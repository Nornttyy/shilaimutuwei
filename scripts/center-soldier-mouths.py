#!/usr/bin/env python3
"""Keep each formal soldier mouth compact and anchored beneath its eyes."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
CELL = 418
ATLAS_SIZE = CELL * 3
EXPRESSION_SLOTS = ((3, 4), (5, 6), (7, 8))
ATLASES = {
    ROOT / "assets/generated/soldier/soldier-shield-dun-atlas-v1.png": {
        "widths": (56, 60, 60),
        "center_y": 296.5,
    },
    ROOT / "assets/generated/soldier/soldier-bean-bow-atlas-v1.png": {
        "widths": (56, 60, 60),
        "center_y": 296.5,
    },
    ROOT / "assets/generated/soldier/soldier-bounce-hammer-atlas-v1.png": {
        "widths": (56, 70, 66),
        "center_y": 280.5,
    },
    ROOT / "assets/generated/soldier/soldier-leaf-spinner-atlas-v1.png": {
        "widths": (56, 70, 66),
        "center_y": 281.5,
    },
}


def cell(atlas: Image.Image, slot: int) -> Image.Image:
    left = (slot % 3) * CELL
    top = (slot // 3) * CELL
    return atlas.crop((left, top, left + CELL, top + CELL))


def visible_bounds(image: Image.Image, threshold: int = 32) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A").point(lambda value: 255 if value >= threshold else 0)
    bounds = alpha.getbbox()
    if bounds is None:
        raise ValueError("expression layer has no visible pixels")
    return bounds


def bounds_center(bounds: tuple[int, int, int, int]) -> tuple[float, float]:
    left, top, right, bottom = bounds
    return ((left + right - 1) / 2, (top + bottom - 1) / 2)


def visible_size(image: Image.Image) -> tuple[int, int]:
    left, top, right, bottom = visible_bounds(image)
    return right - left, bottom - top


def transform_cell(
    layer: Image.Image,
    target_width: int,
    target_center: tuple[float, float],
) -> Image.Image:
    """Scale only visible mouth pixels, then place their high-alpha center exactly."""
    source_box = layer.getchannel("A").getbbox()
    if source_box is None:
        raise ValueError("expression layer has no alpha content")
    content = layer.crop(source_box)
    current_width, _ = visible_size(layer)
    ratio = target_width / current_width
    scaled = content
    for _ in range(3):
        width = max(1, round(content.width * ratio))
        height = max(1, round(content.height * ratio))
        scaled = content.resize((width, height), Image.Resampling.LANCZOS)
        measured_width, _ = visible_size(scaled)
        if abs(measured_width - target_width) <= 1:
            break
        ratio *= target_width / measured_width

    center_x, center_y = bounds_center(visible_bounds(scaled))
    paste_x = round(target_center[0] - center_x)
    paste_y = round(target_center[1] - center_y)
    transformed = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    transformed.alpha_composite(scaled, (paste_x, paste_y))
    return transformed


def replace_cell(atlas: Image.Image, slot: int, layer: Image.Image) -> None:
    left = (slot % 3) * CELL
    top = (slot // 3) * CELL
    atlas.paste((0, 0, 0, 0), (left, top, left + CELL, top + CELL))
    atlas.alpha_composite(layer, (left, top))


def problems(atlas: Image.Image, profile: dict[str, object]) -> list[str]:
    issues = []
    target_widths = profile["widths"]
    target_center_y = float(profile["center_y"])
    for expression_index, (eye_slot, mouth_slot) in enumerate(EXPRESSION_SLOTS):
        eye_center = bounds_center(visible_bounds(cell(atlas, eye_slot)))
        mouth_layer = cell(atlas, mouth_slot)
        mouth_center = bounds_center(visible_bounds(mouth_layer))
        mouth_width, _ = visible_size(mouth_layer)
        target_width = int(target_widths[expression_index])
        if abs(mouth_center[0] - eye_center[0]) > 1:
            issues.append(
                f"slot {mouth_slot} x={mouth_center[0] - eye_center[0]:+.2f}px"
            )
        if abs(mouth_center[1] - target_center_y) > 1:
            issues.append(
                f"slot {mouth_slot} y={mouth_center[1]:.2f}px"
            )
        if abs(mouth_width - target_width) > 1:
            issues.append(
                f"slot {mouth_slot} width={mouth_width}px"
            )
    return issues


def main(check: bool = False) -> None:
    for atlas_path, profile in ATLASES.items():
        atlas = Image.open(atlas_path).convert("RGBA")
        if atlas.size != (ATLAS_SIZE, ATLAS_SIZE):
            raise ValueError(f"{atlas_path} must be {ATLAS_SIZE}x{ATLAS_SIZE}")

        current_problems = problems(atlas, profile)
        if current_problems and check:
            raise ValueError(f"{atlas_path} has invalid mouth layers: {', '.join(current_problems)}")
        if not current_problems:
            continue

        corrected = atlas.copy()
        for expression_index, (eye_slot, mouth_slot) in enumerate(EXPRESSION_SLOTS):
            eye_center_x, _ = bounds_center(visible_bounds(cell(atlas, eye_slot)))
            target_center = (eye_center_x, float(profile["center_y"]))
            target_width = int(profile["widths"][expression_index])
            replace_cell(
                corrected,
                mouth_slot,
                transform_cell(cell(atlas, mouth_slot), target_width, target_center),
            )
        remaining = problems(corrected, profile)
        if remaining:
            raise ValueError(f"{atlas_path} correction failed: {', '.join(remaining)}")
        corrected.save(atlas_path, optimize=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the committed atlas mouth alignment without changing files",
    )
    main(check=parser.parse_args().check)
