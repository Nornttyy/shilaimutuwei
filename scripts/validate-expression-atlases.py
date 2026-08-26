#!/usr/bin/env python3
"""Validate character-specific expression atlases referenced by rig-parts.json.

The checks deliberately compare every variant with that owner's current normal
face crop. This catches generic replacement faces while allowing restrained
lid and mouth motion inside fixed atlas cells.
"""

from __future__ import annotations

import argparse
import json
from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "assets" / "rig-parts.json"
EXPECTED_VARIANTS = {
    "eyes": {"blink", "hurt", "attack"},
    "mouth": {"open", "hurt"},
}
EXPECTED_OWNERS = {
    "survivor-shell-shell",
    "survivor-crystal-pin",
    "survivor-bubble-float",
    "survivor-moss-sprout",
    "enemy-soft-biter",
    "enemy-windcap",
    "enemy-stone-lump",
    "enemy-acid-shell-king",
}
ENEMY_OWNERS = {
    "enemy-soft-biter",
    "enemy-windcap",
    "enemy-stone-lump",
    "enemy-acid-shell-king",
}
ALPHA_THRESHOLD = 32
EYE_COUNTS = {owner: 2 for owner in EXPECTED_OWNERS} | {
    "enemy-acid-shell-king": 3,
}

# Minimum retained normal-eye alpha for open expressions. Sprout's hurt eyes
# are intentionally closed arcs and are verified by geometry instead.
EYE_OVERLAP_MINIMUMS = {
    "survivor-shell-shell": {"attack": 0.93, "hurt": 0.86},
    "survivor-crystal-pin": {"attack": 0.97, "hurt": 0.93},
    "survivor-bubble-float": {"attack": 0.99, "hurt": 0.93},
    "survivor-moss-sprout": {"attack": 0.97},
    "enemy-soft-biter": {"attack": 0.96, "hurt": 0.90},
    "enemy-windcap": {"attack": 0.98, "hurt": 0.96},
    "enemy-stone-lump": {"attack": 0.98, "hurt": 0.95},
    "enemy-acid-shell-king": {"attack": 0.98, "hurt": 0.96},
}

# Enemy mouths retain their source silhouette as well as their own palette.
# Different minima reflect the deliberately different mouth motions.
ENEMY_MOUTH_OVERLAP_MINIMUMS = {
    "enemy-soft-biter": {"open": 0.95, "hurt": 0.50},
    "enemy-windcap": {"open": 0.84, "hurt": 0.30},
    "enemy-stone-lump": {"open": 0.86, "hurt": 0.55},
    "enemy-acid-shell-king": {"open": 0.97, "hurt": 0.83},
}

Box = tuple[int, int, int, int]
Region = tuple[int, Box]


def _pixel_data(image: Image.Image):
    getter = getattr(image, "get_flattened_data", None)
    return getter() if getter is not None else image.getdata()


def _part(rig: dict, part_id: str) -> dict:
    return next(part for part in rig["parts"] if part["id"] == part_id)


def _rect_tuple(rect: dict) -> Box:
    fields = (rect.get("x"), rect.get("y"), rect.get("width"), rect.get("height"))
    if not all(isinstance(value, int) for value in fields):
        raise AssertionError(f"sourceRect must contain integer fields: {rect}")
    x, y, width, height = fields
    if x < 0 or y < 0 or width <= 0 or height <= 0:
        raise AssertionError(f"sourceRect must be positive and non-negative: {rect}")
    return x, y, width, height


def _overlap(a: Box, b: Box) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def _source_crop(part: dict) -> Image.Image:
    path = ROOT / part["path"]
    if not path.is_file():
        raise AssertionError(f"missing normal face atlas: {part['path']}")
    with Image.open(path) as atlas:
        image = atlas.convert("RGBA")
    x, y, width, height = _rect_tuple(part["sourceRect"])
    if x + width > image.width or y + height > image.height:
        raise AssertionError(f"normal face sourceRect exceeds {part['path']}")
    return image.crop((x, y, x + width, y + height))


def _alpha_regions(image: Image.Image) -> list[Region]:
    """Return substantial alpha-connected regions and their exact boxes."""

    alpha = image.getchannel("A")
    width, height = image.size
    pixels = alpha.load()
    seen = bytearray(width * height)
    regions: list[Region] = []

    for start_y in range(height):
        for start_x in range(width):
            start_index = start_y * width + start_x
            if seen[start_index] or pixels[start_x, start_y] < ALPHA_THRESHOLD:
                continue
            queue = deque([(start_x, start_y)])
            seen[start_index] = 1
            area = 0
            left = right = start_x
            top = bottom = start_y
            while queue:
                x, y = queue.popleft()
                area += 1
                left = min(left, x)
                right = max(right, x)
                top = min(top, y)
                bottom = max(bottom, y)
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
            regions.append((area, (left, top, right + 1, bottom + 1)))

    minimum_area = max(12, width * height // 150)
    return sorted(
        (region for region in regions if region[0] >= minimum_area),
        key=lambda region: region[1][0],
    )


def _eye_regions(
    image: Image.Image,
    label: str,
    expected_count: int = 2,
) -> tuple[Region, ...]:
    regions = _alpha_regions(image)
    if len(regions) != expected_count:
        raise AssertionError(
            f"{label} must contain {expected_count} separated facial eyes, got {regions}"
        )
    return tuple(regions)


def _alpha_overlap(base: Image.Image, variant: Image.Image) -> float:
    base_alpha = base.getchannel("A").tobytes()
    variant_alpha = variant.getchannel("A").tobytes()
    base_pixels = sum(alpha >= ALPHA_THRESHOLD for alpha in base_alpha)
    if base_pixels == 0:
        raise AssertionError("normal face crop has no alpha")
    shared_pixels = sum(
        left >= ALPHA_THRESHOLD and right >= ALPHA_THRESHOLD
        for left, right in zip(base_alpha, variant_alpha, strict=True)
    )
    return shared_pixels / base_pixels


def _palette_bins(image: Image.Image) -> set[tuple[int, int, int]]:
    return {
        (red // 24, green // 24, blue // 24)
        for red, green, blue, alpha in _pixel_data(image)
        if alpha >= ALPHA_THRESHOLD
    }


def _variant_palette_retention(base: Image.Image, variant: Image.Image) -> float:
    base_palette = _palette_bins(base)
    variant_palette = _palette_bins(variant)
    if not variant_palette:
        raise AssertionError("generated face crop has no visible palette")
    return len(base_palette & variant_palette) / len(variant_palette)


def _generic_pink_count(image: Image.Image) -> int:
    """Count pixels in the former cast-wide hot-pink tongue range."""

    return sum(
        alpha >= ALPHA_THRESHOLD
        and red >= 240
        and green <= 105
        and 105 <= blue <= 190
        for red, green, blue, alpha in _pixel_data(image)
    )


def _box_center_x(box: Box) -> float:
    return (box[0] + box[2]) / 2


def _box_width(box: Box) -> int:
    return box[2] - box[0]


def _box_height(box: Box) -> int:
    return box[3] - box[1]


def _validate_eye_geometry(
    owner: str,
    normal: Image.Image,
    variants: dict[str, Image.Image],
) -> None:
    expected_count = EYE_COUNTS[owner]
    normal_regions = _eye_regions(
        normal,
        f"{owner}:eyes:normal",
        expected_count,
    )

    for variant_name, image in variants.items():
        regions = _eye_regions(
            image,
            f"{owner}:eyes:{variant_name}",
            expected_count,
        )
        for index, ((_, normal_box), (area, box)) in enumerate(
            zip(normal_regions, regions, strict=True)
        ):
            if abs(_box_center_x(box) - _box_center_x(normal_box)) > 1.5:
                raise AssertionError(
                    f"{owner}:eyes:{variant_name}:{index} changes eye spacing"
                )
            minimum_width_ratio = 0.88 if variant_name == "blink" else 0.96
            if owner == "survivor-moss-sprout" and variant_name == "hurt":
                minimum_width_ratio = 0.94
            if _box_width(box) / _box_width(normal_box) < minimum_width_ratio:
                raise AssertionError(
                    f"{owner}:eyes:{variant_name}:{index} changes eye width too much"
                )

            box_area = _box_width(box) * _box_height(box)
            fill_ratio = area / box_area
            closed = variant_name == "blink" or (
                owner == "survivor-moss-sprout" and variant_name == "hurt"
            )
            if closed:
                if _box_height(box) / _box_width(box) > 0.55:
                    raise AssertionError(
                        f"{owner}:eyes:{variant_name}:{index} is not a natural closed arc"
                    )
            elif variant_name == "hurt" and fill_ratio < 0.50:
                raise AssertionError(
                    f"{owner}:eyes:hurt:{index} resembles sparse/X eyes"
                )

    for variant_name, minimum in EYE_OVERLAP_MINIMUMS[owner].items():
        overlap_ratio = _alpha_overlap(normal, variants[variant_name])
        if overlap_ratio < minimum:
            raise AssertionError(
                f"{owner}:eyes:{variant_name} retains only "
                f"{overlap_ratio:.3f} of the normal eye shape"
            )

    if owner == "survivor-bubble-float":
        if variants["attack"].tobytes() == normal.tobytes():
            raise AssertionError("Bubble attack eyes need a subtle independent pose")


def _validate_enemy_identity(
    owner: str,
    normal_eyes: Image.Image,
    eye_variants: dict[str, Image.Image],
    normal_mouth: Image.Image,
    mouth_variants: dict[str, Image.Image],
) -> None:
    expected_count = EYE_COUNTS[owner]
    normal_regions = _eye_regions(
        normal_eyes,
        f"{owner}:eyes:normal",
        expected_count,
    )
    normal_delta = normal_regions[0][0] - normal_regions[-1][0]

    for variant_name in ("attack", "hurt"):
        variant = eye_variants[variant_name]
        if _variant_palette_retention(normal_eyes, variant) < 0.95:
            raise AssertionError(
                f"{owner}:eyes:{variant_name} loses the owner's pupil palette"
            )
        regions = _eye_regions(
            variant,
            f"{owner}:eyes:{variant_name}",
            expected_count,
        )
        variant_delta = regions[0][0] - regions[-1][0]
        if normal_delta * variant_delta <= 0:
            raise AssertionError(
                f"{owner}:eyes:{variant_name} loses the owner's eye asymmetry"
            )

    for variant_name, minimum in ENEMY_MOUTH_OVERLAP_MINIMUMS[owner].items():
        variant = mouth_variants[variant_name]
        overlap_ratio = _alpha_overlap(normal_mouth, variant)
        if overlap_ratio < minimum:
            raise AssertionError(
                f"{owner}:mouth:{variant_name} loses its source mouth silhouette"
            )
        if _variant_palette_retention(normal_mouth, variant) < 0.45:
            raise AssertionError(
                f"{owner}:mouth:{variant_name} replaces its character palette"
            )


def validate() -> dict[str, int]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    rigs = manifest["rigs"]
    if set(rigs) != EXPECTED_OWNERS:
        raise AssertionError(
            f"expression owner mismatch: {sorted(set(rigs) ^ EXPECTED_OWNERS)}"
        )

    stats = {
        "rigCount": len(rigs),
        "atlasCount": 0,
        "variantCount": 0,
        "eyeVariantCount": 0,
        "mouthVariantCount": 0,
        "faceOnlyAtlasCount": 0,
        "roleProfileCount": 0,
        "fixedFaceCellCount": 0,
        "noXHurtOwnerCount": 0,
        "enemyIdentityCount": 0,
        "bossThreeEyeContractCount": 0,
    }

    for owner, rig in rigs.items():
        eyes = _part(rig, "eyes")
        mouth = _part(rig, "mouth")
        normal_eyes = _source_crop(eyes)
        normal_mouth = _source_crop(mouth)
        expression_name = (
            "expressions-v3.png" if owner == "survivor-shell-shell" else "expressions-v2.png"
        )
        expected_path = f"assets/generated-v2/rig/{owner}/{expression_name}"
        expression_paths: set[str] = set()
        all_rects: list[tuple[str, Box]] = []
        variant_images: dict[str, dict[str, Image.Image]] = {"eyes": {}, "mouth": {}}
        variant_alpha: dict[str, set[bytes]] = {"eyes": set(), "mouth": set()}

        eye_base = _rect_tuple(eyes["sourceRect"])
        mouth_base = _rect_tuple(mouth["sourceRect"])
        expected_size = (
            max(eye_base[2] * 3, mouth_base[2] * 2),
            eye_base[3] + mouth_base[3],
        )

        for part_id, part in (("eyes", eyes), ("mouth", mouth)):
            variants = part.get("variants")
            if not isinstance(variants, dict) or set(variants) != EXPECTED_VARIANTS[part_id]:
                raise AssertionError(
                    f"{owner}:{part_id} variants must be "
                    f"{sorted(EXPECTED_VARIANTS[part_id])}"
                )
            base_rect = _rect_tuple(part["sourceRect"])

            for variant_name, variant in variants.items():
                path = variant.get("path")
                if path != expected_path:
                    raise AssertionError(
                        f"{owner}:{part_id}:{variant_name} uses unexpected path {path}"
                    )
                if "bindRect" in variant and variant["bindRect"] != part["bindRect"]:
                    raise AssertionError(
                        f"{owner}:{part_id}:{variant_name} changes the facial bindRect"
                    )
                expression_paths.add(path)
                rect = _rect_tuple(variant.get("sourceRect", {}))
                if rect[2:] != base_rect[2:]:
                    raise AssertionError(
                        f"{owner}:{part_id}:{variant_name} changes the fixed face-cell size"
                    )
                all_rects.append((f"{part_id}:{variant_name}", rect))
                stats["variantCount"] += 1
                stats[f"{part_id[:-1] if part_id == 'eyes' else part_id}VariantCount"] += 1
                stats["fixedFaceCellCount"] += 1

        if expression_paths != {expected_path}:
            raise AssertionError(f"{owner} must use exactly one expression atlas")
        expression_path = ROOT / expected_path
        if not expression_path.is_file():
            raise AssertionError(f"missing expression atlas: {expected_path}")

        with Image.open(expression_path) as atlas:
            if atlas.format != "PNG" or atlas.mode != "RGBA":
                raise AssertionError(f"{expected_path} must be an RGBA PNG")
            if atlas.size != expected_size:
                raise AssertionError(
                    f"{expected_path} size {atlas.size} != expected {expected_size}"
                )
            image = atlas.copy()
        stats["atlasCount"] += 1

        non_face_parts = [
            part for part in rig["parts"] if part["id"] not in {"eyes", "mouth"}
        ]
        if expected_path in {part["path"] for part in non_face_parts}:
            raise AssertionError(f"{owner} body/non-face part references expression atlas")
        if any("variants" in part for part in non_face_parts):
            raise AssertionError(f"{owner} body/non-face part unexpectedly has variants")
        stats["faceOnlyAtlasCount"] += 1

        for index, (label, rect) in enumerate(all_rects):
            x, y, width, height = rect
            if x + width > image.width or y + height > image.height:
                raise AssertionError(f"{owner}:{label} sourceRect exceeds PNG bounds")
            for other_label, other_rect in all_rects[index + 1 :]:
                if _overlap(rect, other_rect):
                    raise AssertionError(
                        f"{owner} expression cells overlap: {label} and {other_label}"
                    )

            crop = image.crop((x, y, x + width, y + height))
            alpha = crop.getchannel("A")
            alpha_box = alpha.getbbox()
            if alpha_box is None:
                raise AssertionError(f"{owner}:{label} has empty alpha")
            left, top, right, bottom = alpha_box
            if left <= 0 or top <= 0 or right >= width or bottom >= height:
                raise AssertionError(f"{owner}:{label} has no transparent cell boundary")
            if alpha.getextrema() != (0, 255):
                raise AssertionError(
                    f"{owner}:{label} must contain transparent and opaque pixels"
                )

            part_id, variant_name = label.split(":", 1)
            variant_images[part_id][variant_name] = crop
            variant_alpha[part_id].add(alpha.tobytes())
            if part_id == "eyes":
                _eye_regions(crop, f"{owner}:{label}", EYE_COUNTS[owner])

        if len(variant_alpha["eyes"]) != 3 or len(variant_alpha["mouth"]) != 2:
            raise AssertionError(f"{owner} expression variants are not distinct bitmaps")

        _validate_eye_geometry(owner, normal_eyes, variant_images["eyes"])
        for part_id, normal in (("eyes", normal_eyes), ("mouth", normal_mouth)):
            for variant_name, variant in variant_images[part_id].items():
                if _variant_palette_retention(normal, variant) < 0.45:
                    raise AssertionError(
                        f"{owner}:{part_id}:{variant_name} introduces a generic face palette"
                    )
                base_palette = _palette_bins(normal)
                variant_palette = _palette_bins(variant)
                if len(variant_palette) > len(base_palette) + max(2, len(base_palette) // 4):
                    raise AssertionError(
                        f"{owner}:{part_id}:{variant_name} adds excessive face detail"
                    )
                if part_id == "mouth" and _generic_pink_count(variant) > _generic_pink_count(normal):
                    raise AssertionError(
                        f"{owner}:mouth:{variant_name} adds a generic pink tongue"
                    )
        stats["roleProfileCount"] += 1
        stats["noXHurtOwnerCount"] += 1

        if owner in ENEMY_OWNERS:
            _validate_enemy_identity(
                owner,
                normal_eyes,
                variant_images["eyes"],
                normal_mouth,
                variant_images["mouth"],
            )
            stats["enemyIdentityCount"] += 1

        if owner == "enemy-acid-shell-king":
            core = _part(rig, "core")
            if core.get("variants") or core["path"] == expected_path:
                raise AssertionError("Boss energy core must remain an independent non-facial layer")
            if core["path"] == eyes["path"] and _overlap(
                _rect_tuple(core["sourceRect"]),
                _rect_tuple(eyes["sourceRect"]),
            ):
                raise AssertionError("Boss energy core must not overlap the three-eye face cell")
            normal_regions = _eye_regions(normal_eyes, f"{owner}:eyes:normal", 3)
            middle_area, middle_box = normal_regions[1]
            if middle_area >= min(normal_regions[0][0], normal_regions[2][0]):
                raise AssertionError("Boss central third eye must be distinct and smaller")
            if middle_box[1] >= min(normal_regions[0][1][1], normal_regions[2][1][1]):
                raise AssertionError("Boss central third eye must sit above the outside eyes")
            for variant_name, variant in variant_images["eyes"].items():
                regions = _eye_regions(variant, f"{owner}:eyes:{variant_name}", 3)
                if regions[1][0] >= min(regions[0][0], regions[2][0]):
                    raise AssertionError(
                        f"Boss {variant_name} central third eye loses its smaller identity"
                    )
            if _alpha_overlap(normal_mouth, variant_images["mouth"]["open"]) < 0.97:
                raise AssertionError("Boss open expression must preserve the acid-spitting mouth")
            stats["bossThreeEyeContractCount"] += 1

    if stats["variantCount"] != 40:
        raise AssertionError(f"expected 40 facial variants, found {stats['variantCount']}")
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="print machine-readable stats")
    args = parser.parse_args()
    stats = validate()
    if args.json:
        print(json.dumps(stats, sort_keys=True))
    else:
        print(
            f"validated {stats['variantCount']} character-specific variants in "
            f"{stats['atlasCount']} face-only atlases"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
