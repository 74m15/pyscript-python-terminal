"""Minimal 3D helpers: rotations and perspective projection onto character cells."""
import math


def rot_x(p, a):
    x, y, z = p
    c, s = math.cos(a), math.sin(a)
    return (x, y * c - z * s, y * s + z * c)


def rot_y(p, a):
    x, y, z = p
    c, s = math.cos(a), math.sin(a)
    return (x * c + z * s, y, -x * s + z * c)


def rot_z(p, a):
    x, y, z = p
    c, s = math.cos(a), math.sin(a)
    return (x * c - y * s, x * s + y * c, z)


def rotate(p, ax, ay, az):
    return rot_z(rot_y(rot_x(p, ax), ay), az)


def project(p, cx, cy, size, dist=5.0, aspect=0.5):
    """Perspective projection. Returns (column, row, depth).

    The camera looks along +z from z = -dist. ``aspect`` compensates for character
    cells being about twice as tall as they are wide.
    """
    x, y, z = p
    f = size * dist / (z + dist)
    return (cx + x * f, cy - y * f * aspect, z)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def normalize(v):
    n = math.sqrt(dot(v, v)) or 1.0
    return (v[0] / n, v[1] / n, v[2] / n)
