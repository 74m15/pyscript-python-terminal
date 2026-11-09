import { createIcons, icons } from 'https://cdn.jsdelivr.net/npm/lucide@latest/+esm';
import { Terminal } from './terminal.js';
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
const COLORS = {
  err: '#ff7b72', prompt: '#ffd43b', input: '#e6edf3',
  info: '#7d8b99', result: '#79c0ff', accent: '#7ee787',
};

let ready = false;
let busy = false;
let continuing = false;
let lastIndent = '';
let history = [];
try { history = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || '[]'); } catch { history = []; }
let histIndex = history.length;
let draft = '';
let pyVersion = '';

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
  $('term-title').textContent = t || 'Python REPL · PyScript';
  const full = t ? `${t} — PyTerm` : 'PyTerm — Python REPL';
  document.title = full;
  if (inPuter) { try { P.ui.setWindowTitle(t ? `PyTerm — ${t}` : 'PyTerm'); } catch {} }
}

function write(text, kind = 'out') {
  if (!text) return;
  if (kind === 'out') term.write(text);
  else term.writeKind(text, COLORS[kind]);
}
function ensureNewline() { term.prepareForPrompt(); }
function clearScreen() { term.clear(); if (ready && !busy) term.attachInput(inputRow); }
window.pyterm_write = (text, kind) => write(text, kind);
window.pyterm_clear = () => clearScreen();

/* ---------- size ---------- */
let charW = 0, lineH = 0;
function measure() {
  const probe = document.createElement('div');
  probe.className = 'tl';
  probe.style.cssText = 'position:absolute;visibility:hidden;';
  probe.textContent = 'M'.repeat(50);
  probe.style.width = 'auto';
  probe.style.display = 'inline-block';
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
  if (window.pyterm_set_size) { try { window.pyterm_set_size(cols, rows); } catch {} }
}
new ResizeObserver(() => fit()).observe(screen);
fit();

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
  write('VT100/ANSI escape sequences are supported — try ', 'info');
  write('await demo()', 'prompt');
  write('. clear() wipes the screen.\n', 'info');
}

/* ---------- input ---------- */
function setPrompt(p) { promptEl.textContent = p; }
function showInput(show) {
  inputRow.classList.toggle('hidden', !show);
  inputRow.classList.toggle('flex', show);
  term.showCursor = !show;
  if (show) {
    ensureNewline();
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

/* ---------- scripts (open / drop / launch with file) ---------- */
const pendingScripts = [];

async function runScript(name, source) {
  if (!ready || busy) { pendingScripts.push([name, source]); return; }
  if (continuing) { try { window.pyterm_reset_buffer(); } catch {} continuing = false; }
  busy = true;
  cmd.value = '';
  showInput(false);
  setStatus('running');
  ensureNewline();
  write(`▶ Running ${name}\n`, 'info');
  try {
    window.pyterm_stage_file(name, source);
    await window.pyterm_push('await __pyterm_run__()');
  } catch (e) {
    write(String(e && e.message || e) + '\n', 'err');
  }
  ensureNewline();
  write(`■ ${name} finished — its variables are available at the prompt\n`, 'info');
  busy = false;
  setStatus('ready');
  setPrompt(PS1);
  showInput(true);
  if (pendingScripts.length) { const [n, s] = pendingScripts.shift(); runScript(n, s); }
}

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

async function saveTranscript() {
  const text = term.getText();
  const name = `pyterm-session-${stamp()}.txt`;
  if (inPuter) {
    try {
      const item = await P.ui.showSaveFilePicker(text, name).undefinedOnCancel;
      if (item) flashLabel('btn-save', 'Saved');
    } catch (e) {
      write(`Could not save: ${e && e.message || e}\n`, 'err');
    }
  } else {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flashLabel('btn-save', 'Saved');
  }
}

function flashLabel(id, msg) {
  const label = $(id).querySelector('span');
  if (!label) return;
  const old = label.textContent;
  label.textContent = msg;
  setTimeout(() => { label.textContent = old; }, 1400);
}

// Drag & drop
let dragDepth = 0;
const drop = $('drop');
const showDrop = (on) => { drop.classList.toggle('hidden', !on); drop.classList.toggle('flex', on); };
window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; showDrop(true); } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) showDrop(false); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0; showDrop(false);
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) runScript(f.name, await f.text());
});

async function runSource(raw) {
  const lines = raw.split('\n');
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
      ensureNewline();
      write('Interpreter restarted.\n', 'info');
      continuing = false;
      lastResult = 'complete';
      continue;
    }
    continuing = lastResult === 'incomplete';
    lastIndent = (line.match(/^\s*/) || [''])[0];
    if (continuing && line.trimEnd().endsWith(':')) lastIndent += '    ';
  }

  busy = false;
  setStatus('ready');
  setPrompt(continuing ? PS2 : PS1);
  if (continuing && lines.length === 1 && lines[0].trim() !== '') cmd.value = lastIndent;
  else lastIndent = '';
  showInput(true);
  cmd.setSelectionRange(cmd.value.length, cmd.value.length);
}

function submit() {
  if (!ready || busy) return;
  const raw = cmd.value;
  cmd.value = '';
  autosize();
  runSource(raw);
}

function cancelInput() {
  term.detachInput();
  ensureNewline();
  write(continuing ? PS2 : PS1, 'prompt');
  write(cmd.value + '\n', 'input');
  write('KeyboardInterrupt\n', 'err');
  cmd.value = '';
  continuing = false;
  lastIndent = '';
  try { window.pyterm_reset_buffer(); } catch {}
  setPrompt(PS1);
  showInput(true);
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
  if (!currentLine.trim() || /\s$/.test(currentLine)) { insertText('    '); return; }
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
    term.detachInput();
    ensureNewline();
    write(continuing ? PS2 : PS1, 'prompt');
    write(cmd.value + '\n', 'input');
    const width = Math.max(...options.map((o) => o.length)) + 2;
    const cols = Math.max(1, Math.floor(term.cols / width));
    let out = '';
    options.slice(0, 300).forEach((o, i) => {
      out += o.padEnd(width);
      if ((i + 1) % cols === 0) out += '\n';
    });
    if (options.length > 300) out += `\n… ${options.length - 300} more`;
    write(out.trimEnd() + '\n', 'info');
    showInput(true);
    cmd.setSelectionRange(pos, pos);
  }
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
    if (!e.shiftKey) doComplete();
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
    cmd.focus();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    openScript();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveTranscript();
  } else if (e.key === 'Backspace' && continuing && cmd.selectionStart === cmd.selectionEnd) {
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

screen.addEventListener('mouseup', (e) => {
  if (e.target.closest('a')) return;
  if (window.getSelection().toString()) return;
  if (ready && !busy) cmd.focus({ preventScroll: true });
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
$('btn-clear').onclick = () => { clearScreen(); if (ready && !busy) cmd.focus(); };
$('btn-demo').onclick = () => { if (ready && !busy) runSource('await demo()'); };

$('btn-open').onclick = () => openScript();
$('btn-save').onclick = () => saveTranscript();

async function copySession() {
  try {
    await navigator.clipboard.writeText(term.getText());
    flashLabel('btn-copy', 'Copied');
  } catch {}
}
$('btn-copy').onclick = copySession;

function restartPython() {
  if (!ready || busy) return;
  try { window.pyterm_restart(); } catch (e) { write(String(e) + '\n', 'err'); return; }
  continuing = false;
  lastIndent = '';
  cmd.value = '';
  setPrompt(PS1);
  term.detachInput();
  term.reset();
  fit();
  banner();
  showInput(true);
}
$('btn-restart').onclick = restartPython;

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

function setupPuterApp() {
  if (!inPuter) return;
  const idle = (fn) => () => { if (ready && !busy) fn(); };
  try {
    P.ui.setMenubar({
      items: [
        { label: 'File', items: [
          { label: 'Open Script…', action: idle(openScript) },
          { label: 'Save Transcript…', action: saveTranscript },
          '-',
          { label: 'Quit', action: () => P.exit() },
        ] },
        { label: 'Edit', items: [
          { label: 'Copy Session', action: copySession },
          { label: 'Clear Screen', action: () => { clearScreen(); cmd.focus(); } },
        ] },
        { label: 'Python', items: [
          { label: 'Restart Interpreter', action: idle(restartPython) },
          { label: 'Run Demo', action: idle(() => runSource('await demo()')) },
        ] },
        { label: 'View', items: [
          { label: 'Larger Text', action: () => $('btn-font-up').click() },
          { label: 'Smaller Text', action: () => $('btn-font-down').click() },
        ] },
        { label: 'Help', items: [
          { label: 'Keyboard Shortcuts', action: openHelp },
          { label: 'Python Documentation', action: () => window.open('https://docs.python.org/3.12/', '_blank') },
        ] },
      ],
    });
  } catch {}
  try {
    P.ui.onLaunchedWithItems(async (items) => {
      for (const item of items || []) {
        if (item.isDir) continue;
        try { runScript(item.name, await (await item.read()).text()); }
        catch (e) { write(`Could not open ${item.name}: ${e && e.message || e}\n`, 'err'); }
      }
    });
  } catch {}
  try {
    P.ui.onItemsOpened && P.ui.onItemsOpened(async (items) => {
      for (const item of items || []) {
        if (item.isDir) continue;
        try { runScript(item.name, await (await item.read()).text()); } catch {}
      }
    });
  } catch {}
  setTitle('');
}
setupPuterApp();

window.pyterm_ready = (version) => {
  clearInterval(loadTimer);
  clearTimeout(failTimer);
  pyVersion = version;
  ready = true;
  loader.remove();
  $('py-version').textContent = 'Python ' + version.split(' ')[0];
  setStatus('ready');
  fit();
  banner();
  setPrompt(PS1);
  showInput(true);
  if (pendingScripts.length) { const [n, s] = pendingScripts.shift(); runScript(n, s); }
};

window.addEventListener('py:error', () => setStatus('error'));
