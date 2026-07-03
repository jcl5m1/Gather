#!/usr/bin/env python3
"""
Overlay debug labels onto the LOD tiles so transitions are visible in the browser.

Each tile gets:
  - A thick colored border     (yellow = L1, cyan = L2)
  - The tile ID (e.g. "C3") and coordinates stamped in a 4×4 checkerboard
    across the entire tile so the label is visible at any zoom level
  - The altitude range for that LOD level

Run after generate_earth_tiles.py (or --no-upscale).
Overwrites tiles in-place; safe to re-run.
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

TILE_ROOT = Path('dist/tiles')

BORDER   = {1: (8, (255, 220,  50)),   # yellow for L1
             2: (5, ( 50, 230, 255))}   # cyan for L2

ALT_LABEL = {
    1: '500 km – 3 000 km',
    2: '50 km – 500 km',
}

# Number of label cells across each axis (4×4 = 16 label regions per tile)
GRID_CELLS = 4


def get_font(size: int) -> ImageFont.FreeTypeFont:
    for path in [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
        '/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf',
    ]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def label_level(level: int) -> None:
    level_dir = TILE_ROOT / f'L{level}'
    if not level_dir.exists():
        print(f'  {level_dir} not found — skipping L{level}')
        return

    border_px, border_color = BORDER[level]

    # Font sizes: L1 tiles cover 1/16 of sphere so can use bigger text;
    # L2 tiles cover 1/256 so need smaller text to fit in each label cell.
    cell_font   = get_font(72 if level == 1 else 36)
    alt_font    = get_font(40 if level == 1 else 22)

    tiles = sorted(level_dir.glob('*.jpg'))
    print(f'Labelling {len(tiles)} L{level} tiles…')

    for path in tiles:
        row, col = map(int, path.stem.split('_'))
        tile_id  = chr(ord('A') + row) + str(col)

        img  = Image.open(path).convert('RGB')
        draw = ImageDraw.Draw(img)
        w, h = img.size

        # ── Colored border ────────────────────────────────────────────────────
        for i in range(border_px):
            draw.rectangle([i, i, w - 1 - i, h - 1 - i], outline=border_color)

        # ── Checkerboard label grid ───────────────────────────────────────────
        cw = w // GRID_CELLS   # cell width  in px
        ch = h // GRID_CELLS   # cell height in px

        for gr in range(GRID_CELLS):
            for gc in range(GRID_CELLS):
                # Alternate dark/medium backgrounds like a checkerboard
                if (gr + gc) % 2 == 0:
                    bg = (0, 0, 0, 140)        # darker cell
                else:
                    bg = (30, 30, 30, 100)     # slightly lighter cell

                cx = gc * cw
                cy = gr * ch

                # Semi-transparent dark background for readability
                draw.rectangle([cx + 4, cy + 4, cx + cw - 4, cy + ch - 4], fill=bg)

                # Main tile ID
                main_text = f'L{level} {tile_id}'
                draw.text((cx + 10, cy + 10), main_text,
                          font=cell_font, fill=(255, 255, 255))

                # Sub-text: row/col coords
                sub_text = f'r{row} c{col}'
                draw.text((cx + 10, cy + 10 + (80 if level == 1 else 42)),
                          sub_text, font=alt_font, fill=border_color)

                # Altitude range (only in top-left cell to avoid clutter)
                if gr == 0 and gc == 0:
                    draw.text((cx + 10, cy + 10 + (130 if level == 1 else 70)),
                              ALT_LABEL[level], font=alt_font,
                              fill=(200, 200, 200))

        img.save(path, 'JPEG', quality=90)

    print(f'  L{level} done.')


def main():
    label_level(1)
    label_level(2)
    print('All tiles labelled.')


if __name__ == '__main__':
    main()
