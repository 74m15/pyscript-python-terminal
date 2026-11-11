// Main-thread side of the Python worker (py-worker.js).
//
// Messages page → worker: init, push, complete, reset_buffer, restart, run_file, save, extract,
//   tree, read, sync (all answered with {type:'result', id}), plus input_reply, interrupt, size, flush_fs.
// Messages worker → page: status, ready, fatal, out, clear, title, input, progress, download, result.

const enc = new TextEncoder();
const STDIN_BYTES = 1 << 20;

export class PythonEngine {
  constructor(handlers = {}) {
    this.h = handlers;
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
    this.info = null;
    this.size = [80, 24];
    this.inputRequest = null;
  }

  get shared() { return typeof SharedArrayBuffer === 'function' && self.crossOriginIsolated === true; }

  start() {
    this.stop();
    this.info = null;
    const w = new Worker(new URL('./py-worker.js', import.meta.url), { type: 'module', name: 'pyterm-python' });
    this.worker = w;
    this.interrupt = null;
    this.stdin = null;
    if (this.shared) {
      this.interrupt = new Uint8Array(new SharedArrayBuffer(1));
      this.stdin = new SharedArrayBuffer(8 + STDIN_BYTES);
      this.stdinCtl = new Int32Array(this.stdin, 0, 2);
      this.stdinData = new Uint8Array(this.stdin, 8);
    }
    w.onmessage = (e) => this._onMessage(e.data);
    w.onerror = (e) => {
      e.preventDefault && e.preventDefault();
      if (!this.info) this.h.onFatal && this.h.onFatal(e.message || 'The Python worker failed to start');
    };
    w.postMessage({ type: 'init', interrupt: this.interrupt, stdin: this.stdin, cols: this.size[0], rows: this.size[1] });
  }

  stop() {
    if (this.worker) { try { this.worker.terminate(); } catch {} }
    this.worker = null;
    this.inputRequest = null;
    for (const { reject } of this.pending.values()) reject(new Error('Python was stopped'));
    this.pending.clear();
  }

  _onMessage(m) {
    switch (m.type) {
      case 'out': this.h.onOutput && this.h.onOutput(m.text, m.kind); break;
      case 'clear': this.h.onClear && this.h.onClear(); break;
      case 'title': this.h.onTitle && this.h.onTitle(m.text); break;
      case 'status': this.h.onStatus && this.h.onStatus(m.text); break;
      case 'progress': this.h.onProgress && this.h.onProgress(m); break;
      case 'download': this.h.onDownload && this.h.onDownload(m.name, m.data, m.mime); break;
      case 'input': this.inputRequest = m; this.h.onInput && this.h.onInput(m); break;
      case 'ready': this.info = m; this.h.onReady && this.h.onReady(m); break;
      case 'fatal': this.h.onFatal && this.h.onFatal(m.message); break;
      case 'result': {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error)); else p.resolve(m.value);
        break;
      }
    }
  }

  call(type, payload = {}, transfer = []) {
    if (!this.worker) return Promise.reject(new Error('Python is not running'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type, id, ...payload }, transfer);
    });
  }

  /** status: 1 = line, 2 = EOF (Ctrl+D), 3 = KeyboardInterrupt (Ctrl+C) */
  reply(text, status = 1) {
    const req = this.inputRequest;
    if (!req || !this.worker) return;
    this.inputRequest = null;
    if (req.via === 'sab' && this.stdinCtl) {
      let bytes = enc.encode(text);
      if (bytes.length > STDIN_BYTES) bytes = bytes.slice(0, STDIN_BYTES);
      this.stdinData.set(bytes);
      Atomics.store(this.stdinCtl, 1, bytes.length);
      Atomics.store(this.stdinCtl, 0, status);
      Atomics.notify(this.stdinCtl, 0);
    } else {
      this.worker.postMessage({ type: 'input_reply', text, status });
    }
  }

  sendInterrupt() {
    if (!this.worker) return;
    if (this.inputRequest) { this.reply('', 3); return; }
    if (this.interrupt) this.interrupt[0] = 2;
    this.worker.postMessage({ type: 'interrupt' });
  }

  resize(cols, rows) {
    this.size = [cols, rows];
    if (this.worker) this.worker.postMessage({ type: 'size', cols, rows });
  }

  flushFs() { if (this.worker) this.worker.postMessage({ type: 'flush_fs' }); }
}
