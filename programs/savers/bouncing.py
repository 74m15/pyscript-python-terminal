"""A bouncing ball that changes colour, size and symbol at every bounce."""
import math
import random

from termgfx import hsv

SYMBOLS = "●◆★■@O♥✦#❖✚◉"


class BouncingBall:
    key = "ball"
    title = "Bouncing ball"
    fps = 30

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.maxr = max(2, min(h // 4, w // 10))
        self.ry = float(self.maxr)
        self.target = self.maxr
        self.r = self.ry
        self.x = w / 2
        self.y = self.ry + 1
        self.vx = random.choice((-1, 1)) * random.uniform(14, 24)
        self.vy = 0.0
        self.g = max(25.0, h * 2.2)
        self.hue = random.random()
        self.sym = random.choice(SYMBOLS)
        self.trail = []
        self.squash = 0.0
        self.bounces = 0

    def _bounce(self):
        self.bounces += 1
        self.hue += 0.11 + random.random() * 0.1
        self.sym = random.choice([s for s in SYMBOLS if s != self.sym])
        self.target = random.randint(max(1, self.maxr // 2), self.maxr)

    def update(self, dt, t):
        # the size eases towards a new target after each bounce, and gently "breathes"
        self.ry += (self.target - self.ry) * min(1.0, dt * 3)
        r = self.r = self.ry * (0.9 + 0.1 * math.sin(t * 4))
        self.hue += dt * 0.08
        self.vy += self.g * dt
        self.x += self.vx * dt
        self.y += self.vy * dt
        rx = r * 2  # character cells are about twice as tall as wide
        floor = self.h - 1 - r
        if self.y > floor:
            self.y = floor
            self.vy = -abs(self.vy) * 0.9
            if abs(self.vy) < self.g * 0.35:  # keep it lively
                self.vy = -math.sqrt(2 * self.g * self.h * random.uniform(0.45, 0.8))
            self.squash = 0.15
            self._bounce()
        if self.y < r:
            self.y, self.vy = r, abs(self.vy)
        if self.x < rx:
            self.x, self.vx = rx, abs(self.vx)
            self._bounce()
        elif self.x > self.w - 1 - rx:
            self.x, self.vx = self.w - 1 - rx, -abs(self.vx)
            self._bounce()
        self.squash = max(0.0, self.squash - dt)
        self.trail.append((self.x, self.y))
        del self.trail[:-16]

    def draw(self, scr):
        r = self.r
        # fading trail
        n = len(self.trail)
        for i, (tx, ty) in enumerate(self.trail[:-1]):
            k = (i + 1) / n
            scr.put(tx, ty, "·", fg=hsv(self.hue - (1 - k) * 0.3, 0.8, 0.2 + 0.5 * k))
        # shadow on the floor: wider and darker when the ball is close
        height = (self.h - 1 - r - self.y) / max(1, self.h)
        sw = max(1, int(r * 2 * (1.2 - height)))
        shade = int(30 + 60 * (1 - height))
        for dx in range(-sw, sw + 1):
            scr.put(self.x + dx, self.h - 1, "▁", fg=(shade, shade, shade))
        # the ball, squashed for a moment when it hits the floor, lit from the top-left
        sq = self.squash / 0.15
        ry = r * (1 - 0.3 * sq)
        rx = r * 2 * (1 + 0.3 * sq)
        cy = self.y + (r - ry)
        for yy in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for xx in range(int(self.x - rx) - 1, int(self.x + rx) + 2):
                dx = (xx + 0.5 - self.x) / rx
                dy = (yy + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1:
                    lx, ly = dx + 0.35, dy + 0.4
                    light = max(0.0, 1 - math.sqrt(lx * lx + ly * ly) * 0.7)
                    scr.put(xx, yy, self.sym, fg=hsv(self.hue, 0.85 - 0.5 * light * light, 0.35 + 0.65 * light))
        scr.text(2, 0, f"bounces: {self.bounces}", fg=(110, 120, 135))
