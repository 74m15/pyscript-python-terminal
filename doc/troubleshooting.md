# Troubleshooting & FAQ

- [Known limitations](#known-limitations)
- [Common problems](#common-problems)
- [FAQ](#faq)

---

## Known limitations

| Limitation | Reason / workaround |
|---|---|
| `input()` is not interactive | Python runs on the browser's main thread and cannot block waiting for keystrokes. Pyodide falls back to the browser's `prompt()` dialog, or raises an error. Read values at the REPL prompt instead, or pass them as function arguments. |
| `time.sleep()` freezes the page | It blocks the only thread. Use `await asyncio.sleep()` for anything that should animate or update. |
| Long computations freeze the page | Same reason. Split the work and `await asyncio.sleep(0)` from time to time. Ctrl+C cannot interrupt running code. |
| No real interrupt | Ctrl+C only cancels the *input line*. To stop a runaway loop, reload the page. |
| `os.get_terminal_size()` fails | There is no TTY. Use `shutil.get_terminal_size()`, which reads `COLUMNS` / `LINES`. |
| `sys.stdout.isatty()` is `False` | Some libraries then turn colour off; force it (e.g. `Console(force_terminal=True)` in rich, `FORCE_COLOR=1`). |
| No terminal replies | Cursor position reports, device attributes and similar queries are ignored, because the output stream has no input side. Programs that wait for a reply will hang or fall back. |
| No mouse or keyboard reporting | Full-screen TUI frameworks that need raw keyboard input (curses, prompt_toolkit, textual) can't take input. |
| No text reflow | Output wrapped at one width is not re-wrapped when the window is resized. |
| Some packages can't be installed | Only pure-Python wheels and packages built for Pyodide work with micropip. |
| No subprocesses or threads | `subprocess`, `os.fork` and `multiprocessing` are unavailable; `threading` cannot start real threads. |
| Raw sockets are unavailable | Use `pyodide.http.pyfetch`; requests are subject to CORS. |
| State is not saved | Variables and installed packages are lost on reload. History and font size last for the browser tab session only. |

## Common problems

### The page stays on "Starting" / loading forever
- Check your internet connection. The runtime (about 10 MB) comes from `pyscript.net` and `cdn.jsdelivr.net`.
- Browser extensions or corporate firewalls may block these CDNs. Check the DevTools Network tab for failed requests.
- Make sure you are serving over HTTP(S), not `file://`.
- If the status turns **Failed**, open the DevTools console to see the Python error.

### Nothing happens when I press Enter
- While code is running (status **Running**), the input line is hidden. Wait for it to finish, or reload if it is stuck in an endless loop.
- Click inside the terminal to give the input focus.

### Colours or escape sequences show up as raw text like `[31m`
- Make sure you write the escape character itself: `"\x1b[31m"` or `"\033[31m"`, not `"\\x1b[31m"` or a raw string `r"\x1b..."`.
- `repr()` output (results without `print`) shows escapes as text on purpose. Use `print()`.

### A progress bar prints on many lines instead of updating
- Use `end=""` so `print` doesn't add a newline: `print(f"\r{i}%", end="")`.
- Use `await asyncio.sleep(...)` between updates. With `time.sleep`, all updates arrive at once when the loop ends.
- If the line is wider than the terminal, it wraps and `\r` only returns to the start of the last part. Keep updating lines shorter than the column count (`shutil.get_terminal_size().columns`).

### Box-drawing or wide characters don't line up
- Use the bundled monospace font (JetBrains Mono). Some emoji and symbols are drawn from fallback fonts whose width may differ slightly. The emulator still gives them two cells.

### Output appears after my code finishes, not while it runs
- That is the single-thread limitation. Add `await asyncio.sleep(0)` inside loops to let the browser render.

### `exit()` doesn't close the page
- By design: it resets the interpreter. Close the browser tab to leave.

### Copy button does nothing
- The clipboard API needs HTTPS (or `localhost`) and, in some browsers, permission. Select the text manually as a fallback.

### Text looks wrong after a program crashed mid-sequence
- A program can leave modes on (hidden cursor, alternate screen, reverse video, odd colours). Print `"\x1bc"` (full reset) or press **Restart**.

## FAQ

**Which Python version is it?**
CPython 3.12 compiled to WebAssembly by Pyodide 0.26.4, loaded through PyScript 2024.11.1. The exact version is shown in the banner and status bar.

**Does my code run on a server?**
No. Everything runs in your browser. No code or data is sent anywhere, apart from downloading the runtime and any packages you install.

**Can I use numpy, pandas, matplotlib…?**
Yes: `import micropip; await micropip.install("numpy")`. Many scientific packages are pre-built for Pyodide. Matplotlib figures are not shown inside the terminal; you can save them to bytes and display them through the `js` module if needed.

**Can I save my session?**
Use **Copy** to copy the transcript. To keep code, write it in a file elsewhere and paste it in. The browser's in-memory file system (`open("x.txt", "w")`) is cleared on reload.

**Is the terminal a full xterm?**
It implements most VT100/VT220/xterm *output* sequences: cursor control, erasing, scroll regions, colours, styles, character sets, the alternate screen, titles and hyperlinks. It does not do input-side features (key/mouse reporting, status replies). See the [Terminal Emulator Reference](terminal-emulator.md#not-supported).

**How do I clear the screen from Python?**
`clear()`, `cls()`, or `print("\x1b[2J\x1b[3J\x1b[H", end="")`.

**How do I reset colours if a program left them on?**
`print("\x1b[0m")`, or `print("\x1bc")` for a full reset.
