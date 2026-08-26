import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeRgbaPng } from '../scripts/export-rig-layers.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TEST_DIRECTORY, '..');
const OWNERS = ['survivor-crystal-pin', 'survivor-moss-sprout'];
const MANIFEST = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function overlaps(a, b) {
  return (
    Math.max(a.x, b.x) < Math.min(a.x + a.width, b.x + b.width)
    && Math.max(a.y, b.y) < Math.min(a.y + a.height, b.y + b.height)
  );
}

test('approved masters deterministically rebuild the checked-in layered rigs', () => {
  const output = execFileSync(
    'python3',
    ['scripts/build-master-derived-rigs.py', '--check'],
    { cwd: PROJECT_ROOT, encoding: 'utf8' },
  );
  const report = JSON.parse(output);
  assert.deepEqual(report.rigs.map(({ owner }) => owner), OWNERS);
});

test('master-derived metadata preserves independent source cells and labels the runtime eye composite', async (t) => {
  const expectedLayers = {
    'survivor-crystal-pin': [
      'needleBottom',
      'needleLower',
      'needleMid',
      'needleMidUpper',
      'needleUpper',
      'needleTall',
      'needleRight',
      'body',
      'eyeLeft',
      'eyeRight',
      'mouth',
      'front',
    ],
    'survivor-moss-sprout': [
      'body',
      'eyeLeft',
      'eyeRight',
      'mouth',
      'leafLeft',
      'leafRight',
      'stemCollar',
      'pack',
    ],
  };

  for (const owner of OWNERS) {
    await t.test(owner, async () => {
      const manifestMetadata = MANIFEST.rigs[owner].masterDerived;
      const metadataPath = path.join(PROJECT_ROOT, manifestMetadata.metadataPath);
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
      assert.equal(metadata.builder, 'scripts/build-master-derived-rigs.py');
      assert.equal(metadata.sourceMaster, manifestMetadata.sourceMaster);
      assert.equal(
        sha256(await readFile(path.join(PROJECT_ROOT, metadata.sourceMaster))),
        metadata.sourceMasterSha256,
      );
      assert.deepEqual(Object.keys(metadata.independentCells), expectedLayers[owner]);
      const independentlyAnimated = owner === 'survivor-crystal-pin'
        ? expectedLayers[owner].filter((name) => name.startsWith('needle'))
        : ['leafLeft', 'leafRight', 'stemCollar'];
      for (const name of independentlyAnimated) {
        assert.equal(metadata.independentCells[name].bone, name);
        assert.equal(
          metadata.runtimeRig.parts.find((part) => part.id === name).bone,
          name,
        );
      }
      assert.deepEqual(metadata.runtimeCompatibility.eyes.compositeOf, ['eyeLeft', 'eyeRight']);
      assert.equal(metadata.runtimeCompatibility.eyes.kind, 'derived-composite');
      assert.deepEqual(metadata.runtimeRig, MANIFEST.rigs[owner]);

      const cells = Object.entries(metadata.independentCells).map(([name, value]) => ({
        name,
        rect: value.atlasRect,
      }));
      const compatibility = {
        name: 'eyes',
        rect: metadata.runtimeCompatibility.eyes.atlasRect,
      };
      const allCells = [...cells, compatibility];
      for (let index = 0; index < allCells.length; index += 1) {
        for (const other of allCells.slice(index + 1)) {
          assert.equal(
            overlaps(allCells[index].rect, other.rect),
            false,
            `${owner}:${allCells[index].name} overlaps ${other.name}`,
          );
        }
      }

      for (const name of [...expectedLayers[owner], 'eyes']) {
        const relative = name === 'eyes'
          ? metadata.runtimeCompatibility.eyes.standalone
          : metadata.independentCells[name].standalone;
        const png = await readFile(path.join(PROJECT_ROOT, relative));
        const decoded = decodeRgbaPng(png, relative);
        let visible = 0;
        let transparent = 0;
        for (let offset = 3; offset < decoded.pixels.length; offset += 4) {
          if (decoded.pixels[offset] > 0) visible += 1;
          else transparent += 1;
        }
        assert.ok(visible > 0, `${owner}:${name} must contain visible pixels`);
        assert.ok(transparent > 0, `${owner}:${name} must retain transparent padding`);
        assert.equal(sha256(png), metadata.layerPngSha256[name]);
      }

      const left = await readFile(path.join(
        PROJECT_ROOT,
        metadata.independentCells.eyeLeft.standalone,
      ));
      const right = await readFile(path.join(
        PROJECT_ROOT,
        metadata.independentCells.eyeRight.standalone,
      ));
      assert.notEqual(sha256(left), sha256(right));
    });
  }
});

test('bind-pose recomposition stays within conservative measured tolerances', async () => {
  const thresholds = {
    'survivor-crystal-pin': { alphaIoU: 0.98, psnr: 25 },
    'survivor-moss-sprout': { alphaIoU: 0.99, psnr: 38 },
  };
  for (const owner of OWNERS) {
    const metadataPath = path.join(
      PROJECT_ROOT,
      MANIFEST.rigs[owner].masterDerived.metadataPath,
    );
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    const metrics = metadata.validation.metrics;
    assert.ok(metrics.alphaIoU >= thresholds[owner].alphaIoU, `${owner} alpha IoU`);
    assert.ok(metrics.visibleRgbPsnrDb >= thresholds[owner].psnr, `${owner} PSNR`);
    assert.ok(metrics.meanAlphaError < 3, `${owner} mean alpha error`);
    if (owner === 'survivor-moss-sprout') {
      assert.equal(metadata.darkGlowCleanup.enabled, true);
      assert.equal(metadata.darkGlowCleanup.strongAlphaThreshold, 192);
      assert.equal(metadata.darkGlowCleanup.retainedEdgeRadiusPixels, 2);
    }

    const recomposition = decodeRgbaPng(
      await readFile(path.join(PROJECT_ROOT, metadata.validation.bindRecomposition)),
      metadata.validation.bindRecomposition,
    );
    assert.deepEqual([recomposition.width, recomposition.height], [512, 512]);
    for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511]]) {
      assert.equal(recomposition.pixels[(y * 512 + x) * 4 + 3], 0);
    }
  }
});
