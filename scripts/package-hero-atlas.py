#!/usr/bin/env python3
"""Package generated hero physical layers with canonical expressions.

Image generation does not reliably respect the visual 3x3 dividers: a body,
hat, or weapon can cross a 418px boundary even when it is clearly a single
object.  Candidate physical parts are therefore selected as full-image alpha
connected components.  The canonical expression cells remain unchanged.
"""

from __future__ import annotations

import argparse
import math
import os
import tempfile
from collections import deque
from dataclasses import dataclass
from itertools import permutations
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


ATLAS_SIZE = 1254
GRID_SIZE = 3
CELL_SIZE = ATLAS_SIZE // GRID_SIZE
CELL_COUNT = GRID_SIZE * GRID_SIZE
GUTTER = 2
PHYSICAL_CELL_COUNT = 3
ALPHA_COMPONENT_THRESHOLD = 16
MINIMUM_COMPONENT_AREA = 128
COMPONENT_FRINGE_RADIUS = 2

# Expected authored centers in the generated full atlas.  Area contributes to
# the score so a tiny highlight near a target cannot replace the main object.
PHYSICAL_SOURCE_TARGETS = (
    (CELL_SIZE * 0.5, 250.0),
    (CELL_SIZE * 1.5, 250.0),
    (CELL_SIZE * 2.5, 250.0),
)
AREA_SCORE_WEIGHT = 0.32

BODY_CENTER_X = CELL_SIZE / 2
BODY_BOTTOM = 390
BODY_MAX_WIDTH = 390
BODY_MAX_HEIGHT = BODY_BOTTOM - GUTTER
HEADGEAR_BOTTOM = 225
HEADGEAR_MAX_SIZE = (280, 220)
EQUIPMENT_CENTER = (330, 325)
EQUIPMENT_MAX_SIZE = (165, 170)


class AtlasValidationError(ValueError):
    """Raised when an input cannot safely be used as a layered hero atlas."""


@dataclass(frozen=True)
class AlphaComponent:
    area: int
    centroid_x: float
    centroid_y: float
    bounds: tuple[int, int, int, int]
    pixels: tuple[int, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Extract candidate body/headgear/equipment components and combine "
            "them with canonical expression cells 3-8."
        )
    )
    parser.add_argument("candidate", type=Path, help="candidate 1254px RGBA atlas")
    parser.add_argument("canonical", type=Path, help="canonical 3x3 RGBA atlas")
    parser.add_argument("output", type=Path, help="output PNG path")
    return parser.parse_args()


def _edge_has_alpha(alpha: Image.Image, gutter: int = 1) -> bool:
    width, height = alpha.size
    edges = (
        alpha.crop((0, 0, width, gutter)),
        alpha.crop((0, height - gutter, width, height)),
        alpha.crop((0, 0, gutter, height)),
        alpha.crop((width - gutter, 0, width, height)),
    )
    return any(edge.getextrema()[1] != 0 for edge in edges)


def _cell_box(index: int) -> tuple[int, int, int, int]:
    column = index % GRID_SIZE
    row = index // GRID_SIZE
    left = column * CELL_SIZE
    top = row * CELL_SIZE
    return left, top, left + CELL_SIZE, top + CELL_SIZE


def _load_rgba_atlas(path: Path, label: str) -> Image.Image:
    if not path.is_file():
        raise AtlasValidationError(f"{label} does not exist: {path}")
    try:
        with Image.open(path) as source:
            source.load()
            if source.size != (ATLAS_SIZE, ATLAS_SIZE):
                raise AtlasValidationError(
                    f"{label} must be {ATLAS_SIZE}x{ATLAS_SIZE}, got "
                    f"{source.width}x{source.height}"
                )
            if source.mode != "RGBA":
                raise AtlasValidationError(
                    f"{label} must be RGBA, got {source.mode}; refusing to infer transparency"
                )
            return source.copy()
    except AtlasValidationError:
        raise
    except (OSError, ValueError) as error:
        raise AtlasValidationError(f"could not read {label} {path}: {error}") from error


def _connected_components(alpha: Image.Image) -> list[AlphaComponent]:
    width, height = alpha.size
    alpha_data = alpha.tobytes()
    seen = bytearray(width * height)
    components: list[AlphaComponent] = []

    for start_index, opacity in enumerate(alpha_data):
        if seen[start_index] or opacity < ALPHA_COMPONENT_THRESHOLD:
            continue
        seen[start_index] = 1
        queue: deque[int] = deque((start_index,))
        pixels: list[int] = []
        area = 0
        sum_x = 0
        sum_y = 0
        left = width
        top = height
        right = 0
        bottom = 0

        while queue:
            index = queue.popleft()
            y, x = divmod(index, width)
            pixels.append(index)
            area += 1
            sum_x += x
            sum_y += y
            left = min(left, x)
            top = min(top, y)
            right = max(right, x + 1)
            bottom = max(bottom, y + 1)

            for next_y in range(max(0, y - 1), min(height, y + 2)):
                row_offset = next_y * width
                for next_x in range(max(0, x - 1), min(width, x + 2)):
                    next_index = row_offset + next_x
                    if seen[next_index] or alpha_data[next_index] < ALPHA_COMPONENT_THRESHOLD:
                        continue
                    seen[next_index] = 1
                    queue.append(next_index)

        if area < MINIMUM_COMPONENT_AREA:
            continue
        components.append(
            AlphaComponent(
                area=area,
                centroid_x=sum_x / area,
                centroid_y=sum_y / area,
                bounds=(left, top, right, bottom),
                pixels=tuple(pixels),
            )
        )

    return components


def _component_score(
    component: AlphaComponent,
    target: tuple[float, float],
) -> float:
    distance = math.hypot(
        component.centroid_x - target[0],
        component.centroid_y - target[1],
    ) / CELL_SIZE
    atlas_cell_area = CELL_SIZE * CELL_SIZE
    area_bonus = min(1.0, math.sqrt(component.area / atlas_cell_area))
    return distance - AREA_SCORE_WEIGHT * area_bonus


def _select_physical_components(alpha: Image.Image) -> tuple[AlphaComponent, ...]:
    components = _connected_components(alpha)
    upper_components = [
        component
        for component in components
        if component.centroid_y < ATLAS_SIZE / 2
        and component.bounds[1] < CELL_SIZE + CELL_SIZE // 4
    ]
    if len(upper_components) < PHYSICAL_CELL_COUNT:
        raise AtlasValidationError(
            "candidate must contain three substantial upper-half alpha components"
        )

    # Keep the search bounded if an exported image contains many small upper
    # specks, then solve the three-target assignment globally so one component
    # can never be selected for two roles.
    upper_components.sort(key=lambda component: component.area, reverse=True)
    candidates = upper_components[:18]
    best_assignment: tuple[AlphaComponent, ...] | None = None
    best_key: tuple[float, tuple[tuple[int, int, int, int], ...]] | None = None
    for assignment in permutations(candidates, PHYSICAL_CELL_COUNT):
        score = sum(
            _component_score(component, target)
            for component, target in zip(
                assignment,
                PHYSICAL_SOURCE_TARGETS,
                strict=True,
            )
        )
        key = (score, tuple(component.bounds for component in assignment))
        if best_key is None or key < best_key:
            best_key = key
            best_assignment = assignment

    if best_assignment is None:
        raise AtlasValidationError("could not assign candidate physical components")
    for index, (component, target) in enumerate(
        zip(best_assignment, PHYSICAL_SOURCE_TARGETS, strict=True)
    ):
        if abs(component.centroid_x - target[0]) > CELL_SIZE * 0.72:
            raise AtlasValidationError(
                f"candidate physical component {index} is too far from its authored column"
            )
    return best_assignment


def _extract_component(atlas: Image.Image, component: AlphaComponent) -> Image.Image:
    left, top, right, bottom = component.bounds
    left = max(0, left - COMPONENT_FRINGE_RADIUS)
    top = max(0, top - COMPONENT_FRINGE_RADIUS)
    right = min(ATLAS_SIZE, right + COMPONENT_FRINGE_RADIUS)
    bottom = min(ATLAS_SIZE, bottom + COMPONENT_FRINGE_RADIUS)
    width = right - left
    height = bottom - top

    mask_data = bytearray(width * height)
    for index in component.pixels:
        source_y, source_x = divmod(index, ATLAS_SIZE)
        mask_data[(source_y - top) * width + source_x - left] = 255
    mask = Image.frombytes("L", (width, height), bytes(mask_data))
    if COMPONENT_FRINGE_RADIUS:
        mask = mask.filter(ImageFilter.MaxFilter(COMPONENT_FRINGE_RADIUS * 2 + 1))

    content = atlas.crop((left, top, right, bottom))
    content.putalpha(ImageChops.multiply(content.getchannel("A"), mask))
    visible_bounds = content.getchannel("A").getbbox()
    if visible_bounds is None:
        raise AtlasValidationError("selected candidate component became empty")
    return content.crop(visible_bounds)


def _resize_down_to_fit(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
    scale = min(1.0, max_width / image.width, max_height / image.height)
    if scale >= 1.0:
        return image
    return image.resize(
        (
            max(1, math.floor(image.width * scale)),
            max(1, math.floor(image.height * scale)),
        ),
        Image.Resampling.LANCZOS,
    )


def _paste_centered(
    content: Image.Image,
    center_x: float,
    center_y: float,
    label: str,
) -> Image.Image:
    half_width = content.width / 2
    half_height = content.height / 2
    center_x = min(
        max(center_x, GUTTER + half_width),
        CELL_SIZE - GUTTER - half_width,
    )
    center_y = min(
        max(center_y, GUTTER + half_height),
        CELL_SIZE - GUTTER - half_height,
    )
    left = round(center_x - half_width)
    top = round(center_y - half_height)
    if (
        left < GUTTER
        or top < GUTTER
        or left + content.width > CELL_SIZE - GUTTER
        or top + content.height > CELL_SIZE - GUTTER
    ):
        raise AtlasValidationError(f"could not place {label} with a {GUTTER}px gutter")

    cell = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    cell.paste(content, (left, top))
    if _edge_has_alpha(cell.getchannel("A"), GUTTER):
        raise AtlasValidationError(f"could not preserve the gutter for {label}")
    return cell


def _layout_physical_component(
    image: Image.Image,
    component: AlphaComponent,
    role_index: int,
) -> Image.Image:
    if role_index == 0:
        content = _resize_down_to_fit(image, BODY_MAX_WIDTH, BODY_MAX_HEIGHT)
        center_y = BODY_BOTTOM - content.height / 2
        return _paste_centered(content, BODY_CENTER_X, center_y, "candidate body")

    if role_index == 1:
        content = _resize_down_to_fit(image, *HEADGEAR_MAX_SIZE)
        source_left, _, source_right, _ = component.bounds
        local_center_x = (source_left + source_right) / 2 - CELL_SIZE
        local_center_y = HEADGEAR_BOTTOM - content.height / 2
        return _paste_centered(
            content,
            local_center_x,
            local_center_y,
            "candidate headgear",
        )

    content = _resize_down_to_fit(image, *EQUIPMENT_MAX_SIZE)
    return _paste_centered(
        content,
        EQUIPMENT_CENTER[0],
        EQUIPMENT_CENTER[1],
        "candidate equipment",
    )


def _canonical_expression_cells(canonical: Image.Image) -> list[Image.Image]:
    cells: list[Image.Image] = []
    for index in range(PHYSICAL_CELL_COUNT, CELL_COUNT):
        cell = canonical.crop(_cell_box(index))
        alpha = cell.getchannel("A")
        if alpha.getbbox() is None:
            raise AtlasValidationError(f"canonical cell {index} is empty")
        if _edge_has_alpha(alpha, GUTTER):
            raise AtlasValidationError(
                f"canonical cell {index} violates the {GUTTER}px transparent gutter"
            )
        # These are the already-shipped, registration-sensitive expressions.
        # Once validated, preserve their pixels and placement exactly.
        cells.append(cell)
    return cells


def package_atlas(candidate_path: Path, canonical_path: Path, output_path: Path) -> None:
    candidate_resolved = candidate_path.expanduser().resolve()
    canonical_resolved = canonical_path.expanduser().resolve()
    output_resolved = output_path.expanduser().resolve()
    if output_resolved in (candidate_resolved, canonical_resolved):
        raise AtlasValidationError("output must not overwrite either input atlas")

    candidate = _load_rgba_atlas(candidate_resolved, "candidate")
    if _edge_has_alpha(candidate.getchannel("A")):
        raise AtlasValidationError("candidate has non-transparent pixels on the atlas edge")
    canonical = _load_rgba_atlas(canonical_resolved, "canonical")
    expression_cells = _canonical_expression_cells(canonical)

    components = _select_physical_components(candidate.getchannel("A"))
    physical_cells = [
        _layout_physical_component(
            _extract_component(candidate, component),
            component,
            index,
        )
        for index, component in enumerate(components)
    ]

    output = Image.new("RGBA", (ATLAS_SIZE, ATLAS_SIZE), (0, 0, 0, 0))
    for index, cell in enumerate((*physical_cells, *expression_cells)):
        left, top, _, _ = _cell_box(index)
        output.paste(cell, (left, top))

    if output.mode != "RGBA" or output.size != (ATLAS_SIZE, ATLAS_SIZE):
        raise RuntimeError("internal error: packaged atlas has an invalid format")

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
        package_atlas(args.candidate, args.canonical, args.output)
    except (AtlasValidationError, OSError) as error:
        raise SystemExit(f"error: {error}") from error
    print(f"Packaged hero atlas: {args.output}")


if __name__ == "__main__":
    main()
