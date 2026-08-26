import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BOSS_LAYERED_ATLAS_LAYOUT,
  BOSS_LAYERED_ATLAS_PATH,
  BOSS_LAYERED_ATLAS_REPORT_PATH,
  composeBossLayeredAtlas,
} from '../scripts/build-boss-layered-atlas.mjs';
import {
  cropRgba,
  decodeRgbaPng,
} from '../scripts/export-rig-layers.mjs';

const BASE_ATLAS_URL = new URL(
  '../assets/generated-v2/rig/enemy-acid-shell-king/atlas.png',
  import.meta.url,
);
const MANIFEST = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));

const PRESERVED_PART_RECTS = Object.freeze({
  tentacles: { x: 36, y: 161, width: 206, height: 76 },
  body: { x: 255, y: 56, width: 259, height: 209 },
  core: { x: 62, y: 289, width: 152, height: 182 },
  eyes: { x: 289, y: 339, width: 190, height: 99 },
  mouth: { x: 531, y: 332, width: 197, height: 126 },
});

test('Boss layered v2 atlas and metadata rebuild byte-for-byte', async () => {
  const composed = await composeBossLayeredAtlas();
  assert.deepEqual(await readFile(BOSS_LAYERED_ATLAS_PATH), composed.png);
  assert.deepEqual(
    JSON.parse(await readFile(BOSS_LAYERED_ATLAS_REPORT_PATH, 'utf8')),
    composed.report,
  );
  assert.deepEqual(
    { width: composed.atlas.width, height: composed.atlas.height },
    { width: 768, height: 768 },
  );

  for (const [id, part] of Object.entries(composed.report.parts)) {
    assert.deepEqual(part.sourceRect, BOSS_LAYERED_ATLAS_LAYOUT.parts[id].sourceRect);
    assert.ok(part.visiblePixels > 0);
    assert.ok(part.transparentPixels > 0);
    assert.ok(part.translucentPixels > 0);
  }
});

test('Boss v2 keeps every original atlas pixel and replaces only the old mixed-cell reference', async () => {
  const base = decodeRgbaPng(await readFile(BASE_ATLAS_URL), 'Boss base atlas');
  const layered = decodeRgbaPng(
    await readFile(BOSS_LAYERED_ATLAS_PATH),
    'Boss layered v2 atlas',
  );
  assert.deepEqual(
    cropRgba(layered, BOSS_LAYERED_ATLAS_LAYOUT.preservedBaseRect).pixels,
    base.pixels,
  );

  const rig = MANIFEST.rigs['enemy-acid-shell-king'];
  const layeredPath = 'assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v2.png';
  assert.ok(rig.parts.every(({ path }) => path === layeredPath));
  assert.deepEqual(
    rig.parts.map(({ id }) => id),
    ['tentacles', 'body', 'acidShell', 'crown', 'core', 'eyes', 'mouth'],
  );

  for (const [id, expectedRect] of Object.entries(PRESERVED_PART_RECTS)) {
    const actualRect = rig.parts.find((part) => part.id === id).sourceRect;
    assert.deepEqual(actualRect, expectedRect, `${id} sourceRect must not move`);
    assert.deepEqual(
      cropRgba(layered, actualRect, `${id} layered crop`).pixels,
      cropRgba(base, expectedRect, `${id} base crop`).pixels,
      `${id} pixels must not change`,
    );
  }

  assert.deepEqual(
    rig.parts.find(({ id }) => id === 'acidShell').sourceRect,
    BOSS_LAYERED_ATLAS_LAYOUT.parts.acidShell.sourceRect,
  );
  assert.deepEqual(
    rig.parts.find(({ id }) => id === 'crown').sourceRect,
    BOSS_LAYERED_ATLAS_LAYOUT.parts.crown.sourceRect,
  );
  assert.equal(
    rig.parts.some(({ sourceRect }) => (
      sourceRect.x === 525
      && sourceRect.y === 57
      && sourceRect.width === 210
      && sourceRect.height === 186
    )),
    false,
    'the old combined acid-shell/crown cell must not be referenced',
  );
});

test('Boss expression variants remain on their nested expression sheet', () => {
  const rig = MANIFEST.rigs['enemy-acid-shell-king'];
  const expressionPath = 'assets/generated-v2/rig/enemy-acid-shell-king/expressions-v2.png';
  for (const id of ['eyes', 'mouth']) {
    const variants = Object.values(rig.parts.find((part) => part.id === id).variants);
    assert.ok(variants.length > 0);
    assert.ok(variants.every(({ path }) => path === expressionPath));
  }
});
