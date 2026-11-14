"""Matrix rain: streams of glyphs falling down the screen, with a bright head and a
fading green tail. Columns run at different depths (near = fast and bright, far =
slow and dim), the glyphs flicker, and now and then a hidden message is revealed.
"""
import random

# Only single-width characters, so every column stays aligned in the terminal.
GLYPHS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$+-*/=%#&@<>?!:;|^~ΣΞΨΩλπδθ"
MESSAGES = ("WAKE UP", "FOLLOW THE WHITE RABBIT", "THERE IS NO SPOON", "HELLO FROM PYTHON")

HEAD = (235, 255, 240)


def _green(k, depth):
    """Tail colour: k = 1 right behind the head, 0 at the end of the tail."""
    v = (0.18 + 0.82 * k) * depth
    return (int(20 * v), int(255 * v), int(70 * v))


class _Drop:
    __slots__ = ("y", "speed", "length", "depth")

    def __init__(self, h, start_above=True):
        self.depth = random.choice((0.45, 0.7, 1.0, 1.0))
        self.speed = random.uniform(6, 14) * (0.55 + 0.6 * self.depth)
        self.length = random.randint(max(4, h // 4), max(6, int(h * 0.9)))
        # the first streams are spread over the screen so the rain starts at once
        self.y = random.uniform(-h * 0.8, h * 1.2) if start_above else -1.0


class MatrixRain:
    key = "matrix"
    title = "Matrix rain"
    fps = 24

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.cols = list(range(0, w, 2)) if w > 60 else list(range(w))
        self.glyph = [[random.choice(GLYPHS) for _ in range(h)] for _ in range(w)]
        self.drops = {x: [_Drop(h)] for x in self.cols}
        self.message = None
        self.next_message = random.uniform(4, 7)

    def _new_message(self, t):
        text = random.choice(MESSAGES)
        if len(text) > self.w - 4:
            text = text[: self.w - 4]
        x0 = (self.w - len(text)) // 2
        y0 = self.h // 2
        # each letter lights up when a stream passes over it
        self.message = {"text": text, "x": x0, "y": y0, "lit": [False] * len(text), "start": t, "until": t + 4.5}

    def update(self, dt, t):
        h = self.h
        for x, drops in self.drops.items():
            for d in drops:
                d.y += d.speed * dt
            # recycle drops whose tail left the screen; sometimes start a second stream
            drops[:] = [d for d in drops if d.y - d.length < h]
            if not drops or (drops[-1].y - drops[-1].length > random.uniform(0, h) and len(drops) < 3):
                drops.append(_Drop(h, start_above=False))
                drops[-1].y = -random.uniform(0, h * 0.3)
        # flicker: a few random glyphs change every frame
        for _ in range(max(1, (self.w * h) // 60)):
            gx, gy = random.randrange(self.w), random.randrange(h)
            self.glyph[gx][gy] = random.choice(GLYPHS)
        if self.message is None and t >= self.next_message:
            self._new_message(t)
        m = self.message
        if m is not None:
            for i in range(len(m["text"])):
                x = m["x"] + i
                for d in self.drops.get(x, ()) or self.drops.get(x - 1, ()):
                    if abs(d.y - m["y"]) < 1.5:
                        m["lit"][i] = True
            # streams may miss a letter: light the rest gradually
            if t - m["start"] > 2.0:
                for i in range(len(m["lit"])):
                    if not m["lit"][i] and random.random() < dt * 2:
                        m["lit"][i] = True
            if t > m["until"]:
                self.message = None
                self.next_message = t + random.uniform(5, 9)

    def draw(self, scr):
        h = self.h
        for x, drops in self.drops.items():
            col = self.glyph[x]
            for d in drops:
                head = int(d.y)
                for k in range(d.length):
                    y = head - k
                    if y < 0:
                        break
                    if y >= h:
                        continue
                    if k == 0:
                        scr.put(x, y, random.choice(GLYPHS), fg=HEAD)
                    else:
                        scr.put(x, y, col[y], fg=_green(1 - k / d.length, d.depth))
        m = self.message
        if m is not None:
            for i, ch in enumerate(m["text"]):
                if m["lit"][i] and ch != " ":
                    scr.put(m["x"] + i, m["y"], ch, fg=HEAD, bg=(0, 40, 12))
                elif ch == " " and all(m["lit"]):
                    scr.put(m["x"] + i, m["y"], " ", bg=(0, 40, 12))
