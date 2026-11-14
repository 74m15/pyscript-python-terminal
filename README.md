# PyTerm — Python REPL in the Browser

<img src="icon.svg" alt="PyTerm logo" width="72" />

> A full Python 3.14 REPL in your browser — run code, scripts and interactive terminal programs, upload files, install packages, enjoy a real color terminal.

PyTerm is a terminal-style web application that runs a full **CPython 3.14 interactive interpreter (REPL)** in the browser. Python runs on WebAssembly through [Pyodide](https://pyodide.org) inside a **background worker**, so the page stays responsive, long-running code can be **stopped**, and `input()` really waits for you to type. No server, no installation and no account are needed.

Its output goes through a **VT100 / xterm-compatible terminal emulator** written for the project. Programs can use ANSI colours, cursor movement, `\r` carriage returns (progress bars, spinners), screen and line erasing, scroll regions, line-drawing characters, the alternate screen and more.

```
Python 3.14.2 (main, ...) on WebAssembly (Pyodide, background worker)
Type "help", "copyright", "credits" or "license" for more information.
>>> name = input("Your name? ")
Your name? Ada
>>> f"Hello, {name}!"
'Hello, Ada!'
>>> for p in range(101): print(f"\r{p}%", end="")
100%
```

---

## Features

### Python REPL
- Real CPython 3.14 (Pyodide 314.0.7) with the full standard library, running in a Web Worker.
- Classic `>>>` / `...` prompts, multi-line blocks with automatic indentation, results echoed with `repr()` and stored in `_`.
- **Interactive `input()`**, `sys.stdin.readline()`, `getpass.getpass()` and `cmd.Cmd` loops — Python pauses until you press Enter.
- **Stop button / Ctrl+C** interrupts running code (`KeyboardInterrupt`). If Python can't be interrupted, it is restarted automatically.
- **Top-level `await`**, `time.sleep()` that doesn't freeze the page, live output while code runs.
- Packages imported at the prompt are loaded automatically when Pyodide ships them (numpy, pandas, …); `micropip` installs pure-Python wheels from PyPI.
- Built-in helpers: `clear()`, `demo()`, `download(path)`, `run(path, *args)`.

### Terminal programs
- **Programs menu** with ready-made examples: a screen saver (bouncing ball, billiards, rotating cube, ASCII art, Matrix rain), a to-do list (`cmd.Cmd`), a calculator (`pyterm.App`), a banner maker (pyfiglet from PyPI) and a guessing game (plain `input()` loop).
- **Shared libraries**: folders or ZIP files in `programs/`, declared in `programs/index.json`, are importable by every program (installed in `~/programs` and added to `sys.path` / `PYTHONPATH` while it runs).
- **`requires`**: programs and libraries can list PyPI packages in `programs/index.json`; PyTerm installs them with micropip before launch, with progress in the terminal (`pyterm.ainstall()` / `pyterm.require()` do the same from code).
- Run any `.py` file as a program (fresh namespace, `input()`, Ctrl+D to leave), or link to one with `?program=<id>`.
- The bundled **`pyterm` module** makes command-line apps easy: commands with help, Tab completion, history, colours, tables, yes/no questions and menus. See [doc/custom-programs.md](doc/custom-programs.md).

### Files
- **Upload** dialog (Ctrl/Cmd+U or drag & drop): files, whole folders and Puter Drive files, with progress.
- **ZIP and tar(.gz/.bz2/.xz) archives are extracted** safely (no path traversal, no links), optionally into their own folder.
- Choose the destination folder and what happens on name conflicts (keep both, replace, skip).
- **`~/browser` is saved in the browser** (IndexedDB) and is still there after a reload.
- `download("file-or-folder")` sends files back to your computer or Puter Drive (folders are zipped).
- See [doc/files-and-upload.md](doc/files-and-upload.md).

### Terminal
- VT100 / VT220 / xterm escape sequence emulation (see [doc/terminal-emulator.md](doc/terminal-emulator.md)).
- 16-colour, 256-colour and 24-bit truecolor SGR attributes and every common text style.
- Cursor movement, erasing, insert/delete, scroll regions, tab stops, alternate screen, DEC line drawing, double-width/height lines, OSC titles and OSC 8 hyperlinks, wide and combining characters.
- Auto-sizing to the window; `COLUMNS` / `LINES` exported to Python; 5,000-line scrollback.

### Puter desktop app
- Native menu bar: File / Edit / Python / Programs / View / Help.
- Open and run `.py` scripts from Puter Drive, or double-click `.py` files on the desktop; upload from Drive; save transcripts and downloads to Drive.
- Ready for the Puter App Center, see [doc/puter-app-store.md](doc/puter-app-store.md).

---

## Quick start

PyTerm is a static site with no build step.

```bash
git clone <your-repo-url> pyterm
cd pyterm
python3 -m http.server 8000
# open http://localhost:8000
```

> The page must be served over HTTP(S). Opening `index.html` via `file://` does not work, because module workers and the fetch of `repl.py` need HTTP.

The first load downloads the Python runtime (about 10 MB, then cached by the browser).

---

## Project structure

```
.
├── index.html        # Page layout, styles, dialogs (shortcuts, upload)
├── app.js            # UI controller: input line, input() prompts, history, completion, toolbar, programs menu
├── engine.js         # PythonEngine: starts the worker, request/response protocol, input replies, Stop
├── py-worker.js      # Web Worker: loads Pyodide, output batching, stdin, interrupts, ~/browser persistence
├── repl.py           # Python side: interactive console, input()/stdin, scripts, uploads, archives, demo()
├── pyterm_lib.py     # The `pyterm` module available to user programs
├── upload.js         # Upload dialog: pickers, drag & drop, archive detection, progress
├── terminal.js       # VT100/xterm terminal emulator (parser, screen buffers, renderer)
├── programs/         # Programs menu: index.json, programs (screensaver, todo, calc, guess) and libraries (termgfx/, savers/)
├── icon.svg          # Application icon (Python logo)
├── puter-app.json    # Puter App Center listing metadata
├── assets/           # icon-512.png (store icon), preview.png / preview.svg (social image)
└── doc/              # Full documentation
```

---

## Documentation

| Document | Contents |
|---|---|
| [doc/README.md](doc/README.md) | Documentation index |
| [doc/user-guide.md](doc/user-guide.md) | Using the REPL: prompts, input(), Stop, shortcuts, toolbar, packages, examples |
| [doc/custom-programs.md](doc/custom-programs.md) | Writing interactive terminal programs and adding them to the Programs menu |
| [doc/files-and-upload.md](doc/files-and-upload.md) | Upload dialog, archives, conflict handling, `~/browser`, downloads |
| [doc/architecture.md](doc/architecture.md) | How the pieces fit together, boot sequence, data flow |
| [doc/python-bridge.md](doc/python-bridge.md) | The page ↔ worker protocol and `repl.py` internals |
| [doc/terminal-emulator.md](doc/terminal-emulator.md) | Complete escape sequence reference for the emulator |
| [doc/puter-app-store.md](doc/puter-app-store.md) | Puter desktop integration and App Center publishing |
| [doc/customization.md](doc/customization.md) | Colours, prompts, fonts, limits, preloaded packages, upgrading Pyodide |
| [doc/development.md](doc/development.md) | Running locally, deploying, manual test checklist |
| [doc/troubleshooting.md](doc/troubleshooting.md) | Known limitations, common problems and FAQ |

---

## Tech stack

- [Pyodide 314.0.7](https://pyodide.org) (CPython 3.14.2 on WebAssembly) in a module Web Worker
- Vanilla JavaScript ES modules (no framework, no bundler)
- [Puter.js](https://developer.puter.com) for desktop integration (menu bar, Drive file pickers, file associations)
- [Tailwind CSS](https://tailwindcss.com) (Play CDN) for layout
- [Lucide](https://lucide.dev) icons
- Inter and JetBrains Mono fonts (Google Fonts)

## Browser support

Recent Chrome, Edge, Firefox and Safari (desktop and mobile). Interactive `input()` needs either WebAssembly stack switching (JSPI: current Chrome/Edge, Firefox) or a cross-origin isolated page; otherwise `await pyterm.ainput()` works everywhere.

## License

Add your license of choice here (for example MIT).
