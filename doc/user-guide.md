# User Guide

This guide explains how to use PyTerm as an end user.

- [Starting up](#starting-up)
- [The screen](#the-screen)
- [Typing Python](#typing-python)
- [input() and interactive programs](#input-and-interactive-programs)
- [Stopping running code](#stopping-running-code)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Toolbar](#toolbar)
- [Built-in helpers](#built-in-helpers)
- [Asynchronous code](#asynchronous-code)
- [Installing packages](#installing-packages)
- [Using escape sequences](#using-escape-sequences)
- [Copying output](#copying-output)
- [Examples](#examples)

---

## Starting up

When the page opens, the status pill next to the app name reads **Starting** (pulsing amber), and the terminal shows a loading message:

1. *Downloading the Python runtime…*
2. *Opening your browser folder…*
3. *Loading the standard library…*

The first visit downloads about 10 MB. Later visits load from the browser cache and start much faster. If loading takes more than 30 seconds, the message changes to *Still loading — slow connections can take a minute…*.

When Python is ready, the status pill turns **Ready** (green) and the banner appears:

```
Python 3.14.2 (main, ...) on WebAssembly (Pyodide, background worker)
Type "help", "copyright", "credits" or "license" for more information.
Try await demo(), the Programs menu, or Upload to add files. ~/browser keeps files after a reload.
>>>
```

Python runs in a background worker, so the page stays responsive while your code runs.

## The screen

| Area | What it shows |
|---|---|
| **Header** | App name, the terminal title (changeable by programs via OSC 0/2), status pill, toolbar buttons |
| **Terminal** | Program output and the input line |
| **Status bar** | Python version, worker mode, **~/browser saved** (when the saved folder is active), terminal type, size in columns × rows, number of commands in history, Web / Puter app |

Status pill states:

| State | Meaning |
|---|---|
| Starting (amber, pulsing) | The Python runtime is loading |
| Ready (green) | Waiting for input |
| Running (blue, pulsing) | Python is executing your code; the **Stop** button appears |
| Waiting for input (violet, pulsing) | A program called `input()`; type an answer and press Enter |
| Stopping (amber) | Stop was pressed; Python is being interrupted |
| Failed (red) | Python could not start |

While a program from the Programs menu runs, its name is added: *Running · calc*.

Output colours used by the app itself:

| Colour | Used for |
|---|---|
| Yellow | Prompts (`>>>`, `...`) |
| White | Echoed input |
| Light grey | Normal program output (`print`, `sys.stdout`) |
| Blue | Expression results (`repr`) |
| Red | Errors and tracebacks (`sys.stderr`) |
| Dim grey | Informational messages |
| Green | Python version in the banner |

Programs can use any colours with ANSI escape sequences.

## Typing Python

PyTerm behaves like the standard `python` interactive prompt.

**Single statements and expressions.** Type and press **Enter**. Expressions that are not `None` have their `repr()` printed, and the value is stored in `_`:

```python
>>> 6 * 7
42
>>> _ + 1
43
```

**Multi-line blocks.** A line that opens a block (ending with `:`) switches the prompt to `...` and pre-fills the next line with the right indentation (4 spaces more after a colon). Press **Enter** on an empty `...` line to finish the block:

```python
>>> def greet(name):
...     return f"Hello, {name}!"
...
>>> greet("world")
'Hello, world!'
```

**Pasting code.** You can paste several lines at once. Each line is fed to the interpreter in turn, exactly as if typed, and echoed with its prompt. Use **Shift + Enter** to add a new line in the input box without running it.

**Errors** print a full traceback in red. Syntax errors are reported without running anything:

```python
>>> 1/0
Traceback (most recent call last):
  File "<console>", line 1, in <module>
ZeroDivisionError: division by zero
```

**Long results.** If a result's `repr()` is longer than 8,000 characters, the middle is replaced by `... [N chars hidden] ...`. Use `print()` to see the full value.

## input() and interactive programs

`input()` works like in a real terminal: the program's prompt appears, you type on the same line, and Python continues when you press **Enter**.

```python
>>> name = input("What's your name? ")
What's your name? Ada
>>> age = int(input("Age? "))
Age? 36
>>> f"{name} is {age}"
'Ada is 36'
```

- **Ctrl + D** on an empty line sends end-of-file (`EOFError`); **Ctrl + C** raises `KeyboardInterrupt` in the program.
- `sys.stdin.readline()`, `for line in sys.stdin`, `getpass.getpass()` (typing is hidden) and `cmd.Cmd` all work.
- ↑ / ↓ recall earlier answers. Each program has its own history, separate from the `>>>` history.
- Pasting several lines answers several `input()` calls in a row.

The **Programs** menu has ready-made interactive programs (a to-do list, a calculator, a guessing game) and runs any `.py` file as a program. To write your own, see [Custom Programs](custom-programs.md).

> `input()` needs a browser with WebAssembly stack switching (current Chrome, Edge, Firefox) or a cross-origin isolated page. Otherwise the banner shows a note and `await pyterm.ainput("prompt")` can be used instead.

## Stopping running code

Press **Stop** in the toolbar (it appears while code runs) or **Ctrl + C**:

- Code that is waiting — `time.sleep()`, `await asyncio.sleep()`, network requests — stops at once with `KeyboardInterrupt`; your variables are kept.
- A program waiting for `input()` is ended (Ctrl+C sends it a `KeyboardInterrupt` instead, which it may handle itself).
- A pure CPU loop (`while True: pass`) stops at once when the page is cross-origin isolated (status bar: *Worker · shared memory*). On normal hosting, PyTerm waits 2.5 seconds and then **restarts Python**: variables and loaded packages are cleared, files in `~/browser` are kept. Pressing Stop again while it says *Stopping* restarts immediately.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| **Enter** | Run the line, or continue the block |
| **Shift + Enter** | Insert a newline without running |
| **↑ / ↓** | Previous / next command from history (when the cursor is on the first / last line of the input) |
| **Tab** | Autocomplete names and attributes; inserts 4 spaces at the start of a line or after whitespace |
| **Backspace** | Inside a block, deleting leading spaces removes a whole indent level (4 spaces) |
| **Ctrl + C** | Cancel the current input line, stop running code, or interrupt a program waiting for input (copies instead when text is selected) |
| **Ctrl + D** | In a program's `input()`: end of input (`EOFError`) |
| **Ctrl + L** | Clear the screen |
| **Ctrl/Cmd + O** | Open and run a `.py` script |
| **Ctrl/Cmd + U** | Upload files, folders or archives |
| **Ctrl/Cmd + S** | Save the session transcript |
| **Esc** | Close a dialog |

### Autocompletion

- With one match, Tab completes it.
- With several matches sharing a longer prefix, Tab completes the shared prefix.
- Otherwise, Tab lists the candidates in columns below your input (up to 300) and keeps what you typed.

```python
>>> import collections
>>> collections.Or<Tab>        →  collections.OrderedDict
```

### History

The last 500 distinct commands are kept for the current browser tab (they survive a page reload but not closing the tab). Multi-line entries are recalled as a whole. The count is shown in the status bar.

## Toolbar

| Button | Action |
|---|---|
| **Open** | Pick a `.py` file and run it (Puter Drive inside Puter, the computer's file dialog otherwise). Its variables stay available at the prompt. You can also drag a file onto the window. |
| **Upload** | Copy files, folders or archives into Python's file system. See [Files & Upload](files-and-upload.md). |
| **Save** | Save the session transcript as `.txt` (to Puter Drive inside Puter, as a download otherwise) |
| **Programs** | Start a bundled interactive program, or run a `.py` file as a program. See [Custom Programs](custom-programs.md). |
| **Stop** | Shown while code runs: interrupts it (see [Stopping running code](#stopping-running-code)) |
| **A↓ / A↑** | Decrease / increase the terminal font size (10–24 px). The terminal is resized to fit. |
| **Demo** | Runs `await demo()`: a tour of styles, colours, line drawing, links, `\r` progress bars and cursor movement |
| **Copy** | Copies the whole session (scrollback and screen) as plain text, without escape codes |
| **Clear** | Clears the screen and scrollback (same as Ctrl + L or `clear()`) |
| **Keyboard** | Opens the shortcuts dialog |
| **Restart** | Resets Python (fresh namespace), resets all terminal modes and colours, clears the screen and prints the banner again |

Font size is remembered for the browser tab session.

## Built-in helpers

These names are predefined in the REPL namespace:

| Name | Description |
|---|---|
| `clear()` / `cls()` | Clear the terminal screen |
| `demo()` | Coroutine; run with `await demo()` to see escape sequence support |
| `download(path)` | Send a file (or a folder, zipped) to your computer or Puter Drive |
| `run(path, *args)` | Run a `.py` file from Python's file system as a program |
| `exit()` / `quit()` | Reset the interpreter (the page cannot be closed from Python). Typing just `exit` explains this. |
| `import pyterm` | Helpers for interactive programs ([Custom Programs](custom-programs.md)) |
| `help`, `copyright`, `credits`, `license` | Standard Python built-ins |

`sys.exit()` and `raise SystemExit` also reset the interpreter and print `Interpreter restarted.`.

## Asynchronous code

The prompt supports top-level `await`, so you can call coroutines directly:

```python
>>> import asyncio
>>> await asyncio.sleep(1); print("one second later")
one second later
```

Python runs in a background worker, so neither `time.sleep()` nor a long loop freezes the page, and output appears while the code runs. `time.sleep()` and `await asyncio.sleep()` both work for animations and progress bars.

```python
>>> async def countdown(n):
...     for i in range(n, 0, -1):
...         print(f"\r{i} ", end="", flush=True)
...         await asyncio.sleep(1)
...     print("\rLiftoff!")
...
>>> await countdown(5)
```

## Installing packages

Many popular scientific packages are pre-built for Pyodide (numpy, pandas, matplotlib, scipy, scikit-learn, and more). Just `import` them: PyTerm notices the import and downloads the package first (a grey *Loading numpy…* line appears). Pure-Python wheels can be installed from PyPI:

```python
>>> import micropip
>>> await micropip.install("rich")
>>> from rich import print
>>> print("[bold magenta]Hello[/] from [green]rich[/]!")
```

Notes:

- Packages with C extensions that are not in the Pyodide distribution cannot be installed.
- Installed packages live in memory and are lost when the page reloads (or when Stop has to restart Python). The Restart button keeps installed packages but resets your variables.
- Network access from Python goes through the browser, so normal CORS rules apply (`pyodide.http.pyfetch` is the recommended way to make HTTP requests).

## Using escape sequences

Anything you write to `stdout` or `stderr` is interpreted by the terminal emulator. See the [Terminal Emulator Reference](terminal-emulator.md) for the complete list. The most common sequences:

| Write | Effect |
|---|---|
| `\r` | Move to the start of the current line; following text overwrites it |
| `\b` | Move one column left |
| `\t` | Move to the next tab stop (every 8 columns) |
| `\a` | Bell (the terminal briefly flashes) |
| `\x1b[31m` … `\x1b[0m` | Red text … reset |
| `\x1b[1m` | Bold |
| `\x1b[38;5;208m` | 256-colour foreground (orange) |
| `\x1b[38;2;255;105;180m` | Truecolor foreground (hot pink) |
| `\x1b[2K` | Erase the whole current line |
| `\x1b[K` | Erase from the cursor to the end of the line |
| `\x1b[2J\x1b[H` | Clear the screen and move home |
| `\x1b[3A` | Cursor up 3 lines |
| `\x1b[?25l` / `\x1b[?25h` | Hide / show the cursor |
| `\x1b[?1049h` / `\x1b[?1049l` | Enter / leave the alternate (full-screen) buffer |

A blinking-block cursor is shown while a program runs, so you can see where output will go. The input line takes its place when the prompt returns.

### Terminal size

The terminal measures how many columns and rows fit in the window and updates on resize or font change. The size is exported as the environment variables `COLUMNS` and `LINES`, so the standard library picks it up:

```python
>>> import shutil
>>> shutil.get_terminal_size()
os.terminal_size(columns=118, lines=36)
```

`os.get_terminal_size()` is not available, because there is no real TTY. Use `shutil.get_terminal_size()`.

## Running scripts

Open a `.py` file with **Open**, Ctrl/Cmd+O or drag-and-drop, or inside Puter by double-clicking it. It runs like `python -i script.py`: the output appears in the terminal, `input()` works, and its functions and variables are available at the prompt afterwards. `__file__` and `sys.argv[0]` are set to the file name, and top-level `await` is allowed. To run a script in its own clean namespace instead, use **Programs → Run a .py file as a program…** or `run("path/to/file.py")`. See [Puter App & App Center](puter-app-store.md) for the Puter-specific features.

## Files

Your home folder is `/home/pyodide`. Upload files with the **Upload** button, keep files permanently in `~/browser`, and send files back with `download(path)`. Everything is explained in [Files & Upload](files-and-upload.md).

## Copying output

- **Select with the mouse** and use your browser's copy (Ctrl/Cmd + C). Clicking without selecting focuses the input.
- **Copy button**: copies the full session as plain text. Lines that wrapped automatically are joined back together and trailing spaces are removed.

## Examples

**Progress bar with `\r`**

```python
>>> import asyncio
>>> async def progress():
...     for i in range(101):
...         bar = "█" * (i // 4) + "░" * (25 - i // 4)
...         print(f"\r{bar} {i:3d}%", end="")
...         await asyncio.sleep(0.02)
...     print()
...
>>> await progress()
```

**Colour table**

```python
>>> for i in range(16):
...     print(f"\x1b[48;5;{i}m {i:2d} \x1b[0m", end="")
...
>>> print()
```

**Box drawing with the DEC graphics charset**

```python
>>> print("\x1b(0lqqqqk\nx    x\nmqqqqj\x1b(B")
┌────┐
│    │
└────┘
```

**Clickable link (OSC 8)**

```python
>>> print("\x1b]8;;https://python.org\x07Python website\x1b]8;;\x07")
```

**Full-screen app on the alternate screen**

```python
>>> import asyncio
>>> async def fullscreen():
...     print("\x1b[?1049h\x1b[2J\x1b[H\x1b[1;33mAlternate screen!\x1b[0m", end="")
...     for i in range(5, 0, -1):
...         print(f"\x1b[3;1HReturning in {i}…", end="")
...         await asyncio.sleep(1)
...     print("\x1b[?1049l", end="")
...
>>> await fullscreen()
```

When you leave the alternate screen, the previous scrollback comes back untouched.
