#!/usr/bin/env node

import { deflateSync, inflateSync } from 'node:zlib';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
export const DEFAULT_MANIFEST_PATH = path.join(PROJECT_ROOT, 'assets/rig-parts.json');
export const DEFAULT_OUTPUT_ROOT = path.join(
  PROJECT_ROOT,
  'assets/generated-v2/rig-parts-exported',
);
export const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const SAFE_ATLAS_PATH = /^assets\/generated-v2\/rig\/[^/]+\/atlas\.png$/;
const VERSIONED_ATLAS_PATHS = Object.freeze({
  'enemy-acid-shell-king': 'assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v2.png',
});
const FORBIDDEN_IMAGE_PATH_SEGMENT = /(?:^|\/)(?:review|preview|candidates?)(?:\/|$)/i;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const CRC_TABLE = makeCrcTable();

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, 'ascii');
  const checksumInput = Buffer.concat([typeBytes, data]);
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(checksumInput), 8 + data.length);
  return output;
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

/** Decode the exact PNG format required by the current rig atlases. */
export function decodeRgbaPng(input, label = 'PNG') {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${label}: invalid PNG signature`);
  }

  let offset = 8;
  let header = null;
  let sawEnd = false;
  const imageData = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) throw new Error(`${label}: truncated PNG chunk`);

    const type = buffer.toString('ascii', typeStart, typeStart + 4);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    const actualCrc = crc32(buffer.subarray(typeStart, dataEnd));
    if (actualCrc !== expectedCrc) throw new Error(`${label}: invalid ${type} CRC`);

    if (type === 'IHDR') {
      if (header || length !== 13) throw new Error(`${label}: invalid IHDR`);
      header = {
        width: buffer.readUInt32BE(dataStart),
        height: buffer.readUInt32BE(dataStart + 4),
        bitDepth: buffer[dataStart + 8],
        colorType: buffer[dataStart + 9],
        compression: buffer[dataStart + 10],
        filter: buffer[dataStart + 11],
        interlace: buffer[dataStart + 12],
      };
    } else if (type === 'IDAT') {
      imageData.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      if (length !== 0) throw new Error(`${label}: invalid IEND`);
      sawEnd = true;
      break;
    }
    offset = chunkEnd;
  }

  if (!header || imageData.length === 0 || !sawEnd) {
    throw new Error(`${label}: incomplete PNG`);
  }
  if (
    header.width <= 0
    || header.height <= 0
    || header.bitDepth !== 8
    || header.colorType !== 6
    || header.compression !== 0
    || header.filter !== 0
    || header.interlace !== 0
  ) {
    throw new Error(`${label}: expected non-interlaced 8-bit RGBA PNG`);
  }

  const bytesPerPixel = 4;
  const rowBytes = header.width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(imageData));
  const expectedBytes = (rowBytes + 1) * header.height;
  if (filtered.length !== expectedBytes) {
    throw new Error(`${label}: decoded byte count is ${filtered.length}, expected ${expectedBytes}`);
  }

  const pixels = Buffer.alloc(rowBytes * header.height);
  let sourceOffset = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filterType = filtered[sourceOffset];
    sourceOffset += 1;
    if (filterType > 4) throw new Error(`${label}: unsupported row filter ${filterType}`);
    const rowOffset = y * rowBytes;
    const previousRowOffset = rowOffset - rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = filtered[sourceOffset + x];
      const left = x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[previousRowOffset + x] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? pixels[previousRowOffset + x - bytesPerPixel]
        : 0;
      let predictor = 0;
      if (filterType === 1) predictor = left;
      else if (filterType === 2) predictor = up;
      else if (filterType === 3) predictor = Math.floor((left + up) / 2);
      else if (filterType === 4) predictor = paethPredictor(left, up, upperLeft);
      pixels[rowOffset + x] = (raw + predictor) & 0xff;
    }
    sourceOffset += rowBytes;
  }

  return { ...header, pixels };
}

/** Encode unmodified RGBA pixels with deterministic filter and zlib settings. */
export function encodeRgbaPng({ width, height, pixels }) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('PNG dimensions must be positive integers');
  }
  if (!Buffer.isBuffer(pixels) || pixels.length !== width * height * 4) {
    throw new Error('RGBA pixel buffer has the wrong size');
  }

  const rowBytes = width * 4;
  const scanlines = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const targetOffset = y * (rowBytes + 1);
    scanlines[targetOffset] = 0;
    pixels.copy(scanlines, targetOffset + 1, y * rowBytes, (y + 1) * rowBytes);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND'),
  ]);
}

export function cropRgba(image, rect, label = 'PNG crop') {
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isInteger(rect?.[key])) throw new Error(`${label}: sourceRect.${key} must be an integer`);
  }
  if (
    rect.x < 0
    || rect.y < 0
    || rect.width <= 0
    || rect.height <= 0
    || rect.x + rect.width > image.width
    || rect.y + rect.height > image.height
  ) {
    throw new Error(`${label}: sourceRect is outside ${image.width}x${image.height} atlas`);
  }

  const pixels = Buffer.alloc(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    const sourceStart = ((rect.y + y) * image.width + rect.x) * 4;
    const targetStart = y * rect.width * 4;
    image.pixels.copy(pixels, targetStart, sourceStart, sourceStart + rect.width * 4);
  }
  return { width: rect.width, height: rect.height, pixels };
}

export function alphaStats(pixels) {
  let visiblePixels = 0;
  let transparentPixels = 0;
  let translucentPixels = 0;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset];
    if (alpha > 0) visiblePixels += 1;
    if (alpha === 0) transparentPixels += 1;
    else if (alpha < 255) translucentPixels += 1;
  }
  return { visiblePixels, transparentPixels, translucentPixels };
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function resolveSafeAtlas(projectRoot, assetPath, ownerId) {
  if (typeof assetPath !== 'string' || FORBIDDEN_IMAGE_PATH_SEGMENT.test(assetPath)) {
    throw new Error(`${ownerId}: atlas path points to a forbidden preview/review/candidate location`);
  }
  const expectedPath = VERSIONED_ATLAS_PATHS[ownerId]
    ?? `assets/generated-v2/rig/${ownerId}/atlas.png`;
  const isApprovedVersionedPath = VERSIONED_ATLAS_PATHS[ownerId] === assetPath;
  if (!SAFE_ATLAS_PATH.test(assetPath) && !isApprovedVersionedPath) {
    throw new Error(`${ownerId}: atlas path is outside the current rig atlas convention`);
  }
  if (assetPath !== expectedPath) {
    throw new Error(`${ownerId}: expected atlas path ${expectedPath}`);
  }
  const resolved = path.resolve(projectRoot, assetPath);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${ownerId}: atlas path escapes the project root`);
  }
  return resolved;
}

function resolveSafeExpressionSheet(projectRoot, assetPath, ownerId) {
  const expectedPath = `assets/generated-v2/rig/${ownerId}/expressions-v2.png`;
  if (typeof assetPath !== 'string' || FORBIDDEN_IMAGE_PATH_SEGMENT.test(assetPath)) {
    throw new Error(`${ownerId}: expression path points to a forbidden preview/review/candidate location`);
  }
  if (assetPath !== expectedPath) {
    throw new Error(`${ownerId}: expected expression path ${expectedPath}`);
  }
  const resolved = path.resolve(projectRoot, assetPath);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${ownerId}: expression path escapes the project root`);
  }
  return resolved;
}

async function writeAtomically(filePath, bytes) {
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, filePath);
}

/**
 * Export every sourceRect into a standalone transparent PNG.
 * The output root is fully generated and replaced on each run.
 */
export async function exportRigLayers({
  projectRoot = PROJECT_ROOT,
  manifestPath = DEFAULT_MANIFEST_PATH,
  outputRoot = DEFAULT_OUTPUT_ROOT,
} = {}) {
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedOutput = path.resolve(outputRoot);
  const isDefaultOutput = resolvedOutput === path.resolve(DEFAULT_OUTPUT_ROOT);
  const temporaryParent = path.dirname(resolvedOutput);
  const isTestOutput = (
    path.basename(resolvedOutput) === 'rig-parts-exported'
    && path.basename(temporaryParent).startsWith('slime-rig-layers-')
    && path.dirname(temporaryParent) === path.resolve(os.tmpdir())
  );
  if (!isDefaultOutput && !isTestOutput) {
    throw new Error('Refusing to replace an unsafe output directory');
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest?.rigs || typeof manifest.rigs !== 'object') {
    throw new Error('rig-parts.json must contain a rigs object');
  }

  await rm(resolvedOutput, { recursive: true, force: true });
  await mkdir(resolvedOutput, { recursive: true });
  const imageCache = new Map();
  const report = {
    schemaVersion: 2,
    generatedFrom: 'assets/rig-parts.json',
    outputRoot: 'assets/generated-v2/rig-parts-exported',
    rigs: {},
  };

  for (const [ownerId, rig] of Object.entries(manifest.rigs)) {
    if (!SAFE_ID.test(ownerId)) throw new Error(`Unsafe rig id: ${ownerId}`);
    if (!Array.isArray(rig.parts) || rig.parts.length === 0) {
      throw new Error(`${ownerId}: parts must be a non-empty array`);
    }
    const rigDirectory = path.join(resolvedOutput, ownerId);
    await mkdir(rigDirectory, { recursive: true });
    const usedIds = new Set();
    const exportedParts = [];
    const exportedExpressions = [];

    async function readCurrentImage(assetPath, kind) {
      const resolvedPath = kind === 'expression'
        ? resolveSafeExpressionSheet(resolvedRoot, assetPath, ownerId)
        : resolveSafeAtlas(resolvedRoot, assetPath, ownerId);
      let image = imageCache.get(resolvedPath);
      if (!image) {
        image = decodeRgbaPng(await readFile(resolvedPath), assetPath);
        imageCache.set(resolvedPath, image);
      }
      return image;
    }

    async function exportSourceRect({
      label,
      sourcePath,
      sourceRect,
      kind,
      outputPath,
    }) {
      const image = await readCurrentImage(sourcePath, kind);
      const cropped = cropRgba(image, sourceRect, label);
      const stats = alphaStats(cropped.pixels);
      if (stats.visiblePixels === 0) throw new Error(`${label}: sourceRect has zero visible alpha`);
      if (stats.transparentPixels === 0) {
        throw new Error(`${label}: sourceRect has no transparent background pixels`);
      }
      const png = encodeRgbaPng(cropped);
      await writeAtomically(path.join(resolvedOutput, outputPath), png);
      return {
        sourcePath,
        sourceRect: { ...sourceRect },
        output: outputPath,
        width: cropped.width,
        height: cropped.height,
        ...stats,
        pixelSha256: sha256(cropped.pixels),
        pngSha256: sha256(png),
      };
    }

    for (const part of rig.parts) {
      const label = `${ownerId}.${part?.id ?? '?'}`;
      if (!SAFE_ID.test(part?.id ?? '') || usedIds.has(part.id)) {
        throw new Error(`${label}: unsafe or duplicate part id`);
      }
      usedIds.add(part.id);
      const outputName = `${part.id}.png`;
      exportedParts.push({
        id: part.id,
        bone: part.bone,
        z: part.z,
        ...await exportSourceRect({
          label,
          sourcePath: part.path,
          sourceRect: part.sourceRect,
          kind: 'atlas',
          outputPath: `${ownerId}/${outputName}`,
        }),
      });

      if (part.id !== 'eyes' && part.id !== 'mouth') {
        if (part.variants != null) {
          throw new Error(`${label}: only eyes and mouth may declare expression variants`);
        }
        continue;
      }
      if (!part.variants || Array.isArray(part.variants) || typeof part.variants !== 'object') {
        throw new Error(`${label}: expression variants must be an object`);
      }
      if (Object.hasOwn(part.variants, 'normal')) {
        throw new Error(`${label}: normal is supplied automatically from the base atlas`);
      }
      const expressionDirectory = path.join(rigDirectory, 'expressions');
      await mkdir(expressionDirectory, { recursive: true });
      const variants = [
        ['normal', { path: part.path, sourceRect: part.sourceRect, kind: 'atlas' }],
        ...Object.entries(part.variants).map(([variantId, variant]) => [
          variantId,
          { ...variant, kind: 'expression' },
        ]),
      ];
      for (const [variantId, variant] of variants) {
        if (!SAFE_ID.test(variantId)) {
          throw new Error(`${label}: unsafe expression variant id ${variantId}`);
        }
        const expressionLabel = `${label}.${variantId}`;
        const expressionName = `${part.id}--${variantId}.png`;
        exportedExpressions.push({
          partId: part.id,
          variant: variantId,
          ...await exportSourceRect({
            label: expressionLabel,
            sourcePath: variant.path,
            sourceRect: variant.sourceRect,
            kind: variant.kind,
            outputPath: `${ownerId}/expressions/${expressionName}`,
          }),
        });
      }
    }
    report.rigs[ownerId] = {
      atlas: rig.parts[0].path,
      parts: exportedParts,
      expressions: exportedExpressions,
    };
  }

  const indexBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  await writeAtomically(path.join(resolvedOutput, 'index.json'), indexBytes);
  return report;
}

function isDirectRun() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  try {
    const report = await exportRigLayers();
    const rigCount = Object.keys(report.rigs).length;
    const partCount = Object.values(report.rigs)
      .reduce((sum, rig) => sum + rig.parts.length, 0);
    const expressionCount = Object.values(report.rigs)
      .reduce((sum, rig) => sum + rig.expressions.length, 0);
    console.log(
      `Exported ${partCount} base layers and ${expressionCount} expression layers `
      + `for ${rigCount} rigs.`,
    );
    console.log(path.relative(PROJECT_ROOT, DEFAULT_OUTPUT_ROOT));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
