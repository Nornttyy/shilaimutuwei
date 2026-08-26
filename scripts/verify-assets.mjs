#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEFAULT_SPEC_PATH = 'assets/asset-spec.json';
export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const REQUIRED_ASSET_FIELDS = Object.freeze([
  'id',
  'path',
  'width',
  'height',
  'category',
  'maxBytes',
]);

const PNG_COLOR_TYPES = Object.freeze({
  0: 'grayscale',
  2: 'RGB',
  3: 'indexed',
  4: 'grayscale-alpha',
  6: 'RGBA',
});

const NAMED_COLOR_TYPES = Object.freeze({
  grayscale: 0,
  grey: 0,
  gray: 0,
  rgb: 2,
  indexed: 3,
  palette: 3,
  'grayscale-alpha': 4,
  'grey-alpha': 4,
  'gray-alpha': 4,
  rgba: 6,
});

const BACKGROUND_CATEGORIES = new Set([
  'background',
  'backgrounds',
  'bg',
  'scene-background',
]);

function issue(code, message, asset = null, details = {}) {
  return {
    code,
    message,
    ...(asset?.id ? { id: asset.id } : {}),
    ...(asset?.path ? { path: asset.path } : {}),
    ...details,
  };
}

function field(asset, primary, aliases = []) {
  if (asset?.[primary] != null) return asset[primary];
  for (const alias of aliases) {
    if (asset?.[alias] != null) return asset[alias];
  }
  return undefined;
}

function normalizedAsset(raw) {
  const dimensions = raw?.dimensions ?? raw?.size;
  return {
    raw,
    id: field(raw, 'id', ['assetId', 'key']),
    path: field(raw, 'path', ['file', 'src', 'filePath']),
    width: field(raw, 'width') ?? dimensions?.width ?? dimensions?.[0],
    height: field(raw, 'height') ?? dimensions?.height ?? dimensions?.[1],
    category: field(raw, 'category', ['kind', 'assetType', 'type']),
    maxBytes: field(raw, 'maxBytes', ['maxFileSize', 'maxSizeBytes']),
    minBytes: field(raw, 'minBytes', ['minFileSize', 'minSizeBytes']),
    expectedBytes: field(raw, 'expectedBytes', ['fileSizeBytes']),
    colorType: field(raw, 'colorType', ['pngColorType']),
    alpha: field(raw, 'alpha', ['requiresAlpha', 'hasAlpha', 'transparent']),
    background: raw?.background === true || raw?.isBackground === true,
  };
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function manifestAssets(manifest) {
  if (Array.isArray(manifest)) return manifest;
  if (manifest && Array.isArray(manifest.assets)) return manifest.assets;
  return null;
}

function normalizeExpectedColorType(value) {
  if (value == null) return null;
  if (Number.isInteger(value) && PNG_COLOR_TYPES[value]) return value;
  if (typeof value === 'string') return NAMED_COLOR_TYPES[value.trim().toLowerCase()] ?? null;
  return null;
}

function isBackground(asset) {
  if (asset.background) return true;
  const category = String(asset.category ?? '').trim().toLowerCase();
  return BACKGROUND_CATEGORIES.has(category) || category.startsWith('background-');
}

function printableBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/**
 * Parse enough of a PNG to validate its signature, chunk framing and IHDR.
 * CRC/image decoding is intentionally left to image tooling; this is a fast
 * package-level QA check requiring no native or npm dependencies.
 */
export function parsePng(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid PNG signature.');
  }

  let offset = 8;
  let chunkIndex = 0;
  let ihdr = null;
  let hasTransparencyChunk = false;
  let hasImageData = false;
  let hasEnd = false;
  const chunks = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) throw new Error('PNG chunk extends beyond the file.');

    const type = buffer.toString('ascii', typeStart, typeStart + 4);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('PNG contains an invalid chunk type.');
    chunks.push(type);

    if (chunkIndex === 0 && type !== 'IHDR') throw new Error('IHDR must be the first PNG chunk.');
    if (type === 'IHDR') {
      if (ihdr) throw new Error('PNG contains multiple IHDR chunks.');
      if (length !== 13) throw new Error('IHDR must contain exactly 13 bytes.');
      ihdr = {
        width: buffer.readUInt32BE(dataStart),
        height: buffer.readUInt32BE(dataStart + 4),
        bitDepth: buffer[dataStart + 8],
        colorType: buffer[dataStart + 9],
        compression: buffer[dataStart + 10],
        filter: buffer[dataStart + 11],
        interlace: buffer[dataStart + 12],
      };
    } else if (type === 'tRNS') {
      hasTransparencyChunk = true;
    } else if (type === 'IDAT') {
      hasImageData = true;
    } else if (type === 'IEND') {
      if (length !== 0) throw new Error('IEND must be empty.');
      hasEnd = true;
      offset = chunkEnd;
      break;
    }

    offset = chunkEnd;
    chunkIndex += 1;
  }

  if (!ihdr) throw new Error('PNG is missing IHDR.');
  if (!hasImageData) throw new Error('PNG is missing IDAT image data.');
  if (!hasEnd) throw new Error('PNG is missing IEND.');
  if (ihdr.width === 0 || ihdr.height === 0) throw new Error('PNG dimensions must be positive.');
  if (!PNG_COLOR_TYPES[ihdr.colorType]) {
    throw new Error(`Unsupported PNG color type ${ihdr.colorType}.`);
  }
  if (ihdr.compression !== 0 || ihdr.filter !== 0 || ![0, 1].includes(ihdr.interlace)) {
    throw new Error('PNG uses invalid IHDR method values.');
  }

  const hasAlphaChannel = ihdr.colorType === 4 || ihdr.colorType === 6;
  return {
    ...ihdr,
    colorTypeName: PNG_COLOR_TYPES[ihdr.colorType],
    hasAlphaChannel,
    hasTransparency: hasAlphaChannel || hasTransparencyChunk,
    hasTransparencyChunk,
    chunks,
    trailingBytes: buffer.length - offset,
  };
}

export async function readPngMetadata(filePath) {
  const buffer = await readFile(filePath);
  return { ...parsePng(buffer), bytes: buffer.length };
}

async function chooseAssetPath(assetPath, { projectRoot, specDirectory, baseDirectory }) {
  if (path.isAbsolute(assetPath)) {
    return { error: 'Asset paths must be relative to the project.', resolvedPath: assetPath };
  }
  if (assetPath.split(/[\\/]+/).includes('..')) {
    return { error: 'Asset paths cannot contain parent-directory traversal.', resolvedPath: assetPath };
  }

  const bases = [baseDirectory, projectRoot, specDirectory]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
  const candidates = bases.map((base) => path.resolve(base, assetPath));
  const safeCandidates = candidates.filter((candidate) => isInside(projectRoot, candidate));
  if (safeCandidates.length === 0) {
    return { error: 'Asset path escapes the project root.', resolvedPath: candidates[0] };
  }

  for (const candidate of safeCandidates) {
    try {
      const information = await stat(candidate);
      if (information.isFile()) return { resolvedPath: candidate, information };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return { resolvedPath: safeCandidates[0], information: null };
}

/** Validate an already parsed manifest and all PNG files it references. */
export async function validateAssetManifest(manifest, {
  specPath = path.resolve(DEFAULT_SPEC_PATH),
  projectRoot = path.dirname(path.dirname(path.resolve(specPath))),
} = {}) {
  const errors = [];
  const warnings = [];
  const checkedAssets = [];
  const rawAssets = manifestAssets(manifest);
  const resolvedSpecPath = path.resolve(specPath);
  const specDirectory = path.dirname(resolvedSpecPath);
  const requestedBase = !Array.isArray(manifest) ? manifest?.baseDir : null;
  const baseDirectory = requestedBase
    ? path.resolve(projectRoot, requestedBase)
    : projectRoot;

  if (!isInside(projectRoot, baseDirectory)) {
    errors.push(issue('INVALID_BASE_DIRECTORY', 'Manifest baseDir escapes the project root.'));
  }
  if (!rawAssets) {
    errors.push(issue(
      'INVALID_ASSET_LIST',
      'asset-spec.json must be an array or an object containing an assets array.',
    ));
    return summaryResult({ errors, warnings, checkedAssets, assetCount: 0 });
  }
  if (rawAssets.length === 0) {
    errors.push(issue('EMPTY_ASSET_LIST', 'asset-spec.json contains no assets.'));
  }

  const seenIds = new Map();
  const seenPaths = new Map();
  for (let index = 0; index < rawAssets.length; index += 1) {
    const raw = rawAssets[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(issue('INVALID_ASSET_ENTRY', `Asset entry ${index} must be an object.`));
      continue;
    }
    const asset = normalizedAsset(raw);

    if (typeof asset.id !== 'string' || asset.id.trim() === '') {
      errors.push(issue('MISSING_FIELD', `Asset entry ${index} is missing a non-empty id.`, asset, { field: 'id' }));
    } else if (seenIds.has(asset.id)) {
      errors.push(issue(
        'DUPLICATE_ID',
        `Duplicate asset id "${asset.id}" (entries ${seenIds.get(asset.id)} and ${index}).`,
        asset,
        { firstIndex: seenIds.get(asset.id), duplicateIndex: index },
      ));
    } else {
      seenIds.set(asset.id, index);
    }

    if (typeof asset.path !== 'string' || asset.path.trim() === '') {
      errors.push(issue('MISSING_FIELD', `Asset "${asset.id ?? index}" is missing path.`, asset, { field: 'path' }));
    }
    if (!isPositiveInteger(asset.width)) {
      errors.push(issue('MISSING_FIELD', `Asset "${asset.id ?? index}" needs a positive integer width.`, asset, { field: 'width' }));
    }
    if (!isPositiveInteger(asset.height)) {
      errors.push(issue('MISSING_FIELD', `Asset "${asset.id ?? index}" needs a positive integer height.`, asset, { field: 'height' }));
    }
    if (typeof asset.category !== 'string' || asset.category.trim() === '') {
      errors.push(issue('MISSING_FIELD', `Asset "${asset.id ?? index}" is missing category.`, asset, { field: 'category' }));
    }
    if (!isPositiveInteger(asset.maxBytes)) {
      errors.push(issue('MISSING_FIELD', `Asset "${asset.id ?? index}" needs a positive integer maxBytes.`, asset, { field: 'maxBytes' }));
    }
    if (asset.minBytes != null && !isNonNegativeInteger(asset.minBytes)) {
      errors.push(issue('INVALID_FIELD', `Asset "${asset.id ?? index}" has invalid minBytes.`, asset, { field: 'minBytes' }));
    }
    if (asset.expectedBytes != null && !isPositiveInteger(asset.expectedBytes)) {
      errors.push(issue('INVALID_FIELD', `Asset "${asset.id ?? index}" has invalid expectedBytes.`, asset, { field: 'expectedBytes' }));
    }

    if (typeof asset.path !== 'string' || asset.path.trim() === '') continue;
    if (path.extname(asset.path).toLowerCase() !== '.png') {
      errors.push(issue('NOT_PNG_PATH', 'Asset path must end in .png.', asset));
      continue;
    }
    const normalizedPath = asset.path.replaceAll('\\', '/');
    if (seenPaths.has(normalizedPath)) {
      warnings.push(issue(
        'DUPLICATE_PATH',
        `Asset path is also used by "${seenPaths.get(normalizedPath)}".`,
        asset,
      ));
    } else {
      seenPaths.set(normalizedPath, asset.id ?? `entry-${index}`);
    }

    let located;
    try {
      located = await chooseAssetPath(asset.path, {
        projectRoot,
        specDirectory,
        baseDirectory: isInside(projectRoot, baseDirectory) ? baseDirectory : projectRoot,
      });
    } catch (error) {
      errors.push(issue('FILE_STAT_FAILED', `Could not inspect asset: ${error.message}`, asset));
      continue;
    }
    if (located.error) {
      errors.push(issue('UNSAFE_PATH', located.error, asset));
      continue;
    }
    if (!located.information) {
      errors.push(issue('FILE_NOT_FOUND', 'Referenced PNG file does not exist.', asset));
      continue;
    }

    const fileBytes = located.information.size;
    if (fileBytes <= 0) errors.push(issue('EMPTY_FILE', 'PNG file is empty.', asset));
    if (isPositiveInteger(asset.maxBytes) && fileBytes > asset.maxBytes) {
      errors.push(issue(
        'FILE_TOO_LARGE',
        `File is ${printableBytes(fileBytes)}; limit is ${printableBytes(asset.maxBytes)}.`,
        asset,
        { actualBytes: fileBytes, maxBytes: asset.maxBytes },
      ));
    }
    if (isNonNegativeInteger(asset.minBytes) && fileBytes < asset.minBytes) {
      errors.push(issue(
        'FILE_TOO_SMALL',
        `File is ${printableBytes(fileBytes)}; minimum is ${printableBytes(asset.minBytes)}.`,
        asset,
        { actualBytes: fileBytes, minBytes: asset.minBytes },
      ));
    }
    if (isPositiveInteger(asset.expectedBytes) && fileBytes !== asset.expectedBytes) {
      errors.push(issue(
        'FILE_SIZE_MISMATCH',
        `File is ${fileBytes} bytes; manifest expects ${asset.expectedBytes}.`,
        asset,
        { actualBytes: fileBytes, expectedBytes: asset.expectedBytes },
      ));
    }

    let png;
    try {
      png = await readPngMetadata(located.resolvedPath);
    } catch (error) {
      errors.push(issue('INVALID_PNG', error.message, asset));
      continue;
    }

    if (isPositiveInteger(asset.width) && png.width !== asset.width) {
      errors.push(issue(
        'WIDTH_MISMATCH',
        `PNG width is ${png.width}; manifest expects ${asset.width}.`,
        asset,
        { actual: png.width, expected: asset.width },
      ));
    }
    if (isPositiveInteger(asset.height) && png.height !== asset.height) {
      errors.push(issue(
        'HEIGHT_MISMATCH',
        `PNG height is ${png.height}; manifest expects ${asset.height}.`,
        asset,
        { actual: png.height, expected: asset.height },
      ));
    }

    const explicitColorType = normalizeExpectedColorType(asset.colorType);
    if (asset.colorType != null && explicitColorType == null) {
      errors.push(issue('INVALID_FIELD', 'colorType must be a PNG color type number or name.', asset, { field: 'colorType' }));
    } else if (explicitColorType != null && png.colorType !== explicitColorType) {
      errors.push(issue(
        'COLOR_TYPE_MISMATCH',
        `PNG is ${png.colorTypeName}; manifest expects ${PNG_COLOR_TYPES[explicitColorType]}.`,
        asset,
        { actual: png.colorType, expected: explicitColorType },
      ));
    }

    if (asset.alpha === true && !png.hasAlphaChannel) {
      errors.push(issue('ALPHA_REQUIRED', 'Manifest requires an alpha channel.', asset));
    } else if (asset.alpha === false && png.hasAlphaChannel) {
      errors.push(issue('ALPHA_NOT_EXPECTED', 'Manifest requires a PNG without an alpha channel.', asset));
    }

    if (isBackground(asset)) {
      if (![2, 6].includes(png.colorType)) {
        errors.push(issue(
          'BACKGROUND_COLOR_TYPE',
          `Background PNG must be RGB or RGBA, not ${png.colorTypeName}.`,
          asset,
        ));
      }
    } else if (png.colorType !== 6) {
      errors.push(issue(
        'PNG_RGBA_REQUIRED',
        `Non-background PNG must use RGBA color type 6; found ${png.colorTypeName}.`,
        asset,
        { actualColorType: png.colorType },
      ));
    }

    checkedAssets.push({
      id: asset.id,
      path: asset.path,
      resolvedPath: located.resolvedPath,
      category: asset.category,
      width: png.width,
      height: png.height,
      bytes: fileBytes,
      colorType: png.colorType,
      colorTypeName: png.colorTypeName,
      hasAlphaChannel: png.hasAlphaChannel,
    });
  }

  const declaredTotalLimit = !Array.isArray(manifest)
    ? field(manifest, 'maxTotalBytes', ['totalMaxBytes'])
    : null;
  const totalBytes = checkedAssets.reduce((sum, asset) => sum + asset.bytes, 0);
  if (declaredTotalLimit != null && !isPositiveInteger(declaredTotalLimit)) {
    errors.push(issue('INVALID_FIELD', 'maxTotalBytes must be a positive integer.', null, { field: 'maxTotalBytes' }));
  } else if (isPositiveInteger(declaredTotalLimit) && totalBytes > declaredTotalLimit) {
    errors.push(issue(
      'TOTAL_SIZE_EXCEEDED',
      `Asset total is ${printableBytes(totalBytes)}; limit is ${printableBytes(declaredTotalLimit)}.`,
      null,
      { actualBytes: totalBytes, maxBytes: declaredTotalLimit },
    ));
  }

  return summaryResult({
    errors,
    warnings,
    checkedAssets,
    assetCount: rawAssets.length,
  });
}

function summaryResult({ errors, warnings, checkedAssets, assetCount, skipped = false, specPath = null }) {
  const totalBytes = checkedAssets.reduce((sum, asset) => sum + asset.bytes, 0);
  return {
    ok: errors.length === 0,
    skipped,
    specPath,
    errors,
    warnings,
    assets: checkedAssets,
    summary: {
      declaredAssets: assetCount,
      checkedAssets: checkedAssets.length,
      totalBytes,
      totalSize: printableBytes(totalBytes),
    },
  };
}

/** Read asset-spec.json and validate it. Missing manifests are optionally skipped. */
export async function verifyAssets({
  specPath = DEFAULT_SPEC_PATH,
  cwd = process.cwd(),
  allowMissingSpec = true,
} = {}) {
  const resolvedSpecPath = path.isAbsolute(specPath)
    ? specPath
    : path.resolve(cwd, specPath);
  let source;
  try {
    source = await readFile(resolvedSpecPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT' && allowMissingSpec) {
      return summaryResult({
        errors: [],
        warnings: [issue('SPEC_NOT_FOUND', `Asset manifest not found: ${resolvedSpecPath}`)],
        checkedAssets: [],
        assetCount: 0,
        skipped: true,
        specPath: resolvedSpecPath,
      });
    }
    return summaryResult({
      errors: [issue('SPEC_READ_FAILED', `Could not read asset manifest: ${error.message}`)],
      warnings: [],
      checkedAssets: [],
      assetCount: 0,
      specPath: resolvedSpecPath,
    });
  }

  let manifest;
  try {
    manifest = JSON.parse(source.replace(/^\uFEFF/, ''));
  } catch (error) {
    return summaryResult({
      errors: [issue('INVALID_JSON', `Could not parse asset manifest: ${error.message}`)],
      warnings: [],
      checkedAssets: [],
      assetCount: 0,
      specPath: resolvedSpecPath,
    });
  }

  const result = await validateAssetManifest(manifest, {
    specPath: resolvedSpecPath,
    projectRoot: path.dirname(path.dirname(resolvedSpecPath)),
  });
  return { ...result, specPath: resolvedSpecPath };
}

function printResult(result) {
  if (result.skipped) {
    console.log(`○ 素材 QA 跳过：${result.warnings[0]?.message ?? '清单尚未生成'}`);
    return;
  }
  for (const warning of result.warnings) {
    console.warn(`△ [${warning.code}] ${warning.id ? `${warning.id}: ` : ''}${warning.message}`);
  }
  for (const error of result.errors) {
    console.error(`✗ [${error.code}] ${error.id ? `${error.id}: ` : ''}${error.message}`);
  }
  if (result.ok) {
    console.log(
      `✓ 素材 QA 通过：${result.summary.checkedAssets} 个 PNG，合计 ${result.summary.totalSize}`,
    );
  } else {
    console.error(
      `素材 QA 失败：${result.errors.length} 个错误，已检查 ${result.summary.checkedAssets}/${result.summary.declaredAssets} 个资源。`,
    );
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const positional = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  const strict = process.argv.includes('--strict') || process.argv.includes('--require-spec');
  const result = await verifyAssets({
    specPath: positional[0] ?? DEFAULT_SPEC_PATH,
    allowMissingSpec: !strict,
  });
  printResult(result);
  if (!result.ok) process.exitCode = 1;
}

export const modulePath = fileURLToPath(import.meta.url);
