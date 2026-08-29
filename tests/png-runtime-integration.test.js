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
const { TowerDefenseGame } = await import('../src/tower-defense-game.js');
const {
  CHARACTER_RENDER_PROFILES,
  characterWorldScale,
} = await import('../src/character-render-profiles.js');

function resetOffscreen() {
  offscreenState.clearCount = 0;
  offscreenState.failLayerId = null;
  offscreenState.layerDraws.length = 0;
}

function readyBundle(ownerId, { missing = null, canonicalFacing = null, rigId = null } = {}) {
  const definition = MANIFEST.rigs[ownerId];
  return {
    id: ownerId,
    ownerId,
    rigId: rigId ?? definition.rigId,
    rootBone: definition.rootBone,
    faceBone: definition.faceBone,
    canonicalFacing: canonicalFacing ?? definition.canonicalFacing,
    parts: definition.parts.map((part) => ({
      ...part,
      image: part.id === missing ? null : { id: `${ownerId}:${part.id}` },
      variants: Object.fromEntries(Object.entries(part.variants || {}).map(
        ([variantName, variant]) => [variantName, {
          ...variant,
          bindRect: variant.bindRect ?? part.bindRect,
          image: { id: `${ownerId}:${part.id}:${variantName}` },
        }],
      )),
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
    'clip',
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

const CHARACTER_DIRECTION_CASES = [
  ['survivor-shell-shell', (ctx, options) => drawSlime(ctx, 0, 0, 100, 'shell', options)],
  ['survivor-crystal-pin', (ctx, options) => drawSlime(ctx, 0, 0, 100, 'needle', options)],
  ['survivor-bubble-float', (ctx, options) => drawSlime(ctx, 0, 0, 100, 'bubble', options)],
  ['survivor-moss-sprout', (ctx, options) => drawSlime(ctx, 0, 0, 100, 'sprout', options)],
  ['enemy-soft-biter', (ctx, options) => drawMonster(ctx, 0, 0, 100, 'bug', options)],
  ['enemy-windcap', (ctx, options) => drawMonster(ctx, 0, 0, 100, 'mushroom', options)],
  ['enemy-stone-lump', (ctx, options) => drawMonster(ctx, 0, 0, 100, 'stone', options)],
  ['enemy-acid-shell-king', (ctx, options) => drawMonster(ctx, 0, 0, 100, 'boss', options)],
];

test('all eight layered rigs and standalones obey the requested-by-source facing matrix', async (t) => {
  for (const [ownerId, renderCharacter] of CHARACTER_DIRECTION_CASES) {
    await t.test(ownerId, () => {
      const profile = CHARACTER_RENDER_PROFILES[ownerId];
      const canonicalFacing = MANIFEST.rigs[ownerId].canonicalFacing;
      const requestedCases = [-1, 1, undefined];

      for (const suppliedFacing of requestedCases) {
        const requestedFacing = suppliedFacing ?? profile.gameplayFacing;
        const caseLabel = suppliedFacing == null ? 'default' : `${suppliedFacing}`;

        resetOffscreen();
        const rigContext = createMainContext();
        renderCharacter(rigContext, {
          animate: false,
          facing: suppliedFacing,
          rigAsset: readyBundle(ownerId),
        });
        const rigScales = rigContext.calls.filter(([name]) => name === 'scale');
        assert.equal(rigScales.length, 1, `${ownerId} ${caseLabel}: rig pixels transform once`);
        const expectedRigX = characterWorldScale(ownerId)
          * requestedFacing * canonicalFacing;
        assert.ok(
          Math.abs(rigScales[0][1] - expectedRigX) < 1e-10,
          `${ownerId} ${caseLabel}: rig multiplier is requested * canonical`,
        );
        assert.equal(
          Math.sign(rigScales[0][1]) * canonicalFacing,
          requestedFacing,
          `${ownerId} ${caseLabel}: rig finishes in the requested gameplay direction`,
        );
        assert.equal(rigContext.compositeDraws, 1);

        const standalone = {
          kind: `${ownerId}:standalone`,
          naturalWidth: profile.portraitCanvas.width,
          naturalHeight: profile.portraitCanvas.height,
        };
        const standaloneStore = {
          useOrFallback(key, renderAsset) {
            assert.equal(key, ownerId);
            renderAsset(standalone);
            return true;
          },
        };
        const standaloneContext = createMainContext();
        renderCharacter(standaloneContext, {
          animate: false,
          facing: suppliedFacing,
          rigAsset: null,
          assetStore: standaloneStore,
        });
        const standaloneScales = standaloneContext.calls
          .filter(([name]) => name === 'scale');
        assert.deepEqual(
          standaloneScales,
          [['scale', requestedFacing * profile.gameplayFacing, 1]],
          `${ownerId} ${caseLabel}: standalone pixels transform once from exported facing`,
        );
        assert.equal(
          Math.sign(standaloneScales[0][1]) * profile.gameplayFacing,
          requestedFacing,
          `${ownerId} ${caseLabel}: standalone finishes in the requested gameplay direction`,
        );
        assert.equal(standaloneContext.compositeDraws, 1);

        if (suppliedFacing == null) {
          assert.equal(standaloneScales[0][1], 1,
            `${ownerId}: world default matches the unmirrored card/list standalone`);
        }
      }
    });
  }
});

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
  const scale = 0.5 * characterWorldScale(ownerId);
  assert.deepEqual(ctx.calls.find(([name]) => name === 'scale'), ['scale', -scale, scale]);
  assert.deepEqual(
    ctx.calls.find(([name]) => name === 'drawImage'),
    ['drawImage', 'rig-surface', -128, -192, 256, 256],
  );
  assert.equal(ctx.compositeDraws, 1);
  assert.equal(ctx.globalAlpha, 1);
});

test('Sprout authored facing left mirrors exactly once to face right in gameplay', () => {
  resetOffscreen();
  const ctx = createMainContext();
  const ownerId = 'survivor-moss-sprout';

  drawSlime(ctx, 30, 70, 100, 'sprout', {
    animate: false,
    rigAsset: readyBundle(ownerId),
  });

  const scale = characterWorldScale(ownerId);
  assert.equal(MANIFEST.rigs[ownerId].canonicalFacing, -1);
  assert.deepEqual(ctx.calls.find(([name]) => name === 'scale'), ['scale', -scale, scale]);
  assert.deepEqual(
    offscreenState.layerDraws,
    MANIFEST.rigs[ownerId].parts.map(({ id }) => `${ownerId}:${id}`),
  );
  assert.equal(ctx.compositeDraws, 1);
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
      path: `assets/generated-v2/rig/${ownerId}/expressions-v3.png`,
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

test('boss canonical-right rig mirrors once to face left and fits its nominal world box', () => {
  resetOffscreen();
  const ctx = createMainContext();
  const ownerId = 'enemy-acid-shell-king';

  drawMonster(ctx, 100, 120, 100, 'boss', {
    animate: false,
    facing: -1,
    rigAsset: readyBundle(ownerId),
  });

  const scale = characterWorldScale(ownerId);
  assert.deepEqual(ctx.calls.find(([name]) => name === 'scale'), ['scale', -scale, scale]);
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
    rigAsset: readyBundle('survivor-shell-shell', { canonicalFacing: 0 }),
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

test('a missing rig prefers the generated standalone instead of exposing the old vector character', () => {
  resetOffscreen();
  const ownerId = 'survivor-shell-shell';
  const standalone = {
    kind: 'generated-standalone',
    naturalWidth: 512,
    naturalHeight: 512,
  };
  const assetStore = {
    useOrFallback(key, renderAsset) {
      assert.equal(key, ownerId);
      renderAsset(standalone);
      return true;
    },
  };
  const ctx = createMainContext();

  drawSlime(ctx, 30, 70, 100, 'shell', {
    animate: false,
    assetStore,
    rigAsset: null,
  });

  const draw = ctx.calls.find((call) => call[0] === 'drawImage' && call[1] === standalone.kind);
  assert.ok(draw, 'the already generated standalone should cover a delayed or failed rig');
  assert.equal(draw[7] + draw[9], 0, 'the cropped standalone should remain grounded at the actor anchor');
  assert.deepEqual(ctx.calls.filter(([name]) => name === 'scale').at(-1), ['scale', 1, 1]);
  assert.equal(ctx.gradientCount, 0, 'the legacy vector body must not be drawn behind the standalone');

  const explicitVectorCtx = createMainContext();
  drawSlime(explicitVectorCtx, 0, 0, 100, 'shell', {
    animate: false,
    assetStore,
    rigAsset: null,
    allowGeneratedStandalone: false,
  });
  assert.equal(
    explicitVectorCtx.calls.some((call) => call[0] === 'drawImage' && call[1] === standalone.kind),
    false,
    'the localhost vector diagnostic must still bypass generated character images',
  );
  assert.ok(explicitVectorCtx.gradientCount > 0);
});

test('standalone fallback keeps exported enemy facing and rejects invalid image dimensions atomically', () => {
  resetOffscreen();
  const enemyId = 'enemy-soft-biter';
  const enemyCtx = createMainContext();
  const enemyStore = {
    useOrFallback(key, renderAsset) {
      assert.equal(key, enemyId);
      renderAsset({ kind: 'generated-enemy', naturalWidth: 512, naturalHeight: 512 });
      return true;
    },
  };
  drawMonster(enemyCtx, 0, 0, 100, 'bug', {
    animate: false,
    assetStore: enemyStore,
    rigAsset: null,
  });
  assert.deepEqual(
    enemyCtx.calls.filter(([name]) => name === 'scale').at(-1),
    ['scale', 1, 1],
    'the already gameplay-left export must not be mirrored a second time',
  );

  const invalidCtx = createMainContext();
  const invalidStore = {
    useOrFallback(key, renderAsset, renderFallback) {
      try {
        renderAsset({ kind: 'invalid-standalone', naturalWidth: 0, naturalHeight: 0 });
        return true;
      } catch (error) {
        renderFallback?.({ status: 'loaded' }, error);
        return false;
      }
    },
  };
  drawSlime(invalidCtx, 0, 0, 100, 'shell', {
    animate: false,
    assetStore: invalidStore,
    rigAsset: null,
  });
  assert.equal(
    invalidCtx.calls.some((call) => call[0] === 'drawImage' && call[1] === 'invalid-standalone'),
    false,
  );
  assert.ok(invalidCtx.gradientCount > 0, 'an invalid standalone must fall back to one complete vector body');
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

test('production strict mode rejects a failed layered rig instead of exposing standalone art', () => {
  resetOffscreen();
  const ownerId = 'survivor-shell-shell';
  offscreenState.failLayerId = `${ownerId}:body`;
  const ctx = createMainContext();
  let standaloneRequests = 0;

  assert.throws(() => drawSlime(ctx, 0, 0, 100, 'shell', {
    animate: false,
    rigAsset: readyBundle(ownerId),
    requireLayeredRig: true,
    assetStore: {
      useOrFallback(_key, renderAsset) {
        standaloneRequests += 1;
        renderAsset({ width: 512, height: 512 });
        return true;
      },
    },
  }), /Required layered rig could not render/);

  assert.equal(ctx.compositeDraws, 0);
  assert.equal(standaloneRequests, 0);
});

test('tower-defense attack controllers reach the real layered rig pipeline for all four towers', () => {
  resetOffscreen();
  const ownerIds = [
    'survivor-shell-shell',
    'survivor-crystal-pin',
    'survivor-bubble-float',
    'survivor-moss-sprout',
  ];
  const bundles = new Map(ownerIds.map((ownerId) => [ownerId, readyBundle(ownerId)]));
  const rigStore = {
    manifest: MANIFEST,
    get(ownerId, fallback = null) {
      return bundles.get(ownerId) ?? fallback;
    },
  };
  const context = createMainContext();
  const canvas = {
    width: 1280,
    height: 720,
    clientWidth: 1280,
    clientHeight: 720,
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    addEventListener() {},
    removeEventListener() {},
  };
  context.canvas = canvas;
  const game = new TowerDefenseGame(canvas, {
    pixelRatio: 1,
    rigAssetStore: rigStore,
    assetStore: {
      get(_key, fallback = null) { return fallback; },
      useOrFallback(_key, _drawAsset, drawFallback) {
        drawFallback?.();
        return false;
      },
    },
    runtime: {
      storage: {
        get: () => ({ tutorialSeen: true }),
        set: () => true,
      },
    },
  });

  game.state.screen = 'battle';
  game.state.hand = [];
  game.state.enemies = [];
  game.state.towers = ['shell', 'needle', 'bubble', 'sprout'].map((type, index) => ({
    uid: `pipeline-tower-${index}`,
    type,
    star: 1,
    padIndex: index,
    cooldown: 0,
    attackPulse: 1,
    aimAngle: 0,
  }));
  for (const tower of game.state.towers) {
    game.processCharacterAnimationEvent({ type: 'shot', towerUid: tower.uid });
  }
  game.updateCharacterAnimations(0.18);
  resetOffscreen();
  assert.doesNotThrow(() => game.render());

  for (const ownerId of ownerIds) {
    assert.ok(offscreenState.layerDraws.includes(`${ownerId}:eyes:attack`));
    assert.ok(offscreenState.layerDraws.includes(`${ownerId}:mouth:open`));
  }
  assert.ok(context.compositeDraws >= 8, 'menu and battle frames composite complete rig surfaces');
  game.dispose();
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
