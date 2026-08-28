import test from 'node:test';
import assert from 'node:assert/strict';

import { SlimeGame } from '../src/game.js';
import {
  BUILDINGS,
  ENEMY_BY_ID,
  ITEMS,
  SKILLS,
  SURVIVORS,
  WAVES,
} from '../src/catalog.js';
import {
  PALETTE,
  drawAssetOrFallback,
  drawBuilding,
  drawParticle,
  drawStatusIcon,
} from '../src/draw.js';
import {
  BOSS_CLIPS,
  BUBBLE_CLIPS,
  BUG_CLIPS,
  CRYSTAL_CLIPS,
  SHELL_CLIPS,
  SPROUT_CLIPS,
  STONE_CLIPS,
  WINDCAP_CLIPS,
} from '../src/animation/clips.js';
import { DEFAULT_EXPRESSION_TRANSITION_DURATION } from '../src/animation/expression-mixer.js';
import { characterPortraitCrop } from '../src/character-render-profiles.js';
import { WORLD as COLONY_WORLD } from '../src/colony-catalog.js';

function createGradient() {
  return { addColorStop() {} };
}

function createContext() {
  const functions = new Set([
    'arc', 'beginPath', 'bezierCurveTo', 'clearRect', 'closePath', 'ellipse', 'fill',
    'fillRect', 'fillText', 'lineTo', 'moveTo', 'quadraticCurveTo', 'restore', 'rotate',
    'save', 'scale', 'setLineDash', 'setTransform', 'stroke', 'strokeRect', 'strokeText',
    'translate', 'drawImage',
  ]);
  return new Proxy({
    createLinearGradient: createGradient,
    createRadialGradient: createGradient,
    measureText: (text) => ({ width: String(text).length * 16 }),
  }, {
    get(target, property) {
      if (property in target) return target[property];
      if (functions.has(property)) return () => {};
      return undefined;
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}

function createHarness({
  context = createContext(),
  assetStore = null,
  viewportWidth = 1280,
  viewportHeight = 720,
} = {}) {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener() {},
    AudioContext: null,
    webkitAudioContext: null,
  };
  const ctx = context;
  const canvas = {
    width: viewportWidth,
    height: viewportHeight,
    getContext: () => ctx,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: viewportWidth,
      height: viewportHeight,
    }),
    addEventListener() {},
  };
  const game = new SlimeGame(canvas, { assetStore });
  game.modal = null;
  game.state.tutorialSeen = true;
  return { game, storage };
}

function createRecordingContext({ throwOnDrawImage = false } = {}) {
  const ctx = createContext();
  const calls = [];
  ctx.drawImage = (...args) => {
    calls.push(['drawImage', ...args]);
    if (throwOnDrawImage) throw new Error('drawImage failed');
  };
  ctx.fillRect = (...args) => calls.push(['fillRect', ...args]);
  ctx.createLinearGradient = (...args) => {
    calls.push(['createLinearGradient', ...args]);
    return createGradient();
  };
  return { ctx, calls };
}

function createDynamicEffectRecordingContext() {
  const ctx = createContext();
  const calls = [];
  const methods = [
    'arc', 'beginPath', 'bezierCurveTo', 'closePath', 'ellipse', 'fill', 'lineTo',
    'moveTo', 'quadraticCurveTo', 'restore', 'rotate', 'save', 'scale', 'setLineDash',
    'stroke', 'translate', 'drawImage',
  ];
  for (const method of methods) {
    ctx[method] = (...args) => calls.push([method, ...args]);
  }
  ctx.createLinearGradient = (...args) => {
    calls.push(['createLinearGradient', ...args]);
    return createGradient();
  };
  ctx.createRadialGradient = (...args) => {
    calls.push(['createRadialGradient', ...args]);
    return createGradient();
  };
  return { ctx, calls };
}

const DYNAMIC_COMPONENT_ATLAS_KEY = 'effect-dynamic-components-v1';
const AUTHORED_DYNAMIC_EFFECT_ASSET_BY_KIND = Object.freeze({
  push: 'effect-jelly-bounce-wave',
  heal: 'effect-heal-burst',
  spawn: 'effect-spawn-rift-burst',
  trail: 'effect-honey-draw-trail',
  swap: 'effect-soft-swap-arc',
  'building-destruction': 'effect-building-destruction-puff',
  'shield-break': 'effect-shield-break-v1',
});
const AUTHORED_DYNAMIC_EFFECT_KEYS = Object.freeze(
  Object.values(AUTHORED_DYNAMIC_EFFECT_ASSET_BY_KIND),
);
const DYNAMIC_EFFECT_CASES = Object.freeze([
  ['impact', {}],
  ['push', { dx: 78, dy: -16 }],
  ['enemy-pop', {}],
  ['building-destruction', {}],
  ['shield-break', {}],
  ['heal', {}],
  ['spawn', { layer: 'back' }],
  ['trail', { dx: 150, dy: 0 }],
  ['swap', { dx: 130, dy: 55 }],
  ['place', {}],
  ['wave-clear', {}],
]);
const DYNAMIC_GEOMETRY_METHODS = new Set([
  'arc', 'ellipse', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'stroke', 'fill',
]);
const DYNAMIC_MOTION_METHODS = new Set([
  'translate', 'rotate', 'scale', 'drawImage',
]);

function normalizedCallTrace(calls, methodNames) {
  return calls
    .filter(([name]) => methodNames.has(name))
    .map(([name, ...args]) => [
      name,
      ...args.map((value) => (
        value && typeof value === 'object'
          ? value.key || value.id || '[canvas-image]'
          : value
      )),
    ]);
}

function createDynamicAtlasStore() {
  return createReadyAssetStore({
    [DYNAMIC_COMPONENT_ATLAS_KEY]: {
      key: DYNAMIC_COMPONENT_ATLAS_KEY,
      width: 1254,
      height: 1254,
      naturalWidth: 1254,
      naturalHeight: 1254,
    },
  });
}

function createReadyAssetStore(keysOrAssets) {
  const assets = keysOrAssets instanceof Map
    ? new Map(keysOrAssets)
    : Array.isArray(keysOrAssets)
      ? new Map(keysOrAssets.map((key) => [key, { key }]))
      : new Map(Object.entries(keysOrAssets));
  const requests = [];
  return {
    requests,
    get(key, fallback = null) {
      return assets.get(key) ?? fallback;
    },
    useOrFallback(key, renderAsset, renderFallback) {
      requests.push(key);
      if (!assets.has(key)) {
        renderFallback?.({ status: 'failed' }, null);
        return false;
      }
      try {
        renderAsset(assets.get(key));
        return true;
      } catch (error) {
        renderFallback?.({ status: 'loaded' }, error);
        return false;
      }
    },
  };
}

test('renders all top-level screens with the zero-dependency canvas renderer', () => {
  const { game } = createHarness();
  assert.doesNotThrow(() => game.render());

  game.openIntel();
  assert.equal(game.state.phase, 'intel');
  assert.doesNotThrow(() => game.render());

  game.beginDefense();
  assert.equal(game.state.phase, 'battle');
  assert.doesNotThrow(() => game.render());

  game.finishDefense(true);
  assert.equal(game.state.phase, 'result');
  assert.doesNotThrow(() => game.render());
});

test('the infinite map fills the authored canvas and replaces the decorative background layers', () => {
  const recording = createRecordingContext();
  const { game } = createHarness({ context: recording.ctx });
  let backgroundDraws = 0;
  let foregroundDraws = 0;
  game.drawBackground = () => { backgroundDraws += 1; };
  game.drawForeground = () => { foregroundDraws += 1; };

  game.render();

  assert.equal(backgroundDraws, 0);
  assert.equal(foregroundDraws, 0);
  assert.ok(
    recording.calls.some(([name, x, y, width, height]) => (
      name === 'fillRect' && x === 0 && y === 0 && width === 1280 && height === 720
    )),
    'the terrain layer should cover the complete logical canvas',
  );
  assert.ok(game.pointToCell({ x: 0, y: 0 }));
  assert.ok(game.pointToCell({ x: 1279, y: 719 }));
});

test('welcome tutorial step cards compose formal game art instead of number placeholders', () => {
  const keys = [
    'building-mushroom-home',
    'resource-soft-gel-token',
    'survivor-shell-shell',
    'survivor-crystal-pin',
    'survivor-moss-sprout',
    'terrain-discovery-fog-cell-v1',
    'terrain-crystal-shard-node-a',
  ];
  const assets = Object.fromEntries(keys.map((key) => [key, { key, width: 512, height: 512 }]));
  const store = createReadyAssetStore(assets);
  const recording = createRecordingContext();
  recording.ctx.fillText = (...args) => recording.calls.push(['fillText', ...args]);
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  game.modal = { type: 'welcome', page: 1 };

  game.drawWelcome(recording.ctx);

  for (const key of keys) {
    assert.ok(store.requests.includes(key), `tutorial should request ${key}`);
    assert.ok(
      recording.calls.some(([name, image]) => name === 'drawImage' && image === assets[key]),
      `tutorial should draw ${key}`,
    );
  }
  const text = recording.calls.filter(([name]) => name === 'fillText').map(([, value]) => value);
  assert.equal(text.some((value) => ['1', '2', '3'].includes(value)), false);
});

test('discovery fog uses its authored world asset and keeps Canvas only as load fallback', () => {
  const fogKey = 'terrain-discovery-fog-cell-v1';
  const readyStore = createReadyAssetStore([fogKey]);
  const authored = createRecordingContext();
  const { game } = createHarness({ context: authored.ctx, assetStore: readyStore });
  game.worldCellAt = (x, y) => ({ discovered: !(x === 4 && y === 7) });

  const result = game.drawDiscoveryFog(authored.ctx, {
    minX: 4,
    minY: 7,
    maxX: 5,
    maxY: 7,
  });

  assert.equal(result.usedAsset, true);
  assert.equal(result.assetCells, 1);
  assert.ok(readyStore.requests.includes(fogKey));
  assert.equal(authored.calls.filter(([name]) => name === 'drawImage').length, 1);
  assert.equal(
    authored.calls.some(([name]) => name === 'fillRect'),
    false,
    'ready authored fog must not reveal a square grid through Canvas fills',
  );

  const fallback = createRecordingContext();
  const fallbackHarness = createHarness({
    context: fallback.ctx,
    assetStore: createReadyAssetStore([]),
  });
  fallbackHarness.game.worldCellAt = () => ({ discovered: false });
  const fallbackResult = fallbackHarness.game.drawDiscoveryFog(fallback.ctx, {
    minX: 4,
    minY: 7,
    maxX: 4,
    maxY: 7,
  });
  assert.equal(fallbackResult.usedAsset, false);
  assert.equal(fallbackResult.fallbackCells, 1);
  assert.ok(fallback.calls.some(([name]) => name === 'fillRect'));
});

test('wide landscape screens reveal more world instead of leaving letterbox background', () => {
  const recording = createRecordingContext();
  const { game } = createHarness({
    context: recording.ctx,
    viewportWidth: 1920,
    viewportHeight: 720,
  });

  game.render();

  assert.equal(game.scale, 1);
  assert.equal(game.offsetX, 320);
  assert.ok(
    recording.calls.some(([name, x, y, width, height]) => (
      name === 'fillRect' && x === -320 && y === 0 && width === 1920 && height === 720
    )),
    'the world layer should expand through both wide-screen side areas',
  );
  const leftEdge = game.toGamePoint({ clientX: 1, clientY: 360 });
  const rightEdge = game.toGamePoint({ clientX: 1919, clientY: 360 });
  assert.ok(game.pointToCell(leftEdge), 'left physical edge stays interactive world');
  assert.ok(game.pointToCell(rightEdge), 'right physical edge stays interactive world');
});

test('HUD overlays block map dragging while uncovered terrain remains draggable', () => {
  const { game } = createHarness();
  game.render();
  const pointer = (clientX, clientY, pointerId = 1) => ({
    clientX,
    clientY,
    pointerId,
    preventDefault() {},
  });

  game.onPointerDown(pointer(900, 200));
  assert.equal(game.pointerDrag, null, 'the right-side overlay must capture pointer gestures');
  game.onPointerCancel();

  game.onPointerDown(pointer(500, 300, 2));
  assert.deepEqual(game.pointerDrag?.start, { x: 500, y: 300 });
  game.onPointerCancel();

  game.onPointerDown(pointer(400, 40, 3));
  assert.equal(game.pointerDrag, null, 'the top HUD must not initiate camera movement');
  game.onPointerCancel();

  game.onPointerDown(pointer(500, 650, 4));
  assert.equal(game.pointerDrag, null, 'the bottom controls must not initiate camera movement');
  game.onPointerCancel();
});

test('generated image drawing is preferred and drawImage failures atomically use fallback', () => {
  const store = createReadyAssetStore(['ready']);
  const successful = createRecordingContext();
  let fallbackCount = 0;
  assert.equal(drawAssetOrFallback(
    successful.ctx,
    store,
    'ready',
    (asset) => successful.ctx.drawImage(asset, 1, 2, 3, 4),
    () => { fallbackCount += 1; },
  ), true);
  assert.equal(successful.calls.filter(([name]) => name === 'drawImage').length, 1);
  assert.equal(fallbackCount, 0);

  const failing = createRecordingContext({ throwOnDrawImage: true });
  assert.equal(drawAssetOrFallback(
    failing.ctx,
    store,
    'ready',
    (asset) => failing.ctx.drawImage(asset, 1, 2, 3, 4),
    () => { fallbackCount += 1; },
  ), false);
  assert.equal(fallbackCount, 1);
});

test('main background PNG replaces the whole vector scene and safely falls back', () => {
  const store = createReadyAssetStore(['background-garden-base']);
  const generated = createRecordingContext();
  const { game } = createHarness({ context: generated.ctx, assetStore: store });
  game.drawBackground(generated.ctx);
  assert.equal(generated.calls.filter(([name]) => name === 'drawImage').length, 1);
  assert.equal(generated.calls.some(([name]) => name === 'createLinearGradient'), false);

  const failing = createRecordingContext({ throwOnDrawImage: true });
  const fallbackHarness = createHarness({ context: failing.ctx, assetStore: store });
  fallbackHarness.game.drawBackground(failing.ctx);
  assert.equal(failing.calls.some(([name]) => name === 'createLinearGradient'), true);
  assert.equal(failing.calls.some(([name]) => name === 'fillRect'), true);
});

test('right-side details require building PNGs while other card types retain glyph fallback', () => {
  const building = BUILDINGS.find((card) => card.id === 'building-honey-plot');
  const skill = SKILLS.find((card) => card.id === 'skill-jelly-bounce');
  const item = ITEMS.find((card) => card.id === 'item-moving-bubble');
  const buildingArt = {
    key: building.id,
    naturalWidth: 512,
    naturalHeight: 512,
  };
  const skillArt = {
    key: `${skill.id}-icon`,
    naturalWidth: 512,
    naturalHeight: 512,
  };
  const itemArt = {
    key: `${item.id}-icon`,
    naturalWidth: 512,
    naturalHeight: 512,
  };
  const store = createReadyAssetStore(new Map([
    [building.id, buildingArt],
    [`${skill.id}-icon`, skillArt],
    [`${item.id}-icon`, itemArt],
  ]));
  const recording = createRecordingContext();
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  game.state.phase = 'build';
  game.state.buildings = [{
    uid: 'detail-building',
    cardId: building.id,
    x: 0,
    y: 0,
    rotation: 0,
    hp: building.hp,
    maxHp: building.hp,
  }];
  game.selection = { kind: 'inspect-building', uid: 'detail-building' };

  game.drawBuildSide(recording.ctx);

  const buildingCall = recording.calls.find((call) => (
    call[0] === 'drawImage' && call[1] === buildingArt
  ));
  assert.ok(buildingCall, 'the selected building detail should request its generated PNG');
  assert.ok(Math.abs(buildingCall[4] / buildingCall[5] - 1) < 1e-9);
  assert.ok(buildingCall[4] <= 66 && buildingCall[5] <= 66);

  recording.calls.length = 0;
  game.state.phase = 'battle';
  game.selection = {
    kind: 'target-card',
    cardType: 'skill',
    cardId: skill.id,
    step: 0,
    wasPaused: false,
  };
  game.drawBattleSide(recording.ctx);
  const skillCall = recording.calls.find((call) => call[0] === 'drawImage' && call[1] === skillArt);
  assert.ok(skillCall, 'the targeting detail should request its generated icon');
  assert.ok(skillCall[4] <= 54 && skillCall[5] <= 54);

  recording.calls.length = 0;
  game.selection = {
    kind: 'target-card',
    cardType: 'item',
    cardId: item.id,
    step: 0,
    wasPaused: false,
  };
  game.drawBattleSide(recording.ctx);
  assert.ok(
    recording.calls.some((call) => call[0] === 'drawImage' && call[1] === itemArt),
    'the targeting detail should request its generated item icon',
  );

  const fallbackRecording = createRecordingContext();
  const fallbackTexts = [];
  fallbackRecording.ctx.fillText = (value) => fallbackTexts.push(String(value));
  const fallbackHarness = createHarness({
    context: fallbackRecording.ctx,
    assetStore: createReadyAssetStore([]),
  });
  fallbackHarness.game.drawCardArtwork(
    fallbackRecording.ctx,
    building,
    { x: 0, y: 0, w: 78, h: 78 },
    { fallbackFontSize: 34 },
  );
  assert.equal(
    fallbackTexts.includes(fallbackHarness.game.cardGlyph(building)),
    false,
    'a missing production building PNG must not be replaced by a glyph',
  );

  fallbackHarness.game.drawCardArtwork(
    fallbackRecording.ctx,
    skill,
    { x: 0, y: 0, w: 78, h: 78 },
    { fallbackFontSize: 34 },
  );
  assert.ok(
    fallbackTexts.includes(fallbackHarness.game.cardGlyph(skill)),
    'non-building card types keep their existing fallback behavior',
  );

  const throwingRecording = createRecordingContext({ throwOnDrawImage: true });
  const throwingTexts = [];
  throwingRecording.ctx.fillText = (value) => throwingTexts.push(String(value));
  const throwingHarness = createHarness({
    context: throwingRecording.ctx,
    assetStore: createReadyAssetStore(new Map([[building.id, buildingArt]])),
  });
  assert.equal(
    throwingHarness.game.drawCardArtwork(
      throwingRecording.ctx,
      building,
      { x: 0, y: 0, w: 78, h: 78 },
    ),
    false,
  );
  assert.equal(throwingTexts.includes(throwingHarness.game.cardGlyph(building)), false);
});

test('character detail and mini-card art crops transparent margins without distorting the PNG', () => {
  const card = SURVIVORS.find(({ id }) => id === 'survivor-shell-shell');
  const art = { key: card.id, naturalWidth: 512, naturalHeight: 512 };
  const recording = createRecordingContext();
  const { game } = createHarness({
    context: recording.ctx,
    assetStore: createReadyAssetStore(new Map([[card.id, art]])),
  });
  const expectedCrop = characterPortraitCrop(card.id, 512, 512);

  game.drawCardArtwork(recording.ctx, card, { x: 0, y: 0, w: 78, h: 78 });
  let call = recording.calls.find((entry) => entry[0] === 'drawImage' && entry[1] === art);
  assert.deepEqual(call.slice(2, 6), [
    expectedCrop.x,
    expectedCrop.y,
    expectedCrop.width,
    expectedCrop.height,
  ]);
  assert.ok(call[8] <= 66 && call[9] <= 66);
  assert.ok(Math.abs(call[8] / call[9] - expectedCrop.width / expectedCrop.height) < 1e-9);

  recording.calls.length = 0;
  game.drawMiniCard(
    recording.ctx,
    `profile-${card.id}`,
    { x: 0, y: 0, w: 150, h: 84 },
    card,
    { selected: false, meta: '测试' },
    () => {},
  );
  call = recording.calls.find((entry) => entry[0] === 'drawImage' && entry[1] === art);
  assert.deepEqual(call.slice(2, 6), [
    expectedCrop.x,
    expectedCrop.y,
    expectedCrop.width,
    expectedCrop.height,
  ]);
  assert.ok(call[8] <= 40 && call[9] <= 60);
  assert.ok(Math.abs(call[8] / call[9] - expectedCrop.width / expectedCrop.height) < 1e-9);
});

test('battlefield keeps the portal and moving-bubble shell behind depth-sorted actors', () => {
  const events = [];
  const store = createReadyAssetStore(['rift-entry-portal']);
  const useOrFallback = store.useOrFallback.bind(store);
  store.useOrFallback = (key, renderAsset, renderFallback) => {
    events.push(`asset:${key}`);
    return useOrFallback(key, renderAsset, renderFallback);
  };
  const { game } = createHarness({ assetStore: store });
  game.drawRoutes = () => events.push('routes');
  game.drawTerrain = () => events.push('terrain');
  game.drawWorldEffects = (_ctx, layer) => events.push(`effects:${layer}`);
  game.drawDynamicEffects = (_ctx, layer) => events.push(`dynamic:${layer}`);
  game.drawMovingBubblePreview = () => events.push('moving-bubble-preview');
  game.drawWorldActors = () => events.push('actors');
  game.drawProjectilesAndParticles = () => events.push('projectiles');
  game.drawSelectionOverlay = () => events.push('selection');

  game.drawBattlefield(game.ctx);

  assert.ok(
    events.indexOf('asset:rift-entry-portal') < events.indexOf('actors'),
    'the portal must be painted before enemies emerging from it',
  );
  assert.deepEqual(events.filter((event) => [
    'effects:back',
    'moving-bubble-preview',
    'actors',
    'effects:front',
    'projectiles',
    'selection',
  ].includes(event)), [
    'effects:back',
    'moving-bubble-preview',
    'actors',
    'effects:front',
    'projectiles',
    'selection',
  ]);
  assert.ok(
    events.indexOf('dynamic:back') < events.indexOf('actors'),
    'back-layer procedural effects must remain behind depth-sorted actors',
  );
  assert.ok(
    events.indexOf('dynamic:front') > events.indexOf('actors')
      && events.indexOf('dynamic:front') < events.indexOf('projectiles'),
    'front-layer procedural effects must overlay actors without covering projectiles',
  );

  const order = [];
  const { game: depthGame } = createHarness();
  depthGame.state.buildings = [{
    uid: 'building-depth', cardId: 'building-mushroom-home', x: 0, y: 3, rotation: 0,
  }];
  depthGame.state.deployables = [{ uid: 'deployable-depth', type: 'pad', x: 0, y: 1 }];
  depthGame.state.survivors = [{ uid: 'survivor-depth', x: 0, y: 0 }];
  depthGame.state.enemies = [{ uid: 'enemy-depth', x: 0, y: 2 }];
  depthGame.drawBuildings = (_ctx, [entity]) => order.push(entity.uid);
  depthGame.drawDeployables = (_ctx, [entity]) => order.push(entity.uid);
  depthGame.drawUnits = (_ctx, [{ entity }]) => order.push(entity.uid);

  depthGame.drawWorldActors(depthGame.ctx);
  assert.deepEqual(order, [
    'survivor-depth',
    'deployable-depth',
    'enemy-depth',
    'building-depth',
  ]);

  order.length = 0;
  depthGame.state.buildings[0].y = 2;
  depthGame.state.survivors[0].y = 2;
  depthGame.state.deployables = [];
  depthGame.state.enemies = [];
  depthGame.drawWorldActors(depthGame.ctx);
  assert.deepEqual(
    order,
    ['building-depth', 'survivor-depth'],
    'a unit stationed in a one-cell home must remain visible in front of it',
  );
});

test('all six building surfaces use their formal PNG and a 60px world slot', () => {
  const frame = { key: 'ui-card-frame-common', naturalWidth: 512, naturalHeight: 384 };
  const buildingArt = new Map(BUILDINGS.map((card) => [card.id, {
    key: card.id,
    naturalWidth: 512,
    naturalHeight: 512,
  }]));
  const store = createReadyAssetStore(new Map([
    ['ui-card-frame-common', frame],
    ...buildingArt,
  ]));
  const recording = createRecordingContext();
  const scales = [];
  recording.ctx.scale = (x, y) => scales.push([x, y]);
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  game.state.phase = 'build';
  game.state.buildings = BUILDINGS.map((card, index) => ({
    uid: `formal-building-${index}`,
    cardId: card.id,
    x: 8 + index,
    y: 7,
    rotation: 0,
    hp: card.hp,
    maxHp: card.hp,
    placedAt: -10,
  }));

  game.drawBuildings(recording.ctx);

  for (const art of buildingArt.values()) {
    assert.ok(
      recording.calls.some((call) => call[0] === 'drawImage' && call[1] === art),
      `${art.key} should render its formal world PNG`,
    );
  }
  assert.ok(
    scales.filter(([x, y]) => (
      Math.abs(x - 60 / 115) < 1e-9 && Math.abs(y - 60 / 115) < 1e-9
    )).length >= BUILDINGS.length,
    'every world building should use the 60px logical art slot',
  );
  assert.equal(
    scales.some(([x, y]) => Math.abs(x - 104 / 115) < 1e-9 || Math.abs(y - 104 / 115) < 1e-9),
    false,
  );
  assert.equal(
    scales.some(([x, y]) => Math.abs(x - 88 / 115) < 1e-9 || Math.abs(y - 88 / 115) < 1e-9),
    false,
  );

  recording.calls.length = 0;
  game.drawBuildCards(recording.ctx);
  for (const art of buildingArt.values()) {
    assert.ok(
      recording.calls.some((call) => call[0] === 'drawImage' && call[1] === art),
      `${art.key} should render in the bottom building card`,
    );
  }
  assert.equal(
    recording.calls.filter((call) => call[0] === 'drawImage' && call[1] === frame).length,
    BUILDINGS.length * 9,
    'each building card should keep the generated nine-slice frame',
  );
});

test('missing building PNGs never invoke procedural building art or building glyphs', () => {
  const missingStore = createReadyAssetStore([]);
  const variants = ['hut', 'farm', 'tower', 'fence', 'weather', 'paver'];
  let emptySlotTrace = null;
  for (const variant of variants) {
    const recording = createDynamicEffectRecordingContext();
    drawBuilding(recording.ctx, 0, 0, 60, variant, { assetStore: missingStore });
    assert.equal(recording.calls.some(([name]) => name === 'drawImage'), false, variant);
    const trace = normalizedCallTrace(recording.calls, new Set([
      'arc', 'ellipse', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo',
      'stroke', 'fill', 'translate', 'rotate', 'scale', 'drawImage',
    ]));
    if (emptySlotTrace === null) emptySlotTrace = trace;
    else assert.deepEqual(
      trace,
      emptySlotTrace,
      `${variant} must not add a variant-specific procedural building fallback`,
    );
  }

  const recording = createRecordingContext();
  const texts = [];
  recording.ctx.fillText = (value) => texts.push(String(value));
  const { game } = createHarness({ context: recording.ctx, assetStore: missingStore });
  for (const card of BUILDINGS) {
    texts.length = 0;
    assert.equal(
      game.drawCardArtwork(recording.ctx, card, { x: 0, y: 0, w: 78, h: 78 }),
      false,
    );
    assert.equal(texts.includes(game.cardGlyph(card)), false, card.id);
  }
});

test('all building previews stay on one tile, use formal art, and expose no rotation UI', () => {
  const validTile = { key: 'tile-placement-valid' };
  const invalidTile = { key: 'tile-placement-invalid' };
  const buildingArt = new Map(BUILDINGS.map((card) => [card.id, {
    key: card.id,
    naturalWidth: 512,
    naturalHeight: 512,
  }]));
  const store = createReadyAssetStore(new Map([
    [validTile.key, validTile],
    [invalidTile.key, invalidTile],
    ...buildingArt,
  ]));
  const recording = createRecordingContext();
  const scales = [];
  recording.ctx.scale = (x, y) => scales.push([x, y]);
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  game.state.phase = 'build';
  game.state.buildings = [];
  game.hoverCell = { x: 14, y: 4 };

  for (const card of BUILDINGS) {
    recording.calls.length = 0;
    scales.length = 0;
    game.hits = [];
    game.selection = { kind: 'place-building', cardId: card.id, rotation: 0 };
    game.drawSelectionOverlay(recording.ctx);

    const footprintCalls = recording.calls.filter((call) => (
      call[0] === 'drawImage' && (call[1] === validTile || call[1] === invalidTile)
    ));
    assert.equal(footprintCalls.length, 1, `${card.id} must preview exactly one occupied tile`);
    assert.ok(
      recording.calls.some((call) => call[0] === 'drawImage' && call[1] === buildingArt.get(card.id)),
      `${card.id} preview should use its formal PNG`,
    );
    assert.ok(scales.some(([x, y]) => (
      Math.abs(x - 60 / 115) < 1e-9 && Math.abs(y - 60 / 115) < 1e-9
    )), `${card.id} preview must use the 60px slot`);

    recording.calls.length = 0;
    game.drawBuildSide(recording.ctx);
    assert.ok(
      recording.calls.some((call) => call[0] === 'drawImage' && call[1] === buildingArt.get(card.id)),
      `${card.id} right-side details should use its formal PNG`,
    );
    assert.equal(game.hits.some(({ id }) => id === 'rotate-new'), false, card.id);
  }
});

test('single-cell buildings ignore rotation and legacy saved directions normalize to zero', () => {
  const { game, storage } = createHarness();
  game.save();
  const storageKey = storage.keys().next().value;
  storage.set(storageKey, JSON.stringify({
    softCrystals: 160,
    tutorialSeen: true,
    buildings: [
      { cardId: 'building-bouncy-fence', x: 4, y: 3, rotation: 90, hp: 200, maxHp: 340 },
      { cardId: 'building-honey-plot', x: 1, y: 1, rotation: 90, hp: 150, maxHp: 150 },
    ],
  }));

  game.load();

  const fence = game.state.buildings.find(({ cardId }) => cardId === 'building-bouncy-fence');
  const plot = game.state.buildings.find(({ cardId }) => cardId === 'building-honey-plot');
  assert.equal(fence.rotation, 0);
  assert.equal(plot.rotation, 0);

  game.state.phase = 'build';
  for (const building of [fence, plot]) {
    game.selection = { kind: 'inspect-building', uid: building.uid };
    game.hits = [];
    game.drawBuildSide(game.ctx);
    assert.equal(game.hits.some(({ id }) => id === 'rotate-building'), false, building.cardId);
    game.rotateSelection();
    assert.deepEqual(game.selection, { kind: 'inspect-building', uid: building.uid });

    game.selection = { kind: 'move-building', uid: building.uid, rotation: 0 };
    game.hits = [];
    game.drawBuildSide(game.ctx);
    assert.equal(game.hits.some(({ id }) => id === 'rotate-move'), false, building.cardId);
    game.rotateSelection();
    assert.equal(game.selection.rotation, 0);
  }

  game.save();
  const resaved = JSON.parse(storage.get(storageKey));
  assert.ok(resaved.buildings.every(({ rotation }) => rotation === 0));
});

test('warehouse material counters use the three authored resource tokens', () => {
  const keys = [
    'resource-soft-gel-token',
    'resource-dew-honey-token',
    'resource-crystal-shard-token',
  ];
  const assets = Object.fromEntries(keys.map((key) => [key, { key, width: 128, height: 128 }]));
  const store = createReadyAssetStore(assets);
  const recording = createRecordingContext();
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  game.state.phase = 'build';
  game.selection = null;

  game.drawBuildSide(recording.ctx);

  for (const key of keys) {
    assert.ok(store.requests.includes(key), `warehouse should request ${key}`);
    assert.ok(
      recording.calls.some(([name, asset]) => name === 'drawImage' && asset === assets[key]),
      `warehouse should draw ${key}`,
    );
  }
});

test('selected world POIs reuse the friendly authored selection ring', () => {
  const key = 'effect-selection-ring-friendly';
  const ring = { key, width: 512, height: 256 };
  const frameKey = 'nest-soft-rift-frame-a';
  const frame = { key: frameKey, width: 512, height: 512 };
  const store = createReadyAssetStore({ [key]: ring, [frameKey]: frame });
  const recording = createRecordingContext();
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  const site = {
    id: 'selected-nest',
    kind: 'nest',
    x: 8,
    y: 6,
    zoneKind: 'gel-garden',
    cleared: false,
  };
  game.state.worldExpedition = {
    status: 'choose-site',
    targetPoiId: site.id,
    sites: [site],
  };

  game.drawWorldPoiActor(recording.ctx, site);

  assert.ok(store.requests.includes(key));
  const ringIndex = recording.calls.findIndex(([name, asset]) => name === 'drawImage' && asset === ring);
  const frameIndex = recording.calls.findIndex(([name, asset]) => name === 'drawImage' && asset === frame);
  assert.ok(ringIndex >= 0);
  assert.ok(frameIndex > ringIndex, 'the selection ring should render behind the POI artwork');
  const ringCall = recording.calls[ringIndex];
  const frameCall = recording.calls[frameIndex];
  assert.ok(
    ringCall[4] >= frameCall[4] * 0.9 && ringCall[4] <= frameCall[4],
    'the ground ring should track the POI base width rather than its old centre radius',
  );
  assert.ok(
    ringCall[3] + ringCall[5] / 2 > frameCall[3] + frameCall[5] / 2,
    'the ring should sit at the POI base rather than across its centre',
  );
});

test('placement, danger rings, and combat statuses request their dedicated PNG layers', () => {
  const keys = [
    'tile-placement-valid', 'tile-placement-invalid',
    'effect-target-ring-danger', 'effect-selection-ring-friendly', 'effect-shield-dome',
    'effect-boss-acid-telegraph', 'effect-damage-cracks-overlay',
    'status-shield', 'status-heal', 'status-poison', 'status-marked',
    'status-stun', 'status-slow', 'status-bubble',
  ];
  const store = createReadyAssetStore(keys);
  const { game } = createHarness({ assetStore: store });
  game.state.phase = 'battle';

  const building = game.state.buildings[0];
  building.hp = building.maxHp / 2;
  building.shield = 10;
  building.poisoned = 1;
  game.drawBuildings(game.ctx, [building]);

  const survivor = game.state.survivors[0];
  survivor.shield = 20;
  survivor.seed = 1;
  game.drawUnits(game.ctx, [{ kind: 'survivor', entity: survivor, depth: 0 }]);

  game.spawnEnemy('enemy-acid-shell-king', 2);
  const boss = game.state.enemies.at(-1);
  boss.x = 14;
  boss.y = 8;
  boss.marked = true;
  boss.stagger = 0.5;
  boss.rooted = 0.5;
  boss.bubbleStatus = 0.5;
  boss.telegraph = 0.5;
  game.drawUnits(game.ctx, [{ kind: 'enemy', entity: boss, depth: 0 }]);

  game.state.phase = 'build';
  game.state.buildings = [];
  game.selection = {
    kind: 'place-building',
    cardId: 'building-bouncy-fence',
    rotation: 0,
  };
  game.hoverCell = { x: 14, y: 4 };
  game.drawSelectionOverlay(game.ctx);
  game.state.buildings = [building];
  building.x = 14;
  building.y = 4;
  game.drawSelectionOverlay(game.ctx);

  for (const key of keys.filter((key) => key !== 'effect-selection-ring-friendly')) {
    assert.ok(store.requests.includes(key), `expected generated layer request: ${key}`);
  }
  assert.equal(
    store.requests.includes('effect-selection-ring-friendly'),
    false,
    'a marked hostile must never receive the friendly selection ring',
  );
});

test('world effects render on their assigned layer and moving bubbles stay behind the moved unit', () => {
  const effectKeys = [
    'effect-spawn-rift-burst',
    'effect-heal-burst',
    'effect-building-destruction-puff',
    'effect-jelly-bounce-wave',
    'effect-soft-swap-arc',
    'effect-honey-draw-trail',
    'effect-particle-expanding-ring',
    'effect-particle-dust-puff',
  ];
  const store = createReadyAssetStore([...effectKeys, 'item-moving-bubble-world']);
  const { game } = createHarness({ assetStore: store });
  effectKeys.forEach((key, index) => {
    game.spawnWorldEffect(key, 100 + index, 200, 80, 50, 0.5, {
      layer: index % 2 === 0 ? 'back' : 'front',
    });
  });

  game.drawWorldEffects(game.ctx, 'back');
  game.drawWorldEffects(game.ctx, 'front');
  for (const key of effectKeys) {
    assert.ok(store.requests.includes(key), `expected world effect request: ${key}`);
  }

  game.state.phase = 'battle';
  const item = ITEMS.find((card) => card.id === 'item-moving-bubble');
  const survivor = game.state.survivors[0];
  game.selectCombatCard(item);
  game.handleBattleTarget({ x: survivor.x, y: survivor.y });
  game.drawMovingBubblePreview(game.ctx);
  assert.ok(store.requests.includes('item-moving-bubble-world'));
  game.handleBattleTarget({ x: 5, y: 5 });

  const moveEffect = game.state.worldEffects.find((effect) => (
    effect.assetKey === 'item-moving-bubble-world'
  ));
  assert.ok(moveEffect);
  assert.equal(moveEffect.layer, 'back');
  assert.deepEqual({ x: survivor.x, y: survivor.y }, { x: 5, y: 5 });
});

test('dynamic effect state validates coordinates and keeps the newest 96 effects', () => {
  const { game } = createHarness();
  assert.deepEqual(game.state.dynamicEffects, []);
  assert.equal(game.spawnDynamicEffect('impact', Number.NaN, 20), null);
  assert.equal(game.spawnDynamicEffect('impact', 20, Number.POSITIVE_INFINITY), null);
  assert.equal(game.state.dynamicEffects.length, 0);

  let newest = null;
  for (let index = 0; index < 110; index += 1) {
    newest = game.spawnDynamicEffect('impact', 100 + index, 200, {
      layer: index % 2 ? 'back' : 'front',
      seed: index,
      intensity: 0.8 + index / 100,
    });
  }

  assert.equal(game.state.dynamicEffects.length, 96);
  assert.equal(game.state.dynamicEffects.at(-1), newest);
  assert.equal(newest.kind, 'impact');
  assert.ok(newest.life > 0);
  assert.equal(newest.life, newest.maxLife);
});

test('dynamic effects advance on the animation clock, freeze while paused, and expire', () => {
  const { game } = createHarness();
  const effect = game.spawnDynamicEffect('enemy-pop', 320, 240, {
    duration: 0.18,
    layer: 'front',
    seed: 12,
  });
  const initialLife = effect.life;

  game.update(0.04);
  assert.ok(effect.life < initialLife, 'an active procedural effect should advance each frame');

  game.state.phase = 'battle';
  game.state.paused = true;
  game.spawnParticles(100, 100, '#fff', 1, 20);
  game.floatText(100, 100, '暂停', '#fff');
  game.shake = 0.4;
  game.state.survivors[0].hitFlash = 1;
  const pausedLife = effect.life;
  const pausedParticle = { ...game.state.particles.at(-1) };
  const pausedFloater = { ...game.state.floaters.at(-1) };
  game.update(0.08);
  assert.equal(effect.life, pausedLife, 'combat pause must freeze the shared animation clock');
  assert.deepEqual(game.state.particles.at(-1), pausedParticle, 'ballistic particles must freeze with the hit effect');
  assert.deepEqual(game.state.floaters.at(-1), pausedFloater, 'damage text must freeze with the hit effect');
  assert.equal(game.shake, 0.4, 'camera recoil must not finish while the game is paused');
  assert.equal(game.state.survivors[0].hitFlash, 1, 'hit flash must remain synchronized while paused');

  game.state.phase = 'build';
  game.state.paused = false;
  game.update(effect.life + 0.01);
  assert.ok(!game.state.dynamicEffects.includes(effect));
});

test('seven authored dynamic composites animate as the primary path without Canvas geometry', () => {
  const cases = [
    ['push', { dx: 78, dy: -16 }],
    ['heal', {}],
    ['spawn', { layer: 'back' }],
    ['trail', { dx: 150, dy: 0 }],
    ['swap', { dx: 130, dy: 55 }],
    ['building-destruction', {}],
    ['shield-break', {}],
  ];
  for (const [kind, options] of cases) {
    const recording = createDynamicEffectRecordingContext();
    const assetKey = AUTHORED_DYNAMIC_EFFECT_ASSET_BY_KIND[kind];
    const asset = { key: assetKey, width: 768, height: 512 };
    const store = createReadyAssetStore({ [assetKey]: asset });
    const { game } = createHarness({ context: recording.ctx, assetStore: store });
    const effect = game.spawnDynamicEffect(kind, 320, 240, {
      ...options,
      seed: 41,
      intensity: 1.1,
    });
    effect.life = effect.maxLife * 0.66;

    game.drawDynamicEffects(recording.ctx, effect.layer);
    const firstMotion = normalizedCallTrace(recording.calls, DYNAMIC_MOTION_METHODS);
    assert.equal(
      recording.calls.filter(([name, image]) => name === 'drawImage' && image === asset).length,
      1,
      `${kind} should draw its authored composite once`,
    );
    assert.equal(
      recording.calls.some(([name]) => DYNAMIC_GEOMETRY_METHODS.has(name)),
      false,
      `${kind} should not mix Canvas geometry into a successful authored draw`,
    );
    assert.equal(store.requests.includes(DYNAMIC_COMPONENT_ATLAS_KEY), false);

    recording.calls.length = 0;
    effect.life = effect.maxLife * 0.42;
    game.drawDynamicEffects(recording.ctx, effect.layer);
    const secondMotion = normalizedCallTrace(recording.calls, DYNAMIC_MOTION_METHODS);
    assert.notDeepEqual(secondMotion, firstMotion, `${kind} should scale or rotate with progress`);
  }
});

test('dynamic effects fall back to independently animated atlas components when authored composites fail', () => {
  DYNAMIC_EFFECT_CASES.forEach(([kind, options], index) => {
    const recording = createDynamicEffectRecordingContext();
    const store = createDynamicAtlasStore();
    const { game } = createHarness({ context: recording.ctx, assetStore: store });
    const effect = game.spawnDynamicEffect(kind, 180 + index * 80, 260, {
      ...options,
      seed: 30 + index,
      color: '#65CBE4',
      accent: '#FFF8E9',
    });
    effect.life = effect.maxLife * 0.55;

    game.drawDynamicEffects(recording.ctx, effect.layer);
    const firstImages = recording.calls.filter(([name]) => name === 'drawImage');
    const firstMotion = normalizedCallTrace(recording.calls, DYNAMIC_MOTION_METHODS);
    assert.ok(firstImages.length >= 2, `${kind} should draw multiple independent atlas cells`);
    assert.ok(
      store.requests.includes(DYNAMIC_COMPONENT_ATLAS_KEY),
      `${kind} should request the dynamic component atlas`,
    );

    recording.calls.length = 0;
    game.update(effect.maxLife * 0.12);
    game.drawDynamicEffects(recording.ctx, effect.layer);
    const secondImages = recording.calls.filter(([name]) => name === 'drawImage');
    const secondMotion = normalizedCallTrace(recording.calls, DYNAMIC_MOTION_METHODS);
    assert.ok(secondImages.length >= 2, `${kind} should keep multiple atlas cells alive on its next frame`);
    assert.equal(
      secondImages.length,
      firstImages.length,
      `${kind} comparison frames should contain the same components so motion cannot pass by count alone`,
    );
    assert.notDeepEqual(
      secondMotion,
      firstMotion,
      `${kind} atlas cells should independently translate, rotate, scale, or resize between frames`,
    );
    const authoredKey = AUTHORED_DYNAMIC_EFFECT_ASSET_BY_KIND[kind];
    if (authoredKey) {
      assert.ok(
        store.requests.includes(authoredKey),
        `${kind} should try its authored composite before the component fallback`,
      );
    }
  });
});

test('all dynamic effect families retain changing procedural geometry when authored art and atlas fail', () => {
  DYNAMIC_EFFECT_CASES.forEach(([kind, options], index) => {
    const recording = createDynamicEffectRecordingContext();
    const store = createReadyAssetStore([]);
    const { game } = createHarness({ context: recording.ctx, assetStore: store });
    const effect = game.spawnDynamicEffect(kind, 180 + index * 80, 260, {
      ...options,
      seed: 60 + index,
      color: '#65CBE4',
      accent: '#FFF8E9',
    });
    effect.life = effect.maxLife * 0.55;

    game.drawDynamicEffects(recording.ctx, effect.layer);
    const firstGeometry = normalizedCallTrace(recording.calls, DYNAMIC_GEOMETRY_METHODS);
    assert.ok(firstGeometry.length >= 3, `${kind} fallback should contain multiple procedural parts`);
    assert.equal(
      recording.calls.some(([name]) => name === 'drawImage'),
      false,
      `${kind} fallback must not require a bitmap`,
    );

    recording.calls.length = 0;
    game.update(effect.maxLife * 0.12);
    game.drawDynamicEffects(recording.ctx, effect.layer);
    const secondGeometry = normalizedCallTrace(recording.calls, DYNAMIC_GEOMETRY_METHODS);
    assert.notDeepEqual(secondGeometry, firstGeometry, `${kind} fallback geometry should move between frames`);
    assert.equal(recording.calls.some(([name]) => name === 'drawImage'), false);
    assert.ok(
      store.requests.includes(DYNAMIC_COMPONENT_ATLAS_KEY),
      `${kind} should safely attempt the shared atlas before falling back`,
    );
    const authoredKey = AUTHORED_DYNAMIC_EFFECT_ASSET_BY_KIND[kind];
    if (authoredKey) {
      assert.ok(store.requests.includes(authoredKey));
    }
  });
});

test('enemy-pop reveals fewer atlas components on its first frame than during the burst', () => {
  const recording = createDynamicEffectRecordingContext();
  const store = createDynamicAtlasStore();
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  const effect = game.spawnDynamicEffect('enemy-pop', 320, 240, { seed: 19, intensity: 1 });

  game.drawDynamicEffects(recording.ctx, 'front');
  const initialImages = recording.calls.filter(([name]) => name === 'drawImage').length;

  recording.calls.length = 0;
  game.update(effect.maxLife * 0.35);
  game.drawDynamicEffects(recording.ctx, 'front');
  const burstImages = recording.calls.filter(([name]) => name === 'drawImage').length;
  assert.ok(
    initialImages < burstImages,
    `enemy-pop should stagger atlas cells (${initialImages} initially, ${burstImages} during burst)`,
  );
  assert.ok(store.requests.includes(DYNAMIC_COMPONENT_ATLAS_KEY));
  for (const authoredKey of AUTHORED_DYNAMIC_EFFECT_KEYS) {
    assert.equal(store.requests.includes(authoredKey), false);
  }
});

test('dense kill chains cap illustrated components at 64 and reserve room for wave-clear art', () => {
  const recording = createDynamicEffectRecordingContext();
  const store = createDynamicAtlasStore();
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  const addEffect = (kind, options, count) => {
    for (let index = 0; index < count; index += 1) {
      const effect = game.spawnDynamicEffect(kind, 260 + index * 4, 250 + index * 2, {
        ...options,
        seed: 300 + index,
        color: '#65CBE4',
        accent: '#FFF8E9',
      });
      effect.life = effect.maxLife * 0.55;
    }
  };

  addEffect('impact', {}, 14);
  addEffect('enemy-pop', {}, 7);
  addEffect('push', { dx: 78, dy: -16 }, 6);
  addEffect('wave-clear', {}, 1);
  game.resetDynamicComponentBudget();
  game.drawDynamicEffects(recording.ctx, 'front');

  const atlasDraws = recording.calls.filter(([name, asset]) => (
    name === 'drawImage' && asset?.key === DYNAMIC_COMPONENT_ATLAS_KEY
  ));
  assert.ok(atlasDraws.length <= 64, `expected at most 64 atlas draws, got ${atlasDraws.length}`);
  assert.equal(game.dynamicComponentDrawCount, atlasDraws.length);
  assert.ok(
    atlasDraws.some(([, , , sourceY]) => sourceY >= 1254 * 0.75),
    'reserved component slots should keep the wave-clear ribbon and confetti row visible',
  );
});

test('priority-two effects cannot consume the wave-clear-only component reserve', () => {
  const recording = createDynamicEffectRecordingContext();
  const store = createDynamicAtlasStore();
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  const addAtProgress = (kind, count) => {
    for (let index = 0; index < count; index += 1) {
      const effect = game.spawnDynamicEffect(kind, 280 + index * 3, 250, {
        seed: 500 + index,
        color: '#65CBE4',
        accent: '#FFF8E9',
      });
      effect.life = effect.maxLife * 0.8;
    }
  };

  addAtProgress('impact', 24);
  addAtProgress('heal', 2);
  addAtProgress('wave-clear', 1);
  game.resetDynamicComponentBudget();
  game.drawDynamicEffects(recording.ctx, 'front');

  const atlasDraws = recording.calls.filter(([name, asset]) => (
    name === 'drawImage' && asset?.key === DYNAMIC_COMPONENT_ATLAS_KEY
  ));
  assert.ok(atlasDraws.length <= 64);
  assert.ok(
    atlasDraws.some(([, , , sourceY]) => sourceY >= 1254 * 0.75),
    'wave-clear should retain ribbon/confetti cells after earlier heal effects use their reserve',
  );
});

test('failed atlas drawImage calls do not consume the next component budget', () => {
  const recording = createRecordingContext({ throwOnDrawImage: true });
  const store = createDynamicAtlasStore();
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  const effect = game.spawnDynamicEffect('impact', 320, 240, { seed: 91 });
  effect.life = effect.maxLife * 0.55;
  game.resetDynamicComponentBudget();

  assert.doesNotThrow(() => game.drawDynamicEffects(recording.ctx, 'front'));
  assert.equal(game.dynamicComponentDrawCount, 0);
  assert.equal(game.dynamicComponentGeneralRemaining, 48);
});

test('enemy hits and deaths emit distinct procedural impact and pop effects', () => {
  const { game } = createHarness();
  game.spawnEnemy('enemy-soft-biter', 2);
  const enemy = game.state.enemies.at(-1);
  game.state.dynamicEffects = [];

  const crystal = game.state.survivors.find(({ cardId }) => cardId === 'survivor-crystal-pin');
  game.damageEnemy(enemy, 1, crystal);
  const impact = game.state.dynamicEffects.find(({ kind }) => kind === 'impact');
  assert.ok(impact);
  assert.equal(impact.color, SURVIVORS.find(({ id }) => id === crystal.cardId).color);
  assert.equal(game.state.dynamicEffects.some(({ kind }) => kind === 'enemy-pop'), false);

  const beforeDeath = game.state.dynamicEffects.length;
  game.damageEnemy(enemy, enemy.hp, null);
  const deathEffects = game.state.dynamicEffects.slice(beforeDeath);
  assert.ok(deathEffects.some(({ kind }) => kind === 'enemy-pop'));
});

test('destroyed buildings use their authored destruction effect instead of enemy-pop', () => {
  const assetKey = 'effect-building-destruction-puff';
  const asset = { key: assetKey, width: 512, height: 512 };
  const store = createReadyAssetStore({ [assetKey]: asset });
  const recording = createDynamicEffectRecordingContext();
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  const building = game.state.buildings[0];
  game.state.dynamicEffects = [];

  assert.equal(game.damageBuilding(building, building.hp + 1), true);
  const effect = game.state.dynamicEffects.find(({ kind }) => kind === 'building-destruction');
  assert.ok(effect);
  assert.equal(game.state.dynamicEffects.some(({ kind }) => kind === 'enemy-pop'), false);
  effect.life = effect.maxLife * 0.55;
  game.drawDynamicEffects(recording.ctx, effect.layer);

  assert.ok(store.requests.includes(assetKey));
  assert.ok(recording.calls.some(([name, image]) => name === 'drawImage' && image === asset));
});

test('shield depletion emits one authored break burst with segmented opacity', () => {
  const assetKey = 'effect-shield-break-v1';
  const asset = { key: assetKey, width: 512, height: 512 };
  const store = createReadyAssetStore({ [assetKey]: asset });
  const recording = createDynamicEffectRecordingContext();
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  const survivor = game.state.survivors.find(({ cardId }) => cardId !== 'survivor-shell-shell');
  game.state.buildings = [];
  game.state.dynamicEffects = [];
  survivor.shield = 12;
  const hpBefore = survivor.hp;

  game.damageSurvivor(survivor, 5);
  assert.equal(survivor.shield, 7);
  assert.equal(game.state.dynamicEffects.some(({ kind }) => kind === 'shield-break'), false);

  game.damageSurvivor(survivor, 7);
  assert.equal(survivor.shield, 0);
  assert.equal(survivor.hp, hpBefore, 'the breaking hit should remain fully absorbed');
  const breakEffects = game.state.dynamicEffects.filter(({ kind }) => kind === 'shield-break');
  assert.equal(breakEffects.length, 1);
  const effect = breakEffects[0];

  effect.life = effect.maxLife * 0.7;
  recording.ctx.globalAlpha = 1;
  game.drawDynamicEffects(recording.ctx, effect.layer);
  const heldAlpha = recording.ctx.globalAlpha;
  assert.ok(store.requests.includes(assetKey));
  assert.ok(recording.calls.some(([name, image]) => name === 'drawImage' && image === asset));

  recording.calls.length = 0;
  effect.life = effect.maxLife * 0.1;
  recording.ctx.globalAlpha = 1;
  game.drawDynamicEffects(recording.ctx, effect.layer);
  assert.ok(recording.ctx.globalAlpha < heldAlpha, 'the final opacity segment should fade out');

  game.damageSurvivor(survivor, 1);
  assert.equal(
    game.state.dynamicEffects.filter(({ kind }) => kind === 'shield-break').length,
    1,
    'later health damage must not retrigger a depleted shield',
  );
});

test('enemy pushes emit a directional trail and collisions add a stronger impact', () => {
  const { game } = createHarness();
  game.spawnEnemy('enemy-soft-biter', 2);
  game.spawnEnemy('enemy-soft-biter', 2);
  const [pushed, blocker] = game.state.enemies.slice(-2);
  pushed.x = 2;
  pushed.y = 2;
  blocker.x = 3;
  blocker.y = 2;
  game.state.dynamicEffects = [];

  assert.equal(game.pushEnemy(pushed, 1, 0, {
    maxPushWeight: 1,
    collisionDamage: 4,
  }), true);
  const push = game.state.dynamicEffects.find(({ kind }) => kind === 'push');
  assert.ok(push);
  assert.ok(push.dx > 0);
  assert.equal(push.dy, 0);
  assert.ok(
    game.state.dynamicEffects.some(({ kind, intensity }) => (
      kind === 'impact' && intensity > 1
    )),
    'a body collision should add a visibly stronger impact than a routine hit',
  );
});

test('shell impacts use the generated goo-drop particle without recoloring unrelated particles', () => {
  const store = createReadyAssetStore(['effect-particle-goo-drop']);
  const { game } = createHarness({ assetStore: store });
  game.spawnEnemy('enemy-soft-biter', 2);
  const enemy = game.state.enemies.at(-1);
  const shell = game.state.survivors.find((survivor) => (
    survivor.cardId === 'survivor-shell-shell'
  ));

  game.damageEnemy(enemy, 1, shell);
  assert.equal(game.state.particles.at(-1).assetKey, 'effect-particle-goo-drop');
  game.drawProjectilesAndParticles(game.ctx);
  assert.ok(store.requests.includes('effect-particle-goo-drop'));
});

test('game routes world, UI, projectile, status, and particle slots through the PNG store', () => {
  const keys = [
    'terrain-ground-detail-a', 'terrain-soft-gel-node-a', 'terrain-dew-honey-node-a',
    'terrain-crystal-shard-node-a', 'terrain-brittle-boulder-a',
    'tile-honey-puddle', 'tile-crystal-spikes',
    'tile-building-rubble', 'building-mushroom-home', 'building-honey-plot',
    'building-bubble-tower', 'building-bouncy-fence', 'building-weather-scout',
    'building-gel-foundation',
    'town-soft-core', 'rift-entry-portal', 'item-spring-pad-world', 'item-lure-jelly-world',
    'background-garden-base', 'background-cloud-overlay', 'background-foreground-grass',
    'effect-projectile-goo', 'effect-projectile-needle', 'effect-projectile-bubble',
    'effect-projectile-seed', 'effect-projectile-acid',
    'effect-particle-goo-drop', 'effect-particle-healing-leaf',
    'effect-particle-bubble', 'effect-particle-impact-spark',
    'status-heal', 'status-marked', 'status-sticky', 'status-stun',
    'ui-soft-crystal', 'ui-gel-energy', 'ui-card-frame-common', 'ui-card-frame-item',
    'ui-audio-on', 'ui-audio-off',
    ...SURVIVORS.map((card) => card.id),
    ...Object.keys(ENEMY_BY_ID),
    ...SKILLS.map((card) => `${card.id}-icon`),
    ...ITEMS.map((card) => `${card.id}-icon`),
  ];
  const store = createReadyAssetStore(keys);
  const recording = createRecordingContext();
  const { game } = createHarness({ context: recording.ctx, assetStore: store });

  game.drawBackground(recording.ctx);
  game.drawForeground(recording.ctx);
  game.drawBattlefield(recording.ctx);
  const baseCamera = { ...game.camera };
  game.camera = { x: 0, y: 0, zoom: 1 };
  game.drawBattlefield(recording.ctx);
  game.camera = baseCamera;
  game.state.phase = 'battle';
  game.state.buildings[0].destroyed = true;
  game.drawBuildings(recording.ctx);
  game.state.terrain = [
    { type: 'honey', x: 10, y: 7 },
    { type: 'crystal', x: 11, y: 7 },
  ];
  game.drawTerrain(recording.ctx);
  game.state.deployables = [
    { type: 'pad', x: 10, y: 7, dx: 1, dy: 0 },
    { type: 'lure', x: 11, y: 7 },
  ];
  game.drawDeployables(recording.ctx);
  game.state.projectiles = [
    { type: 'goo', progress: 0.5, from: { x: 0, y: 0 }, to: { x: 20, y: 20 } },
    { type: 'crystal', progress: 0.5, from: { x: 0, y: 0 }, to: { x: 20, y: 20 } },
    { type: 'bubble', progress: 0.5, from: { x: 0, y: 0 }, to: { x: 20, y: 20 } },
    { type: 'seed', progress: 0.5, from: { x: 0, y: 0 }, to: { x: 20, y: 20 } },
    { type: 'acid', progress: 0.5, from: { x: 0, y: 0 }, to: { x: 20, y: 20 } },
  ];
  game.state.particles = [
    { x: 0, y: 0, size: 4, life: 1, maxLife: 1, color: '#unknown' },
    { x: 0, y: 0, size: 4, life: 1, maxLife: 1, color: PALETTE.heal },
    { x: 0, y: 0, size: 4, life: 1, maxLife: 1, color: PALETTE.bubble },
    { x: 0, y: 0, size: 4, life: 1, maxLife: 1, color: PALETTE.crystal },
  ];
  game.drawProjectilesAndParticles(recording.ctx);
  drawParticle(recording.ctx, 0, 0, 12, 'goo', { assetStore: store, progress: 0.5 });
  game.drawTopHud(recording.ctx);
  game.audio.enabled = false;
  game.drawTopHud(recording.ctx);
  game.drawCombatCards(recording.ctx);
  game.state.phase = 'build';
  game.buildTab = 'buildings';
  game.drawBuildCards(recording.ctx);
  game.buildTab = 'survivors';
  game.drawBuildCards(recording.ctx);
  game.drawIntelModal(recording.ctx);
  for (const type of ['heal', 'marked', 'sticky', 'stun']) {
    drawStatusIcon(recording.ctx, 0, 0, 22, type, { assetStore: store });
  }

  for (const key of keys) {
    assert.ok(store.requests.includes(key), `expected generated asset request: ${key}`);
  }
});

test('starts an active wave only after the explicit start action', () => {
  const { game } = createHarness();
  assert.equal(game.state.phase, 'build');
  assert.equal(game.state.enemies.length, 0);
  game.openIntel();
  assert.equal(game.state.enemies.length, 0);
  game.beginDefense();
  for (let index = 0; index < 4; index += 1) game.update(0.05);
  assert.equal(game.state.waveIndex, 0);
  assert.equal(game.state.spawnQueue.length, WAVES[0].groups[0].count);
  assert.ok(game.state.enemies.length >= 1);
});

test('targeting a skill pauses, consumes energy, and restores the previous pause state', () => {
  const { game } = createHarness();
  game.openIntel();
  game.beginDefense();
  for (let index = 0; index < 3; index += 1) game.update(0.05);
  const enemy = game.state.enemies[0];
  enemy.x = 4;
  enemy.y = 2;
  const skill = SKILLS.find((card) => card.id === 'skill-jelly-bounce');
  const beforeEnergy = game.state.energy;
  game.selectCombatCard(skill);
  assert.equal(game.state.paused, true);
  game.handleBattleTarget({ x: 4, y: 2 });
  assert.equal(game.state.energy, beforeEnergy - skill.energy);
  assert.equal(game.state.paused, false);
  assert.equal(game.selection, null);
  assert.ok(enemy.x > 4);
});

test('two-step spring pad targeting uses one charge and records its direction', () => {
  const { game } = createHarness();
  game.openIntel();
  game.beginDefense();
  const item = ITEMS.find((card) => card.id === 'item-spring-pad');
  game.selectCombatCard(item);
  game.handleBattleTarget({ x: 2, y: 2 });
  assert.equal(game.selection.step, 1);
  game.handleBattleTarget({ x: 3, y: 2 });
  assert.equal(game.state.items[item.id].charges, item.charges - 1);
  assert.deepEqual(
    Object.fromEntries(Object.entries(game.state.deployables[0]).filter(([key]) => ['type', 'x', 'y', 'dx', 'dy'].includes(key))),
    { type: 'pad', x: 2, y: 2, dx: 1, dy: 0 },
  );
});

test('saving during combat preserves the safe pre-battle layout', () => {
  const { game, storage } = createHarness();
  game.openIntel();
  game.beginDefense();
  const originalCount = game.state.buildings.length;
  game.state.buildings[0].destroyed = true;
  game.save();
  const saved = JSON.parse(storage.values().next().value);
  assert.equal(saved.buildings.length, originalCount);
});

test('all survivor and enemy cards resolve to their rig clip collections', () => {
  const { game } = createHarness();
  const expected = {
    'survivor-shell-shell': SHELL_CLIPS,
    'survivor-crystal-pin': CRYSTAL_CLIPS,
    'survivor-bubble-float': BUBBLE_CLIPS,
    'survivor-moss-sprout': SPROUT_CLIPS,
    'enemy-soft-biter': BUG_CLIPS,
    'enemy-windcap': WINDCAP_CLIPS,
    'enemy-stone-lump': STONE_CLIPS,
    'enemy-acid-shell-king': BOSS_CLIPS,
  };

  for (const [cardId, clips] of Object.entries(expected)) {
    assert.equal(game.animationClipsFor(cardId), clips, `${cardId} should use its own clips`);
  }
  assert.equal(game.animationClipsFor('unknown-card'), null);
});

test('all survivor rigs resolve damage, hurt, and hit particles at the attack hit event', () => {
  const survivorIds = [
    'survivor-shell-shell',
    'survivor-crystal-pin',
    'survivor-bubble-float',
    'survivor-moss-sprout',
  ];

  for (const cardId of survivorIds) {
    const { game } = createHarness();
    const survivor = game.state.survivors.find((candidate) => candidate.cardId === cardId);
    game.spawnEnemy('enemy-soft-biter', survivor.y);
    const enemy = game.state.enemies.at(-1);
    enemy.x = survivor.x + 0.6;
    enemy.y = survivor.y;
    const hpBefore = enemy.hp;
    const particlesBefore = game.state.particles.length;
    const hitTime = game.animationClipsFor(cardId).attack.events.find((event) => event.name === 'hit').time;

    assert.equal(game.performSurvivorAction(survivor), true, `${cardId} should find a target`);
    assert.equal(enemy.hp, hpBefore, `${cardId} damage must wait for its hit pose`);
    assert.equal(game.animators.get(survivor.uid)?.controller.current, 'attack');
    assert.notEqual(game.animators.get(enemy.uid)?.controller.current, 'hurt');

    game.updateEntityAnimations(hitTime - 0.01);
    assert.equal(enemy.hp, hpBefore, `${cardId} must not deal damage before its hit event`);
    assert.equal(game.state.particles.length, particlesBefore, 'hit particles must also wait for impact');

    game.updateEntityAnimations(0.02);
    assert.ok(enemy.hp < hpBefore, `${cardId} damage should resolve when the hit event fires`);
    assert.equal(game.animators.get(enemy.uid)?.controller.current, 'hurt');
    assert.ok(game.state.particles.length > particlesBefore, 'impact should create hit particles');
    const hpAfterHit = enemy.hp;
    game.updateEntityAnimations(game.animationClipsFor(cardId).attack.duration);
    assert.equal(enemy.hp, hpAfterHit, 'a drained hit event must settle exactly once');

    game.damageSurvivor(survivor, survivor.maxHp * 2);
    assert.equal(survivor.downed, true);
    assert.equal(game.animators.get(survivor.uid)?.controller.current, 'downed');
  }
});

test('sprout healing dispatches its attack clip as a cast animation', () => {
  const { game } = createHarness();
  const sprout = game.state.survivors.find((survivor) => survivor.cardId === 'survivor-moss-sprout');
  const ally = game.state.survivors.find((survivor) => survivor.cardId === 'survivor-crystal-pin');
  const sproutCard = SURVIVORS.find((card) => card.id === sprout.cardId);
  const actionsRequired = sproutCard.ability.actionsRequired;
  sprout.actionCount = actionsRequired - 1;
  ally.hp = Math.floor(ally.maxHp / 2);
  ally.x = sprout.x + 1;
  ally.y = sprout.y;
  const hpBefore = ally.hp;

  assert.equal(game.performSurvivorAction(sprout), true);
  assert.ok(ally.hp > hpBefore, 'healing should remain immediate');
  assert.equal(sprout.actionCount, actionsRequired);
  assert.equal(game.animators.get(sprout.uid)?.controller.current, 'attack');
});

test('all enemy rigs resolve attack damage at their hit event, then still hurt and die normally', () => {
  const enemyIds = [
    'enemy-soft-biter',
    'enemy-windcap',
    'enemy-stone-lump',
    'enemy-acid-shell-king',
  ];

  for (const enemyId of enemyIds) {
    const { game } = createHarness();
    game.state.phase = 'battle';
    game.spawnEnemy(enemyId, 0);
    const enemy = game.state.enemies.at(-1);
    enemy.x = COLONY_WORLD.base.core.x;
    enemy.y = COLONY_WORLD.base.core.y;
    enemy.path = [
      { ...COLONY_WORLD.base.core },
      { x: COLONY_WORLD.base.core.x - 1, y: COLONY_WORLD.base.core.y },
    ];
    enemy.routeTimer = 1;
    const coreBefore = game.state.coreHp;
    const hitTime = game.animationClipsFor(enemyId).attack.events.find((event) => event.name === 'hit').time;

    game.updateEnemies(0.01);
    assert.equal(game.state.coreHp, coreBefore, `${enemyId} damage must wait for its hit pose`);
    assert.equal(game.animators.get(enemy.uid)?.controller.current, 'attack');

    game.updateEntityAnimations(hitTime - 0.01);
    assert.equal(game.state.coreHp, coreBefore, `${enemyId} must not damage the core before hit`);
    game.updateEntityAnimations(0.02);
    assert.ok(game.state.coreHp < coreBefore, `${enemyId} should damage the core on hit`);

    game.damageEnemy(enemy, 1, null);
    assert.equal(game.animators.get(enemy.uid)?.controller.current, 'hurt');
    game.damageEnemy(enemy, enemy.hp, null);
    assert.equal(enemy.dead, true);
    assert.equal(game.animators.get(enemy.uid)?.controller.current, 'death');
  }
});

test('boss charge is a base state that resumes after hurt and exits when interrupted', () => {
  const { game } = createHarness();
  game.spawnEnemy('enemy-acid-shell-king', 2);
  const boss = game.state.enemies.at(-1);
  const card = ENEMY_BY_ID[boss.cardId];
  boss.abilityTimer = 0;

  game.updateEnemyAbility(boss, card, 0.01);
  assert.ok(boss.telegraph > 0);
  game.updateEntityAnimations(0.01);
  let controller = game.animators.get(boss.uid)?.controller;
  assert.equal(controller.baseName, 'charge');
  assert.equal(controller.current, 'charge');

  game.damageEnemy(boss, 1, null);
  assert.equal(controller.current, 'hurt');
  for (let index = 0; index < 100 && controller.actionName; index += 1) {
    game.updateEntityAnimations(0.02);
  }
  assert.equal(controller.actionName, null);
  assert.equal(controller.current, 'charge', 'charge should resume after the hurt reaction');

  boss.stagger = 0.5;
  game.updateEnemyAbility(boss, card, 0.01);
  assert.equal(boss.telegraph, 0);
  assert.equal(boss.telegraphTarget, null);
  game.updateEntityAnimations(0);
  controller = game.animators.get(boss.uid)?.controller;
  assert.equal(controller.baseName, 'idle');
  assert.equal(controller.current, 'hurt', 'the interruption should show a recoil');
  for (let index = 0; index < 100 && controller.actionName; index += 1) {
    game.updateEntityAnimations(0.02);
  }
  assert.equal(controller.current, 'idle');
});

test('each enemy death uses its own visual lifetime for cleanup', () => {
  const durations = {
    'enemy-soft-biter': 0.4,
    'enemy-windcap': 0.38,
    'enemy-stone-lump': 0.42,
    'enemy-acid-shell-king': 0.68,
  };

  for (const [enemyId, duration] of Object.entries(durations)) {
    const { game } = createHarness();
    game.state.phase = 'battle';
    game.spawnEnemy(enemyId, 0);
    const enemy = game.state.enemies.at(-1);
    assert.equal(game.enemyDeathDuration(enemy), duration);
    game.damageEnemy(enemy, enemy.hp, null);

    game.updateEntityAnimations(duration * 0.9);
    game.updateEnemies(0);
    assert.ok(game.state.enemies.includes(enemy), `${enemyId} should remain during its death clip`);

    game.updateEntityAnimations(duration * 0.11);
    game.updateEnemies(0);
    assert.ok(!game.state.enemies.includes(enemy), `${enemyId} should clean up at its own duration`);
  }
});

test('shell attack impact pauses with the rig clock and resolves only after resuming', () => {
  const { game } = createHarness();
  const shell = game.state.survivors.find((survivor) => survivor.cardId === 'survivor-shell-shell');
  game.spawnEnemy('enemy-soft-biter', shell.y);
  const enemy = game.state.enemies.at(-1);
  enemy.x = shell.x + 0.65;
  enemy.y = shell.y;

  const hpBefore = enemy.hp;
  assert.equal(game.performSurvivorAction(shell), true);
  const projectile = game.state.projectiles.at(-1);
  const projectileProgress = projectile.progress;
  assert.equal(enemy.hp, hpBefore, 'damage should wait for the animation event');
  assert.equal(game.animators.get(shell.uid)?.controller.current, 'attack');

  game.state.phase = 'battle';
  game.state.paused = true;
  game.update(0.25);
  assert.equal(enemy.hp, hpBefore, 'pausing must also pause a queued attack impact');
  assert.ok(
    Math.abs(projectile.progress - projectileProgress) < 1e-12,
    'pausing must freeze projectile travel',
  );

  game.state.paused = false;
  game.selection = { kind: 'targeting-test' };
  game.update(0.25);
  assert.ok(
    Math.abs(projectile.progress - projectileProgress) < 1e-12,
    'targeting must freeze projectile travel',
  );

  game.selection = null;
  game.state.survivors.forEach((survivor) => { survivor.cooldown = 999; });
  game.state.buildings.forEach((building) => { building.cooldown = 999; });
  enemy.rooted = 999;
  game.update(0.01);
  assert.ok(projectile.progress > projectileProgress, 'projectile travel should resume with the rig');
  game.updateEntityAnimations(SHELL_CLIPS.attack.events[0].time + 0.01);
  assert.ok(enemy.hp < hpBefore, 'the queued impact should resolve after the hit event resumes');
  assert.equal(game.animators.get(enemy.uid)?.controller.current, 'hurt');

  game.damageEnemy(enemy, enemy.hp, shell);
  assert.equal(enemy.dead, true);
  assert.equal(game.animators.get(enemy.uid)?.controller.current, 'death');
  game.state.paused = true;
  game.update(0.25);
  assert.equal(enemy.deathElapsed, 0, 'death fade should share the paused rig clock');
});

test('a hurt reaction does not erase an attack that already committed to its hit timing', () => {
  const { game } = createHarness();
  const shell = game.state.survivors.find((survivor) => survivor.cardId === 'survivor-shell-shell');
  game.spawnEnemy('enemy-soft-biter', shell.y);
  const enemy = game.state.enemies.at(-1);
  enemy.x = shell.x + 0.65;
  enemy.y = shell.y;
  const hpBefore = enemy.hp;

  assert.equal(game.performSurvivorAction(shell), true);
  game.damageSurvivor(shell, 1);
  assert.equal(
    game.animators.get(shell.uid)?.controller.current,
    'attack',
    'nonlethal damage must not replace a committed attack',
  );
  game.updateEntityAnimations(SHELL_CLIPS.attack.events[0].time - 0.01);
  assert.equal(enemy.hp, hpBefore);
  game.updateEntityAnimations(0.02);

  assert.ok(enemy.hp < hpBefore);
  assert.equal(game.pendingAttackHits.has(shell.uid), false);
});

test('an interrupted attack cannot deal ghost damage without its attack.hit event', () => {
  const { game } = createHarness();
  const shell = game.state.survivors.find((survivor) => survivor.cardId === 'survivor-shell-shell');
  game.spawnEnemy('enemy-soft-biter', shell.y);
  const enemy = game.state.enemies.at(-1);
  enemy.x = shell.x + 0.65;
  enemy.y = shell.y;
  const hpBefore = enemy.hp;

  assert.equal(game.performSurvivorAction(shell), true);
  assert.equal(game.playEntityAnimation(shell, 'hurt'), true, 'the test interruption should replace attack');
  game.updateEntityAnimations(SHELL_CLIPS.attack.events[0].time + 0.05);

  assert.equal(enemy.hp, hpBefore, 'elapsed time alone must never resolve a queued impact');
  assert.equal(game.pendingAttackHits.has(shell.uid), false, 'an interrupted attack must be cancelled');
});

test('death and downed states immediately cancel committed attack impacts', () => {
  const survivorHarness = createHarness();
  const survivorGame = survivorHarness.game;
  const shell = survivorGame.state.survivors.find(
    (survivor) => survivor.cardId === 'survivor-shell-shell',
  );
  survivorGame.spawnEnemy('enemy-soft-biter', shell.y);
  const target = survivorGame.state.enemies.at(-1);
  target.x = shell.x + 0.65;
  target.y = shell.y;
  const targetHp = target.hp;

  assert.equal(survivorGame.performSurvivorAction(shell), true);
  survivorGame.damageSurvivor(shell, shell.maxHp * 2);
  assert.equal(shell.downed, true);
  assert.equal(survivorGame.pendingAttackHits.has(shell.uid), false);
  survivorGame.updateEntityAnimations(SHELL_CLIPS.attack.duration);
  assert.equal(target.hp, targetHp, 'a downed attacker must not finish its queued impact');

  const enemyHarness = createHarness();
  const enemyGame = enemyHarness.game;
  enemyGame.state.phase = 'battle';
  enemyGame.spawnEnemy('enemy-soft-biter', 0);
  const attacker = enemyGame.state.enemies.at(-1);
  attacker.x = COLONY_WORLD.base.core.x;
  attacker.y = COLONY_WORLD.base.core.y;
  attacker.path = [
    { ...COLONY_WORLD.base.core },
    { x: COLONY_WORLD.base.core.x - 1, y: COLONY_WORLD.base.core.y },
  ];
  attacker.routeTimer = 1;
  const coreHp = enemyGame.state.coreHp;

  enemyGame.updateEnemies(0.01);
  assert.equal(enemyGame.pendingAttackHits.has(attacker.uid), true);
  enemyGame.damageEnemy(attacker, attacker.hp, null);
  assert.equal(attacker.dead, true);
  assert.equal(enemyGame.pendingAttackHits.has(attacker.uid), false);
  enemyGame.updateEntityAnimations(BUG_CLIPS.attack.duration);
  assert.equal(enemyGame.state.coreHp, coreHp, 'a dead attacker must not finish its queued impact');
});

test('entity expression mixers follow attacks and reactions with real slot cross-fades', () => {
  const { game } = createHarness();
  const shell = game.state.survivors.find(
    (survivor) => survivor.cardId === 'survivor-shell-shell',
  );

  game.updateEntityAnimations(0);
  assert.equal(game.entityExpressionSample(shell).to, 'normal');

  assert.equal(game.playEntityAnimation(shell, 'attack'), true);
  game.updateEntityAnimations(DEFAULT_EXPRESSION_TRANSITION_DURATION / 2);
  const attacking = game.entityExpressionSample(shell);
  assert.equal(attacking.from, 'normal');
  assert.equal(attacking.to, 'attack');
  assert.equal(attacking.mix, 0.5);
  assert.deepEqual(attacking.slots.eyes.weights, { from: 0.5, to: 0.5 });
  assert.deepEqual(attacking.slots.mouth.weights, { from: 0.5, to: 0.5 });

  game.updateEntityAnimations(DEFAULT_EXPRESSION_TRANSITION_DURATION / 2);
  assert.equal(game.entityExpressionSample(shell).from, 'attack');
  assert.equal(game.entityExpressionSample(shell).to, 'attack');

  game.damageSurvivor(shell, 1);
  game.updateEntityAnimations(0.12);
  assert.equal(game.entityExpressionSample(shell).to, 'hurt');

  game.damageSurvivor(shell, shell.hp);
  game.updateEntityAnimations(0.12);
  assert.equal(game.entityExpressionSample(shell).to, 'hurt');
});

test('idle expressions blink on a stable clock and freeze together with paused rigs', () => {
  const { game } = createHarness();
  const shell = game.state.survivors.find(
    (survivor) => survivor.cardId === 'survivor-shell-shell',
  );
  let blinkSample = null;
  for (let step = 0; step < 80; step += 1) {
    game.updateEntityAnimations(0.05);
    const sample = game.entityExpressionSample(shell);
    if (sample.to === 'blink') {
      blinkSample = sample;
      break;
    }
  }
  assert.ok(blinkSample, 'idle should reach the owner-staggered blink state');

  game.state.phase = 'battle';
  game.state.paused = true;
  const frozen = game.entityExpressionSample(shell);
  const frozenAnimationTime = game.animationTime;
  game.time += 10;
  game.update(0.25);
  assert.equal(game.animationTime, frozenAnimationTime, 'the animation clock must stop while paused');
  assert.deepEqual(game.entityExpressionSample(shell), frozen);
});

test('battle pause freezes entity rig time', () => {
  const { game } = createHarness();
  const shell = game.state.survivors.find((survivor) => survivor.cardId === 'survivor-shell-shell');
  game.playEntityAnimation(shell, 'attack');
  game.updateEntityAnimations(0.12);
  const poseBeforePause = game.entityAnimationPose(shell);

  game.state.phase = 'battle';
  game.state.paused = true;
  game.update(0.25);

  assert.deepEqual(game.entityAnimationPose(shell), poseBeforePause);
});

test('the autonomous colony defeats repeated weakened swarms without entering a manual wave flow', () => {
  const { game } = createHarness();
  game.state.colonyDirector.nextPackAt = 0;
  let steps = 0;
  let peakLivingEnemies = 0;
  while ((game.state.colonyDirector.packIndex < 2 || game.state.kills < 6) && steps < 1400) {
    game.update(0.05);
    peakLivingEnemies = Math.max(
      peakLivingEnemies,
      game.state.enemies.filter((enemy) => !enemy.dead).length,
    );
    steps += 1;
  }

  assert.ok(steps < 1400, 'automatic defenders must not stall against the weakened packs');
  assert.ok(peakLivingEnemies >= 6, 'the director should create a visibly dense first pack');
  assert.ok(game.state.kills >= 6, 'the starter slimes should clear at least the first pack');
  assert.equal(game.state.phase, 'build', 'automatic defense stays inside the playable base loop');
  assert.equal(game.state.result, null, 'base defense must not open the retired wave result screen');
  assert.ok(game.state.coreHp > 0);
});

test('the final wave still asks the player to use active cards', () => {
  const { game } = createHarness();
  game.openIntel();
  game.beginDefense();
  let steps = 0;
  while (game.state.phase !== 'result' && steps < 30000) {
    if (game.state.phase === 'between') game.startWave(game.state.waveIndex + 1);
    game.update(0.05);
    steps += 1;
  }
  assert.ok(steps < 30000);
  assert.equal(game.state.result?.victory, false, 'a completely passive run should eventually be overrun');
});

test('after an automatic teaching swarm, the starter slimes return to colony work', () => {
  const { game } = createHarness();
  game.state.colonyDirector.nextPackAt = 0;
  let steps = 0;
  while ((game.state.kills < 6 || game.state.enemies.some((enemy) => !enemy.dead)) && steps < 800) {
    game.update(0.05);
    steps += 1;
  }
  const colonyWorkStates = new Set([
    'idle', 'seek', 'move', 'harvest', 'carry', 'deposit', 'build', 'rally', 'rest',
  ]);
  for (let settleSteps = 0; settleSteps < 40
    && !game.state.colony.slimes.some((slime) => colonyWorkStates.has(slime.aiState));
    settleSteps += 1) game.update(0.05);

  assert.ok(steps < 800, 'the automatic teaching swarm should resolve');
  assert.equal(game.state.phase, 'build');
  assert.equal(game.selection, null, 'automatic combat must not demand manual card targeting');
  assert.ok(game.state.kills >= 6);
  assert.ok(
    game.state.colony.slimes.some((slime) => colonyWorkStates.has(slime.aiState)),
    'slimes should resume autonomous base jobs after the threat is gone',
  );
  assert.ok(game.state.coreHp > 0);
});
