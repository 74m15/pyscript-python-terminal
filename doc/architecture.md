# Architecture

PyTerm is a static, client-side application. There is no build step, no server-side code and no framework. Python runs in a **module Web Worker**; the page only draws the terminal and handles the keyboard.

- [Overview](#overview)
- [Files and responsibilities](#files-and-responsibilities)
- [Boot sequence](#boot-sequence)
- [Input → execution → output](#input--execution--output)
- [input() and other reads from stdin](#input-and-other-reads-from-stdin)
- [Stopping code](#stopping-code)
- [The input line inside the terminal](#the-input-line-inside-the-terminal)
- [Rendering strategy](#rendering-strategy)
- [Terminal sizing](#terminal-sizing)
- [State and persistence](#state-and-persistence)
- [External dependencies](#external-dependencies)

---

## Overview

```
┌──────────────────────────────── Browser tab ─────────────────────────────────┐
│ Main thread                                                                  │
│   index.html ── layout, CSS, dialogs                                         │
│   app.js ───── UI controller (input line, input() prompts, history,          │
│     │           completion, toolbar, Programs menu, drag & drop)             │
│     ├── terminal.js ── Terminal: parser → screen buffers → DOM renderer      │
│     ├── upload.js ──── Upload dialog                                         │
│     └── engine.js ──── PythonEngine ──┐                                      │
│                         postMessage    │  (+ SharedArrayBuffer when          │
│                                        │     the page is cross-origin        │
│ Web Worker                             ▼     isolated)                       │
│   py-worker.js ── loadPyodide(), stdout/stderr batching, stdin, interrupt,   │
│     │             IDBFS mount for ~/browser, request queue                   │
│     ├── pyterm_host (JS module registered in Python)                         │
│     ├── repl.py ── SafeConsole, input()/stdin, scripts, uploads, demo()      │
│     └── ~/.pyterm/pyterm.py (from pyterm_lib.py) ── helpers for programs     │
└──────────────────────────────────────────────────────────────────────────────┘
```

The page and the worker talk only with `postMessage` (see [Python Bridge](python-bridge.md)). Python talks to the worker through the `pyterm_host` JavaScript module.

## Files and responsibilities

### `index.html`
- Required error-reporting and runtime scripts, meta tags, fonts, Tailwind, Puter.js, a `modulepreload` hint for `pyodide.mjs`.
- Custom CSS for the terminal: line boxes (`.tl`), wide characters (`.w2`), the block cursor (`.cur`), blink, double-width/height lines, reverse video, bell flash, password input (`#cmd.secret`), upload rows and chips.
- Markup: header (status pill, toolbar, Programs menu, Stop button), the `#screen` scroll container with `#output` (emulator root) and `#input-row` (prompt + textarea), the loader, the status bar (Python version, worker mode, `~/browser saved` badge, size, history count), the shortcuts dialog, the drop overlay and the Upload dialog.
- `<script type="module" src="./app.js">` starts everything.

### `app.js`: UI controller
- Creates the `Terminal` and the `PythonEngine`, and routes worker output to the terminal.
- REPL input: submit, line-by-line feeding of pasted code, auto-indent, history, Tab completion, Ctrl+C / Ctrl+L, smart Backspace.
- `input()` requests: shows the program's own prompt (the text already on the cursor line), password mode, per-program history and completion words, Ctrl+D (EOF), Ctrl+C (KeyboardInterrupt), multi-line paste queue.
- Stop / restart, scripts and programs (`runFile`), the Programs menu and `?program=` links, drag & drop, Open/Save/download, Puter menu bar, status and sizing.

### `engine.js`: `PythonEngine`
- Starts (and restarts) the worker; creates the shared interrupt and stdin buffers when `crossOriginIsolated` is true.
- `call(type, payload)` → Promise, matched by request id.
- `reply(text, status)` answers an `input()` request, `sendInterrupt()`, `resize()`, `flushFs()`.

### `py-worker.js`: the worker
- Loads Pyodide 314.0.7 with `HOME=/home/pyodide`, `TERM`, `COLORTERM`.
- Batches stdout/stderr into `out` messages (at most one every ~12 ms, or 64 KB).
- Mounts `/home/pyodide/browser` on IDBFS and syncs it.
- Registers the `pyterm_host` module, installs `pyterm.py`, runs `repl.py` and keeps references to its functions.
- Runs requests one at a time (promise chain); `input_reply`, `interrupt`, `size` and `flush_fs` are handled immediately, even while code runs.

### `repl.py`: Python side
- `SafeConsole` (a `pyodide.console.PyodideConsole`) runs REPL lines with top-level await.
- Replaces `input`, `sys.stdin`, `getpass.getpass` and `time.sleep` with worker-aware versions.
- Runs staged scripts and programs, implements `run()`, uploads, archive extraction, `tree()` and downloads.

### `pyterm_lib.py`: the `pyterm` module
Helpers for user programs (`input` with completions/password/history, `ainput`, `confirm`, `choose`, `table`, `style`, `download`, `App`, `run`). See [Custom Programs](custom-programs.md).

### `upload.js`: Upload dialog
File, folder and Puter Drive pickers, drop zone with folder traversal, archive detection by magic bytes, destination and conflict policy, progress, summary in the terminal.

### `terminal.js`: terminal emulator
State-machine parser, normal and alternate buffers, scroll region, tab stops, modes, character sets, interned attributes, incremental DOM renderer. See the [Terminal Emulator Reference](terminal-emulator.md).

## Boot sequence

```
index.html parsed
 └─ app.js module
      ├─ new Terminal(#output), ResizeObserver + fit()
      ├─ new PythonEngine(handlers), Programs menu loaded from programs/index.json
      └─ engine.start()
           └─ new Worker('py-worker.js', {type:'module'})  ── postMessage {init, cols, rows, [SABs]}
                ├─ status "Downloading the Python runtime…"  → loader text
                ├─ loadPyodide(), setStdout/setStderr, setInterruptBuffer (if shared)
                ├─ status "Opening your browser folder…": mount IDBFS, syncfs(populate)
                ├─ status "Loading the standard library…"
                ├─ registerJsModule('pyterm_host'), write ~/.pyterm/pyterm.py
                ├─ runPython(repl.py)
                └─ postMessage {ready, version, persist, shared, interrupt, jspi}
                     └─ app.js: remove loader, status Ready, banner, prompt,
                        launch ?program=… if present, run queued actions
```

## Input → execution → output

1. **Enter** → `submit()` → `runSource(raw)`.
2. `runSource` saves history, sets **Running**, hides the input line and, for each line, echoes the prompt and line, then `await engine.call('push', {line})`.
3. The worker loads any Pyodide packages the line imports (`loadPackagesFromImports`), then calls `push(line)` in `repl.py`, which returns `"incomplete"`, `"complete"` or `"exit"`.
4. While the code runs, `print()` → Pyodide stdout → `out()` batching → `{type:'out'}` → `term.write()`. Results are sent with kind `result`, errors with kind `err`.
5. When the promise resolves, `endBusy()` shows the `>>>` or `...` prompt again.

Scripts and programs use `engine.call('run_file', {name, source, isolated})`; see [Python Bridge](python-bridge.md#running-scripts-and-programs).

### Output kinds

| kind | Path | Colour |
|---|---|---|
| `out` | `term.write(text)` (program's own SGR state) | program-defined |
| `err` | `term.writeKind(text, '#ff7b72')` | red |
| `result` | `term.writeKind(text, '#79c0ff')` | blue |
| `info` | `term.writeKind(text, '#7d8b99')` | grey |
| `prompt`, `input`, `accent` | used by `app.js` | see `COLORS` |

## input() and other reads from stdin

```
Python: input("Name? ")
  ├─ prompt written to stdout, output flushed
  └─ pyterm.read_line()
       ├─ JSPI available (can_run_sync):  run_sync(host.input_async())  → {type:'input', via:'msg'}
       │      worker keeps running its event loop; page answers with {type:'input_reply'}
       └─ shared memory:  host.read_input() → {type:'input', via:'sab'}
              worker blocks in Atomics.wait; page writes the line into the SAB and notifies
Page: beginInput(req) → prompt element shows the cursor line's HTML, textarea focused
      Enter → engine.reply(line, 1)   Ctrl+D → reply('', 2) → EOFError   Ctrl+C → reply('', 3) → KeyboardInterrupt
```

If neither mechanism is available (old browsers on a non-isolated page), `input()` raises a clear error suggesting `await pyterm.ainput()`, which is promise-based and works everywhere.

## Stopping code

1. **Stop** (or Ctrl+C while running) → `interrupt()`.
2. If Python is waiting for input, the request is answered with status 3 (`KeyboardInterrupt`).
3. Otherwise `engine.sendInterrupt()`:
   - with shared memory, writes `2` (SIGINT) into Pyodide's interrupt buffer, so even a busy `while True:` loop raises `KeyboardInterrupt`;
   - always posts `{type:'interrupt'}`, which cancels every pending asyncio task (stops `await asyncio.sleep()`, `time.sleep()`, network waits).
4. If Python is still busy 2.5 s later (a CPU loop without shared memory), `hardRestart()` terminates the worker and starts a fresh one. Variables are lost; `~/browser` is kept (it is synced after every request and while waiting for input).

## The input line inside the terminal

The input line is a real `<textarea>` (native editing, selection, IME, mobile keyboards):

- `term.attachInput(inputRow)` moves `#input-row` into the active buffer, just before the cursor line, and hides that line.
- For the REPL, the prompt element shows `>>> ` / `... `. For `input()`, `term.currentLineHTML()` copies the cursor line up to the cursor — the program's prompt, with its colours — so typing continues right after it.
- `detachInput()` brings the hidden line back while code runs; the typed text is echoed into the terminal.

## Rendering strategy

- **Model.** Each buffer holds line objects `{ c: string[], a: Attr[], wrapped, size, dirty }`.
- **Batching.** The worker batches output; the terminal parses each chunk and schedules one `requestAnimationFrame` render.
- **Incremental DOM.** One `<div class="tl">` per line; only dirty lines are rebuilt; runs of equal attributes become one `<span>`.
- **Cursor.** While a program runs, the cell under the cursor is wrapped in `<span class="cur">`.
- **Auto-scroll.** `onRender` keeps `#screen` scrolled to the bottom.

## Terminal sizing

`fit()` measures a 50-character probe to get the cell size, then:

```
cols = floor(#output width / char width)          (minimum 20)
rows = floor(#screen inner height / line height)  (minimum 5)
```

The size goes to `term.resize()` and to the worker (`{type:'size'}`), which sets `COLUMNS` and `LINES` before the next request.

## State and persistence

| Data | Where | Lifetime |
|---|---|---|
| REPL history (max 500) | `sessionStorage['pyterm-history']` | Browser tab session |
| Program / input() history | `sessionStorage['pyterm-history:<name>']` | Browser tab session |
| Font size | `sessionStorage['pyterm-font']` | Browser tab session |
| Recent upload folders | `sessionStorage['pyterm-upload-dests']` | Browser tab session |
| Files in `/home/pyodide/browser` | IndexedDB (Emscripten IDBFS) | Until the site's browser data is cleared |
| Other files (`~/Upload`, …) | Pyodide's in-memory file system | Until reload or hard restart |
| Python variables | Worker memory | Until Restart, `exit()`, hard stop or reload |
| Packages | Worker memory | Until reload or hard restart |

PyTerm has no backend and stores nothing on any server.

## External dependencies

| Dependency | URL | Purpose |
|---|---|---|
| Pyodide 314.0.7 (CPython 3.14.2) | `cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs` | CPython on WebAssembly |
| Puter.js v2 | `js.puter.com/v2/` | Desktop integration (menu bar, file pickers, window title) |
| Tailwind CSS | `cdn.tailwindcss.com` | Utility classes for layout |
| Lucide | `cdn.jsdelivr.net/npm/lucide@latest/+esm` | Toolbar icons |
| Google Fonts | Inter, JetBrains Mono | UI and terminal fonts |
