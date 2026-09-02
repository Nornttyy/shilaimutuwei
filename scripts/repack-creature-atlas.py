#!/usr/bin/env python3
"""Deterministically register a code-driven 3x3 creature atlas.

The atlas contract is fixed: three physical layers followed by normal,
attack, and hurt eyes/mouth cells.  Physical layers are found as full-atlas
alpha components, so authored pixels may cross a 418px cell boundary.  Face
cells are cleaned independently: alpha components touching a source-cell
boundary are treated as spill from a neighbouring cell and removed before the
remaining expression is resized and registered.

Layout can be supplied as one JSON document or entirely through CLI flags.
Physical JSON entries default to ``group: "nearest"``; an entry may instead
use ``group: {"mode":"seeds", "seeds":[...], "seedRadius":...}`` to name
unusual detached fragments explicitly.  Each ``expressions.maxSize`` entry may
be the legacy ``[width,height]`` pair or an object containing ``maxSize``,
``center``, and ``allowUpscale`` overrides.  A physical entry may also define
``clearFlood`` seeds to remove an enclosed, baked-in neutral grey/white region
without treating other white artwork as transparent.  Z values are copied to
the JSON report only; they never affect atlas pixels or the fixed slot order.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import tempfile
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageFilter


ATLAS_SIZE = 1254
GRID_SIZE = 3
CELL_SIZE = 418
GUTTER = 2
CELL_COUNT = 9
DEFAULT_ALPHA_THRESHOLD = 16
DEFAULT_SOURCE_RADIUS = CELL_SIZE * 0.8
DEFAULT_PHYSICAL_MINIMUM_AREA = 4
DEFAULT_EXPRESSION_MINIMUM_AREA = 4
DEFAULT_SEED_RADIUS = 48.0
DEFAULT_CLEAR_MINIMUM_VALUE = 180
DEFAULT_CLEAR_MAXIMUM_CHROMA = 24
DEFAULT_CLEAR_MINIMUM_AREA = 32
DEFAULT_CLEAR_MAXIMUM_AREA = CELL_SIZE * CELL_SIZE
MINIMUM_PRIMARY_COMPONENT_AREA = 32
COMPONENT_FRINGE_RADIUS = 2

PHYSICAL_NAMES = ("body", "headgear", "equipment")
EXPRESSION_SLOTS = (
    ("normalEyes", "eyes", "normal"),
    ("normalMouth", "mouth", "normal"),
    ("attackEyes", "eyes", "attack"),
    ("attackMouth", "mouth", "attack"),
    ("hurtEyes", "eyes", "hurt"),
    ("hurtMouth", "mouth", "hurt"),
)


class AtlasLayoutError(ValueError):
    """Raised when an atlas or requested registration is ambiguous or unsafe."""


@dataclass(frozen=True)
class AlphaComponent:
    area: int
    centroid_x: float
    centroid_y: float
    bounds: tuple[int, int, int, int]
    pixels: tuple[int, ...]


@dataclass(frozen=True)
class NeutralClearFlood:
    seeds: tuple[tuple[int, int], ...]
    source_bounds: tuple[int, int, int, int]
    minimum_value: int
    maximum_chroma: int
    minimum_area: int
    maximum_area: int
    allow_already_clear: bool


@dataclass(frozen=True)
class PhysicalLayout:
    name: str
    slot: int
    source_center: tuple[float, float]
    target_center: tuple[float, float]
    max_size: tuple[int, int]
    source_radius: float
    z: float
    allow_upscale: bool
    group_mode: str
    group_seeds: tuple[tuple[float, float], ...]
    seed_radius: float
    minimum_component_area: int
    clear_flood: NeutralClearFlood | None


@dataclass(frozen=True)
class ExpressionLayout:
    name: str
    slot: int
    kind: str
    state: str
    target_center: tuple[float, float]
    max_size: tuple[int, int]
    z: float
    allow_upscale: bool


@dataclass(frozen=True)
class RepackLayout:
    physical: tuple[PhysicalLayout, ...]
    expressions: tuple[ExpressionLayout, ...]
    alpha_threshold: int
    boundary_margin: int
    expression_minimum_area: int


def _parse_csv_numbers(value: str, count: int, label: str) -> tuple[float, ...]:
    fields = [field.strip() for field in value.split(",")]
    if len(fields) != count:
        raise argparse.ArgumentTypeError(
            f"{label} requires {count} comma-separated numbers, got {len(fields)}"
        )
    try:
        numbers = tuple(float(field) for field in fields)
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"{label} contains a non-number") from error
    if not all(math.isfinite(number) for number in numbers):
        raise argparse.ArgumentTypeError(f"{label} values must be finite")
    return numbers


def _cli_point(value: str) -> tuple[float, float]:
    numbers = _parse_csv_numbers(value, 2, "center")
    return numbers[0], numbers[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Clean and register a 1254px RGBA 3x3 creature atlas while "
            "preserving its fixed physical/expression slot contract."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "CLI layout formats:\n"
            "  --physical NAME,SRC_X,SRC_Y,DST_X,DST_Y,MAX_W,MAX_H[,Z[,RADIUS]]\n"
            "  --expression NAME,MAX_W,MAX_H[,CENTER_X,CENTER_Y[,UPSCALE]]\n"
            "Repeat --physical for body/headgear/equipment and --expression for\n"
            "normalEyes/normalMouth/attackEyes/attackMouth/hurtEyes/hurtMouth."
        ),
    )
    parser.add_argument("input", type=Path, help="source 1254x1254 RGBA PNG")
    parser.add_argument("output", type=Path, help="new normalized RGBA PNG")
    layout_group = parser.add_mutually_exclusive_group(required=True)
    layout_group.add_argument("--layout", type=Path, help="layout JSON path")
    layout_group.add_argument(
        "--physical",
        action="append",
        metavar="SPEC",
        help="physical-layer CLI spec; repeat exactly three times",
    )
    parser.add_argument(
        "--expression",
        action="append",
        default=[],
        metavar="SPEC",
        help="expression CLI spec; repeat exactly six times",
    )
    parser.add_argument(
        "--layout-id",
        help=(
            "layout key when --layout points to a JSON bundle containing a "
            "top-level layouts object"
        ),
    )
    parser.add_argument("--eyes-center", type=_cli_point, metavar="X,Y")
    parser.add_argument("--mouth-center", type=_cli_point, metavar="X,Y")
    parser.add_argument("--eyes-z", type=float, default=30.0)
    parser.add_argument("--mouth-z", type=float, default=31.0)
    parser.add_argument(
        "--alpha-threshold", type=int, default=DEFAULT_ALPHA_THRESHOLD
    )
    parser.add_argument(
        "--boundary-margin", type=int, default=GUTTER,
        help="source-cell edge width whose connected spill is removed (default: 2)",
    )
    parser.add_argument(
        "--physical-minimum-area",
        type=int,
        default=DEFAULT_PHYSICAL_MINIMUM_AREA,
        help="smallest detached physical fragment to retain (default: 4)",
    )
    parser.add_argument(
        "--expression-minimum-area",
        type=int,
        default=DEFAULT_EXPRESSION_MINIMUM_AREA,
    )
    parser.add_argument(
        "--no-upscale",
        action="store_true",
        help="never enlarge extracted layers to meet their max-size boxes",
    )
    parser.add_argument("--report", type=Path, help="optional JSON report path")
    return parser.parse_args()


def _require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AtlasLayoutError(f"{label} must be a JSON object")
    return value


def _finite_number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise AtlasLayoutError(f"{label} must be a finite number")
    number = float(value)
    if not math.isfinite(number):
        raise AtlasLayoutError(f"{label} must be a finite number")
    return number


def _integer(value: Any, label: str) -> int:
    number = _finite_number(value, label)
    if not number.is_integer():
        raise AtlasLayoutError(f"{label} must be an integer")
    return int(number)


def _point(value: Any, label: str) -> tuple[float, float]:
    if not isinstance(value, list) or len(value) != 2:
        raise AtlasLayoutError(f"{label} must be [x, y]")
    return _finite_number(value[0], f"{label}[0]"), _finite_number(
        value[1], f"{label}[1]"
    )


def _pixel_point(value: Any, label: str) -> tuple[int, int]:
    x, y = _point(value, label)
    if not x.is_integer() or not y.is_integer():
        raise AtlasLayoutError(f"{label} must contain integer pixel coordinates")
    result = int(x), int(y)
    _validate_source_point(result, label)
    return result


def _source_bounds(value: Any, label: str) -> tuple[int, int, int, int]:
    if not isinstance(value, list) or len(value) != 4:
        raise AtlasLayoutError(f"{label} must be [left, top, right, bottom]")
    bounds = tuple(
        _integer(component, f"{label}[{index}]")
        for index, component in enumerate(value)
    )
    left, top, right, bottom = bounds
    if not (0 <= left < right <= ATLAS_SIZE and 0 <= top < bottom <= ATLAS_SIZE):
        raise AtlasLayoutError(f"{label} must be a non-empty box inside the source atlas")
    return bounds


def _size(value: Any, label: str) -> tuple[int, int]:
    width, height = _point(value, label)
    if not width.is_integer() or not height.is_integer():
        raise AtlasLayoutError(f"{label} must contain integer pixel sizes")
    result = int(width), int(height)
    if any(side < 1 or side > CELL_SIZE - GUTTER * 2 for side in result):
        raise AtlasLayoutError(
            f"{label} sides must be between 1 and {CELL_SIZE - GUTTER * 2}"
        )
    return result


def _boolean(value: Any, label: str) -> bool:
    if not isinstance(value, bool):
        raise AtlasLayoutError(f"{label} must be true or false")
    return value


def _validate_center(center: tuple[float, float], label: str) -> None:
    if not all(GUTTER <= coordinate <= CELL_SIZE - GUTTER for coordinate in center):
        raise AtlasLayoutError(
            f"{label} must stay inside the {CELL_SIZE}px cell and {GUTTER}px gutter"
        )


def _validate_source_point(point: tuple[float, float], label: str) -> None:
    if not all(0 <= coordinate < ATLAS_SIZE for coordinate in point):
        raise AtlasLayoutError(f"{label} must stay inside the source atlas")


def _physical_group_from_json(
    value: Any,
    label: str,
    default_minimum_area: int,
) -> tuple[str, tuple[tuple[float, float], ...], float, int]:
    if value is None:
        group = {"mode": "nearest"}
    elif isinstance(value, str):
        group = {"mode": value}
    else:
        group = _require_object(value, label)
    allowed_keys = {"mode", "seeds", "seedRadius", "minimumComponentArea"}
    unexpected = set(group) - allowed_keys
    if unexpected:
        raise AtlasLayoutError(
            f"{label} has unsupported keys: {', '.join(sorted(unexpected))}"
        )
    mode = group.get("mode", "nearest")
    if mode not in ("nearest", "seeds"):
        raise AtlasLayoutError(f'{label}.mode must be "nearest" or "seeds"')
    minimum_area = _integer(
        group.get("minimumComponentArea", default_minimum_area),
        f"{label}.minimumComponentArea",
    )
    if minimum_area < 1:
        raise AtlasLayoutError(f"{label}.minimumComponentArea must be positive")
    seed_radius = _finite_number(
        group.get("seedRadius", DEFAULT_SEED_RADIUS),
        f"{label}.seedRadius",
    )
    if seed_radius <= 0:
        raise AtlasLayoutError(f"{label}.seedRadius must be positive")
    raw_seeds = group.get("seeds", [])
    if not isinstance(raw_seeds, list):
        raise AtlasLayoutError(f"{label}.seeds must be an array of [x, y] points")
    seeds = tuple(
        _point(seed, f"{label}.seeds[{index}]")
        for index, seed in enumerate(raw_seeds)
    )
    for index, seed in enumerate(seeds):
        _validate_source_point(seed, f"{label}.seeds[{index}]")
    if mode == "seeds" and not seeds:
        raise AtlasLayoutError(f"{label}.seeds cannot be empty in seeds mode")
    if mode == "nearest" and seeds:
        raise AtlasLayoutError(f"{label}.seeds is only valid in seeds mode")
    return mode, seeds, seed_radius, minimum_area


def _neutral_clear_flood_from_json(
    value: Any,
    label: str,
) -> NeutralClearFlood | None:
    if value is None:
        return None
    flood = _require_object(value, label)
    allowed_keys = {
        "seeds",
        "sourceBounds",
        "minimumValue",
        "maximumChroma",
        "minimumArea",
        "maximumArea",
        "allowAlreadyClear",
    }
    unexpected = set(flood) - allowed_keys
    if unexpected:
        raise AtlasLayoutError(
            f"{label} has unsupported keys: {', '.join(sorted(unexpected))}"
        )
    raw_seeds = flood.get("seeds")
    if not isinstance(raw_seeds, list) or not raw_seeds:
        raise AtlasLayoutError(f"{label}.seeds must be a non-empty array of [x, y]")
    seeds = tuple(
        _pixel_point(seed, f"{label}.seeds[{index}]")
        for index, seed in enumerate(raw_seeds)
    )
    source_bounds = _source_bounds(
        flood.get("sourceBounds"),
        f"{label}.sourceBounds",
    )
    left, top, right, bottom = source_bounds
    for index, (x, y) in enumerate(seeds):
        if not (left < x < right - 1 and top < y < bottom - 1):
            raise AtlasLayoutError(
                f"{label}.seeds[{index}] must be strictly inside sourceBounds"
            )
    minimum_value = _integer(
        flood.get("minimumValue", DEFAULT_CLEAR_MINIMUM_VALUE),
        f"{label}.minimumValue",
    )
    maximum_chroma = _integer(
        flood.get("maximumChroma", DEFAULT_CLEAR_MAXIMUM_CHROMA),
        f"{label}.maximumChroma",
    )
    if not 0 <= minimum_value <= 255:
        raise AtlasLayoutError(f"{label}.minimumValue must be between 0 and 255")
    if not 0 <= maximum_chroma <= 255:
        raise AtlasLayoutError(f"{label}.maximumChroma must be between 0 and 255")
    minimum_area = _integer(
        flood.get("minimumArea", DEFAULT_CLEAR_MINIMUM_AREA),
        f"{label}.minimumArea",
    )
    maximum_area = _integer(
        flood.get("maximumArea", DEFAULT_CLEAR_MAXIMUM_AREA),
        f"{label}.maximumArea",
    )
    if minimum_area < 1:
        raise AtlasLayoutError(f"{label}.minimumArea must be positive")
    if maximum_area < minimum_area:
        raise AtlasLayoutError(
            f"{label}.maximumArea must be at least minimumArea"
        )
    allow_already_clear = _boolean(
        flood.get("allowAlreadyClear", False),
        f"{label}.allowAlreadyClear",
    )
    return NeutralClearFlood(
        seeds=seeds,
        source_bounds=source_bounds,
        minimum_value=minimum_value,
        maximum_chroma=maximum_chroma,
        minimum_area=minimum_area,
        maximum_area=maximum_area,
        allow_already_clear=allow_already_clear,
    )


def _layout_from_json(path: Path, layout_id: str | None = None) -> RepackLayout:
    if not path.is_file():
        raise AtlasLayoutError(f"layout does not exist: {path}")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise AtlasLayoutError(f"could not read layout {path}: {error}") from error
    document = _require_object(raw, "layout")
    if "layouts" in document:
        layouts = _require_object(document["layouts"], "layouts")
        if not layout_id:
            raise AtlasLayoutError(
                "layout bundle requires --layout-id to select one layout"
            )
        if layout_id not in layouts:
            raise AtlasLayoutError(f"layout bundle has no entry named {layout_id}")
        document = _require_object(layouts[layout_id], f"layouts.{layout_id}")
    elif layout_id is not None:
        raise AtlasLayoutError(
            "--layout-id is only valid for a JSON bundle with a layouts object"
        )
    if "gutter" in document and document["gutter"] != GUTTER:
        raise AtlasLayoutError(f"gutter is fixed at {GUTTER}px")

    alpha_threshold = _integer(
        document.get("alphaThreshold", DEFAULT_ALPHA_THRESHOLD),
        "alphaThreshold",
    )
    allow_upscale = _boolean(
        document.get("allowUpscale", True), "allowUpscale"
    )
    if not 1 <= alpha_threshold <= 255:
        raise AtlasLayoutError("alphaThreshold must be between 1 and 255")
    default_physical_minimum_area = _integer(
        document.get(
            "physicalMinimumComponentArea", DEFAULT_PHYSICAL_MINIMUM_AREA
        ),
        "physicalMinimumComponentArea",
    )
    if default_physical_minimum_area < 1:
        raise AtlasLayoutError("physicalMinimumComponentArea must be positive")

    physical_object = _require_object(document.get("physical"), "physical")
    if set(physical_object) != set(PHYSICAL_NAMES):
        raise AtlasLayoutError(
            "physical must contain exactly body, headgear, and equipment"
        )
    physical: list[PhysicalLayout] = []
    for slot, name in enumerate(PHYSICAL_NAMES):
        item = _require_object(physical_object[name], f"physical.{name}")
        source_center = _point(item.get("sourceCenter"), f"physical.{name}.sourceCenter")
        _validate_source_point(source_center, f"physical.{name}.sourceCenter")
        target_center = _point(item.get("center"), f"physical.{name}.center")
        _validate_center(target_center, f"physical.{name}.center")
        max_size = _size(item.get("maxSize"), f"physical.{name}.maxSize")
        source_radius = _finite_number(
            item.get("sourceRadius", DEFAULT_SOURCE_RADIUS),
            f"physical.{name}.sourceRadius",
        )
        if source_radius <= 0:
            raise AtlasLayoutError(f"physical.{name}.sourceRadius must be positive")
        z = _finite_number(item.get("z", slot * 10), f"physical.{name}.z")
        item_upscale = _boolean(
            item.get("allowUpscale", allow_upscale),
            f"physical.{name}.allowUpscale",
        )
        group_mode, group_seeds, seed_radius, minimum_component_area = (
            _physical_group_from_json(
                item.get("group"),
                f"physical.{name}.group",
                default_physical_minimum_area,
            )
        )
        clear_flood = _neutral_clear_flood_from_json(
            item.get("clearFlood"),
            f"physical.{name}.clearFlood",
        )
        physical.append(
            PhysicalLayout(
                name,
                slot,
                source_center,
                target_center,
                max_size,
                source_radius,
                z,
                item_upscale,
                group_mode,
                group_seeds,
                seed_radius,
                minimum_component_area,
                clear_flood,
            )
        )

    expression_object = _require_object(
        document.get("expressions"), "expressions"
    )
    eyes_center = _point(expression_object.get("eyesCenter"), "expressions.eyesCenter")
    mouth_center = _point(
        expression_object.get("mouthCenter"), "expressions.mouthCenter"
    )
    _validate_center(eyes_center, "expressions.eyesCenter")
    _validate_center(mouth_center, "expressions.mouthCenter")
    max_sizes = _require_object(
        expression_object.get("maxSize"), "expressions.maxSize"
    )
    expected_expression_names = {item[0] for item in EXPRESSION_SLOTS}
    if set(max_sizes) != expected_expression_names:
        raise AtlasLayoutError(
            "expressions.maxSize must contain exactly "
            + ", ".join(item[0] for item in EXPRESSION_SLOTS)
        )
    z_object = _require_object(expression_object.get("z", {}), "expressions.z")
    if not set(z_object).issubset({"eyes", "mouth"}):
        raise AtlasLayoutError("expressions.z only accepts eyes and mouth")
    expression_upscale = _boolean(
        expression_object.get("allowUpscale", allow_upscale),
        "expressions.allowUpscale",
    )
    boundary_margin = _integer(
        expression_object.get("boundaryMargin", GUTTER),
        "expressions.boundaryMargin",
    )
    expression_minimum_area = _integer(
        expression_object.get(
            "minimumComponentArea", DEFAULT_EXPRESSION_MINIMUM_AREA
        ),
        "expressions.minimumComponentArea",
    )
    if not GUTTER <= boundary_margin < CELL_SIZE // 2:
        raise AtlasLayoutError(
            f"expressions.boundaryMargin must be at least {GUTTER} and below {CELL_SIZE // 2}"
        )
    if expression_minimum_area < 1:
        raise AtlasLayoutError("expressions.minimumComponentArea must be positive")

    expressions: list[ExpressionLayout] = []
    for offset, (name, kind, state) in enumerate(EXPRESSION_SLOTS):
        entry = max_sizes[name]
        default_center = eyes_center if kind == "eyes" else mouth_center
        if isinstance(entry, list):
            item_max_size = _size(entry, f"expressions.maxSize.{name}")
            item_center = default_center
            item_upscale = expression_upscale
        else:
            entry_object = _require_object(entry, f"expressions.maxSize.{name}")
            unexpected = set(entry_object) - {
                "maxSize",
                "center",
                "allowUpscale",
            }
            if unexpected:
                raise AtlasLayoutError(
                    f"expressions.maxSize.{name} has unsupported keys: "
                    + ", ".join(sorted(unexpected))
                )
            item_max_size = _size(
                entry_object.get("maxSize"),
                f"expressions.maxSize.{name}.maxSize",
            )
            item_center = _point(
                entry_object.get("center", list(default_center)),
                f"expressions.maxSize.{name}.center",
            )
            _validate_center(item_center, f"expressions.maxSize.{name}.center")
            item_upscale = _boolean(
                entry_object.get("allowUpscale", expression_upscale),
                f"expressions.maxSize.{name}.allowUpscale",
            )
        expressions.append(
            ExpressionLayout(
                name=name,
                slot=offset + len(PHYSICAL_NAMES),
                kind=kind,
                state=state,
                target_center=item_center,
                max_size=item_max_size,
                z=_finite_number(
                    z_object.get(kind, 30 if kind == "eyes" else 31),
                    f"expressions.z.{kind}",
                ),
                allow_upscale=item_upscale,
            )
        )
    return RepackLayout(
        tuple(physical),
        tuple(expressions),
        alpha_threshold,
        boundary_margin,
        expression_minimum_area,
    )


def _parse_physical_cli(
    spec: str,
    allow_upscale: bool,
    minimum_component_area: int,
) -> PhysicalLayout:
    fields = [field.strip() for field in spec.split(",")]
    if len(fields) not in (7, 8, 9):
        raise AtlasLayoutError(
            "--physical needs NAME,SRC_X,SRC_Y,DST_X,DST_Y,MAX_W,MAX_H[,Z[,RADIUS]]"
        )
    name = fields[0]
    if name not in PHYSICAL_NAMES:
        raise AtlasLayoutError(f"unknown physical layer: {name}")
    try:
        values = [float(value) for value in fields[1:]]
    except ValueError as error:
        raise AtlasLayoutError(f"--physical {name} contains a non-number") from error
    if not all(math.isfinite(value) for value in values):
        raise AtlasLayoutError(f"--physical {name} values must be finite")
    slot = PHYSICAL_NAMES.index(name)
    max_size = _size(values[4:6], f"--physical {name} max size")
    target_center = values[2], values[3]
    _validate_center(target_center, f"--physical {name} target center")
    source_radius = values[7] if len(values) == 8 else DEFAULT_SOURCE_RADIUS
    if source_radius <= 0:
        raise AtlasLayoutError(f"--physical {name} radius must be positive")
    return PhysicalLayout(
        name=name,
        slot=slot,
        source_center=(values[0], values[1]),
        target_center=target_center,
        max_size=max_size,
        z=values[6] if len(values) >= 7 else slot * 10,
        source_radius=source_radius,
        allow_upscale=allow_upscale,
        group_mode="nearest",
        group_seeds=(),
        seed_radius=DEFAULT_SEED_RADIUS,
        minimum_component_area=minimum_component_area,
        clear_flood=None,
    )


def _parse_expression_cli(
    spec: str,
    eyes_center: tuple[float, float],
    mouth_center: tuple[float, float],
    eyes_z: float,
    mouth_z: float,
    allow_upscale: bool,
) -> ExpressionLayout:
    fields = [field.strip() for field in spec.split(",")]
    if len(fields) not in (3, 5, 6):
        raise AtlasLayoutError(
            "--expression needs NAME,MAX_W,MAX_H[,CENTER_X,CENTER_Y[,UPSCALE]]"
        )
    name = fields[0]
    names = [item[0] for item in EXPRESSION_SLOTS]
    if name not in names:
        raise AtlasLayoutError(f"unknown expression layer: {name}")
    offset = names.index(name)
    _, kind, state = EXPRESSION_SLOTS[offset]
    try:
        max_size = _size(
            [float(fields[1]), float(fields[2])], f"--expression {name} max size"
        )
        target_center = (
            (float(fields[3]), float(fields[4]))
            if len(fields) >= 5
            else (eyes_center if kind == "eyes" else mouth_center)
        )
    except ValueError as error:
        raise AtlasLayoutError(f"--expression {name} contains a non-number") from error
    if not all(math.isfinite(value) for value in target_center):
        raise AtlasLayoutError(f"--expression {name} center values must be finite")
    _validate_center(target_center, f"--expression {name} center")
    item_upscale = allow_upscale
    if len(fields) == 6:
        boolean_text = fields[5].lower()
        if boolean_text not in ("true", "false"):
            raise AtlasLayoutError(
                f"--expression {name} UPSCALE must be true or false"
            )
        item_upscale = boolean_text == "true"
    return ExpressionLayout(
        name=name,
        slot=offset + len(PHYSICAL_NAMES),
        kind=kind,
        state=state,
        target_center=target_center,
        max_size=max_size,
        z=eyes_z if kind == "eyes" else mouth_z,
        allow_upscale=item_upscale,
    )


def _layout_from_cli(args: argparse.Namespace) -> RepackLayout:
    if len(args.physical) != len(PHYSICAL_NAMES):
        raise AtlasLayoutError("CLI layout requires exactly three --physical specs")
    if len(args.expression) != len(EXPRESSION_SLOTS):
        raise AtlasLayoutError("CLI layout requires exactly six --expression specs")
    if args.eyes_center is None or args.mouth_center is None:
        raise AtlasLayoutError("CLI layout requires --eyes-center and --mouth-center")
    _validate_center(args.eyes_center, "--eyes-center")
    _validate_center(args.mouth_center, "--mouth-center")
    if not 1 <= args.alpha_threshold <= 255:
        raise AtlasLayoutError("--alpha-threshold must be between 1 and 255")
    if not GUTTER <= args.boundary_margin < CELL_SIZE // 2:
        raise AtlasLayoutError(
            f"--boundary-margin must be at least {GUTTER} and below {CELL_SIZE // 2}"
        )
    if args.expression_minimum_area < 1:
        raise AtlasLayoutError("--expression-minimum-area must be positive")
    if args.physical_minimum_area < 1:
        raise AtlasLayoutError("--physical-minimum-area must be positive")
    if not math.isfinite(args.eyes_z) or not math.isfinite(args.mouth_z):
        raise AtlasLayoutError("face z values must be finite")

    allow_upscale = not args.no_upscale
    physical = tuple(
        sorted(
            (
                _parse_physical_cli(
                    spec,
                    allow_upscale,
                    args.physical_minimum_area,
                )
                for spec in args.physical
            ),
            key=lambda item: item.slot,
        )
    )
    if tuple(item.name for item in physical) != PHYSICAL_NAMES:
        raise AtlasLayoutError(
            "CLI layout needs one body, one headgear, and one equipment spec"
        )
    expressions = tuple(
        sorted(
            (
                _parse_expression_cli(
                    spec,
                    args.eyes_center,
                    args.mouth_center,
                    args.eyes_z,
                    args.mouth_z,
                    allow_upscale,
                )
                for spec in args.expression
            ),
            key=lambda item: item.slot,
        )
    )
    if tuple(item.name for item in expressions) != tuple(
        item[0] for item in EXPRESSION_SLOTS
    ):
        raise AtlasLayoutError("CLI layout needs every expression name exactly once")
    return RepackLayout(
        physical,
        expressions,
        args.alpha_threshold,
        args.boundary_margin,
        args.expression_minimum_area,
    )


def _load_atlas(path: Path) -> tuple[Image.Image, bytes]:
    if not path.is_file():
        raise AtlasLayoutError(f"input does not exist: {path}")
    try:
        source_bytes = path.read_bytes()
        with Image.open(io.BytesIO(source_bytes)) as source:
            source.load()
            if source.size != (ATLAS_SIZE, ATLAS_SIZE):
                raise AtlasLayoutError(
                    f"input must be {ATLAS_SIZE}x{ATLAS_SIZE}, got "
                    f"{source.width}x{source.height}"
                )
            if source.mode != "RGBA":
                raise AtlasLayoutError(
                    f"input must be RGBA, got {source.mode}; refusing to infer transparency"
                )
            return source.copy(), source_bytes
    except AtlasLayoutError:
        raise
    except (OSError, ValueError) as error:
        raise AtlasLayoutError(f"could not read input {path}: {error}") from error


def _connected_components(
    alpha: Image.Image,
    threshold: int,
    minimum_area: int,
) -> list[AlphaComponent]:
    width, height = alpha.size
    alpha_data = alpha.tobytes()
    seen = bytearray(width * height)
    components: list[AlphaComponent] = []
    for start_index, opacity in enumerate(alpha_data):
        if seen[start_index] or opacity < threshold:
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
                    if seen[next_index] or alpha_data[next_index] < threshold:
                        continue
                    seen[next_index] = 1
                    queue.append(next_index)
        if area < minimum_area:
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


def _component_distance(
    component: AlphaComponent,
    point: tuple[float, float],
) -> float:
    return math.hypot(
        component.centroid_x - point[0],
        component.centroid_y - point[1],
    )


def _select_physical_component_groups(
    alpha: Image.Image,
    layout: RepackLayout,
) -> tuple[tuple[AlphaComponent, ...], ...]:
    global_minimum_area = min(
        item.minimum_component_area for item in layout.physical
    )
    components = _connected_components(
        alpha,
        layout.alpha_threshold,
        minimum_area=global_minimum_area,
    )
    groups: list[list[AlphaComponent]] = [
        [] for _ in layout.physical
    ]
    claimed: set[int] = set()

    # Explicit seed groups are resolved first.  They are the escape hatch for
    # intentionally detached pieces below the physical source row or for an
    # unusual layer whose fragments sit closer to a neighbouring role center.
    for role_index, item in enumerate(layout.physical):
        if item.group_mode != "seeds":
            continue
        for seed_index, seed in enumerate(item.group_seeds):
            candidates: list[tuple[tuple[Any, ...], int]] = []
            for component_index, component in enumerate(components):
                if component_index in claimed:
                    continue
                if component.area < item.minimum_component_area:
                    continue
                source_distance = _component_distance(component, item.source_center)
                seed_distance = _component_distance(component, seed)
                if source_distance > item.source_radius or seed_distance > item.seed_radius:
                    continue
                candidates.append(
                    (
                        (
                            seed_distance,
                            source_distance / item.source_radius,
                            -component.area,
                            component.bounds,
                        ),
                        component_index,
                    )
                )
            if not candidates:
                raise AtlasLayoutError(
                    f"physical.{item.name}.group seed {seed_index} did not match "
                    "an unclaimed component"
                )
            _, chosen_index = min(candidates)
            claimed.add(chosen_index)
            groups[role_index].append(components[chosen_index])

    # In nearest mode every top-row component inside a role radius is retained,
    # including detached crown points and floating gloss.  Normalized nearest
    # ownership makes the groups disjoint even when radii overlap.  Components
    # wholly inside rows 1-2 are expressions and are intentionally ineligible;
    # a physical component crossing y=418 remains eligible because its bounds
    # begin in the authored physical row.
    for component_index, component in enumerate(components):
        if component_index in claimed or component.bounds[1] >= CELL_SIZE:
            continue
        eligible: list[tuple[tuple[float, float, int], int]] = []
        for role_index, item in enumerate(layout.physical):
            if item.group_mode != "nearest":
                continue
            if component.area < item.minimum_component_area:
                continue
            distance = _component_distance(component, item.source_center)
            if distance > item.source_radius:
                continue
            eligible.append(
                ((distance / item.source_radius, distance, item.slot), role_index)
            )
        if not eligible:
            continue
        _, owner_index = min(eligible)
        claimed.add(component_index)
        groups[owner_index].append(component)

    normalized_groups: list[tuple[AlphaComponent, ...]] = []
    for item, group in zip(layout.physical, groups, strict=True):
        if not group:
            raise AtlasLayoutError(
                f"no physical alpha component was assigned to {item.name}"
            )
        if max(component.area for component in group) < MINIMUM_PRIMARY_COMPONENT_AREA:
            raise AtlasLayoutError(
                f"physical group {item.name} contains only tiny fragments"
            )
        normalized_groups.append(
            tuple(sorted(group, key=lambda component: component.bounds))
        )
    return tuple(normalized_groups)


def _apply_neutral_clear_flood(
    content: Image.Image,
    source_origin: tuple[int, int],
    clear_flood: NeutralClearFlood | None,
    alpha_threshold: int,
) -> dict[str, Any]:
    if clear_flood is None:
        return {
            "enabled": False,
            "alreadyClear": False,
            "clearedPixelCount": 0,
            "regions": [],
        }

    width, height = content.size
    origin_x, origin_y = source_origin
    bound_left, bound_top, bound_right, bound_bottom = clear_flood.source_bounds
    pixels = content.load()
    cleared: set[int] = set()
    regions: list[dict[str, Any]] = []

    def eligible(local_x: int, local_y: int) -> bool:
        source_x = origin_x + local_x
        source_y = origin_y + local_y
        if not (
            bound_left <= source_x < bound_right
            and bound_top <= source_y < bound_bottom
        ):
            return False
        red, green, blue, alpha = pixels[local_x, local_y]
        return (
            alpha >= alpha_threshold
            and min(red, green, blue) >= clear_flood.minimum_value
            and max(red, green, blue) - min(red, green, blue)
            <= clear_flood.maximum_chroma
        )

    for seed_index, (source_seed_x, source_seed_y) in enumerate(clear_flood.seeds):
        seed_x = source_seed_x - origin_x
        seed_y = source_seed_y - origin_y
        if not (0 <= seed_x < width and 0 <= seed_y < height):
            raise AtlasLayoutError(
                f"clearFlood seed {seed_index} lies outside its selected physical layer"
            )
        seed_alpha = pixels[seed_x, seed_y][3]
        if seed_alpha < alpha_threshold:
            if not clear_flood.allow_already_clear:
                raise AtlasLayoutError(
                    f"clearFlood seed {seed_index} is already transparent; set "
                    "allowAlreadyClear=true for an idempotent no-op"
                )
            regions.append(
                {
                    "seed": [source_seed_x, source_seed_y],
                    "pixelCount": 0,
                    "sourceBounds": None,
                    "duplicateRegion": False,
                    "alreadyClear": True,
                }
            )
            continue
        if not eligible(seed_x, seed_y):
            raise AtlasLayoutError(
                f"clearFlood seed {seed_index} is not an opaque near-neutral pixel"
            )
        start = seed_y * width + seed_x
        if start in cleared:
            regions.append(
                {
                    "seed": [source_seed_x, source_seed_y],
                    "pixelCount": 0,
                    "sourceBounds": None,
                    "duplicateRegion": True,
                    "alreadyClear": False,
                }
            )
            continue

        seen = bytearray(width * height)
        seen[start] = 1
        queue: deque[int] = deque((start,))
        region: list[int] = []
        left = width
        top = height
        right = 0
        bottom = 0
        while queue:
            index = queue.popleft()
            local_y, local_x = divmod(index, width)
            region.append(index)
            left = min(left, local_x)
            top = min(top, local_y)
            right = max(right, local_x + 1)
            bottom = max(bottom, local_y + 1)
            for next_x, next_y in (
                (local_x - 1, local_y),
                (local_x + 1, local_y),
                (local_x, local_y - 1),
                (local_x, local_y + 1),
            ):
                if not (0 <= next_x < width and 0 <= next_y < height):
                    continue
                next_index = next_y * width + next_x
                if seen[next_index] or not eligible(next_x, next_y):
                    continue
                seen[next_index] = 1
                queue.append(next_index)

        area = len(region)
        if not clear_flood.minimum_area <= area <= clear_flood.maximum_area:
            raise AtlasLayoutError(
                f"clearFlood seed {seed_index} selected {area} pixels; expected "
                f"{clear_flood.minimum_area}..{clear_flood.maximum_area}"
            )
        source_region_bounds = (
            origin_x + left,
            origin_y + top,
            origin_x + right,
            origin_y + bottom,
        )
        if (
            source_region_bounds[0] <= bound_left
            or source_region_bounds[1] <= bound_top
            or source_region_bounds[2] >= bound_right
            or source_region_bounds[3] >= bound_bottom
        ):
            raise AtlasLayoutError(
                f"clearFlood seed {seed_index} reaches sourceBounds; refusing a "
                "possibly truncated clear region"
            )
        cleared.update(region)
        regions.append(
            {
                "seed": [source_seed_x, source_seed_y],
                "pixelCount": area,
                "sourceBounds": list(source_region_bounds),
                "duplicateRegion": False,
                "alreadyClear": False,
            }
        )

    for index in cleared:
        local_y, local_x = divmod(index, width)
        pixels[local_x, local_y] = (0, 0, 0, 0)

    return {
        "enabled": True,
        "predicate": {
            "alphaThreshold": alpha_threshold,
            "minimumValue": clear_flood.minimum_value,
            "maximumChroma": clear_flood.maximum_chroma,
            "connectivity": 4,
        },
        "sourceBounds": list(clear_flood.source_bounds),
        "minimumArea": clear_flood.minimum_area,
        "maximumArea": clear_flood.maximum_area,
        "allowAlreadyClear": clear_flood.allow_already_clear,
        "alreadyClear": bool(regions) and all(
            region["alreadyClear"] for region in regions
        ),
        "clearedPixelCount": len(cleared),
        "regions": regions,
    }


def _extract_component_group(
    image: Image.Image,
    components: tuple[AlphaComponent, ...],
    threshold: int,
    clear_flood: NeutralClearFlood | None,
) -> tuple[Image.Image, dict[str, Any]]:
    image_width, image_height = image.size
    left = min(component.bounds[0] for component in components)
    top = min(component.bounds[1] for component in components)
    right = max(component.bounds[2] for component in components)
    bottom = max(component.bounds[3] for component in components)
    left = max(0, left - COMPONENT_FRINGE_RADIUS)
    top = max(0, top - COMPONENT_FRINGE_RADIUS)
    right = min(image_width, right + COMPONENT_FRINGE_RADIUS)
    bottom = min(image_height, bottom + COMPONENT_FRINGE_RADIUS)
    width = right - left
    height = bottom - top
    mask_data = bytearray(width * height)
    for component in components:
        for index in component.pixels:
            source_y, source_x = divmod(index, image_width)
            mask_data[(source_y - top) * width + source_x - left] = 255
    mask = Image.frombytes("L", (width, height), bytes(mask_data))
    if COMPONENT_FRINGE_RADIUS:
        mask = mask.filter(ImageFilter.MaxFilter(COMPONENT_FRINGE_RADIUS * 2 + 1))
    content = image.crop((left, top, right, bottom))
    # Multiplication keeps the source's authored soft alpha while discarding
    # every unselected component, including low-alpha neighbouring fringe.
    content.putalpha(ImageChops.multiply(content.getchannel("A"), mask))
    clear_report = _apply_neutral_clear_flood(
        content,
        (left, top),
        clear_flood,
        threshold,
    )
    bounds = content.getchannel("A").getbbox()
    if bounds is None:
        raise AtlasLayoutError(
            f"selected component group became empty at alpha threshold {threshold}"
        )
    return content.crop(bounds), clear_report


def _component_touches_boundary(
    component: AlphaComponent,
    width: int,
    height: int,
    margin: int,
) -> bool:
    left, top, right, bottom = component.bounds
    return (
        left < margin
        or top < margin
        or right > width - margin
        or bottom > height - margin
    )


def _extract_clean_expression(
    atlas: Image.Image,
    item: ExpressionLayout,
    layout: RepackLayout,
) -> tuple[Image.Image, dict[str, Any]]:
    left = item.slot % GRID_SIZE * CELL_SIZE
    top = item.slot // GRID_SIZE * CELL_SIZE
    source_cell = atlas.crop((left, top, left + CELL_SIZE, top + CELL_SIZE))
    components = _connected_components(
        source_cell.getchannel("A"),
        layout.alpha_threshold,
        layout.expression_minimum_area,
    )
    kept = [
        component
        for component in components
        if not _component_touches_boundary(
            component,
            CELL_SIZE,
            CELL_SIZE,
            layout.boundary_margin,
        )
    ]
    removed = [component for component in components if component not in kept]
    if not kept:
        raise AtlasLayoutError(
            f"expression {item.name} has no interior alpha after boundary spill cleanup"
        )

    mask = Image.new("L", source_cell.size, 0)
    mask_data = bytearray(CELL_SIZE * CELL_SIZE)
    for component in kept:
        for index in component.pixels:
            mask_data[index] = 255
    mask = Image.frombytes("L", source_cell.size, bytes(mask_data))
    if COMPONENT_FRINGE_RADIUS:
        mask = mask.filter(ImageFilter.MaxFilter(COMPONENT_FRINGE_RADIUS * 2 + 1))
    clean = source_cell.copy()
    clean.putalpha(ImageChops.multiply(clean.getchannel("A"), mask))
    bounds = clean.getchannel("A").getbbox()
    if bounds is None:
        raise AtlasLayoutError(f"expression {item.name} became empty")
    return clean.crop(bounds), {
        "sourceCell": [left, top, CELL_SIZE, CELL_SIZE],
        "sourceVisibleBounds": list(bounds),
        "keptComponentCount": len(kept),
        "removedBoundaryComponentCount": len(removed),
        "removedBoundaryBounds": [list(component.bounds) for component in removed],
    }


def _resize_to_fit(
    content: Image.Image,
    max_size: tuple[int, int],
    allow_upscale: bool,
) -> Image.Image:
    scale = min(max_size[0] / content.width, max_size[1] / content.height)
    if not allow_upscale:
        scale = min(1.0, scale)
    width = max(1, min(max_size[0], round(content.width * scale)))
    height = max(1, min(max_size[1], round(content.height * scale)))
    if (width, height) == content.size:
        return content
    return content.resize((width, height), Image.Resampling.LANCZOS)


def _place_registered(
    content: Image.Image,
    center: tuple[float, float],
    max_size: tuple[int, int],
    allow_upscale: bool,
    label: str,
) -> tuple[Image.Image, tuple[int, int, int, int]]:
    resized = _resize_to_fit(content, max_size, allow_upscale)
    left = round(center[0] - resized.width / 2)
    top = round(center[1] - resized.height / 2)
    right = left + resized.width
    bottom = top + resized.height
    if (
        left < GUTTER
        or top < GUTTER
        or right > CELL_SIZE - GUTTER
        or bottom > CELL_SIZE - GUTTER
    ):
        raise AtlasLayoutError(
            f"{label} cannot fit center={center} maxSize={max_size} with a {GUTTER}px gutter"
        )
    cell = Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0))
    cell.alpha_composite(resized, (left, top))
    if _gutter_has_alpha(cell):
        raise AtlasLayoutError(f"internal error: {label} violates the {GUTTER}px gutter")
    return cell, (left, top, right, bottom)


def _gutter_has_alpha(cell: Image.Image) -> bool:
    alpha = cell.getchannel("A")
    width, height = alpha.size
    strips = (
        alpha.crop((0, 0, width, GUTTER)),
        alpha.crop((0, height - GUTTER, width, height)),
        alpha.crop((0, 0, GUTTER, height)),
        alpha.crop((width - GUTTER, 0, width, height)),
    )
    return any(strip.getextrema()[1] != 0 for strip in strips)


def _crossed_grid_boundaries(bounds: tuple[int, int, int, int]) -> list[str]:
    left, top, right, bottom = bounds
    crossed: list[str] = []
    for boundary in (CELL_SIZE, CELL_SIZE * 2):
        if left < boundary < right:
            crossed.append(f"x={boundary}")
        if top < boundary < bottom:
            crossed.append(f"y={boundary}")
    return crossed


def _center_of(bounds: tuple[int, int, int, int]) -> list[float]:
    left, top, right, bottom = bounds
    return [(left + right) / 2, (top + bottom) / 2]


def repack_atlas(
    source: Image.Image,
    layout: RepackLayout,
) -> tuple[Image.Image, list[dict[str, Any]]]:
    selected_physical = _select_physical_component_groups(
        source.getchannel("A"), layout
    )
    output = Image.new("RGBA", (ATLAS_SIZE, ATLAS_SIZE), (0, 0, 0, 0))
    reports: list[dict[str, Any]] = []

    for item, components in zip(
        layout.physical, selected_physical, strict=True
    ):
        extracted, clear_report = _extract_component_group(
            source,
            components,
            layout.alpha_threshold,
            item.clear_flood,
        )
        cell, visible_bounds = _place_registered(
            extracted,
            item.target_center,
            item.max_size,
            item.allow_upscale,
            item.name,
        )
        cell_left = item.slot % GRID_SIZE * CELL_SIZE
        cell_top = item.slot // GRID_SIZE * CELL_SIZE
        output.alpha_composite(cell, (cell_left, cell_top))
        reports.append(
            {
                "name": item.name,
                "slot": item.slot,
                "kind": "physical",
                "z": item.z,
                "source": {
                    "groupMode": item.group_mode,
                    "componentCount": len(components),
                    "componentAreas": [component.area for component in components],
                    "componentBounds": [
                        list(component.bounds) for component in components
                    ],
                    "componentCenters": [
                        [component.centroid_x, component.centroid_y]
                        for component in components
                    ],
                    "requestedCenter": list(item.source_center),
                    "sourceRadius": item.source_radius,
                    "minimumComponentArea": item.minimum_component_area,
                    "seeds": [list(seed) for seed in item.group_seeds],
                    "seedRadius": item.seed_radius,
                    "clearFlood": clear_report,
                    "crossedGridBoundaries": sorted(
                        {
                            boundary
                            for component in components
                            for boundary in _crossed_grid_boundaries(
                                component.bounds
                            )
                        }
                    ),
                },
                "target": {
                    "center": list(item.target_center),
                    "maxSize": list(item.max_size),
                    "visibleBounds": list(visible_bounds),
                    "visibleCenter": _center_of(visible_bounds),
                    "allowUpscale": item.allow_upscale,
                },
            }
        )

    for item in layout.expressions:
        extracted, cleanup = _extract_clean_expression(source, item, layout)
        cell, visible_bounds = _place_registered(
            extracted,
            item.target_center,
            item.max_size,
            item.allow_upscale,
            item.name,
        )
        cell_left = item.slot % GRID_SIZE * CELL_SIZE
        cell_top = item.slot // GRID_SIZE * CELL_SIZE
        output.alpha_composite(cell, (cell_left, cell_top))
        reports.append(
            {
                "name": item.name,
                "slot": item.slot,
                "kind": item.kind,
                "state": item.state,
                "z": item.z,
                "source": cleanup,
                "target": {
                    "center": list(item.target_center),
                    "maxSize": list(item.max_size),
                    "visibleBounds": list(visible_bounds),
                    "visibleCenter": _center_of(visible_bounds),
                    "allowUpscale": item.allow_upscale,
                },
            }
        )

    for slot in range(CELL_COUNT):
        left = slot % GRID_SIZE * CELL_SIZE
        top = slot // GRID_SIZE * CELL_SIZE
        if _gutter_has_alpha(output.crop((left, top, left + CELL_SIZE, top + CELL_SIZE))):
            raise AtlasLayoutError(
                f"internal error: output cell {slot} violates the {GUTTER}px gutter"
            )
    return output, reports


def _png_bytes(image: Image.Image) -> bytes:
    stream = io.BytesIO()
    image.save(stream, format="PNG", optimize=True)
    return stream.getvalue()


def _atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary.write(content)
            temporary_path = Path(temporary.name)
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _build_report(
    source_bytes: bytes,
    output_bytes: bytes,
    layout: RepackLayout,
    layers: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "format": {
            "mode": "RGBA",
            "atlasSize": [ATLAS_SIZE, ATLAS_SIZE],
            "grid": [GRID_SIZE, GRID_SIZE],
            "cellSize": [CELL_SIZE, CELL_SIZE],
            "gutter": GUTTER,
            "slotOrder": [*PHYSICAL_NAMES, *(item[0] for item in EXPRESSION_SLOTS)],
        },
        "input": {
            "sha256": hashlib.sha256(source_bytes).hexdigest(),
        },
        "output": {
            "sha256": hashlib.sha256(output_bytes).hexdigest(),
        },
        "cleanup": {
            "alphaThreshold": layout.alpha_threshold,
            "expressionBoundaryMargin": layout.boundary_margin,
            "expressionMinimumComponentArea": layout.expression_minimum_area,
        },
        "zMetadataOnly": True,
        "zOrder": [
            {"name": item["name"], "z": item["z"]}
            for item in sorted(layers, key=lambda item: (item["z"], item["slot"]))
        ],
        "layers": layers,
    }


def main() -> None:
    args = parse_args()
    try:
        input_path = args.input.expanduser().resolve()
        output_path = args.output.expanduser().resolve()
        report_path = args.report.expanduser().resolve() if args.report else None
        if output_path == input_path:
            raise AtlasLayoutError("output must not overwrite input")
        if report_path in (input_path, output_path):
            raise AtlasLayoutError("report must not overwrite input or output")
        if args.layout is not None:
            if args.expression or args.eyes_center or args.mouth_center:
                raise AtlasLayoutError(
                    "--layout cannot be mixed with CLI expression/center flags"
                )
            layout = _layout_from_json(
                args.layout.expanduser().resolve(),
                args.layout_id,
            )
        else:
            if args.layout_id is not None:
                raise AtlasLayoutError("--layout-id requires --layout")
            layout = _layout_from_cli(args)
        source, source_bytes = _load_atlas(input_path)
        output, layer_reports = repack_atlas(source, layout)
        output_bytes = _png_bytes(output)
        report = _build_report(
            source_bytes, output_bytes, layout, layer_reports
        )
        report_bytes = (
            json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
        _atomic_write(output_path, output_bytes)
        if report_path is not None:
            _atomic_write(report_path, report_bytes)
    except (AtlasLayoutError, OSError) as error:
        raise SystemExit(f"error: {error}") from error
    print(report_bytes.decode("utf-8"), end="")


if __name__ == "__main__":
    main()
