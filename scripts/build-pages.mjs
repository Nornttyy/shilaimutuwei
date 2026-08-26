import {
  access,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateRigPartManifest } from '../src/animation/rig-assets.js';

export const RIG_MANIFEST_PATH = 'assets/rig-parts.json';
export const PUBLISH_ENTRIES = Object.freeze(['index.html', 'styles.css', 'src']);
export const LOCAL_OUTPUT_DIRECTORY = '_site';
export const DOCS_OUTPUT_DIRECTORY = 'docs';

const RIG_IMAGE_PREFIX = 'assets/generated-v2/rig/';
const RIG_ATLAS_PATTERN = /^assets\/generated-v2\/rig\/[A-Za-z0-9_-]+\/atlas\.png$/;
const IMAGE_PATTERN = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

  const references = [];
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
    const expectedAtlasPath = `${RIG_IMAGE_PREFIX}${ownerId}/atlas.png`;
    if (atlasPath !== expectedAtlasPath) {
      throw new TypeError(`Rig "${ownerId}" atlas path must be ${expectedAtlasPath}.`);
    }
    ownersByPath.set(atlasPath, ownerId);
    references.push(atlasPath);
  }

  return references.sort();
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

export async function assertRigImagesExist(projectRoot, imagePaths) {
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
      const signature = Buffer.alloc(PNG_SIGNATURE.length);
      const file = await open(source, 'r');
      try {
        await file.read(signature, 0, signature.length, 0);
      } finally {
        await file.close();
      }
      if (!signature.equals(PNG_SIGNATURE)) invalid.push(`${assetPath} (invalid PNG signature)`);
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
      `Cannot build GitHub Pages: ${details.length} rig PNG asset(s) failed validation:\n`
      + details.map((detail) => `  - ${detail}`).join('\n'),
    );
  }
}

export async function listImageFiles(directory) {
  const entries = await readdir(directory, { recursive: true });
  return entries
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((entry) => IMAGE_PATTERN.test(entry))
    .sort();
}

export async function verifyPagesOutput(outputDirectory, expectedImagePaths) {
  const copiedManifest = await readRigManifest(outputDirectory);
  const copiedReferences = collectRigImagePaths(copiedManifest);
  assertSamePaths(
    copiedReferences,
    expectedImagePaths,
    'The copied rig manifest does not match the source manifest.',
  );

  const outputImages = await listImageFiles(outputDirectory);
  assertSamePaths(
    outputImages,
    expectedImagePaths,
    'Pages output image files must exactly equal the rig manifest references.',
  );
}

export async function buildPages({ projectRoot, outputDirectory } = {}) {
  const root = path.resolve(projectRoot ?? fileURLToPath(new URL('../', import.meta.url)));
  const target = path.resolve(outputDirectory ?? path.join(root, LOCAL_OUTPUT_DIRECTORY));
  assertSafeOutputDirectory(root, target);

  const manifest = await readRigManifest(root);
  const imagePaths = collectRigImagePaths(manifest);

  for (const entry of PUBLISH_ENTRIES) {
    try {
      await access(path.join(root, entry));
    } catch (error) {
      throw new Error(`Cannot build GitHub Pages: missing publish entry "${entry}" (${error.message})`);
    }
  }
  await assertRigImagesExist(root, imagePaths);

  const stagingDirectory = await mkdtemp(path.join(root, '.pages-build-'));
  try {
    for (const entry of PUBLISH_ENTRIES) {
      await cp(path.join(root, entry), path.join(stagingDirectory, entry), {
        recursive: true,
      });
    }

    await copyProjectFile(root, stagingDirectory, RIG_MANIFEST_PATH);
    for (const assetPath of imagePaths) {
      await copyProjectFile(root, stagingDirectory, assetPath);
    }

    await verifyPagesOutput(stagingDirectory, imagePaths);
    await rm(target, { recursive: true, force: true });
    await rename(stagingDirectory, target);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }

  return {
    outputDirectory: target,
    manifestPath: RIG_MANIFEST_PATH,
    imagePaths,
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
      + `with ${result.imagePaths.length} manifest-listed PNG files.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
