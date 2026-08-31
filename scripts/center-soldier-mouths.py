#!/usr/bin/env python3
"""Keep each formal soldier mouth centered beneath its matching eye layer."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
CELL = 418
ATLAS_SIZE = CELL * 3
EXPRESSION_SLOTS = ((3, 4), (5, 6), (7, 8))
ATLASES = {
    ROOT / "assets/generated/soldier/soldier-shield-dun-atlas-v1.png": 37,
    ROOT / "assets/generated/soldier/soldier-bean-bow-atlas-v1.png": 28,
    ROOT / "assets/generated/soldier/soldier-bounce-hammer-atlas-v1.png": 0,
    ROOT / "assets/generated/soldier/soldier-leaf-spinner-atlas-v1.png": 0,
}


def cell(atlas: Image.Image, slot: int) -> Image.Image:
    left = (slot % 3) * CELL
    top = (slot // 3) * CELL
    return atlas.crop((left, top, left + CELL, top + CELL))


def visible_center_x(image: Image.Image, threshold: int = 32) -> float:
    alpha = image.getchannel("A")
    left = image.width
    right = -1
    for y in range(alpha.height):
        for x in range(alpha.width):
            value = alpha.getpixel((x, y))
            if value < threshold:
                continue
            left = min(left, x)
            right = max(right, x)
    if right < left:
        raise ValueError("expression layer has no visible pixels")
    return (left + right) / 2


def translate_cell(layer: Image.Image, shift_x: int) -> Image.Image:
    translated = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    translated.alpha_composite(layer, (shift_x, 0))
    return translated


def replace_cell(atlas: Image.Image, slot: int, layer: Image.Image) -> None:
    left = (slot % 3) * CELL
    top = (slot // 3) * CELL
    atlas.paste((0, 0, 0, 0), (left, top, left + CELL, top + CELL))
    atlas.alpha_composite(layer, (left, top))


def offsets(atlas: Image.Image) -> list[float]:
    return [
        visible_center_x(cell(atlas, mouth_slot))
        - visible_center_x(cell(atlas, eye_slot))
        for eye_slot, mouth_slot in EXPRESSION_SLOTS
    ]


def main(check: bool = False) -> None:
    for atlas_path, authored_shift in ATLASES.items():
        atlas = Image.open(atlas_path).convert("RGBA")
        if atlas.size != (ATLAS_SIZE, ATLAS_SIZE):
            raise ValueError(f"{atlas_path} must be {ATLAS_SIZE}x{ATLAS_SIZE}")

        current_offsets = offsets(atlas)
        aligned = all(abs(offset) <= 1 for offset in current_offsets)
        if not aligned and check:
            formatted = ", ".join(f"{offset:+.2f}px" for offset in current_offsets)
            raise ValueError(f"{atlas_path} has off-centre mouth layers: {formatted}")
        if aligned:
            continue
        if authored_shift == 0:
            formatted = ", ".join(f"{offset:+.2f}px" for offset in current_offsets)
            raise ValueError(f"{atlas_path} unexpectedly needs correction: {formatted}")

        corrected = atlas.copy()
        for _, mouth_slot in EXPRESSION_SLOTS:
            replace_cell(corrected, mouth_slot, translate_cell(cell(atlas, mouth_slot), authored_shift))
        remaining = offsets(corrected)
        if not all(abs(offset) <= 1 for offset in remaining):
            formatted = ", ".join(f"{offset:+.2f}px" for offset in remaining)
            raise ValueError(f"{atlas_path} correction did not center every mouth: {formatted}")
        corrected.save(atlas_path, optimize=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the committed atlas mouth alignment without changing files",
    )
    main(check=parser.parse_args().check)
