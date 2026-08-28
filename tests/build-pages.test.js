import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ASSET_SPEC_PATH,
  buildPages,
  collectDeclaredAssetPaths,
  collectRigImagePaths,
  listImageFiles,
  RIG_MANIFEST_PATH,
  verifyPublishedModules,
  verifyPagesOutput,
} from '../scripts/build-pages.mjs';

const MINIMAL_RGBA_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR42mMAAQAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_WITH_IHDR_ONLY = MINIMAL_RGBA_PNG.subarray(0, 33);
const MINIMAL_RGB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);
const ATLAS_PATHS = Object.freeze([
  'assets/generated-v2/rig/survivor-test/atlas.png',
]);
const EXPRESSION_PATH = 'assets/generated-v2/rig/survivor-test/expressions-v2.png';
const DECLARED_ASSET_PATHS = Object.freeze([
  'assets/generated/background/background-test.png',
  'assets/generated/effect/effect-test.png',
].sort());
const RUNTIME_IMAGE_PATHS = Object.freeze([
  ...DECLARED_ASSET_PATHS,
  ...ATLAS_PATHS,
  EXPRESSION_PATH,
].sort());

const PROJECT_MANIFEST = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));
const PROJECT_ASSET_SPEC = JSON.parse(await readFile(
  new URL('../assets/asset-spec.json', import.meta.url),
  'utf8',
));
const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SHELL_SLIME_IMAGE_PATH = './assets/generated/survivor/survivor-moss-sprout.png';
const REQUIRED_GAMEPLAY_MODULES = Object.freeze([
  'src/world.js',
  'src/colony-catalog.js',
  'src/colony.js',
  'src/terrain-renderer.js',
  'src/expedition-catalog.js',
  'src/expedition.js',
  'src/platform/runtime.js',
  'src/platform/wechat.js',
  'src/platform/wechat-canvas.js',
  'src/platform/wechat-entry.js',
]);
const REQUIRED_GAMEPLAY_ASSET_CATEGORIES = Object.freeze({
  terrain: 10,
  'terrain-waste': 7,
  region: 5,
  nest: 2,
  landmark: 5,
  expedition: 14,
  resource: 3,
});

test('the browser shell loads formal loading and rotation art without JavaScript', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(
    html,
    new RegExp(`<link rel="preload" as="image" href="${escapeRegExp(SHELL_SLIME_IMAGE_PATH)}"`),
  );
  for (const className of ['loading-blob', 'rotate-slime']) {
    const image = html.match(new RegExp(`<img\\s+class="${className}"[\\s\\S]*?\\/>`))?.[0] || '';
    assert.match(image, new RegExp(`src="${escapeRegExp(SHELL_SLIME_IMAGE_PATH)}"`));
    assert.match(image, /alt=""/);
    assert.match(image, /aria-hidden="true"/);
    assert.doesNotMatch(html, new RegExp(`<span class="${className}"`));

    const declarations = css.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`))?.[1] || '';
    assert.match(declarations, /object-fit:\s*contain/);
    assert.doesNotMatch(declarations, /(?:background|border-radius|box-shadow)\s*:/);
  }
  assert.match(css, /\.loading-blob\s*\{[^}]*animation:\s*bob/s);
  assert.match(css, /@media \(orientation:\s*portrait\) and \(max-width:\s*900px\)/);
});

test('the project asset whitelist covers all 123 canonical nested PNG paths', () => {
  const paths = collectDeclaredAssetPaths(PROJECT_ASSET_SPEC);
  assert.equal(paths.length, 123);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(paths.every((assetPath) => (
    /^assets\/generated\/[a-z][a-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/.test(assetPath)
  )), true);
});

test('the project whitelist includes every terrain, expedition, and resource PNG contract', () => {
  const declaredPaths = new Set(collectDeclaredAssetPaths(PROJECT_ASSET_SPEC));
  for (const [category, expectedCount] of Object.entries(REQUIRED_GAMEPLAY_ASSET_CATEGORIES)) {
    const assets = PROJECT_ASSET_SPEC.assets.filter((asset) => asset.category === category);
    assert.equal(assets.length, expectedCount, category);
    for (const asset of assets) {
      assert.equal(declaredPaths.has(asset.path), true, asset.path);
      assert.match(asset.path, new RegExp(`^assets/generated/${category}/`));
    }
  }
});

test('the project Pages whitelist contains every manifest-declared runtime PNG', () => {
  const paths = collectRigImagePaths(PROJECT_MANIFEST);
  const baseAtlases = [...new Set(Object.values(PROJECT_MANIFEST.rigs).flatMap(
    (rig) => rig.parts.map((part) => part.path),
  ))].sort();
  const expectedBaseAtlases = Object.keys(PROJECT_MANIFEST.rigs).map((ownerId) => (
    ownerId === 'survivor-shell-shell'
      ? 'assets/generated-v2/rig/survivor-shell-shell/atlas-layered-v3.png'
      : ownerId === 'survivor-bubble-float'
      ? 'assets/generated-v2/rig/survivor-bubble-float/atlas-layered-v2.png'
      : ownerId === 'enemy-acid-shell-king'
        ? 'assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v2.png'
        : ownerId === 'enemy-windcap'
          ? 'assets/generated-v2/rig/enemy-windcap/atlas-layered-v2.png'
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

test('Pages build copies exactly the asset-spec and rig-manifest PNG sets', async () => {
  await withFixture(async (root) => {
    await writePng(root, 'assets/generated/effect/effect-test-source.png');
    await writePng(root, 'assets/generated/effect/effect-test-alpha.png');
    await writePng(root, 'assets/generated/effect/preview.png');
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
      '<canvas></canvas><script type="module" src="./src/main.js"></script>',
    );
    assert.equal(
      await readFile(path.join(root, '_site', 'src', 'main.js'), 'utf8'),
      'export const ready = true;\n',
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(root, '_site', RIG_MANIFEST_PATH), 'utf8')),
      createManifest(),
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(root, '_site', ASSET_SPEC_PATH), 'utf8')),
      createAssetSpec(),
    );
    await assertMissing(path.join(root, '_site', 'assets/generated/effect/effect-test-source.png'));
    await assertMissing(path.join(root, '_site', 'assets/generated/effect/effect-test-alpha.png'));
    await assertMissing(path.join(root, '_site', 'assets/generated/effect/preview.png'));
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
      [...ATLAS_PATHS, EXPRESSION_PATH].sort(),
    );
    assert.deepEqual(
      collectDeclaredAssetPaths(JSON.parse(
        await readFile(path.join(root, 'docs', ASSET_SPEC_PATH), 'utf8'),
      )),
      DECLARED_ASSET_PATHS,
    );
  });
});

test('Pages build copies every declared terrain, expedition, and resource gameplay PNG', async () => {
  await withFixture(async (root) => {
    const gameplayAssets = PROJECT_ASSET_SPEC.assets
      .filter(({ category }) => category in REQUIRED_GAMEPLAY_ASSET_CATEGORIES)
      .map(({ id, category, filename, path: assetPath }) => ({
        id,
        category,
        filename,
        path: assetPath,
        width: 1,
        height: 1,
        maxBytes: 128,
        transparent: true,
      }));
    const expectedPaths = gameplayAssets.map(({ path: assetPath }) => assetPath).sort();
    assert.equal(
      expectedPaths.length,
      Object.values(REQUIRED_GAMEPLAY_ASSET_CATEGORIES).reduce((total, count) => total + count, 0),
    );
    await writeJson(root, ASSET_SPEC_PATH, { schemaVersion: 1, assets: gameplayAssets });
    await Promise.all(expectedPaths.map((assetPath) => writePng(root, assetPath)));

    const result = await buildPages({
      projectRoot: root,
      outputDirectory: path.join(root, 'docs'),
    });
    assert.deepEqual(result.assetPaths, expectedPaths);
    for (const assetPath of expectedPaths) {
      assert.deepEqual(
        await readFile(path.join(root, 'docs', ...assetPath.split('/'))),
        MINIMAL_RGBA_PNG,
      );
    }
  });
});

test('Pages build copies the complete gameplay module tree with resolvable imports', async () => {
  await withFixture(async (root) => {
    await rm(path.join(root, 'src'), { recursive: true, force: true });
    await cp(path.join(PROJECT_ROOT, 'src'), path.join(root, 'src'), { recursive: true });
    await writeFile(
      path.join(root, 'index.html'),
      '<canvas></canvas><script type="module" src="./src/main.js"></script>',
    );

    const result = await buildPages({
      projectRoot: root,
      outputDirectory: path.join(root, 'docs'),
    });
    const moduleReport = await verifyPublishedModules(result.outputDirectory);
    assert.deepEqual(moduleReport.entrypoints, ['./src/main.js']);
    for (const modulePath of REQUIRED_GAMEPLAY_MODULES) {
      assert.equal(moduleReport.modulePaths.includes(modulePath), true, modulePath);
      assert.equal(
        await readFile(path.join(root, 'docs', ...modulePath.split('/')), 'utf8'),
        await readFile(path.join(PROJECT_ROOT, ...modulePath.split('/')), 'utf8'),
      );
    }
  });
});

test('Pages module validation rejects a broken browser-relative import', async () => {
  await withFixture(async (root) => {
    await writeFile(path.join(root, 'src', 'main.js'), "import './missing-module.js';\n");
    await assert.rejects(
      buildPages({ projectRoot: root, outputDirectory: path.join(root, '_site') }),
      /src\/main\.js cannot resolve: \.\/missing-module\.js/,
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

test('a missing asset-spec PNG fails before replacing an existing build', async () => {
  await withFixture(async (root) => {
    const [missingPath] = DECLARED_ASSET_PATHS;
    await rm(path.join(root, ...missingPath.split('/')));
    await mkdir(path.join(root, '_site'), { recursive: true });
    await writeFile(path.join(root, '_site', 'keep.txt'), 'previous good build');

    await assert.rejects(
      buildPages({ projectRoot: root, outputDirectory: path.join(root, '_site') }),
      (error) => {
        assert.match(error.message, /source asset-spec PNG validation failed/);
        assert.match(error.message, /\[FILE_NOT_FOUND\]/);
        assert.match(error.message, new RegExp(escapeRegExp(missingPath)));
        return true;
      },
    );
    assert.equal(
      await readFile(path.join(root, '_site', 'keep.txt'), 'utf8'),
      'previous good build',
    );
  });
});

test('a rig PNG with a valid signature and IHDR but no image chunks is rejected', async () => {
  await withFixture(async (root) => {
    const [invalidPath] = ATLAS_PATHS;
    await writeFile(path.join(root, ...invalidPath.split('/')), PNG_WITH_IHDR_ONLY);

    await assert.rejects(
      buildPages({ projectRoot: root, outputDirectory: path.join(root, '_site') }),
      (error) => {
        assert.match(error.message, new RegExp(`invalid: ${escapeRegExp(invalidPath)}`));
        assert.match(error.message, /missing IDAT image data/i);
        return true;
      },
    );
  });
});

test('source asset-spec verification enforces dimensions, RGBA, and maxBytes', async () => {
  const cases = [
    {
      code: 'WIDTH_MISMATCH',
      prepare: async (root) => {
        const spec = createAssetSpec();
        spec.assets[1].width = 2;
        await writeJson(root, ASSET_SPEC_PATH, spec);
      },
    },
    {
      code: 'PNG_RGBA_REQUIRED',
      prepare: async (root) => {
        await writePng(root, DECLARED_ASSET_PATHS[1], MINIMAL_RGB_PNG);
      },
    },
    {
      code: 'FILE_TOO_LARGE',
      prepare: async (root) => {
        const spec = createAssetSpec();
        spec.assets[1].maxBytes = 1;
        await writeJson(root, ASSET_SPEC_PATH, spec);
      },
    },
  ];

  for (const { code, prepare } of cases) {
    await withFixture(async (root) => {
      await prepare(root);
      await assert.rejects(
        buildPages({ projectRoot: root, outputDirectory: path.join(root, '_site') }),
        (error) => {
          assert.match(error.message, /source asset-spec PNG validation failed/);
          assert.match(error.message, new RegExp(`\\[${code}\\]`));
          return true;
        },
      );
    });
  }
});

test('staging output reruns strict asset-spec PNG metadata verification', async () => {
  await withFixture(async (root) => {
    const result = await buildPages({
      projectRoot: root,
      outputDirectory: path.join(root, '_site'),
    });
    const copiedSpec = createAssetSpec();
    copiedSpec.assets[1].height = 2;
    await writeJson(result.outputDirectory, ASSET_SPEC_PATH, copiedSpec);

    await assert.rejects(
      verifyPagesOutput(result.outputDirectory, result),
      (error) => {
        assert.match(error.message, /staging asset-spec PNG validation failed/);
        assert.match(error.message, /\[HEIGHT_MISMATCH\]/);
        return true;
      },
    );
  });
});

test('staging output rejects a rig PNG whose image chunks are missing', async () => {
  await withFixture(async (root) => {
    const result = await buildPages({
      projectRoot: root,
      outputDirectory: path.join(root, '_site'),
    });
    const [invalidPath] = ATLAS_PATHS;
    await writeFile(
      path.join(result.outputDirectory, ...invalidPath.split('/')),
      PNG_WITH_IHDR_ONLY,
    );

    await assert.rejects(
      verifyPagesOutput(result.outputDirectory, result),
      (error) => {
        assert.match(error.message, new RegExp(`invalid: ${escapeRegExp(invalidPath)}`));
        assert.match(error.message, /missing IDAT image data/i);
        return true;
      },
    );
  });
});

test('build validates the complete rig contract before touching output', async () => {
  await withFixture(async (root) => {
    const manifest = createManifest();
    manifest.rigs['survivor-test'].canonicalFacing = 0;
    await writeJson(root, RIG_MANIFEST_PATH, manifest);
    await mkdir(path.join(root, '_site'), { recursive: true });
    await writeFile(path.join(root, '_site', 'keep.txt'), 'previous good build');

    await assert.rejects(
      buildPages({ projectRoot: root, outputDirectory: path.join(root, '_site') }),
      /Invalid rig contract.*canonicalFacing must be \+1 or -1/s,
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
    /atlas path must be .*atlas-layered-v2\.png/i,
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

test('asset spec paths must be canonical finished PNGs in their category directory', () => {
  const wrongCategory = createAssetSpec();
  wrongCategory.assets[0].path = 'assets/generated/effect/background-test.png';
  assert.throws(() => collectDeclaredAssetPaths(wrongCategory), /path category must match/i);

  const wrongFilename = createAssetSpec();
  wrongFilename.assets[0].filename = 'different.png';
  assert.throws(() => collectDeclaredAssetPaths(wrongFilename), /path filename must match/i);

  for (const fileName of ['effect-test-source.png', 'effect-test-alpha.png', 'preview.png']) {
    const derivative = createAssetSpec();
    derivative.assets[1].filename = fileName;
    derivative.assets[1].path = `assets/generated/effect/${fileName}`;
    assert.throws(() => collectDeclaredAssetPaths(derivative), /cannot publish derivative file/i);
  }

  const traversal = createAssetSpec();
  traversal.assets[1].path = 'assets/generated/effect/../effect-test.png';
  assert.throws(() => collectDeclaredAssetPaths(traversal), /must reference assets\/generated/i);
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

function createAssetSpec() {
  return {
    schemaVersion: 1,
    assets: [
      {
        id: 'background-test',
        category: 'background',
        filename: 'background-test.png',
        path: 'assets/generated/background/background-test.png',
        width: 1,
        height: 1,
        maxBytes: 128,
        colorType: 'RGBA',
        alpha: true,
      },
      {
        id: 'effect-test',
        category: 'effect',
        filename: 'effect-test.png',
        path: 'assets/generated/effect/effect-test.png',
        width: 1,
        height: 1,
        maxBytes: 128,
        colorType: 'RGBA',
        alpha: true,
      },
    ],
  };
}

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
    await writeFile(
      path.join(root, 'index.html'),
      '<canvas></canvas><script type="module" src="./src/main.js"></script>',
    );
    await writeFile(path.join(root, 'styles.css'), 'canvas { display: block; }\n');
    await writeFile(path.join(root, 'src', 'main.js'), 'export const ready = true;\n');
    await writeJson(root, ASSET_SPEC_PATH, createAssetSpec());
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

async function writePng(root, relativePath, contents = MINIMAL_RGBA_PNG) {
  const destination = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents);
}

async function assertMissing(filePath) {
  await assert.rejects(readFile(filePath), (error) => error?.code === 'ENOENT');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
