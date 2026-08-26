import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MANIFEST = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));

const offscreenState = {
  clearCount: 0,
  failLayerId: null,
  layerDraws: [],
};

function createOffscreenContext() {
  const stack = [];
  return {
    globalAlpha: 1,
    save() {
      stack.push({ globalAlpha: this.globalAlpha });
    },
    restore() {
      const state = stack.pop();
      if (!state) throw new Error('restore without save');
      this.globalAlpha = state.globalAlpha;
    },
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    clearRect() {
      offscreenState.clearCount += 1;
    },
    drawImage(image) {
      offscreenState.layerDraws.push(image.id);
      if (image.id === offscreenState.failLayerId) {
        throw new Error(`rejected layer ${image.id}`);
      }
    },
  };
}

class FakeOffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.kind = 'rig-surface';
    this.context = createOffscreenContext();
  }

  getContext() {
    return this.context;
  }
}

globalThis.OffscreenCanvas = FakeOffscreenCanvas;

const { drawMonster, drawSlime } = await import('../src/draw.js');
const { SlimeGame } = await import('../src/game.js');

function resetOffscreen() {
  offscreenState.clearCount = 0;
  offscreenState.failLayerId = null;
  offscreenState.layerDraws.length = 0;
}

function readyBundle(ownerId, { missing = null, canonicalFacing = 1, rigId = null } = {}) {
  const definition = MANIFEST.rigs[ownerId];
  return {
    id: ownerId,
    ownerId,
    rigId: rigId ?? definition.rigId,
    rootBone: definition.rootBone,
    faceBone: definition.faceBone,
    canonicalFacing,
    parts: definition.parts.map((part) => ({
      ...part,
      image: part.id === missing ? null : { id: `${ownerId}:${part.id}` },
    })),
  };
}

function createMainContext() {
  const stack = [];
  const ctx = {
    canvas: {},
    calls: [],
    compositeAttempts: 0,
    compositeDraws: 0,
    failComposite: false,
    filter: 'none',
    globalAlpha: 1,
    gradientCount: 0,
    save() {
      this.calls.push(['save']);
      stack.push({ globalAlpha: this.globalAlpha });
    },
    restore() {
      this.calls.push(['restore']);
      const state = stack.pop();
      if (!state) throw new Error('restore without save');
      this.globalAlpha = state.globalAlpha;
    },
    translate(x, y) {
      this.calls.push(['translate', x, y]);
    },
    rotate(value) {
      this.calls.push(['rotate', value]);
    },
    scale(x, y) {
      this.calls.push(['scale', x, y]);
    },
    drawImage(image, ...rect) {
      this.compositeAttempts += 1;
      this.calls.push(['drawImage', image.kind, ...rect]);
      if (this.failComposite) throw new Error('rejected composite');
      this.compositeDraws += 1;
    },
    createLinearGradient() {
      this.gradientCount += 1;
      return { addColorStop() {} };
    },
    createRadialGradient() {
      this.gradientCount += 1;
      return { addColorStop() {} };
    },
    measureText: (text) => ({ width: String(text).length * 16 }),
  };

  for (const method of [
    'arc',
    'beginPath',
    'bezierCurveTo',
    'clearRect',
    'closePath',
    'ellipse',
    'fill',
    'fillRect',
    'fillText',
    'lineTo',
    'moveTo',
    'quadraticCurveTo',
    'setLineDash',
    'setTransform',
    'stroke',
    'strokeRect',
    'strokeText',
  ]) ctx[method] = () => {};

  return ctx;
}

test('slime composites one complete card bundle after the outer size and facing transform', () => {
  resetOffscreen();
  const ctx = createMainContext();
  const ownerId = 'survivor-shell-shell';

  drawSlime(ctx, 30, 70, 50, 'shell', {
    animate: false,
    facing: -1,
    pose: { root: { x: 2 } },
    rigAsset: readyBundle(ownerId),
  });

  assert.deepEqual(
    offscreenState.layerDraws,
    MANIFEST.rigs[ownerId].parts.map(({ id }) => `${ownerId}:${id}`),
  );
  assert.deepEqual(ctx.calls.find(([name]) => name === 'scale'), ['scale', -0.5, 0.5]);
  assert.deepEqual(
    ctx.calls.find(([name]) => name === 'drawImage'),
    ['drawImage', 'rig-surface', -128, -192, 256, 256],
  );
  assert.equal(ctx.compositeDraws, 1);
  assert.equal(ctx.globalAlpha, 1);
});

test('draw pipeline forwards expression selection to an independent facial layer', () => {
  resetOffscreen();
  const ctx = createMainContext();
  const ownerId = 'survivor-shell-shell';
  const bundle = readyBundle(ownerId);
  const eyes = bundle.parts.find(({ id }) => id === 'eyes');
  eyes.variants = {
    blink: {
      name: 'blink',
      path: `assets/generated-v2/rig/${ownerId}/expressions-v2.png`,
      sourceRect: { x: 0, y: 0, width: 72, height: 24 },
      bindRect: eyes.bindRect,
      image: { id: `${ownerId}:eyes:blink` },
    },
  };

  drawSlime(ctx, 30, 70, 50, 'shell', {
    animate: false,
    rigAsset: bundle,
    expression: 'blink',
  });

  assert.deepEqual(offscreenState.layerDraws, [
    `${ownerId}:shellBack`,
    `${ownerId}:body`,
    `${ownerId}:shellFront`,
    `${ownerId}:eyes:blink`,
    `${ownerId}:mouth`,
  ]);
  assert.equal(ctx.compositeDraws, 1);
});

test('boss keeps its 1.08 visual scale and mirrors only at the outer transform', () => {
  resetOffscreen();
  const ctx = createMainContext();
  const ownerId = 'enemy-acid-shell-king';

  drawMonster(ctx, 100, 120, 100, 'boss', {
    animate: false,
    facing: -1,
    rigAsset: readyBundle(ownerId),
  });

  assert.deepEqual(ctx.calls.find(([name]) => name === 'scale'), ['scale', -1.08, 1.08]);
  assert.deepEqual(
    offscreenState.layerDraws,
    MANIFEST.rigs[ownerId].parts.map(({ id }) => `${ownerId}:${id}`),
  );
  assert.equal(ctx.compositeDraws, 1);
});

test('incompatible or incomplete bundles draw zero PNG pixels and use the whole vector fallback', () => {
  resetOffscreen();
  const incompatibleCtx = createMainContext();
  drawSlime(incompatibleCtx, 0, 0, 100, 'shell', {
    animate: false,
    rigAsset: readyBundle('survivor-shell-shell', { canonicalFacing: -1 }),
  });
  assert.equal(incompatibleCtx.compositeAttempts, 0);
  assert.equal(offscreenState.layerDraws.length, 0);
  assert.ok(incompatibleCtx.gradientCount > 0);

  resetOffscreen();
  const incompleteCtx = createMainContext();
  drawSlime(incompleteCtx, 0, 0, 100, 'shell', {
    animate: false,
    rigAsset: readyBundle('survivor-shell-shell', { missing: 'mouth' }),
  });
  assert.equal(incompleteCtx.compositeAttempts, 0);
  assert.equal(offscreenState.layerDraws.length, 0, 'required parts are checked before any layer draw');
  assert.ok(incompleteCtx.gradientCount > 0);
});

test('a late layer drawImage failure cannot leave a partial PNG character on the main canvas', () => {
  resetOffscreen();
  const ownerId = 'survivor-shell-shell';
  offscreenState.failLayerId = `${ownerId}:mouth`;
  const ctx = createMainContext();

  drawSlime(ctx, 0, 0, 100, 'shell', {
    animate: false,
    rigAsset: readyBundle(ownerId),
  });

  assert.deepEqual(offscreenState.layerDraws, [
    `${ownerId}:shellBack`,
    `${ownerId}:body`,
    `${ownerId}:shellFront`,
    `${ownerId}:eyes`,
    `${ownerId}:mouth`,
  ]);
  assert.equal(ctx.compositeAttempts, 0, 'the failed offscreen character is never composited');
  assert.ok(ctx.gradientCount > 0, 'the complete vector character is drawn instead');
  assert.ok(offscreenState.clearCount >= 2, 'the failed offscreen buffer is discarded');
});

test('the welcome screen resolves all four survivor bundles by card id', () => {
  resetOffscreen();
  globalThis.localStorage = {
    getItem: () => null,
    setItem() {},
    removeItem() {},
  };
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener() {},
    AudioContext: null,
    webkitAudioContext: null,
  };

  const requested = [];
  const bundles = new Map([
    'survivor-shell-shell',
    'survivor-crystal-pin',
    'survivor-bubble-float',
    'survivor-moss-sprout',
  ].map((ownerId) => [ownerId, readyBundle(ownerId)]));
  const store = {
    get(ownerId, fallback = null) {
      requested.push(ownerId);
      return bundles.get(ownerId) ?? fallback;
    },
  };
  const ctx = createMainContext();
  const canvas = {
    width: 1280,
    height: 720,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    addEventListener() {},
  };
  const game = new SlimeGame(canvas, { rigAssetStore: store });
  game.modal = { type: 'welcome', page: 0 };

  game.drawWelcome(ctx);

  assert.deepEqual(requested, [...bundles.keys()]);
  assert.equal(ctx.compositeDraws, 4);
});
