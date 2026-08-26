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
  decodeRgbaPng,
  encodeRgbaPng,
  PROJECT_ROOT,
} from './export-rig-layers.mjs';

export const BOSS_LAYERED_ATLAS_PATH = path.join(
  PROJECT_ROOT,
  'assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v2.png',
);
export const BOSS_LAYERED_ATLAS_REPORT_PATH = path.join(
  PROJECT_ROOT,
  'assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v2.json',
);

const BASE_ATLAS = Object.freeze({
  path: path.join(
    PROJECT_ROOT,
    'assets/generated-v2/rig/enemy-acid-shell-king/atlas.png',
  ),
  width: 768,
  height: 512,
  pngSha256: '8fc2a2b61f37e5b67cc8db3ab9b853f0e7fcf9c5caf7389901f9a419b4cd0be5',
});

const CANDIDATE_ROOT = path.join(
  PROJECT_ROOT,
  'assets/generated-v2/rig-parts-candidates/enemy-acid-shell-king/shell-crown-split-v2',
);

export const BOSS_LAYERED_ATLAS_LAYOUT = Object.freeze({
  width: 768,
  height: 768,
  preservedBaseRect: Object.freeze({ x: 0, y: 0, width: 768, height: 512 }),
  parts: Object.freeze({
    acidShell: Object.freeze({
      input: 'acidShell.png',
      inputWidth: 884,
      inputHeight: 601,
      inputPngSha256: '3e479d7a9742aba4488750489c5e93724de019f618edade5313b477cb06a8b30',
      sourceRect: Object.freeze({ x: 16, y: 528, width: 294, height: 200 }),
    }),
    crown: Object.freeze({
      input: 'crown.png',
      inputWidth: 421,
      inputHeight: 294,
      inputPngSha256: '6a2de8070c3a4f69bf9c4a7d64905037a8925c6c98dd47606eb62cf0be8c6178',
      sourceRect: Object.freeze({ x: 326, y: 528, width: 172, height: 120 }),
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
  const { width, height, preservedBaseRect, parts } = BOSS_LAYERED_ATLAS_LAYOUT;
  if (
    preservedBaseRect.x !== 0
    || preservedBaseRect.y !== 0
    || preservedBaseRect.width !== BASE_ATLAS.width
    || preservedBaseRect.height !== BASE_ATLAS.height
  ) {
    throw new Error('Boss layered atlas must preserve the complete base atlas at (0, 0)');
  }
  const occupied = [preservedBaseRect];
  for (const [id, { sourceRect }] of Object.entries(parts)) {
    if (
      sourceRect.x < 0
      || sourceRect.y < 0
      || sourceRect.width <= 0
      || sourceRect.height <= 0
      || sourceRect.x + sourceRect.width > width
      || sourceRect.y + sourceRect.height > height
    ) {
      throw new Error(`${id}: output cell is outside the layered atlas`);
    }
    for (const previous of occupied) {
      if (rectanglesOverlap(sourceRect, previous)) {
        throw new Error(`${id}: output cell overlaps another atlas region`);
      }
    }
    occupied.push(sourceRect);
  }
}

/**
 * Resize RGBA pixels using premultiplied-alpha bilinear sampling.
 * This keeps translucent edges free of dark RGB halos and is deterministic.
 */
export function resizeRgbaBilinear(source, width, height) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('Resize dimensions must be positive integers');
  }
  const pixels = Buffer.alloc(width * height * 4);
  const sample = (x, y, channel) => source.pixels[(y * source.width + x) * 4 + channel];

  for (let targetY = 0; targetY < height; targetY += 1) {
    const sourceY = ((targetY + 0.5) * source.height) / height - 0.5;
    const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(sourceY)));
    const y1 = Math.max(0, Math.min(source.height - 1, y0 + 1));
    const yWeight = Math.max(0, Math.min(1, sourceY - Math.floor(sourceY)));

    for (let targetX = 0; targetX < width; targetX += 1) {
      const sourceX = ((targetX + 0.5) * source.width) / width - 0.5;
      const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(sourceX)));
      const x1 = Math.max(0, Math.min(source.width - 1, x0 + 1));
      const xWeight = Math.max(0, Math.min(1, sourceX - Math.floor(sourceX)));
      const samples = [
        [x0, y0, (1 - xWeight) * (1 - yWeight)],
        [x1, y0, xWeight * (1 - yWeight)],
        [x0, y1, (1 - xWeight) * yWeight],
        [x1, y1, xWeight * yWeight],
      ];

      let alpha = 0;
      const premultiplied = [0, 0, 0];
      for (const [x, y, weight] of samples) {
        const sampleAlpha = sample(x, y, 3);
        alpha += sampleAlpha * weight;
        for (let channel = 0; channel < 3; channel += 1) {
          premultiplied[channel] += sample(x, y, channel) * sampleAlpha * weight;
        }
      }

      const targetOffset = (targetY * width + targetX) * 4;
      if (alpha > 1e-8) {
        for (let channel = 0; channel < 3; channel += 1) {
          pixels[targetOffset + channel] = Math.round(premultiplied[channel] / alpha);
        }
        pixels[targetOffset + 3] = Math.round(alpha);
      }
    }
  }
  return { width, height, pixels };
}

function blit(target, source, x, y) {
  if (
    x < 0
    || y < 0
    || x + source.width > target.width
    || y + source.height > target.height
  ) {
    throw new Error('RGBA blit is outside the target image');
  }
  for (let row = 0; row < source.height; row += 1) {
    const sourceStart = row * source.width * 4;
    const targetStart = ((y + row) * target.width + x) * 4;
    source.pixels.copy(
      target.pixels,
      targetStart,
      sourceStart,
      sourceStart + source.width * 4,
    );
  }
}

async function readVerifiedPng(spec, label) {
  const bytes = await readFile(spec.path);
  const digest = sha256(bytes);
  if (digest !== spec.pngSha256) {
    throw new Error(`${label}: input PNG hash changed (${digest})`);
  }
  const image = decodeRgbaPng(bytes, relative(spec.path));
  if (image.width !== spec.width || image.height !== spec.height) {
    throw new Error(`${label}: expected ${spec.width}x${spec.height} input`);
  }
  return { bytes, image };
}

/** Compose the approved Boss v2 cells in memory without touching any files. */
export async function composeBossLayeredAtlas() {
  assertLayout();
  const { image: base } = await readVerifiedPng(BASE_ATLAS, 'base atlas');
  const atlas = {
    width: BOSS_LAYERED_ATLAS_LAYOUT.width,
    height: BOSS_LAYERED_ATLAS_LAYOUT.height,
    pixels: Buffer.alloc(
      BOSS_LAYERED_ATLAS_LAYOUT.width * BOSS_LAYERED_ATLAS_LAYOUT.height * 4,
    ),
  };
  blit(atlas, base, 0, 0);

  const parts = {};
  for (const [id, spec] of Object.entries(BOSS_LAYERED_ATLAS_LAYOUT.parts)) {
    const candidatePath = path.join(CANDIDATE_ROOT, spec.input);
    const { image: candidate } = await readVerifiedPng({
      path: candidatePath,
      width: spec.inputWidth,
      height: spec.inputHeight,
      pngSha256: spec.inputPngSha256,
    }, id);
    const resized = resizeRgbaBilinear(
      candidate,
      spec.sourceRect.width,
      spec.sourceRect.height,
    );
    blit(atlas, resized, spec.sourceRect.x, spec.sourceRect.y);
    parts[id] = {
      input: relative(candidatePath),
      inputWidth: candidate.width,
      inputHeight: candidate.height,
      inputPngSha256: spec.inputPngSha256,
      sourceRect: { ...spec.sourceRect },
      ...alphaStats(resized.pixels),
      pixelSha256: sha256(resized.pixels),
    };
  }

  const png = encodeRgbaPng(atlas);
  const report = {
    schemaVersion: 1,
    generator: 'scripts/build-boss-layered-atlas.mjs',
    baseAtlas: {
      path: relative(BASE_ATLAS.path),
      width: BASE_ATLAS.width,
      height: BASE_ATLAS.height,
      pngSha256: BASE_ATLAS.pngSha256,
      preservedRect: { ...BOSS_LAYERED_ATLAS_LAYOUT.preservedBaseRect },
    },
    output: {
      path: relative(BOSS_LAYERED_ATLAS_PATH),
      width: atlas.width,
      height: atlas.height,
      pngSha256: sha256(png),
      pixelSha256: sha256(atlas.pixels),
    },
    resize: 'premultiplied-alpha-bilinear',
    parts,
  };
  return { atlas, png, report };
}

async function writeAtomically(filePath, bytes) {
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, filePath);
}

/** Build only the exact checked-in Boss v2 atlas and its deterministic report. */
export async function buildBossLayeredAtlas() {
  const result = await composeBossLayeredAtlas();
  await writeAtomically(BOSS_LAYERED_ATLAS_PATH, result.png);
  await writeAtomically(
    BOSS_LAYERED_ATLAS_REPORT_PATH,
    Buffer.from(`${JSON.stringify(result.report, null, 2)}\n`),
  );
  return result.report;
}

const directlyExecuted = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directlyExecuted) {
  try {
    const report = await buildBossLayeredAtlas();
    console.log(
      `Built ${report.output.width}x${report.output.height} Boss layered atlas: `
      + report.output.path,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
