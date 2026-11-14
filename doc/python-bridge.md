# Python Bridge

How the page (`app.js` / `engine.js`) talks to the Python worker (`py-worker.js` / `repl.py`), and how the REPL works inside.

- [Overview](#overview)
- [Messages from the page](#messages-from-the-page)
- [Messages from the worker](#messages-from-the-worker)
- [The pyterm_host module](#the-pyterm_host-module)
- [repl.py internals](#replpy-internals)
- [Running scripts and programs](#running-scripts-and-programs)
- [The REPL namespace](#the-repl-namespace)
- [Environment variables](#environment-variables)
- [Calling the browser from Python](#calling-the-browser-from-python)

---

## Overview

```
 Page (engine.js)                                   Worker (py-worker.js → repl.py)
 ─────────────────                                  ───────────────────────────────
 init {interrupt?, stdin?, cols, rows}  ──────────►  loadPyodide, mount ~/browser, run repl.py
                                        ◄──────────  status {text} … ready {version, persist, shared, interrupt, jspi}
 push {id, line}                        ──────────►  push(line)
                                        ◄──────────  out {text, kind} …  input {…} …
                                        ◄──────────  result {id, value: "complete" | "incomplete" | "exit"}
 input_reply {text, status}             ──────────►  (or written to the shared stdin buffer)
 interrupt                              ──────────►  cancel tasks (+ SIGINT through the shared buffer)
```

Requests carrying an `id` are answered with exactly one `{type:'result', id, value, error}` and are executed **one at a time** in the order received. `input_reply`, `interrupt`, `size` and `flush_fs` bypass the queue.

## Messages from the page

| type | Payload | Answer `value` | Notes |
|---|---|---|---|
| `init` | `interrupt` (Uint8Array on a SharedArrayBuffer or null), `stdin` (SharedArrayBuffer or null), `cols`, `rows` | — | Sent once by `start()` |
| `push` | `line` | `"complete"`, `"incomplete"` or `"exit"` | Loads Pyodide packages the line imports first |
| `complete` | `source` | `[options[], start]` | `rlcompleter` candidates; `start` is where the completed word begins |
| `reset_buffer` | — | — | Drops a half-typed block |
| `restart` | — | — | New console and namespace |
| `run_file` | `name`, `source`, `isolated`, `paths` (import paths), `extra` (library sources, for package loading) | like `push` | See [Running scripts](#running-scripts-and-programs) |
| `write_files` | `files: [{path, data}]` (ArrayBuffers, transferred) | number of files | Installs a program and its libraries in `~/programs` |
| `save` | `path`, `data` (ArrayBuffer, transferred), `policy` | final path or `null` (skipped) | Upload of one file |
| `extract` | `name`, `data`, `dest`, `policy`, `subfolder` | `{dest, files, skipped, renamed, blocked, kind}` | ZIP / tar extraction |
| `tree` | `path`, `limit` | — | Prints a coloured tree |
| `read` | `path` | `{name, data: Uint8Array}` | A file, or a folder as a ZIP |
| `sync` | — | — | Saves `~/browser` to IndexedDB now |
| `input_reply` | `text`, `status` | — | Answers a `via:'msg'` input request |
| `interrupt` | — | — | Ctrl+C / Stop |
| `size` | `cols`, `rows` | — | Applied before the next request |
| `flush_fs` | — | — | Save `~/browser` (page hidden or closing) |

`status` for input replies: `1` = a line, `2` = EOF (Ctrl+D → `EOFError`), `3` = interrupt (Ctrl+C → `KeyboardInterrupt`), `4` = Stop button (→ `pyterm.StopProgram`, ends the program).

## Messages from the worker

| type | Payload | Page action |
|---|---|---|
| `status` | `text` | Loader message during boot |
| `ready` | `version`, `persist`, `shared`, `interrupt`, `jspi` | Remove loader, banner, prompt, badges |
| `fatal` | `message` | Status **Failed** |
| `out` | `text`, `kind` (`out`, `err`, `info`, `result`) | Written to the terminal |
| `clear` | — | Clear the screen |
| `title` | `text` | Header / window title |
| `input` | `via` (`msg` or `sab`), `password`, `completions`, `history` | Show the input line for `input()` |
| `progress` | `done`, `total`, `label` | Archive extraction progress |
| `download` | `name`, `data`, `mime` | Save picker (Puter) or browser download |
| `result` | `id`, `value`, `error` | Resolves / rejects `engine.call()` |

### Shared memory layout (cross-origin isolated pages only)

- **Interrupt buffer**: `Uint8Array(1)` passed to `pyodide.setInterruptBuffer()`. Writing `2` raises `KeyboardInterrupt` at the next bytecode check.
- **Stdin buffer**: `SharedArrayBuffer(8 + 1 MiB)`. `Int32Array[0]` is the status (0 = waiting), `Int32Array[1]` the byte length, then UTF-8 data. The worker waits with `Atomics.wait`; the page writes the data, stores the status and calls `Atomics.notify`.

## The pyterm_host module

Registered with `pyodide.registerJsModule('pyterm_host', host)`; used by `repl.py` and `pyterm.py`:

| Function | Purpose |
|---|---|
| `out(text, kind)` | Write to the terminal (batched) |
| `flush()` | Send buffered output now |
| `clear()` | Clear the screen |
| `title(text)` | Set the title |
| `can_block()` | True if shared-memory stdin is available |
| `read_input(password, completions, history)` | Blocking read via `Atomics.wait` → `[status, text]` |
| `input_async(password, completions, history)` | Promise of `[status, text]` (JSPI / `ainput`) |
| `sleep(ms)` | Promise used by `time.sleep()` under JSPI; resolves `0`, or `1` when Stop wakes it early (→ `KeyboardInterrupt`) |
| `progress(done, total, label)` | Progress message |
| `download(name, data, mime)` | Send bytes to the page |
| `load_imports(source)` | `pyodide.loadPackagesFromImports(source)` |

## repl.py internals

### `SafeConsole`

```python
class SafeConsole(PyodideConsole):
    async def runcode(self, source, code):
        try:
            return await super().runcode(source, code)
        except SystemExit as e:
            raise _ExitRequested(str(e)) from None
        except (KeyboardInterrupt, asyncio.CancelledError):
            raise _Interrupted() from None
```

asyncio re-raises `SystemExit` and `KeyboardInterrupt` out of the event loop, where nothing could catch them. `SafeConsole` turns them into ordinary exceptions that travel back to `push()`.

### stdin and friends

| Replaced | With |
|---|---|
| `builtins.input` | `pyterm.input(prompt)` → `read_line()` |
| `sys.stdin` | `_Stdin` (`readline()`, `read()`, `isatty() == True`); used by `cmd.Cmd`, `sys.stdin.readline()`, `for line in sys.stdin` |
| `getpass.getpass` | Password-mode `pyterm.input` |
| `time.sleep` | `run_sync(host.sleep(ms))` when possible (Stop wakes it, the worker stays responsive), otherwise `Atomics.wait` in 100 ms slices on isolated pages |

`read_line()` prefers **JSPI** (`pyodide.ffi.run_sync`), which suspends Python while the worker's event loop keeps running (so `~/browser` can still be saved). It falls back to **shared-memory blocking**, and otherwise raises a `RuntimeError` that suggests `await pyterm.ainput()`.

### `push(line)`

```text
fut = console.push(line)
├─ "incomplete"   → return "incomplete"
├─ "syntax-error" → write formatted_error (err) → "complete"
└─ await fut
     ├─ result is not None    → namespace["_"] = result; write repr (result)
     ├─ _ExitRequested        → make_console(); return "exit"
     ├─ interrupted           → write "KeyboardInterrupt" (err)
     └─ other exception       → write fut.formatted_error (err)
   finally: flush output
return "complete"
```

### `interrupt()`

On an `interrupt` message the worker first answers a pending input request (status 3) or wakes a pending `time.sleep()`. Otherwise `interrupt()` cancels every pending asyncio task except the `push()` wrappers themselves, so `await` points raise and the console reports `KeyboardInterrupt`. With shared memory, the interrupt buffer also stops computing code.

### Uploads

- `save_upload(path, data, policy)` — relative paths are inside `/home/pyodide`; folders are created; `policy` is `rename` (`name (1).ext`), `overwrite` or `skip`.
- `extract_upload(name, data, dest, policy, subfolder)` — detects ZIP / tar / tar.gz / tar.bz2 / tar.xz by magic bytes; decodes non-UTF-8 ZIP names as CP437; refuses absolute paths, `..`, symlinks, hard links and devices; drops `__MACOSX` and `.DS_Store`; reports progress every 25 entries.
- `tree(path, limit)` and `read_for_download(path)`.

See [Files & Upload](files-and-upload.md).

## Running scripts and programs

`run_file` stages the source with `stage_file(name, source, isolated)` and pushes `await __pyterm_run__()`, so output, tracebacks, `exit()` and the busy state behave like typed code.

| | Script (Open, drag & drop, Puter double-click) | Program (Programs menu, `?program=`) |
|---|---|---|
| Namespace | The REPL namespace (like `python -i script.py`) | A fresh `__main__` namespace |
| `__name__` | `"__main__"` | `"__main__"` |
| `__file__`, `sys.argv[0]` | file name | file name |
| Top-level `await` | yes | yes |
| `sys.exit(n)` | ends the script; non-zero status is reported | same |
| Afterwards | variables stay available | nothing leaks into the REPL |

`run(path, *args)` (available at the prompt) runs a file from the virtual file system as a program, with `sys.argv = [path, *args]` and its folder added to `sys.path`.

## The REPL namespace

| Name | Value |
|---|---|
| `__name__` | `"__main__"` |
| `clear`, `cls` | Clear the terminal |
| `demo` | Escape-sequence demo coroutine (`await demo()`) |
| `download(path, name=None)` | Send a file or folder (zipped) to your computer / Puter Drive |
| `run(path, *args)` | Run a `.py` file as a program |
| `exit`, `quit` | Reset the interpreter |
| `_` | Last non-`None` result |

`import pyterm` gives the helper module described in [Custom Programs](custom-programs.md).

## Environment variables

| Variable | Value |
|---|---|
| `HOME` | `/home/pyodide` |
| `TERM` | `xterm-256color` |
| `COLORTERM` | `truecolor` |
| `COLUMNS`, `LINES` | Current terminal size |

The current directory at start is `/home/pyodide`.

## Calling the browser from Python

Python runs in a **worker**, so `js` refers to the worker's global scope: `fetch`, `crypto`, `indexedDB`, `setTimeout`, `TextEncoder`… are available; `document` and `window` are not.

```python
>>> from pyodide.http import pyfetch
>>> r = await pyfetch("https://api.github.com/zen")
>>> await r.string()
'Keep it logically awesome.'
>>> import js
>>> js.crypto.randomUUID()
'0f6c…'
```

Network requests follow the browser's CORS rules.
