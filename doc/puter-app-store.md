# Running on Puter & Publishing to the App Center

PyTerm works both as a normal website and as a **Puter desktop app**. This guide covers the Puter integration and the steps to list PyTerm in the Puter App Center.

- [Puter integration](#puter-integration)
- [Store listing kit](#store-listing-kit)
- [Publishing steps](#publishing-steps)
- [File associations](#file-associations)
- [Release checklist](#release-checklist)

---

## Puter integration

`index.html` loads Puter.js (`https://js.puter.com/v2/`). `app.js` checks `puter.env`:

| `puter.env` | Where it runs | Behaviour |
|---|---|---|
| `app` | Inside a Puter desktop window (`puter.com/app/<name>`) | Native menu bar, window title, Puter Drive file pickers, opening files by double-click, Quit |
| `web` | Any normal browser tab | Same REPL; Open/Save use the browser's own file dialog and download |

The status bar shows **Puter app** or **Web**.

### Features available inside Puter

| Feature | Puter API | Notes |
|---|---|---|
| Menu bar: File / Edit / Python / View / Help | `puter.ui.setMenubar()` | Open Script, Save Transcript, Quit, Copy Session, Clear Screen, Restart Interpreter, Run Demo, Larger/Smaller Text, Keyboard Shortcuts, Python Documentation |
| Window title follows OSC 0/2 titles | `puter.ui.setWindowTitle()` | `print("\x1b]2;My tool\x07")` → window title "PyTerm — My tool" |
| Open & run `.py` from Puter Drive | `puter.ui.showOpenFilePicker()` | Toolbar **Open**, File → Open Script, or Ctrl/Cmd+O |
| Save the session transcript to Puter Drive | `puter.ui.showSaveFilePicker()` | Toolbar **Save**, File → Save Transcript, or Ctrl/Cmd+S |
| Double-click a `.py` file / "Open With → PyTerm" | `puter.ui.onLaunchedWithItems()`, `puter.ui.onItemsOpened()` | Each file is run in the REPL (needs a [file association](#file-associations)) |
| Quit | `puter.exit()` | File → Quit |

PyTerm doesn't need sign-in or any user data. It never calls `puter.kv` or `puter.fs` directly; files are touched only through pickers the user opens.

### Running scripts

Scripts run like `python -i script.py`:

- The code runs in the REPL namespace, so its variables, functions and imports stay available at the prompt afterwards.
- `__file__` and `sys.argv[0]` are set to the file name.
- Top-level `await` is allowed in scripts too.
- Output, escape sequences and tracebacks behave like code typed at the prompt.
- Outside Puter, you can also **drag and drop** a `.py` file onto the window.

---

## Store listing kit

Copy these values into the app's settings in the Puter Developer Center.

| Field | Value |
|---|---|
| **Name** (unique id) | `pyterm` (or another free name, e.g. `pyterm-repl`) |
| **Title** | PyTerm — Python REPL |
| **Category** | Developer Tools |
| **Icon** | `assets/icon-512.png` (512×512, standard Python logo) or `icon.svg` |
| **Social / preview image** | `assets/preview.png` (1200×630) |
| **Index URL** | Your published site, e.g. `https://<your-site>.puter.site/` |
| **Maximize on start** | Off (suggested window size 960×640) |
| **Background app** | Off |
| **File associations** | `.py`, `.pyw` |

### Short description (store card, ≤ 140 chars)

> A full Python 3.12 REPL in your browser — run code and .py scripts, install packages, enjoy a real color terminal.

### Long description

> **PyTerm** brings the real Python 3.12 interpreter to Puter, running entirely in your browser with WebAssembly. Nothing to install, no server.
>
> • Classic `>>>` REPL with multi-line blocks, auto-indent, history and Tab completion
> • Top-level `await` and `micropip` to install packages like numpy, pandas or rich
> • Open `.py` files from your Puter Drive, or double-click them to run
> • A VT100/xterm terminal: ANSI colors (16, 256, truecolor), `\r` progress bars, cursor control, line drawing, the alternate screen and clickable links
> • Save your session transcript to Drive, copy it, adjust the font size, and restart Python at any time
>
> Great for learning Python, quick calculations, testing snippets and teaching.

### Tags

`python`, `repl`, `terminal`, `console`, `pyscript`, `pyodide`, `developer-tools`, `education`, `programming`

---

## Publishing steps

1. **Publish the site.** Use the **Publish** button in Builder (or `puter.hosting.create()` / the Puter CLI) to host the project folder. Note the URL, e.g. `https://charming-camel-7180.puter.site/`.
2. **Create the app.** Open the Puter **Dev Center** (`https://puter.com/app/dev-center`) → **Create New App**. Enter the name and title from the kit above and set the **Index URL** to the published site.
   You can also do this from code:
   ```js
   await puter.apps.create({
     name: 'pyterm',
     indexURL: 'https://<your-site>.puter.site/',
     title: 'PyTerm — Python REPL',
     description: 'A full Python 3.12 REPL in your browser — run code and .py scripts, install packages, enjoy a real color terminal.',
     icon: 'https://<your-site>.puter.site/assets/icon-512.png',
     maximizeOnStart: false,
     filetypeAssociations: ['.py', '.pyw'],
   });
   ```
3. **Upload the icon** (`assets/icon-512.png`) and fill in the description, category, tags and screenshots (`assets/preview.png` plus your own screenshots of the running app).
4. **Set the file associations** to `.py` and `.pyw`.
5. **Test it on the desktop.** Open `https://puter.com/app/pyterm`. Check the menu bar, Open/Save, and double-clicking a `.py` file on the Puter desktop.
6. **List it in the App Center.** In the Dev Center, turn on the option to list the app publicly and submit it. Puter reviews apps before they appear in the App Center.
7. **Updates.** Republish the site. The app keeps pointing at the same Index URL, so users get the new version on their next launch.

---

## File associations

With `.py` associated:

- Double-clicking a Python file on the Puter desktop opens PyTerm and runs it.
- Right-clicking a file → **Open With → PyTerm** runs it.
- A link like `https://puter.com/app/pyterm?file=~/Desktop/hello.py` launches PyTerm with that file (Puter asks the user for permission first).

Folders are ignored. If several files are opened at once, they run one after another.

---

## Release checklist

- [ ] Site published and reachable at its `.puter.site` URL
- [ ] `icon.svg` / `assets/icon-512.png` show the Python logo
- [ ] Short and long descriptions entered
- [ ] Inside `puter.com/app/<name>`: the status bar says **Puter app** and the menu bar appears
- [ ] File → Open Script runs a `.py` file from Drive
- [ ] File → Save Transcript writes a `.txt` file to Drive
- [ ] Double-clicking a `.py` file runs it
- [ ] `print("\x1b]2;Hello\x07")` changes the window title
- [ ] File → Quit closes the window
- [ ] As a plain website, Open uses the browser file dialog, Save downloads a file, and drag-and-drop works
