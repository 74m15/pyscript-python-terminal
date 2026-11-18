import { createIcons, icons } from 'https://cdn.jsdelivr.net/npm/lucide@latest/+esm';
import { Terminal } from './terminal.js';
import { PythonEngine } from './engine.js';
import { createUploader, collectDrop } from './upload.js';
import { createSSO, SSOError } from './sso.js';
createIcons({ icons });

const $ = (id) => document.getElementById(id);
const screen = $('screen');
const output = $('output');
const inputRow = $('input-row');
const promptEl = $('prompt');
const cmd = $('cmd');
const statusDot = $('status-dot');
const statusText = $('status-text');

const PS1 = '>>> ';
const PS2 = '... ';
const HISTORY_KEY = 'pyterm-history';
const COLORS = {
  err: '#ff7b72', prompt: '#ffd43b', input: '#e6edf3',
  info: '#7d8b99', result: '#79c0ff', accent: '#7ee787',
};

let ready = false;        // Python is up
let busy = false;         // something is running
let booted = false;       // first boot done (banner shown)
let continuing = false;
let lastIndent = '';
let pyVersion = '';
let inputReq = null;      // pending input() request from Python
let currentProgram = null;
let stopTimer = 0;
let activeRun = null;      // program started by runFile: {id, title, onexit, autoplay}
const programStack = [];  // programs started from Python with run("id")
let lastProgram = null;   // the last program that started or ended
let stopped = null;       // Python was stopped by a program with "onexit": "stop"
let bannerPending = null; // autoplay: the welcome banner waits until the program returns to the prompt
let relaunch = null;      // autoplay program to start again after Restart

/* ---------- history ---------- */
const histories = new Map();
function histKey(name) { return name ? `${HISTORY_KEY}:${name}` : HISTORY_KEY; }
function getHistory(name) {
  const k = histKey(name);
  if (!histories.has(k)) {
    let h = [];
    try { h = JSON.parse(sessionStorage.getItem(k) || '[]'); } catch {}
    histories.set(k, { list: h, index: h.length, draft: '' });
  }
  return histories.get(k);
}
function activeHistory() {
  if (inputReq) {
    if (inputReq.password) return null;
    return getHistory(inputReq.history || (currentProgram ? `program:${currentProgram}` : 'input'));
  }
  return getHistory(null);
}

/* ---------- terminal ---------- */
const term = new Terminal(output, {
  onRender: () => { screen.scrollTop = screen.scrollHeight; },
  onBell: () => {
    screen.classList.remove('bell');
    void screen.offsetWidth;
    screen.classList.add('bell');
  },
  onTitle: (t) => setTitle(t),
});

/* ---------- Puter integration ---------- */
const P = window.puter;
const inPuter = !!(P && P.env === 'app');
$('env-badge').textContent = inPuter ? 'Puter app' : 'Web';

function setTitle(t) {
  $('term-title').textContent = t || 'Python REPL';
  document.title = t ? `${t} — PyTerm` : 'PyTerm — Python REPL';
  if (inPuter) { try { P.ui.setWindowTitle(t ? `PyTerm — ${t}` : 'PyTerm'); } catch {} }
}

function write(text, kind = 'out') {
  if (!text) return;
  if (kind === 'out') term.write(text);
  else term.writeKind(text, COLORS[kind]);
}
function ensureNewline() { term.prepareForPrompt(); }
function clearScreen() {
  term.clear();
  if (inputReq) showInput(true);
  else if (ready && !busy) term.attachInput(inputRow);
}

/* ---------- python engine ---------- */
const engine = new PythonEngine({
  onOutput: (text, kind) => write(text, kind),
  onClear: () => clearScreen(),
  onTitle: (t) => setTitle(t),
  onStatus: (t) => { const l = $('loader-text'); if (l) l.textContent = t; },
  onInput: (req) => beginInput(req),
  onDownload: (name, data, mime) => saveBlob(new Blob([data], { type: mime || 'application/octet-stream' }), name),
  onReady: (info) => (booted ? pythonReady(info) : programsLoaded.then(() => pythonReady(info))),
  onRpc: (m) => handleRpc(m),
  onRpcCancel: (rid) => cancelRpc(rid),
  onEvent: (name, data) => handleEvent(name, data),
  onFatal: (msg) => {
    setStatus('error');
    const l = $('loader-text');
    if (l) l.textContent = 'Python could not start: ' + msg;
    else write(`Python could not start: ${msg}\n`, 'err');
  },
});

/* ---------- size ---------- */
let charW = 0, lineH = 0;
function measure() {
  const probe = document.createElement('div');
  probe.className = 'tl';
  probe.style.cssText = 'position:absolute;visibility:hidden;width:auto;display:inline-block;';
  probe.textContent = 'M'.repeat(50);
  output.appendChild(probe);
  const r = probe.getBoundingClientRect();
  charW = r.width / 50 || 8;
  lineH = r.height || 20;
  probe.remove();
}
function fit() {
  measure();
  const cs = getComputedStyle(screen);
  const h = screen.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const cols = Math.max(20, Math.floor(output.clientWidth / charW));
  const rows = Math.max(5, Math.floor(h / lineH));
  term.resize(cols, rows);
  $('term-size').textContent = `${cols}×${rows}`;
  engine.resize(cols, rows);
}
new ResizeObserver(() => fit()).observe(screen);
fit();

/* ---------- status ---------- */
function setStatus(state) {
  const map = {
    starting: ['bg-amber-400 dot-pulse', 'Starting'],
    ready: ['bg-emerald-400', 'Ready'],
    running: ['bg-sky-400 dot-pulse', 'Running'],
    input: ['bg-violet-400 dot-pulse', 'Waiting for input'],
    signin: ['bg-violet-400 dot-pulse', 'Waiting for sign-in'],
    stopping: ['bg-amber-400 dot-pulse', 'Stopping'],
    stopped: ['bg-slate-500', 'Stopped'],
    error: ['bg-red-400', 'Failed'],
  };
  const [cls, label] = map[state];
  statusDot.className = 'w-1.5 h-1.5 rounded-full ' + cls;
  statusText.textContent = currentProgram && (state === 'running' || state === 'input' || state === 'signin') ? `${label} · ${currentProgram}` : label;
  const showStop = state === 'running' || state === 'input' || state === 'signin' || state === 'stopping';
  $('btn-stop').classList.toggle('hidden', !showStop);
  $('btn-stop').classList.toggle('inline-flex', showStop);
}

function banner(info) {
  write(`Python ${pyVersion}`, 'accent');
  write(' on WebAssembly (Pyodide, background worker)\n', 'info');
  write('Type "help", "copyright", "credits" or "license" for more information.\n', 'info');
  write('Try ', 'info'); write('await demo()', 'prompt');
  write(', the Programs menu, or Upload to add files. ', 'info');
  if (info.persist) { write('~/browser', 'accent'); write(' keeps files after a reload.\n', 'info'); }
  else write('\n', 'info');
  if (!catalog.builtin) {
    write('Programs from ', 'info'); write(catalogLabel(), 'accent');
    write(` (${programs.length} program${programs.length === 1 ? '' : 's'})\n`, 'info');
  }
  if (!info.jspi && !info.shared) {
    write('Note: this browser can\'t pause Python for input() — use await pyterm.ainput() instead.\n', 'err');
  }
}

/* ---------- input line ---------- */
function setPrompt(p) {
  promptEl.textContent = p;
  promptEl.classList.add('repl');
}
function showInput(show) {
  inputRow.classList.toggle('hidden', !show);
  inputRow.classList.toggle('flex', show);
  term.showCursor = !show;
  if (show) {
    if (!inputReq) ensureNewline();
    term.attachInput(inputRow);
    autosize();
    cmd.focus({ preventScroll: true });
    screen.scrollTop = screen.scrollHeight;
  } else {
    term.detachInput();
  }
}
function autosize() {
  cmd.style.height = 'auto';
  cmd.style.height = cmd.scrollHeight + 'px';
}
cmd.addEventListener('input', autosize);

function updateHistoryCount() {
  const n = getHistory(null).list.length;
  $('history-count').textContent = `${n} command${n === 1 ? '' : 's'}`;
}
function addHistory(h, entry) {
  if (!h || !entry.trim()) return;
  if (h.list[h.list.length - 1] !== entry) h.list.push(entry);
  if (h.list.length > 500) h.list = h.list.slice(-500);
  for (const [k, v] of histories) if (v === h) { try { sessionStorage.setItem(k, JSON.stringify(h.list)); } catch {} }
  h.index = h.list.length;
  updateHistoryCount();
}

/* Python asked for a line (input(), cmd.Cmd, sys.stdin.readline, …) */
function beginInput(req) {
  inputReq = req;
  setStatus('input');
  cmd.value = '';
  cmd.classList.toggle('secret', !!req.password);
  term.renderNow();
  promptEl.classList.remove('repl');
  promptEl.innerHTML = term.currentLineHTML();
  const h = activeHistory();
  if (h) h.index = h.list.length;
  showInput(true);
  if (pasteQueue.length) { cmd.value = pasteQueue.shift(); setTimeout(() => finishInput(1), 0); }
}
const pasteQueue = [];

function finishInput(status) {
  const req = inputReq;
  if (!req) return;
  const text = cmd.value.replace(/\r/g, '');
  const line = text.split('\n')[0];
  inputReq = null;
  showInput(false);
  cmd.classList.remove('secret');
  cmd.value = '';
  if (status === 1) {
    write((req.password ? '' : line) + '\n', 'input');
    addHistory(req.password ? null : getHistory(req.history || (currentProgram ? `program:${currentProgram}` : 'input')), line);
  } else if (status === 2 || status === 4) {
    write('\n');
  } else {
    write('^C\n', 'err');
  }
  setStatus('running');
  engine.reply(line, status);
}

/* ---------- running code ---------- */
const queue = [];

function whenIdle(fn) {
  if (stopped) return;
  if (ready && !busy) fn(); else queue.push(fn);
}
function drainQueue() {
  if (ready && !busy && queue.length) queue.shift()();
}

function beginBusy() {
  busy = true;
  showInput(false);
  setStatus('running');
}
function endBusy() {
  busy = false;
  inputReq = null;
  programStack.length = 0;
  currentProgram = null;
  clearTimeout(stopTimer);
  setStatus('ready');
  setPrompt(continuing ? PS2 : PS1);
  showInput(true);
  flushDeferredLog();
  drainQueue();
}

async function runSource(raw) {
  const lines = raw.split('\n');
  addHistory(getHistory(null), raw.replace(/\s+$/, ''));
  beginBusy();
  let lastResult = 'complete';
  for (const line of lines) {
    ensureNewline();
    write(continuing ? PS2 : PS1, 'prompt');
    write(line + '\n', 'input');
    try {
      lastResult = await engine.call('push', { line });
    } catch (e) {
      if (!ready) return; // hard stop in progress
      write(String(e && e.message || e) + '\n', 'err');
      lastResult = 'complete';
    }
    if (lastResult === 'stopped') { stopRuntime(lastProgram); return; } // run("id") of an "onexit": "stop" program
    if (lastResult === 'exit') {
      ensureNewline();
      write('Interpreter restarted.\n', 'info');
      continuing = false;
      continue;
    }
    continuing = lastResult === 'incomplete';
    lastIndent = (line.match(/^\s*/) || [''])[0];
    if (continuing && line.trimEnd().endsWith(':')) lastIndent += '    ';
  }
  endBusy();
  if (continuing && lines.length === 1 && lines[0].trim() !== '') cmd.value = lastIndent;
  else lastIndent = '';
  cmd.setSelectionRange(cmd.value.length, cmd.value.length);
}

async function runFile(name, source, opts = {}) {
  const { program = null, title = null, isolated = false, files = null, paths = null, extra = [], requires = [],
    onexit = 'continue', autoplay = false, quiet = false } = opts;
  if (stopped) return;
  if (!ready || busy) { queue.push(() => runFile(name, source, opts)); return; }
  if (continuing) { try { await engine.call('reset_buffer'); } catch {} continuing = false; }
  cmd.value = '';
  currentProgram = program;
  activeRun = program ? { id: program, title: title || program, onexit, autoplay } : null;
  beginBusy();
  ensureNewline();
  if (!quiet) {
    write(!program ? `▶ Running ${name}\n`
      : onexit === 'stop' ? `▶ Starting ${program}\n`
      : `▶ Starting ${program} — type exit or press Ctrl+D to come back to Python\n`, 'info');
  }
  let res = null;
  try {
    // install the program and its libraries in ~/programs, then run it with them on sys.path
    if (files && files.length) {
      await engine.call('write_files', { files, marker: MARKER, catalog: catalog.url }, files.map((f) => f.data));
    }
    res = await engine.call('run_file', { name, source, isolated, paths, extra, requires });
  } catch (e) {
    if (!ready) return;
    write(String(e && e.message || e) + '\n', 'err');
  }
  const run = activeRun;
  activeRun = null;
  // "onexit": "stop" — the program (or one it started with run()) ends Python
  if (res === 'stopped') { stopRuntime(lastProgram || run); return; }
  if (run && run.onexit === 'stop') { stopRuntime(run); return; }
  ensureNewline();
  write(program ? `■ ${program} ended\n` : `■ ${name} finished — its variables are available at the prompt\n`, 'info');
  currentProgram = null;
  setTitle('');
  if (bannerPending) { const info = bannerPending; bannerPending = null; banner(info); }
  endBusy();
}
const runScript = (name, source) => runFile(name, source);

/* ---------- stop / restart ---------- */
function interrupt() {
  if (!busy) return;
  clearTimeout(stopTimer);
  if (inputReq) {
    // Stop while a program waits for input: end the program (status 4 = StopProgram)
    cmd.value = '';
    finishInput(4);
  } else {
    engine.sendInterrupt();
  }
  setStatus('stopping');
  // Python didn't stop on its own (e.g. a busy loop without shared memory): restart the worker.
  stopTimer = setTimeout(() => { if (busy) hardRestart('Stopped — Python had to be restarted, so variables were cleared.', true); }, 2500);
}

function resetSession() {
  ready = false;
  busy = false;
  inputReq = null;
  continuing = false;
  currentProgram = null;
  activeRun = null;
  programStack.length = 0;
  queue.length = 0;
  bannerPending = null;
  cancelRpcs();
  closeSso();
}

// fromStop: the user pressed Stop and Python did not stop by itself
function hardRestart(message, fromStop = false) {
  const owner = fromStop ? stopOwner() : null;
  if (owner) { stopRuntime(owner); return; } // a program with "onexit": "stop" ends Python instead
  clearTimeout(stopTimer);
  resetSession();
  cmd.value = '';
  showInput(false);
  ensureNewline();
  write((message || 'Restarting Python…') + '\n', 'info');
  setStatus('starting');
  setTitle('');
  restartPending = true;
  engine.start();
}
let restartPending = false;

const restartAny = () => (stopped ? restartFromStopped() : restartPython());

async function restartPython() {
  if (!ready) return;
  if (busy) { hardRestart('Python restarted.'); return; }
  try { await engine.call('restart'); } catch (e) { write(String(e) + '\n', 'err'); return; }
  continuing = false;
  lastIndent = '';
  cmd.value = '';
  setPrompt(PS1);
  term.detachInput();
  term.reset();
  fit();
  banner(engine.info || {});
  showInput(true);
}

/* ---------- completion ---------- */
function commonPrefix(list) {
  if (!list.length) return '';
  let p = list[0];
  for (const s of list) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p;
}

async function getCompletions(currentLine) {
  if (inputReq) {
    const words = inputReq.completions || [];
    const m = currentLine.match(/(\S*)$/);
    const typed = m ? m[1] : '';
    const start = currentLine.length - typed.length;
    return [words.filter((w) => w.startsWith(typed) && w !== typed || (w === typed && words.length === 1)), start];
  }
  return engine.call('complete', { source: currentLine });
}

async function doComplete() {
  const pos = cmd.selectionStart;
  const before = cmd.value.slice(0, pos);
  const lineStart = before.lastIndexOf('\n') + 1;
  const currentLine = before.slice(lineStart);
  if (!inputReq && (!currentLine.trim() || /\s$/.test(currentLine))) { insertText('    '); return; }
  if (inputReq && !inputReq.completions) return;
  let res;
  try { res = await getCompletions(currentLine); } catch { return; }
  const [options, start] = res;
  if (!options || !options.length) return;
  const typed = currentLine.slice(start);
  const replacement = options.length === 1 ? options[0] + (inputReq ? ' ' : '') : commonPrefix(options);
  if (replacement.length > typed.length) {
    const absStart = lineStart + start;
    cmd.value = cmd.value.slice(0, absStart) + replacement + cmd.value.slice(pos);
    const c = absStart + replacement.length;
    cmd.setSelectionRange(c, c);
    autosize();
  } else if (options.length > 1) {
    const width = Math.max(...options.map((o) => o.length)) + 2;
    const cols = Math.max(1, Math.floor(term.cols / width));
    let out = '';
    options.slice(0, 300).forEach((o, i) => {
      out += o.padEnd(width);
      if ((i + 1) % cols === 0) out += '\n';
    });
    if (options.length > 300) out += `\n… ${options.length - 300} more`;
    if (inputReq) {
      // keep the program's prompt: print the list above it
      const promptHTML = promptEl.innerHTML;
      term.detachInput();
      write('\n' + out.trimEnd() + '\n', 'info');
      promptEl.innerHTML = promptHTML;
      term.attachInput(inputRow);
      cmd.focus();
    } else {
      term.detachInput();
      ensureNewline();
      write(continuing ? PS2 : PS1, 'prompt');
      write(cmd.value + '\n', 'input');
      write(out.trimEnd() + '\n', 'info');
      showInput(true);
    }
    cmd.setSelectionRange(pos, pos);
  }
}

function insertText(t) {
  const s = cmd.selectionStart, e = cmd.selectionEnd;
  cmd.value = cmd.value.slice(0, s) + t + cmd.value.slice(e);
  cmd.setSelectionRange(s + t.length, s + t.length);
  autosize();
}

/* ---------- keyboard ---------- */
function submit() {
  if (inputReq) { finishInput(1); return; }
  if (!ready || busy) return;
  const raw = cmd.value;
  cmd.value = '';
  autosize();
  runSource(raw);
}

async function cancelInput() {
  term.detachInput();
  ensureNewline();
  write(continuing ? PS2 : PS1, 'prompt');
  write(cmd.value + '\n', 'input');
  write('KeyboardInterrupt\n', 'err');
  cmd.value = '';
  continuing = false;
  lastIndent = '';
  try { await engine.call('reset_buffer'); } catch {}
  setPrompt(PS1);
  showInput(true);
}

cmd.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  const h = activeHistory();
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit();
  } else if (e.key === 'Enter' && e.shiftKey && inputReq) {
    e.preventDefault();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    if (!e.shiftKey) doComplete();
  } else if (e.key === 'ArrowUp') {
    const atTop = cmd.value.lastIndexOf('\n', cmd.selectionStart - 1) === -1;
    if (!atTop || !h || !h.list.length) return;
    e.preventDefault();
    if (h.index === h.list.length) h.draft = cmd.value;
    h.index = Math.max(0, h.index - 1);
    cmd.value = h.list[h.index];
    autosize();
    cmd.setSelectionRange(cmd.value.length, cmd.value.length);
  } else if (e.key === 'ArrowDown') {
    const atBottom = cmd.value.indexOf('\n', cmd.selectionEnd) === -1;
    if (!atBottom || !h || h.index >= h.list.length) return;
    e.preventDefault();
    h.index = Math.min(h.list.length, h.index + 1);
    cmd.value = h.index === h.list.length ? h.draft : h.list[h.index];
    autosize();
    cmd.setSelectionRange(cmd.value.length, cmd.value.length);
  } else if (e.ctrlKey && key === 'c' && cmd.selectionStart === cmd.selectionEnd) {
    e.preventDefault();
    if (inputReq) finishInput(3);
    else cancelInput();
  } else if (e.ctrlKey && key === 'd') {
    if (inputReq && !cmd.value) { e.preventDefault(); finishInput(2); }
  } else if (e.ctrlKey && key === 'l') {
    e.preventDefault();
    clearScreen();
    cmd.focus();
  } else if (e.key === 'Backspace' && continuing && !inputReq && cmd.selectionStart === cmd.selectionEnd) {
    const pos = cmd.selectionStart;
    const lineStart = cmd.value.lastIndexOf('\n', pos - 1) + 1;
    const lead = cmd.value.slice(lineStart, pos);
    if (lead.length >= 4 && /^ +$/.test(lead)) {
      e.preventDefault();
      const n = lead.length % 4 || 4;
      cmd.value = cmd.value.slice(0, pos - n) + cmd.value.slice(pos);
      cmd.setSelectionRange(pos - n, pos - n);
    }
  }
});

// Paste of several lines into an input() prompt: send them one by one.
cmd.addEventListener('paste', (e) => {
  if (!inputReq) return;
  const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
  if (!text.includes('\n')) return;
  e.preventDefault();
  const lines = text.replace(/\r/g, '').split('\n');
  insertText(lines.shift());
  pasteQueue.push(...lines.filter((l, i) => i < lines.length - 1 || l));
  finishInput(1);
});

document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  const modal = !$('help').classList.contains('hidden') || uploader.isOpen() || !!ssoState
    || !$('catalog').classList.contains('hidden') || !!trustState;
  if ((e.ctrlKey || e.metaKey) && key === 'o' && !modal) { e.preventDefault(); openScript(); }
  else if ((e.ctrlKey || e.metaKey) && key === 's' && !modal) { e.preventDefault(); saveTranscript(); }
  else if ((e.ctrlKey || e.metaKey) && key === 'u' && !modal) { e.preventDefault(); if (!stopped) uploader.open(); }
  else if (e.ctrlKey && key === 'c' && busy && !inputReq && !window.getSelection().toString() && !modal) {
    e.preventDefault();
    interrupt();
  }
});

screen.addEventListener('mouseup', (e) => {
  if (e.target.closest('a')) return;
  if (window.getSelection().toString()) return;
  if ((ready && !busy) || inputReq) cmd.focus({ preventScroll: true });
});

/* ---------- files: open / save / download ---------- */
async function openScript() {
  if (stopped) return;
  if (inPuter) {
    try {
      const picked = await P.ui.showOpenFilePicker({ accept: ['.py', '.pyw', '.txt'] }).undefinedOnCancel;
      if (!picked) return;
      const item = Array.isArray(picked) ? picked[0] : picked;
      const text = await (await item.read()).text();
      runScript(item.name, text);
    } catch (e) {
      write(`Could not open file: ${e && e.message || e}\n`, 'err');
    }
  } else {
    $('file-input').click();
  }
}

$('file-input').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (f) runScript(f.name, await f.text());
});

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

async function saveBlob(blob, name) {
  if (inPuter) {
    try {
      const item = await P.ui.showSaveFilePicker(blob, name).undefinedOnCancel;
      if (item) write(`⬇ Saved ${name} to Puter Drive\n`, 'info');
    } catch (e) {
      write(`Could not save ${name}: ${e && e.message || e}\n`, 'err');
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  write(`⬇ Downloaded ${name}\n`, 'info');
}

async function saveTranscript() {
  if (stopped) return;
  const name = `pyterm-session-${stamp()}.txt`;
  await saveBlob(new Blob([term.getText()], { type: 'text/plain' }), name);
  flashLabel('btn-save', 'Saved');
}

function flashLabel(id, msg) {
  const label = $(id).querySelector('span');
  if (!label) return;
  const old = label.textContent;
  label.textContent = msg;
  setTimeout(() => { label.textContent = old; }, 1400);
}

/* ---------- upload ---------- */
// Messages produced while code runs (e.g. an upload finished) wait until it ends,
// so they never break into a program's screen.
const deferredLog = [];
function flushDeferredLog() {
  if (!deferredLog.length || busy || !ready) return;
  term.detachInput();
  ensureNewline();
  for (const [t, k] of deferredLog.splice(0)) write(t, k);
  term.attachInput(inputRow);
}

let toastTimer = 0;
function toast(text, errors) {
  const el = $('toast');
  $('toast-text').textContent = text;
  const err = $('toast-errors');
  err.textContent = errors && errors.length ? errors.slice(0, 3).join('\n') + (errors.length > 3 ? `\n… ${errors.length - 3} more` : '') : '';
  err.classList.toggle('hidden', !err.textContent);
  $('toast-icon').classList.toggle('text-red-400', !!(errors && errors.length));
  $('toast-icon').classList.toggle('text-emerald-400', !(errors && errors.length));
  el.classList.remove('hidden');
  el.classList.add('flex');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, errors && errors.length ? 9000 : 5000);
}
function hideToast() {
  $('toast').classList.add('hidden');
  $('toast').classList.remove('flex');
}
$('toast-close').onclick = hideToast;

const uploader = createUploader({
  engine, inPuter, P,
  log: (t, k) => {
    if (busy) { deferredLog.push([t, k]); return; }
    ensureNewlineIfIdle();
    write(t, k);
  },
  notify: (text, errors) => toast(text, errors),
  isBusy: () => busy,
  isReady: () => ready,
  onOpen: () => {},
  onClose: () => { if (inputReq || (ready && !busy)) { if (ready && !busy && !inputReq) { ensureNewline(); term.attachInput(inputRow); } cmd.focus({ preventScroll: true }); } },
});
function ensureNewlineIfIdle() {
  if (ready && !busy) { term.detachInput(); ensureNewline(); }
}
$('btn-upload').onclick = () => uploader.open();

// Drag & drop anywhere: one .py file runs; anything else opens the upload dialog.
let dragDepth = 0;
const drop = $('drop');
const showDrop = (on) => { drop.classList.toggle('hidden', !on); drop.classList.toggle('flex', on); };
window.addEventListener('dragenter', (e) => {
  if (uploader.isOpen() || stopped) return;
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; showDrop(true); }
});
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) showDrop(false); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0; showDrop(false);
  if (uploader.isOpen() || stopped || !e.dataTransfer) return;
  const { items, hasFolder } = await collectDrop(e.dataTransfer);
  if (!items.length) return;
  if (items.length === 1 && !hasFolder && /\.pyw?$/i.test(items[0].file.name)) {
    runScript(items[0].file.name, await items[0].file.text());
  } else {
    uploader.open(items);
  }
});

/* ---------- programs ---------- */
const PROG_HOME = '/home/pyodide/programs';
let programs = [];
let libraries = [];
const progMenu = $('programs-menu');

/* ---------- programs list (index.json): built-in or from a URL ---------- */
// Where the list comes from, first match wins:
//   1. ?programs=<url> in the page address        (via 'query')
//   2. the choice made in "Load programs from URL…" (via 'ui', kept for this tab)
//   3. window.PYTERM_CONFIG = { programs: url }    (via 'config', set before app.js loads)
//   4. <meta name="pyterm-programs" content=url>   (via 'html')
//   5. programs/index.json next to PyTerm          (via 'default')
// At run time: PyTerm.loadPrograms(url), postMessage from a parent page, pyterm.programs.load(url).
// Program and library files are fetched relative to the index.json (or to its "base" field).
const BUILTIN_INDEX = new URL('programs/index.json', location.href).href;
const CATALOG_KEY = 'pyterm-programs-url';
const RECENT_CATALOGS_KEY = 'pyterm-programs-recent';
const MARKER = PROG_HOME + '/.catalog'; // which list the files in ~/programs came from
let catalog = { url: BUILTIN_INDEX, base: new URL('./', BUILTIN_INDEX).href, name: '', via: 'default', builtin: true };
let startupNotice = null;

function siteDefaultCatalog() {
  const cfg = (window.PYTERM_CONFIG && typeof window.PYTERM_CONFIG === 'object') ? window.PYTERM_CONFIG : {};
  const fromJs = cfg.programs || cfg.programsUrl;
  if (fromJs) return { url: String(fromJs), via: 'config' };
  const meta = document.querySelector('meta[name="pyterm-programs"]');
  const fromHtml = meta && (meta.getAttribute('content') || '').trim();
  if (fromHtml) return { url: fromHtml, via: 'html' };
  return { url: BUILTIN_INDEX, via: 'default' };
}

function launchCatalog() {
  const q = new URLSearchParams(location.search).get('programs');
  if (q) return { url: q, via: 'query' };
  let saved = null;
  try { saved = sessionStorage.getItem(CATALOG_KEY); } catch {}
  if (saved) return { url: saved, via: 'ui' };
  return siteDefaultCatalog();
}

// "https://x.org/progs/" → "https://x.org/progs/index.json"; relative addresses start at PyTerm's page
function catalogUrl(url) {
  let u;
  try { u = new URL(String(url || '').trim(), location.href); } catch { throw new Error('this is not a valid address'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http:// and https:// addresses can be used');
  if (u.pathname.endsWith('/')) u.pathname += 'index.json';
  return u;
}

async function fetchCatalog(url, via) {
  const u = catalogUrl(url);
  let r;
  try { r = await fetch(u.href, { cache: 'no-cache' }); }
  catch { throw new Error(`${u.host} could not be reached, or it doesn't let other sites read its files (CORS)`); }
  if (!r.ok) throw new Error(`${u.href} answered ${r.status}${r.statusText ? ' ' + r.statusText : ''}`);
  let data;
  try { data = JSON.parse(await r.text()); } catch { throw new Error('the file is not valid JSON'); }
  if (!data || typeof data !== 'object' || !Array.isArray(data.programs)) throw new Error('the file has no "programs" list');
  return {
    url: u.href,
    base: new URL(typeof data.base === 'string' && data.base.trim() ? data.base.trim() : './', u).href,
    name: typeof data.name === 'string' ? data.name.trim() : '',
    via,
    builtin: u.href === BUILTIN_INDEX,
    programs: data.programs.filter((p) => p && typeof p === 'object' && p.id && p.file),
    libraries: Array.isArray(data.libraries) ? data.libraries.filter((l) => l && typeof l === 'object') : [],
  };
}

function catalogLabel(c = catalog) {
  if (c.builtin) return 'Built-in programs';
  if (c.name) return c.name;
  try { const u = new URL(c.url); return u.host + u.pathname.replace(/\/index\.json$/i, ''); } catch { return c.url; }
}

function catalogInfo() {
  return { url: catalog.url, base: catalog.base, name: catalogLabel(), builtin: catalog.builtin, via: catalog.via, count: programs.length };
}

function applyCatalog(c) {
  catalog = { url: c.url, base: c.base, name: c.name, via: c.via, builtin: c.builtin };
  programs = c.programs;
  libraries = c.libraries;
  renderProgramsMenu();
  setupMenubar();
  try { window.dispatchEvent(new CustomEvent('pyterm:programs', { detail: catalogInfo() })); } catch {}
}

async function loadPrograms() {
  const want = launchCatalog();
  const tried = new Set();
  let loaded = false;
  let firstError = null;
  for (const c of [want, siteDefaultCatalog(), { url: BUILTIN_INDEX, via: 'default' }]) {
    let key;
    try { key = catalogUrl(c.url).href; } catch { key = c.url; }
    if (tried.has(key)) continue;
    tried.add(key);
    try { applyCatalog(await fetchCatalog(c.url, c.via)); loaded = true; break; }
    catch (e) { if (!firstError) firstError = `Could not load the programs list ${c.url}: ${e.message}`; }
  }
  if (!loaded) applyCatalog({ ...catalog, programs: [], libraries: [] });
  if (firstError) {
    if (want.via === 'ui') { try { sessionStorage.removeItem(CATALOG_KEY); } catch {} }
    startupNotice = firstError + (loaded ? `. Using ${catalogLabel()} instead.` : '.');
  }
  return programs;
}

/* Switch to another list at run time. url null/'' = the site's default. Throws if it can't be loaded. */
async function switchCatalog(url, via = 'api') {
  await programsLoaded;
  const reset = url == null || String(url).trim() === '';
  const target = reset ? siteDefaultCatalog() : { url: String(url), via };
  const c = await fetchCatalog(target.url, target.via);
  applyCatalog(c);
  if (via === 'ui' || via === 'python') {
    // remembered for this tab, and the address bar keeps up (so a reload shows the same list)
    try { if (reset) sessionStorage.removeItem(CATALOG_KEY); else sessionStorage.setItem(CATALOG_KEY, c.url); } catch {}
    if (!reset && !c.builtin) rememberRecent(c.url);
    const q = new URLSearchParams(location.search);
    if (q.has('programs')) {
      if (reset) q.delete('programs'); else q.set('programs', c.url);
      const qs = q.toString();
      try { history.replaceState(history.state, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch {}
    }
  }
  if (via !== 'python') logLine(`Programs: ${catalogLabel()} — ${programs.length} program${programs.length === 1 ? '' : 's'}\n`, 'info');
  return catalogInfo();
}

function renderProgramsMenu() {
  $('programs-source').textContent = catalogLabel();
  $('programs-source').title = catalog.url;
  const list = $('programs-list');
  list.innerHTML = '';
  if (!programs.length) {
    const empty = document.createElement('div');
    empty.className = 'px-3 py-2 text-[12px] text-slate-500';
    empty.textContent = 'No programs in this list.';
    list.appendChild(empty);
  }
  for (const p of programs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item';
    b.innerHTML = '<span class="block text-[13px] text-slate-100"></span><span class="block text-[12px] text-slate-500 leading-snug mt-0.5"></span>';
    b.children[0].textContent = p.title || p.id;
    b.children[1].textContent = p.description || '';
    b.onclick = () => { closePrograms(); launchProgram(p.id); };
    list.appendChild(b);
  }
}
const programsLoaded = loadPrograms();

const onexitOf = (p) => (p && p.onexit === 'stop' ? 'stop' : 'continue');

// A program by id, title or file name (case-insensitive), e.g. "calc", "Calculator", "calc.py"
function findProgram(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const file = (p) => cleanRel(p.file).toLowerCase();
  return programs.find((p) => String(p.id).toLowerCase() === q)
    || programs.find((p) => String(p.title || '').toLowerCase() === q)
    || programs.find((p) => { const f = file(p); return f === q || f.replace(/\.pyw?$/, '') === q || f.split('/').pop() === q; })
    || null;
}

// "a/../b\c" → "b/c": keeps every path inside programs/
function cleanRel(p) {
  return String(p || '').replace(/\\/g, '/').split('/').filter((s) => s && s !== '.' && s !== '..').join('/');
}

// Files are read relative to the list's folder (or its "base")
async function fetchBytes(rel) {
  const url = new URL(rel, catalog.base).href;
  let r;
  try { r = await fetch(url, { cache: 'no-cache' }); }
  catch { throw new Error(`${url} could not be reached (network or CORS)`); }
  if (!r.ok) throw new Error(`${url} could not be loaded (${r.status})`);
  return r.arrayBuffer();
}

/* Where a program and its libraries go in ~/programs, its import paths and packages. */
function programLayout(p) {
  const progRel = cleanRel(p.file);
  const progPath = `${PROG_HOME}/${progRel}`;
  const progDir = progPath.slice(0, progPath.lastIndexOf('/'));
  const wanted = Array.isArray(p.uses) ? libraries.filter((l) => p.uses.includes(l.name)) : libraries;
  if (Array.isArray(p.uses)) {
    const missing = p.uses.filter((u) => !libraries.some((l) => l.name === u));
    if (missing.length) throw new Error(`library not listed in programs/index.json: ${missing.join(', ')}`);
  }
  const jobs = [];
  const paths = [progDir, PROG_HOME];
  for (const lib of wanted) {
    if (lib.zip) {
      const rel = cleanRel(lib.zip);
      jobs.push({ rel, path: `${PROG_HOME}/${rel}`, py: false });
      paths.push(`${PROG_HOME}/${rel}`);
    }
    for (const f of lib.files || []) {
      const rel = cleanRel(lib.name ? `${lib.name}/${f}` : f);
      jobs.push({ rel, path: `${PROG_HOME}/${rel}`, py: /\.py$/i.test(rel) });
    }
  }
  // PyPI / Pyodide packages to install with micropip before the program starts:
  // the libraries' "requires" first, then the program's own
  const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []);
  const requires = [...new Set([...wanted.flatMap((l) => asList(l.requires)), ...asList(p.requires)]
    .map((r) => String(r).trim()).filter(Boolean))];
  return { progRel, progPath, jobs, paths: [...new Set(paths)], requires };
}

/* What pyterm.programs.find() returns to Python. */
function programManifest(p) {
  const L = programLayout(p);
  return {
    id: p.id, title: p.title || p.id, description: p.description || '', path: L.progPath,
    files: [...L.jobs.map((j) => j.path), L.progPath], paths: L.paths, requires: L.requires,
    onexit: onexitOf(p), autoplay: p.autoplay === true, catalog: catalog.url, marker: MARKER,
  };
}

/* Fetch a program and the libraries it uses (folders listed file by file, or ZIPs). */
async function prepareProgram(p) {
  const L = programLayout(p);
  const dec = new TextDecoder();
  const [srcBuf, ...datas] = await Promise.all([fetchBytes(L.progRel), ...L.jobs.map((j) => fetchBytes(j.rel))]);
  const src = dec.decode(srcBuf);
  const extra = [];
  const files = L.jobs.map((j, i) => {
    if (j.py) extra.push(dec.decode(datas[i]));
    return { path: j.path, data: datas[i] };
  });
  files.push({ path: L.progPath, data: srcBuf });
  files.push({ path: MARKER, data: new TextEncoder().encode(catalog.url).buffer });
  return { name: L.progPath, src, files, paths: L.paths, extra, requires: L.requires };
}

// Messages written while Python is idle go above the prompt; while code runs they wait.
function logLine(text, kind) {
  if (busy) { deferredLog.push([text, kind]); return; }
  const idle = ready && !stopped;
  if (idle) { term.detachInput(); ensureNewline(); }
  write(text, kind);
  if (idle && !inputRow.classList.contains('hidden')) term.attachInput(inputRow);
}

/* Start a program of programs/index.json like the Programs menu does. Returns false if it could not start. */
async function launchProgram(query, extra = {}) {
  await programsLoaded;
  if (stopped) return false;
  const p = findProgram(query);
  if (!p) { logLine(`No program named ${query} in ${catalogLabel()}\n`, 'err'); return false; }
  let prep;
  try { prep = await prepareProgram(p); }
  catch (e) { logLine(`Could not load ${p.title || p.id}: ${e && e.message || e}\n`, 'err'); return false; }
  runFile(prep.name, prep.src, {
    program: p.id, title: p.title, isolated: true, files: prep.files, paths: prep.paths, extra: prep.extra,
    requires: prep.requires, onexit: onexitOf(p), ...extra,
  });
  return true;
}

/* ---------- requests from Python (pyterm._bridge) ---------- */
// A handler gets (args, {signal}) and returns a JSON-able value, or new Binary(value, [ArrayBuffer…]).
// Throw an Error with a `code` to send Python a BridgeError(code, message). `signal` aborts when
// the user presses Stop. New features: add a handler here and a wrapper module in pylib/pyterm.
class Binary { constructor(value, blobs) { this.value = value; this.blobs = blobs; } }
const bridgeError = (code, message) => Object.assign(new Error(message), { code });

const rpcHandlers = {
  'programs.list': async () => {
    await programsLoaded;
    return programs.map((p) => ({
      id: p.id, title: p.title || p.id, description: p.description || '', file: p.file,
      uses: p.uses || null, requires: p.requires || [], autoplay: p.autoplay === true, onexit: onexitOf(p),
    }));
  },
  'programs.manifest': async ({ query }) => {
    await programsLoaded;
    const p = findProgram(query);
    return p ? programManifest(p) : null;
  },
  'programs.fetch': async ({ query }) => {
    await programsLoaded;
    const p = findProgram(query);
    if (!p) throw bridgeError('not_found', `no program named ${query}`);
    const prep = await prepareProgram(p);
    return new Binary({ files: prep.files.map((f) => f.path) }, prep.files.map((f) => f.data));
  },
  'programs.source': async () => { await programsLoaded; return catalogInfo(); },
  'programs.load': async ({ url }) => {
    try { return await switchCatalog(url == null ? null : String(url), 'python'); }
    catch (e) { throw bridgeError('load_failed', (e && e.message) || String(e)); }
  },
};

const rpcControllers = new Map();
async function handleRpc(m) {
  const fn = rpcHandlers[m.name];
  if (!fn) { engine.rpcReply(m, null, [], { code: 'unknown_request', message: `PyTerm has no handler for ${m.name}` }); return; }
  let args = {};
  try { args = JSON.parse(m.args || '{}') || {}; } catch {}
  const key = `${m.gen}:${m.rid}`;
  const ctl = new AbortController();
  rpcControllers.set(key, ctl);
  try {
    const r = await fn(args, { signal: ctl.signal });
    if (ctl.signal.aborted) return;
    if (r instanceof Binary) engine.rpcReply(m, r.value, r.blobs);
    else engine.rpcReply(m, r);
  } catch (e) {
    if (ctl.signal.aborted) return;
    engine.rpcReply(m, null, [], { code: (e && e.code) || 'error', message: (e && e.message) || String(e) });
  } finally {
    rpcControllers.delete(key);
  }
}
function cancelRpc(rid) {
  const key = `${engine.gen}:${rid}`;
  const c = rpcControllers.get(key);
  if (c) { rpcControllers.delete(key); c.abort(); }
}
function cancelRpcs() {
  for (const c of rpcControllers.values()) c.abort();
  rpcControllers.clear();
}

/* One-way notifications from Python. */
function handleEvent(name, data) {
  if (name !== 'program' || !data) return;
  // a program started / ended with run("id") from Python
  if (data.state === 'start') programStack.push(data);
  else {
    const i = programStack.map((p) => p.id).lastIndexOf(data.id);
    if (i >= 0) programStack.splice(i, 1);
  }
  lastProgram = data;
  const top = programStack[programStack.length - 1];
  currentProgram = top ? top.id : (activeRun ? activeRun.id : null);
  refreshStatus();
}

function refreshStatus() {
  if (!busy || statusText.textContent.startsWith('Stopping')) return;
  setStatus(ssoState ? 'signin' : inputReq ? 'input' : 'running');
}

/* ---------- "onexit": "stop" ---------- */
// The program that owns this run and asks Python to stop when it ends, if any.
function stopOwner() {
  const fromRun = [...programStack].reverse().find((p) => p.onexit === 'stop');
  if (fromRun) return fromRun;
  return activeRun && activeRun.onexit === 'stop' ? activeRun : null;
}

const LOCKED = ['btn-open', 'btn-upload', 'btn-save', 'btn-programs', 'btn-demo', 'btn-copy', 'btn-clear'];
function setStoppedUI(on) {
  for (const id of LOCKED) $(id).disabled = on;
  $('btn-restart').classList.toggle('restart-cta', on);
  const panel = $('stopped');
  panel.classList.toggle('hidden', !on);
  panel.classList.toggle('flex', on);
  if (on) {
    closePrograms();
    if (uploader.isOpen()) uploader.close();
    screen.scrollTop = screen.scrollHeight;
    $('stopped-restart').focus({ preventScroll: true });
  }
}

// Python ends with the program: the only way on is Restart.
function stopRuntime(prog) {
  clearTimeout(stopTimer);
  const title = (prog && (prog.title || prog.id)) || 'The program';
  const autoplay = !!(prog && prog.autoplay);
  resetSession();
  engine.stop();
  stopped = { id: prog && prog.id, title, relaunch: autoplay ? prog.id : null };
  bannerPending = null;
  pasteQueue.length = 0;
  cmd.value = '';
  showInput(false);
  term.showCursor = false;
  ensureNewline();
  write(`■ ${title} ended — Python has stopped.\n`, 'info');
  setTitle('');
  setStatus('stopped');
  setStoppedUI(true);
}

function restartFromStopped() {
  const s = stopped;
  if (!s) return;
  stopped = null;
  setStoppedUI(false);
  relaunch = s.relaunch;
  if (relaunch) { term.detachInput(); term.reset(); fit(); } // the start-up program begins on a clean screen
  else { ensureNewline(); write('Restarting Python…\n', 'info'); }
  setStatus('starting');
  restartPending = true;
  engine.start();
}

/* ---------- sign-in (pyterm.sso) ---------- */
const SSO_NAMES = { google: 'Google', microsoft: 'Microsoft' };
let ssoState = null;

function scopeLabel(s) {
  return String(s).replace(/^https:\/\/www\.googleapis\.com\/auth\//, '').replace(/^https:\/\/graph\.microsoft\.com\//, '');
}

function ssoInteract({ provider, scopes, mode, signal }, start) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(new SSOError('cancelled', 'Sign-in cancelled')); return; }
    if (ssoState) { reject(new SSOError('busy', 'Another sign-in is already waiting')); return; }
    const st = { provider, resolve, reject, start, working: false, signal, lastError: null };
    st.onAbort = () => finishSso(st, new SSOError('cancelled', 'Sign-in cancelled'));
    if (signal) signal.addEventListener('abort', st.onAbort);
    ssoState = st;
    const name = SSO_NAMES[provider] || provider;
    const who = currentProgram ? currentProgram : 'Your Python code';
    $('sso-logo').innerHTML = $(`logo-${provider}`) ? $(`logo-${provider}`).innerHTML : '';
    $('sso-title').textContent = mode === 'renew' ? `Renew ${name} sign-in` : `Sign in with ${name}`;
    $('sso-sub').textContent = `Requested by ${who}`;
    $('sso-text').textContent = mode === 'renew'
      ? `The ${name} sign-in has to be renewed. Continue opens the ${name} window; the program waits until you are done.`
      : `Continue opens the ${name} sign-in window. The access token stays in this tab and is only given to the running program.`;
    const list = $('sso-scopes');
    list.innerHTML = '';
    for (const s of scopes || []) {
      const li = document.createElement('li');
      li.className = 'truncate';
      li.textContent = scopeLabel(s);
      li.title = s;
      list.appendChild(li);
    }
    $('sso-scopes-box').classList.toggle('hidden', !(scopes && scopes.length));
    setSsoWorking(false);
    showSsoError('');
    const dlg = $('sso');
    dlg.classList.remove('hidden');
    dlg.classList.add('flex');
    refreshStatus();
    setTimeout(() => $('sso-continue').focus(), 0);
  });
}

function setSsoWorking(on) {
  $('sso-continue').disabled = on;
  $('sso-continue-label').textContent = on ? 'Waiting for the sign-in window…' : (ssoState && ssoState.lastError ? 'Try again' : 'Continue');
}
function showSsoError(text) {
  const el = $('sso-error');
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}

function finishSso(st, err, value) {
  if (ssoState !== st) return;
  ssoState = null;
  if (st.signal) st.signal.removeEventListener('abort', st.onAbort);
  const dlg = $('sso');
  dlg.classList.add('hidden');
  dlg.classList.remove('flex');
  refreshStatus();
  if (inputReq || (ready && !busy)) cmd.focus({ preventScroll: true });
  if (err) st.reject(err); else st.resolve(value);
}
function closeSso() { if (ssoState) finishSso(ssoState, new SSOError('cancelled', 'Sign-in cancelled')); }

const SSO_HINTS = {
  popup_blocked: 'The browser blocked the sign-in window. Allow pop-ups for this site, then try again.',
  cancelled: 'The sign-in window was closed before finishing.',
  consent_denied: 'The permissions were not granted.',
  network: 'The sign-in service could not be reached. Check the connection.',
  busy: 'Another sign-in window is still open. Finish or close it first.',
};

$('sso-continue').onclick = () => {
  const st = ssoState;
  if (!st || st.working) return;
  st.working = true;
  setSsoWorking(true);
  let p;
  try { p = st.start(); } catch (e) { p = Promise.reject(e); } // opens the pop-up inside this click
  Promise.resolve(p).then((v) => finishSso(st, null, v), (e) => {
    if (ssoState !== st) return;
    st.working = false;
    st.lastError = e instanceof SSOError ? e : new SSOError((e && e.code) || 'error', (e && e.message) || String(e));
    setSsoWorking(false);
    showSsoError(SSO_HINTS[st.lastError.code] || st.lastError.message);
  });
};
$('sso-cancel').onclick = () => {
  const st = ssoState;
  if (!st) return;
  const e = st.lastError && st.lastError.code !== 'cancelled' ? st.lastError : new SSOError('cancelled', 'Sign-in cancelled by the user');
  finishSso(st, e);
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ssoState) $('sso-cancel').click(); });

// Non-blocking notices (e.g. "Your Google sign-in expires at 14:05 — Renew")
function ssoNotice(provider, text, actionLabel, onAction) {
  ssoClearNotice(provider);
  const box = document.createElement('div');
  box.id = `notice-${provider}`;
  box.className = 'notice';
  box.innerHTML = '<span class="notice-logo"></span><span class="notice-text"></span><button type="button" class="notice-act"></button><button type="button" class="notice-x" title="Dismiss">&times;</button>';
  box.querySelector('.notice-logo').innerHTML = $(`logo-${provider}`) ? $(`logo-${provider}`).innerHTML : '';
  box.querySelector('.notice-text').textContent = text;
  const act = box.querySelector('.notice-act');
  act.textContent = actionLabel || 'OK';
  act.onclick = () => { ssoClearNotice(provider); if (onAction) onAction(); }; // runs inside the click: pop-ups allowed
  box.querySelector('.notice-x').onclick = () => ssoClearNotice(provider);
  $('notices').appendChild(box);
}
function ssoClearNotice(provider) {
  const el = $(`notice-${provider}`);
  if (el) el.remove();
}

const sso = createSSO({ ui: { interact: ssoInteract, notice: ssoNotice, clearNotice: ssoClearNotice } });
Object.assign(rpcHandlers, sso.handlers);

function openPrograms() { progMenu.classList.remove('hidden'); }
function closePrograms() { progMenu.classList.add('hidden'); }
$('btn-programs').onclick = (e) => {
  e.stopPropagation();
  progMenu.classList.contains('hidden') ? openPrograms() : closePrograms();
};
document.addEventListener('click', (e) => { if (!progMenu.contains(e.target)) closePrograms(); });
$('programs-file').onclick = () => { closePrograms(); $('program-input').click(); };
$('programs-url').onclick = () => openCatalog();

/* ---------- "Load programs from URL…" dialog ---------- */
const catalogDlg = $('catalog');
function recentCatalogs() {
  try { return JSON.parse(localStorage.getItem(RECENT_CATALOGS_KEY) || '[]').filter((s) => typeof s === 'string'); } catch { return []; }
}
function rememberRecent(url) {
  const list = [url, ...recentCatalogs().filter((u) => u !== url)].slice(0, 6);
  try { localStorage.setItem(RECENT_CATALOGS_KEY, JSON.stringify(list)); } catch {}
}
function showCatalogError(text) {
  const el = $('catalog-error');
  el.textContent = text;
  el.classList.toggle('hidden', !text);
}
function setCatalogWorking(on) {
  $('catalog-load').disabled = on;
  $('catalog-reset').disabled = on || catalog.url === (() => { try { return catalogUrl(siteDefaultCatalog().url).href; } catch { return ''; } })();
  $('catalog-url').disabled = on;
  $('catalog-load-label').textContent = on ? 'Loading…' : 'Load';
}
function openCatalog() {
  if (stopped) return;
  closePrograms();
  $('catalog-current').textContent = catalogLabel();
  $('catalog-count').textContent = `${programs.length} program${programs.length === 1 ? '' : 's'}`;
  $('catalog-current-url').textContent = catalog.url;
  $('catalog-current-url').title = catalog.url;
  $('catalog-url').value = catalog.builtin ? '' : catalog.url;
  const recent = $('catalog-recent');
  recent.innerHTML = '';
  for (const u of recentCatalogs()) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip max-w-full truncate';
    chip.textContent = catalogLabel({ url: u, builtin: false, name: '' });
    chip.title = u;
    chip.onclick = () => { $('catalog-url').value = u; $('catalog-url').focus(); };
    recent.appendChild(chip);
  }
  showCatalogError('');
  setCatalogWorking(false);
  catalogDlg.classList.remove('hidden');
  catalogDlg.classList.add('flex');
  setTimeout(() => { $('catalog-url').focus(); $('catalog-url').select(); }, 0);
}
function closeCatalog() {
  catalogDlg.classList.add('hidden');
  catalogDlg.classList.remove('flex');
  if (inputReq || (ready && !busy)) cmd.focus({ preventScroll: true });
}
async function submitCatalog(url) {
  showCatalogError('');
  setCatalogWorking(true);
  try {
    await switchCatalog(url, 'ui');
    closeCatalog();
  } catch (e) {
    showCatalogError(`Could not load the list: ${(e && e.message) || e}`);
  } finally {
    setCatalogWorking(false);
  }
}
$('catalog-load').onclick = () => {
  const v = $('catalog-url').value.trim();
  if (!v) { showCatalogError('Enter the address of an index.json file, or of the folder that contains it.'); return; }
  submitCatalog(v);
};
$('catalog-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('catalog-load').click(); } });
$('catalog-reset').onclick = () => submitCatalog(null);
$('catalog-cancel').onclick = closeCatalog;
$('catalog-close').onclick = closeCatalog;
catalogDlg.addEventListener('click', (e) => { if (e.target === catalogDlg) closeCatalog(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !catalogDlg.classList.contains('hidden')) closeCatalog(); });

/* ---------- autoplay from a list on another site (?programs=…) needs the user's OK ---------- */
const TRUSTED_KEY = 'pyterm-trusted-origins';
const trustedNow = new Set();
let trustState = null;
function trustedOrigins() {
  try { return JSON.parse(localStorage.getItem(TRUSTED_KEY) || '[]').filter((s) => typeof s === 'string'); } catch { return []; }
}
function untrustedOrigins() {
  if (catalog.via !== 'query') return []; // lists set by the site itself (HTML / JS) or by the user are trusted
  const found = new Set();
  for (const u of [catalog.url, catalog.base]) { try { found.add(new URL(u).origin); } catch {} }
  const ok = new Set([location.origin, ...trustedOrigins(), ...trustedNow]);
  return [...found].filter((o) => !ok.has(o));
}
function askTrust(p, origins) {
  return new Promise((resolve) => {
    trustState = { resolve, origins };
    const hosts = origins.map((o) => { try { return new URL(o).host; } catch { return o; } }).join(', ');
    $('trust-title').textContent = `Start “${p.title || p.id}”?`;
    $('trust-host').textContent = hosts;
    $('trust-remember').checked = false;
    $('trust-remember-label').textContent = `Always trust ${hosts}`;
    const dlg = $('trust');
    dlg.classList.remove('hidden');
    dlg.classList.add('flex');
    setTimeout(() => $('trust-cancel').focus(), 0);
  });
}
function finishTrust(ok) {
  const st = trustState;
  if (!st) return;
  trustState = null;
  const dlg = $('trust');
  dlg.classList.add('hidden');
  dlg.classList.remove('flex');
  if (ok) {
    st.origins.forEach((o) => trustedNow.add(o));
    if ($('trust-remember').checked) {
      try { localStorage.setItem(TRUSTED_KEY, JSON.stringify([...new Set([...trustedOrigins(), ...st.origins])])); } catch {}
    }
  }
  st.resolve(ok);
}
$('trust-run').onclick = () => finishTrust(true);
$('trust-cancel').onclick = () => finishTrust(false);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && trustState) finishTrust(false); });

/* ---------- JavaScript API for pages that embed or extend PyTerm ---------- */
let resolveReady;
const pytermReady = new Promise((r) => { resolveReady = r; });
window.PyTerm = Object.freeze({
  /** Resolves with {version, …} when Python is ready the first time. */
  ready: pytermReady,
  /** Address of the programs list in use. */
  get programsUrl() { return catalog.url; },
  /** {url, base, name, builtin, via, count} of the list in use. */
  programsSource: async () => { await programsLoaded; return catalogInfo(); },
  /** Use the index.json at `url` (or the site's default with null). Resolves with programsSource(). */
  loadPrograms: (url) => switchCatalog(url == null ? null : String(url), 'api'),
  resetPrograms: () => switchCatalog(null, 'api'),
  /** The programs of the list: [{id, title, description, autoplay, onexit}] */
  listPrograms: async () => {
    await programsLoaded;
    return programs.map((p) => ({ id: p.id, title: p.title || p.id, description: p.description || '', autoplay: p.autoplay === true, onexit: onexitOf(p) }));
  },
  /** Start a program (id, title or file), like the Programs menu. Resolves false if it couldn't start. */
  launch: (query) => launchProgram(String(query)),
});

// A page that shows PyTerm in an <iframe> can switch the list:
//   frame.contentWindow.postMessage({ type: 'pyterm:load-programs', url }, '*')
// and gets back { type: 'pyterm:programs-loaded', ok, url, name, count, error }.
window.addEventListener('message', async (e) => {
  const m = e.data;
  if (!m || typeof m !== 'object' || m.type !== 'pyterm:load-programs') return;
  if (window.parent === window || e.source !== window.parent) return;
  let reply;
  try { reply = { type: 'pyterm:programs-loaded', ok: true, ...(await switchCatalog(m.url == null ? null : String(m.url), 'parent')) }; }
  catch (err) { reply = { type: 'pyterm:programs-loaded', ok: false, url: m.url == null ? null : String(m.url), error: (err && err.message) || String(err) }; }
  try { e.source.postMessage(reply, e.origin && e.origin !== 'null' ? e.origin : '*'); } catch {}
});
$('program-input').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (stopped) return;
  if (f) runFile(f.name, await f.text(), { program: f.name.replace(/\.pyw?$/i, ''), isolated: true });
});

/* ---------- toolbar ---------- */
let fontSize = parseInt(sessionStorage.getItem('pyterm-font') || '14', 10);
function applyFont() {
  document.documentElement.style.setProperty('--term-size', fontSize + 'px');
  sessionStorage.setItem('pyterm-font', String(fontSize));
  autosize();
  fit();
}
applyFont();
$('btn-font-up').onclick = () => { fontSize = Math.min(24, fontSize + 1); applyFont(); };
$('btn-font-down').onclick = () => { fontSize = Math.max(10, fontSize - 1); applyFont(); };
$('btn-clear').onclick = () => { clearScreen(); if ((ready && !busy) || inputReq) cmd.focus(); };
$('btn-demo').onclick = () => whenIdle(() => runSource('await demo()'));
$('btn-open').onclick = () => openScript();
$('btn-save').onclick = () => saveTranscript();
$('btn-stop').onclick = () => {
  if (statusText.textContent.startsWith('Stopping')) hardRestart('Stopped — Python was restarted, so variables were cleared.', true);
  else interrupt();
};

async function copySession() {
  if (stopped) return;
  try {
    await navigator.clipboard.writeText(term.getText());
    flashLabel('btn-copy', 'Copied');
  } catch {}
}
$('btn-copy').onclick = copySession;
$('btn-restart').onclick = restartAny;
$('stopped-restart').onclick = restartFromStopped;

const help = $('help');
const openHelp = () => { help.classList.remove('hidden'); help.classList.add('flex'); };
const closeHelp = () => { help.classList.add('hidden'); help.classList.remove('flex'); if (ready) cmd.focus(); };
$('btn-help').onclick = openHelp;
$('help-close').onclick = closeHelp;
help.addEventListener('click', (e) => { if (e.target === help) closeHelp(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !help.classList.contains('hidden')) closeHelp(); });

/* ---------- Puter menubar & file associations ---------- */
function setupMenubar() {
  if (!inPuter) return;
  const idle = (fn) => () => whenIdle(fn);
  const live = (fn) => () => { if (!stopped) fn(); }; // after "onexit": "stop" only Restart works
  try {
    P.ui.setMenubar({
      items: [
        { label: 'File', items: [
          { label: 'Open Script…', action: live(openScript) },
          { label: 'Upload Files…', action: live(() => uploader.open()) },
          { label: 'Save Transcript…', action: live(saveTranscript) },
          '-',
          { label: 'Quit', action: () => P.exit() },
        ] },
        { label: 'Edit', items: [
          { label: 'Copy Session', action: live(copySession) },
          { label: 'Clear Screen', action: live(() => clearScreen()) },
        ] },
        { label: 'Python', items: [
          { label: 'Stop', action: interrupt },
          { label: 'Restart Interpreter', action: restartAny },
          { label: 'Run Demo', action: idle(() => runSource('await demo()')) },
        ] },
        { label: 'Programs', items: [
          ...programs.map((p) => ({ label: p.title || p.id, action: live(() => launchProgram(p.id)) })),
          '-',
          { label: 'Run a .py file as a program…', action: live(() => $('program-input').click()) },
          { label: 'Load Programs from URL…', action: live(openCatalog) },
        ] },
        { label: 'View', items: [
          { label: 'Larger Text', action: () => $('btn-font-up').click() },
          { label: 'Smaller Text', action: () => $('btn-font-down').click() },
        ] },
        { label: 'Help', items: [
          { label: 'Keyboard Shortcuts', action: openHelp },
          { label: 'Python Documentation', action: () => window.open('https://docs.python.org/3.14/', '_blank') },
        ] },
      ],
    });
  } catch {}
}

function setupPuterApp() {
  if (!inPuter) return;
  setupMenubar();
  programsLoaded.then(setupMenubar);
  const openItems = async (items) => {
    for (const item of items || []) {
      if (item.isDir) continue;
      try { runScript(item.name, await (await item.read()).text()); }
      catch (e) { write(`Could not open ${item.name}: ${e && e.message || e}\n`, 'err'); }
    }
  };
  try { P.ui.onLaunchedWithItems(openItems); } catch {}
  try { P.ui.onItemsOpened && P.ui.onItemsOpened(openItems); } catch {}
  setTitle('');
}
setupPuterApp();

/* ---------- boot ---------- */
setStatus('starting');
updateHistoryCount();
const failTimer = setTimeout(() => {
  const l = $('loader-text');
  if (!ready && l) l.textContent = 'Still loading — slow connections can take a minute…';
}, 30000);

function pythonReady(info) {
  clearTimeout(failTimer);
  pyVersion = info.version;
  ready = true;
  busy = false;
  const loader = $('loader');
  if (loader) loader.remove();
  $('py-version').textContent = 'Python ' + info.version.split(' ')[0];
  $('mode-badge').textContent = info.shared ? 'Worker · shared memory' : (info.jspi ? 'Worker' : 'Worker · limited input');
  $('mode-badge').title = info.shared
    ? 'Python runs in a background thread. Stop interrupts code instantly.'
    : 'Python runs in a background thread. Stop interrupts waiting code; busy loops restart Python.';
  $('fs-badge').classList.toggle('hidden', !info.persist);
  setStatus('ready');
  fit();
  // start-up program: ?program=<id> in the address, else the first one with "autoplay": true
  let start = null;
  if (!booted) {
    booted = true;
    if (startupNotice) { write(startupNotice + '\n', 'err'); startupNotice = null; }
    start = startupProgram();
    if (start) bannerPending = info; // the banner appears when the program returns to Python
    else banner(info);
  } else if (!restartPending) write('Python restarted.\n', 'info');
  else if (relaunch) { start = relaunch; }
  relaunch = null;
  restartPending = false;
  continuing = false;
  setPrompt(PS1);
  if (start) startAutoplay(start);
  else showInput(true);
  flushDeferredLog();
  drainQueue();
  resolveReady(info);
}

async function startAutoplay(query) {
  const p = findProgram(query);
  const origins = p ? untrustedOrigins() : [];
  const allowed = !origins.length || await askTrust(p, origins);
  const ok = allowed && await launchProgram(query, { autoplay: true, quiet: true });
  if (ok) return;
  if (bannerPending) { const i = bannerPending; bannerPending = null; banner(i); }
  if (!allowed) logLine(`${p.title || p.id} was not started. Start it from the Programs menu or with run("${p.id}").\n`, 'info');
  if (ready && !busy && !stopped) showInput(true);
}

function startupProgram() {
  const param = new URLSearchParams(location.search).get('program');
  if (param) return param;
  const auto = programs.find((p) => p.autoplay === true);
  return auto ? auto.id : null;
}

window.addEventListener('beforeunload', () => engine.flushFs());
document.addEventListener('visibilitychange', () => { if (document.hidden) engine.flushFs(); });

engine.start();
