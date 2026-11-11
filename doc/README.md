# PyTerm Documentation

Welcome to the PyTerm documentation. PyTerm is a browser-based Python REPL with a VT100/xterm-compatible terminal emulator. Python (Pyodide) runs in a background Web Worker, so code can be stopped, `input()` is interactive, and the page never freezes.

## Contents

1. **[User Guide](user-guide.md)**
   Starting the REPL, prompts and multi-line input, `input()`, stopping code, keyboard shortcuts, the toolbar, installing packages, escape sequences, examples.

2. **[Custom Programs](custom-programs.md)**
   Writing interactive terminal programs (`input()` loops, `cmd.Cmd`, the `pyterm` helper module), running them, and adding them to the Programs menu.

3. **[Files & Upload](files-and-upload.md)**
   The Upload dialog, folders and Puter Drive, archive extraction, name conflicts, the persistent `~/browser` folder, and downloading files from Python.

4. **[Architecture](architecture.md)**
   The source files and their responsibilities, the boot sequence, how input travels to the worker and output comes back, rendering, persistence.

5. **[Python Bridge](python-bridge.md)**
   The page ↔ worker message protocol, the `pyterm_host` module, `repl.py` internals (console, stdin, interrupts, scripts, uploads), the REPL namespace and environment variables.

6. **[Terminal Emulator Reference](terminal-emulator.md)**
   Supported control characters, ESC, CSI, OSC and DEC private mode sequences, SGR attributes, character sets, and the emulator's JavaScript API.

7. **[Puter App & App Center](puter-app-store.md)**
   Running as a Puter desktop app (menu bar, Drive pickers, file associations), the store listing kit and publishing steps.

8. **[Customization](customization.md)**
   Colours, palette, prompts, fonts, limits, the banner, REPL helpers, preloading packages, upgrading Pyodide.

9. **[Development & Deployment](development.md)**
   Local setup, project conventions, deployment, optional cross-origin isolation, and a manual test checklist.

10. **[Troubleshooting & FAQ](troubleshooting.md)**
    Known limitations, common issues and their fixes, frequently asked questions.

## At a glance

| Item | Value |
|---|---|
| Runtime | Pyodide 314.0.7 → CPython 3.14.2 (WebAssembly), in a module Web Worker |
| Terminal type | `xterm-256color` (`COLORTERM=truecolor`) |
| Home folder | `/home/pyodide` (current directory at start) |
| Saved folder | `/home/pyodide/browser` (IndexedDB, survives reloads) |
| Scrollback | 5,000 lines |
| History | 500 commands per prompt, per browser tab session |
| Build step | None — static files |
| Backend | None — everything runs client-side |

## Conventions used in these docs

- `ESC` means the escape character `\x1b` (decimal 27).
- `CSI` means `ESC [` (or the 8-bit C1 character `\x9b`).
- `OSC` means `ESC ]`; `ST` (string terminator) means `ESC \` or `BEL` (`\x07`).
- `Pn` is a numeric parameter; `Ps` a selector parameter. Missing parameters take their default.
- Python examples are typed at the `>>>` prompt unless stated otherwise.
- `~` means `/home/pyodide`.
