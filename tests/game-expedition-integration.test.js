import test from 'node:test';
import assert from 'node:assert/strict';

import { SlimeGame } from '../src/game.js';
import { EXPEDITION_PARTY_RULES } from '../src/expedition-catalog.js';

function installRuntime(storage = new Map()) {
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
  return storage;
}

function createContext() {
  const methods = new Set([
    'arc', 'beginPath', 'bezierCurveTo', 'clearRect', 'clip', 'closePath', 'drawImage',
    'ellipse', 'fill', 'fillRect', 'fillText', 'lineTo', 'moveTo', 'quadraticCurveTo',
    'restore', 'rotate', 'save', 'scale', 'setLineDash', 'setTransform', 'stroke',
    'strokeRect', 'strokeText', 'translate',
  ]);
  const gradient = () => ({ addColorStop() {} });
  return new Proxy({
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    measureText: (text) => ({ width: String(text).length * 16 }),
  }, {
    get(target, property) {
      if (property in target) return target[property];
      if (methods.has(property)) return () => {};
      return undefined;
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}

function createFallbackAssetStore() {
  const requests = [];
  return {
    requests,
    get(_key, fallback = null) {
      return fallback;
    },
    useOrFallback(key, _renderAsset, renderFallback) {
      requests.push(key);
      renderFallback?.({ status: 'failed' }, null);
      return false;
    },
  };
}

function tapRegisteredHit(game, id) {
  game.render();
  const hit = game.hits.find((candidate) => candidate.id === id);
  assert.ok(hit, `${id} is not visible or registered`);
  assert.notEqual(hit.enabled, false, `${id} is unexpectedly disabled`);
  game.handleTap({ x: hit.x + hit.w / 2, y: hit.y + hit.h / 2 });
  return hit;
}

function createGame(storage = new Map(), context = {}) {
  installRuntime(storage);
  const canvas = {
    width: 1280,
    height: 720,
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    addEventListener() {},
    setPointerCapture() {},
  };
  const game = new SlimeGame(canvas);
  game.modal = null;
  game.state.tutorialSeen = true;
  return game;
}

function startDefaultExpedition(game) {
  assert.equal(game.openExpedition(), true);
  assert.equal(game.modal.type, 'expedition-squad');
  assert.equal(game.state.paused, true, 'the colony freezes while choosing a squad');
  assert.equal(game.modal.selectedIds.length, 3);
  assert.equal(game.startExpedition(game.modal.selectedIds), true);
  return game.state.expeditionRun;
}

function winCurrentRoute(game) {
  const run = game.state.expeditionRun;
  assert.equal(run.phase, 'route-selection');
  assert.equal(game.chooseExpeditionRouteNode(run.route.choices[0].uid), true);
  assert.equal(run.phase, 'encounter');
  assert.equal(game.finishExpeditionEncounter(true), true);
}

test('requires exactly three unique resident slimes and starts in route selection', () => {
  const game = createGame();
  const ids = game.availableExpeditionSlimeIds();
  assert.equal(EXPEDITION_PARTY_RULES.size, 3);
  assert.equal(game.startExpedition(ids.slice(0, 2)), false);
  assert.equal(game.state.phase, 'build');
  assert.equal(game.state.expeditionRun, null);
  assert.equal(game.startExpedition([ids[0], ids[1], ids[2], ids[3]]), false);

  const baseBuildingCount = game.state.buildings.length;
  const run = startDefaultExpedition(game);
  assert.equal(game.state.phase, 'battle');
  assert.equal(game.state.paused, true);
  assert.equal(game.modal.type, 'expedition-route');
  assert.equal(run.phase, 'route-selection');
  assert.equal(run.squad.length, 3);
  assert.equal(game.state.survivors.length, 3);
  assert.equal(game.state.buildings.length, 0, 'base buildings do not join a squad expedition');
  assert.equal(JSON.parse(game.preBattleSnapshot).buildings.length, baseBuildingCount);
});

test('a first-time player can dismiss onboarding and reach the expedition squad button', () => {
  const game = createGame(new Map(), createContext());
  game.state.tutorialSeen = false;
  globalThis.requestAnimationFrame = () => 0;
  game.start();
  assert.equal(game.modal.type, 'welcome');
  tapRegisteredHit(game, 'welcome-next');
  assert.equal(game.modal.page, 1);
  tapRegisteredHit(game, 'welcome-next');
  assert.equal(game.modal, null);
  assert.match(game.toast.text, /三人远征/);
  tapRegisteredHit(game, 'open-expedition');
  assert.equal(game.modal.type, 'expedition-squad');
  assert.equal(game.modal.selectedIds.length, 3);
  game.render();
  const startHit = game.hits.find(({ id }) => id === 'expedition-squad-start');
  assert.ok(startHit);
  assert.equal(startHit.enabled, true);
});

test('every modal CTA is clickable from squad selection through Boss and back to base', () => {
  const game = createGame(new Map(), createContext());
  game.openExpedition();
  tapRegisteredHit(game, 'expedition-squad-start');
  const run = game.state.expeditionRun;
  assert.equal(run.phase, 'route-selection');

  while (run.status === 'active') {
    if (run.phase === 'route-selection') {
      const node = run.route.choices[0];
      tapRegisteredHit(game, `expedition-route-${node.uid}`);
      assert.equal(run.phase, 'encounter');
    } else if (run.phase === 'encounter') {
      game.finishExpeditionEncounter(true);
    } else if (run.phase === 'boon-selection') {
      const boon = run.boonChoices[0];
      tapRegisteredHit(game, `expedition-boon-${boon.id}`);
    }
  }

  assert.equal(run.stats.bossWins, 1);
  assert.equal(game.state.phase, 'result');
  tapRegisteredHit(game, 'expedition-result-return');
  assert.equal(game.state.phase, 'build');
  assert.equal(game.state.expeditionRun, null);
  assert.equal(game.state.survivors.length, 4);
});

test('route choice enters an encounter and creates the weakened swarm queue', () => {
  const game = createGame();
  const run = startDefaultExpedition(game);
  const node = run.route.choices[0];
  assert.equal(game.chooseExpeditionRouteNode(node.uid), true);
  assert.equal(run.phase, 'encounter');
  assert.equal(game.state.paused, false);
  assert.equal(game.modal, null);
  assert.ok(game.state.spawnQueue.length >= 9);
  assert.equal(game.state.spawnQueue.length, run.currentEncounter.groups.reduce((sum, group) => sum + group.count, 0));
  assert.ok(run.currentEncounter.tuning.enemyHpMultiplier <= 0.62);
  assert.ok(run.currentEncounter.tuning.enemyDamageMultiplier <= 0.55);
});

test('the autonomous three-slime squad can clear a real encounter without animation errors', () => {
  const game = createGame();
  const run = startDefaultExpedition(game);
  game.chooseExpeditionRouteNode(run.route.choices[0].uid);
  let elapsed = 0;
  while (elapsed < 60 && run.phase === 'encounter') {
    game.time += 0.05;
    game.update(0.05);
    elapsed += 0.05;
  }
  assert.equal(run.phase, 'boon-selection');
  assert.equal(game.modal.type, 'expedition-boon');
  assert.ok(game.state.kills >= 9);
  assert.ok(game.state.survivors.some((survivor) => survivor.visualMoving));
});

test('a beacon breach settles the expedition without falling into the legacy wave flow', () => {
  const game = createGame();
  const run = startDefaultExpedition(game);
  game.chooseExpeditionRouteNode(run.route.choices[0].uid);
  game.updateEnemies = () => game.damageCore(game.state.coreMaxHp + 1);
  game.updateBattle(0.1);
  assert.equal(run.status, 'failed');
  assert.equal(game.state.phase, 'result');
  assert.equal(game.state.result.expedition, true);
});

test('regular encounters draft boons, then the final boss settles and restores the base once', () => {
  const game = createGame();
  const originalSurvivors = game.state.survivors.map(({ cardId }) => cardId);
  const originalBuildings = game.state.buildings.map(({ cardId }) => cardId);
  const crystalsBefore = game.state.softCrystals;
  const resourcesBefore = { ...game.state.colony.resources };
  const run = startDefaultExpedition(game);

  while (run.status === 'active') {
    if (run.phase === 'route-selection') {
      const node = run.route.choices[0];
      game.chooseExpeditionRouteNode(node.uid);
    } else if (run.phase === 'encounter') {
      game.finishExpeditionEncounter(true);
    } else if (run.phase === 'boon-selection') {
      assert.equal(run.boonChoices.length, 3);
      game.chooseExpeditionUpgrade(run.boonChoices[0].id);
    } else {
      assert.fail(`unexpected expedition phase ${run.phase}`);
    }
  }

  assert.equal(run.status, 'completed');
  assert.equal(run.stats.bossWins, 1);
  assert.equal(run.settlement.claimed, true);
  assert.equal(game.state.phase, 'result');
  assert.equal(game.state.result.expedition, true);
  assert.equal(game.state.result.victory, true);
  assert.deepEqual(game.state.survivors.map(({ cardId }) => cardId), originalSurvivors);
  assert.deepEqual(game.state.buildings.map(({ cardId }) => cardId), originalBuildings);
  assert.equal(game.state.expeditionProgress.firstClear, true);
  assert.equal(game.state.expeditionProgress.completions, 1);
  assert.ok(game.state.softCrystals > crystalsBefore);
  assert.ok(Object.keys(resourcesBefore).some((key) => game.state.colony.resources[key] > resourcesBefore[key]));

  const balances = {
    softCrystals: game.state.softCrystals,
    resources: { ...game.state.colony.resources },
    completions: game.state.expeditionProgress.completions,
  };
  assert.equal(game.settleExpeditionRun(), false, 'a settled run cannot grant rewards twice');
  assert.deepEqual({
    softCrystals: game.state.softCrystals,
    resources: game.state.colony.resources,
    completions: game.state.expeditionProgress.completions,
  }, balances);

  game.returnToTown();
  assert.equal(game.state.phase, 'build');
  assert.equal(game.state.expeditionRun, null);
});

test('abandonment restores the base and only keeps the configured fraction', () => {
  const game = createGame();
  const run = startDefaultExpedition(game);
  run.runLoot = { 'soft-gel': 20, softCrystals: 8 };
  const gelBefore = game.state.colony.resources.gel;
  const crystalsBefore = game.state.softCrystals;
  assert.equal(game.abandonCurrentExpedition(), true);
  assert.equal(run.status, 'abandoned');
  assert.equal(game.state.phase, 'result');
  assert.equal(game.state.colony.resources.gel, gelBefore + 5);
  assert.equal(game.state.softCrystals, crystalsBefore + 2);
  assert.equal(game.state.survivors.length, 4);
  assert.equal(game.abandonCurrentExpedition(), false);
  assert.equal(game.state.colony.resources.gel, gelBefore + 5);
  assert.equal(game.state.softCrystals, crystalsBefore + 2);
});

test('backgrounding an active expedition safely abandons it and cannot replay rewards', () => {
  const storage = new Map();
  const game = createGame(storage);
  const run = startDefaultExpedition(game);
  run.runLoot = { 'soft-gel': 20, softCrystals: 8 };
  const gelBefore = game.state.colony.resources.gel;
  const crystalsBefore = game.state.softCrystals;

  game.onBackground();
  assert.equal(game.state.phase, 'build');
  assert.equal(game.state.expeditionRun, null);
  assert.equal(game.state.survivors.length, 4);
  assert.equal(game.state.colony.resources.gel, gelBefore + 5);
  assert.equal(game.state.softCrystals, crystalsBefore + 2);
  game.onBackground();
  assert.equal(game.state.colony.resources.gel, gelBefore + 5);
  assert.equal(game.state.softCrystals, crystalsBefore + 2);

  const saved = JSON.parse([...storage.values()][0]);
  assert.equal(saved.expeditionRun, null);
});

test('an abruptly saved active run is recovered as a single safe abandonment', () => {
  const storage = new Map();
  const first = createGame(storage);
  const run = startDefaultExpedition(first);
  run.runLoot = { 'soft-gel': 20, softCrystals: 8 };
  first.save();

  const recovered = createGame(storage);
  assert.equal(recovered.state.phase, 'build');
  assert.equal(recovered.state.expeditionRun, null);
  assert.equal(recovered.state.survivors.length, 4);
  assert.equal(recovered.state.colony.resources.gel, first.state.colony.resources.gel + 5);
  assert.equal(recovered.state.softCrystals, first.state.softCrystals + 2);

  const afterRecovery = {
    gel: recovered.state.colony.resources.gel,
    crystals: recovered.state.softCrystals,
  };
  const reloadedAgain = createGame(storage);
  assert.deepEqual({
    gel: reloadedAgain.state.colony.resources.gel,
    crystals: reloadedAgain.state.softCrystals,
  }, afterRecovery);
});

test('squad, route, boon, and expedition result screens render without new bitmap assets', () => {
  const game = createGame(new Map(), createContext());
  game.openExpedition();
  assert.doesNotThrow(() => game.render());
  game.startExpedition(game.modal.selectedIds);
  assert.doesNotThrow(() => game.render());
  game.chooseExpeditionRouteNode(game.state.expeditionRun.route.choices[0].uid);
  assert.doesNotThrow(() => game.render());
  game.finishExpeditionEncounter(true);
  assert.equal(game.modal.type, 'expedition-boon');
  assert.doesNotThrow(() => game.render());
  game.abandonCurrentExpedition();
  assert.equal(game.state.phase, 'result');
  assert.doesNotThrow(() => game.render());
  tapRegisteredHit(game, 'expedition-result-return');
  assert.equal(game.state.phase, 'build');
  assert.equal(game.state.expeditionRun, null);
});

test('expedition screens consume route, beacon, and selected boon art with safe fallbacks', () => {
  const store = createFallbackAssetStore();
  const game = createGame(new Map(), createContext());
  game.setAssetStore(store);
  const run = startDefaultExpedition(game);
  game.render();
  assert.ok(store.requests.includes('expedition-beacon'));
  assert.ok(store.requests.includes('expedition-route-combat'));
  assert.ok(store.requests.includes('expedition-route-resource'));
  assert.ok(store.requests.includes('expedition-route-event'));

  game.chooseExpeditionRouteNode(run.route.choices[0].uid);
  game.finishExpeditionEncounter(true);
  const firstDraftIds = run.boonChoices.map(({ id }) => id);
  game.render();
  firstDraftIds.forEach((id) => assert.ok(store.requests.includes(id), `${id} art was not requested`));
  game.chooseExpeditionUpgrade(run.boonChoices[0].id);

  while (!run.route.isBossStage) {
    game.chooseExpeditionRouteNode(run.route.choices[0].uid);
    game.finishExpeditionEncounter(true);
    game.chooseExpeditionUpgrade(run.boonChoices[0].id);
  }
  game.render();
  assert.ok(store.requests.includes('expedition-route-boss'));
});

test('welcome, cargo HUD, and settlement request generated character and resource art', () => {
  const store = createFallbackAssetStore();
  const context = createContext();
  const game = createGame(new Map(), context);
  game.setAssetStore(store);
  game.modal = { type: 'welcome', page: 0 };
  game.render();
  for (const survivorId of [
    'survivor-shell-shell',
    'survivor-crystal-pin',
    'survivor-bubble-float',
    'survivor-moss-sprout',
  ]) assert.ok(store.requests.includes(survivorId), `${survivorId} welcome art was not requested`);

  game.modal = null;
  game.state.survivors[0].carrying = { resourceType: 'gel', amount: 4 };
  game.render();
  for (const resourceAssetId of [
    'resource-soft-gel-token',
    'resource-dew-honey-token',
    'resource-crystal-shard-token',
    'ui-soft-crystal',
  ]) assert.ok(store.requests.includes(resourceAssetId), `${resourceAssetId} HUD/cargo art was not requested`);

  game.drawExpeditionResultModal(context, {
    outcome: 'completed',
    firstClear: false,
    rewards: { 'soft-gel': 4, 'dew-honey': 3, 'crystal-shard': 2, softCrystals: 1 },
    regularWins: 4,
    eliteWins: 0,
    kills: 28,
  });
  for (const resourceAssetId of [
    'resource-soft-gel-token',
    'resource-dew-honey-token',
    'resource-crystal-shard-token',
    'ui-soft-crystal',
  ]) assert.ok(store.requests.includes(resourceAssetId), `${resourceAssetId} settlement art was not requested`);
});
