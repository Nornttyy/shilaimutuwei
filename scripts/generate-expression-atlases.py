#!/usr/bin/env python3
"""Generate small, deterministic facial-expression atlases for every rig.

The normal eyes and mouth stay in each rig's main atlas.  This script reads only
the current canonical atlases declared by ``assets/rig-parts.json``.  It uses the
normal eye alpha mask to locate the two eyes, then draws deliberately simple,
flat-colour variants into ``expressions-v2.png`` beside that atlas.

Run from anywhere with:

    python3 scripts/generate-expression-atlases.py
"""

from __future__ import annotations

import argparse
import json
import re
from collections import deque
from pathlib import Path
from typing import Callable, Iterable, Sequence

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "assets" / "rig-parts.json"
ALLOWED_ATLAS = re.compile(r"^assets/generated-v2/rig/[^/]+/atlas\.png$")
ALLOWED_VERSIONED_ATLASES = frozenset(
    {
        "assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v2.png",
    }
)

EYE_VARIANTS = ("blink", "hurt", "attack")
MOUTH_VARIANTS = ("open", "hurt")
ALPHA_THRESHOLD = 32
SUPERSAMPLE = 4

# One compact, high-saturation palette shared by the cast.  The generated art
# intentionally has no gradients, texture, shadows, or decorative detail.
INK = (8, 35, 92, 255)
ACCENT = (24, 201, 255, 255)
TONGUE = (255, 67, 145, 255)

Box = tuple[int, int, int, int]
Point = tuple[float, float]


def _part(rig: dict, part_id: str) -> dict:
    return next(part for part in rig["parts"] if part["id"] == part_id)


def _source_crop(part: dict) -> Image.Image:
    relative_path = part["path"]
    if (
        not ALLOWED_ATLAS.fullmatch(relative_path)
        and relative_path not in ALLOWED_VERSIONED_ATLASES
    ):
        raise ValueError(
            f"refusing non-current or non-rig image input: {relative_path}"
        )

    rect = part["sourceRect"]
    atlas = Image.open(ROOT / relative_path).convert("RGBA")
    box = (
        rect["x"],
        rect["y"],
        rect["x"] + rect["width"],
        rect["y"] + rect["height"],
    )
    crop = atlas.crop(box)
    expected_size = (rect["width"], rect["height"])
    if crop.size != expected_size:
        raise ValueError(f"invalid sourceRect for {relative_path}: {rect}")
    return crop


def _connected_alpha_boxes(image: Image.Image) -> list[tuple[int, Box]]:
    """Return alpha-component areas and boxes, largest first (4-connected)."""

    alpha = image.getchannel("A")
    width, height = image.size
    pixels = alpha.load()
    seen = bytearray(width * height)
    components: list[tuple[int, Box]] = []

    for start_y in range(height):
        for start_x in range(width):
            start_index = start_y * width + start_x
            if seen[start_index] or pixels[start_x, start_y] < ALPHA_THRESHOLD:
                continue

            queue = deque([(start_x, start_y)])
            seen[start_index] = 1
            area = 0
            min_x = max_x = start_x
            min_y = max_y = start_y

            while queue:
                x, y = queue.popleft()
                area += 1
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)

                for next_x, next_y in (
                    (x - 1, y),
                    (x + 1, y),
                    (x, y - 1),
                    (x, y + 1),
                ):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    index = next_y * width + next_x
                    if seen[index] or pixels[next_x, next_y] < ALPHA_THRESHOLD:
                        continue
                    seen[index] = 1
                    queue.append((next_x, next_y))

            components.append((area, (min_x, min_y, max_x + 1, max_y + 1)))

    return sorted(components, key=lambda component: component[0], reverse=True)


def _infer_eye_boxes(normal_eyes: Image.Image) -> tuple[Box, Box]:
    components = _connected_alpha_boxes(normal_eyes)
    minimum_area = max(24, normal_eyes.width * normal_eyes.height // 50)
    substantial = [component for component in components if component[0] >= minimum_area]
    if len(substantial) < 2:
        raise ValueError(
            f"expected two alpha-connected eyes, found {len(substantial)} "
            f"in {normal_eyes.size} source"
        )

    boxes = sorted((substantial[0][1], substantial[1][1]), key=lambda box: box[0])
    left_center = (boxes[0][0] + boxes[0][2]) / 2
    right_center = (boxes[1][0] + boxes[1][2]) / 2
    if left_center >= normal_eyes.width / 2 or right_center <= normal_eyes.width / 2:
        raise ValueError(f"could not separate left and right eyes: {boxes}")
    return boxes[0], boxes[1]


def _scale_point(point: Point) -> tuple[int, int]:
    return round(point[0] * SUPERSAMPLE), round(point[1] * SUPERSAMPLE)


def _round_line(
    draw: ImageDraw.ImageDraw,
    points: Sequence[Point],
    width: float,
    fill: tuple[int, int, int, int] = INK,
) -> None:
    scaled_points = [_scale_point(point) for point in points]
    scaled_width = max(SUPERSAMPLE, round(width * SUPERSAMPLE))
    draw.line(scaled_points, fill=fill, width=scaled_width, joint="curve")
    radius = scaled_width / 2
    for x, y in (scaled_points[0], scaled_points[-1]):
        draw.ellipse(
            (round(x - radius), round(y - radius), round(x + radius), round(y + radius)),
            fill=fill,
        )


def _render_cell(
    size: tuple[int, int], painter: Callable[[ImageDraw.ImageDraw], None]
) -> Image.Image:
    large = Image.new(
        "RGBA", (size[0] * SUPERSAMPLE, size[1] * SUPERSAMPLE), (0, 0, 0, 0)
    )
    painter(ImageDraw.Draw(large))
    return large.resize(size, Image.Resampling.LANCZOS)


def _inset_box(box: Box, x_ratio: float, y_ratio: float) -> tuple[float, ...]:
    left, top, right, bottom = box
    width = right - left
    height = bottom - top
    inset_x = max(2.5, width * x_ratio)
    inset_y = max(2.5, height * y_ratio)
    return left + inset_x, top + inset_y, right - inset_x, bottom - inset_y


def _paint_blink(draw: ImageDraw.ImageDraw, eye_boxes: Iterable[Box]) -> None:
    for box in eye_boxes:
        left, top, right, bottom = _inset_box(box, 0.10, 0.18)
        width = right - left
        height = bottom - top
        center_y = top + height * 0.54
        points = (
            (left, center_y - height * 0.07),
            (left + width * 0.25, center_y + height * 0.06),
            (left + width * 0.50, center_y + height * 0.11),
            (left + width * 0.75, center_y + height * 0.06),
            (right, center_y - height * 0.07),
        )
        _round_line(draw, points, max(2.2, min(width, height) * 0.14))


def _paint_hurt_eyes(draw: ImageDraw.ImageDraw, eye_boxes: Iterable[Box]) -> None:
    for box in eye_boxes:
        left, top, right, bottom = _inset_box(box, 0.20, 0.20)
        stroke = max(2.2, min(right - left, bottom - top) * 0.14)
        _round_line(draw, ((left, top), (right, bottom)), stroke)
        _round_line(draw, ((right, top), (left, bottom)), stroke)


def _paint_attack_eyes(draw: ImageDraw.ImageDraw, eye_boxes: Sequence[Box]) -> None:
    for index, box in enumerate(eye_boxes):
        left, top, right, bottom = _inset_box(box, 0.15, 0.10)
        width = right - left
        height = bottom - top
        draw.ellipse(
            (
                round(left * SUPERSAMPLE),
                round(top * SUPERSAMPLE),
                round(right * SUPERSAMPLE),
                round(bottom * SUPERSAMPLE),
            ),
            fill=INK,
        )

        # Cut an angled upper lid from a rounded eye. This keeps the attack
        # expression forceful without turning small faces into square blocks.
        if index == 0:
            cutout = (
                (left - 1, top - 1),
                (right + 1, top - 1),
                (right + 1, top + height * 0.30),
                (left - 1, top + height * 0.08),
            )
            accent_x = left + width * 0.63
        else:
            cutout = (
                (left - 1, top - 1),
                (right + 1, top - 1),
                (right + 1, top + height * 0.08),
                (left - 1, top + height * 0.30),
            )
            accent_x = left + width * 0.22

        draw.polygon(
            [_scale_point(point) for point in cutout],
            fill=(0, 0, 0, 0),
        )
        accent_width = max(2.0, width * 0.16)
        accent_height = max(2.0, height * 0.13)
        accent_y = top + height * 0.64
        draw.ellipse(
            (
                round((accent_x - accent_width / 2) * SUPERSAMPLE),
                round((accent_y - accent_height / 2) * SUPERSAMPLE),
                round((accent_x + accent_width / 2) * SUPERSAMPLE),
                round((accent_y + accent_height / 2) * SUPERSAMPLE),
            ),
            fill=ACCENT,
        )


def _mouth_content_box(normal_mouth: Image.Image) -> Box:
    alpha_box = normal_mouth.getchannel("A").getbbox()
    if alpha_box is None:
        raise ValueError(f"normal mouth has no alpha content: {normal_mouth.size}")
    return alpha_box


def _paint_open_mouth(draw: ImageDraw.ImageDraw, content_box: Box) -> None:
    left, top, right, bottom = content_box
    source_width = right - left
    source_height = bottom - top
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    width = source_width * 0.66
    height = source_height * 0.88
    oval = (
        round((center_x - width / 2) * SUPERSAMPLE),
        round((center_y - height / 2) * SUPERSAMPLE),
        round((center_x + width / 2) * SUPERSAMPLE),
        round((center_y + height / 2) * SUPERSAMPLE),
    )
    draw.ellipse(oval, fill=INK)

    tongue_width = width * 0.56
    tongue_height = height * 0.25
    tongue_y = center_y + height * 0.22
    draw.ellipse(
        (
            round((center_x - tongue_width / 2) * SUPERSAMPLE),
            round((tongue_y - tongue_height / 2) * SUPERSAMPLE),
            round((center_x + tongue_width / 2) * SUPERSAMPLE),
            round((tongue_y + tongue_height / 2) * SUPERSAMPLE),
        ),
        fill=TONGUE,
    )


def _paint_hurt_mouth(draw: ImageDraw.ImageDraw, content_box: Box) -> None:
    left, top, right, bottom = _inset_box(content_box, 0.08, 0.17)
    width = right - left
    height = bottom - top
    center_y = top + height * 0.52
    amplitude = height * 0.24
    points = tuple(
        (left + width * index / 4, center_y + (-amplitude if index % 2 == 0 else amplitude))
        for index in range(5)
    )
    _round_line(draw, points, max(2.0, min(width, height) * 0.12))


def _assert_transparent_boundary(image: Image.Image, label: str) -> None:
    alpha_box = image.getchannel("A").getbbox()
    if alpha_box is None:
        raise ValueError(f"generated expression is empty: {label}")
    left, top, right, bottom = alpha_box
    if left <= 0 or top <= 0 or right >= image.width or bottom >= image.height:
        raise ValueError(f"generated expression lacks transparent boundary: {label}")


def _generate_rig(owner: str, rig: dict) -> Path:
    normal_eyes = _source_crop(_part(rig, "eyes"))
    normal_mouth = _source_crop(_part(rig, "mouth"))
    eye_boxes = _infer_eye_boxes(normal_eyes)
    mouth_box = _mouth_content_box(normal_mouth)

    eyes = {
        "blink": _render_cell(
            normal_eyes.size, lambda draw: _paint_blink(draw, eye_boxes)
        ),
        "hurt": _render_cell(
            normal_eyes.size, lambda draw: _paint_hurt_eyes(draw, eye_boxes)
        ),
        "attack": _render_cell(
            normal_eyes.size, lambda draw: _paint_attack_eyes(draw, eye_boxes)
        ),
    }
    mouths = {
        "open": _render_cell(
            normal_mouth.size, lambda draw: _paint_open_mouth(draw, mouth_box)
        ),
        "hurt": _render_cell(
            normal_mouth.size, lambda draw: _paint_hurt_mouth(draw, mouth_box)
        ),
    }

    for variant, image in (*eyes.items(), *mouths.items()):
        _assert_transparent_boundary(image, f"{owner}:{variant}")

    eye_width, eye_height = normal_eyes.size
    mouth_width, mouth_height = normal_mouth.size
    atlas = Image.new(
        "RGBA",
        (max(eye_width * len(EYE_VARIANTS), mouth_width * len(MOUTH_VARIANTS)),
         eye_height + mouth_height),
        (0, 0, 0, 0),
    )
    for index, variant in enumerate(EYE_VARIANTS):
        atlas.alpha_composite(eyes[variant], (index * eye_width, 0))
    for index, variant in enumerate(MOUTH_VARIANTS):
        atlas.alpha_composite(mouths[variant], (index * mouth_width, eye_height))

    output = ROOT / "assets" / "generated-v2" / "rig" / owner / "expressions-v2.png"
    output.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(output, format="PNG", optimize=True)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=DEFAULT_MANIFEST,
        help="rig-parts manifest (default: assets/rig-parts.json)",
    )
    args = parser.parse_args()

    manifest_path = args.manifest.resolve()
    if manifest_path != DEFAULT_MANIFEST.resolve():
        raise ValueError("only the current assets/rig-parts.json manifest is allowed")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    rigs = manifest["rigs"]
    if len(rigs) != 8:
        raise ValueError(f"expected 8 current rigs, found {len(rigs)}")

    for owner, rig in rigs.items():
        output = _generate_rig(owner, rig)
        print(output.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
