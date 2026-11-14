"""A shaded rotating cube flying through a starfield."""
import math
import random

from termgfx import hsv
from termgfx.math3d import dot, normalize, project, rotate

VERTS = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
         (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
FACES = [((0, 1, 2, 3), (0, 0, -1)), ((5, 4, 7, 6), (0, 0, 1)), ((4, 0, 3, 7), (-1, 0, 0)),
         ((1, 5, 6, 2), (1, 0, 0)), ((3, 2, 6, 7), (0, 1, 0)), ((4, 5, 1, 0), (0, -1, 0))]
RAMP = ".,-~:;=!*#$@"
LIGHT = normalize((-0.5, 0.7, -1.0))
DIST = 4.0


def _inside(px, py, poly):
    sign = 0
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        c = (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1)
        if c:
            s = 1 if c > 0 else -1
            if sign and s != sign:
                return False
            sign = s
    return True


class RotatingCube:
    key = "cube"
    title = "Rotating cube"
    fps = 30

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.size = min(h / 3.1, w / 6.2)
        self.t = 0.0
        self.stars = [self._star(random.uniform(0.5, 6)) for _ in range(90)]

    def _star(self, z):
        return [random.uniform(-6, 6), random.uniform(-3.5, 3.5), z]

    def update(self, dt, t):
        self.t = t
        for s in self.stars:
            s[2] -= dt * 1.6
            if s[2] < 0.3:
                s[:] = self._star(6)

    def draw(self, scr):
        w, h, t = self.w, self.h, self.t
        cx, cy = w / 2, h / 2
        # starfield: closer stars are brighter and bigger
        for x, y, z in self.stars:
            col, row = cx + x / z * w * 0.25, cy - y / z * h * 0.25
            v = max(0.15, min(1.0, 1.4 - z / 5))
            ch = "*" if z < 1.5 else "+" if z < 3 else "."
            g = int(255 * v)
            scr.put(col, row, ch, fg=(g, g, min(255, g + 30)))
        ax, ay, az = t * 0.7, t * 1.1, t * 0.33
        pts3 = [rotate(v, ax, ay, az) for v in VERTS]
        pts2 = [project(p, cx, cy, self.size, DIST) for p in pts3]
        for fi, (idx, normal) in enumerate(FACES):
            n = rotate(normal, ax, ay, az)
            if n[2] >= 0:  # facing away from the camera
                continue
            b = max(0.0, dot(n, LIGHT))
            light = 0.15 + 0.85 * b
            ch = RAMP[min(len(RAMP) - 1, int(light * len(RAMP)))]
            fg = hsv(fi / 6 + t * 0.05, 0.6, 0.25 + 0.75 * light)
            poly = [(pts2[i][0], pts2[i][1]) for i in idx]
            x0 = int(min(p[0] for p in poly))
            x1 = int(max(p[0] for p in poly)) + 1
            y0 = int(min(p[1] for p in poly))
            y1 = int(max(p[1] for p in poly)) + 1
            for row in range(max(0, y0), min(h, y1 + 1)):
                for col in range(max(0, x0), min(w, x1 + 1)):
                    if _inside(col + 0.5, row + 0.5, poly):
                        scr.put(col, row, ch, fg=fg, bg=(0, 0, 0))
