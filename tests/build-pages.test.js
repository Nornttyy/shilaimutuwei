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
const EXPRESSION_PATH = 'assets/generated-v2/rig/survivor-test/expressions-v2.png';
const RUNTIME_IMAGE_PATHS = Object.freeze([
  ...ATLAS_PATHS,
  EXPRESSION_PATH,
].sort());

const PROJECT_MANIFEST = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));

test('the project Pages whitelist contains every manifest-declared runtime PNG', () => {
  const paths = collectRigImagePaths(PROJECT_MANIFEST);
  const baseAtlases = [...new Set(Object.values(PROJECT_MANIFEST.rigs).flatMap(
    (rig) => rig.parts.map((part) => part.path),
  ))].sort();
  const expectedBaseAtlases = Object.keys(PROJECT_MANIFEST.rigs).map((ownerId) => (
    ownerId === 'enemy-acid-shell-king'
      ? 'assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v2.png'
      : `assets/generated-v2/rig/${ownerId}/atlas.png`
  )).sort();
  const declaredPaths = [...new Set(Object.values(PROJECT_MANIFEST.rigs).flatMap(
    (rig) => rig.parts.flatMap((part) => [
      part.path,
      ...Object.values(part.variants ?? {}).map((variant) => variant.path ?? part.path),
    ]),
  ))].sort();

  assert.equal(baseAtlases.length, 8);
  assert.deepEqual(baseAtlases, expectedBaseAtlases);
  assert.deepEqual(paths, declaredPaths);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(paths.every((assetPath) => assetPath.endsWith('.png')), true);
});

test('Pages build copies exactly the manifest-listed rig PNG set', async () => {
  await withFixture(async (root) => {
    await writePng(root, 'assets/generated-v2/rig/unused/preview.png');
    await writePng(root, 'assets/generated-v2/rig/survivor-test/body.png');
    await writePng(root, 'assets/generated-v2/rig/survivor-test/candidates/blink.png');
    await writePng(root, 'assets/generated-v2/rig-parts-exported/survivor-test/eyes.png');
    await writePng(root, 'assets/generated-v2/review/style-preview.png');

    const result = await buildPages({
      projectRoot: root,
      outputDirectory: path.join(root, '_site'),
    });

    assert.deepEqual(result.imagePaths, RUNTIME_IMAGE_PATHS);
    assert.deepEqual(await listImageFiles(path.join(root, '_site')), RUNTIME_IMAGE_PATHS);
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
    await assertMissing(path.join(root, '_site', 'assets/generated-v2/rig/survivor-test/body.png'));
    await assertMissing(
      path.join(root, '_site', 'assets/generated-v2/rig/survivor-test/candidates/blink.png'),
    );
    await assertMissing(
      path.join(root, '_site', 'assets/generated-v2/rig-parts-exported/survivor-test/eyes.png'),
    );
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
    assert.deepEqual(await listImageFiles(path.join(root, 'docs')), RUNTIME_IMAGE_PATHS);
    assert.deepEqual(
      collectRigImagePaths(JSON.parse(
        await readFile(path.join(root, 'docs', RIG_MANIFEST_PATH), 'utf8'),
      )),
      RUNTIME_IMAGE_PATHS,
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

test('a missing expression variant PNG fails before replacing an existing build', async () => {
  await withFixture(async (root) => {
    await rm(path.join(root, ...EXPRESSION_PATH.split('/')));
    await mkdir(path.join(root, '_site'), { recursive: true });
    await writeFile(path.join(root, '_site', 'keep.txt'), 'previous good build');

    await assert.rejects(
      buildPages({ projectRoot: root, outputDirectory: path.join(root, '_site') }),
      (error) => {
        assert.match(error.message, /Cannot build GitHub Pages/);
        assert.match(error.message, /1 rig PNG asset\(s\) failed validation/);
        assert.match(error.message, new RegExp(`missing: ${escapeRegExp(EXPRESSION_PATH)}`));
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

  const versionedBoss = createManifest();
  versionedBoss.rigs['enemy-acid-shell-king'] = versionedBoss.rigs['survivor-test'];
  delete versionedBoss.rigs['survivor-test'];
  for (const part of versionedBoss.rigs['enemy-acid-shell-king'].parts) {
    part.path = 'assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v2.png';
    for (const variant of Object.values(part.variants ?? {})) {
      if (variant.path) {
        variant.path = 'assets/generated-v2/rig/enemy-acid-shell-king/expressions-v2.png';
      }
    }
  }
  assert.equal(
    collectRigImagePaths(versionedBoss).includes(
      'assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v2.png',
    ),
    true,
  );

  const unapprovedVersion = structuredClone(versionedBoss);
  for (const part of unapprovedVersion.rigs['enemy-acid-shell-king'].parts) {
    part.path = 'assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v3.png';
  }
  assert.throws(
    () => collectRigImagePaths(unapprovedVersion),
    /must reference an atlas\.png below assets\/generated-v2\/rig\//,
  );
});

test('variant PNGs must stay directly inside their owning rig directory', () => {
  const outsideRigDirectory = createManifest();
  outsideRigDirectory.rigs['survivor-test'].parts[1].variants.blink.path =
    'assets/generated-v2/review/expressions-v2.png';
  assert.throws(
    () => collectRigImagePaths(outsideRigDirectory),
    /must reference a PNG directly below assets\/generated-v2\/rig\/survivor-test\//,
  );

  const candidateDirectory = createManifest();
  candidateDirectory.rigs['survivor-test'].parts[1].variants.blink.path =
    'assets/generated-v2/rig/survivor-test/candidates/blink.png';
  assert.throws(
    () => collectRigImagePaths(candidateDirectory),
    /must reference a PNG directly below assets\/generated-v2\/rig\/survivor-test\//,
  );

  const anotherOwner = createManifest();
  anotherOwner.rigs['survivor-test'].parts[1].variants.blink.path =
    'assets/generated-v2/rig/enemy-test/expressions-v2.png';
  assert.throws(
    () => collectRigImagePaths(anotherOwner),
    /must reference a PNG directly below assets\/generated-v2\/rig\/survivor-test\//,
  );

  const traversal = createManifest();
  traversal.rigs['survivor-test'].parts[1].variants.blink.path =
    'assets/generated-v2/rig/survivor-test/../expressions-v2.png';
  assert.throws(
    () => collectRigImagePaths(traversal),
    /must reference a PNG directly below assets\/generated-v2\/rig\/survivor-test\//,
  );
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
        parts: ['body', 'eyes', 'mouth'].map((partId, index) => {
          const part = {
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
          };
          if (partId === 'eyes') {
            part.variants = {
              normal: {},
              blink: {
                path: EXPRESSION_PATH,
                sourceRect: { x: 0, y: 0, width: 64, height: 32 },
              },
            };
          }
          if (partId === 'mouth') {
            part.variants = {
              normal: {},
              attack: {
                path: EXPRESSION_PATH,
                sourceRect: { x: 64, y: 0, width: 64, height: 32 },
              },
            };
          }
          return part;
        }),
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
    await Promise.all(RUNTIME_IMAGE_PATHS.map((assetPath) => writePng(root, assetPath)));
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
