import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { SOLDIER_RIG } from '../src/animation/rigs.js';
import { SOLDIER_CLIPS } from '../src/animation/clips.js';
import { decodeRgbaPng } from '../scripts/export-rig-layers.mjs';

function contextFor(canvas = null) {
  const stack = [];
  const calls = [];
  const target = {
    canvas,
    calls,
    globalAlpha: 1,
    save() { stack.push(this.globalAlpha); },
    restore() { this.globalAlpha = stack.pop() ?? 1; },
    translate(...args) { calls.push(['translate', ...args]); },
    rotate(...args) { calls.push(['rotate', ...args]); },
    scale(...args) { calls.push(['scale', ...args]); },
    setTransform() {},
    resetTransform() {},
    clearRect() {},
    drawImage(...args) { calls.push(['drawImage', ...args]); },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
  };
  return new Proxy(target, {
    get(object, property) {
      if (property in object) return object[property];
      return () => {};
    },
  });
}

function readyStore(asset, requested) {
  return {
    useOrFallback(key, render, fallback) {
      requested.push(key);
      try {
        render(asset);
        return true;
      } catch (error) {
        fallback('failed', error);
        return false;
      }
    },
  };
}

function highAlphaBounds(atlas, slot, threshold = 32) {
  const cell = 418;
  const originX = (slot % 3) * cell;
  const originY = Math.floor(slot / 3) * cell;
  let minX = cell;
  let minY = cell;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const alpha = atlas.pixels[((originY + y) * atlas.width + originX + x) * 4 + 3];
      if (alpha < threshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function boundsCenter(bounds) {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

test('formal 3x3 character atlas cells keep a two-pixel transparent sampling gutter', async () => {
  const cell = 418;
  const gutter = 2;
  const atlases = [
    new URL('../assets/generated/soldier/soldier-shield-dun-atlas-v1.png', import.meta.url),
    new URL('../assets/generated/soldier/soldier-bean-bow-atlas-v1.png', import.meta.url),
    new URL('../assets/generated/soldier/soldier-bounce-hammer-atlas-v1.png', import.meta.url),
    new URL('../assets/generated/soldier/soldier-leaf-spinner-atlas-v1.png', import.meta.url),
    new URL('../assets/generated/hero/hero-berry-burst-atlas-v1.png', import.meta.url),
  ];
  for (const atlasUrl of atlases) {
    const atlas = decodeRgbaPng(await readFile(atlasUrl), atlasUrl.pathname);
    assert.equal(atlas.width, cell * 3);
    assert.equal(atlas.height, cell * 3);
    for (let index = 0; index < 9; index += 1) {
      const originX = (index % 3) * cell;
      const originY = Math.floor(index / 3) * cell;
      let visiblePixels = 0;
      let gutterPixels = 0;
      for (let y = 0; y < cell; y += 1) {
        for (let x = 0; x < cell; x += 1) {
          const alpha = atlas.pixels[
            ((originY + y) * atlas.width + originX + x) * 4 + 3
          ];
          if (alpha > 0) visiblePixels += 1;
          if (alpha > 0 && (
            x < gutter || y < gutter || x >= cell - gutter || y >= cell - gutter
          )) {
            gutterPixels += 1;
          }
        }
      }
      assert.ok(visiblePixels > 0, `${atlasUrl.pathname} cell ${index} is non-empty`);
      assert.equal(gutterPixels, 0, `${atlasUrl.pathname} cell ${index} has a ${gutter}px transparent gutter`);
    }
  }
});

test('formal atlases keep stable expressions and the newest slimes reuse the approved round eyes', async () => {
  const atlasUrls = [
    new URL('../assets/generated/soldier/soldier-shield-dun-atlas-v1.png', import.meta.url),
    new URL('../assets/generated/soldier/soldier-bean-bow-atlas-v1.png', import.meta.url),
    new URL('../assets/generated/soldier/soldier-bounce-hammer-atlas-v1.png', import.meta.url),
    new URL('../assets/generated/soldier/soldier-leaf-spinner-atlas-v1.png', import.meta.url),
    new URL('../assets/generated/hero/hero-berry-burst-atlas-v1.png', import.meta.url),
    new URL('../assets/generated/hero/hero-dew-bloom-atlas-v1.png', import.meta.url),
  ];
  const approvedEyes = decodeRgbaPng(await readFile(new URL(
    '../assets/generated-v2/rig-parts-exported/survivor-shell-shell/eyes.png',
    import.meta.url,
  )), 'approved round slime eyes');
  for (const atlasUrl of atlasUrls) {
    const atlas = decodeRgbaPng(await readFile(atlasUrl), atlasUrl.pathname);
    const normalEyes = highAlphaBounds(atlas, 3);
    const usesRestoredEyes = /bounce-hammer|leaf-spinner|hero-berry|hero-dew/.test(
      atlasUrl.pathname,
    );
    if (usesRestoredEyes) {
      const originX = 0;
      const originY = 418;
      let matchesApprovedAlpha = true;
      compareAlpha: for (let y = 0; y < 418; y += 1) {
        for (let x = 0; x < 418; x += 1) {
          const sourceX = x - 123;
          const sourceY = y - 158;
          const expected = (
            sourceX >= 0 && sourceX < approvedEyes.width
            && sourceY >= 0 && sourceY < approvedEyes.height
          ) ? approvedEyes.pixels[(sourceY * approvedEyes.width + sourceX) * 4 + 3] : 0;
          const actual = atlas.pixels[
            ((originY + y) * atlas.width + originX + x) * 4 + 3
          ];
          if (actual !== expected) {
            matchesApprovedAlpha = false;
            break compareAlpha;
          }
        }
      }
      assert.equal(matchesApprovedAlpha, true,
        `${atlasUrl.pathname} normal eyes retain the approved old-style alpha shape`);
      const normalCenter = boundsCenter(normalEyes);
      for (const slot of [5, 7]) {
        const center = boundsCenter(highAlphaBounds(atlas, slot));
        assert.ok(Math.abs(center.x - normalCenter.x) <= 1,
          `${atlasUrl.pathname} expression ${slot} keeps its horizontal eye anchor`);
        assert.ok(Math.abs(center.y - normalCenter.y) <= 8,
          `${atlasUrl.pathname} expression ${slot} keeps its vertical eye anchor`);
      }
    } else {
      for (const slot of [5, 7]) {
        assert.deepEqual(highAlphaBounds(atlas, slot), normalEyes,
          `${atlasUrl.pathname} expression eyes share the normal anchor`);
      }
    }
    const normalMouthCenter = boundsCenter(highAlphaBounds(atlas, 4));
    for (const slot of [6, 8]) {
      const center = boundsCenter(highAlphaBounds(atlas, slot));
      assert.ok(Math.abs(center.x - normalMouthCenter.x) <= 1);
      assert.ok(Math.abs(center.y - normalMouthCenter.y) <= 1);
    }

    if (usesRestoredEyes) {
      const mouth = highAlphaBounds(atlas, 4);
      assert.ok(normalEyes.maxY <= 250,
        `${atlasUrl.pathname} keeps its eyes in the upper face`);
      assert.ok(mouth.minY - normalEyes.maxY >= 12,
        `${atlasUrl.pathname} leaves a clear gap between eyes and mouth`);
    }
  }
});

test('every formal soldier mouth is centered beneath its matching eyes', async () => {
  const atlasUrls = [
    new URL('../assets/generated/soldier/soldier-shield-dun-atlas-v1.png', import.meta.url),
    new URL('../assets/generated/soldier/soldier-bean-bow-atlas-v1.png', import.meta.url),
    new URL('../assets/generated/soldier/soldier-bounce-hammer-atlas-v1.png', import.meta.url),
    new URL('../assets/generated/soldier/soldier-leaf-spinner-atlas-v1.png', import.meta.url),
  ];
  for (const atlasUrl of atlasUrls) {
    const atlas = decodeRgbaPng(await readFile(atlasUrl), atlasUrl.pathname);
    for (const [eyesSlot, mouthSlot] of [[3, 4], [5, 6], [7, 8]]) {
      const offset = boundsCenter(highAlphaBounds(atlas, mouthSlot)).x
        - boundsCenter(highAlphaBounds(atlas, eyesSlot)).x;
      assert.ok(Math.abs(offset) <= 1,
        `${atlasUrl.pathname} expression ${mouthSlot} mouth offset is ${offset.toFixed(2)}px`);
    }
  }
});

test('soldier rig keeps deform, headgear inertia, and equipment recoil independent', () => {
  assert.equal(SOLDIER_RIG.bones.body.parent, 'deform');
  assert.equal(SOLDIER_RIG.bones.face.parent, 'deform');
  assert.equal(SOLDIER_RIG.bones.headgear.parent, 'motion');
  assert.equal(SOLDIER_RIG.bones.equipment.parent, 'motion');
  assert.notDeepEqual(SOLDIER_CLIPS.attack.tracks.headgear, SOLDIER_CLIPS.attack.tracks.equipment);
  assert.equal(SOLDIER_CLIPS.attack.expression, 'attack');
  assert.equal(SOLDIER_CLIPS.hurt.expression, 'hurt');
  assert.equal(SOLDIER_CLIPS.downed.duration, 0.52);
  assert.equal(SOLDIER_CLIPS.downed.mode, 'once');
  assert.equal(SOLDIER_CLIPS.downed.expression, 'hurt');
  assert.equal(SOLDIER_CLIPS.downed.priority, 90);
  assert.ok(SOLDIER_CLIPS.downed.tracks.deform.scaleY.at(-1)[1] < 0.8,
    'downed pose visibly compresses the body');
  assert.notDeepEqual(
    SOLDIER_CLIPS.downed.tracks.headgear,
    SOLDIER_CLIPS.downed.tracks.equipment,
    'headgear and equipment retain independent throw inertia',
  );
  assert.deepEqual(SOLDIER_CLIPS.downed.events, [{ time: 0.52, name: 'downed' }]);
});

test('drawSoldier uses one shared atlas-space bind pose and flips facing once', async () => {
  const previous = globalThis.OffscreenCanvas;
  const surfaces = [];
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = contextFor(this);
      surfaces.push(this.context);
    }
    getContext() { return this.context; }
  };
  try {
    const { drawSoldier } = await import(`../src/draw.js?soldier=${Date.now()}`);
    const atlas = { id: 'formal-soldier', width: 1254, height: 1254 };
    const requested = [];
    const main = contextFor({ id: 'main' });
    assert.equal(drawSoldier(main, 120, 300, 80, {
      assetStore: readyStore(atlas, requested),
      assetKey: 'soldier-ranged-atlas',
      squadType: 'ranged',
      facing: -1,
      state: 'attack',
      attackPulse: 0.5,
    }), true);
    assert.deepEqual(requested, ['soldier-ranged-atlas']);
    assert.equal(surfaces.length, 1);
    const layerCalls = surfaces[0].calls.filter(([method, image]) => (
      method === 'drawImage' && image === atlas
    ));
    assert.equal(layerCalls.length, 5, 'body, headgear, equipment, eyes, and mouth draw once');
    assert.ok(layerCalls.some(([, , sx, sy]) => sx === 836 && sy === 418),
      'attack eyes use row-major cell 5');
    assert.ok(layerCalls.some(([, , sx, sy]) => sx === 0 && sy === 836),
      'attack mouth uses row-major cell 6');
    for (const layerCall of layerCalls) {
      assert.deepEqual(layerCall.slice(6, 10), [-60, -120, 120, 120],
        'every physical and facial layer shares one logical atlas bind rectangle');
    }
    assert.equal(main.calls.filter(([method, xScale]) => (
      method === 'scale' && xScale < 0
    )).length, 1, 'requested left facing is applied only at the outer composite');
    assert.equal(main.calls.filter(([method]) => method === 'drawImage').length, 1,
      'the completed offscreen rig reaches the main canvas atomically');

    surfaces.forEach((surface) => { surface.calls.length = 0; });
    const meleeMain = contextFor({ id: 'melee-main' });
    assert.equal(drawSoldier(meleeMain, 120, 300, 80, {
      assetStore: readyStore(atlas, requested),
      assetKey: 'soldier-melee-atlas',
      squadType: 'melee',
      state: 'hurt',
      hit: 0.8,
    }), true);
    const meleeLayers = surfaces[0].calls.filter(([method, image]) => (
      method === 'drawImage' && image === atlas
    ));
    for (const layerCall of meleeLayers) {
      assert.deepEqual(layerCall.slice(6, 10), [-60, -120, 120, 120]);
    }

    surfaces[0].calls.length = 0;
    const leftDownedMain = contextFor();
    assert.equal(drawSoldier(leftDownedMain, 0, 0, 80, {
      assetStore: readyStore(atlas, requested),
      assetKey: 'soldier-melee-atlas',
      squadType: 'melee',
      facing: -1,
      pose: { root: { rotation: 0.12 }, deform: { scaleY: 0.78 } },
      expressionSample: {
        state: 'attack',
        slots: {
          eyes: {
            from: 'normal', to: 'attack', weights: { from: 0.35, to: 0.65 },
          },
          mouth: {
            from: 'normal', to: 'attack', weights: { from: 0.35, to: 0.65 },
          },
        },
      },
    }), true);
    const blendedLayers = surfaces.flatMap(({ calls }) => calls).filter(([method, image]) => (
      method === 'drawImage' && image === atlas
    ));
    assert.equal(blendedLayers.length, 7,
      'three physical layers plus two weighted eyes and two weighted mouths');
    for (const [sx, sy] of [[0, 418], [836, 418], [418, 418], [0, 836]]) {
      assert.ok(blendedLayers.some(([, , sourceX, sourceY]) => (
        sourceX === sx && sourceY === sy
      )), `crossfade consumes expression cell ${sx},${sy}`);
    }
    assert.equal(leftDownedMain.calls.filter(([method, xScale]) => (
      method === 'scale' && xScale < 0
    )).length, 1, 'left-facing downed pose remains left-facing');
  } finally {
    if (previous === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previous;
  }
});

test('invalid or missing soldier atlas uses one whole vector fallback without hero assets', async () => {
  const { drawSoldier } = await import('../src/draw.js');
  for (const asset of [null, { width: 1253, height: 1254 }]) {
    const requested = [];
    const store = asset
      ? readyStore(asset, requested)
      : { useOrFallback(key, render, fallback) { requested.push(key); fallback(); return false; } };
    const main = contextFor();
    assert.equal(drawSoldier(main, 20, 80, 60, {
      assetStore: store,
      assetKey: 'soldier-melee-atlas',
      squadType: 'melee',
    }), false);
    assert.deepEqual(requested, ['soldier-melee-atlas']);
    assert.ok(main.calls.length > 0, 'the complete vector soldier fallback is drawn');
  }
});

test('formal hero and new squad atlases share the generic rig without falling back to 壳壳', async () => {
  const previous = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = contextFor(this);
    }
    getContext() { return this.context; }
  };
  try {
    const { drawAtlasCharacter } = await import(`../src/draw.js?atlas=${Date.now()}`);
    const atlas = { id: 'berry-atlas', width: 1254, height: 1254 };
    const requested = [];
    assert.equal(drawAtlasCharacter(contextFor(), 32, 96, 74, {
      assetStore: readyStore(atlas, requested),
      assetKey: 'hero-berry-burst-atlas-v1',
      state: 'attack',
      attackPulse: 0.7,
    }), true);
    assert.deepEqual(requested, ['hero-berry-burst-atlas-v1']);

    const absentCalls = contextFor().calls;
    const absentContext = contextFor();
    assert.equal(drawAtlasCharacter(absentContext, 32, 96, 74, {
      assetKey: 'hero-dew-bloom-atlas-v1',
    }), false);
    assert.ok(absentContext.calls.length > absentCalls.length,
      'a missing formal atlas uses its neutral emergency silhouette, not another hero');
  } finally {
    if (previous === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previous;
  }
});

test('skill step kinds select generated animated frames instead of a fading static icon', async () => {
  const { drawSkillEffectFrames, SKILL_EFFECT_ASSET_KEY_BY_STEP_KIND } = await import('../src/draw.js');
  assert.equal(SKILL_EFFECT_ASSET_KEY_BY_STEP_KIND['berry-finale'],
    'effect-berry-chain-barrage-frames-v1');
  assert.equal(SKILL_EFFECT_ASSET_KEY_BY_STEP_KIND['dew-bloom'],
    'effect-dew-garland-frames-v1');
  const sheet = { id: 'skill-sheet', width: 800, height: 800 };
  const requested = [];
  const main = contextFor();
  assert.equal(drawSkillEffectFrames(main, 120, 300, 160, {
    assetStore: readyStore(sheet, requested),
    stepKind: 'bubble-burst',
    age: 0.31,
    duration: 0.4,
    spin: 0.25,
  }), true);
  assert.deepEqual(requested, ['effect-bubble-tide-domain-frames-v1']);
  const frameDraw = main.calls.find(([method, image]) => method === 'drawImage' && image === sheet);
  assert.deepEqual(frameDraw.slice(2, 6), [400, 400, 400, 400],
    'late skill age selects the fourth 2×2 authored frame');
  assert.ok(main.calls.some(([method, angle]) => method === 'rotate' && angle !== 0),
    'the same sheet has deterministic time-based rotation');
  assert.ok(main.calls.some(([method, xScale]) => method === 'scale' && xScale > 1),
    'the effect expands during its lifetime rather than only fading');
});
