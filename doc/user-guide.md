# User Guide

This guide explains how to use PyTerm as an end user.

- [Starting up](#starting-up)
- [The screen](#the-screen)
- [Typing Python](#typing-python)
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
2. *Compiling WebAssembly…*
3. *Loading the standard library…*
4. *Almost there…*

The first visit downloads about 10 MB. Later visits load from the browser cache and start much faster. If loading takes more than 30 seconds, the message changes to *Still loading — slow connections can take a minute…*.

When Python is ready, the status pill turns **Ready** (green) and the banner appears:

```
Python 3.12.x (main, ...) on WebAssembly (Pyodide via PyScript)
Type "help", "copyright", "credits" or "license" for more information.
VT100/ANSI escape sequences are supported — try await demo(). clear() wipes the screen.
>>>
```

## The screen

| Area | What it shows |
|---|---|
| **Header** | App name, the terminal title (changeable by programs via OSC 0/2), status pill, toolbar buttons |
| **Terminal** | Program output and the input line |
| **Status bar** | Python version, encoding (UTF-8), terminal type (VT100 · xterm-256color), size in columns × rows, number of commands in history, a Tab-completion hint |

Status pill states:

| State | Meaning |
|---|---|
| Starting (amber, pulsing) | The Python runtime is loading |
| Ready (green) | Waiting for input |
| Running (blue, pulsing) | Python is executing your code; input is hidden until it finishes |
| Failed (red) | PyScript reported a fatal error while starting |

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

## Keyboard shortcuts

| Keys | Action |
|---|---|
| **Enter** | Run the line, or continue the block |
| **Shift + Enter** | Insert a newline without running |
| **↑ / ↓** | Previous / next command from history (when the cursor is on the first / last line of the input) |
| **Tab** | Autocomplete names and attributes; inserts 4 spaces at the start of a line or after whitespace |
| **Backspace** | Inside a block, deleting leading spaces removes a whole indent level (4 spaces) |
| **Ctrl + C** | Cancel the current input (prints `KeyboardInterrupt`), unless text is selected, where it copies as usual |
| **Ctrl + L** | Clear the screen |
| **Ctrl/Cmd + O** | Open and run a `.py` script |
| **Ctrl/Cmd + S** | Save the session transcript |
| **Esc** | Close the shortcuts dialog |

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
| **Save** | Save the session transcript as `.txt` (to Puter Drive inside Puter, as a download otherwise) |
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
| `exit()` / `quit()` | Reset the interpreter (the page cannot be closed from Python). Typing just `exit` explains this. |
| `help`, `copyright`, `credits`, `license` | Standard Python built-ins |

`sys.exit()` and `raise SystemExit` also reset the interpreter and print `Interpreter restarted.`.

## Asynchronous code

The prompt supports top-level `await`, so you can call coroutines directly:

```python
>>> import asyncio
>>> await asyncio.sleep(1); print("one second later")
one second later
```

Python runs on the browser's main thread. Blocking code such as `time.sleep()` or a long CPU-bound loop freezes the page until it finishes, and output appears only at the end. For animations, progress bars and anything that should update live, use `await asyncio.sleep(...)` between updates. That lets the browser repaint.

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

Many popular scientific packages are pre-built for Pyodide (numpy, pandas, matplotlib, scipy, scikit-learn, and more), and pure-Python wheels can be installed from PyPI:

```python
>>> import micropip
>>> await micropip.install("rich")
>>> from rich import print
>>> print("[bold magenta]Hello[/] from [green]rich[/]!")
```

Notes:

- Packages with C extensions that are not in the Pyodide distribution cannot be installed.
- Installed packages live in memory and are lost when the page reloads. Restart keeps installed packages but resets your variables.
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

Open a `.py` file with **Open**, Ctrl/Cmd+O or drag-and-drop, or inside Puter by double-clicking it. It runs like `python -i script.py`: the output appears in the terminal, and its functions and variables are available at the prompt afterwards. `__file__` and `sys.argv[0]` are set to the file name, and top-level `await` is allowed. See [Puter App & App Center](puter-app-store.md) for the Puter-specific features.

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
