#!/usr/bin/env python3
"""Build the additive 2-4 star armor atlases from approved ImageGen masters.

The runtime keeps every original slime rig part and draws these transparent
cutouts on top.  Three masters already contain genuine alpha.  Bubble's
approved master contains a baked transparency checker, so this builder removes
only the bright neutral region connected to the canvas boundary.  No character
pixels are synthesized or copied into the production atlases.
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

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
MASTER_SIZE = 1254
MASTER_CELL = MASTER_SIZE // 3
ATLAS_SIZE = 768
ATLAS_CELL = ATLAS_SIZE // 3
CELL_GUTTER = 4
VISIBLE_ALPHA = 32


@dataclass(frozen=True)
class ArmorSpec:
    owner: str
    source_sha256: str
    baked_checker: bool = False

    @property
    def source(self) -> Path:
        return ROOT / "assets/generated-v2/evolution-armor" / f"{self.owner}-armor-master-v3.png"

    @property
    def output(self) -> Path:
        return ROOT / "assets/generated/evolution-armor" / f"{self.owner}-evolution-armor-v3.png"


SPECS = (
    ArmorSpec("shell", "81bfe50a27b5ad90cb497f4e230eade5a6a150cd6fa4bbf93e6ee4cb14e1e7e8"),
    ArmorSpec("needle", "bd418d6b3993fd297b526e412338aabd99190812e17ba22b63829319d6df68e1"),
    ArmorSpec(
        "bubble",
        "bb9639aa4808209bdad82ef2a42b6902c783399f20c59ebf59e4dd8e6d12c94f",
        baked_checker=True,
    ),
    ArmorSpec("sprout", "0b84afa45f3ac2f78c41d3af0b4f95523097bb4ca055f0a760fa7c9158c08dc9"),
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_write(target: Path, data: bytes) -> None:
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


def remove_baked_checker(image: Image.Image) -> Image.Image:
    """Turn only the exterior-connected neutral checker into alpha."""

    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    visited = bytearray(width * height)
    background = bytearray(width * height)
    queue: deque[int] = deque()

    def candidate(index: int) -> bool:
        x = index % width
        y = index // width
        red, green, blue = pixels[x, y]
        return min(red, green, blue) >= 215 and max(red, green, blue) - min(red, green, blue) <= 24

    def add(index: int) -> None:
        if not visited[index] and candidate(index):
            visited[index] = 1
            queue.append(index)

    for x in range(width):
        add(x)
        add((height - 1) * width + x)
    for y in range(height):
        add(y * width)
        add(y * width + width - 1)

    while queue:
        current = queue.popleft()
        background[current] = 1
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

    if sum(background) < width * height * 0.5:
        raise RuntimeError("Bubble checker was not recognized; refusing unsafe alpha removal")

    matte = Image.new("L", (width, height), 0)
    matte.frombytes(bytes(255 if value else 0 for value in background))
    # Remove the small antialias halo painted against the checker while keeping
    # the much thicker dark-blue armor outline intact.
    matte = matte.filter(ImageFilter.MaxFilter(5))
    alpha = Image.eval(matte, lambda value: 255 - value)
    rgba = rgb.convert("RGBA")
    rgba.putalpha(alpha)
    return rgba


def alpha_components(image: Image.Image) -> list[list[int]]:
    width, height = image.size
    alpha = image.getchannel("A").tobytes()
    seen = bytearray(width * height)
    components: list[list[int]] = []
    for start, opacity in enumerate(alpha):
        if opacity < VISIBLE_ALPHA or seen[start]:
            continue
        seen[start] = 1
        stack = [start]
        component: list[int] = []
        while stack:
            current = stack.pop()
            component.append(current)
            x = current % width
            y = current // width
            for candidate in (
                current - 1 if x > 0 else -1,
                current + 1 if x + 1 < width else -1,
                current - width if y > 0 else -1,
                current + width if y + 1 < height else -1,
            ):
                if candidate >= 0 and not seen[candidate] and alpha[candidate] >= VISIBLE_ALPHA:
                    seen[candidate] = 1
                    stack.append(candidate)
        components.append(component)
    return sorted(components, key=len, reverse=True)


def remove_bubble_extra_nozzle(image: Image.Image) -> Image.Image:
    """Delete the stray lower-centre nozzle from Bubble's 4-star clamp cell."""

    left = MASTER_CELL * 2
    top = MASTER_CELL * 2
    cell = image.crop((left, top, left + MASTER_CELL, top + MASTER_CELL))
    components = alpha_components(cell)
    removable: list[list[int]] = []
    for component in components:
        xs = [index % MASTER_CELL for index in component]
        ys = [index // MASTER_CELL for index in component]
        center_x = (min(xs) + max(xs)) / 2
        center_y = (min(ys) + max(ys)) / 2
        if (
            len(component) >= 250
            and MASTER_CELL * 0.36 <= center_x <= MASTER_CELL * 0.64
            and center_y >= MASTER_CELL * 0.68
        ):
            removable.append(component)
    if len(removable) != 1:
        raise RuntimeError(f"Expected one stray Bubble nozzle, found {len(removable)}")

    cleaned = image.copy()
    pixels = cleaned.load()
    for index in removable[0]:
        x = index % MASTER_CELL
        y = index // MASTER_CELL
        pixels[left + x, top + y] = (0, 0, 0, 0)
    return cleaned


def clear_cell_gutters(atlas: Image.Image) -> Image.Image:
    cleaned = atlas.copy()
    pixels = cleaned.load()
    for row in range(3):
        for column in range(3):
            x0 = column * ATLAS_CELL
            y0 = row * ATLAS_CELL
            for y in range(y0, y0 + ATLAS_CELL):
                for x in range(x0, x0 + ATLAS_CELL):
                    local_x = x - x0
                    local_y = y - y0
                    if (
                        local_x < CELL_GUTTER
                        or local_y < CELL_GUTTER
                        or local_x >= ATLAS_CELL - CELL_GUTTER
                        or local_y >= ATLAS_CELL - CELL_GUTTER
                    ):
                        pixels[x, y] = (0, 0, 0, 0)
    return cleaned


def transparent_rgb_cleanup(image: Image.Image) -> Image.Image:
    cleaned = image.copy().convert("RGBA")
    pixels = cleaned.load()
    for y in range(cleaned.height):
        for x in range(cleaned.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                pixels[x, y] = (0, 0, 0, 0)
            else:
                pixels[x, y] = (red, green, blue, alpha)
    return cleaned


def cell_stats(atlas: Image.Image) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for row in range(3):
        for column in range(3):
            cell = atlas.crop((
                column * ATLAS_CELL,
                row * ATLAS_CELL,
                (column + 1) * ATLAS_CELL,
                (row + 1) * ATLAS_CELL,
            ))
            alpha = cell.getchannel("A")
            visible = sum(value >= VISIBLE_ALPHA for value in alpha.tobytes())
            components = [item for item in alpha_components(cell) if len(item) >= 32]
            rows.append({
                "row": row,
                "column": column,
                "visiblePixels": visible,
                "occupancy": round(visible / (ATLAS_CELL * ATLAS_CELL), 6),
                "substantialComponents": len(components),
            })
    return rows


def build_one(spec: ArmorSpec) -> dict[str, object]:
    source_bytes = spec.source.read_bytes()
    actual_hash = sha256(source_bytes)
    if actual_hash != spec.source_sha256:
        raise RuntimeError(f"Unexpected {spec.owner} armor master: {actual_hash}")

    source = Image.open(io.BytesIO(source_bytes))
    if source.size != (MASTER_SIZE, MASTER_SIZE):
        raise RuntimeError(f"Unexpected {spec.owner} master size: {source.size}")
    if spec.baked_checker:
        prepared = remove_baked_checker(source)
        prepared = remove_bubble_extra_nozzle(prepared)
    else:
        if "A" not in source.getbands() or source.getchannel("A").getextrema()[0] != 0:
            raise RuntimeError(f"{spec.owner} master must contain genuine alpha")
        prepared = source.convert("RGBA")

    atlas = prepared.resize((ATLAS_SIZE, ATLAS_SIZE), Image.Resampling.LANCZOS)
    atlas = clear_cell_gutters(atlas)
    atlas = transparent_rgb_cleanup(atlas)

    buffer = io.BytesIO()
    atlas.save(buffer, format="PNG", optimize=True, compress_level=9)
    output_bytes = buffer.getvalue()
    atomic_write(spec.output, output_bytes)
    return {
        "owner": spec.owner,
        "source": spec.source.relative_to(ROOT).as_posix(),
        "sourceSha256": actual_hash,
        "sourceMode": source.mode,
        "bakedCheckerRemoved": spec.baked_checker,
        "output": spec.output.relative_to(ROOT).as_posix(),
        "outputSha256": sha256(output_bytes),
        "outputBytes": len(output_bytes),
        "cells": cell_stats(atlas),
    }


def build() -> dict[str, object]:
    report = {
        "schemaVersion": 1,
        "generator": "scripts/build-evolution-armor-atlases.py",
        "contract": "additive armor only; original rig parts remain unchanged",
        "atlases": [build_one(spec) for spec in SPECS],
    }
    report_path = ROOT / "assets/generated-v2/evolution-armor/build-v3.json"
    atomic_write(
        report_path,
        (json.dumps(report, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    )
    return report


if __name__ == "__main__":
    print(json.dumps(build(), ensure_ascii=False, indent=2))
