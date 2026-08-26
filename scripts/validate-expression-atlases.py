#!/usr/bin/env python3
"""Validate the generated expression atlases referenced by rig-parts.json."""

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
ALPHA_THRESHOLD = 32


def _part(rig: dict, part_id: str) -> dict:
    return next(part for part in rig["parts"] if part["id"] == part_id)


def _rect_tuple(rect: dict) -> tuple[int, int, int, int]:
    fields = (rect.get("x"), rect.get("y"), rect.get("width"), rect.get("height"))
    if not all(isinstance(value, int) for value in fields):
        raise AssertionError(f"sourceRect must contain integer fields: {rect}")
    x, y, width, height = fields
    if x < 0 or y < 0 or width <= 0 or height <= 0:
        raise AssertionError(f"sourceRect must be positive and non-negative: {rect}")
    return x, y, width, height


def _overlap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def _alpha_components(image: Image.Image) -> list[int]:
    alpha = image.getchannel("A")
    width, height = image.size
    pixels = alpha.load()
    seen = bytearray(width * height)
    areas: list[int] = []

    for start_y in range(height):
        for start_x in range(width):
            start_index = start_y * width + start_x
            if seen[start_index] or pixels[start_x, start_y] < ALPHA_THRESHOLD:
                continue
            queue = deque([(start_x, start_y)])
            seen[start_index] = 1
            area = 0
            while queue:
                x, y = queue.popleft()
                area += 1
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
            areas.append(area)
    return sorted(areas, reverse=True)


def validate() -> dict[str, int]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    rigs = manifest["rigs"]
    if len(rigs) != 8:
        raise AssertionError(f"expected 8 rigs, found {len(rigs)}")

    stats = {
        "rigCount": len(rigs),
        "atlasCount": 0,
        "variantCount": 0,
        "eyeVariantCount": 0,
        "mouthVariantCount": 0,
        "faceOnlyAtlasCount": 0,
    }

    for owner, rig in rigs.items():
        eyes = _part(rig, "eyes")
        mouth = _part(rig, "mouth")
        expected_path = f"assets/generated-v2/rig/{owner}/expressions-v2.png"
        expression_paths: set[str] = set()
        all_rects: list[tuple[str, tuple[int, int, int, int]]] = []
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
                all_rects.append((f"{part_id}:{variant_name}", rect))
                stats["variantCount"] += 1
                stats[f"{part_id[:-1] if part_id == 'eyes' else part_id}VariantCount"] += 1

        if expression_paths != {expected_path}:
            raise AssertionError(f"{owner} must use exactly one expression atlas")
        expression_path = ROOT / expected_path
        if not expression_path.is_file():
            raise AssertionError(f"missing expression atlas: {expected_path}")

        image = Image.open(expression_path)
        if image.format != "PNG" or image.mode != "RGBA":
            raise AssertionError(f"{expected_path} must be an RGBA PNG")
        if image.size != expected_size:
            raise AssertionError(
                f"{expected_path} size {image.size} != expected {expected_size}"
            )
        stats["atlasCount"] += 1

        non_face_paths = {
            part["path"] for part in rig["parts"] if part["id"] not in {"eyes", "mouth"}
        }
        if expected_path in non_face_paths:
            raise AssertionError(f"{owner} body/non-face part references expression atlas")
        if any("variants" in part for part in rig["parts"] if part["id"] not in {"eyes", "mouth"}):
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
                raise AssertionError(f"{owner}:{label} must contain transparent and opaque pixels")

            part_id = label.split(":", 1)[0]
            variant_alpha[part_id].add(alpha.tobytes())
            components = _alpha_components(crop)
            if part_id == "eyes":
                minimum_area = max(12, width * height // 150)
                substantial = [area for area in components if area >= minimum_area]
                if len(substantial) != 2:
                    raise AssertionError(
                        f"{owner}:{label} must contain two separated eyes, got {substantial}"
                    )

        if len(variant_alpha["eyes"]) != 3 or len(variant_alpha["mouth"]) != 2:
            raise AssertionError(f"{owner} expression variants are not distinct bitmaps")

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
            f"validated {stats['variantCount']} variants in "
            f"{stats['atlasCount']} face-only atlases"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
