# Customization

Common changes and where to make them. All files are plain source; reload the page after editing.

- [App colours](#app-colours)
- [Terminal palette](#terminal-palette)
- [Default foreground and background](#default-foreground-and-background)
- [Prompts](#prompts)
- [Fonts and font size](#fonts-and-font-size)
- [Line height](#line-height)
- [Banner](#banner)
- [Limits](#limits)
- [Cursor appearance](#cursor-appearance)
- [Bell](#bell)
- [Adding REPL helpers](#adding-repl-helpers)
- [Adding programs](#adding-programs)
- [Upload defaults](#upload-defaults)
- [Stop timeout](#stop-timeout)
- [Preloading packages](#preloading-packages)
- [Running startup code](#running-startup-code)
- [Upgrading Pyodide](#upgrading-pyodide)
- [Theme colour and icon](#theme-colour-and-icon)

---

## App colours

The colours for the app's own output kinds are set in `app.js`:

```js
const COLORS = {
  err: '#ff7b72', prompt: '#ffd43b', input: '#e6edf3',
  info: '#7d8b99', result: '#79c0ff', accent: '#7ee787',
};
```

`out` (program output) has no entry: it uses the terminal's default foreground.

## Terminal palette

The 16 base ANSI colours are in `terminal.js`:

```js
const BASE16 = [
  '#2d333b', '#f47067', '#57ab5a', '#c69026', '#539bf5', '#b083f0', '#39c5cf', '#c9d1d9',
  '#636e7b', '#ff938a', '#6bc46d', '#daaa3f', '#6cb6ff', '#dcbdfb', '#56d4dd', '#f0f6fc',
];
```

Order: black, red, green, yellow, blue, magenta, cyan, white, then the bright variants. Indexes 16–255 are generated (6×6×6 colour cube and greyscale ramp) and normally need no changes.

Example: the classic xterm palette:

```js
const BASE16 = [
  '#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
  '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
];
```

## Default foreground and background

Change them in three places so everything stays consistent:

1. `terminal.js`: `DEFAULT_FG` and `DEFAULT_BG` (used for inverse video).
2. `index.html` CSS: `#output { color: … }`, `html, body { background: … }`, and the `.cur` cursor colours.
3. `index.html`: `<meta name="theme-color">` and the `bg-[#0b0f14]` / `bg-[#0d1218]` Tailwind classes on the header and status bar.

## Prompts

In `app.js`:

```js
const PS1 = '>>> ';
const PS2 = '... ';
```

The prompt colour is `COLORS.prompt`.

## Fonts and font size

- The font families are loaded from Google Fonts in `index.html` (`Inter` for the UI, `JetBrains Mono` for the terminal). To change the terminal font, edit the `<link>` and the `.mono` rule.
- The default size is the `14` in `app.js` (`sessionStorage.getItem('pyterm-font') || '14'`). The allowed range is set in the font button handlers (`Math.min(24, …)`, `Math.max(10, …)`).

Use a monospaced font: column calculations assume every character is the same width.

## Line height

`#screen { line-height: 1.55; }` and `.tl { min-height: 1.55em; }` in `index.html`. Keep the two values the same. `fit()` measures the real line height, so the row count adjusts automatically.

## Banner

Edit `banner()` in `app.js`. Each `write(text, kind)` call adds one coloured segment.

## Limits

| Setting | File | Default |
|---|---|---|
| Scrollback lines | `terminal.js` → `MAX_LINES` | 5000 |
| History entries | `app.js` → `addHistory` (`> 500`) | 500 |
| Result repr length | `repl.py` → `MAX_REPR` | 8000 |
| Completion candidates listed | `app.js` → `doComplete` (`slice(0, 300)`) | 300 |
| stdin buffer for one `input()` line | `engine.js` → `STDIN_BYTES` | 1 MiB |
| Output batch size / interval | `py-worker.js` → `out()` (`65536`, `12` ms) | 64 KB / 12 ms |
| Upload size warning | `upload.js` → `BIG` | 200 MB |
| Tree lines after an upload | `upload.js` → `engine.call('tree', { limit: 40 })` | 40 |
| OSC payload length | `terminal.js` → `_feed` (`4096`) | 4096 |
| CSI parameter length | `terminal.js` → `_feed` (`256`) | 256 |

## Cursor appearance

The block cursor shown while code runs uses the `.cur` class:

```css
.cur { background: #ffd43b; color: #0b0f14; }
```

For an underline cursor, for example: `.cur { box-shadow: inset 0 -2px #ffd43b; }`. For a blinking cursor, add `animation: tblink 1s steps(1) infinite;`.

## Bell

`BEL` calls `onBell` in `app.js`, which adds the `bell` class to `#screen` to play a short background flash (`@keyframes bell` in `index.html`). To also play a sound:

```js
onBell: () => {
  const ctx = new AudioContext(), o = ctx.createOscillator();
  o.frequency.value = 880; o.connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime + 0.08);
},
```

## Adding REPL helpers

Add entries to the namespace dictionary in `make_console()` in `repl.py`:

```python
def now():
    """Current time as a string."""
    import datetime
    return datetime.datetime.now().isoformat(timespec="seconds")

namespace = {
    ...
    "now": now,
}
```

Helpers are added again after every Restart. Helpers meant for programs belong in `pyterm_lib.py` (the `pyterm` module) instead.

## Adding programs

Put a `.py` file in `programs/` and list it in `programs/index.json` (`id`, `file`, `title`, `description`). For the Puter menu bar, add a line to the *Programs* menu in `setupPuterApp()` in `app.js`. Details in [Custom Programs](custom-programs.md#adding-a-program-to-the-programs-menu).

## Upload defaults

In `index.html` (Upload dialog markup):

- Default destination: `<input id="up-dest" … value="Upload">`.
- Default conflict policy: the first `<option>` of `#up-policy`.
- *Extract archives* / *Into a folder named after each archive*: the `checked` attribute on `#up-extract` / `#up-subfolder`.

In `upload.js`: `ZIP_BASED` lists extensions that are ZIPs inside but are copied as they are; `ARCHIVE_EXT` lists the archive extensions.

## Stop timeout

When Stop can't interrupt Python, it is restarted after 2.5 s. Change `2500` in `interrupt()` in `app.js`.

## Preloading packages

Packages are loaded automatically when an `import` line mentions them. To have some ready before the first prompt, load them in `init()` in `py-worker.js`, just before `runPython(repl, …)`:

```js
await py.loadPackage(['numpy', 'micropip']);
```

Preloaded packages make the first load slower.

## Running startup code

To run Python before the first prompt (imports, settings), run it in the REPL namespace at the end of `make_console()` in `repl.py`, so it runs again on every Restart:

```python
def make_console():
    ...
    console = SafeConsole(...)
    exec("import math, json, re", namespace)
```

## Upgrading Pyodide

The version appears in two places:

- `py-worker.js`: `import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';`
- `index.html`: the `<link rel="modulepreload" …>` hint.

The latest version is on npm (`pyodide`) and in the Pyodide changelog. After upgrading, check:

- `pyodide.console.PyodideConsole` still has `push`, `complete`, `buffer` and an async `runcode(source, code)`; the future from `push` still has `syntax_check` and `formatted_error`.
- `pyodide.ffi.run_sync` / `can_run_sync` (stack switching) and `setInterruptBuffer` still exist.
- `FS.filesystems.IDBFS` and `FS.syncfs` are still exported (used for `~/browser`).

## Theme colour and icon

- `<meta name="theme-color" content="#0b0f14">` in `index.html` sets the browser UI colour.
- `icon.svg` is the app icon (also shown in the header). Keep it square with a `viewBox`.
