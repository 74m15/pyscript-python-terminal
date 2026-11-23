// PyTerm background worker: runs Pyodide (CPython 3.14 on WebAssembly) off the main thread.
// The page talks to it with postMessage (see engine.js for the protocol).
//
// - stdout/stderr are batched and posted to the page as {type:'out'}.
// - input() blocks Python until the page answers. With a SharedArrayBuffer (cross-origin
//   isolated pages) the worker waits with Atomics.wait; otherwise Pyodide's JSPI stack
//   switching (run_sync) suspends Python while the worker keeps receiving messages.
// - Ctrl+C / Stop uses Pyodide's interrupt buffer when shared memory is available, and
//   cancels pending awaits otherwise. The page can always terminate the worker (hard stop).
// - /storage is the root of the folders kept outside Python's memory:
//     /storage/browser        IndexedDB-backed folder (Emscripten IDBFS) that survives reloads
//     /storage/local/<name>   folders of the computer, mounted with pyterm.storage.mount(name):
//                             the page lets the user pick a folder (File System Access API),
//                             its handle comes here, the files are copied into memory and
//                             Python's changes are written back on every sync (see below)
//   ~/browser and ~/storage are links to /storage/browser and /storage. Files saved by older
//   versions in the old /home/pyodide/browser database are moved to /storage/browser once.
// - Back-pressure: every output message has a sequence number and the page answers {type:'drawn'}
//   once it has shown it. time.sleep() / asyncio.sleep() first wait (up to DRAIN_MAX ms) until the
//   page has caught up, so a fast animation can never queue more frames than the page can draw.

import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';

const HOME = '/home/pyodide';
const STORAGE_DIR = '/storage';
const PERSIST_DIR = STORAGE_DIR + '/browser';
const LOCAL_DIR = STORAGE_DIR + '/local';
const OLD_PERSIST_DIR = HOME + '/browser'; // where ~/browser was mounted before /storage existed
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
const PYTERM_FILES = ['__init__.py', 'console.py', 'packages.py', 'programs.py', 'sso.py', 'storage.py', '_bridge.py'];
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
  if (!py || (!persist && !locals.size)) return Promise.resolve();
  if (syncing) { syncAgain = true; return syncing; }
  syncing = (async () => {
    if (persist) {
      try { await syncfs(false); } catch (e) { console.warn('PyTerm: could not save /storage/browser', e); }
    }
    for (const m of [...locals.values()]) {
      try { await saveLocal(m); } catch (e) { console.warn(`PyTerm: could not save ${m.path} to the computer`, e); }
    }
    syncing = null;
    if (syncAgain) { syncAgain = false; syncOut(); }
  })();
  return syncing;
}

/* ---------- folders of the computer: /storage/local/<name> (pyterm.storage) ---------- */
// Each mount keeps the folder's handle and a snapshot of what Python's copy looked like at the
// last sync (relative path → {dir, mtime, size}). Saving writes files that changed since then
// and removes entries Python deleted. Entries that were never in the snapshot (added on the
// computer after the mount) are never touched; refresh() reads them.
const LOCAL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const locals = new Map(); // name → {name, path, folder, since, handle, snap}
let localChain = Promise.resolve();

const localInfo = (m) => ({ name: m.name, path: m.path, folder: m.folder, since: m.since });
const serial = (fn) => { const p = localChain.then(fn); localChain = p.catch(() => {}); return p; };

async function readLocalTree(handle, dir, rel, snap) {
  let n = 0;
  for await (const [name, h] of handle.entries()) {
    const p = `${dir}/${name}`, r = rel ? `${rel}/${name}` : name;
    if (h.kind === 'directory') {
      py.FS.mkdirTree(p);
      snap.set(r, { dir: true });
      n += await readLocalTree(h, p, r, snap);
    } else {
      const f = await h.getFile();
      py.FS.writeFile(p, new Uint8Array(await f.arrayBuffer()));
      try { py.FS.utime(p, f.lastModified, f.lastModified); } catch {}
      const st = py.FS.stat(p);
      snap.set(r, { dir: false, mtime: +st.mtime, size: st.size });
      n++;
    }
  }
  return n;
}

async function dirHandleOf(root, parts) {
  let h = root;
  for (const p of parts) h = await h.getDirectoryHandle(p);
  return h;
}

async function writeLocalFile(dh, name, data) {
  const fh = await dh.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try { await w.write(data); await w.close(); }
  catch (e) { try { await w.abort(); } catch {} throw e; }
}

function saveLocal(m) {
  return serial(async () => {
    if (locals.get(m.name) !== m || !py.FS.analyzePath(m.path).exists) return { written: 0, removed: 0 };
    let written = 0, removed = 0;
    const seen = new Set();
    const walk = async (dir, rel, dh) => {
      for (const name of entries(dir)) {
        const p = `${dir}/${name}`, r = rel ? `${rel}/${name}` : name;
        const st = py.FS.lstat(p);
        const old = m.snap.get(r);
        if (py.FS.isDir(st.mode)) {
          seen.add(r);
          if (old && !old.dir) { try { await dh.removeEntry(name); } catch {} }
          const sub = await dh.getDirectoryHandle(name, { create: true });
          m.snap.set(r, { dir: true });
          await walk(p, r, sub);
        } else if (py.FS.isFile(st.mode)) {
          seen.add(r);
          const cur = { dir: false, mtime: +st.mtime, size: st.size };
          if (!old || old.dir || old.mtime !== cur.mtime || old.size !== cur.size) {
            if (old && old.dir) { try { await dh.removeEntry(name, { recursive: true }); } catch {} }
            await writeLocalFile(dh, name, py.FS.readFile(p));
            m.snap.set(r, cur);
            written++;
          }
        } // links and other special files stay in Python only
      }
    };
    await walk(m.path, '', m.handle);
    // entries Python deleted since the last sync (parents first; their children go with them)
    const gone = [...m.snap.keys()].filter((r) => !seen.has(r)).sort((a, b) => a.length - b.length);
    const done = [];
    for (const r of gone) {
      m.snap.delete(r);
      if (done.some((d) => r.startsWith(d + '/'))) continue;
      done.push(r);
      const parts = r.split('/');
      const name = parts.pop();
      try {
        const dh = await dirHandleOf(m.handle, parts);
        await dh.removeEntry(name, { recursive: true });
        removed++;
      } catch (e) {
        if (!e || e.name !== 'NotFoundError') throw e;
      }
    }
    return { written, removed };
  });
}

function localError(code, e) {
  const msg = (e && e.message) || String(e);
  return rpcError(code, msg);
}

function checkLocalName(name) {
  const n = String(name == null ? '' : name).trim();
  if (!LOCAL_NAME.test(n)) throw rpcError('invalid_name', `invalid name ${JSON.stringify(n)}`);
  return n;
}

function getLocal(name) {
  const m = locals.get(checkLocalName(name));
  if (!m) throw rpcError('not_mounted', `nothing is mounted at ${LOCAL_DIR}/${name}`);
  return m;
}

const localHost = {
  local_list: () => JSON.stringify([...locals.values()].map(localInfo)),

  async local_mount(name) {
    const n = checkLocalName(name);
    const path = `${LOCAL_DIR}/${n}`;
    if (locals.has(n)) throw rpcError('already_mounted', `${path} is already mounted`);
    const st = py.FS.analyzePath(path);
    if (st.exists && (!py.FS.isDir(py.FS.lstat(path).mode) || entries(path).length)) {
      throw rpcError('not_empty', `${path} already exists and is not an empty folder`);
    }
    const res = await host.rpc('storage.pick', JSON.stringify({ name: n, path }));
    const handle = res && res.objects && res.objects.handle;
    if (!handle || handle.kind !== 'directory') throw rpcError('error', 'no folder was received from the page');
    if (locals.has(n)) throw rpcError('already_mounted', `${path} is already mounted`);
    if (typeof handle.queryPermission === 'function') {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') throw rpcError('denied', 'PyTerm may not change this folder');
    }
    return serial(async () => {
      py.FS.mkdirTree(path);
      const snap = new Map();
      try {
        await readLocalTree(handle, path, '', snap);
      } catch (e) {
        removeTree(path);
        throw localError('error', `could not read the folder: ${(e && e.message) || e}`);
      }
      const m = { name: n, path, folder: handle.name, since: Date.now() / 1000, handle, snap };
      locals.set(n, m);
      return JSON.stringify(localInfo(m));
    });
  },

  async local_unmount(name, save) {
    const m = getLocal(name);
    if (save !== false) {
      try { await saveLocal(m); }
      catch (e) { throw localError('save_failed', `could not save ${m.path} (still mounted; unmount(name, save=False) drops the changes): ${(e && e.message) || e}`); }
    }
    return serial(async () => {
      locals.delete(m.name);
      removeTree(m.path);
      return JSON.stringify(localInfo(m));
    });
  },

  async local_save(name) {
    const list = name == null ? [...locals.values()] : [getLocal(name)];
    const total = { written: 0, removed: 0 };
    for (const m of list) {
      try {
        const r = await saveLocal(m);
        total.written += r.written;
        total.removed += r.removed;
      } catch (e) {
        throw localError('save_failed', `could not save ${m.path}: ${(e && e.message) || e}`);
      }
    }
    return JSON.stringify(total);
  },

  async local_refresh(name) {
    const m = getLocal(name);
    try { await saveLocal(m); }
    catch (e) { throw localError('save_failed', `could not save ${m.path} before reading it again: ${(e && e.message) || e}`); }
    return serial(async () => {
      const before = new Set([...m.snap].filter(([, v]) => !v.dir).map(([k]) => k));
      for (const n of entries(m.path)) removeTree(`${m.path}/${n}`);
      const snap = new Map();
      let read;
      try { read = await readLocalTree(m.handle, m.path, '', snap); }
      catch (e) { throw localError('error', `could not read the folder: ${(e && e.message) || e}`); }
      m.snap = snap;
      let removedCount = 0;
      for (const k of before) if (!snap.has(k)) removedCount++;
      return JSON.stringify({ read, removed: removedCount });
    });
  },
};

const syncfs = (populate) => new Promise((resolve, reject) => py.FS.syncfs(populate, (err) => (err ? reject(err) : resolve())));
const entries = (dir) => py.FS.readdir(dir).filter((n) => n !== '.' && n !== '..');

function copyTree(src, dst) {
  let n = 0;
  for (const name of entries(src)) {
    const from = `${src}/${name}`, to = `${dst}/${name}`;
    const st = py.FS.lstat(from);
    if (py.FS.isDir(st.mode)) {
      py.FS.mkdirTree(to);
      n += copyTree(from, to);
    } else if (py.FS.isFile(st.mode)) {
      py.FS.writeFile(to, py.FS.readFile(from));
      try { py.FS.utime(to, +st.mtime, +st.mtime); } catch {}
      n++;
    }
  }
  return n;
}

// IDBFS names its database after the mount point. Files saved by versions that mounted the folder
// at ~/browser are copied into /storage/browser (only while it is still empty), and the old
// database is emptied so this happens once.
async function migrateOldBrowserFolder() {
  if (entries(PERSIST_DIR).length) return 0;
  py.FS.mkdirTree(OLD_PERSIST_DIR);
  py.FS.mount(py.FS.filesystems.IDBFS, {}, OLD_PERSIST_DIR);
  let moved = 0;
  try {
    await syncfs(true);
    moved = copyTree(OLD_PERSIST_DIR, PERSIST_DIR);
    if (moved) {
      for (const name of entries(OLD_PERSIST_DIR)) removeTree(`${OLD_PERSIST_DIR}/${name}`);
      await syncfs(false);
    }
  } finally {
    py.FS.unmount(OLD_PERSIST_DIR);
    py.FS.rmdir(OLD_PERSIST_DIR);
  }
  return moved;
}

function link(target, path) {
  try {
    if (py.FS.analyzePath(path).exists) return;
    py.FS.symlink(target, path);
  } catch (e) {
    console.warn('PyTerm: could not create the link', path, e);
  }
}

function scheduleSync(delay = 250) {
  if (!persist && !locals.size) return;
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
  ...localHost,
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
    py.FS.mkdirTree(PERSIST_DIR);
    py.FS.mkdirTree(LOCAL_DIR);
    try {
      py.FS.mount(py.FS.filesystems.IDBFS, {}, PERSIST_DIR);
      await syncfs(true);
      persist = true;
    } catch (e) {
      console.warn('PyTerm: persistent folder unavailable', e);
      persist = false;
    }
    if (persist) {
      try {
        const moved = await migrateOldBrowserFolder();
        if (moved) console.info(`PyTerm: moved ${moved} file(s) from ~/browser to /storage/browser`);
      } catch (e) {
        console.warn('PyTerm: could not move the files of the old ~/browser folder', e);
      }
    }
    link(PERSIST_DIR, HOME + '/browser');
    link(STORAGE_DIR, HOME + '/storage');

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
      else r.resolve({ json: m.json == null ? 'null' : m.json, blobs: (m.blobs || []).map((b) => new Uint8Array(b)), objects: m.objects || null });
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
