# Custom Programs

PyTerm can run **interactive terminal programs**: anything that reads what you type with `input()`, `sys.stdin` or `cmd.Cmd` and prints back. Python runs in a background worker, so `input()` really pauses the program until you press Enter — just like in a real terminal.

- [Three ways to write a program](#three-ways-to-write-a-program)
- [Running a program](#running-a-program)
- [The pyterm module](#the-pyterm-module)
- [pyterm.App reference](#pytermapp-reference)
- [Keys inside a program](#keys-inside-a-program)
- [Saving data between visits](#saving-data-between-visits)
- [Adding a program to the Programs menu](#adding-a-program-to-the-programs-menu)
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
| **Programs** menu → a program | Runs one of the bundled examples |
| **Programs** → *Run a .py file as a program…* | Pick a file from your computer |
| `run("folder/app.py", "arg1", "arg2")` at the `>>>` prompt | Runs a file already in Python's file system (for example one you uploaded); `sys.argv` gets the arguments |
| `https://<site>/?program=calc` | Opens PyTerm and starts that program straight away |
| Puter menu bar → **Programs** | Same as the toolbar menu |

Programs run in a **fresh namespace** (`__name__ == "__main__"`), so they don't see or change your REPL variables. Scripts opened with **Open** or drag & drop run in the REPL namespace instead (like `python -i`). The status pill shows `Running · <program>` or `Waiting for input · <program>`.

When the program ends (it returns, calls `sys.exit()`, the user types `exit` or presses Ctrl+D), PyTerm prints `■ <program> ended` and the `>>>` prompt comes back.

## The pyterm module

`import pyterm` works in the REPL, in scripts and in programs.

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
| `uses` | Names of the libraries the program needs. Leave it out to get **all** libraries; use `[]` for none |
| `requires` | Packages to install with micropip before the program starts, e.g. `["pyfiglet", "rich==13.7.1"]` |

### What happens when a program starts

1. PyTerm downloads the program and its libraries and copies them into **`/home/pyodide/programs`**, keeping the same layout as on the site (`~/programs/screensaver.py`, `~/programs/termgfx/screen.py`, `~/programs/mytools.zip`).
2. While the program runs, `sys.path` starts with the program's folder, `~/programs` and every ZIP library, and `PYTHONPATH` is set to the same list. So `import termgfx`, `from savers.cube import RotatingCube` or `import mytools` just work, and libraries can import each other (the `savers` scenes import `termgfx`).
3. `__file__` is the real path (`/home/pyodide/programs/screensaver.py`), so a program can open data files next to itself.
4. Pyodide packages imported by the program **or by its libraries** (numpy, …) are loaded first.
5. Packages listed in `requires` (the libraries' first, then the program's) are installed with micropip, with progress shown in the terminal.
6. When the program ends, `sys.path` and `PYTHONPATH` are restored and the library modules are removed from `sys.modules`. Edit a library, reload the page or just launch the program again, and the new version is used.

Files are fetched fresh each time a program starts (`cache: no-cache`), so updated libraries on the published site are picked up.

### From the prompt

`run("programs/screensaver.py", "--seconds", "5", "cube")` also puts `~/programs` and its ZIPs on the path, so you can run programs (and test libraries) by hand after launching one from the menu, or after uploading your own into `~/programs`.

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

For programs run with **Open**, drag & drop or `run(...)` (which don't read `index.json`), or to install something only when needed, use the same installer from Python:

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
- Animations: draw a frame, then `time.sleep()` a little. The sleep lets output reach the screen and lets Stop work instantly.
