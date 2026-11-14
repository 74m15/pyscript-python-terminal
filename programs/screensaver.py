"""Screen saver — rotates through five animations, 15 seconds each.

It shows how programs use libraries: ``termgfx`` (drawing) and ``savers`` (the scenes)
are folders next to this file in programs/, listed in programs/index.json, and PyTerm
puts them on the import path while the program runs.

Press Ctrl+C or the Stop button to leave.

Options (with run("programs/screensaver.py", ...) at the >>> prompt):
    --seconds N        time per scene (default 15)
    ball billiards cube ascii matrix   only show these scenes, in this order
"""
import sys
import time

import pyterm
from termgfx import Screen, hsv
from savers import SCENES

SECONDS = 15.0
BAR_BG = (16, 20, 26)
BAR_FG = (140, 150, 165)


def parse_args(argv):
    seconds, keys = SECONDS, []
    it = iter(argv)
    for a in it:
        if a in ("-s", "--seconds"):
            seconds = max(2.0, float(next(it, SECONDS)))
        else:
            keys.append(a.lower())
    scenes = [s for k in keys for s in SCENES if s.key == k] or list(SCENES)
    return seconds, scenes


def status_bar(scr, i, total, scene, left, seconds):
    y = scr.h - 1
    scr.fill(0, y, scr.w, 1, " ", bg=BAR_BG)
    head = f" ▶ {i}/{total}  {scene.title} "
    tail = f" next in {int(left) + 1:>2}s · Ctrl+C / Stop to exit "
    scr.text(0, y, head, fg=(230, 235, 240), bg=BAR_BG)
    scr.text(scr.w - len(tail), y, tail, fg=BAR_FG, bg=BAR_BG)
    # progress bar between the two labels
    x0, x1 = len(head) + 1, scr.w - len(tail) - 1
    if x1 - x0 >= 6:
        done = int((x1 - x0) * (1 - left / seconds))
        for x in range(x0, x1):
            scr.put(x, y, "━", fg=hsv(0.55, 0.7, 0.9) if x - x0 < done else (45, 52, 62), bg=BAR_BG)


def play(seconds, scenes):
    scr = Screen()
    shown = 0
    with scr:
        n = 0
        while True:
            cls = scenes[n % len(scenes)]
            n += 1
            pyterm.title(f"Screen saver — {cls.title}")
            scene = cls(scr.w, scr.h - 1)
            start = last = time.monotonic()
            shown += 1
            while True:
                now = time.monotonic()
                dt, last = min(0.1, now - last), now
                elapsed = now - start
                if elapsed >= seconds:
                    break
                if scr.size_changed():
                    scr.resize()
                    scene = cls(scr.w, scr.h - 1)
                scene.update(dt, elapsed)
                scr.clear()
                scene.draw(scr)
                if elapsed < 0.4:  # wipe-in transition from the left
                    edge = int(scr.w * elapsed / 0.4)
                    scr.erase(edge, 0, scr.w - edge, scr.h - 1)
                    scr.fill(edge, 0, 1, scr.h - 1, "▌", fg=hsv(elapsed, 0.6, 1.0))
                status_bar(scr, (n - 1) % len(scenes) + 1, len(scenes), cls, seconds - elapsed, seconds)
                scr.present()
                frame = 1.0 / cls.fps
                time.sleep(max(0.005, frame - (time.monotonic() - now)))
    return shown


def main():
    seconds, scenes = parse_args(sys.argv[1:])
    try:
        play(seconds, scenes)
    except KeyboardInterrupt:
        pass
    finally:
        pyterm.title("")
    print(pyterm.style("Screen saver stopped.", "grey"))


if __name__ == "__main__":
    main()
