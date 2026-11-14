"""Colour helpers. Colours are (r, g, b) tuples with 0-255 components."""
import colorsys

WHITE = (255, 255, 255)
BLACK = (0, 0, 0)


def hsv(h, s=1.0, v=1.0):
    """Hue (0-1, wraps around), saturation and value (0-1) -> (r, g, b)."""
    s = 0.0 if s < 0 else 1.0 if s > 1 else s
    v = 0.0 if v < 0 else 1.0 if v > 1 else v
    r, g, b = colorsys.hsv_to_rgb(h % 1.0, s, v)
    return (int(r * 255), int(g * 255), int(b * 255))


def lerp_color(a, b, t):
    """Blend from colour a (t=0) to colour b (t=1)."""
    t = 0.0 if t < 0 else 1.0 if t > 1 else t
    return (int(a[0] + (b[0] - a[0]) * t), int(a[1] + (b[1] - a[1]) * t), int(a[2] + (b[2] - a[2]) * t))


def scale(c, k):
    """Make a colour brighter (k > 1) or darker (k < 1)."""
    return tuple(255 if v * k > 255 else 0 if v * k < 0 else int(v * k) for v in c)
