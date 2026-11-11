# Troubleshooting & FAQ

- [Known limitations](#known-limitations)
- [Common problems](#common-problems)
- [FAQ](#faq)

---

## Known limitations

| Limitation | Reason / workaround |
|---|---|
| Stop can't interrupt a pure CPU loop on normal hosting | Interrupting computing code needs shared memory, which browsers only allow on cross-origin isolated pages. Without it, PyTerm restarts Python after 2.5 s (variables are lost, `~/browser` is kept). Waiting code (`input()`, sleeps, awaits) stops instantly everywhere. See [Development](development.md#optional-cross-origin-isolation). |
| `input()` needs a recent browser | It uses WebAssembly stack switching (JSPI) or shared memory. Older browsers on a normal page get an error suggesting `await pyterm.ainput()`, which works everywhere. |
| Input is line-based | Programs receive whole lines. Full-screen TUI frameworks that need single key presses (curses, prompt_toolkit, textual) can't take input. |
| No terminal replies | Cursor position reports, device attributes and similar queries are ignored. |
| No mouse reporting | Mouse events are not sent to programs. |
| No text reflow | Output wrapped at one width is not re-wrapped when the window is resized. |
| `os.get_terminal_size()` fails | There is no TTY. Use `shutil.get_terminal_size()`, which reads `COLUMNS` / `LINES`. |
| No `document` / `window` in `js` | Python runs in a worker. `js` is the worker scope (`fetch`, `crypto`, `setTimeout`…). |
| Some packages can't be installed | Only pure-Python wheels and packages built for Pyodide work. |
| No subprocesses or threads | `subprocess`, `os.fork`, `multiprocessing` and real threads are unavailable. |
| Raw sockets are unavailable | Use `pyodide.http.pyfetch`; requests are subject to CORS. |
| Only `~/browser` is saved | Other files, variables and packages are lost on reload. |

## Common problems

### The page stays on "Starting" / loading forever
- Check your internet connection. The runtime (about 10 MB) comes from `cdn.jsdelivr.net`.
- Browser extensions or firewalls may block the CDN or Web Workers. Check the DevTools Network tab.
- Make sure you are serving over HTTP(S), not `file://`.
- If the status turns **Failed**, the loader line shows the error; the DevTools console has details.

### input() says it "can't pause Python in this browser"
- Update the browser (current Chrome, Edge and Firefox support WebAssembly stack switching).
- Or write `await pyterm.ainput("prompt")` instead of `input("prompt")`, and `await app.arun()` instead of `app.run()`.

### Stop restarted Python and my variables are gone
- The code was computing without pausing, and the page isn't cross-origin isolated, so the only way to stop it was a restart. Put long computations in functions you can re-run, keep data in `~/browser`, or serve the site with the isolation headers.

### My program is "Waiting for input" but I see no prompt
- Click inside the terminal to focus the input line. The prompt is whatever the program printed last on the line (it may be empty).
- Press **Ctrl + D** to send end-of-file or **Ctrl + C** / **Stop** to interrupt.

### Uploaded files are gone after a reload
- Only `~/browser` is saved. Upload into `browser` (pick the `~/browser` chip in the Upload dialog) or copy files there with `shutil.copy`.
- Private / incognito windows may block IndexedDB; the status bar then doesn't show **~/browser saved**.

### An archive was copied instead of extracted
- Check *Extract archives* in the Upload dialog.
- Office documents, `.jar`, `.whl`, `.epub` and similar are ZIPs inside but are copied on purpose. Extract them in Python with `zipfile` if you need to.
- `.gz` / `.bz2` / `.xz` files are extracted only when they contain a tar archive (`.tar.gz`, `.tgz`, …). Decompress single files with `gzip.open()`.

### "unsafe archive entries ignored"
- The archive contained absolute paths, `..`, or links. They were skipped so nothing could be written outside the destination folder.

### Nothing happens when I press Enter
- While code runs, the `>>>` line is hidden. Wait for it, or press **Stop**.
- Click inside the terminal to give the input focus.

### Colours or escape sequences show up as raw text like `[31m`
- Write the escape character itself: `"\x1b[31m"` or `"\033[31m"`, not `"\\x1b[31m"` or a raw string.
- `repr()` output (results without `print`) shows escapes as text on purpose. Use `print()`.

### A progress bar prints on many lines instead of updating
- Use `end=""` so `print` doesn't add a newline: `print(f"\r{i}%", end="")`.
- If the line is wider than the terminal it wraps, and `\r` only returns to the start of the last part. Keep it shorter than `shutil.get_terminal_size().columns`.

### Box-drawing or wide characters don't line up
- Use the bundled monospace font (JetBrains Mono). Some emoji come from fallback fonts whose width may differ slightly.

### `exit()` doesn't close the page
- By design: it resets the interpreter. Close the browser tab to leave.

### Copy button does nothing
- The clipboard API needs HTTPS (or `localhost`) and, in some browsers, permission. Select the text manually as a fallback.

### Text looks wrong after a program crashed mid-sequence
- A program can leave modes on (hidden cursor, alternate screen, odd colours). Print `"\x1bc"` (full reset) or press **Restart**.

## FAQ

**Which Python version is it?**
CPython 3.14.2 compiled to WebAssembly by Pyodide 314.0.7, running in a Web Worker. The exact version is in the banner and status bar.

**Does my code run on a server?**
No. Everything runs in your browser. Nothing is sent anywhere, apart from downloading the runtime and the packages you use.

**Where are my uploaded files?**
In Python's own file system inside the tab, under `/home/pyodide/<folder>`. Only `~/browser` is kept after a reload. See [Files & Upload](files-and-upload.md).

**Can I use numpy, pandas, matplotlib…?**
Yes, just `import` them; packages built for Pyodide are loaded automatically. Matplotlib figures are not shown in the terminal, but you can `savefig("browser/plot.png")` and `download("browser/plot.png")`.

**Can I write my own interactive programs?**
Yes. Plain `input()` loops, `cmd.Cmd` and the `pyterm.App` helper all work. See [Custom Programs](custom-programs.md).

**Can I save my session?**
**Save** writes the transcript to a `.txt` file; **Copy** copies it. Files you want to keep go in `~/browser`.

**Is the terminal a full xterm?**
It implements most VT100/VT220/xterm *output* sequences. It doesn't do key/mouse reporting or status replies. See the [Terminal Emulator Reference](terminal-emulator.md#not-supported).

**How do I clear the screen from Python?**
`clear()`, `cls()`, `pyterm.clear()`, or `print("\x1b[2J\x1b[3J\x1b[H", end="")`.
