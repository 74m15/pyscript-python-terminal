import { createIcons, icons } from 'https://cdn.jsdelivr.net/npm/lucide@latest/+esm';
createIcons({ icons });

const $ = (id) => document.getElementById(id);
const screen = $('screen');
const output = $('output');
const inputRow = $('input-row');
const promptEl = $('prompt');
const cmd = $('cmd');
const loader = $('loader');
const statusDot = $('status-dot');
const statusText = $('status-text');

const PS1 = '>>> ';
const PS2 = '... ';
const HISTORY_KEY = 'pyterm-history';

let ready = false;
let busy = false;
let continuing = false;
let lastIndent = '';
let history = [];
try { history = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]'); } catch { history = []; }
let histIndex = history.length;
let draft = '';
let pyVersion = '';

/* ---------- output ---------- */
let lastSpan = null;
function write(text, kind = 'out') {
  if (!text) return;
  const cls = 'o-' + kind;
  if (lastSpan && lastSpan.className === cls && lastSpan.parentNode === output) {
    lastSpan.appendChild(document.createTextNode(text));
  } else {
    lastSpan = document.createElement('span');
    lastSpan.className = cls;
    lastSpan.textContent = text;
    output.appendChild(lastSpan);
  }
  scrollToEnd();
}
function ensureNewline() {
  const t = output.textContent;
  if (t.length && !t.endsWith('\n')) write('\n', 'out');
}
function clearScreen() {
  output.innerHTML = '';
  lastSpan = null;
}
function scrollToEnd() {
  requestAnimationFrame(() => { screen.scrollTop = screen.scrollHeight; });
}
window.pyterm_write = (text, kind) => write(text, kind);
window.pyterm_clear = () => clearScreen();

/* ---------- status ---------- */
function setStatus(state) {
  const map = {
    starting: ['bg-amber-400 dot-pulse', 'Starting'],
    ready: ['bg-emerald-400', 'Ready'],
    running: ['bg-sky-400 dot-pulse', 'Running'],
    error: ['bg-red-400', 'Failed'],
  };
  const [cls, label] = map[state];
  statusDot.className = 'w-1.5 h-1.5 rounded-full ' + cls;
  statusText.textContent = label;
}

function banner() {
  write(`Python ${pyVersion}`, 'accent');
  write(' on WebAssembly (Pyodide via PyScript)\n', 'info');
  write('Type "help", "copyright", "credits" or "license" for more information.\n', 'info');
  write('Extras: clear() wipes the screen · top-level await supported · micropip for packages\n', 'info');
}

/* ---------- input ---------- */
function setPrompt(p) { promptEl.textContent = p; }
function showInput(show) {
  inputRow.classList.toggle('hidden', !show);
  inputRow.classList.toggle('flex', show);
  if (show) { autosize(); cmd.focus({ preventScroll: true }); scrollToEnd(); }
}
function autosize() {
  cmd.style.height = 'auto';
  cmd.style.height = cmd.scrollHeight + 'px';
}
cmd.addEventListener('input', autosize);

function updateHistoryCount() {
  $('history-count').textContent = `${history.length} command${history.length === 1 ? '' : 's'}`;
}
function addHistory(entry) {
  if (!entry.trim()) return;
  if (history[history.length - 1] !== entry) history.push(entry);
  if (history.length > 500) history = history.slice(-500);
  try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch {}
  histIndex = history.length;
  updateHistoryCount();
}

async function submit() {
  if (!ready || busy) return;
  const raw = cmd.value;
  const lines = raw.split('\n');
  cmd.value = '';
  autosize();
  addHistory(raw.replace(/\s+$/, ''));
  busy = true;
  showInput(false);
  setStatus('running');

  let lastResult = 'complete';
  for (const line of lines) {
    ensureNewline();
    write(continuing ? PS2 : PS1, 'prompt');
    write(line + '\n', 'input');
    try {
      lastResult = await window.pyterm_push(line);
    } catch (e) {
      write(String(e && e.message || e) + '\n', 'err');
      lastResult = 'complete';
    }
    if (lastResult === 'exit') {
      write('Interpreter restarted.\n', 'info');
      continuing = false;
      lastResult = 'complete';
      continue;
    }
    continuing = lastResult === 'incomplete';
    lastIndent = (line.match(/^\s*/) || [''])[0];
    if (continuing && line.trimEnd().endsWith(':')) lastIndent += '    ';
  }

  ensureNewline();
  busy = false;
  setStatus('ready');
  setPrompt(continuing ? PS2 : PS1);
  if (continuing && lines.length === 1 && lines[0].trim() !== '') {
    cmd.value = lastIndent;
  } else {
    lastIndent = '';
  }
  showInput(true);
  cmd.setSelectionRange(cmd.value.length, cmd.value.length);
}

function cancelInput() {
  ensureNewline();
  write((continuing ? PS2 : PS1), 'prompt');
  write(cmd.value + '\n', 'input');
  write('KeyboardInterrupt\n', 'err');
  cmd.value = '';
  continuing = false;
  lastIndent = '';
  try { window.pyterm_reset_buffer(); } catch {}
  setPrompt(PS1);
  autosize();
  scrollToEnd();
}

function commonPrefix(list) {
  if (!list.length) return '';
  let p = list[0];
  for (const s of list) while (!s.startsWith(p)) p = p.slice(0, -1);
  return p;
}

function doComplete() {
  const pos = cmd.selectionStart;
  const before = cmd.value.slice(0, pos);
  const lineStart = before.lastIndexOf('\n') + 1;
  const currentLine = before.slice(lineStart);
  if (!currentLine.trim() || /\s$/.test(currentLine)) {
    insertText('    ');
    return;
  }
  let res;
  try { res = window.pyterm_complete(currentLine); } catch { return; }
  const [options, start] = res;
  if (!options || !options.length) return;
  const typed = currentLine.slice(start);
  const replacement = options.length === 1 ? options[0] : commonPrefix(options);
  if (replacement.length > typed.length) {
    const absStart = lineStart + start;
    cmd.value = cmd.value.slice(0, absStart) + replacement + cmd.value.slice(pos);
    const c = absStart + replacement.length;
    cmd.setSelectionRange(c, c);
    autosize();
  } else if (options.length > 1) {
    ensureNewline();
    write((continuing ? PS2 : PS1), 'prompt');
    write(cmd.value + '\n', 'input');
    const width = Math.max(...options.map((o) => o.length)) + 2;
    const cols = Math.max(1, Math.floor((screen.clientWidth - 48) / (charWidth() * width)));
    let out = '';
    options.slice(0, 300).forEach((o, i) => {
      out += o.padEnd(width);
      if ((i + 1) % cols === 0) out += '\n';
    });
    if (options.length > 300) out += `\n… ${options.length - 300} more`;
    write(out.trimEnd() + '\n', 'info');
  }
}

let _cw = 0;
function charWidth() {
  if (_cw) return _cw;
  const s = document.createElement('span');
  s.className = 'mono';
  s.style.visibility = 'hidden';
  s.textContent = 'MMMMMMMMMM';
  screen.appendChild(s);
  _cw = s.getBoundingClientRect().width / 10 || 8;
  s.remove();
  return _cw;
}

function insertText(t) {
  const s = cmd.selectionStart, e = cmd.selectionEnd;
  cmd.value = cmd.value.slice(0, s) + t + cmd.value.slice(e);
  cmd.setSelectionRange(s + t.length, s + t.length);
  autosize();
}

cmd.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    submit();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) return;
    doComplete();
  } else if (e.key === 'ArrowUp') {
    const atTop = cmd.value.lastIndexOf('\n', cmd.selectionStart - 1) === -1;
    if (!atTop || !history.length) return;
    e.preventDefault();
    if (histIndex === history.length) draft = cmd.value;
    histIndex = Math.max(0, histIndex - 1);
    cmd.value = history[histIndex];
    autosize();
    cmd.setSelectionRange(cmd.value.length, cmd.value.length);
  } else if (e.key === 'ArrowDown') {
    const atBottom = cmd.value.indexOf('\n', cmd.selectionEnd) === -1;
    if (!atBottom || histIndex >= history.length) return;
    e.preventDefault();
    histIndex = Math.min(history.length, histIndex + 1);
    cmd.value = histIndex === history.length ? draft : history[histIndex];
    autosize();
    cmd.setSelectionRange(cmd.value.length, cmd.value.length);
  } else if (e.ctrlKey && e.key.toLowerCase() === 'c' && cmd.selectionStart === cmd.selectionEnd) {
    e.preventDefault();
    cancelInput();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    clearScreen();
  } else if (e.key === 'Backspace' && continuing && cmd.selectionStart === cmd.selectionEnd) {
    // dedent by 4 when deleting inside leading whitespace
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

screen.addEventListener('mouseup', () => {
  if (window.getSelection().toString()) return;
  if (ready && !busy) cmd.focus({ preventScroll: true });
});

/* ---------- toolbar ---------- */
let fontSize = parseInt(sessionStorage.getItem('pyterm-font') || '14', 10);
function applyFont() {
  document.documentElement.style.setProperty('--term-size', fontSize + 'px');
  sessionStorage.setItem('pyterm-font', String(fontSize));
  _cw = 0;
  autosize();
}
applyFont();
$('btn-font-up').onclick = () => { fontSize = Math.min(24, fontSize + 1); applyFont(); };
$('btn-font-down').onclick = () => { fontSize = Math.max(10, fontSize - 1); applyFont(); };
$('btn-clear').onclick = () => { clearScreen(); if (ready && !busy) cmd.focus(); };

$('btn-copy').onclick = async () => {
  const btn = $('btn-copy');
  try {
    await navigator.clipboard.writeText(output.textContent);
    btn.querySelector('span') && (btn.querySelector('span').textContent = 'Copied');
    setTimeout(() => { btn.querySelector('span') && (btn.querySelector('span').textContent = 'Copy'); }, 1400);
  } catch {}
};

$('btn-restart').onclick = async () => {
  if (!ready || busy) return;
  try { window.pyterm_restart(); } catch (e) { write(String(e) + '\n', 'err'); return; }
  continuing = false;
  lastIndent = '';
  cmd.value = '';
  setPrompt(PS1);
  ensureNewline();
  write('\n──────── RESTART ────────\n\n', 'info');
  banner();
  showInput(true);
};

const help = $('help');
const openHelp = () => { help.classList.remove('hidden'); help.classList.add('flex'); };
const closeHelp = () => { help.classList.add('hidden'); help.classList.remove('flex'); if (ready) cmd.focus(); };
$('btn-help').onclick = openHelp;
$('help-close').onclick = closeHelp;
help.addEventListener('click', (e) => { if (e.target === help) closeHelp(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !help.classList.contains('hidden')) closeHelp(); });

/* ---------- boot ---------- */
updateHistoryCount();
setStatus('starting');
const loadMsgs = ['Downloading the Python runtime…', 'Compiling WebAssembly…', 'Loading the standard library…', 'Almost there…'];
let li = 0;
const loadTimer = setInterval(() => {
  li = Math.min(li + 1, loadMsgs.length - 1);
  $('loader-text').textContent = loadMsgs[li];
}, 2500);
const failTimer = setTimeout(() => {
  if (!ready) $('loader-text').textContent = 'Still loading — slow connections can take a minute…';
}, 30000);

window.pyterm_ready = (version) => {
  clearInterval(loadTimer);
  clearTimeout(failTimer);
  pyVersion = version;
  ready = true;
  loader.remove();
  $('py-version').textContent = 'Python ' + version.split(' ')[0];
  setStatus('ready');
  banner();
  setPrompt(PS1);
  showInput(true);
};

window.addEventListener('py:error', () => setStatus('error'));
