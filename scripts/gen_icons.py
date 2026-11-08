"""Generate PWA icons (PNG + SVG) for RainRadarF1. Pure Pillow, no assets.

Usage: python3 scripts/gen_icons.py
"""
from PIL import Image, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')

BG = (11, 18, 32, 255)        # deep navy
RING = (38, 64, 102, 255)     # radar rings
DROP = (56, 189, 248, 255)    # sky blue raindrop
DROP_DARK = (14, 116, 180, 255)


def draw_icon(size: int, safe: float) -> Image.Image:
    """safe = fraction of the canvas the artwork stays inside (maskable: 0.8)."""
    img = Image.new('RGBA', (size, size), BG)
    d = ImageDraw.Draw(img)
    cx = cy = size / 2
    r_max = size * safe / 2

    # radar rings
    for i, frac in enumerate((1.0, 0.72, 0.46)):
        r = r_max * frac
        width = max(2, int(size * 0.022))
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=RING, width=width)

    # raindrop: circle + triangle on top
    dr = r_max * 0.30
    drop_cy = cy + dr * 0.55
    d.ellipse([cx - dr, drop_cy - dr, cx + dr, drop_cy + dr], fill=DROP)
    tip_y = cy - r_max * 0.85
    d.polygon([(cx, tip_y), (cx - dr * 0.82, drop_cy - dr * 0.35), (cx + dr * 0.82, drop_cy - dr * 0.35)], fill=DROP)
    # glossy highlight
    hr = dr * 0.34
    d.ellipse([cx - dr * 0.52 - hr / 2, drop_cy - dr * 0.35 - hr / 2,
               cx - dr * 0.52 + hr / 2, drop_cy - dr * 0.35 + hr / 2], fill=(255, 255, 255, 210))
    return img


def main() -> None:
    os.makedirs(PUBLIC, exist_ok=True)
    draw_icon(512, 0.86).save(os.path.join(PUBLIC, 'icon-512.png'))
    draw_icon(192, 0.86).save(os.path.join(PUBLIC, 'icon-192.png'))
    draw_icon(512, 0.72).save(os.path.join(PUBLIC, 'icon-512-maskable.png'))
    draw_icon(180, 0.86).save(os.path.join(PUBLIC, 'apple-touch-icon.png'))

    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0b1220"/>
  <circle cx="32" cy="32" r="26" fill="none" stroke="#264066" stroke-width="3"/>
  <circle cx="32" cy="32" r="19" fill="none" stroke="#264066" stroke-width="3"/>
  <circle cx="32" cy="32" r="12" fill="none" stroke="#264066" stroke-width="3"/>
  <path d="M32 8 L39 30 A9.5 9.5 0 1 1 25 30 Z" fill="#38bdf8"/>
  <circle cx="27" cy="33" r="3" fill="#ffffff" opacity="0.8"/>
</svg>
"""
    with open(os.path.join(PUBLIC, 'favicon.svg'), 'w') as f:
        f.write(svg)
    print('icons written to', PUBLIC)


if __name__ == '__main__':
    main()
