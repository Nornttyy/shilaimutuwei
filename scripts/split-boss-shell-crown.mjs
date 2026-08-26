#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
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

export const BOSS_SPLIT_SOURCE = path.join(
  PROJECT_ROOT,
  'assets/generated-v2/rig/enemy-acid-shell-king/candidates/shell-crown-split-v2.png',
);
export const BOSS_SPLIT_OUTPUT = path.join(
  PROJECT_ROOT,
  'assets/generated-v2/rig-parts-candidates/enemy-acid-shell-king/shell-crown-split-v2',
);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Find 4-connected components whose alpha is above the supplied threshold. */
export function alphaComponents(image, threshold = 0) {
  const { width, height, pixels } = image;
  const seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  const components = [];
  for (let start = 0; start < seen.length; start += 1) {
    if (seen[start] || pixels[start * 4 + 3] <= threshold) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    seen[start] = 1;
    let pixelCount = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (head < tail) {
      const index = queue[head];
      head += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      pixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const neighbors = [];
      if (x > 0) neighbors.push(index - 1);
      if (x + 1 < width) neighbors.push(index + 1);
      if (y > 0) neighbors.push(index - width);
      if (y + 1 < height) neighbors.push(index + width);
      for (const neighbor of neighbors) {
        if (!seen[neighbor] && pixels[neighbor * 4 + 3] > threshold) {
          seen[neighbor] = 1;
          queue[tail] = neighbor;
          tail += 1;
        }
      }
    }
    components.push({
      pixelCount,
      bbox: {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      },
    });
  }
  return components.sort((a, b) => b.pixelCount - a.pixelCount);
}

function paddedRect(bbox, image, padding) {
  const x = Math.max(0, bbox.x - padding);
  const y = Math.max(0, bbox.y - padding);
  const right = Math.min(image.width, bbox.x + bbox.width + padding);
  const bottom = Math.min(image.height, bbox.y + bbox.height + padding);
  return { x, y, width: right - x, height: bottom - y };
}

function growBboxThroughPaddedAlpha(image, initialBbox, padding) {
  let bbox = { ...initialBbox };
  for (;;) {
    const rect = paddedRect(bbox, image, padding);
    const visible = visibleAlphaBbox(cropRgba(image, rect, 'alpha component probe'));
    if (!visible) return bbox;
    const visibleInSource = {
      x: rect.x + visible.x,
      y: rect.y + visible.y,
      width: visible.width,
      height: visible.height,
    };
    const left = Math.min(bbox.x, visibleInSource.x);
    const top = Math.min(bbox.y, visibleInSource.y);
    const right = Math.max(
      bbox.x + bbox.width,
      visibleInSource.x + visibleInSource.width,
    );
    const bottom = Math.max(
      bbox.y + bbox.height,
      visibleInSource.y + visibleInSource.height,
    );
    const grown = { x: left, y: top, width: right - left, height: bottom - top };
    if (
      grown.x === bbox.x
      && grown.y === bbox.y
      && grown.width === bbox.width
      && grown.height === bbox.height
    ) return bbox;
    bbox = grown;
  }
}

function visibleAlphaBbox(image) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.pixels[(y * image.width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function writeAtomically(filePath, bytes) {
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, filePath);
}

/**
 * Split the two dominant alpha components without repainting or resampling.
 * Every output pixel is copied verbatim from a padded source rectangle.
 */
export async function splitBossShellCrown({
  sourcePath = BOSS_SPLIT_SOURCE,
  outputRoot = BOSS_SPLIT_OUTPUT,
  padding = 2,
} = {}) {
  if (path.resolve(sourcePath) !== path.resolve(BOSS_SPLIT_SOURCE)) {
    throw new Error('Only the approved shell-crown-split-v2 candidate may be read');
  }
  if (path.resolve(outputRoot) !== path.resolve(BOSS_SPLIT_OUTPUT)) {
    throw new Error('Unsafe Boss split output directory');
  }
  if (!Number.isInteger(padding) || padding < 0) throw new Error('Padding must be non-negative');

  const sourcePng = await readFile(sourcePath);
  const source = decodeRgbaPng(sourcePng, path.relative(PROJECT_ROOT, sourcePath));
  const components = alphaComponents(source, 0);
  if (components.length < 2 || components[1].pixelCount < 1_000) {
    throw new Error('Candidate does not contain two dominant alpha components');
  }
  if (components[2] && components[2].pixelCount >= components[1].pixelCount * 0.01) {
    throw new Error('Candidate contains more than two significant alpha components');
  }

  const [acidShellComponent, crownComponent] = components;
  if (
    acidShellComponent.pixelCount <= crownComponent.pixelCount
    || acidShellComponent.bbox.x >= crownComponent.bbox.x
  ) {
    throw new Error('Expected the larger acid shell at left and smaller crown at right');
  }

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const report = {
    schemaVersion: 1,
    source: path.relative(PROJECT_ROOT, sourcePath),
    sourceWidth: source.width,
    sourceHeight: source.height,
    padding,
    splitRule: 'two-largest-4-connected-alpha-components',
    parts: {},
  };

  for (const [id, component] of [
    ['acidShell', acidShellComponent],
    ['crown', crownComponent],
  ]) {
    const retainedAlphaBbox = growBboxThroughPaddedAlpha(source, component.bbox, padding);
    const sourceRect = paddedRect(retainedAlphaBbox, source, padding);
    const cropped = cropRgba(source, sourceRect, id);
    const png = encodeRgbaPng(cropped);
    const decoded = decodeRgbaPng(png, `${id}.png`);
    if (!decoded.pixels.equals(cropped.pixels)) throw new Error(`${id}: PNG round trip changed pixels`);
    const outputName = `${id}.png`;
    await writeAtomically(path.join(outputRoot, outputName), png);
    const alphaBboxInOutput = visibleAlphaBbox(cropped);
    if (
      alphaBboxInOutput.x < padding
      || alphaBboxInOutput.y < padding
      || alphaBboxInOutput.x + alphaBboxInOutput.width > cropped.width - padding
      || alphaBboxInOutput.y + alphaBboxInOutput.height > cropped.height - padding
    ) {
      throw new Error(`${id}: output does not retain ${padding}px transparent padding`);
    }
    report.parts[id] = {
      output: `${id}.png`,
      componentPixels: component.pixelCount,
      componentBboxInSource: component.bbox,
      retainedAlphaBboxInSource: retainedAlphaBbox,
      sourceRect,
      width: cropped.width,
      height: cropped.height,
      alphaBboxInOutput,
      ...alphaStats(cropped.pixels),
      pixelSha256: sha256(cropped.pixels),
      pngSha256: sha256(png),
    };
  }

  await writeAtomically(
    path.join(outputRoot, 'index.json'),
    Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
  );
  return report;
}

const directlyExecuted = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directlyExecuted) {
  try {
    const report = await splitBossShellCrown();
    for (const [id, part] of Object.entries(report.parts)) {
      console.log(
        `${id}: ${part.width}x${part.height}, alpha bbox `
        + `${part.alphaBboxInOutput.x},${part.alphaBboxInOutput.y},`
        + `${part.alphaBboxInOutput.width},${part.alphaBboxInOutput.height}`,
      );
    }
    console.log(path.relative(PROJECT_ROOT, BOSS_SPLIT_OUTPUT));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
