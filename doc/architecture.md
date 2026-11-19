# Architecture

PyTerm is a static, client-side application. There is no build step, no server-side code and no framework. Python runs in a **module Web Worker**; the page only draws the terminal and handles the keyboard.

- [Overview](#overview)
- [Files and responsibilities](#files-and-responsibilities)
- [Boot sequence](#boot-sequence)
- [Input → execution → output](#input--execution--output)
- [input() and other reads from stdin](#input-and-other-reads-from-stdin)
- [Stopping code](#stopping-code)
- [Back-pressure: Python waits for the screen](#back-pressure-python-waits-for-the-screen)
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
│     │           completion, toolbar, Programs menu, drag & drop,             │
│     │           autoplay / onexit, requests from Python, sign-in dialog)     │
│     ├── terminal.js ── Terminal: parser → screen buffers → DOM renderer      │
│     ├── upload.js ──── Upload dialog                                         │
│     ├── sso.js ─────── Google Identity Services + Microsoft MSAL tokens      │
│     └── engine.js ──── PythonEngine ──┐                                      │
│                         postMessage    │  (+ SharedArrayBuffer when          │
│                                        │     the page is cross-origin        │
│ Web Worker                             ▼     isolated)                       │
│   py-worker.js ── loadPyodide(), stdout/stderr batching, stdin, interrupt,   │
│     │             IDBFS mount for ~/browser, request queue                   │
│     ├── pyterm_host (JS module registered in Python)                         │
│     ├── repl.py ── SafeConsole, input()/stdin, scripts, uploads, demo()      │
│     └── ~/.pyterm/pyterm/ (from pylib/pyterm/) ── the pyterm package:        │
│           console, packages, programs, sso, _bridge (requests to the page)   │
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
- Stop / restart, scripts and programs (`runFile`), the Programs menu, `?program=` links and `autoplay`, the `onexit: "stop"` state (everything locked except Restart), drag & drop, Open/Save/download, Puter menu bar, status and sizing.
- Requests from Python (`rpcHandlers`: `programs.*`, and `sso.*` from `sso.js`), the sign-in dialog and renewal notices.

### `sso.js`: sign-in
`createSSO({ui})` returns the `sso.*` request handlers: Google Identity Services token client and Microsoft MSAL (`PublicClientApplication`, silent refresh, pop-up). It reads `sso.json` and asks `app.js` (the `ui` object) to show the dialog whose click opens the provider's pop-up. See [Sign-in](sso.md).

### `auth/redirect.html`
The page the Microsoft sign-in pop-up returns to; MSAL reads the result from it and closes it.

### `engine.js`: `PythonEngine`
- Starts (and restarts) the worker; creates the shared interrupt and stdin buffers when `crossOriginIsolated` is true.
- `call(type, payload)` → Promise, matched by request id.
- `reply(text, status)` answers an `input()` request, `rpcReply(req, value, blobs, error)` answers a request from Python, `sendInterrupt()`, `resize()`, `flushFs()`.
- `drawn()` tells the worker that the output received so far is on screen (called by `app.js` after every terminal render; see [Back-pressure](#back-pressure-python-waits-for-the-screen)).

### `py-worker.js`: the worker
- Loads Pyodide 314.0.7 with `HOME=/home/pyodide`, `TERM`, `COLORTERM`.
- Batches stdout/stderr into `out` messages (at most one every ~12 ms, or 64 KB), each with a sequence number `seq`.
- Keeps track of the last `seq` the page has drawn; `time.sleep()` and `asyncio.sleep()` wait for it (back-pressure, at most `DRAIN_MAX` = 1000 ms).
- Mounts `/home/pyodide/browser` on IDBFS and syncs it.
- Registers the `pyterm_host` module, installs the `pyterm` package (`pylib/pyterm/*.py` → `~/.pyterm/pyterm/`), runs `repl.py` and keeps references to its functions.
- Forwards `rpc` requests from Python to the page and resolves them with `rpc_result`; Stop cancels pending ones.
- Runs requests one at a time (promise chain); `input_reply`, `interrupt`, `size` and `flush_fs` are handled immediately, even while code runs.

### `repl.py`: Python side
- `SafeConsole` (a `pyodide.console.PyodideConsole`) runs REPL lines with top-level await.
- Replaces `input`, `sys.stdin`, `getpass.getpass`, `time.sleep` and `asyncio.sleep` with worker-aware versions.
- Runs staged scripts and programs, implements `run()`, uploads, archive extraction, `tree()` and downloads.

### `pylib/pyterm/`: the `pyterm` package

| Module | Contents |
|---|---|
| `console.py` | Helpers for user programs (`input` with completions/password/history, `ainput`, `confirm`, `choose`, `table`, `style`, `download`, `App`, `run`) |
| `packages.py` | `ainstall` / `require` (micropip with progress) |
| `programs.py` | `list`, `find`, `prepare` for the programs of `programs/index.json` |
| `sso.py` | Google / Microsoft sign-in and tokens |
| `_bridge.py` | `acall(name, args)`: requests to the page |
| `__init__.py` | Re-exports `console` (and `ainstall`/`require`) so `pyterm.input(...)` keeps working |

See [Custom Programs](custom-programs.md#the-pyterm-package) and [Sign-in](sso.md).

### `upload.js`: Upload dialog
File, folder and Puter Drive pickers, drop zone with folder traversal, archive detection by magic bytes, destination and conflict policy, progress, summary in the terminal.

### `terminal.js`: terminal emulator
State-machine parser, normal and alternate buffers, scroll region, tab stops, modes, character sets, interned attributes, incremental DOM renderer. See the [Terminal Emulator Reference](terminal-emulator.md).

## Boot sequence

```
index.html parsed
 └─ app.js module
      ├─ new Terminal(#output), ResizeObserver + fit()
      ├─ new PythonEngine(handlers), Programs menu loaded from the programs list
      │    (?programs= → tab choice → PYTERM_CONFIG → <meta name="pyterm-programs"> → programs/index.json;
      │     falls back to the next one if it can't be loaded)
      └─ engine.start()
           └─ new Worker('py-worker.js', {type:'module'})  ── postMessage {init, cols, rows, [SABs]}
                ├─ status "Downloading the Python runtime…"  → loader text
                ├─ loadPyodide(), setStdout/setStderr, setInterruptBuffer (if shared)
                ├─ status "Opening your browser folder…": mount IDBFS, syncfs(populate)
                ├─ status "Loading the standard library…"
                ├─ registerJsModule('pyterm_host'), write ~/.pyterm/pyterm/*.py
                ├─ runPython(repl.py)
                └─ postMessage {ready, version, persist, shared, interrupt, jspi}
                     └─ app.js (after programs/index.json is loaded): remove loader, status Ready;
                        ?program=… or the first "autoplay": true program → start it
                        (banner postponed until it returns), otherwise banner + prompt;
                        run queued actions
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

## Back-pressure: Python waits for the screen

A program that prints a full screen and then sleeps a little (an animation) can produce frames faster than a slow page can draw them. Without a brake the frames pile up in the page's message queue, the animation lags further and further behind, and Stop seems slow because the old frames are still being drawn.

```
worker                                        page
──────                                        ────
out {text, kind, seq: 41}   ───────────────►  term.write()  → render on the next animation frame
out {text, kind, seq: 42}   ───────────────►  term.write()
time.sleep(0.05)                               …
  └─ waits until drawnSeq ≥ 42 (max 1000 ms)  onRender → engine.drawn()
                            ◄───────────────  drawn {seq: 42}   (+ Atomics.store/notify on isolated pages)
  └─ then sleeps what is left of the 50 ms
```

- The time spent waiting for the page **counts as part of the sleep**: a program that sleeps 50 ms between frames still runs at the same speed when the page keeps up, and simply slows down to the page's speed when it can't.
- `time.sleep()` under JSPI (`host.sleep`) and `asyncio.sleep()` (`host.drain`) wait through messages; the shared-memory fallback of `time.sleep()` waits with `Atomics.wait` on a 4-byte shared cell (`host.wait_drawn`).
- The wait never exceeds `DRAIN_MAX` (1000 ms, in `py-worker.js`).
- **Stop** releases every wait at once, so it is never delayed.
- A **hidden tab** does not paint: `engine.js` reports output as drawn as soon as it arrives while `document.hidden` is true, and `app.js` reports everything when the tab is hidden, so programs in background tabs are not slowed down by the brake.
- Code that never sleeps (a plain `for` loop with `print`) is not slowed down; its output is batched as before.

## The input line inside the terminal

The input line is a real `<textarea>` (native editing, selection, IME, mobile keyboards):

- `term.attachInput(inputRow)` moves `#input-row` into the active buffer, just before the cursor line, and hides that line.
- For the REPL, the prompt element shows `>>> ` / `... `. For `input()`, `term.currentLineHTML()` copies the cursor line up to the cursor — the program's prompt, with its colours — so typing continues right after it.
- `detachInput()` brings the hidden line back while code runs; the typed text is echoed into the terminal.

## Rendering strategy

- **Model.** Each buffer holds line objects `{ c: string[], a: Attr[], wrapped, size, dirty }`.
- **Batching.** The worker batches output; the terminal parses each chunk and schedules one `requestAnimationFrame` render. However many chunks arrive between two frames, only the final state is drawn.
- **Fast parser paths.** `write()` scans the text by index: runs of ordinary printable characters (width 1, no control codes, normal character set) are stored in one tight loop (`_printRun`), and the digits of a CSI sequence (`38;2;0;255;70`) are copied in one slice. Everything else goes through the full state machine (`_feed`). SGR results are cached per *(current attributes, parameters)*, so the repeated colour codes of an animation cost one lookup.
- **Incremental DOM.** One `<div class="tl">` per line; only dirty lines are rebuilt. Neighbouring cells whose attributes *look* the same (same CSS, class and link) become one `<span>`, even when the attributes differ in ways that are not visible.
- **Skipping unchanged lines.** The markup of each on-screen line is remembered; when a program repaints the whole screen, lines whose markup is identical to what is shown are not touched. Lines without any markup are set with `textContent` instead of `innerHTML`. Scrolled-off lines forget their markup, so long sessions stay light.
- **Containment.** `.tl { contain: content }` lets the browser lay out a changed line without re-checking the others.
- **Cursor.** While a program runs, the cell under the cursor is wrapped in `<span class="cur">`.
- **Auto-scroll and acknowledgement.** `onRender` keeps `#screen` scrolled to the bottom and calls `engine.drawn()` ([back-pressure](#back-pressure-python-waits-for-the-screen)).

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
| Google access token | Page memory | Until expiry, `sso.logout()` or reload |
| Microsoft accounts and tokens | `sessionStorage` (MSAL cache) | Browser tab session |
| Packages | Worker memory | Until reload or hard restart |

PyTerm has no backend and stores nothing on any server.

## External dependencies

| Dependency | URL | Purpose |
|---|---|---|
| Pyodide 314.0.7 (CPython 3.14.2) | `cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs` | CPython on WebAssembly |
| Puter.js v2 | `js.puter.com/v2/` | Desktop integration (menu bar, file pickers, window title) |
| Tailwind CSS | `cdn.tailwindcss.com` | Utility classes for layout |
| Lucide | `cdn.jsdelivr.net/npm/lucide@latest/+esm` | Toolbar icons |
| Google Identity Services | `accounts.google.com/gsi/client` | Google sign-in (loaded on first use) |
| MSAL Browser 4.30 | `cdn.jsdelivr.net/npm/@azure/msal-browser@4.30.0/+esm` | Microsoft sign-in (loaded on first use) |
| Google Fonts | Inter, JetBrains Mono | UI and terminal fonts |
