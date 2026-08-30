import test from 'node:test';
import assert from 'node:assert/strict';

import { TowerDefenseGame } from '../src/tower-defense-game.js';
import { TD_STORAGE_KEY } from '../src/tower-defense-core.js';

function createContext() {
  const gradient = () => ({ addColorStop() {} });
  const calls = [];
  const base = {
    calls,
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    measureText: (text) => ({ width: String(text).length * 12 }),
    drawImage: (...args) => calls.push(['drawImage', ...args]),
    fillText: (text, x, y) => calls.push(['fillText', text, x, y]),
  };
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

function createAssetStore() {
  const requests = [];
  return {
    requests,
    get(_key, fallback = null) {
      return fallback;
    },
    useOrFallback(key, _drawAsset, drawFallback) {
      requests.push(key);
      drawFallback?.();
      return false;
    },
  };
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
    'start-story', 'endless', 'open-summon',
  ]);
  assert.ok(canvas.context.calls.some(([kind, text]) => (
    kind === 'fillText' && text === '史莱姆自走防线'
  )));
  game.dispose();
});

test('formal asset and rig stores can be replaced and are used during rendering', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  const assets = createAssetStore();
  const rigs = createRigStore();

  assert.equal(game.setAssetStore(assets), game);
  assert.equal(game.setRigAssetStore(rigs), game);
  assert.equal(game.setGeneratedCharacterArtEnabled(false), game);
  assert.equal(game.generatedCharacterArtEnabled, false);
  game.render();

  assert.ok(assets.requests.includes('background-garden-base'));
  assert.ok(assets.requests.includes('background-cloud-overlay'));
  assert.ok(assets.requests.includes('town-soft-core'));
  assert.ok(rigs.requests.includes('survivor-shell-shell'));
  assert.ok(rigs.requests.includes('survivor-crystal-pin'));
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

test('summon page supports one and ten pulls, result closing, hero selection, and back', () => {
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
  game.render();
  assert.deepEqual(game.hits.map(({ id }) => id), [
    'summon-back',
    'hero-select-shell', 'hero-select-needle', 'hero-select-bubble', 'hero-select-sprout',
    'summon-one', 'summon-ten',
  ]);
  assert.equal(game.hits.find(({ id }) => id === 'hero-select-shell').enabled, true);
  assert.equal(game.hits.find(({ id }) => id === 'hero-select-needle').enabled, false);

  click(game, canvas, hitCenter(game, 'hero-select-needle'));
  assert.equal(game.state.progress.selectedHero, 'shell', 'locked heroes cannot be selected');

  click(game, canvas, hitCenter(game, 'summon-one'));
  assert.equal(game.state.progress.summonCurrency, 900);
  assert.equal(game.summonResults.length, 1);
  game.render();
  assert.deepEqual(game.hits.map(({ id }) => id), ['summon-result-close']);
  click(game, canvas, hitCenter(game, 'summon-result-close'));
  assert.equal(game.summonResults.length, 0);

  game.render();
  assert.equal(game.hits.find(({ id }) => id === 'summon-ten').enabled, true);
  click(game, canvas, hitCenter(game, 'summon-ten'));
  assert.equal(game.state.progress.summonCurrency, 0);
  assert.equal(game.summonResults.length, 10);
  game.render();
  assert.deepEqual(game.hits.map(({ id }) => id), ['summon-result-close']);
  click(game, canvas, hitCenter(game, 'summon-result-close'));

  const unlocked = ['needle', 'bubble', 'sprout'].find((type) => (
    game.state.progress.contractRanks[type] > 0
  ));
  assert.ok(unlocked, 'the first ten pull unlocks another selectable hero');
  game.render();
  click(game, canvas, hitCenter(game, `hero-select-${unlocked}`));
  assert.equal(game.state.progress.selectedHero, unlocked);
  assert.equal(runtime.values.get(TD_STORAGE_KEY).selectedHero, unlocked);

  game.render();
  click(game, canvas, hitCenter(game, 'summon-back'));
  assert.equal(game.menuPage, 'main');
  game.render();
  assert.ok(game.hits.some(({ id }) => id === 'open-summon'));
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
  assert.equal(deathEntry.controller.actionName, 'downed');

  let formationDraws = 0;
  game.drawSquadMembers = () => { formationDraws += 1; };
  game.drawDefeatedTowers(canvas.context);
  assert.equal(formationDraws, 0);
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
    'start-story', 'endless', 'open-summon',
  ]);
  const storyHit = game.hits.find(({ id }) => id === 'start-story');
  assert.equal(storyHit.action, 'open-stage-select');
  assert.equal(game.hits.find(({ id }) => id === 'endless').enabled, false);

  click(game, canvas, hitCenter(game, 'start-story'));
  assert.equal(game.state.screen, 'menu');
  assert.equal(game.menuPage, 'stage-select');
  game.render();

  assert.deepEqual(game.hits.map(({ id }) => id), [
    'stage-select-back', 'select-stage-1', 'select-stage-2', 'select-stage-3',
  ]);
  assert.equal(game.hits.find(({ id }) => id === 'select-stage-1').enabled, true);
  assert.equal(game.hits.find(({ id }) => id === 'select-stage-2').enabled, true);
  assert.equal(game.hits.find(({ id }) => id === 'select-stage-3').enabled, false);
  assert.ok(canvas.context.calls.some(([kind, text]) => kind === 'fillText' && text === '✓ 已通关'));
  assert.ok(canvas.context.calls.some(([kind, text]) => kind === 'fillText' && text === '可挑战'));
  assert.ok(canvas.context.calls.some(([kind, text]) => kind === 'fillText' && text === '未解锁'));

  click(game, canvas, hitCenter(game, 'select-stage-3'));
  assert.equal(game.state.screen, 'menu', 'a locked stage cannot be entered');
  click(game, canvas, hitCenter(game, 'stage-select-back'));
  assert.equal(game.menuPage, 'main');
  game.render();
  assert.deepEqual(game.hits.map(({ id }) => id), [
    'start-story', 'endless', 'open-summon',
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
  const runtime = createRuntime({
    unlockedStage: 3,
    clearedStages: ['stage-1', 'stage-2', 'stage-3'],
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
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
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
  assert.equal(game.hits.find(({ id }) => id === 'purchase-turret').action, 'select-purchase');
  assert.equal(game.hits.find(({ id }) => id === 'hero-joystick').enabled, false);
  assert.equal(game.hits.find(({ id }) => id === 'hero-skill').enabled, false);
  assert.ok(assets.requests.includes('ui-gel-energy'));
  assert.ok(assets.requests.includes('ui-card-frame-common'));

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
  click(game, canvas, hitCenter(game, `tower-${melee.uid}`));
  game.render();
  assert.equal(game.hits.find(({ id }) => id === 'pad-1').enabled, true);
  click(game, canvas, hitCenter(game, 'pad-1'));
  assert.equal(melee.padIndex, 1, 'a squad can be rearranged only during preparation');

  game.render();
  click(game, canvas, hitCenter(game, 'purchase-ranged'));
  game.render();
  click(game, canvas, hitCenter(game, 'pad-0'));
  assert.equal(game.state.currency, 250);
  assert.equal(game.state.towers[1].squadType, 'ranged');
  assert.equal(game.state.towers[1].aliveMembers, 4);

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
  game.render();
  assert.equal(game.hits.find(({ id }) => id === 'purchase-melee').enabled, false);
  assert.equal(game.hits.find(({ id }) => id === 'hero-joystick').enabled, true);
  assert.equal(game.hits.find(({ id }) => id === 'hero-skill').enabled, true);

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

test('portrait battle keeps deployment cards below the fortress and supports direct drag placement', () => {
  const canvas = createCanvas();
  const game = new TowerDefenseGame(canvas, {
    runtime: createRuntime({ tutorialSeen: true }),
    pixelRatio: 1,
  });
  const assets = createAssetStore();
  game.setAssetStore(assets);
  game.render();
  click(game, canvas, hitCenter(game, 'start-story'));
  game.render();
  click(game, canvas, hitCenter(game, 'select-stage-1'));
  game.render();

  const purchaseHits = ['purchase-melee', 'purchase-ranged', 'purchase-turret']
    .map((id) => game.hits.find((hit) => hit.id === id));
  purchaseHits.forEach((hit) => {
    assert.ok(hit.y >= 1096, `${hit.id} is in the portrait card dock`);
    assert.ok(hit.y + hit.height <= 1280, `${hit.id} stays inside the portrait view`);
  });
  const padZero = game.hits.find(({ id }) => id === 'pad-0');
  assert.ok(padZero.y > 200 && padZero.y + padZero.height < 900,
    'soldier cells stay in the middle field');
  const slotId = game.state.turretSlots[0].id;
  const turretSlot = game.hits.find(({ id }) => id === slotId);
  assert.ok(turretSlot.y > 850 && turretSlot.y + turretSlot.height < 1020,
    'turret construction sits directly above the lower fortress');
  assert.ok(assets.requests.includes('town-soft-core'));
  assert.ok(assets.requests.includes('building-gel-foundation'));
  assert.ok(assets.requests.includes('turret-gel-mortar'));

  drag(game, canvas, hitCenter(game, 'purchase-melee'), hitCenter(game, 'pad-0'));
  assert.equal(game.state.towers.length, 1);
  assert.equal(game.state.towers[0].squadType, 'melee');
  assert.equal(game.state.currency, 400);

  game.render();
  drag(game, canvas, hitCenter(game, 'purchase-turret'), hitCenter(game, slotId));
  assert.equal(game.state.turrets.length, 1);
  assert.equal(game.state.turrets[0].type, 'gel-mortar');
  assert.equal(game.state.currency, 225);

  game.render();
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
    kind === 'fillText' && ['近战小队', '远程小队', '固定炮台'].includes(text)
  )), false, 'purchase cards are hidden during combat');
  game.dispose();
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
  assert.deepEqual(saved.contractRanks, {
    shell: 1, needle: 0, bubble: 0, sprout: 0,
  });
  assert.deepEqual(saved.contractShards, {
    shell: 0, needle: 0, bubble: 0, sprout: 0,
  });
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
