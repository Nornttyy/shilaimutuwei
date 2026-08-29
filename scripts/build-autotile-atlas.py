#!/usr/bin/env python3
"""Pack approved 2x2 sheets and single renders into a 16-mask atlas.

The runtime mask convention is ``N=1, E=2, S=4, W=8``.  Frames are stored in
mask order, four per row, in a 512x512 RGBA atlas of 128x128 cells.  ImageGen
returned most masks as 2x2 review sheets, so this builder deliberately splits
each sheet first and runs the existing generated-asset transparency cleanup on
each quadrant independently.  It never rotates or mirrors a source tile.

With no source arguments the script exactly reproduces the digest-pinned gel
paving atlas.  Other autotile families can supply repeated
``--mask-group 0,15,5,10=/path/to/sheet.png`` and
``--single-mask 7=/path/to/tile.png`` arguments.  Explicit sources are not
digest-pinned, but their SHA-256 provenance is always printed.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import os
import tempfile
from pathlib import Path
from types import ModuleType

from PIL import Image, ImageChops, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
FRAME_SIZE = 128
ATLAS_SIZE = FRAME_SIZE * 4
MASK_NORTH = 1
MASK_EAST = 2
MASK_SOUTH = 4
MASK_WEST = 8
SIDE_BITS = (MASK_NORTH, MASK_EAST, MASK_SOUTH, MASK_WEST)
VISIBLE_ALPHA = 24
EDGE_ALPHA = 32
EDGE_BAND = 3
CONNECTOR_WIDTH = 40
CONNECTOR_DEPTH = 4
CONNECTOR_WIDTH_TOLERANCE = 5
MAX_EDGE_CENTER_OFFSET = 2
UNPAIRED_SPAN = FRAME_SIZE - 10
SEAM_HARD_DEPTH = 16
SEAM_BLEND_DEPTH = 24
SEAM_CLEAR_WIDTH = CONNECTOR_WIDTH + 16
SEAM_MEAN_CHANNEL_DELTA = 3.0
SEAM_MAX_CHANNEL_DELTA = 18
SEAM_INWARD_DEPTH = 12

# The default gel family's TL T-junction places its north/south spine
# deliberately to the right of its review-cell centre.  This correction must
# never leak into a custom family; custom builds start with no offsets and may
# opt into their own repeated --position-offset values.
GEL_POSITION_OFFSETS = {13: (-24, 0)}

DEFAULT_SOURCE_ROOT = (
    Path.home()
    / ".codex/generated_images/01a03b3e-6845-7dc1-a106-219ddaadca78"
)
DEFAULT_OUTPUT = ROOT / "assets/generated/terrain/terrain-gel-paving-autotile-v1.png"
EXPECTED_GEL_ATLAS_SHA256 = (
    "b0a332e9753b01e422315d633edf1be4c97aaf7d8a964368c8ab3aebf21e8f2d"
)

GEL_GROUP_ARGUMENTS = (
    (
        "group_0_15_5_10",
        "exec-2b83e644-de0b-477d-9b4e-42b894953c52.png",
        (0, 15, 5, 10),
        "808808aef9ea2491f7da8da5835787521e353a98d3bd132bfb080a4368d13556",
    ),
    (
        "group_1_2_4_8",
        "exec-65010635-05dc-46a0-9749-46c4f9bebda7.png",
        (1, 2, 4, 8),
        "46ebf03aa842f85975ec7244d18e447cd19abad4bbeb427a99362deb26e28c48",
    ),
    (
        "group_3_6_12_9",
        "exec-12fbb3a5-4312-4bd8-b257-1f1817ea1bac.png",
        (3, 6, 12, 9),
        "71c48885e5131d8642ce897b97ef9411513b80b805eb8360c449d0a843f34f87",
    ),
    (
        "group_13_14_skip_11",
        "exec-6b363308-dc18-4f0a-afb9-376db8942a27.png",
        (13, 14, None, 11),
        "92783c95642e11ef1791dc8b5c2dd8cfeeddca7c5dc168505f9dc603af0a017e",
    ),
)
GEL_SINGLE_ARGUMENT = (
    "single_7",
    "exec-8b044351-5182-49de-9288-ddd3ceaa3a93.png",
    7,
    "4f07db1cf7eb955a6125753d6ef35a4d5cda0cef9d033c17634ae29a7ca6d7f0",
)


def load_prepare_module() -> ModuleType:
    """Load the existing hyphenated helper without duplicating its cleanup."""

    helper_path = ROOT / "scripts/prepare-generated-asset.py"
    spec = importlib.util.spec_from_file_location("prepare_generated_asset", helper_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load transparency helper: {helper_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PREPARE_GENERATED_ASSET = load_prepare_module()


def parse_mask(value: str, label: str) -> int:
    try:
        mask = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"{label}: mask must be an integer: {value}") from error
    if mask < 0 or mask > 15:
        raise argparse.ArgumentTypeError(f"{label}: mask must be in 0..15: {mask}")
    return mask


def split_mapping(value: str, label: str) -> tuple[str, Path]:
    if "=" not in value:
        raise argparse.ArgumentTypeError(f"{label} must use MASKS=PATH syntax")
    mask_text, path_text = value.split("=", 1)
    if not path_text:
        raise argparse.ArgumentTypeError(f"{label}: source path cannot be empty")
    return mask_text, Path(path_text).expanduser()


def parse_mask_group(value: str) -> tuple[tuple[int, int, int, int], Path]:
    mask_text, path = split_mapping(value, "--mask-group")
    tokens = [token.strip() for token in mask_text.split(",")]
    if len(tokens) != 4:
        raise argparse.ArgumentTypeError(
            "--mask-group needs exactly four TL,TR,BL,BR masks"
        )
    masks = tuple(parse_mask(token, "--mask-group") for token in tokens)
    if len(set(masks)) != 4:
        raise argparse.ArgumentTypeError("--mask-group masks must be unique")
    return masks, path


def parse_single_mask(value: str) -> tuple[int, Path]:
    mask_text, path = split_mapping(value, "--single-mask")
    if "," in mask_text:
        raise argparse.ArgumentTypeError("--single-mask accepts one mask")
    return parse_mask(mask_text.strip(), "--single-mask"), path


def parse_position_offset(value: str) -> tuple[int, tuple[int, int]]:
    mask_text, offset_text = split_mapping(value, "--position-offset")
    parts = [part.strip() for part in str(offset_text).split(",")]
    if len(parts) != 2:
        raise argparse.ArgumentTypeError("--position-offset must use MASK=DX,DY")
    try:
        offset = (int(parts[0]), int(parts[1]))
    except ValueError as error:
        raise argparse.ArgumentTypeError(
            "--position-offset DX and DY must be integers"
        ) from error
    if any(abs(component) > FRAME_SIZE for component in offset):
        raise argparse.ArgumentTypeError("--position-offset components must be within -128..128")
    return parse_mask(mask_text.strip(), "--position-offset"), offset


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    for argument, filename, _masks, _digest in GEL_GROUP_ARGUMENTS:
        parser.add_argument(
            f"--{argument.replace('_', '-')}",
            dest=argument,
            type=Path,
            default=DEFAULT_SOURCE_ROOT / filename,
            help=argparse.SUPPRESS,
        )
    argument, filename, _mask, _digest = GEL_SINGLE_ARGUMENT
    parser.add_argument(
        f"--{argument.replace('_', '-')}",
        dest=argument,
        type=Path,
        default=DEFAULT_SOURCE_ROOT / filename,
        help=argparse.SUPPRESS,
    )
    parser.add_argument(
        "--mask-group",
        action="append",
        type=parse_mask_group,
        default=[],
        metavar="TL,TR,BL,BR=PATH",
        help="add one explicit 2x2 source sheet; repeat to cover more masks",
    )
    parser.add_argument(
        "--single-mask",
        action="append",
        type=parse_single_mask,
        default=[],
        metavar="MASK=PATH",
        help="add one explicit full-image mask source; may be repeated",
    )
    parser.add_argument(
        "--position-offset",
        action="append",
        type=parse_position_offset,
        default=[],
        metavar="MASK=DX,DY",
        help="optional custom-family placement correction; may be repeated",
    )
    parser.add_argument(
        "--preserve-frame",
        action="store_true",
        help=(
            "keep each cleaned quadrant on one fixed-scale canvas so object size "
            "does not change with its mask; only outer connector pixels are normalized"
        ),
    )
    parser.add_argument(
        "--seam-family",
        choices=("auto", "none", "fence", "honey", "gel"),
        default="auto",
        help=(
            "apply deterministic family-aware seam repair after packing source cells; "
            "auto infers fence, honey, or gel from the output filename"
        ),
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="validate an existing output without reading authoring sources",
    )
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_source(
    path: Path,
    label: str,
    expected_sha256: str | None = None,
) -> str:
    if not path.is_file():
        raise FileNotFoundError(f"{label}: approved source does not exist: {path}")
    actual = sha256_file(path)
    if expected_sha256 is not None and actual != expected_sha256:
        raise RuntimeError(
            f"{label}: source digest changed; expected {expected_sha256}, got {actual}"
        )
    pin = " pinned" if expected_sha256 is not None else ""
    print(f"source{pin} label={label} sha256={actual} path={path}")
    return actual


def split_quadrants(image: Image.Image) -> tuple[Image.Image, ...]:
    """Return TL, TR, BL, BR without resampling or orientation changes."""

    width, height = image.size
    if width < 4 or height < 4:
        raise RuntimeError(f"Review sheet is too small to split: {image.size}")
    x_edges = (0, width // 2, width)
    y_edges = (0, height // 2, height)
    return tuple(
        image.crop((x_edges[column], y_edges[row], x_edges[column + 1], y_edges[row + 1]))
        for row in range(2)
        for column in range(2)
    )


def alpha_components(alpha: Image.Image, threshold: int = VISIBLE_ALPHA) -> list[list[int]]:
    width, height = alpha.size
    values = alpha.tobytes()
    seen = bytearray(width * height)
    components: list[list[int]] = []

    for start, value in enumerate(values):
        if value < threshold or seen[start]:
            continue
        seen[start] = 1
        stack = [start]
        component: list[int] = []
        while stack:
            current = stack.pop()
            component.append(current)
            x = current % width
            y = current // width
            neighbors = (
                current - 1 if x > 0 else -1,
                current + 1 if x + 1 < width else -1,
                current - width if y > 0 else -1,
                current + width if y + 1 < height else -1,
            )
            for neighbor in neighbors:
                if (
                    neighbor >= 0
                    and not seen[neighbor]
                    and values[neighbor] >= threshold
                ):
                    seen[neighbor] = 1
                    stack.append(neighbor)
        components.append(component)

    return sorted(components, key=len, reverse=True)


def isolate_primary_art(
    image: Image.Image,
    label: str,
    crop_result: bool = True,
) -> Image.Image:
    """Drop quadrant bleed and tiny ImageGen specks while retaining antialiasing."""

    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    components = alpha_components(alpha)
    if not components:
        raise RuntimeError(f"{label}: quadrant contains no visible artwork")
    primary = components[0]
    if len(primary) < rgba.width * rgba.height * 0.03:
        raise RuntimeError(f"{label}: primary artwork is implausibly small")

    seed_bytes = bytearray(rgba.width * rgba.height)
    for index in primary:
        seed_bytes[index] = 255
    keep = Image.new("L", rgba.size, 0)
    keep.frombytes(bytes(seed_bytes))
    # Recover the original two-pixel antialias fringe around the thresholded
    # component, but never reconnect distant sheet noise.
    keep = keep.filter(ImageFilter.MaxFilter(5))
    isolated_alpha = ImageChops.multiply(alpha, keep)
    isolated = rgba.copy()
    isolated.putalpha(isolated_alpha)
    bounds = isolated_alpha.getbbox()
    if bounds is None:
        raise RuntimeError(f"{label}: primary artwork became empty")
    return isolated.crop(bounds) if crop_result else isolated


def prepare_cell(
    image: Image.Image,
    label: str,
    preserve_frame: bool = False,
) -> Image.Image:
    # This is intentionally called after the source sheet has been split.  A
    # whole-sheet flood can cross a quadrant seam and destroy a connector.
    transparent = PREPARE_GENERATED_ASSET.ensure_transparency(image, 0.03)
    return isolate_primary_art(transparent, label, crop_result=not preserve_frame)


def resize_premultiplied(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Resize RGBA without importing RGB matte colours into transparent edges."""

    return image.convert("RGBa").resize(size, Image.Resampling.LANCZOS).convert("RGBA")


def resize_preserved_frame(image: Image.Image, label: str) -> Image.Image:
    """Resize one cleaned source canvas at a fixed canvas-derived scale.

    Unlike the ordinary shape mode this never scales from the alpha bounds.
    Non-square review quadrants are proportionally cover-scaled, then a square
    window is centred on the cleaned art solely to remove asymmetric montage
    gutter.  The scale remains derived from the complete quadrant canvas, so
    masks with more or less visible artwork cannot change object size.
    """

    alpha_bounds = image.getchannel("A").getbbox()
    if alpha_bounds is None:
        raise RuntimeError(f"{label}: preserved frame contains no visible artwork")
    scale = FRAME_SIZE / min(image.size)
    resized = resize_premultiplied(
        image,
        (
            max(FRAME_SIZE, round(image.width * scale)),
            max(FRAME_SIZE, round(image.height * scale)),
        ),
    )
    scaled_alpha_bounds = resized.getchannel("A").getbbox()
    if scaled_alpha_bounds is None:
        raise RuntimeError(f"{label}: preserved frame became empty after resize")
    center_x = (scaled_alpha_bounds[0] + scaled_alpha_bounds[2]) / 2
    center_y = (scaled_alpha_bounds[1] + scaled_alpha_bounds[3]) / 2
    left = min(max(0, round(center_x - FRAME_SIZE / 2)), resized.width - FRAME_SIZE)
    top = min(max(0, round(center_y - FRAME_SIZE / 2)), resized.height - FRAME_SIZE)
    return resized.crop((left, top, left + FRAME_SIZE, top + FRAME_SIZE))


def clear_outer_edge(frame: Image.Image, side: int) -> None:
    if side == MASK_NORTH:
        box = (0, 0, FRAME_SIZE, CONNECTOR_DEPTH)
    elif side == MASK_EAST:
        box = (FRAME_SIZE - CONNECTOR_DEPTH, 0, FRAME_SIZE, FRAME_SIZE)
    elif side == MASK_SOUTH:
        box = (0, FRAME_SIZE - CONNECTOR_DEPTH, FRAME_SIZE, FRAME_SIZE)
    elif side == MASK_WEST:
        box = (0, 0, CONNECTOR_DEPTH, FRAME_SIZE)
    else:
        raise ValueError(f"Unknown side bit: {side}")
    frame.paste((0, 0, 0, 0), box)


def nearest_connector_coordinate(frame: Image.Image, side: int, mask: int) -> int:
    alpha = frame.getchannel("A").load()
    target_start = (FRAME_SIZE - CONNECTOR_WIDTH) // 2
    target_range = range(target_start, target_start + CONNECTOR_WIDTH)
    if side == MASK_NORTH:
        candidates = range(FRAME_SIZE)
        count = lambda coordinate: sum(
            alpha[perpendicular, coordinate] >= VISIBLE_ALPHA
            for perpendicular in target_range
        )
    elif side == MASK_EAST:
        candidates = range(FRAME_SIZE - 1, -1, -1)
        count = lambda coordinate: sum(
            alpha[coordinate, perpendicular] >= VISIBLE_ALPHA
            for perpendicular in target_range
        )
    elif side == MASK_SOUTH:
        candidates = range(FRAME_SIZE - 1, -1, -1)
        count = lambda coordinate: sum(
            alpha[perpendicular, coordinate] >= VISIBLE_ALPHA
            for perpendicular in target_range
        )
    elif side == MASK_WEST:
        candidates = range(FRAME_SIZE)
        count = lambda coordinate: sum(
            alpha[coordinate, perpendicular] >= VISIBLE_ALPHA
            for perpendicular in target_range
        )
    else:
        raise ValueError(f"Unknown side bit: {side}")
    for coordinate in candidates:
        if count(coordinate) >= 6:
            return coordinate
    raise RuntimeError(f"mask {mask}: cannot locate authored connector material on side {side}")


def extend_preserved_connector(frame: Image.Image, side: int, mask: int) -> None:
    """Carry the authored connector material to its exact outer seam."""

    coordinate = nearest_connector_coordinate(frame, side, mask)
    target_start = (FRAME_SIZE - CONNECTOR_WIDTH) // 2
    if side == MASK_NORTH:
        source_top = min(coordinate, FRAME_SIZE - CONNECTOR_DEPTH)
        source_box = (
            target_start,
            source_top,
            target_start + CONNECTOR_WIDTH,
            source_top + CONNECTOR_DEPTH,
        )
        size = (CONNECTOR_WIDTH, source_top + CONNECTOR_DEPTH)
        target = (target_start, 0)
    elif side == MASK_EAST:
        source_right = max(CONNECTOR_DEPTH, coordinate + 1)
        source_left = source_right - CONNECTOR_DEPTH
        source_box = (
            source_left,
            target_start,
            source_right,
            target_start + CONNECTOR_WIDTH,
        )
        size = (FRAME_SIZE - source_left, CONNECTOR_WIDTH)
        target = (source_left, target_start)
    elif side == MASK_SOUTH:
        source_bottom = max(CONNECTOR_DEPTH, coordinate + 1)
        source_top = source_bottom - CONNECTOR_DEPTH
        source_box = (
            target_start,
            source_top,
            target_start + CONNECTOR_WIDTH,
            source_bottom,
        )
        size = (CONNECTOR_WIDTH, FRAME_SIZE - source_top)
        target = (target_start, source_top)
    elif side == MASK_WEST:
        source_left = min(coordinate, FRAME_SIZE - CONNECTOR_DEPTH)
        source_box = (
            source_left,
            target_start,
            source_left + CONNECTOR_DEPTH,
            target_start + CONNECTOR_WIDTH,
        )
        size = (source_left + CONNECTOR_DEPTH, CONNECTOR_WIDTH)
        target = (0, target_start)
    else:
        raise ValueError(f"Unknown side bit: {side}")
    bridge = resize_premultiplied(frame.crop(source_box), size)
    frame.alpha_composite(bridge, target)


def normalize_preserved_frame(frame: Image.Image, mask: int) -> Image.Image:
    for side in SIDE_BITS:
        if mask & side:
            extend_preserved_connector(frame, side, mask)
        else:
            clear_outer_edge(frame, side)
    for side in SIDE_BITS:
        if mask & side:
            normalize_connector_aperture(frame, side, mask, strict_center=True)
    return frame


def normalized_size(
    image: Image.Image,
    mask: int,
    clamp_paired_closed_axis: bool = False,
) -> tuple[int, int]:
    north = bool(mask & MASK_NORTH)
    east = bool(mask & MASK_EAST)
    south = bool(mask & MASK_SOUTH)
    west = bool(mask & MASK_WEST)
    width, height = image.size

    if north and east and south and west:
        # The all-connected source is an authored square.  Mapping both axes
        # to the frame is the only way to guarantee four exact seam landings.
        return FRAME_SIZE, FRAME_SIZE
    if north and south:
        scale = FRAME_SIZE / height
    elif east and west:
        scale = FRAME_SIZE / width
    else:
        scale = min(UNPAIRED_SPAN / width, UNPAIRED_SPAN / height)

    target_width = max(1, round(width * scale))
    target_height = max(1, round(height * scale))
    if clamp_paired_closed_axis:
        # Farm/fence families are full-cell modules rather than gel strips.
        # Preserve the connected axis at 128 while allowing a small closed-edge
        # gutter on the perpendicular axis, even when that requires a modest
        # non-uniform squeeze of the generated review render.
        maximum_width = FRAME_SIZE if east and west else UNPAIRED_SPAN
        maximum_height = FRAME_SIZE if north and south else UNPAIRED_SPAN
        target_width = min(target_width, maximum_width)
        target_height = min(target_height, maximum_height)
    if target_width > FRAME_SIZE or target_height > FRAME_SIZE:
        raise RuntimeError(
            f"mask {mask}: source aspect cannot reach its paired edges inside one frame"
        )
    return target_width, target_height


def place_coordinate(length: int, low_connected: bool, high_connected: bool) -> int:
    if low_connected:
        return 0
    if high_connected:
        return FRAME_SIZE - length
    return (FRAME_SIZE - length) // 2


def normalize_cell(
    image: Image.Image,
    mask: int,
    position_offsets: dict[int, tuple[int, int]],
    clamp_paired_closed_axis: bool = False,
) -> Image.Image:
    if mask < 0 or mask > 15:
        raise ValueError(f"Autotile mask must be in 0..15, got {mask}")
    width, height = normalized_size(image, mask, clamp_paired_closed_axis)
    resized = resize_premultiplied(image, (width, height))
    x = place_coordinate(
        width,
        bool(mask & MASK_WEST),
        bool(mask & MASK_EAST),
    )
    y = place_coordinate(
        height,
        bool(mask & MASK_NORTH),
        bool(mask & MASK_SOUTH),
    )
    offset_x, offset_y = position_offsets.get(mask, (0, 0))
    x += offset_x
    y += offset_y
    frame = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
    frame.alpha_composite(resized, (x, y))
    for side in SIDE_BITS:
        if mask & side:
            normalize_connector_aperture(
                frame,
                side,
                mask,
                strict_center=clamp_paired_closed_axis,
            )
    return frame


def normalize_connector_aperture(
    frame: Image.Image,
    side: int,
    mask: int,
    strict_center: bool = False,
) -> None:
    """Give every open edge one centred, fixed-width seam aperture.

    The generated groups disagree slightly about arm width and placement.  A
    four-pixel boundary strip is enough to make adjacent frames meet exactly
    while leaving the authored interior, shading, and orientation untouched.
    """

    alpha = frame.getchannel("A")
    points = edge_points(alpha, side)
    if not points:
        raise RuntimeError(f"mask {mask}: connector {side} does not reach its source edge")
    perpendicular = [
        x if side in (MASK_NORTH, MASK_SOUTH) else y
        for x, y in points
    ]
    if strict_center:
        # Custom full-cell modules can carry asymmetric frame highlights.  Use
        # the actual thresholded edge aperture so that those highlights cannot
        # bias the seam away from x/y=64.
        source_start = min(perpendicular)
        source_end = max(perpendicular) + 1
    else:
        # Preserve the original gel output byte-for-byte, including its small
        # antialias fringe around the thresholded endpoint.
        source_start = max(0, min(perpendicular) - 1)
        source_end = min(FRAME_SIZE, max(perpendicular) + 2)
    target_start = (FRAME_SIZE - CONNECTOR_WIDTH) // 2

    if side == MASK_NORTH:
        source_box = (source_start, 0, source_end, CONNECTOR_DEPTH)
        clear_box = (0, 0, FRAME_SIZE, CONNECTOR_DEPTH)
        target = (target_start, 0)
        target_size = (CONNECTOR_WIDTH, CONNECTOR_DEPTH)
    elif side == MASK_EAST:
        source_box = (
            FRAME_SIZE - CONNECTOR_DEPTH,
            source_start,
            FRAME_SIZE,
            source_end,
        )
        clear_box = (
            FRAME_SIZE - CONNECTOR_DEPTH,
            0,
            FRAME_SIZE,
            FRAME_SIZE,
        )
        target = (FRAME_SIZE - CONNECTOR_DEPTH, target_start)
        target_size = (CONNECTOR_DEPTH, CONNECTOR_WIDTH)
    elif side == MASK_SOUTH:
        source_box = (
            source_start,
            FRAME_SIZE - CONNECTOR_DEPTH,
            source_end,
            FRAME_SIZE,
        )
        clear_box = (
            0,
            FRAME_SIZE - CONNECTOR_DEPTH,
            FRAME_SIZE,
            FRAME_SIZE,
        )
        target = (target_start, FRAME_SIZE - CONNECTOR_DEPTH)
        target_size = (CONNECTOR_WIDTH, CONNECTOR_DEPTH)
    elif side == MASK_WEST:
        source_box = (0, source_start, CONNECTOR_DEPTH, source_end)
        clear_box = (0, 0, CONNECTOR_DEPTH, FRAME_SIZE)
        target = (0, target_start)
        target_size = (CONNECTOR_DEPTH, CONNECTOR_WIDTH)
    else:
        raise ValueError(f"Unknown side bit: {side}")

    strip = resize_premultiplied(frame.crop(source_box), target_size)
    if strict_center:
        strip = solidify_connector_strip(strip, mask, side)
    frame.paste((0, 0, 0, 0), clear_box)
    frame.alpha_composite(strip, target)


def solidify_connector_strip(image: Image.Image, mask: int, side: int) -> Image.Image:
    """Fill only the four-pixel custom seam from its nearest authored colour."""

    rgba = image.convert("RGBA")
    pixels = rgba.load()
    visible = [
        (x, y)
        for y in range(rgba.height)
        for x in range(rgba.width)
        if pixels[x, y][3] >= VISIBLE_ALPHA
    ]
    if not visible:
        raise RuntimeError(f"mask {mask}: side {side} connector strip is empty")
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha < EDGE_ALPHA:
                source_x, source_y = min(
                    visible,
                    key=lambda point: abs(point[0] - x) + abs(point[1] - y),
                )
                red, green, blue, _source_alpha = pixels[source_x, source_y]
            pixels[x, y] = (red, green, blue, 255)
    return rgba


def inferred_seam_family(output: Path, requested: str) -> str:
    if requested != "auto":
        return requested
    name = output.name.lower()
    if "bouncy-fence" in name:
        return "fence"
    if "honey-plot" in name:
        return "honey"
    if "gel-paving" in name:
        return "gel"
    return "none"


def averaged_premultiplied_profile(
    image: Image.Image,
    sample_boxes: tuple[tuple[int, int, int, int], ...],
    orientation: str,
) -> Image.Image:
    """Extract one stable arm cross-section without retaining an end cap.

    Generated opposite arms differ slightly in local gloss.  Averaging their
    interior pixels in premultiplied space keeps the authored palette while
    producing one cross-section that can safely meet itself at either side of
    a neighbouring frame.
    """

    rgba = image.convert("RGBA")
    if orientation == "horizontal":
        length = rgba.height
        samples = [
            (x, y)
            for left, top, right, bottom in sample_boxes
            for y in range(max(0, top), min(rgba.height, bottom))
            for x in range(max(0, left), min(rgba.width, right))
        ]
        coordinates = [
            [(x, y) for x, sample_y in samples if sample_y == y]
            for y in range(length)
        ]
        profile = Image.new("RGBA", (1, length), (0, 0, 0, 0))
    elif orientation == "vertical":
        length = rgba.width
        samples = [
            (x, y)
            for left, top, right, bottom in sample_boxes
            for y in range(max(0, top), min(rgba.height, bottom))
            for x in range(max(0, left), min(rgba.width, right))
        ]
        coordinates = [
            [(x, y) for sample_x, y in samples if sample_x == x]
            for x in range(length)
        ]
        profile = Image.new("RGBA", (length, 1), (0, 0, 0, 0))
    else:
        raise ValueError(f"Unknown profile orientation: {orientation}")

    source = rgba.load()
    target = profile.load()
    for index, points in enumerate(coordinates):
        if not points:
            continue
        alpha_sum = sum(source[x, y][3] for x, y in points)
        alpha = round(alpha_sum / len(points))
        if alpha_sum:
            red = round(sum(source[x, y][0] * source[x, y][3] for x, y in points) / alpha_sum)
            green = round(sum(source[x, y][1] * source[x, y][3] for x, y in points) / alpha_sum)
            blue = round(sum(source[x, y][2] * source[x, y][3] for x, y in points) / alpha_sum)
        else:
            red = green = blue = 0
        if orientation == "horizontal":
            target[0, index] = (red, green, blue, alpha)
        else:
            target[index, 0] = (red, green, blue, alpha)
    return profile


def fixed_width_profile(profile: Image.Image, orientation: str) -> Image.Image:
    alpha_bounds = profile.getchannel("A").getbbox()
    if alpha_bounds is None:
        raise RuntimeError("Canonical connector profile is empty")
    cropped = profile.crop(alpha_bounds)
    if orientation == "horizontal":
        resized = resize_premultiplied(cropped, (1, CONNECTOR_WIDTH))
    else:
        resized = resize_premultiplied(cropped, (CONNECTOR_WIDTH, 1))
    # The seam aperture itself must be fully covered.  Nearest authored colour
    # fills only antialias holes; it does not invent a new palette.
    return solidify_connector_strip(resized, 15, MASK_EAST)


def repeated_profile(profile: Image.Image, size: tuple[int, int]) -> Image.Image:
    return profile.resize(size, Image.Resampling.NEAREST)


def rebuild_fence_frames(frames: dict[int, Image.Image]) -> dict[int, Image.Image]:
    """Compose every fence mask from one node and two canonical elastic bands."""

    node = frames[0].convert("RGBA")
    horizontal_profile = fixed_width_profile(
        averaged_premultiplied_profile(
            frames[10],
            ((12, 0, 34, FRAME_SIZE), (94, 0, 116, FRAME_SIZE)),
            "horizontal",
        ),
        "horizontal",
    )
    vertical_profile = fixed_width_profile(
        averaged_premultiplied_profile(
            frames[5],
            ((0, 12, FRAME_SIZE, 34), (0, 94, FRAME_SIZE, 116)),
            "vertical",
        ),
        "vertical",
    )
    horizontal_band = repeated_profile(horizontal_profile, (FRAME_SIZE, CONNECTOR_WIDTH))
    vertical_band = repeated_profile(vertical_profile, (CONNECTOR_WIDTH, FRAME_SIZE))
    centre = (FRAME_SIZE - CONNECTOR_WIDTH) // 2
    rebuilt: dict[int, Image.Image] = {}
    for mask in range(16):
        frame = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
        if mask & MASK_WEST:
            frame.alpha_composite(horizontal_band.crop((0, 0, FRAME_SIZE // 2, CONNECTOR_WIDTH)), (0, centre))
        if mask & MASK_EAST:
            frame.alpha_composite(
                horizontal_band.crop((FRAME_SIZE // 2, 0, FRAME_SIZE, CONNECTOR_WIDTH)),
                (FRAME_SIZE // 2, centre),
            )
        if mask & MASK_NORTH:
            frame.alpha_composite(vertical_band.crop((0, 0, CONNECTOR_WIDTH, FRAME_SIZE // 2)), (centre, 0))
        if mask & MASK_SOUTH:
            frame.alpha_composite(
                vertical_band.crop((0, FRAME_SIZE // 2, CONNECTOR_WIDTH, FRAME_SIZE)),
                (centre, FRAME_SIZE // 2),
            )
        frame.alpha_composite(node)
        rebuilt[mask] = frame
    return rebuilt


def canonical_surface_profile(frame: Image.Image, orientation: str) -> Image.Image:
    """Sample clean mask-15 surface away from the central sprout/highlight."""

    if orientation == "horizontal":
        raw = averaged_premultiplied_profile(
            frame,
            ((88, (FRAME_SIZE - CONNECTOR_WIDTH) // 2, 108, (FRAME_SIZE + CONNECTOR_WIDTH) // 2),),
            "horizontal",
        )
    else:
        raw = averaged_premultiplied_profile(
            frame,
            (((FRAME_SIZE - CONNECTOR_WIDTH) // 2, 84, (FRAME_SIZE + CONNECTOR_WIDTH) // 2, 104),),
            "vertical",
        )
    fixed = fixed_width_profile(raw, orientation)
    # Connected honey/gel is a surface, not a translucent endpoint.  Keeping
    # the canonical corridor opaque prevents the terrain below from forming a
    # false dark seam through two otherwise connected cells.
    fixed.putalpha(Image.new("L", fixed.size, 255))
    return fixed


def clear_surface_port(frame: Image.Image, side: int) -> None:
    start = (FRAME_SIZE - SEAM_CLEAR_WIDTH) // 2
    end = start + SEAM_CLEAR_WIDTH
    if side == MASK_NORTH:
        box = (start, 0, end, SEAM_HARD_DEPTH)
    elif side == MASK_EAST:
        box = (FRAME_SIZE - SEAM_HARD_DEPTH, start, FRAME_SIZE, end)
    elif side == MASK_SOUTH:
        box = (start, FRAME_SIZE - SEAM_HARD_DEPTH, end, FRAME_SIZE)
    elif side == MASK_WEST:
        box = (0, start, SEAM_HARD_DEPTH, end)
    else:
        raise ValueError(f"Unknown side bit: {side}")
    frame.paste((0, 0, 0, 0), box)


def surface_corridor_layer(
    profile: Image.Image,
    side: int,
) -> tuple[Image.Image, tuple[int, int]]:
    """Return a canonical corridor with a 24px inward opacity transition."""

    centre = (FRAME_SIZE - CONNECTOR_WIDTH) // 2
    depth = SEAM_HARD_DEPTH + SEAM_BLEND_DEPTH
    if side in (MASK_EAST, MASK_WEST):
        corridor = repeated_profile(profile, (depth, CONNECTOR_WIDTH))
        alpha = Image.new("L", corridor.size, 255)
        values = alpha.load()
        for x in range(depth):
            distance_from_edge = depth - 1 - x if side == MASK_EAST else x
            if distance_from_edge >= SEAM_HARD_DEPTH:
                blend = 1 - (
                    (distance_from_edge - SEAM_HARD_DEPTH + 1)
                    / (SEAM_BLEND_DEPTH + 1)
                )
                opacity = round(255 * max(0, min(1, blend)))
                for y in range(CONNECTOR_WIDTH):
                    values[x, y] = opacity
        corridor.putalpha(alpha)
        target = (FRAME_SIZE - depth, centre) if side == MASK_EAST else (0, centre)
    else:
        corridor = repeated_profile(profile, (CONNECTOR_WIDTH, depth))
        alpha = Image.new("L", corridor.size, 255)
        values = alpha.load()
        for y in range(depth):
            distance_from_edge = depth - 1 - y if side == MASK_SOUTH else y
            if distance_from_edge >= SEAM_HARD_DEPTH:
                blend = 1 - (
                    (distance_from_edge - SEAM_HARD_DEPTH + 1)
                    / (SEAM_BLEND_DEPTH + 1)
                )
                opacity = round(255 * max(0, min(1, blend)))
                for x in range(CONNECTOR_WIDTH):
                    values[x, y] = opacity
        corridor.putalpha(alpha)
        target = (centre, FRAME_SIZE - depth) if side == MASK_SOUTH else (centre, 0)
    return corridor, target


def repair_surface_frames(frames: dict[int, Image.Image]) -> dict[int, Image.Image]:
    """Remove generated end caps and blend one mask-15 surface into every port."""

    horizontal = canonical_surface_profile(frames[15], "horizontal")
    vertical = canonical_surface_profile(frames[15], "vertical")
    repaired: dict[int, Image.Image] = {}
    for mask, source in frames.items():
        frame = source.convert("RGBA").copy()
        for side in SIDE_BITS:
            if not mask & side:
                continue
            clear_surface_port(frame, side)
            profile = horizontal if side in (MASK_EAST, MASK_WEST) else vertical
            corridor, target = surface_corridor_layer(profile, side)
            frame.alpha_composite(corridor, target)
        repaired[mask] = frame
    return repaired


def repair_autotile_seams(
    frames: dict[int, Image.Image],
    family: str,
) -> dict[int, Image.Image]:
    if family == "fence":
        return rebuild_fence_frames(frames)
    if family in ("honey", "gel"):
        return repair_surface_frames(frames)
    return frames


def resolve_source_plan(
    args: argparse.Namespace,
) -> tuple[
    list[tuple[str, Path, tuple[int | None, ...], str | None]],
    list[tuple[str, Path, int, str | None]],
    dict[int, tuple[int, int]],
    bool,
    bool,
]:
    custom = bool(args.mask_group or args.single_mask)
    if custom:
        groups = [
            (f"mask-group-{index}", path, masks, None)
            for index, (masks, path) in enumerate(args.mask_group, start=1)
        ]
        singles = [
            (f"single-mask-{mask}", path, mask, None)
            for mask, path in args.single_mask
        ]
        position_offsets: dict[int, tuple[int, int]] = {}
    else:
        groups = [
            (argument, getattr(args, argument), masks, digest)
            for argument, _filename, masks, digest in GEL_GROUP_ARGUMENTS
        ]
        argument, _filename, mask, digest = GEL_SINGLE_ARGUMENT
        singles = [(argument, getattr(args, argument), mask, digest)]
        position_offsets = dict(GEL_POSITION_OFFSETS)

    for mask, offset in args.position_offset:
        if mask in position_offsets:
            raise RuntimeError(f"Duplicate position offset for mask {mask}")
        position_offsets[mask] = offset
    return groups, singles, position_offsets, custom, bool(args.preserve_frame)


def add_frame(
    frames: dict[int, Image.Image],
    mask: int,
    image: Image.Image,
    label: str,
    position_offsets: dict[int, tuple[int, int]],
    clamp_paired_closed_axis: bool,
    preserve_frame: bool,
) -> None:
    if mask in frames:
        raise RuntimeError(f"Duplicate source for mask {mask}: {label}")
    prepared = prepare_cell(
        image,
        f"{label}:mask-{mask}",
        preserve_frame=preserve_frame,
    )
    if preserve_frame:
        frame = resize_preserved_frame(prepared, f"{label}:mask-{mask}")
        frames[mask] = normalize_preserved_frame(frame, mask)
    else:
        frames[mask] = normalize_cell(
            prepared,
            mask,
            position_offsets,
            clamp_paired_closed_axis,
        )


def build_frames(args: argparse.Namespace) -> dict[int, Image.Image]:
    (
        groups,
        singles,
        position_offsets,
        clamp_paired_closed_axis,
        preserve_frame,
    ) = resolve_source_plan(args)
    frames: dict[int, Image.Image] = {}
    for label, source_path, masks, expected_digest in groups:
        inspect_source(source_path, label, expected_digest)
        with Image.open(source_path) as source:
            quadrants = split_quadrants(source)
            for quadrant, mask in zip(quadrants, masks, strict=True):
                if mask is None:
                    continue
                add_frame(
                    frames,
                    mask,
                    quadrant,
                    label,
                    position_offsets,
                    clamp_paired_closed_axis,
                    preserve_frame,
                )

    for label, source_path, mask, expected_digest in singles:
        inspect_source(source_path, label, expected_digest)
        with Image.open(source_path) as source:
            add_frame(
                frames,
                mask,
                source,
                label,
                position_offsets,
                clamp_paired_closed_axis,
                preserve_frame,
            )

    expected = set(range(16))
    if set(frames) != expected:
        missing = sorted(expected - set(frames))
        extra = sorted(set(frames) - expected)
        raise RuntimeError(
            "Atlas source map must cover masks 0..15 exactly; "
            f"missing={missing}, extra={extra}"
        )
    return frames


def pack_atlas(frames: dict[int, Image.Image]) -> Image.Image:
    atlas = Image.new("RGBA", (ATLAS_SIZE, ATLAS_SIZE), (0, 0, 0, 0))
    for mask in range(16):
        x = (mask % 4) * FRAME_SIZE
        y = (mask // 4) * FRAME_SIZE
        atlas.alpha_composite(frames[mask], (x, y))
    return atlas


def edge_points(alpha: Image.Image, side: int) -> list[tuple[int, int]]:
    values = alpha.load()
    points: list[tuple[int, int]] = []
    if side == MASK_NORTH:
        coordinates = (
            (x, y) for y in range(EDGE_BAND) for x in range(FRAME_SIZE)
        )
    elif side == MASK_EAST:
        coordinates = (
            (x, y)
            for x in range(FRAME_SIZE - EDGE_BAND, FRAME_SIZE)
            for y in range(FRAME_SIZE)
        )
    elif side == MASK_SOUTH:
        coordinates = (
            (x, y)
            for y in range(FRAME_SIZE - EDGE_BAND, FRAME_SIZE)
            for x in range(FRAME_SIZE)
        )
    elif side == MASK_WEST:
        coordinates = (
            (x, y) for x in range(EDGE_BAND) for y in range(FRAME_SIZE)
        )
    else:
        raise ValueError(f"Unknown side bit: {side}")
    for x, y in coordinates:
        if values[x, y] >= EDGE_ALPHA:
            points.append((x, y))
    return points


def edge_center(points: list[tuple[int, int]], side: int) -> float:
    if side in (MASK_NORTH, MASK_SOUTH):
        positions = [x for x, _y in points]
    else:
        positions = [y for _x, y in points]
    # The geometric aperture midpoint is the seam anchor.  Alpha-weighting or
    # counting every shaded pixel would incorrectly pull glossy asymmetric
    # connectors toward their highlight side.
    return (min(positions) + max(positions)) / 2


def verify_frame(frame: Image.Image, mask: int) -> dict[str, float | int]:
    if frame.mode != "RGBA" or frame.size != (FRAME_SIZE, FRAME_SIZE):
        raise RuntimeError(f"mask {mask}: expected RGBA {FRAME_SIZE}x{FRAME_SIZE} frame")
    alpha = frame.getchannel("A")
    visible = sum(value >= VISIBLE_ALPHA for value in alpha.tobytes())
    if visible < FRAME_SIZE * FRAME_SIZE * 0.12:
        raise RuntimeError(f"mask {mask}: frame is empty or too sparse ({visible} pixels)")

    report: dict[str, float | int] = {"visible": visible}
    side_names = {
        MASK_NORTH: "north",
        MASK_EAST: "east",
        MASK_SOUTH: "south",
        MASK_WEST: "west",
    }
    for side in SIDE_BITS:
        points = edge_points(alpha, side)
        connected = bool(mask & side)
        if connected and len(points) < EDGE_BAND * 8:
            raise RuntimeError(
                f"mask {mask}: {side_names[side]} connector does not reach the frame edge"
            )
        if not connected and points:
            raise RuntimeError(
                f"mask {mask}: closed {side_names[side]} edge leaks {len(points)} pixels"
            )
        if connected:
            center = edge_center(points, side)
            perpendicular = [
                x if side in (MASK_NORTH, MASK_SOUTH) else y
                for x, y in points
            ]
            span = max(perpendicular) - min(perpendicular) + 1
            if abs(center - (FRAME_SIZE - 1) / 2) > MAX_EDGE_CENTER_OFFSET:
                raise RuntimeError(
                    f"mask {mask}: {side_names[side]} connector lands off-centre at {center:.2f}"
                )
            if not CONNECTOR_WIDTH - CONNECTOR_WIDTH_TOLERANCE <= span <= CONNECTOR_WIDTH:
                raise RuntimeError(
                    f"mask {mask}: {side_names[side]} connector width is {span}, "
                    f"expected {CONNECTOR_WIDTH - CONNECTOR_WIDTH_TOLERANCE}..{CONNECTOR_WIDTH}"
                )
            report[f"{side_names[side]}Center"] = round(center, 2)
            report[f"{side_names[side]}Pixels"] = len(points)
            report[f"{side_names[side]}Span"] = span
    return report


def verify_atlas(atlas: Image.Image) -> dict[int, dict[str, float | int]]:
    if atlas.mode != "RGBA":
        raise RuntimeError(f"Atlas mode must be RGBA, got {atlas.mode}")
    if atlas.size != (ATLAS_SIZE, ATLAS_SIZE):
        raise RuntimeError(
            f"Atlas must be {ATLAS_SIZE}x{ATLAS_SIZE}, got {atlas.size}"
        )
    if atlas.getchannel("A").getextrema()[0] != 0:
        raise RuntimeError("Atlas must retain transparent pixels")

    report: dict[int, dict[str, float | int]] = {}
    for mask in range(16):
        x = (mask % 4) * FRAME_SIZE
        y = (mask // 4) * FRAME_SIZE
        frame = atlas.crop((x, y, x + FRAME_SIZE, y + FRAME_SIZE))
        report[mask] = verify_frame(frame, mask)

    # All instances of a cardinal connector must meet in the same central seam
    # zone.  Per-frame checks above also guarantee that absent sides stay clear.
    for side in SIDE_BITS:
        side_name = {
            MASK_NORTH: "north",
            MASK_EAST: "east",
            MASK_SOUTH: "south",
            MASK_WEST: "west",
        }[side]
        centers = [
            float(report[mask][f"{side_name}Center"])
            for mask in range(16)
            if mask & side
        ]
        if max(centers) - min(centers) > MAX_EDGE_CENTER_OFFSET * 2:
            raise RuntimeError(f"Side {side} connector anchors are inconsistent: {centers}")
        spans = [
            int(report[mask][f"{side_name}Span"])
            for mask in range(16)
            if mask & side
        ]
        if max(spans) - min(spans) > CONNECTOR_WIDTH_TOLERANCE:
            raise RuntimeError(f"Side {side} connector widths are inconsistent: {spans}")
    return report


def premultiplied_pixel(pixel: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    red, green, blue, alpha = pixel
    return (
        round(red * alpha / 255),
        round(green * alpha / 255),
        round(blue * alpha / 255),
        alpha,
    )


def seam_profile(frame: Image.Image, side: int) -> list[tuple[int, int, int, int]]:
    pixels = frame.convert("RGBA").load()
    if side == MASK_EAST:
        coordinates = (
            (FRAME_SIZE - 1 - depth, perpendicular)
            for perpendicular in range(FRAME_SIZE)
            for depth in range(EDGE_BAND)
        )
    elif side == MASK_WEST:
        coordinates = (
            (depth, perpendicular)
            for perpendicular in range(FRAME_SIZE)
            for depth in range(EDGE_BAND)
        )
    elif side == MASK_SOUTH:
        coordinates = (
            (perpendicular, FRAME_SIZE - 1 - depth)
            for perpendicular in range(FRAME_SIZE)
            for depth in range(EDGE_BAND)
        )
    elif side == MASK_NORTH:
        coordinates = (
            (perpendicular, depth)
            for perpendicular in range(FRAME_SIZE)
            for depth in range(EDGE_BAND)
        )
    else:
        raise ValueError(f"Unknown side bit: {side}")
    return [premultiplied_pixel(pixels[x, y]) for x, y in coordinates]


def inward_port_differences(frame: Image.Image, side: int) -> list[int]:
    """Measure whether an open connector changes within its first 12 pixels.

    A matching outer edge alone can hide a generated end cap immediately
    inside the tile.  Comparing every premultiplied RGBA aperture pixel with
    its own boundary pixel makes that failure deterministic and catches both
    dark outlines and alpha notches before an atlas is written.
    """

    pixels = frame.convert("RGBA").load()
    start = (FRAME_SIZE - CONNECTOR_WIDTH) // 2
    end = start + CONNECTOR_WIDTH
    differences: list[int] = []
    for perpendicular in range(start, end):
        if side == MASK_EAST:
            boundary = premultiplied_pixel(pixels[FRAME_SIZE - 1, perpendicular])
            coordinates = (
                (FRAME_SIZE - 1 - depth, perpendicular)
                for depth in range(SEAM_INWARD_DEPTH)
            )
        elif side == MASK_WEST:
            boundary = premultiplied_pixel(pixels[0, perpendicular])
            coordinates = (
                (depth, perpendicular)
                for depth in range(SEAM_INWARD_DEPTH)
            )
        elif side == MASK_SOUTH:
            boundary = premultiplied_pixel(pixels[perpendicular, FRAME_SIZE - 1])
            coordinates = (
                (perpendicular, FRAME_SIZE - 1 - depth)
                for depth in range(SEAM_INWARD_DEPTH)
            )
        elif side == MASK_NORTH:
            boundary = premultiplied_pixel(pixels[perpendicular, 0])
            coordinates = (
                (perpendicular, depth)
                for depth in range(SEAM_INWARD_DEPTH)
            )
        else:
            raise ValueError(f"Unknown side bit: {side}")
        differences.extend(
            abs(premultiplied_pixel(pixels[x, y])[channel] - boundary[channel])
            for x, y in coordinates
            for channel in range(4)
        )
    return differences


def verify_seam_colours(atlas: Image.Image) -> dict[str, float | int]:
    frames = {
        mask: atlas.crop(
            (
                (mask % 4) * FRAME_SIZE,
                (mask // 4) * FRAME_SIZE,
                (mask % 4 + 1) * FRAME_SIZE,
                (mask // 4 + 1) * FRAME_SIZE,
            )
        )
        for mask in range(16)
    }
    comparisons = ((MASK_EAST, MASK_WEST), (MASK_SOUTH, MASK_NORTH))
    differences: list[int] = []
    inward_differences: list[int] = []
    pairs = 0
    ports = 0
    for outgoing, incoming in comparisons:
        outgoing_profiles = [
            seam_profile(frame, outgoing)
            for mask, frame in frames.items()
            if mask & outgoing
        ]
        incoming_profiles = [
            seam_profile(frame, incoming)
            for mask, frame in frames.items()
            if mask & incoming
        ]
        for left in outgoing_profiles:
            for right in incoming_profiles:
                pairs += 1
                differences.extend(
                    abs(left_pixel[channel] - right_pixel[channel])
                    for left_pixel, right_pixel in zip(left, right, strict=True)
                    for channel in range(4)
                )
    for mask, frame in frames.items():
        for side in SIDE_BITS:
            if mask & side:
                ports += 1
                inward_differences.extend(inward_port_differences(frame, side))
    mean_delta = sum(differences) / max(1, len(differences))
    max_delta = max(differences, default=0)
    inward_mean_delta = sum(inward_differences) / max(1, len(inward_differences))
    inward_max_delta = max(inward_differences, default=0)
    if mean_delta > SEAM_MEAN_CHANNEL_DELTA or max_delta > SEAM_MAX_CHANNEL_DELTA:
        raise RuntimeError(
            "Opposing connector colours are discontinuous in premultiplied RGBA: "
            f"mean={mean_delta:.3f} (limit {SEAM_MEAN_CHANNEL_DELTA}), "
            f"max={max_delta} (limit {SEAM_MAX_CHANNEL_DELTA})"
        )
    if (
        inward_mean_delta > SEAM_MEAN_CHANNEL_DELTA
        or inward_max_delta > SEAM_MAX_CHANNEL_DELTA
    ):
        raise RuntimeError(
            f"Open connectors contain an inward end cap within {SEAM_INWARD_DEPTH}px: "
            f"mean={inward_mean_delta:.3f} (limit {SEAM_MEAN_CHANNEL_DELTA}), "
            f"max={inward_max_delta} (limit {SEAM_MAX_CHANNEL_DELTA})"
        )
    return {
        "pairs": pairs,
        "meanChannelDelta": round(mean_delta, 3),
        "maxChannelDelta": max_delta,
        "ports": ports,
        "inwardDepth": SEAM_INWARD_DEPTH,
        "inwardMeanChannelDelta": round(inward_mean_delta, 3),
        "inwardMaxChannelDelta": inward_max_delta,
    }


def encode_png(image: Image.Image) -> bytes:
    stream = io.BytesIO()
    image.save(stream, "PNG", optimize=True)
    return stream.getvalue()


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def print_report(
    path: Path,
    report: dict[int, dict[str, float | int]],
    seam_report: dict[str, float | int],
) -> None:
    edge_centers = {
        side: [
            value
            for frame in report.values()
            for key, value in frame.items()
            if key == f"{side}Center"
        ]
        for side in ("north", "east", "south", "west")
    }
    ranges = ", ".join(
        f"{side}={min(values):.2f}..{max(values):.2f}"
        for side, values in edge_centers.items()
    )
    print(
        f"verified {path} RGBA {ATLAS_SIZE}x{ATLAS_SIZE}; "
        f"16 non-empty {FRAME_SIZE}px frames; edge centers {ranges}; "
        f"premultiplied seam mean={seam_report['meanChannelDelta']:.3f} "
        f"max={seam_report['maxChannelDelta']} across {seam_report['pairs']} pairs; "
        f"inward {seam_report['inwardDepth']}px mean="
        f"{seam_report['inwardMeanChannelDelta']:.3f} "
        f"max={seam_report['inwardMaxChannelDelta']} across "
        f"{seam_report['ports']} ports"
    )


def main() -> None:
    args = parse_args()
    if args.verify_only:
        with Image.open(args.output) as output:
            atlas = output.convert("RGBA") if output.mode == "RGBA" else output.copy()
        report = verify_atlas(atlas)
        seam_report = verify_seam_colours(atlas)
        print_report(args.output, report, seam_report)
        return

    frames = build_frames(args)
    family = inferred_seam_family(args.output, args.seam_family)
    frames = repair_autotile_seams(frames, family)
    atlas = pack_atlas(frames)
    report = verify_atlas(atlas)
    seam_report = verify_seam_colours(atlas)
    encoded = encode_png(atlas)
    encoded_sha256 = hashlib.sha256(encoded).hexdigest()
    if (
        family == "gel"
        and not args.mask_group
        and not args.single_mask
        and encoded_sha256 != EXPECTED_GEL_ATLAS_SHA256
    ):
        raise RuntimeError(
            "Digest-pinned gel atlas changed: expected "
            f"{EXPECTED_GEL_ATLAS_SHA256}, got {encoded_sha256}"
        )
    atomic_write(args.output, encoded)

    # Re-open the encoded artifact so validation covers the bytes actually
    # written rather than only Pillow's in-memory representation.
    with Image.open(args.output) as written:
        written.load()
        written_report = verify_atlas(written)
        written_seam_report = verify_seam_colours(written)
    print_report(args.output, written_report, written_seam_report)
    print(f"sha256={encoded_sha256} bytes={len(encoded)}")


if __name__ == "__main__":
    main()
