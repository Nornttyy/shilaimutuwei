import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeRgbaPng } from '../scripts/export-rig-layers.mjs';
import {
  buildRigStandalones,
  RIG_IDS,
} from '../scripts/render-rig-standalones.mjs';
import {
  CHARACTER_RENDER_PROFILES,
  characterPortraitCrop,
  characterWorldScale,
} from '../src/character-render-profiles.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(
  path.join(PROJECT_ROOT, 'assets/rig-parts.json'),
  'utf8',
));
const assetSpec = JSON.parse(await readFile(
  path.join(PROJECT_ROOT, 'assets/asset-spec.json'),
  'utf8',
));
const specsById = new Map(assetSpec.assets.map((spec) => [spec.id, spec]));
let buildPromise;

function build() {
  buildPromise ??= buildRigStandalones({ projectRoot: PROJECT_ROOT });
  return buildPromise;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('all eight checked-in card/list characters exactly match a fresh rig render', async () => {
  const report = await build();
  assert.equal(report.schemaVersion, 1);
  assert.deepEqual(report.generatedFrom, ['assets/rig-parts.json', 'assets/asset-spec.json']);
  assert.deepEqual(report.outputs.map(({ ownerId }) => ownerId), RIG_IDS);

  for (const output of report.outputs) {
    const existing = await readFile(path.join(PROJECT_ROOT, output.output));
    assert.ok(
      existing.equals(output.png),
      `${output.ownerId} must be regenerated from the current production rig`,
    );
    assert.equal(sha256(existing), output.pngSha256);
  }
});

test('standalones obey asset-spec dimensions, byte caps, transparency, and safe placement', async (t) => {
  const report = await build();
  for (const output of report.outputs) {
    await t.test(output.ownerId, () => {
      const spec = specsById.get(output.ownerId);
      const decoded = decodeRgbaPng(output.png, output.output);
      assert.equal(decoded.width, spec.width);
      assert.equal(decoded.height, spec.height);
      assert.equal(output.width, spec.width);
      assert.equal(output.height, spec.height);
      assert.ok(output.pngBytes <= spec.maxBytes);
      assert.equal(output.expression, 'normal');
      assert.equal(output.stats.visiblePixels > 0, true);
      assert.equal(output.stats.transparentPixels > 0, true);
      assert.deepEqual(output.stats.cornerAlpha, [0, 0, 0, 0]);

      const { safeMargin, targetBindBounds, anchorX, facing } = output.placement;
      const epsilon = 1e-6;
      assert.equal(anchorX, output.width / 2, 'the logical ground anchor must be centered');
      assert.equal(output.authoredFacing, manifest.rigs[output.ownerId].canonicalFacing);
      assert.equal(
        output.targetFacing,
        CHARACTER_RENDER_PROFILES[output.ownerId].gameplayFacing,
      );
      assert.equal(facing, output.targetFacing * output.authoredFacing);
      assert.ok(targetBindBounds.minX >= safeMargin - epsilon);
      assert.ok(targetBindBounds.minY >= safeMargin - epsilon);
      assert.ok(targetBindBounds.maxX <= output.width - safeMargin + epsilon);
      assert.ok(targetBindBounds.maxY <= output.height - safeMargin + epsilon);
      assert.ok(
        Math.abs(targetBindBounds.maxY - (output.height - safeMargin)) <= epsilon,
        'the bind-pose bottom must sit on the common safe baseline',
      );

      const alpha = output.stats.alphaBounds;
      assert.ok(alpha.minX >= safeMargin - 1);
      assert.ok(alpha.minY >= safeMargin - 1);
      assert.ok(alpha.maxX <= output.width - safeMargin);
      assert.ok(alpha.maxY <= output.height - safeMargin);
    });
  }
});

test('world sizing and portrait crops share one aspect-safe profile per character', async () => {
  const report = await build();
  assert.deepEqual(Object.keys(CHARACTER_RENDER_PROFILES), RIG_IDS);

  for (const output of report.outputs) {
    const profile = CHARACTER_RENDER_PROFILES[output.ownerId];
    const rig = manifest.rigs[output.ownerId];
    const worldBounds = rig.parts.reduce((bounds, part) => ({
      minX: Math.min(bounds.minX, part.bindRect.x),
      minY: Math.min(bounds.minY, part.bindRect.y),
      maxX: Math.max(bounds.maxX, part.bindRect.x + part.bindRect.width),
      maxY: Math.max(bounds.maxY, part.bindRect.y + part.bindRect.height),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    for (const key of ['minX', 'minY', 'maxX', 'maxY']) {
      assert.ok(Math.abs(profile.worldBounds[key] - worldBounds[key]) < 1e-9);
    }
    assert.equal(rig.canonicalFacing, 1, 'all current production rigs are authored facing right');
    assert.equal(profile.gameplayFacing, output.category === 'enemy' ? -1 : 1);

    const maxSpan = Math.max(
      worldBounds.maxX - worldBounds.minX,
      worldBounds.maxY - worldBounds.minY,
    );
    assert.ok(Math.abs(maxSpan * characterWorldScale(output.ownerId) - 100) < 1e-9);

    const crop = characterPortraitCrop(output.ownerId, output.width, output.height);
    assert.deepEqual(crop, profile.portraitCrop);
    assert.ok(crop.x >= 0 && crop.y >= 0);
    assert.ok(crop.x + crop.width <= output.width);
    assert.ok(crop.y + crop.height <= output.height);
    const alpha = output.stats.alphaBounds;
    assert.ok(crop.x <= alpha.minX && crop.y <= alpha.minY);
    assert.ok(crop.x + crop.width > alpha.maxX);
    assert.ok(crop.y + crop.height > alpha.maxY);
  }
});

test('every output records only its current owned production atlas and base normal face', async (t) => {
  const report = await build();
  for (const output of report.outputs) {
    await t.test(output.ownerId, async () => {
      const rig = manifest.rigs[output.ownerId];
      const expectedAtlas = rig.parts[0].path;
      assert.equal(output.sources.length, 1);
      assert.equal(output.sources[0].path, expectedAtlas);
      assert.match(
        expectedAtlas,
        new RegExp(`^assets/generated-v2/rig/${output.ownerId}/atlas(?:-layered-v\\d+)?\\.png$`),
      );
      assert.doesNotMatch(expectedAtlas, /(?:review|preview|candidate|assets\/generated\/(?:survivor|enemy))/i);
      assert.equal(
        output.sources[0].sha256,
        sha256(await readFile(path.join(PROJECT_ROOT, expectedAtlas))),
      );

      assert.deepEqual(
        output.layers.map(({ id }) => id),
        rig.parts.map(({ id }) => id),
        'z order must be identical to the production manifest',
      );
      for (const partId of ['eyes', 'mouth']) {
        const normal = output.normalExpressions[partId];
        const manifestPart = rig.parts.find(({ id }) => id === partId);
        assert.equal(normal.variant, 'normal');
        assert.equal(normal.kind, 'base-atlas-normal');
        assert.equal(normal.sourcePath, manifestPart.path);
        assert.deepEqual(normal.sourceRect, manifestPart.sourceRect);
      }
    });
  }
});
