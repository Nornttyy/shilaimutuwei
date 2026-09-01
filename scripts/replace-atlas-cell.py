#!/usr/bin/env python3
"""Replace one cell in a fixed-grid RGBA atlas without disturbing the others."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("atlas", type=Path)
    parser.add_argument("replacement", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--columns", type=int, required=True)
    parser.add_argument("--rows", type=int, required=True)
    parser.add_argument("--index", type=int, required=True)
    parser.add_argument("--gutter", type=int, default=0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.columns <= 0 or args.rows <= 0:
        raise ValueError("columns and rows must be positive")
    if not 0 <= args.index < args.columns * args.rows:
        raise ValueError("index is outside the atlas grid")

    atlas = Image.open(args.atlas).convert("RGBA")
    if atlas.width % args.columns or atlas.height % args.rows:
        raise ValueError("atlas dimensions are not divisible by the requested grid")
    cell_width = atlas.width // args.columns
    cell_height = atlas.height // args.rows
    if args.gutter < 0 or args.gutter * 2 >= min(cell_width, cell_height):
        raise ValueError("gutter is invalid for the cell size")

    replacement = Image.open(args.replacement).convert("RGBA")
    if replacement.size != (cell_width, cell_height):
        raise ValueError(
            f"replacement must be exactly {cell_width}x{cell_height}, got "
            f"{replacement.width}x{replacement.height}"
        )

    column = args.index % args.columns
    row = args.index // args.columns
    left = column * cell_width
    top = row * cell_height
    atlas.paste((0, 0, 0, 0), (left, top, left + cell_width, top + cell_height))

    if args.gutter:
        replacement = replacement.crop(
            (args.gutter, args.gutter, cell_width - args.gutter, cell_height - args.gutter)
        )
        atlas.alpha_composite(replacement, (left + args.gutter, top + args.gutter))
    else:
        atlas.alpha_composite(replacement, (left, top))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(args.output, optimize=True)


if __name__ == "__main__":
    main()
