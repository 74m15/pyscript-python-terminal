"""A character-cell frame buffer that redraws only what changed."""
import math
import shutil
import sys

CSI = "\x1b["


def _sgr(fg, bg):
    parts = ["0"]
    if fg is not None:
        parts.append("38;2;%d;%d;%d" % fg)
    if bg is not None:
        parts.append("48;2;%d;%d;%d" % bg)
    return CSI + ";".join(parts) + "m"


def _cell(v):
    return v if v.__class__ is int else math.floor(v)


class Screen:
    """Full-screen drawing surface.

    Coordinates are character cells: x = column (0 = left), y = row (0 = top).
    Floats are accepted and rounded down. Colours are (r, g, b) tuples or None
    (terminal default). Use it as a context manager to switch to the alternate
    screen and hide the cursor; everything is restored on exit, even on errors.
    """

    def __init__(self, bg=None):
        self.bg = bg
        self.resize()

    # -- setup
    def resize(self):
        cols, rows = shutil.get_terminal_size((80, 24))
        self.w = max(20, cols)
        self.h = max(8, rows)
        self.cells = [(" ", None, self.bg)] * (self.w * self.h)
        self.prev = None

    def __enter__(self):
        sys.stdout.write("\x1b[?1049h\x1b[?25l\x1b[0m\x1b[2J\x1b[H")
        sys.stdout.flush()
        self.prev = None
        return self

    def __exit__(self, *exc):
        sys.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l")
        sys.stdout.flush()
        return False

    # -- drawing
    def clear(self, bg=None):
        self.cells = [(" ", None, self.bg if bg is None else bg)] * (self.w * self.h)

    def size_changed(self):
        """True when the terminal was resized since resize() was last called."""
        cols, rows = shutil.get_terminal_size((80, 24))
        return (max(20, cols), max(8, rows)) != (self.w, self.h)

    def erase(self, x, y, w, h):
        """Reset a rectangle to blank cells with the screen's background."""
        x, y = _cell(x), _cell(y)
        blank = (" ", None, self.bg)
        for row in range(max(0, y), min(self.h, y + h)):
            base = row * self.w
            for col in range(max(0, x), min(self.w, x + w)):
                self.cells[base + col] = blank

    def put(self, x, y, ch, fg=None, bg=None):
        """Set one cell. bg=None keeps the background already there."""
        x = _cell(x)
        y = _cell(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            i = y * self.w + x
            self.cells[i] = (ch, fg, self.cells[i][2] if bg is None else bg)

    def get(self, x, y):
        x, y = _cell(x), _cell(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.cells[y * self.w + x]
        return None

    def text(self, x, y, s, fg=None, bg=None):
        x = _cell(x)
        for i, ch in enumerate(str(s)):
            self.put(x + i, y, ch, fg, bg)

    def fill(self, x, y, w, h, ch=" ", fg=None, bg=None):
        x, y = _cell(x), _cell(y)
        for row in range(max(0, y), min(self.h, y + h)):
            for col in range(max(0, x), min(self.w, x + w)):
                self.put(col, row, ch, fg, bg)

    def line(self, x0, y0, x1, y1, ch, fg=None, bg=None):
        """Bresenham line between two cells."""
        x0, y0, x1, y1 = _cell(x0), _cell(y0), _cell(x1), _cell(y1)
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        for _ in range(dx - dy + 1):
            self.put(x0, y0, ch, fg, bg)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def box(self, x, y, w, h, fg=None, bg=None):
        """Rounded box outline."""
        x, y = _cell(x), _cell(y)
        if w < 2 or h < 2:
            return
        self.text(x, y, "╭" + "─" * (w - 2) + "╮", fg, bg)
        self.text(x, y + h - 1, "╰" + "─" * (w - 2) + "╯", fg, bg)
        for row in range(y + 1, y + h - 1):
            self.put(x, row, "│", fg, bg)
            self.put(x + w - 1, row, "│", fg, bg)

    # -- output
    def present(self):
        """Send the changed cells to the terminal in one write."""
        w, cells, prev = self.w, self.cells, self.prev
        out = [] if prev is not None else ["\x1b[0m\x1b[2J"]
        cur = None
        for y in range(self.h):
            base = y * w
            x = 0
            while x < w:
                if prev is not None and prev[base + x] == cells[base + x]:
                    x += 1
                    continue
                out.append("%s%d;%dH" % (CSI, y + 1, x + 1))
                while x < w:
                    c = cells[base + x]
                    if prev is not None and prev[base + x] == c:
                        break
                    style = (c[1], c[2])
                    if style != cur:
                        out.append(_sgr(c[1], c[2]))
                        cur = style
                    out.append(c[0])
                    x += 1
        if out:
            out.append(CSI + "0m")
            sys.stdout.write("".join(out))
            sys.stdout.flush()
        self.prev = list(cells)
