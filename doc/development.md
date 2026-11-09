# Development & Deployment

- [Requirements](#requirements)
- [Running locally](#running-locally)
- [Project layout](#project-layout)
- [Code conventions](#code-conventions)
- [Debugging tips](#debugging-tips)
- [Manual test checklist](#manual-test-checklist)
- [Deploying](#deploying)

---

## Requirements

- Any static HTTP server (Python, Node, nginx, …).
- A recent browser with WebAssembly and ES module support.
- Internet access at runtime (PyScript, Pyodide, Tailwind, Lucide and fonts load from CDNs).

No package manager, compiler or bundler is needed.

## Running locally

```bash
# Python
python3 -m http.server 8000

# or Node
npx serve .
```

Open `http://localhost:8000`. Pages opened with `file://` don't work, because ES modules and the fetch of `repl.py` need HTTP.

After editing a file, reload the page. If an old version keeps loading, do a hard reload (Ctrl/Cmd + Shift + R) or disable the cache in DevTools.

## Project layout

| File | Language | Approx. size | Role |
|---|---|---|---|
| `index.html` | HTML/CSS | ~170 lines | Layout, styles, script loading |
| `app.js` | JS (ES module) | ~400 lines | UI controller |
| `terminal.js` | JS (ES module) | ~800 lines | Terminal emulator |
| `repl.py` | Python 3.12 | ~180 lines | Interactive console and bridge |
| `icon.svg` | SVG | — | App icon |
| `doc/` | Markdown | — | Documentation |

See [Architecture](architecture.md) for how the pieces fit together.

## Code conventions

- **No build step.** Keep files loadable directly by the browser. Import ES modules by relative path (`./terminal.js`).
- **Bridge names.** Every function shared between JS and Python is on `window` and starts with `pyterm_`.
- **Terminal emulator.**
  - Parser states: `GROUND`, `ESC`, `ESC_INT`, `CSI`, `OSC`, `STR`.
  - Add new CSI finals in `_csiDispatch`, DEC private modes in `_decMode`, SGR codes in `_sgr`, ESC finals in `_esc`.
  - Mark a line `dirty = true` whenever its cells change, or it won't be redrawn.
  - Create attributes only with `makeAttr()`, which interns them; never mutate an attribute object.
  - Rows passed to helpers like `_setRow` are relative to the screen; `buf.y` is an absolute line index.
- **Python.** Keep user-facing helpers in the namespace built by `make_console()` and bridge functions at module level. Never let `SystemExit` escape a task (see `SafeConsole`).
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

- **Python errors during boot** appear in the browser console and set the status pill to **Failed** (via PyScript's `py:error` event).
- **Slow output**: thousands of tiny writes in a tight loop are batched per animation frame, but Python itself blocks the main thread. Use `await asyncio.sleep(0)` in long loops so the page can update.

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
- No special headers are required. PyScript's worker-based features (which need `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy`) are not used.
- The `doc/` folder and `README.md` can be deployed alongside the app or left out.

For offline or air-gapped use, download PyScript and the Pyodide distribution, host them yourself, and point the `<script>` / `<link>` tags (and PyScript's `interpreter` config) at the local copies.
