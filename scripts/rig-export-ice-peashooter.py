#!/usr/bin/env python3
"""Build a non-destructive Armature runtime master for the edited Ice Peashooter.

Run with Blender:

    blender --background --factory-startup \
      --python scripts/rig-export-ice-peashooter.py -- --force

The user's edited source Blend is opened read-only and never saved.  A packed,
editable rigged copy is written under ``assets/original-masters/3d/shooter`` and
an atomically replaced runtime GLB under ``assets/generated/3d/shooter``.
Every deform-bound object receives one 100% vertex group, so animation remains
rigid per authored piece and cannot warp the user-edited silhouette.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import re
import struct
import sys
from typing import Sequence

import bpy
from mathutils import Matrix, Vector


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = PROJECT_ROOT / "assets/original-masters/3d/ice-peashooter/ice-peashooter.blend"
DEFAULT_MASTER = PROJECT_ROOT / "assets/original-masters/3d/shooter/ice-peashooter.blend"
DEFAULT_OUTPUT = PROJECT_ROOT / "assets/generated/3d/shooter/ice-peashooter.glb"
MODEL_COLLECTION = "IcePeashooter_Model"
PRIMARY_ROOT = "IcePeashooter_ROOT"
DUPLICATE_ROOTS = tuple(f"IcePeashooter_ROOT.{index:03d}" for index in range(1, 4))
ARMATURE_NAME = "IcePeashooter_Armature"
CLIP_NAMES = ("Idle", "Move", "Shoot", "Hit")
CORE_BONES = ("Root", "LeafBase", "Stem", "Head", "Muzzle", "Arm_L", "Arm_R", "Crown")
LEAF_BONES = (
    "Leaf_Front",
    "Leaf_FrontLeft",
    "Leaf_FrontRight",
    "Leaf_Left",
    "Leaf_Right",
    "Leaf_BackLeft",
    "Leaf_BackRight",
    "Leaf_Front_001",
    "Leaf_Front_002",
    "Leaf_Front_003",
)
DEFAULT_PRIMITIVE_NAME = re.compile(r"^(?:Camera|Light|Cube)(?:\.\d{3})?$")


def script_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--master", type=Path, default=DEFAULT_MASTER)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args(script_args())


def canonical(path: Path) -> Path:
    return path.expanduser().resolve()


def validate_paths(source: Path, master: Path, output: Path, force: bool) -> None:
    if not source.is_file() or source.suffix.lower() != ".blend":
        raise FileNotFoundError(f"Edited Ice Peashooter source is missing: {source}")
    if master.suffix.lower() != ".blend" or output.suffix.lower() != ".glb":
        raise ValueError("Rigged master must be .blend and runtime output must be .glb")
    if len({source, master, output}) != 3:
        raise ValueError("Source, rigged master, and runtime output must be distinct paths")
    existing = [path for path in (master, output) if path.exists()]
    if existing and not force:
        raise FileExistsError("Pass --force to safely replace: " + ", ".join(map(str, existing)))


def runtime_source_objects() -> list[bpy.types.Object]:
    collection = bpy.data.collections.get(MODEL_COLLECTION)
    if collection is None:
        raise RuntimeError(f"Missing source collection: {MODEL_COLLECTION}")
    objects = [
        obj for obj in collection.all_objects
        if obj.type in {"MESH", "EMPTY"}
        and obj.type not in {"CAMERA", "LIGHT"}
        and not DEFAULT_PRIMITIVE_NAME.fullmatch(obj.name)
    ]
    names = {obj.name for obj in objects}
    required = {PRIMARY_ROOT, *DUPLICATE_ROOTS, "CTRL_Muzzle", "CTRL_Head", "CTRL_Stem"}
    missing = required - names
    if missing:
        raise RuntimeError(f"Edited source is missing required contracts: {sorted(missing)}")
    for suffix in (".001", ".002", ".003"):
        for base in ("Leaf_Front", "Leaf_Front_Vein"):
            if base + suffix not in names:
                raise RuntimeError(f"Edited leaf branch is incomplete: {base + suffix}")
    return objects


def mesh_snapshot(objects: Sequence[bpy.types.Object]) -> dict[str, tuple]:
    snapshot = {}
    for obj in objects:
        if obj.type != "MESH":
            continue
        snapshot[obj.name] = (
            len(obj.data.vertices),
            len(obj.data.edges),
            len(obj.data.polygons),
            tuple(slot.name for slot in obj.data.materials),
            # Bone parenting can introduce sub-micrometre float normalization;
            # five decimals still detects any visible/rest-pose movement.
            tuple(round(value, 5) for row in obj.matrix_world for value in row),
        )
    return snapshot


def world_location(object_name: str) -> Vector:
    obj = bpy.data.objects.get(object_name)
    if obj is None:
        raise RuntimeError(f"Cannot locate rig pivot object: {object_name}")
    return obj.matrix_world.translation.copy()


def create_armature(collection: bpy.types.Collection) -> bpy.types.Object:
    armature_data = bpy.data.armatures.new(f"{ARMATURE_NAME}_Data")
    armature = bpy.data.objects.new(ARMATURE_NAME, armature_data)
    collection.objects.link(armature)
    armature.show_in_front = True
    armature["rig_kind"] = "rigid-piece skeletal rig"
    armature["asset_id"] = "ice-peashooter"
    armature.parent = bpy.data.objects[PRIMARY_ROOT]

    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    bone_specs: dict[str, tuple[Vector, Vector, str | None]] = {
        "Root": (Vector((0, 0, 0)), Vector((0, 0, 0.52)), None),
        "LeafBase": (Vector((0, 0, 0.42)), Vector((0, 0, 0.92)), "Root"),
        "Stem": (world_location("CTRL_Stem"), world_location("CTRL_Head"), "LeafBase"),
        "Head": (world_location("CTRL_Head"), world_location("CTRL_Head") + Vector((0, 0, 1.32)), "Stem"),
        "Muzzle": (world_location("CTRL_Muzzle"), world_location("CTRL_Muzzle") + Vector((0, -0.48, 0)), "Head"),
        "Arm_L": (world_location("CTRL_Arm_Left"), world_location("CTRL_Arm_Left") + Vector((-1.25, -0.05, 0)), "Stem"),
        "Arm_R": (world_location("CTRL_Arm_Right"), world_location("CTRL_Arm_Right") + Vector((1.25, -0.05, 0)), "Stem"),
        "Crown": (world_location("CTRL_IceCrown"), world_location("CTRL_IceCrown") + Vector((0, 0, 0.62)), "Head"),
    }
    leaf_controls = {
        "Leaf_Front": "CTRL_Leaf_Front",
        "Leaf_FrontLeft": "CTRL_Leaf_FrontLeft",
        "Leaf_FrontRight": "CTRL_Leaf_FrontRight",
        "Leaf_Left": "CTRL_Leaf_Left",
        "Leaf_Right": "CTRL_Leaf_Right",
        "Leaf_BackLeft": "CTRL_Leaf_BackLeft",
        "Leaf_BackRight": "CTRL_Leaf_BackRight",
        "Leaf_Front_001": "CTRL_Leaf_Front.001",
        "Leaf_Front_002": "CTRL_Leaf_Front.002",
        "Leaf_Front_003": "CTRL_Leaf_Front.003",
    }
    for bone_name, control_name in leaf_controls.items():
        head = world_location(control_name)
        # A vertical rest tail gives stable axes while retaining the exact
        # authored controller origin as the rotation pivot.
        bone_specs[bone_name] = (head, head + Vector((0, 0, 0.36)), "LeafBase")

    created: dict[str, bpy.types.EditBone] = {}
    for name in (*CORE_BONES, *LEAF_BONES):
        head, tail, parent_name = bone_specs[name]
        bone = armature_data.edit_bones.new(name)
        bone.head = head
        bone.tail = tail
        bone.use_connect = False
        bone.parent = created.get(parent_name)
        created[name] = bone
    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "XYZ"
    bpy.ops.object.mode_set(mode="OBJECT")
    return armature


def nearest_control(obj: bpy.types.Object) -> str | None:
    parent = obj.parent
    while parent is not None:
        if parent.name.startswith("CTRL_"):
            return parent.name
        parent = parent.parent
    return None


def control_to_bone(control_name: str | None) -> str:
    mapping = {
        "CTRL_LeafBase": "LeafBase",
        "CTRL_Stem": "Stem",
        "CTRL_Head": "Head",
        "CTRL_Muzzle": "Muzzle",
        "CTRL_IceCrown": "Crown",
        "CTRL_Arm_Left": "Arm_L",
        "CTRL_Arm_Right": "Arm_R",
        "CTRL_Leaf_Front": "Leaf_Front",
        "CTRL_Leaf_FrontLeft": "Leaf_FrontLeft",
        "CTRL_Leaf_FrontRight": "Leaf_FrontRight",
        "CTRL_Leaf_Left": "Leaf_Left",
        "CTRL_Leaf_Right": "Leaf_Right",
        "CTRL_Leaf_BackLeft": "Leaf_BackLeft",
        "CTRL_Leaf_BackRight": "Leaf_BackRight",
        "CTRL_Leaf_Front.001": "Leaf_Front_001",
        "CTRL_Leaf_Front.002": "Leaf_Front_002",
        "CTRL_Leaf_Front.003": "Leaf_Front_003",
    }
    return mapping.get(control_name, "Root")


def rigid_bind_meshes(
    objects: Sequence[bpy.types.Object],
    armature: bpy.types.Object,
) -> dict[str, str]:
    assignments: dict[str, str] = {}
    for obj in objects:
        if obj.type != "MESH":
            continue
        bone_name = control_to_bone(nearest_control(obj))
        assignments[obj.name] = bone_name
        # CTRL_Muzzle is bone-parented below, so its existing child mesh follows
        # once through object parenting and must not also deform through a skin.
        if bone_name == "Muzzle":
            continue
        group = obj.vertex_groups.get(bone_name) or obj.vertex_groups.new(name=bone_name)
        group.add(range(len(obj.data.vertices)), 1.0, "REPLACE")
        modifier = obj.modifiers.new(name="Rigid_Armature", type="ARMATURE")
        modifier.object = armature
        modifier.use_deform_preserve_volume = False
    return assignments


def bone_parent_muzzle_locator(armature: bpy.types.Object) -> None:
    locator = bpy.data.objects.get("CTRL_Muzzle")
    if locator is None:
        raise RuntimeError("CTRL_Muzzle disappeared before rig parenting")
    world = locator.matrix_world.copy()
    locator.parent = armature
    locator.parent_type = "BONE"
    locator.parent_bone = "Muzzle"
    locator.matrix_world = world


def pose_state(
    armature: bpy.types.Object,
    frame: int,
    transforms: dict[str, tuple[Sequence[float], Sequence[float], Sequence[float]]],
) -> None:
    for bone_name in (*CORE_BONES, *LEAF_BONES):
        bone = armature.pose.bones[bone_name]
        location, rotation, scale = transforms.get(
            bone_name,
            ((0, 0, 0), (0, 0, 0), (1, 1, 1)),
        )
        bone.location = location
        bone.rotation_euler = rotation
        bone.scale = scale
        bone.keyframe_insert(data_path="location", frame=frame, group=bone_name)
        bone.keyframe_insert(data_path="rotation_euler", frame=frame, group=bone_name)
        bone.keyframe_insert(data_path="scale", frame=frame, group=bone_name)


def build_action(
    armature: bpy.types.Object,
    name: str,
    frames: Sequence[tuple[int, dict[str, tuple[Sequence[float], Sequence[float], Sequence[float]]]]],
) -> bpy.types.Action:
    if armature.animation_data is None:
        armature.animation_data_create()
    armature.animation_data.action = bpy.data.actions.new(name=name)
    for frame, transforms in frames:
        pose_state(armature, frame, transforms)
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
    nla_strip.blend_type = "REPLACE"
    action["loop_hint"] = name in {"Idle", "Move"}
    return action


def transform(
    location: Sequence[float] = (0, 0, 0),
    rotation: Sequence[float] = (0, 0, 0),
    scale: Sequence[float] = (1, 1, 1),
) -> tuple[Sequence[float], Sequence[float], Sequence[float]]:
    return location, rotation, scale


def create_animations(armature: bpy.types.Object) -> None:
    leaf_names = LEAF_BONES
    idle_frames = []
    for frame, phase in ((1, 0), (16, math.pi / 2), (31, math.pi), (46, math.pi * 1.5), (61, math.tau)):
        state = {
            "Root": transform((0, 0, 0.025 * math.sin(phase))),
            "Stem": transform(rotation=(0.022 * math.sin(phase), 0.014 * math.cos(phase), -0.018 * math.sin(phase))),
            "Head": transform(rotation=(-0.018 * math.sin(phase), 0.015 * math.cos(phase), 0.020 * math.sin(phase))),
            "Arm_L": transform(rotation=(0.035 * math.sin(phase), 0, 0.025 * math.cos(phase))),
            "Arm_R": transform(rotation=(-0.035 * math.sin(phase), 0, -0.025 * math.cos(phase))),
        }
        for index, bone_name in enumerate(leaf_names):
            state[bone_name] = transform(rotation=(0.018 * math.sin(phase + index * 0.55), 0, 0.024 * math.cos(phase + index * 0.43)))
        idle_frames.append((frame, state))
    build_action(armature, "Idle", idle_frames)

    move_frames = []
    for frame, phase in ((1, 0), (8, math.pi / 2), (16, math.pi), (24, math.pi * 1.5), (31, math.tau)):
        lift = 0.085 * abs(math.sin(phase))
        state = {
            "Root": transform((0, 0, lift), rotation=(0.025 * math.sin(phase), 0, 0.045 * math.sin(phase))),
            "Stem": transform(rotation=(0.065 * math.sin(phase), 0.018 * math.cos(phase), -0.085 * math.sin(phase))),
            "Head": transform(rotation=(-0.045 * math.sin(phase), 0, 0.055 * math.sin(phase))),
            "Arm_L": transform(rotation=(0.18 * math.sin(phase), 0, 0.12 * math.sin(phase))),
            "Arm_R": transform(rotation=(-0.18 * math.sin(phase), 0, -0.12 * math.sin(phase))),
        }
        for index, bone_name in enumerate(leaf_names):
            direction = 1 if index % 2 == 0 else -1
            state[bone_name] = transform(rotation=(0.07 * math.sin(phase + index * 0.38), 0, direction * 0.11 * math.sin(phase)))
        move_frames.append((frame, state))
    build_action(armature, "Move", move_frames)

    build_action(
        armature,
        "Shoot",
        (
            (1, {}),
            (4, {
                "Stem": transform(rotation=(0.055, 0, 0)),
                "Head": transform((0, 0.10, -0.03), rotation=(0.13, 0, 0), scale=(1.04, 0.94, 1.03)),
                "Muzzle": transform((0, 0.08, 0), scale=(1.08, 0.88, 1.08)),
                "Arm_L": transform(rotation=(0.10, 0, -0.08)),
                "Arm_R": transform(rotation=(0.10, 0, 0.08)),
            }),
            (8, {
                "Stem": transform(rotation=(-0.025, 0, 0)),
                "Head": transform((0, -0.025, 0.012), rotation=(-0.035, 0, 0), scale=(0.99, 1.02, 0.99)),
                "Muzzle": transform((0, -0.02, 0), scale=(0.98, 1.04, 0.98)),
            }),
            (16, {}),
        ),
    )
    build_action(
        armature,
        "Hit",
        (
            (1, {}),
            (4, {
                "Root": transform((0, 0.10, 0.05), rotation=(-0.10, 0.05, -0.16), scale=(1.05, 0.94, 0.96)),
                "Stem": transform(rotation=(-0.12, 0.05, -0.10)),
                "Head": transform(rotation=(0.16, -0.08, 0.14)),
                "Arm_L": transform(rotation=(0.15, 0, -0.18)),
                "Arm_R": transform(rotation=(-0.10, 0, 0.20)),
            }),
            (9, {
                "Root": transform((0, -0.04, 0.015), rotation=(0.06, -0.025, 0.09)),
                "Stem": transform(rotation=(0.07, -0.03, 0.06)),
                "Head": transform(rotation=(-0.08, 0.04, -0.07)),
            }),
            (15, {"Root": transform(rotation=(-0.02, 0, -0.025))}),
            (21, {}),
        ),
    )
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 61
    bpy.context.scene.frame_set(1)


def select_export_objects(objects: Sequence[bpy.types.Object], armature: bpy.types.Object) -> list[bpy.types.Object]:
    selected = list(objects) + [armature]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in selected:
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    return selected


def read_glb(path: Path) -> dict:
    with path.open("rb") as handle:
        magic, version, total = struct.unpack("<4sII", handle.read(12))
        if magic != b"glTF" or version != 2 or total != path.stat().st_size:
            raise RuntimeError("Invalid glTF 2.0 GLB header")
        while handle.tell() < total:
            length, chunk_type = struct.unpack("<II", handle.read(8))
            payload = handle.read(length)
            if chunk_type == 0x4E4F534A:
                return json.loads(payload.decode("utf-8").rstrip(" \t\r\n\0"))
    raise RuntimeError("GLB JSON chunk is missing")


def validate_glb(document: dict, expected_meshes: int) -> dict:
    names = {str(node.get("name", "")) for node in document.get("nodes", [])}
    required = {PRIMARY_ROOT, *DUPLICATE_ROOTS, "CTRL_Muzzle", ARMATURE_NAME, *CORE_BONES, *LEAF_BONES}
    missing = required - names
    if missing:
        raise RuntimeError(f"Rigged GLB lost required nodes/joints: {sorted(missing)}")
    clips = {str(animation.get("name", "")) for animation in document.get("animations", [])}
    if clips != set(CLIP_NAMES):
        raise RuntimeError(f"Animation clips {sorted(clips)} != {sorted(CLIP_NAMES)}")
    if len(document.get("meshes", [])) != expected_meshes:
        raise RuntimeError("Rigging changed the exported mesh count")
    skins = document.get("skins", [])
    if not skins or not any(len(skin.get("joints", [])) >= len(CORE_BONES) for skin in skins):
        raise RuntimeError("Rigged GLB has no complete joint skin")
    primitives = [primitive for mesh in document.get("meshes", []) for primitive in mesh.get("primitives", [])]
    skinned_primitives = sum(
        "JOINTS_0" in primitive.get("attributes", {}) and "WEIGHTS_0" in primitive.get("attributes", {})
        for primitive in primitives
    )
    if skinned_primitives < expected_meshes - 2:
        raise RuntimeError(f"Only {skinned_primitives} primitives carry rigid joint weights")
    if document.get("cameras") or document.get("extensions", {}).get("KHR_lights_punctual", {}).get("lights"):
        raise RuntimeError("Runtime GLB contains presentation camera/light data")
    return {
        "nodes": len(document.get("nodes", [])),
        "meshes": len(document.get("meshes", [])),
        "skins": len(skins),
        "joints": max(len(skin.get("joints", [])) for skin in skins),
        "skinned_primitives": skinned_primitives,
        "animations": sorted(clips),
    }


def main() -> None:
    args = parse_args()
    source = canonical(args.source)
    master = canonical(args.master)
    output = canonical(args.output)
    validate_paths(source, master, output, args.force)
    master.parent.mkdir(parents=True, exist_ok=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    temp_master = master.with_name(f".{master.stem}.rigging.blend")
    temp_glb = output.with_name(f".{output.stem}.rigging.glb")
    for temp in (temp_master, temp_glb):
        if temp.exists():
            temp.unlink()

    bpy.ops.wm.open_mainfile(filepath=os.fspath(source), load_ui=False)
    source_objects = runtime_source_objects()
    before = mesh_snapshot(source_objects)
    collection = bpy.data.collections[MODEL_COLLECTION]
    armature = create_armature(collection)
    assignments = rigid_bind_meshes(source_objects, armature)
    bone_parent_muzzle_locator(armature)
    create_animations(armature)
    after = mesh_snapshot(source_objects)
    if before != after:
        changed = [name for name in before if before[name] != after.get(name)]
        for name in changed:
            print(f"INVARIANT_DIFF {name}: before={before[name]} after={after.get(name)}")
        raise RuntimeError(
            "Rig creation changed source mesh topology, materials, or rest transforms: "
            + ", ".join(changed)
        )

    # The rigged copy is reproducible; avoid numbered backup files beside it.
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=os.fspath(temp_master), check_existing=False)
    selected = select_export_objects(source_objects, armature)
    try:
        bpy.ops.export_scene.gltf(
            filepath=os.fspath(temp_glb),
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
            export_animations=True,
            export_animation_mode="NLA_TRACKS",
            export_nla_strips=True,
            export_force_sampling=True,
            export_frame_step=1,
            export_optimize_animation_size=True,
        )
        document = read_glb(temp_glb)
        result = validate_glb(document, len(before))
        os.replace(temp_master, master)
        os.replace(temp_glb, output)
    finally:
        for temp in (temp_master, temp_glb):
            if temp.exists():
                temp.unlink()

    print(
        "RIGGED_EXPORT "
        f"asset_id=ice-peashooter source_meshes={len(before)} bound_meshes={len(assignments)} "
        f"objects={len(selected)} bytes={output.stat().st_size} "
        + " ".join(f"{key}={value}" for key, value in result.items())
        + f" master={master} output={output}"
    )


if __name__ == "__main__":
    main()
