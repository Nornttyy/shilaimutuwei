#!/usr/bin/env python3
"""Normalize ImageGen output into a verified game-ready PNG.

Image generation can occasionally render a white/gray transparency grid into
an RGB image.  For transparent assets this script removes only the bright,
near-neutral region connected to the canvas boundary, preserving enclosed
white highlights.  It then fits the visible pixels into the requested canvas.
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("width", type=int)
    parser.add_argument("height", type=int)
    parser.add_argument("--opaque", action="store_true")
    parser.add_argument("--margin", type=float, default=0.08)
    parser.add_argument("--bottom-margin", type=float)
    parser.add_argument("--anchor", choices=("center", "bottom"), default="center")
    parser.add_argument("--min-background-fraction", type=float, default=0.08)
    parser.add_argument("--clean-alpha-radius", type=int, default=0)
    parser.add_argument("--clear-center-neutral", action="store_true")
    parser.add_argument(
        "--dark-background",
        action="store_true",
        help="remove an exterior-connected near-black matte instead of a bright checker",
    )
    parser.add_argument(
        "--preserve-canvas",
        action="store_true",
        help="keep the authored full-canvas layout instead of fitting visible bounds",
    )
    parser.add_argument(
        "--force-neutral-background",
        action="store_true",
        help=(
            "remove a large bright neutral matte even when the source already has "
            "some transparent pixels (ImageGen can mix alpha with a baked checker)"
        ),
    )
    return parser.parse_args()


def connected_neutral_background(
    image: Image.Image,
    min_background_fraction: float,
    dark_background: bool = False,
) -> Image.Image:
    rgb = image.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    visited = bytearray(width * height)
    background = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def is_candidate(x: int, y: int) -> bool:
        red, green, blue = pixels[x, y]
        if dark_background:
            return max(red, green, blue) <= 28 and max(red, green, blue) - min(red, green, blue) <= 18
        return min(red, green, blue) >= 215 and max(red, green, blue) - min(red, green, blue) <= 24

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if visited[index] or not is_candidate(x, y):
            return
        visited[index] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        background[y * width + x] = 1
        if x > 0:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y > 0:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    removed = sum(background)
    if removed < width * height * min_background_fraction:
        # Some ImageGen PNGs contain a transparent outer rim around an opaque
        # checkerboard. In that case no neutral pixel reaches the canvas edge,
        # so locate the largest enclosed neutral component instead. White
        # highlights remain safe because they are much smaller and enclosed by
        # the character's coloured fill/outline.
        visited = bytearray(width * height)
        largest: list[int] = []
        for start_y in range(height):
            for start_x in range(width):
                start_index = start_y * width + start_x
                if visited[start_index] or not is_candidate(start_x, start_y):
                    continue
                visited[start_index] = 1
                component_queue: deque[tuple[int, int]] = deque([(start_x, start_y)])
                component: list[int] = []
                while component_queue:
                    x, y = component_queue.popleft()
                    component.append(y * width + x)
                    for next_x, next_y in (
                        (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)
                    ):
                        if not (0 <= next_x < width and 0 <= next_y < height):
                            continue
                        index = next_y * width + next_x
                        if visited[index] or not is_candidate(next_x, next_y):
                            continue
                        visited[index] = 1
                        component_queue.append((next_x, next_y))
                if len(component) > len(largest):
                    largest = component

        if len(largest) < width * height * min_background_fraction:
            raise RuntimeError(
                "Could not find a connected bright neutral background; refusing to fake transparency."
            )
        background = bytearray(width * height)
        for index in largest:
            background[index] = 1

    rgba = image.convert("RGBA")
    matte = Image.new("L", (width, height), 0)
    matte_data = bytearray(width * height)
    for index, is_background in enumerate(background):
        if is_background:
            matte_data[index] = 255
    matte.frombytes(bytes(matte_data))
    # Eat a two-source-pixel exterior halo left by antialiasing against the
    # rendered checkerboard.  The generated art uses a much thicker outline,
    # so this does not alter the readable silhouette after downsampling.
    matte = matte.filter(ImageFilter.MaxFilter(5))
    keep = Image.eval(matte, lambda value: 255 - value)
    alpha = ImageChops.multiply(rgba.getchannel("A"), keep)
    rgba.putalpha(alpha)
    return rgba


def ensure_transparency(
    image: Image.Image,
    min_background_fraction: float,
    dark_background: bool = False,
    force_neutral_background: bool = False,
) -> Image.Image:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    if alpha.getextrema()[0] == 0 and not force_neutral_background:
        return rgba
    try:
        return connected_neutral_background(image, min_background_fraction, dark_background)
    except RuntimeError:
        if alpha.getextrema()[0] == 0:
            return rgba
        raise


def fit_transparent(
    image: Image.Image,
    width: int,
    height: int,
    margin: float,
    anchor: str,
    bottom_margin: float | None = None,
) -> Image.Image:
    alpha = image.getchannel("A")
    bounds = alpha.getbbox()
    if bounds is None:
        raise RuntimeError("Generated image contains no visible pixels.")
    content = image.crop(bounds)
    usable_width = max(1, round(width * (1 - margin * 2)))
    usable_height = max(1, round(height * (1 - margin * 2)))
    scale = min(usable_width / content.width, usable_height / content.height)
    resized = content.resize(
        (max(1, round(content.width * scale)), max(1, round(content.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    x = (width - resized.width) // 2
    if anchor == "bottom":
        ground_margin = margin if bottom_margin is None else bottom_margin
        y = height - round(height * ground_margin) - resized.height
    else:
        y = (height - resized.height) // 2
    canvas.alpha_composite(resized, (x, y))
    return canvas


def clean_alpha_noise(image: Image.Image, radius: int) -> Image.Image:
    if radius <= 0:
        return image
    kernel = radius * 2 + 1
    if kernel % 2 == 0:
        kernel += 1
    alpha = image.getchannel("A").point(lambda value: 255 if value >= 24 else 0)
    alpha = alpha.filter(ImageFilter.MinFilter(kernel))
    alpha = alpha.filter(ImageFilter.MaxFilter(kernel))
    cleaned = image.copy()
    cleaned.putalpha(alpha)
    return cleaned


def clear_center_neutral(image: Image.Image) -> Image.Image:
    width, height = image.size
    pixels = image.load()
    alpha = image.getchannel("A")
    if alpha.getpixel((width // 2, height // 2)) == 0:
        return image
    alpha_data = bytearray(alpha.tobytes())
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque([(width // 2, height // 2)])

    def is_candidate(x: int, y: int) -> bool:
        red, green, blue, opacity = pixels[x, y]
        return (
            opacity > 0
            and min(red, green, blue) >= 218
            and max(red, green, blue) - min(red, green, blue) <= 28
        )

    removed = 0
    while queue:
        x, y = queue.popleft()
        index = y * width + x
        if visited[index] or not is_candidate(x, y):
            continue
        visited[index] = 1
        alpha_data[index] = 0
        removed += 1
        if x > 0:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))

    if removed < width * height * 0.01:
        raise RuntimeError("Center is not a removable bright neutral region.")
    cleared = image.copy()
    alpha.frombytes(bytes(alpha_data))
    cleared.putalpha(alpha)
    return cleared


def fit_opaque(image: Image.Image, width: int, height: int) -> Image.Image:
    rgb = image.convert("RGB")
    scale = max(width / rgb.width, height / rgb.height)
    resized = rgb.resize(
        (max(width, round(rgb.width * scale)), max(height, round(rgb.height * scale))),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def main() -> None:
    args = parse_args()
    if args.width <= 0 or args.height <= 0:
        raise ValueError("width and height must be positive")
    if not 0 <= args.margin < 0.4:
        raise ValueError("margin must be between 0 and 0.4")
    if args.bottom_margin is not None and not 0 <= args.bottom_margin < 0.4:
        raise ValueError("bottom-margin must be between 0 and 0.4")
    if not 0 < args.min_background_fraction < 1:
        raise ValueError("min-background-fraction must be between 0 and 1")
    if args.clean_alpha_radius < 0 or args.clean_alpha_radius > 16:
        raise ValueError("clean-alpha-radius must be between 0 and 16")

    source = Image.open(args.source)
    if args.opaque:
        output = fit_opaque(source, args.width, args.height)
    else:
        prepared = ensure_transparency(
            source,
            args.min_background_fraction,
            args.dark_background,
            args.force_neutral_background,
        )
        if args.clear_center_neutral:
            prepared = clear_center_neutral(prepared)
        prepared = clean_alpha_noise(prepared, args.clean_alpha_radius)
        if args.preserve_canvas:
            output = prepared.resize(
                (args.width, args.height),
                Image.Resampling.LANCZOS,
            )
        else:
            output = fit_transparent(
                prepared,
                args.width,
                args.height,
                args.margin,
                args.anchor,
                args.bottom_margin,
            )
        if output.getchannel("A").getextrema()[0] != 0:
            raise RuntimeError("Output does not contain transparent pixels.")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    output.save(args.output, "PNG", optimize=True)
    print(f"saved {args.output} {output.mode} {output.size} {args.output.stat().st_size} bytes")


if __name__ == "__main__":
    main()
