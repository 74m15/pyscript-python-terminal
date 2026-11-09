# Terminal Emulator Reference

`terminal.js` implements a compact terminal emulator compatible with VT100 / VT220 / xterm that renders to the DOM. This document lists every control function it understands, how each one behaves, and the JavaScript API.

- [Model](#model)
- [C0 control characters](#c0-control-characters)
- [C1 control characters](#c1-control-characters)
- [ESC sequences](#esc-sequences)
- [CSI sequences](#csi-sequences)
- [ANSI modes (SM / RM)](#ansi-modes-sm--rm)
- [DEC private modes (DECSET / DECRST)](#dec-private-modes-decset--decrst)
- [SGR: Select Graphic Rendition](#sgr-select-graphic-rendition)
- [Colour palette](#colour-palette)
- [OSC sequences](#osc-sequences)
- [Device control and other strings](#device-control-and-other-strings)
- [Character sets](#character-sets)
- [Unicode handling](#unicode-handling)
- [Not supported](#not-supported)
- [JavaScript API](#javascript-api)

Notation: `ESC` = `\x1b`, `CSI` = `ESC [`, `OSC` = `ESC ]`, `ST` = `ESC \`. `Pn` = numeric parameter (default shown in parentheses). Parameters are separated by `;`, and sub-parameters by `:`.

---

## Model

| Concept | Behaviour |
|---|---|
| **Screen size** | `cols × rows`, computed from the window size (see [Architecture](architecture.md#terminal-sizing)). Defaults to 80×24 before the first fit. |
| **Normal buffer** | The visible screen is the last `rows` lines of the buffer; earlier lines form the scrollback (max **5,000** lines; the oldest are dropped). |
| **Alternate buffer** | Exactly `rows` lines, no scrollback. Used by full-screen programs. |
| **Cursor** | Column `x` and line `y` per buffer. Cursor *rows* in sequences are relative to the top of the visible screen. |
| **Pending wrap** | Printing in the last column leaves the cursor there with a "wrap pending" flag (DEC behaviour). The next printable character wraps to a new line first. Any cursor movement or CR clears the flag. |
| **Scroll region** | Top and bottom margins (DECSTBM). Index/reverse index, IL/DL and SU/SD act inside the region. Lines only move into the scrollback when the region is the full screen of the normal buffer. |
| **Tab stops** | Every 8 columns by default; can be set and cleared. |
| **Erase colour** | Erase operations fill with the current background colour (background colour erase, BCE). |
| **Line feed** | LF moves down **and** returns to column 0, like a Unix tty with `onlcr`, which is what Python output expects. |

---

## C0 control characters

| Char | Hex | Name | Action |
|---|---|---|---|
| `\a` | 07 | BEL | Rings the bell (the terminal flashes briefly). Also terminates OSC strings. |
| `\b` | 08 | BS | Cursor left one column (stops at column 0). Clears pending wrap. |
| `\t` | 09 | HT | Moves to the next tab stop (or the last column). |
| `\n` | 0A | LF | Index (down one line, scrolling at the bottom margin), then carriage return. |
| `\v` | 0B | VT | Index. Also carriage return when LNM is set. |
| `\f` | 0C | FF | Index. Also carriage return when LNM is set. |
| `\r` | 0D | CR | **Moves the cursor to column 0 of the current line.** Following output overwrites the line from the start. Clears pending wrap. |
| | 0E | SO | Shift Out: use the G1 character set. |
| | 0F | SI | Shift In: use the G0 character set. |
| | 18 | CAN | Cancels the escape sequence in progress. |
| | 1A | SUB | Cancels the sequence in progress and prints `␦`. |
| `\x1b` | 1B | ESC | Starts an escape sequence (and ends an open OSC string). |
| | 7F | DEL | Ignored. |

All other C0 characters are ignored. C0 controls are also carried out *inside* ESC and CSI sequences, as on a real VT100.

### `\r` in practice

```python
print("hello world\rHELLO")          # → HELLO world
print("Loading...\r\x1b[2KDone")     # CR, erase line, then write → Done
for i in range(101):
    print(f"\rProgress {i}%", end="")   # updates in place
```

---

## C1 control characters

In ground state, the 8-bit C1 characters `0x80–0x9F` are treated as their 7-bit `ESC` equivalents (`0x84` = IND, `0x85` = NEL, `0x88` = HTS, `0x8D` = RI, `0x8E` = SS2, `0x8F` = SS3, `0x90` = DCS, `0x9B` = CSI, `0x9C` = ST, `0x9D` = OSC, …).

---

## ESC sequences

| Sequence | Name | Action |
|---|---|---|
| `ESC 7` | DECSC | Save cursor: position, attributes, character sets, GL, origin mode, pending-wrap flag |
| `ESC 8` | DECRC | Restore cursor (homes and resets attributes if nothing was saved) |
| `ESC D` | IND | Index: down one line, scrolling at the bottom margin |
| `ESC E` | NEL | Next line: index then carriage return |
| `ESC M` | RI | Reverse index: up one line, scrolling down at the top margin |
| `ESC H` | HTS | Set a tab stop at the cursor column |
| `ESC c` | RIS | Full reset: modes, attributes, charsets, tabs, margins; clears screen and scrollback |
| `ESC N` | SS2 | Single shift: the next character uses G2 |
| `ESC O` | SS3 | Single shift: the next character uses G3 |
| `ESC n` | LS2 | Use G2 as GL |
| `ESC o` | LS3 | Use G3 as GL |
| `ESC ( C` | SCS G0 | Designate character set `C` into G0 |
| `ESC ) C` | SCS G1 | Designate into G1 |
| `ESC * C` | SCS G2 | Designate into G2 |
| `ESC + C` | SCS G3 | Designate into G3 |
| `ESC # 3` | DECDHL | Current line becomes double-height, top half |
| `ESC # 4` | DECDHL | Current line becomes double-height, bottom half |
| `ESC # 5` | DECSWL | Current line becomes single-width |
| `ESC # 6` | DECDWL | Current line becomes double-width |
| `ESC # 8` | DECALN | Screen alignment test: fill the screen with `E`, reset margins, home cursor |
| `ESC [` | CSI | Control Sequence Introducer |
| `ESC ]` | OSC | Operating System Command |
| `ESC P` | DCS | Device Control String (consumed and ignored) |
| `ESC X` / `ESC ^` / `ESC _` | SOS / PM / APC | Strings consumed and ignored |
| `ESC \` | ST | String terminator |
| `ESC =` / `ESC >` | DECKPAM / DECKPNM | Keypad modes: accepted, no effect (there is no key reporting) |

Character set codes `C`: `B` = US ASCII, `0` = DEC Special Graphics, `A` = UK. Any other code is treated as ASCII.

---

## CSI sequences

Missing parameters, or parameters set to `0` where a count is expected, use the default.

### Cursor movement

| Sequence | Name | Action |
|---|---|---|
| `CSI Pn A` | CUU | Cursor up `Pn` (1). Stops at the top margin if the cursor is inside the region, otherwise at row 1 |
| `CSI Pn B` | CUD | Cursor down `Pn` (1). Stops at the bottom margin or the last row |
| `CSI Pn e` | VPR | Same as CUD |
| `CSI Pn C` | CUF | Cursor forward `Pn` (1), stops at the last column |
| `CSI Pn a` | HPR | Same as CUF |
| `CSI Pn D` | CUB | Cursor back `Pn` (1), stops at column 1 |
| `CSI Pn E` | CNL | Cursor down `Pn` lines, to column 1 |
| `CSI Pn F` | CPL | Cursor up `Pn` lines, to column 1 |
| `CSI Pn G` | CHA | Cursor to column `Pn` (1) |
| `` CSI Pn ` `` | HPA | Same as CHA |
| `CSI Pr ; Pc H` | CUP | Cursor to row `Pr` (1), column `Pc` (1). Relative to the scroll region in origin mode |
| `CSI Pr ; Pc f` | HVP | Same as CUP |
| `CSI Pn d` | VPA | Cursor to row `Pn` (1), keeping the column |
| `CSI s` | SCOSC | Save cursor (same as DECSC) |
| `CSI u` | SCORC | Restore cursor (same as DECRC) |

### Erasing

| Sequence | Name | Action |
|---|---|---|
| `CSI 0 J` / `CSI J` | ED | Erase from the cursor to the end of the screen |
| `CSI 1 J` | ED | Erase from the start of the screen to the cursor (inclusive) |
| `CSI 2 J` | ED | Erase the whole visible screen (the scrollback is kept) |
| `CSI 3 J` | ED | Erase the scrollback (normal buffer only) |
| `CSI 0 K` / `CSI K` | EL | Erase from the cursor to the end of the line |
| `CSI 1 K` | EL | Erase from the start of the line to the cursor (inclusive) |
| `CSI 2 K` | EL | Erase the whole line |
| `CSI ? Ps J` / `CSI ? Ps K` | DECSED / DECSEL | Selective erase, treated like ED / EL |
| `CSI Pn X` | ECH | Erase `Pn` (1) characters from the cursor, without moving anything |

### Inserting, deleting, repeating

| Sequence | Name | Action |
|---|---|---|
| `CSI Pn @` | ICH | Insert `Pn` (1) blank characters at the cursor; the rest of the line shifts right and is cut at the right edge |
| `CSI Pn P` | DCH | Delete `Pn` (1) characters at the cursor; the rest of the line shifts left |
| `CSI Pn L` | IL | Insert `Pn` (1) blank lines at the cursor row (inside the scroll region); cursor to column 1 |
| `CSI Pn M` | DL | Delete `Pn` (1) lines at the cursor row (inside the scroll region); cursor to column 1 |
| `CSI Pn b` | REP | Repeat the last printed character `Pn` (1) times (capped at cols × rows) |

### Scrolling and margins

| Sequence | Name | Action |
|---|---|---|
| `CSI Pt ; Pb r` | DECSTBM | Set the scroll region from row `Pt` (1) to `Pb` (rows). Ignored unless `Pt < Pb`. Homes the cursor |
| `CSI Pn S` | SU | Scroll the region up `Pn` (1) lines |
| `CSI Pn T` | SD | Scroll the region down `Pn` (1) lines (the 5-parameter mouse-tracking form is ignored) |

### Tabs

| Sequence | Name | Action |
|---|---|---|
| `CSI Pn I` | CHT | Forward `Pn` (1) tab stops |
| `CSI Pn Z` | CBT | Back `Pn` (1) tab stops |
| `CSI 0 g` / `CSI g` | TBC | Clear the tab stop at the cursor column |
| `CSI 3 g` | TBC | Clear all tab stops |

### Other

| Sequence | Name | Action |
|---|---|---|
| `CSI Ps m` | SGR | Set text attributes, see [SGR](#sgr-select-graphic-rendition) |
| `CSI Ps h` / `CSI Ps l` | SM / RM | Set / reset ANSI modes |
| `CSI ? Ps h` / `CSI ? Ps l` | DECSET / DECRST | Set / reset DEC private modes |
| `CSI ! p` | DECSTR | Soft reset: cursor visible, insert/origin off, autowrap on, full-screen margins, default attributes, ASCII charsets, saved cursor cleared |

Several modes can be set at once: `CSI ? 25 ; 7 h`.

---

## ANSI modes (SM / RM)

| Mode | Name | Set (`h`) | Reset (`l`, default) |
|---|---|---|---|
| 4 | IRM | Insert mode: printed characters push the rest of the line to the right | Replace mode |
| 20 | LNM | VT and FF also return to column 0 | VT and FF move down only |

---

## DEC private modes (DECSET / DECRST)

| Mode | Name | Set (`h`) | Reset (`l`) |
|---|---|---|---|
| 3 | DECCOLM | The column count is fixed by the window, but, as on a VT100, the screen is cleared, margins reset and the cursor homed | Same |
| 5 | DECSCNM | Reverse video for the whole screen | Normal video (default) |
| 6 | DECOM | Origin mode: CUP/VPA rows are relative to the scroll region and the cursor is kept inside it; homes the cursor | Absolute positions (default); homes the cursor |
| 7 | DECAWM | Auto-wrap at the right margin (default) | No wrap: further characters overwrite the last column |
| 25 | DECTCEM | Show the cursor (default) | Hide the cursor |
| 47 | — | Switch to the alternate buffer | Switch back to the normal buffer |
| 1047 | — | Switch to the alternate buffer and clear it | Switch back to the normal buffer |
| 1048 | — | Save the cursor | Restore the cursor |
| 1049 | — | Save the cursor, switch to the alternate buffer and clear it | Switch back to the normal buffer and restore the cursor |

The normal buffer, including its scrollback, is kept untouched while the alternate buffer is active.

---

## SGR: Select Graphic Rendition

`CSI Ps ; Ps ; … m`. An empty parameter list means `0`.

| Code | Effect | Code | Reset |
|---|---|---|---|
| 0 | Reset all attributes (an open OSC 8 link stays open) | | |
| 1 | Bold (basic colours 0–7 are shown in their bright variant) | 22 | Normal intensity (clears bold and dim) |
| 2 | Dim / faint | 22 | |
| 3 | Italic | 23 | Not italic |
| 4 | Underline | 24 | Not underlined |
| 4:0 – 4:5 | Underline style: none, single, double, curly, dotted, dashed | 24 | |
| 21 | Double underline | 24 | |
| 5, 6 | Blink (slow / rapid, both shown as a 1 s blink) | 25 | Not blinking |
| 7 | Inverse (swap foreground and background) | 27 | Not inverse |
| 8 | Hidden / concealed | 28 | Visible |
| 9 | Strikethrough | 29 | Not struck through |
| 53 | Overline | 55 | Not overlined |
| 30–37 | Foreground: basic colours 0–7 | 39 | Default foreground |
| 90–97 | Foreground: bright colours 8–15 | 39 | |
| 40–47 | Background: basic colours 0–7 | 49 | Default background |
| 100–107 | Background: bright colours 8–15 | 49 | |
| 38;5;N / 38:5:N | Foreground: 256-colour index N | 39 | |
| 38;2;R;G;B / 38:2::R:G:B / 38:2:R:G:B | Foreground: truecolor | 39 | |
| 48;5;N / 48;2;R;G;B | Background: 256 colours / truecolor | 49 | |
| 58;5;N / 58;2;R;G;B | Underline colour | 59 | Default underline colour |

Unknown codes are ignored. Several codes can be combined: `CSI 1;3;38;5;208m` = bold italic orange.

---

## Colour palette

| Index | Colour | Index | Colour |
|---|---|---|---|
| 0 black | `#2d333b` | 8 bright black | `#636e7b` |
| 1 red | `#f47067` | 9 bright red | `#ff938a` |
| 2 green | `#57ab5a` | 10 bright green | `#6bc46d` |
| 3 yellow | `#c69026` | 11 bright yellow | `#daaa3f` |
| 4 blue | `#539bf5` | 12 bright blue | `#6cb6ff` |
| 5 magenta | `#b083f0` | 13 bright magenta | `#dcbdfb` |
| 6 cyan | `#39c5cf` | 14 bright cyan | `#56d4dd` |
| 7 white | `#c9d1d9` | 15 bright white | `#f0f6fc` |

- **16–231**: the standard 6×6×6 colour cube, levels `0, 95, 135, 175, 215, 255`.
- **232–255**: a 24-step greyscale ramp from `#080808` to `#eeeeee`.
- **Default foreground** `#d6dde6`, **default background** `#0b0f14`.

To change the palette, see [Customization](customization.md#terminal-palette).

---

## OSC sequences

Terminated by `BEL` (`\x07`), `ST` (`ESC \`) or the 8-bit `ST` (`\x9c`). Payloads longer than 4,096 characters are cut off.

| Sequence | Action |
|---|---|
| `OSC 0 ; text BEL` | Set the window title (shown in the header and the browser tab) |
| `OSC 2 ; text BEL` | Same as OSC 0 |
| `OSC 8 ; params ; URL BEL` | Start a hyperlink: following text links to `URL` |
| `OSC 8 ; ; BEL` | End the hyperlink |

Only `http:`, `https:`, `mailto:` and `ftp:` URLs become clickable; anything else is shown as plain text. Links open in a new tab with `rel="noopener noreferrer"`. An empty title restores the default.

```python
print("\x1b]2;My Program\x07")
print("\x1b]8;;https://docs.python.org\x07Python docs\x1b]8;;\x07")
```

Other OSC numbers (for example palette changes or clipboard access) are accepted and ignored.

---

## Device control and other strings

`DCS` (`ESC P`), `SOS` (`ESC X`), `PM` (`ESC ^`) and `APC` (`ESC _`) strings are consumed up to their terminator and ignored, so their content never shows up as text (this covers Sixel, for example).

---

## Character sets

Four slots, G0–G3, can each be given a character set (`ESC ( ) * +`). GL, the set in use, is chosen with SI/SO/LS2/LS3, or for a single character with SS2/SS3.

**DEC Special Graphics (`0`)** maps these characters:

| In | Out | In | Out | In | Out | In | Out |
|---|---|---|---|---|---|---|---|
| `` ` `` | ◆ | `a` | ▒ | `f` | ° | `g` | ± |
| `j` | ┘ | `k` | ┐ | `l` | ┌ | `m` | └ |
| `n` | ┼ | `o` | ⎺ | `p` | ⎻ | `q` | ─ |
| `r` | ⎼ | `s` | ⎽ | `t` | ├ | `u` | ┤ |
| `v` | ┴ | `w` | ┬ | `x` | │ | `y` | ≤ |
| `z` | ≥ | `{` | π | `\|` | ≠ | `}` | £ |
| `~` | · | `_` | (space) | `b` `c` `d` `e` `h` `i` | ␉ ␌ ␍ ␊ ␤ ␋ | | |

**UK (`A`)** maps `#` to `£`.

---

## Unicode handling

- Input is processed by code point, so characters outside the BMP (emoji) are handled correctly.
- **Wide characters** (CJK, Hangul, full-width forms, most emoji) take two cells. A wide character that does not fit in the last column wraps first (or is placed one column earlier when auto-wrap is off).
- **Zero-width characters** (combining marks, variation selectors, ZWJ and similar) attach to the previous cell.
- Overwriting half of a wide character turns the other half into a space.

---

## Not supported

These need a reply channel, keyboard or mouse reporting, or hardware features that a REPL output stream doesn't have. They are recognised and ignored:

| Feature | Sequences |
|---|---|
| Status reports | DSR / CPR `CSI 5n`, `CSI 6n`; DA `CSI c`, `CSI > c`; DECRQM, XTVERSION |
| Window operations | `CSI … t` |
| Cursor style | DECSCUSR `CSI Ps SP q` |
| Mouse tracking, bracketed paste, focus events | `CSI ? 1000 h`, `?1002`, `?1006`, `?2004`, `?1004`, … |
| Application cursor keys and keypad | `CSI ? 1 h`, `ESC =` (accepted, no effect) |
| Left/right margins | DECSLRM, `CSI ? 69 h` |
| Palette changes, clipboard | OSC 4, 10, 11, 52, … |
| Graphics | Sixel, ReGIS, iTerm/kitty image protocols |
| Reflow | Text is not re-wrapped when the window is resized |

---

## JavaScript API

```js
import { Terminal } from './terminal.js';

const term = new Terminal(rootElement, {
  onRender: () => {},          // called after every DOM update
  onBell:   () => {},          // BEL received
  onTitle:  (title) => {},     // OSC 0 / 2
});
```

### Methods

| Method | Description |
|---|---|
| `write(text)` | Parse and display `text` (any mix of characters and escape sequences). Rendering is batched into the next animation frame. |
| `writeKind(text, color)` | Write app-generated text whose default foreground is `color` (or the normal default when `null`). The program's SGR state and any half-finished escape sequence are reset around the call, so app messages never pick up program colours and vice versa. |
| `prepareForPrompt()` | Cancel any half-finished escape sequence and, if the cursor isn't at column 0, move to the start of a new line. |
| `attachInput(el)` | Place element `el` (the input row) in the active buffer at the cursor line and hide that line. |
| `detachInput()` | Restore the hidden line and stop tracking the input element (it stays where it is; the caller hides it). |
| `clear()` | Leave the alternate screen, clear the screen and scrollback, home the cursor. Modes and attributes are kept. |
| `reset()` | Full reset (RIS) plus `clear()`. |
| `resize(cols, rows)` | Change the size. Resets the scroll region and tab stops, clamps the cursor, resizes the alternate buffer. |
| `getText()` | The normal buffer as plain text: wrapped lines joined, trailing whitespace trimmed, one trailing newline. |
| `renderNow()` | Render at once instead of waiting for the next frame. |

### Properties

| Property | Description |
|---|---|
| `cols`, `rows` | Current size (read-only; change it with `resize`) |
| `showCursor` | Whether the emulator draws its block cursor. `app.js` turns it on while code runs and off while the input line is shown. The cursor also needs DECTCEM to be on. |
| `buf` | The active buffer (`normal` or `alt`) |

### CSS hooks

| Selector | Purpose |
|---|---|
| `.tbuf` | Container of one buffer |
| `.tl` | One terminal line (`white-space: pre`) |
| `.tl.dw` / `.tl.dht` / `.tl.dhb` | Double-width / double-height top / double-height bottom lines; their content is wrapped in `.ln` and scaled |
| `.w2` | A wide character (2ch wide) |
| `.cur` | The cell under the block cursor |
| `.blink` | Blinking text |
| `#output.reverse-video` | Added to the root while DECSCNM is set |
