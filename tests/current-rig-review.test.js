import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { decodeRgbaPng } from '../scripts/export-rig-layers.mjs';
import {
  renderCurrentRigReviews,
  REVIEW_LAYOUT,
} from '../scripts/render-rig-review-current.mjs';

const MANIFEST = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));

const EXPECTED_COLUMNS = Object.freeze({
  shell: ['bind', 'idle', 'attack', 'hurt', 'downed'],
  crystal: ['bind', 'idle', 'attack', 'hurt', 'downed'],
  bubble: ['bind', 'idle', 'attack', 'hurt', 'downed'],
  sprout: ['bind', 'idle', 'attack', 'hurt', 'downed'],
  bug: ['bind', 'idle', 'move', 'attack', 'hurt', 'death'],
  windcap: ['bind', 'idle', 'move', 'attack', 'hurt', 'death'],
  stone: ['bind', 'idle', 'move', 'attack', 'hurt', 'death'],
  boss: ['bind', 'idle', 'move', 'attack', 'hurt', 'death', 'charge'],
});

const ACTION_EXPRESSIONS = Object.freeze({
  bind: 'normal',
  idle: 'blink',
  move: 'normal',
  attack: 'attack',
  hurt: 'hurt',
  downed: 'hurt',
  death: 'hurt',
  charge: 'normal',
});

const ACTION_VARIANTS = Object.freeze({
  bind: [],
  idle: ['eyes:blink'],
  move: [],
  attack: ['eyes:attack', 'mouth:open'],
  hurt: ['eyes:hurt', 'mouth:hurt'],
  downed: ['eyes:hurt', 'mouth:hurt'],
  death: ['eyes:hurt', 'mouth:hurt'],
  charge: [],
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function declaredAssets(entry) {
  const result = new Set();
  for (const part of entry.parts) {
    result.add(part.path);
    for (const variant of Object.values(part.variants ?? {})) {
      result.add(variant.path ?? part.path);
    }
  }
  return [...result].sort();
}

test('current rig review sheets are deterministic, non-empty, and column-safe', async () => {
  const temporaryRoots = await Promise.all([
    mkdtemp(path.join(os.tmpdir(), 'slime-rig-review-')),
    mkdtemp(path.join(os.tmpdir(), 'slime-rig-review-')),
  ]);
  const outputRoots = temporaryRoots.map((root) => path.join(root, 'rig-review-current'));

  try {
    const [first, second] = await Promise.all(outputRoots.map((outputRoot) => (
      renderCurrentRigReviews({ outputRoot })
    )));
    assert.deepEqual(first, second, 'review metadata must be byte-stable in meaning');
    assert.equal(Object.keys(first.rigs).length, 8);
    assert.deepEqual(Object.keys(first.rigs), Object.keys(MANIFEST.rigs));

    for (const [ownerId, review] of Object.entries(first.rigs)) {
      assert.deepEqual(review.sourceAssets, declaredAssets(MANIFEST.rigs[ownerId]));
      for (const assetPath of review.sourceAssets) {
        assert.match(assetPath, new RegExp(`^assets/generated-v2/rig/${ownerId}/[^/]+\\.png$`));
        assert.doesNotMatch(assetPath, /(?:review|preview|candidate|generated\/)/i);
      }

      assert.equal(review.width, REVIEW_LAYOUT.cellWidth * review.columns.length);
      assert.equal(review.height, REVIEW_LAYOUT.height);
      assert.ok(review.scale > 0 && review.scale <= REVIEW_LAYOUT.maximumScale);
      const expectedColumns = EXPECTED_COLUMNS[review.rigId];
      assert.deepEqual(
        review.columns.map(({ key }) => key),
        expectedColumns,
      );
      assert.deepEqual(
        review.columns.map(({ expression }) => expression),
        expectedColumns.map((key) => ACTION_EXPRESSIONS[key]),
      );
      assert.deepEqual(
        review.columns.map(({ variantsDrawn }) => variantsDrawn),
        expectedColumns.map((key) => ACTION_VARIANTS[key]),
        `${ownerId} must draw the real expression-sheet variants`,
      );

      for (let column = 0; column < review.columns.length; column += 1) {
        const frame = review.columns[column];
        const startX = column * REVIEW_LAYOUT.cellWidth;
        const endX = startX + REVIEW_LAYOUT.cellWidth;
        assert.ok(frame.drawCount > 0, `${ownerId}.${frame.key} must issue layer draws`);
        assert.ok(
          frame.pixelBounds.visiblePixels > 1000,
          `${ownerId}.${frame.key} must contain visible rig pixels`,
        );
        assert.ok(frame.pixelBounds.minX >= startX + 1);
        assert.ok(frame.pixelBounds.maxX < endX - 1);
        assert.ok(frame.pixelBounds.minY >= REVIEW_LAYOUT.headerHeight);
        assert.ok(frame.pixelBounds.maxY < REVIEW_LAYOUT.height);
        assert.ok(frame.geometricBounds.minX >= startX + 1);
        assert.ok(frame.geometricBounds.maxX <= endX - 1);
        assert.ok(frame.geometricBounds.minY >= REVIEW_LAYOUT.headerHeight);
        assert.ok(frame.geometricBounds.maxY <= REVIEW_LAYOUT.height - 1);
      }

      const firstPng = await readFile(path.join(outputRoots[0], review.file));
      const secondPng = await readFile(path.join(outputRoots[1], review.file));
      assert.equal(sha256(firstPng), review.pngSha256);
      assert.equal(sha256(secondPng), review.pngSha256);
      assert.deepEqual(firstPng, secondPng, `${ownerId} review PNG must be reproducible`);
      const decoded = decodeRgbaPng(firstPng, review.file);
      assert.equal(decoded.width, review.width);
      assert.equal(decoded.height, REVIEW_LAYOUT.height);
      for (let offset = 3; offset < decoded.pixels.length; offset += 4) {
        assert.equal(decoded.pixels[offset], 255, `${ownerId} background must stay opaque`);
      }
    }

    const boss = first.rigs['enemy-acid-shell-king'];
    const bossParts = MANIFEST.rigs['enemy-acid-shell-king'].parts;
    assert.deepEqual(
      bossParts.filter(({ id }) => ['acidShell', 'crown'].includes(id)).map(({ id }) => id),
      ['acidShell', 'crown'],
      'Boss manifest must retain two explicit shell/crown parts',
    );
    assert.equal(boss.splitLayers.sourceRectsDisjoint, true);
    assert.ok(boss.splitLayers.acidShell.visiblePixels > 0);
    assert.ok(boss.splitLayers.crown.visiblePixels > 0);
    assert.ok(boss.sourceAssets.includes(
      'assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v2.png',
    ));
    for (const column of boss.columns) {
      assert.ok(column.partsDrawn.includes('acidShell'), `${column.key} must draw acidShell`);
      assert.ok(column.partsDrawn.includes('crown'), `${column.key} must draw crown`);
    }

    const firstIndex = await readFile(path.join(outputRoots[0], 'index.json'));
    const secondIndex = await readFile(path.join(outputRoots[1], 'index.json'));
    assert.deepEqual(firstIndex, secondIndex, 'review index must be reproducible');
  } finally {
    await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
  }
});
