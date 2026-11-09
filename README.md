# PyTerm — Python REPL in the Browser

<img src="icon.svg" alt="PyTerm logo" width="72" />

> A full Python 3.12 REPL in your browser — run code and .py scripts, install packages, enjoy a real color terminal.

PyTerm is a terminal-style web application that launches a full **CPython 3.12 interactive interpreter (REPL)** directly in the browser. Python runs on WebAssembly through [PyScript](https://pyscript.net) / [Pyodide](https://pyodide.org). No server, no installation and no account are needed: open the page and start typing Python.

Its output goes through a **VT100 / xterm-compatible terminal emulator** written for the project. Programs can use ANSI colours, cursor movement, `\r` carriage returns (progress bars, spinners), screen and line erasing, scroll regions, line-drawing characters, the alternate screen and more.

```
Python 3.12.x (main, ...) on WebAssembly (Pyodide via PyScript)
Type "help", "copyright", "credits" or "license" for more information.
>>> import math
>>> math.sqrt(2)
1.4142135623730951
>>> for p in range(101): print(f"\r{p}%", end="")
100%
```

---

## Features

### Python REPL
- Real CPython 3.12 (Pyodide 0.26) with the full standard library.
- Classic `>>>` / `...` prompts, multi-line blocks (`for`, `def`, `class`, `with`, …) with automatic indentation.
- Expression results echoed with `repr()`, last result stored in `_`.
- Full tracebacks for errors; syntax errors reported without running the line.
- **Top-level `await`**: `await asyncio.sleep(1)` works at the prompt.
- Install pure-Python wheels from PyPI with `micropip`.
- `exit()` / `quit()` reset the interpreter instead of closing the page.
- Built-in helpers: `clear()` / `cls()` to wipe the screen, `demo()` to show off the terminal.

### Terminal
- VT100 / VT220 / xterm escape sequence emulation (see [doc/terminal-emulator.md](doc/terminal-emulator.md)).
- `\r` returns the cursor to column 0 so following output overwrites the line.
- 16-colour, 256-colour and 24-bit truecolor SGR attributes, bold/dim/italic/underline styles (straight, double, curly, dotted, dashed), blink, inverse, hidden, strikethrough, overline.
- Cursor movement, save/restore, erase in display/line, insert/delete characters and lines, scroll regions, tab stops.
- Alternate screen buffer (`?1049h`), origin mode, auto-wrap control, insert mode, reverse video.
- DEC Special Graphics line drawing, double-width / double-height lines, OSC window titles and OSC 8 hyperlinks.
- Wide (CJK / emoji) and combining characters.
- Auto-sizing to the window; `COLUMNS` / `LINES` are exported to Python.
- 5,000-line scrollback.

### Puter desktop app
- Runs as a native Puter app with a File / Edit / Python / View / Help menu bar.
- Open and run `.py` scripts from Puter Drive, or double-click `.py` files on the desktop.
- Save the session transcript to Puter Drive; window title follows OSC titles; File → Quit.
- Ready for the Puter App Center, see [doc/puter-app-store.md](doc/puter-app-store.md).

### App
- Open & run scripts (Ctrl/Cmd+O or drag-and-drop), save transcript (Ctrl/Cmd+S).
- Command history (↑ / ↓), Tab completion, Ctrl+C to cancel input, Ctrl+L to clear.
- Toolbar: font size, escape-sequence demo, copy session as plain text, clear, keyboard shortcuts, restart Python.
- Status indicator (Starting / Ready / Running / Failed), Python version and terminal size in the status bar.
- Responsive layout for desktop and mobile.

---

## Quick start

PyTerm is a static site with no build step.

```bash
git clone <your-repo-url> pyterm
cd pyterm
python3 -m http.server 8000
# open http://localhost:8000
```

> The page must be served over HTTP(S). Opening `index.html` directly via `file://` will not work, because the browser blocks ES modules and the fetch of `repl.py`.

The first load downloads the Python runtime (about 10 MB, then cached by the browser), which can take a few seconds.

---

## Project structure

```
.
├── index.html        # Page layout, styles, PyScript bootstrap, shortcuts dialog
├── app.js            # UI controller: input line, history, completion, toolbar, sizing
├── terminal.js       # VT100/xterm terminal emulator (parser, screen buffers, renderer)
├── repl.py           # Python side: interactive console, output bridge, demo()
├── icon.svg          # Application icon (Python logo)
├── puter-app.json    # Puter App Center listing metadata
├── assets/           # icon-512.png (store icon), preview.png / preview.svg (social image)
├── README.md         # This file
└── doc/              # Full documentation
```

---

## Documentation

| Document | Contents |
|---|---|
| [doc/README.md](doc/README.md) | Documentation index |
| [doc/user-guide.md](doc/user-guide.md) | Using the REPL: prompts, shortcuts, toolbar, packages, examples |
| [doc/architecture.md](doc/architecture.md) | How the pieces fit together, boot sequence, data flow |
| [doc/terminal-emulator.md](doc/terminal-emulator.md) | Complete escape sequence reference for the emulator |
| [doc/python-bridge.md](doc/python-bridge.md) | The JavaScript ↔ Python interface and `repl.py` internals |
| [doc/puter-app-store.md](doc/puter-app-store.md) | Puter desktop integration and App Center publishing |
| [doc/customization.md](doc/customization.md) | Changing colours, prompts, fonts, limits, preloaded packages |
| [doc/development.md](doc/development.md) | Running locally, deploying, manual test checklist |
| [doc/troubleshooting.md](doc/troubleshooting.md) | Known limitations, common problems and FAQ |

---

## Tech stack

- [PyScript 2024.11.1](https://pyscript.net) (bundling Pyodide 0.26.4 / Python 3.12)
- Vanilla JavaScript ES modules (no framework, no bundler)
- [Puter.js](https://developer.puter.com) for desktop integration (menu bar, Drive file pickers, file associations)
- [Tailwind CSS](https://tailwindcss.com) (Play CDN) for layout
- [Lucide](https://lucide.dev) icons
- Inter and JetBrains Mono fonts (Google Fonts)

## Browser support

Recent versions of Chrome, Edge, Firefox and Safari (desktop and mobile). WebAssembly and ES modules are required.

## License

Add your license of choice here (for example MIT).
