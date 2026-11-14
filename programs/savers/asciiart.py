"""ASCII art: a plasma made of characters behind a wavy rainbow banner."""
import math

from termgfx import font, hsv

RAMP = " .:-=+*#%@"
SUBTITLE = "Python 3.14 · running in your browser"


class AsciiArt:
    key = "ascii"
    title = "ASCII art"
    fps = 15  # the plasma redraws every cell, so a calmer frame rate is plenty

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.t = 0.0
        self.word = "PYTERM" if w >= font.width("PYTERM") + 4 else "PY"
        self.rows = font.render(self.word)
        self.bw = font.width(self.word)

    def update(self, dt, t):
        self.t = t

    def draw(self, scr):
        w, h, t = self.w, self.h, self.t
        # plasma: sum of a few sine waves, mapped to characters and a small palette
        base = t * 0.04
        palette = [hsv(base + lvl * 0.07, 0.75, 0.16 + lvl * 0.07) for lvl in range(10)]
        cols = [math.sin(x * 0.11 + t * 1.1) for x in range(w)]
        rows = [math.sin(y * 0.23 - t * 0.8) for y in range(h)]
        cx, cy = w / 2, h / 2
        for y in range(h):
            ry = rows[y]
            dy = (y - cy) * 2
            for x in range(w):
                d = math.sqrt((x - cx) ** 2 + dy * dy) * 0.09
                v = (cols[x] + ry + math.sin(d - t * 1.5) + 3) / 6
                lvl = int(v * 9.99)
                scr.put(x, y, RAMP[lvl], fg=palette[lvl])
        # wavy rainbow banner with a drop shadow
        bx = (w - self.bw) // 2
        by = h // 2 - 4
        waves = [round(math.sin(t * 2.5 + ci * 0.22) * 1.4) for ci in range(self.bw)]
        for pass_ in (0, 1):
            for ci in range(self.bw):
                col = hsv(t * 0.15 + ci / self.bw * 0.8, 0.8, 1.0)
                for r in range(font.HEIGHT):
                    if self.rows[r][ci] == "#":
                        if pass_ == 0:
                            scr.put(bx + ci + 1, by + r + waves[ci] + 1, "█", fg=(0, 0, 0))
                        else:
                            scr.put(bx + ci, by + r + waves[ci], "█", fg=col)
        # typewriter subtitle with a blinking cursor
        n = min(len(SUBTITLE), int(t * 14))
        text = SUBTITLE[:n] + ("▌" if int(t * 3) % 2 == 0 else " ")
        sx = (w - len(SUBTITLE)) // 2
        scr.text(sx - 1, by + 8, " " * (len(SUBTITLE) + 3), bg=(0, 0, 0))
        scr.text(sx, by + 8, text, fg=(235, 240, 245), bg=(0, 0, 0))
