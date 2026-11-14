"""savers — the scenes used by the screen saver program.

Every scene is a class with the same small interface:

    scene = Scene(width, height)   # size of the drawing area in cells
    scene.update(dt, t)            # advance the animation (dt = seconds since the last frame,
                                   # t = seconds since the scene started)
    scene.draw(screen)             # draw on a termgfx.Screen

Class attributes: ``key`` (short name), ``title`` and ``fps`` (frames per second).
This package itself imports the termgfx library: libraries can use each other.
"""
from .bouncing import BouncingBall
from .billiards import Billiards
from .cube import RotatingCube
from .asciiart import AsciiArt
from .matrix import MatrixRain

SCENES = [BouncingBall, Billiards, RotatingCube, AsciiArt, MatrixRain]

__all__ = ["SCENES", "BouncingBall", "Billiards", "RotatingCube", "AsciiArt", "MatrixRain"]
