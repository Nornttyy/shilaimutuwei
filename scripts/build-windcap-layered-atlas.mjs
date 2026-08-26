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
  cropRgba,
  decodeRgbaPng,
  encodeRgbaPng,
  PROJECT_ROOT,
} from './export-rig-layers.mjs';

export const WINDCAP_LAYERED_ATLAS_PATH = path.join(
  PROJECT_ROOT,
  'assets/generated-v2/rig/enemy-windcap/atlas-layered-v2.png',
);
export const WINDCAP_LAYERED_ATLAS_REPORT_PATH = path.join(
  PROJECT_ROOT,
  'assets/generated-v2/rig/enemy-windcap/atlas-layered-v2.json',
);

const BASE_ATLAS = Object.freeze({
  path: path.join(PROJECT_ROOT, 'assets/generated-v2/rig/enemy-windcap/atlas.png'),
  width: 768,
  height: 512,
  pngSha256: '8f3e4e9526e44213c1fa3f4ef85495e21c23aff4bea3c6fdcef520e1c556870a',
});

export const WINDCAP_LAYERED_ATLAS_LAYOUT = Object.freeze({
  stem: Object.freeze({
    sourceRect: Object.freeze({ x: 35, y: 69, width: 156, height: 189 }),
    bindRect: Object.freeze({ x: -30, y: -65, width: 60, height: 73 }),
  }),
  cap: Object.freeze({
    sourceRect: Object.freeze({ x: 254, y: 103, width: 268, height: 154 }),
  }),
  eyes: Object.freeze({
    sourceRect: Object.freeze({ x: 585, y: 161, width: 124, height: 66 }),
    bindRect: Object.freeze({ x: -17, y: -47, width: 34, height: 18 }),
  }),
  mouth: Object.freeze({
    sourceRect: Object.freeze({ x: 89, y: 346, width: 69, height: 54 }),
  }),
  cleanup: Object.freeze({
    alphaThreshold: 8,
    dilationRadius: 4,
    harmonicPasses: 40,
  }),
});

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function relative(filePath) {
  return path.relative(PROJECT_ROOT, filePath).split(path.sep).join('/');
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

function placedFaceRect(bodyPart, facePart) {
  const x = Math.round(
    ((facePart.bindRect.x - bodyPart.bindRect.x) / bodyPart.bindRect.width)
      * bodyPart.sourceRect.width,
  );
  const y = Math.round(
    ((facePart.bindRect.y - bodyPart.bindRect.y) / bodyPart.bindRect.height)
      * bodyPart.sourceRect.height,
  );
  const width = Math.round(
    (facePart.bindRect.width / bodyPart.bindRect.width) * bodyPart.sourceRect.width,
  );
  const height = Math.round(
    (facePart.bindRect.height / bodyPart.bindRect.height) * bodyPart.sourceRect.height,
  );
  return { x, y, width, height };
}

/** Resize just the source alpha channel with deterministic bilinear sampling. */
function resizeAlphaBilinear(source, width, height) {
  const alpha = new Uint8Array(width * height);
  for (let targetY = 0; targetY < height; targetY += 1) {
    const sourceY = ((targetY + 0.5) * source.height) / height - 0.5;
    const sourceFloorY = Math.floor(sourceY);
    const y0 = Math.max(0, Math.min(source.height - 1, sourceFloorY));
    const y1 = Math.max(0, Math.min(source.height - 1, sourceFloorY + 1));
    const yWeight = Math.max(0, Math.min(1, sourceY - sourceFloorY));

    for (let targetX = 0; targetX < width; targetX += 1) {
      const sourceX = ((targetX + 0.5) * source.width) / width - 0.5;
      const sourceFloorX = Math.floor(sourceX);
      const x0 = Math.max(0, Math.min(source.width - 1, sourceFloorX));
      const x1 = Math.max(0, Math.min(source.width - 1, sourceFloorX + 1));
      const xWeight = Math.max(0, Math.min(1, sourceX - sourceFloorX));
      const alphaAt = (x, y) => source.pixels[(y * source.width + x) * 4 + 3];
      const top = alphaAt(x0, y0) * (1 - xWeight) + alphaAt(x1, y0) * xWeight;
      const bottom = alphaAt(x0, y1) * (1 - xWeight) + alphaAt(x1, y1) * xWeight;
      alpha[targetY * width + targetX] = Math.round(
        top * (1 - yWeight) + bottom * yWeight,
      );
    }
  }
  return alpha;
}

function buildCleanupMask(stem, eyes) {
  const target = placedFaceRect(
    WINDCAP_LAYERED_ATLAS_LAYOUT.stem,
    WINDCAP_LAYERED_ATLAS_LAYOUT.eyes,
  );
  const resizedAlpha = resizeAlphaBilinear(eyes, target.width, target.height);
  const placed = new Uint8Array(stem.width * stem.height);
  for (let y = 0; y < target.height; y += 1) {
    for (let x = 0; x < target.width; x += 1) {
      const targetX = target.x + x;
      const targetY = target.y + y;
      if (targetX < 0 || targetY < 0 || targetX >= stem.width || targetY >= stem.height) {
        continue;
      }
      placed[targetY * stem.width + targetX] = resizedAlpha[y * target.width + x];
    }
  }

  const { alphaThreshold, dilationRadius } = WINDCAP_LAYERED_ATLAS_LAYOUT.cleanup;
  const mask = new Uint8Array(stem.width * stem.height);
  for (let y = 0; y < stem.height; y += 1) {
    for (let x = 0; x < stem.width; x += 1) {
      let selected = false;
      for (let offsetY = -dilationRadius; offsetY <= dilationRadius && !selected; offsetY += 1) {
        const sourceY = y + offsetY;
        if (sourceY < 0 || sourceY >= stem.height) continue;
        for (let offsetX = -dilationRadius; offsetX <= dilationRadius; offsetX += 1) {
          const sourceX = x + offsetX;
          if (sourceX < 0 || sourceX >= stem.width) continue;
          if (placed[sourceY * stem.width + sourceX] >= alphaThreshold) {
            selected = true;
            break;
          }
        }
      }
      const offset = (y * stem.width + x) * 4;
      if (selected && stem.pixels[offset + 3] >= alphaThreshold) {
        mask[y * stem.width + x] = 1;
      }
    }
  }
  return { mask, placedAlpha: placed, target };
}

function inpaintStem(stem, mask) {
  const pixels = Buffer.from(stem.pixels);
  const remaining = Uint8Array.from(mask);
  let remainingCount = remaining.reduce((total, value) => total + value, 0);
  let fillRounds = 0;

  while (remainingCount > 0) {
    const filled = [];
    for (let y = 0; y < stem.height; y += 1) {
      for (let x = 0; x < stem.width; x += 1) {
        const pixelIndex = y * stem.width + x;
        if (!remaining[pixelIndex]) continue;
        const sums = [0, 0, 0];
        let samples = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const sampleY = y + offsetY;
          if (sampleY < 0 || sampleY >= stem.height) continue;
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleX = x + offsetX;
            if (
              (offsetX === 0 && offsetY === 0)
              || sampleX < 0
              || sampleX >= stem.width
            ) {
              continue;
            }
            const sampleIndex = sampleY * stem.width + sampleX;
            const sampleOffset = sampleIndex * 4;
            if (remaining[sampleIndex] || pixels[sampleOffset + 3] < 8) continue;
            for (let channel = 0; channel < 3; channel += 1) {
              sums[channel] += pixels[sampleOffset + channel];
            }
            samples += 1;
          }
        }
        if (samples > 0) {
          filled.push({
            pixelIndex,
            rgb: sums.map((sum) => Math.round(sum / samples)),
          });
        }
      }
    }
    if (filled.length === 0) throw new Error('Windcap stem inpaint has no visible boundary');
    for (const { pixelIndex, rgb } of filled) {
      const offset = pixelIndex * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = rgb[channel];
      }
      remaining[pixelIndex] = 0;
      remainingCount -= 1;
    }
    fillRounds += 1;
  }

  const maskIndices = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) maskIndices.push(index);
  }
  const nextRgb = new Uint8Array(mask.length * 3);
  for (let pass = 0; pass < WINDCAP_LAYERED_ATLAS_LAYOUT.cleanup.harmonicPasses; pass += 1) {
    for (const pixelIndex of maskIndices) {
      const x = pixelIndex % stem.width;
      const y = Math.floor(pixelIndex / stem.width);
      const sums = [0, 0, 0];
      let samples = 0;
      for (const [sampleX, sampleY] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        if (sampleX < 0 || sampleY < 0 || sampleX >= stem.width || sampleY >= stem.height) {
          continue;
        }
        const sampleOffset = (sampleY * stem.width + sampleX) * 4;
        if (pixels[sampleOffset + 3] < 8) continue;
        for (let channel = 0; channel < 3; channel += 1) {
          sums[channel] += pixels[sampleOffset + channel];
        }
        samples += 1;
      }
      for (let channel = 0; channel < 3; channel += 1) {
        nextRgb[pixelIndex * 3 + channel] = samples > 0
          ? Math.round(sums[channel] / samples)
          : pixels[pixelIndex * 4 + channel];
      }
    }
    for (const pixelIndex of maskIndices) {
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[pixelIndex * 4 + channel] = nextRgb[pixelIndex * 3 + channel];
      }
    }
  }

  return {
    image: { width: stem.width, height: stem.height, pixels },
    fillRounds,
  };
}

function placedEyeInkStats(stem, eyes, placedAlpha) {
  const target = placedFaceRect(
    WINDCAP_LAYERED_ATLAS_LAYOUT.stem,
    WINDCAP_LAYERED_ATLAS_LAYOUT.eyes,
  );
  const scaledEyes = {
    width: target.width,
    height: target.height,
    pixels: Buffer.alloc(target.width * target.height * 4),
  };
  for (let y = 0; y < target.height; y += 1) {
    const sourceY = Math.min(
      eyes.height - 1,
      Math.floor(((y + 0.5) / target.height) * eyes.height),
    );
    for (let x = 0; x < target.width; x += 1) {
      const sourceX = Math.min(
        eyes.width - 1,
        Math.floor(((x + 0.5) / target.width) * eyes.width),
      );
      const sourceOffset = (sourceY * eyes.width + sourceX) * 4;
      const targetOffset = (y * target.width + x) * 4;
      eyes.pixels.copy(scaledEyes.pixels, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }

  let compared = 0;
  let nearInk = 0;
  let darkInk = 0;
  for (let y = 0; y < stem.height; y += 1) {
    for (let x = 0; x < stem.width; x += 1) {
      const stemOffset = (y * stem.width + x) * 4;
      if (placedAlpha[y * stem.width + x] < 32 || stem.pixels[stemOffset + 3] < 32) continue;
      const faceX = x - target.x;
      const faceY = y - target.y;
      if (faceX < 0 || faceY < 0 || faceX >= target.width || faceY >= target.height) continue;
      const faceOffset = (faceY * target.width + faceX) * 4;
      if (scaledEyes.pixels[faceOffset + 3] < 32) continue;
      compared += 1;
      const difference = Math.max(
        Math.abs(stem.pixels[stemOffset] - scaledEyes.pixels[faceOffset]),
        Math.abs(stem.pixels[stemOffset + 1] - scaledEyes.pixels[faceOffset + 1]),
        Math.abs(stem.pixels[stemOffset + 2] - scaledEyes.pixels[faceOffset + 2]),
      );
      if (difference <= 20) nearInk += 1;
      if (
        stem.pixels[stemOffset] < 100
        && stem.pixels[stemOffset + 1] < 140
        && stem.pixels[stemOffset + 2] < 200
      ) {
        darkInk += 1;
      }
    }
  }
  return {
    compared,
    nearInk,
    nearInkRatio: compared === 0 ? 0 : nearInk / compared,
    darkInk,
    darkInkRatio: compared === 0 ? 0 : darkInk / compared,
  };
}

/** Build the face-clean Windcap atlas in memory without touching any files. */
export async function composeWindcapLayeredAtlas() {
  const baseBytes = await readFile(BASE_ATLAS.path);
  const baseDigest = sha256(baseBytes);
  if (baseDigest !== BASE_ATLAS.pngSha256) {
    throw new Error(`Windcap base atlas hash changed (${baseDigest})`);
  }
  const base = decodeRgbaPng(baseBytes, relative(BASE_ATLAS.path));
  if (base.width !== BASE_ATLAS.width || base.height !== BASE_ATLAS.height) {
    throw new Error(`Windcap base atlas must be ${BASE_ATLAS.width}x${BASE_ATLAS.height}`);
  }

  const stem = cropRgba(base, WINDCAP_LAYERED_ATLAS_LAYOUT.stem.sourceRect, 'Windcap stem');
  const eyes = cropRgba(base, WINDCAP_LAYERED_ATLAS_LAYOUT.eyes.sourceRect, 'Windcap eyes');
  const { mask, placedAlpha, target } = buildCleanupMask(stem, eyes);
  const { image: cleanStem, fillRounds } = inpaintStem(stem, mask);
  const atlas = { width: base.width, height: base.height, pixels: Buffer.from(base.pixels) };
  const stemRect = WINDCAP_LAYERED_ATLAS_LAYOUT.stem.sourceRect;
  blit(atlas, cleanStem, stemRect.x, stemRect.y);

  let changedPixels = 0;
  let alphaChangedPixels = 0;
  let outsideMaskChangedPixels = 0;
  for (let index = 0; index < stem.width * stem.height; index += 1) {
    const offset = index * 4;
    let changed = false;
    for (let channel = 0; channel < 4; channel += 1) {
      if (stem.pixels[offset + channel] !== cleanStem.pixels[offset + channel]) changed = true;
    }
    if (changed) {
      changedPixels += 1;
      if (!mask[index]) outsideMaskChangedPixels += 1;
    }
    if (stem.pixels[offset + 3] !== cleanStem.pixels[offset + 3]) alphaChangedPixels += 1;
  }
  if (outsideMaskChangedPixels !== 0 || alphaChangedPixels !== 0) {
    throw new Error('Windcap cleanup changed pixels outside its mask or altered silhouette alpha');
  }

  const png = encodeRgbaPng(atlas);
  const maskPixels = mask.reduce((total, value) => total + value, 0);
  const report = {
    schemaVersion: 1,
    generator: 'scripts/build-windcap-layered-atlas.mjs',
    baseAtlas: {
      path: relative(BASE_ATLAS.path),
      width: BASE_ATLAS.width,
      height: BASE_ATLAS.height,
      pngSha256: BASE_ATLAS.pngSha256,
    },
    output: {
      path: relative(WINDCAP_LAYERED_ATLAS_PATH),
      width: atlas.width,
      height: atlas.height,
      pngSha256: sha256(png),
      pixelSha256: sha256(atlas.pixels),
    },
    cleanup: {
      part: 'stem',
      sourceRect: { ...stemRect },
      mappedEyesRect: target,
      alphaThreshold: WINDCAP_LAYERED_ATLAS_LAYOUT.cleanup.alphaThreshold,
      dilationRadius: WINDCAP_LAYERED_ATLAS_LAYOUT.cleanup.dilationRadius,
      harmonicPasses: WINDCAP_LAYERED_ATLAS_LAYOUT.cleanup.harmonicPasses,
      fillRounds,
      maskPixels,
      changedPixels,
      outsideMaskChangedPixels,
      alphaChangedPixels,
      sourcePixelSha256: sha256(stem.pixels),
      outputPixelSha256: sha256(cleanStem.pixels),
      legacyEyeInk: {
        before: placedEyeInkStats(stem, eyes, placedAlpha),
        after: placedEyeInkStats(cleanStem, eyes, placedAlpha),
      },
    },
    preservedCells: Object.fromEntries(['cap', 'eyes', 'mouth'].map((id) => {
      const pixels = cropRgba(base, WINDCAP_LAYERED_ATLAS_LAYOUT[id].sourceRect, id).pixels;
      return [id, {
        sourceRect: { ...WINDCAP_LAYERED_ATLAS_LAYOUT[id].sourceRect },
        pixelSha256: sha256(pixels),
      }];
    })),
  };

  return { atlas, cleanupMask: mask, cleanStem, png, report };
}

async function writeAtomically(filePath, bytes) {
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, filePath);
}

export async function buildWindcapLayeredAtlas() {
  const composed = await composeWindcapLayeredAtlas();
  await writeAtomically(WINDCAP_LAYERED_ATLAS_PATH, composed.png);
  await writeAtomically(
    WINDCAP_LAYERED_ATLAS_REPORT_PATH,
    `${JSON.stringify(composed.report, null, 2)}\n`,
  );
  return composed.report;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const report = await buildWindcapLayeredAtlas();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
