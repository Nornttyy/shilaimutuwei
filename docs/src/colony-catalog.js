/**
 * Data for the first playable colony-simulation slice.
 *
 * Coordinates are logical world cells. Rendering may merge neighbouring cells
 * into smooth contours, but simulation code should always read its dimensions
 * and bounds from WORLD instead of assuming a particular board size.
 */

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const cluster = (id, terrainId, coordinates) => ({
  id,
  terrainId,
  cells: coordinates.map(([x, y]) => ({ x, y })),
});

export const WORLD = deepFreeze({
  id: 'slime-haven-world-v1',
  width: 24,
  height: 16,
  cellSize: 1,
  topology: 'orthogonal-grid',
  time: {
    mode: 'continuous',
    dayNightCycle: false,
    fixedLighting: 'daylight',
  },
  rendering: {
    mergeAdjacentTerrain: true,
    contourSmoothing: 0.72,
    edgeJitterCells: 0.16,
    hideGridLines: true,
  },
  base: {
    spawnZone: { x: 8, y: 5, width: 8, height: 6 },
    core: { x: 12, y: 8 },
    rallyPoint: { x: 11, y: 8 },
    startingStockpile: {
      'soft-gel': 18,
      'dew-honey': 8,
      'crystal-shard': 4,
    },
    starterBuildingIds: [
      'building-mushroom-home',
      'building-honey-plot',
      'building-bouncy-fence',
    ],
    startingSlimeIds: [
      'survivor-shell-shell',
      'survivor-crystal-pin',
      'survivor-bubble-float',
      'survivor-moss-sprout',
    ],
  },
  monsterEntrances: [
    { id: 'entrance-west', edge: 'west', x: 0, y: 4 },
    { id: 'entrance-north', edge: 'north', x: 18, y: 0 },
    { id: 'entrance-east', edge: 'east', x: 23, y: 11 },
    { id: 'entrance-south', edge: 'south', x: 5, y: 15 },
  ],
  monsterNests: [
    {
      id: 'nest-west-mire',
      entranceId: 'entrance-west',
      x: 2,
      y: 4,
      spawnRadiusCells: 1.4,
      selectionWeight: 1,
    },
    {
      id: 'nest-north-ridge',
      entranceId: 'entrance-north',
      x: 18,
      y: 2,
      spawnRadiusCells: 1.4,
      selectionWeight: 1,
    },
    {
      id: 'nest-east-bog',
      entranceId: 'entrance-east',
      x: 21,
      y: 11,
      spawnRadiusCells: 1.4,
      selectionWeight: 1,
    },
    {
      id: 'nest-south-root',
      entranceId: 'entrance-south',
      x: 5,
      y: 13,
      spawnRadiusCells: 1.4,
      selectionWeight: 1,
    },
  ],
});

/**
 * Every terrain type exposes the same interaction contract. Resource cells are
 * walkable but cannot be built on until harvesting replaces them with ground.
 */
export const TERRAIN_TYPES = deepFreeze({
  ground: {
    id: 'ground',
    name: '软土地',
    kind: 'ground',
    passable: true,
    buildable: true,
    harvestable: false,
    destructible: false,
    yield: null,
    replacement: null,
  },
  'soft-gel': {
    id: 'soft-gel',
    name: '软胶洼',
    kind: 'resource',
    passable: true,
    buildable: false,
    harvestable: true,
    destructible: false,
    yield: { resourceId: 'soft-gel', amount: 3, gatherSeconds: 3 },
    replacement: 'ground',
  },
  'dew-honey': {
    id: 'dew-honey',
    name: '露蜜花丛',
    kind: 'resource',
    passable: true,
    buildable: false,
    harvestable: true,
    destructible: false,
    yield: { resourceId: 'dew-honey', amount: 2, gatherSeconds: 2.5 },
    replacement: 'ground',
  },
  'crystal-shard': {
    id: 'crystal-shard',
    name: '晶屑脉',
    kind: 'resource',
    passable: true,
    buildable: false,
    harvestable: true,
    destructible: false,
    yield: { resourceId: 'crystal-shard', amount: 2, gatherSeconds: 4.5 },
    replacement: 'ground',
  },
  'thorn-thicket': {
    id: 'thorn-thicket',
    name: '密刺丛',
    kind: 'obstacle',
    passable: false,
    buildable: false,
    harvestable: false,
    destructible: false,
    yield: null,
    replacement: null,
  },
  'brittle-boulder': {
    id: 'brittle-boulder',
    name: '脆壳岩',
    kind: 'destructible-obstacle',
    passable: false,
    buildable: false,
    harvestable: false,
    destructible: true,
    yield: { resourceId: 'crystal-shard', amount: 1 },
    replacement: 'ground',
  },
  'deep-water': {
    id: 'deep-water',
    name: '深水洼',
    kind: 'indestructible-terrain',
    passable: false,
    buildable: false,
    harvestable: false,
    destructible: false,
    yield: null,
    replacement: null,
  },
});

/**
 * Explicit connected blobs give the first map deliberate pacing. The seed is
 * reserved for edge variation, decorative scatter, and later generated maps;
 * it must not change the authored gameplay cells below.
 */
export const INITIAL_TERRAIN = deepFreeze({
  seed: 240160731,
  generator: 'authored-clusters-with-seeded-edges-v1',
  defaultTerrainId: 'ground',
  clusters: [
    cluster('soft-gel-west', 'soft-gel', [
      [3, 6], [4, 6], [3, 7], [4, 7], [5, 7], [4, 8], [5, 8],
    ]),
    cluster('soft-gel-southeast', 'soft-gel', [
      [17, 9], [18, 9], [17, 10], [18, 10], [19, 10], [18, 11], [19, 11],
    ]),
    cluster('dew-honey-northwest', 'dew-honey', [
      [6, 2], [7, 2], [6, 3], [7, 3], [8, 3], [7, 4], [8, 4],
    ]),
    cluster('dew-honey-south', 'dew-honey', [
      [8, 12], [9, 12], [10, 12], [8, 13], [9, 13], [10, 13], [9, 14],
    ]),
    cluster('crystal-northeast', 'crystal-shard', [
      [18, 4], [19, 4], [20, 4], [18, 5], [19, 5], [20, 5], [21, 5],
    ]),
    cluster('crystal-southwest', 'crystal-shard', [
      [3, 11], [4, 11], [5, 11], [3, 12], [4, 12], [5, 12], [4, 13],
    ]),
    cluster('thicket-northwest', 'thorn-thicket', [
      [1, 1], [2, 1], [3, 1], [2, 2], [3, 2], [3, 3],
    ]),
    cluster('boulders-northeast', 'brittle-boulder', [
      [20, 1], [21, 1], [22, 1], [20, 2], [21, 2], [22, 2], [21, 3],
    ]),
    cluster('boulders-south', 'brittle-boulder', [
      [14, 12], [15, 12], [16, 12], [15, 13], [16, 13], [17, 13], [16, 14],
    ]),
    cluster('water-west', 'deep-water', [
      [0, 9], [1, 9], [0, 10], [1, 10], [2, 10], [1, 11], [2, 11],
    ]),
    cluster('water-southeast', 'deep-water', [
      [20, 13], [21, 13], [22, 13], [19, 14], [20, 14],
      [21, 14], [22, 14], [20, 15], [21, 15], [22, 15],
    ]),
  ],
});

function visualVariantFor(seed, x, y) {
  let hash = (seed >>> 0)
    ^ Math.imul(x + 1, 0x9e3779b1)
    ^ Math.imul(y + 1, 0x85ebca6b);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash >>> 0) % 4;
}

/**
 * Build the deterministic row-major terrain map used by simulation code.
 * Changing the seed changes visual variants, not authored collision/layout.
 */
export function createInitialTerrain(seed = INITIAL_TERRAIN.seed) {
  if (!Number.isSafeInteger(seed)) {
    throw new TypeError('terrain seed must be a safe integer');
  }

  const terrainIds = Array(WORLD.width * WORLD.height)
    .fill(INITIAL_TERRAIN.defaultTerrainId);
  for (const terrainCluster of INITIAL_TERRAIN.clusters) {
    for (const { x, y } of terrainCluster.cells) {
      terrainIds[y * WORLD.width + x] = terrainCluster.terrainId;
    }
  }

  const cells = terrainIds.map((terrainId, index) => {
    const x = index % WORLD.width;
    const y = Math.floor(index / WORLD.width);
    const terrain = TERRAIN_TYPES[terrainId];
    return {
      x,
      y,
      terrainId,
      visualVariant: visualVariantFor(seed, x, y),
      passable: terrain.passable,
      buildable: terrain.buildable,
      harvestable: terrain.harvestable,
      destructible: terrain.destructible,
      yield: terrain.yield,
      replacement: terrain.replacement,
      placement: { buildable: terrain.buildable },
      path: { passable: terrain.passable },
    };
  });

  return deepFreeze({
    seed,
    width: WORLD.width,
    height: WORLD.height,
    cells,
  });
}

/** Return a generated terrain cell, or null for a non-integer/out-of-world coordinate. */
export function terrainAt(terrain, x, y) {
  if (!terrain
    || !Number.isInteger(x)
    || !Number.isInteger(y)
    || x < 0
    || y < 0
    || x >= terrain.width
    || y >= terrain.height) {
    return null;
  }
  return terrain.cells[y * terrain.width + x] ?? null;
}

export const terrainAllowsPlacement = (terrain, x, y) => (
  terrainAt(terrain, x, y)?.placement.buildable === true
);

export const terrainAllowsPath = (terrain, x, y) => (
  terrainAt(terrain, x, y)?.path.passable === true
);

export const INITIAL_WORLD_TERRAIN = createInitialTerrain();

export const BUILDING_RECIPES = deepFreeze([
  {
    id: 'building-mushroom-home',
    name: '蘑菇小屋',
    footprint: { width: 2, height: 2 },
    recipe: { 'soft-gel': 8, 'dew-honey': 4 },
    constructionSeconds: 12,
    workerSlots: 2,
    effect: { kind: 'housing', slimeCapacity: 2, restRecoveryPerSecond: 1.2 },
  },
  {
    id: 'building-honey-plot',
    name: '蜜胶田',
    footprint: { width: 2, height: 2 },
    recipe: { 'soft-gel': 4, 'dew-honey': 2 },
    constructionSeconds: 10,
    workerSlots: 1,
    effect: {
      kind: 'resource-production',
      resourceId: 'dew-honey',
      amount: 2,
      cycleSeconds: 9,
    },
  },
  {
    id: 'building-bubble-tower',
    name: '泡泡水塔',
    footprint: { width: 1, height: 1 },
    recipe: { 'soft-gel': 7, 'dew-honey': 2, 'crystal-shard': 6 },
    constructionSeconds: 18,
    workerSlots: 1,
    effect: {
      kind: 'defense',
      damage: 13,
      rangeCells: 4.8,
      attackIntervalSeconds: 2.15,
      pushEveryShots: 3,
    },
  },
  {
    id: 'building-bouncy-fence',
    name: '蹦蹦围栏',
    footprint: { width: 2, height: 1 },
    recipe: { 'soft-gel': 3, 'crystal-shard': 1 },
    constructionSeconds: 6,
    workerSlots: 1,
    effect: { kind: 'route-control', knockbackCells: 1, resetSeconds: 8 },
  },
  {
    id: 'building-weather-scout',
    name: '侦察气象台',
    footprint: { width: 2, height: 2 },
    recipe: { 'soft-gel': 5, 'dew-honey': 2, 'crystal-shard': 4 },
    constructionSeconds: 15,
    workerSlots: 1,
    effect: {
      kind: 'threat-intel',
      revealRadiusCells: 8,
      forecastSeconds: 18,
      exposesNestWeights: true,
    },
  },
]);

export const BUILDING_RECIPE_BY_ID = deepFreeze(
  Object.fromEntries(BUILDING_RECIPES.map((building) => [building.id, building])),
);

export const SLIME_JOBS = deepFreeze([
  {
    id: 'builder',
    name: '筑巢师',
    slimeId: 'survivor-shell-shell',
    moveSpeedCellsPerSecond: 0.9,
    carryCapacity: 10,
    jobBonus: { task: 'construction', multiplier: 1.45 },
  },
  {
    id: 'miner',
    name: '晶脉师',
    slimeId: 'survivor-crystal-pin',
    moveSpeedCellsPerSecond: 1.05,
    carryCapacity: 7,
    jobBonus: {
      task: 'resource-harvest',
      resourceId: 'crystal-shard',
      multiplier: 1.5,
    },
  },
  {
    id: 'hauler',
    name: '泡泡搬运员',
    slimeId: 'survivor-bubble-float',
    moveSpeedCellsPerSecond: 1.35,
    carryCapacity: 12,
    jobBonus: { task: 'hauling', multiplier: 1.4 },
  },
  {
    id: 'cultivator',
    name: '露田照料员',
    slimeId: 'survivor-moss-sprout',
    moveSpeedCellsPerSecond: 1.1,
    carryCapacity: 8,
    jobBonus: {
      task: 'resource-production',
      resourceId: 'dew-honey',
      multiplier: 1.45,
    },
  },
]);

export const SLIME_JOB_BY_ID = deepFreeze(
  Object.fromEntries(SLIME_JOBS.map((job) => [job.id, job])),
);

/**
 * Threat is sampled from a linearly interpolated curve and spent on packs as
 * soon as enough budget exists. This is deliberately continuous: there are no
 * waves, phase resets, or night-only spawns.
 */
export const THREAT_CURVE = deepFreeze({
  mode: 'continuous',
  gracePeriodSeconds: 55,
  interpolation: 'linear',
  evaluationIntervalSeconds: 2,
  points: [
    { elapsedSeconds: 0, budgetPerMinute: 0, maxActiveEnemies: 0, eliteChance: 0 },
    { elapsedSeconds: 55, budgetPerMinute: 7, maxActiveEnemies: 8, eliteChance: 0 },
    { elapsedSeconds: 180, budgetPerMinute: 13, maxActiveEnemies: 14, eliteChance: 0.02 },
    { elapsedSeconds: 360, budgetPerMinute: 18, maxActiveEnemies: 22, eliteChance: 0.05 },
    { elapsedSeconds: 600, budgetPerMinute: 26, maxActiveEnemies: 32, eliteChance: 0.08 },
    { elapsedSeconds: 900, budgetPerMinute: 34, maxActiveEnemies: 42, eliteChance: 0.11 },
    { elapsedSeconds: 1200, budgetPerMinute: 44, maxActiveEnemies: 54, eliteChance: 0.15 },
    { elapsedSeconds: 1800, budgetPerMinute: 58, maxActiveEnemies: 70, eliteChance: 0.2 },
  ],
  endlessGrowth: {
    startsAtSeconds: 1800,
    budgetGainPerMinute: 3,
    maxBudgetPerMinute: 96,
    activeEnemyGainPerMinute: 2,
    maxActiveEnemies: 96,
    maxEliteChance: 0.28,
  },
});

export const ENEMY_PACK_TEMPLATES = deepFreeze([
  {
    id: 'pack-soft-foragers',
    unlockAtSeconds: 55,
    selectionWeight: 6,
    budgetRange: { min: 4, max: 7 },
    spawnIntervalSeconds: { min: 0.65, max: 1.1 },
    spawnRule: 'weighted-active-nest',
    members: [
      { enemyId: 'enemy-soft-biter', minCount: 4, maxCount: 7, threatCostEach: 1 },
    ],
  },
  {
    id: 'pack-wind-flank',
    unlockAtSeconds: 180,
    selectionWeight: 5,
    budgetRange: { min: 8, max: 14 },
    spawnIntervalSeconds: { min: 0.45, max: 0.85 },
    spawnRule: 'weighted-active-nest',
    members: [
      { enemyId: 'enemy-soft-biter', minCount: 2, maxCount: 4, threatCostEach: 1 },
      { enemyId: 'enemy-windcap', minCount: 3, maxCount: 5, threatCostEach: 2 },
    ],
  },
  {
    id: 'pack-stone-escort',
    unlockAtSeconds: 360,
    selectionWeight: 4,
    budgetRange: { min: 8, max: 15 },
    spawnIntervalSeconds: { min: 0.8, max: 1.4 },
    spawnRule: 'weighted-active-nest',
    members: [
      { enemyId: 'enemy-soft-biter', minCount: 4, maxCount: 7, threatCostEach: 1 },
      { enemyId: 'enemy-stone-lump', minCount: 1, maxCount: 2, threatCostEach: 4 },
    ],
  },
  {
    id: 'pack-mixed-pressure',
    unlockAtSeconds: 600,
    selectionWeight: 3,
    budgetRange: { min: 19, max: 32 },
    spawnIntervalSeconds: { min: 0.5, max: 1 },
    spawnRule: 'weighted-active-nest',
    members: [
      { enemyId: 'enemy-soft-biter', minCount: 5, maxCount: 8, threatCostEach: 1 },
      { enemyId: 'enemy-windcap', minCount: 3, maxCount: 6, threatCostEach: 2 },
      { enemyId: 'enemy-stone-lump', minCount: 2, maxCount: 3, threatCostEach: 4 },
    ],
  },
  {
    id: 'pack-acid-siege',
    unlockAtSeconds: 1200,
    selectionWeight: 1,
    budgetRange: { min: 28, max: 40 },
    spawnIntervalSeconds: { min: 0.75, max: 1.25 },
    spawnRule: 'weighted-active-nest',
    members: [
      { enemyId: 'enemy-soft-biter', minCount: 6, maxCount: 10, threatCostEach: 1 },
      { enemyId: 'enemy-stone-lump', minCount: 2, maxCount: 4, threatCostEach: 4 },
      { enemyId: 'enemy-acid-shell-king', minCount: 1, maxCount: 1, threatCostEach: 14 },
    ],
  },
]);

export const ENEMY_PACK_BY_ID = deepFreeze(
  Object.fromEntries(ENEMY_PACK_TEMPLATES.map((pack) => [pack.id, pack])),
);

export const COLONY_CATALOG = deepFreeze({
  world: WORLD,
  terrainTypes: TERRAIN_TYPES,
  initialTerrain: INITIAL_TERRAIN,
  initialWorldTerrain: INITIAL_WORLD_TERRAIN,
  buildingRecipes: BUILDING_RECIPES,
  slimeJobs: SLIME_JOBS,
  threatCurve: THREAT_CURVE,
  enemyPackTemplates: ENEMY_PACK_TEMPLATES,
});
