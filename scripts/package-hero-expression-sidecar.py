#!/usr/bin/env python3
"""Align a two-cell generated expression sidecar to a canonical hero atlas.

The source is any strictly 2:1 RGBA image: eyes in the left square and mouth
in the right square.  The output is a fixed 836x418 RGBA atlas whose cells are
scaled and aligned to canonical normal-eye cell 3 and normal-mouth cell 4.
"""

from __future__ import annotations

import argparse
import math
import os
import tempfile
from pathlib import Path

from PIL import Image


CANONICAL_SIZE = 1254
CANONICAL_GRID = 3
CELL_SIZE = CANONICAL_SIZE // CANONICAL_GRID
OUTPUT_SIZE = (CELL_SIZE * 2, CELL_SIZE)
GUTTER = 2
REFERENCE_SCALE = 1.08
EYES_REFERENCE_CELL = 3
MOUTH_REFERENCE_CELL = 4


class SidecarValidationError(ValueError):
    """Raised when a sidecar cannot be packaged without clipping or guessing."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build an 836x418 eyes/mouth sidecar aligned to canonical atlas "
            "cells 3 and 4."
        )
    )
    parser.add_argument("input", type=Path, help="strict 2:1 RGBA eyes/mouth source")
    parser.add_argument("canonical", type=Path, help="1254x1254 canonical RGBA atlas")
    parser.add_argument("output", type=Path, help="output PNG path")
    return parser.parse_args()


def _edge_has_alpha(alpha: Image.Image) -> bool:
    width, height = alpha.size
    edges = (
        alpha.crop((0, 0, width, 1)),
        alpha.crop((0, height - 1, width, height)),
        alpha.crop((0, 0, 1, height)),
        alpha.crop((width - 1, 0, width, height)),
    )
    return any(edge.getextrema()[1] != 0 for edge in edges)


def _validate_visible_cell(cell: Image.Image, label: str) -> tuple[int, int, int, int]:
    alpha = cell.getchannel("A")
    bounds = alpha.getbbox()
    if bounds is None:
        raise SidecarValidationError(f"{label} is empty")
    if _edge_has_alpha(alpha):
        raise SidecarValidationError(
            f"{label} has non-transparent pixels on a cell edge"
        )
    return bounds


def _load_source(path: Path) -> tuple[Image.Image, Image.Image]:
    if not path.is_file():
        raise SidecarValidationError(f"input does not exist: {path}")
    try:
        with Image.open(path) as source:
            source.load()
            if source.mode != "RGBA":
                raise SidecarValidationError(
                    f"input must be RGBA, got {source.mode}; refusing to infer transparency"
                )
            if source.width != source.height * 2:
                raise SidecarValidationError(
                    f"input must have an exact 2:1 ratio, got {source.width}x{source.height}"
                )
            if source.height < 1:
                raise SidecarValidationError("input dimensions must be positive")
            image = source.copy()
    except SidecarValidationError:
        raise
    except (OSError, ValueError) as error:
        raise SidecarValidationError(f"could not read input {path}: {error}") from error

    half = image.width // 2
    eyes = image.crop((0, 0, half, image.height))
    mouth = image.crop((half, 0, image.width, image.height))
    _validate_visible_cell(eyes, "input eyes cell")
    _validate_visible_cell(mouth, "input mouth cell")
    return eyes, mouth


def _canonical_cell_box(index: int) -> tuple[int, int, int, int]:
    left = index % CANONICAL_GRID * CELL_SIZE
    top = index // CANONICAL_GRID * CELL_SIZE
    return left, top, left + CELL_SIZE, top + CELL_SIZE


def _load_canonical_references(
    path: Path,
) -> tuple[tuple[int, int, int, int], tuple[int, int, int, int]]:
    if not path.is_file():
        raise SidecarValidationError(f"canonical does not exist: {path}")
    try:
        with Image.open(path) as source:
            source.load()
            if source.size != (CANONICAL_SIZE, CANONICAL_SIZE):
                raise SidecarValidationError(
                    f"canonical must be {CANONICAL_SIZE}x{CANONICAL_SIZE}, got "
                    f"{source.width}x{source.height}"
                )
            if source.mode != "RGBA":
                raise SidecarValidationError(
                    f"canonical must be RGBA, got {source.mode}; refusing to infer transparency"
                )
            image = source.copy()
    except SidecarValidationError:
        raise
    except (OSError, ValueError) as error:
        raise SidecarValidationError(f"could not read canonical {path}: {error}") from error

    eyes = image.crop(_canonical_cell_box(EYES_REFERENCE_CELL))
    mouth = image.crop(_canonical_cell_box(MOUTH_REFERENCE_CELL))
    return (
        _validate_visible_cell(eyes, "canonical normal-eyes cell 3"),
        _validate_visible_cell(mouth, "canonical normal-mouth cell 4"),
    )


def _aligned_cell(
    source: Image.Image,
    reference_bounds: tuple[int, int, int, int],
    label: str,
) -> Image.Image:
    source_bounds = source.getchannel("A").getbbox()
    if source_bounds is None:
        raise SidecarValidationError(f"{label} is empty")
    content = source.crop(source_bounds)

    ref_left, ref_top, ref_right, ref_bottom = reference_bounds
    ref_width = ref_right - ref_left
    ref_height = ref_bottom - ref_top
    maximum_width = min(
        CELL_SIZE - GUTTER * 2,
        max(1, math.floor(ref_width * REFERENCE_SCALE)),
    )
    maximum_height = min(
        CELL_SIZE - GUTTER * 2,
        max(1, math.floor(ref_height * REFERENCE_SCALE)),
    )
    scale = min(maximum_width / content.width, maximum_height / content.height)
    resized_width = max(1, min(maximum_width, round(content.width * scale)))
    resized_height = max(1, min(maximum_height, round(content.height * scale)))
    resized = content.resize(
        (resized_width, resized_height),
        Image.Resampling.LANCZOS,
    )

    reference_center_x = (ref_left + ref_right) / 2
    reference_center_y = (ref_top + ref_bottom) / 2
    target_left = round(reference_center_x - resized_width / 2)
    target_top = round(reference_center_y - resized_height / 2)
    if (
        target_left < GUTTER
        or target_top < GUTTER
        or target_left + resized_width > CELL_SIZE - GUTTER
        or target_top + resized_height > CELL_SIZE - GUTTER
    ):
        raise SidecarValidationError(
            f"{label} cannot stay centered on its canonical bounds with a {GUTTER}px gutter"
        )

    cell = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    cell.paste(resized, (target_left, target_top))
    if _edge_has_alpha(cell.getchannel("A")):
        raise SidecarValidationError(f"could not preserve the transparent edge for {label}")
    return cell


def package_sidecar(input_path: Path, canonical_path: Path, output_path: Path) -> None:
    input_resolved = input_path.expanduser().resolve()
    canonical_resolved = canonical_path.expanduser().resolve()
    output_resolved = output_path.expanduser().resolve()
    if output_resolved in (input_resolved, canonical_resolved):
        raise SidecarValidationError("output must not overwrite either input image")

    eyes, mouth = _load_source(input_resolved)
    eyes_reference, mouth_reference = _load_canonical_references(canonical_resolved)
    output = Image.new("RGBA", OUTPUT_SIZE, (0, 0, 0, 0))
    output.paste(_aligned_cell(eyes, eyes_reference, "eyes"), (0, 0))
    output.paste(_aligned_cell(mouth, mouth_reference, "mouth"), (CELL_SIZE, 0))

    output_resolved.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=output_resolved.parent,
            prefix=f".{output_resolved.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
        output.save(temporary_path, format="PNG", optimize=True)
        os.replace(temporary_path, output_resolved)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def main() -> None:
    args = parse_args()
    try:
        package_sidecar(args.input, args.canonical, args.output)
    except (SidecarValidationError, OSError) as error:
        raise SystemExit(f"error: {error}") from error
    print(f"Packaged hero expression sidecar: {args.output}")


if __name__ == "__main__":
    main()
