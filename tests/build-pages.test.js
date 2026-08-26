import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildPages,
  collectRigImagePaths,
  listImageFiles,
  RIG_MANIFEST_PATH,
} from '../scripts/build-pages.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ATLAS_PATHS = Object.freeze([
  'assets/generated-v2/rig/survivor-test/atlas.png',
]);

const PROJECT_MANIFEST = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));

test('the project Pages whitelist contains exactly eight character atlases', () => {
  const paths = collectRigImagePaths(PROJECT_MANIFEST);
  assert.equal(paths.length, 8);
  assert.equal(new Set(paths).size, 8);
  assert.equal(paths.every((assetPath) => assetPath.endsWith('/atlas.png')), true);
});

test('Pages build copies exactly the manifest-listed rig PNG set', async () => {
  await withFixture(async (root) => {
    await writePng(root, 'assets/generated-v2/rig/unused/preview.png');
    await writePng(root, 'assets/generated-v2/review/style-preview.png');

    const result = await buildPages({
      projectRoot: root,
      outputDirectory: path.join(root, '_site'),
    });

    assert.deepEqual(result.imagePaths, [...ATLAS_PATHS].sort());
    assert.deepEqual(await listImageFiles(path.join(root, '_site')), [...ATLAS_PATHS].sort());
    assert.equal(
      await readFile(path.join(root, '_site', 'index.html'), 'utf8'),
      '<canvas></canvas>',
    );
    assert.equal(
      await readFile(path.join(root, '_site', 'src', 'main.js'), 'utf8'),
      'export const ready = true;\n',
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(root, '_site', RIG_MANIFEST_PATH), 'utf8')),
      createManifest(),
    );
    await assertMissing(path.join(root, '_site', 'assets/generated-v2/rig/unused/preview.png'));
    await assertMissing(path.join(root, '_site', 'assets/generated-v2/review/style-preview.png'));
  });
});

test('docs build is a trackable whitelist package with the same contents', async () => {
  await withFixture(async (root) => {
    const result = await buildPages({
      projectRoot: root,
      outputDirectory: path.join(root, 'docs'),
    });
    assert.equal(result.outputDirectory, path.join(root, 'docs'));
    assert.deepEqual(await listImageFiles(path.join(root, 'docs')), [...ATLAS_PATHS].sort());
    assert.deepEqual(
      collectRigImagePaths(JSON.parse(
        await readFile(path.join(root, 'docs', RIG_MANIFEST_PATH), 'utf8'),
      )),
      [...ATLAS_PATHS].sort(),
    );
  });
});

test('a missing rig PNG fails clearly before replacing an existing build', async () => {
  await withFixture(async (root) => {
    const [missingPath] = ATLAS_PATHS;
    await rm(path.join(root, ...missingPath.split('/')));
    await mkdir(path.join(root, '_site'), { recursive: true });
    await writeFile(path.join(root, '_site', 'keep.txt'), 'previous good build');

    await assert.rejects(
      buildPages({ projectRoot: root, outputDirectory: path.join(root, '_site') }),
      (error) => {
        assert.match(error.message, /Cannot build GitHub Pages/);
        assert.match(error.message, /1 rig PNG asset\(s\) failed validation/);
        assert.match(error.message, new RegExp(`missing: ${escapeRegExp(missingPath)}`));
        return true;
      },
    );

    assert.equal(
      await readFile(path.join(root, '_site', 'keep.txt'), 'utf8'),
      'previous good build',
    );
    assert.deepEqual(
      (await readdir(root)).filter((entry) => entry.startsWith('.pages-build-')),
      [],
    );
  });
});

test('a non-PNG file with a png suffix is rejected as invalid', async () => {
  await withFixture(async (root) => {
    const [invalidPath] = ATLAS_PATHS;
    await writeFile(path.join(root, ...invalidPath.split('/')), 'not a real png');

    await assert.rejects(
      buildPages({ projectRoot: root, outputDirectory: path.join(root, '_site') }),
      (error) => {
        assert.match(error.message, new RegExp(`invalid: ${escapeRegExp(invalidPath)}`));
        assert.match(error.message, /invalid PNG signature/);
        return true;
      },
    );
  });
});

test('build validates the complete rig contract before touching output', async () => {
  await withFixture(async (root) => {
    const manifest = createManifest();
    manifest.rigs['survivor-test'].canonicalFacing = -1;
    await writeJson(root, RIG_MANIFEST_PATH, manifest);
    await mkdir(path.join(root, '_site'), { recursive: true });
    await writeFile(path.join(root, '_site', 'keep.txt'), 'previous good build');

    await assert.rejects(
      buildPages({ projectRoot: root, outputDirectory: path.join(root, '_site') }),
      /Invalid rig contract.*canonicalFacing must be \+1/s,
    );
    assert.equal(
      await readFile(path.join(root, '_site', 'keep.txt'), 'utf8'),
      'previous good build',
    );
  });
});

test('manifest paths must be rig atlases, shared inside one rig but never across rigs', () => {
  const outsideRigDirectory = createManifest();
  outsideRigDirectory.rigs['survivor-test'].parts[0].path = 'assets/generated-v2/review/atlas.png';
  assert.throws(
    () => collectRigImagePaths(outsideRigDirectory),
    /must reference an atlas\.png below assets\/generated-v2\/rig\//,
  );

  const traversal = createManifest();
  traversal.rigs['survivor-test'].parts[0].path = '../body.png';
  assert.throws(
    () => collectRigImagePaths(traversal),
    /must reference an atlas\.png below assets\/generated-v2\/rig\//,
  );

  const split = createManifest();
  split.rigs['survivor-test'].parts[1].path =
    'assets/generated-v2/rig/survivor-test-alt/atlas.png';
  assert.throws(() => collectRigImagePaths(split), /share exactly one atlas PNG path/i);

  const wrongOwner = createManifest();
  for (const part of wrongOwner.rigs['survivor-test'].parts) {
    part.path = 'assets/generated-v2/rig/someone-else/atlas.png';
  }
  assert.throws(() => collectRigImagePaths(wrongOwner), /atlas path must be .*survivor-test\/atlas\.png/i);

  const shared = createManifest();
  shared.rigs['enemy-test'] = {
    ...structuredClone(shared.rigs['survivor-test']),
    rigId: 'enemy-test',
  };
  assert.throws(() => collectRigImagePaths(shared), /cannot be shared across rigs/i);
});

test('build refuses output paths other than project-local _site or docs', async () => {
  await withFixture(async (root) => {
    await assert.rejects(
      buildPages({ projectRoot: root, outputDirectory: root }),
      /Refusing to replace unsafe Pages output directory/,
    );
    await assert.rejects(
      buildPages({ projectRoot: root, outputDirectory: path.join(root, 'public') }),
      /Refusing to replace unsafe Pages output directory/,
    );
  });
});

function createManifest() {
  return {
    schemaVersion: 2,
    coordinateSpace: {
      units: 'rig-local',
      canonicalSize: 100,
      origin: 'ground-center',
      xAxis: 'right',
      yAxis: 'down',
    },
    assetPolicy: {
      container: 'PNG',
      colorMode: 'RGBA',
      transparent: true,
      rootBoneHasImage: false,
      faceBoneHasImage: false,
      bodyIncludesFacialPixels: false,
      readiness: 'atomic',
    },
    rigs: {
      'survivor-test': {
        rigId: 'test',
        rootBone: 'root',
        faceBone: 'face',
        canonicalFacing: 1,
        parts: ['body', 'eyes', 'mouth'].map((partId, index) => ({
          id: partId,
          bone: partId,
          z: index * 10,
          path: ATLAS_PATHS[0],
          required: true,
          sourceRect: {
            x: index * 256,
            y: 0,
            width: 256,
            height: 256,
          },
          bindRect: { x: -10, y: -20, width: 20, height: 20 },
        })),
      },
    },
  };
}

async function withFixture(callback) {
  const root = await mkdtemp(path.join(tmpdir(), 'slime-pages-build-'));
  try {
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'index.html'), '<canvas></canvas>');
    await writeFile(path.join(root, 'styles.css'), 'canvas { display: block; }\n');
    await writeFile(path.join(root, 'src', 'main.js'), 'export const ready = true;\n');
    await writeJson(root, RIG_MANIFEST_PATH, createManifest());
    await Promise.all(ATLAS_PATHS.map((assetPath) => writePng(root, assetPath)));
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeJson(root, relativePath, value) {
  const destination = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`);
}

async function writePng(root, relativePath) {
  const destination = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, PNG_SIGNATURE);
}

async function assertMissing(filePath) {
  await assert.rejects(readFile(filePath), (error) => error?.code === 'ENOENT');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
