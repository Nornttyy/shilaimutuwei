#!/usr/bin/env python3
"""Generate deterministic, character-specific expression atlases for every rig.

The normal eyes and mouth stay in each rig's main atlas.  This script reads only
the current canonical atlases declared by ``assets/rig-parts.json``.  Variants
reuse each character's normal pixels, palette, eye spacing and mouth silhouette;
only small, profile-specific lid and mouth changes are introduced.  This keeps
the cast recognizable and avoids a shared generic angry/X-eye template.

Run from anywhere with:

    python3 scripts/generate-expression-atlases.py
"""

from __future__ import annotations

import argparse
import json
import re
from collections import deque
from pathlib import Path
from typing import Callable, Sequence

from PIL import Image, ImageChops, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "assets" / "rig-parts.json"
ALLOWED_ATLAS = re.compile(r"^assets/generated-v2/rig/[^/]+/atlas\.png$")
ALLOWED_VERSIONED_ATLASES = frozenset(
    {
        "assets/generated-v2/rig/survivor-shell-shell/atlas-layered-v3.png",
        "assets/generated-v2/rig/survivor-bubble-float/atlas-layered-v2.png",
        "assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v2.png",
        "assets/generated-v2/rig/enemy-windcap/atlas-layered-v2.png",
    }
)

EYE_VARIANTS = ("blink", "hurt", "attack")
MOUTH_VARIANTS = ("open", "hurt")
ALPHA_THRESHOLD = 32
SUPERSAMPLE = 4

# Every owner has its own restrained expression direction.  Numeric lid depths
# are fractions of that owner's original eye height, so the atlas stays fixed
# when source art dimensions differ.  Mouth transforms always reuse normal art
# unless a deliberately simple O mouth is requested.
ROLE_PROFILES = {
    "survivor-shell-shell": {
        "blink_curve": 0.08,
        "blink_offsets": (-0.01, 0.01),
        "attack_depths": (0.10, 0.10),
        "attack_focus": 0.045,
        "hurt_depths": (0.17, 0.17),
        "open_mouth": (0.82, 0.96, 0.0, 0.0, False),
        "hurt_mouth": (0.84, 0.76, 0.0, 2.0, True),
    },
    "survivor-crystal-pin": {
        "blink_curve": 0.03,
        "blink_offsets": (0.00, -0.02),
        "attack_depths": (0.055, 0.055),
        "attack_focus": 0.0,
        "hurt_depths": (0.13, 0.13),
        "open_mouth": (0.96, 1.06, 0.0, 0.0, False),
        "hurt_mouth": (0.90, 0.78, 0.0, 1.0, True),
    },
    "survivor-bubble-float": {
        "blink_curve": 0.14,
        "blink_offsets": (0.0, 0.0),
        "attack_depths": (0.015, 0.015),
        "attack_focus": 0.0,
        "hurt_depths": (0.10, 0.10),
        "open_mouth": "round-o",
        "hurt_mouth": (0.88, 0.72, 0.0, 2.0, True),
    },
    "survivor-moss-sprout": {
        "blink_curve": 0.17,
        "blink_offsets": (-0.01, 0.01),
        "attack_depths": (0.035, 0.035),
        "attack_focus": 0.0,
        "hurt_closed_curve": -0.12,
        "open_mouth": "small-o",
        "hurt_mouth": (0.86, 0.70, 0.0, 1.0, True),
    },
    "enemy-soft-biter": {
        "blink_curve": 0.05,
        "blink_offsets": (-0.02, 0.02),
        "attack_depths": (0.075, 0.10),
        "attack_focus": 0.025,
        "hurt_depths": (0.15, 0.19),
        "open_mouth": (0.98, 1.10, -1.0, 1.0, False),
        "hurt_mouth": (0.96, 0.78, -1.0, 2.0, True),
    },
    "enemy-windcap": {
        "blink_curve": 0.11,
        "blink_offsets": (0.02, -0.02),
        "attack_depths": (0.055, 0.085),
        "attack_focus": 0.0,
        "hurt_depths": (0.14, 0.10),
        "open_mouth": (0.90, 1.16, 1.0, 1.0, False),
        "hurt_mouth": (0.92, 0.75, 1.0, 2.0, True),
    },
    "enemy-stone-lump": {
        "blink_curve": 0.02,
        "blink_offsets": (0.0, 0.0),
        "attack_depths": (0.045, 0.065),
        "attack_focus": 0.015,
        "hurt_depths": (0.10, 0.13),
        "open_mouth": (1.0, 0.94, 0.0, 1.0, False),
        "hurt_mouth": (0.90, 0.72, 0.0, 2.0, True),
    },
    "enemy-acid-shell-king": {
        "eye_count": 3,
        "blink_curve": 0.0,
        "blink_stroke_ratio": 0.18,
        "blink_offsets": (-0.01, 0.0, 0.01),
        "attack_depths": (0.065, 0.045, 0.065),
        "attack_focus": 0.02,
        "hurt_depths": (0.12, 0.08, 0.09),
        "open_mouth": "preserve-acid",
        "hurt_mouth": (0.96, 0.90, 0.0, 1.0, False),
    },
}

Box = tuple[int, int, int, int]
Point = tuple[float, float]
Colour = tuple[int, int, int, int]


def _pixel_data(image: Image.Image):
    getter = getattr(image, "get_flattened_data", None)
    return getter() if getter is not None else image.getdata()


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


def _infer_eye_boxes(
    normal_eyes: Image.Image,
    expected_count: int = 2,
) -> tuple[Box, ...]:
    components = _connected_alpha_boxes(normal_eyes)
    minimum_area = max(24, normal_eyes.width * normal_eyes.height // 50)
    substantial = [component for component in components if component[0] >= minimum_area]
    if len(substantial) != expected_count:
        raise ValueError(
            f"expected {expected_count} alpha-connected eyes, found {len(substantial)} "
            f"in {normal_eyes.size} source"
        )

    boxes = sorted((component[1] for component in substantial), key=lambda box: box[0])
    left_center = (boxes[0][0] + boxes[0][2]) / 2
    right_center = (boxes[-1][0] + boxes[-1][2]) / 2
    if left_center >= normal_eyes.width / 2 or right_center <= normal_eyes.width / 2:
        raise ValueError(f"could not separate left and right eyes: {boxes}")
    if any(left[2] >= right[0] for left, right in zip(boxes, boxes[1:])):
        raise ValueError(f"facial eyes are not independently separated: {boxes}")
    return tuple(boxes)


def _scale_point(point: Point) -> tuple[int, int]:
    return round(point[0] * SUPERSAMPLE), round(point[1] * SUPERSAMPLE)


def _round_line(
    draw: ImageDraw.ImageDraw,
    points: Sequence[Point],
    width: float,
    fill: Colour,
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


def _sample_ink(image: Image.Image) -> Colour:
    """Sample the owner's own dark outline colour instead of a cast-wide ink."""

    pixels = [
        (red, green, blue)
        for red, green, blue, alpha in _pixel_data(image)
        if alpha >= 128 and max(red, green, blue) < 245
    ]
    if not pixels:
        raise ValueError(f"could not sample facial ink from {image.size} source")
    pixels.sort(key=lambda colour: colour[0] * 3 + colour[1] * 6 + colour[2])
    darkest = pixels[: max(12, len(pixels) // 5)]
    channels = [sorted(colour[index] for colour in darkest) for index in range(3)]
    middle = len(darkest) // 2
    return channels[0][middle], channels[1][middle], channels[2][middle], 255


def _paint_closed_eyes(
    draw: ImageDraw.ImageDraw,
    eye_boxes: Sequence[Box],
    ink: Colour,
    curve: float,
    offsets: Sequence[float],
    stroke_ratio: float = 0.12,
) -> None:
    """Draw one soft arc per original eye box, preserving horizontal centres."""

    for index, box in enumerate(eye_boxes):
        left, top, right, bottom = box
        width = right - left
        height = bottom - top
        inset = max(2.0, width * 0.08)
        left += inset
        right -= inset
        width = right - left
        center_y = (top + bottom) / 2 + height * offsets[index]
        points = (
            (left, center_y - curve * height * 0.25),
            (left + width * 0.25, center_y + curve * height * 0.45),
            (left + width * 0.50, center_y + curve * height),
            (left + width * 0.75, center_y + curve * height * 0.45),
            (right, center_y - curve * height * 0.25),
        )
        _round_line(
            draw,
            points,
            max(2.0, min(width, height) * stroke_ratio),
            ink,
        )


def _clear_lids(
    normal_eyes: Image.Image,
    eye_boxes: Sequence[Box],
    depths: Sequence[float],
    focus: float = 0.0,
) -> Image.Image:
    """Open the top interior of each eye without moving or resizing the eye."""

    if not any(depth > 0 for depth in depths):
        return normal_eyes.copy()

    mask = Image.new(
        "L",
        (normal_eyes.width * SUPERSAMPLE, normal_eyes.height * SUPERSAMPLE),
        0,
    )
    draw = ImageDraw.Draw(mask)
    for index, (box, depth) in enumerate(zip(eye_boxes, depths, strict=True)):
        if depth <= 0:
            continue
        left, top, right, bottom = box
        width = right - left
        height = bottom - top
        inset = max(2.0, width * 0.13)
        x1 = left + inset
        x2 = right - inset
        y_top = top + max(1.0, height * 0.025)
        base_depth = max(1.0, height * depth)
        # A tiny mirrored inner slope gives Shell/Boss a focused look.  Profiles
        # with focus=0 stay horizontal, so Bubble/Sprout never gain angry brows.
        if index == 0:
            y1 = y_top + base_depth - height * focus
            y2 = y_top + base_depth + height * focus
        elif index == len(eye_boxes) - 1:
            y1 = y_top + base_depth + height * focus
            y2 = y_top + base_depth - height * focus
        else:
            # A central Boss eye remains level while the two outside eyes aim
            # inward. Two-eye characters only use the branches above.
            y1 = y2 = y_top + base_depth
        draw.polygon(
            [
                _scale_point(point)
                for point in ((x1, y_top), (x2, y_top), (x2, y2), (x1, y1))
            ],
            fill=255,
        )

    mask = mask.resize(normal_eyes.size, Image.Resampling.LANCZOS)
    result = normal_eyes.copy()
    result.putalpha(ImageChops.multiply(normal_eyes.getchannel("A"), ImageOps.invert(mask)))
    return result


def _mouth_content_box(normal_mouth: Image.Image) -> Box:
    alpha_box = normal_mouth.getchannel("A").getbbox()
    if alpha_box is None:
        raise ValueError(f"normal mouth has no alpha content: {normal_mouth.size}")
    return alpha_box


def _transform_content(
    normal: Image.Image,
    transform: tuple[float, float, float, float, bool],
) -> Image.Image:
    """Reuse a normal mouth's pixels while making one restrained pose change."""

    scale_x, scale_y, shift_x, shift_y, flip_y = transform
    content_box = _mouth_content_box(normal)
    crop = normal.crop(content_box)
    target_size = (
        max(1, round(crop.width * scale_x)),
        max(1, round(crop.height * scale_y)),
    )
    crop = crop.resize(target_size, Image.Resampling.LANCZOS)
    if flip_y:
        crop = ImageOps.flip(crop)

    center_x = (content_box[0] + content_box[2]) / 2 + shift_x
    center_y = (content_box[1] + content_box[3]) / 2 + shift_y
    x = round(center_x - crop.width / 2)
    y = round(center_y - crop.height / 2)
    if x <= 0 or y <= 0 or x + crop.width >= normal.width or y + crop.height >= normal.height:
        raise ValueError(f"mouth transform exceeds transparent boundary: {normal.size}")
    result = Image.new("RGBA", normal.size, (0, 0, 0, 0))
    result.alpha_composite(crop, (x, y))
    return result


def _paint_o_mouth(
    draw: ImageDraw.ImageDraw,
    content_box: Box,
    ink: Colour,
    width_ratio: float,
    height_ratio: float,
) -> None:
    left, top, right, bottom = content_box
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    width = (right - left) * width_ratio
    height = (bottom - top) * height_ratio
    draw.ellipse(
        (
            round((center_x - width / 2) * SUPERSAMPLE),
            round((center_y - height / 2) * SUPERSAMPLE),
            round((center_x + width / 2) * SUPERSAMPLE),
            round((center_y + height / 2) * SUPERSAMPLE),
        ),
        fill=ink,
    )


def _assert_transparent_boundary(image: Image.Image, label: str) -> None:
    alpha_box = image.getchannel("A").getbbox()
    if alpha_box is None:
        raise ValueError(f"generated expression is empty: {label}")
    left, top, right, bottom = alpha_box
    if left <= 0 or top <= 0 or right >= image.width or bottom >= image.height:
        raise ValueError(f"generated expression lacks transparent boundary: {label}")


def generate_expression_sheet(
    owner: str,
    normal_eyes: Image.Image,
    normal_mouth: Image.Image,
) -> Image.Image:
    """Build one owner's atlas from its current normal face cells."""

    profile = ROLE_PROFILES.get(owner)
    if profile is None:
        raise ValueError(f"missing character-specific expression profile: {owner}")

    normal_eyes = normal_eyes.convert("RGBA")
    normal_mouth = normal_mouth.convert("RGBA")
    eye_boxes = _infer_eye_boxes(normal_eyes, profile.get("eye_count", 2))
    mouth_box = _mouth_content_box(normal_mouth)
    eye_ink = _sample_ink(normal_eyes)
    mouth_ink = _sample_ink(normal_mouth)

    blink = _render_cell(
        normal_eyes.size,
        lambda draw: _paint_closed_eyes(
            draw,
            eye_boxes,
            eye_ink,
            profile["blink_curve"],
            profile["blink_offsets"],
            stroke_ratio=profile.get("blink_stroke_ratio", 0.12),
        ),
    )
    attack = _clear_lids(
        normal_eyes,
        eye_boxes,
        profile["attack_depths"],
        profile["attack_focus"],
    )
    if "hurt_closed_curve" in profile:
        hurt = _render_cell(
            normal_eyes.size,
            lambda draw: _paint_closed_eyes(
                draw,
                eye_boxes,
                eye_ink,
                profile["hurt_closed_curve"],
                (0.03, -0.02),
                stroke_ratio=0.13,
            ),
        )
    else:
        hurt = _clear_lids(
            normal_eyes,
            eye_boxes,
            profile["hurt_depths"],
        )
    eyes = {
        "blink": blink,
        "hurt": hurt,
        "attack": attack,
    }

    open_style = profile["open_mouth"]
    if open_style == "round-o":
        open_mouth = _render_cell(
            normal_mouth.size,
            lambda draw: _paint_o_mouth(
                draw, mouth_box, mouth_ink, width_ratio=0.44, height_ratio=0.90
            ),
        )
    elif open_style == "small-o":
        open_mouth = _render_cell(
            normal_mouth.size,
            lambda draw: _paint_o_mouth(
                draw, mouth_box, mouth_ink, width_ratio=0.34, height_ratio=0.72
            ),
        )
    elif open_style == "preserve-acid":
        # Boss's acid-spitting mouth stays intact in every expression
        # replacement. Its three facial eyes are handled in the eyes slot;
        # the energy core remains a separate non-facial layer.
        # A 1% width change gives the open slot distinct pixels without
        # replacing the spray silhouette or introducing a new palette.
        open_mouth = _transform_content(
            normal_mouth,
            (0.99, 1.04, 0.0, 0.0, False),
        )
    else:
        open_mouth = _transform_content(normal_mouth, open_style)

    mouths = {
        "open": open_mouth,
        "hurt": _transform_content(normal_mouth, profile["hurt_mouth"]),
    }

    for variant, image in (*eyes.items(), *mouths.items()):
        _assert_transparent_boundary(image, f"{owner}:{variant}")

    eye_width, eye_height = normal_eyes.size
    mouth_width, mouth_height = normal_mouth.size
    atlas = Image.new(
        "RGBA",
        (
            max(eye_width * len(EYE_VARIANTS), mouth_width * len(MOUTH_VARIANTS)),
            eye_height + mouth_height,
        ),
        (0, 0, 0, 0),
    )
    for index, variant in enumerate(EYE_VARIANTS):
        atlas.alpha_composite(eyes[variant], (index * eye_width, 0))
    for index, variant in enumerate(MOUTH_VARIANTS):
        atlas.alpha_composite(mouths[variant], (index * mouth_width, eye_height))

    return atlas


def _generate_rig(owner: str, rig: dict) -> Path:
    normal_eyes = _source_crop(_part(rig, "eyes"))
    normal_mouth = _source_crop(_part(rig, "mouth"))
    atlas = generate_expression_sheet(owner, normal_eyes, normal_mouth)

    expression_name = (
        "expressions-v3.png" if owner == "survivor-shell-shell" else "expressions-v2.png"
    )
    output = ROOT / "assets" / "generated-v2" / "rig" / owner / expression_name
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
    if set(rigs) != set(ROLE_PROFILES):
        missing = sorted(set(rigs) - set(ROLE_PROFILES))
        stale = sorted(set(ROLE_PROFILES) - set(rigs))
        raise ValueError(f"expression profile mismatch; missing={missing}, stale={stale}")

    for owner, rig in rigs.items():
        output = _generate_rig(owner, rig)
        print(output.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
