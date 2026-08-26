#!/usr/bin/env python3
"""Build deterministic rig layers from the two approved survivor masters.

This builder deliberately reads only:

* assets/original-masters/survivor-crystal-pin.png
* assets/original-masters/survivor-moss-sprout.png

It never consumes review/preview output.  Visible bind-pose pixels come from the
approved masters.  Only pixels hidden by faces/accessories are reconstructed,
using a deterministic nearest-boundary diffusion.

The current runtime accepts one expression-enabled ``eyes`` slot.  The atlas
therefore contains real ``eyeLeft`` and ``eyeRight`` cells plus an explicitly
labelled compatibility ``eyes`` cell composed from those two independent
cells.  The independent cells and PNG exports are the source of truth.
Expression variants reuse the character profiles in
``scripts/generate-expression-atlases.py`` so master rebuilds cannot restore a
separate generic face template.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import runpy
import sys
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "assets" / "rig-parts.json"
ATLAS_SIZE = (768, 512)
PIXELS_PER_RIG_UNIT = 4
CELL_GUTTER = 4
VERSION = 1


@dataclass(frozen=True)
class LayerSpec:
    name: str
    bbox: tuple[int, int, int, int]
    pivot: tuple[float, float]
    bone: str
    z: int
    polygons: tuple[tuple[tuple[int, int], ...], ...] = ()
    feature: str | None = None


@dataclass(frozen=True)
class CharacterSpec:
    owner: str
    rig_id: str
    master_path: str
    root: tuple[float, float]
    body_width: int
    subject_bbox: tuple[int, int, int, int]
    layers: tuple[LayerSpec, ...]
    body_holes: tuple[str, ...]
    runtime_order: tuple[str, ...]
    clean_glow: bool = False


CRYSTAL = CharacterSpec(
    owner="survivor-crystal-pin",
    rig_id="crystal",
    master_path="assets/original-masters/survivor-crystal-pin.png",
    root=(828.0, 1071.0),
    body_width=948,
    subject_bbox=(123, 13, 1302, 1071),
    layers=(
        LayerSpec(
            "needleBottom", (165, 846, 420, 999), (377, 951), "needleBottom", -70,
            (((177, 917), (292, 858), (394, 908), (410, 969),
              (371, 997), (260, 981), (196, 950)),),
        ),
        LayerSpec(
            "needleLower", (112, 720, 460, 919), (400, 872), "needleLower", -60,
            (((124, 782), (276, 731), (421, 792), (447, 865),
              (405, 910), (242, 884), (151, 829)),),
        ),
        LayerSpec(
            "needleMid", (116, 520, 555, 806), (489, 746), "needleMid", -50,
            (((122, 548), (310, 522), (507, 600), (548, 708),
              (514, 780), (459, 805), (281, 732), (157, 633)),),
        ),
        LayerSpec(
            "needleMidUpper", (215, 298, 670, 666), (602, 621), "needleMidUpper", -40,
            (((226, 310), (477, 325), (627, 470), (668, 583),
              (635, 646), (578, 664), (442, 569), (326, 447)),),
        ),
        LayerSpec(
            "needleUpper", (390, 68, 856, 492), (823, 473), "needleUpper", -30,
            (((398, 78), (711, 190), (842, 344), (856, 438),
              (824, 485), (731, 478), (610, 383), (510, 260), (425, 128)),),
        ),
        LayerSpec(
            "needleTall", (760, 13, 1060, 518), (979, 489), "needleTall", -20,
            (((807, 13), (1010, 188), (1048, 247), (1055, 405),
              (1030, 486), (982, 518), (854, 456), (779, 310), (765, 101)),),
        ),
        LayerSpec(
            "needleRight", (1008, 268, 1210, 574), (1095, 501), "needleRight", -10,
            (((1133, 271), (1193, 326), (1207, 421), (1181, 530),
              (1139, 572), (1064, 535), (1010, 454), (1037, 354)),),
        ),
        LayerSpec(
            "body", (354, 409, 1302, 1071), (828, 1071), "body", 0,
            (((357, 936), (369, 866), (414, 805), (458, 765),
              (486, 696), (518, 621), (566, 550), (627, 493),
              (700, 448), (780, 421), (862, 409), (947, 419),
              (1029, 449), (1101, 495), (1166, 559), (1215, 634),
              (1255, 718), (1288, 812), (1302, 895), (1288, 951),
              (1249, 991), (1194, 1023), (1110, 1047), (1014, 1058),
              (911, 1066), (805, 1071), (697, 1065), (594, 1057),
              (501, 1040), (421, 1012), (374, 974)),),
        ),
        LayerSpec("eyeLeft", (850, 620, 995, 820), (924, 720), "eyes", 10, feature="eye"),
        LayerSpec("eyeRight", (1085, 615, 1200, 805), (1141, 708), "eyes", 11, feature="eye"),
        LayerSpec("mouth", (980, 750, 1100, 865), (1041, 810), "mouth", 20, feature="filled-mouth"),
        LayerSpec(
            "front", (620, 767, 887, 979), (646, 798), "front", 30,
            (((626, 780), (652, 773), (780, 803), (813, 826),
              (887, 949), (882, 975), (744, 968), (686, 943),
              (651, 884), (621, 806)),),
        ),
    ),
    body_holes=("eyeLeft", "eyeRight", "mouth", "front"),
    runtime_order=(
        "needleBottom", "needleLower", "needleMid", "needleMidUpper",
        "needleUpper", "needleTall", "needleRight", "body", "eyes",
        "mouth", "front",
    ),
)


SPROUT = CharacterSpec(
    owner="survivor-moss-sprout",
    rig_id="sprout",
    master_path="assets/original-masters/survivor-moss-sprout.png",
    root=(704.5, 1019.0),
    body_width=831,
    subject_bbox=(289, 10, 1248, 1019),
    clean_glow=True,
    layers=(
        LayerSpec(
            "body", (289, 334, 1120, 1019), (704.5, 1019), "body", 0,
            (((648, 334), (757, 335), (866, 351), (963, 390),
              (1044, 450), (1091, 518), (1118, 598), (1120, 681),
              (1105, 770), (1071, 858), (1012, 927), (943, 973),
              (845, 999), (704, 1005), (551, 998), (430, 974),
              (348, 932), (304, 875), (304, 813), (346, 754),
              (375, 677), (397, 582), (439, 491), (505, 414),
              (579, 369)),),
        ),
        LayerSpec("eyeLeft", (425, 550, 560, 750), (494, 651), "eyes", 10, feature="eye"),
        LayerSpec("eyeRight", (685, 558, 835, 770), (760, 665), "eyes", 11, feature="eye"),
        LayerSpec("mouth", (540, 690, 680, 775), (610, 733), "mouth", 20, feature="line-mouth"),
        LayerSpec(
            "leafLeft", (370, 10, 780, 290), (759, 250), "leafLeft", 30,
            (((382, 111), (414, 69), (469, 37), (544, 19),
              (620, 27), (679, 60), (723, 111), (752, 169),
              (778, 228), (756, 271), (691, 289), (619, 286),
              (552, 260), (496, 218), (444, 171)),),
        ),
        LayerSpec(
            "leafRight", (730, 69, 1179, 330), (771, 251), "leafRight", 31,
            (((754, 224), (774, 171), (820, 125), (885, 89),
              (954, 70), (1028, 79), (1098, 102), (1149, 143),
              (1178, 191), (1169, 225), (1115, 254), (1041, 282),
              (954, 308), (873, 304), (809, 275)),),
        ),
        LayerSpec(
            "stemCollar", (648, 210, 880, 410), (754, 373), "stemCollar", 32,
            (
                ((704, 210), (773, 211), (819, 244), (815, 346),
                 (787, 371), (708, 352), (695, 278)),
                ((648, 349), (668, 331), (734, 324), (809, 331),
                 (866, 353), (879, 375), (852, 401), (777, 411),
                 (699, 405), (651, 382)),
            ),
        ),
        LayerSpec(
            "pack", (760, 564, 1248, 1000), (963, 738), "pack", 40,
            (
                ((905, 638), (1087, 618), (1144, 630), (1195, 663),
                 (1225, 716), (1248, 774), (1243, 895), (1205, 956),
                 (1154, 988), (1013, 992), (943, 970), (911, 921),
                 (895, 838), (905, 787)),
                ((769, 828), (793, 808), (931, 720), (979, 733),
                 (990, 780), (806, 914), (775, 909), (760, 881)),
                ((1048, 636), (1095, 568), (1124, 579), (1147, 635)),
                ((886, 713), (915, 684), (956, 686), (989, 720),
                 (990, 770), (961, 810), (913, 806), (885, 776)),
            ),
        ),
    ),
    body_holes=("eyeLeft", "eyeRight", "mouth", "stemCollar", "pack"),
    runtime_order=("body", "eyes", "mouth", "leafLeft", "leafRight", "stemCollar", "pack"),
)


SPECS = (CRYSTAL, SPROUT)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _png_bytes(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, format="PNG", optimize=True, compress_level=9)
    return output.getvalue()


def _rect_dict(rect: tuple[int, int, int, int]) -> dict[str, int]:
    x0, y0, x1, y1 = rect
    return {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0}


def _clean_master_alpha(image: Image.Image, enabled: bool) -> Image.Image:
    if not enabled:
        return image.copy()

    alpha = image.getchannel("A")
    strong = alpha.point(lambda value: 255 if value >= 192 else 0)
    near_strong = strong.filter(ImageFilter.MaxFilter(5))
    a_pixels = alpha.load()
    n_pixels = near_strong.load()
    cleaned = Image.new("L", image.size, 0)
    c_pixels = cleaned.load()
    for y in range(image.height):
        for x in range(image.width):
            value = a_pixels[x, y]
            if value >= 248:
                c_pixels[x, y] = 255
            elif value >= 8 and n_pixels[x, y]:
                c_pixels[x, y] = value

    output = image.copy()
    output.putalpha(cleaned)
    return output


def _polygon_mask(
    size: tuple[int, int],
    polygons: Sequence[Sequence[tuple[int, int]]],
    blur: float = 0.7,
) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    for polygon in polygons:
        draw.polygon(polygon, fill=255)
    if blur > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(blur))
    return mask


def _largest_component(mask: Image.Image) -> Image.Image:
    width, height = mask.size
    pixels = mask.load()
    seen = bytearray(width * height)
    best: list[tuple[int, int]] = []
    for start_y in range(height):
        for start_x in range(width):
            index = start_y * width + start_x
            if seen[index] or pixels[start_x, start_y] < 128:
                continue
            queue = deque([(start_x, start_y)])
            seen[index] = 1
            component: list[tuple[int, int]] = []
            while queue:
                x, y = queue.popleft()
                component.append((x, y))
                for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    next_index = next_y * width + next_x
                    if seen[next_index] or pixels[next_x, next_y] < 128:
                        continue
                    seen[next_index] = 1
                    queue.append((next_x, next_y))
            if len(component) > len(best):
                best = component
    output = Image.new("L", mask.size, 0)
    target = output.load()
    for x, y in best:
        target[x, y] = 255
    return output


def _fill_component_holes(component: Image.Image) -> Image.Image:
    width, height = component.size
    source = component.load()
    exterior = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        for y in (0, height - 1):
            if source[x, y] < 128 and not exterior[y * width + x]:
                exterior[y * width + x] = 1
                queue.append((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if source[x, y] < 128 and not exterior[y * width + x]:
                exterior[y * width + x] = 1
                queue.append((x, y))
    while queue:
        x, y = queue.popleft()
        for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if not (0 <= next_x < width and 0 <= next_y < height):
                continue
            index = next_y * width + next_x
            if exterior[index] or source[next_x, next_y] >= 128:
                continue
            exterior[index] = 1
            queue.append((next_x, next_y))
    output = Image.new("L", component.size, 255)
    pixels = output.load()
    for y in range(height):
        for x in range(width):
            if exterior[y * width + x]:
                pixels[x, y] = 0
    return output


def _feature_mask(image: Image.Image, bbox: tuple[int, int, int, int], kind: str) -> Image.Image:
    crop = image.crop(bbox)
    source = crop.load()
    binary = Image.new("L", crop.size, 0)
    target = binary.load()
    for y in range(crop.height):
        for x in range(crop.width):
            red, green, blue, alpha = source[x, y]
            if alpha < 32:
                continue
            is_ink = red < 72 and green < 112 and blue < 165
            if is_ink:
                target[x, y] = 255
    component = _largest_component(binary)
    if kind in {"eye", "filled-mouth"}:
        component = _fill_component_holes(component)
    component = component.filter(ImageFilter.MaxFilter(3))
    component = component.filter(ImageFilter.GaussianBlur(0.65))
    full = Image.new("L", image.size, 0)
    full.paste(component, bbox[:2])
    return full


def _mask_layer(image: Image.Image, mask: Image.Image) -> Image.Image:
    output = image.copy()
    output.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
    return output


def _union_masks(masks: Iterable[Image.Image], size: tuple[int, int]) -> Image.Image:
    result = Image.new("L", size, 0)
    for mask in masks:
        result = ImageChops.lighter(result, mask)
    return result


def _expand_mask(mask: Image.Image, pixels: int) -> Image.Image:
    size = pixels * 2 + 1
    return mask.filter(ImageFilter.MaxFilter(size))


def _fill_hidden_pixels(
    source: Image.Image,
    body_mask: Image.Image,
    hole_mask: Image.Image,
    bbox: tuple[int, int, int, int],
) -> Image.Image:
    """Diffuse known boundary colours into hidden body pixels deterministically."""

    x0, y0, x1, y1 = bbox
    working = source.crop(bbox).copy()
    body = body_mask.crop(bbox)
    holes = ImageChops.multiply(_expand_mask(hole_mask.crop(bbox), 5), body)
    pixels = working.load()
    body_pixels = body.load()
    hole_pixels = holes.load()
    width, height = working.size
    unknown = bytearray(width * height)
    remaining = 0
    for y in range(height):
        for x in range(width):
            if body_pixels[x, y] >= 64 and hole_pixels[x, y] >= 32:
                unknown[y * width + x] = 1
                remaining += 1

    queue: deque[tuple[int, int]] = deque()
    queued = bytearray(width * height)
    for y in range(height):
        for x in range(width):
            index = y * width + x
            if not unknown[index]:
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < width and 0 <= ny < height and not unknown[ny * width + nx] and body_pixels[nx, ny] >= 32:
                    queued[index] = 1
                    queue.append((x, y))
                    break

    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if not unknown[index]:
            continue
        neighbours: list[tuple[int, int, int, int]] = []
        for ny in range(max(0, y - 1), min(height, y + 2)):
            for nx in range(max(0, x - 1), min(width, x + 2)):
                if nx == x and ny == y:
                    continue
                if not unknown[ny * width + nx] and body_pixels[nx, ny] >= 32:
                    neighbours.append(pixels[nx, ny])
        if not neighbours:
            queued[index] = 0
            continue
        pixels[x, y] = tuple(
            round(sum(pixel[channel] for pixel in neighbours) / len(neighbours))
            for channel in range(4)
        )
        unknown[index] = 0
        remaining -= 1
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if not (0 <= nx < width and 0 <= ny < height):
                continue
            next_index = ny * width + nx
            if unknown[next_index] and not queued[next_index]:
                queued[next_index] = 1
                queue.append((nx, ny))

    if remaining:
        known = [pixels[x, y] for y in range(height) for x in range(width)
                 if body_pixels[x, y] >= 32 and not unknown[y * width + x]]
        fallback = tuple(round(sum(pixel[c] for pixel in known) / len(known)) for c in range(4))
        for y in range(height):
            for x in range(width):
                if unknown[y * width + x]:
                    pixels[x, y] = fallback

    softened = working.filter(ImageFilter.GaussianBlur(3.0))
    working = Image.composite(softened, working, holes.filter(ImageFilter.GaussianBlur(1.2)))
    output = source.copy()
    output.paste(working, bbox[:2])
    return output


def _native_layers(spec: CharacterSpec) -> tuple[Image.Image, dict[str, Image.Image], dict[str, Image.Image]]:
    master = Image.open(ROOT / spec.master_path).convert("RGBA")
    master = _clean_master_alpha(master, spec.clean_glow)
    masks: dict[str, Image.Image] = {}
    layer_specs = {layer.name: layer for layer in spec.layers}
    for layer in spec.layers:
        if layer.feature:
            masks[layer.name] = _feature_mask(master, layer.bbox, layer.feature)
        else:
            # The hand-authored polygon follows the centre of the source ink.
            # Grow it by twelve native pixels so the complete anti-aliased navy
            # outline remains owned by the semantic layer.  Multiplication by
            # the approved master's alpha still prevents any background fill.
            masks[layer.name] = _polygon_mask(master.size, layer.polygons).filter(
                ImageFilter.MaxFilter(25)
            )

    body_spec = layer_specs["body"]
    body_mask = masks["body"]
    holes = _union_masks((masks[name] for name in spec.body_holes), master.size)
    body_source = _fill_hidden_pixels(master, body_mask, holes, body_spec.bbox)
    body_visible_mask = ImageChops.subtract(body_mask, _expand_mask(holes, 1))
    layers: dict[str, Image.Image] = {"body": _mask_layer(body_source, body_mask)}

    for layer in spec.layers:
        if layer.name == "body":
            continue
        mask = masks[layer.name]
        if layer.z < 0:
            # Back crystals must never carry cyan body pixels in their hidden roots.
            mask = ImageChops.subtract(mask, body_visible_mask)
        layers[layer.name] = _mask_layer(master, mask)

    return master, layers, masks


def _layer_cell(
    layer: Image.Image,
    layer_spec: LayerSpec,
    rig_scale: float,
) -> Image.Image:
    crop = layer.crop(layer_spec.bbox)
    native_width = layer_spec.bbox[2] - layer_spec.bbox[0]
    native_height = layer_spec.bbox[3] - layer_spec.bbox[1]
    size = (
        max(4, round(native_width * rig_scale * PIXELS_PER_RIG_UNIT)),
        max(4, round(native_height * rig_scale * PIXELS_PER_RIG_UNIT)),
    )
    return crop.resize(size, Image.Resampling.LANCZOS)


def _combine_eye_cells(
    spec: CharacterSpec,
    layers: dict[str, Image.Image],
    layer_specs: dict[str, LayerSpec],
    rig_scale: float,
) -> tuple[Image.Image, tuple[int, int, int, int]]:
    left = layer_specs["eyeLeft"].bbox
    right = layer_specs["eyeRight"].bbox
    union = (min(left[0], right[0]), min(left[1], right[1]), max(left[2], right[2]), max(left[3], right[3]))
    full = Image.new("RGBA", layers["eyeLeft"].size, (0, 0, 0, 0))
    full.alpha_composite(layers["eyeLeft"])
    full.alpha_composite(layers["eyeRight"])
    pseudo = LayerSpec("eyes", union, ((left[0] + right[2]) / 2, (left[1] + right[3]) / 2), "eyes", 10)
    return _layer_cell(full, pseudo, rig_scale), union


_CHARACTER_EXPRESSION_BUILDER = None


def _expression_sheet(
    owner: str,
    normal_eyes: Image.Image,
    normal_mouth: Image.Image,
) -> Image.Image:
    """Reuse the production character profiles instead of a master-only template."""

    global _CHARACTER_EXPRESSION_BUILDER
    if _CHARACTER_EXPRESSION_BUILDER is None:
        generator_path = ROOT / "scripts" / "generate-expression-atlases.py"
        namespace = runpy.run_path(str(generator_path))
        builder = namespace.get("generate_expression_sheet")
        if not callable(builder):
            raise RuntimeError("expression generator has no generate_expression_sheet function")
        _CHARACTER_EXPRESSION_BUILDER = builder

    return _CHARACTER_EXPRESSION_BUILDER(owner, normal_eyes, normal_mouth)


def _pack_cells(cells: dict[str, Image.Image]) -> dict[str, tuple[int, int, int, int]]:
    atlas_width, atlas_height = ATLAS_SIZE
    free = [(0, 0, atlas_width, atlas_height)]
    placements: dict[str, tuple[int, int, int, int]] = {}
    ordered = sorted(cells.items(), key=lambda item: (-(item[1].width * item[1].height), -max(item[1].size), item[0]))

    def prune(rectangles: list[tuple[int, int, int, int]]) -> list[tuple[int, int, int, int]]:
        output: list[tuple[int, int, int, int]] = []
        for index, rect in enumerate(rectangles):
            x, y, width, height = rect
            if width <= 0 or height <= 0:
                continue
            contained = False
            for other_index, other in enumerate(rectangles):
                if index == other_index:
                    continue
                ox, oy, ow, oh = other
                if x >= ox and y >= oy and x + width <= ox + ow and y + height <= oy + oh:
                    if rect != other or index > other_index:
                        contained = True
                        break
            if not contained and rect not in output:
                output.append(rect)
        return output

    for name, image in ordered:
        requested_width = image.width + CELL_GUTTER * 2
        requested_height = image.height + CELL_GUTTER * 2
        choices = []
        for index, (x, y, width, height) in enumerate(free):
            if requested_width <= width and requested_height <= height:
                choices.append((min(width - requested_width, height - requested_height),
                                width * height - requested_width * requested_height, y, x, index))
        if not choices:
            raise RuntimeError(f"{name} does not fit in {atlas_width}x{atlas_height} atlas")
        _, _, _, _, chosen_index = min(choices)
        px, py, pw, ph = free[chosen_index]
        used = (px, py, requested_width, requested_height)
        ux, uy, uw, uh = used
        next_free: list[tuple[int, int, int, int]] = []
        for fx, fy, fw, fh in free:
            if ux >= fx + fw or ux + uw <= fx or uy >= fy + fh or uy + uh <= fy:
                next_free.append((fx, fy, fw, fh))
                continue
            if ux > fx:
                next_free.append((fx, fy, ux - fx, fh))
            if ux + uw < fx + fw:
                next_free.append((ux + uw, fy, fx + fw - (ux + uw), fh))
            if uy > fy:
                next_free.append((fx, fy, fw, uy - fy))
            if uy + uh < fy + fh:
                next_free.append((fx, uy + uh, fw, fy + fh - (uy + uh)))
        free = prune(next_free)
        placements[name] = (px + CELL_GUTTER, py + CELL_GUTTER, image.width, image.height)
    return placements


def _compose_native(spec: CharacterSpec, layers: dict[str, Image.Image]) -> Image.Image:
    output = Image.new("RGBA", next(iter(layers.values())).size, (0, 0, 0, 0))
    for layer in sorted(spec.layers, key=lambda item: item.z):
        output.alpha_composite(layers[layer.name])
    return output


def _metrics(reference: Image.Image, actual: Image.Image) -> dict[str, float | int]:
    ref = reference.convert("RGBA")
    got = actual.convert("RGBA")
    ref_pixels = ref.load()
    got_pixels = got.load()
    union = intersection = 0
    alpha_error = 0
    rgb_squared = 0
    rgb_samples = 0
    changed = 0
    for y in range(ref.height):
        for x in range(ref.width):
            a = ref_pixels[x, y]
            b = got_pixels[x, y]
            av = a[3] >= 32
            bv = b[3] >= 32
            union += int(av or bv)
            intersection += int(av and bv)
            alpha_error += abs(a[3] - b[3])
            if av:
                delta = max(abs(a[c] - b[c]) for c in range(3))
                changed += int(delta > 8 or abs(a[3] - b[3]) > 8)
                for channel in range(3):
                    rgb_squared += (a[channel] - b[channel]) ** 2
                    rgb_samples += 1
    mse = rgb_squared / max(1, rgb_samples)
    psnr = 99.0 if mse == 0 else 10 * math.log10((255 * 255) / mse)
    return {
        "alphaIoU": round(intersection / max(1, union), 6),
        "meanAlphaError": round(alpha_error / (ref.width * ref.height), 6),
        "visibleRgbPsnrDb": round(psnr, 4),
        "visiblePixelsChangedOver8": changed,
        "visiblePixels": sum(ref.getchannel("A").histogram()[32:]),
    }


def _bind_rect(layer: LayerSpec, spec: CharacterSpec, cell: Image.Image) -> dict[str, float]:
    scale = 102 / spec.body_width
    x0, y0, _, _ = layer.bbox
    return {
        "x": round((x0 - spec.root[0]) * scale, 3),
        "y": round((y0 - spec.root[1]) * scale, 3),
        "width": cell.width / PIXELS_PER_RIG_UNIT,
        "height": cell.height / PIXELS_PER_RIG_UNIT,
    }


def _build_character(spec: CharacterSpec) -> tuple[dict[str, bytes], dict, dict]:
    master, layers, masks = _native_layers(spec)
    layer_specs = {layer.name: layer for layer in spec.layers}
    rig_scale = 102 / spec.body_width
    cells = {
        name: _layer_cell(image, layer_specs[name], rig_scale)
        for name, image in layers.items()
    }
    eyes_cell, eyes_bbox = _combine_eye_cells(spec, layers, layer_specs, rig_scale)
    cells["eyes"] = eyes_cell
    placements = _pack_cells(cells)
    atlas = Image.new("RGBA", ATLAS_SIZE, (0, 0, 0, 0))
    for name, cell in cells.items():
        x, y, _, _ = placements[name]
        atlas.alpha_composite(cell, (x, y))

    expressions = _expression_sheet(spec.owner, cells["eyes"], cells["mouth"])
    native_recomposition = _compose_native(spec, layers)
    validation_image = native_recomposition.resize((512, 512), Image.Resampling.LANCZOS)
    validation_metrics = _metrics(master, native_recomposition)

    atlas_path = f"assets/generated-v2/rig/{spec.owner}/atlas.png"
    expressions_path = f"assets/generated-v2/rig/{spec.owner}/expressions-v2.png"
    output: dict[str, bytes] = {
        "atlas.png": _png_bytes(atlas),
        "expressions-v2.png": _png_bytes(expressions),
        "bind-recomposition-v1.png": _png_bytes(validation_image),
    }
    for name, cell in cells.items():
        output[f"layers-v1/{name}.png"] = _png_bytes(cell)

    def atlas_rect(name: str) -> dict[str, int]:
        x, y, width, height = placements[name]
        return {"x": x, "y": y, "width": width, "height": height}

    runtime_parts = []
    for name in spec.runtime_order:
        if name == "eyes":
            left = layer_specs["eyeLeft"]
            right = layer_specs["eyeRight"]
            pseudo = LayerSpec("eyes", eyes_bbox, ((left.pivot[0] + right.pivot[0]) / 2,
                                                   (left.pivot[1] + right.pivot[1]) / 2),
                               "eyes", 10)
            source_layer = pseudo
        else:
            source_layer = layer_specs[name]
        part = {
            "id": name,
            "bone": source_layer.bone,
            "z": source_layer.z,
            "path": atlas_path,
            "sourceRect": atlas_rect(name),
            "required": True,
            "bindRect": _bind_rect(source_layer, spec, cells[name]),
        }
        if name == "eyes":
            width, height = cells[name].size
            part["variants"] = {
                "blink": {"path": expressions_path, "sourceRect": {"x": 0, "y": 0, "width": width, "height": height}},
                "hurt": {"path": expressions_path, "sourceRect": {"x": width, "y": 0, "width": width, "height": height}},
                "attack": {"path": expressions_path, "sourceRect": {"x": width * 2, "y": 0, "width": width, "height": height}},
            }
        elif name == "mouth":
            width, height = cells[name].size
            eye_height = cells["eyes"].height
            part["variants"] = {
                "open": {"path": expressions_path, "sourceRect": {"x": 0, "y": eye_height, "width": width, "height": height}},
                "hurt": {"path": expressions_path, "sourceRect": {"x": width, "y": eye_height, "width": width, "height": height}},
            }
        runtime_parts.append(part)

    independent_cells = {}
    for name, layer in layer_specs.items():
        independent_cells[name] = {
            "atlasRect": atlas_rect(name),
            "bindRect": _bind_rect(layer, spec, cells[name]),
            "bone": layer.bone,
            "pivotMaster": [layer.pivot[0], layer.pivot[1]],
            "sourceBboxMaster": list(layer.bbox),
            "standalone": f"assets/generated-v2/rig/{spec.owner}/layers-v1/{name}.png",
        }

    master_bytes = (ROOT / spec.master_path).read_bytes()
    metadata = {
        "schemaVersion": 1,
        "builder": "scripts/build-master-derived-rigs.py",
        "sourceMaster": spec.master_path,
        "sourceMasterSha256": _sha256(master_bytes),
        "sourceMasterSize": list(master.size),
        "subjectBboxMaster": list(spec.subject_bbox),
        "rootMaster": list(spec.root),
        "rigUnitsPerMasterPixel": round(rig_scale, 9),
        "darkGlowCleanup": {
            "enabled": spec.clean_glow,
            "strongAlphaThreshold": 192 if spec.clean_glow else None,
            "retainedEdgeRadiusPixels": 2 if spec.clean_glow else None,
        },
        "independentCells": independent_cells,
        "runtimeCompatibility": {
            "eyes": {
                "kind": "derived-composite",
                "compositeOf": ["eyeLeft", "eyeRight"],
                "reason": "runtime schema v2 exposes one expression-enabled eyes slot",
                "atlasRect": atlas_rect("eyes"),
                "standalone": f"assets/generated-v2/rig/{spec.owner}/layers-v1/eyes.png",
            }
        },
        "validation": {
            "reference": "post-alpha-cleanup master" if spec.clean_glow else "approved master",
            "bindRecomposition": f"assets/generated-v2/rig/{spec.owner}/bind-recomposition-v1.png",
            "metrics": validation_metrics,
        },
    }

    manifest_metadata = {
        "schemaVersion": 1,
        "sourceMaster": spec.master_path,
        "builder": "scripts/build-master-derived-rigs.py",
        "metadataPath": f"assets/generated-v2/rig/{spec.owner}/master-derived-v1.json",
        "independentEyeCells": ["eyeLeft", "eyeRight"],
        "runtimeEyesCompatibility": {
            "kind": "derived-composite",
            "compositeOf": ["eyeLeft", "eyeRight"],
        },
    }
    runtime_rig = {
        "rigId": spec.rig_id,
        "rootBone": "root",
        "faceBone": "face",
        "canonicalFacing": 1,
        "masterDerived": manifest_metadata,
        "parts": runtime_parts,
    }
    validation_document = {
        **metadata,
        "atlasSha256": _sha256(output["atlas.png"]),
        "expressionsSha256": _sha256(output["expressions-v2.png"]),
        "layerPngSha256": {
            name: _sha256(output[f"layers-v1/{name}.png"])
            for name in sorted(cells)
        },
        "runtimeRig": runtime_rig,
    }
    output["master-derived-v1.json"] = (json.dumps(validation_document, indent=2, ensure_ascii=False) + "\n").encode()
    return output, runtime_rig, validation_document


def _write_outputs(spec: CharacterSpec, outputs: dict[str, bytes]) -> None:
    directory = ROOT / "assets" / "generated-v2" / "rig" / spec.owner
    for relative, data in outputs.items():
        target = directory / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def _check_outputs(spec: CharacterSpec, outputs: dict[str, bytes], runtime_rig: dict) -> list[str]:
    directory = ROOT / "assets" / "generated-v2" / "rig" / spec.owner
    errors = []
    for relative, expected in outputs.items():
        path = directory / relative
        if not path.is_file():
            errors.append(f"missing {path.relative_to(ROOT)}")
        elif path.read_bytes() != expected:
            errors.append(f"stale {path.relative_to(ROOT)}")
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if manifest.get("rigs", {}).get(spec.owner) != runtime_rig:
        errors.append(f"stale assets/rig-parts.json entry: {spec.owner}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify checked-in outputs without writing")
    parser.add_argument("--print-manifest", action="store_true", help="print generated rig entries")
    args = parser.parse_args()

    generated = []
    errors: list[str] = []
    manifest_entries = {}
    for spec in SPECS:
        outputs, runtime_rig, validation = _build_character(spec)
        manifest_entries[spec.owner] = runtime_rig
        if args.check:
            errors.extend(_check_outputs(spec, outputs, runtime_rig))
        else:
            _write_outputs(spec, outputs)
        generated.append({
            "owner": spec.owner,
            "metrics": validation["validation"]["metrics"],
            "files": len(outputs),
        })

    if args.print_manifest:
        print(json.dumps(manifest_entries, indent=2, ensure_ascii=False))
    elif errors:
        for error in errors:
            print(error, file=sys.stderr)
    else:
        print(json.dumps({"rigs": generated}, ensure_ascii=False))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
