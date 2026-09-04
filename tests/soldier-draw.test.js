import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

import {
  BUBBLE_RIG,
  CRYSTAL_RIG,
  HERO_ATLAS_RIG,
  SHELL_RIG,
  SOLDIER_RIG,
  SPROUT_RIG,
} from '../src/animation/rigs.js';
import { HERO_ATLAS_CLIPS, SOLDIER_CLIPS } from '../src/animation/clips.js';
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

function readyAssetMapStore(assets, requested) {
  return {
    useOrFallback(key, render, fallback) {
      requested.push(key);
      const asset = assets[key];
      if (!asset) {
        fallback('missing');
        return false;
      }
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

function alignedAlphaOverlap(atlas, leftSlot, rightSlot, threshold = 16) {
  const cell = 418;
  const leftOriginX = (leftSlot % 3) * cell;
  const leftOriginY = Math.floor(leftSlot / 3) * cell;
  const rightOriginX = (rightSlot % 3) * cell;
  const rightOriginY = Math.floor(rightSlot / 3) * cell;
  let overlap = 0;
  for (let y = 0; y < cell; y += 1) {
    for (let x = 0; x < cell; x += 1) {
      const leftAlpha = atlas.pixels[
        ((leftOriginY + y) * atlas.width + leftOriginX + x) * 4 + 3
      ];
      const rightAlpha = atlas.pixels[
        ((rightOriginY + y) * atlas.width + rightOriginX + x) * 4 + 3
      ];
      if (leftAlpha >= threshold && rightAlpha >= threshold) overlap += 1;
    }
  }
  return overlap;
}

function highAlphaImageBounds(image, threshold = 32) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.pixels[(y * image.width + x) * 4 + 3] < threshold) continue;
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

test('all layered heroes keep attack equipment in front without breaking shell or ring depth', () => {
  assert.ok(SHELL_RIG.bones.shellBack.layer < SHELL_RIG.bones.body.layer);
  assert.ok(SHELL_RIG.bones.shellFront.layer > SHELL_RIG.bones.body.layer);
  assert.ok(SHELL_RIG.bones.shellFront.layer < SHELL_RIG.bones.eyes.layer,
    'the shell front stays above the body but below the face');
  assert.ok(CRYSTAL_RIG.bones.front.layer > CRYSTAL_RIG.bones.body.layer,
    'the forward attack crystal stays above the body');
  assert.ok(SPROUT_RIG.bones.pack.layer > SPROUT_RIG.bones.body.layer,
    'Sprout attack equipment stays above the body');
  assert.ok(BUBBLE_RIG.bones.ring.layer > BUBBLE_RIG.bones.eyes.layer,
    'the one outer bubble ring keeps its authored position outside the face');
});

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
      const approvedBounds = highAlphaImageBounds(approvedEyes);
      assert.equal(normalEyes.maxX - normalEyes.minX,
        approvedBounds.maxX - approvedBounds.minX,
        `${atlasUrl.pathname} keeps the approved eye width`);
      assert.equal(normalEyes.maxY - normalEyes.minY,
        approvedBounds.maxY - approvedBounds.minY,
        `${atlasUrl.pathname} keeps the approved eye height`);
      let matchesApprovedAlpha = true;
      compareAlpha: for (let y = 0; y <= normalEyes.maxY - normalEyes.minY; y += 1) {
        for (let x = 0; x <= normalEyes.maxX - normalEyes.minX; x += 1) {
          const sourceX = approvedBounds.minX + x;
          const sourceY = approvedBounds.minY + y;
          const expected = approvedEyes.pixels[
            (sourceY * approvedEyes.width + sourceX) * 4 + 3
          ];
          const actual = atlas.pixels[
            ((originY + normalEyes.minY + y) * atlas.width
              + originX + normalEyes.minX + x) * 4 + 3
          ];
          if ((actual >= 32) !== (expected >= 32)) {
            matchesApprovedAlpha = false;
            break compareAlpha;
          }
        }
      }
      assert.equal(matchesApprovedAlpha, true,
        `${atlasUrl.pathname} normal eyes retain the approved old-style silhouette`);
      const normalCenter = boundsCenter(normalEyes);
      for (const slot of [5, 7]) {
        const center = boundsCenter(highAlphaBounds(atlas, slot));
        assert.ok(Math.abs(center.x - normalCenter.x) <= 1,
          `${atlasUrl.pathname} expression ${slot} keeps its horizontal eye anchor`);
        assert.ok(Math.abs(center.y - normalCenter.y) <= 18,
          `${atlasUrl.pathname} expression ${slot} keeps its vertical eye anchor`);
      }
    } else {
      const normalCenter = boundsCenter(normalEyes);
      for (const slot of [5, 7]) {
        const center = boundsCenter(highAlphaBounds(atlas, slot));
        assert.ok(Math.abs(center.x - normalCenter.x) <= 2,
          `${atlasUrl.pathname} expression ${slot} keeps its horizontal eye anchor`);
        assert.ok(Math.abs(center.y - normalCenter.y) <= 18,
          `${atlasUrl.pathname} expression ${slot} keeps its intentional vertical pose`);
      }
    }
    const normalMouthCenter = boundsCenter(highAlphaBounds(atlas, 4));
    for (const slot of [6, 8]) {
      const center = boundsCenter(highAlphaBounds(atlas, slot));
      assert.ok(Math.abs(center.x - normalMouthCenter.x) <= 2,
        `${atlasUrl.pathname} expression ${slot} keeps its horizontal mouth anchor`);
      assert.ok(Math.abs(center.y - normalMouthCenter.y) <= 12,
        `${atlasUrl.pathname} expression ${slot} keeps its intentional vertical mouth pose`);
    }

    if (usesRestoredEyes) {
      const mouth = highAlphaBounds(atlas, 4);
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
    const body = highAlphaBounds(atlas, 0);
    const bodyWidth = body.maxX - body.minX + 1;
    const bodyHeight = body.maxY - body.minY + 1;
    const bodyCenter = boundsCenter(body);
    const normalMouth = highAlphaBounds(atlas, 4);
    const normalMouthWidth = normalMouth.maxX - normalMouth.minX + 1;
    const normalMouthHeight = normalMouth.maxY - normalMouth.minY + 1;
    assert.ok(normalMouthWidth <= bodyWidth * 0.23,
      `${atlasUrl.pathname} normal mouth stays compact relative to its body`);
    assert.ok(normalMouthHeight <= bodyHeight * 0.14,
      `${atlasUrl.pathname} normal mouth stays short relative to its body`);
    assert.ok(boundsCenter(normalMouth).y - bodyCenter.y >= bodyHeight * 0.08,
      `${atlasUrl.pathname} mouth sits in the lower half of its face`);
    for (const [eyesSlot, mouthSlot] of [[3, 4], [5, 6], [7, 8]]) {
      const mouth = highAlphaBounds(atlas, mouthSlot);
      const offset = boundsCenter(highAlphaBounds(atlas, mouthSlot)).x
        - boundsCenter(highAlphaBounds(atlas, eyesSlot)).x;
      assert.ok(Math.abs(offset) <= 1,
        `${atlasUrl.pathname} expression ${mouthSlot} mouth offset is ${offset.toFixed(2)}px`);
      const mouthWidth = mouth.maxX - mouth.minX + 1;
      const mouthHeight = mouth.maxY - mouth.minY + 1;
      assert.ok(mouthWidth <= bodyWidth * 0.25,
        `${atlasUrl.pathname} expression ${mouthSlot} mouth is not oversized`);
      assert.ok(mouthHeight <= bodyHeight * 0.24,
        `${atlasUrl.pathname} expression ${mouthSlot} mouth is not too tall`);
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

test('hero atlas rig adds only the skill expression and keeps weapon layering independent', () => {
  assert.notEqual(HERO_ATLAS_RIG, SOLDIER_RIG);
  assert.notEqual(HERO_ATLAS_CLIPS, SOLDIER_CLIPS);
  assert.deepEqual(HERO_ATLAS_RIG.expression.slots.eyes.variants,
    ['normal', 'attack', 'skill', 'hurt']);
  assert.deepEqual(HERO_ATLAS_RIG.expression.slots.mouth.variants,
    ['normal', 'attack', 'skill', 'hurt']);
  assert.equal(HERO_ATLAS_CLIPS.skill.expression, 'skill');
  assert.ok(HERO_ATLAS_CLIPS.attack.priority < HERO_ATLAS_CLIPS.skill.priority);
  assert.ok(HERO_ATLAS_CLIPS.skill.priority < HERO_ATLAS_CLIPS.hurt.priority);
  assert.equal(SOLDIER_RIG.expression.states.skill, undefined);
  assert.equal(SOLDIER_CLIPS.skill, undefined);
});

test('atlas character profiles cover every formal creature and keep only authored rear layers', async () => {
  const { ATLAS_CHARACTER_PROFILES } = await import('../src/draw.js');
  const expectedAssetKeys = [
    'hero-berry-burst-atlas-v1',
    'hero-dew-bloom-atlas-v1',
    'hero-bell-boom-atlas-v1',
    'hero-drill-gum-atlas-v1',
    'hero-ember-fizz-atlas-v1',
    'hero-ink-splash-atlas-v1',
    'hero-cloud-spin-atlas-v1',
    'hero-frost-drop-atlas-v1',
    'hero-honey-pop-atlas-v1',
    'hero-spark-bean-atlas-v1',
    'hero-star-core-atlas-v1',
    'soldier-shield-dun-atlas-v1',
    'soldier-bean-bow-atlas-v1',
    'soldier-bounce-hammer-atlas-v1',
    'soldier-leaf-spinner-atlas-v1',
    'soldier-drill-lancer-atlas-v1',
    'soldier-spore-lobber-atlas-v1',
    'soldier-volt-orbiter-atlas-v1',
    'enemy-thorn-roller-atlas-v1',
    'enemy-lantern-spore-atlas-v1',
    'enemy-mud-bulwark-atlas-v1',
    'enemy-rift-beacon-king-atlas-v1',
  ];
  assert.deepEqual(Object.keys(ATLAS_CHARACTER_PROFILES), expectedAssetKeys);
  for (const [assetKey, profile] of Object.entries(ATLAS_CHARACTER_PROFILES)) {
    assert.equal(Object.isFrozen(profile), true, assetKey);
    assert.equal(Object.isFrozen(profile.parts), true, `${assetKey} parts`);
    assert.equal(profile.parts.body, 0, assetKey);
    assert.equal(profile.parts.eyes, 30, assetKey);
    assert.equal(profile.parts.mouth, 31, assetKey);
    assert.equal(Number.isFinite(profile.worldScale), true, `${assetKey} scale`);
    assert.equal(Number.isFinite(profile.worldYOffset), true, `${assetKey} y offset`);
    if (![
      'soldier-leaf-spinner-atlas-v1',
      'soldier-spore-lobber-atlas-v1',
    ].includes(assetKey)) {
      assert.equal(profile.parts.equipment, 40, `${assetKey} equipment stays foreground`);
    }
  }

  assert.equal(ATLAS_CHARACTER_PROFILES['hero-dew-bloom-atlas-v1'].parts.headgear, -5);
  assert.equal(ATLAS_CHARACTER_PROFILES['soldier-leaf-spinner-atlas-v1'].parts.equipment, -5);
  assert.equal(ATLAS_CHARACTER_PROFILES['enemy-thorn-roller-atlas-v1'].parts.headgear, -5);
  for (const assetKey of [
    'hero-drill-gum-atlas-v1',
    'hero-ink-splash-atlas-v1',
    'hero-honey-pop-atlas-v1',
    'soldier-drill-lancer-atlas-v1',
    'enemy-mud-bulwark-atlas-v1',
    'enemy-rift-beacon-king-atlas-v1',
  ]) {
    assert.ok(ATLAS_CHARACTER_PROFILES[assetKey].parts.headgear > 0,
      `${assetKey} identity layer is no longer swallowed by the body`);
  }
  assert.equal(ATLAS_CHARACTER_PROFILES['hero-star-core-atlas-v1'].parts.headgear, -5,
    'the star ring wraps behind the body');
  assert.equal(ATLAS_CHARACTER_PROFILES['soldier-volt-orbiter-atlas-v1'].parts.headgear, -5,
    'the conductive ring wraps behind the body');
  assert.equal(ATLAS_CHARACTER_PROFILES['soldier-spore-lobber-atlas-v1'].parts.equipment, -5,
    'the spore launcher is mounted behind the body');
});

test('formal layout metadata and runtime profiles share one z-order contract', async () => {
  const { ATLAS_CHARACTER_PROFILES } = await import('../src/draw.js');
  const heroBundle = JSON.parse(await readFile(new URL(
    '../assets/config/hero-atlas-layouts.json', import.meta.url,
  ), 'utf8'));
  const creatureDirectory = new URL('../assets/config/creature-atlas/', import.meta.url);
  const creatureFiles = (await readdir(creatureDirectory))
    .filter((name) => name.endsWith('.json'))
    .sort();
  const configuredLayouts = { ...heroBundle.layouts };
  for (const filename of creatureFiles) {
    const layout = JSON.parse(await readFile(new URL(filename, creatureDirectory), 'utf8'));
    configuredLayouts[layout.assetId] = layout;
  }

  assert.deepEqual(
    Object.keys(ATLAS_CHARACTER_PROFILES).sort(),
    Object.keys(configuredLayouts).sort(),
    'every formal atlas has an explicit runtime profile and no stale profile remains',
  );
  for (const [assetKey, layout] of Object.entries(configuredLayouts)) {
    const profile = ATLAS_CHARACTER_PROFILES[assetKey];
    assert.deepEqual(profile.parts, {
      body: layout.physical.body.z ?? 0,
      headgear: layout.physical.headgear.z ?? 10,
      eyes: layout.expressions.z?.eyes ?? 30,
      mouth: layout.expressions.z?.mouth ?? 31,
      equipment: layout.physical.equipment.z ?? 40,
    }, `${assetKey} uses the authored layer order at runtime`);
  }
});

test('hero runtime profiles normalize visible size and body baseline without enlarging the atlas', async () => {
  const { ATLAS_CHARACTER_PROFILES } = await import('../src/draw.js');
  const heroBundle = JSON.parse(await readFile(new URL(
    '../assets/config/hero-atlas-layouts.json', import.meta.url,
  ), 'utf8'));
  for (const [assetKey, layout] of Object.entries(heroBundle.layouts)) {
    const atlasUrl = new URL(`../${layout.assetPath}`, import.meta.url);
    const atlas = decodeRgbaPng(await readFile(atlasUrl), atlasUrl.pathname);
    const physicalBounds = [0, 1, 2].map((slot) => highAlphaBounds(atlas, slot));
    const union = physicalBounds.reduce((bounds, current) => ({
      minX: Math.min(bounds.minX, current.minX),
      minY: Math.min(bounds.minY, current.minY),
      maxX: Math.max(bounds.maxX, current.maxX),
      maxY: Math.max(bounds.maxY, current.maxY),
    }));
    const profile = ATLAS_CHARACTER_PROFILES[assetKey];
    const visibleWidth = (union.maxX - union.minX + 1) / 418 * 120 * profile.worldScale;
    const bodyBottom = -120 + (physicalBounds[0].maxY + 1) / 418 * 120;
    const renderedBodyBottom = bodyBottom * profile.worldScale + profile.worldYOffset;
    assert.ok(visibleWidth >= 105 && visibleWidth <= 112,
      `${assetKey} visible width ${visibleWidth.toFixed(2)} stays in the shared hero range`);
    assert.ok(renderedBodyBottom >= -10 && renderedBodyBottom <= -6,
      `${assetKey} baseline ${renderedBodyBottom.toFixed(2)} stays in the shared hero range`);
  }
});

test('thorn roller drill stays clear of every authored facial expression', async () => {
  const atlasUrl = new URL(
    '../assets/generated/enemy/enemy-thorn-roller-atlas-v1.png', import.meta.url,
  );
  const atlas = decodeRgbaPng(await readFile(atlasUrl), atlasUrl.pathname);
  for (const expressionSlot of [3, 4, 5, 6, 7, 8]) {
    assert.equal(alignedAlphaOverlap(atlas, 2, expressionSlot), 0,
      `foreground drill and expression cell ${expressionSlot} do not cover each other`);
  }
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

test('formal 1254 atlas draws reuse frozen preparation for a settled expression sample', async () => {
  const previousCanvas = globalThis.OffscreenCanvas;
  const nativeSort = Array.prototype.sort;
  let sortCalls = 0;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = contextFor(this);
    }
    getContext() { return this.context; }
  };
  Array.prototype.sort = function observedSort(...args) {
    sortCalls += 1;
    return nativeSort.apply(this, args);
  };
  try {
    const { drawSoldier } = await import(`../src/draw.js?cache=${Date.now()}`);
    const atlas = { id: 'formal-cache-atlas', width: 1254, height: 1254 };
    const expressionSample = {
      from: 'normal',
      to: 'normal',
      mix: 1,
      pending: null,
      slots: {
        eyes: { from: 'normal', to: 'normal', weights: { from: 1, to: 0 } },
        mouth: { from: 'normal', to: 'normal', weights: { from: 1, to: 0 } },
      },
    };
    const options = {
      assetStore: readyStore(atlas, []),
      assetKey: 'soldier-ranged-atlas',
      squadType: 'ranged',
      pose: { root: { y: -1 } },
      expressionSample,
    };

    assert.equal(drawSoldier(contextFor(), 0, 0, 80, options), true);
    const firstDrawSorts = sortCalls;
    assert.ok(firstDrawSorts > 0, 'the first draw prepares and sorts the five atlas layers');
    options.pose = { root: { y: 3 } };
    assert.equal(drawSoldier(contextFor(), 0, 0, 80, options), true);
    assert.equal(sortCalls, firstDrawSorts,
      'the next pose reuses formal-atlas structure without sorting the layers again');
  } finally {
    Array.prototype.sort = nativeSort;
    if (previousCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousCanvas;
  }
});

test('atlas profile scale and baseline apply through the shared battle and preview renderer', async () => {
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
    const drawModule = await import(`../src/draw.js?profileTransform=${Date.now()}`);
    assert.equal(drawModule.drawSoldier, drawModule.drawAtlasCharacter,
      'battle squads and UI previews use the same profile-aware entry point');
    const atlas = { id: 'spore-lobber', width: 1254, height: 1254 };
    const main = contextFor({ id: 'main' });
    assert.equal(drawModule.drawSoldier(main, 25, 90, 50, {
      assetStore: readyStore(atlas, []),
      assetKey: 'soldier-spore-lobber-atlas-v1',
      state: 'idle',
    }), true);
    assert.ok(main.calls.some(([method, x, y]) => (
      method === 'translate' && x === 25 && y === 90
    )), 'the registered atlas baseline is not shifted upward a second time');
    assert.ok(main.calls.some(([method, xScale, yScale]) => (
      method === 'scale' && xScale === 0.52 && yScale === 0.52
    )), 'the per-character 1.04 scale multiplies the requested size');
  } finally {
    if (previous === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previous;
  }
});

test('atlas profile z order is per asset key even when an image object is reused', async () => {
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
    const { drawSoldier } = await import(`../src/draw.js?profileZ=${Date.now()}`);
    const atlas = { id: 'shared-test-atlas', width: 1254, height: 1254 };
    const sourceCells = () => surfaces.flatMap(({ calls }) => calls)
      .filter(([method, image]) => method === 'drawImage' && image === atlas)
      .map(([, , sourceX, sourceY]) => [sourceX, sourceY]);

    assert.equal(drawSoldier(contextFor(), 0, 0, 80, {
      assetStore: readyStore(atlas, []),
      assetKey: 'soldier-leaf-spinner-atlas-v1',
    }), true);
    assert.deepEqual(sourceCells(), [
      [836, 0], [0, 0], [418, 0], [0, 418], [418, 418],
    ], 'the authored rear leaf wheel draws before the body');

    surfaces.forEach(({ calls }) => { calls.length = 0; });
    assert.equal(drawSoldier(contextFor(), 0, 0, 80, {
      assetStore: readyStore(atlas, []),
      assetKey: 'soldier-drill-lancer-atlas-v1',
    }), true);
    assert.deepEqual(sourceCells(), [
      [0, 0], [418, 0], [0, 418], [418, 418], [836, 0],
    ], 'front identity and equipment order does not inherit the prior asset profile');
  } finally {
    if (previous === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previous;
  }
});

test('invalid or missing formal atlas draws nothing while the loading layer owns the frame', async () => {
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
    assert.deepEqual(main.calls, [], 'missing production art never creates a temporary soldier');
  }
});

test('formal hero and new squad atlases share the generic rig without falling back to 壳壳', async () => {
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
    const berryLayers = surfaces.flatMap(({ calls }) => calls)
      .filter(([method, image]) => method === 'drawImage' && image === atlas);
    assert.deepEqual(berryLayers.map(([, , sx, sy]) => [sx, sy]), [
      [0, 0], [418, 0], [836, 418], [0, 836], [836, 0],
    ], 'Berry draws its attack equipment as the final foreground layer');

    surfaces.forEach(({ calls }) => { calls.length = 0; });
    const dewAtlas = { id: 'dew-atlas', width: 1254, height: 1254 };
    assert.equal(drawAtlasCharacter(contextFor(), 32, 96, 74, {
      assetStore: readyStore(dewAtlas, requested),
      assetKey: 'hero-dew-bloom-atlas-v1',
      state: 'attack',
      attackPulse: 0.7,
    }), true);
    const dewLayers = surfaces.flatMap(({ calls }) => calls)
      .filter(([method, image]) => method === 'drawImage' && image === dewAtlas);
    assert.deepEqual(dewLayers.map(([, , sx, sy]) => [sx, sy]), [
      [418, 0], [0, 0], [836, 418], [0, 836], [836, 0],
    ], 'Dew keeps its authored rear flower crown behind body and expression');

    const absentCalls = contextFor().calls;
    const absentContext = contextFor();
    assert.equal(drawAtlasCharacter(absentContext, 32, 96, 74, {
      assetKey: 'hero-dew-bloom-atlas-v1',
    }), false);
    assert.equal(absentContext.calls.length, absentCalls.length,
      'a missing formal atlas stays empty instead of borrowing or inventing a hero');

    surfaces.forEach(({ calls }) => { calls.length = 0; });
    const drillAtlas = { id: 'drill-atlas', width: 1254, height: 1254 };
    assert.equal(drawAtlasCharacter(contextFor(), 32, 96, 74, {
      assetStore: readyStore(drillAtlas, requested),
      assetKey: 'hero-drill-gum-atlas-v1',
      state: 'attack',
      attackPulse: 0.7,
    }), true);
    const drillLayers = surfaces.flatMap(({ calls }) => calls)
      .filter(([method, image]) => method === 'drawImage' && image === drillAtlas);
    assert.deepEqual(drillLayers.map(([, , sx, sy]) => [sx, sy]), [
      [0, 0], [418, 0], [836, 418], [0, 836], [836, 0],
    ], 'Drill identity and weapon both remain visible in front of the body');
  } finally {
    if (previous === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previous;
  }
});

test('all eleven atlas heroes atomically draw skill faces from their sidecars before equipment', async () => {
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
    const { drawAtlasCharacter } = await import(`../src/draw.js?skillFace=${Date.now()}`);
    const heroSlugs = [
      'berry-burst', 'dew-bloom', 'bell-boom', 'drill-gum', 'ember-fizz',
      'ink-splash', 'cloud-spin', 'frost-drop', 'honey-pop', 'spark-bean',
      'star-core',
    ];
    for (const slug of heroSlugs) {
      surfaces.forEach(({ calls }) => { calls.length = 0; });
      const mainAssetKey = `hero-${slug}-atlas-v1`;
      const skillFaceAssetKey = `hero-${slug}-skill-face-v1`;
      const mainAtlas = { id: `${slug}-main`, width: 1254, height: 1254 };
      const skillFace = { id: `${slug}-skill-face`, width: 836, height: 418 };
      const requested = [];
      const store = readyAssetMapStore({
        [mainAssetKey]: mainAtlas,
        [skillFaceAssetKey]: skillFace,
      }, requested);
      const main = contextFor();
      assert.equal(drawAtlasCharacter(main, 32, 96, 74, {
        assetStore: store,
        assetKey: mainAssetKey,
        skillFaceAssetKey,
        state: 'skill',
      }), true, slug);
      assert.deepEqual(requested, [mainAssetKey, skillFaceAssetKey], slug);

      const layerCalls = surfaces.flatMap(({ calls }) => calls)
        .filter(([method]) => method === 'drawImage');
      const skillLayers = layerCalls.filter(([, image]) => image === skillFace);
      assert.deepEqual(skillLayers.map(([, , sx, sy, sw, sh]) => [sx, sy, sw, sh]), [
        [0, 0, 418, 418],
        [418, 0, 418, 418],
      ], `${slug} skill eyes and mouth come from its two sidecar cells`);
      const authoredLayers = layerCalls.filter(([, image]) => (
        image === mainAtlas || image === skillFace
      ));
      assert.equal(authoredLayers.at(-1)[1], mainAtlas, `${slug} equipment image`);
      assert.deepEqual(authoredLayers.at(-1).slice(2, 6), [836, 0, 418, 418],
        `${slug} main-atlas equipment remains the final foreground layer`);
      assert.equal(main.calls.filter(([method]) => method === 'drawImage').length, 1,
        `${slug} reaches the main canvas only as one complete atomic composite`);
    }
  } finally {
    if (previous === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previous;
  }
});

test('atlas heroes never disguise a missing or malformed skill sidecar as an attack face', async () => {
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
    const { drawAtlasCharacter } = await import(`../src/draw.js?strictSkillFace=${Date.now()}`);
    const mainAssetKey = 'hero-berry-burst-atlas-v1';
    const skillFaceAssetKey = 'hero-berry-burst-skill-face-v1';
    const mainAtlas = { id: 'berry-main', width: 1254, height: 1254 };
    for (const [label, skillFace] of [
      ['missing', null],
      ['wrong-size', { id: 'bad-skill-face', width: 835, height: 418 }],
    ]) {
      const requested = [];
      const assets = { [mainAssetKey]: mainAtlas };
      if (skillFace) assets[skillFaceAssetKey] = skillFace;
      const main = contextFor();
      assert.equal(drawAtlasCharacter(main, 32, 96, 74, {
        assetStore: readyAssetMapStore(assets, requested),
        assetKey: mainAssetKey,
        skillFaceAssetKey,
        state: 'skill',
      }), false, label);
      assert.deepEqual(requested, [mainAssetKey, skillFaceAssetKey], label);
      assert.equal(main.calls.some(([method]) => method === 'drawImage'), false,
        `${label} skill art must not reach the main canvas`);
    }
    assert.equal(surfaces.length, 0,
      'invalid hero skill input never creates a partial offscreen composite');
  } finally {
    if (previous === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previous;
  }
});

test('layered turret keeps the left base fixed while only the right head aims and recoils', async () => {
  const { drawLayeredTurret } = await import('../src/draw.js');
  const atlas = { id: 'gale-atlas', width: 1536, height: 768 };
  const requested = [];
  const first = contextFor();
  assert.equal(drawLayeredTurret(first, 180, 420, 96, {
    assetStore: readyStore(atlas, requested),
    assetKey: 'turret-gale-fan-atlas-v1',
    aimAngle: -Math.PI / 2,
    attackPulse: 1,
  }), true);
  const second = contextFor();
  assert.equal(drawLayeredTurret(second, 180, 420, 96, {
    assetStore: readyStore(atlas, requested),
    assetKey: 'turret-gale-fan-atlas-v1',
    aimAngle: -0.25,
    attackPulse: 0,
  }), true);
  assert.deepEqual(requested, [
    'turret-gale-fan-atlas-v1', 'turret-gale-fan-atlas-v1',
  ]);
  const firstLayers = first.calls.filter(([method]) => method === 'drawImage');
  const secondLayers = second.calls.filter(([method]) => method === 'drawImage');
  assert.equal(firstLayers.length, 2);
  assert.equal(secondLayers.length, 2);
  assert.deepEqual(firstLayers[0], secondLayers[0],
    'the base crop and destination are identical at every aim angle');
  assert.equal(firstLayers[0][2], 0);
  assert.equal(firstLayers[1][2], 768);
  assert.ok(first.calls.some(([method, angle]) => method === 'rotate' && angle === -Math.PI / 2));
  assert.ok(second.calls.some(([method, angle]) => method === 'rotate' && angle === -0.25));
  assert.equal(drawLayeredTurret(contextFor(), 0, 0, 96, {
    assetKey: 'turret-gale-fan-atlas-v1',
  }), false, 'a missing layered turret never falls back to another building');
});

test('draw module no longer exposes the retired skill frame-atlas renderer', async () => {
  const drawModule = await import('../src/draw.js');
  assert.equal('drawSkillEffectFrames' in drawModule, false);
  assert.equal('SKILL_EFFECT_ASSET_KEY_BY_STEP_KIND' in drawModule, false);
});
