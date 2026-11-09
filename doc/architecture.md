# Architecture

PyTerm is a static, client-side application made of four source files. There is no build step, no server-side code, and no framework.

- [Overview](#overview)
- [Files and responsibilities](#files-and-responsibilities)
- [Boot sequence](#boot-sequence)
- [Input → execution → output](#input--execution--output)
- [The input line inside the terminal](#the-input-line-inside-the-terminal)
- [Rendering strategy](#rendering-strategy)
- [Terminal sizing](#terminal-sizing)
- [State and persistence](#state-and-persistence)
- [External dependencies](#external-dependencies)

---

## Overview

```
┌──────────────────────────── Browser tab ────────────────────────────┐
│                                                                     │
│  index.html ── layout, CSS, PyScript bootstrap                      │
│      │                                                              │
│      ├── app.js (ES module) ─────────── UI controller               │
│      │     │  owns the <textarea> input, history, completion,       │
│      │     │  toolbar, status, sizing                               │
│      │     │                                                        │
│      │     ├── terminal.js ─── Terminal class                       │
│      │     │     parser → screen buffers → DOM renderer             │
│      │     │                                                        │
│      │     │   window.pyterm_push / _complete / _restart / ...      │
│      │     ▼   (functions exported by Python)                       │
│      └── repl.py (PyScript, Pyodide/WebAssembly)                    │
│            SafeConsole (pyodide.console.PyodideConsole)             │
│            stdout/stderr callbacks ──► window.pyterm_write          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

JavaScript and Python talk only through a few functions attached to `window` (see [Python Bridge](python-bridge.md)).

## Files and responsibilities

### `index.html`
- Required error-reporting and runtime scripts, meta tags, fonts.
- Loads **Tailwind CSS** (Play CDN), **PyScript** `core.css` and `core.js` (2024.11.1).
- Custom CSS for the terminal: line boxes (`.tl`), wide characters (`.w2`), the block cursor (`.cur`), blink animation, double-width and double-height lines, reverse-video mode, bell flash, scrollbars.
- Markup: header with status pill and toolbar, the `#screen` scroll container holding `#output` (emulator root) and `#input-row` (prompt and textarea), the loader, the status bar, and the shortcuts dialog.
- `<script type="py" src="./repl.py">` starts Python. `<script type="module" src="./app.js">` starts the UI.

### `app.js`: UI controller
- Creates the `Terminal` on `#output` with callbacks for rendering (auto-scroll), bell and title.
- Implements `window.pyterm_write(text, kind)` and `window.pyterm_clear()`, which Python calls.
- Handles the input textarea: submitting, multi-line feeding, auto-indent, history, Tab completion, Ctrl+C / Ctrl+L, smart Backspace.
- Toolbar actions, status pill, loader messages, terminal sizing (`fit()`), and the `pyterm_ready` handshake.

### `terminal.js`: terminal emulator
- `Terminal` class: a state-machine parser for C0/C1 controls, ESC, CSI, OSC and string sequences.
- Two screen buffers (normal with scrollback, and alternate), cursor and wrap state, scroll region, tab stops, modes, character sets.
- Interned, immutable cell attributes, and a cached CSS style for each attribute set.
- Incremental DOM renderer batched with `requestAnimationFrame`.
- Full details in the [Terminal Emulator Reference](terminal-emulator.md).

### `repl.py`: Python side
- Builds a `SafeConsole` (a subclass of `pyodide.console.PyodideConsole`) whose stdout/stderr callbacks forward text to JavaScript.
- `push(line)` feeds one line, awaits execution (top-level await), prints results, and reports errors.
- Exit handling, completion, buffer reset, restart, terminal size, and the `demo()` coroutine.
- Exposes its functions on `window`, then calls `window.pyterm_ready(version, platform)`.

## Boot sequence

```
index.html parsed
 ├─ app.js module runs
 │    ├─ createIcons()
 │    ├─ new Terminal(#output)            (renderer ready, empty)
 │    ├─ ResizeObserver + fit()           (cols × rows computed)
 │    ├─ status = "Starting", loader messages rotate every 2.5 s
 │    └─ defines window.pyterm_ready / pyterm_write / pyterm_clear
 │
 └─ PyScript core.js
      ├─ downloads Pyodide (WASM + stdlib)
      └─ runs repl.py
           ├─ sets TERM / COLORTERM
           ├─ make_console()
           ├─ window.pyterm_push = create_proxy(push), …
           └─ window.pyterm_ready(sys.version, sys.platform)
                 └─ app.js: remove loader, status "Ready",
                    fit() (now also pushes size to Python),
                    print banner, show prompt
```

Because `pyterm_ready` is called from Python, the UI never shows a prompt before the interpreter can take input.

## Input → execution → output

1. The user presses **Enter**. `submit()` takes the textarea value and calls `runSource(raw)`.
2. `runSource` adds the entry to history, sets `busy = true`, hides the input line, shows the emulator cursor, and sets the status to **Running**.
3. For **each line** of the input:
   - `term.prepareForPrompt()` makes sure the prompt starts on a fresh line (a CR+LF is emitted only if the cursor is not already at column 0).
   - The prompt (`>>> ` or `... `) and the line are echoed through `term.writeKind()` in the prompt and input colours.
   - `await window.pyterm_push(line)` hands the line to Python.
4. In Python, `push()`:
   - calls `console.push(line)`, which returns a future with `syntax_check` set to `"incomplete"`, `"syntax-error"` or `"complete"`;
   - for `incomplete`, returns immediately and the UI switches to `...`;
   - for `syntax-error`, writes the formatted error to stderr;
   - otherwise awaits the future. While the code runs, every `print` goes through `stdout_callback` → `window.pyterm_write(text, "out")` → `term.write(text)`;
   - a non-`None` result is stored in `_` and written as kind `"result"`;
   - exceptions are written as kind `"err"`; an exit request rebuilds the console and returns `"exit"`.
5. Back in `runSource`, after the last line: status **Ready**, prompt chosen from the continuation state, auto-indent pre-filled when continuing a block, and the input line reattached at the cursor.

### Output kinds

`window.pyterm_write(text, kind)` routes text based on `kind`:

| kind | Path | Colour |
|---|---|---|
| `out` | `term.write(text)`: raw, with the program's own SGR state | program-defined |
| `err` | `term.writeKind(text, '#ff7b72')` | red |
| `result` | `term.writeKind(text, '#79c0ff')` | blue |
| `prompt`, `input`, `info`, `accent` | `term.writeKind(...)` | see `COLORS` in `app.js` |

`writeKind` temporarily swaps the emulator's *default* attribute, so `ESC[0m` or `ESC[39m` inside a traceback falls back to red rather than plain grey. It then restores the program's SGR state, so a program's colour settings survive between `print` calls.

## The input line inside the terminal

The input line is a real `<textarea>`, which gives native editing, selection, IME and mobile keyboard support. To make it look like part of the terminal:

- When the prompt is shown, `term.attachInput(inputRow)` moves the `#input-row` element into the active buffer, **just before the line the cursor is on**, and hides that line's own DOM element.
- Before the prompt is drawn, `prepareForPrompt()` puts the cursor on a fresh line, so nothing visible is hidden.
- When execution starts, `detachInput()` shows the hidden line again and the emulator's block cursor appears.
- The textarea grows with its content (`autosize()`), so multi-line input expands naturally.

## Rendering strategy

- **Model.** Each buffer holds an array of line objects `{ c: string[], a: Attr[], wrapped, size, dirty }`. `c[i]` is the character in column *i* (combining marks are appended to it); `''` marks the second half of a wide character. `a[i]` is an interned, frozen attribute object.
- **Batching.** `write()` parses the whole chunk, then schedules one `requestAnimationFrame`. Many small writes in the same frame produce a single DOM update.
- **Incremental DOM.** Every line has one `<div class="tl">`. During a render, a line is regenerated only if it is marked dirty, its line object changed (after scrolling or insert/delete), or the cursor moved onto or off it. Line elements removed from the front of the scrollback (`pendingTrim`) are dropped from the DOM without rebuilding the rest.
- **Runs.** Neighbouring cells with the same attributes are merged into a single `<span style="…">`, so the DOM stays small.
- **Cursor.** While a program is running, the cell under the cursor is wrapped in `<span class="cur">`.
- **Auto-scroll.** After each render, `onRender` scrolls `#screen` to the bottom.

## Terminal sizing

`fit()` in `app.js` measures a hidden 50-character probe line to get the character width and line height, then computes:

```
cols = floor(#output width / char width)      (minimum 20)
rows = floor(#screen inner height / line height)   (minimum 5)
```

It runs on load, on every `ResizeObserver` event for `#screen`, and when the font size changes. The size goes to `term.resize(cols, rows)` (which resets the scroll region and tab stops, clamps the cursor and resizes the alternate buffer) and to Python via `pyterm_set_size`, which sets `COLUMNS` and `LINES`.

Output does not reflow on resize: lines keep the wrapping they had when written, which is how most VT terminals behave.

## State and persistence

| Data | Where | Lifetime |
|---|---|---|
| Command history (max 500) | `sessionStorage['pyterm-history']` | Browser tab session |
| Font size | `sessionStorage['pyterm-font']` | Browser tab session |
| Python variables, imported modules | Pyodide memory | Until Restart / `exit()` (variables) or page reload (everything) |
| Packages installed with micropip | Pyodide in-memory file system | Until page reload |
| Scrollback (max 5,000 lines) | `Terminal` buffers | Until Clear, Restart or reload |

PyTerm has no backend and stores nothing on any server.

## External dependencies

All loaded from CDNs at runtime:

| Dependency | URL | Purpose |
|---|---|---|
| PyScript 2024.11.1 | `pyscript.net/releases/2024.11.1/core.js`, `core.css` | Loads Pyodide and runs `repl.py` |
| Pyodide 0.26.4 | fetched by PyScript from `cdn.jsdelivr.net/pyodide/` | CPython on WebAssembly |
| Tailwind CSS | `cdn.tailwindcss.com` | Utility classes for layout |
| Lucide | `cdn.jsdelivr.net/npm/lucide@latest/+esm` | Toolbar icons |
| Google Fonts | Inter, JetBrains Mono | UI and terminal fonts |
