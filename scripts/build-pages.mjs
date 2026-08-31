import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateRigPartManifest } from '../src/animation/rig-assets.js';
import { parsePng, verifyAssets } from './verify-assets.mjs';

export const RIG_MANIFEST_PATH = 'assets/rig-parts.json';
export const ASSET_SPEC_PATH = 'assets/asset-spec.json';
export const AUDIO_MANIFEST_PATH = 'assets/audio/manifest.json';
export const PUBLISH_ENTRIES = Object.freeze(['index.html', 'styles.css', 'src']);
export const LOCAL_OUTPUT_DIRECTORY = '_site';
export const DOCS_OUTPUT_DIRECTORY = 'docs';

const RIG_IMAGE_PREFIX = 'assets/generated-v2/rig/';
const RIG_ATLAS_PATTERN =
  /^assets\/generated-v2\/rig\/[A-Za-z0-9_-]+\/atlas(?:-layered-v[23])?\.png$/;
const RIG_IMAGE_PATTERN =
  /^assets\/generated-v2\/rig\/[A-Za-z0-9_-]+\/[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/;
const DECLARED_ASSET_PATTERN =
  /^assets\/generated\/([a-z][a-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9_.-]*\.png)$/;
const DECLARED_AUDIO_PATTERN =
  /^assets\/audio\/([a-z][a-z0-9-]*\.(?:m4a|wav))$/;
const FORBIDDEN_DERIVATIVE_PATTERN =
  /(?:^|[-_.])(source|alpha|preview|review|legacy|candidates?)(?:[-_.]|$)/i;
const VERSIONED_ATLAS_PATHS = Object.freeze({
  'survivor-shell-shell':
    'assets/generated-v2/rig/survivor-shell-shell/atlas-layered-v3.png',
  'survivor-bubble-float':
    'assets/generated-v2/rig/survivor-bubble-float/atlas-layered-v2.png',
  'enemy-acid-shell-king':
    'assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v2.png',
  'enemy-windcap':
    'assets/generated-v2/rig/enemy-windcap/atlas-layered-v2.png',
});
const IMAGE_PATTERN = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const JAVASCRIPT_MODULE_PATTERN = /\.m?js$/i;
const RELATIVE_MODULE_SPECIFIER_PATTERN =
  /\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;

export function collectDeclaredAssetPaths(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError('Asset spec must be a JSON object.');
  }
  if (spec.schemaVersion !== 1) {
    throw new TypeError('Asset spec schemaVersion must be 1.');
  }
  if (!Array.isArray(spec.assets) || spec.assets.length === 0) {
    throw new TypeError('Asset spec must contain a non-empty "assets" array.');
  }

  const ids = new Set();
  const references = new Set();
  for (const [index, asset] of spec.assets.entries()) {
    const label = asset?.id ?? `assets[${index}]`;
    if (typeof asset?.id !== 'string' || !asset.id) {
      throw new TypeError(`Asset spec entry ${index} must declare a non-empty id.`);
    }
    if (ids.has(asset.id)) throw new TypeError(`Asset spec contains duplicate id: ${asset.id}`);
    ids.add(asset.id);

    const assetPath = asset.path;
    const match = typeof assetPath === 'string' && DECLARED_ASSET_PATTERN.exec(assetPath);
    if (
      !match
      || path.posix.normalize(assetPath) !== assetPath
      || path.posix.isAbsolute(assetPath)
    ) {
      throw new TypeError(
        `Asset "${label}" must reference assets/generated/<category>/<filename>.png.`,
      );
    }
    const [, pathCategory, fileName] = match;
    if (asset.category !== pathCategory) {
      throw new TypeError(
        `Asset "${label}" path category must match its category "${asset.category}".`,
      );
    }
    if (asset.filename !== fileName) {
      throw new TypeError(
        `Asset "${label}" path filename must match its filename "${asset.filename}".`,
      );
    }
    if (FORBIDDEN_DERIVATIVE_PATTERN.test(fileName)) {
      throw new TypeError(`Asset "${label}" cannot publish derivative file ${fileName}.`);
    }
    if (references.has(assetPath)) {
      throw new TypeError(`Asset spec cannot publish one PNG path twice: ${assetPath}`);
    }
    references.add(assetPath);
  }

  return [...references].sort();
}

export function collectDeclaredAudioPaths(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('Audio manifest must be a JSON object.');
  }
  if (manifest.schemaVersion !== 1) {
    throw new TypeError('Audio manifest schemaVersion must be 1.');
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new TypeError('Audio manifest must contain a non-empty "assets" array.');
  }
  const ids = new Set();
  const paths = new Set();
  for (const [index, asset] of manifest.assets.entries()) {
    const label = asset?.id ?? `assets[${index}]`;
    if (typeof asset?.id !== 'string' || !/^(?:bgm|sfx)-[a-z0-9-]+$/.test(asset.id)) {
      throw new TypeError(`Audio asset ${label} must declare a stable bgm-* or sfx-* id.`);
    }
    if (ids.has(asset.id)) throw new TypeError(`Audio manifest contains duplicate id: ${asset.id}`);
    ids.add(asset.id);
    const match = typeof asset.path === 'string' && DECLARED_AUDIO_PATTERN.exec(asset.path);
    if (!match || path.posix.normalize(asset.path) !== asset.path || path.posix.isAbsolute(asset.path)) {
      throw new TypeError(`Audio asset "${label}" must reference assets/audio/<filename>.m4a or .wav.`);
    }
    if (paths.has(asset.path)) {
      throw new TypeError(`Audio manifest cannot publish one file twice: ${asset.path}`);
    }
    paths.add(asset.path);
    if (!['bgm', 'sfx'].includes(asset.kind)) {
      throw new TypeError(`Audio asset "${label}" kind must be bgm or sfx.`);
    }
    if (asset.loop !== (asset.kind === 'bgm')) {
      throw new TypeError(`Audio asset "${label}" loop must match its bgm/sfx kind.`);
    }
    if (!Number.isFinite(asset.volume) || asset.volume < 0 || asset.volume > 1) {
      throw new TypeError(`Audio asset "${label}" volume must be between 0 and 1.`);
    }
    if (asset.kind === 'bgm' && !asset.path.endsWith('.m4a')) {
      throw new TypeError(`Audio asset "${label}" BGM must use AAC M4A.`);
    }
    if (asset.kind === 'sfx' && !asset.path.endsWith('.wav')) {
      throw new TypeError(`Audio asset "${label}" SFX must use PCM WAV.`);
    }
  }
  return [...paths].sort();
}

export function collectRigImagePaths(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError('Rig part manifest must be a JSON object.');
  }
  if (!manifest.rigs || typeof manifest.rigs !== 'object' || Array.isArray(manifest.rigs)) {
    throw new TypeError('Rig part manifest must contain a "rigs" object.');
  }

  const rigEntries = Object.entries(manifest.rigs);
  if (rigEntries.length === 0) {
    throw new TypeError('Rig part manifest must declare at least one rig.');
  }

  const references = new Set();
  const ownersByPath = new Map();

  for (const [ownerId, rig] of rigEntries) {
    if (!rig || !Array.isArray(rig.parts) || rig.parts.length === 0) {
      throw new TypeError(`Rig "${ownerId}" must declare a non-empty parts array.`);
    }

    const rigPaths = new Set();
    for (const [partIndex, part] of rig.parts.entries()) {
      const label = `${ownerId}.${part?.id ?? `parts[${partIndex}]`}`;
      const assetPath = part?.path;
      if (typeof assetPath !== 'string' || !RIG_ATLAS_PATTERN.test(assetPath)) {
        throw new TypeError(
          `Rig part "${label}" must reference an atlas.png below ${RIG_IMAGE_PREFIX}`,
        );
      }
      if (path.posix.normalize(assetPath) !== assetPath || path.isAbsolute(assetPath)) {
        throw new TypeError(`Rig part "${label}" has an unsafe asset path: ${assetPath}`);
      }
      rigPaths.add(assetPath);
    }

    if (rigPaths.size !== 1) {
      throw new TypeError(`Rig "${ownerId}" parts must share exactly one atlas PNG path.`);
    }
    const [atlasPath] = rigPaths;
    if (ownersByPath.has(atlasPath)) {
      throw new TypeError(
        `Rig atlas path cannot be shared across rigs: ${atlasPath} `
        + `(${ownersByPath.get(atlasPath)} and ${ownerId})`,
      );
    }
    const expectedAtlasPath = VERSIONED_ATLAS_PATHS[ownerId]
      ?? `${RIG_IMAGE_PREFIX}${ownerId}/atlas.png`;
    if (atlasPath !== expectedAtlasPath) {
      throw new TypeError(`Rig "${ownerId}" atlas path must be ${expectedAtlasPath}.`);
    }
    ownersByPath.set(atlasPath, ownerId);
    references.add(atlasPath);

    for (const [partIndex, part] of rig.parts.entries()) {
      const label = `${ownerId}.${part?.id ?? `parts[${partIndex}]`}`;
      if (
        part.variants != null
        && (!part.variants || typeof part.variants !== 'object' || Array.isArray(part.variants))
      ) {
        throw new TypeError(`Rig part "${label}" variants must be a JSON object.`);
      }
      for (const [variantName, variant] of Object.entries(part.variants ?? {})) {
        if (!variant || typeof variant !== 'object' || Array.isArray(variant)) {
          throw new TypeError(`Rig part variant "${label}.${variantName}" must be a JSON object.`);
        }
        const variantPath = variant.path ?? part.path;
        assertSafeRigRuntimeImagePath(variantPath, `${label}.${variantName}`, ownerId);
        references.add(variantPath);
      }
    }
  }

  return [...references].sort();
}

function assertSafeRigRuntimeImagePath(assetPath, label, ownerId) {
  const expectedPrefix = `${RIG_IMAGE_PREFIX}${ownerId}/`;
  const fileName = typeof assetPath === 'string' ? path.posix.basename(assetPath) : '';
  if (
    typeof assetPath !== 'string'
    || !RIG_IMAGE_PATTERN.test(assetPath)
    || !assetPath.startsWith(expectedPrefix)
    || path.posix.normalize(assetPath) !== assetPath
    || path.posix.isAbsolute(assetPath)
    || FORBIDDEN_DERIVATIVE_PATTERN.test(fileName)
  ) {
    throw new TypeError(
      `Rig part variant "${label}" must reference a PNG directly below ${expectedPrefix}`,
    );
  }
}

export async function readRigManifest(projectRoot) {
  const manifestFile = path.join(projectRoot, RIG_MANIFEST_PATH);
  let source;
  try {
    source = await readFile(manifestFile, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read rig part manifest at ${RIG_MANIFEST_PATH}: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${RIG_MANIFEST_PATH}: ${error.message}`);
  }

  try {
    return validateRigPartManifest(parsed);
  } catch (error) {
    throw new Error(`Invalid rig contract in ${RIG_MANIFEST_PATH}: ${error.message}`);
  }
}

export async function readAssetSpec(projectRoot) {
  const specFile = path.join(projectRoot, ASSET_SPEC_PATH);
  let source;
  try {
    source = await readFile(specFile, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read asset spec at ${ASSET_SPEC_PATH}: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${ASSET_SPEC_PATH}: ${error.message}`);
  }

  try {
    collectDeclaredAssetPaths(parsed);
  } catch (error) {
    throw new Error(`Invalid asset contract in ${ASSET_SPEC_PATH}: ${error.message}`);
  }
  return parsed;
}

export async function readAudioManifest(projectRoot, { optional = true } = {}) {
  const manifestFile = path.join(projectRoot, AUDIO_MANIFEST_PATH);
  let source;
  try {
    source = await readFile(manifestFile, 'utf8');
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return null;
    throw new Error(`Cannot read audio manifest at ${AUDIO_MANIFEST_PATH}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${AUDIO_MANIFEST_PATH}: ${error.message}`);
  }
  try {
    collectDeclaredAudioPaths(parsed);
  } catch (error) {
    throw new Error(`Invalid audio contract in ${AUDIO_MANIFEST_PATH}: ${error.message}`);
  }
  return parsed;
}

async function assertPngImagesExist(projectRoot, imagePaths, kind) {
  const missing = [];
  const invalid = [];

  await Promise.all(imagePaths.map(async (assetPath) => {
    const source = path.join(projectRoot, ...assetPath.split('/'));
    try {
      const info = await lstat(source);
      if (!info.isFile()) {
        invalid.push(`${assetPath} (not a regular file)`);
        return;
      }
      try {
        parsePng(await readFile(source));
      } catch (error) {
        invalid.push(`${assetPath} (${error.message})`);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') missing.push(assetPath);
      else throw error;
    }
  }));

  if (missing.length > 0 || invalid.length > 0) {
    const details = [
      ...missing.sort().map((assetPath) => `missing: ${assetPath}`),
      ...invalid.sort().map((assetPath) => `invalid: ${assetPath}`),
    ];
    throw new Error(
      `Cannot build GitHub Pages: ${details.length} ${kind} PNG asset(s) failed validation:\n`
      + details.map((detail) => `  - ${detail}`).join('\n'),
    );
  }
}

export async function assertRigImagesExist(projectRoot, imagePaths) {
  return assertPngImagesExist(projectRoot, imagePaths, 'rig');
}

export async function assertDeclaredAssetsExist(projectRoot, imagePaths) {
  return assertPngImagesExist(projectRoot, imagePaths, 'declared');
}

async function assertAssetSpecPngsValid(projectRoot, phase) {
  const result = await verifyAssets({
    specPath: path.join(projectRoot, ASSET_SPEC_PATH),
    cwd: projectRoot,
    allowMissingSpec: false,
  });
  if (result.ok) return result;

  const details = result.errors.map((error) => {
    const subject = error.path ?? error.id;
    return `[${error.code}] ${subject ? `${subject}: ` : ''}${error.message}`;
  });
  throw new Error(
    `Cannot build GitHub Pages: ${phase} asset-spec PNG validation failed `
    + `with ${details.length} error(s):\n`
    + details.map((detail) => `  - ${detail}`).join('\n'),
  );
}

export async function listImageFiles(directory) {
  const entries = await readdir(directory, { recursive: true });
  return entries
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((entry) => IMAGE_PATTERN.test(entry))
    .sort();
}

export async function listAudioFiles(directory) {
  const entries = await readdir(directory, { recursive: true });
  return entries
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((entry) => /\.(?:m4a|wav)$/i.test(entry))
    .sort();
}

export async function assertAudioAssetsExist(projectRoot, audioPaths) {
  const problems = [];
  await Promise.all(audioPaths.map(async (audioPath) => {
    const filename = path.join(projectRoot, ...audioPath.split('/'));
    try {
      const info = await lstat(filename);
      if (!info.isFile() || info.size < 64) {
        problems.push(`${audioPath} is missing usable audio data`);
        return;
      }
      const contents = await readFile(filename);
      const validWav = audioPath.endsWith('.wav')
        && contents.toString('ascii', 0, 4) === 'RIFF'
        && contents.toString('ascii', 8, 12) === 'WAVE';
      const validM4a = audioPath.endsWith('.m4a')
        && contents.toString('ascii', 4, 8) === 'ftyp';
      if (!validWav && !validM4a) problems.push(`${audioPath} has an invalid container header`);
    } catch (error) {
      if (error?.code === 'ENOENT') problems.push(`${audioPath} is missing`);
      else throw error;
    }
  }));
  if (problems.length) {
    throw new Error(
      `Cannot build GitHub Pages: ${problems.length} audio asset(s) failed validation:\n`
      + problems.sort().map((problem) => `  - ${problem}`).join('\n'),
    );
  }
}

function pathIsInside(parentDirectory, candidatePath) {
  const relative = path.relative(parentDirectory, candidatePath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function collectRelativeModuleSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(RELATIVE_MODULE_SPECIFIER_PATTERN)) {
    specifiers.push(match[1] ?? match[2]);
  }
  return specifiers;
}

async function assertPublishedFile(outputDirectory, sourceFile, specifier, problems) {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  const resolvedPath = path.resolve(path.dirname(sourceFile), cleanSpecifier);
  if (!pathIsInside(outputDirectory, resolvedPath)) {
    problems.push(`${path.relative(outputDirectory, sourceFile)} imports outside output: ${specifier}`);
    return;
  }
  try {
    const information = await lstat(resolvedPath);
    if (!information.isFile()) {
      problems.push(`${path.relative(outputDirectory, sourceFile)} imports a non-file: ${specifier}`);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      problems.push(`${path.relative(outputDirectory, sourceFile)} cannot resolve: ${specifier}`);
      return;
    }
    throw error;
  }
}

/**
 * GitHub Pages serves browser modules without a bundler. Validate the copied
 * HTML entry and every relative ESM import exactly as the browser will resolve
 * them, including modules that are currently platform-specific.
 */
export async function verifyPublishedModules(outputDirectory) {
  const root = path.resolve(outputDirectory);
  const indexPath = path.join(root, 'index.html');
  const indexSource = await readFile(indexPath, 'utf8');
  const moduleEntrypoints = [];
  for (const [tag] of indexSource.matchAll(/<script\b[^>]*>/gi)) {
    if (!/\btype\s*=\s*['"]module['"]/i.test(tag)) continue;
    const sourceMatch = /\bsrc\s*=\s*['"]([^'"]+)['"]/i.exec(tag);
    if (sourceMatch) moduleEntrypoints.push(sourceMatch[1]);
  }
  if (moduleEntrypoints.length === 0) {
    throw new Error('Pages output index.html must declare a module script with a relative src.');
  }

  const problems = [];
  for (const entrypoint of moduleEntrypoints) {
    if (!entrypoint.startsWith('.')) {
      problems.push(`index.html module entry must be relative: ${entrypoint}`);
      continue;
    }
    await assertPublishedFile(root, indexPath, entrypoint, problems);
  }

  const sourceDirectory = path.join(root, 'src');
  const sourceEntries = await readdir(sourceDirectory, { recursive: true });
  const modulePaths = sourceEntries
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((entry) => JAVASCRIPT_MODULE_PATTERN.test(entry))
    .sort();
  if (modulePaths.length === 0) {
    problems.push('src does not contain any JavaScript modules.');
  }

  for (const modulePath of modulePaths) {
    const sourceFile = path.join(sourceDirectory, ...modulePath.split('/'));
    const source = await readFile(sourceFile, 'utf8');
    for (const specifier of collectRelativeModuleSpecifiers(source)) {
      await assertPublishedFile(root, sourceFile, specifier, problems);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Pages output contains ${problems.length} unresolved module path(s):\n`
      + problems.map((problem) => `  - ${problem}`).join('\n'),
    );
  }
  return Object.freeze({
    entrypoints: Object.freeze([...moduleEntrypoints]),
    modulePaths: Object.freeze(modulePaths.map((modulePath) => `src/${modulePath}`)),
  });
}

export async function verifyPagesOutput(
  outputDirectory,
  {
    assetPaths: expectedAssetPaths,
    rigImagePaths: expectedRigImagePaths,
    audioPaths: expectedAudioPaths = [],
  },
) {
  await verifyPublishedModules(outputDirectory);
  const copiedSpec = await readAssetSpec(outputDirectory);
  const copiedAssetReferences = collectDeclaredAssetPaths(copiedSpec);
  assertSamePaths(
    copiedAssetReferences,
    expectedAssetPaths,
    'The copied asset spec does not match the source asset spec.',
  );

  const copiedManifest = await readRigManifest(outputDirectory);
  const copiedReferences = collectRigImagePaths(copiedManifest);
  assertSamePaths(
    copiedReferences,
    expectedRigImagePaths,
    'The copied rig manifest does not match the source manifest.',
  );

  const expectedImagePaths = [...new Set([
    ...expectedAssetPaths,
    ...expectedRigImagePaths,
  ])].sort();
  const outputImages = await listImageFiles(outputDirectory);
  assertSamePaths(
    outputImages,
    expectedImagePaths,
    'Pages output image files must exactly equal the two manifest reference sets.',
  );
  await assertAssetSpecPngsValid(outputDirectory, 'staging');
  await assertDeclaredAssetsExist(outputDirectory, expectedAssetPaths);
  await assertRigImagesExist(outputDirectory, expectedRigImagePaths);
  const outputAudio = await listAudioFiles(outputDirectory);
  assertSamePaths(
    outputAudio,
    expectedAudioPaths,
    'Pages output audio files must exactly equal the audio manifest reference set.',
  );
  if (expectedAudioPaths.length) {
    const copiedAudioManifest = await readAudioManifest(outputDirectory, { optional: false });
    assertSamePaths(
      collectDeclaredAudioPaths(copiedAudioManifest),
      expectedAudioPaths,
      'The copied audio manifest does not match the source audio manifest.',
    );
    await assertAudioAssetsExist(outputDirectory, expectedAudioPaths);
  }
}

export async function buildPages({ projectRoot, outputDirectory } = {}) {
  const root = path.resolve(projectRoot ?? fileURLToPath(new URL('../', import.meta.url)));
  const target = path.resolve(outputDirectory ?? path.join(root, LOCAL_OUTPUT_DIRECTORY));
  assertSafeOutputDirectory(root, target);

  const spec = await readAssetSpec(root);
  const assetPaths = collectDeclaredAssetPaths(spec);
  const manifest = await readRigManifest(root);
  const rigImagePaths = collectRigImagePaths(manifest);
  const imagePaths = [...new Set([...assetPaths, ...rigImagePaths])].sort();
  const audioManifest = await readAudioManifest(root);
  const audioPaths = audioManifest ? collectDeclaredAudioPaths(audioManifest) : [];

  for (const entry of PUBLISH_ENTRIES) {
    try {
      await access(path.join(root, entry));
    } catch (error) {
      throw new Error(`Cannot build GitHub Pages: missing publish entry "${entry}" (${error.message})`);
    }
  }
  await assertAssetSpecPngsValid(root, 'source');
  await assertDeclaredAssetsExist(root, assetPaths);
  await assertRigImagesExist(root, rigImagePaths);
  await assertAudioAssetsExist(root, audioPaths);

  const stagingDirectory = await mkdtemp(path.join(root, '.pages-build-'));
  try {
    for (const entry of PUBLISH_ENTRIES) {
      await cp(path.join(root, entry), path.join(stagingDirectory, entry), {
        recursive: true,
      });
    }

    await copyProjectFile(root, stagingDirectory, ASSET_SPEC_PATH);
    await copyProjectFile(root, stagingDirectory, RIG_MANIFEST_PATH);
    if (audioManifest) await copyProjectFile(root, stagingDirectory, AUDIO_MANIFEST_PATH);
    for (const assetPath of imagePaths) {
      await copyProjectFile(root, stagingDirectory, assetPath);
    }
    for (const audioPath of audioPaths) {
      await copyProjectFile(root, stagingDirectory, audioPath);
    }

    await verifyPagesOutput(stagingDirectory, { assetPaths, rigImagePaths, audioPaths });
    await rm(target, { recursive: true, force: true });
    await rename(stagingDirectory, target);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }

  return {
    outputDirectory: target,
    assetSpecPath: ASSET_SPEC_PATH,
    manifestPath: RIG_MANIFEST_PATH,
    assetPaths,
    rigImagePaths,
    imagePaths,
    audioManifestPath: audioManifest ? AUDIO_MANIFEST_PATH : null,
    audioPaths,
  };
}

function assertSafeOutputDirectory(projectRoot, outputDirectory) {
  const relative = path.relative(projectRoot, outputDirectory);
  const allowed = new Set([LOCAL_OUTPUT_DIRECTORY, DOCS_OUTPUT_DIRECTORY]);
  if (!allowed.has(relative)) {
    throw new Error(
      `Refusing to replace unsafe Pages output directory "${outputDirectory}". `
      + `Allowed outputs are ${[...allowed].join(' and ')} below the project root.`,
    );
  }
}

async function copyProjectFile(projectRoot, outputDirectory, relativePath) {
  const destination = path.join(outputDirectory, ...relativePath.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(projectRoot, ...relativePath.split('/')), destination);
}

function assertSamePaths(actual, expected, message) {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (
    normalizedActual.length !== normalizedExpected.length
    || normalizedActual.some((entry, index) => entry !== normalizedExpected[index])
  ) {
    const actualSet = new Set(normalizedActual);
    const expectedSet = new Set(normalizedExpected);
    const missing = normalizedExpected.filter((entry) => !actualSet.has(entry));
    const unexpected = normalizedActual.filter((entry) => !expectedSet.has(entry));
    throw new Error(
      `${message}\n`
      + `Missing: ${missing.join(', ') || '(none)'}\n`
      + `Unexpected: ${unexpected.join(', ') || '(none)'}`,
    );
  }
}

function parseCliOutput(args, projectRoot) {
  if (args.length === 0) return path.join(projectRoot, LOCAL_OUTPUT_DIRECTORY);
  if (args.length === 2 && args[0] === '--output') {
    if (![LOCAL_OUTPUT_DIRECTORY, DOCS_OUTPUT_DIRECTORY].includes(args[1])) {
      throw new Error(`--output must be "${LOCAL_OUTPUT_DIRECTORY}" or "${DOCS_OUTPUT_DIRECTORY}".`);
    }
    return path.join(projectRoot, args[1]);
  }
  throw new Error(
    `Usage: node scripts/build-pages.mjs [--output ${LOCAL_OUTPUT_DIRECTORY}|${DOCS_OUTPUT_DIRECTORY}]`,
  );
}

const isDirectRun = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  try {
    const outputDirectory = parseCliOutput(process.argv.slice(2), projectRoot);
    const result = await buildPages({ projectRoot, outputDirectory });
    console.log(
      `GitHub Pages site built at ${result.outputDirectory} `
      + `with ${result.imagePaths.length} manifest-listed PNG files `
      + `and ${result.audioPaths.length} audio files.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
