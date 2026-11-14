"""termgfx — tiny full-screen graphics for PyTerm programs.

A library that lives in programs/termgfx/ and is listed in programs/index.json,
so any program in programs/ can simply ``import termgfx``.

    from termgfx import Screen, hsv

    scr = Screen()
    with scr:                      # alternate screen, hidden cursor
        scr.clear()
        scr.text(2, 1, "Hello", fg=hsv(0.6))
        scr.present()              # only changed cells are sent to the terminal
"""
from .screen import Screen
from .color import hsv, lerp_color, scale, WHITE, BLACK
from . import font, math3d

__all__ = ["Screen", "hsv", "lerp_color", "scale", "WHITE", "BLACK", "font", "math3d"]
__version__ = "1.0"
