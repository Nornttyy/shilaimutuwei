import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE_SAFE_RADIUS,
  CHUNK_SIZE,
  CORE_CELL,
  INFINITE_WORLD_GENERATOR_VERSION,
  INFINITE_WORLD_SCHEMA_VERSION,
  TERRAIN_IDS,
  chunksForBounds,
  createInfiniteWorld,
  distanceProfileAt,
  floorDiv,
  floorMod,
  generateChunk,
  isInBaseSafeZone,
  restoreInfiniteWorld,
  worldToChunk,
  zoneForChunk,
} from '../src/infinite-world.js';

const obstacleIds = new Set(['thorn-thicket', 'brittle-boulder', 'deep-water']);

function terrainCounts(chunks) {
  const counts = Object.fromEntries(TERRAIN_IDS.map((terrainId) => [terrainId, 0]));
  for (const chunk of chunks) {
    for (const cell of chunk.cells) counts[cell.terrainId] += 1;
  }
  return counts;
}

function findBaseCell(world, predicate, radius = 30) {
  for (let chunkY = -radius; chunkY <= radius; chunkY += 1) {
    for (let chunkX = -radius; chunkX <= radius; chunkX += 1) {
      const cell = generateChunk({ seed: world.seed, chunkX, chunkY })
        .cells.find(predicate);
      if (cell) return cell;
    }
  }
  throw new Error('matching generated cell was not found');
}

test('16x16 coordinate mapping is exact for zero, boundaries, negative, and far cells', () => {
  assert.equal(CHUNK_SIZE, 16);
  assert.deepEqual(
    [floorDiv(-17), floorMod(-17), floorDiv(-16), floorMod(-16), floorDiv(-1), floorMod(-1)],
    [-2, 15, -1, 0, -1, 15],
  );

  assert.deepEqual(
    worldToChunk(-1, -17),
    {
      chunkX: -1,
      chunkY: -2,
      cx: -1,
      cy: -2,
      localX: 15,
      localY: 15,
      lx: 15,
      ly: 15,
      index: 255,
      key: '-1,-2',
    },
  );
  assert.deepEqual(
    chunksForBounds({ minX: -16, minY: -1, maxXExclusive: 16, maxYExclusive: 16 }),
    [
      { chunkX: -1, chunkY: -1, key: '-1,-1' },
      { chunkX: 0, chunkY: -1, key: '0,-1' },
      { chunkX: -1, chunkY: 0, key: '-1,0' },
      { chunkX: 0, chunkY: 0, key: '0,0' },
    ],
  );

  const far = 4_000_000_000_000;
  const mapped = worldToChunk(-far - 1, far + 15);
  assert.equal(mapped.localX >= 0 && mapped.localX < CHUNK_SIZE, true);
  assert.equal(mapped.localY >= 0 && mapped.localY < CHUNK_SIZE, true);
  assert.equal(mapped.chunkX * CHUNK_SIZE + mapped.localX, -far - 1);
  assert.equal(mapped.chunkY * CHUNK_SIZE + mapped.localY, far + 15);
  assert.throws(() => worldToChunk(1.5, 0), /safe integer/);
  assert.throws(() => worldToChunk(Number.MAX_SAFE_INTEGER + 1, 0), /safe integer/);
});

test('chunk generation is immutable, order-independent, and deterministic at negative and far coordinates', () => {
  const coordinates = [
    [0, 0],
    [-1, 3],
    [234_567_890, -345_678_901],
  ];
  const forward = coordinates.map(([chunkX, chunkY]) => generateChunk({
    seed: 'deterministic-world', chunkX, chunkY,
  }));
  const reverse = [...coordinates].reverse().map(([chunkX, chunkY]) => generateChunk({
    seed: 'deterministic-world', chunkX, chunkY,
  })).reverse();
  assert.deepEqual(forward, reverse);
  assert.notDeepEqual(
    generateChunk({ seed: 'deterministic-world', chunkX: -7, chunkY: 11 }).cells,
    generateChunk({ seed: 'another-world', chunkX: -7, chunkY: 11 }).cells,
  );
  for (const chunk of forward) {
    assert.equal(chunk.size, 16);
    assert.equal(chunk.cells.length, 256);
    assert.equal(Object.isFrozen(chunk), true);
    assert.equal(Object.isFrozen(chunk.cells), true);
    assert.equal(Object.isFrozen(chunk.cells[0]), true);
  }
});

test('the safe circle around the existing 12,8 core is ground and contains no hostile POI', () => {
  assert.deepEqual(CORE_CELL, { x: 12, y: 8 });
  const chunks = [];
  for (let chunkY = -1; chunkY <= 1; chunkY += 1) {
    for (let chunkX = 0; chunkX <= 1; chunkX += 1) {
      chunks.push(generateChunk({ seed: 'safe-home', chunkX, chunkY }));
    }
  }

  for (let y = CORE_CELL.y - BASE_SAFE_RADIUS; y <= CORE_CELL.y + BASE_SAFE_RADIUS; y += 1) {
    for (let x = CORE_CELL.x - BASE_SAFE_RADIUS; x <= CORE_CELL.x + BASE_SAFE_RADIUS; x += 1) {
      if (!isInBaseSafeZone(x, y)) continue;
      const coordinate = worldToChunk(x, y);
      const chunk = chunks.find((candidate) => candidate.chunkX === coordinate.chunkX
        && candidate.chunkY === coordinate.chunkY);
      assert.ok(chunk, `safe cell ${x},${y} was not generated`);
      const cell = chunk.cells[coordinate.index];
      assert.equal(cell.terrainId, 'ground');
      assert.equal(cell.safe, true);
      assert.equal(cell.buildable, true);
    }
  }
  for (const poi of chunks.flatMap(({ pois }) => pois)) {
    assert.equal(isInBaseSafeZone(poi.x, poi.y), false, `${poi.id} entered the safe zone`);
    assert.notEqual(poi.kind, 'nest', `${poi.id} is a hostile home POI`);
  }
});

test('all seven terrain types appear and far profiles shift toward obstacles', () => {
  const nearChunks = [];
  const farChunks = [];
  for (let offset = -5; offset <= 5; offset += 1) {
    nearChunks.push(generateChunk({ seed: 'terrain-spread', chunkX: offset, chunkY: 3 }));
    nearChunks.push(generateChunk({ seed: 'terrain-spread', chunkX: 3, chunkY: offset }));
    farChunks.push(generateChunk({ seed: 'terrain-spread', chunkX: 180 + offset, chunkY: 180 }));
    farChunks.push(generateChunk({ seed: 'terrain-spread', chunkX: -180, chunkY: 180 + offset }));
  }
  const allCounts = terrainCounts([...nearChunks, ...farChunks]);
  for (const terrainId of TERRAIN_IDS) {
    assert.ok(allCounts[terrainId] > 0, `${terrainId} never generated`);
  }

  const nearCounts = terrainCounts(nearChunks);
  const farCounts = terrainCounts(farChunks);
  const obstacleTotal = (counts) => [...obstacleIds]
    .reduce((total, terrainId) => total + counts[terrainId], 0);
  assert.ok(obstacleTotal(farCounts) > obstacleTotal(nearCounts));

  const nearProfile = distanceProfileAt(CORE_CELL.x + 8, CORE_CELL.y);
  const farProfile = distanceProfileAt(CORE_CELL.x + 20_000, CORE_CELL.y - 20_000);
  assert.ok(farProfile.distanceBand > nearProfile.distanceBand);
  assert.ok(farProfile.obstacleChance > nearProfile.obstacleChance);
  assert.ok(farProfile.nestChance > nearProfile.nestChance);
});

test('distance-scaled nests, bright landmarks, and one deterministic regional Boss are real POIs', () => {
  const seed = 'poi-world';
  const zone = zoneForChunk({ seed, chunkX: 8, chunkY: 0 });
  assert.equal(zone.home, false);
  assert.ok(zone.boss);
  assert.match(zone.name, /软胶|露蜜|晶屑|泡泡|软壳/);
  const bossChunk = generateChunk({
    seed,
    chunkX: zone.boss.chunkX,
    chunkY: zone.boss.chunkY,
  });
  const bosses = bossChunk.pois.filter(({ kind }) => kind === 'boss');
  assert.equal(bosses.length, 1);
  assert.equal(bosses[0].regionBoss, true);
  assert.equal(bosses[0].zoneId, zone.id);
  assert.ok(bosses[0].revealRadius > 0);
  assert.equal(bossChunk.cells[worldToChunk(bosses[0].x, bosses[0].y).index].terrainId, 'ground');

  const kinds = new Set(['boss']);
  for (let chunkY = 80; chunkY < 100; chunkY += 1) {
    for (let chunkX = -100; chunkX < -80; chunkX += 1) {
      for (const poi of generateChunk({ seed, chunkX, chunkY }).pois) kinds.add(poi.kind);
    }
  }
  assert.equal(kinds.has('nest'), true);
  assert.equal(kinds.has('landmark'), true);
});

test('camera-radius loading evicts far chunks and remains bounded during long travel', () => {
  const world = createInfiniteWorld({ seed: 'bounded-cache', maxLoadedChunks: 9 });
  const homeChunk = generateChunk({ seed: world.seed, chunkX: 0, chunkY: 0 });
  const first = world.loadAround({ x: 12, y: 8 }, 40);
  assert.equal(first.length, 9);
  assert.equal(world.stats().loadedChunks, 9);
  assert.equal(world.cacheKeys().includes('0,0'), true);

  world.loadAroundCamera({ x: -80_000, y: 120_000 }, 48);
  assert.ok(world.stats().loadedChunks <= 9);
  assert.equal(world.cacheKeys().includes('0,0'), false);
  assert.deepEqual(world.getChunk(0, 0).cells.map(({ terrainId }) => terrainId), homeChunk.cells.map(({ terrainId }) => terrainId));

  // Five hundred large jumps regenerate several thousand chunks while the
  // resident cache must stay fixed at nine entries.
  for (let step = 0; step < 500; step += 1) {
    world.loadAround({ x: step * 97, y: -step * 131 }, 24);
    assert.ok(world.stats().loadedChunks <= 9);
  }
  assert.equal(world.stats().discoveryChunks, 0, 'camera travel must not accumulate discovery implicitly');
  assert.equal(world.stats().modifiedCells, 0, 'camera travel must not accumulate cell state');
});

test('updateCamera returns lightweight base chunks unless resolved cells are requested', () => {
  const world = createInfiniteWorld({ seed: 'camera-resolution', maxLoadedChunks: 9 });
  const bounds = {
    minX: 0,
    minY: 0,
    maxXExclusive: CHUNK_SIZE,
    maxYExclusive: CHUNK_SIZE,
  };

  const baseChunks = world.updateCamera(bounds, { paddingChunks: 0 });
  const baseHomeChunk = baseChunks.find(({ chunkX, chunkY }) => chunkX === 0 && chunkY === 0);
  assert.ok(baseHomeChunk);
  assert.equal(Object.hasOwn(baseHomeChunk.cells[0], 'discovered'), false);

  world.reveal(CORE_CELL.x, CORE_CELL.y);
  const resolvedChunks = world.updateCamera(bounds, {
    paddingChunks: 0,
    resolved: true,
  });
  const resolvedHomeChunk = resolvedChunks.find(({ chunkX, chunkY }) => (
    chunkX === 0 && chunkY === 0
  ));
  assert.ok(resolvedHomeChunk);
  const coreCell = resolvedHomeChunk.cells[worldToChunk(CORE_CELL.x, CORE_CELL.y).index];
  assert.equal(Object.hasOwn(coreCell, 'discovered'), true);
  assert.equal(coreCell.discovered, true);
});

test('resolved cell hot reads reuse immutable objects and invalidate only changed cells', () => {
  const world = createInfiniteWorld({ seed: 'resolved-cell-cache', maxLoadedChunks: 4 });
  const x = CHUNK_SIZE * 2 + 3;
  const y = -CHUNK_SIZE + 5;

  const initial = world.getCell(x, y);
  assert.equal(world.getCell(x, y), initial,
    'unchanged render reads should reuse the resolved immutable cell');

  world.reveal(x, y);
  const discovered = world.getCell(x, y);
  assert.notEqual(discovered, initial);
  assert.equal(discovered.discovered, true);
  assert.equal(world.getCell(x, y), discovered,
    'the newly discovered value should become the next hot cache entry');

  const replacement = discovered.terrainId === 'ground' ? 'soft-gel' : 'ground';
  world.setTerrain(x, y, replacement);
  const modified = world.getCell(x, y);
  assert.notEqual(modified, discovered);
  assert.equal(modified.terrainId, replacement);
  assert.equal(modified.modified, true);
  assert.equal(world.getCell(x, y), modified,
    'a terrain delta invalidates exactly once, then returns to the hot path');
});

test('timestamp LRU refreshes hot chunks without depending on Map insertion order', () => {
  const world = createInfiniteWorld({ seed: 'timestamp-lru', maxLoadedChunks: 2 });
  world.getCell(0, 0);
  world.getCell(CHUNK_SIZE, 0);
  world.getCell(0, 0);
  world.getCell(CHUNK_SIZE * 2, 0);

  assert.deepEqual(new Set(world.cacheKeys()), new Set(['0,0', '2,0']));
  assert.equal(world.stats().loadedChunks, 2);
});

test('discovery plus harvest, destruction, and building deltas survive eviction and restore', () => {
  const world = createInfiniteWorld({ seed: 'persistent-world', maxLoadedChunks: 4 });
  const resource = findBaseCell(world, (cell) => cell.harvestable && !cell.safe);
  const boulder = findBaseCell(world, (cell) => cell.terrainId === 'brittle-boulder');
  const ground = findBaseCell(world, (cell) => cell.buildable && !cell.safe
    && (cell.x !== resource.x || cell.y !== resource.y)
    && (cell.x !== boulder.x || cell.y !== boulder.y));

  assert.equal(world.harvestCell(resource.x, resource.y).ok, true);
  assert.equal(world.destroyCell(boulder.x, boulder.y).ok, true);
  assert.equal(world.buildAt(ground.x, ground.y, { id: 'building-test-home', solid: true }).ok, true);
  world.reveal(resource.x, resource.y, 2);
  world.setPoiState('poi:test', { cleared: true, rewardClaimed: false });

  world.loadAround({ x: 900_000, y: -700_000 }, 80);
  assert.equal(world.cacheKeys().includes(worldToChunk(resource.x, resource.y).key), false);
  assert.equal(world.getCell(resource.x, resource.y).terrainId, 'ground');
  assert.equal(world.getCell(boulder.x, boulder.y).terrainId, 'ground');
  assert.equal(world.getCell(ground.x, ground.y).building.id, 'building-test-home');
  assert.equal(world.getCell(ground.x, ground.y).passable, false);
  assert.equal(world.isDiscovered(resource.x, resource.y), true);

  const snapshot = world.serialize();
  assert.equal(snapshot.schemaVersion, INFINITE_WORLD_SCHEMA_VERSION);
  assert.equal(snapshot.generatorVersion, INFINITE_WORLD_GENERATOR_VERSION);
  assert.equal(snapshot.chunkSize, 16);
  assert.equal('cache' in snapshot, false);
  assert.equal('loadedChunks' in snapshot, false);
  const restored = restoreInfiniteWorld(JSON.stringify(snapshot), { maxLoadedChunks: 3 });
  assert.equal(restored.stats().loadedChunks, 0, 'runtime cache must regenerate after restore');
  assert.equal(restored.getCell(resource.x, resource.y).terrainId, 'ground');
  assert.equal(restored.getCell(boulder.x, boulder.y).terrainId, 'ground');
  assert.equal(restored.getCell(ground.x, ground.y).building.id, 'building-test-home');
  assert.equal(restored.isDiscovered(resource.x, resource.y), true);
  assert.deepEqual(restored.getPoiState('poi:test'), { cleared: true, rewardClaimed: false });
  assert.deepEqual(restored.serialize(), snapshot, 'restore must produce a canonical save');

  assert.equal(restored.removeBuildingAt(ground.x, ground.y).ok, true);
  assert.equal(restored.getCell(ground.x, ground.y).building, null);
  restored.setTerrain(resource.x, resource.y, restored.peekBaseCell(resource.x, resource.y).terrainId);
  assert.equal(restored.getCellDelta(resource.x, resource.y), null, 'returning to procedural terrain removes the sparse delta');
});

test('restore rejects corrupted or incompatible snapshots without accepting partial state', () => {
  const snapshot = createInfiniteWorld({ seed: 'restore-validation' }).serialize();
  assert.throws(
    () => restoreInfiniteWorld({ ...snapshot, schemaVersion: 999 }),
    /unsupported schemaVersion/,
  );
  assert.throws(
    () => restoreInfiniteWorld({ ...snapshot, generatorVersion: 999 }),
    /unsupported generatorVersion/,
  );
  assert.throws(
    () => restoreInfiniteWorld({ ...snapshot, discovery: [{ chunkX: 0, chunkY: 0, bits: [1] }] }),
    /discovery bits/,
  );
  assert.throws(() => restoreInfiniteWorld('{bad json'), /valid JSON/);
});
