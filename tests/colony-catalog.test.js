import test from 'node:test';
import assert from 'node:assert/strict';

import { CARD_BY_ID, ENEMY_BY_ID } from '../src/catalog.js';
import {
  BUILDING_RECIPES,
  BUILDING_RECIPE_BY_ID,
  COLONY_CATALOG,
  ENEMY_PACK_BY_ID,
  ENEMY_PACK_TEMPLATES,
  INITIAL_TERRAIN,
  INITIAL_WORLD_TERRAIN,
  SLIME_JOB_BY_ID,
  SLIME_JOBS,
  TERRAIN_TYPES,
  THREAT_CURVE,
  WORLD,
  createInitialTerrain,
  terrainAllowsPath,
  terrainAllowsPlacement,
  terrainAt,
} from '../src/colony-catalog.js';

const insideWorld = ({ x, y }) => Number.isInteger(x)
  && Number.isInteger(y)
  && x >= 0
  && x < WORLD.width
  && y >= 0
  && y < WORLD.height;

const insideZone = (cell, zone) => cell.x >= zone.x
  && cell.x < zone.x + zone.width
  && cell.y >= zone.y
  && cell.y < zone.y + zone.height;

function assertDeepFrozen(value, path = 'catalog') {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const [key, child] of Object.entries(value)) {
    assertDeepFrozen(child, `${path}.${key}`);
  }
}

const recipeTotal = (buildingIds) => buildingIds.reduce((total, buildingId) => {
  for (const [resourceId, amount] of Object.entries(BUILDING_RECIPE_BY_ID[buildingId].recipe)) {
    total[resourceId] = (total[resourceId] ?? 0) + amount;
  }
  return total;
}, {});

test('colony catalog is deeply immutable and keeps continuous daylight', () => {
  assertDeepFrozen(COLONY_CATALOG);
  assertDeepFrozen(BUILDING_RECIPE_BY_ID);
  assertDeepFrozen(SLIME_JOB_BY_ID);
  assertDeepFrozen(ENEMY_PACK_BY_ID);

  assert.deepEqual([WORLD.width, WORLD.height], [24, 16]);
  assert.equal(WORLD.time.mode, 'continuous');
  assert.equal(WORLD.time.dayNightCycle, false);
  assert.equal(WORLD.time.fixedLighting, 'daylight');
  assert.equal('phases' in COLONY_CATALOG, false);
  assert.throws(() => {
    WORLD.width = 6;
  }, TypeError);
});

test('terrain interaction contract covers ground, resources, and all obstacle classes', () => {
  const requiredFields = [
    'passable',
    'buildable',
    'harvestable',
    'destructible',
    'yield',
    'replacement',
  ];

  for (const [terrainId, terrain] of Object.entries(TERRAIN_TYPES)) {
    assert.equal(terrain.id, terrainId);
    for (const field of requiredFields) {
      assert.equal(field in terrain, true, `${terrainId} lacks ${field}`);
    }
    for (const field of requiredFields.slice(0, 4)) {
      assert.equal(typeof terrain[field], 'boolean', `${terrainId}.${field}`);
    }
  }

  assert.deepEqual(
    Object.values(TERRAIN_TYPES).map(({ kind }) => kind).sort(),
    [
      'destructible-obstacle',
      'ground',
      'indestructible-terrain',
      'obstacle',
      'resource',
      'resource',
      'resource',
    ],
  );

  const resourceTerrains = Object.values(TERRAIN_TYPES)
    .filter(({ kind }) => kind === 'resource');
  assert.deepEqual(
    resourceTerrains.map(({ yield: output }) => output.resourceId).sort(),
    ['crystal-shard', 'dew-honey', 'soft-gel'],
  );
  for (const terrain of resourceTerrains) {
    assert.equal(terrain.passable, true);
    assert.equal(terrain.buildable, false);
    assert.equal(terrain.harvestable, true);
    assert.equal(terrain.destructible, false);
    assert.equal(terrain.replacement, 'ground');
    assert.ok(terrain.yield.amount > 0);
    assert.ok(terrain.yield.gatherSeconds > 0);
  }

  assert.equal(TERRAIN_TYPES.ground.buildable, true);
  assert.equal(TERRAIN_TYPES['brittle-boulder'].destructible, true);
  assert.equal(TERRAIN_TYPES['brittle-boulder'].replacement, 'ground');
  assert.equal(TERRAIN_TYPES['deep-water'].destructible, false);
  assert.equal(TERRAIN_TYPES['deep-water'].replacement, null);
});

test('initial terrain uses unique, connected organic clusters inside WORLD coordinates', () => {
  assert.ok(Number.isSafeInteger(INITIAL_TERRAIN.seed));
  assert.equal(INITIAL_TERRAIN.defaultTerrainId, 'ground');
  assert.ok(INITIAL_TERRAIN.clusters.length >= 10);

  const occupied = new Set();
  const clusterIds = new Set();
  const baseZone = WORLD.base.spawnZone;

  for (const terrainCluster of INITIAL_TERRAIN.clusters) {
    assert.equal(clusterIds.has(terrainCluster.id), false, `duplicate ${terrainCluster.id}`);
    clusterIds.add(terrainCluster.id);
    assert.ok(TERRAIN_TYPES[terrainCluster.terrainId], terrainCluster.terrainId);
    assert.ok(terrainCluster.cells.length >= 5, `${terrainCluster.id} is not a cluster`);

    const local = new Set(terrainCluster.cells.map(({ x, y }) => `${x},${y}`));
    assert.equal(local.size, terrainCluster.cells.length, `${terrainCluster.id} repeats a cell`);
    const pending = [terrainCluster.cells[0]];
    const visited = new Set();
    while (pending.length) {
      const current = pending.pop();
      const key = `${current.x},${current.y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const neighbourKey = `${current.x + dx},${current.y + dy}`;
        if (local.has(neighbourKey) && !visited.has(neighbourKey)) {
          pending.push({ x: current.x + dx, y: current.y + dy });
        }
      }
    }
    assert.equal(visited.size, terrainCluster.cells.length, `${terrainCluster.id} is disconnected`);

    const xs = terrainCluster.cells.map(({ x }) => x);
    const ys = terrainCluster.cells.map(({ y }) => y);
    const boundingArea = (Math.max(...xs) - Math.min(...xs) + 1)
      * (Math.max(...ys) - Math.min(...ys) + 1);
    assert.ok(new Set(xs).size > 1 && new Set(ys).size > 1, `${terrainCluster.id} is a line`);
    assert.ok(terrainCluster.cells.length < boundingArea, `${terrainCluster.id} is a rigid rectangle`);

    for (const cell of terrainCluster.cells) {
      assert.equal(insideWorld(cell), true, `${terrainCluster.id} is outside WORLD`);
      assert.equal(insideZone(cell, baseZone), false, `${terrainCluster.id} blocks base spawn`);
      const key = `${cell.x},${cell.y}`;
      assert.equal(occupied.has(key), false, `terrain overlap at ${key}`);
      occupied.add(key);
    }
  }

  for (const resourceId of ['soft-gel', 'dew-honey', 'crystal-shard']) {
    assert.ok(
      INITIAL_TERRAIN.clusters.filter(({ terrainId }) => terrainId === resourceId).length >= 2,
      `${resourceId} is not distributed around the map`,
    );
  }
});

test('terrain generator is deterministic and exposes placement and path queries', () => {
  const first = createInitialTerrain(INITIAL_TERRAIN.seed);
  const replay = createInitialTerrain(INITIAL_TERRAIN.seed);
  const alternateVisualSeed = createInitialTerrain(INITIAL_TERRAIN.seed + 1);

  assert.deepEqual(first, replay);
  assert.equal(first.width, WORLD.width);
  assert.equal(first.height, WORLD.height);
  assert.equal(first.cells.length, WORLD.width * WORLD.height);
  assert.deepEqual(first, INITIAL_WORLD_TERRAIN);
  assert.deepEqual(
    first.cells.map(({ terrainId }) => terrainId),
    alternateVisualSeed.cells.map(({ terrainId }) => terrainId),
    'seed must not move authored gameplay terrain',
  );
  assert.ok(
    first.cells.some((cell, index) => (
      cell.visualVariant !== alternateVisualSeed.cells[index].visualVariant
    )),
    'different seeds should vary terrain rendering',
  );

  for (const cell of first.cells) {
    const type = TERRAIN_TYPES[cell.terrainId];
    assert.equal(terrainAt(first, cell.x, cell.y), cell);
    assert.equal(cell.buildable, type.buildable);
    assert.equal(cell.passable, type.passable);
    assert.equal(cell.placement.buildable, type.buildable);
    assert.equal(cell.path.passable, type.passable);
    assert.equal(terrainAllowsPlacement(first, cell.x, cell.y), type.buildable);
    assert.equal(terrainAllowsPath(first, cell.x, cell.y), type.passable);
  }

  assert.equal(terrainAt(first, -1, 0), null);
  assert.equal(terrainAt(first, WORLD.width, 0), null);
  assert.equal(terrainAllowsPlacement(first, WORLD.width, 0), false);
  assert.equal(terrainAllowsPath(first, 0, WORLD.height), false);
  assert.throws(() => createInitialTerrain(1.5), TypeError);
});

test('base, entrances, and nests derive their coordinate checks from WORLD bounds', () => {
  const zone = WORLD.base.spawnZone;
  assert.ok(zone.width > 0 && zone.height > 0);
  assert.ok(zone.x >= 0 && zone.y >= 0);
  assert.ok(zone.x + zone.width <= WORLD.width);
  assert.ok(zone.y + zone.height <= WORLD.height);
  assert.equal(insideZone(WORLD.base.core, zone), true);
  assert.equal(insideZone(WORLD.base.rallyPoint, zone), true);

  const entranceById = Object.fromEntries(
    WORLD.monsterEntrances.map((entrance) => [entrance.id, entrance]),
  );
  assert.equal(new Set(Object.keys(entranceById)).size, WORLD.monsterEntrances.length);
  assert.equal(WORLD.monsterEntrances.length, 4);
  for (const entrance of WORLD.monsterEntrances) {
    assert.equal(insideWorld(entrance), true);
    if (entrance.edge === 'west') assert.equal(entrance.x, 0);
    else if (entrance.edge === 'east') assert.equal(entrance.x, WORLD.width - 1);
    else if (entrance.edge === 'north') assert.equal(entrance.y, 0);
    else if (entrance.edge === 'south') assert.equal(entrance.y, WORLD.height - 1);
    else assert.fail(`unknown edge ${entrance.edge}`);
  }

  assert.equal(WORLD.monsterNests.length, WORLD.monsterEntrances.length);
  for (const nest of WORLD.monsterNests) {
    const entrance = entranceById[nest.entranceId];
    assert.ok(entrance, `${nest.id} lacks an entrance`);
    assert.equal(insideWorld(nest), true);
    assert.equal(insideZone(nest, zone), false);
    assert.ok(Math.abs(nest.x - entrance.x) + Math.abs(nest.y - entrance.y) <= 3);
    assert.ok(nest.spawnRadiusCells > 0);
    assert.ok(nest.selectionWeight > 0);
  }
});

test('all building and terrain-project recipes are complete and the starting resource budget has progression', () => {
  assert.equal(BUILDING_RECIPES.length, 6);
  assert.equal(new Set(BUILDING_RECIPES.map(({ id }) => id)).size, 6);
  assert.deepEqual(
    BUILDING_RECIPES.map(({ id }) => id).sort(),
    Object.values(CARD_BY_ID).filter(({ type }) => type === 'building').map(({ id }) => id).sort(),
    'every placeable construction card must have a material recipe',
  );
  const resourceIds = new Set(
    Object.values(TERRAIN_TYPES)
      .filter(({ kind }) => kind === 'resource')
      .map(({ yield: output }) => output.resourceId),
  );

  for (const building of BUILDING_RECIPES) {
    assert.equal(CARD_BY_ID[building.id]?.type, 'building', `${building.id} is unknown`);
    assert.deepEqual(
      building.footprint,
      CARD_BY_ID[building.id].footprint,
      `${building.id} recipe footprint must match its placement card`,
    );
    assert.ok(building.footprint.width > 0 && building.footprint.width <= WORLD.width);
    assert.ok(building.footprint.height > 0 && building.footprint.height <= WORLD.height);
    assert.ok(building.constructionSeconds > 0);
    assert.ok(Number.isInteger(building.workerSlots) && building.workerSlots > 0);
    assert.ok(Object.keys(building.recipe).length > 0);
    for (const [resourceId, amount] of Object.entries(building.recipe)) {
      assert.equal(resourceIds.has(resourceId), true, `${building.id} uses ${resourceId}`);
      assert.ok(Number.isInteger(amount) && amount > 0);
    }
    assert.equal(typeof building.effect.kind, 'string');
  }

  const starterCost = recipeTotal(WORLD.base.starterBuildingIds);
  for (const resourceId of resourceIds) {
    assert.ok(
      (starterCost[resourceId] ?? 0) <= WORLD.base.startingStockpile[resourceId],
      `starter plan exceeds ${resourceId}`,
    );
  }

  const fullCatalogCost = recipeTotal(BUILDING_RECIPES.map(({ id }) => id));
  assert.ok(
    [...resourceIds].some(
      (resourceId) => fullCatalogCost[resourceId] > WORLD.base.startingStockpile[resourceId],
    ),
    'starting stockpile should not buy every building immediately',
  );

  const harvestBudget = Object.fromEntries([...resourceIds].map((id) => [id, 0]));
  for (const terrainCluster of INITIAL_TERRAIN.clusters) {
    const terrain = TERRAIN_TYPES[terrainCluster.terrainId];
    if (!terrain.harvestable) continue;
    harvestBudget[terrain.yield.resourceId] += terrain.yield.amount * terrainCluster.cells.length;
  }
  for (const resourceId of resourceIds) {
    assert.ok(harvestBudget[resourceId] >= fullCatalogCost[resourceId]);
  }
});

test('all six construction cards use one cell and the rebalanced material contracts', () => {
  const expected = {
    'building-mushroom-home': {
      recipe: { 'soft-gel': 7, 'dew-honey': 3 },
      constructionSeconds: 10,
      effect: {
        kind: 'nearby-protection',
        protectionRadiusTiles: 1.5,
        allyDamageMultiplier: 0.8,
      },
    },
    'building-honey-plot': {
      recipe: { 'soft-gel': 2, 'dew-honey': 1 },
      constructionSeconds: 6,
      effect: { kind: 'enemy-slow', speedMultiplier: 0.62 },
    },
    'building-bubble-tower': {
      recipe: { 'soft-gel': 6, 'dew-honey': 2, 'crystal-shard': 4 },
      constructionSeconds: 15,
      effect: {
        kind: 'defense',
        damage: 13,
        rangeCells: 4.8,
        attackIntervalSeconds: 2.15,
        pushEveryShots: 3,
      },
    },
    'building-bouncy-fence': {
      recipe: { 'soft-gel': 2, 'crystal-shard': 1 },
      constructionSeconds: 5,
      effect: {
        kind: 'route-control',
        triggersPerWave: 1,
        knockbackCells: 1,
        maxPushWeight: 1,
        heavyStaggerSeconds: 1,
      },
    },
    'building-weather-scout': {
      recipe: { 'soft-gel': 4, 'dew-honey': 2, 'crystal-shard': 3 },
      constructionSeconds: 12,
      effect: {
        kind: 'elite-mark',
        markElites: true,
        markedDamageTakenMultiplier: 1.15,
      },
    },
    'building-gel-foundation': {
      recipe: { 'soft-gel': 1 },
      constructionSeconds: 2,
      effect: { kind: 'terrain-foundation', replacementTerrainId: 'ground' },
    },
  };

  for (const [buildingId, contract] of Object.entries(expected)) {
    assert.deepEqual(CARD_BY_ID[buildingId].footprint, { width: 1, height: 1 });
    assert.deepEqual(BUILDING_RECIPE_BY_ID[buildingId].footprint, { width: 1, height: 1 });
    assert.deepEqual(BUILDING_RECIPE_BY_ID[buildingId].recipe, contract.recipe);
    assert.equal(
      BUILDING_RECIPE_BY_ID[buildingId].constructionSeconds,
      contract.constructionSeconds,
    );
    assert.deepEqual(BUILDING_RECIPE_BY_ID[buildingId].effect, contract.effect);
  }

  const fence = CARD_BY_ID['building-bouncy-fence'];
  assert.equal(fence.hp, 200);
  assert.doesNotMatch(fence.description, /两格|二格|2×1/);
  assert.equal(
    Object.values(BUILDING_RECIPE_BY_ID)
      .some(({ effect }) => effect.kind === 'resource-production'),
    false,
    'the recipe catalog must not advertise an unimplemented passive resource output',
  );
  assert.deepEqual(
    recipeTotal(Object.keys(expected)),
    { 'soft-gel': 22, 'dew-honey': 8, 'crystal-shard': 8 },
  );
});

test('four slime jobs preserve character identity and distinct work advantages', () => {
  assert.equal(SLIME_JOBS.length, 4);
  assert.equal(new Set(SLIME_JOBS.map(({ id }) => id)).size, 4);
  assert.equal(new Set(SLIME_JOBS.map(({ slimeId }) => slimeId)).size, 4);
  assert.deepEqual(
    SLIME_JOBS.map(({ slimeId }) => slimeId).sort(),
    WORLD.base.startingSlimeIds.slice().sort(),
  );

  const bonusTasks = new Set();
  for (const job of SLIME_JOBS) {
    assert.equal(CARD_BY_ID[job.slimeId]?.type, 'survivor', `${job.slimeId} is unknown`);
    assert.ok(job.moveSpeedCellsPerSecond > 0);
    assert.ok(Number.isInteger(job.carryCapacity) && job.carryCapacity > 0);
    assert.ok(job.jobBonus.multiplier > 1);
    assert.equal(bonusTasks.has(job.jobBonus.task), false, `${job.jobBonus.task} is duplicated`);
    bonusTasks.add(job.jobBonus.task);
  }
});

test('continuous threat curve grows monotonically and pack budgets match their members', () => {
  assert.equal(THREAT_CURVE.mode, 'continuous');
  assert.equal(THREAT_CURVE.interpolation, 'linear');
  assert.ok(THREAT_CURVE.gracePeriodSeconds > 0);
  assert.equal('waves' in THREAT_CURVE, false);
  assert.ok(THREAT_CURVE.points.length >= 6);

  THREAT_CURVE.points.forEach((point, index) => {
    assert.ok(point.elapsedSeconds >= 0);
    assert.ok(point.budgetPerMinute >= 0);
    assert.ok(point.maxActiveEnemies >= 0);
    assert.ok(point.eliteChance >= 0 && point.eliteChance < 1);
    if (index === 0) return;
    const previous = THREAT_CURVE.points[index - 1];
    assert.ok(point.elapsedSeconds > previous.elapsedSeconds);
    assert.ok(point.budgetPerMinute >= previous.budgetPerMinute);
    assert.ok(point.maxActiveEnemies >= previous.maxActiveEnemies);
    assert.ok(point.eliteChance >= previous.eliteChance);
  });

  const finalPoint = THREAT_CURVE.points.at(-1);
  assert.equal(THREAT_CURVE.endlessGrowth.startsAtSeconds, finalPoint.elapsedSeconds);
  assert.ok(THREAT_CURVE.endlessGrowth.maxBudgetPerMinute >= finalPoint.budgetPerMinute);
  assert.ok(THREAT_CURVE.endlessGrowth.maxActiveEnemies >= finalPoint.maxActiveEnemies);
  assert.ok(THREAT_CURVE.endlessGrowth.maxEliteChance >= finalPoint.eliteChance);

  assert.ok(ENEMY_PACK_TEMPLATES.length >= 4);
  assert.equal(new Set(ENEMY_PACK_TEMPLATES.map(({ id }) => id)).size, ENEMY_PACK_TEMPLATES.length);
  for (const pack of ENEMY_PACK_TEMPLATES) {
    assert.ok(pack.unlockAtSeconds >= THREAT_CURVE.gracePeriodSeconds);
    assert.ok(pack.selectionWeight > 0);
    assert.equal(pack.spawnRule, 'weighted-active-nest');
    assert.ok(pack.spawnIntervalSeconds.min > 0);
    assert.ok(pack.spawnIntervalSeconds.max >= pack.spawnIntervalSeconds.min);

    let minimumCost = 0;
    let maximumCost = 0;
    for (const member of pack.members) {
      assert.ok(ENEMY_BY_ID[member.enemyId], `${pack.id} uses ${member.enemyId}`);
      assert.ok(Number.isInteger(member.minCount) && member.minCount >= 0);
      assert.ok(Number.isInteger(member.maxCount) && member.maxCount >= member.minCount);
      assert.ok(member.threatCostEach > 0);
      minimumCost += member.minCount * member.threatCostEach;
      maximumCost += member.maxCount * member.threatCostEach;
    }
    assert.deepEqual(pack.budgetRange, { min: minimumCost, max: maximumCost });
    assert.ok(minimumCost > 0);
  }
});
