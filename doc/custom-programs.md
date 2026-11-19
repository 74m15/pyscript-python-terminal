# Custom Programs

PyTerm can run **interactive terminal programs**: anything that reads what you type with `input()`, `sys.stdin` or `cmd.Cmd` and prints back. Python runs in a background worker, so `input()` really pauses the program until you press Enter — just like in a real terminal.

- [Three ways to write a program](#three-ways-to-write-a-program)
- [Running a program](#running-a-program)
- [Starting a program automatically (`autoplay`)](#starting-a-program-automatically-autoplay)
- [What happens when a program ends (`onexit`)](#what-happens-when-a-program-ends-onexit)
- [The pyterm package](#the-pyterm-package)
- [The pyterm module](#the-pyterm-module)
- [pyterm.App reference](#pytermapp-reference)
- [Keys inside a program](#keys-inside-a-program)
- [Saving data between visits](#saving-data-between-visits)
- [Adding a program to the Programs menu](#adding-a-program-to-the-programs-menu)
- [Loading the programs list from a URL](#loading-the-programs-list-from-a-url)
- [Shared libraries](#shared-libraries)
- [Packages from PyPI (`requires`)](#packages-from-pypi-requires)
- [Tips and limits](#tips-and-limits)

---

## Three ways to write a program

### 1. A plain `input()` loop

No imports needed — this is ordinary Python ([`programs/guess.py`](../programs/guess.py)):

```python
import random

secret = random.randint(1, 100)
while True:
    try:
        text = input("Your guess: ")
    except EOFError:          # Ctrl+D
        break
    guess = int(text)
    if guess == secret:
        print("Correct!")
        break
    print("Higher" if guess < secret else "Lower")
```

### 2. `cmd.Cmd` from the standard library

`cmd.Cmd` gives you `help`, command dispatch and `do_EOF` for free ([`programs/todo.py`](../programs/todo.py)):

```python
import cmd

class Shell(cmd.Cmd):
    intro = "Welcome! Type help."
    prompt = "shell> "

    def do_hello(self, arg):
        """hello [name] — say hello"""
        print(f"Hello, {arg or 'world'}!")

    def do_exit(self, arg):
        """exit — leave"""
        return True

    do_EOF = do_exit

Shell().cmdloop()
```

### 3. `pyterm.App`

The bundled `pyterm` module turns functions into commands, with help generated from docstrings, Tab completion of command names, per-program history and shell-style argument splitting ([`programs/calc.py`](../programs/calc.py)):

```python
import pyterm

app = pyterm.App("notes", intro="Type help to see the commands.")
notes = []

@app.command
def add(*words):
    "Add a note"
    notes.append(" ".join(words))
    return f"Saved note #{len(notes)}"

@app.command(aliases=("ls",))
def list():
    "Show all notes"
    pyterm.table([(i, n) for i, n in enumerate(notes, 1)], headers=["#", "note"])

app.run()
```

```
notes> help
add [words...]   Add a note
clear            Clear the screen
exit             Leave the program
help [command]   Show the commands (help <command> for details)
list             Show all notes
notes> add "buy milk" today
Saved note #1
```

## Running a program

| How | What happens |
|---|---|
| **Programs** menu → a program | Runs one of the programs of the list in use (`programs/index.json`, or one [loaded from a URL](#loading-the-programs-list-from-a-url)) |
| `run("calc")` at the `>>>` prompt or from code | The same as the menu, by **id, title or file name** (`run("Calculator")`, `run("calc.py")`): downloads the program and its libraries into `~/programs` if missing, loads the Pyodide packages they import, installs `requires`, then runs it. Extra arguments go to `sys.argv`: `run("screensaver", "matrix")` |
| **Programs** → *Run a .py file as a program…* | Pick a file from your computer |
| `run("folder/app.py", "arg1", "arg2")` | Runs a file already in Python's file system (for example one you uploaded); `sys.argv` gets the arguments |
| `https://<site>/?program=calc` | Opens PyTerm and starts that program straight away |
| `"autoplay": true` in `index.json` | Starts the program when PyTerm opens ([below](#starting-a-program-automatically-autoplay)) |
| Puter menu bar → **Programs** | Same as the toolbar menu |

`run()` decides between a file and a program like this: an existing file, or a text containing `/` or starting with `~`, is a **file**; anything else is looked up in `programs/index.json`. Use `run("./name.py")` for a file in `/home/pyodide` that has the same name as a program. In browsers without stack switching, `run("calc")` returns an object to `await` (`await run("calc")`).

Programs run in a **fresh namespace** (`__name__ == "__main__"`), so they don't see or change your REPL variables. Scripts opened with **Open** or drag & drop run in the REPL namespace instead (like `python -i`). The status pill shows `Running · <program>` or `Waiting for input · <program>`.

When the program ends (it returns, calls `sys.exit()`, the user types `exit` or presses Ctrl+D), PyTerm prints `■ <program> ended` and the `>>>` prompt comes back — unless the program says otherwise with [`onexit`](#what-happens-when-a-program-ends-onexit).

Programs can start other programs: `run("guess")` inside a program runs the game and continues after it.

## Starting a program automatically (`autoplay`)

Add `"autoplay": true` to one program in `programs/index.json` and PyTerm starts it as soon as Python is ready, instead of showing the `>>>` prompt:

```json
{ "id": "kiosk", "file": "kiosk.py", "title": "Kiosk", "description": "…",
  "autoplay": true, "onexit": "stop" }
```

- Only the **first** program with `"autoplay": true` starts. A `?program=<id>` in the address takes precedence.
- The start-up program begins on a clean screen; the PyTerm welcome banner is shown later, if and when the program returns to the `>>>` prompt.
- With `"onexit": "stop"`, pressing **Restart** after the program ended starts it again — PyTerm behaves like a dedicated app.
- Leave `autoplay` out (or `false`) for normal programs.

## What happens when a program ends (`onexit`)

| `onexit` | When the program ends |
|---|---|
| `"continue"` (default) | `■ <program> ended`, and the `>>>` prompt comes back with the REPL ready |
| `"stop"` | Python stops: `■ <program> ended — Python has stopped.` The prompt doesn't come back and every action is disabled (Open, Upload, Save, Programs, Demo, Copy, Clear, drag & drop, keyboard shortcuts and the matching Puter menu items); only **Restart** works. Restart starts a fresh Python (and the program again if it is the `autoplay` one) |

With `"stop"`, the program "ends" in every case: it returns, calls `sys.exit()`, raises an error (the traceback is shown first), or the user presses **Stop**. It also applies when the program is started from code with `run("id")`: when it ends, Python stops instead of returning to the caller.

## The pyterm package

`import pyterm` works in the REPL, in scripts and in programs. It is a package with one sub-module per area:

| Module | Contents |
|---|---|
| `pyterm.console` | Terminal I/O: `input`/`ainput`, `confirm`, `choose`, `table`, `style`, `clear`, `title`, `download`, `App`, `run`, `StopProgram`, colour constants (described below) |
| `pyterm.packages` | `ainstall`, `require`, `installed_version` — [packages from PyPI](#packages-from-pypi-requires) |
| `pyterm.programs` | The programs of the list in use: `list()`, `find(query)`, `prepare(query, refresh=False)`, `load(url)`, `source()` (async twins `alist`, `afind`, `aprepare`, `aload`, `asource`) |
| `pyterm.sso` | Google / Microsoft sign-in and OAuth access tokens — see [Sign-in](sso.md) |

Everything in `pyterm.console`, plus `ainstall` and `require`, is also available directly on `pyterm` (`pyterm.input`, `pyterm.App`, …), so older programs keep working. Both styles are fine:

```python
import pyterm
name = pyterm.input("Name? ")

from pyterm import console, sso
console.table(rows)
tok = sso.login("google")
```

### pyterm.programs

```python
>>> from pyterm import programs
>>> [p["id"] for p in programs.list()]
['screensaver', 'todo', 'calc', 'banner', 'guess', 'signin']
>>> m = programs.prepare("banner")   # download + install pyfiglet, without running it
>>> m["path"], m["requires"], m["onexit"]
('/home/pyodide/programs/banner.py', ['pyfiglet'], 'continue')
```

`load(url)` switches to another programs list (see [Loading the programs list from a URL](#loading-the-programs-list-from-a-url)); `load(None)` goes back to the site's default. `source()` tells which list is in use: `{"url", "base", "name", "builtin", "via", "count"}`. A list that can't be loaded raises `programs.LoadError` and the current list stays in use.

`find()` returns the program's **manifest** (or `None`): `id`, `title`, `description`, `path`, `files` (every file of the program and its libraries in Python's file system), `paths` (import paths), `requires`, `onexit`, `autoplay`. `prepare()` downloads what is missing (or everything with `refresh=True`), loads Pyodide packages, installs `requires` and returns the manifest; it raises `LookupError` for an unknown program. `run("id")` is `prepare()` followed by running `path` with `paths` on `sys.path`.

## The pyterm module

The functions below live in `pyterm.console` and are re-exported by `pyterm`.

### Input

| Function | Description |
|---|---|
| `pyterm.input(prompt="", *, password=False, completions=None, history=None)` | Like `input()`, plus Tab-completion words, hidden typing for passwords, and a history name (↑/↓ recall only that program's entries) |
| `await pyterm.ainput(...)` | Same, as a coroutine. Works in every browser, even without stack switching |
| `pyterm.confirm(question, default=False)` | Yes/no question → `bool` |
| `pyterm.choose(prompt, options)` | Numbered menu → the chosen option (number or name) |
| `pyterm.StopProgram` | Raised by an input call when the user presses **Stop**. Derives from `BaseException`; catch it only to clean up, then re-raise |

`input()`, `sys.stdin.readline()` and `getpass.getpass()` all go through the same mechanism.

### Output

| Function | Description |
|---|---|
| `pyterm.style(text, fg=None, bg=None, *, bold, dim, italic, underline)` | Wrap text in ANSI codes. Colours: names (`"red"`, `"cyan"`, `"grey"`…), 0–255, `"#rrggbb"` or `(r, g, b)` |
| `pyterm.table(rows, headers=None, padding=2)` | Print aligned columns (ANSI codes don't break alignment) |
| `pyterm.clear()` | Clear the screen |
| `pyterm.title(text)` | Set the terminal / window title (`""` restores it) |
| Constants | `RED`, `GREEN`, `YELLOW`, `BLUE`, `MAGENTA`, `CYAN`, `WHITE`, `GREY`, `BOLD`, `DIM`, `RESET` |

### Files

| Name | Description |
|---|---|
| `pyterm.HOME` | `/home/pyodide` |
| `pyterm.BROWSER_DIR` | `/home/pyodide/browser` — saved in the browser |
| `pyterm.download(path, name=None)` | Send a file (or a folder, zipped) to the user's computer / Puter Drive |

### Packages

| Function | Description |
|---|---|
| `await pyterm.ainstall(*packages, label=None, quiet=False)` | Install packages with micropip, showing a progress line per package. Already-installed names are skipped. Returns `True` / `False` (the error is printed) |
| `pyterm.require(*packages, quiet=False)` | Same from ordinary (non-async) code; raises `ImportError` if a package can't be installed. Needs stack switching (JSPI) |

See [Packages from PyPI](#packages-from-pypi-requires).

### Simple loop

```python
pyterm.run(handler, *, prompt="> ", intro=None, history=None, completions=None)
```

Calls `handler(line)` for every line. Typing `exit`/`quit`, pressing Ctrl+D or returning `False` stops it. Any other non-`None` return value is printed.

```python
import pyterm
pyterm.run(lambda line: line[::-1], prompt="reverse> ", intro="I reverse text.")
```

## pyterm.App reference

```python
app = pyterm.App(name="app", *, prompt=None, intro=None, history=True, color="cyan")
```

| Member | Description |
|---|---|
| `@app.command` / `@app.command(name=..., aliases=(...), help=...)` | Register a command. The name defaults to the function name (`_` → `-`); the help text defaults to the docstring's first line |
| `@app.default` | Called with the whole line when it isn't a command (e.g. a calculator) |
| `@app.on_exit` | Called when the program ends |
| `app.run()` | Start the loop; returns when the user leaves |
| `await app.arun()` | Async version (works without stack switching) |
| `app.stop()` | Leave the loop from inside a command |
| `app.execute(line)` | Run one line as if typed |

- Arguments are split like a shell (`"two words"` stays together) and passed positionally. A wrong number of arguments prints the usage line built from the function signature.
- Commands may be `async def`; they are awaited.
- Built-in commands: `help [command]`, `clear`, `exit` (alias `quit`).
- Errors inside a command print a traceback and the program keeps running. Ctrl+C at the prompt clears the line; Ctrl+C during a command prints *Interrupted*.

## Keys inside a program

| Keys | Effect |
|---|---|
| **Enter** | Send the line |
| **↑ / ↓** | This program's history |
| **Tab** | Complete from the program's words (`completions=` or the `App` command names) |
| **Ctrl + D** on an empty line | End of input → `EOFError` (most programs exit) |
| **Ctrl + C** | `KeyboardInterrupt` in the program (it may catch it and carry on) |
| **Stop** button | Ends the program. While it waits for input this raises `pyterm.StopProgram`, which `except Exception` / `except KeyboardInterrupt` don't catch; while it computes it works like Ctrl+C, and Python is restarted if the program doesn't react |
| Paste several lines | Each line answers one `input()` in turn |

## Saving data between visits

Everything under `/home/pyodide/browser` (`pyterm.BROWSER_DIR`) is stored in the browser's IndexedDB and is still there after a reload. The to-do example keeps its tasks in `~/browser/todo.json`:

```python
import json, os, pyterm
STORE = os.path.join(pyterm.BROWSER_DIR, "myapp.json")
```

Other folders live in memory only. See [Files & Upload](files-and-upload.md).

## Adding a program to the Programs menu

1. Put the file in `programs/`, e.g. `programs/notes.py`.
2. Add an entry to `programs/index.json`:

   ```json
   {
     "id": "notes",
     "file": "notes.py",
     "title": "Notes",
     "description": "Keep quick notes in your browser."
   }
   ```

3. Reload. The program appears in the toolbar menu, in Puter's **Programs** menu bar, and can be opened with `?program=notes`.

## Loading the programs list from a URL

By default the Programs menu shows `programs/index.json` from PyTerm's own site. Another `index.json` — on any web server, GitHub Pages, a CDN… — can be used instead. Its programs and libraries are read **next to that index.json** (same relative paths as in `programs/`), or from the folder given by an optional `"base"` field.

```json
{
  "name": "Maths club",
  "base": "https://cdn.example.org/maths/v2/",
  "programs": [ { "id": "quiz", "file": "quiz.py", "title": "Quiz", "description": "…", "autoplay": true } ],
  "libraries": [ { "name": "mathlib", "files": ["__init__.py"] } ]
}
```

| Optional top-level field | Meaning |
|---|---|
| `name` | Shown in the Programs menu and in the banner (otherwise the host and path) |
| `base` | Folder the `file` / `files` / `zip` paths are relative to (absolute or relative to the index.json) |

An address ending with `/` gets `index.json` added, so `https://example.org/my-programs/` works.

### Ways to choose the list

| Where | How | Priority |
|---|---|---|
| Page address | `https://<pyterm>/?programs=https://example.org/my-programs/index.json` (combine with `&program=quiz` to start one) | 1 (highest) |
| User interface | **Programs → Load programs from URL…** (also in Puter's **Programs** menu bar). The choice is kept for the browser tab; recent addresses are offered as chips; **Default list** goes back | 2 |
| JavaScript (before PyTerm starts) | `<script>window.PYTERM_CONFIG = { programs: "https://example.org/my-programs/" };</script>` placed before `app.js` | 3 |
| HTML | `<meta name="pyterm-programs" content="https://example.org/my-programs/index.json">` in `index.html` | 4 |
| Default | `programs/index.json` next to PyTerm | 5 |

If the chosen list can't be loaded, PyTerm prints why at start-up and falls back to the next one (the site default, then the built-in list).

### At run time

**JavaScript**, in PyTerm's page (e.g. a script you add to `index.html`, or the browser console):

```js
await PyTerm.ready;                                   // Python is up
await PyTerm.loadPrograms('https://example.org/my-programs/');   // → {url, base, name, builtin, via, count}
await PyTerm.listPrograms();                          // [{id, title, description, autoplay, onexit}]
await PyTerm.launch('quiz');                          // like the Programs menu; false if it couldn't start
await PyTerm.resetPrograms();                         // back to the site's default list
PyTerm.programsUrl;                                   // the list in use
window.addEventListener('pyterm:programs', (e) => console.log(e.detail));   // fired on every change
```

**A page that embeds PyTerm in an `<iframe>`**:

```html
<iframe id="pt" src="https://charming-camel-7180.puter.site/?programs=https://example.org/my-programs/"></iframe>
<script>
  const pt = document.getElementById('pt');
  // later: switch list
  pt.contentWindow.postMessage({ type: 'pyterm:load-programs', url: 'https://example.org/other/' }, '*');
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'pyterm:programs-loaded') console.log(e.data);  // {ok, url, name, count, error}
  });
</script>
```

Only the parent page can send `pyterm:load-programs`; `url: null` restores the default list.

**Python**:

```python
>>> from pyterm import programs
>>> programs.load("https://example.org/my-programs/")
{'url': 'https://example.org/my-programs/index.json', 'name': 'Maths club', 'builtin': False, 'count': 1, ...}
>>> run("quiz")
```

### Requirements and safety

- The other site must allow cross-origin reads (**CORS**, `Access-Control-Allow-Origin: *` or PyTerm's address) for the index.json **and** the program files. GitHub Pages, jsDelivr and `raw.githubusercontent.com` do. Without it the error says *could not be reached … (CORS)*.
- Only `http://` and `https://` addresses are accepted.
- Programs run with access to everything in PyTerm (your files, `~/browser`, sign-in tokens they ask for). Load lists you trust.
- A start-up program (`autoplay` or `&program=`) from a list on **another site given in the address** (`?programs=`) does not start by itself: PyTerm asks first, with an *Always trust this site* option. Lists chosen in the UI, set in HTML / `PYTERM_CONFIG` by the site owner, or on PyTerm's own site start without asking.
- `~/programs` holds the files of one list at a time: when a program of a different list starts, the previous list's files are removed so modules with the same name can't mix.

## Shared libraries

Programs in `programs/` can `import` code from **library folders** (packages) or **ZIP files** placed in `programs/` too. A web server can't list a folder, so libraries are declared in `programs/index.json`:

```json
{
  "programs": [
    { "id": "screensaver", "file": "screensaver.py", "title": "Screen saver",
      "description": "…", "uses": ["termgfx", "savers"] }
  ],
  "libraries": [
    { "name": "termgfx", "files": ["__init__.py", "screen.py", "color.py", "math3d.py", "font.py"] },
    { "name": "savers",  "files": ["__init__.py", "bouncing.py", "billiards.py", "cube.py", "asciiart.py", "matrix.py"] },
    { "name": "mytools", "zip": "mytools.zip" }
  ]
}
```

| Library field | Meaning |
|---|---|
| `name` | Library name. With `files`, it is also the folder inside `programs/` |
| `files` | Files of the folder, relative to `programs/<name>/`. Sub-folders are fine (`"db/__init__.py"`, `"data/words.txt"`) |
| `zip` | A ZIP inside `programs/` (e.g. `"mytools.zip"`). Python imports straight from it; the packages/modules must be at the top level of the ZIP (`mytools/__init__.py` or `helper.py`) |
| `description` | Optional note |
| `requires` | Optional PyPI / Pyodide packages the library needs, installed before any program that uses it starts. See [below](#packages-from-pypi-requires) |

| Program field | Meaning |
|---|---|
| `id`, `file`, `title`, `description` | Identifier (used by `run("id")` and `?program=id`), file inside `programs/`, menu title and description |
| `uses` | Names of the libraries the program needs. Leave it out to get **all** libraries; use `[]` for none |
| `requires` | Packages to install with micropip before the program starts, e.g. `["pyfiglet", "rich==13.7.1"]` |
| `autoplay` | `true`: start this program when PyTerm opens ([details](#starting-a-program-automatically-autoplay)) |
| `onexit` | `"continue"` (default) or `"stop"` ([details](#what-happens-when-a-program-ends-onexit)) |

### What happens when a program starts

1. PyTerm downloads the program and its libraries and copies them into **`/home/pyodide/programs`**, keeping the same layout as on the site (`~/programs/screensaver.py`, `~/programs/termgfx/screen.py`, `~/programs/mytools.zip`).
2. While the program runs, `sys.path` starts with the program's folder, `~/programs` and every ZIP library, and `PYTHONPATH` is set to the same list. So `import termgfx`, `from savers.cube import RotatingCube` or `import mytools` just work, and libraries can import each other (the `savers` scenes import `termgfx`).
3. `__file__` is the real path (`/home/pyodide/programs/screensaver.py`), so a program can open data files next to itself.
4. Pyodide packages imported by the program **or by its libraries** (numpy, …) are loaded first.
5. Packages listed in `requires` (the libraries' first, then the program's) are installed with micropip, with progress shown in the terminal.
6. When the program ends, `sys.path` and `PYTHONPATH` are restored and the library modules are removed from `sys.modules`. Edit a library, reload the page or just launch the program again, and the new version is used.

Files are fetched fresh each time a program starts (`cache: no-cache`), so updated libraries on the published site are picked up.

### From the prompt

`run("screensaver", "cube")` sets everything up exactly like the menu. `run("programs/screensaver.py", "--seconds", "5", "cube")` runs the file directly and also puts `~/programs` and its ZIPs on the path, so you can test libraries by hand, or run programs you uploaded into `~/programs` yourself.

### The example: Screen saver

`programs/screensaver.py` is a small program that rotates five animations, 15 seconds each: a **bouncing ball** that changes colour, size and symbol at each bounce, a self-playing **billiards** table, a shaded **rotating cube** in a starfield, **ASCII art** (a character plasma behind a wavy rainbow banner) and **Matrix rain** (green glyph streams at three depths, with a white head, flickering characters and a hidden message that lights up as the streams pass). Ctrl+C or Stop ends it. Scene keys for `run(...)`: `ball`, `billiards`, `cube`, `ascii`, `matrix`. It is built on two libraries:

| Library | Contents |
|---|---|
| `termgfx` | `Screen` (frame buffer on the alternate screen that sends only changed cells; `put`, `text`, `fill`, `line`, `box`, `present`), colour helpers (`hsv`, `lerp_color`, `scale`), `math3d` (rotations, perspective projection), `font` (5×5 block letters) |
| `savers` | One module per scene. Each scene has `update(dt, t)`, `draw(screen)`, `title`, `fps`. `savers.SCENES` lists them |

To add a scene: write `programs/savers/myscene.py` with a class following that interface, add it to `SCENES` in `savers/__init__.py`, and add `"myscene.py"` to the `savers` files in `index.json`.

## Packages from PyPI (`requires`)

Pyodide already ships many packages (numpy, pandas, matplotlib, scipy, …): a plain `import` is enough, PyTerm loads them before the program starts. Other packages come from **PyPI** and must be installed with **micropip** before they are imported. Declare them with `requires` and PyTerm does it for you:

```json
{
  "id": "banner",
  "file": "banner.py",
  "title": "Banner maker",
  "description": "Big ASCII-art text in 500+ fonts.",
  "uses": [],
  "requires": ["pyfiglet"]
}
```

```python
import pyfiglet          # banner.py: just import it
print(pyfiglet.figlet_format("Hello"))
```

When the program is launched, the terminal shows:

```
▶ Starting banner — type exit or press Ctrl+D to come back to Python
Installing 1 package for banner with micropip…
  ⠹ ━━━━━━━━━━━━━━━━━━ 1/1  pyfiglet  0.8s      ← animated while downloading
  ✔ pyfiglet 1.0.2  1.4s
Ready in 1.4s.
```

- **Entries** can be names (`"pyfiglet"`), version specifiers (`"rich==13.7.1"`, `"tabulate>=0.9"`), Pyodide packages (`"numpy"`) or wheel URLs. A string instead of a list is accepted for a single package.
- **Libraries** can have `requires` too; their packages are installed first, for every program that uses the library.
- **Already installed** packages are skipped instantly, so only the first launch waits. Installed packages stay until the page is reloaded or Python is hard-restarted.
- **Errors**: if a package can't be installed (no internet, not on PyPI, or it has C code that wasn't built for Pyodide), the error is printed and the program is **not started**.
- **Stop** during the installation cancels it and returns to the prompt.
- Only **pure-Python** wheels (`py3-none-any`) and packages built for Pyodide can be installed. Dependencies are resolved automatically.

### Installing from code

For scripts run with **Open**, drag & drop or `run("path/file.py")` (which don't read `index.json`), or to install something only when needed, use the same installer from Python:

```python
import pyterm

await pyterm.ainstall("pyfiglet", "tabulate")   # top-level await is allowed in programs
import pyfiglet

def later():
    pyterm.require("rich")                        # from ordinary code (needs stack switching)
    import rich
```

Or call micropip directly: `import micropip; await micropip.install("pyfiglet")`.

### The example: Banner maker

`programs/banner.py` (menu: **Banner maker**) declares `"requires": ["pyfiglet"]`. Type any text to get it as big ASCII art; `font <name>`, `fonts [prefix]`, `color <name>`, `sample <text>` and `save <text>` (writes `~/browser/banner.txt` and downloads it).

## Tips and limits

- **Interactive `input()` needs** WebAssembly stack switching (JSPI: current Chrome, Edge and Firefox) or a cross-origin isolated page. Otherwise it raises an error that points to `await pyterm.ainput()` / `await app.arun()`, which work everywhere.
- **Stopping busy loops.** On normal hosting (no cross-origin isolation) Stop interrupts programs that are waiting (for input, `time.sleep`, `await`) instantly, but a pure CPU loop can only be stopped by restarting Python, which clears variables. `~/browser` is kept.
- `curses`, `prompt_toolkit`, `textual` and other full-screen frameworks that need raw key presses don't work: input is line-based.
- `time.sleep()` works and output appears while the program runs.
- Programs can't start subprocesses or real threads.
- Packages from PyPI: list them in `requires` (see above) or install them with `pyterm.ainstall()`. C-extension packages work only if Pyodide ships them.
- Animations: draw a frame, then `time.sleep()` (or `await asyncio.sleep()`) a little. The sleep lets output reach the screen and lets Stop work instantly.
- **The screen sets the pace.** Before sleeping, `time.sleep()` and `asyncio.sleep()` wait until the page has drawn what was printed (at most 1 second). The wait counts as part of the sleep, so on a fast computer an animation runs at the speed you chose, and on a slow one it slows down smoothly instead of falling behind and piling up frames. You don't need to do anything for this. To keep it working, sleep once per frame (even `time.sleep(0.01)`): a loop that never sleeps can't be held back, and its frames reach the screen in bursts.
- Send each frame in one go (build it in a string or with `termgfx.Screen`, then print and flush once), and only redraw what changed: fewer, larger writes are drawn much faster than many small ones.
