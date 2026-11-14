import { createIcons, icons } from 'https://cdn.jsdelivr.net/npm/lucide@latest/+esm';
import { Terminal } from './terminal.js';
import { PythonEngine } from './engine.js';
import { createUploader, collectDrop } from './upload.js';
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
  onReady: (info) => pythonReady(info),
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
    stopping: ['bg-amber-400 dot-pulse', 'Stopping'],
    error: ['bg-red-400', 'Failed'],
  };
  const [cls, label] = map[state];
  statusDot.className = 'w-1.5 h-1.5 rounded-full ' + cls;
  statusText.textContent = currentProgram && (state === 'running' || state === 'input') ? `${label} · ${currentProgram}` : label;
  const showStop = state === 'running' || state === 'input' || state === 'stopping';
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
  clearTimeout(stopTimer);
  setStatus('ready');
  setPrompt(continuing ? PS2 : PS1);
  showInput(true);
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
  const { program = null, isolated = false, files = null, paths = null, extra = [], requires = [] } = opts;
  if (!ready || busy) { queue.push(() => runFile(name, source, opts)); return; }
  if (continuing) { try { await engine.call('reset_buffer'); } catch {} continuing = false; }
  cmd.value = '';
  currentProgram = program;
  beginBusy();
  ensureNewline();
  write(program ? `▶ Starting ${program} — type exit or press Ctrl+D to come back to Python\n` : `▶ Running ${name}\n`, 'info');
  try {
    // install the program and its libraries in ~/programs, then run it with them on sys.path
    if (files && files.length) await engine.call('write_files', { files }, files.map((f) => f.data));
    await engine.call('run_file', { name, source, isolated, paths, extra, requires });
  } catch (e) {
    if (!ready) return;
    write(String(e && e.message || e) + '\n', 'err');
  }
  ensureNewline();
  write(program ? `■ ${program} ended\n` : `■ ${name} finished — its variables are available at the prompt\n`, 'info');
  currentProgram = null;
  setTitle('');
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
  stopTimer = setTimeout(() => { if (busy) hardRestart('Stopped — Python had to be restarted, so variables were cleared.'); }, 2500);
}

function hardRestart(message) {
  clearTimeout(stopTimer);
  ready = false;
  busy = false;
  inputReq = null;
  continuing = false;
  currentProgram = null;
  queue.length = 0;
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
  const modal = !$('help').classList.contains('hidden') || uploader.isOpen();
  if ((e.ctrlKey || e.metaKey) && key === 'o' && !modal) { e.preventDefault(); openScript(); }
  else if ((e.ctrlKey || e.metaKey) && key === 's' && !modal) { e.preventDefault(); saveTranscript(); }
  else if ((e.ctrlKey || e.metaKey) && key === 'u' && !modal) { e.preventDefault(); uploader.open(); }
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
const uploader = createUploader({
  engine, inPuter, P,
  log: (t, k) => { ensureNewlineIfIdle(); write(t, k); },
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
  if (uploader.isOpen()) return;
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; showDrop(true); }
});
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) showDrop(false); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0; showDrop(false);
  if (uploader.isOpen() || !e.dataTransfer) return;
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

async function loadPrograms() {
  try {
    const r = await fetch('programs/index.json', { cache: 'no-cache' });
    const data = await r.json();
    programs = data.programs || [];
    libraries = data.libraries || [];
  } catch { programs = []; libraries = []; }
  const list = $('programs-list');
  list.innerHTML = '';
  for (const p of programs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item';
    b.innerHTML = '<span class="block text-[13px] text-slate-100"></span><span class="block text-[12px] text-slate-500 leading-snug mt-0.5"></span>';
    b.children[0].textContent = p.title;
    b.children[1].textContent = p.description;
    b.onclick = () => { closePrograms(); launchProgram(p.id); };
    list.appendChild(b);
  }
  return programs;
}
const programsLoaded = loadPrograms();

// "a/../b\c" → "b/c": keeps every path inside programs/
function cleanRel(p) {
  return String(p || '').replace(/\\/g, '/').split('/').filter((s) => s && s !== '.' && s !== '..').join('/');
}

async function fetchBytes(rel) {
  const r = await fetch(`programs/${rel}`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`programs/${rel} could not be loaded (${r.status})`);
  return r.arrayBuffer();
}

/* Fetch a program and the libraries it uses (folders listed file by file, or ZIPs). */
async function prepareProgram(p) {
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
  const dec = new TextDecoder();
  const [src, ...datas] = await Promise.all([
    fetchBytes(progRel).then((b) => dec.decode(b)),
    ...jobs.map((j) => fetchBytes(j.rel)),
  ]);
  const extra = [];
  const files = jobs.map((j, i) => {
    if (j.py) extra.push(dec.decode(datas[i]));
    return { path: j.path, data: datas[i] };
  });
  files.push({ path: progPath, data: new TextEncoder().encode(src).buffer });
  // PyPI / Pyodide packages to install with micropip before the program starts:
  // the libraries' "requires" first, then the program's own
  const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []);
  const requires = [...new Set([...wanted.flatMap((l) => asList(l.requires)), ...asList(p.requires)]
    .map((r) => String(r).trim()).filter(Boolean))];
  return { name: progPath, src, files, paths: [...new Set(paths)], extra, requires };
}

async function launchProgram(id) {
  await programsLoaded;
  const p = programs.find((x) => x.id === id);
  if (!p) { write(`No program named ${id}\n`, 'err'); return; }
  try {
    const prep = await prepareProgram(p);
    runFile(prep.name, prep.src, { program: p.id, isolated: true, files: prep.files, paths: prep.paths, extra: prep.extra, requires: prep.requires });
  } catch (e) {
    ensureNewlineIfIdle();
    write(`Could not load ${p.title}: ${e && e.message || e}\n`, 'err');
  }
}

function openPrograms() { progMenu.classList.remove('hidden'); }
function closePrograms() { progMenu.classList.add('hidden'); }
$('btn-programs').onclick = (e) => {
  e.stopPropagation();
  progMenu.classList.contains('hidden') ? openPrograms() : closePrograms();
};
document.addEventListener('click', (e) => { if (!progMenu.contains(e.target)) closePrograms(); });
$('programs-file').onclick = () => { closePrograms(); $('program-input').click(); };
$('program-input').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
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
  if (statusText.textContent.startsWith('Stopping')) hardRestart('Stopped — Python was restarted, so variables were cleared.');
  else interrupt();
};

async function copySession() {
  try {
    await navigator.clipboard.writeText(term.getText());
    flashLabel('btn-copy', 'Copied');
  } catch {}
}
$('btn-copy').onclick = copySession;
$('btn-restart').onclick = restartPython;

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
  try {
    P.ui.setMenubar({
      items: [
        { label: 'File', items: [
          { label: 'Open Script…', action: openScript },
          { label: 'Upload Files…', action: () => uploader.open() },
          { label: 'Save Transcript…', action: saveTranscript },
          '-',
          { label: 'Quit', action: () => P.exit() },
        ] },
        { label: 'Edit', items: [
          { label: 'Copy Session', action: copySession },
          { label: 'Clear Screen', action: () => clearScreen() },
        ] },
        { label: 'Python', items: [
          { label: 'Stop', action: interrupt },
          { label: 'Restart Interpreter', action: restartPython },
          { label: 'Run Demo', action: idle(() => runSource('await demo()')) },
        ] },
        { label: 'Programs', items: [
          ...programs.map((p) => ({ label: p.title, action: () => launchProgram(p.id) })),
          '-',
          { label: 'Run a .py file as a program…', action: () => $('program-input').click() },
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
  if (!booted) { booted = true; banner(info); }
  else if (!restartPending) write('Python restarted.\n', 'info');
  restartPending = false;
  continuing = false;
  setPrompt(PS1);
  showInput(true);
  const param = new URLSearchParams(location.search).get('program');
  if (param && !pythonReady.launched) { pythonReady.launched = true; launchProgram(param); }
  drainQueue();
}

window.addEventListener('beforeunload', () => engine.flushFs());
document.addEventListener('visibilitychange', () => { if (document.hidden) engine.flushFs(); });

engine.start();
