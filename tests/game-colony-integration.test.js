import test from 'node:test';
import assert from 'node:assert/strict';

import { SlimeGame } from '../src/game.js';
import { BUILDINGS, ENEMY_BY_ID } from '../src/catalog.js';
import { TERRAIN_TYPES, WORLD } from '../src/colony-catalog.js';
import { rebuildColonyJobs } from '../src/colony.js';

function createContext() {
  const gradient = () => ({ addColorStop() {} });
  return new Proxy({
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    measureText: (text) => ({ width: String(text).length * 12 }),
  }, {
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

function createGame(storage = new Map()) {
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
  const context = createContext();
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

function advance(game, seconds, step = 0.1) {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) game.update(step);
}

test('game starts on a persistent 24x16 daylight colony with every terrain interaction class', () => {
  const game = createGame();
  assert.deepEqual([game.state.worldTerrain.width, game.state.worldTerrain.height], [24, 16]);
  assert.equal(WORLD.time.dayNightCycle, false);
  const kinds = new Set(game.state.worldTerrain.cells.map((cell) => TERRAIN_TYPES[cell.terrainId].kind));
  assert.deepEqual(kinds, new Set([
    'ground',
    'resource',
    'obstacle',
    'destructible-obstacle',
    'indestructible-terrain',
  ]));
  assert.equal(game.state.colony.slimes.length, 4);
  assert.ok(game.state.colony.resourceNodes.length >= 30);
});

test('building placement uses terrain capabilities and reserves the base core', () => {
  const game = createGame();
  const tower = BUILDINGS.find(({ id }) => id === 'building-bubble-tower');
  game.state.buildings = [];
  game.selection = { kind: 'place-building', cardId: tower.id, rotation: 0 };

  assert.equal(game.selectionCellIsValid({ x: 0, y: 9 }), false, 'deep water is permanent');
  assert.equal(game.selectionCellIsValid(WORLD.base.core), false, 'the core cannot be covered');
  assert.equal(game.selectionCellIsValid({ x: 8, y: 5 }), true, 'clear ground remains buildable');
});

test('tapping wilderness exposes the correct interaction category', () => {
  const game = createGame();
  game.handleBuildCellTap({ x: 0, y: 9 });
  assert.deepEqual(
    { kind: game.selection.kind, terrainId: game.selection.terrainId },
    { kind: 'inspect-terrain', terrainId: 'deep-water' },
  );
  game.handleBuildCellTap({ x: 20, y: 1 });
  assert.equal(game.selection.terrainId, 'brittle-boulder');
  game.handleBuildCellTap({ x: 1, y: 1 });
  assert.equal(game.selection.terrainId, 'thorn-thicket');
});

test('worker slimes automatically harvest, carry, deposit, and reveal buildable ground', () => {
  const game = createGame();
  game.state.colonyDirector.nextPackAt = Infinity;
  const before = { ...game.state.colony.resources };
  const resourceCellsBefore = game.state.worldTerrain.cells
    .filter((cell) => TERRAIN_TYPES[cell.terrainId].kind === 'resource').length;

  advance(game, 45);

  const resourcesAfter = game.state.colony.resources;
  assert.ok(
    resourcesAfter.gel > before.gel
      || resourcesAfter.nectar > before.nectar
      || resourcesAfter.shard > before.shard,
    'at least one gathered load should reach the core stockpile',
  );
  const resourceCellsAfter = game.state.worldTerrain.cells
    .filter((cell) => TERRAIN_TYPES[cell.terrainId].kind === 'resource').length;
  assert.ok(resourceCellsAfter < resourceCellsBefore, 'depleted resource terrain becomes ground');
  assert.ok(game.state.survivors.some((survivor) => survivor.x !== 11 && survivor.x !== 12 && survivor.x !== 13));
});

test('placing a building creates a resource blueprint that worker slimes finish automatically', () => {
  const game = createGame();
  game.state.colonyDirector.nextPackAt = Infinity;
  game.state.colony.resources = { gel: 99, nectar: 99, shard: 99 };
  const tower = BUILDINGS.find(({ id }) => id === 'building-bubble-tower');
  game.selection = { kind: 'place-building', cardId: tower.id, rotation: 0 };
  game.handleBuildCellTap({ x: 8, y: 5 });

  const building = game.state.buildings.find(({ cardId, x, y }) => (
    cardId === tower.id && x === 8 && y === 5
  ));
  assert.equal(building.underConstruction, true);
  assert.ok(game.state.colony.blueprints.some(({ uid }) => uid === building.blueprintUid));

  advance(game, 80);
  assert.equal(building.underConstruction, false);
  assert.equal(building.buildProgress, 1);
});

test('cancelling a blueprint returns delivered and in-transit resources', () => {
  const game = createGame();
  game.state.colonyDirector.nextPackAt = Infinity;
  game.state.colony.resources = { gel: 99, nectar: 99, shard: 99 };
  const weather = BUILDINGS.find(({ id }) => id === 'building-weather-scout');
  game.selection = { kind: 'place-building', cardId: weather.id, rotation: 0 };
  game.handleBuildCellTap({ x: 8, y: 5 });
  const building = game.state.buildings.find(({ cardId, x, y }) => (
    cardId === weather.id && x === 8 && y === 5
  ));
  advance(game, 2);
  const totalBeforeCancel = Object.values(game.state.colony.resources).reduce((sum, value) => sum + value, 0)
    + game.state.colony.slimes.reduce((sum, slime) => sum + (slime.carrying?.amount || 0), 0)
    + Object.values(game.state.colony.blueprints.find(({ uid }) => uid === building.blueprintUid).delivered)
      .reduce((sum, value) => sum + value, 0);
  game.selection = { kind: 'inspect-building', uid: building.uid };
  game.cancelSelectedBlueprint();
  const totalAfterCancel = Object.values(game.state.colony.resources).reduce((sum, value) => sum + value, 0);

  assert.equal(game.state.buildings.includes(building), false);
  assert.equal(totalAfterCancel, totalBeforeCancel);
});

test('continuous director spawns a larger pack of substantially weaker monsters without a night phase', () => {
  const game = createGame();
  game.state.colonyDirector.nextPackAt = 0.1;
  advance(game, 0.2);

  const living = game.state.enemies.filter((enemy) => !enemy.dead);
  assert.ok(living.length >= 6);
  assert.ok(living.every((enemy) => enemy.maxHp < ENEMY_BY_ID[enemy.cardId].hp * 0.7));
  assert.ok(living.every((enemy) => enemy.damageMultiplier <= 0.62));
  assert.equal('night' in game.state.colonyDirector, false);
});

test('game camera and renderer load signed world chunks instead of clamping to the starter garden', () => {
  const game = createGame();
  game.camera = { x: -140, y: 90, zoom: 1 };

  assert.deepEqual(game.pointToCell({ x: 54, y: 124 }), { x: -140, y: 90 });
  assert.doesNotThrow(() => game.drawBattlefield(game.ctx));
  assert.ok(game.infiniteWorld.stats().loadedChunks > 0);
  assert.equal(game.worldCellAt(-140, 90).x, -140);
  assert.equal(game.worldCellAt(-140, 90).y, 90);
});

test('a discovered generated ground cell beyond 24x16 accepts a blueprint and workers finish it', () => {
  const game = createGame();
  game.state.colonyDirector.nextPackAt = Infinity;
  game.state.colony.resources = { gel: 99, nectar: 99, shard: 99 };
  const tower = BUILDINGS.find(({ id }) => id === 'building-bubble-tower');
  const target = { x: 24, y: 11 };
  assert.equal(game.worldCellAt(target.x, target.y).discovered, true);
  assert.equal(game.worldCellAt(target.x, target.y).buildable, true);

  game.selection = { kind: 'place-building', cardId: tower.id, rotation: 0 };
  game.handleBuildCellTap(target);
  const building = game.state.buildings.find(({ cardId, x, y }) => (
    cardId === tower.id && x === target.x && y === target.y
  ));
  assert.ok(building);
  assert.equal(building.underConstruction, true);
  assert.ok(game.state.colony.bounds.x + game.state.colony.bounds.width > 24);

  advance(game, 120);
  assert.equal(building.underConstruction, false);
  assert.equal(building.buildProgress, 1);
});

test('world exploration keeps original buildings and base construction running in parallel', () => {
  const game = createGame();
  game.state.colonyDirector.nextPackAt = Infinity;
  game.state.colony.resources = { gel: 99, nectar: 99, shard: 99 };
  const tower = BUILDINGS.find(({ id }) => id === 'building-bubble-tower');
  game.selection = { kind: 'place-building', cardId: tower.id, rotation: 0 };
  game.handleBuildCellTap({ x: 8, y: 5 });
  const blueprintBuilding = game.state.buildings.find(({ cardId, x, y }) => (
    cardId === tower.id && x === 8 && y === 5
  ));
  const buildingUids = game.state.buildings.map(({ uid }) => uid);
  const survivorUids = game.state.survivors.map(({ uid }) => uid);
  const colonyTimeBefore = game.state.colony.time;

  assert.equal(game.openExpedition(), true);
  assert.equal(game.startExpedition(game.modal.selectedIds), true);
  assert.equal(game.state.phase, 'build');
  assert.equal(game.state.paused, false);
  assert.equal(game.preBattleSnapshot, null);
  assert.deepEqual(game.state.buildings.map(({ uid }) => uid), buildingUids);
  assert.deepEqual(game.state.survivors.map(({ uid }) => uid), survivorUids);
  const site = game.state.worldExpedition.sites[0];
  assert.ok(site);
  assert.equal(game.selectWorldExpeditionSite(site.id), true);

  advance(game, 40);
  assert.ok(game.state.colony.time > colonyTimeBefore + 39);
  assert.deepEqual(game.state.buildings.slice(0, buildingUids.length).map(({ uid }) => uid), buildingUids);
  assert.ok(blueprintBuilding.buildProgress > 0 || !blueprintBuilding.underConstruction);
});

test('later exploration attempts deterministically offer negative or farther-than-starter sites', () => {
  const game = createGame();
  game.state.expeditionProgress.attempts = 1;
  assert.equal(game.openExpedition(), true);
  assert.equal(game.startExpedition(game.modal.selectedIds), true);
  assert.ok(game.state.worldExpedition.sites.length > 0);
  assert.ok(game.state.worldExpedition.sites.some((site) => (
    site.x < 0 || site.y < 0 || Math.hypot(site.x - WORLD.base.core.x, site.y - WORLD.base.core.y) > 72
  )));
});

test('saving during world exploration keeps the base and safely recalls the away squad on reload', () => {
  const storage = new Map();
  const game = createGame(storage);
  game.state.colonyDirector.nextPackAt = Infinity;
  const originalBuildingCards = game.state.buildings.map(({ cardId }) => cardId);
  assert.equal(game.openExpedition(), true);
  const selectedCardIds = [...game.modal.selectedIds];
  assert.equal(game.startExpedition(game.modal.selectedIds), true);
  const site = game.state.worldExpedition.sites[0];
  assert.ok(site);
  assert.equal(game.selectWorldExpeditionSite(site.id), true);
  advance(game, 3);
  game.save();

  const restored = createGame(storage);
  assert.equal(restored.state.worldExpedition, null);
  assert.deepEqual(restored.state.buildings.map(({ cardId }) => cardId), originalBuildingCards);
  assert.equal(restored.state.survivors.length, 4);
  assert.ok(restored.state.survivors
    .filter((survivor) => selectedCardIds.includes(survivor.cardId))
    .every((survivor) => (
    Math.abs(survivor.x - WORLD.base.rallyPoint.x) < 3
      && Math.abs(survivor.y - WORLD.base.rallyPoint.y) < 3
    )));
});

test('build-phase wounds, downed workers, and building damage survive reload', () => {
  const storage = new Map();
  const game = createGame(storage);
  game.state.colonyDirector.nextPackAt = Infinity;
  const building = game.state.buildings[0];
  const wounded = game.state.survivors[0];
  const downed = game.state.survivors[1];
  const woundedWorker = game.state.colony.slimes.find(({ uid }) => uid === wounded.uid);
  const downedWorker = game.state.colony.slimes.find(({ uid }) => uid === downed.uid);
  building.hp = 1;
  wounded.hp = 3;
  wounded.downed = false;
  woundedWorker.hp = 3;
  downed.hp = 0;
  downed.downed = true;
  downedWorker.hp = 0;
  downedWorker.aiState = 'downed';
  const nectarBefore = game.state.colony.resources.nectar;

  game.save();
  const restored = createGame(storage);
  const restoredBuilding = restored.state.buildings.find(({ cardId }) => cardId === building.cardId);
  const restoredWounded = restored.state.survivors.find(({ cardId }) => cardId === wounded.cardId);
  const restoredDowned = restored.state.survivors.find(({ cardId }) => cardId === downed.cardId);
  const restoredWoundedWorker = restored.state.colony.slimes
    .find(({ uid }) => uid === restoredWounded.uid);
  const restoredDownedWorker = restored.state.colony.slimes
    .find(({ uid }) => uid === restoredDowned.uid);

  assert.equal(restoredBuilding.hp, 1);
  assert.equal(restoredWounded.hp, 3);
  assert.equal(restoredWounded.downed, false);
  assert.equal(restoredWoundedWorker.hp, 3);
  assert.equal(restoredDowned.hp, 0);
  assert.equal(restoredDowned.downed, true);
  assert.equal(restoredDownedWorker.hp, 0);
  assert.equal(restoredDownedWorker.aiState, 'downed');
  assert.equal(restored.state.colony.resources.nectar, nectarBefore);
});

test('manual survivor relocation rejects fog and restores safely at discovered signed coordinates', () => {
  const storage = new Map();
  const game = createGame(storage);
  const survivor = game.state.survivors[0];
  const original = { x: survivor.x, y: survivor.y };

  game.selection = { kind: 'move-survivor', uid: survivor.uid };
  assert.equal(game.selectionCellIsValid({ x: -100, y: -100 }), false);
  game.handleBuildCellTap({ x: -100, y: -100 });
  assert.deepEqual({ x: survivor.x, y: survivor.y }, original);

  game.infiniteWorld.reveal(-32, -32, 7);
  let target = null;
  for (let y = -38; y <= -26 && !target; y += 1) {
    for (let x = -38; x <= -26; x += 1) {
      const cell = game.worldCellAt(x, y);
      if (cell.discovered && cell.passable) {
        target = { x, y };
        break;
      }
    }
  }
  assert.ok(target);
  game.selection = { kind: 'move-survivor', uid: survivor.uid };
  assert.equal(game.selectionCellIsValid(target), true);
  game.handleBuildCellTap(target);
  assert.deepEqual({ x: survivor.x, y: survivor.y }, target);
  const worker = game.state.colony.slimes.find(({ uid }) => uid === survivor.uid);
  assert.deepEqual({ x: worker.x, y: worker.y }, target);
  assert.ok(game.state.colony.bounds.x <= target.x);
  assert.ok(game.state.colony.bounds.y <= target.y);

  game.save();
  let restored = null;
  assert.doesNotThrow(() => { restored = createGame(storage); });
  const restoredSurvivor = restored.state.survivors.find(({ cardId }) => cardId === survivor.cardId);
  assert.deepEqual({ x: restoredSurvivor.x, y: restoredSurvivor.y }, target);
});

test('far generated blueprints keep destructible-job scanning bounded', () => {
  const game = createGame();
  const tower = BUILDINGS.find(({ id }) => id === 'building-bubble-tower');
  game.infiniteWorld.reveal(5000, -5000, 8);
  let target = null;
  for (let y = -5008; y <= -4992 && !target; y += 1) {
    for (let x = 4992; x <= 5008; x += 1) {
      const cell = game.worldCellAt(x, y);
      if (cell.discovered && cell.buildable) {
        target = { x, y };
        break;
      }
    }
  }
  assert.ok(target);
  game.selection = { kind: 'place-building', cardId: tower.id, rotation: 0 };
  game.handleBuildCellTap(target);
  assert.ok(game.state.colony.bounds.width > 4900);
  assert.ok(game.state.colony.bounds.height > 4900);

  let terrainQueries = 0;
  const terrainQuery = game.state.colony.terrainQuery;
  game.state.colony.terrainQuery = (...args) => {
    terrainQueries += 1;
    return terrainQuery(...args);
  };
  rebuildColonyJobs(game.state.colony);
  assert.ok(terrainQueries < 1200, `expected bounded terrain checks, received ${terrainQueries}`);
  assert.ok(game.colonyWorkCells().length < 1200);
});

test('300 historical outposts and their resource jobs share one bounded terrain scan per update', () => {
  const game = createGame();
  game.state.colonyDirector.nextPackAt = Infinity;
  game.state.enemies = [];
  game.state.expeditionProgress.outposts = Array.from({ length: 300 }, (_, index) => ({
    id: `historical-outpost-${index}`,
    x: 1000 + index * 7,
    y: -1000 - index * 5,
    name: `生态前哨 ${index}`,
  }));
  game.syncColonyDepots();
  game.state.colony.resourceNodes = game.state.expeditionProgress.outposts.flatMap((outpost, outpostIndex) => (
    Array.from({ length: 8 }, (_, nodeIndex) => ({
      uid: `relay-resource-${outpostIndex}-${nodeIndex}`,
      x: outpost.x,
      y: outpost.y,
      resourceType: ['gel', 'nectar', 'shard'][nodeIndex % 3],
      amount: 2,
      harvestSeconds: 2.5,
      reservedBy: null,
    }))
  ));
  for (const slime of game.state.colony.slimes) {
    slime.job = null;
    slime.path = [];
    slime.aiState = 'idle';
    slime.thinkTimer = 0;
  }

  let providerCalls = 0;
  let candidateCells = 0;
  let worldCellQueries = 0;
  const jobCellProvider = game.state.colony.jobCellProvider;
  const worldCellAt = game.worldCellAt.bind(game);
  game.state.colony.jobCellProvider = (...args) => {
    providerCalls += 1;
    const cells = jobCellProvider(...args);
    candidateCells += cells.length;
    return cells;
  };
  game.worldCellAt = (...args) => {
    worldCellQueries += 1;
    return worldCellAt(...args);
  };

  game.update(0.25);

  assert.equal(game.state.colony.depots.length, 301, 'the relay network remains available');
  assert.equal(providerCalls, 1, 'idle workers must share the same think-cycle job snapshot');
  assert.ok(candidateCells < 1200, `expected bounded work cells, received ${candidateCells}`);
  assert.ok(worldCellQueries < 5000, `expected bounded world queries, received ${worldCellQueries}`);
  assert.ok(game.infiniteWorld.stats().loadedChunks < 16, 'historical relay scans must not churn the chunk cache');
});

test('a resource-free outpost persists exact local clear targets and workers can clear them after reload', () => {
  const storage = new Map();
  const game = createGame(storage);
  const outpost = {
    id: 'poi:nest:-1850,-1940',
    x: -1850,
    y: -1940,
    name: '远方怪物巢穴前哨',
  };
  game.state.expeditionProgress.outposts.push(outpost);
  game.syncColonyDepots();
  game.state.colony.resourceNodes = [];

  assert.ok(game.indexOutpostClearTargets(outpost, 4) > 0);
  const relayCells = [];
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      if (dx * dx + dy * dy <= 16) relayCells.push({ x: outpost.x + dx, y: outpost.y + dy });
    }
  }
  const indexedTargets = game.state.expeditionProgress.activeClearTargets.map(({ x, y }) => ({ x, y }));
  assert.ok(indexedTargets.every(({ x, y }) => game.worldCellAt(x, y).destructible));
  assert.equal(game.registerDiscoveredResourceNodes(relayCells), 0, 'the relay has no harvestable node');
  rebuildColonyJobs(game.state.colony);
  assert.ok(indexedTargets.every((target) => game.state.colony.jobs.some((job) => (
    job.type === 'clear' && target.x === job.x && target.y === job.y
  ))));
  game.save();

  const restored = createGame(storage);
  restored.state.colonyDirector.nextPackAt = Infinity;
  restored.state.colony.resourceNodes = [];
  restored.state.colony.workPriorities.clear = 20;
  assert.deepEqual(
    restored.state.expeditionProgress.activeClearTargets.map(({ x, y }) => ({ x, y })),
    indexedTargets,
  );
  rebuildColonyJobs(restored.state.colony);
  assert.ok(indexedTargets.every((target) => restored.state.colony.jobs.some((job) => (
    job.type === 'clear' && target.x === job.x && target.y === job.y
  ))));

  advance(restored, 90);
  assert.ok(
    restored.state.expeditionProgress.activeClearTargets.length < indexedTargets.length,
    'workers should remove cleared coordinates from the persisted active index',
  );
});

test('discovered generated resources become real jobs and depleted terrain persists as ground', () => {
  const storage = new Map();
  const game = createGame(storage);
  game.state.colonyDirector.nextPackAt = Infinity;
  game.state.colony.resourceNodes = [];
  for (const slime of game.state.colony.slimes) {
    slime.job = null;
    slime.path = [];
    slime.carrying = null;
    slime.aiState = 'idle';
  }
  const target = { x: 24, y: 5 };
  const generated = game.worldCellAt(target.x, target.y);
  assert.equal(generated.terrainId, 'dew-honey');
  assert.equal(generated.discovered, true);
  assert.equal(game.registerDiscoveredResourceNodes([target]), 1);
  assert.ok(game.state.colony.resourceNodes.some((node) => (
    node.x === target.x && node.y === target.y && node.resourceType === 'nectar'
  )));
  const nectarBefore = game.state.colony.resources.nectar;

  advance(game, 80);
  assert.ok(game.state.colony.resources.nectar > nectarBefore);
  assert.equal(game.worldCellAt(target.x, target.y).terrainId, 'ground');
  assert.equal(game.state.colony.resourceNodes.some((node) => node.x === target.x && node.y === target.y), false);
  game.save();

  const restored = createGame(storage);
  assert.equal(restored.worldCellAt(target.x, target.y).terrainId, 'ground');
  assert.equal(restored.state.colony.resourceNodes.some((node) => node.x === target.x && node.y === target.y), false);
});

test('saving refunds both stockpile-bound and blueprint-bound carried materials in the snapshot', () => {
  const storage = new Map();
  const game = createGame(storage);
  game.state.colony.resources = { gel: 10, nectar: 8, shard: 6 };
  game.state.colony.slimes[0].carrying = { resourceType: 'gel', amount: 3, destination: 'base' };
  game.state.colony.slimes[1].carrying = { resourceType: 'shard', amount: 2, destination: 'blueprint' };

  game.save();
  const payload = JSON.parse([...storage.values()][0]);
  assert.deepEqual(payload.colonyResources, { gel: 13, nectar: 8, shard: 8 });
  assert.deepEqual(game.state.colony.resources, { gel: 10, nectar: 8, shard: 6 }, 'live state is untouched');

  const restored = createGame(storage);
  assert.deepEqual(restored.state.colony.resources, { gel: 13, nectar: 8, shard: 8 });
});

test('a distant discovered brittle boulder is cleared, yields shard, and stays ground after reload', () => {
  const storage = new Map();
  const game = createGame(storage);
  game.state.colonyDirector.nextPackAt = Infinity;
  game.state.colony.resourceNodes = [];
  let target = null;
  for (let y = -80; y <= -32 && !target; y += 1) {
    for (let x = 40; x <= 88; x += 1) {
      if (game.worldCellAt(x, y).terrainId === 'brittle-boulder') {
        target = { x, y };
        break;
      }
    }
  }
  assert.ok(target);
  game.infiniteWorld.reveal(target.x, target.y, 4);
  const worker = game.state.colony.slimes[0];
  const survivor = game.state.survivors.find(({ uid }) => uid === worker.uid);
  const approach = { x: target.x + 1, y: target.y };
  game.infiniteWorld.setTerrain(approach.x, approach.y, 'ground');
  worker.x = approach.x;
  worker.y = approach.y;
  survivor.x = approach.x;
  survivor.y = approach.y;
  game.ensureColonyBounds([target, approach]);
  const shardBefore = game.state.colony.resources.shard;

  advance(game, 12, 0.05);
  assert.equal(game.worldCellAt(target.x, target.y).terrainId, 'ground');
  assert.ok(game.state.colony.resources.shard > shardBefore);
  game.save();

  const restored = createGame(storage);
  assert.equal(restored.worldCellAt(target.x, target.y).terrainId, 'ground');
});
