"""A pool table that plays itself: break, aim, shoot, pot, re-rack."""
import math
import random

CLOTH = (12, 102, 58)
CLOTH_LIGHT = (40, 140, 90)
RAIL = (88, 50, 22)
RAIL_FG = (196, 150, 98)
POCKET = (6, 6, 6)
CUE_BALL = (245, 245, 235)
STICK = (205, 160, 100)
TIP = (140, 190, 255)
COLORS = [
    (250, 205, 40), (40, 95, 230), (225, 45, 45), (140, 70, 185), (250, 135, 30),
    (30, 175, 90), (150, 35, 45), (20, 20, 20), (255, 230, 120), (120, 190, 255),
]
R = 1.0          # ball radius (in column widths; y is measured in half-rows)
POCKET_R = 2.3


class Ball:
    __slots__ = ("x", "y", "vx", "vy", "color", "cue", "alive")

    def __init__(self, x, y, color, cue=False):
        self.x, self.y, self.vx, self.vy = x, y, 0.0, 0.0
        self.color, self.cue, self.alive = color, cue, True


class Billiards:
    key = "billiards"
    title = "Billiards"
    fps = 30

    def __init__(self, w, h):
        self.w, self.h = w, h
        # physics space: x in columns, y in half-rows, so distances are the same in both directions
        self.xmin, self.xmax = 1.5, w - 1.5
        self.ymin, self.ymax = 2 + R, 2 * (h - 1) - R
        self.cy = (self.ymin + self.ymax) / 2
        self.pockets = [(self.xmin, self.ymin), (w / 2, self.ymin - 0.5), (self.xmax, self.ymin),
                        (self.xmin, self.ymax), (w / 2, self.ymax + 0.5), (self.xmax, self.ymax)]
        self.potted = 0
        self.shots = 0
        self.rack()

    # -- setup
    def rack(self):
        self.balls = [Ball(self.w * 0.25, self.cy, CUE_BALL, cue=True)]
        apex = min(self.w * 0.66, self.xmax - 8)
        n = 0
        for row in range(4):
            for j in range(row + 1):
                x = apex + row * math.sqrt(3) * R * 1.02
                y = self.cy + (j - row / 2) * 2 * R * 1.02
                self.balls.append(Ball(x, y, COLORS[n % len(COLORS)]))
                n += 1
        self.cue = self.balls[0]
        self.start_aim(target=(apex, self.cy), power=115)

    def start_aim(self, target=None, power=None):
        cue = self.cue
        if not cue.alive:  # cue ball was potted: put it back on the table
            cue.alive, cue.vx, cue.vy = True, 0.0, 0.0
            cue.x, cue.y = self.w * 0.25, self.cy
            for _ in range(50):
                if all((b.x - cue.x) ** 2 + (b.y - cue.y) ** 2 > (2.2 * R) ** 2
                       for b in self.balls if b.alive and b is not cue):
                    break
                cue.y = random.uniform(self.ymin, self.ymax)
        if target is None:
            others = [b for b in self.balls if b.alive and not b.cue]
            if not others:
                self.rack()
                return
            t = random.choice(others)
            target = (t.x, t.y)
        ang = math.atan2(target[1] - cue.y, target[0] - cue.x) + random.uniform(-0.07, 0.07)
        self.dir = (math.cos(ang), math.sin(ang))
        self.power = power or random.uniform(55, 100)
        self.phase = "aim"
        self.timer = 0.0

    # -- physics
    def _step(self, dt):
        live = [b for b in self.balls if b.alive]
        for b in live:
            b.x += b.vx * dt
            b.y += b.vy * dt
            if b.x < self.xmin:
                b.x, b.vx = self.xmin, abs(b.vx) * 0.85
            elif b.x > self.xmax:
                b.x, b.vx = self.xmax, -abs(b.vx) * 0.85
            if b.y < self.ymin:
                b.y, b.vy = self.ymin, abs(b.vy) * 0.85
            elif b.y > self.ymax:
                b.y, b.vy = self.ymax, -abs(b.vy) * 0.85
        for i in range(len(live)):
            a = live[i]
            for j in range(i + 1, len(live)):
                b = live[j]
                dx, dy = b.x - a.x, b.y - a.y
                d2 = dx * dx + dy * dy
                if 0 < d2 < (2 * R) ** 2:
                    d = math.sqrt(d2)
                    nx, ny = dx / d, dy / d
                    push = (2 * R - d) / 2
                    a.x -= nx * push
                    a.y -= ny * push
                    b.x += nx * push
                    b.y += ny * push
                    vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
                    if vrel < 0:  # approaching: equal-mass elastic collision
                        a.vx += vrel * nx * 0.97
                        a.vy += vrel * ny * 0.97
                        b.vx -= vrel * nx * 0.97
                        b.vy -= vrel * ny * 0.97
        for b in live:
            for px, py in self.pockets:
                if (b.x - px) ** 2 + (b.y - py) ** 2 < POCKET_R ** 2:
                    b.alive = False
                    b.vx = b.vy = 0.0
                    if not b.cue:
                        self.potted += 1
                    break
            s = math.hypot(b.vx, b.vy)
            if s > 0:
                ns = max(0.0, s - (7 + 0.55 * s) * dt)  # rolling friction
                if ns < 0.6:
                    ns = 0.0
                b.vx *= ns / s
                b.vy *= ns / s

    def update(self, dt, t):
        self.timer += dt
        if self.phase == "aim":
            if self.timer > 0.9:
                self.cue.vx = self.dir[0] * self.power
                self.cue.vy = self.dir[1] * self.power
                self.shots += 1
                self.phase = "roll"
                self.timer = 0.0
            return
        for _ in range(4):
            self._step(dt / 4)
        moving = any(b.alive and (b.vx or b.vy) for b in self.balls)
        if not moving or self.timer > 9:
            self.start_aim()

    # -- drawing
    def _cell(self, x, y):
        return int(x), int(y / 2)

    def draw(self, scr):
        w, h = self.w, self.h
        scr.fill(0, 0, w, h, " ", bg=RAIL)
        scr.fill(1, 1, w - 2, h - 2, " ", bg=CLOTH)
        # head string and spot
        hx = int(self.w * 0.25)
        for row in range(1, h - 1):
            scr.put(hx, row, "┊", fg=CLOTH_LIGHT)
        for px, py in self.pockets:
            cx = min(max(int(px), 0), w - 1)
            top = py < self.cy
            scr.put(cx, 0 if top else h - 1, "●", fg=POCKET)
            scr.put(min(max(cx, 1), w - 2), 1 if top else h - 2, " ", bg=(4, 60, 34))
        label = f" Billiards · potted {self.potted} · shots {self.shots} "
        scr.text(max(1, (w - len(label)) // 2), 0, label[: w - 2], fg=RAIL_FG, bg=RAIL)
        cue = self.cue
        if self.phase == "aim" and cue.alive:
            dx, dy = self.dir
            # dotted aiming line
            for k in range(3, 40, 2):
                scr.put(*self._cell(cue.x + dx * k, cue.y + dy * k), "·", fg=CLOTH_LIGHT)
            # the stick pulls back, then strikes
            pull = 1.5 + 4 * min(1.0, self.timer / 0.75)
            if self.timer > 0.75:
                pull = max(1.2, pull - (self.timer - 0.75) * 40)
            length = min(18, w / 3)
            k = R + pull
            first = True
            while k < R + pull + length:
                x, y = self._cell(cue.x - dx * k, cue.y - dy * k)
                scr.put(x, y, "◦" if first else "•", fg=TIP if first else STICK)
                first = False
                k += 0.9
        for b in self.balls:
            if b.alive:
                x, y = self._cell(b.x, b.y)
                scr.put(x, y, "●", fg=b.color, bg=CLOTH)
