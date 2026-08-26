import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  WINDCAP_LAYERED_ATLAS_LAYOUT,
  WINDCAP_LAYERED_ATLAS_PATH,
  WINDCAP_LAYERED_ATLAS_REPORT_PATH,
  composeWindcapLayeredAtlas,
} from '../scripts/build-windcap-layered-atlas.mjs';
import {
  cropRgba,
  decodeRgbaPng,
} from '../scripts/export-rig-layers.mjs';

const BASE_ATLAS_URL = new URL(
  '../assets/generated-v2/rig/enemy-windcap/atlas.png',
  import.meta.url,
);
const MANIFEST = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));

test('Windcap layered v2 atlas and metadata rebuild byte-for-byte', async () => {
  const composed = await composeWindcapLayeredAtlas();
  assert.deepEqual(await readFile(WINDCAP_LAYERED_ATLAS_PATH), composed.png);
  assert.deepEqual(
    JSON.parse(await readFile(WINDCAP_LAYERED_ATLAS_REPORT_PATH, 'utf8')),
    composed.report,
  );
  assert.deepEqual(
    { width: composed.atlas.width, height: composed.atlas.height },
    { width: 768, height: 512 },
  );
  assert.ok(composed.report.cleanup.maskPixels > 900);
  assert.ok(composed.report.cleanup.changedPixels > 900);
  assert.ok(composed.report.cleanup.changedPixels <= composed.report.cleanup.maskPixels);
  assert.equal(composed.report.cleanup.outsideMaskChangedPixels, 0);
  assert.equal(composed.report.cleanup.alphaChangedPixels, 0);
});

test('Windcap v2 changes only the mapped eye cleanup mask and preserves silhouette alpha', async () => {
  const base = decodeRgbaPng(await readFile(BASE_ATLAS_URL), 'Windcap base atlas');
  const layered = decodeRgbaPng(
    await readFile(WINDCAP_LAYERED_ATLAS_PATH),
    'Windcap layered v2 atlas',
  );
  const composed = await composeWindcapLayeredAtlas();
  const stemRect = WINDCAP_LAYERED_ATLAS_LAYOUT.stem.sourceRect;
  let changedPixels = 0;

  for (let y = 0; y < base.height; y += 1) {
    for (let x = 0; x < base.width; x += 1) {
      const offset = (y * base.width + x) * 4;
      assert.equal(layered.pixels[offset + 3], base.pixels[offset + 3]);
      const changed = [0, 1, 2, 3].some((channel) => (
        layered.pixels[offset + channel] !== base.pixels[offset + channel]
      ));
      if (!changed) continue;
      changedPixels += 1;
      assert.ok(x >= stemRect.x && x < stemRect.x + stemRect.width);
      assert.ok(y >= stemRect.y && y < stemRect.y + stemRect.height);
      const maskIndex = (y - stemRect.y) * stemRect.width + (x - stemRect.x);
      assert.equal(composed.cleanupMask[maskIndex], 1);
    }
  }
  assert.equal(changedPixels, composed.report.cleanup.changedPixels);
});

test('Windcap keeps cap, real face cells, and identity geometry byte-identical', async () => {
  const base = decodeRgbaPng(await readFile(BASE_ATLAS_URL), 'Windcap base atlas');
  const layered = decodeRgbaPng(
    await readFile(WINDCAP_LAYERED_ATLAS_PATH),
    'Windcap layered v2 atlas',
  );
  for (const id of ['cap', 'eyes', 'mouth']) {
    const rect = WINDCAP_LAYERED_ATLAS_LAYOUT[id].sourceRect;
    assert.deepEqual(
      cropRgba(layered, rect, `${id} layered crop`).pixels,
      cropRgba(base, rect, `${id} base crop`).pixels,
      `${id} source cell must remain byte-identical`,
    );
  }

  const rig = MANIFEST.rigs['enemy-windcap'];
  const layeredPath = 'assets/generated-v2/rig/enemy-windcap/atlas-layered-v2.png';
  assert.ok(rig.parts.every(({ path }) => path === layeredPath));
  for (const id of ['stem', 'cap', 'eyes', 'mouth']) {
    const part = rig.parts.find((candidate) => candidate.id === id);
    assert.deepEqual(part.sourceRect, WINDCAP_LAYERED_ATLAS_LAYOUT[id].sourceRect);
  }
  assert.deepEqual(
    rig.parts.find(({ id }) => id === 'stem').bindRect,
    WINDCAP_LAYERED_ATLAS_LAYOUT.stem.bindRect,
  );
  assert.deepEqual(
    rig.parts.find(({ id }) => id === 'eyes').bindRect,
    WINDCAP_LAYERED_ATLAS_LAYOUT.eyes.bindRect,
  );
  for (const id of ['eyes', 'mouth']) {
    const variants = Object.values(rig.parts.find((part) => part.id === id).variants);
    assert.ok(variants.every(({ path }) => (
      path === 'assets/generated-v2/rig/enemy-windcap/expressions-v2.png'
    )));
  }
});

test('Windcap stem cleanup removes legacy eye ink at the bind placement', async () => {
  const { report } = await composeWindcapLayeredAtlas();
  const { before, after } = report.cleanup.legacyEyeInk;
  assert.ok(before.compared > 450);
  assert.ok(before.nearInkRatio > 0.45);
  assert.ok(before.darkInkRatio > 0.5);
  assert.ok(after.nearInkRatio < 0.02);
  assert.ok(after.darkInkRatio < 0.08);
});
