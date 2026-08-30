import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MANIFEST = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));
const DRAW_SOURCE = await readFile(new URL('../src/draw.js', import.meta.url), 'utf8');
const TOWER_DEFENSE_SOURCE = await readFile(
  new URL('../src/tower-defense-game.js', import.meta.url),
  'utf8',
);

const offscreenState = {
  clearCount: 0,
  failLayerId: null,
  layerDraws: [],
  layerDrawDetails: [],
  armorDraws: [],
};

function createOffscreenContext() {
  const stack = [];
  return {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    save() {
      stack.push({
        globalAlpha: this.globalAlpha,
        globalCompositeOperation: this.globalCompositeOperation,
      });
    },
    restore() {
      const state = stack.pop();
      if (!state) throw new Error('restore without save');
      this.globalAlpha = state.globalAlpha;
      this.globalCompositeOperation = state.globalCompositeOperation;
    },
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    clearRect() {
      offscreenState.clearCount += 1;
    },
    drawImage(image, ...rect) {
      if (String(image.kind || '').startsWith('evolution-armor:')) {
        offscreenState.armorDraws.push({
          kind: image.kind,
          rect,
          composite: this.globalCompositeOperation,
        });
        return;
      }
      offscreenState.layerDraws.push(image.id);
      offscreenState.layerDrawDetails.push({
        id: image.id,
        image,
        rect,
        composite: this.globalCompositeOperation,
      });
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

const {
  drawMonster,
  drawSlime,
  slimeEvolutionArmorLayout,
  slimeEvolutionProfile,
} = await import('../src/draw.js');
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
  offscreenState.layerDrawDetails.length = 0;
  offscreenState.armorDraws.length = 0;
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
  ]) ctx[method] = (...args) => {
    ctx.calls.push([method, ...args]);
  };

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

const EVOLUTION_CASES = [
  ['survivor-shell-shell', 'shell', 'evolution-shell-armor-v3'],
  ['survivor-crystal-pin', 'needle', 'evolution-needle-armor-v3'],
  ['survivor-bubble-float', 'bubble', 'evolution-bubble-armor-v3'],
  ['survivor-moss-sprout', 'sprout', 'evolution-sprout-armor-v3'],
];

const IDENTITY_PROTECTED_PART_IDS = Object.freeze(['body', 'eyes', 'mouth']);

function unionBindRects(ownerId, partIds) {
  const parts = MANIFEST.rigs[ownerId].parts.filter(({ id }) => partIds.includes(id));
  assert.equal(parts.length, partIds.length, `${ownerId}: every base part exists`);
  const left = Math.min(...parts.map(({ bindRect }) => bindRect.x));
  const top = Math.min(...parts.map(({ bindRect }) => bindRect.y));
  const right = Math.max(...parts.map(({ bindRect }) => bindRect.x + bindRect.width));
  const bottom = Math.max(...parts.map(({ bindRect }) => bindRect.y + bindRect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function detailForLayer(id) {
  const matches = offscreenState.layerDrawDetails.filter((detail) => detail.id === id);
  assert.equal(matches.length, 1, `${id} is drawn exactly once`);
  return matches[0];
}

function expressionLayerIds(ownerId, expression) {
  return MANIFEST.rigs[ownerId].parts.map(({ id }) => {
    if (id === 'eyes' && expression === 'blink') return `${ownerId}:eyes:blink`;
    if (id === 'eyes' && expression === 'attack') return `${ownerId}:eyes:attack`;
    if (id === 'mouth' && expression === 'attack') return `${ownerId}:mouth:open`;
    return `${ownerId}:${id}`;
  });
}

function rectContains(outer, inner, epsilon = 1e-6) {
  return outer.x <= inner.x + epsilon
    && outer.y <= inner.y + epsilon
    && outer.x + outer.width + epsilon >= inner.x + inner.width
    && outer.y + outer.height + epsilon >= inner.y + inner.height;
}

test('slime evolution profiles preserve the base rig and add only three armor parts', () => {
  for (const type of ['shell', 'needle', 'bubble', 'sprout']) {
    for (let star = 1; star <= 4; star += 1) {
      const profile = slimeEvolutionProfile(type, star);
      assert.equal(profile.type, type);
      assert.equal(profile.level, star);
      assert.equal(profile.basePartsPreserved, true);
      assert.equal(profile.armorLayers, star >= 2 ? 3 : 0);
      assert.equal(profile.surfaceLayers, star >= 2 ? 3 : 0);
      assert.equal(profile.componentReplacements, 0);
      assert.equal(profile.addsVolume, false);
      assert.equal(profile.changesSilhouette, false);
      assert.equal(profile.mainRings, type === 'bubble' ? 1 : 0);
      assert.equal(Object.isFrozen(profile), true);
    }
  }
});

test('skeletal armor has no legacy decal, v2 replacement, or source-atop path', () => {
  for (const legacyKey of [
    'evolution-shell-atlas-v1',
    'evolution-needle-atlas-v1',
    'evolution-bubble-atlas-v1',
    'evolution-sprout-atlas-v1',
    'evolution-shell-components-v2',
    'evolution-needle-components-v2',
    'evolution-bubble-components-v2',
    'evolution-sprout-components-v2',
  ]) assert.equal(DRAW_SOURCE.includes(legacyKey), false, legacyKey);
  assert.equal(DRAW_SOURCE.includes('source-atop'), false);
  assert.equal(DRAW_SOURCE.includes('slimeEvolutionDecalLayout'), false);
});

test('placed tower art uses one fixed 76px lane-safe size at every star', () => {
  assert.match(
    TOWER_DEFENSE_SOURCE,
    /drawSlime\(ctx,\s*pad\.x,\s*pad\.y\s*\+\s*6,\s*76,\s*tower\.type,/,
  );
  assert.doesNotMatch(
    TOWER_DEFENSE_SOURCE,
    /drawSlime\(ctx,\s*pad\.x,\s*pad\.y\s*\+\s*6,[^;]*tower\.star\s*[+*\-/]/,
  );
});

test('armor layouts map each exact star row to three fixed non-replacement skeletal slots', () => {
  for (const [ownerId, type, key] of EVOLUTION_CASES) {
    const ownerPartIds = MANIFEST.rigs[ownerId].parts.map(({ id }) => id);
    const originalActorBounds = unionBindRects(ownerId, ownerPartIds);
    const baseLayout = slimeEvolutionArmorLayout(type, 1);
    assert.equal(baseLayout.type, type);
    assert.equal(baseLayout.level, 1);
    assert.equal(baseLayout.key, key);
    assert.equal(baseLayout.atlasSize, 768);
    assert.equal(baseLayout.cellSize, 256);
    assert.equal(baseLayout.row, null);
    assert.deepEqual(baseLayout.cells, {});
    assert.deepEqual(baseLayout.slots, []);
    assert.equal(Object.isFrozen(baseLayout), true);
    assert.equal(Object.isFrozen(baseLayout.cells), true);
    assert.equal(Object.isFrozen(baseLayout.slots), true);

    let fixedBindRects = null;
    for (let star = 2; star <= 4; star += 1) {
      const layout = slimeEvolutionArmorLayout(type, star);
      const row = star - 2;
      assert.equal(layout.type, type);
      assert.equal(layout.level, star);
      assert.equal(layout.key, key);
      assert.equal(layout.atlasSize, 768);
      assert.equal(layout.cellSize, 256);
      assert.equal(layout.row, row);
      assert.equal(layout.slots.length, 3);
      assert.equal(new Set(layout.slots.map(({ id }) => id)).size, 3);
      assert.equal(new Set(layout.slots.map(({ partId }) => partId)).size, 3);

      for (const [column, slot] of layout.slots.entries()) {
        assert.equal(slot.partId, `armor-${type}-${slot.id}-${star}-star`);
        assert.equal(Object.hasOwn(slot, 'replaces'), false,
          `${type}.${slot.id} is additive armor and cannot replace a base part`);
        assert.deepEqual(slot.sourceRect, {
          x: column * 256,
          y: row * 256,
          width: 256,
          height: 256,
        });
        assert.equal(rectContains(originalActorBounds, slot.bindRect), true,
          `${type}.${slot.id} stays inside the original actor volume`);
        assert.equal(ownerPartIds.includes(slot.partId), false);
        assert.equal(typeof slot.bone, 'string');
        assert.ok(slot.bone.length > 0);
        assert.equal(['face', 'eyes', 'mouth'].includes(slot.bone), false,
          `${type}.${slot.id} is a skeletal armor layer, never a face layer`);
        assert.equal(Number.isFinite(slot.z), true);
        assert.equal(Object.isFrozen(slot), true);
        assert.equal(Object.isFrozen(slot.bindRect), true);
        assert.equal(Object.isFrozen(slot.sourceRect), true);
      }
      assert.equal(Object.isFrozen(layout), true);
      assert.equal(Object.isFrozen(layout.cells), true);
      assert.equal(Object.isFrozen(layout.slots), true);

      const bindRects = layout.slots.map(({ id, bone, z, bindRect }) => ({
        id,
        bone,
        z,
        ...bindRect,
      }));
      if (fixedBindRects == null) fixedBindRects = bindRects;
      assert.deepEqual(bindRects, fixedBindRects,
        `${type} uses fixed armor bones and bind slots at every star`);
    }
  }
});

test('each evolved star keeps every original rig part once and adds three armor layers', () => {
  for (const [ownerId, type, atlasKey] of EVOLUTION_CASES) {
    resetOffscreen();
    const baseRequests = [];
    const baseContext = createMainContext();
    const rigAsset = readyBundle(ownerId);
    drawSlime(baseContext, 12, 18, 90, type, {
      animate: false,
      alpha: 0.7,
      facing: -1,
      time: 1.25,
      star: 1,
      assetStore: {
        useOrFallback(key) { baseRequests.push(key); },
      },
      rigAsset,
      requireLayeredRig: true,
    });
    assert.deepEqual(baseRequests, [], `${type} 1★ does not request an evolution atlas`);
    assert.deepEqual(
      offscreenState.layerDraws,
      MANIFEST.rigs[ownerId].parts.map(({ id }) => `${ownerId}:${id}`),
      `${type} 1★ uses every authored base part`,
    );
    assert.equal(offscreenState.armorDraws.length, 0);
    const baseLayerIds = [...offscreenState.layerDraws];
    const protectedBaseDetails = new Map(IDENTITY_PROTECTED_PART_IDS.map((partId) => {
      const id = `${ownerId}:${partId}`;
      return [partId, detailForLayer(id)];
    }));
    const baseMainScale = baseContext.calls.find(([method]) => method === 'scale');
    const baseComposite = baseContext.calls.find(([method, kind]) => (
      method === 'drawImage' && kind === 'rig-surface'
    ));

    for (let star = 2; star <= 4; star += 1) {
      resetOffscreen();
      const requests = [];
      const atlas = {
        kind: `evolution-armor:${type}`,
        width: 768,
        height: 768,
      };
      const assetStore = {
        useOrFallback(key, renderAsset) {
          requests.push(key);
          renderAsset(atlas);
          return true;
        },
      };
      const ctx = createMainContext();
      drawSlime(ctx, 12, 18, 90, type, {
        animate: false,
        alpha: 0.7,
        facing: -1,
        time: 1.25,
        star,
        assetStore,
        rigAsset,
        requireLayeredRig: true,
      });

      assert.deepEqual(requests, [atlasKey], `${type} requests its canonical atlas once`);
      const layout = slimeEvolutionArmorLayout(type, star);
      const armorDraws = offscreenState.armorDraws;
      assert.equal(armorDraws.length, 3, `${type} ${star}★ draws exactly three armor parts`);
      assert.deepEqual(
        armorDraws.map(({ rect: [sx, sy, sw, sh] }) => ({
          x: sx, y: sy, width: sw, height: sh,
        })),
        [...layout.slots]
          .sort((left, right) => left.z - right.z)
          .map(({ sourceRect }) => sourceRect),
        `${type} ${star}★ draws only its own atlas row`,
      );
      assert.ok(armorDraws.every(({ composite }) => composite === 'source-over'),
        `${type} ${star}★ armor uses ordinary skeletal source-over parts`);
      assert.deepEqual(offscreenState.layerDraws, baseLayerIds,
        `${type} ${star}★ preserves every original rig layer in its original order`);
      for (const layerId of baseLayerIds) {
        assert.equal(offscreenState.layerDraws.filter((id) => id === layerId).length, 1,
          `${type} ${star}★ keeps ${layerId} exactly once`);
      }
      for (const partId of IDENTITY_PROTECTED_PART_IDS) {
        const baseDetail = protectedBaseDetails.get(partId);
        const evolvedDetail = detailForLayer(`${ownerId}:${partId}`);
        assert.equal(evolvedDetail.image, baseDetail.image,
          `${type} ${star}★ keeps the exact original ${partId} image object`);
        assert.deepEqual(evolvedDetail.rect, baseDetail.rect,
          `${type} ${star}★ keeps the original ${partId} crop and bind rectangle`);
        assert.equal(evolvedDetail.composite, 'source-over');
      }
      assert.equal(ctx.calls.filter(([method, kind]) => (
        method === 'drawImage' && kind === 'rig-surface'
      )).length, 1, `${type} ${star}★ keeps one atomic rig composite`);
      assert.deepEqual(ctx.calls.find(([method]) => method === 'scale'), baseMainScale,
        `${type} ${star}★ keeps the same final main-canvas scale as 1★`);
      assert.deepEqual(ctx.calls.find(([method, kind]) => (
        method === 'drawImage' && kind === 'rig-surface'
      )), baseComposite, `${type} ${star}★ keeps the same rig surface footprint as 1★`);
      const expectedFacingScale = -1 * MANIFEST.rigs[ownerId].canonicalFacing;
      assert.ok(ctx.calls.some(([method, xScale]) => (
        method === 'scale' && Math.sign(xScale) === expectedFacingScale
      )),
        `${type} atlas and rig preserve requested facing`);
    }
  }
});

test('missing strict armor atlases fail atomically without base, standalone, or vector art', () => {
  const visualMethods = new Set([
    'arc', 'ellipse', 'fill', 'lineTo', 'moveTo', 'quadraticCurveTo', 'stroke',
  ]);

  for (const [ownerId, type] of EVOLUTION_CASES) {
    resetOffscreen();
    const baseContext = createMainContext();
    drawSlime(baseContext, 0, 0, 90, type, {
      animate: false,
      time: 0.7,
      star: 1,
      rigAsset: readyBundle(ownerId),
      requireLayeredRig: true,
    });
    const baselineGeometry = baseContext.calls
      .filter(([method]) => visualMethods.has(method)).length;
    for (let star = 2; star <= 4; star += 1) {
      resetOffscreen();
      const ctx = createMainContext();
      assert.throws(() => drawSlime(ctx, 0, 0, 90, type, {
        animate: false,
        time: 0.7,
        star,
        rigAsset: readyBundle(ownerId),
        requireLayeredRig: true,
      }), /Required layered rig could not render/);
      const geometry = ctx.calls.filter(([method]) => visualMethods.has(method)).length;
      assert.equal(ctx.compositeDraws, 0, `${type} ${star}★ exposes no character composite`);
      assert.equal(offscreenState.layerDraws.length, 0,
        `${type} ${star}★ does not expose base rig layers`);
      assert.equal(offscreenState.armorDraws.length, 0);
      assert.equal(geometry, baselineGeometry,
        `${type} ${star}★ adds no fallback character geometry beyond the normal shadow`);
    }
  }
});

test('bubble keeps its one original ring while all v3 armor remains additive', () => {
  const ownerId = 'survivor-bubble-float';
  const rigAsset = readyBundle(ownerId);
  let baseRing = null;
  for (let star = 1; star <= 4; star += 1) {
    resetOffscreen();
    const atlas = { kind: 'evolution-armor:bubble', width: 768, height: 768 };
    drawSlime(createMainContext(), 0, 0, 90, 'bubble', {
      animate: false,
      star,
      assetStore: star === 1 ? undefined : {
        useOrFallback(_key, renderAsset) {
          renderAsset(atlas);
          return true;
        },
      },
      rigAsset,
      requireLayeredRig: true,
    });
    assert.equal(slimeEvolutionProfile('bubble', star).mainRings, 1);
    assert.equal(offscreenState.layerDraws.filter((id) => id === `${ownerId}:ring`).length, 1,
      `bubble ${star}★ draws the original ring exactly once`);
    const ring = detailForLayer(`${ownerId}:ring`);
    if (baseRing == null) baseRing = ring;
    else {
      assert.equal(ring.image, baseRing.image, `bubble ${star}★ keeps the original ring image`);
      assert.deepEqual(ring.rect, baseRing.rect, `bubble ${star}★ keeps the original ring crop and bind`);
      assert.equal(slimeEvolutionArmorLayout('bubble', star).slots.some(
        (slot) => Object.hasOwn(slot, 'replaces'),
      ), false, `bubble ${star}★ armor cannot replace or duplicate the ring`);
    }
  }
});

test('evolved armor preserves every base layer while blink and attack replace only face images', () => {
  for (const [ownerId, type] of EVOLUTION_CASES) {
    const rigAsset = readyBundle(ownerId);
    for (const expression of ['blink', 'attack']) {
      resetOffscreen();
      const ctx = createMainContext();
      const atlas = { kind: `evolution-armor:${type}`, width: 768, height: 768 };
      const assetStore = {
        useOrFallback(_key, renderAsset) {
          renderAsset(atlas);
          return true;
        },
      };
      assert.doesNotThrow(() => drawSlime(ctx, 0, 0, 100, type, {
        animate: false,
        star: 4,
        expression,
        assetStore,
        rigAsset,
        requireLayeredRig: true,
      }));
      assert.equal(ctx.compositeDraws, 1, `${ownerId} keeps one complete rig composite`);
      assert.equal(offscreenState.armorDraws.length, 3,
        `${ownerId} adds exactly three armor parts`);
      assert.deepEqual(offscreenState.layerDraws, expressionLayerIds(ownerId, expression),
        `${ownerId} ${expression} preserves every non-face base image exactly once`);
    }
  }
});

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
