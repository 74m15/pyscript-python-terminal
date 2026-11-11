// A compact VT100 / VT220 / xterm-compatible terminal emulator rendering to the DOM.
// Supports: C0/C1 controls (BEL, BS, HT, LF, VT, FF, CR, SO, SI, CAN, SUB), ESC sequences
// (DECSC/DECRC, IND, NEL, RI, HTS, RIS, SS2/SS3, charset designation, DECALN, DECDHL/DECDWL),
// CSI sequences (cursor movement, erase, insert/delete, scroll, tabs, SGR incl. 256/truecolor,
// scroll regions, ANSI & DEC private modes, alternate screen), OSC titles and OSC 8 hyperlinks.

const DEFAULT_FG = '#d6dde6';
const DEFAULT_BG = '#0b0f14';
const BASE16 = [
  '#2d333b', '#f47067', '#57ab5a', '#c69026', '#539bf5', '#b083f0', '#39c5cf', '#c9d1d9',
  '#636e7b', '#ff938a', '#6bc46d', '#daaa3f', '#6cb6ff', '#dcbdfb', '#56d4dd', '#f0f6fc',
];
const hx = (n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0');
const PALETTE = (() => {
  const p = BASE16.slice();
  const lv = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) p.push('#' + hx(lv[r]) + hx(lv[g]) + hx(lv[b]));
  for (let i = 0; i < 24; i++) { const v = 8 + i * 10; p.push('#' + hx(v) + hx(v) + hx(v)); }
  return p;
})();
const colorCss = (c) => (typeof c === 'number' ? PALETTE[c] : c);

// DEC Special Graphics (line drawing) charset
const DEC_GRAPHICS = {
  '_': ' ', '`': '◆', 'a': '▒', 'b': '␉', 'c': '␌', 'd': '␍', 'e': '␊', 'f': '°', 'g': '±',
  'h': '␤', 'i': '␋', 'j': '┘', 'k': '┐', 'l': '┌', 'm': '└', 'n': '┼', 'o': '⎺', 'p': '⎻',
  'q': '─', 'r': '⎼', 's': '⎽', 't': '├', 'u': '┤', 'v': '┴', 'w': '┬', 'x': '│', 'y': '≤',
  'z': '≥', '{': 'π', '|': '≠', '}': '£', '~': '·',
};

/* ---------------- attributes ---------------- */
const ATTR_KEYS = ['fg', 'bg', 'bold', 'dim', 'italic', 'ul', 'blink', 'inverse', 'hidden', 'strike', 'overline', 'link', 'ulc'];
const NULLABLE = new Set(['fg', 'bg', 'link', 'ulc']);
const attrCache = new Map();
function makeAttr(o) {
  const v = {};
  for (const k of ATTR_KEYS) {
    const val = o[k];
    v[k] = val === undefined ? (NULLABLE.has(k) ? null : k === 'ul' ? 0 : false) : val;
  }
  const key = ATTR_KEYS.map((k) => (v[k] === null || v[k] === false || v[k] === 0 ? '' : v[k] === true ? '1' : v[k])).join('|');
  let a = attrCache.get(key);
  if (a) return a;
  if (attrCache.size > 20000) attrCache.clear();
  a = Object.freeze({ ...v, key });
  attrCache.set(key, a);
  return a;
}
const DEFAULT = makeAttr({});

const styleCache = new Map();
function attrStyle(a) {
  let s = styleCache.get(a.key);
  if (s) return s;
  let fg = a.fg == null ? null : colorCss(a.fg);
  let bg = a.bg == null ? null : colorCss(a.bg);
  if (a.bold && typeof a.fg === 'number' && a.fg < 8) fg = PALETTE[a.fg + 8];
  if (a.inverse) { const t = fg; fg = bg || DEFAULT_BG; bg = t || DEFAULT_FG; }
  let css = '';
  if (a.hidden) css += 'color:transparent;';
  else if (fg) css += `color:${fg};`;
  if (bg) css += `background-color:${bg};`;
  if (a.bold) css += 'font-weight:700;';
  if (a.dim) css += 'opacity:.55;';
  if (a.italic) css += 'font-style:italic;';
  const d = [];
  if (a.ul) d.push('underline');
  if (a.strike) d.push('line-through');
  if (a.overline) d.push('overline');
  if (d.length) {
    css += `text-decoration-line:${d.join(' ')};`;
    const st = ['', 'solid', 'double', 'wavy', 'dotted', 'dashed'][a.ul];
    if (st) css += `text-decoration-style:${st};text-underline-offset:3px;`;
    if (a.ulc != null) css += `text-decoration-color:${colorCss(a.ulc)};`;
  }
  s = { css, cls: a.blink ? 'blink' : '' };
  styleCache.set(a.key, s);
  return s;
}

/* ---------------- unicode width ---------------- */
function wcwidth(cp) {
  if (cp < 0x300) return 1;
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x483 && cp <= 0x489) || (cp >= 0x591 && cp <= 0x5bd) ||
      (cp >= 0x610 && cp <= 0x61a) || (cp >= 0x64b && cp <= 0x65f) || (cp >= 0x1ab0 && cp <= 0x1aff) ||
      (cp >= 0x1dc0 && cp <= 0x1dff) || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe00 && cp <= 0xfe0f) ||
      (cp >= 0xfe20 && cp <= 0xfe2f) || (cp >= 0x200b && cp <= 0x200d) || (cp >= 0xe0100 && cp <= 0xe01ef)) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || cp === 0x2329 || cp === 0x232a || (cp >= 0x231a && cp <= 0x231b) ||
      (cp >= 0x23e9 && cp <= 0x23ec) || cp === 0x23f0 || cp === 0x23f3 || (cp >= 0x25fd && cp <= 0x25fe) ||
      (cp >= 0x2614 && cp <= 0x2615) || (cp >= 0x2648 && cp <= 0x2653) || cp === 0x267f || cp === 0x2693 ||
      cp === 0x26a1 || (cp >= 0x26aa && cp <= 0x26ab) || (cp >= 0x26bd && cp <= 0x26be) || (cp >= 0x26c4 && cp <= 0x26c5) ||
      cp === 0x26ce || cp === 0x26d4 || cp === 0x26ea || (cp >= 0x26f2 && cp <= 0x26f3) || cp === 0x26f5 ||
      cp === 0x26fa || cp === 0x26fd || cp === 0x2705 || (cp >= 0x270a && cp <= 0x270b) || cp === 0x2728 ||
      cp === 0x274c || cp === 0x274e || (cp >= 0x2753 && cp <= 0x2755) || cp === 0x2757 || (cp >= 0x2795 && cp <= 0x2797) ||
      cp === 0x27b0 || cp === 0x27bf || (cp >= 0x2b1b && cp <= 0x2b1c) || cp === 0x2b50 || cp === 0x2b55 ||
      (cp >= 0x2e80 && cp <= 0x303e) || (cp >= 0x3041 && cp <= 0x33ff) || (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xa000 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f680 && cp <= 0x1f6ff) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x1fa70 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
  return 1;
}

/* ---------------- rendering helpers ---------------- */
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escHtml = (s) => s.replace(/[&<>"]/g, (c) => ESC_MAP[c]);
const safeUrl = (u) => (/^(https?:|mailto:|ftp:)/i.test(u) ? u : null);

function wrapRun(html, at) {
  if (at.key === DEFAULT.key) return html;
  const st = attrStyle(at);
  let s = st.css || st.cls
    ? `<span${st.cls ? ` class="${st.cls}"` : ''}${st.css ? ` style="${st.css}"` : ''}>${html}</span>`
    : html;
  if (at.link) {
    const u = safeUrl(at.link);
    if (u) s = `<a href="${escHtml(u)}" target="_blank" rel="noopener noreferrer">${s}</a>`;
  }
  return s;
}

function renderLine(ln, curX) {
  const c = ln.c, a = ln.a;
  const n = Math.max(c.length, curX + 1);
  let out = '', run = '', runKey = null, runAttr = DEFAULT;
  const flush = () => { if (run) { out += wrapRun(run, runAttr); run = ''; } };
  for (let i = 0; i < n; i++) {
    const ch = i < c.length ? c[i] : ' ';
    if (ch === '') continue;
    const at = (i < c.length && a[i]) || DEFAULT;
    let html = escHtml(ch);
    if (c[i + 1] === '') html = `<span class="w2">${html}</span>`;
    if (i === curX) { flush(); runKey = null; out += `<span class="cur">${html}</span>`; continue; }
    if (at.key !== runKey) { flush(); runKey = at.key; runAttr = at; }
    run += html;
  }
  flush();
  if (ln.size) out = `<span class="ln">${out}</span>`;
  return out;
}

const SIZE_CLASS = ['tl', 'tl dw', 'tl dht', 'tl dhb'];
const blankLine = () => ({ c: [], a: [], wrapped: false, size: 0, dirty: true });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const GROUND = 0, ESC = 1, ESC_INT = 2, CSI = 3, OSC = 4, STR = 5;
const MAX_LINES = 5000;

export class Terminal {
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.cols = 80;
    this.rows = 24;
    this.normal = this._mkBuf(false);
    this.alt = this._mkBuf(true);
    this.alt.el.style.display = 'none';
    root.append(this.normal.el, this.alt.el);
    this.buf = this.normal;
    this.input = null;
    this._hiddenEl = null;
    this.showCursor = false;
    this._raf = 0;
    this._fullReset();
  }

  /* ---------- public API ---------- */
  write(s) {
    for (const ch of s) this._feed(ch);
    this._schedule();
  }

  // Write app-generated text with a given default colour without disturbing the program's SGR state.
  writeKind(s, color) {
    const savedAttr = this.attr, savedDef = this.defaultAttr;
    this.state = GROUND;
    this.defaultAttr = color ? makeAttr({ fg: color }) : DEFAULT;
    this.attr = this.defaultAttr;
    this.write(s);
    this.state = GROUND;
    this.attr = savedAttr;
    this.defaultAttr = savedDef;
  }

  prepareForPrompt() {
    const b = this.buf;
    this.state = GROUND;
    if (b.x > 0 || b.wrapPending) { this._cr(); this._index(); }
  }

  attachInput(el) {
    this.input = el;
    this.renderNow();
  }

  detachInput() {
    if (this._hiddenEl) { this._hiddenEl.style.display = ''; this._hiddenEl = null; }
    this.input = null;
    this._schedule();
  }

  clear() {
    this._altScreen(false);
    const b = this.normal;
    b.lineEls.forEach((e) => e.remove());
    b.lineEls = [];
    b.lines = [];
    b.pendingTrim = 0;
    b.x = 0; b.y = 0; b.wrapPending = false; b.saved = null;
    this._hiddenEl = null;
    this.renderNow();
  }

  reset() {
    this._fullReset();
    this.clear();
  }

  resize(cols, rows) {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
    this._resetTabs();
    for (const b of [this.normal, this.alt]) { b.x = Math.min(b.x, cols - 1); b.wrapPending = false; }
    const n = this.normal;
    const base = Math.max(0, n.lines.length - rows);
    if (n.y < base) n.y = base;
    const a = this.alt;
    if (this.buf === a) {
      while (a.lines.length < rows) a.lines.push(blankLine());
      if (a.lines.length > rows) {
        const fromTop = Math.min(a.lines.length - rows, Math.max(0, a.y - (rows - 1)));
        a.lines.splice(0, fromTop);
        a.y -= fromTop;
        a.lines.length = rows;
        a.y = Math.min(a.y, rows - 1);
      }
    }
    this._schedule();
  }

  // HTML of the cursor line up to the cursor (used as the prompt of an input() line, colours included).
  currentLineHTML() {
    const b = this.buf;
    const ln = b.lines[b.y];
    if (!ln) return '';
    const end = b.wrapPending ? ln.c.length : Math.min(b.x, ln.c.length);
    let html = renderLine({ c: ln.c.slice(0, end), a: ln.a.slice(0, end), size: 0 }, -1);
    if (!b.wrapPending && b.x > ln.c.length) html += ' '.repeat(b.x - ln.c.length);
    return html;
  }

  getText() {
    const L = this.normal.lines;
    let out = '';
    L.forEach((ln, i) => {
      const t = ln.c.join('');
      out += ln.wrapped ? t : t.replace(/\s+$/, '');
      if (!ln.wrapped && i < L.length - 1) out += '\n';
    });
    return out.replace(/\s+$/, '') + '\n';
  }

  renderNow() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._renderBuf(this.buf);
    this.opts.onRender && this.opts.onRender();
  }

  /* ---------- rendering ---------- */
  _schedule() {
    if (!this._raf) this._raf = requestAnimationFrame(() => this.renderNow());
  }

  _renderBuf(b) {
    if (this.input) this._line(b.y);
    if (b.pendingTrim) {
      const k = Math.min(b.pendingTrim, b.lineEls.length);
      for (let i = 0; i < k; i++) b.lineEls[i].remove();
      b.lineEls.splice(0, k);
      b.pendingTrim = 0;
    }
    const lines = b.lines;
    while (b.lineEls.length > lines.length) b.lineEls.pop().remove();
    const cursorOn = this.showCursor && this.cursorVisible && !this.input;
    const cy = cursorOn ? b.y : -1;
    for (let i = 0; i < lines.length; i++) {
      let el = b.lineEls[i];
      if (!el) {
        el = document.createElement('div');
        const prev = b.lineEls[i - 1];
        b.el.insertBefore(el, prev ? prev.nextSibling : b.el.firstChild);
        b.lineEls.push(el);
      }
      const ln = lines[i];
      const curX = i === cy ? Math.min(b.x, this.cols - 1) : -1;
      if (el._line !== ln || ln.dirty || el._cur !== curX) {
        el.className = SIZE_CLASS[ln.size] || 'tl';
        el.innerHTML = renderLine(ln, curX);
        el._line = ln;
        el._cur = curX;
        ln.dirty = false;
      }
    }
    if (this.input) {
      const target = b.lineEls[b.y];
      if (this._hiddenEl && this._hiddenEl !== target) this._hiddenEl.style.display = '';
      if (this.input.parentNode !== b.el || this.input.nextSibling !== target) {
        const active = document.activeElement;
        const had = active && this.input.contains(active);
        b.el.insertBefore(this.input, target);
        if (had) active.focus({ preventScroll: true });
      }
      if (target) { target.style.display = 'none'; this._hiddenEl = target; }
    }
  }

  /* ---------- state ---------- */
  _mkBuf(alt) {
    const el = document.createElement('div');
    el.className = 'tbuf';
    return { alt, lines: [], x: 0, y: 0, wrapPending: false, saved: null, el, lineEls: [], pendingTrim: 0 };
  }

  _fullReset() {
    this.attr = DEFAULT;
    this.defaultAttr = DEFAULT;
    this.charsets = ['B', 'B', 'B', 'B'];
    this.gl = 0;
    this.ss = -1;
    this.insertMode = false;
    this.autowrap = true;
    this.originMode = false;
    this.cursorVisible = true;
    this.lnm = false;
    this._setReverse(false);
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this._resetTabs();
    this.lastChar = null;
    this.state = GROUND;
    this.params = '';
    this.prefix = '';
    this.inter = '';
    this.osc = '';
  }

  _softReset() {
    this.cursorVisible = true;
    this.insertMode = false;
    this.originMode = false;
    this.autowrap = true;
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.attr = this.defaultAttr;
    this.charsets = ['B', 'B', 'B', 'B'];
    this.gl = 0;
    this.buf.saved = null;
  }

  _resetTabs() {
    this.tabs = Array.from({ length: this.cols }, (_, i) => i > 0 && i % 8 === 0);
  }

  _setReverse(on) {
    this.reverse = on;
    this.root.classList.toggle('reverse-video', on);
  }

  _base() {
    const b = this.buf;
    return b.alt ? 0 : Math.max(0, b.lines.length - this.rows);
  }
  _row() { return this.buf.y - this._base(); }
  _line(y) {
    const L = this.buf.lines;
    while (L.length <= y) L.push(blankLine());
    return L[y];
  }
  _setRow(row) {
    const b = this.buf;
    b.y = this._base() + row;
    this._line(b.y);
    b.wrapPending = false;
  }
  _eraseAttr() {
    return this.attr.bg == null ? DEFAULT : makeAttr({ bg: this.attr.bg });
  }

  /* ---------- parser ---------- */
  _feed(ch) {
    const cp = ch.codePointAt(0);
    if (cp === 0x1b) {
      if (this.state === OSC) this._oscDispatch();
      this.state = ESC;
      this.inter = '';
      return;
    }
    if (cp === 0x18 || cp === 0x1a) {
      if (this.state !== GROUND && cp === 0x1a) this._print('\u2426', 0x2426);
      this.state = GROUND;
      return;
    }
    switch (this.state) {
      case GROUND:
        if (cp < 0x20 || cp === 0x7f) return this._control(cp);
        if (cp >= 0x80 && cp < 0xa0) return this._c1(cp);
        return this._print(ch, cp);
      case ESC:
        if (cp < 0x20) return this._control(cp);
        return this._esc(ch);
      case ESC_INT:
        if (cp < 0x20) return this._control(cp);
        return this._escInt(ch, cp);
      case CSI:
        if (cp < 0x20) return this._control(cp);
        if ((cp >= 0x30 && cp <= 0x39) || ch === ';' || ch === ':') {
          if (this.params.length < 256) this.params += ch;
        } else if (ch === '?' || ch === '>' || ch === '=' || ch === '<') {
          if (this.params === '' && this.prefix === '') this.prefix = ch;
        } else if (cp >= 0x20 && cp <= 0x2f) {
          this.inter += ch;
        } else if (cp >= 0x40 && cp <= 0x7e) {
          this.state = GROUND;
          this._csiDispatch(ch);
        }
        return;
      case OSC:
        if (cp === 0x07 || cp === 0x9c) { this._oscDispatch(); this.state = GROUND; return; }
        if (this.osc.length < 4096) this.osc += ch;
        return;
      case STR:
        if (cp === 0x9c || cp === 0x07) this.state = GROUND;
        return;
    }
  }

  _control(cp) {
    const b = this.buf;
    switch (cp) {
      case 0x07: this.opts.onBell && this.opts.onBell(); break;
      case 0x08: b.wrapPending = false; if (b.x > 0) b.x--; break;
      case 0x09: this._tab(1); break;
      case 0x0a: this._index(); this._cr(); break; // behaves like a tty with onlcr
      case 0x0b: case 0x0c: this._index(); if (this.lnm) this._cr(); break;
      case 0x0d: this._cr(); break;
      case 0x0e: this.gl = 1; break;
      case 0x0f: this.gl = 0; break;
    }
  }

  _c1(cp) {
    this.state = GROUND;
    this._esc(String.fromCharCode(cp - 0x40));
  }

  _esc(ch) {
    const b = this.buf;
    this.state = GROUND;
    switch (ch) {
      case '[': this.state = CSI; this.params = ''; this.prefix = ''; this.inter = ''; break;
      case ']': this.state = OSC; this.osc = ''; break;
      case 'P': case 'X': case '^': case '_': this.state = STR; break;
      case '7': this._saveCursor(); break;
      case '8': this._restoreCursor(); break;
      case 'D': this._index(); break;
      case 'E': this._index(); this._cr(); break;
      case 'M': this._reverseIndex(); break;
      case 'H': if (b.x < this.cols) this.tabs[b.x] = true; break;
      case 'c': this.reset(); break;
      case 'N': this.ss = 2; break;
      case 'O': this.ss = 3; break;
      case 'n': this.gl = 2; break;
      case 'o': this.gl = 3; break;
      case '\\': case '=': case '>': case 'Z': break;
      default:
        if (ch >= ' ' && ch <= '/') { this.state = ESC_INT; this.inter = ch; }
    }
  }

  _escInt(ch, cp) {
    if (cp >= 0x20 && cp <= 0x2f) { this.inter += ch; return; }
    this.state = GROUND;
    const i = this.inter[0];
    const g = '()*+'.indexOf(i);
    if (g >= 0) { this.charsets[g] = ch; return; }
    if (i === '#') {
      if (ch === '8') return this._decaln();
      const size = { '3': 2, '4': 3, '5': 0, '6': 1 }[ch];
      if (size !== undefined) { const ln = this._line(this.buf.y); ln.size = size; ln.dirty = true; }
    }
  }

  _oscDispatch() {
    const s = this.osc;
    this.osc = '';
    const idx = s.indexOf(';');
    const cmd = idx < 0 ? s : s.slice(0, idx);
    const rest = idx < 0 ? '' : s.slice(idx + 1);
    if (cmd === '0' || cmd === '2') this.opts.onTitle && this.opts.onTitle(rest);
    else if (cmd === '8') {
      const j = rest.indexOf(';');
      const url = j < 0 ? '' : rest.slice(j + 1);
      this.attr = makeAttr({ ...this.attr, link: url || null });
    }
  }

  /* ---------- printing ---------- */
  _print(ch, cp) {
    const b = this.buf;
    const cs = this.ss >= 0 ? this.charsets[this.ss] : this.charsets[this.gl];
    this.ss = -1;
    if (cs === '0' && DEC_GRAPHICS[ch]) { ch = DEC_GRAPHICS[ch]; cp = ch.codePointAt(0); }
    else if (cs === 'A' && ch === '#') { ch = '£'; cp = 0xa3; }
    const w = wcwidth(cp);
    if (w === 0) return this._combine(ch);
    if (b.wrapPending) {
      if (this.autowrap) { this._line(b.y).wrapped = true; this._index(); b.x = 0; }
      b.wrapPending = false;
    }
    if (w === 2 && b.x >= this.cols - 1) {
      if (this.autowrap) { this._line(b.y).wrapped = true; this._index(); b.x = 0; }
      else b.x = Math.max(0, this.cols - 2);
    }
    const ln = this._line(b.y);
    if (this.insertMode) this._insertCells(ln, b.x, w, DEFAULT);
    this._setCell(ln, b.x, ch, this.attr);
    if (w === 2) this._setCell(ln, b.x + 1, '', this.attr);
    ln.dirty = true;
    this.lastChar = ch;
    b.x += w;
    if (b.x >= this.cols) { b.x = this.cols - 1; b.wrapPending = this.autowrap; }
  }

  _combine(ch) {
    const b = this.buf;
    const ln = this._line(b.y);
    let i = b.wrapPending ? b.x : b.x - 1;
    if (i < 0) return;
    if (ln.c[i] === '' && i > 0) i--;
    if (i < ln.c.length) { ln.c[i] += ch; ln.dirty = true; }
  }

  _setCell(ln, x, ch, at) {
    const c = ln.c, a = ln.a;
    while (c.length < x) { c.push(' '); a.push(DEFAULT); }
    if (ch !== '' && c[x] === '' && x > 0) c[x - 1] = ' ';
    if (c[x + 1] === '') c[x + 1] = ' ';
    c[x] = ch;
    a[x] = at;
  }

  _fill(ln, from, to, at) {
    const c = ln.c, a = ln.a;
    while (c.length < from) { c.push(' '); a.push(DEFAULT); }
    if (c[from] === '' && from > 0) c[from - 1] = ' ';
    for (let i = from; i < to; i++) { c[i] = ' '; a[i] = at; }
    if (c[to] === '') c[to] = ' ';
    ln.dirty = true;
  }

  _insertCells(ln, x, n, at) {
    if (x >= ln.c.length) return;
    ln.c.splice(x, 0, ...Array(n).fill(' '));
    ln.a.splice(x, 0, ...Array(n).fill(at));
    if (ln.c.length > this.cols) { ln.c.length = this.cols; ln.a.length = this.cols; }
    ln.dirty = true;
  }

  _clearLine(ln) {
    const ea = this._eraseAttr();
    if (ea === DEFAULT) { ln.c = []; ln.a = []; }
    else { ln.c = Array(this.cols).fill(' '); ln.a = Array(this.cols).fill(ea); }
    ln.wrapped = false;
    ln.size = 0;
    ln.dirty = true;
  }

  /* ---------- cursor & scrolling ---------- */
  _cr() { this.buf.x = 0; this.buf.wrapPending = false; }

  _index() {
    const b = this.buf;
    const row = this._row();
    if (row === this.scrollBottom) this._scrollUp(1);
    else if (row < this.rows - 1) { b.y++; this._line(b.y); }
  }

  _reverseIndex() {
    const row = this._row();
    if (row === this.scrollTop) this._scrollDown(1);
    else if (row > 0) this._setRow(row - 1);
  }

  _scrollUp(n) {
    const b = this.buf;
    n = clamp(n, 1, this.scrollBottom - this.scrollTop + 1);
    const base = this._base();
    const top = base + this.scrollTop, bot = base + this.scrollBottom;
    this._line(bot);
    if (!b.alt && this.scrollTop === 0 && this.scrollBottom === this.rows - 1) {
      for (let i = 0; i < n; i++) b.lines.push(blankLine());
      b.y += n;
      if (b.lines.length > MAX_LINES) {
        const k = b.lines.length - MAX_LINES;
        b.lines.splice(0, k);
        b.y -= k;
        b.pendingTrim += k;
      }
    } else {
      for (let i = 0; i < n; i++) { b.lines.splice(top, 1); b.lines.splice(bot, 0, blankLine()); }
    }
  }

  _scrollDown(n) {
    const b = this.buf;
    n = clamp(n, 1, this.scrollBottom - this.scrollTop + 1);
    const base = this._base();
    const top = base + this.scrollTop, bot = base + this.scrollBottom;
    this._line(bot);
    for (let i = 0; i < n; i++) { b.lines.splice(bot, 1); b.lines.splice(top, 0, blankLine()); }
  }

  _tab(n) {
    const b = this.buf;
    b.wrapPending = false;
    for (let k = 0; k < n; k++) {
      let x = b.x + 1;
      while (x < this.cols - 1 && !this.tabs[x]) x++;
      b.x = Math.min(x, this.cols - 1);
    }
  }

  _backTab(n) {
    const b = this.buf;
    b.wrapPending = false;
    for (let k = 0; k < n; k++) {
      let x = b.x - 1;
      while (x > 0 && !this.tabs[x]) x--;
      b.x = Math.max(0, x);
    }
  }

  _cup(r, c) {
    let row = r - 1;
    row = this.originMode ? clamp(row + this.scrollTop, this.scrollTop, this.scrollBottom) : clamp(row, 0, this.rows - 1);
    this._setRow(row);
    this.buf.x = clamp(c - 1, 0, this.cols - 1);
  }

  _saveCursor() {
    const b = this.buf;
    b.saved = { x: b.x, row: this._row(), attr: this.attr, charsets: this.charsets.slice(), gl: this.gl, origin: this.originMode, wrap: b.wrapPending };
  }

  _restoreCursor() {
    const b = this.buf, s = b.saved;
    if (!s) { this._setRow(0); b.x = 0; this.attr = this.defaultAttr; return; }
    this._setRow(clamp(s.row, 0, this.rows - 1));
    b.x = Math.min(s.x, this.cols - 1);
    b.wrapPending = s.wrap;
    this.attr = s.attr;
    this.charsets = s.charsets.slice();
    this.gl = s.gl;
    this.originMode = s.origin;
  }

  _altScreen(on, clearIt) {
    if (on) {
      const a = this.alt;
      if (this.buf === a) { if (clearIt) a.lines.forEach((l) => this._clearLine(l)); return; }
      const row = this._row(), x = this.normal.x;
      a.lineEls.forEach((e) => e.remove());
      a.lineEls = [];
      a.pendingTrim = 0;
      a.lines = Array.from({ length: this.rows }, blankLine);
      a.x = x; a.y = clamp(row, 0, this.rows - 1); a.wrapPending = false;
      this.buf = a;
    } else {
      if (this.buf !== this.alt) return;
      this.buf = this.normal;
    }
    if (this._hiddenEl) { this._hiddenEl.style.display = ''; this._hiddenEl = null; }
    this.normal.el.style.display = this.buf === this.normal ? '' : 'none';
    this.alt.el.style.display = this.buf === this.alt ? '' : 'none';
  }

  _decaln() {
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    const base = this._base();
    for (let r = 0; r < this.rows; r++) {
      const ln = this._line(base + r);
      ln.c = Array(this.cols).fill('E');
      ln.a = Array(this.cols).fill(DEFAULT);
      ln.size = 0;
      ln.dirty = true;
    }
    this._setRow(0);
    this.buf.x = 0;
  }

  /* ---------- CSI ---------- */
  _csiDispatch(final) {
    const raw = this.params === '' ? [] : this.params.split(';');
    const P = (i, d) => {
      const s = raw[i];
      if (s === undefined || s === '') return d;
      const v = parseInt(s, 10);
      return Number.isNaN(v) ? d : v;
    };
    const N = (i) => Math.max(1, P(i, 1));
    const b = this.buf;
    const prefix = this.prefix, inter = this.inter;

    if (prefix === '?') {
      if (final === 'h' || final === 'l') this._decMode(raw, final === 'h');
      else if (final === 'J') this._ed(P(0, 0));
      else if (final === 'K') this._el(P(0, 0));
      return;
    }
    if (prefix) return;
    if (inter === '!' && final === 'p') return this._softReset();
    if (inter) return;

    switch (final) {
      case 'A': this._cuu(N(0)); break;
      case 'B': case 'e': this._cud(N(0)); break;
      case 'C': case 'a': b.x = Math.min(this.cols - 1, b.x + N(0)); b.wrapPending = false; break;
      case 'D': b.x = Math.max(0, b.x - N(0)); b.wrapPending = false; break;
      case 'E': this._cud(N(0)); this._cr(); break;
      case 'F': this._cuu(N(0)); this._cr(); break;
      case 'G': case '`': b.x = clamp(N(0) - 1, 0, this.cols - 1); b.wrapPending = false; break;
      case 'H': case 'f': this._cup(N(0), N(1)); break;
      case 'd': { const x = b.x; this._cup(N(0), 1); b.x = x; break; }
      case 'J': this._ed(P(0, 0)); break;
      case 'K': this._el(P(0, 0)); break;
      case 'L': this._il(N(0)); break;
      case 'M': this._dl(N(0)); break;
      case '@': this._insertCells(this._line(b.y), b.x, Math.min(N(0), this.cols), this._eraseAttr()); b.wrapPending = false; break;
      case 'P': this._dch(N(0)); break;
      case 'X': { const ln = this._line(b.y); this._fill(ln, b.x, Math.min(this.cols, b.x + N(0)), this._eraseAttr()); b.wrapPending = false; break; }
      case 'S': this._scrollUp(N(0)); break;
      case 'T': if (raw.length <= 1) this._scrollDown(N(0)); break;
      case 'I': this._tab(N(0)); break;
      case 'Z': this._backTab(N(0)); break;
      case 'b': if (this.lastChar) { const n = Math.min(N(0), this.cols * this.rows); const ch = this.lastChar; for (let i = 0; i < n; i++) this._print(ch, ch.codePointAt(0)); } break;
      case 'g': { const m = P(0, 0); if (m === 0) this.tabs[b.x] = false; else if (m === 3) this.tabs.fill(false); break; }
      case 'm': this._sgr(raw); break;
      case 'r': {
        const t = P(0, 1) - 1, bm = Math.min(P(1, this.rows), this.rows) - 1;
        if (t < bm) { this.scrollTop = Math.max(0, t); this.scrollBottom = bm; this._cup(1, 1); }
        break;
      }
      case 's': this._saveCursor(); break;
      case 'u': this._restoreCursor(); break;
      case 'h': case 'l':
        for (const s of raw) {
          const m = parseInt(s, 10);
          if (m === 4) this.insertMode = final === 'h';
          else if (m === 20) this.lnm = final === 'h';
        }
        break;
      // n (DSR), c (DA), t (window ops), q (DECLL) need a reply channel / hardware — ignored
    }
  }

  _cuu(n) {
    const row = this._row();
    const min = row >= this.scrollTop ? this.scrollTop : 0;
    const x = this.buf.x;
    this._setRow(Math.max(min, row - n));
    this.buf.x = x;
  }

  _cud(n) {
    const row = this._row();
    const max = row <= this.scrollBottom ? this.scrollBottom : this.rows - 1;
    const x = this.buf.x;
    this._setRow(Math.min(max, row + n));
    this.buf.x = x;
  }

  _ed(m) {
    const b = this.buf, base = this._base();
    const end = Math.min(b.lines.length, base + this.rows);
    if (m === 0) { this._el(0); for (let i = b.y + 1; i < end; i++) this._clearLine(b.lines[i]); }
    else if (m === 1) { this._el(1); for (let i = base; i < b.y; i++) this._clearLine(b.lines[i]); }
    else if (m === 2) { for (let i = base; i < end; i++) this._clearLine(b.lines[i]); }
    else if (m === 3 && !b.alt && base > 0) {
      b.lines.splice(0, base);
      b.y -= base;
      b.pendingTrim += base;
    }
  }

  _el(m) {
    const b = this.buf, ln = this._line(b.y), ea = this._eraseAttr();
    const x = b.x;
    if (m === 0) {
      if (ea === DEFAULT) {
        if (ln.c[x] === '' && x > 0) ln.c[x - 1] = ' ';
        ln.c.length = Math.min(ln.c.length, x);
        ln.a.length = ln.c.length;
      } else this._fill(ln, x, this.cols, ea);
      ln.wrapped = false;
    } else if (m === 1) {
      this._fill(ln, 0, Math.min(x + 1, this.cols), ea);
    } else if (m === 2) {
      if (ea === DEFAULT) { ln.c = []; ln.a = []; } else this._fill(ln, 0, this.cols, ea);
      ln.wrapped = false;
    }
    ln.dirty = true;
  }

  _il(n) {
    const b = this.buf, row = this._row();
    if (row < this.scrollTop || row > this.scrollBottom) return;
    n = Math.min(n, this.scrollBottom - row + 1);
    const bot = this._base() + this.scrollBottom;
    this._line(bot);
    for (let i = 0; i < n; i++) { b.lines.splice(bot, 1); b.lines.splice(b.y, 0, blankLine()); }
    b.x = 0; b.wrapPending = false;
  }

  _dl(n) {
    const b = this.buf, row = this._row();
    if (row < this.scrollTop || row > this.scrollBottom) return;
    n = Math.min(n, this.scrollBottom - row + 1);
    const bot = this._base() + this.scrollBottom;
    this._line(bot);
    for (let i = 0; i < n; i++) { b.lines.splice(b.y, 1); b.lines.splice(bot, 0, blankLine()); }
    b.x = 0; b.wrapPending = false;
  }

  _dch(n) {
    const b = this.buf, ln = this._line(b.y), ea = this._eraseAttr();
    b.wrapPending = false;
    if (b.x >= ln.c.length) return;
    if (ln.c[b.x] === '' && b.x > 0) ln.c[b.x - 1] = ' ';
    ln.c.splice(b.x, n);
    ln.a.splice(b.x, n);
    if (ln.c[b.x] === '') ln.c[b.x] = ' ';
    if (ea !== DEFAULT) while (ln.c.length < this.cols) { ln.c.push(' '); ln.a.push(ea); }
    ln.dirty = true;
  }

  _decMode(raw, on) {
    for (const s of raw) {
      switch (parseInt(s, 10)) {
        case 3: // DECCOLM: column width can't change here, but it clears and homes like a real VT100
          this.scrollTop = 0; this.scrollBottom = this.rows - 1; this._ed(2); this._cup(1, 1); break;
        case 5: this._setReverse(on); break;
        case 6: this.originMode = on; this._cup(1, 1); break;
        case 7: this.autowrap = on; if (!on) this.buf.wrapPending = false; break;
        case 25: this.cursorVisible = on; break;
        case 47: case 1047: this._altScreen(on, s === '1047'); break;
        case 1048: on ? this._saveCursor() : this._restoreCursor(); break;
        case 1049:
          if (on) { this._saveCursor(); this._altScreen(true, true); }
          else { this._altScreen(false); this._restoreCursor(); }
          break;
      }
    }
  }

  _sgr(raw) {
    if (raw.length === 0) raw = ['0'];
    const a = { ...this.attr };
    const toColor = (n) => (Number.isFinite(n) ? clamp(n, 0, 255) : null);
    const rgb = (v) => {
      const n = v.map((x) => parseInt(x, 10));
      if (n.some((x) => !Number.isFinite(x))) return null;
      return '#' + hx(n[0]) + hx(n[1]) + hx(n[2]);
    };
    for (let i = 0; i < raw.length; i++) {
      const sub = raw[i].split(':');
      const p = sub[0] === '' ? 0 : parseInt(sub[0], 10);
      if (p === 38 || p === 48 || p === 58) {
        let col = null;
        if (sub.length > 1) {
          const mode = parseInt(sub[1], 10);
          if (mode === 5) col = toColor(parseInt(sub[2], 10));
          else if (mode === 2) col = rgb(sub.length >= 6 ? sub.slice(3, 6) : sub.slice(2, 5));
        } else {
          const mode = parseInt(raw[i + 1], 10);
          if (mode === 5) { col = toColor(parseInt(raw[i + 2], 10)); i += 2; }
          else if (mode === 2) { col = rgb([raw[i + 2], raw[i + 3], raw[i + 4]]); i += 4; }
          else i += 1;
        }
        if (col !== null) { if (p === 38) a.fg = col; else if (p === 48) a.bg = col; else a.ulc = col; }
        continue;
      }
      switch (p) {
        case 0: { const link = a.link; Object.assign(a, this.defaultAttr); a.link = link; break; }
        case 1: a.bold = true; break;
        case 2: a.dim = true; break;
        case 3: a.italic = true; break;
        case 4: a.ul = sub.length > 1 ? clamp(parseInt(sub[1], 10) || 0, 0, 5) : 1; break;
        case 5: case 6: a.blink = true; break;
        case 7: a.inverse = true; break;
        case 8: a.hidden = true; break;
        case 9: a.strike = true; break;
        case 21: a.ul = 2; break;
        case 22: a.bold = false; a.dim = false; break;
        case 23: a.italic = false; break;
        case 24: a.ul = 0; break;
        case 25: a.blink = false; break;
        case 27: a.inverse = false; break;
        case 28: a.hidden = false; break;
        case 29: a.strike = false; break;
        case 39: a.fg = this.defaultAttr.fg; break;
        case 49: a.bg = this.defaultAttr.bg; break;
        case 53: a.overline = true; break;
        case 55: a.overline = false; break;
        case 59: a.ulc = null; break;
        default:
          if (p >= 30 && p <= 37) a.fg = p - 30;
          else if (p >= 40 && p <= 47) a.bg = p - 40;
          else if (p >= 90 && p <= 97) a.fg = p - 90 + 8;
          else if (p >= 100 && p <= 107) a.bg = p - 100 + 8;
      }
    }
    this.attr = makeAttr(a);
  }
}
