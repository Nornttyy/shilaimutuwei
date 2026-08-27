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

function createHarness({ context = createContext(), assetStore = null } = {}) {
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
    width: 1280,
    height: 720,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
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

test('right-side card details use generated art with contained scaling and glyph fallback', () => {
  const building = BUILDINGS.find((card) => card.id === 'building-honey-plot');
  const skill = SKILLS.find((card) => card.id === 'skill-jelly-bounce');
  const item = ITEMS.find((card) => card.id === 'item-moving-bubble');
  const buildingArt = {
    key: building.id,
    naturalWidth: 768,
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
  assert.ok(Math.abs(buildingCall[4] / buildingCall[5] - 1.5) < 1e-9);
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
  assert.ok(fallbackTexts.includes(fallbackHarness.game.cardGlyph(building)));

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
  assert.ok(throwingTexts.includes(throwingHarness.game.cardGlyph(building)));
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

test('generated card and wide-building art is contained without changing its aspect ratio', () => {
  const building = BUILDINGS.find((card) => card.id === 'building-honey-plot');
  const frame = { key: 'ui-card-frame-common', naturalWidth: 512, naturalHeight: 384 };
  const art = { key: building.id, naturalWidth: 768, naturalHeight: 512 };
  const store = createReadyAssetStore(new Map([
    ['ui-card-frame-common', frame],
    [building.id, art],
  ]));
  const recording = createRecordingContext();
  const { game } = createHarness({ context: recording.ctx, assetStore: store });

  game.drawMiniCard(
    recording.ctx,
    'ratio-card',
    { x: 20, y: 30, w: 134, h: 84 },
    building,
    { selected: false, disabled: false, meta: '' },
    () => {},
  );
  const cardArtCall = recording.calls.find((call) => call[0] === 'drawImage' && call[1] === art);
  assert.ok(cardArtCall);
  assert.ok(Math.abs(cardArtCall[4] / cardArtCall[5] - 1.5) < 1e-9);
  assert.ok(cardArtCall[4] <= 40 && cardArtCall[5] <= 60);
  assert.equal(
    recording.calls.filter((call) => call[0] === 'drawImage' && call[1] === frame).length,
    9,
    'the frame should use nine-slice drawing instead of one stretched bitmap',
  );

  recording.calls.length = 0;
  drawBuilding(recording.ctx, 0, 0, 104, 'farm', { assetStore: store });
  const worldArtCall = recording.calls.find((call) => call[0] === 'drawImage' && call[1] === art);
  assert.ok(worldArtCall);
  assert.ok(Math.abs(worldArtCall[4] / worldArtCall[5] - 1.5) < 1e-9);
  assert.ok(worldArtCall[4] <= 115 && worldArtCall[5] <= 115, 'world art stays inside its logical slot');
});

test('rotated wide buildings keep generated PNG art upright and center world effects on the footprint', () => {
  const art = { key: 'building-honey-plot', naturalWidth: 768, naturalHeight: 512 };
  const store = createReadyAssetStore(new Map([[art.key, art]]));
  const recording = createRecordingContext();
  const rotations = [];
  const translations = [];
  recording.ctx.rotate = (angle) => rotations.push(angle);
  recording.ctx.translate = (x, y) => translations.push([x, y]);
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  const building = {
    uid: 'rotated-plot',
    cardId: 'building-honey-plot',
    x: 2,
    y: 1,
    rotation: 90,
    hp: 150,
    maxHp: 150,
    placedAt: -10,
  };

  game.drawBuildings(recording.ctx, [building]);

  assert.deepEqual(game.entityCanvasPosition(building), { x: 393, y: 322 });
  assert.deepEqual(translations[0], [393, 322]);
  assert.deepEqual(
    rotations,
    [],
    'a front-facing generated illustration must not be rolled sideways with its grid footprint',
  );
  assert.ok(recording.calls.some((call) => call[0] === 'drawImage' && call[1] === art));
});

test('building placement preview paints every rotated footprint cell and keeps its ghost upright', () => {
  const validTile = { key: 'tile-placement-valid' };
  const art = { key: 'building-honey-plot', naturalWidth: 768, naturalHeight: 512 };
  const store = createReadyAssetStore(new Map([
    [validTile.key, validTile],
    [art.key, art],
  ]));
  const recording = createRecordingContext();
  const rotations = [];
  recording.ctx.rotate = (angle) => rotations.push(angle);
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  game.state.phase = 'build';
  game.state.buildings = [];
  game.selection = {
    kind: 'place-building',
    cardId: 'building-honey-plot',
    rotation: 90,
  };
  game.hoverCell = { x: 2, y: 1 };

  game.drawSelectionOverlay(recording.ctx);

  const footprintCalls = recording.calls.filter((call) => (
    call[0] === 'drawImage' && call[1] === validTile
  ));
  assert.deepEqual(
    footprintCalls.map((call) => ({ x: call[2], y: call[3] })),
    [{ x: 359, y: 186 }, { x: 359, y: 264 }],
  );
  assert.ok(recording.calls.some((call) => call[0] === 'drawImage' && call[1] === art));
  assert.deepEqual(rotations, []);
});

test('moving a wide building previews rotation, cancels safely, rejects invalid cells, then commits', () => {
  const recording = createRecordingContext();
  const texts = [];
  recording.ctx.fillText = (value, ...args) => texts.push([String(value), ...args]);
  const { game } = createHarness({ context: recording.ctx });
  const building = {
    uid: 'moving-plot',
    cardId: 'building-honey-plot',
    x: 0,
    y: 0,
    rotation: 0,
    hp: 150,
    maxHp: 150,
    placedAt: -10,
  };
  game.state.phase = 'build';
  game.state.buildings = [building];
  game.selection = { kind: 'move-building', uid: building.uid, rotation: building.rotation };

  game.rotateSelection();

  assert.equal(game.selection.rotation, 90);
  assert.equal(building.rotation, 0, 'previewing a move must leave the placed direction unchanged');
  assert.equal(game.selectionCellIsValid({ x: 5, y: 4 }), true);
  game.drawBuildSide(recording.ctx);
  assert.ok(texts.some(([text]) => text === '1×2 · 定形值 2'));

  const cancel = game.hits.find(({ id }) => id === 'cancel-move');
  assert.ok(cancel);
  cancel.onTap();
  assert.equal(game.selection, null);
  assert.deepEqual(
    { x: building.x, y: building.y, rotation: building.rotation },
    { x: 0, y: 0, rotation: 0 },
    'canceling must preserve the placed building exactly',
  );

  game.selection = { kind: 'move-building', uid: building.uid, rotation: building.rotation };
  game.rotateSelection();
  assert.equal(game.selectionCellIsValid({ x: 5, y: 5 }), false);
  game.handleBuildCellTap({ x: 5, y: 5 });
  assert.deepEqual(
    { x: building.x, y: building.y, rotation: building.rotation },
    { x: 0, y: 0, rotation: 0 },
    'an invalid rotated footprint must not mutate the placed building',
  );

  game.handleBuildCellTap({ x: 5, y: 4 });

  assert.deepEqual(
    { x: building.x, y: building.y, rotation: building.rotation },
    { x: 5, y: 4, rotation: 90 },
  );
  assert.deepEqual(game.selection, { kind: 'inspect-building', uid: building.uid });
});

test('the complete fence occupies one cell, stays compact, and cannot rotate', () => {
  const fence = BUILDINGS.find((card) => card.id === 'building-bouncy-fence');
  assert.deepEqual(fence.footprint, { width: 1, height: 1 });

  const validTile = { key: 'tile-placement-valid' };
  const art = { key: fence.id, naturalWidth: 768, naturalHeight: 512 };
  const store = createReadyAssetStore(new Map([
    [validTile.key, validTile],
    [art.key, art],
  ]));
  const recording = createRecordingContext();
  const scales = [];
  recording.ctx.scale = (x, y) => scales.push([x, y]);
  const { game } = createHarness({ context: recording.ctx, assetStore: store });
  game.state.phase = 'build';
  game.state.buildings = [];
  game.selection = { kind: 'place-building', cardId: fence.id, rotation: 90 };
  game.hoverCell = { x: 2, y: 1 };

  game.rotateSelection();
  assert.equal(game.selection.rotation, 0, 'a square one-cell fence must ignore rotation');
  game.drawSelectionOverlay(recording.ctx);

  const footprintCalls = recording.calls.filter((call) => (
    call[0] === 'drawImage' && call[1] === validTile
  ));
  assert.deepEqual(
    footprintCalls.map((call) => ({ x: call[2], y: call[3] })),
    [{ x: 359, y: 186 }],
    'the complete fence must preview as exactly one cell',
  );
  assert.ok(
    scales.some(([x, y]) => Math.abs(x - 88 / 115) < 1e-9 && Math.abs(y - 88 / 115) < 1e-9),
    'the one-cell fence must use the compact 88px world slot, not the 104px wide-building slot',
  );

  const fenceRingMoves = [];
  recording.ctx.moveTo = (...args) => fenceRingMoves.push(args);
  drawBuilding(recording.ctx, 0, 0, 88, 'fence', {
    assetStore: store,
    ghost: true,
    valid: true,
  });
  assert.ok(
    fenceRingMoves.some(([moveX, moveY]) => (
      Math.abs(moveX + 88 * 0.47) < 1e-9
      && Math.abs(moveY) < 1e-9
    )),
    'the one-cell fence ghost ring must not retain the old wide-building multiplier',
  );

  game.hits = [];
  game.drawBuildSide(recording.ctx);
  assert.equal(game.hits.some(({ id }) => id === 'rotate-new'), false);

  const placedFence = {
    uid: 'one-cell-fence',
    cardId: fence.id,
    x: 2,
    y: 1,
    rotation: 0,
    hp: fence.hp,
    maxHp: fence.hp,
    placedAt: -10,
  };
  game.state.buildings = [placedFence];
  game.selection = { kind: 'inspect-building', uid: placedFence.uid };
  game.hits = [];
  game.drawBuildSide(recording.ctx);
  assert.equal(game.hits.some(({ id }) => id === 'rotate-building'), false);
  game.rotateSelection();
  assert.deepEqual(game.selection, { kind: 'inspect-building', uid: placedFence.uid });
  assert.equal(placedFence.rotation, 0);
});

test('inspecting rotation opens a pending preview without moving, saving, or committing', () => {
  const { game, storage } = createHarness();
  const building = {
    uid: 'stable-plot',
    cardId: 'building-honey-plot',
    x: 2,
    y: 3,
    rotation: 0,
    hp: 150,
    maxHp: 150,
    placedAt: -10,
  };
  game.state.phase = 'build';
  game.state.buildings = [building];
  game.selection = { kind: 'inspect-building', uid: building.uid };

  game.rotateSelection();

  assert.deepEqual(
    { x: building.x, y: building.y, rotation: building.rotation },
    { x: 2, y: 3, rotation: 0 },
    'rotation must not move or mutate the placed building before confirmation',
  );
  assert.deepEqual(game.selection, {
    kind: 'move-building',
    uid: building.uid,
    rotation: 90,
  });
  assert.equal(storage.size, 0, 'opening a rotation preview must not write a save');
  game.selection = null;
  assert.deepEqual(
    { x: building.x, y: building.y, rotation: building.rotation },
    { x: 2, y: 3, rotation: 0 },
  );
});

test('old saves normalize the former rotated fence to one upright cell', () => {
  const { game, storage } = createHarness();
  storage.set('slime-haven-prototype-v1', JSON.stringify({
    softCrystals: 160,
    tutorialSeen: true,
    buildings: [
      { cardId: 'building-bouncy-fence', x: 4, y: 3, rotation: 90, hp: 340, maxHp: 340 },
      { cardId: 'building-honey-plot', x: 1, y: 1, rotation: 90, hp: 150, maxHp: 150 },
    ],
  }));

  game.load();

  const fence = game.state.buildings.find(({ cardId }) => cardId === 'building-bouncy-fence');
  const plot = game.state.buildings.find(({ cardId }) => cardId === 'building-honey-plot');
  assert.deepEqual({ x: fence.x, y: fence.y, rotation: fence.rotation }, { x: 4, y: 3, rotation: 0 });
  assert.equal(plot.rotation, 90, 'a genuinely wide building must retain its saved direction');

  game.save();
  const resaved = JSON.parse(storage.get('slime-haven-prototype-v1'));
  assert.equal(
    resaved.buildings.find(({ cardId }) => cardId === 'building-bouncy-fence').rotation,
    0,
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
  game.hoverCell = { x: 0, y: 0 };
  game.drawSelectionOverlay(game.ctx);
  game.state.buildings = [building];
  building.x = 0;
  building.y = 0;
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
    'tile-build-light', 'tile-build-dark', 'tile-honey-puddle', 'tile-crystal-spikes',
    'tile-building-rubble', 'building-mushroom-home', 'building-honey-plot',
    'building-bubble-tower', 'building-bouncy-fence', 'building-weather-scout',
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
  game.state.phase = 'battle';
  game.state.buildings[0].destroyed = true;
  game.drawBuildings(recording.ctx);
  game.state.terrain = [
    { type: 'honey', x: 0, y: 0 },
    { type: 'crystal', x: 1, y: 0 },
  ];
  game.drawTerrain(recording.ctx);
  game.state.deployables = [
    { type: 'pad', x: 0, y: 0, dx: 1, dy: 0 },
    { type: 'lure', x: 1, y: 0 },
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

    game.damageSurvivor(survivor, survivor.hp);
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
    enemy.x = 0;
    enemy.y = 0;
    enemy.path = [{ x: 0, y: 0 }, { x: -1, y: 0 }];
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
  survivorGame.damageSurvivor(shell, shell.hp);
  assert.equal(shell.downed, true);
  assert.equal(survivorGame.pendingAttackHits.has(shell.uid), false);
  survivorGame.updateEntityAnimations(SHELL_CLIPS.attack.duration);
  assert.equal(target.hp, targetHp, 'a downed attacker must not finish its queued impact');

  const enemyHarness = createHarness();
  const enemyGame = enemyHarness.game;
  enemyGame.state.phase = 'battle';
  enemyGame.spawnEnemy('enemy-soft-biter', 0);
  const attacker = enemyGame.state.enemies.at(-1);
  attacker.x = 0;
  attacker.y = 0;
  attacker.path = [{ x: 0, y: 0 }, { x: -1, y: 0 }];
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

test('a complete assisted defense reaches a result without stalled enemies or waves', () => {
  const { game } = createHarness();
  game.openIntel();
  game.beginDefense();

  let steps = 0;
  while (game.state.phase !== 'result' && steps < 30000) {
    if (game.state.phase === 'between') {
      game.startWave(game.state.waveIndex + 1);
    } else if (game.state.phase === 'battle' && !game.selection) {
      const heal = SKILLS.find((card) => card.id === 'skill-sprout-renewal');
      const hurtSurvivor = game.state.survivors.find((target) => !target.downed && target.hp / target.maxHp < 0.45);
      const hurtBuilding = game.state.buildings.find((target) => !target.destroyed && target.hp / target.maxHp < 0.4);
      if ((hurtSurvivor || hurtBuilding)
        && game.state.energy >= heal.energy
        && game.state.friendlyActions >= game.state.skills[heal.id].readyAtAction) {
        const target = hurtSurvivor || hurtBuilding;
        game.selectCombatCard(heal);
        game.handleBattleTarget({ x: target.x, y: target.y });
      } else {
        const bounce = SKILLS.find((card) => card.id === 'skill-jelly-bounce');
        const threat = game.state.enemies.find((enemy) => !enemy.dead && enemy.x < 2.1);
        if (threat
          && game.state.energy >= bounce.energy
          && game.state.friendlyActions >= game.state.skills[bounce.id].readyAtAction) {
          game.selectCombatCard(bounce);
          game.handleBattleTarget(game.nearestCell(threat));
        }
      }
    }
    game.update(0.05);
    steps += 1;
  }

  assert.ok(steps < 30000, 'the battle loop should reach a terminal result');
  assert.ok(game.state.result);
  assert.equal(game.state.result.victory, true, 'the starter layout plus basic skill use should be winnable');
  assert.ok(game.state.kills > 0);
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

test('the starter layout clears the teaching wave without demanding perfect card use', () => {
  const { game } = createHarness();
  game.openIntel();
  game.beginDefense();
  let steps = 0;
  while (game.state.phase === 'battle' && steps < 12000) {
    game.update(0.05);
    steps += 1;
  }
  assert.equal(game.state.phase, 'between');
  assert.ok(game.state.coreHp > 0);
});
