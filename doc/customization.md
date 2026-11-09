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
- [Preloading packages](#preloading-packages)
- [Running startup code](#running-startup-code)
- [Upgrading PyScript / Pyodide](#upgrading-pyscript--pyodide)
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

Helpers are added again after every Restart.

## Preloading packages

To make packages available at startup, add a PyScript config to the `<script type="py">` tag in `index.html`:

```html
<script type="py" src="./repl.py" config='{"packages": ["numpy", "rich"]}'></script>
```

Or use a separate `pyscript.toml`:

```toml
packages = ["numpy", "rich"]
```

```html
<script type="py" src="./repl.py" config="./pyscript.toml"></script>
```

Preloaded packages make the first load slower.

## Running startup code

To run Python before the first prompt (imports, settings), run it in the REPL namespace at the end of `make_console()`, so it runs again on every Restart:

```python
def make_console():
    ...
    console = SafeConsole(...)
    exec("import math, json, re", namespace)
```

## Upgrading PyScript / Pyodide

The PyScript version is set in two tags in `index.html`:

```html
<link rel="stylesheet" href="https://pyscript.net/releases/2024.11.1/core.css" />
<script type="module" src="https://pyscript.net/releases/2024.11.1/core.js"></script>
```

Change both to the new release. Then check:

- `pyodide.console.PyodideConsole` still has `push`, `complete`, `buffer` and an async `runcode(source, code)`. `SafeConsole` overrides `runcode`.
- The future returned by `push` still has `syntax_check` and `formatted_error`.

## Theme colour and icon

- `<meta name="theme-color" content="#0b0f14">` in `index.html` sets the browser UI colour.
- `icon.svg` is the app icon (also shown in the header). Keep it square with a `viewBox`.
