#!/usr/bin/env python3
"""Restore the approved round eye language on the four newest slime atlases."""

from __future__ import annotations

import argparse
import colorsys
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
CELL = 418
ATLAS_SIZE = CELL * 3
EYE_SOURCE = (
    ROOT
    / "assets/generated-v2/rig-parts-exported/survivor-shell-shell/eyes.png"
)
HURT_SOURCE = (
    ROOT
    / "assets/generated-v2/rig-parts-exported/survivor-moss-sprout"
    / "expressions/eyes--hurt.png"
)

CHARACTERS = {
    "berry": {
        "atlas": ROOT / "assets/generated/hero/hero-berry-burst-atlas-v1.png",
        "accent": "#ff4f78",
        "standalone": ROOT / "assets/generated/survivor/survivor-berry-burst.png",
        "normal_order": (2, 0, 1, 3, 4),
    },
    "dew": {
        "atlas": ROOT / "assets/generated/hero/hero-dew-bloom-atlas-v1.png",
        "accent": "#22dff3",
        "standalone": ROOT / "assets/generated/survivor/survivor-dew-bloom.png",
        "normal_order": (1, 0, 2, 3, 4),
    },
    "bounce": {
        "atlas": ROOT / "assets/generated/soldier/soldier-bounce-hammer-atlas-v1.png",
        "accent": "#ffad17",
    },
    "leaf": {
        "atlas": ROOT / "assets/generated/soldier/soldier-leaf-spinner-atlas-v1.png",
        "accent": "#81e548",
    },
}


def recolor_lower_reflection(image: Image.Image, target_hex: str) -> Image.Image:
    """Hue-shift only the approved eye's green lower reflection."""

    target_rgb = tuple(int(target_hex[index : index + 2], 16) / 255 for index in (1, 3, 5))
    target_hue, target_saturation, _ = colorsys.rgb_to_hsv(*target_rgb)
    output = image.convert("RGBA").copy()
    pixels = output.load()
    for y in range(output.height):
        for x in range(output.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue
            hue, saturation, value = colorsys.rgb_to_hsv(
                red / 255, green / 255, blue / 255
            )
            if 0.24 <= hue <= 0.49 and saturation >= 0.42 and green > red * 1.08:
                shifted = colorsys.hsv_to_rgb(
                    target_hue,
                    max(saturation, min(0.92, target_saturation)),
                    value,
                )
                pixels[x, y] = (*[round(channel * 255) for channel in shifted], alpha)
    return output


def draw_attack_brows() -> Image.Image:
    """Add an expressive brow without cutting the round eye silhouettes."""

    scale = 4
    layer = Image.new("RGBA", (CELL * scale, CELL * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    def rounded_line(points, fill, width):
        scaled = [(x * scale, y * scale) for x, y in points]
        draw.line(scaled, fill=fill, width=width * scale, joint="curve")
        radius = width * scale // 2
        for x, y in scaled[0], scaled[-1]:
            draw.ellipse(
                (x - radius, y - radius, x + radius, y + radius),
                fill=fill,
            )

    rounded_line(((132, 153), (172, 161)), (2, 25, 69, 255), 10)
    rounded_line(((246, 161), (286, 153)), (2, 25, 69, 255), 10)
    rounded_line(((134, 152), (171, 159)), (17, 67, 139, 255), 3)
    rounded_line(((247, 159), (284, 152)), (17, 67, 139, 255), 3)
    return layer.resize((CELL, CELL), Image.Resampling.LANCZOS)


def replace_cell(atlas: Image.Image, slot: int, layer: Image.Image) -> None:
    x = (slot % 3) * CELL
    y = (slot // 3) * CELL
    atlas.paste((0, 0, 0, 0), (x, y, x + CELL, y + CELL))
    atlas.alpha_composite(layer, (x, y))


def cell(atlas: Image.Image, slot: int) -> Image.Image:
    x = (slot % 3) * CELL
    y = (slot // 3) * CELL
    return atlas.crop((x, y, x + CELL, y + CELL))


def compose_standalone(atlas: Image.Image, order) -> Image.Image:
    composite = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    for slot in order:
        composite.alpha_composite(cell(atlas, slot))
    fitted = composite.resize((488, 488), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    canvas.alpha_composite(fitted, (12, 12))
    return canvas


def same_pixels(left: Image.Image, right: Image.Image) -> bool:
    return left.size == right.size and left.convert("RGBA").tobytes() == right.convert(
        "RGBA"
    ).tobytes()


def main(check: bool = False) -> None:
    approved_eyes = Image.open(EYE_SOURCE).convert("RGBA")
    hurt_eyes = Image.open(HURT_SOURCE).convert("RGBA").resize(
        (183, 98), Image.Resampling.LANCZOS
    )
    attack_brows = draw_attack_brows()

    for config in CHARACTERS.values():
        current_atlas = Image.open(config["atlas"]).convert("RGBA")
        if current_atlas.size != (ATLAS_SIZE, ATLAS_SIZE):
            raise ValueError(f"{config['atlas']} must be {ATLAS_SIZE}x{ATLAS_SIZE}")
        atlas = current_atlas.copy()

        normal = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        normal.alpha_composite(
            recolor_lower_reflection(approved_eyes, config["accent"]),
            (123, 158),
        )
        attack = normal.copy()
        attack.alpha_composite(attack_brows)
        hurt = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        hurt.alpha_composite(hurt_eyes, (118, 158))

        replace_cell(atlas, 3, normal)
        replace_cell(atlas, 5, attack)
        replace_cell(atlas, 7, hurt)
        if check:
            if not same_pixels(atlas, current_atlas):
                raise ValueError(f"{config['atlas']} does not contain the approved eye layers")
        else:
            atlas.save(config["atlas"], optimize=True)

        if config.get("standalone"):
            standalone = compose_standalone(atlas, config["normal_order"])
            if check:
                current = Image.open(config["standalone"]).convert("RGBA")
                if not same_pixels(standalone, current):
                    raise ValueError(
                        f"{config['standalone']} is not synchronized with its layered atlas"
                    )
            else:
                standalone.save(config["standalone"], optimize=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the committed atlases and standalones without changing files",
    )
    main(check=parser.parse_args().check)
