import test from 'node:test';
import assert from 'node:assert/strict';

import { SlimeGame } from '../src/game.js';
import { BUILDINGS, ENEMY_BY_ID } from '../src/catalog.js';
import { TERRAIN_TYPES, WORLD } from '../src/colony-catalog.js';

function createGame() {
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
  const canvas = {
    width: 1280,
    height: 720,
    getContext: () => ({}),
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
