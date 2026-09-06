#!/usr/bin/env python3
"""Build the original, browser-ready 3D asset pack for the shooter prototype.

Run with Blender, not the system Python:

    blender --background --factory-startup --python scripts/build-shooter-3d-assets.py

The script writes editable, texture-packed Blender masters below
``assets/original-masters/3d/shooter`` and self-contained GLBs below
``assets/generated/3d/shooter``.  It deliberately creates no cameras or lights;
the browser scene owns presentation lighting and the third-person camera.
"""

from __future__ import annotations

import colorsys
import math
import os
from pathlib import Path
import random
from typing import Iterable, Sequence

import bpy
from mathutils import Vector


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MASTER_DIR = PROJECT_ROOT / "assets" / "original-masters" / "3d" / "shooter"
OUTPUT_DIR = PROJECT_ROOT / "assets" / "generated" / "3d" / "shooter"
FPS = 30


def hex_rgb(value: str) -> tuple[float, float, float]:
    normalized = value.strip().lstrip("#")
    if len(normalized) != 6:
        raise ValueError(f"Expected six-digit RGB hex colour, got {value!r}")
    return tuple(int(normalized[index:index + 2], 16) / 255 for index in (0, 2, 4))


def hex_linear_rgb(value: str) -> tuple[float, float, float]:
    """Convert authored sRGB hex colours to Blender image-buffer linear RGB."""
    def linear(channel: float) -> float:
        return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4

    return tuple(linear(channel) for channel in hex_rgb(value))


def mix_rgb(
    left: Sequence[float],
    right: Sequence[float],
    amount: float,
) -> tuple[float, float, float]:
    t = max(0.0, min(1.0, amount))
    return tuple(left[index] * (1 - t) + right[index] * t for index in range(3))


def reset_scene(asset_name: str) -> bpy.types.Collection:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # Generated masters are reproducible; avoid leaving Blender's numbered
    # backup files beside the formal editable outputs on repeat builds.
    bpy.context.preferences.filepaths.save_version = 0
    scene = bpy.context.scene
    scene.name = f"{asset_name}_Scene"
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = 60
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.length_unit = "METERS"
    scene.world = bpy.data.worlds.new(f"{asset_name}_World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    if background:
        background.inputs["Color"].default_value = (0.035, 0.055, 0.08, 1)
        background.inputs["Strength"].default_value = 0.25
    collection = bpy.data.collections.new(f"{asset_name}_Model")
    scene.collection.children.link(collection)
    return collection


def move_to_collection(obj: bpy.types.Object, collection: bpy.types.Collection) -> None:
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def parent_to(obj: bpy.types.Object, parent: bpy.types.Object | None) -> bpy.types.Object:
    if parent is not None:
        obj.parent = parent
    return obj


def add_empty(
    name: str,
    collection: bpy.types.Collection,
    *,
    parent: bpy.types.Object | None = None,
    location: Sequence[float] = (0, 0, 0),
    display: str = "PLAIN_AXES",
    size: float = 0.35,
    extras: dict | None = None,
) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    collection.objects.link(obj)
    obj.empty_display_type = display
    obj.empty_display_size = size
    obj.location = location
    parent_to(obj, parent)
    for key, value in (extras or {}).items():
        obj[key] = value
    return obj


def select_hierarchy(root: bpy.types.Object) -> list[bpy.types.Object]:
    selected: list[bpy.types.Object] = []

    def visit(obj: bpy.types.Object) -> None:
        selected.append(obj)
        for child in obj.children:
            visit(child)

    visit(root)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in selected:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    return selected


def smooth_mesh(obj: bpy.types.Object) -> bpy.types.Object:
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def add_bevel(obj: bpy.types.Object, width: float, segments: int = 2) -> bpy.types.Object:
    modifier = obj.modifiers.new(name="Soft_Edges", type="BEVEL")
    modifier.width = width
    modifier.segments = segments
    return obj


def assign_material(obj: bpy.types.Object, material: bpy.types.Material) -> bpy.types.Object:
    if obj.data and hasattr(obj.data, "materials"):
        obj.data.materials.append(material)
    return obj


def add_cube(
    name: str,
    collection: bpy.types.Collection,
    dimensions: Sequence[float],
    *,
    location: Sequence[float] = (0, 0, 0),
    rotation: Sequence[float] = (0, 0, 0),
    material: bpy.types.Material | None = None,
    parent: bpy.types.Object | None = None,
    bevel: float = 0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(obj, collection)
    parent_to(obj, parent)
    if material:
        assign_material(obj, material)
    if bevel > 0:
        add_bevel(obj, bevel)
    return obj


def add_cylinder(
    name: str,
    collection: bpy.types.Collection,
    radius: float,
    depth: float,
    *,
    vertices: int = 24,
    location: Sequence[float] = (0, 0, 0),
    rotation: Sequence[float] = (0, 0, 0),
    scale_xy: Sequence[float] = (1, 1),
    material: bpy.types.Material | None = None,
    parent: bpy.types.Object | None = None,
    bevel: float = 0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale.x = scale_xy[0]
    obj.scale.y = scale_xy[1]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(obj, collection)
    parent_to(obj, parent)
    if material:
        assign_material(obj, material)
    if bevel > 0:
        add_bevel(obj, bevel)
    return smooth_mesh(obj)


def add_uv_sphere(
    name: str,
    collection: bpy.types.Collection,
    scale: Sequence[float],
    *,
    location: Sequence[float] = (0, 0, 0),
    segments: int = 20,
    rings: int = 12,
    material: bpy.types.Material | None = None,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments,
        ring_count=rings,
        radius=1,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(obj, collection)
    parent_to(obj, parent)
    if material:
        assign_material(obj, material)
    return smooth_mesh(obj)


def add_ico_sphere(
    name: str,
    collection: bpy.types.Collection,
    scale: Sequence[float],
    *,
    location: Sequence[float] = (0, 0, 0),
    subdivisions: int = 2,
    material: bpy.types.Material | None = None,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=subdivisions,
        radius=1,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(obj, collection)
    parent_to(obj, parent)
    if material:
        assign_material(obj, material)
    return smooth_mesh(obj)


def add_cone_between(
    name: str,
    collection: bpy.types.Collection,
    start: Sequence[float],
    end: Sequence[float],
    radius: float,
    *,
    vertices: int = 10,
    material: bpy.types.Material | None = None,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    start_vec = Vector(start)
    end_vec = Vector(end)
    direction = end_vec - start_vec
    midpoint = (start_vec + end_vec) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius,
        radius2=0,
        depth=direction.length,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    move_to_collection(obj, collection)
    parent_to(obj, parent)
    if material:
        assign_material(obj, material)
    return smooth_mesh(obj)


def add_tapered_between(
    name: str,
    collection: bpy.types.Collection,
    start: Sequence[float],
    end: Sequence[float],
    radius_start: float,
    radius_end: float,
    *,
    vertices: int = 12,
    material: bpy.types.Material | None = None,
    parent: bpy.types.Object | None = None,
    bevel: float = 0,
) -> bpy.types.Object:
    start_vec = Vector(start)
    end_vec = Vector(end)
    direction = end_vec - start_vec
    midpoint = (start_vec + end_vec) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius_start,
        radius2=radius_end,
        depth=direction.length,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    move_to_collection(obj, collection)
    parent_to(obj, parent)
    if material:
        assign_material(obj, material)
    if bevel > 0:
        add_bevel(obj, bevel)
    return smooth_mesh(obj)


def add_torus(
    name: str,
    collection: bpy.types.Collection,
    major_radius: float,
    minor_radius: float,
    *,
    location: Sequence[float] = (0, 0, 0),
    rotation: Sequence[float] = (0, 0, 0),
    scale: Sequence[float] = (1, 1, 1),
    major_segments: int = 24,
    minor_segments: int = 8,
    material: bpy.types.Material | None = None,
    parent: bpy.types.Object | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        align="WORLD",
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=location,
        rotation=rotation,
        major_radius=major_radius,
        minor_radius=minor_radius,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    move_to_collection(obj, collection)
    parent_to(obj, parent)
    if material:
        assign_material(obj, material)
    return smooth_mesh(obj)


def distort_radial_mesh(
    obj: bpy.types.Object,
    amount: float,
    seed: int,
    *,
    vertical: float = 0,
) -> bpy.types.Object:
    """Break perfect primitive outlines without changing their usable footprint."""
    if obj.type != "MESH":
        return obj
    for vertex in obj.data.vertices:
        radius = math.hypot(vertex.co.x, vertex.co.y)
        if radius < 1e-5:
            continue
        angle = math.atan2(vertex.co.y, vertex.co.x)
        wobble = (
            math.sin(angle * 3 + seed * 0.71) * 0.54
            + math.sin(angle * 7 - seed * 0.23) * 0.31
            + math.sin(angle * 11 + seed * 0.41) * 0.15
        )
        factor = 1.0 + amount * wobble
        vertex.co.x *= factor
        vertex.co.y *= factor
        if vertical:
            vertex.co.z += vertical * math.sin(angle * 5 + seed) * (0.35 + radius * 0.04)
    obj.data.update()
    return obj


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def hash_noise(x: int, y: int, seed: int) -> float:
    """Small deterministic hash used by the authored bitmap generator."""
    value = math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123
    return value - math.floor(value)


def value_noise(u: float, v: float, seed: int, frequency: float) -> float:
    x = u * frequency
    y = v * frequency
    x0 = math.floor(x)
    y0 = math.floor(y)
    tx = x - x0
    ty = y - y0
    tx = tx * tx * (3.0 - 2.0 * tx)
    ty = ty * ty * (3.0 - 2.0 * ty)
    a = hash_noise(x0, y0, seed)
    b = hash_noise(x0 + 1, y0, seed)
    c = hash_noise(x0, y0 + 1, seed)
    d = hash_noise(x0 + 1, y0 + 1, seed)
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def fbm(u: float, v: float, seed: int) -> float:
    total = 0.0
    weight = 0.58
    normalizer = 0.0
    frequency = 3.0
    for octave in range(4):
        total += value_noise(u, v, seed + octave * 13, frequency) * weight
        normalizer += weight
        weight *= 0.52
        frequency *= 2.15
    return total / normalizer


def surface_height(style: str, u: float, v: float, seed: int) -> float:
    broad = fbm(u, v, seed)
    fine = value_noise(u, v, seed + 101, 34.0)
    wave = 0.5 + 0.5 * math.sin((u * 13.0 + v * 7.0 + seed * 0.17) * math.tau)
    if style == "grass":
        blades = abs(math.sin((u * 31 + v * 5) * math.pi)) ** 8
        return clamp01(0.24 + broad * 0.38 + blades * 0.28 + fine * 0.10)
    if style == "soil":
        grains = 1.0 if fine > 0.78 else fine * 0.35
        return clamp01(0.18 + broad * 0.48 + grains * 0.28)
    if style in {"stone", "teeth"}:
        hairline = abs(math.sin((u * 4.1 + v * 5.7 + broad * 0.8) * math.pi))
        crack = 1.0 - min(1.0, hairline * 10.0)
        return clamp01(0.34 + broad * 0.34 + fine * 0.12 - crack * 0.32)
    if style in {"wood", "painted_wood"}:
        grain = 0.5 + 0.5 * math.sin((u * 14.0 + math.sin(v * 8.0) * 0.7) * math.pi)
        gouge = 1.0 if fine < 0.07 else 0.0
        return clamp01(0.24 + grain * 0.32 + broad * 0.24 - gouge * 0.18)
    if style in {"leaf", "skin"}:
        pores = fine * 0.16
        vein = max(0.0, 1.0 - abs(u - 0.5) * 20.0)
        return clamp01(0.30 + broad * 0.28 + pores + vein * (0.18 if style == "leaf" else 0.06))
    if style in {"fabric", "spots"}:
        warp = 0.5 + 0.5 * math.sin(u * 56 * math.pi)
        weft = 0.5 + 0.5 * math.sin(v * 52 * math.pi)
        return clamp01(0.32 + broad * 0.22 + (warp + weft) * 0.10)
    if style == "terracotta":
        pits = 1.0 if fine < 0.08 else 0.0
        return clamp01(0.30 + broad * 0.34 + wave * 0.08 - pits * 0.22)
    if style in {"metal", "painted_metal"}:
        scratches = 1.0 if fine < 0.045 or fine > 0.965 else 0.0
        return clamp01(0.38 + broad * 0.18 - scratches * 0.30)
    if style == "ice":
        vein = abs(math.sin((u * 7.0 + v * 11.0 + broad) * math.pi))
        fracture = 1.0 - min(1.0, abs(vein - 0.48) * 12.0)
        return clamp01(0.40 + broad * 0.24 + fine * 0.10 - fracture * 0.28)
    if style == "petal":
        radial = max(0.0, 1.0 - math.hypot(u - 0.5, v - 0.5) * 1.7)
        return clamp01(0.28 + radial * 0.35 + broad * 0.20)
    return clamp01(0.28 + broad * 0.44 + fine * 0.12)


def texture_pixel(
    style: str,
    u: float,
    v: float,
    base: Sequence[float],
    accent: Sequence[float],
    highlight: Sequence[float],
    seed: int,
) -> tuple[float, float, float]:
    broad = fbm(u, v, seed)
    fine = value_noise(u, v, seed + 79, 32.0)
    height = surface_height(style, u, v, seed)
    # The low-frequency light-to-dark sweep reads like deliberate brushwork,
    # rather than sterile procedural noise, when the small maps are magnified.
    brush = 0.5 + 0.5 * math.sin((u * 3.2 - v * 2.1 + broad * 0.65) * math.pi)
    amount = clamp01(0.06 + broad * 0.24 + brush * 0.08)
    colour = mix_rgb(base, highlight, amount)
    dirt = fine < 0.075 or value_noise(u, v, seed + 211, 9.0) < 0.12

    if style == "grass":
        blade = abs(math.sin((u * 27.0 + v * 4.0) * math.pi)) ** 10
        colour = mix_rgb(colour, highlight, 0.08 + blade * 0.28)
        colour = mix_rgb(colour, accent, (1.0 - height) * 0.18)
    elif style == "soil":
        colour = mix_rgb(colour, accent, 0.20 + (1.0 - height) * 0.22)
        if fine > 0.88:
            colour = mix_rgb(colour, highlight, 0.33)
    elif style in {"stone", "teeth"}:
        colour = mix_rgb(colour, accent, max(0.0, 0.48 - height) * 0.62)
        if dirt:
            colour = mix_rgb(colour, accent, 0.28 if style == "stone" else 0.12)
    elif style in {"wood", "painted_wood"}:
        grain = 0.5 + 0.5 * math.sin((u * 13.0 + math.sin(v * 7.0) * 0.75) * math.pi)
        colour = mix_rgb(colour, accent, 0.10 + grain * 0.23)
        if style == "painted_wood" and fine < 0.10:
            colour = mix_rgb(colour, accent, 0.48)
    elif style == "leaf":
        vein = max(0.0, 1.0 - abs(u - 0.5) * 18.0)
        colour = mix_rgb(colour, highlight, vein * 0.26)
        colour = mix_rgb(colour, accent, (1.0 - height) * 0.14)
    elif style == "skin":
        mottling = value_noise(u, v, seed + 37, 11.0)
        colour = mix_rgb(colour, accent, max(0.0, 0.54 - mottling) * 0.42)
        if dirt:
            colour = mix_rgb(colour, (0.13, 0.12, 0.08), 0.20)
    elif style in {"fabric", "spots"}:
        patch = value_noise(u, v, seed + 53, 7.0) < 0.16
        colour = mix_rgb(colour, accent, 0.18 + (0.26 if patch else 0.0))
        if dirt:
            colour = mix_rgb(colour, (0.12, 0.09, 0.07), 0.18)
    elif style == "terracotta":
        band = 0.5 + 0.5 * math.sin((v * 5.0 + broad * 0.4) * math.pi)
        colour = mix_rgb(colour, accent, 0.10 + band * 0.12)
        if dirt:
            colour = mix_rgb(colour, (0.15, 0.11, 0.07), 0.24)
    elif style in {"metal", "painted_metal"}:
        colour = mix_rgb(colour, accent, max(0.0, 0.52 - height) * 0.45)
        if style == "painted_metal" and (fine < 0.07 or fine > 0.95):
            colour = mix_rgb(colour, (0.20, 0.22, 0.20), 0.65)
    elif style == "ice":
        fracture = max(0.0, 0.42 - height) * 1.8
        colour = mix_rgb(colour, highlight, clamp01(0.12 + fracture))
        colour = mix_rgb(colour, accent, (1.0 - broad) * 0.12)
    elif style == "petal":
        radial = max(0.0, 1.0 - math.hypot(u - 0.5, v - 0.5) * 1.7)
        colour = mix_rgb(colour, highlight, radial * 0.32)

    # Subtle cool grime settles in the low parts of every non-ice material.
    if dirt and style not in {"ice", "petal", "teeth"}:
        colour = mix_rgb(colour, (0.12, 0.15, 0.12), 0.08)
    return tuple(clamp01(channel) for channel in colour)


def make_surface_textures(
    name: str,
    base_hex: str,
    accent_hex: str,
    highlight_hex: str,
    *,
    style: str,
    seed: int,
    base_roughness: float,
    size: int = 96,
) -> tuple[bpy.types.Image, bpy.types.Image, bpy.types.Image]:
    # Generated-image pixels are scene-linear. Converting the art-directed
    # sRGB swatches here prevents the washed-out pastel look of raw hex values.
    base = hex_linear_rgb(base_hex)
    accent = hex_linear_rgb(accent_hex)
    highlight = hex_linear_rgb(highlight_hex)
    albedo = bpy.data.images.new(name=f"{name}_Albedo", width=size, height=size, alpha=True)
    roughness = bpy.data.images.new(name=f"{name}_Roughness", width=size, height=size, alpha=True)
    normal = bpy.data.images.new(name=f"{name}_Normal", width=size, height=size, alpha=True)
    roughness.colorspace_settings.name = "Non-Color"
    normal.colorspace_settings.name = "Non-Color"
    albedo_pixels: list[float] = []
    roughness_pixels: list[float] = []
    normal_pixels: list[float] = []
    step = 1.0 / size
    normal_scale = {
        "grass": 3.2, "soil": 2.8, "stone": 2.5, "wood": 2.4,
        "painted_wood": 2.2, "leaf": 2.0, "skin": 1.65, "fabric": 2.0,
        "spots": 2.0, "terracotta": 2.6, "metal": 1.3,
        "painted_metal": 1.7, "ice": 2.0, "petal": 1.2, "teeth": 0.8,
    }.get(style, 1.8)
    for y in range(size):
        v = (y + 0.5) / size
        for x in range(size):
            u = (x + 0.5) / size
            rgb = texture_pixel(style, u, v, base, accent, highlight, seed)
            albedo_pixels.extend((*rgb, 1.0))
            h = surface_height(style, u, v, seed)
            detail = value_noise(u, v, seed + 313, 27.0) - 0.5
            style_bias = -0.09 if style == "ice" else (0.05 if style in {"soil", "fabric"} else 0.0)
            rough = clamp01(base_roughness + style_bias + (0.5 - h) * 0.16 + detail * 0.12)
            roughness_pixels.extend((rough, rough, rough, 1.0))
            left = surface_height(style, u - step, v, seed)
            right = surface_height(style, u + step, v, seed)
            down = surface_height(style, u, v - step, seed)
            up = surface_height(style, u, v + step, seed)
            nx = -(right - left) * normal_scale
            ny = -(up - down) * normal_scale
            nz = 1.0
            length = math.sqrt(nx * nx + ny * ny + nz * nz)
            normal_pixels.extend((nx / length * 0.5 + 0.5, ny / length * 0.5 + 0.5, nz / length * 0.5 + 0.5, 1.0))
    for image, pixels in (
        (albedo, albedo_pixels),
        (roughness, roughness_pixels),
        (normal, normal_pixels),
    ):
        image.pixels.foreach_set(pixels)
        image.update()
        image.pack()
    return albedo, roughness, normal


def make_material(
    name: str,
    albedo_texture: bpy.types.Image,
    roughness_texture: bpy.types.Image,
    normal_texture: bpy.types.Image,
    *,
    metallic: float = 0,
    emission_strength: float = 0,
    transmission: float = 0,
    normal_strength: float = 0.55,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = nodes.get("Principled BSDF")

    albedo_node = nodes.new("ShaderNodeTexImage")
    albedo_node.name = f"{name}_AlbedoTexture"
    albedo_node.label = "Packed hand-painted albedo"
    albedo_node.image = albedo_texture
    albedo_node.interpolation = "Linear"
    albedo_node.extension = "REPEAT"
    links.new(albedo_node.outputs["Color"], principled.inputs["Base Color"])

    roughness_node = nodes.new("ShaderNodeTexImage")
    roughness_node.name = f"{name}_RoughnessTexture"
    roughness_node.label = "Packed material roughness"
    roughness_node.image = roughness_texture
    roughness_node.interpolation = "Linear"
    roughness_node.extension = "REPEAT"
    links.new(roughness_node.outputs["Color"], principled.inputs["Roughness"])

    normal_node = nodes.new("ShaderNodeTexImage")
    normal_node.name = f"{name}_NormalTexture"
    normal_node.label = "Packed tangent-space surface variation"
    normal_node.image = normal_texture
    normal_node.interpolation = "Linear"
    normal_node.extension = "REPEAT"
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.name = f"{name}_NormalMap"
    normal_map.inputs["Strength"].default_value = normal_strength
    links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])

    principled.inputs["Metallic"].default_value = metallic
    emission = principled.inputs.get("Emission Color") or principled.inputs.get("Emission")
    if emission and emission_strength > 0:
        links.new(albedo_node.outputs["Color"], emission)
        strength = principled.inputs.get("Emission Strength")
        if strength:
            strength.default_value = emission_strength
    transmission_socket = principled.inputs.get("Transmission Weight") or principled.inputs.get("Transmission")
    if transmission_socket:
        transmission_socket.default_value = transmission
    material.diffuse_color = (*hex_rgb("#FFFFFF"), 1)
    return material


def create_material(
    name: str,
    base: str,
    accent: str,
    highlight: str,
    *,
    style: str,
    seed: int,
    roughness: float = 0.72,
    **material_options,
) -> bpy.types.Material:
    textures = make_surface_textures(
        name,
        base,
        accent,
        highlight,
        style=style,
        seed=seed,
        base_roughness=roughness,
    )
    return make_material(name, *textures, **material_options)


def add_flower(
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    index: int,
    location: Sequence[float],
    stem_material: bpy.types.Material,
    petal_material: bpy.types.Material,
    center_material: bpy.types.Material,
) -> None:
    x, y, z = location
    height = 0.38 + (index % 3) * 0.07
    add_cylinder(
        f"Flower_{index:02d}_Stem",
        collection,
        0.025,
        height,
        vertices=8,
        location=(x, y, z + height * 0.5),
        material=stem_material,
        parent=parent,
    )
    center = (x, y, z + height)
    for petal_index in range(5):
        angle = petal_index / 5 * math.tau
        add_uv_sphere(
            f"Flower_{index:02d}_Petal_{petal_index + 1}",
            collection,
            (0.10, 0.055, 0.035),
            location=(
                center[0] + math.cos(angle) * 0.10,
                center[1] + math.sin(angle) * 0.10,
                center[2],
            ),
            segments=10,
            rings=6,
            material=petal_material,
            parent=parent,
        ).rotation_euler.z = angle
    add_uv_sphere(
        f"Flower_{index:02d}_Center",
        collection,
        (0.075, 0.075, 0.05),
        location=center,
        segments=12,
        rings=6,
        material=center_material,
        parent=parent,
    )


def build_garden_arena() -> tuple[bpy.types.Object, Path, Path]:
    collection = reset_scene("garden-arena")
    root = add_empty(
        "garden-arena",
        collection,
        extras={
            "asset_id": "garden-arena",
            "asset_kind": "arena",
            "units": "metres",
            "up_axis": "+Y after glTF export",
            "play_radius": 10.4,
        },
    )

    grass = create_material(
        "Arena_Grass_PBR", "#2E8E3B", "#134B32", "#96D43D",
        style="grass", seed=11, roughness=0.82, normal_strength=0.72,
    )
    soil = create_material(
        "Arena_Soil_PBR", "#70442A", "#302A25", "#B76B38",
        style="soil", seed=17, roughness=0.90, normal_strength=0.78,
    )
    stone = create_material(
        "Arena_Flagstone_PBR", "#727C76", "#38484A", "#B8C3A5",
        style="stone", seed=23, roughness=0.79, normal_strength=0.64,
    )
    crack = create_material(
        "Arena_Crack_PBR", "#25352E", "#171D1B", "#4E5947",
        style="soil", seed=25, roughness=0.96, normal_strength=0.40,
    )
    hedge = create_material(
        "Arena_Hedge_PBR", "#24763B", "#103E2E", "#78C83F",
        style="leaf", seed=29, roughness=0.79, normal_strength=0.70,
    )
    terracotta = create_material(
        "Arena_Terracotta_PBR", "#AA502D", "#5B3026", "#E18A49",
        style="terracotta", seed=31, roughness=0.82, normal_strength=0.72,
    )
    painted_wood = create_material(
        "Arena_PaintedWood_PBR", "#2E8E89", "#5A3926", "#68C5A6",
        style="painted_wood", seed=33, roughness=0.76, normal_strength=0.60,
    )
    bare_wood = create_material(
        "Arena_BareWood_PBR", "#81502D", "#3F2D25", "#C18445",
        style="wood", seed=35, roughness=0.84, normal_strength=0.68,
    )
    painted_metal = create_material(
        "Arena_PaintedMetal_PBR", "#E8A62F", "#42535A", "#FFD861",
        style="painted_metal", seed=37, roughness=0.58, metallic=0.42,
        normal_strength=0.48,
    )
    portal_glow = create_material(
        "Arena_PortalGlow_PBR", "#7833AC", "#36165E", "#E056D8",
        style="ice", seed=39, roughness=0.36, emission_strength=0.55,
        normal_strength=0.30,
    )
    flower_pink = create_material(
        "Arena_FlowerPink_PBR", "#D92775", "#7C285E", "#FF9F9A",
        style="petal", seed=41, roughness=0.60, normal_strength=0.35,
    )
    flower_gold = create_material(
        "Arena_FlowerGold_PBR", "#E99521", "#9A4920", "#FFE157",
        style="petal", seed=43, roughness=0.57, normal_strength=0.34,
    )

    soil_island = add_cylinder(
        "Arena_Island_Soil",
        collection,
        13.2,
        0.82,
        vertices=48,
        location=(0, 0, -0.44),
        material=soil,
        parent=root,
        bevel=0.13,
    )
    distort_radial_mesh(soil_island, 0.055, 5, vertical=0.04)
    grass_island = add_cylinder(
        "Arena_Playfield_Grass",
        collection,
        12.55,
        0.20,
        vertices=48,
        location=(0, 0, -0.01),
        material=grass,
        parent=root,
        bevel=0.08,
    )
    distort_radial_mesh(grass_island, 0.035, 9, vertical=0.018)

    # Oversized hand-set flagstones form a readable combat lane. Each outline,
    # tilt, and crack is different so the path feels built, repaired, and worn.
    path_points = [
        (-0.35, -7.45), (0.54, -5.95), (-0.46, -4.45), (0.46, -2.85),
        (-0.26, -1.25), (0.42, 0.42), (-0.48, 2.10), (0.35, 3.82),
        (-0.30, 5.52), (0.38, 7.18),
    ]
    for index, (x, y) in enumerate(path_points, start=1):
        angle = (index % 5 - 2) * 0.115
        stone_obj = add_cylinder(
            f"Path_Flagstone_{index:02d}",
            collection,
            0.77 + (index % 3) * 0.065,
            0.14 + (index % 2) * 0.025,
            vertices=9 + index % 3,
            location=(x, y, 0.13 + (index % 2) * 0.012),
            rotation=(0.02 * (index % 3 - 1), 0.025 * ((index + 1) % 3 - 1), angle),
            scale_xy=(1.24 + (index % 2) * 0.08, 0.77 + (index % 3) * 0.035),
            material=stone,
            parent=root,
            bevel=0.045,
        )
        distort_radial_mesh(stone_obj, 0.115, 50 + index, vertical=0.018)
        crack_angle = angle + (0.48 if index % 2 else -0.38)
        crack_length = 0.43 + 0.04 * (index % 3)
        crack_start = Vector((x, y, 0.225)) - Vector((math.cos(crack_angle), math.sin(crack_angle), 0)) * crack_length
        crack_end = Vector((x, y, 0.225)) + Vector((math.cos(crack_angle), math.sin(crack_angle), 0)) * crack_length
        add_tapered_between(
            f"Path_Crack_{index:02d}_A", collection, crack_start, crack_end,
            0.026, 0.013, vertices=6, material=crack, parent=root,
        )
        branch_start = Vector((x + math.cos(crack_angle) * 0.08, y + math.sin(crack_angle) * 0.08, 0.228))
        branch_end = branch_start + Vector((math.cos(crack_angle + 1.1), math.sin(crack_angle + 1.1), 0)) * 0.30
        add_tapered_between(
            f"Path_Crack_{index:02d}_B", collection, branch_start, branch_end,
            0.020, 0.008, vertices=6, material=crack, parent=root,
        )

    # The clipped ring still reads as a suburban hedge, but multiple lumpy
    # crowns and intermittent repair boards prevent a repeated mobile-game tile.
    hedge_rng = random.Random(20260906)
    for index in range(18):
        angle = index / 18 * math.tau
        radius = 11.62 + hedge_rng.uniform(-0.16, 0.16)
        x, y = math.cos(angle) * radius, math.sin(angle) * radius
        height = 1.25 + hedge_rng.uniform(-0.17, 0.25)
        block = add_cube(
            f"Boundary_Hedge_{index + 1:02d}_ClippedBase",
            collection,
            (3.62 + hedge_rng.uniform(-0.18, 0.22), 0.83 + hedge_rng.uniform(-0.08, 0.12), height),
            location=(x, y, height * 0.50),
            rotation=(hedge_rng.uniform(-0.025, 0.025), hedge_rng.uniform(-0.025, 0.025), angle + math.pi / 2 + hedge_rng.uniform(-0.035, 0.035)),
            material=hedge,
            parent=root,
            bevel=0.27,
        )
        block["collision"] = "boundary_visual"
        tangent = Vector((-math.sin(angle), math.cos(angle), 0))
        radial = Vector((math.cos(angle), math.sin(angle), 0))
        for lump_index, offset in enumerate((-0.82, 0.0, 0.82), start=1):
            lump_location = Vector((x, y, 0)) + tangent * (offset + hedge_rng.uniform(-0.10, 0.10)) + radial * hedge_rng.uniform(-0.08, 0.08)
            add_ico_sphere(
                f"Boundary_Hedge_{index + 1:02d}_Crown_{lump_index}",
                collection,
                (0.72 + hedge_rng.uniform(-0.08, 0.12), 0.52 + hedge_rng.uniform(-0.06, 0.10), 0.49 + hedge_rng.uniform(-0.06, 0.14)),
                location=(lump_location.x, lump_location.y, height + hedge_rng.uniform(-0.08, 0.14)),
                subdivisions=2,
                material=hedge,
                parent=root,
            )
        if index in {2, 3, 9, 10, 14}:
            board_center = Vector((x, y, 0)) - radial * 0.48
            for board_index, offset in enumerate((-0.52, 0.0, 0.52), start=1):
                plank_center = board_center + tangent * offset
                add_cube(
                    f"Boundary_Repair_{index + 1:02d}_Plank_{board_index}",
                    collection,
                    (0.46, 0.16, 1.28 + 0.10 * board_index),
                    location=(plank_center.x, plank_center.y, 0.58 + 0.06 * board_index),
                    rotation=(0.02 * board_index, -0.06 + 0.025 * board_index, angle + hedge_rng.uniform(-0.09, 0.09)),
                    material=painted_wood if index % 2 else bare_wood,
                    parent=root,
                    bevel=0.045,
                )

    # Four hefty, chipped planters are both cover silhouettes and garden props.
    cover_positions = [(-5.2, -2.7), (5.1, -2.2), (-4.9, 3.5), (5.0, 3.8)]
    for index, (x, y) in enumerate(cover_positions, start=1):
        pot = add_tapered_between(
            f"Cover_Planter_{index:02d}_Body", collection,
            (x, y, 0.09), (x, y, 0.78), 0.70, 0.91,
            vertices=14, material=terracotta, parent=root, bevel=0.045,
        )
        distort_radial_mesh(pot, 0.055, 90 + index, vertical=0.018)
        add_torus(
            f"Cover_Planter_{index:02d}_Rim", collection, 0.86, 0.115,
            location=(x, y, 0.78), major_segments=18, minor_segments=7,
            material=terracotta, parent=root,
        )
        dirt_top = add_cylinder(
            f"Cover_Planter_{index:02d}_Soil", collection, 0.78, 0.07,
            vertices=16, location=(x, y, 0.79), material=soil, parent=root,
        )
        distort_radial_mesh(dirt_top, 0.07, 100 + index)
        offsets = ((-0.35, 0.04, 0.98), (0.30, 0.12, 1.10), (0.02, -0.20, 1.38), (0.16, 0.26, 1.52))
        for lump_index, (ox, oy, oz) in enumerate(offsets, start=1):
            shrub = add_ico_sphere(
                f"Cover_Shrub_{index:02d}_Lump_{lump_index}", collection,
                (0.68 + 0.05 * (lump_index % 2), 0.57 + 0.04 * ((index + lump_index) % 2), 0.52 + 0.07 * (lump_index % 3)),
                location=(x + ox, y + oy, oz), subdivisions=2,
                material=hedge, parent=root,
            )
            shrub.rotation_euler.z = (index * 0.31 + lump_index * 0.7)
        # A crooked marker stake gives each cover a clear front and more scale.
        add_cube(
            f"Cover_Planter_{index:02d}_Stake", collection, (0.12, 0.12, 1.18),
            location=(x + (-0.48 if index % 2 else 0.48), y + 0.10, 1.02),
            rotation=(0.12 if index % 2 else -0.10, 0.04, index * 0.22),
            material=bare_wood, parent=root, bevel=0.02,
        )
        collider = add_empty(
            f"COLLIDER_Cover_{index:02d}",
            collection,
            parent=root,
            location=(x, y, 0),
            display="CIRCLE",
            size=1.18,
            extras={"shape": "cylinder", "radius": 1.18, "height": 2.1},
        )
        collider.hide_render = True

    # A playful, jury-rigged garden-tech enemy portal anchors the far end. The
    # bent frame, exposed braces, and mismatched painted materials keep it from
    # reading as a clean sci-fi ring.
    portal = add_empty("PROP_EnemyPortal", collection, parent=root, location=(0, 10.45, 0))
    for side, x in (("Left", -1.10), ("Right", 1.02)):
        add_ico_sphere(
            f"Portal_Foot_{side}", collection, (0.58, 0.48, 0.31),
            location=(x, 0, 0.27), subdivisions=1, material=stone, parent=portal,
        )
    add_tapered_between(
        "Portal_Post_Left", collection, (-1.10, 0, 0.35), (-0.93, 0.03, 2.45),
        0.20, 0.16, vertices=10, material=painted_metal, parent=portal,
    )
    add_tapered_between(
        "Portal_Post_Right", collection, (1.02, 0, 0.34), (1.17, -0.02, 2.25),
        0.18, 0.22, vertices=10, material=painted_metal, parent=portal,
    )
    add_torus(
        "Portal_BentCoil", collection, 0.86, 0.15,
        location=(0.05, 0.02, 1.54), rotation=(math.pi / 2, 0.08, -0.05),
        scale=(1.05, 1.0, 1.17), major_segments=20, minor_segments=8,
        material=painted_metal, parent=portal,
    )
    add_uv_sphere(
        "Portal_EnergyMembrane", collection, (0.78, 0.075, 0.94),
        location=(0.05, 0.05, 1.54), segments=20, rings=12,
        material=portal_glow, parent=portal,
    )
    add_cube(
        "Portal_CrookedHeader", collection, (2.42, 0.28, 0.38),
        location=(0.02, 0.02, 2.55), rotation=(0.02, -0.06, -0.07),
        material=painted_wood, parent=portal, bevel=0.07,
    )
    for index, (start, end) in enumerate((
        ((-1.06, 0.06, 0.65), (-0.38, -0.02, 1.20)),
        ((1.05, 0.05, 0.55), (0.52, -0.03, 1.05)),
        ((-0.92, 0.08, 2.34), (-0.32, 0.02, 2.62)),
    ), start=1):
        add_tapered_between(
            f"Portal_Brace_{index}", collection, start, end,
            0.075, 0.045, vertices=8,
            material=bare_wood if index < 3 else painted_metal, parent=portal,
        )
    for index, (x, z) in enumerate(((-0.54, 2.58), (0.18, 2.54), (0.72, 2.50)), start=1):
        add_cylinder(
            f"Portal_Bulb_{index}", collection, 0.10, 0.12, vertices=10,
            location=(x, -0.17, z), rotation=(math.pi / 2, 0, 0),
            material=portal_glow if index != 2 else hedge, parent=portal,
        )

    # Chunky flowers and weeds punctuate the green rather than forming a neat,
    # symmetric decorative ring.
    flower_positions = [
        (-8.2, -6.2), (-7.1, 6.7), (7.8, -5.8), (8.0, 6.0),
        (-8.9, 0.8), (8.8, 0.1), (-2.7, 8.35), (3.1, -8.5),
    ]
    for index, position in enumerate(flower_positions, start=1):
        add_flower(
            collection,
            root,
            index,
            (*position, 0.10),
            hedge,
            flower_pink if index % 2 else flower_gold,
            flower_gold,
        )

    # A few broad dirt scuffs break up the perfect lawn surface without adding
    # collision or noisy micro-props to the central combat read.
    for index, (x, y, sx, sy) in enumerate((
        (-7.1, -1.1, 1.15, 0.55), (6.8, 1.3, 0.88, 0.48),
        (-3.0, -7.7, 0.70, 0.36), (3.4, 7.5, 0.82, 0.41),
    ), start=1):
        patch = add_cylinder(
            f"Lawn_DirtScuff_{index:02d}", collection, 0.68, 0.025,
            vertices=10, location=(x, y, 0.105),
            rotation=(0, 0, index * 0.63), scale_xy=(sx, sy),
            material=soil, parent=root,
        )
        distort_radial_mesh(patch, 0.18, 130 + index)

    add_empty(
        "COLLIDER_ArenaBoundary",
        collection,
        parent=root,
        display="CIRCLE",
        size=10.4,
        extras={"shape": "inside_circle", "radius": 10.4},
    )
    add_empty(
        "SPAWN_Player",
        collection,
        parent=root,
        location=(0, -6.8, 0.12),
        display="ARROWS",
        size=0.65,
        extras={"spawn_role": "player", "forward": [0, 1, 0]},
    )
    for index, angle in enumerate((0.15, 1.45, 2.75, 4.0, 5.2), start=1):
        add_empty(
            f"SPAWN_Enemy_{index:02d}",
            collection,
            parent=root,
            location=(math.cos(angle) * 8.8, math.sin(angle) * 8.8, 0.12),
            display="ARROWS",
            size=0.55,
            extras={"spawn_role": "enemy", "spawn_index": index},
        )

    return save_and_export_asset("garden-arena", root, animations=False)


def create_motion_action(
    obj: bpy.types.Object,
    name: str,
    frames: Sequence[tuple[int, Sequence[float], Sequence[float], Sequence[float]]],
) -> bpy.types.Action:
    if obj.animation_data is None:
        obj.animation_data_create()
    else:
        obj.animation_data.action = None
    obj.animation_data.action = bpy.data.actions.new(name=name)
    for frame, location, rotation, scale in frames:
        obj.location = location
        obj.rotation_mode = "XYZ"
        obj.rotation_euler = rotation
        obj.scale = scale
        obj.keyframe_insert(data_path="location", frame=frame, group="Motion")
        obj.keyframe_insert(data_path="rotation_euler", frame=frame, group="Motion")
        obj.keyframe_insert(data_path="scale", frame=frame, group="Motion")
    action = obj.animation_data.action
    action.name = name
    # Blender 5 actions expose curves through channel bags.  Iterating all
    # f-curves via the compatibility helper keeps interpolation smooth.
    for layer in action.layers:
        for strip in layer.strips:
            channelbag = strip.channelbag(obj.animation_data.action_slot)
            if not channelbag:
                continue
            for curve in channelbag.fcurves:
                for point in curve.keyframe_points:
                    point.interpolation = "BEZIER"
                    point.handle_left_type = "AUTO_CLAMPED"
                    point.handle_right_type = "AUTO_CLAMPED"
    obj.animation_data.action = None
    track = obj.animation_data.nla_tracks.new()
    track.name = name
    first_frame = min(frame for frame, *_ in frames)
    strip = track.strips.new(name, first_frame, action)
    strip.name = name
    strip.action_frame_start = first_frame
    strip.action_frame_end = max(frame for frame, *_ in frames)
    return action


def _build_garden_ghoul_legacy() -> tuple[bpy.types.Object, Path, Path]:
    collection = reset_scene("garden-ghoul")
    root = add_empty(
        "garden-ghoul",
        collection,
        extras={
            "asset_id": "garden-ghoul",
            "asset_kind": "enemy",
            "animation_rig": "armature-rigid-weights",
            "collision_radius": 0.72,
            "collision_height": 1.65,
        },
    )
    motion = add_empty("RIG_Motion", collection, parent=root, display="SPHERE", size=0.28)
    body_ctrl = add_empty("RIG_Body", collection, parent=motion, location=(0, 0, 0))
    face_ctrl = add_empty("RIG_Face", collection, parent=body_ctrl, location=(0, 0, 0))
    sprout_ctrl = add_empty("RIG_Sprout", collection, parent=body_ctrl, location=(0, 0, 0))

    body_material = create_material(
        "Ghoul_Body_Textured", "#704D87", "#C35A83", "#A978B2",
        style="spots", seed=53, roughness=0.72,
    )
    belly_material = create_material(
        "Ghoul_Belly_Textured", "#C690A7", "#865A82", "#E8B7B9",
        style="petal", seed=59, roughness=0.78,
    )
    leaf_material = create_material(
        "Ghoul_Sprout_Textured", "#3A8A66", "#215346", "#91CE70",
        style="leaf", seed=61, roughness=0.82,
    )
    eye_material = create_material(
        "Ghoul_Eye_Textured", "#EAF5D2", "#9CCB9A", "#FFFFFF",
        style="petal", seed=67, roughness=0.42,
    )
    pupil_material = create_material(
        "Ghoul_Pupil_Textured", "#1D2431", "#442F58", "#687181",
        style="stone", seed=71, roughness=0.38,
    )
    tooth_material = create_material(
        "Ghoul_Tooth_Textured", "#DCE9C8", "#9FB699", "#FFFFFF",
        style="stone", seed=73, roughness=0.52,
    )

    add_uv_sphere(
        "Ghoul_Body",
        collection,
        (0.82, 0.72, 0.78),
        location=(0, 0, 0.80),
        segments=24,
        rings=14,
        material=body_material,
        parent=body_ctrl,
    )
    # Three grounded lobes make the silhouette clearly slime-like without
    # borrowing a pre-existing character design.
    for index, (x, y, scale) in enumerate(((-0.46, 0.08, 0.42), (0.45, 0.10, 0.40), (0, 0.27, 0.45)), start=1):
        add_uv_sphere(
            f"Ghoul_BaseLobe_{index}",
            collection,
            (scale, scale * 0.86, scale * 0.50),
            location=(x, y, 0.30),
            segments=16,
            rings=9,
            material=body_material,
            parent=body_ctrl,
        )
    add_uv_sphere(
        "Ghoul_BellyPatch",
        collection,
        (0.48, 0.075, 0.44),
        location=(0, -0.675, 0.74),
        segments=18,
        rings=10,
        material=belly_material,
        parent=body_ctrl,
    )

    for side, x in (("Left", -0.27), ("Right", 0.27)):
        add_uv_sphere(
            f"Ghoul_Eye_{side}",
            collection,
            (0.22, 0.11, 0.25),
            location=(x, -0.66, 1.01),
            segments=18,
            rings=10,
            material=eye_material,
            parent=face_ctrl,
        )
        pupil = add_uv_sphere(
            f"Ghoul_Pupil_{side}",
            collection,
            (0.09, 0.045, 0.13),
            location=(x + (0.025 if side == "Left" else -0.025), -0.765, 1.00),
            segments=14,
            rings=8,
            material=pupil_material,
            parent=face_ctrl,
        )
        pupil["look_axis"] = "local -Y"

    add_cube(
        "Ghoul_Mouth",
        collection,
        (0.30, 0.055, 0.10),
        location=(0, -0.745, 0.61),
        material=pupil_material,
        parent=face_ctrl,
        bevel=0.045,
    )
    for index, x in enumerate((-0.085, 0.09), start=1):
        add_cone_between(
            f"Ghoul_Tooth_{index}",
            collection,
            (x, -0.785, 0.64),
            (x, -0.80, 0.49),
            0.055,
            vertices=8,
            material=tooth_material,
            parent=face_ctrl,
        )

    add_cylinder(
        "Ghoul_SproutStem",
        collection,
        0.065,
        0.42,
        vertices=10,
        location=(0, 0, 1.67),
        material=leaf_material,
        parent=sprout_ctrl,
    )
    for index, (angle, x) in enumerate(((-0.68, -0.22), (0.64, 0.22)), start=1):
        leaf = add_uv_sphere(
            f"Ghoul_SproutLeaf_{index}",
            collection,
            (0.34, 0.12, 0.16),
            location=(x, 0, 1.88),
            segments=16,
            rings=8,
            material=leaf_material,
            parent=sprout_ctrl,
        )
        leaf.rotation_euler.y = angle

    add_empty(
        "COLLIDER_Ghoul",
        collection,
        parent=root,
        location=(0, 0, 0.82),
        display="CIRCLE",
        size=0.72,
        extras={"shape": "capsule", "radius": 0.72, "height": 1.65},
    )
    add_empty(
        "TARGET_GhoulCenter",
        collection,
        parent=motion,
        location=(0, 0, 0.92),
        display="PLAIN_AXES",
        size=0.22,
        extras={"target_role": "damage_center"},
    )

    create_motion_action(
        motion,
        "Ghoul_Idle",
        (
            (1, (0, 0, 0), (0, 0, 0), (1.00, 1.00, 1.00)),
            (16, (0, 0, 0.035), (0.015, 0, -0.018), (1.025, 1.025, 0.975)),
            (31, (0, 0, 0.07), (-0.012, 0, 0.016), (0.985, 0.985, 1.035)),
            (46, (0, 0, 0.032), (0.012, 0, -0.012), (1.018, 1.018, 0.985)),
            (61, (0, 0, 0), (0, 0, 0), (1.00, 1.00, 1.00)),
        ),
    )
    create_motion_action(
        motion,
        "Ghoul_Hop",
        (
            (1, (0, 0, 0), (0, 0, 0), (1.00, 1.00, 1.00)),
            (5, (0, 0, -0.04), (0.05, 0, 0), (1.12, 1.12, 0.82)),
            (12, (0, 0, 0.62), (-0.08, 0, 0.04), (0.92, 0.92, 1.10)),
            (18, (0, 0, 0.80), (0.03, 0, -0.035), (0.96, 0.96, 1.05)),
            (25, (0, 0, 0), (0, 0, 0), (1.16, 1.16, 0.78)),
            (32, (0, 0, 0.08), (-0.02, 0, 0), (0.97, 0.97, 1.04)),
            (39, (0, 0, 0), (0, 0, 0), (1.00, 1.00, 1.00)),
        ),
    )
    create_motion_action(
        motion,
        "Ghoul_Hit",
        (
            (1, (0, 0, 0), (0, 0, 0), (1.00, 1.00, 1.00)),
            (4, (0, 0.16, 0.08), (-0.16, 0.05, -0.16), (1.14, 0.88, 0.90)),
            (9, (0, -0.10, 0.02), (0.09, -0.04, 0.12), (0.91, 1.08, 1.04)),
            (15, (0, 0.04, 0), (-0.03, 0, -0.035), (1.03, 0.98, 0.99)),
            (21, (0, 0, 0), (0, 0, 0), (1.00, 1.00, 1.00)),
        ),
    )
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 61
    bpy.context.scene.frame_set(1)
    return save_and_export_asset("garden-ghoul", root, animations=True)


def create_rigid_armature(
    name: str,
    collection: bpy.types.Collection,
    parent: bpy.types.Object,
    bone_specs: Sequence[tuple[str, Sequence[float], Sequence[float], str | None]],
) -> bpy.types.Object:
    armature_data = bpy.data.armatures.new(f"{name}_Data")
    armature = bpy.data.objects.new(name, armature_data)
    collection.objects.link(armature)
    armature.parent = parent
    armature.show_in_front = True
    armature["rig_kind"] = "rigid-piece skeletal rig"
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    created = {}
    for bone_name, head, tail, parent_name in bone_specs:
        bone = armature_data.edit_bones.new(bone_name)
        bone.head = head
        bone.tail = tail
        bone.parent = created.get(parent_name)
        bone.use_connect = False
        created[bone_name] = bone
    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    return armature


def rigid_bind_object(
    obj: bpy.types.Object,
    armature: bpy.types.Object,
    bone_name: str,
) -> None:
    group = obj.vertex_groups.get(bone_name) or obj.vertex_groups.new(name=bone_name)
    group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
    modifier = obj.modifiers.new(name="Rigid_Armature", type="ARMATURE")
    modifier.object = armature
    modifier.use_deform_preserve_volume = False


def create_bone_action(
    armature: bpy.types.Object,
    name: str,
    frames: Sequence[tuple[int, dict[str, tuple[Sequence[float], Sequence[float], Sequence[float]]]]],
) -> bpy.types.Action:
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = bpy.data.actions.new(name=name)
    for frame, state in frames:
        for bone in armature.pose.bones:
            location, rotation, scale = state.get(
                bone.name,
                ((0, 0, 0), (0, 0, 0), (1, 1, 1)),
            )
            bone.location = location
            bone.rotation_euler = rotation
            bone.scale = scale
            bone.keyframe_insert(data_path="location", frame=frame, group=bone.name)
            bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone.name)
            bone.keyframe_insert(data_path="scale", frame=frame, group=bone.name)
    action = armature.animation_data.action
    action.name = name
    for layer in action.layers:
        for strip in layer.strips:
            channelbag = strip.channelbag(armature.animation_data.action_slot)
            if not channelbag:
                continue
            for curve in channelbag.fcurves:
                for key in curve.keyframe_points:
                    key.interpolation = "BEZIER"
                    key.handle_left_type = "AUTO_CLAMPED"
                    key.handle_right_type = "AUTO_CLAMPED"
    armature.animation_data.action = None
    track = armature.animation_data.nla_tracks.new()
    track.name = name
    first = min(frame for frame, _ in frames)
    last = max(frame for frame, _ in frames)
    nla_strip = track.strips.new(name, first, action)
    nla_strip.name = name
    nla_strip.action_frame_start = first
    nla_strip.action_frame_end = last
    action["loop_hint"] = name in {"Ghoul_Idle", "Ghoul_Hop"}
    return action


def build_garden_ghoul() -> tuple[bpy.types.Object, Path, Path]:
    collection = reset_scene("garden-ghoul")
    root = add_empty(
        "garden-ghoul",
        collection,
        extras={
            "asset_id": "garden-ghoul",
            "asset_kind": "enemy",
            "animation_rig": "armature-rigid-weights",
            "collision_radius": 0.72,
            "collision_height": 1.65,
        },
    )
    motion = add_empty("RIG_Motion", collection, parent=root, display="SPHERE", size=0.28)
    body_ctrl = add_empty("RIG_Body", collection, parent=motion)
    face_ctrl = add_empty("RIG_Face", collection, parent=body_ctrl)
    sprout_ctrl = add_empty("RIG_Sprout", collection, parent=body_ctrl)
    left_arm_ctrl = add_empty("RIG_Arm_Left", collection, parent=body_ctrl)
    right_arm_ctrl = add_empty("RIG_Arm_Right", collection, parent=body_ctrl)

    skin = create_material(
        "Ghoul_SicklySkin_PBR", "#789545", "#354D2D", "#B1C85D",
        style="skin", seed=53, roughness=0.74, normal_strength=0.58,
    )
    bruised_skin = create_material(
        "Ghoul_BruisedSkin_PBR", "#596D3A", "#3C3540", "#8FA551",
        style="skin", seed=55, roughness=0.78, normal_strength=0.62,
    )
    vest = create_material(
        "Ghoul_WornVest_PBR", "#5A3D79", "#2F2945", "#9B638E",
        style="fabric", seed=57, roughness=0.82, normal_strength=0.68,
    )
    shirt = create_material(
        "Ghoul_GardeningShirt_PBR", "#C47B27", "#674128", "#E9B33F",
        style="fabric", seed=59, roughness=0.86, normal_strength=0.64,
    )
    trousers = create_material(
        "Ghoul_Trousers_PBR", "#334C57", "#202A31", "#59726A",
        style="fabric", seed=61, roughness=0.87, normal_strength=0.65,
    )
    boot = create_material(
        "Ghoul_MuddyBoots_PBR", "#50372B", "#241F1D", "#815338",
        style="wood", seed=63, roughness=0.91, normal_strength=0.70,
    )
    pot_material = create_material(
        "Ghoul_CrackedPot_PBR", "#A94C2D", "#562E29", "#DC7A43",
        style="terracotta", seed=65, roughness=0.83, normal_strength=0.72,
    )
    leaf_material = create_material(
        "Ghoul_Sprout_PBR", "#318540", "#173D2D", "#80C746",
        style="leaf", seed=67, roughness=0.76, normal_strength=0.64,
    )
    eye_material = create_material(
        "Ghoul_Eye_PBR", "#DEDFAF", "#8B9A71", "#FFF5D2",
        style="skin", seed=69, roughness=0.49, normal_strength=0.20,
    )
    pupil_material = create_material(
        "Ghoul_Pupil_PBR", "#17212B", "#341E3B", "#52615A",
        style="stone", seed=71, roughness=0.43, normal_strength=0.24,
    )
    mouth_material = create_material(
        "Ghoul_Mouth_PBR", "#2A1722", "#130F17", "#6A2D35",
        style="skin", seed=73, roughness=0.62, normal_strength=0.26,
    )
    tooth_material = create_material(
        "Ghoul_Teeth_PBR", "#C8C496", "#77795E", "#EEE4B2",
        style="teeth", seed=75, roughness=0.58, normal_strength=0.30,
    )
    buckle_material = create_material(
        "Ghoul_Buckle_PBR", "#B08024", "#4A4D42", "#E2BB4D",
        style="painted_metal", seed=77, roughness=0.56, metallic=0.34,
        normal_strength=0.42,
    )

    # Stubby, mismatched feet make a heavy, off-balance base.
    for side, x, y, scale, yaw in (
        ("Left", -0.34, -0.15, (0.34, 0.51, 0.22), -0.12),
        ("Right", 0.38, -0.08, (0.38, 0.57, 0.24), 0.16),
    ):
        shoe = add_uv_sphere(
            f"Ghoul_Boot_{side}", collection, scale, location=(x, y, 0.22),
            segments=16, rings=9, material=boot, parent=body_ctrl,
        )
        shoe.rotation_euler.z = yaw
    for side, start, end, radii in (
        ("Left", (-0.30, 0, 0.30), (-0.25, 0.02, 0.70), (0.20, 0.17)),
        ("Right", (0.35, 0.02, 0.31), (0.29, 0.04, 0.68), (0.22, 0.18)),
    ):
        add_tapered_between(
            f"Ghoul_Leg_{side}", collection, start, end, *radii,
            vertices=10, material=trousers, parent=body_ctrl,
        )

    torso = add_uv_sphere(
        "Ghoul_HunchedTorso", collection, (0.67, 0.48, 0.73),
        location=(0.04, 0.04, 1.03), segments=22, rings=13,
        material=shirt, parent=body_ctrl,
    )
    torso.rotation_euler.x = 0.13
    add_uv_sphere(
        "Ghoul_VestFront", collection, (0.55, 0.095, 0.56),
        location=(0.03, -0.445, 1.07), segments=18, rings=10,
        material=vest, parent=body_ctrl,
    )
    add_cube(
        "Ghoul_VestPatch", collection, (0.27, 0.045, 0.22),
        location=(-0.27, -0.548, 1.00), rotation=(0.02, 0.08, -0.13),
        material=shirt, parent=body_ctrl, bevel=0.035,
    )
    add_torus(
        "Ghoul_Belt", collection, 0.48, 0.075, location=(0.04, 0.02, 0.68),
        scale=(1.17, 0.88, 1), major_segments=18, minor_segments=7,
        material=boot, parent=body_ctrl,
    )
    add_cube(
        "Ghoul_BeltBuckle", collection, (0.25, 0.08, 0.21),
        location=(0.08, -0.49, 0.70), rotation=(0, 0.03, 0.06),
        material=buckle_material, parent=body_ctrl, bevel=0.035,
    )
    add_tapered_between(
        "Ghoul_Neck", collection, (0.07, -0.02, 1.43), (0.04, -0.08, 1.66),
        0.24, 0.30, vertices=12, material=bruised_skin, parent=body_ctrl,
    )

    # The huge crooked head, jutting jaw, and mismatched eyes carry the comic
    # menace at gameplay distance without reverting to a cute spherical blob.
    head = add_uv_sphere(
        "Ghoul_CrookedHead", collection, (0.63, 0.50, 0.59),
        location=(0.04, -0.13, 1.86), segments=24, rings=14,
        material=skin, parent=body_ctrl,
    )
    head.rotation_euler = (0.06, -0.10, -0.045)
    jaw = add_uv_sphere(
        "Ghoul_ProtrudingJaw", collection, (0.53, 0.36, 0.27),
        location=(0.10, -0.43, 1.58), segments=20, rings=11,
        material=bruised_skin, parent=face_ctrl,
    )
    jaw.rotation_euler.z = 0.06
    add_uv_sphere(
        "Ghoul_Nose", collection, (0.16, 0.26, 0.18),
        location=(0.13, -0.62, 1.82), segments=16, rings=9,
        material=bruised_skin, parent=face_ctrl,
    ).rotation_euler.z = -0.16
    for side, x, z, scale in (
        ("Left", -0.58, 1.84, (0.15, 0.10, 0.21)),
        ("Right", 0.66, 1.78, (0.12, 0.085, 0.17)),
    ):
        add_uv_sphere(
            f"Ghoul_Ear_{side}", collection, scale, location=(x, -0.10, z),
            segments=14, rings=8, material=bruised_skin, parent=face_ctrl,
        )

    for side, x, z, scale, pupil_shift in (
        ("Left", -0.25, 1.98, (0.225, 0.115, 0.245), -0.015),
        ("Right", 0.29, 1.91, (0.155, 0.090, 0.175), 0.020),
    ):
        add_uv_sphere(
            f"Ghoul_Eye_{side}", collection, scale, location=(x, -0.58, z),
            segments=18, rings=10, material=eye_material, parent=face_ctrl,
        )
        pupil = add_uv_sphere(
            f"Ghoul_Pupil_{side}", collection,
            (scale[0] * 0.42, 0.048, scale[2] * 0.50),
            location=(x + pupil_shift, -0.684, z - 0.015),
            segments=14, rings=8, material=pupil_material, parent=face_ctrl,
        )
        pupil["look_axis"] = "local -Y"
    for side, x, z, yaw in (
        ("Left", -0.25, 2.145, -0.18),
        ("Right", 0.29, 2.045, 0.24),
    ):
        brow = add_uv_sphere(
            f"Ghoul_HeavyBrow_{side}", collection,
            (0.27 if side == "Left" else 0.20, 0.075, 0.085),
            location=(x, -0.642, z), segments=14, rings=8,
            material=bruised_skin, parent=face_ctrl,
        )
        brow.rotation_euler.z = yaw
    add_uv_sphere(
        "Ghoul_MouthCavity", collection, (0.37, 0.050, 0.145),
        location=(0.10, -0.765, 1.51), segments=18, rings=9,
        material=mouth_material, parent=face_ctrl,
    )
    for index, (x, start_z, end_z, radius) in enumerate((
        (-0.15, 1.61, 1.47, 0.068),
        (0.04, 1.60, 1.43, 0.055),
        (0.23, 1.42, 1.54, 0.066),
    ), start=1):
        add_cone_between(
            f"Ghoul_Tooth_{index}", collection,
            (x, -0.815, start_z), (x + (0.018 if index == 2 else -0.01), -0.825, end_z),
            radius, vertices=8, material=tooth_material, parent=face_ctrl,
        )

    # Unequal arms and oversized hands create the shambling silhouette.
    arm_specs = (
        ("Left", left_arm_ctrl, (-0.55, -0.02, 1.25), (-0.88, -0.30, 0.63), (-0.91, -0.34, 0.56), 0.29, -1),
        ("Right", right_arm_ctrl, (0.61, -0.01, 1.22), (1.02, -0.37, 0.84), (1.06, -0.42, 0.79), 0.31, 1),
    )
    for side, ctrl, shoulder, wrist, hand, shoulder_size, direction in arm_specs:
        add_uv_sphere(
            f"Ghoul_Shoulder_{side}", collection,
            (shoulder_size, shoulder_size * 0.94, shoulder_size * 1.03),
            location=shoulder, segments=14, rings=8,
            material=vest if side == "Left" else shirt, parent=ctrl,
        )
        add_tapered_between(
            f"Ghoul_Arm_{side}", collection, shoulder, wrist,
            0.22 if side == "Right" else 0.21, 0.15,
            vertices=11, material=skin, parent=ctrl,
        )
        add_uv_sphere(
            f"Ghoul_Hand_{side}", collection,
            (0.28, 0.25, 0.24) if side == "Right" else (0.25, 0.22, 0.22),
            location=hand, segments=14, rings=8,
            material=bruised_skin, parent=ctrl,
        )
        for finger_index in range(3):
            spread = (finger_index - 1) * 0.11
            add_tapered_between(
                f"Ghoul_Finger_{side}_{finger_index + 1}", collection,
                (hand[0] + spread, hand[1], hand[2]),
                (hand[0] + spread + direction * 0.04, hand[1] - 0.12, hand[2] - 0.18 - 0.025 * finger_index),
                0.050, 0.027, vertices=7, material=bruised_skin, parent=ctrl,
            )

    # The cracked flowerpot helmet is deliberately tilted and off-centre.
    pot = add_tapered_between(
        "Ghoul_FlowerpotHelmet", collection,
        (-0.06, 0.01, 2.19), (-0.06, 0.01, 2.57), 0.34, 0.46,
        vertices=13, material=pot_material, parent=sprout_ctrl,
    )
    pot.rotation_mode = "XYZ"
    pot.rotation_euler = (0.055, -0.10, 0.065)
    add_torus(
        "Ghoul_FlowerpotRim", collection, 0.43, 0.085,
        location=(-0.06, 0.01, 2.56), rotation=(0.055, -0.10, 0.065),
        major_segments=18, minor_segments=7, material=pot_material, parent=sprout_ctrl,
    )
    add_tapered_between(
        "Ghoul_PotCrack", collection, (-0.32, -0.35, 2.48), (-0.18, -0.39, 2.31),
        0.025, 0.010, vertices=6, material=mouth_material, parent=sprout_ctrl,
    )
    add_tapered_between(
        "Ghoul_SproutStem", collection, (-0.07, 0.01, 2.55), (-0.01, 0, 2.92),
        0.065, 0.045, vertices=10, material=leaf_material, parent=sprout_ctrl,
    )
    for index, (x, y, z, scale, angle) in enumerate((
        (-0.24, 0, 2.90, (0.31, 0.10, 0.15), -0.58),
        (0.20, 0.01, 2.84, (0.28, 0.095, 0.14), 0.70),
        (0.05, 0.02, 3.04, (0.22, 0.085, 0.12), 0.18),
    ), start=1):
        leaf = add_uv_sphere(
            f"Ghoul_SproutLeaf_{index}", collection, scale,
            location=(x, y, z), segments=16, rings=8,
            material=leaf_material, parent=sprout_ctrl,
        )
        leaf.rotation_euler.y = angle

    ghoul_bones = (
        ("Root", (0, 0, 0), (0, 0, 0.42), None),
        ("Body", (0.04, 0.02, 0.55), (0.04, 0.02, 1.48), "Root"),
        ("Head", (0.04, -0.12, 1.45), (0.04, -0.12, 2.28), "Body"),
        ("Arm_L", (-0.55, -0.02, 1.25), (-0.88, -0.30, 0.63), "Body"),
        ("Arm_R", (0.61, -0.01, 1.22), (1.02, -0.37, 0.84), "Body"),
        ("Leg_L", (-0.25, 0.02, 0.70), (-0.34, -0.15, 0.22), "Root"),
        ("Leg_R", (0.29, 0.04, 0.68), (0.38, -0.08, 0.24), "Root"),
        ("Sprout", (-0.06, 0.01, 2.18), (-0.01, 0, 3.05), "Head"),
    )
    armature = create_rigid_armature(
        "GardenGhoul_Armature", collection, motion, ghoul_bones,
    )
    armature["asset_id"] = "garden-ghoul"

    def ghoul_bone_for(name: str) -> str:
        if name.startswith(("Ghoul_Sprout", "Ghoul_Flowerpot", "Ghoul_Pot")):
            return "Sprout"
        if name.startswith(("Ghoul_Shoulder_Left", "Ghoul_Arm_Left", "Ghoul_Hand_Left", "Ghoul_Finger_Left")):
            return "Arm_L"
        if name.startswith(("Ghoul_Shoulder_Right", "Ghoul_Arm_Right", "Ghoul_Hand_Right", "Ghoul_Finger_Right")):
            return "Arm_R"
        if name.startswith(("Ghoul_Boot_Left", "Ghoul_Leg_Left")):
            return "Leg_L"
        if name.startswith(("Ghoul_Boot_Right", "Ghoul_Leg_Right")):
            return "Leg_R"
        if name.startswith((
            "Ghoul_CrookedHead", "Ghoul_ProtrudingJaw", "Ghoul_Nose",
            "Ghoul_Ear", "Ghoul_Eye", "Ghoul_Pupil", "Ghoul_HeavyBrow",
            "Ghoul_Mouth", "Ghoul_Tooth", "Ghoul_Neck",
        )):
            return "Head"
        return "Body"

    for mesh_obj in [obj for obj in collection.all_objects if obj.type == "MESH"]:
        rigid_bind_object(mesh_obj, armature, ghoul_bone_for(mesh_obj.name))

    add_empty(
        "COLLIDER_Ghoul", collection, parent=root, location=(0, 0, 0.82),
        display="CIRCLE", size=0.72,
        extras={"shape": "capsule", "radius": 0.72, "height": 1.65},
    )
    add_empty(
        "TARGET_GhoulCenter", collection, parent=motion, location=(0, 0, 0.92),
        display="PLAIN_AXES", size=0.22, extras={"target_role": "damage_center"},
    )

    idle_frames = []
    for frame, phase in ((1, 0), (16, math.pi / 2), (31, math.pi), (46, math.pi * 1.5), (61, math.tau)):
        idle_frames.append((frame, {
            "Root": ((0, 0, 0.028 * math.sin(phase)), (0, 0, 0.012 * math.sin(phase)), (1, 1, 1)),
            "Body": ((0, 0, 0), (0.018 * math.sin(phase), 0, -0.025 * math.sin(phase)), (1, 1, 1)),
            "Head": ((0, 0, 0), (-0.020 * math.sin(phase), 0.012 * math.cos(phase), 0.028 * math.sin(phase)), (1, 1, 1)),
            "Arm_L": ((0, 0, 0), (0.032 * math.sin(phase), 0, -0.040 * math.cos(phase)), (1, 1, 1)),
            "Arm_R": ((0, 0, 0), (-0.032 * math.sin(phase), 0, 0.040 * math.cos(phase)), (1, 1, 1)),
            "Sprout": ((0, 0, 0), (0.045 * math.sin(phase + 0.4), 0, -0.055 * math.sin(phase)), (1, 1, 1)),
        }))
    create_bone_action(armature, "Ghoul_Idle", idle_frames)
    create_bone_action(
        armature, "Ghoul_Hop",
        (
            (1, {}),
            (5, {
                "Root": ((0, 0.02, -0.035), (0.07, 0, -0.03), (1.04, 1.03, 0.93)),
                "Leg_L": ((0, 0, 0), (0.11, 0, -0.08), (1, 1, 1)),
                "Leg_R": ((0, 0, 0), (0.09, 0, 0.08), (1, 1, 1)),
            }),
            (12, {
                "Root": ((0, -0.03, 0.46), (-0.09, 0.02, 0.05), (0.98, 0.98, 1.03)),
                "Arm_L": ((0, 0, 0), (-0.15, 0, -0.14), (1, 1, 1)),
                "Arm_R": ((0, 0, 0), (0.13, 0, 0.16), (1, 1, 1)),
                "Leg_L": ((0, 0, 0), (-0.18, 0, 0.08), (1, 1, 1)),
                "Leg_R": ((0, 0, 0), (-0.16, 0, -0.08), (1, 1, 1)),
                "Sprout": ((0, 0, 0), (0.13, 0, -0.10), (1, 1, 1)),
            }),
            (18, {
                "Root": ((0, -0.01, 0.63), (0.04, -0.015, -0.04), (1, 1, 1)),
                "Head": ((0, 0, 0), (-0.08, 0, 0.04), (1, 1, 1)),
                "Sprout": ((0, 0, 0), (-0.10, 0, 0.08), (1, 1, 1)),
            }),
            (25, {"Root": ((0, 0.03, 0), (0.065, 0, 0.02), (1.06, 1.04, 0.91))}),
            (32, {"Root": ((0, -0.01, 0.05), (-0.025, 0, -0.01), (0.99, 0.99, 1.02))}),
            (39, {}),
        ),
    )
    create_bone_action(
        armature, "Ghoul_Hit",
        (
            (1, {}),
            (4, {
                "Root": ((0, 0.13, 0.055), (-0.14, 0.06, -0.18), (1.06, 0.94, 0.95)),
                "Head": ((0, 0, 0), (0.18, -0.08, 0.16), (1, 1, 1)),
                "Arm_L": ((0, 0, 0), (0.16, 0, -0.22), (1, 1, 1)),
                "Arm_R": ((0, 0, 0), (-0.12, 0, 0.20), (1, 1, 1)),
                "Sprout": ((0, 0, 0), (-0.20, 0, 0.16), (1, 1, 1)),
            }),
            (9, {
                "Root": ((0, -0.08, 0.018), (0.085, -0.045, 0.13), (0.96, 1.035, 1.02)),
                "Head": ((0, 0, 0), (-0.11, 0.04, -0.10), (1, 1, 1)),
                "Sprout": ((0, 0, 0), (0.15, 0, -0.12), (1, 1, 1)),
            }),
            (15, {"Root": ((0, 0.03, 0), (-0.028, 0, -0.04), (1.02, 0.985, 0.995))}),
            (21, {}),
        ),
    )
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 61
    bpy.context.scene.frame_set(1)
    return save_and_export_asset("garden-ghoul", root, animations=True)


def build_ice_projectile() -> tuple[bpy.types.Object, Path, Path]:
    collection = reset_scene("ice-pea-projectile")
    root = add_empty(
        "ice-pea-projectile",
        collection,
        extras={
            "asset_id": "ice-pea-projectile",
            "asset_kind": "projectile",
            "front_axis": "-Y in Blender, +Z after glTF export",
            "collision_radius": 0.24,
        },
    )
    visual = add_empty("Projectile_Visual", collection, parent=root)
    ice = create_material(
        "Projectile_FrozenPea_PBR", "#0C6593", "#0B3158", "#36AFBF",
        style="ice", seed=83, roughness=0.38, metallic=0.02,
        emission_strength=0.055, transmission=0.015, normal_strength=0.58,
    )
    deep_ice = create_material(
        "Projectile_DeepIce_PBR", "#0A3D69", "#081F43", "#237FA9",
        style="ice", seed=89, roughness=0.46, metallic=0.02,
        emission_strength=0.025, normal_strength=0.64,
    )
    frost = create_material(
        "Projectile_Frost_PBR", "#3C93A3", "#226A8A", "#86D1C9",
        style="ice", seed=97, roughness=0.58, emission_strength=0.035,
        normal_strength=0.72,
    )

    # A frozen pea first, projectile second: the squat core and frosted face
    # avoid the clean spear/gem silhouette while the rear shards imply speed.
    core = add_ico_sphere(
        "Projectile_FrozenPeaCore",
        collection,
        (0.34, 0.36, 0.33),
        location=(0.015, -0.035, 0),
        subdivisions=3,
        material=ice,
        parent=visual,
    )
    core.rotation_euler = (0.08, -0.06, 0.11)
    # Matte frost collects in three uneven plates rather than a pristine cap.
    # The saturated blue pea therefore stays dominant from the firing camera.
    for index, (location, scale, rotation) in enumerate((
        ((-0.16, -0.28, 0.20), (0.15, 0.060, 0.105), (0.20, -0.16, -0.25)),
        ((0.21, -0.20, 0.15), (0.12, 0.052, 0.085), (-0.12, 0.18, 0.32)),
        ((-0.08, -0.25, -0.24), (0.13, 0.050, 0.090), (0.16, 0.08, 0.12)),
    ), start=1):
        frost_plate = add_ico_sphere(
            f"Projectile_FrostPlate_{index}", collection, scale,
            location=location, subdivisions=2, material=frost, parent=visual,
        )
        frost_plate.rotation_euler = rotation

    shard_specs = (
        (0.15, 0.38, 0.05, 0.145),
        (1.40, 0.32, -0.02, 0.125),
        (2.72, 0.41, 0.02, 0.150),
        (4.28, 0.29, -0.04, 0.115),
        (5.30, 0.35, 0.00, 0.130),
    )
    for index, (angle, length, y_offset, radius) in enumerate(shard_specs, start=1):
        radial = Vector((math.cos(angle), 0, math.sin(angle)))
        start = radial * 0.19 + Vector((0.015, 0.16 + y_offset, 0))
        # All points trail rearward (+Y); the radial offset keeps the cluster
        # irregular and readable as splintered frost from every camera angle.
        end = radial * (0.24 + length * 0.24) + Vector((0.015, 0.23 + length, 0))
        add_cone_between(
            f"Projectile_RearIceShard_{index}", collection, start, end, radius,
            vertices=7 + index % 2,
            material=deep_ice if index % 2 else frost,
            parent=visual,
        )
    for index, (start, end) in enumerate((
        ((-0.24, -0.17, 0.16), (-0.10, -0.25, 0.25)),
        ((0.20, -0.10, -0.20), (0.29, 0.01, -0.27)),
        ((-0.20, 0.01, -0.19), (-0.29, 0.16, -0.25)),
    ), start=1):
        add_tapered_between(
            f"Projectile_SurfaceFracture_{index}", collection, start, end,
            0.022, 0.008, vertices=6, material=frost, parent=visual,
        )
    add_empty(
        "FX_TrailAnchor",
        collection,
        parent=root,
        location=(0, 0.78, 0),
        display="SPHERE",
        size=0.10,
        extras={"fx_role": "trail_origin"},
    )
    add_empty(
        "COLLIDER_Projectile",
        collection,
        parent=root,
        display="CIRCLE",
        size=0.24,
        extras={"shape": "sphere", "radius": 0.24},
    )
    return save_and_export_asset("ice-pea-projectile", root, animations=False)


def save_and_export_asset(
    asset_id: str,
    root: bpy.types.Object,
    *,
    animations: bool,
) -> tuple[bpy.types.Object, Path, Path]:
    MASTER_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    blend_path = MASTER_DIR / f"{asset_id}.blend"
    glb_path = OUTPUT_DIR / f"{asset_id}.glb"
    for image in bpy.data.images:
        if image.source == "GENERATED" and not image.packed_file:
            image.pack()
    bpy.ops.wm.save_as_mainfile(filepath=os.fspath(blend_path), check_existing=False)
    selected = select_hierarchy(root)
    if any(obj.type in {"CAMERA", "LIGHT"} for obj in selected):
        raise RuntimeError(f"{asset_id}: runtime hierarchy unexpectedly contains a camera or light")
    export_options = dict(
        filepath=os.fspath(glb_path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_apply=False,
        export_animations=animations,
    )
    if animations:
        export_options.update(
            export_animation_mode="NLA_TRACKS",
            export_nla_strips=True,
            export_force_sampling=True,
            export_frame_step=1,
            export_optimize_animation_size=True,
        )
    bpy.ops.export_scene.gltf(**export_options)
    if not glb_path.is_file() or glb_path.stat().st_size < 256:
        raise RuntimeError(f"{asset_id}: Blender did not produce a valid-size GLB")
    print(
        f"BUILT {asset_id}: {len(selected)} objects, "
        f"{glb_path.stat().st_size} bytes -> {glb_path}"
    )
    return root, blend_path, glb_path


def main() -> None:
    MASTER_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    build_garden_arena()
    build_garden_ghoul()
    build_ice_projectile()
    print(f"Shooter masters: {MASTER_DIR}")
    print(f"Shooter GLBs: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
