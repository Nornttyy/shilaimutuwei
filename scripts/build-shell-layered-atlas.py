#!/usr/bin/env python3
"""Build Shell's production RGBA atlas from the approved generated layer master.

The image generator supplied the five required visual groups in six 512px
cells, but baked its transparency checker into an RGB image.  This builder
turns only the large, saturated/dark connected artwork components into alpha,
fills enclosed light highlights, and packs the five runtime layers into the
project's 768x512 atlas convention.  It never reads review/preview assets.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import tempfile
from collections import deque
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OWNER = "survivor-shell-shell"
SOURCE = ROOT / "assets/generated-v2/rig" / OWNER / "layer-master-v3.png"
OUTPUT = ROOT / "assets/generated-v2/rig" / OWNER / "atlas-layered-v3.png"
REPORT = ROOT / "assets/generated-v2/rig" / OWNER / "atlas-layered-v3.json"
SOURCE_SHA256 = "76739c65633479f431a3ccc22c133c7d4a9b348a8c499bc50f2875b1a8897e3b"
CELL_SIZE = 512
ATLAS_SIZE = (1024, 768)
TARGET_PADDING = 4


@dataclass(frozen=True)
class LayerSpec:
    name: str
    cell: tuple[int, int]
    component_count: int
    source_rect: tuple[int, int, int, int]


LAYERS = (
    LayerSpec("shellBack", (0, 0), 1, (4, 4, 496, 440)),
    LayerSpec("body", (1, 0), 1, (508, 4, 408, 280)),
    LayerSpec("shellFront", (2, 0), 1, (508, 292, 320, 256)),
    LayerSpec("eyes", (0, 1), 2, (836, 292, 172, 84)),
    LayerSpec("mouth", (1, 1), 1, (836, 384, 64, 60)),
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_write_bytes(target: Path, data: bytes) -> None:
    """Replace a generated artifact without exposing a partial PNG/JSON."""

    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=target.parent,
        prefix=f".{target.name}.",
        suffix=".tmp",
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def foreground_seed(rgb: Image.Image) -> bytearray:
    """Separate colored/dark art from the near-white generated checker."""

    width, height = rgb.size
    pixels = rgb.load()
    mask = bytearray(width * height)
    for y in range(height):
        for x in range(width):
            red, green, blue = pixels[x, y]
            chroma = max(red, green, blue) - min(red, green, blue)
            if chroma >= 12 or min(red, green, blue) < 232:
                mask[y * width + x] = 1
    return mask


def connected_components(mask: bytearray, width: int, height: int) -> list[list[int]]:
    seen = bytearray(len(mask))
    components: list[list[int]] = []
    for start, present in enumerate(mask):
        if not present or seen[start]:
            continue
        queue = [start]
        seen[start] = 1
        component: list[int] = []
        while queue:
            current = queue.pop()
            component.append(current)
            x = current % width
            y = current // width
            if x > 0:
                candidate = current - 1
                if mask[candidate] and not seen[candidate]:
                    seen[candidate] = 1
                    queue.append(candidate)
            if x + 1 < width:
                candidate = current + 1
                if mask[candidate] and not seen[candidate]:
                    seen[candidate] = 1
                    queue.append(candidate)
            if y > 0:
                candidate = current - width
                if mask[candidate] and not seen[candidate]:
                    seen[candidate] = 1
                    queue.append(candidate)
            if y + 1 < height:
                candidate = current + width
                if mask[candidate] and not seen[candidate]:
                    seen[candidate] = 1
                    queue.append(candidate)
        components.append(component)
    return sorted(components, key=len, reverse=True)


def fill_enclosed_holes(mask: bytearray, width: int, height: int) -> bytearray:
    exterior = bytearray(len(mask))
    queue: deque[int] = deque()

    def add(index: int) -> None:
        if not mask[index] and not exterior[index]:
            exterior[index] = 1
            queue.append(index)

    for x in range(width):
        add(x)
        add((height - 1) * width + x)
    for y in range(height):
        add(y * width)
        add(y * width + width - 1)

    while queue:
        current = queue.popleft()
        x = current % width
        y = current // width
        if x > 0:
            add(current - 1)
        if x + 1 < width:
            add(current + 1)
        if y > 0:
            add(current - width)
        if y + 1 < height:
            add(current + width)

    return bytearray(1 if mask[index] or not exterior[index] else 0 for index in range(len(mask)))


def remove_exterior_light_matte(
    mask: bytearray,
    rgb: Image.Image,
    width: int,
    height: int,
) -> bytearray:
    """Peel only pale neutral pixels connected to the cell boundary.

    Generated checker pixels can dip below the initial seed threshold and cling
    to the illustrated outline.  A boundary flood distinguishes those pixels
    from enclosed white gloss, so highlights survive while the outer matte is
    removed.
    """

    pixels = rgb.load()
    exterior = bytearray(len(mask))
    queue: deque[int] = deque()

    def is_light_neutral(index: int) -> bool:
        x = index % width
        y = index // width
        red, green, blue = pixels[x, y]
        return min(red, green, blue) >= 150 and max(red, green, blue) - min(red, green, blue) <= 30

    def add(index: int) -> None:
        if not exterior[index] and is_light_neutral(index):
            exterior[index] = 1
            queue.append(index)

    for x in range(width):
        add(x)
        add((height - 1) * width + x)
    for y in range(height):
        add(y * width)
        add(y * width + width - 1)

    while queue:
        current = queue.popleft()
        x = current % width
        y = current // width
        if x > 0:
            add(current - 1)
        if x + 1 < width:
            add(current + 1)
        if y > 0:
            add(current - width)
        if y + 1 < height:
            add(current + width)

    return bytearray(
        1 if present and not exterior[index] else 0
        for index, present in enumerate(mask)
    )


def extract_layer(master: Image.Image, spec: LayerSpec) -> tuple[Image.Image, dict[str, object]]:
    cell_x, cell_y = spec.cell
    rgb = master.crop((
        cell_x * CELL_SIZE,
        cell_y * CELL_SIZE,
        (cell_x + 1) * CELL_SIZE,
        (cell_y + 1) * CELL_SIZE,
    )).convert("RGB")
    seed = foreground_seed(rgb)
    components = connected_components(seed, CELL_SIZE, CELL_SIZE)
    if len(components) < spec.component_count:
        raise RuntimeError(f"{spec.name}: expected {spec.component_count} substantial components")

    selected = components[:spec.component_count]
    if any(len(component) < 4_000 for component in selected):
        raise RuntimeError(f"{spec.name}: selected component is unexpectedly small")
    mask = bytearray(CELL_SIZE * CELL_SIZE)
    for component in selected:
        for index in component:
            mask[index] = 1
    mask = remove_exterior_light_matte(mask, rgb, CELL_SIZE, CELL_SIZE)
    mask = fill_enclosed_holes(mask, CELL_SIZE, CELL_SIZE)

    selected_indices = [index for index, value in enumerate(mask) if value]
    left = min(index % CELL_SIZE for index in selected_indices)
    top = min(index // CELL_SIZE for index in selected_indices)
    right = max(index % CELL_SIZE for index in selected_indices) + 1
    bottom = max(index // CELL_SIZE for index in selected_indices) + 1
    padding = 4
    crop_rect = (
        max(0, left - padding),
        max(0, top - padding),
        min(CELL_SIZE, right + padding),
        min(CELL_SIZE, bottom + padding),
    )

    rgba = Image.new("RGBA", rgb.size, (0, 0, 0, 0))
    source_pixels = rgb.load()
    target_pixels = rgba.load()
    for index in selected_indices:
        x = index % CELL_SIZE
        y = index // CELL_SIZE
        target_pixels[x, y] = (*source_pixels[x, y], 255)

    cropped = rgba.crop(crop_rect)
    _, _, target_width, target_height = spec.source_rect
    content_size = (
        target_width - TARGET_PADDING * 2,
        target_height - TARGET_PADDING * 2,
    )
    content = cropped.resize(content_size, Image.Resampling.LANCZOS)
    resized = Image.new("RGBA", (target_width, target_height), (0, 0, 0, 0))
    resized.alpha_composite(content, (TARGET_PADDING, TARGET_PADDING))
    alpha = resized.getchannel("A")
    if alpha.getbbox() is None:
        raise RuntimeError(f"{spec.name}: transparent output")

    return resized, {
        "cell": {"column": cell_x, "row": cell_y},
        "componentAreas": [len(component) for component in selected],
        "maskPixels": len(selected_indices),
        "cellBounds": {"x": left, "y": top, "width": right - left, "height": bottom - top},
        "cropRect": {
            "x": crop_rect[0],
            "y": crop_rect[1],
            "width": crop_rect[2] - crop_rect[0],
            "height": crop_rect[3] - crop_rect[1],
        },
        "sourceRect": {
            "x": spec.source_rect[0],
            "y": spec.source_rect[1],
            "width": target_width,
            "height": target_height,
        },
        "transparentPadding": TARGET_PADDING,
    }


def build() -> dict[str, object]:
    source_bytes = SOURCE.read_bytes()
    actual_source_sha = sha256(source_bytes)
    if actual_source_sha != SOURCE_SHA256:
        raise RuntimeError(
            f"Refusing unexpected Shell layer master: {actual_source_sha} != {SOURCE_SHA256}"
        )

    master = Image.open(SOURCE)
    if master.size != (1536, 1024) or master.mode != "RGB":
        raise RuntimeError(f"Unexpected Shell layer master format: {master.mode} {master.size}")

    atlas = Image.new("RGBA", ATLAS_SIZE, (0, 0, 0, 0))
    layer_report: dict[str, object] = {}
    for spec in LAYERS:
        layer, details = extract_layer(master, spec)
        x, y, width, height = spec.source_rect
        atlas.alpha_composite(layer, (x, y))
        layer_report[spec.name] = details

    output_buffer = io.BytesIO()
    atlas.save(output_buffer, format="PNG", optimize=True, compress_level=9)
    output_bytes = output_buffer.getvalue()
    atomic_write_bytes(OUTPUT, output_bytes)
    report = {
        "schemaVersion": 1,
        "generator": "scripts/build-shell-layered-atlas.py",
        "ownerId": OWNER,
        "source": {
            "path": SOURCE.relative_to(ROOT).as_posix(),
            "width": master.width,
            "height": master.height,
            "mode": master.mode,
            "sha256": actual_source_sha,
        },
        "matting": {
            "seed": "chroma >= 12 OR minimum channel < 232",
            "connectivity": 4,
            "exteriorLightMatte": "neutral light pixels flood-filled only from cell boundary",
            "enclosedHighlightsFilled": True,
            "background": "generated near-white checker removed deterministically",
        },
        "output": {
            "path": OUTPUT.relative_to(ROOT).as_posix(),
            "width": atlas.width,
            "height": atlas.height,
            "mode": atlas.mode,
            "sha256": sha256(output_bytes),
        },
        "layers": layer_report,
    }
    report_bytes = (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    atomic_write_bytes(REPORT, report_bytes)
    return report


if __name__ == "__main__":
    print(json.dumps(build(), ensure_ascii=False, indent=2))
