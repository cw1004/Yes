#!/usr/bin/env python3
"""Turn the raw product cutouts into the web-sized WebP files the app inlines.

    python3 tools/prepare_assets.py

Reads assets/source/*.png (1600-1920px transparent PNGs, ~3.3 MB total) and
writes assets/*.webp (max 700px, ~170 KB total). Two source photos carry a
saturated chroma-key fringe along the bottom edge left over from cutting them
out; that band is trimmed here so the furniture sits cleanly on the room floor.
"""
import colorsys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "source"
DST = ROOT / "assets"

MAX_EDGE = 700
QUALITY = 82
FRINGE_SATURATION = 0.65  # oak tops out near 0.55; the keying fringe sits above 0.7
FRINGE_LIMIT = 0.08  # never trim more than 8% of the height


def fringe_rows(im: Image.Image) -> int:
    """Rows of saturated non-product pixels along the bottom edge."""
    w, h = im.size
    px = im.load()
    step = max(1, w // 80)
    last = 0
    for offset in range(1, int(h * FRINGE_LIMIT)):
        y = h - offset
        sats = [
            colorsys.rgb_to_hsv(*(c / 255 for c in px[x, y][:3]))[1]
            for x in range(0, w, step)
            if px[x, y][3] > 128
        ]
        if sats and max(sats) > FRINGE_SATURATION:
            last = offset
    return last


def main() -> None:
    total = 0
    for src in sorted(SRC.glob("*.png")):
        im = Image.open(src).convert("RGBA")
        im = im.crop(im.getbbox())

        trim = fringe_rows(im)
        if trim:
            im = im.crop((0, 0, im.width, im.height - trim))
            im = im.crop(im.getbbox())

        scale = MAX_EDGE / max(im.size)
        if scale < 1:
            im = im.resize((round(im.width * scale), round(im.height * scale)), Image.LANCZOS)

        out = DST / f"{src.stem}.webp"
        im.save(out, "WEBP", quality=QUALITY, method=6)
        total += out.stat().st_size
        print(f"{out.name:24} {im.width}x{im.height}  {out.stat().st_size / 1024:6.1f} KB"
              + (f"  (fringe -{trim}px)" if trim else ""))
    print(f"{'total':24} {'':11}  {total / 1024:6.1f} KB")


if __name__ == "__main__":
    main()
