# Python Bridge

This document describes how JavaScript (`app.js`) and Python (`repl.py`) communicate, and how the REPL works internally.

- [Overview](#overview)
- [Functions exported by Python](#functions-exported-by-python)
- [Functions exported by JavaScript](#functions-exported-by-javascript)
- [repl.py internals](#replpy-internals)
- [The REPL namespace](#the-repl-namespace)
- [Environment variables](#environment-variables)
- [Calling the page from Python](#calling-the-page-from-python)

---

## Overview

The two sides talk only through functions placed on the global `window` object:

```
          JavaScript (app.js)                         Python (repl.py)
  ─────────────────────────────────           ─────────────────────────────────
  window.pyterm_ready(version, platform)  ◄─── called once at the end of boot
  window.pyterm_write(text, kind)         ◄─── stdout / stderr / results / errors
  window.pyterm_clear()                   ◄─── clear() / cls()

  await window.pyterm_push(line)          ───► push(line)          → "complete" | "incomplete" | "exit"
  window.pyterm_complete(source)          ───► complete(source)    → [options[], start]
  window.pyterm_reset_buffer()            ───► reset_buffer()
  window.pyterm_restart()                 ───► restart()
  window.pyterm_set_size(cols, rows)      ───► set_size(cols, rows)
```

Python functions are wrapped with `pyodide.ffi.create_proxy`, so they stay alive after `repl.py` finishes running. Async Python functions return JavaScript Promises when called from JavaScript.

## Functions exported by Python

### `pyterm_push(line: str) → Promise<"complete" | "incomplete" | "exit">`

Feeds **one** line of source to the interactive console.

| Return value | Meaning | What the UI does |
|---|---|---|
| `"incomplete"` | More input is needed (open block, bracket or string) | Shows the `... ` prompt and pre-fills indentation |
| `"complete"` | The statement ran (or a syntax error was reported) | Shows the `>>> ` prompt |
| `"exit"` | `exit()`, `quit()`, `sys.exit()` or `SystemExit` was raised; the console has been rebuilt | Prints *Interpreter restarted.* and shows `>>> ` |

The promise resolves only after the code (including any awaited coroutines) has finished.

### `pyterm_complete(source: str) → [string[], number]`

Returns completion candidates for the current input line, using the console's `rlcompleter`-based completer. The second item is the index in `source` where the completed word starts. On failure it returns `[[], source.length]`. The call is synchronous.

### `pyterm_reset_buffer()`

Throws away any partly typed block (used by Ctrl+C), so the next line starts a new statement.

### `pyterm_restart() → true`

Creates a new console with a new namespace. Imported modules stay cached in `sys.modules` and installed packages stay on the virtual file system, but every user variable is gone.

### `pyterm_set_size(cols: number, rows: number)`

Stores the terminal size in `os.environ["COLUMNS"]` and `os.environ["LINES"]`. Called by `fit()` whenever the size changes.

## Functions exported by JavaScript

### `pyterm_ready(version: str, platform: str)`

Called by Python as the last step of `repl.py`. The UI removes the loader, shows the version in the status bar, prints the banner and shows the first prompt.

### `pyterm_write(text: str, kind: str)`

Sends output to the terminal. `kind` is one of:

| kind | Source | Rendering |
|---|---|---|
| `out` | `sys.stdout` | Raw: escape sequences are interpreted using the program's SGR state |
| `err` | `sys.stderr`, tracebacks, syntax errors | Default colour red |
| `result` | `repr()` of a non-`None` expression | Default colour blue |
| `prompt`, `input`, `info`, `accent` | Used by `app.js` itself | See `COLORS` in `app.js` |

Escape sequences are interpreted in **every** kind. For example, `sys.stderr.write("\x1b[1mbold red\x1b[0m")` prints bold red text.

### `pyterm_clear()`

Clears the screen and scrollback (`Terminal.clear()`), then puts the input line back if the REPL is idle.

## repl.py internals

### `SafeConsole`

```python
class SafeConsole(PyodideConsole):
    async def runcode(self, source, code):
        try:
            return await super().runcode(source, code)
        except (SystemExit, KeyboardInterrupt) as e:
            raise _ExitRequested(str(e)) from None
```

`PyodideConsole` runs code as asyncio tasks on Pyodide's WebLoop. If a `SystemExit` escapes such a task, asyncio re-raises it out of the event loop. It never reaches the awaiting code and shows up in the browser as an *unhandled promise rejection*. `SafeConsole` turns `SystemExit` (and `KeyboardInterrupt`) into the ordinary exception `_ExitRequested`, which travels back to `push()` normally.

### `make_console()`

Builds a new namespace and a `SafeConsole` with:

```python
stdout_callback=lambda s: _write(s, "out")
stderr_callback=lambda s: _write(s, "err")
```

Pyodide's console redirects `sys.stdout` / `sys.stderr` while user code runs, so every write goes straight to the terminal.

### `push(line)`

```text
fut = console.push(line)
├─ syntax_check == "incomplete"   → return "incomplete"
├─ syntax_check == "syntax-error" → write formatted_error (err) → return "complete"
└─ await fut
     ├─ result is not None → namespace["_"] = result; write repr (result)
     ├─ _ExitRequested     → make_console(); return "exit"
     └─ other exception    → write fut.formatted_error (err)
   finally: flush stdout/stderr
return "complete"
```

`formatted_error` contains a traceback with Pyodide's internal frames removed, so it looks like CPython's own REPL.

### `_short_repr(value)`

Returns `repr(value)`. Results longer than `MAX_REPR` (8,000) characters keep the first and last 4,000 characters, with `... [N chars hidden] ...` in between. If `repr()` itself raises, it returns `<repr failed: …>`.

### `_Exit`

Stands in for the `exit` and `quit` built-ins. Calling it raises `_ExitRequested`. Its `repr()` says to use `exit()` or the Restart button.

### `demo()`

An `async` function that shows text styles, the 16, 256 and truecolor palettes, DEC line drawing, an OSC 8 link, a `\r` progress bar and spinner, and cursor movement, insert, delete and erase. It uses `await asyncio.sleep()` between frames so the browser can repaint.

## The REPL namespace

A fresh namespace contains:

| Name | Value |
|---|---|
| `__name__` | `"__main__"` |
| `__doc__` | `None` |
| `clear`, `cls` | Clear the terminal |
| `demo` | The escape sequence demo coroutine function |
| `exit`, `quit` | `_Exit` instances that reset the interpreter |
| `_` | Set after the first non-`None` result |

The built-ins (`print`, `help`, `len`, …) come from `__builtins__` as usual. The namespace is separate from the module globals of `repl.py`, so user code cannot accidentally overwrite the bridge.

## Environment variables

| Variable | Value | Purpose |
|---|---|---|
| `TERM` | `xterm-256color` | Lets libraries (rich, colorama, click, …) detect colour support |
| `COLORTERM` | `truecolor` | Advertises 24-bit colour support |
| `COLUMNS` | current column count | Used by `shutil.get_terminal_size()`, `textwrap`, `argparse` help, rich, … |
| `LINES` | current row count | Same, for height |

`TERM` and `COLORTERM` are set with `setdefault`, so they can be overridden beforehand.

> Some libraries check `sys.stdout.isatty()` before emitting colour. Pyodide's console streams are not TTYs, so you may need to force colour, for example with `rich.console.Console(force_terminal=True)` or `FORCE_COLOR=1`.

## Calling the page from Python

User code can reach the browser through the `js` module:

```python
>>> import js
>>> js.window.pyterm_write("\x1b[35mdirect write\x1b[0m\n", "out")
>>> js.document.title
'PyTerm — Python REPL'
>>> from pyodide.http import pyfetch
>>> r = await pyfetch("https://api.github.com/zen")
>>> await r.string()
'Keep it logically awesome.'
```

Network requests follow the browser's CORS rules.
