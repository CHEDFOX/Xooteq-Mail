#!/usr/bin/env python3
"""The home-screen icons, drawn from the Xooteq Mail mark (components/Brand.tsx).

    python3 tools/make-icons.py          writes web/public/*.png

The mark is an envelope whose two diagonals make the X, with the teal dot for
the new message. Each icon is drawn eight times too large and scaled down, so
the strokes stay smooth. Android's maskable icon keeps the glyph inside the
safe circle; Apple's rounds the corners itself, so that one is full-bleed.
"""
from pathlib import Path

from PIL import Image, ImageDraw

BG = (20, 21, 23)          # --mark-bg
FG = (255, 255, 255)       # --mark-fg
DOT = (18, 165, 148)       # --brand
SS = 8                     # supersampling
OUT = Path(__file__).resolve().parent.parent / "web" / "public"


def cap(d: ImageDraw.ImageDraw, xy, width, fill):
    """A line with round ends: Pillow draws neither cap nor join round."""
    (x1, y1), (x2, y2) = xy
    d.line([(x1, y1), (x2, y2)], fill=fill, width=width)
    for x, y in ((x1, y1), (x2, y2)):
        d.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=fill)


# The mark on its own 32-unit grid: the envelope, the two diagonals that make
# the X, and the dot. The ink reaches past the grid's middle (the dot sits high
# and right), so the icons are centred on the ink, not on the grid.
INK = (5.5, 4.25, 29.25, 24.0)


def draw(size: int, *, ink: float, radius: float) -> Image.Image:
    """One icon: the background, then the mark drawn to fill `ink` of the canvas.

    `radius` is the corner radius as a fraction of the size (0 is full-bleed).
    """
    n = size * SS
    img = Image.new("RGBA" if radius > 0 else "RGB", (n, n), BG)
    if radius > 0:
        # The rounded square, drawn as a mask so the corners are clean.
        mask = Image.new("L", (n, n), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, n - 1, n - 1], radius=radius * n, fill=255)
        img.putalpha(mask)
    d = ImageDraw.Draw(img)

    x0, y0, x1, y1 = INK
    u = ink * n / (x1 - x0)
    ox = n / 2 - (x0 + x1) / 2 * u
    oy = n / 2 - (y0 + y1) / 2 * u
    def p(x, y):
        return (ox + x * u, oy + y * u)
    stroke = max(1, round(2 * u))

    d.rounded_rectangle([*p(6.5, 9), *p(25.5, 23)], radius=2.5 * u, outline=FG, width=stroke)
    # The diagonals stop a stroke short of the envelope's inner corners, so
    # their round ends stay inside the outline instead of bulging through it.
    cap(d, [p(8.4, 10.9), p(23.6, 21.1)], stroke, FG)
    cap(d, [p(23.6, 10.9), p(8.4, 21.1)], stroke, FG)
    # The dot sits over the envelope's corner, with the background as its ring.
    cx, cy = p(25, 8.5)
    r = 3.5 * u + stroke * 0.75
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BG)
    r = 3.5 * u
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=DOT)

    return img.resize((size, size), Image.LANCZOS)


ICONS = [
    # Chrome's own: the mark as it looks everywhere else, rounded.
    ("icon-192.png", 192, 0.64, 0.22),
    ("icon-512.png", 512, 0.64, 0.22),
    # Android masks this one to its own shape, so the mark stays well inside
    # the safe circle (the inner 80%) and the background reaches every edge.
    ("icon-maskable-512.png", 512, 0.55, 0),
    # iOS rounds the corners itself; a square with corners of our own looks wrong.
    ("apple-touch-icon.png", 180, 0.66, 0),
]

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, ink, radius in ICONS:
        icon = draw(size, ink=ink, radius=radius)
        icon.save(OUT / name, optimize=True)
        print(f"{name}  {size}x{size}  {(OUT / name).stat().st_size // 1024 or 1} KB")
