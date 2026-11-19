// PyTerm background worker: runs Pyodide (CPython 3.14 on WebAssembly) off the main thread.
// The page talks to it with postMessage (see engine.js for the protocol).
//
// - stdout/stderr are batched and posted to the page as {type:'out'}.
// - input() blocks Python until the page answers. With a SharedArrayBuffer (cross-origin
//   isolated pages) the worker waits with Atomics.wait; otherwise Pyodide's JSPI stack
//   switching (run_sync) suspends Python while the worker keeps receiving messages.
// - Ctrl+C / Stop uses Pyodide's interrupt buffer when shared memory is available, and
//   cancels pending awaits otherwise. The page can always terminate the worker (hard stop).
// - /home/pyodide/browser is an IndexedDB-backed folder (Emscripten IDBFS) that survives reloads.
// - Back-pressure: every output message has a sequence number and the page answers {type:'drawn'}
//   once it has shown it. time.sleep() / asyncio.sleep() first wait (up to DRAIN_MAX ms) until the
//   page has caught up, so a fast animation can never queue more frames than the page can draw.

import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';

const HOME = '/home/pyodide';
const PERSIST_DIR = HOME + '/browser';
const dec = new TextDecoder();

let py = null;
let api = null;
let interruptBuf = null;
let stdinCtl = null;
let stdinData = null;
let inputWaiter = null;
const sleepers = new Set(); // pending time.sleep() calls, woken early by Stop
let pendingInterrupt = false; // Stop arrived while nothing was waiting: deliver it at the next sleep/input
const rpcs = new Map();       // pending requests from Python to the page (pyterm._bridge)
let rpcSeq = 0;
const rpcError = (code, message) => new Error(JSON.stringify({ code, message }));

/* ---------- back-pressure: wait until the page has drawn our output ---------- */
const DRAIN_MAX = 1000;       // never wait longer than this for the page (ms)
let outSeq = 0;               // last output message sent
let drawnSeq = 0;             // last output message the page has drawn
let drawnCell = null;         // Int32Array on shared memory (cross-origin isolated pages only)
const drainWaiters = new Set();

function drained() {
  if (drawnCell) drawnSeq = Math.max(drawnSeq, Atomics.load(drawnCell, 0));
  return drawnSeq >= outSeq;
}
function onDrawn(seq) {
  if (seq > drawnSeq) drawnSeq = seq;
  if (drawnSeq >= outSeq) for (const w of [...drainWaiters]) w();
}
// Promise resolved when the page has drawn everything sent so far (or after maxMs).
function drain(maxMs = DRAIN_MAX) {
  flushOut();
  if (drained()) return Promise.resolve();
  return new Promise((resolve) => {
    let t = 0;
    const done = () => { clearTimeout(t); drainWaiters.delete(done); resolve(); };
    t = setTimeout(done, Math.max(0, maxMs));
    drainWaiters.add(done);
  });
}

// The pyterm package (pylib/pyterm/*.py) is installed in ~/.pyterm/pyterm
const PYTERM_FILES = ['__init__.py', 'console.py', 'packages.py', 'programs.py', 'sso.py', '_bridge.py'];
let persist = false;
let size = [80, 24];
let sizeDirty = true;

let initDone;
const initPromise = new Promise((r) => { initDone = r; });
let chain = initPromise;

/* ---------- output batching ---------- */
let outBuf = '';
let outKind = 'out';
let lastPost = 0;
let flushTimer = 0;

function flushOut() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
  if (outBuf) {
    self.postMessage({ type: 'out', text: outBuf, kind: outKind, seq: ++outSeq });
    outBuf = '';
  }
  lastPost = performance.now();
}

function out(text, kind = 'out') {
  if (!text) return;
  if (kind !== outKind) { flushOut(); outKind = kind; }
  outBuf += text;
  const now = performance.now();
  if (now - lastPost > 12 || outBuf.length > 65536) flushOut();
  else if (!flushTimer) flushTimer = setTimeout(flushOut, 0);
}

/* ---------- persistent folder ---------- */
let syncing = null;
let syncAgain = false;
let syncTimer = 0;

function syncOut() {
  if (!persist || !py) return Promise.resolve();
  if (syncing) { syncAgain = true; return syncing; }
  syncing = new Promise((resolve) => {
    try {
      py.FS.syncfs(false, (err) => {
        if (err) console.warn('PyTerm: could not save ~/browser', err);
        syncing = null;
        resolve();
        if (syncAgain) { syncAgain = false; syncOut(); }
      });
    } catch (e) {
      console.warn('PyTerm: could not save ~/browser', e);
      syncing = null;
      resolve();
    }
  });
  return syncing;
}

function scheduleSync(delay = 250) {
  if (!persist) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncOut, delay);
}

/* ---------- functions Python can call (import pyterm_host) ---------- */
function inputRequest(password, completions, history, via) {
  flushOut();
  let comps = null;
  if (completions && typeof completions.length === 'number') comps = Array.from(completions, String);
  return {
    type: 'input',
    via,
    password: !!password,
    completions: comps,
    history: history ? String(history) : null,
  };
}

const host = {
  out: (text, kind) => out(String(text), kind ? String(kind) : 'out'),
  flush: () => flushOut(),
  clear: () => { flushOut(); self.postMessage({ type: 'clear' }); },
  title: (t) => { flushOut(); self.postMessage({ type: 'title', text: String(t) }); },
  can_block: () => !!stdinCtl,
  // Blocking read through shared memory (only when the page is cross-origin isolated).
  read_input(password, completions, history) {
    Atomics.store(stdinCtl, 0, 0);
    self.postMessage(inputRequest(password, completions, history, 'sab'));
    while (Atomics.load(stdinCtl, 0) === 0) Atomics.wait(stdinCtl, 0, 0, 500);
    const status = Atomics.load(stdinCtl, 0);
    const len = Atomics.load(stdinCtl, 1);
    const text = dec.decode(stdinData.slice(0, len));
    Atomics.store(stdinCtl, 0, 0);
    return [status, text];
  },
  // Promise-based read (used with run_sync / JSPI, and by `await ainput()`).
  input_async(password, completions, history) {
    scheduleSync(0);
    if (pendingInterrupt) { pendingInterrupt = false; return Promise.resolve([3, '']); }
    return new Promise((resolve) => {
      inputWaiter = resolve;
      self.postMessage(inputRequest(password, completions, history, 'msg'));
    });
  },
  // time.sleep() under JSPI: resolves 0 when done, 1 when interrupted. It first waits until the
  // page has drawn the output (that time counts as part of the sleep), then sleeps the rest.
  sleep(ms) {
    flushOut();
    if (pendingInterrupt) { pendingInterrupt = false; return Promise.resolve(1); }
    const total = Math.max(0, Number(ms) || 0);
    return new Promise((resolve) => {
      const start = performance.now();
      const entry = { t: 0, done: false, resolve: null };
      entry.resolve = (v) => {
        if (entry.done) return;
        entry.done = true;
        clearTimeout(entry.t);
        sleepers.delete(entry);
        resolve(v);
      };
      sleepers.add(entry);
      drain().then(() => {
        if (entry.done) return;
        entry.t = setTimeout(() => entry.resolve(0), Math.max(0, total - (performance.now() - start)));
      });
    });
  },
  // asyncio.sleep(): promise resolved when the page has drawn the output (at most maxMs)
  drain: (maxMs) => drain(maxMs == null ? DRAIN_MAX : Number(maxMs)),
  // Shared-memory variant for the blocking time.sleep() fallback: waits at most maxMs.
  wait_drawn(maxMs) {
    flushOut();
    if (!drawnCell) return;
    const end = performance.now() + Math.max(0, Number(maxMs) || 0);
    for (;;) {
      const d = Atomics.load(drawnCell, 0);
      if (d >= outSeq) return;
      const left = end - performance.now();
      if (left <= 0) return;
      Atomics.wait(drawnCell, 0, d, Math.min(left, 50));
    }
  },
  progress: (done, total, label) => {
    self.postMessage({ type: 'progress', done: Number(done), total: Number(total), label: label ? String(label) : '' });
  },
  download: (name, data, mime) => {
    flushOut();
    const copy = new Uint8Array(data);
    self.postMessage({ type: 'download', name: String(name), data: copy, mime: mime ? String(mime) : '' }, [copy.buffer]);
  },
  // Request to the page (sign-in, programs list, …): resolves with {json, blobs}.
  rpc(name, argsJson) {
    flushOut();
    if (pendingInterrupt) { pendingInterrupt = false; return Promise.reject(rpcError('interrupted', 'Interrupted')); }
    const rid = ++rpcSeq;
    return new Promise((resolve, reject) => {
      rpcs.set(rid, { resolve, reject });
      self.postMessage({ type: 'rpc', rid, name: String(name), args: String(argsJson || '{}') });
    });
  },
  // One-way notification to the page (e.g. a program launched with run() has ended).
  event: (name, json) => { flushOut(); self.postMessage({ type: 'event', name: String(name), data: json ? String(json) : '' }); },
  load_imports: (src) => py.loadPackagesFromImports(String(src), {
    messageCallback: (m) => out(m + '\n', 'info'),
    errorCallback: (m) => out(m + '\n', 'err'),
  }),
};

/* ---------- boot ---------- */
async function init(m) {
  try {
    if (m.interrupt) interruptBuf = m.interrupt;
    if (m.drawn) drawnCell = new Int32Array(m.drawn);
    if (m.stdin) {
      stdinCtl = new Int32Array(m.stdin, 0, 2);
      stdinData = new Uint8Array(m.stdin, 8);
    }
    if (m.cols) size = [m.cols, m.rows];
    self.postMessage({ type: 'status', text: 'Downloading the Python runtime…' });
    py = await loadPyodide({
      env: { HOME, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    const outDec = new TextDecoder();
    const errDec = new TextDecoder();
    py.setStdout({ write: (b) => { out(outDec.decode(b, { stream: true })); return b.length; }, isatty: true });
    py.setStderr({ write: (b) => { out(errDec.decode(b, { stream: true }), 'err'); return b.length; }, isatty: true });
    if (interruptBuf) py.setInterruptBuffer(interruptBuf);

    self.postMessage({ type: 'status', text: 'Opening your browser folder…' });
    try {
      py.FS.mkdirTree(PERSIST_DIR);
      py.FS.mount(py.FS.filesystems.IDBFS, {}, PERSIST_DIR);
      await new Promise((resolve, reject) => py.FS.syncfs(true, (err) => (err ? reject(err) : resolve())));
      persist = true;
    } catch (e) {
      console.warn('PyTerm: persistent folder unavailable', e);
      persist = false;
    }

    self.postMessage({ type: 'status', text: 'Loading the standard library…' });
    py.registerJsModule('pyterm_host', host);
    const base = new URL('./', import.meta.url);
    const sources = ['repl.py', ...PYTERM_FILES.map((f) => `pylib/pyterm/${f}`)];
    const [repl, ...lib] = await Promise.all(sources.map(async (f) => {
      const r = await fetch(new URL(f, base), { cache: 'no-cache' });
      if (!r.ok) throw new Error(`Could not load ${f} (${r.status})`);
      return r.text();
    }));
    py.FS.mkdirTree(HOME + '/.pyterm/pyterm');
    PYTERM_FILES.forEach((f, i) => py.FS.writeFile(`${HOME}/.pyterm/pyterm/${f}`, lib[i]));

    const ns = py.toPy({});
    py.runPython(repl, { globals: ns, filename: '<pyterm>' });
    const names = ['push', 'complete', 'reset_buffer', 'restart', 'set_size', 'stage_file', 'interrupt',
      'save_upload', 'extract_upload', 'tree', 'read_for_download'];
    api = {};
    for (const n of names) api[n] = ns.get(n);
    const version = String(ns.get('VERSION'));

    self.postMessage({
      type: 'ready',
      version,
      persist,
      shared: !!stdinCtl,
      interrupt: !!interruptBuf,
      jspi: typeof WebAssembly.Suspending === 'function',
    });
  } catch (e) {
    self.postMessage({ type: 'fatal', message: String((e && e.message) || e) });
  } finally {
    initDone();
  }
}

function removeTree(path) {
  try {
    const st = py.FS.lstat(path);
    if (py.FS.isDir(st.mode)) {
      for (const n of py.FS.readdir(path)) if (n !== '.' && n !== '..') removeTree(`${path}/${n}`);
      py.FS.rmdir(path);
    } else {
      py.FS.unlink(path);
    }
  } catch (e) {
    console.warn('PyTerm: could not remove', path, e);
  }
}

/* ---------- requests ---------- */
function toPlain(v) {
  if (v && typeof v === 'object' && typeof v.toJs === 'function') {
    const r = v.toJs({ dict_converter: Object.fromEntries });
    try { v.destroy(); } catch {}
    return r;
  }
  return v;
}

async function handle(m) {
  let value = null;
  let error = null;
  try {
    if (!api) throw new Error('Python is not available');
    if (sizeDirty) { api.set_size(size[0], size[1]); sizeDirty = false; }
    if (m.type === 'push' || m.type === 'run_file') pendingInterrupt = false;
    switch (m.type) {
      case 'push':
        if (/\bimport\b/.test(m.line)) {
          try { await host.load_imports(m.line); } catch {}
        }
        value = await api.push(m.line);
        break;
      case 'complete':
        value = api.complete(m.source);
        break;
      case 'reset_buffer':
        api.reset_buffer();
        break;
      case 'restart':
        api.restart();
        break;
      case 'run_file': {
        // load Pyodide packages imported by the program and by its libraries
        for (const src of [m.source, ...(m.extra || [])]) {
          if (src && /\bimport\b/.test(src)) {
            try { await host.load_imports(src); } catch {}
          }
        }
        api.stage_file(m.name, m.source, !!m.isolated, m.paths && m.paths.length ? m.paths : null,
          m.requires && m.requires.length ? m.requires : null);
        value = await api.push('await __pyterm_run__()');
        break;
      }
      case 'write_files': {
        // install program / library files fetched by the page: [{path, data(ArrayBuffer)}]
        // ~/programs holds one programs list at a time: files of another list are removed first
        if (m.marker && m.catalog) {
          let prev = null;
          try { prev = dec.decode(py.FS.readFile(m.marker)).trim(); } catch {}
          const dir = m.marker.slice(0, m.marker.lastIndexOf('/'));
          if (prev !== m.catalog && py.FS.analyzePath(dir).exists) removeTree(dir);
        }
        for (const f of m.files || []) {
          const dir = f.path.slice(0, f.path.lastIndexOf('/'));
          if (dir) py.FS.mkdirTree(dir);
          py.FS.writeFile(f.path, new Uint8Array(f.data));
        }
        value = (m.files || []).length;
        break;
      }
      case 'save':
        value = api.save_upload(m.path, m.data, m.policy || 'rename');
        break;
      case 'extract':
        value = api.extract_upload(m.name, m.data, m.dest, m.policy || 'rename', !!m.subfolder);
        break;
      case 'tree':
        api.tree(m.path, m.limit || 60, true);
        break;
      case 'read':
        value = api.read_for_download(m.path);
        break;
      case 'sync':
        await syncOut();
        break;
      default:
        throw new Error('Unknown request ' + m.type);
    }
    value = toPlain(value);
  } catch (e) {
    error = String((e && e.message) || e);
  }
  flushOut();
  self.postMessage({ type: 'result', id: m.id, value, error });
  scheduleSync();
}

self.onmessage = (e) => {
  const m = e.data || {};
  switch (m.type) {
    case 'init':
      init(m);
      return;
    case 'drawn':
      onDrawn(Number(m.seq) || 0);
      return;
    case 'input_reply':
      if (inputWaiter) { const w = inputWaiter; inputWaiter = null; w([m.status, m.text || '']); }
      return;
    case 'rpc_result': {
      const r = rpcs.get(m.rid);
      if (!r) return;
      rpcs.delete(m.rid);
      if (m.error) r.reject(rpcError(m.error.code || 'error', m.error.message || 'Request failed'));
      else r.resolve({ json: m.json == null ? 'null' : m.json, blobs: (m.blobs || []).map((b) => new Uint8Array(b)) });
      return;
    }
    case 'interrupt':
      for (const w of [...drainWaiters]) w(); // never make Stop wait for the page
      if (inputWaiter) { const w = inputWaiter; inputWaiter = null; w([3, '']); return; }
      if (rpcs.size) {
        // Python is waiting for the page (e.g. a sign-in dialog): cancel it → KeyboardInterrupt
        for (const [rid, r] of rpcs) { r.reject(rpcError('interrupted', 'Interrupted')); self.postMessage({ type: 'rpc_cancel', rid }); }
        rpcs.clear();
        if (interruptBuf) interruptBuf[0] = 0;
        return;
      }
      if (sleepers.size) {
        // Python is inside time.sleep(): wake it with a KeyboardInterrupt
        for (const s of sleepers) { clearTimeout(s.t); s.resolve(1); }
        sleepers.clear();
        if (interruptBuf) interruptBuf[0] = 0;
        return;
      }
      pendingInterrupt = true;
      if (api) { try { api.interrupt(); } catch {} }
      return;
    case 'size':
      size = [m.cols, m.rows];
      sizeDirty = true;
      // apply right away too, so a running program (e.g. a full-screen animation) sees the new size
      if (api) { try { api.set_size(m.cols, m.rows); sizeDirty = false; } catch {} }
      return;
    case 'flush_fs':
      syncOut();
      return;
    // File operations skip the request queue, so uploads work while user code runs:
    // the worker gets these messages whenever Python is waiting (input(), time.sleep(),
    // await …) and writes the files at once. A pure CPU loop delays them until it yields.
    case 'save':
    case 'extract':
    case 'read':
    case 'sync':
      initPromise.then(() => handle(m));
      return;
    default:
      chain = chain.then(() => handle(m));
  }
};
