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
    self.postMessage({ type: 'out', text: outBuf, kind: outKind });
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
    return new Promise((resolve) => {
      inputWaiter = resolve;
      self.postMessage(inputRequest(password, completions, history, 'msg'));
    });
  },
  progress: (done, total, label) => {
    self.postMessage({ type: 'progress', done: Number(done), total: Number(total), label: label ? String(label) : '' });
  },
  download: (name, data, mime) => {
    flushOut();
    const copy = new Uint8Array(data);
    self.postMessage({ type: 'download', name: String(name), data: copy, mime: mime ? String(mime) : '' }, [copy.buffer]);
  },
  load_imports: (src) => py.loadPackagesFromImports(String(src), {
    messageCallback: (m) => out(m + '\n', 'info'),
    errorCallback: (m) => out(m + '\n', 'err'),
  }),
};

/* ---------- boot ---------- */
async function init(m) {
  try {
    if (m.interrupt) interruptBuf = m.interrupt;
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
    const [repl, lib] = await Promise.all(['repl.py', 'pyterm_lib.py'].map(async (f) => {
      const r = await fetch(new URL(f, base));
      if (!r.ok) throw new Error(`Could not load ${f} (${r.status})`);
      return r.text();
    }));
    py.FS.mkdirTree(HOME + '/.pyterm');
    py.FS.writeFile(HOME + '/.pyterm/pyterm.py', lib);

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
      case 'run_file':
        if (/\bimport\b/.test(m.source)) {
          try { await host.load_imports(m.source); } catch {}
        }
        api.stage_file(m.name, m.source, !!m.isolated);
        value = await api.push('await __pyterm_run__()');
        break;
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
    case 'input_reply':
      if (inputWaiter) { const w = inputWaiter; inputWaiter = null; w([m.status, m.text || '']); }
      return;
    case 'interrupt':
      if (inputWaiter) { const w = inputWaiter; inputWaiter = null; w([3, '']); return; }
      if (api) { try { api.interrupt(); } catch {} }
      return;
    case 'size':
      size = [m.cols, m.rows];
      sizeDirty = true;
      return;
    case 'flush_fs':
      syncOut();
      return;
    default:
      chain = chain.then(() => handle(m));
  }
};
