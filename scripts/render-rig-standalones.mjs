#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import {
  decodeRgbaPng,
  PNG_SIGNATURE,
} from './export-rig-layers.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
export const DEFAULT_MANIFEST_PATH = path.join(PROJECT_ROOT, 'assets/rig-parts.json');
export const DEFAULT_ASSET_SPEC_PATH = path.join(PROJECT_ROOT, 'assets/asset-spec.json');
export const RIG_IDS = Object.freeze([
  'survivor-shell-shell',
  'survivor-crystal-pin',
  'survivor-bubble-float',
  'survivor-moss-sprout',
  'enemy-soft-biter',
  'enemy-windcap',
  'enemy-stone-lump',
  'enemy-acid-shell-king',
]);

const FACE_PARTS = new Set(['eyes', 'mouth']);
const FORBIDDEN_SOURCE_SEGMENT = /(?:^|\/)(?:review|preview|candidates?)(?:\/|$)/i;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const SAFE_SOURCE_FILE = /^(?:atlas(?:-layered-v\d+)?|expressions-v\d+)\.png$/;
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
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBytes.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
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

function filterScore(byte) {
  return byte < 128 ? byte : 256 - byte;
}

/** Encode RGBA with deterministic adaptive row filters and maximum DEFLATE. */
export function encodeStandalonePng({ width, height, pixels }) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('PNG dimensions must be positive integers.');
  }
  if (!Buffer.isBuffer(pixels) || pixels.length !== width * height * 4) {
    throw new Error('RGBA pixel buffer has the wrong size.');
  }

  const rowBytes = width * 4;
  const scanlines = Buffer.alloc((rowBytes + 1) * height);
  const candidates = Array.from({ length: 5 }, () => Buffer.allocUnsafe(rowBytes));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowBytes;
    let bestFilter = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let filter = 0; filter <= 4; filter += 1) {
      const candidate = candidates[filter];
      let score = 0;
      for (let x = 0; x < rowBytes; x += 1) {
        const raw = pixels[rowOffset + x];
        const left = x >= 4 ? pixels[rowOffset + x - 4] : 0;
        const up = y > 0 ? pixels[rowOffset - rowBytes + x] : 0;
        const upperLeft = y > 0 && x >= 4 ? pixels[rowOffset - rowBytes + x - 4] : 0;
        let predictor = 0;
        if (filter === 1) predictor = left;
        else if (filter === 2) predictor = up;
        else if (filter === 3) predictor = Math.floor((left + up) / 2);
        else if (filter === 4) predictor = paethPredictor(left, up, upperLeft);
        const filtered = (raw - predictor) & 0xff;
        candidate[x] = filtered;
        score += filterScore(filtered);
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
      }
    }
    const targetOffset = y * (rowBytes + 1);
    scanlines[targetOffset] = bestFilter;
    candidates[bestFilter].copy(scanlines, targetOffset + 1);
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function finiteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function clampUnit(value, fallback = 1) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, number));
}

function normalizedSourceRect(value, label) {
  assertObject(value, label);
  const result = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isInteger(value[key])) throw new TypeError(`${label}.${key} must be an integer.`);
    result[key] = value[key];
  }
  if (result.x < 0 || result.y < 0 || result.width <= 0 || result.height <= 0) {
    throw new RangeError(`${label} must be a positive source crop.`);
  }
  return result;
}

function normalizedBindRect(value, label) {
  assertObject(value, label);
  const result = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    result[key] = finiteNumber(value[key], `${label}.${key}`);
  }
  if (result.width <= 0 || result.height <= 0) {
    throw new RangeError(`${label} must have positive dimensions.`);
  }
  return result;
}

function resolveProjectPath(projectRoot, assetPath, label) {
  if (typeof assetPath !== 'string' || !assetPath.startsWith('assets/')) {
    throw new RangeError(`${label} must be a project-relative assets path.`);
  }
  const resolved = path.resolve(projectRoot, assetPath);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new RangeError(`${label} escapes the project root.`);
  }
  return resolved;
}

function resolveProductionSource(projectRoot, assetPath, ownerId, label) {
  if (typeof assetPath !== 'string' || FORBIDDEN_SOURCE_SEGMENT.test(assetPath)) {
    throw new RangeError(`${label} points to a forbidden review, preview, or candidate path.`);
  }
  const ownerDirectory = `assets/generated-v2/rig/${ownerId}/`;
  const fileName = assetPath.startsWith(ownerDirectory)
    ? assetPath.slice(ownerDirectory.length)
    : '';
  if (!SAFE_SOURCE_FILE.test(fileName)) {
    throw new RangeError(`${label} is not a current production atlas/expression file.`);
  }
  return resolveProjectPath(projectRoot, assetPath, label);
}

function resolveOutput(projectRoot, assetPath, ownerId, category) {
  const expected = `assets/generated/${category}/${ownerId}.png`;
  if (assetPath !== expected) {
    throw new RangeError(`${ownerId}: asset-spec output must be ${expected}.`);
  }
  return resolveProjectPath(projectRoot, assetPath, `${ownerId}.output`);
}

function descriptorForNormal(part, ownerId, index) {
  const label = `${ownerId}.parts[${index}]`;
  assertObject(part, label);
  if (!SAFE_ID.test(part.id ?? '')) throw new RangeError(`${label}.id is unsafe.`);
  const explicitNormal = part.variants?.normal;
  if (explicitNormal != null) assertObject(explicitNormal, `${label}.variants.normal`);
  const descriptor = explicitNormal ?? part;
  return {
    id: part.id,
    z: finiteNumber(part.z, `${label}.z`),
    manifestIndex: index,
    sourcePath: descriptor.path ?? part.path,
    sourceRect: normalizedSourceRect(
      descriptor.sourceRect ?? part.sourceRect,
      `${label}.normal.sourceRect`,
    ),
    bindRect: normalizedBindRect(
      descriptor.bindRect ?? part.bindRect,
      `${label}.normal.bindRect`,
    ),
    alpha: clampUnit(part.alpha) * (explicitNormal ? clampUnit(descriptor.alpha) : 1),
    expression: FACE_PARTS.has(part.id) ? 'normal' : null,
    normalKind: explicitNormal ? 'explicit-normal-variant' : 'base-atlas-normal',
  };
}

function unionBindBounds(layers) {
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const { bindRect } of layers) {
    bounds.minX = Math.min(bounds.minX, bindRect.x);
    bounds.minY = Math.min(bounds.minY, bindRect.y);
    bounds.maxX = Math.max(bounds.maxX, bindRect.x + bindRect.width);
    bounds.maxY = Math.max(bounds.maxY, bindRect.y + bindRect.height);
  }
  if (!Object.values(bounds).every(Number.isFinite)) throw new Error('Rig has no finite bind bounds.');
  return bounds;
}

function placementFor(width, height, logicalBounds, facing) {
  const safeMargin = Math.round(width * 5 / 64);
  const horizontalExtent = Math.max(Math.abs(logicalBounds.minX), Math.abs(logicalBounds.maxX));
  const logicalHeight = logicalBounds.maxY - logicalBounds.minY;
  const scale = Math.min(
    (width / 2 - safeMargin) / horizontalExtent,
    (height - safeMargin * 2) / logicalHeight,
  );
  if (!(scale > 0)) throw new RangeError('Rig cannot be fitted inside the standalone canvas.');
  const anchorX = width / 2;
  const anchorY = height - safeMargin - logicalBounds.maxY * scale;
  const xCandidates = [
    anchorX + facing * logicalBounds.minX * scale,
    anchorX + facing * logicalBounds.maxX * scale,
  ];
  const targetBindBounds = {
    minX: Math.min(...xCandidates),
    minY: anchorY + logicalBounds.minY * scale,
    maxX: Math.max(...xCandidates),
    maxY: anchorY + logicalBounds.maxY * scale,
  };
  const epsilon = 1e-7;
  if (
    targetBindBounds.minX < safeMargin - epsilon
    || targetBindBounds.minY < safeMargin - epsilon
    || targetBindBounds.maxX > width - safeMargin + epsilon
    || targetBindBounds.maxY > height - safeMargin + epsilon
  ) {
    throw new RangeError('Computed bind pose violates the standalone safe margin.');
  }
  return {
    safeMargin,
    scale,
    facing,
    anchorX,
    anchorY,
    targetBindBounds,
  };
}

function assertCropInside(image, rect, label) {
  if (rect.x + rect.width > image.width || rect.y + rect.height > image.height) {
    throw new RangeError(`${label} exceeds its ${image.width}x${image.height} source image.`);
  }
}

function samplePremultiplied(image, rect, u, v, output) {
  const sourceX = rect.x + u * rect.width - 0.5;
  const sourceY = rect.y + v * rect.height - 0.5;
  const floorX = Math.floor(sourceX);
  const floorY = Math.floor(sourceY);
  const fractionX = sourceX - floorX;
  const fractionY = sourceY - floorY;
  const x0 = Math.max(rect.x, Math.min(rect.x + rect.width - 1, floorX));
  const x1 = Math.max(rect.x, Math.min(rect.x + rect.width - 1, floorX + 1));
  const y0 = Math.max(rect.y, Math.min(rect.y + rect.height - 1, floorY));
  const y1 = Math.max(rect.y, Math.min(rect.y + rect.height - 1, floorY + 1));
  const weights = [
    (1 - fractionX) * (1 - fractionY),
    fractionX * (1 - fractionY),
    (1 - fractionX) * fractionY,
    fractionX * fractionY,
  ];
  const coordinates = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
  output.fill(0);
  for (let index = 0; index < coordinates.length; index += 1) {
    const [x, y] = coordinates[index];
    const pixelOffset = (y * image.width + x) * 4;
    const alpha = image.pixels[pixelOffset + 3] / 255;
    const weight = weights[index];
    output[0] += image.pixels[pixelOffset] * alpha * weight;
    output[1] += image.pixels[pixelOffset + 1] * alpha * weight;
    output[2] += image.pixels[pixelOffset + 2] * alpha * weight;
    output[3] += alpha * weight;
  }
}

function compositeLayer(destination, canvasWidth, canvasHeight, image, layer, placement) {
  const { bindRect, sourceRect, alpha } = layer;
  if (alpha <= 0) return;
  const { scale, facing, anchorX, anchorY } = placement;
  const xEndpoints = [
    anchorX + facing * bindRect.x * scale,
    anchorX + facing * (bindRect.x + bindRect.width) * scale,
  ];
  const yStart = anchorY + bindRect.y * scale;
  const yEnd = anchorY + (bindRect.y + bindRect.height) * scale;
  const startX = Math.max(0, Math.floor(Math.min(...xEndpoints)));
  const endX = Math.min(canvasWidth, Math.ceil(Math.max(...xEndpoints)));
  const startY = Math.max(0, Math.floor(yStart));
  const endY = Math.min(canvasHeight, Math.ceil(yEnd));
  const sample = new Float64Array(4);

  for (let y = startY; y < endY; y += 1) {
    const logicalY = (y + 0.5 - anchorY) / scale;
    const v = (logicalY - bindRect.y) / bindRect.height;
    if (v < 0 || v >= 1) continue;
    for (let x = startX; x < endX; x += 1) {
      const logicalX = facing * (x + 0.5 - anchorX) / scale;
      const u = (logicalX - bindRect.x) / bindRect.width;
      if (u < 0 || u >= 1) continue;
      samplePremultiplied(image, sourceRect, u, v, sample);
      const sourceAlpha = sample[3] * alpha;
      if (sourceAlpha <= 0) continue;
      const inverseAlpha = 1 - sourceAlpha;
      const targetOffset = (y * canvasWidth + x) * 4;
      destination[targetOffset] = sample[0] * alpha + destination[targetOffset] * inverseAlpha;
      destination[targetOffset + 1] = sample[1] * alpha + destination[targetOffset + 1] * inverseAlpha;
      destination[targetOffset + 2] = sample[2] * alpha + destination[targetOffset + 2] * inverseAlpha;
      destination[targetOffset + 3] = sourceAlpha + destination[targetOffset + 3] * inverseAlpha;
    }
  }
}

function unpremultiply(destination, width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const alpha = Math.max(0, Math.min(1, destination[offset + 3]));
    const alphaByte = Math.round(alpha * 255);
    pixels[offset + 3] = alphaByte;
    if (alphaByte === 0 || alpha <= 0) continue;
    pixels[offset] = Math.max(0, Math.min(255, Math.round(destination[offset] / alpha)));
    pixels[offset + 1] = Math.max(0, Math.min(255, Math.round(destination[offset + 1] / alpha)));
    pixels[offset + 2] = Math.max(0, Math.min(255, Math.round(destination[offset + 2] / alpha)));
  }
  return pixels;
}

function pixelStats(pixels, width, height) {
  let visiblePixels = 0;
  let transparentPixels = 0;
  let translucentPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha === 0) transparentPixels += 1;
      else {
        visiblePixels += 1;
        if (alpha < 255) translucentPixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (visiblePixels === 0) throw new Error('Rendered standalone has zero visible pixels.');
  return {
    visiblePixels,
    transparentPixels,
    translucentPixels,
    alphaBounds: { minX, minY, maxX, maxY },
    cornerAlpha: [
      pixels[3],
      pixels[(width - 1) * 4 + 3],
      pixels[((height - 1) * width) * 4 + 3],
      pixels[(height * width - 1) * 4 + 3],
    ],
  };
}

function publicOutput(output) {
  const { png, resolvedOutput, ...result } = output;
  return result;
}

async function writeAtomically(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.rig-standalone.tmp`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, filePath);
}

/**
 * Build all eight card/list images exclusively from rig-parts.json and its
 * current production atlas crops. This function never reads an existing
 * standalone; callers explicitly choose whether to write the newly built bytes.
 */
export async function buildRigStandalones({
  projectRoot = PROJECT_ROOT,
  manifestPath = path.join(projectRoot, 'assets/rig-parts.json'),
  assetSpecPath = path.join(projectRoot, 'assets/asset-spec.json'),
} = {}) {
  const resolvedRoot = path.resolve(projectRoot);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const assetSpec = JSON.parse(await readFile(assetSpecPath, 'utf8'));
  assertObject(manifest.rigs, 'rig-parts.json.rigs');
  if (!Array.isArray(assetSpec.assets)) throw new TypeError('asset-spec.json.assets must be an array.');
  const specsById = new Map(assetSpec.assets.map((spec) => [spec.id, spec]));
  const imageCache = new Map();

  async function loadSource(ownerId, assetPath) {
    const resolvedPath = resolveProductionSource(
      resolvedRoot,
      assetPath,
      ownerId,
      `${ownerId}.source`,
    );
    let cached = imageCache.get(resolvedPath);
    if (!cached) {
      const bytes = await readFile(resolvedPath);
      cached = {
        assetPath,
        bytesSha256: sha256(bytes),
        image: decodeRgbaPng(bytes, assetPath),
      };
      imageCache.set(resolvedPath, cached);
    }
    return cached;
  }

  const outputs = [];
  for (const ownerId of RIG_IDS) {
    const rig = manifest.rigs[ownerId];
    const spec = specsById.get(ownerId);
    assertObject(rig, `rigs.${ownerId}`);
    assertObject(spec, `asset-spec.${ownerId}`);
    if (!Array.isArray(rig.parts) || rig.parts.length === 0) {
      throw new TypeError(`${ownerId}.parts must be a non-empty array.`);
    }
    if (!['survivor', 'enemy'].includes(spec.category)) {
      throw new RangeError(`${ownerId}: expected survivor or enemy asset category.`);
    }
    const expectedSize = ownerId === 'enemy-acid-shell-king' ? 768 : 512;
    if (
      spec.width !== expectedSize
      || spec.height !== expectedSize
      || spec.recommendedCanvas?.width !== expectedSize
      || spec.recommendedCanvas?.height !== expectedSize
    ) {
      throw new RangeError(`${ownerId}: asset-spec canvas must be ${expectedSize}x${expectedSize}.`);
    }
    if (spec.transparent !== true || !Number.isInteger(spec.maxBytes) || spec.maxBytes <= 0) {
      throw new RangeError(`${ownerId}: asset-spec must require transparency and a positive byte cap.`);
    }
    const resolvedOutput = resolveOutput(resolvedRoot, spec.path, ownerId, spec.category);
    const facing = spec.category === 'enemy' ? -1 : 1;
    const layers = rig.parts
      .map((part, index) => descriptorForNormal(part, ownerId, index))
      .sort((left, right) => left.z - right.z || left.manifestIndex - right.manifestIndex);
    const logicalBounds = unionBindBounds(layers);
    const placement = placementFor(spec.width, spec.height, logicalBounds, facing);
    const destination = new Float64Array(spec.width * spec.height * 4);
    const sources = new Map();

    for (const layer of layers) {
      const source = await loadSource(ownerId, layer.sourcePath);
      assertCropInside(source.image, layer.sourceRect, `${ownerId}.${layer.id}.sourceRect`);
      sources.set(layer.sourcePath, {
        path: layer.sourcePath,
        sha256: source.bytesSha256,
        width: source.image.width,
        height: source.image.height,
      });
      compositeLayer(
        destination,
        spec.width,
        spec.height,
        source.image,
        layer,
        placement,
      );
    }

    const pixels = unpremultiply(destination, spec.width, spec.height);
    const stats = pixelStats(pixels, spec.width, spec.height);
    if (stats.transparentPixels === 0 || stats.cornerAlpha.some((alpha) => alpha !== 0)) {
      throw new Error(`${ownerId}: standalone is not transparent at its canvas corners.`);
    }
    const png = encodeStandalonePng({ width: spec.width, height: spec.height, pixels });
    if (png.length > spec.maxBytes) {
      throw new RangeError(`${ownerId}: ${png.length} PNG bytes exceed asset-spec cap ${spec.maxBytes}.`);
    }
    outputs.push({
      ownerId,
      category: spec.category,
      output: spec.path,
      resolvedOutput,
      width: spec.width,
      height: spec.height,
      maxBytes: spec.maxBytes,
      pngBytes: png.length,
      pngSha256: sha256(png),
      pixelSha256: sha256(pixels),
      expression: 'normal',
      logicalBounds,
      placement,
      stats,
      sources: [...sources.values()].sort((left, right) => left.path.localeCompare(right.path)),
      normalExpressions: Object.fromEntries(layers
        .filter(({ id }) => FACE_PARTS.has(id))
        .map((layer) => [layer.id, {
          variant: 'normal',
          kind: layer.normalKind,
          sourcePath: layer.sourcePath,
          sourceRect: layer.sourceRect,
        }])),
      layers: layers.map((layer) => ({
        id: layer.id,
        z: layer.z,
        sourcePath: layer.sourcePath,
        sourceRect: layer.sourceRect,
        bindRect: layer.bindRect,
        expression: layer.expression,
      })),
      png,
    });
  }

  return {
    schemaVersion: 1,
    generatedFrom: ['assets/rig-parts.json', 'assets/asset-spec.json'],
    renderer: 'scripts/render-rig-standalones.mjs',
    outputs,
  };
}

export async function writeRigStandalones(options = {}) {
  const report = await buildRigStandalones(options);
  for (const output of report.outputs) {
    await writeAtomically(output.resolvedOutput, output.png);
  }
  return {
    ...report,
    outputs: report.outputs.map(publicOutput),
  };
}

export async function checkRigStandalones(options = {}) {
  const report = await buildRigStandalones(options);
  for (const output of report.outputs) {
    const existing = await readFile(output.resolvedOutput);
    if (!existing.equals(output.png)) {
      throw new Error(`${output.ownerId}: checked-in standalone does not match deterministic render.`);
    }
  }
  return {
    ...report,
    outputs: report.outputs.map(publicOutput),
  };
}

function isDirectRun() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const argumentsSet = new Set(process.argv.slice(2));
  const unknown = [...argumentsSet].filter((argument) => argument !== '--check');
  if (unknown.length > 0) {
    console.error(`Unknown argument(s): ${unknown.join(', ')}`);
    process.exitCode = 1;
  } else {
    try {
      const report = argumentsSet.has('--check')
        ? await checkRigStandalones()
        : await writeRigStandalones();
      console.log(JSON.stringify({
        schemaVersion: report.schemaVersion,
        generatedFrom: report.generatedFrom,
        outputs: report.outputs.map((output) => ({
          ownerId: output.ownerId,
          output: output.output,
          dimensions: `${output.width}x${output.height}`,
          expression: output.expression,
          facing: output.placement.facing,
          pngBytes: output.pngBytes,
          pngSha256: output.pngSha256,
          alphaBounds: output.stats.alphaBounds,
          sources: output.sources.map(({ path: sourcePath, sha256: sourceSha256 }) => ({
            path: sourcePath,
            sha256: sourceSha256,
          })),
        })),
      }, null, 2));
    } catch (error) {
      console.error(error?.stack ?? error);
      process.exitCode = 1;
    }
  }
}
