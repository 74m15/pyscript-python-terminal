# Development & Deployment

- [Requirements](#requirements)
- [Running locally](#running-locally)
- [Project layout](#project-layout)
- [Code conventions](#code-conventions)
- [Debugging tips](#debugging-tips)
- [Manual test checklist](#manual-test-checklist)
- [Deploying](#deploying)
- [Optional: cross-origin isolation](#optional-cross-origin-isolation)

---

## Requirements

- Any static HTTP server (Python, Node, nginx, …).
- A recent browser with WebAssembly, ES modules and module Web Workers.
- Internet access at runtime (Pyodide, Tailwind, Lucide and fonts load from CDNs).

No package manager, compiler or bundler is needed.

## Running locally

```bash
# Python
python3 -m http.server 8000

# or Node
npx serve .
```

Open `http://localhost:8000`. Pages opened with `file://` don't work, because module workers and the fetch of `repl.py` need HTTP.

After editing a file, reload the page. If an old version keeps loading, do a hard reload (Ctrl/Cmd + Shift + R) or disable the cache in DevTools.

## Project layout

| File | Language | Role |
|---|---|---|
| `index.html` | HTML/CSS | Layout, styles, dialogs |
| `app.js` | JS (ES module) | UI controller |
| `engine.js` | JS (ES module) | Page side of the worker protocol |
| `py-worker.js` | JS (module worker) | Loads Pyodide, output, stdin, interrupts, `~/browser` |
| `upload.js` | JS (ES module) | Upload dialog |
| `terminal.js` | JS (ES module) | Terminal emulator |
| `repl.py` | Python 3.14 | Console, stdin, scripts, uploads, archives |
| `pyterm_lib.py` | Python 3.14 | The `pyterm` module for programs |
| `programs/` | Python + JSON | Programs menu |
| `icon.svg` | SVG | App icon |
| `doc/` | Markdown | Documentation |

See [Architecture](architecture.md) for how the pieces fit together.

## Code conventions

- **No build step.** Keep files loadable directly by the browser. Import ES modules by relative path (`./terminal.js`).
- **Worker protocol.** Every request with an `id` gets exactly one `result`. Add new request types to `handle()` in `py-worker.js` and document them in [Python Bridge](python-bridge.md). Anything that must work while Python runs (like `interrupt`) goes in `self.onmessage` instead of the queue.
- **Python → page.** Only through the `pyterm_host` module; flush output (`host.flush()`) before messages that must arrive after it.
- **Terminal emulator.**
  - Parser states: `GROUND`, `ESC`, `ESC_INT`, `CSI`, `OSC`, `STR`.
  - Add new CSI finals in `_csiDispatch`, DEC private modes in `_decMode`, SGR codes in `_sgr`, ESC finals in `_esc`.
  - Mark a line `dirty = true` whenever its cells change, or it won't be redrawn.
  - Create attributes only with `makeAttr()`, which interns them; never mutate an attribute object.
  - Rows passed to helpers like `_setRow` are relative to the screen; `buf.y` is an absolute line index.
- **Python.** Keep user-facing helpers in the namespace built by `make_console()`, program helpers in `pyterm_lib.py`, and worker-called functions at module level in `repl.py`. Never let `SystemExit` or `KeyboardInterrupt` escape a task (see `SafeConsole`).
- **UI.** Tailwind utility classes for layout; custom CSS in `index.html` only for terminal rendering. Lucide for icons.

## Debugging tips

- **Inspect the emulator** from the DevTools console:

  ```js
  // app.js is a module, so expose the terminal temporarily:
  //   window.term = term;    (add this line in app.js)
  term.buf.lines.slice(-5).map(l => l.c.join(''))
  term.write('\x1b[31mtest\x1b[0m\r\n')
  ```

- **Trace escape sequences** from Python by printing their `repr` instead of the raw text:

  ```python
  >>> s = "\x1b[1;31mhi\x1b[0m"
  >>> print(repr(s))
  ```

- **Python errors during boot** are sent as a `fatal` message: the status pill shows **Failed** and the loader line shows the error.
- **Worker console**: in Chrome DevTools pick the `pyterm-python` worker in the console's context menu to inspect it.
- **Trace the protocol**: temporarily add `console.log(m)` at the top of `_onMessage` in `engine.js`.

## Manual test checklist

Run through this after making changes:

**REPL**
- [ ] Page loads; status goes Starting → Ready; banner and `>>>` prompt appear.
- [ ] `2 + 40` prints `42` in blue; `_` is `42`.
- [ ] `for i in range(3):` → `...` prompt with indentation; empty line runs it.
- [ ] `1/0` prints a red `ZeroDivisionError` traceback.
- [ ] `def f(:` reports a `SyntaxError` without running.
- [ ] `await asyncio.sleep(1)` (after `import asyncio`) works.
- [ ] `exit()` prints *Interpreter restarted.*, with no console errors.
- [ ] Tab completes `import colle` → `import collections`.
- [ ] ↑ / ↓ cycle through history; Ctrl+C cancels the input; Ctrl+L clears.
- [ ] Pasting a multi-line block runs every line.

**Input, Stop, programs**
- [ ] `x = input("Name? ")` shows `Name? ` and the cursor on the same line; typing `Ada` + Enter sets `x`.
- [ ] Ctrl+D in `input()` raises `EOFError`; Ctrl+C raises `KeyboardInterrupt`.
- [ ] `import time; time.sleep(30)` → Stop prints `KeyboardInterrupt` quickly, variables kept.
- [ ] `while True: pass` → Stop restarts Python after about 2.5 s (instantly with shared memory).
- [ ] Programs → Calculator: `2*(3+4)` prints `= 14`; `exit` returns to `>>>`.
- [ ] Programs → To-do list: `add milk`, reload, tasks still there.
- [ ] `?program=guess` starts the game on load.

**Files**
- [ ] Upload two files to `TestUp`: tree printed, `os.listdir("TestUp")` lists them.
- [ ] Upload the same file again with *Keep both*: `name (1).ext` is created.
- [ ] Upload a ZIP with folders: it is extracted; with *Into a folder…* it goes in its own folder.
- [ ] Drop a folder: structure is kept.
- [ ] Write `browser/x.txt`, reload: it is still there.
- [ ] `download("browser")` downloads `browser.zip`.

**Terminal**
- [ ] `print("hello world\rHELLO")` → `HELLO world`.
- [ ] `print("abcdef\x1b[3D\x1b[K!")` → `abc!`.
- [ ] `print("\x1b[31mred\x1b[0m")` is red; later output is not.
- [ ] `print("\x1b(0lqk\nmqj\x1b(B")` draws a small box.
- [ ] `await demo()` (or the Demo button) runs smoothly: progress bar and spinner update in place.
- [ ] `print("\x1b[?1049h\x1b[2JALT", end="")` switches screens; `print("\x1b[?1049l")` brings the scrollback back.
- [ ] Wide characters `print("日本語|")` line up; emoji take two cells.
- [ ] Resizing the window or changing the font updates the size in the status bar and `shutil.get_terminal_size()`.

**Toolbar**
- [ ] Font buttons change the size within 10–24 px.
- [ ] Copy puts plain text (no escape codes) on the clipboard.
- [ ] Restart clears the screen, resets colours and modes, and removes user variables.
- [ ] The shortcuts dialog opens and closes with the button, by clicking outside, and with Esc.

**Mobile**
- [ ] Layout fits at 390 px wide; toolbar labels collapse to icons; the on-screen keyboard can type into the prompt.

## Deploying

PyTerm is fully static: upload the project folder as is to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3, nginx, Puter, …).

Checklist:

- Serve over **HTTPS** (needed for the clipboard API and recommended for WebAssembly).
- Serve `.py` files as plain text (most servers do this by default). `.js` files must use a JavaScript MIME type (`text/javascript`).
- No special headers are required (see the optional isolation below).
- `py-worker.js`, `repl.py`, `pyterm_lib.py` and `programs/` must be deployed next to `index.html`.
- The `doc/` folder and `README.md` can be deployed alongside the app or left out.

For offline or air-gapped use, download the Pyodide distribution, host it yourself, and change the import URL in `py-worker.js` (and the `modulepreload` link).

## Optional: cross-origin isolation

When the page is served with

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp      (or credentialless)
```

`crossOriginIsolated` becomes true and PyTerm uses shared memory: **Stop interrupts even CPU-bound loops instantly** (no restart), and `input()` works in browsers without stack switching. The status bar then reads *Worker · shared memory*.

All third-party resources must then allow embedding (jsDelivr does; others may need `crossorigin` attributes). Puter's static hosting doesn't set these headers, so on `*.puter.site` PyTerm runs without shared memory, which is fully supported.
