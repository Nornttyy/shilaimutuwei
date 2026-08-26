#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  alphaStats,
  cropRgba,
  decodeRgbaPng,
  encodeRgbaPng,
  PROJECT_ROOT,
} from './export-rig-layers.mjs';

export const BUBBLE_LAYERED_ATLAS_PATH = path.join(
  PROJECT_ROOT,
  'assets/generated-v2/rig/survivor-bubble-float/atlas-layered-v2.png',
);
export const BUBBLE_LAYERED_ATLAS_REPORT_PATH = path.join(
  PROJECT_ROOT,
  'assets/generated-v2/rig/survivor-bubble-float/atlas-layered-v2.json',
);

const BASE_ATLAS = Object.freeze({
  path: path.join(
    PROJECT_ROOT,
    'assets/generated-v2/rig/survivor-bubble-float/atlas.png',
  ),
  width: 768,
  height: 512,
  pngSha256: 'aef48879a568430f6da2bd66a68f84bc182aab1a70612460e0c50db476e04adc',
});

export const BUBBLE_LAYERED_ATLAS_LAYOUT = Object.freeze({
  width: BASE_ATLAS.width,
  height: BASE_ATLAS.height,
  sourceRect: Object.freeze({ x: 19, y: 306, width: 209, height: 116 }),
  alphaPredicate: 'alpha > 0',
  connectivity: 4,
  parts: Object.freeze({
    bubbleLarge: Object.freeze({
      rank: 1,
      sourceRect: Object.freeze({ x: 270, y: 0, width: 82, height: 82 }),
    }),
    bubbleMedium: Object.freeze({
      rank: 2,
      sourceRect: Object.freeze({ x: 370, y: 0, width: 59, height: 55 }),
    }),
    bubbleSmall: Object.freeze({
      rank: 3,
      sourceRect: Object.freeze({ x: 450, y: 0, width: 35, height: 35 }),
    }),
  }),
});

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function relative(filePath) {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');
}

function rectanglesOverlap(left, right) {
  return Math.max(left.x, right.x) < Math.min(left.x + left.width, right.x + right.width)
    && Math.max(left.y, right.y) < Math.min(left.y + left.height, right.y + right.height);
}

function assertLayout() {
  const { width, height, sourceRect, parts } = BUBBLE_LAYERED_ATLAS_LAYOUT;
  const occupied = [sourceRect];
  for (const [id, { sourceRect: targetRect }] of Object.entries(parts)) {
    if (
      !Number.isInteger(targetRect.x)
      || !Number.isInteger(targetRect.y)
      || !Number.isInteger(targetRect.width)
      || !Number.isInteger(targetRect.height)
      || targetRect.x < 0
      || targetRect.y < 0
      || targetRect.width <= 0
      || targetRect.height <= 0
      || targetRect.x + targetRect.width > width
      || targetRect.y + targetRect.height > height
    ) {
      throw new Error(`${id}: output cell is outside the Bubble atlas`);
    }
    for (const previous of occupied) {
      if (rectanglesOverlap(previous, targetRect)) {
        throw new Error(`${id}: output cell overlaps a source or output cell`);
      }
    }
    occupied.push(targetRect);
  }
}

function assertTransparentCell(atlas, rect, label) {
  const cell = cropRgba(atlas, rect, label);
  for (const byte of cell.pixels) {
    if (byte !== 0) throw new Error(`${label}: destination cell is not transparent black`);
  }
}

/**
 * Return every alpha>0 four-connected component in deterministic area order.
 * Pixels are indices in the supplied image, so their original RGBA bytes can
 * be copied without resampling or colour conversion.
 */
export function alphaComponents4(image) {
  if (
    !image
    || !Number.isInteger(image.width)
    || !Number.isInteger(image.height)
    || !Buffer.isBuffer(image.pixels)
    || image.pixels.length !== image.width * image.height * 4
  ) {
    throw new Error('alphaComponents4 expects a decoded RGBA image');
  }

  const seen = new Uint8Array(image.width * image.height);
  const components = [];
  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start] || image.pixels[start * 4 + 3] === 0) continue;
    const stack = [start];
    const indices = [];
    seen[start] = 1;
    let left = image.width;
    let top = image.height;
    let right = -1;
    let bottom = -1;
    let alphaSum = 0;

    while (stack.length > 0) {
      const index = stack.pop();
      const x = index % image.width;
      const y = Math.floor(index / image.width);
      indices.push(index);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      alphaSum += image.pixels[index * 4 + 3];

      for (const [nextX, nextY] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (
          nextX < 0
          || nextY < 0
          || nextX >= image.width
          || nextY >= image.height
        ) continue;
        const next = nextY * image.width + nextX;
        if (seen[next] || image.pixels[next * 4 + 3] === 0) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }

    components.push({
      area: indices.length,
      alphaSum,
      bounds: {
        x: left,
        y: top,
        width: right - left + 1,
        height: bottom - top + 1,
      },
      indices,
    });
  }

  return components.sort((left, right) => (
    right.area - left.area
    || left.bounds.x - right.bounds.x
    || left.bounds.y - right.bounds.y
    || left.bounds.width - right.bounds.width
    || left.bounds.height - right.bounds.height
  ));
}

function componentPixels(image, component) {
  const pixels = Buffer.alloc(component.bounds.width * component.bounds.height * 4);
  for (const sourceIndex of component.indices) {
    const sourceX = sourceIndex % image.width;
    const sourceY = Math.floor(sourceIndex / image.width);
    const targetX = sourceX - component.bounds.x;
    const targetY = sourceY - component.bounds.y;
    const sourceOffset = sourceIndex * 4;
    const targetOffset = (targetY * component.bounds.width + targetX) * 4;
    image.pixels.copy(pixels, targetOffset, sourceOffset, sourceOffset + 4);
  }
  return {
    width: component.bounds.width,
    height: component.bounds.height,
    pixels,
  };
}

function copyComponent(atlas, source, component, targetRect, id) {
  const componentImage = componentPixels(source, component);
  const insetX = Math.floor((targetRect.width - componentImage.width) / 2);
  const insetY = Math.floor((targetRect.height - componentImage.height) / 2);
  if (
    insetX < 0
    || insetY < 0
    || insetX + componentImage.width > targetRect.width
    || insetY + componentImage.height > targetRect.height
  ) {
    throw new Error(`${id}: component does not fit its output cell`);
  }

  for (let y = 0; y < componentImage.height; y += 1) {
    for (let x = 0; x < componentImage.width; x += 1) {
      const sourceOffset = (y * componentImage.width + x) * 4;
      if (componentImage.pixels[sourceOffset + 3] === 0) continue;
      const targetX = targetRect.x + insetX + x;
      const targetY = targetRect.y + insetY + y;
      const targetOffset = (targetY * atlas.width + targetX) * 4;
      componentImage.pixels.copy(atlas.pixels, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }

  return {
    image: componentImage,
    placement: {
      x: insetX,
      y: insetY,
      width: componentImage.width,
      height: componentImage.height,
    },
  };
}

/** Build the three independently addressable Bubble cells without file writes. */
export async function composeBubbleLayeredAtlas() {
  assertLayout();
  const baseBytes = await readFile(BASE_ATLAS.path);
  const baseDigest = sha256(baseBytes);
  if (baseDigest !== BASE_ATLAS.pngSha256) {
    throw new Error(`Bubble base atlas hash changed (${baseDigest})`);
  }
  const base = decodeRgbaPng(baseBytes, relative(BASE_ATLAS.path));
  if (base.width !== BASE_ATLAS.width || base.height !== BASE_ATLAS.height) {
    throw new Error(`Bubble base atlas must be ${BASE_ATLAS.width}x${BASE_ATLAS.height}`);
  }

  for (const [id, { sourceRect }] of Object.entries(BUBBLE_LAYERED_ATLAS_LAYOUT.parts)) {
    assertTransparentCell(base, sourceRect, `${id} destination`);
  }

  const source = cropRgba(
    base,
    BUBBLE_LAYERED_ATLAS_LAYOUT.sourceRect,
    'Bubble grouped source',
  );
  const components = alphaComponents4(source);
  if (components.length < 3) {
    throw new Error(`Bubble grouped source has only ${components.length} alpha components`);
  }
  const selected = components.slice(0, 3);
  const discarded = components.slice(3);
  const atlas = {
    width: base.width,
    height: base.height,
    pixels: Buffer.from(base.pixels),
  };

  const partEntries = Object.entries(BUBBLE_LAYERED_ATLAS_LAYOUT.parts);
  const parts = {};
  for (let index = 0; index < partEntries.length; index += 1) {
    const [id, spec] = partEntries[index];
    const component = selected[index];
    if (spec.rank !== index + 1) throw new Error(`${id}: component rank is not sequential`);
    const { image, placement } = copyComponent(
      atlas,
      source,
      component,
      spec.sourceRect,
      id,
    );
    const outputCell = cropRgba(atlas, spec.sourceRect, `${id} output`);
    parts[id] = {
      rank: spec.rank,
      sourceComponentBounds: { ...component.bounds },
      sourceArea: component.area,
      sourceAlphaSum: component.alphaSum,
      sourcePixelSha256: sha256(image.pixels),
      sourceRect: { ...spec.sourceRect },
      placement,
      ...alphaStats(outputCell.pixels),
      pixelSha256: sha256(outputCell.pixels),
    };
  }

  let changedPixels = 0;
  let changedOutsideTargets = 0;
  const targetRects = Object.values(BUBBLE_LAYERED_ATLAS_LAYOUT.parts)
    .map(({ sourceRect }) => sourceRect);
  for (let y = 0; y < atlas.height; y += 1) {
    for (let x = 0; x < atlas.width; x += 1) {
      const offset = (y * atlas.width + x) * 4;
      const changed = [0, 1, 2, 3].some((channel) => (
        atlas.pixels[offset + channel] !== base.pixels[offset + channel]
      ));
      if (!changed) continue;
      changedPixels += 1;
      const inTarget = targetRects.some((rect) => (
        x >= rect.x
        && y >= rect.y
        && x < rect.x + rect.width
        && y < rect.y + rect.height
      ));
      if (!inTarget) changedOutsideTargets += 1;
    }
  }
  const selectedPixels = selected.reduce((sum, component) => sum + component.area, 0);
  if (changedPixels !== selectedPixels || changedOutsideTargets !== 0) {
    throw new Error('Bubble extraction changed unexpected atlas pixels');
  }

  const png = encodeRgbaPng(atlas);
  const report = {
    schemaVersion: 1,
    generator: 'scripts/build-bubble-layered-atlas.mjs',
    baseAtlas: {
      path: relative(BASE_ATLAS.path),
      width: BASE_ATLAS.width,
      height: BASE_ATLAS.height,
      pngSha256: BASE_ATLAS.pngSha256,
    },
    extraction: {
      sourceRect: { ...BUBBLE_LAYERED_ATLAS_LAYOUT.sourceRect },
      alphaPredicate: BUBBLE_LAYERED_ATLAS_LAYOUT.alphaPredicate,
      connectivity: BUBBLE_LAYERED_ATLAS_LAYOUT.connectivity,
      componentCount: components.length,
      sourceVisiblePixels: components.reduce((sum, component) => sum + component.area, 0),
      selectedComponentCount: selected.length,
      selectedPixels,
      discarded: {
        componentCount: discarded.length,
        pixelCount: discarded.reduce((sum, component) => sum + component.area, 0),
        alphaSum: discarded.reduce((sum, component) => sum + component.alphaSum, 0),
        components: discarded.map((component) => ({
          area: component.area,
          alphaSum: component.alphaSum,
          bounds: { ...component.bounds },
        })),
      },
    },
    output: {
      path: relative(BUBBLE_LAYERED_ATLAS_PATH),
      width: atlas.width,
      height: atlas.height,
      pngSha256: sha256(png),
      pixelSha256: sha256(atlas.pixels),
      changedPixels,
      changedOutsideTargets,
    },
    parts,
  };
  return { atlas, base, source, components, png, report };
}

async function writeAtomically(filePath, bytes) {
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, filePath);
}

export async function buildBubbleLayeredAtlas() {
  const composed = await composeBubbleLayeredAtlas();
  await writeAtomically(BUBBLE_LAYERED_ATLAS_PATH, composed.png);
  await writeAtomically(
    BUBBLE_LAYERED_ATLAS_REPORT_PATH,
    Buffer.from(`${JSON.stringify(composed.report, null, 2)}\n`),
  );
  return composed.report;
}

const directlyExecuted = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directlyExecuted) {
  try {
    const report = await buildBubbleLayeredAtlas();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
