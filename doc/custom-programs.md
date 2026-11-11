# Custom Programs

PyTerm can run **interactive terminal programs**: anything that reads what you type with `input()`, `sys.stdin` or `cmd.Cmd` and prints back. Python runs in a background worker, so `input()` really pauses the program until you press Enter — just like in a real terminal.

- [Three ways to write a program](#three-ways-to-write-a-program)
- [Running a program](#running-a-program)
- [The pyterm module](#the-pyterm-module)
- [pyterm.App reference](#pytermapp-reference)
- [Keys inside a program](#keys-inside-a-program)
- [Saving data between visits](#saving-data-between-visits)
- [Adding a program to the Programs menu](#adding-a-program-to-the-programs-menu)
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

3. Reload. The program appears in the toolbar menu and can be opened with `?program=notes`.
4. Inside Puter, the menu bar's **Programs** list is defined in `setupPuterApp()` in `app.js`; add a line there too:

   ```js
   { label: 'Notes', action: () => launchProgram('notes') },
   ```

## Tips and limits

- **Interactive `input()` needs** WebAssembly stack switching (JSPI: current Chrome, Edge and Firefox) or a cross-origin isolated page. Otherwise it raises an error that points to `await pyterm.ainput()` / `await app.arun()`, which work everywhere.
- **Stopping busy loops.** On normal hosting (no cross-origin isolation) Stop interrupts programs that are waiting (for input, `time.sleep`, `await`) instantly, but a pure CPU loop can only be stopped by restarting Python, which clears variables. `~/browser` is kept.
- `curses`, `prompt_toolkit`, `textual` and other full-screen frameworks that need raw key presses don't work: input is line-based.
- `time.sleep()` works and output appears while the program runs.
- Programs can't start subprocesses or real threads.
