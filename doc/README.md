# PyTerm Documentation

Welcome to the PyTerm documentation. PyTerm is a browser-based Python REPL with a VT100/xterm-compatible terminal emulator, built on PyScript and Pyodide.

## Contents

1. **[User Guide](user-guide.md)**
   Everything an end user needs: starting the REPL, prompts and multi-line input, keyboard shortcuts, the toolbar, installing packages, using escape sequences, examples.

2. **[Architecture](architecture.md)**
   The four source files and their responsibilities, the boot sequence, how a line of input travels to Python and how output comes back to the screen, rendering strategy.

3. **[Terminal Emulator Reference](terminal-emulator.md)**
   Complete reference of supported control characters, ESC, CSI, OSC and DEC private mode sequences, SGR attributes, character sets, and the emulator's public JavaScript API.

4. **[Python Bridge](python-bridge.md)**
   The functions exchanged between JavaScript and Python, `repl.py` internals (console, result printing, exit handling, completion), the REPL namespace and environment variables.

5. **[Puter App & App Center](puter-app-store.md)**
   Running as a Puter desktop app (menu bar, Drive pickers, file associations), running scripts, the store listing kit and publishing steps.

6. **[Customization](customization.md)**
   Changing colours, palette, prompts, fonts, scrollback size, result truncation, the banner, preloading packages, and upgrading PyScript.

7. **[Development & Deployment](development.md)**
   Local setup, project conventions, deployment to static hosts, and a manual test checklist.

8. **[Troubleshooting & FAQ](troubleshooting.md)**
   Known limitations, common issues and their fixes, frequently asked questions.

## At a glance

| Item | Value |
|---|---|
| Runtime | PyScript 2026.7.3 → Pyodide 314.0.7 → CPython 3.14.2 (WebAssembly) |
| Terminal type | `xterm-256color` (`COLORTERM=truecolor`) |
| Scrollback | 5,000 lines |
| History | 500 commands, per browser tab session |
| Build step | None — static files |
| Backend | None — everything runs client-side |

## Conventions used in these docs

- `ESC` means the escape character `\x1b` (decimal 27).
- `CSI` means `ESC [` (or the 8-bit C1 character `\x9b`).
- `OSC` means `ESC ]`; `ST` (string terminator) means `ESC \` or `BEL` (`\x07`).
- `Pn` is a numeric parameter; `Ps` a selector parameter. Missing parameters take their default.
- Python examples are typed at the `>>>` prompt unless stated otherwise.
