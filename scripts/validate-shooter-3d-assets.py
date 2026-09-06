#!/usr/bin/env python3
"""Validate and optionally render the shooter prototype's runtime GLB pack.

Examples:

    blender --background --factory-startup \
      --python scripts/validate-shooter-3d-assets.py

    blender --background --factory-startup \
      --python scripts/validate-shooter-3d-assets.py -- \
      --render-dir /tmp/shooter-3d-review
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import struct
import sys

import bpy
from mathutils import Vector


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "assets" / "generated" / "3d" / "shooter"
MASTER_DIR = PROJECT_ROOT / "assets" / "original-masters" / "3d" / "shooter"

ASSET_RULES = {
    "ice-peashooter": {
        "roots": {
            "IcePeashooter_ROOT",
            "IcePeashooter_ROOT.001",
            "IcePeashooter_ROOT.002",
            "IcePeashooter_ROOT.003",
        },
        "required_nodes": {
            "CTRL_Head",
            "CTRL_Muzzle",
            "Leaf_Front.001",
            "Leaf_Front.002",
            "Leaf_Front.003",
            "IcePeashooter_Armature",
            "Root",
            "LeafBase",
            "Stem",
            "Head",
            "Muzzle",
            "Arm_L",
            "Arm_R",
            "Leaf_Front",
        },
        "animations": {"Idle", "Move", "Shoot", "Hit"},
        "min_meshes": 50,
        "min_images": 30,
        "min_skins": 1,
        "master_required": True,
    },
    "garden-arena": {
        "roots": {"garden-arena"},
        "required_nodes": {
            "COLLIDER_ArenaBoundary",
            "COLLIDER_Cover_01",
            "SPAWN_Player",
            "SPAWN_Enemy_01",
            "SPAWN_Enemy_05",
        },
        "animations": set(),
        "min_meshes": 80,
        "min_images": 7,
        "min_skins": 0,
        "master_required": True,
    },
    "garden-ghoul": {
        "roots": {"garden-ghoul"},
        "required_nodes": {
            "RIG_Motion",
            "RIG_Body",
            "RIG_Face",
            "RIG_Sprout",
            "COLLIDER_Ghoul",
            "TARGET_GhoulCenter",
            "GardenGhoul_Armature",
            "Root",
            "Body",
            "Head",
            "Arm_L",
            "Arm_R",
            "Leg_L",
            "Leg_R",
            "Sprout",
        },
        "animations": {"Ghoul_Idle", "Ghoul_Hop", "Ghoul_Hit"},
        "min_meshes": 15,
        "min_images": 6,
        "min_skins": 1,
        "master_required": True,
    },
    "ice-pea-projectile": {
        "roots": {"ice-pea-projectile"},
        "required_nodes": {
            "Projectile_Visual",
            "COLLIDER_Projectile",
            "FX_TrailAnchor",
        },
        "animations": set(),
        "min_meshes": 7,
        "min_images": 3,
        "min_skins": 0,
        "master_required": True,
    },
}


def args_after_separator() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--render-dir", type=Path, default=None)
    return parser.parse_args(args_after_separator())


def read_glb(path: Path) -> dict:
    with path.open("rb") as handle:
        header = handle.read(12)
        if len(header) != 12:
            raise AssertionError(f"{path.name}: truncated header")
        magic, version, length = struct.unpack("<4sII", header)
        if magic != b"glTF" or version != 2 or length != path.stat().st_size:
            raise AssertionError(f"{path.name}: invalid glTF 2.0 binary header")
        document = None
        while handle.tell() < length:
            chunk_header = handle.read(8)
            if len(chunk_header) != 8:
                raise AssertionError(f"{path.name}: truncated chunk header")
            chunk_length, chunk_type = struct.unpack("<II", chunk_header)
            chunk = handle.read(chunk_length)
            if len(chunk) != chunk_length:
                raise AssertionError(f"{path.name}: truncated chunk")
            if chunk_type == 0x4E4F534A:
                document = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\0"))
        if document is None:
            raise AssertionError(f"{path.name}: JSON chunk missing")
        return document


def root_names(document: dict) -> set[str]:
    scene_index = int(document.get("scene", 0))
    scene = document.get("scenes", [])[scene_index]
    nodes = document.get("nodes", [])
    return {str(nodes[index].get("name", "")) for index in scene.get("nodes", [])}


def triangle_count(document: dict) -> int:
    accessors = document.get("accessors", [])
    total = 0
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            accessor_index = primitive.get("indices")
            if isinstance(accessor_index, int):
                total += int(accessors[accessor_index].get("count", 0)) // 3
    return total


def validate_asset(asset_id: str, rules: dict) -> dict:
    path = OUTPUT_DIR / f"{asset_id}.glb"
    if not path.is_file():
        raise AssertionError(f"Missing runtime asset: {path}")
    if rules["master_required"] and not (MASTER_DIR / f"{asset_id}.blend").is_file():
        raise AssertionError(f"Missing editable master for {asset_id}")
    document = read_glb(path)
    nodes = document.get("nodes", [])
    node_names = {str(node.get("name", "")) for node in nodes}
    roots = root_names(document)
    if roots != rules["roots"]:
        raise AssertionError(f"{asset_id}: roots {roots!r} != {rules['roots']!r}")
    missing_nodes = rules["required_nodes"] - node_names
    if missing_nodes:
        raise AssertionError(f"{asset_id}: missing runtime nodes {sorted(missing_nodes)}")
    animation_names = {str(animation.get("name", "")) for animation in document.get("animations", [])}
    if animation_names != rules["animations"]:
        raise AssertionError(
            f"{asset_id}: animation clips {sorted(animation_names)} != {sorted(rules['animations'])}"
        )
    if len(document.get("meshes", [])) < rules["min_meshes"]:
        raise AssertionError(f"{asset_id}: too few modeled meshes")
    images = document.get("images", [])
    if len(images) < rules["min_images"]:
        raise AssertionError(f"{asset_id}: too few embedded authored textures")
    if any("uri" in image for image in images):
        raise AssertionError(f"{asset_id}: GLB must not depend on external image files")
    if document.get("cameras"):
        raise AssertionError(f"{asset_id}: runtime asset contains a camera")
    if document.get("extensions", {}).get("KHR_lights_punctual", {}).get("lights"):
        raise AssertionError(f"{asset_id}: runtime asset contains a light")
    skins = document.get("skins", [])
    if len(skins) < rules.get("min_skins", 0):
        raise AssertionError(f"{asset_id}: expected a real glTF skin/joint rig")
    primitives = [
        primitive
        for mesh in document.get("meshes", [])
        for primitive in mesh.get("primitives", [])
    ]
    skinned_primitives = sum(
        "JOINTS_0" in primitive.get("attributes", {})
        and "WEIGHTS_0" in primitive.get("attributes", {})
        for primitive in primitives
    )
    if rules.get("min_skins", 0) and skinned_primitives == 0:
        raise AssertionError(f"{asset_id}: skin exists but no primitives carry joint weights")
    asset_extras = [
        node.get("extras", {})
        for node in nodes
        if node.get("extras", {}).get("asset_id") == asset_id
    ]
    if not asset_extras:
        raise AssertionError(f"{asset_id}: no node declares its exact runtime asset_id")
    summary = {
        "asset_id": asset_id,
        "bytes": path.stat().st_size,
        "nodes": len(nodes),
        "meshes": len(document.get("meshes", [])),
        "materials": len(document.get("materials", [])),
        "images": len(images),
        "triangles": triangle_count(document),
        "animations": sorted(animation_names),
        "roots": sorted(roots),
        "skins": len(skins),
        "joints": max((len(skin.get("joints", [])) for skin in skins), default=0),
        "skinned_primitives": skinned_primitives,
    }
    print("VALID " + json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return summary


def look_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def imported_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    found = False
    for obj in objects:
        if obj.type != "MESH":
            continue
        found = True
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            minimum.x = min(minimum.x, world.x)
            minimum.y = min(minimum.y, world.y)
            minimum.z = min(minimum.z, world.z)
            maximum.x = max(maximum.x, world.x)
            maximum.y = max(maximum.y, world.y)
            maximum.z = max(maximum.z, world.z)
    if not found:
        raise AssertionError("Imported asset has no mesh bounds")
    return minimum, maximum


def render_asset(asset_id: str, render_dir: Path) -> Path:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.fspath(OUTPUT_DIR / f"{asset_id}.glb"))
    imported = list(bpy.context.scene.objects)
    minimum, maximum = imported_bounds(imported)
    center = (minimum + maximum) * 0.5
    extent = maximum - minimum
    radius = max(extent.x, extent.y, extent.z) * 0.72
    light_scale = max(0.65, (radius / 5.5) ** 2)

    # Review on a neutral daylight ground so grime, roughness, normal response,
    # and warm/cool separation remain legible. This plane is never exported.
    bpy.ops.mesh.primitive_plane_add(
        size=max(8.0, radius * 5.0),
        location=(center.x, center.y, minimum.z - 0.025),
    )
    review_ground = bpy.context.object
    review_ground.name = "Review_Ground"
    ground_material = bpy.data.materials.new("Review_GroundMaterial")
    ground_material.diffuse_color = (0.20, 0.25, 0.22, 1)
    ground_material.use_nodes = True
    ground_principled = ground_material.node_tree.nodes.get("Principled BSDF")
    ground_principled.inputs["Base Color"].default_value = (0.20, 0.25, 0.22, 1)
    ground_principled.inputs["Roughness"].default_value = 0.92
    review_ground.data.materials.append(ground_material)

    camera_data = bpy.data.cameras.new("Review_Camera")
    camera = bpy.data.objects.new("Review_Camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    if asset_id == "garden-arena":
        # A lower south-to-north view reads as a playable garden rather than a
        # mobile-game board, and clearly frames the far spawn portal.
        camera.location = center + Vector((radius * 0.10, -radius * 1.18, radius * 0.38))
        camera_data.lens = 47
        look_at(camera, center + Vector((0, radius * 0.14, -radius * 0.055)))
    else:
        camera.location = center + Vector((radius * 1.25, -radius * 1.75, radius * 1.05))
        camera_data.lens = 52
        look_at(camera, center)
    bpy.context.scene.camera = camera

    for name, offset, energy, size, color in (
        ("Review_Key", (-1.2, -1.4, 1.8), 420, 5.0, (1.0, 0.88, 0.66)),
        ("Review_Fill", (1.5, -0.4, 0.8), 250, 4.0, (0.52, 0.76, 1.0)),
        ("Review_Rim", (0.2, 1.5, 1.7), 330, 4.0, (0.67, 0.96, 0.82)),
    ):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy * light_scale
        light_data.shape = "DISK"
        light_data.size = size
        light_data.color = color
        light = bpy.data.objects.new(name, light_data)
        bpy.context.scene.collection.objects.link(light)
        light.location = center + Vector(offset) * radius
        look_at(light, center)

    sun_data = bpy.data.lights.new("Review_Sun", "SUN")
    sun_data.energy = 1.8
    sun_data.angle = math.radians(24)
    sun_data.color = (1.0, 0.86, 0.66)
    sun = bpy.data.objects.new("Review_Sun", sun_data)
    bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(32), math.radians(-28), math.radians(-38))

    world = bpy.data.worlds.new("Review_World")
    world.use_nodes = True
    world_nodes = world.node_tree.nodes
    background = world_nodes.get("Background")
    background.inputs["Color"].default_value = (0.11, 0.31, 0.52, 1)
    background.inputs["Strength"].default_value = 0.72
    bpy.context.scene.world = world
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.look = "AgX - Medium High Contrast"
    render_dir.mkdir(parents=True, exist_ok=True)
    path = render_dir / f"{asset_id}.png"
    scene.render.filepath = os.fspath(path)
    bpy.ops.render.render(write_still=True)
    print(f"RENDERED {asset_id}: {path}")

    pose_frames = {
        "ice-peashooter": {"Idle": 16, "Move": 8, "Shoot": 4, "Hit": 4},
        "garden-ghoul": {"Ghoul_Idle": 16, "Ghoul_Hop": 18, "Ghoul_Hit": 4},
    }.get(asset_id, {})
    armature = next((obj for obj in imported if obj.type == "ARMATURE"), None)
    if pose_frames:
        if armature is None:
            raise AssertionError(f"{asset_id}: animated review has no imported Armature")
        if armature.animation_data is None:
            armature.animation_data_create()
        for track in armature.animation_data.nla_tracks:
            track.mute = True
        for clip_name, frame in pose_frames.items():
            action = bpy.data.actions.get(clip_name)
            if action is None:
                raise AssertionError(f"{asset_id}: Blender import lost action {clip_name}")
            armature.animation_data.action = action
            scene.frame_set(frame)
            pose_path = render_dir / f"{asset_id}--{clip_name}-f{frame:02d}.png"
            scene.render.filepath = os.fspath(pose_path)
            bpy.ops.render.render(write_still=True)
            print(f"RENDERED_POSE {asset_id} {clip_name} frame={frame}: {pose_path}")

        if asset_id == "ice-peashooter":
            # A separate gameplay-height rear check makes the user-edited back
            # spikes, paired arms, and duplicated leaves visible in one frame.
            # It also exercises the Move skin from the opposite side, catching
            # rigid-parenting drift that a front beauty render can hide.
            camera.location = center + Vector((-radius * 0.72, radius * 1.92, radius * 0.72))
            camera_data.lens = 58
            look_at(camera, center + Vector((0, 0, extent.z * 0.04)))
            rear_action = bpy.data.actions.get("Move")
            if rear_action is None:
                raise AssertionError("ice-peashooter: Blender import lost rear-check Move action")
            armature.animation_data.action = rear_action
            scene.frame_set(8)
            rear_path = render_dir / "ice-peashooter--MoveRearGameplay-f08.png"
            scene.render.filepath = os.fspath(rear_path)
            bpy.ops.render.render(write_still=True)
            print(f"RENDERED_REAR ice-peashooter Move frame=8: {rear_path}")

        armature.animation_data.action = None
        scene.frame_set(1)
    return path


def main() -> None:
    args = parse_args()
    summaries = [validate_asset(asset_id, rules) for asset_id, rules in ASSET_RULES.items()]
    if args.render_dir:
        render_dir = args.render_dir.expanduser().resolve()
        for asset_id in ASSET_RULES:
            render_asset(asset_id, render_dir)
    print(f"VALIDATED {len(summaries)} shooter GLBs")


if __name__ == "__main__":
    main()
