import test from 'node:test';
import assert from 'node:assert/strict';

import { TowerDefenseGame } from '../src/tower-defense-game.js';
import {
  HERO_TYPES,
  SQUAD_TYPES,
  TURRET_TYPES,
  TD_ENEMIES,
  TD_STAGES,
  TD_STORAGE_KEY,
  heroStatsForRank,
} from '../src/tower-defense-core.js';
import { SOLDIER_RIG } from '../src/animation/rigs.js';
import { createWebRuntime } from '../src/platform/runtime.js';

function createContext() {
  const gradient = () => ({ addColorStop() {} });
  const calls = [];
  const stateStack = [];
  const base = {
    calls,
    filter: 'none',
    globalAlpha: 1,
    save() {
      stateStack.push({ filter: this.filter, globalAlpha: this.globalAlpha });
    },
    restore() {
      const state = stateStack.pop();
      if (!state) return;
      this.filter = state.filter;
      this.globalAlpha = state.globalAlpha;
    },
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    measureText: (text) => ({ width: String(text).length * 12 }),
    drawImage: (...args) => calls.push(['drawImage', ...args]),
    fillText: (text, x, y) => calls.push(['fillText', text, x, y]),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    quadraticCurveTo: (...args) => calls.push(['quadraticCurveTo', ...args]),
    arc: (...args) => calls.push(['arc', ...args]),
    ellipse: (...args) => calls.push(['ellipse', ...args]),
    translate: (...args) => calls.push(['translate', ...args]),
    rotate: (...args) => calls.push(['rotate', ...args]),
  };
  base.stroke = () => calls.push([
    'stroke', base.strokeStyle, base.lineWidth, base.globalAlpha,
  ]);
  return new Proxy(base, {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}

function createCanvas({
  left = 0,
  top = 0,
  width = 720,
  height = 1280,
} = {}) {
  const context = createContext();
  const listeners = new Map();
  const frames = new Map();
  const cancelledFrames = [];
  let nextFrameId = 1;
  const rect = { left, top, width, height };

  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    context,
    rect,
    cancelledFrames,
    getContext: () => context,
    getBoundingClientRect: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    }),
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    listenerCount(name) {
      return listeners.get(name)?.size || 0;
    },
    dispatch(name, event = {}) {
      for (const listener of [...(listeners.get(name) || [])]) listener(event);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    requestAnimationFrame(callback) {
      const id = nextFrameId;
      nextFrameId += 1;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      cancelledFrames.push(id);
      frames.delete(id);
    },
    pendingFrameCount() {
      return frames.size;
    },
    flushFrame(timestamp = 16) {
      const entry = frames.entries().next().value;
      if (!entry) return false;
      const [id, callback] = entry;
      frames.delete(id);
      callback(timestamp);
      return true;
    },
  };
  context.canvas = canvas;
  return canvas;
}

function createRuntime(initialProgress = null) {
  const values = new Map();
  if (initialProgress) values.set(TD_STORAGE_KEY, initialProgress);
  const writes = [];
  return {
    values,
    writes,
    storage: {
      get: (key, fallback = null) => values.get(key) ?? fallback,
      set(key, value) {
        values.set(key, JSON.parse(JSON.stringify(value)));
        writes.push({ key, value: JSON.parse(JSON.stringify(value)) });
        return true;
      },
    },
  };
}

function createAssetStore(availableKeys = []) {
  const requests = [];
  const available = new Set(availableKeys);
  return {
    requests,
    available,
    get(_key, fallback = null) {
      return fallback;
    },
    useOrFallback(key, drawAsset, drawFallback) {
      requests.push(key);
      if (available.has(key)) {
        const heroSkillFace = /^hero-.+-skill-face-v1$/.test(key);
        const formalAtlas = /^(?:hero|soldier|enemy)-.+-atlas-v1$/.test(key)
          || /^effect-.+-frames-v1$/.test(key);
        const layeredTurret = /^turret-.+-atlas-v1$/.test(key);
        const reinforcementAtlas = key === 'effect-reinforcement-projectiles-atlas-v1';
        const width = reinforcementAtlas ? 1536
          : layeredTurret ? 1536 : heroSkillFace ? 836 : formalAtlas ? 1254 : 768;
        const height = reinforcementAtlas ? 1024
          : layeredTurret ? 768 : heroSkillFace ? 418 : key.startsWith('turret-') ? 723 : width;
        drawAsset?.({ key, kind: key, width, height, naturalWidth: width, naturalHeight: height });
        return true;
      }
      drawFallback?.();
      return false;
    },
  };
}

function rotationBeforeAsset(calls, assetKey) {
  const imageIndex = calls.findIndex(([kind, asset]) => (
    kind === 'drawImage' && asset?.kind === assetKey
  ));
  if (imageIndex < 0) return null;
  return calls.slice(0, imageIndex).reverse()
    .find(([kind]) => kind === 'rotate')?.[1] ?? null;
}

function createRigStore() {
  const requests = [];
  return {
    requests,
    get(ownerId, fallback = null) {
      requests.push(ownerId);
      return fallback;
    },
  };
}

function clientPoint(game, canvas, logicalPoint) {
  return {
    clientX: canvas.rect.left + game.offsetX + logicalPoint.x * game.scale,
    clientY: canvas.rect.top + game.offsetY + logicalPoint.y * game.scale,
  };
}

function pointerEvent(game, canvas, logicalPoint, pointerId = 1) {
  return {
    ...clientPoint(game, canvas, logicalPoint),
    pointerId,
    preventDefault() {},
  };
}

function click(game, canvas, logicalPoint) {
  const event = pointerEvent(game, canvas, logicalPoint);
  canvas.dispatch('pointerdown', event);
  canvas.dispatch('pointerup', event);
}

function drag(game, canvas, from, to) {
  canvas.dispatch('pointerdown', pointerEvent(game, canvas, from));
  canvas.dispatch('pointermove', pointerEvent(game, canvas, to));
  canvas.dispatch('pointerup', pointerEvent(game, canvas, to));
}

function hitCenter(game, id) {
  const hit = game.hits.find((candidate) => candidate.id === id);
  assert.ok(hit, `expected rendered hit target ${id}`);
  return { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };
}

function transformHasMotion(transform = {}) {
  return Math.abs(Number(transform.x) || 0) > 1e-5
    || Math.abs(Number(transform.y) || 0) > 1e-5
    || Math.abs(Number(transform.rotation) || 0) > 1e-5
    || Math.abs((Number(transform.scaleX) || 1) - 1) > 1e-5
    || Math.abs((Number(transform.scaleY) || 1) - 1) > 1e-5;
}

test('constructs and renders its first menu frame without DOM globals', () => {
  const canvas = createCanvas();
  const runtime = createRuntime({ tutorialSeen: true });
  const game = new TowerDefenseGame(canvas, {
    runtime,
    pixelRatio: 1,
    seed: 123,
  });

  assert.equal(game.state.screen, 'menu');
  assert.doesNotThrow(() => game.render());
  assert.equal(canvas.width, 720);
  assert.equal(canvas.height, 1280);
  assert.ok(game.hits.some(({ id }) => id === 'start-story'));
  assert.deepEqual(game.hits.map(({ id }) => id), [
    'start-story', 'endless', 'open-roster', 'open-summon', 'audio-toggle',
  ]);
  assert.ok(canvas.context.calls.some(([kind, text]) => (
    kind === 'fillText' && text === '史莱姆守望团'
  )));
  game.dispose();
});

test('formal asset and rig stores can be replaced and are used during rendering', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  const menuAssets = [
    'background-menu-portrait-v1',
    'fortress-slime-core',
    'effect-damage-cracks-overlay',
  ];
  const assets = createAssetStore(menuAssets);
  const rigs = createRigStore();

  assert.equal(game.setAssetStore(assets), game);
  assert.equal(game.setRigAssetStore(rigs), game);
  assert.equal(game.setGeneratedCharacterArtEnabled(false), game);
  assert.equal(game.generatedCharacterArtEnabled, false);
  game.render();

  assert.ok(assets.requests.includes('background-menu-portrait-v1'));
  assert.equal(assets.requests.includes('background-garden-base'), false,
    'the ready formal menu backdrop needs no fallback scene');
  assert.ok(assets.requests.includes('fortress-slime-core'));
  for (const key of [
    'rift-entry-portal', 'tile-build-light', 'tile-build-dark',
    'tile-route-open', 'turret-gel-mount',
  ]) {
    assert.equal(assets.requests.includes(key), false,
      `${key} is intentionally absent from the core-only main menu`);
  }
  assert.equal(assets.requests.includes('background-cloud-overlay'), false);
  assert.equal(assets.requests.includes('town-soft-core'), false);
  for (const key of menuAssets.slice(0, 2)) {
    assert.ok(canvas.context.calls.some(([kind, asset]) => (
      kind === 'drawImage' && asset?.kind === key
    )), `${key} is part of the formal menu composition`);
  }
  assert.deepEqual(rigs.requests, [],
    'the main menu only renders the fortress core and never requests a hero rig');
  assert.equal(game.setGeneratedCharacterArtEnabled(true), game);
  assert.equal(game.generatedCharacterArtEnabled, true);
  assert.equal(game.setAssetStore({}), game);
  assert.equal(game.assetStore, null);
  assert.equal(game.setRigAssetStore({}), game);
  assert.equal(game.rigAssetStore, null);
  game.dispose();
});

test('all four towers drive independent attack bones and replace facial layers', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  game.state.screen = 'battle';
  game.state.hand = [];
  const cases = [
    ['shell', 'shellAssembly'],
    ['needle', 'needleTall'],
    ['bubble', 'bubbleSmall'],
    ['sprout', 'leafLeft'],
  ];
  game.state.towers = cases.map(([type], index) => ({
    uid: `animated-tower-${index}`,
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

  cases.forEach(([type, controlBone], index) => {
    const tower = game.state.towers[index];
    const entry = game.characterAnimations.get(`tower:${tower.uid}`);
    assert.equal(entry.controller.actionName, 'attack', `${type} plays its attack clip`);
    assert.equal(transformHasMotion(entry.controller.sample()[controlBone]), true,
      `${type}.${controlBone} moves independently`);
    assert.equal(entry.expressionMixer.sample().to, 'attack', `${type} swaps to attack face layers`);
  });
  game.dispose();
});

test('all eleven atlas heroes play a distinct skill face while legacy heroes stay unchanged', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  game.state.screen = 'battle';
  game.state.phase = 'combat';
  game.state.waveActive = true;
  game.state.towers = [];

  const atlasHeroTypes = [
    'berry', 'dew', 'bell', 'drill', 'ember', 'ink',
    'cloud', 'frost', 'honey', 'spark', 'star',
  ];
  for (const type of atlasHeroTypes) {
    const ownerId = HERO_TYPES[type].ownerId;
    game.state.hero = {
      uid: `skill-${type}`, type, hp: 100, maxHp: 100,
      x: 360, y: 720, moveX: 0, moveY: 0, facing: 1,
    };
    game.processCharacterAnimationEvent({ type: 'hero-skill', heroType: type });
    game.updateCharacterAnimations(0.05);
    const entry = game.characterAnimations.get(`hero:skill-${type}`);
    assert.equal(entry.controller.actionName, 'skill', `${type} owns a skill clip`);
    assert.equal(entry.expressionMixer.sample().to, 'skill', `${type} owns a skill face`);
  }

  game.state.hero = {
    uid: 'priority-berry', type: 'berry', hp: 100, maxHp: 100,
    x: 360, y: 720, moveX: 0, moveY: 0, facing: 1,
  };
  game.processCharacterAnimationEvent({ type: 'hero-skill', heroType: 'berry' });
  game.processCharacterAnimationEvent({ type: 'hero-attack', heroType: 'berry' });
  let entry = game.characterAnimations.get('hero:priority-berry');
  assert.equal(entry.controller.actionName, 'skill', 'a basic attack cannot replace a skill cast');
  game.processCharacterAnimationEvent({ type: 'hero-hit', heroType: 'berry' });
  game.updateCharacterAnimations(0.05);
  entry = game.characterAnimations.get('hero:priority-berry');
  assert.equal(entry.controller.actionName, 'hurt', 'hurt remains more important than skill');

  game.state.hero = {
    uid: 'legacy-shell', type: 'shell', hp: 100, maxHp: 100,
    x: 360, y: 720, moveX: 0, moveY: 0, facing: 1,
  };
  game.processCharacterAnimationEvent({ type: 'hero-skill', heroType: 'shell' });
  entry = game.characterAnimations.get('hero:legacy-shell');
  assert.equal(entry.controller.actionName, 'attack',
    'the original four layered heroes retain their established attack action');
  assert.equal(Object.hasOwn(entry.expressionMixer.spec.states, 'skill'), false,
    'the original layered expression contract is not widened');
  game.dispose();
});

test('summoning and hero formation are separate portrait menu flows', () => {
  const canvas = createCanvas();
  const runtime = createRuntime({ tutorialSeen: true, summonCurrency: 1000 });
  const game = new TowerDefenseGame(canvas, {
    runtime,
    pixelRatio: 1,
    seed: 0xC0A7A5,
  });
  game.render();

  click(game, canvas, hitCenter(game, 'open-summon'));
  assert.equal(game.menuPage, 'summon');
  canvas.context.calls.length = 0;
  game.render();
  assert.deepEqual(game.hits.map(({ id }) => id), [
    'summon-back', 'summon-one', 'summon-ten', 'audio-toggle',
  ]);
  assert.equal(game.hits.some(({ id }) => id.startsWith('hero-select-')), false,
    'the summon page cannot switch the active hero');
  const summonLabels = canvas.context.calls
    .filter(([kind]) => kind === 'fillText')
    .map(([, text]) => text);
  assert.ok(summonLabels.includes('战团招募'));
  assert.ok(summonLabels.includes('英雄 · 小队 · 炮塔  ·  R → UR'));
  assert.ok(summonLabels.includes('稀有度概率'));
  assert.ok(summonLabels.includes('高稀有保底  0/10'));
  assert.ok(summonLabels.includes('最多再 10 次获得 SSR / UR'));
  for (const rarity of ['R', 'SR', 'SSR', 'UR']) assert.ok(summonLabels.includes(rarity));

  const summonOnePoint = hitCenter(game, 'summon-one');
  click(game, canvas, summonOnePoint);
  assert.equal(game.state.progress.summonCurrency, 900);
  assert.equal(game.summonResults.length, 0);
  assert.equal(game.summonAnimation.results.length, 1);
  click(game, canvas, summonOnePoint);
  assert.equal(game.state.progress.summonCurrency, 900,
    'a stale summon hit cannot buy again while the ceremony is running');
  game.render();
  assert.deepEqual(game.hits.map(({ id }) => id), ['summon-animation-skip', 'audio-toggle']);
  assert.ok(canvas.context.calls.some(([kind, text]) => (
    kind === 'fillText' && text === '能量汇聚'
  )), 'the first ceremony stage gathers energy');
  click(game, canvas, hitCenter(game, 'summon-animation-skip'));
  assert.equal(game.summonAnimation, null);
  assert.equal(game.summonResults.length, 1);
  game.render();
  assert.deepEqual(game.hits.map(({ id }) => id), ['summon-result-close', 'audio-toggle']);
  click(game, canvas, hitCenter(game, 'summon-result-close'));
  assert.equal(game.summonResults.length, 0);

  game.render();
  assert.equal(game.hits.find(({ id }) => id === 'summon-ten').enabled, true);
  click(game, canvas, hitCenter(game, 'summon-ten'));
  assert.equal(game.state.progress.summonCurrency, 0);
  assert.equal(game.summonAnimation.results.length, 10);
  for (let index = 0; index < 15; index += 1) game.updateCharacterAnimations(0.05);
  canvas.context.calls.length = 0;
  game.render();
  assert.deepEqual(game.hits.map(({ id }) => id), ['summon-animation-skip', 'audio-toggle']);
  assert.ok(canvas.context.calls.some(([kind, text]) => (
    kind === 'fillText' && text === '契约裂隙开启'
  )), 'the second ceremony stage opens the rift and flips a card');

  for (let index = 0; index < 16; index += 1) game.updateCharacterAnimations(0.05);
  canvas.context.calls.length = 0;
  game.render();
  assert.ok(canvas.context.calls.some(([kind, text]) => (
    kind === 'fillText' && text === '契约显现'
  )), 'the third ceremony stage reveals the results in sequence');
  assert.deepEqual(game.hits.map(({ id }) => id), ['summon-animation-skip', 'audio-toggle']);

  for (let index = 0; index < 24; index += 1) game.updateCharacterAnimations(0.05);
  assert.equal(game.summonAnimation, null);
  assert.equal(game.summonResults.length, 10);
  game.render();
  assert.deepEqual(game.hits.map(({ id }) => id), ['summon-result-close', 'audio-toggle']);
  click(game, canvas, hitCenter(game, 'summon-result-close'));

  const heroTypes = Object.keys(HERO_TYPES);
  const unlocked = heroTypes.find((type) => type !== 'shell' && (
    game.state.progress.contractRanks[type] > 0
  ));
  assert.ok(unlocked, 'the first ten pull unlocks another selectable hero');
  game.activateHit({ action: 'select-hero', data: { heroType: unlocked } });
  assert.equal(game.state.progress.selectedHero, 'shell',
    'even a stale direct select action is ignored outside the formation page');

  game.render();
  click(game, canvas, hitCenter(game, 'summon-back'));
  assert.equal(game.menuPage, 'main');
  game.render();
  click(game, canvas, hitCenter(game, 'open-roster'));
  assert.equal(game.menuPage, 'roster');
  canvas.context.calls.length = 0;
  game.render();
  const heroPageByType = new Map();
  while (true) {
    for (const hit of game.hits.filter(({ id }) => id.startsWith('hero-inspect-'))) {
      const type = hit.id.slice('hero-inspect-'.length);
      heroPageByType.set(type, game.rosterPage);
      assert.equal(hit.enabled, true, `${type} can be inspected even while locked`);
    }
    const next = game.hits.find(({ id }) => id === 'roster-next');
    if (!next?.enabled) break;
    click(game, canvas, hitCenter(game, 'roster-next'));
    game.render();
  }
  assert.deepEqual([...heroPageByType.keys()].sort(), [...heroTypes].sort(),
    'roster pagination exposes every hero without squeezing cards together');
  game.rosterPage = heroPageByType.get('shell') || 0;
  game.render();
  assert.equal(game.hits.find(({ id }) => id === 'hero-select-shell').enabled, false,
    'the already deployed hero has no duplicate deploy action');
  assert.ok(canvas.context.calls.some(([kind, text]) => (
    kind === 'fillText' && text === '英雄编队'
  )));

  const locked = heroTypes.find((type) => game.state.progress.contractRanks[type] <= 0);
  if (locked) {
    game.rosterPage = heroPageByType.get(locked) || 0;
    game.render();
    click(game, canvas, hitCenter(game, `hero-inspect-${locked}`));
    assert.equal(game.rosterInspectType, locked);
    game.render();
    assert.equal(game.hits.find(({ id }) => id === `hero-select-${locked}`).enabled, false,
      'an inspected locked hero cannot be deployed');
  }

  game.rosterPage = heroPageByType.get(unlocked) || 0;
  game.render();
  click(game, canvas, hitCenter(game, `hero-inspect-${unlocked}`));
  assert.equal(game.rosterInspectType, unlocked);
  game.render();
  assert.equal(game.hits.find(({ id }) => id === `hero-select-${unlocked}`).enabled, true);
  click(game, canvas, hitCenter(game, `hero-select-${unlocked}`));
  assert.equal(game.state.progress.selectedHero, unlocked);
  assert.equal(runtime.values.get(TD_STORAGE_KEY).selectedHero, unlocked);

  game.render();
  click(game, canvas, hitCenter(game, 'roster-back'));
  assert.equal(game.menuPage, 'main');
  game.render();
  assert.ok(game.hits.some(({ id }) => id === 'open-summon'));
  game.dispose();
});

test('hero roster renders locked heroes as faceless gray silhouettes without hidden details', (t) => {
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = createContext();
      this.context.canvas = this;
    }
    getContext() { return this.context; }
  };
  t.after(() => {
    if (previousOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousOffscreenCanvas;
  });
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({
      tutorialSeen: true,
      selectedHero: 'shell',
      contractRanks: { shell: 1, needle: 1 },
    }),
    pixelRatio: 1,
  });
  const heroAssetKeys = Object.values(HERO_TYPES)
    .map((definition) => definition.portraitAssetKey || definition.assetKey || definition.ownerId)
    .filter(Boolean);
  heroAssetKeys.push('hero-berry-burst-atlas-v1', 'hero-dew-bloom-atlas-v1');
  game.setAssetStore(createAssetStore(heroAssetKeys));
  const portraitDraws = [];
  canvas.context.drawImage = (...args) => {
    portraitDraws.push({ filter: canvas.context.filter, args });
    canvas.context.calls.push(['drawImage', ...args]);
  };

  game.render();
  click(game, canvas, hitCenter(game, 'open-roster'));
  game.render();
  assert.ok(portraitDraws.some(({ filter }) => (
    String(filter).includes('brightness(0)') && String(filter).includes('invert(0.55)')
  )), 'locked portraits collapse every visible layer, including eyes and mouths, to one gray');

  const lockedType = Object.keys(HERO_TYPES).find((type) => (
    game.state.progress.contractRanks[type] <= 0
  ));
  assert.ok(lockedType);
  const lockedInspect = game.hits.find(({ id }) => id === `hero-inspect-${lockedType}`);
  assert.equal(lockedInspect.enabled, true);
  click(game, canvas, hitCenter(game, lockedInspect.id));
  canvas.context.calls.length = 0;
  game.render();

  const labels = canvas.context.calls
    .filter(([kind]) => kind === 'fillText')
    .map(([, text]) => text);
  assert.ok(labels.includes(HERO_TYPES[lockedType].name));
  assert.ok(labels.includes('未解锁'));
  for (const hiddenText of [
    '攻击', '生命', '射程', '攻速', HERO_TYPES[lockedType].role,
    HERO_TYPES[lockedType].skill.name,
  ]) {
    assert.equal(labels.includes(hiddenText), false, `${hiddenText} stays hidden while locked`);
  }
  assert.equal(labels.some((text) => String(text).includes('范围')), false);
  assert.equal(labels.some((text) => String(text).includes('契约 0阶')), false);
  assert.equal(game.hits.find(({ id }) => id === `hero-select-${lockedType}`).enabled, false);

  click(game, canvas, hitCenter(game, 'hero-inspect-needle'));
  canvas.context.calls.length = 0;
  game.render();
  const ownedLabels = canvas.context.calls
    .filter(([kind]) => kind === 'fillText')
    .map(([, text]) => text);
  for (const statName of ['攻击', '生命', '射程', '攻速']) {
    assert.ok(ownedLabels.includes(statName), `${statName} remains visible when owned`);
  }
  assert.equal(game.hits.find(({ id }) => id === 'hero-select-needle').enabled, true,
    'an owned non-active hero exposes a separate deploy button');
  game.dispose();
});

test('hero roster renders the same rank-adjusted combat values used by the core', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({
      tutorialSeen: true,
      selectedHero: 'berry',
      contractRanks: { shell: 1, berry: 10 },
    }),
    pixelRatio: 1,
  });
  game.render();
  click(game, canvas, hitCenter(game, 'open-roster'));
  canvas.context.calls.length = 0;
  game.render();

  const stats = heroStatsForRank('berry', 10);
  const labels = canvas.context.calls
    .filter(([kind]) => kind === 'fillText')
    .map(([, text]) => String(text));
  assert.ok(labels.includes(String(Math.round(stats.damage))));
  assert.ok(labels.includes(String(stats.maxHp)));
  assert.ok(labels.includes(`${stats.attackSpeed.toFixed(2)}/秒`));
  assert.ok(labels.includes(stats.growthSummary));
  assert.ok(labels.join('').includes(stats.skillEffect),
    'roster prints the same multi-hit or damage-over-time summary used by the simulation');
  assert.deepEqual({
    damage: game.state.heroes.find(({ type }) => type === 'berry').damage,
    maxHp: game.state.heroes.find(({ type }) => type === 'berry').maxHp,
    skillEffect: game.state.heroes.find(({ type }) => type === 'berry').skillEffect,
  }, {
    damage: stats.damage,
    maxHp: stats.maxHp,
    skillEffect: stats.skillEffect,
  });
  game.dispose();
});

test('Berry and Dew use their own 1254 atlases in battle, roster, and summon previews', (t) => {
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = createContext();
      this.context.canvas = this;
    }
    getContext() { return this.context; }
  };
  t.after(() => {
    if (previousOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousOffscreenCanvas;
  });

  const canvas = createCanvas();
  const assets = createAssetStore([
    'hero-berry-burst-atlas-v1',
    'hero-berry-burst-skill-face-v1',
    'hero-dew-bloom-atlas-v1',
    'hero-dew-bloom-skill-face-v1',
  ]);
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  game.setAssetStore(assets);
  game.setGeneratedCharacterArtEnabled(false);

  game.state.screen = 'battle';
  game.state.hero = {
    uid: 'berry-hero', type: 'berry', x: 360, y: 720, hp: 500, maxHp: 660,
    moveX: 0, moveY: 0, facing: 1, hitPulse: 0,
  };
  assets.requests.length = 0;
  game.drawBattleHero(canvas.context);
  assert.ok(assets.requests.includes('hero-berry-burst-atlas-v1'));
  assert.ok(assets.requests.includes('hero-berry-burst-skill-face-v1'));
  assert.equal(assets.requests.includes('survivor-shell-shell'), false,
    'Berry never asks the shell standalone for a fallback');

  assets.requests.length = 0;
  game.drawRosterHeroPortrait(canvas.context, 'dew', 240, 420, 132);
  assert.ok(assets.requests.includes('hero-dew-bloom-atlas-v1'));
  assert.ok(assets.requests.includes('hero-dew-bloom-skill-face-v1'));
  assert.equal(assets.requests.includes('survivor-shell-shell'), false,
    'Dew never asks the shell standalone for a fallback');

  assets.requests.length = 0;
  game.drawSummonResults(canvas.context, {
    results: [{ type: 'berry', rarity: 'SR', unlocked: true }],
  });
  assert.ok(assets.requests.includes('hero-berry-burst-atlas-v1'));
  assert.ok(assets.requests.includes('hero-berry-burst-skill-face-v1'));
  assert.equal(assets.requests.includes('survivor-shell-shell'), false);
  game.dispose();
});

test('expanded heroes, squads, turrets, and enemies request only their own production atlases', (t) => {
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = createContext();
      this.context.canvas = this;
    }
    getContext() { return this.context; }
  };
  t.after(() => {
    if (previousOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousOffscreenCanvas;
  });

  const heroAtlases = {
    bell: 'hero-bell-boom-atlas-v1',
    drill: 'hero-drill-gum-atlas-v1',
    ember: 'hero-ember-fizz-atlas-v1',
    ink: 'hero-ink-splash-atlas-v1',
    cloud: 'hero-cloud-spin-atlas-v1',
    frost: 'hero-frost-drop-atlas-v1',
    honey: 'hero-honey-pop-atlas-v1',
    spark: 'hero-spark-bean-atlas-v1',
    star: 'hero-star-core-atlas-v1',
  };
  const heroSkillFaces = Object.fromEntries(Object.entries({
    berry: 'hero-berry-burst-atlas-v1',
    dew: 'hero-dew-bloom-atlas-v1',
    ...heroAtlases,
  }).map(([type, assetKey]) => [
    type, assetKey.replace(/-atlas-v1$/, '-skill-face-v1'),
  ]));
  const squadAtlases = {
    'drill-lancer': 'soldier-drill-lancer-atlas-v1',
    'spore-lobber': 'soldier-spore-lobber-atlas-v1',
    'volt-orbiter': 'soldier-volt-orbiter-atlas-v1',
  };
  const turretAtlases = {
    'gale-fan': 'turret-gale-fan-atlas-v1',
    'spore-bomber': 'turret-spore-bomber-atlas-v1',
    'thunder-prism': 'turret-thunder-prism-atlas-v1',
  };
  const enemyAtlases = {
    thorn: 'enemy-thorn-roller-atlas-v1',
    lantern: 'enemy-lantern-spore-atlas-v1',
    mud: 'enemy-mud-bulwark-atlas-v1',
    'rift-boss': 'enemy-rift-beacon-king-atlas-v1',
  };
  const productionKeys = [
    ...Object.values(heroAtlases),
    ...Object.values(heroSkillFaces),
    ...Object.values(squadAtlases),
    ...Object.values(turretAtlases),
    ...Object.values(enemyAtlases),
  ];
  const assets = createAssetStore(productionKeys);
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  game.setAssetStore(assets);
  game.setGeneratedCharacterArtEnabled(false);

  for (const [type, assetKey] of Object.entries(heroAtlases)) {
    assert.ok(HERO_TYPES[type]);
    assets.requests.length = 0;
    game.state.screen = 'battle';
    game.state.hero = {
      uid: `expanded-${type}`, type, x: 360, y: 720,
      hp: 100, maxHp: 100, moveX: 0, moveY: 0, facing: 1, hitPulse: 0,
    };
    game.drawBattleHero(canvas.context);
    assert.ok(assets.requests.includes(assetKey), `${type} draws its own battle atlas`);
    assert.ok(assets.requests.includes(heroSkillFaces[type]),
      `${type} also binds its own skill-face sidecar`);
    assert.equal(assets.requests.includes('hero-berry-burst-atlas-v1'), false);
    assert.equal(assets.requests.includes('survivor-shell-shell'), false);
  }

  for (const [type, assetKey] of Object.entries(squadAtlases)) {
    assert.ok(SQUAD_TYPES[type]);
    assets.requests.length = 0;
    game.drawRecruitmentResultVisual(canvas.context, {
      kind: 'squad', type, rarity: SQUAD_TYPES[type].rarity,
    });
    assert.deepEqual([...new Set(assets.requests)], [assetKey],
      `${type} recruitment uses only its four authored atlas instances`);
  }

  for (const [type, assetKey] of Object.entries(turretAtlases)) {
    assert.ok(TURRET_TYPES[type]);
    assets.requests.length = 0;
    canvas.context.calls.length = 0;
    game.drawRecruitmentResultVisual(canvas.context, {
      kind: 'turret', type, rarity: TURRET_TYPES[type].rarity,
    });
    assert.deepEqual(assets.requests, [assetKey]);
    const layers = canvas.context.calls.filter(([kind, asset]) => (
      kind === 'drawImage' && asset?.kind === assetKey
    ));
    assert.deepEqual(layers.map(([, , sourceX]) => sourceX), [0, 768],
      `${type} draws its fixed base and independently aimed head`);
  }

  for (const [type, assetKey] of Object.entries(enemyAtlases)) {
    assert.ok(TD_ENEMIES[type]);
    assets.requests.length = 0;
    game.state.time = 1;
    game.drawEnemy(canvas.context, {
      uid: `expanded-enemy-${type}`, type, x: 360, y: 420,
      hp: 100, maxHp: 100, facing: 1, hitPulse: 0,
    });
    assert.ok(assets.requests.includes(assetKey), `${type} draws its own enemy atlas`);
    assert.equal(assets.requests.includes('enemy-soft-biter'), false,
      `${type} never falls back to the old bug`);
  }

  canvas.context.calls.length = 0;
  game.drawSummonResults(canvas.context, {
    results: [
      { kind: 'squad', type: 'drill-lancer', rarity: 'SR', unlocked: true },
      { kind: 'turret', type: 'gale-fan', rarity: 'R', unlocked: true },
    ],
  });
  const resultLabels = canvas.context.calls
    .filter(([kind]) => kind === 'fillText')
    .map(([, text]) => text);
  for (const expected of ['钻枪小队', '风旋塔', '新小队', '新炮塔']) {
    assert.ok(resultLabels.includes(expected), `mixed recruitment labels ${expected}`);
  }
  game.dispose();
});

test('hero skills combine eighteen authored components with continuous Canvas motion', () => {
  const canvas = createCanvas();
  const retiredSkillSheets = [
    'effect-shell-triple-shock-frames-v1',
    'effect-crystal-rain-frames-v1',
    'effect-bubble-tide-domain-frames-v1',
    'effect-sprout-forest-dance-frames-v1',
    'effect-berry-chain-barrage-frames-v1',
    'effect-dew-garland-frames-v1',
  ];
  const skillComponents = [
    'effect-skill-shell-impact-v1',
    'effect-skill-crystal-laser-emitter-v1',
    'effect-skill-crystal-laser-hit-v1',
    'effect-skill-bubble-orb-v1',
    'effect-skill-bubble-burst-v1',
    'effect-skill-sprout-thorn-v1',
    'effect-skill-berry-bomb-v1',
    'effect-skill-berry-burst-v1',
    'effect-skill-dew-wave-crest-v1',
  ];
  const expandedSkillComponents = [
    'skill-bell-sonic-ring-icon',
    'skill-drill-rupture-dash-icon',
    'skill-ember-scorch-line-icon',
    'skill-ink-cone-burst-icon',
    'skill-cloud-vortex-icon',
    'skill-frost-shard-lane-icon',
    'skill-honey-cluster-icon',
    'skill-spark-chain-arc-icon',
    'skill-star-orbit-barrage-icon',
  ];
  const assets = createAssetStore([
    ...retiredSkillSheets,
    ...skillComponents,
    ...expandedSkillComponents,
  ]);
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  game.setAssetStore(assets);
  game.state.screen = 'battle';
  game.state.phase = 'combat';
  game.state.waveActive = true;
  game.state.result = null;

  const iconByType = {
    shell: 'skill-shell-triple-shock-icon',
    needle: 'skill-crystal-rain-icon',
    bubble: 'skill-bubble-tide-domain-icon',
    sprout: 'skill-sprout-forest-dance-icon',
    berry: 'skill-berry-chain-barrage-icon',
    dew: 'skill-dew-garland-icon',
    bell: 'skill-bell-sonic-ring-icon',
    drill: 'skill-drill-rupture-dash-icon',
    ember: 'skill-ember-scorch-line-icon',
    ink: 'skill-ink-cone-burst-icon',
    cloud: 'skill-cloud-vortex-icon',
    frost: 'skill-frost-shard-lane-icon',
    honey: 'skill-honey-cluster-icon',
    spark: 'skill-spark-chain-arc-icon',
    star: 'skill-star-orbit-barrage-icon',
  };
  for (const [type, iconKey] of Object.entries(iconByType)) {
    game.state.hero = {
      uid: `icon-${type}`, type, hp: 100, maxHp: 100, skillCooldown: 0,
    };
    assets.requests.length = 0;
    game.drawHeroControls(canvas.context);
    assert.ok(assets.requests.includes(iconKey), `${type} uses ${iconKey}`);
  }

  game.state.hero = {
    uid: 'dynamic-hero', type: 'needle', x: 300, y: 760,
    hp: 100, maxHp: 100, skillCooldown: 0,
  };
  game.state.heroSkillActors = [
    {
      uid: 'field', type: 'field', heroType: 'bubble', stepKind: 'bubble-field',
      x: 360, y: 520, radius: 130, age: 0.4, duration: 2,
    },
    {
      uid: 'beam', type: 'beam', heroUid: 'dynamic-hero', heroType: 'needle',
      stepKind: 'crystal-beam', age: 0.3, duration: 1.8,
      originX: 300, originY: 760, endX: 540, endY: 310,
      directionX: 0.47, directionY: -0.88, length: 510, width: 18, followHero: true,
    },
    {
      uid: 'wave', type: 'wave', heroType: 'dew', stepKind: 'dew-wave',
      originX: 240, originY: 700, previousX: 240, previousY: 640,
      x: 240, y: 610, directionX: 0, directionY: -1,
      speed: 320, width: 104, age: 0.28, duration: 1.2,
    },
  ];
  assets.requests.length = 0;
  canvas.context.calls.length = 0;
  game.resetSkillRenderBudget();
  game.drawHeroSkillActors(canvas.context, 'back');
  game.drawHeroSkillActors(canvas.context, 'front');
  assert.ok(canvas.context.calls.filter(([kind]) => kind === 'stroke').length >= 9,
    'beam, field, and wave use continuously drawn strokes');
  assert.ok(canvas.context.calls.some(([kind, , , radius]) => kind === 'arc' && radius > 120),
    'the field reaches its real gameplay radius');
  assert.ok(canvas.context.calls.some(([kind]) => kind === 'quadraticCurveTo'),
    'the travelling wave has a curved crest');
  assert.ok(canvas.context.calls.filter(([kind]) => kind === 'drawImage').length >= 7,
    'field orbs, beam endpoints, and the wave head use formal generated components');
  const beamAngle = Math.atan2(310 - (760 - 24), 540 - 300);
  assert.ok(Math.abs(rotationBeforeAsset(
    canvas.context.calls,
    'effect-skill-crystal-laser-emitter-v1',
  ) - beamAngle) < 1e-9, 'the right-facing laser emitter rotates directly onto the beam');
  assert.ok(Math.abs(rotationBeforeAsset(
    canvas.context.calls,
    'effect-skill-dew-wave-crest-v1',
  ) - (-Math.PI / 2)) < 1e-9, 'the right-facing wave crest rotates onto its travel direction');
  assert.equal(assets.requests.some((key) => retiredSkillSheets.includes(key)), false,
    'runtime skill actors never request the retired nine-frame sheets');

  const earlyBeam = game.state.heroSkillActors[1];
  earlyBeam.age = 0.02;
  canvas.context.calls.length = 0;
  game.resetSkillRenderBudget();
  game.drawHeroSkillActors(canvas.context, 'front');
  const earlyReach = Math.max(...canvas.context.calls
    .filter(([kind]) => kind === 'lineTo')
    .map(([, x]) => x));
  earlyBeam.age = 0.3;
  canvas.context.calls.length = 0;
  game.resetSkillRenderBudget();
  game.drawHeroSkillActors(canvas.context, 'front');
  const fullReach = Math.max(...canvas.context.calls
    .filter(([kind]) => kind === 'lineTo')
    .map(([, x]) => x));
  assert.ok(fullReach > earlyReach + 50, 'the beam grows toward its endpoint over time');

  canvas.context.calls.length = 0;
  game.resetSkillRenderBudget();
  game.drawShot(canvas.context, {
    uid: 'berry-skill-shot', sourceKind: 'hero-skill', heroType: 'berry',
    type: 'berry', x: 360, y: 420, targetX: 490, targetY: 300,
    age: 0.25, maxAge: 1, splashRadius: 76,
  });
  assert.ok(canvas.context.calls.filter(([kind]) => kind === 'ellipse').length >= 3,
    'the authored bomb flies along several continuously drawn trail pieces');
  assert.ok(assets.requests.includes('effect-skill-berry-bomb-v1'));
  assert.ok(canvas.context.calls.some(([kind, asset]) => (
    kind === 'drawImage' && asset?.kind === 'effect-skill-berry-bomb-v1'
  )), 'the flying bomb itself is the formal generated component');
  const projectileAngle = Math.atan2(300 - 420, 490 - 360);
  assert.ok(Math.abs(rotationBeforeAsset(
    canvas.context.calls,
    'effect-skill-berry-bomb-v1',
  ) - (projectileAngle - Math.PI / 2)) < 1e-9,
  'the berry cap points behind the bomb while it flies');

  canvas.context.calls.length = 0;
  game.state.effects = [{
    uid: 'berry-impact', type: 'hero-skill-impact', heroType: 'berry',
    stepKind: 'berry-bomb-finale', x: 490, y: 300,
    radius: 76, age: 0.18, duration: 0.48,
  }];
  game.resetSkillRenderBudget();
  game.drawEffects(canvas.context);
  assert.ok(canvas.context.calls.filter(([kind]) => kind === 'stroke').length >= 7,
    'impact is a growing ring plus radial rays instead of another full-frame picture');
  assert.ok(assets.requests.includes('effect-skill-berry-burst-v1'));

  for (const sample of [
    {
      heroType: 'shell', stepKind: 'shell-quake',
      assetKey: 'effect-skill-shell-impact-v1',
    },
    {
      heroType: 'bubble', stepKind: 'bubble-burst',
      assetKey: 'effect-skill-bubble-burst-v1',
    },
    {
      heroType: 'sprout', stepKind: 'sprout-root-burst',
      assetKey: 'effect-skill-sprout-thorn-v1',
    },
  ]) {
    game.resetSkillRenderBudget();
    game.drawHeroSkillStep(canvas.context, {
      uid: `step-${sample.heroType}`,
      type: 'hero-skill-step',
      heroType: sample.heroType,
      stepKind: sample.stepKind,
      x: 360,
      y: 430,
      radius: 110,
      stage: 3,
      age: 0.16,
      duration: 0.6,
    }, 0.28);
    assert.ok(assets.requests.includes(sample.assetKey),
      `${sample.stepKind} requests ${sample.assetKey}`);
  }

  for (const key of skillComponents) {
    assert.ok(assets.requests.includes(key), `${key} is requested by its matching mechanism`);
  }
  assert.equal(assets.requests.includes('effect-projectile-berry'), false,
    'the berry projectile has no unregistered legacy fallback key');
  assert.equal(assets.requests.some((key) => retiredSkillSheets.includes(key)), false);

  game.state.effects = [
    {
      uid: 'ground-shell', type: 'hero-skill-step', heroType: 'shell',
      stepKind: 'shell-quake', x: 300, y: 700, radius: 120,
      stage: 2, age: 0.18, duration: 0.6,
    },
    {
      uid: 'ground-sprout', type: 'hero-skill-step', heroType: 'sprout',
      stepKind: 'sprout-burst', x: 380, y: 620, radius: 110,
      stage: 2, age: 0.18, duration: 0.6,
    },
    {
      uid: 'ground-bubble', type: 'hero-skill-step', heroType: 'bubble',
      stepKind: 'bubble-field', x: 340, y: 500, radius: 145,
      stage: 1, age: 0.18, duration: 1.6,
    },
    {
      uid: 'front-impact', type: 'hero-skill-impact', heroType: 'berry',
      stepKind: 'berry-bomb-finale', x: 460, y: 340, radius: 74,
      stage: 3, age: 0.18, duration: 0.62,
    },
  ];
  assets.requests.length = 0;
  game.resetSkillRenderBudget();
  game.drawEffects(canvas.context, 'back');
  assert.ok(assets.requests.includes('effect-skill-shell-impact-v1'));
  assert.ok(assets.requests.includes('effect-skill-sprout-thorn-v1'));
  assert.ok(assets.requests.includes('effect-skill-bubble-orb-v1'));
  assert.equal(assets.requests.includes('effect-skill-berry-burst-v1'), false,
    'front impact art is not painted below the actors');

  assets.requests.length = 0;
  game.resetSkillRenderBudget();
  game.drawEffects(canvas.context, 'front');
  assert.deepEqual(assets.requests, ['effect-skill-berry-burst-v1'],
    'only the impact explosion stays in the character front layer');

  const animatedSkillSamples = [
    {
      heroType: 'bell', assetKey: 'skill-bell-sonic-ring-icon',
      draw: (time) => game.drawSkillImpact(canvas.context, {
        uid: 'bell-impact', heroType: 'bell', stepKind: 'bell-sonic-ring',
        x: 360, y: 430, radius: 145, age: time, duration: 1,
      }, time),
    },
    {
      heroType: 'drill', assetKey: 'skill-drill-rupture-dash-icon',
      draw: (time) => game.drawSkillWave(canvas.context, {
        uid: 'drill-wave', type: 'wave', heroType: 'drill', stepKind: 'drill-rupture',
        x: 390, y: 520, previousX: 330, previousY: 540,
        directionX: 0.95, directionY: -0.31, speed: 760, width: 84,
        age: time, duration: 0.9,
      }),
    },
    {
      heroType: 'ember', assetKey: 'skill-ember-scorch-line-icon',
      draw: (time) => game.drawSkillField(canvas.context, {
        uid: 'ember-field', type: 'field', heroType: 'ember', stepKind: 'ember-scorch-field',
        x: 360, y: 480, radius: 135, age: time, duration: 2.4,
      }),
    },
    {
      heroType: 'ink', assetKey: 'skill-ink-cone-burst-icon',
      draw: (time) => game.drawSkillProjectile(canvas.context, {
        uid: 'ink-shot', sourceKind: 'hero-skill', heroType: 'ink', type: 'berry',
        x: 380, y: 480, targetX: 520, targetY: 330, speed: 520,
        age: time, maxAge: 1,
      }, -0.82),
    },
    {
      heroType: 'cloud', assetKey: 'skill-cloud-vortex-icon',
      draw: (time) => game.drawSkillField(canvas.context, {
        uid: 'cloud-field', type: 'field', heroType: 'cloud', stepKind: 'cloud-vortex',
        x: 360, y: 480, radius: 145, age: time, duration: 3,
      }),
    },
    {
      heroType: 'frost', assetKey: 'skill-frost-shard-lane-icon',
      draw: (time) => game.drawSkillWave(canvas.context, {
        uid: 'frost-wave', type: 'wave', heroType: 'frost', stepKind: 'frost-shard-lane',
        x: 370, y: 500, previousX: 330, previousY: 555,
        directionX: 0.59, directionY: -0.81, speed: 570, width: 112,
        age: time, duration: 1,
      }),
    },
    {
      heroType: 'honey', assetKey: 'skill-honey-cluster-icon',
      draw: (time) => game.drawSkillProjectile(canvas.context, {
        uid: 'honey-shot', sourceKind: 'hero-skill', heroType: 'honey', type: 'berry',
        x: 380, y: 480, targetX: 500, targetY: 340, speed: 470,
        age: time, maxAge: 1,
      }, -0.86),
    },
    {
      heroType: 'spark', assetKey: 'skill-spark-chain-arc-icon',
      draw: (time) => game.drawSkillBeam(canvas.context, {
        uid: 'spark-beam', type: 'beam', heroType: 'spark', stepKind: 'spark-chain-beam',
        originX: 280, originY: 720, endX: 510, endY: 310,
        directionX: 0.49, directionY: -0.87, length: 470, width: 42,
        age: time, duration: 0.9,
      }),
    },
    {
      heroType: 'star', assetKey: 'skill-star-orbit-barrage-icon',
      draw: (time) => game.drawSkillProjectile(canvas.context, {
        uid: 'star-shot', sourceKind: 'hero-skill', heroType: 'star', type: 'berry',
        x: 380, y: 480, targetX: 530, targetY: 320, speed: 560,
        age: time, maxAge: 1,
      }, -0.82),
    },
  ];
  for (const sample of animatedSkillSamples) {
    const captureFrame = (time) => {
      assets.requests.length = 0;
      canvas.context.calls.length = 0;
      game.resetSkillRenderBudget();
      sample.draw(time);
      const imageCalls = canvas.context.calls.filter(([kind, asset]) => (
        kind === 'drawImage' && asset?.kind === sample.assetKey
      ));
      assert.ok(assets.requests.includes(sample.assetKey),
        `${sample.heroType} requests its formal skill artwork in the world`);
      assert.ok(imageCalls.length >= 3,
        `${sample.heroType} animates a sequence of authored components`);
      return imageCalls.map((call) => call.slice(2));
    };
    const earlyFrame = captureFrame(0.18);
    const laterFrame = captureFrame(0.47);
    assert.notDeepEqual(laterFrame, earlyFrame,
      `${sample.heroType} changes authored component placement or scale over time`);
  }

  for (const key of expandedSkillComponents) {
    assert.ok(assets.available.has(key), `${key} is a production asset, not a fallback`);
  }
  game.dispose();
});

test('reinforcement squads and turrets use animated authored projectile atlas trails', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  const atlasKey = 'effect-reinforcement-projectiles-atlas-v1';
  const assets = createAssetStore([atlasKey]);
  game.setAssetStore(assets);
  const samples = [
    [{ sourceKind: 'squad', squadType: 'spore-lobber' }, [0, 0, 768, 512]],
    [{ sourceKind: 'turret', turretType: 'spore-bomber' }, [0, 0, 768, 512]],
    [{ sourceKind: 'turret', turretType: 'gale-fan' }, [768, 0, 768, 512]],
    [{ sourceKind: 'squad', squadType: 'volt-orbiter' }, [0, 512, 768, 512]],
    [{ sourceKind: 'turret', turretType: 'thunder-prism' }, [768, 512, 768, 512]],
  ];

  for (const [identity, sourceRect] of samples) {
    assets.requests.length = 0;
    canvas.context.calls.length = 0;
    game.drawShot(canvas.context, {
      uid: `shot-${identity.squadType || identity.turretType}`,
      ...identity,
      type: 'needle', x: 180, y: 520, targetX: 420, targetY: 340,
      age: 0.18, star: 1,
    });
    assert.deepEqual(assets.requests, [atlasKey]);
    const imageCalls = canvas.context.calls.filter(([kind, asset]) => (
      kind === 'drawImage' && asset?.kind === atlasKey
    ));
    assert.equal(imageCalls.length, 4,
      `${identity.squadType || identity.turretType} has three formal trail ghosts and a head`);
    for (const call of imageCalls) assert.deepEqual(call.slice(2, 6), sourceRect);
    assert.equal(canvas.context.calls.filter(([kind]) => kind === 'rotate').length, 4);
  }

  const frameTransform = (age) => {
    canvas.context.calls.length = 0;
    game.drawShot(canvas.context, {
      uid: 'animated-volt', sourceKind: 'squad', squadType: 'volt-orbiter',
      type: 'needle', x: 220, y: 510, targetX: 510, targetY: 320, age,
    });
    return {
      headPosition: canvas.context.calls.filter(([kind]) => kind === 'translate').at(-1),
      headRotation: canvas.context.calls.filter(([kind]) => kind === 'rotate').at(-1),
    };
  };
  assert.notDeepEqual(frameTransform(0.12), frameTransform(0.38),
    'the formal projectile advances its bob and rotation every frame');

  game.setAssetStore(createAssetStore([]));
  canvas.context.calls.length = 0;
  game.drawShot(canvas.context, {
    uid: 'missing-spore', sourceKind: 'squad', squadType: 'spore-lobber',
    type: 'berry', x: 200, y: 480, targetX: 420, targetY: 300, age: 0.2,
  });
  assert.equal(canvas.context.calls.some(([kind]) => kind === 'drawImage'), false,
    'a missing reinforcement atlas stays empty instead of borrowing a legacy projectile');
  assert.equal(canvas.context.calls.some(([kind]) => kind === 'ellipse'), false);
  game.dispose();
});

test('new enemy ranged and charge effects animate cells from the projectile atlas', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  const atlasKey = 'effect-reinforcement-projectiles-atlas-v1';
  const assets = createAssetStore([atlasKey]);
  game.setAssetStore(assets);
  game.state.effects = [
    {
      uid: 'lantern-shot', type: 'enemy-ranged-shot', enemyType: 'lantern',
      x: 140, y: 280, targetX: 390, targetY: 620, age: 0.12, duration: 0.46, phase: 0.26,
    },
    {
      uid: 'rift-shot', type: 'enemy-ranged-shot', enemyType: 'rift-boss',
      x: 560, y: 250, targetX: 330, targetY: 680, age: 0.2, duration: 0.46, phase: 0.44,
    },
    {
      uid: 'charge-start', type: 'enemy-charge-start', enemyType: 'thorn',
      x: 260, y: 420, age: 0.14, duration: 0.42, phase: 0.33,
    },
    {
      uid: 'charge-impact', type: 'enemy-charge-impact', enemyType: 'thorn',
      x: 300, y: 560, age: 0.18, duration: 0.5, phase: 0.36,
    },
  ];
  game.drawEffects(canvas.context, 'front');
  assert.deepEqual(assets.requests, [atlasKey, atlasKey, atlasKey, atlasKey]);
  const sourceRects = canvas.context.calls
    .filter(([kind, asset]) => kind === 'drawImage' && asset?.kind === atlasKey)
    .map((call) => call.slice(2, 6));
  assert.ok(sourceRects.some((rect) => rect.join() === '0,0,768,512'),
    'lantern uses the formal spore projectile');
  assert.ok(sourceRects.some((rect) => rect.join() === '768,512,768,512'),
    'rift boss uses the formal thunder projectile');
  assert.ok(sourceRects.some((rect) => rect.join() === '768,0,768,512'),
    'charge start and impact use the formal gale sequence');

  const rangedPosition = (phase) => {
    assets.requests.length = 0;
    canvas.context.calls.length = 0;
    game.state.effects = [{
      uid: 'moving-lantern-shot', type: 'enemy-ranged-shot', enemyType: 'lantern',
      x: 100, y: 300, targetX: 500, targetY: 700,
      age: phase * 0.46, duration: 0.46, phase,
    }];
    game.drawEffects(canvas.context, 'front');
    return canvas.context.calls.filter(([kind]) => kind === 'translate').at(-1);
  };
  const early = rangedPosition(0.15);
  const late = rangedPosition(0.78);
  assert.ok(late[1] > early[1] + 200 && late[2] > early[2] + 200,
    'the authored enemy projectile follows source to target using effect progress');
  game.dispose();
});

test('moving enemies play hurt bones and leave a temporary skeletal death actor', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  game.state.screen = 'battle';
  game.state.hand = [];
  game.state.towers = [];
  game.state.enemies = [{
    uid: 'animated-enemy',
    type: 'windcap',
    x: 320,
    y: 260,
    facing: -1,
    hp: 10,
    maxHp: 10,
  }];

  game.updateCharacterAnimations(0.12);
  let entry = game.characterAnimations.get('enemy:animated-enemy');
  assert.equal(entry.controller.baseName, 'move');
  assert.equal(transformHasMotion(entry.controller.sample().cap), true);

  game.processCharacterAnimationEvent({
    type: 'enemy-hit', enemyUid: 'animated-enemy', enemyType: 'windcap',
  });
  game.updateCharacterAnimations(0.08);
  entry = game.characterAnimations.get('enemy:animated-enemy');
  assert.equal(entry.controller.actionName, 'hurt');
  assert.equal(transformHasMotion(entry.controller.sample().cap), true);
  assert.equal(entry.expressionMixer.sample().to, 'hurt');

  game.processCharacterAnimationEvent({
    type: 'enemy-defeat',
    enemyUid: 'animated-enemy',
    enemyType: 'windcap',
    x: 320,
    y: 260,
    facing: -1,
  });
  game.state.enemies = [];
  game.updateCharacterAnimations(0.1);
  assert.equal(game.defeatedActors.length, 1);
  const deathEntry = game.characterAnimations.get('defeated:animated-enemy');
  assert.equal(deathEntry.controller.actionName, 'death');
  assert.equal(transformHasMotion(deathEntry.controller.sample().cap), true);
  assert.equal(deathEntry.expressionMixer.sample().to, 'hurt');

  for (let index = 0; index < 12; index += 1) game.updateCharacterAnimations(0.05);
  assert.equal(game.defeatedActors.length, 0);
  assert.equal(game.characterAnimations.has('defeated:animated-enemy'), false);
  game.dispose();
});

test('ranged enemies attack with their authored clip and roster portraits sample the advanced preview', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  game.state.screen = 'battle';
  game.state.enemies = [{
    uid: 'ranged-enemy', type: 'lantern', x: 320, y: 260,
    facing: 1, hp: 100, maxHp: 100, hitPulse: 0,
  }];
  game.processCharacterAnimationEvent({
    type: 'enemy-ranged-attack', enemyUid: 'ranged-enemy', enemyType: 'lantern',
  });
  assert.equal(game.characterAnimations.get('enemy:ranged-enemy').controller.actionName, 'attack');

  game.state.hero = { uid: 'skill-hero', type: 'berry', hp: 100, maxHp: 100 };
  game.processCharacterAnimationEvent({
    type: 'hero-skill-step', heroUid: 'skill-hero', heroType: 'berry', stepIndex: 1,
  });
  assert.equal(game.characterAnimations.get('hero:skill-hero').controller.actionName, 'skill',
    'later authored skill beats replay the dedicated expression instead of returning to idle');

  game.state.screen = 'menu';
  game.menuPage = 'roster';
  game.updateCharacterAnimations(0.12);
  const preview = game.characterAnimations.get('preview:menu:shell');
  assert.ok(preview, 'the roster update advances its shared hero preview controller');
  game.drawRosterHeroPortrait(canvas.context, 'shell', 180, 320, 100);
  assert.equal(game.characterAnimations.get('preview:menu:shell'), preview,
    'the portrait samples the same controller that the frame updater advanced');
  assert.equal(game.characterAnimations.has('preview:roster:shell'), false,
    'no frozen parallel roster controller is created');
  game.dispose();
});

test('moving heroes and squads use their move clips instead of sliding in idle', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  game.render();
  click(game, canvas, hitCenter(game, 'start-story'));
  game.render();
  click(game, canvas, hitCenter(game, 'select-stage-1'));

  game.state.hero.moveX = 1;
  game.state.hero.moveY = 0;
  game.state.towers = [{
    uid: 'moving-squad', kind: 'soldier', type: 'melee', squadType: 'melee',
    aliveMembers: 4, star: 1, padIndex: 0, x: 88, y: 260, moving: true,
  }];
  game.updateCharacterAnimations(0.12);
  game.render();

  const heroKey = [...game.characterAnimations.keys()].find((key) => key.startsWith('hero:'));
  assert.ok(heroKey);
  assert.equal(
    game.characterAnimations.get(heroKey).controller.baseName,
    'move',
  );
  for (let memberIndex = 0; memberIndex < 4; memberIndex += 1) {
    assert.equal(
      game.characterAnimations.get(`squad:moving-squad:${memberIndex}`).controller.baseName,
      'move',
    );
  }

  game.state.hero.moveX = 0;
  game.state.towers[0].moving = false;
  game.updateCharacterAnimations(0.12);
  game.render();
  assert.equal(
    game.characterAnimations.get(heroKey).controller.baseName,
    'idle',
  );
  assert.equal(
    game.characterAnimations.get('squad:moving-squad:0').controller.baseName,
    'idle',
  );
  game.dispose();
});

test('presentation smoothing covers actors, shots, waves, turret aim, and facing without changing combat state', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  game.state.screen = 'battle';
  game.state.phase = 'combat';
  game.state.waveActive = true;
  game.state.tutorial.active = false;
  game.state.hand = [];
  game.state.hero = {
    uid: 'smooth-hero', type: 'shell', hp: 100, maxHp: 100,
    x: 300, y: 720, moveX: 1, moveY: 0, facing: 1, attackPulse: 1, hitPulse: 0,
  };
  const squad = {
    uid: 'smooth-squad', kind: 'soldier', type: 'melee', squadType: 'melee',
    deployX: 240, deployY: 620, x: 240, y: 620, facing: 1, moving: true,
    members: [{
      uid: 'smooth-member', memberIndex: 0, x: 240, y: 620,
      hp: 20, facing: 1, moving: true, attackPulse: 1, hitPulse: 0,
    }],
  };
  const enemy = {
    uid: 'smooth-enemy', type: 'bug', x: 340, y: 310,
    hp: 40, maxHp: 40, facing: 1, hitPulse: 0, travelled: 0,
  };
  const normalShot = {
    uid: 'smooth-normal-shot', sourceKind: 'hero', type: 'needle',
    x: 310, y: 670, targetX: 440, targetY: 330, speed: 400, age: 0.2, star: 1,
  };
  const skillShot = {
    uid: 'smooth-skill-shot', sourceKind: 'hero-skill', heroType: 'berry',
    type: 'berry', x: 320, y: 660, targetX: 450, targetY: 320,
    speed: 420, age: 0.2, maxAge: 2,
  };
  const wave = {
    uid: 'smooth-wave', type: 'wave', heroType: 'dew',
    x: 280, y: 590, previousX: 280, previousY: 596,
    directionX: 0, directionY: -1, speed: 320, width: 90,
    age: 0.2, duration: 1,
  };
  const turret = {
    uid: 'smooth-turret', type: 'gale-fan', slotIndex: 0,
    aimAngle: Math.PI - 0.04, hp: 100, maxHp: 100, attackPulse: 0,
  };
  game.state.turretSlots = [{ id: 'smooth-slot', x: 180, y: 914, type: 'gale-fan' }];
  game.state.turrets = [turret];

  const drawTrackedObjects = () => {
    game.drawBattleHero(canvas.context);
    game.drawSquadMembers(canvas.context, squad, squad.x, squad.y);
    game.drawEnemy(canvas.context, enemy);
    game.drawShot(canvas.context, normalShot);
    game.drawShot(canvas.context, skillShot);
    game.drawSkillWave(canvas.context, wave);
    game.drawTurretSlots(canvas.context, TD_STAGES[0]);
  };

  game.beginVisualFrame(0);
  drawTrackedObjects();
  game.endVisualFrame();

  const starts = new Map([
    ['hero:smooth-hero', game.visualMotion.get('hero:smooth-hero').x],
    ['unit:squad:smooth-squad:smooth-member',
      game.visualMotion.get('unit:squad:smooth-squad:smooth-member').x],
    ['enemy:smooth-enemy', game.visualMotion.get('enemy:smooth-enemy').x],
    ['projectile:smooth-normal-shot', game.visualMotion.get('projectile:smooth-normal-shot').x],
    ['projectile:smooth-skill-shot', game.visualMotion.get('projectile:smooth-skill-shot').x],
    ['skill-actor:smooth-wave', game.visualMotion.get('skill-actor:smooth-wave').x],
  ]);
  game.state.hero.x += 6;
  game.state.hero.facing = -1;
  game.state.hero.moveX = -1;
  squad.members[0].x += 6;
  squad.members[0].facing = -1;
  enemy.x += 6;
  enemy.facing = -1;
  normalShot.x += 6;
  normalShot.age += 1 / 60;
  skillShot.x += 6;
  skillShot.age += 1 / 60;
  wave.previousX = wave.x;
  wave.previousY = wave.y;
  wave.x += 6;
  wave.age += 1 / 60;
  turret.aimAngle = -Math.PI + 0.04;
  const simulationSnapshot = JSON.stringify({
    hero: game.state.hero,
    member: squad.members[0],
    enemy,
    normalShot,
    skillShot,
    wave,
    turret,
  });

  game.beginVisualFrame(1 / 60);
  drawTrackedObjects();
  const heroPointAfterFirstDraw = game.visualMotion.get('hero:smooth-hero').x;
  game.drawBattleHero(canvas.context);
  assert.equal(game.visualMotion.get('hero:smooth-hero').x, heroPointAfterFirstDraw,
    'drawing the same object twice in one frame never advances its smoothing twice');
  game.endVisualFrame();

  const targets = new Map([
    ['hero:smooth-hero', game.state.hero.x],
    ['unit:squad:smooth-squad:smooth-member', squad.members[0].x],
    ['enemy:smooth-enemy', enemy.x],
    ['projectile:smooth-normal-shot', normalShot.x],
    ['projectile:smooth-skill-shot', skillShot.x],
    ['skill-actor:smooth-wave', wave.x],
  ]);
  for (const [key, startX] of starts) {
    const renderedX = game.visualMotion.get(key).x;
    assert.ok(renderedX > startX && renderedX < targets.get(key),
      `${key} advances between its previous and deterministic simulation positions`);
  }
  assert.equal(game.visualFacingState.get('hero:smooth-hero').facing, 1);
  assert.equal(game.visualFacingState.get('unit:squad:smooth-squad:smooth-member').facing, 1);
  assert.equal(game.visualFacingState.get('enemy:smooth-enemy').facing, 1,
    'one opposing frame cannot flicker any character atlas');
  const smoothedTurretAim = game.visualAimState.get('turret:smooth-turret').angle;
  const turretAimStep = Math.atan2(
    Math.sin(smoothedTurretAim - (Math.PI - 0.04)),
    Math.cos(smoothedTurretAim - (Math.PI - 0.04)),
  );
  assert.ok(turretAimStep > 0 && turretAimStep < 0.08,
    'turret aim takes the short path across the -PI/PI seam');
  assert.equal(JSON.stringify({
    hero: game.state.hero,
    member: squad.members[0],
    enemy,
    normalShot,
    skillShot,
    wave,
    turret,
  }), simulationSnapshot, 'presentation sampling never writes back into combat entities');

  for (let index = 0; index < 3; index += 1) {
    game.beginVisualFrame(1 / 60);
    game.drawBattleHero(canvas.context);
    game.drawSquadMembers(canvas.context, squad, squad.x, squad.y);
    game.drawEnemy(canvas.context, enemy);
    game.endVisualFrame();
  }
  assert.equal(game.visualFacingState.get('hero:smooth-hero').facing, -1);
  assert.equal(game.visualFacingState.get('unit:squad:smooth-squad:smooth-member').facing, -1);
  assert.equal(game.visualFacingState.get('enemy:smooth-enemy').facing, -1,
    'a sustained turn is accepted after the short confirmation window');

  for (let index = 0; index < 3; index += 1) {
    game.beginVisualFrame(1 / 60);
    game.endVisualFrame();
  }
  assert.equal(game.visualMotion.size, 0);
  assert.equal(game.visualAimState.size, 0);
  assert.equal(game.visualFacingState.size, 0,
    'objects absent for three presentation frames leave no stale cache entries');

  const newShot = {
    uid: 'new-shot', x: 106, y: 500, targetX: 300, targetY: 500,
    speed: 360, age: 1 / 60,
  };
  game.beginVisualFrame(1 / 60);
  const newShotPoint = game.visualProjectilePoint(newShot);
  game.endVisualFrame();
  assert.ok(newShotPoint.x > 100 && newShotPoint.x < newShot.x,
    'a projectile born and advanced in one simulation tick still presents from its launch path');

  game.state.events.push({ type: 'wave-start' });
  game.processEvents();
  assert.equal(game.visualMotion.size, 0,
    'wave transitions clear presentation history before entities reset to authored spawns');
  game.dispose();
});

test('a stationary hero accepts a sustained reverse facing while casting a skill', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  game.state.screen = 'battle';
  game.state.hero = {
    uid: 'stationary-skill-facing', type: 'berry', hp: 100, maxHp: 100,
    x: 360, y: 720, moveX: 0, moveY: 0, facing: 1,
    attackPulse: 0, skillPulse: 0, hitPulse: 0,
  };

  game.beginVisualFrame(0);
  game.drawBattleHero(canvas.context);
  game.endVisualFrame();
  game.state.hero.facing = -1;
  game.state.hero.skillPulse = 1;

  game.beginVisualFrame(1 / 60);
  game.drawBattleHero(canvas.context);
  game.endVisualFrame();
  assert.equal(game.visualFacingState.get('hero:stationary-skill-facing').facing, 1,
    'one casting frame still cannot flicker the hero atlas');

  for (let index = 0; index < 3; index += 1) {
    game.beginVisualFrame(1 / 60);
    game.drawBattleHero(canvas.context);
    game.endVisualFrame();
  }
  assert.equal(game.visualFacingState.get('hero:stationary-skill-facing').facing, -1,
    'skillPulse keeps the confirmation window active even without movement or a basic attack');
  game.dispose();
});

test('a defeated squad animates only its final member instead of restoring four ghosts', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  game.state.screen = 'battle';
  game.state.towers = [{
    uid: 'fallen-squad',
    kind: 'soldier',
    type: 'melee',
    squadType: 'melee',
    aliveMembers: 0,
    star: 1,
    padIndex: 0,
    x: 300,
    y: 240,
    facing: -1,
  }];
  game.processCharacterAnimationEvent({
    type: 'tower-defeat',
    towerUid: 'fallen-squad',
    towerType: 'melee',
    star: 1,
    padIndex: 0,
    x: 300,
    y: 240,
  });

  assert.equal(game.defeatedTowers.length, 1);
  const actor = game.defeatedTowers[0];
  const deathEntry = game.characterAnimations.get(actor.key);
  assert.equal(actor.squadType, 'melee');
  assert.equal(actor.facing, -1);
  assert.equal(deathEntry.controller.actionName, 'downed');
  assert.equal(deathEntry.expressionMixer.spec, SOLDIER_RIG.expression);

  let formationDraws = 0;
  game.drawSquadMembers = () => { formationDraws += 1; };
  game.drawDefeatedTowers(canvas.context);
  assert.equal(formationDraws, 0);
  game.dispose();
});

test('squad rendering keeps independent coordinates and seats every soldier lower in its grid cell', () => {
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = createContext();
      this.context.canvas = this;
    }
    getContext() { return this.context; }
  };
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  game.setAssetStore(createAssetStore(['soldier-shield-dun-atlas-v1']));
  try {
  game.state.screen = 'battle';
  const translations = [];
  canvas.context.translate = (x, y) => translations.push([x, y]);
  game.drawSquadMembers(canvas.context, {
    uid: 'independent-squad',
    squadType: 'melee',
    aliveMembers: 4,
    deployX: 500,
    deployY: 600,
    members: [
      { uid: 'front', x: 111, y: 222, hp: 20, facing: 1, moving: true },
      { uid: 'downed', x: 222, y: 333, hp: 0, facing: -1 },
      { uid: 'rear', x: 444, y: 555, hp: 12, facing: -1 },
    ],
  }, 500, 600);

  assert.ok(translations.some(([x, y]) => x === 111 && y === 238));
  assert.ok(translations.some(([x, y]) => x === 444 && y === 571));
  assert.equal(translations.some(([x, y]) => x === 222 && y === 349), false,
    'downed independent members are not rendered');
  assert.equal(translations.some(([x, y]) => x === 482 && y === 596), false,
    'the legacy four-member formation is not used when members are authored');
  assert.ok(game.characterAnimations.has('squad:independent-squad:front'));
  assert.ok(game.characterAnimations.has('squad:independent-squad:rear'));

  translations.length = 0;
  game.drawSquadMembers(canvas.context, {
    uid: 'dragged-squad',
    squadType: 'melee',
    deployX: 500,
    deployY: 600,
    members: [{ uid: 'dragged-front', memberIndex: 0, x: 511, y: 622, hp: 20 }],
  }, 700, 800, { anchorIndependentMembers: true });
  assert.ok(translations.some(([x, y]) => x === 711 && y === 838),
    'long-press previews preserve offsets and the shared lower grid anchor');

  translations.length = 0;
  game.drawSquadMembers(canvas.context, {
    uid: 'legacy-fallback-squad',
    squadType: 'melee',
    aliveMembers: 1,
  }, 300, 400);
  assert.ok(translations.some(([x, y]) => x === 300 && y === 435),
    'the compatibility formation keeps its old 13px baseline and moves 16px lower');
  } finally {
    game.dispose();
    if (previousOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousOffscreenCanvas;
  }
});

test('soldiers render larger without battlefield health bars', () => {
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = createContext();
      this.context.canvas = this;
    }
    getContext() { return this.context; }
  };
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  game.setAssetStore(createAssetStore(['soldier-shield-dun-atlas-v1']));
  try {
  game.state.screen = 'battle';
  game.state.phase = 'prep';
  game.state.tutorial.active = false;

  const scales = [];
  canvas.context.scale = (x, y) => scales.push([x, y]);
  game.drawSquadMembers(canvas.context, {
    uid: 'large-squad',
    kind: 'soldier',
    type: 'melee',
    squadType: 'melee',
    aliveMembers: 1,
    members: [{ uid: 'large-member', memberIndex: 0, x: 200, y: 300, hp: 20 }],
  }, 200, 300);
  assert.ok(scales.some(([x, y]) => Math.abs(x) >= 0.52 && Math.abs(y) >= 0.52),
    'battle soldiers use the enlarged 52px render size');
  scales.length = 0;
  game.drawSquadPurchasePreview(canvas.context, {
    x: 12, y: 1104, width: 156, height: 164,
  }, 'melee');
  assert.ok(scales.some(([x, y]) => Math.abs(x) >= 0.42 && Math.abs(y) >= 0.42),
    'purchase previews are enlarged with the battlefield soldiers');
  scales.length = 0;
  game.defeatedTowers = [{
    key: 'defeated-large-member', ownerId: 'soldier-shield-dun', type: 'shell',
    squadType: 'melee', x: 240, y: 320, facing: 1, age: 0, duration: 1,
  }];
  game.drawDefeatedTowers(canvas.context);
  assert.ok(scales.some(([x, y]) => Math.abs(x) >= 0.52 && Math.abs(y) >= 0.52),
    'downed soldier art keeps the same enlarged size');

  const healthBarColor = 'rgba(30, 48, 58, 0.64)';
  let healthBarFills = 0;
  canvas.context.fill = () => {
    if (canvas.context.fillStyle === healthBarColor) healthBarFills += 1;
  };
  const pad = { x: 88, y: 270, laneIndex: 0, rowIndex: 0 };
  game.state.towers = [{
    uid: 'squad-no-health-bar', kind: 'soldier', type: 'melee', squadType: 'melee',
    padIndex: 0, x: pad.x, y: pad.y, hp: 120, maxHp: 288, aliveMembers: 1,
    members: [{ uid: 'member', x: pad.x, y: pad.y, hp: 20 }],
  }];
  game.drawPad(canvas.context, pad, 0);
  assert.equal(healthBarFills, 0, 'squad aggregate health is never drawn above its members');

  game.state.towers = [{
    uid: 'ordinary-tower-health', type: 'shell', padIndex: 0,
    x: pad.x, y: pad.y, hp: 80, maxHp: 100, star: 1,
  }];
  game.drawPad(canvas.context, pad, 0);
  assert.ok(healthBarFills > 0, 'the health-bar guard remains available to non-squad units');
  } finally {
    game.dispose();
    if (previousOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousOffscreenCanvas;
  }
});

test('independent squad events animate only the acting member and show its downed pose', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  game.state.screen = 'battle';
  game.state.hand = [];
  const squad = {
    uid: 'event-squad', kind: 'soldier', type: 'melee', squadType: 'melee',
    aliveMembers: 4, deployX: 300, deployY: 400,
    members: Array.from({ length: 4 }, (_, memberIndex) => ({
      uid: `event-member-${memberIndex}`,
      memberIndex,
      x: 282 + memberIndex * 12,
      y: 390 + memberIndex * 4,
      hp: 72,
      alive: true,
      moving: false,
    })),
  };
  game.state.towers = [squad];
  game.state.enemies = [];
  game.updateCharacterAnimations(0.01);

  const keyFor = (memberIndex) => `squad:event-squad:event-member-${memberIndex}`;
  game.processCharacterAnimationEvent({
    type: 'shot', towerUid: squad.uid,
    soldierUid: squad.members[2].uid, memberIndex: 2,
  });
  assert.equal(game.characterAnimations.get(keyFor(2)).controller.actionName, 'attack');
  for (const memberIndex of [0, 1, 3]) {
    assert.notEqual(game.characterAnimations.get(keyFor(memberIndex)).controller.actionName, 'attack');
  }

  game.processCharacterAnimationEvent({
    type: 'tower-hit', towerUid: squad.uid,
    soldierUid: squad.members[1].uid, memberIndex: 1,
  });
  assert.equal(game.characterAnimations.get(keyFor(1)).controller.actionName, 'hurt');
  assert.notEqual(game.characterAnimations.get(keyFor(0)).controller.actionName, 'hurt');
  assert.notEqual(game.characterAnimations.get(keyFor(3)).controller.actionName, 'hurt');

  game.processCharacterAnimationEvent({
    type: 'squad-member-down', squadUid: squad.uid, squadType: 'melee',
    soldierUid: squad.members[1].uid, memberIndex: 1,
    x: squad.members[1].x, y: squad.members[1].y, facing: -1,
  });
  assert.equal(game.defeatedTowers.length, 1);
  assert.equal(game.defeatedTowers[0].x, squad.members[1].x);
  assert.equal(
    game.characterAnimations.get(`defeated-member:${squad.members[1].uid}`).controller.actionName,
    'downed',
  );
  game.processCharacterAnimationEvent({
    type: 'tower-defeat', towerUid: squad.uid, towerType: 'melee',
    x: squad.deployX, y: squad.deployY,
  });
  assert.equal(game.defeatedTowers.length, 1,
    'the last member down event is not duplicated by the aggregate squad defeat event');
  game.dispose();
});

test('story opens stage selection with lock, clear, selectable, and back states', () => {
  const canvas = createCanvas();
  const runtime = createRuntime({
    unlockedStage: 2,
    clearedStages: ['stage-1'],
    tutorialSeen: true,
  });
  const game = new TowerDefenseGame(canvas, { runtime, pixelRatio: 1 });
  game.render();

  assert.deepEqual(game.hits.map(({ id }) => id), [
    'start-story', 'endless', 'open-roster', 'open-summon', 'audio-toggle',
  ]);
  const storyHit = game.hits.find(({ id }) => id === 'start-story');
  assert.equal(storyHit.action, 'open-stage-select');
  assert.equal(game.hits.find(({ id }) => id === 'endless').enabled, false);

  click(game, canvas, hitCenter(game, 'start-story'));
  assert.equal(game.state.screen, 'menu');
  assert.equal(game.menuPage, 'stage-select');
  game.render();

  const stagePageSize = 6;
  assert.deepEqual(game.hits.map(({ id }) => id), [
    'stage-select-back',
    ...TD_STAGES.slice(0, stagePageSize).map(({ index }) => `select-stage-${index}`),
    'stage-select-previous', 'stage-select-next',
    'audio-toggle',
  ]);
  assert.equal(game.hits.find(({ id }) => id === 'select-stage-1').enabled, true);
  assert.equal(game.hits.find(({ id }) => id === 'select-stage-2').enabled, true);
  assert.equal(game.hits.find(({ id }) => id === 'select-stage-3').enabled, false);
  assert.ok(canvas.context.calls.some(([kind, text]) => kind === 'fillText' && text === '✓ 已通关'));
  assert.ok(canvas.context.calls.some(([kind, text]) => kind === 'fillText' && text === '可挑战'));
  assert.ok(canvas.context.calls.some(([kind, text]) => kind === 'fillText' && text === '未解锁'));

  const seenStageIds = [];
  const stagePageCount = Math.ceil(TD_STAGES.length / stagePageSize);
  for (let page = 0; page < stagePageCount; page += 1) {
    const visibleStages = TD_STAGES.slice(
      page * stagePageSize,
      (page + 1) * stagePageSize,
    );
    const stageHits = visibleStages.map(({ index }) => (
      game.hits.find(({ id }) => id === `select-stage-${index}`)
    ));
    assert.equal(stageHits.every(Boolean), true, `page ${page + 1} renders every stage card`);
    stageHits.forEach((hit) => {
      seenStageIds.push(hit.id);
      assert.ok(hit.x >= 0 && hit.y >= 0);
      assert.ok(hit.x + hit.width <= 720 && hit.y + hit.height <= 1280,
        `${hit.id} remains inside the portrait stage screen`);
    });
    for (let left = 0; left < stageHits.length; left += 1) {
      for (let right = left + 1; right < stageHits.length; right += 1) {
        const a = stageHits[left];
        const b = stageHits[right];
        const overlaps = a.x < b.x + b.width && a.x + a.width > b.x
          && a.y < b.y + b.height && a.y + a.height > b.y;
        assert.equal(overlaps, false, `${a.id} and ${b.id} do not overlap`);
      }
    }
    if (page < stagePageCount - 1) {
      click(game, canvas, hitCenter(game, 'stage-select-next'));
      game.render();
    }
  }
  assert.deepEqual(seenStageIds, TD_STAGES.map(({ index }) => `select-stage-${index}`),
    'paging exposes all authored stages in order');
  while (game.stageSelectPage > 0) {
    click(game, canvas, hitCenter(game, 'stage-select-previous'));
    game.render();
  }

  click(game, canvas, hitCenter(game, 'select-stage-3'));
  assert.equal(game.state.screen, 'menu', 'a locked stage cannot be entered');
  click(game, canvas, hitCenter(game, 'stage-select-back'));
  assert.equal(game.menuPage, 'main');
  game.render();
  assert.deepEqual(game.hits.map(({ id }) => id), [
    'start-story', 'endless', 'open-roster', 'open-summon', 'audio-toggle',
  ]);

  click(game, canvas, hitCenter(game, 'start-story'));
  game.render();
  click(game, canvas, hitCenter(game, 'select-stage-2'));
  assert.equal(game.state.screen, 'battle');
  assert.equal(game.state.stageId, 'stage-2');
  assert.equal(game.state.mode, 'stage');
  game.dispose();
});

test('completed story keeps all three main menu actions and unlocks endless', () => {
  const canvas = createCanvas();
  const finalStage = TD_STAGES.at(-1);
  const runtime = createRuntime({
    unlockedStage: TD_STAGES.length,
    clearedStages: TD_STAGES.map(({ id }) => id),
    tutorialSeen: true,
  });
  const game = new TowerDefenseGame(canvas, { runtime, pixelRatio: 1 });
  game.render();

  const storyHit = game.hits.find(({ id }) => id === 'start-story');
  const endlessHit = game.hits.find(({ id }) => id === 'endless');
  assert.equal(storyHit.action, 'open-stage-select');
  assert.equal(endlessHit.enabled, true);

  click(game, canvas, hitCenter(game, 'endless'));
  assert.equal(game.state.screen, 'battle');
  assert.equal(game.state.mode, 'endless');
  assert.equal(game.state.stageId, finalStage.id);
  game.dispose();
});

test('spotlight tutorial purchases one four-member melee squad and starts the wave', () => {
  const canvas = createCanvas();
  const runtime = createRuntime();
  const game = new TowerDefenseGame(canvas, {
    runtime,
    pixelRatio: 1,
    seed: 0xCAFE,
  });
  game.render();

  click(game, canvas, hitCenter(game, 'start-story'));
  game.render();
  assert.equal(game.menuPage, 'stage-select');
  assert.equal(game.state.tutorial.step, 'stage');
  assert.equal(game.hits.find(({ id }) => id === 'select-stage-1').enabled, true);

  click(game, canvas, hitCenter(game, 'select-stage-1'));
  game.render();
  assert.equal(game.state.tutorial.step, 'squad');
  assert.equal(game.hits.find(({ id }) => id === 'purchase-melee').enabled, true);
  assert.equal(game.purchaseCategory, 'squad');
  click(game, canvas, hitCenter(game, 'purchase-category-turret'));
  assert.equal(game.purchaseCategory, 'squad',
    'the spotlight tutorial keeps its required squad category visible');

  click(game, canvas, hitCenter(game, 'purchase-ranged'));
  assert.equal(game.selectedPurchase, null, 'tutorial blocks the wrong squad choice');
  click(game, canvas, hitCenter(game, 'purchase-melee'));
  assert.equal(game.selectedPurchase, 'melee');
  game.render();
  assert.equal(game.hits.find(({ id }) => id === 'pad-0').enabled, true);
  click(game, canvas, hitCenter(game, 'pad-0'));
  assert.equal(game.state.tutorial.step, 'start');
  assert.equal(game.state.towers.length, 1);
  assert.equal(game.state.towers[0].squadType, 'melee');
  assert.equal(game.state.towers[0].squadSize, 4);
  assert.equal(game.state.towers[0].aliveMembers, 4);
  assert.equal(game.state.currency, 400);

  game.render();
  click(game, canvas, hitCenter(game, 'start-wave'));
  assert.equal(game.state.wave, 1);
  assert.equal(game.state.waveActive, true);
  assert.equal(game.state.phase, 'combat');
  assert.equal(game.state.tutorial.active, false);
  assert.equal(game.state.progress.tutorialSeen, true);
  assert.equal(runtime.values.get(TD_STORAGE_KEY).tutorialSeen, true);
  game.dispose();
});

test('battle dock purchases squads and a fixed turret, moves squads in prep, then exposes hero controls', () => {
  const canvas = createCanvas();
  let interactionTime = 0;
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
    now: () => interactionTime,
  });
  const assets = createAssetStore();
  game.setAssetStore(assets);

  game.render();
  click(game, canvas, hitCenter(game, 'start-story'));
  game.render();
  click(game, canvas, hitCenter(game, 'select-stage-1'));
  assert.equal(game.state.screen, 'battle');
  assert.equal(game.state.phase, 'prep');
  game.render();

  assert.equal(game.hits.find(({ id }) => id === 'purchase-melee').action, 'select-purchase');
  assert.equal(game.hits.find(({ id }) => id === 'purchase-ranged').action, 'select-purchase');
  assert.equal(game.hits.find(({ id }) => id === 'purchase-charger'), undefined);
  assert.equal(game.hits.find(({ id }) => id === 'purchase-leaf'), undefined,
    'unrecruited squad cards are absent from the battle purchase track');
  assert.equal(game.hits.find(({ id }) => id === 'purchase-turret'), undefined,
    'turrets stay off the squad track instead of being squeezed beside it');
  assert.equal(game.hits.find(({ id }) => id === 'purchase-category-squad').action,
    'select-purchase-category');
  assert.equal(game.hits.find(({ id }) => id === 'purchase-category-turret').action,
    'select-purchase-category');
  click(game, canvas, hitCenter(game, 'purchase-category-turret'));
  game.render();
  assert.equal(game.hits.find(({ id }) => id === 'purchase-turret').action, 'select-purchase');
  assert.equal(game.hits.find(({ id }) => id === 'purchase-bubble-coil'), undefined);
  assert.equal(game.hits.find(({ id }) => id === 'purchase-crystal-repeater'), undefined,
    'a fresh account shows only its recruited starter turret');
  click(game, canvas, hitCenter(game, 'purchase-category-squad'));
  game.render();
  assert.equal(game.hits.find(({ id }) => id === 'hero-joystick').enabled, false);
  assert.equal(game.hits.find(({ id }) => id === 'hero-skill').enabled, false);
  assert.ok(assets.requests.includes('ui-gel-energy'));
  assert.ok(assets.requests.includes('ui-card-frame-deploy'));
  assert.equal(assets.requests.includes('ui-card-melee-squad'), false);
  assert.equal(assets.requests.includes('ui-card-ranged-squad'), false);
  assert.equal(assets.requests.includes('ui-card-frame-common'), false);

  click(game, canvas, hitCenter(game, 'purchase-melee'));
  assert.equal(game.selectedPurchase, 'melee');
  game.render();
  click(game, canvas, hitCenter(game, 'pad-0'));
  assert.equal(game.selectedPurchase, null);
  assert.equal(game.state.currency, 400);
  assert.equal(game.state.towers.length, 1);
  const melee = game.state.towers[0];
  assert.deepEqual({
    kind: melee.kind,
    squadType: melee.squadType,
    squadSize: melee.squadSize,
    aliveMembers: melee.aliveMembers,
  }, {
    kind: 'soldier', squadType: 'melee', squadSize: 4, aliveMembers: 4,
  });

  game.render();
  const meleeHit = game.hits.find(({ id }) => id === `tower-${melee.uid}`);
  const frontMember = melee.members.reduce((front, member) => (
    member.y > front.y ? member : front
  ));
  const visibleFrontPoint = {
    x: frontMember.x,
    y: frontMember.y + 16 - 2,
  };
  assert.ok(
    visibleFrontPoint.x >= meleeHit.x
      && visibleFrontPoint.x <= meleeHit.x + meleeHit.width
      && visibleFrontPoint.y >= meleeHit.y
      && visibleFrontPoint.y <= meleeHit.y + meleeHit.height,
    'the squad hit target follows the lowered front soldiers instead of ending above them',
  );
  click(game, canvas, hitCenter(game, `tower-${melee.uid}`));
  game.render();
  assert.equal(game.hits.find(({ id }) => id === 'pad-1').enabled, false,
    'selecting a deployed squad does not enable tap-to-move');
  click(game, canvas, hitCenter(game, 'pad-1'));
  assert.equal(melee.padIndex, 0, 'a short tap on another cell cannot move a squad');

  game.render();
  const quickDragStart = hitCenter(game, `tower-${melee.uid}`);
  const moveTarget = hitCenter(game, 'pad-1');
  drag(game, canvas, quickDragStart, moveTarget);
  assert.equal(melee.padIndex, 0, 'dragging before the hold threshold is ignored');

  game.render();
  const longPressStart = hitCenter(game, `tower-${melee.uid}`);
  canvas.dispatch('pointerdown', pointerEvent(game, canvas, longPressStart));
  interactionTime = 225;
  canvas.context.calls.length = 0;
  game.render();
  assert.ok(canvas.context.calls.some(([kind, text]) => (
    kind === 'fillText' && text === '长按移动'
  )), 'holding a deployed squad shows a compact progress indicator');
  assert.equal(game.hits.find(({ id }) => id === 'pad-1').enabled, false);
  interactionTime = 460;
  game.render();
  assert.equal(game.drag.longPressReady, true);
  assert.equal(game.hits.find(({ id }) => id === 'pad-1').enabled, true);
  canvas.dispatch('pointermove', pointerEvent(game, canvas, moveTarget));
  canvas.dispatch('pointerup', pointerEvent(game, canvas, moveTarget));
  assert.equal(melee.padIndex, 1, 'a squad moves after a 450ms hold arms dragging');

  game.render();
  click(game, canvas, hitCenter(game, 'purchase-ranged'));
  game.render();
  click(game, canvas, hitCenter(game, 'pad-0'));
  assert.equal(game.state.currency, 250);
  assert.equal(game.state.towers[1].squadType, 'ranged');
  assert.equal(game.state.towers[1].aliveMembers, 4);

  game.render();
  const ranged = game.state.towers[1];
  const rangedFront = ranged.members.reduce((front, member) => (
    member.y > front.y ? member : front
  ));
  const clickedAdjacent = game.hitAt({
    x: rangedFront.x,
    y: rangedFront.y + 16 - 2,
  }, (hit) => hit.action === 'tower');
  assert.equal(clickedAdjacent.data.towerUid, ranged.uid,
    'the upper squad keeps ownership of its visible soldiers beside an occupied lower row');
  click(game, canvas, hitCenter(game, 'purchase-category-turret'));
  game.render();
  click(game, canvas, hitCenter(game, 'purchase-turret'));
  assert.equal(game.selectedPurchase, 'turret');
  game.render();
  const slotId = game.state.turretSlots[0].id;
  const turretHit = game.hits.find(({ id }) => id === slotId);
  assert.equal(turretHit.action, 'build-turret');
  assert.equal(turretHit.enabled, true);
  click(game, canvas, hitCenter(game, slotId));
  assert.equal(game.selectedPurchase, null);
  assert.equal(game.state.currency, 75);
  assert.equal(game.state.turrets.length, 1);
  assert.equal(game.state.turrets[0].type, 'gel-mortar');
  assert.equal(game.state.turrets[0].slotIndex, 0);

  game.render();
  click(game, canvas, hitCenter(game, 'start-wave'));
  assert.equal(game.state.phase, 'combat');
  assert.equal(game.state.waveActive, true);
  canvas.context.calls.length = 0;
  game.render();
  assert.equal(game.hits.find(({ id }) => id === 'purchase-melee').enabled, false);
  assert.equal(game.hits.find(({ id }) => id === 'hero-joystick').enabled, true);
  assert.equal(game.hits.find(({ id }) => id === 'hero-skill').enabled, true);
  assert.ok(canvas.context.calls.some(([kind, text]) => (
    kind === 'fillText' && text === '壳壳'
  )), 'the controlled slime is labeled by its own name instead of a generic hero tag');

  click(game, canvas, hitCenter(game, 'hero-skill'));
  assert.ok(game.state.hero.skillCooldown > 0);
  game.render();
  assert.equal(game.hits.find(({ id }) => id === 'hero-skill').enabled, false);

  const joystick = hitCenter(game, 'hero-joystick');
  canvas.dispatch('pointerdown', pointerEvent(game, canvas, joystick));
  canvas.dispatch('pointermove', pointerEvent(game, canvas, {
    x: joystick.x + 44,
    y: joystick.y,
  }));
  assert.ok(game.state.hero.moveX > 0);
  canvas.dispatch('pointerup', pointerEvent(game, canvas, {
    x: joystick.x + 44,
    y: joystick.y,
  }));
  assert.equal(game.state.hero.moveX, 0);
  assert.equal(game.state.hero.moveY, 0);
  game.dispose();
});

test('purchase gestures wait for clear intent and remain owned by their first pointer', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({
      tutorialSeen: true,
      squadRanks: { melee: 1, ranged: 1, charger: 1, leaf: 1 },
    }),
    pixelRatio: 1,
  });
  game.state.screen = 'battle';
  game.state.stageId = 'stage-1';
  game.state.phase = 'prep';
  game.state.waveActive = false;
  game.state.result = null;
  game.state.currency = 1000;
  game.state.tutorial.active = false;
  game.render();

  const meleeStart = hitCenter(game, 'purchase-melee');
  const padZero = hitCenter(game, 'pad-0');
  canvas.dispatch('pointerdown', pointerEvent(game, canvas, meleeStart, 11));
  canvas.dispatch('pointermove', pointerEvent(game, canvas, {
    x: meleeStart.x + 13,
    y: meleeStart.y + 10,
  }, 11));
  assert.equal(game.drag.gesture, null,
    'a small diagonal wobble does not prematurely lock the card to horizontal scrolling');
  canvas.dispatch('pointermove', pointerEvent(game, canvas, padZero, 11));
  assert.equal(game.drag.gesture, 'deploy');
  canvas.dispatch('pointerup', pointerEvent(game, canvas, padZero, 11));
  assert.deepEqual(game.state.towers.map(({ squadType }) => squadType), ['melee']);

  game.render();
  const rangedStart = hitCenter(game, 'purchase-ranged');
  canvas.dispatch('pointerdown', pointerEvent(game, canvas, rangedStart, 12));
  canvas.dispatch('pointermove', pointerEvent(game, canvas, {
    x: rangedStart.x + 10,
    y: rangedStart.y + 10,
  }, 12));
  assert.equal(game.drag.gesture, null,
    'an equal diagonal wobble waits for a later, clearer gesture');
  canvas.dispatch('pointermove', pointerEvent(game, canvas, {
    x: rangedStart.x - 80,
    y: rangedStart.y + 10,
  }, 12));
  assert.equal(game.drag.kind, 'purchase-scroll');
  canvas.dispatch('pointerup', pointerEvent(game, canvas, {
    x: rangedStart.x - 80,
    y: rangedStart.y + 10,
  }, 12));
  assert.equal(game.state.towers.length, 1, 'the resolved swipe does not deploy another squad');
  assert.ok(game.purchaseTrackOffsets.squad > 0);

  game.setPurchaseTrackOffset('squad', 0);
  game.render();
  const diagonalStart = hitCenter(game, 'purchase-ranged');
  canvas.dispatch('pointerdown', pointerEvent(game, canvas, diagonalStart, 13));
  canvas.dispatch('pointermove', pointerEvent(game, canvas, {
    x: diagonalStart.x + 30,
    y: diagonalStart.y + 25,
  }, 13));
  assert.equal(game.drag.gesture, null);
  assert.equal(game.drag.moved, true);
  canvas.dispatch('pointerup', pointerEvent(game, canvas, {
    x: diagonalStart.x + 30,
    y: diagonalStart.y + 25,
  }, 13));
  assert.equal(game.selectedPurchase, null,
    'a large unresolved diagonal gesture cannot fall through into a card click');

  game.setPurchaseTrackOffset('squad', 0);
  game.render();
  const ownedStart = hitCenter(game, 'purchase-ranged');
  const secondFingerCard = hitCenter(game, 'purchase-leaf');
  const padOne = hitCenter(game, 'pad-1');
  canvas.dispatch('pointerdown', pointerEvent(game, canvas, ownedStart, 21));
  canvas.dispatch('pointerdown', pointerEvent(game, canvas, secondFingerCard, 22));
  canvas.dispatch('pointerup', pointerEvent(game, canvas, secondFingerCard, 22));
  assert.equal(game.drag.pointerId, 21,
    'a second finger cannot replace or cancel the card held by the first finger');
  assert.equal(game.drag.purchaseType, 'ranged');
  canvas.dispatch('pointermove', pointerEvent(game, canvas, padOne, 21));
  canvas.dispatch('pointerup', pointerEvent(game, canvas, padOne, 21));
  assert.deepEqual(game.state.towers.map(({ squadType }) => squadType), ['melee', 'ranged']);
  game.dispose();
});

test('categorized purchase track swipes wide cards and buys every squad and turret type', () => {
  const canvas = createCanvas();
  const assets = createAssetStore([
    'turret-bubble-coil',
    'turret-crystal-repeater',
  ]);
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({
      tutorialSeen: true,
      squadRanks: { melee: 1, ranged: 1, charger: 1, leaf: 1 },
      turretRanks: { 'gel-mortar': 1, 'bubble-coil': 1, 'crystal-repeater': 1 },
    }),
    pixelRatio: 1,
  });
  game.setAssetStore(assets);
  game.state.screen = 'battle';
  game.state.stageId = 'stage-1';
  game.state.phase = 'prep';
  game.state.waveActive = false;
  game.state.result = null;
  game.state.currency = 1000;
  game.state.tutorial.active = false;
  game.render();

  const squadPurchaseIds = [
    'purchase-melee', 'purchase-ranged', 'purchase-charger', 'purchase-leaf',
  ];
  assert.deepEqual(
    squadPurchaseIds.map((id) => game.hits.find((hit) => hit.id === id)?.enabled),
    squadPurchaseIds.map(() => true),
  );
  assert.equal(game.purchaseCategory, 'squad');
  assert.equal(game.hits.find(({ id }) => id === 'purchase-turret'), undefined);
  assert.equal(game.hits.find(({ id }) => id === 'purchase-melee').width, 126,
    'cards retain a readable width instead of squeezing all seven into one row');
  const leafBefore = game.hits.find(({ id }) => id === 'purchase-leaf');
  assert.ok(leafBefore.width < 126, 'the clipped last card hints that the track can scroll');

  const swipeStart = hitCenter(game, 'purchase-leaf');
  drag(game, canvas, swipeStart, { x: swipeStart.x - 96, y: swipeStart.y });
  assert.ok(game.purchaseTrackOffsets.squad > 0, 'a horizontal pointer gesture scrolls the track');
  assert.equal(game.selectedPurchase, null, 'swiping a card does not turn into a purchase click');
  assert.equal(game.state.towers.length, 0, 'swiping a card does not deploy it');
  assert.equal(game.state.currency, 1000);
  game.render();
  assert.equal(game.hits.find(({ id }) => id === 'purchase-leaf').width, 126,
    'scrolling reveals the final squad card at full width');

  click(game, canvas, hitCenter(game, 'purchase-charger'));
  game.render();
  click(game, canvas, hitCenter(game, 'pad-0'));
  game.render();
  click(game, canvas, hitCenter(game, 'purchase-leaf'));
  game.render();
  click(game, canvas, hitCenter(game, 'pad-1'));

  assert.deepEqual(game.state.towers.map(({ squadType }) => squadType), ['charger', 'leaf']);
  for (const squad of game.state.towers) {
    assert.equal(squad.members.length, 4);
    assert.equal(new Set(squad.members.map(({ uid }) => uid)).size, 4);
    assert.equal(new Set(squad.members.map(({ x, y }) => `${x}:${y}`)).size, 4,
      `${squad.squadType} keeps four independent member coordinates`);
  }

  game.render();
  click(game, canvas, hitCenter(game, 'purchase-category-turret'));
  game.render();
  assert.equal(game.purchaseCategory, 'turret');
  assert.equal(game.hits.find(({ id }) => id === 'purchase-melee'), undefined);
  const turretPurchaseIds = [
    'purchase-turret', 'purchase-bubble-coil', 'purchase-crystal-repeater',
  ];
  assert.deepEqual(
    turretPurchaseIds.map((id) => game.hits.find((hit) => hit.id === id)?.enabled),
    turretPurchaseIds.map(() => true),
  );
  assert.equal(game.purchaseTrackMaxOffset('turret'), 0,
    'three turret cards fit without artificial spacing or scrolling');
  click(game, canvas, hitCenter(game, 'purchase-bubble-coil'));
  game.render();
  click(game, canvas, hitCenter(game, game.state.turretSlots[0].id));
  game.render();
  click(game, canvas, hitCenter(game, 'purchase-crystal-repeater'));
  game.render();
  click(game, canvas, hitCenter(game, game.state.turretSlots[1].id));
  assert.deepEqual(game.state.turrets.map(({ type }) => type), [
    'bubble-coil', 'crystal-repeater',
  ]);

  assets.requests.length = 0;
  game.drawTurretSlots(canvas.context, TD_STAGES[0]);
  assert.ok(assets.requests.includes('turret-bubble-coil'));
  assert.ok(assets.requests.includes('turret-crystal-repeater'));
  assert.equal(assets.requests.includes('turret-gel-mortar'), false,
    'new turret visuals never fall back to the mortar PNG');
  game.dispose();
});

test('portrait battle keeps deployment cards below the fortress and supports direct drag placement', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({
      tutorialSeen: true,
      squadRanks: { melee: 1, ranged: 1, charger: 1, leaf: 1 },
      turretRanks: { 'gel-mortar': 1, 'bubble-coil': 1, 'crystal-repeater': 1 },
    }),
    pixelRatio: 1,
  });
  const assets = createAssetStore([
    'background-menu-portrait-v1',
    'background-battle-portrait-v1',
  ]);
  game.setAssetStore(assets);
  game.render();
  click(game, canvas, hitCenter(game, 'start-story'));
  game.render();
  click(game, canvas, hitCenter(game, 'select-stage-1'));
  let deploymentGrid = null;
  let deploymentSegments = [];
  const drawDeploymentGrid = game.drawDeploymentGrid.bind(game);
  game.drawDeploymentGrid = (ctx, lanes, stage) => {
    deploymentGrid = {
      columns: lanes.map((lane) => lane.x),
      rows: [...new Set(stage.pads.map((pad) => pad.y))],
    };
    const previousMoveTo = ctx.moveTo;
    const previousLineTo = ctx.lineTo;
    let start = null;
    ctx.moveTo = (x, y) => {
      start = { x, y };
      previousMoveTo.call(ctx, x, y);
    };
    ctx.lineTo = (x, y) => {
      if (start) deploymentSegments.push([start, { x, y }]);
      previousLineTo.call(ctx, x, y);
    };
    try {
      return drawDeploymentGrid(ctx, lanes, stage);
    } finally {
      ctx.moveTo = previousMoveTo;
      ctx.lineTo = previousLineTo;
    }
  };
  assets.requests.length = 0;
  canvas.context.calls.length = 0;
  game.render();
  assert.equal(game.shouldShowDeploymentGrid(), false);
  assert.equal(deploymentSegments.length, 0,
    'the white deployment grid stays hidden during ordinary preparation');

  game.drag = { kind: 'purchase', purchaseType: 'melee', gesture: 'deploy' };
  assert.equal(game.shouldShowDeploymentGrid(), true,
    'a squad deployment gesture reveals the grid before release');
  game.drag = { kind: 'purchase', purchaseType: 'turret', gesture: 'deploy' };
  assert.equal(game.shouldShowDeploymentGrid(), false,
    'a fixed-slot turret gesture does not reveal the ground grid');
  game.drag = {
    kind: 'tower', longPressReady: true, longPressCancelled: false,
  };
  assert.equal(game.shouldShowDeploymentGrid(), true,
    'an armed long-press move gesture reveals valid grid destinations');
  game.drag = null;

  click(game, canvas, hitCenter(game, 'purchase-melee'));
  assert.equal(game.selectedPurchase, 'melee');
  deploymentGrid = null;
  deploymentSegments = [];
  assets.requests.length = 0;
  canvas.context.calls.length = 0;
  game.render();
  assert.equal(game.shouldShowDeploymentGrid(), true,
    'selecting a placeable squad card reveals the grid');

  const purchaseHits = [
    'purchase-melee', 'purchase-ranged', 'purchase-charger', 'purchase-leaf',
  ]
    .map((id) => game.hits.find((hit) => hit.id === id));
  purchaseHits.forEach((hit) => {
    assert.ok(hit.y >= 1096, `${hit.id} is in the portrait card dock`);
    assert.ok(hit.y + hit.height <= 1280, `${hit.id} stays inside the portrait view`);
  });
  for (const id of ['purchase-category-squad', 'purchase-category-turret']) {
    const tab = game.hits.find((hit) => hit.id === id);
    assert.ok(tab.y >= 1096 && tab.y + tab.height < purchaseHits[0].y,
      `${id} stays above the horizontal card track`);
  }
  const padZero = game.hits.find(({ id }) => id === 'pad-0');
  assert.deepEqual({
    x: padZero.x,
    y: padZero.y,
    width: padZero.width,
    height: padZero.height,
  }, {
    x: 20, y: 225, width: 136, height: 90,
  }, 'each touch target covers its complete white-grid cell');
  assert.equal(game.emptyPadHitAt({ x: 21, y: 226 })?.data?.padIndex, 0,
    'the visible top-left edge of a grid cell accepts placement');
  assert.deepEqual(deploymentGrid, {
    columns: [88, 224, 360, 496, 632],
    rows: [270, 360, 450, 540, 630, 720, 810],
  }, 'the deployment overlay is one five-by-seven grid');
  assert.equal(deploymentSegments.length, 14,
    'the five-by-seven grid draws six vertical and eight horizontal lines');
  assert.deepEqual(deploymentSegments[0], [{ x: 20, y: 225 }, { x: 20, y: 855 }]);
  assert.deepEqual(deploymentSegments.at(-1), [{ x: 20, y: 855 }, { x: 700, y: 855 }]);
  assert.ok(canvas.context.calls.some(([kind, strokeStyle, lineWidth]) => (
    kind === 'stroke' && strokeStyle === '#FFFFFF' && lineWidth === 1.25
  )), 'the deployment grid uses a thin white stroke');
  const slotId = game.state.turretSlots[0].id;
  const turretSlot = game.hits.find(({ id }) => id === slotId);
  assert.ok(turretSlot.y > 850 && turretSlot.y + turretSlot.height < 1020,
    'turret construction sits directly above the lower fortress');
  assert.ok(assets.requests.includes('fortress-slime-core'));
  assert.ok(assets.requests.includes('turret-gel-mount'));
  assert.equal(assets.requests.includes('turret-gel-mortar'), false,
    'off-category turret cards are not drawn behind the squad track');
  assert.ok(assets.requests.includes('background-battle-portrait-v1'));
  assert.equal(assets.requests.filter((key) => key === 'rift-entry-portal').length, 1,
    'the battlefield requests exactly one centered portal');
  assert.ok(assets.requests.includes('ui-card-frame-deploy'));
  assert.equal(assets.requests.includes('ui-card-melee-squad'), false);
  assert.equal(assets.requests.includes('ui-card-ranged-squad'), false);
  assert.equal(assets.requests.includes('building-gel-foundation'), false,
    'empty turret positions no longer request the generic foundation');
  assert.equal(assets.requests.includes('ui-card-frame-common'), false,
    'portrait deployment cards no longer request the horizontal card frame');

  deploymentSegments = [];
  click(game, canvas, hitCenter(game, 'purchase-category-turret'));
  game.render();
  assert.equal(game.shouldShowDeploymentGrid(), false);
  assert.equal(deploymentSegments.length, 0,
    'fixed-slot turret selection does not reveal the ground grid');
  assert.ok(assets.requests.includes('turret-gel-mortar'));
  const turretPurchaseHits = [
    'purchase-turret', 'purchase-bubble-coil', 'purchase-crystal-repeater',
  ].map((id) => game.hits.find((hit) => hit.id === id));
  turretPurchaseHits.forEach((hit) => {
    assert.ok(hit.y >= 1096, `${hit.id} is in the lower portrait track`);
    assert.ok(hit.y + hit.height <= 1280, `${hit.id} stays inside the portrait view`);
  });
  assert.equal(game.hits.find(({ id }) => id === 'purchase-melee'), undefined,
    'category selection removes off-category cards from the active track');
  click(game, canvas, hitCenter(game, 'purchase-category-squad'));
  game.render();

  drag(game, canvas, hitCenter(game, 'purchase-melee'), hitCenter(game, 'pad-0'));
  assert.equal(game.state.towers.length, 1);
  assert.equal(game.state.towers[0].squadType, 'melee');
  assert.equal(game.state.currency, 400);

  game.render();
  click(game, canvas, hitCenter(game, 'purchase-category-turret'));
  game.render();
  drag(game, canvas, hitCenter(game, 'purchase-turret'), hitCenter(game, slotId));
  assert.equal(game.state.turrets.length, 1);
  assert.equal(game.state.turrets[0].type, 'gel-mortar');
  assert.equal(game.state.currency, 225);

  assets.requests.length = 0;
  game.render();
  assert.ok(
    assets.requests.indexOf('fortress-slime-core')
      < assets.requests.indexOf('turret-gel-mortar'),
    'the fortress renders behind the turret row',
  );
  assert.ok(
    assets.requests.indexOf('turret-gel-mount')
      < assets.requests.indexOf('turret-gel-mortar'),
    'an installed turret remains seated on its formal mount',
  );

  click(game, canvas, hitCenter(game, 'start-wave'));
  canvas.context.calls.length = 0;
  game.render();
  const joystick = game.hits.find(({ id }) => id === 'hero-joystick');
  const skill = game.hits.find(({ id }) => id === 'hero-skill');
  assert.ok(joystick.enabled && joystick.y >= 1096);
  assert.ok(skill.enabled && skill.y >= 1096);
  assert.equal(game.hits.find(({ id }) => id === 'purchase-melee').enabled, false);
  assert.ok(assets.requests.includes('ui-hero-joystick-base'));
  assert.ok(assets.requests.includes('ui-hero-joystick-knob'));
  assert.ok(assets.requests.includes('ui-hero-control-ring'));
  assert.equal(canvas.context.calls.some(([kind, text]) => (
    kind === 'fillText' && ['盾墩小队', '豆弩小队', '固定炮台'].includes(text)
  )), false, 'purchase cards are hidden during combat');
  game.dispose();
});

test('portrait deployment cards use all four formal nine-layer soldier atlases', () => {
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = class {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.context = createContext();
      this.context.canvas = this;
    }
    getContext() { return this.context; }
  };
  try {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({
      tutorialSeen: true,
      squadRanks: { melee: 1, ranged: 1, charger: 1, leaf: 1 },
    }),
    pixelRatio: 1,
  });
  const assets = createAssetStore([
    'ui-card-frame-deploy',
    'soldier-shield-dun-atlas-v1',
    'soldier-bean-bow-atlas-v1',
    'soldier-bounce-hammer-atlas-v1',
    'soldier-leaf-spinner-atlas-v1',
  ]);
  const rigs = createRigStore();
  game.setAssetStore(assets);
  game.setRigAssetStore(rigs);
  game.render();
  click(game, canvas, hitCenter(game, 'start-story'));
  game.render();
  click(game, canvas, hitCenter(game, 'select-stage-1'));

  let rigPreviewCount = 0;
  const previewAssetRequests = [];
  const previewRigRequests = [];
  const drawRigPreview = game.drawSquadPurchasePreview.bind(game);
  game.drawSquadPurchasePreview = (...args) => {
    rigPreviewCount += 1;
    const assetRequestStart = assets.requests.length;
    const requestStart = rigs.requests.length;
    const result = drawRigPreview(...args);
    previewAssetRequests.push(assets.requests.slice(assetRequestStart));
    previewRigRequests.push(rigs.requests.slice(requestStart));
    return result;
  };
  assets.requests.length = 0;
  rigs.requests.length = 0;
  game.render();

  assert.ok(assets.requests.includes('ui-card-frame-deploy'));
  assert.equal(rigPreviewCount, 4,
    'all four squad cards each render one four-member skeletal preview');
  assert.deepEqual(previewAssetRequests.map((requests) => requests.length), [4, 4, 4, 4],
    'each purchase-card preview resolves four independent layered soldiers');
  assert.deepEqual(previewAssetRequests.map((requests) => [...new Set(requests)]), [
    ['soldier-shield-dun-atlas-v1'],
    ['soldier-bean-bow-atlas-v1'],
    ['soldier-bounce-hammer-atlas-v1'],
    ['soldier-leaf-spinner-atlas-v1'],
  ]);
  assert.deepEqual(previewRigRequests, [[], [], [], []],
    'soldier cards never ask the hero rig store for shell or crystal art');
  game.dispose();
  } finally {
    if (previousOffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = previousOffscreenCanvas;
  }
});

test('CSS coordinates map into the portrait view correctly at DPR 2 with letterboxing', () => {
  const canvas = createCanvas({ left: 40, top: 30, width: 360, height: 800 });
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 2,
  });

  assert.equal(game.scale, 0.5);
  assert.equal(game.offsetX, 0);
  assert.equal(game.offsetY, 80);
  assert.equal(canvas.width, 720);
  assert.equal(canvas.height, 1600);

  game.render();
  const logical = hitCenter(game, 'start-story');
  const mapped = game.toGamePoint(pointerEvent(game, canvas, logical));
  assert.ok(Math.abs(mapped.x - logical.x) < 1e-9);
  assert.ok(Math.abs(mapped.y - logical.y) < 1e-9);

  click(game, canvas, logical);
  assert.equal(game.state.screen, 'menu');
  assert.equal(game.menuPage, 'stage-select');
  game.render();

  const stageLogical = hitCenter(game, 'select-stage-1');
  const stageMapped = game.toGamePoint(pointerEvent(game, canvas, stageLogical));
  assert.ok(Math.abs(stageMapped.x - stageLogical.x) < 1e-9);
  assert.ok(Math.abs(stageMapped.y - stageLogical.y) < 1e-9);
  click(game, canvas, stageLogical);
  assert.equal(game.state.screen, 'battle');
  assert.equal(game.state.stageId, 'stage-1');
  game.dispose();
});

test('save, background, and foreground use runtime storage and frame scheduler safely', () => {
  const canvas = createCanvas();
  const runtime = createRuntime({ tutorialSeen: true });
  const game = new TowerDefenseGame(canvas, { runtime, pixelRatio: 1 });
  game.state.progress.unlockedStage = 2;
  game.state.progress.clearedStages.push('stage-1');

  assert.equal(game.save(), true);
  const saved = runtime.values.get(TD_STORAGE_KEY);
  assert.deepEqual({
    unlockedStage: saved.unlockedStage,
    clearedStages: saved.clearedStages,
    bestEndlessWave: saved.bestEndlessWave,
    tutorialSeen: saved.tutorialSeen,
  }, {
    unlockedStage: 2,
    clearedStages: ['stage-1'],
    bestEndlessWave: 0,
    tutorialSeen: true,
  });
  assert.equal(saved.summonCurrency, 900);
  assert.equal(saved.summonPity, 0);
  assert.equal(Number.isInteger(saved.summonRngState), true);
  assert.deepEqual(saved.contractRanks, Object.fromEntries(
    Object.keys(HERO_TYPES).map((type) => [type, type === 'shell' ? 1 : 0]),
  ));
  assert.deepEqual(saved.contractShards, Object.fromEntries(
    Object.keys(HERO_TYPES).map((type) => [type, 0]),
  ));
  assert.equal(saved.selectedHero, 'shell');

  game.start();
  assert.equal(game.running, true);
  assert.equal(canvas.pendingFrameCount(), 1);
  game.onBackground();
  assert.equal(game.backgrounded, true);
  assert.equal(canvas.pendingFrameCount(), 0);
  assert.ok(runtime.writes.length >= 2);

  game.onForeground();
  assert.equal(game.backgrounded, false);
  assert.equal(canvas.pendingFrameCount(), 1);
  assert.equal(canvas.flushFrame(100), true);
  assert.equal(canvas.pendingFrameCount(), 1, 'a running frame schedules its successor');
  game.dispose();
});

test('legacy browser JSON progress is preserved and migrated to runtime storage format', () => {
  const legacyProgress = {
    unlockedStage: 3,
    clearedStages: ['stage-1', 'stage-2'],
    bestEndlessWave: 8,
    tutorialSeen: true,
    summonCurrency: 777,
  };
  const values = new Map([[TD_STORAGE_KEY, JSON.stringify(legacyProgress)]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const runtime = createWebRuntime({
    storage,
    windowRef: null,
    documentRef: null,
    AudioClass: null,
  });
  const game = new TowerDefenseGame(createCanvas(), { runtime, pixelRatio: 1 });

  assert.deepEqual({
    unlockedStage: game.state.progress.unlockedStage,
    clearedStages: game.state.progress.clearedStages,
    bestEndlessWave: game.state.progress.bestEndlessWave,
    tutorialSeen: game.state.progress.tutorialSeen,
    summonCurrency: game.state.progress.summonCurrency,
  }, legacyProgress);

  assert.equal(game.save(), true);
  const migrated = values.get(TD_STORAGE_KEY);
  assert.match(migrated, /^__slime_runtime_json_v1__:/);
  assert.equal(
    JSON.parse(migrated.slice('__slime_runtime_json_v1__:'.length)).summonCurrency,
    legacyProgress.summonCurrency,
  );

  game.dispose();
  runtime.dispose();
});

test('dispose is idempotent, saves, cancels animation, and removes pointer listeners', () => {
  const canvas = createCanvas();
  const runtime = createRuntime({ tutorialSeen: true });
  const game = new TowerDefenseGame(canvas, { runtime, pixelRatio: 1 });
  game.start();

  for (const eventName of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    assert.equal(canvas.listenerCount(eventName), 1);
  }
  assert.equal(canvas.pendingFrameCount(), 1);

  assert.doesNotThrow(() => game.dispose());
  assert.equal(game.running, false);
  assert.equal(game.frameId, null);
  assert.equal(canvas.pendingFrameCount(), 0);
  for (const eventName of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    assert.equal(canvas.listenerCount(eventName), 0);
  }
  assert.ok(runtime.writes.some(({ key }) => key === TD_STORAGE_KEY));
  assert.doesNotThrow(() => game.dispose());
});
