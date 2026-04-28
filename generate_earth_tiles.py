#!/usr/bin/env python3
"""
Generate a 2-level LOD tile set from the Three.js Earth atmosphere texture.

Level 1 (4×4 = 16 tiles)  – each tile covers 1/16 of the sphere; upscaled 4× from L0 region.
Level 2 (16×16 = 256 tiles) – each tile covers 1/256 of the sphere; upscaled 4× from L1 region.

Output layout:
  dist/tiles/L1/{row}_{col}.jpg   (16 files, ~2048×1024 each)
  dist/tiles/L2/{row}_{col}.jpg   (256 files, ~2048×1024 each)

Requirements:
  pip install Pillow
  ComfyUI running at localhost:8188 (or pass --host; use --no-upscale for bilinear resize fallback)

Usage:
  python generate_earth_tiles.py
  python generate_earth_tiles.py --level 1                    # L1 only
  python generate_earth_tiles.py --level 2                    # L2 only (L1 must exist)
  python generate_earth_tiles.py --no-upscale                 # bilinear resize (no ComfyUI)
  python generate_earth_tiles.py --host http://192.168.1.10:8188
"""

import argparse
import sys
import urllib.request
from pathlib import Path

from PIL import Image

SRC_URL   = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r128/examples/textures/planets/earth_atmos_2048.jpg'
TILE_ROOT = Path('dist/tiles')
CACHE     = TILE_ROOT / '.cache'

DEFAULT_MODEL      = '4x-UltraSharp.pth'
DEFAULT_HOST       = 'http://localhost:8188'
DEFAULT_CHECKPOINT = 'waiNSFWIllustrious_v110.safetensors'

# Text prompts tuned for the camera altitude each LOD level is viewed from.
# L1: viewed from ~500 km – 3 000 km; wide geographic features dominate.
# L2: viewed from ~50 km – 500 km; regional terrain and surface texture matter.
PROMPT_L1 = (
    "satellite photograph of Earth from high orbit, "
    "detailed continental coastlines, ocean color gradients, cloud formations, "
    "crisp geographic features, high resolution, sharp"
)
PROMPT_L2 = (
    "detailed aerial satellite photograph from low orbit, "
    "terrain texture, topographic detail, mountain ridges, river systems, "
    "urban sprawl, road networks, vegetation patterns, "
    "high resolution, sharp, photorealistic"
)
NEGATIVE  = "blurry, low quality, cartoon, painting, illustration, worst quality, artifacts"


# ── Helpers ───────────────────────────────────────────────────────────────────

def download_base() -> Path:
    dest = CACHE / 'earth_atmos_2048.jpg'
    if dest.exists():
        print(f'Base texture already cached: {dest}')
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print('Downloading base texture…', flush=True)
    urllib.request.urlretrieve(SRC_URL, dest)
    print(f'Downloaded to {dest}')
    return dest


def split4x4(img: Image.Image) -> list[list[Image.Image]]:
    """Return a 4×4 list-of-lists of PIL Image tiles."""
    w, h = img.size
    tw, th = w // 4, h // 4
    return [
        [img.crop((c * tw, r * th, (c + 1) * tw, (r + 1) * th)) for c in range(4)]
        for r in range(4)
    ]


def upscale_tile(
    src: Path, dst: Path, *,
    host: str, model: str,
    prompt: str | None = None,
    denoise: float = 0.2,
    checkpoint: str = DEFAULT_CHECKPOINT,
) -> None:
    """Upscale src 4× via ComfyUI and save as JPEG at dst.
    When prompt is given, uses Ultimate SD Upscale (ESRGAN + diffusion).
    """
    if dst.exists():
        print(f'  skip {dst.name}')
        return

    tmp_png = dst.with_suffix('.png')
    try:
        import upscale_client
        upscale_client.upscale(
            str(src), str(tmp_png),
            model=model, host=host,
            prompt=prompt, negative=NEGATIVE,
            checkpoint=checkpoint, denoise=denoise,
        )
        Image.open(tmp_png).convert('RGB').save(dst, 'JPEG', quality=90)
    finally:
        if tmp_png.exists():
            tmp_png.unlink()


def bilinear_4x(src: Path, dst: Path) -> None:
    """Bilinear 4× resize fallback (no ComfyUI needed)."""
    if dst.exists():
        print(f'  skip {dst.name}')
        return
    img = Image.open(src).convert('RGB')
    w, h = img.size
    img.resize((w * 4, h * 4), Image.LANCZOS).save(dst, 'JPEG', quality=90)


# ── Level generation ──────────────────────────────────────────────────────────

def gen_l1(
    base_img: Image.Image, *,
    host: str, model: str, no_upscale: bool,
    prompt: str | None, denoise: float, checkpoint: str,
) -> None:
    l1_dir  = TILE_ROOT / 'L1'
    src_dir = CACHE / 'L1_src'
    l1_dir.mkdir(parents=True, exist_ok=True)
    src_dir.mkdir(parents=True, exist_ok=True)

    effective_prompt = prompt if prompt is not None else (None if no_upscale else PROMPT_L1)
    print(f'L1 prompt: {effective_prompt!r}')

    tiles = split4x4(base_img)
    total = 16
    done  = 0
    for r in range(4):
        for c in range(4):
            src = src_dir / f'{r}_{c}.jpg'
            dst = l1_dir  / f'{r}_{c}.jpg'
            if not src.exists():
                tiles[r][c].save(src, 'JPEG', quality=95)
            print(f'[L1 {done + 1}/{total}] {r}_{c}.jpg', flush=True)
            if no_upscale:
                bilinear_4x(src, dst)
            else:
                upscale_tile(src, dst, host=host, model=model,
                             prompt=effective_prompt, denoise=denoise,
                             checkpoint=checkpoint)
            done += 1
    print('L1 complete.')


def gen_l2(
    *, host: str, model: str, no_upscale: bool,
    prompt: str | None, denoise: float, checkpoint: str,
) -> None:
    l1_dir  = TILE_ROOT / 'L1'
    l2_dir  = TILE_ROOT / 'L2'
    src_dir = CACHE / 'L2_src'
    l2_dir.mkdir(parents=True, exist_ok=True)
    src_dir.mkdir(parents=True, exist_ok=True)

    effective_prompt = prompt if prompt is not None else (None if no_upscale else PROMPT_L2)
    print(f'L2 prompt: {effective_prompt!r}')

    total = 256
    done  = 0
    for r1 in range(4):
        for c1 in range(4):
            l1_path = l1_dir / f'{r1}_{c1}.jpg'
            if not l1_path.exists():
                print(f'  L1 tile {r1}_{c1} missing — skipping its 16 L2 subtiles')
                done += 16
                continue
            subtiles = split4x4(Image.open(l1_path).convert('RGB'))
            for sr in range(4):
                for sc in range(4):
                    row = r1 * 4 + sr
                    col = c1 * 4 + sc
                    src = src_dir / f'{row}_{col}.jpg'
                    dst = l2_dir  / f'{row}_{col}.jpg'
                    if not src.exists():
                        subtiles[sr][sc].save(src, 'JPEG', quality=95)
                    print(f'[L2 {done + 1}/{total}] {row}_{col}.jpg', flush=True)
                    if no_upscale:
                        bilinear_4x(src, dst)
                    else:
                        upscale_tile(src, dst, host=host, model=model,
                                     prompt=effective_prompt, denoise=denoise,
                                     checkpoint=checkpoint)
                    done += 1
    print('L2 complete.')


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description='Generate LOD Earth texture tiles')
    ap.add_argument('--host',       default=DEFAULT_HOST)
    ap.add_argument('--model',      default=DEFAULT_MODEL,
                    choices=['4x-UltraSharp.pth', '4x_NMKD-Siax_200k.pth',
                             'RealESRGAN_x4plus_anime_6B.pth'])
    ap.add_argument('--level',      default='both', choices=['1', '2', 'both'])
    ap.add_argument('--no-upscale', action='store_true',
                    help='Use bilinear resize instead of ComfyUI (fast, for testing)')
    ap.add_argument('--prompt',     default=None,
                    help='Override the auto-selected text prompt (empty string = ESRGAN only)')
    ap.add_argument('--checkpoint', default=DEFAULT_CHECKPOINT,
                    help='SD checkpoint for Ultimate SD Upscale')
    ap.add_argument('--denoise-l1', type=float, default=0.20,
                    help='Denoise strength for L1 tiles — subtle (default 0.20)')
    ap.add_argument('--denoise-l2', type=float, default=0.28,
                    help='Denoise strength for L2 tiles — more surface detail (default 0.28)')
    args = ap.parse_args()

    # Empty string prompt → ESRGAN-only (no diffusion)
    prompt_override = None if args.prompt is None else (None if args.prompt == '' else args.prompt)

    base_img = Image.open(download_base()).convert('RGB')
    print(f'Base image: {base_img.size[0]}×{base_img.size[1]}')

    if args.level in ('1', 'both'):
        gen_l1(base_img, host=args.host, model=args.model, no_upscale=args.no_upscale,
               prompt=prompt_override, denoise=args.denoise_l1, checkpoint=args.checkpoint)

    if args.level in ('2', 'both'):
        gen_l2(host=args.host, model=args.model, no_upscale=args.no_upscale,
               prompt=prompt_override, denoise=args.denoise_l2, checkpoint=args.checkpoint)

    print('Done.')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)
