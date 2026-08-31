import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  BUBBLE_LAYERED_ATLAS_LAYOUT,
  BUBBLE_LAYERED_ATLAS_PATH,
  BUBBLE_LAYERED_ATLAS_REPORT_PATH,
  alphaComponents4,
  composeBubbleLayeredAtlas,
} from '../scripts/build-bubble-layered-atlas.mjs';
import {
  cropRgba,
  decodeRgbaPng,
} from '../scripts/export-rig-layers.mjs';
import { BUBBLE_CLIPS } from '../src/animation/clips.js';
import { renderLayeredRig } from '../src/animation/layer-renderer.js';
import { BUBBLE_RIG } from '../src/animation/rigs.js';

const BASE_ATLAS_URL = new URL(
  '../assets/generated-v2/rig/survivor-bubble-float/atlas.png',
  import.meta.url,
);
const MANIFEST = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));
const LAYERED_PATH = 'assets/generated-v2/rig/survivor-bubble-float/atlas-layered-v2.png';
const BUBBLE_IDS = Object.freeze(['bubbleLarge', 'bubbleSmall', 'bubbleMedium']);
const EXPECTED_BIND_RECTS = Object.freeze({
  bubbleLarge: Object.freeze({ x: 14, y: -104, width: 28, height: 28 }),
  bubbleSmall: Object.freeze({ x: 3, y: -97, width: 12, height: 12 }),
  bubbleMedium: Object.freeze({ x: 36, y: -91, width: 19, height: 18 }),
});

function isInside(rect, x, y) {
  return x >= rect.x
    && y >= rect.y
    && x < rect.x + rect.width
    && y < rect.y + rect.height;
}

test('Bubble layered v2 atlas and report rebuild byte-for-byte', async () => {
  const composed = await composeBubbleLayeredAtlas();
  assert.deepEqual(await readFile(BUBBLE_LAYERED_ATLAS_PATH), composed.png);
  assert.deepEqual(
    JSON.parse(await readFile(BUBBLE_LAYERED_ATLAS_REPORT_PATH, 'utf8')),
    composed.report,
  );
  assert.deepEqual(
    { width: composed.atlas.width, height: composed.atlas.height },
    { width: 768, height: 512 },
  );
  assert.equal(
    composed.report.baseAtlas.pngSha256,
    '9b85df215d9e663d19b5bb5d32b6a4eef04fb851b6b51175031b7e2be362190b',
  );
  assert.deepEqual(
    Object.values(composed.report.parts).map(({ sourceArea }) => sourceArea),
    [4258, 1645, 546],
  );
  assert.deepEqual(composed.report.extraction.discarded, {
    componentCount: 11,
    pixelCount: 21,
    alphaSum: 21,
    components: composed.report.extraction.discarded.components,
  });
  assert.deepEqual(
    composed.report.extraction.discarded.components.map(({ area }) => area),
    [5, 4, 3, 2, 1, 1, 1, 1, 1, 1, 1],
  );
  assert.equal(composed.report.extraction.componentCount, 14);
  assert.equal(composed.report.extraction.sourceVisiblePixels, 6470);
  assert.equal(composed.report.extraction.selectedPixels, 6449);
  assert.equal(composed.report.output.changedPixels, 6449);
  assert.equal(composed.report.output.changedOutsideTargets, 0);
});

test('Bubble v2 preserves every base pixel and only adds exact component bytes to empty cells', async () => {
  const base = decodeRgbaPng(await readFile(BASE_ATLAS_URL), 'Bubble base atlas');
  const layered = decodeRgbaPng(
    await readFile(BUBBLE_LAYERED_ATLAS_PATH),
    'Bubble layered v2 atlas',
  );
  const targets = Object.values(BUBBLE_LAYERED_ATLAS_LAYOUT.parts)
    .map(({ sourceRect }) => sourceRect);
  let changedPixels = 0;

  for (let y = 0; y < base.height; y += 1) {
    for (let x = 0; x < base.width; x += 1) {
      const offset = (y * base.width + x) * 4;
      const changed = [0, 1, 2, 3].some((channel) => (
        base.pixels[offset + channel] !== layered.pixels[offset + channel]
      ));
      if (!changed) continue;
      changedPixels += 1;
      assert.ok(targets.some((rect) => isInside(rect, x, y)));
      assert.deepEqual([...base.pixels.subarray(offset, offset + 4)], [0, 0, 0, 0]);
      assert.ok(layered.pixels[offset + 3] > 0);
    }
  }
  assert.equal(changedPixels, 6449);
  assert.deepEqual(
    cropRgba(layered, BUBBLE_LAYERED_ATLAS_LAYOUT.sourceRect).pixels,
    cropRgba(base, BUBBLE_LAYERED_ATLAS_LAYOUT.sourceRect).pixels,
    'the legacy grouped source remains byte-identical',
  );
});

test('Bubble component cells contain one clean component each with no resampling or cross-contamination', async () => {
  const composed = await composeBubbleLayeredAtlas();
  const layered = decodeRgbaPng(
    await readFile(BUBBLE_LAYERED_ATLAS_PATH),
    'Bubble layered v2 atlas',
  );
  const expectedAreas = [4258, 1645, 546];
  const componentKeys = ['bubbleLarge', 'bubbleMedium', 'bubbleSmall'];

  for (let index = 0; index < componentKeys.length; index += 1) {
    const id = componentKeys[index];
    const spec = BUBBLE_LAYERED_ATLAS_LAYOUT.parts[id];
    const report = composed.report.parts[id];
    const cell = cropRgba(layered, spec.sourceRect, `${id} cell`);
    const components = alphaComponents4(cell);
    assert.equal(components.length, 1, `${id} must contain exactly one alpha component`);
    assert.equal(components[0].area, expectedAreas[index]);
    assert.deepEqual(components[0].bounds, report.placement);
    assert.equal(report.placement.x, 4);
    assert.equal(report.placement.y, 4);
    assert.equal(report.visiblePixels, report.sourceArea);
    assert.ok(report.transparentPixels > 0, `${id} needs a transparent background`);
    assert.ok(report.translucentPixels > 0, `${id} must retain its translucent edge pixels`);

    const sourceComponent = composed.components[index];
    const sourceByIndex = new Map(sourceComponent.indices.map((sourceIndex) => {
      const sourceX = sourceIndex % composed.source.width;
      const sourceY = Math.floor(sourceIndex / composed.source.width);
      return [`${sourceX - sourceComponent.bounds.x}:${sourceY - sourceComponent.bounds.y}`, sourceIndex];
    }));
    for (const targetIndex of components[0].indices) {
      const targetX = targetIndex % cell.width - report.placement.x;
      const targetY = Math.floor(targetIndex / cell.width) - report.placement.y;
      const sourceIndex = sourceByIndex.get(`${targetX}:${targetY}`);
      assert.notEqual(sourceIndex, undefined, `${id} gained a pixel outside its source component`);
      assert.deepEqual(
        [...cell.pixels.subarray(targetIndex * 4, targetIndex * 4 + 4)],
        [...composed.source.pixels.subarray(sourceIndex * 4, sourceIndex * 4 + 4)],
        `${id} component RGBA bytes must be copied exactly`,
      );
    }
  }
});

test('Bubble manifest uses the layered atlas and binds all three independent component cells', () => {
  const rig = MANIFEST.rigs['survivor-bubble-float'];
  assert.ok(rig.parts.every(({ path }) => path === LAYERED_PATH));
  for (const id of BUBBLE_IDS) {
    const part = rig.parts.find((candidate) => candidate.id === id);
    assert.ok(part, `${id} must be a real Bubble rig part`);
    assert.equal(part.bone, id);
    assert.deepEqual(part.sourceRect, BUBBLE_LAYERED_ATLAS_LAYOUT.parts[id].sourceRect);
    assert.deepEqual(part.bindRect, EXPECTED_BIND_RECTS[id]);
    assert.ok(part.z < rig.parts.find(({ id: partId }) => partId === 'body').z);

    const pivot = BUBBLE_RIG.bones[id].pivot;
    assert.equal(pivot.x, part.bindRect.x + part.bindRect.width / 2);
    assert.equal(pivot.y, part.bindRect.y + part.bindRect.height / 2);
    assert.equal(BUBBLE_RIG.bones[id].parent, 'bubbles');

    assert.ok(part.bindRect.x >= 0 && part.bindRect.x + part.bindRect.width <= 60);
    assert.ok(part.bindRect.y >= -110 && part.bindRect.y + part.bindRect.height <= -70);
  }
  assert.equal(rig.parts.some(({ id }) => id === 'bubblesBack'), false);

  const targetRects = Object.values(BUBBLE_LAYERED_ATLAS_LAYOUT.parts)
    .map(({ sourceRect }) => JSON.stringify(sourceRect));
  const manifestRects = rig.parts
    .filter(({ id }) => BUBBLE_IDS.includes(id))
    .map(({ sourceRect }) => JSON.stringify(sourceRect));
  assert.deepEqual(manifestRects.sort(), targetRects.sort());

  for (const id of ['eyes', 'mouth']) {
    const expressionPath = 'assets/generated-v2/rig/survivor-bubble-float/expressions-v2.png';
    const variants = Object.values(rig.parts.find((part) => part.id === id).variants);
    assert.ok(variants.every(({ path }) => path === expressionPath));
  }
});

test('Bubble runtime draws every independent cell and gives each one a distinct subtle track', () => {
  const rig = MANIFEST.rigs['survivor-bubble-float'];
  const calls = [];
  const stack = [];
  const ctx = {
    globalAlpha: 1,
    save() {
      stack.push(this.globalAlpha);
    },
    restore() {
      this.globalAlpha = stack.pop();
    },
    translate() {},
    rotate() {},
    scale() {},
    drawImage(image, ...args) {
      calls.push({ image, args });
    },
  };
  const atlas = { width: 768, height: 512 };
  assert.equal(
    renderLayeredRig(ctx, BUBBLE_RIG, {}, rig, { [LAYERED_PATH]: atlas }),
    true,
  );

  for (const id of BUBBLE_IDS) {
    const part = rig.parts.find((candidate) => candidate.id === id);
    const call = calls.find(({ args }) => (
      args[0] === part.sourceRect.x
      && args[1] === part.sourceRect.y
      && args[2] === part.sourceRect.width
      && args[3] === part.sourceRect.height
    ));
    assert.ok(call, `${id} must reach renderLayeredRig as its own draw call`);
    assert.deepEqual(call.args.slice(4), [
      part.bindRect.x,
      part.bindRect.y,
      part.bindRect.width,
      part.bindRect.height,
    ]);
  }

  for (const [clipName, clip] of Object.entries(BUBBLE_CLIPS)) {
    const signatures = new Set();
    for (const id of BUBBLE_IDS) {
      const track = clip.tracks[id];
      assert.ok(track, `${clipName}.${id} must have an independent track`);
      const values = ['x', 'y', 'rotation'].flatMap((property) => {
        const source = track[property];
        if (source == null) return [];
        return Array.isArray(source) ? source.map((frame) => frame[1]) : [source];
      });
      assert.ok(values.some((value) => value !== 0), `${clipName}.${id} cannot stay rigid`);
      signatures.add(JSON.stringify(track));
    }
    assert.equal(signatures.size, BUBBLE_IDS.length, `${clipName} needs three distinct drifts`);
  }
});
