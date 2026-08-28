/**
 * Deterministic, unbounded world data for the large-world game mode.
 *
 * This module deliberately has no dependency on the current finite-world
 * camera or catalog. Procedural chunks are immutable; player changes live in
 * sparse overlays so unloading a chunk never loses progress.
 */

export const INFINITE_WORLD_SCHEMA_VERSION = 1;
export const INFINITE_WORLD_GENERATOR_VERSION = 1;
export const CHUNK_SIZE = 16;
export const ZONE_SIZE_CHUNKS = 8;
export const CORE_CELL = Object.freeze({ x: 12, y: 8 });
export const BASE_SAFE_RADIUS = 7;

export const TERRAIN_IDS = Object.freeze([
  'ground',
  'soft-gel',
  'dew-honey',
  'crystal-shard',
  'thorn-thicket',
  'brittle-boulder',
  'deep-water',
]);

export const TERRAIN_RULES = deepFreeze({
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

const BIOMES = deepFreeze([
  {
    id: 'gel-garden',
    name: '软胶花园',
    landmark: '弹弹花圃',
    boss: '花冠软胶王',
    boosts: { 'soft-gel': 1.9, 'dew-honey': 1.2 },
  },
  {
    id: 'dew-grove',
    name: '露蜜林',
    landmark: '露珠大花',
    boss: '露蜜林守护者',
    boosts: { 'dew-honey': 2, 'thorn-thicket': 1.25 },
  },
  {
    id: 'crystal-meadow',
    name: '晶屑原',
    landmark: '彩光晶拱',
    boss: '晶羽软胶王',
    boosts: { 'crystal-shard': 2, 'brittle-boulder': 1.25 },
  },
  {
    id: 'bubble-wetland',
    name: '泡泡湿地',
    landmark: '巨型泡泡泉',
    boss: '泡泡湿地之主',
    boosts: { 'soft-gel': 1.3, 'deep-water': 1.8 },
  },
  {
    id: 'soft-shell-canyon',
    name: '软壳峡谷',
    landmark: '旋壳谷门',
    boss: '巨壳软胶王',
    boosts: { 'crystal-shard': 1.35, 'brittle-boulder': 1.8 },
  },
]);

const RESOURCE_IDS = Object.freeze(['soft-gel', 'dew-honey', 'crystal-shard']);
const OBSTACLE_IDS = Object.freeze(['thorn-thicket', 'brittle-boulder', 'deep-water']);
const DISCOVERY_WORDS = (CHUNK_SIZE * CHUNK_SIZE) / 32;
const DEFAULT_SEED = 'slime-haven-infinite-v1';
const DEFAULT_MAX_LOADED_CHUNKS = 81;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function cloneJsonValue(value, label = 'value') {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new TypeError(`${label} must be JSON-serializable`);
  }
  if (encoded === undefined) throw new TypeError(`${label} must be JSON-serializable`);
  return JSON.parse(encoded);
}

function assertSafeInteger(value, label) {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer`);
  }
  return value;
}

function assertFiniteNumber(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

function normalizeSeed(seed = DEFAULT_SEED) {
  if (typeof seed === 'string' && seed.length > 0) return seed;
  if (typeof seed === 'number' && Number.isSafeInteger(seed)) return String(seed);
  if (typeof seed === 'bigint') return seed.toString();
  throw new TypeError('seed must be a non-empty string, safe integer, or bigint');
}

export function floorDiv(value, divisor = CHUNK_SIZE) {
  assertSafeInteger(value, 'value');
  if (!Number.isSafeInteger(divisor) || divisor <= 0) {
    throw new TypeError('divisor must be a positive safe integer');
  }
  return normalizeZero(Math.floor(value / divisor));
}

export function floorMod(value, divisor = CHUNK_SIZE) {
  const quotient = floorDiv(value, divisor);
  return normalizeZero(value - quotient * divisor);
}

export function chunkKey(chunkX, chunkY) {
  assertSafeInteger(chunkX, 'chunkX');
  assertSafeInteger(chunkY, 'chunkY');
  return `${normalizeZero(chunkX)},${normalizeZero(chunkY)}`;
}

export function worldToChunk(x, y) {
  assertSafeInteger(x, 'x');
  assertSafeInteger(y, 'y');
  const chunkX = floorDiv(x);
  const chunkY = floorDiv(y);
  const localX = floorMod(x);
  const localY = floorMod(y);
  return Object.freeze({
    chunkX,
    chunkY,
    cx: chunkX,
    cy: chunkY,
    localX,
    localY,
    lx: localX,
    ly: localY,
    index: localY * CHUNK_SIZE + localX,
    key: chunkKey(chunkX, chunkY),
  });
}

function hash32(...parts) {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function randomUnit(seed, ...parts) {
  return hash32(seed, INFINITE_WORLD_GENERATOR_VERSION, ...parts) / 0x100000000;
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

/** Coherent noise sampled in absolute coordinates, including across chunk seams. */
function valueNoise(seed, x, y, scale, channel) {
  const gridX = Math.floor(x / scale);
  const gridY = Math.floor(y / scale);
  const fractionX = smoothstep((x / scale) - gridX);
  const fractionY = smoothstep((y / scale) - gridY);
  const top = lerp(
    randomUnit(seed, channel, gridX, gridY),
    randomUnit(seed, channel, gridX + 1, gridY),
    fractionX,
  );
  const bottom = lerp(
    randomUnit(seed, channel, gridX, gridY + 1),
    randomUnit(seed, channel, gridX + 1, gridY + 1),
    fractionX,
  );
  return lerp(top, bottom, fractionY);
}

function distanceFromCore(x, y, core) {
  return Math.hypot(x - core.x, y - core.y);
}

export function isInBaseSafeZone(
  x,
  y,
  core = CORE_CELL,
  safeRadius = BASE_SAFE_RADIUS,
) {
  assertSafeInteger(x, 'x');
  assertSafeInteger(y, 'y');
  assertSafeInteger(core.x, 'core.x');
  assertSafeInteger(core.y, 'core.y');
  if (!Number.isFinite(safeRadius) || safeRadius < 0) {
    throw new TypeError('safeRadius must be a non-negative finite number');
  }
  const dx = x - core.x;
  const dy = y - core.y;
  return (dx * dx) + (dy * dy) <= safeRadius * safeRadius;
}

/** Distance-dependent probabilities used by both terrain and POI generation. */
export function distanceProfileAt(x, y, core = CORE_CELL) {
  assertSafeInteger(x, 'x');
  assertSafeInteger(y, 'y');
  const distance = distanceFromCore(x, y, core);
  const distanceBand = Math.max(0, Math.floor(distance / 48));
  const ramp = Math.min(12, distanceBand);
  const featureChance = 0.3 + (ramp * 0.015);
  const resourceShare = Math.max(0.36, 0.66 - (ramp * 0.025));
  return Object.freeze({
    distance,
    distanceBand,
    tier: distanceBand + 1,
    featureChance,
    resourceChance: featureChance * resourceShare,
    obstacleChance: featureChance * (1 - resourceShare),
    nestChance: Math.min(0.34, 0.035 + (distanceBand * 0.022)),
    landmarkChance: Math.min(0.22, 0.08 + (distanceBand * 0.01)),
  });
}

function zoneCoordinatesForChunk(chunkX, chunkY) {
  return {
    zoneX: floorDiv(chunkX, ZONE_SIZE_CHUNKS),
    zoneY: floorDiv(chunkY, ZONE_SIZE_CHUNKS),
  };
}

function homeZoneCoordinates(core) {
  const homeChunk = worldToChunk(core.x, core.y);
  return zoneCoordinatesForChunk(homeChunk.chunkX, homeChunk.chunkY);
}

function bossPlanForZone(seed, zoneX, zoneY, core) {
  const home = homeZoneCoordinates(core);
  if (zoneX === home.zoneX && zoneY === home.zoneY) return null;
  const localChunkX = hash32(seed, 'boss-chunk-x', zoneX, zoneY) % ZONE_SIZE_CHUNKS;
  const localChunkY = hash32(seed, 'boss-chunk-y', zoneX, zoneY) % ZONE_SIZE_CHUNKS;
  const chunkX = zoneX * ZONE_SIZE_CHUNKS + localChunkX;
  const chunkY = zoneY * ZONE_SIZE_CHUNKS + localChunkY;
  const localX = 2 + (hash32(seed, 'boss-cell-x', zoneX, zoneY) % (CHUNK_SIZE - 4));
  const localY = 2 + (hash32(seed, 'boss-cell-y', zoneX, zoneY) % (CHUNK_SIZE - 4));
  return {
    chunkX,
    chunkY,
    x: chunkX * CHUNK_SIZE + localX,
    y: chunkY * CHUNK_SIZE + localY,
  };
}

export function zoneForChunk({
  seed = DEFAULT_SEED,
  cx,
  cy,
  chunkX = cx,
  chunkY = cy,
  core = CORE_CELL,
} = {}) {
  const normalizedSeed = normalizeSeed(seed);
  assertSafeInteger(chunkX, 'chunkX');
  assertSafeInteger(chunkY, 'chunkY');
  const { zoneX, zoneY } = zoneCoordinatesForChunk(chunkX, chunkY);
  const home = homeZoneCoordinates(core);
  const ring = Math.max(Math.abs(zoneX - home.zoneX), Math.abs(zoneY - home.zoneY));
  const biome = BIOMES[hash32(normalizedSeed, 'zone-biome', zoneX, zoneY) % BIOMES.length];
  const boss = bossPlanForZone(normalizedSeed, zoneX, zoneY, core);
  return deepFreeze({
    id: `zone:${zoneX},${zoneY}`,
    zoneX,
    zoneY,
    stage: ring + 1,
    kind: biome.id,
    name: biome.name,
    landmarkName: biome.landmark,
    bossName: biome.boss,
    home: ring === 0,
    boss,
  });
}

function weightedChoice(seed, x, y, channel, ids, weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = randomUnit(seed, channel, x, y) * total;
  for (let index = 0; index < ids.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) return ids[index];
  }
  return ids.at(-1);
}

function terrainFor(seed, x, y, core, safeRadius, biome) {
  if (isInBaseSafeZone(x, y, core, safeRadius)) return 'ground';
  const profile = distanceProfileAt(x, y, core);
  const broad = valueNoise(seed, x, y, 7, 'terrain-presence-broad');
  const detail = valueNoise(seed, x, y, 3, 'terrain-presence-detail');
  const presence = (broad * 0.64) + (detail * 0.36);

  // Coherent value noise clusters around the midpoint; this remap keeps enough
  // open ground while the distance profile visibly increases far hazards.
  const threshold = 0.31 + (profile.featureChance - 0.3) * 0.75;
  if (presence > threshold) return 'ground';

  const resourceShare = profile.resourceChance / profile.featureChance;
  const groupRoll = randomUnit(seed, 'terrain-group', Math.floor(x / 3), Math.floor(y / 3));
  const group = groupRoll < resourceShare ? RESOURCE_IDS : OBSTACLE_IDS;
  const baseWeights = group === RESOURCE_IDS
    ? [1.2, 1.05, 0.85 + Math.min(1.1, profile.distanceBand * 0.08)]
    : [1, 0.82 + Math.min(1, profile.distanceBand * 0.07), 0.62 + Math.min(1, profile.distanceBand * 0.06)];
  const weights = group.map((terrainId, index) => (
    baseWeights[index] * (biome.boosts[terrainId] ?? 1)
  ));
  return weightedChoice(seed, x, y, 'terrain-kind', group, weights);
}

function cellWithTerrain(x, y, localX, localY, terrainId, core, safeRadius) {
  const rules = TERRAIN_RULES[terrainId];
  const profile = distanceProfileAt(x, y, core);
  return {
    x,
    y,
    localX,
    localY,
    index: localY * CHUNK_SIZE + localX,
    terrainId,
    ...rules,
    safe: isInBaseSafeZone(x, y, core, safeRadius),
    distanceBand: profile.distanceBand,
  };
}

function minimumDistanceToChunk(core, originX, originY) {
  const maxX = originX + CHUNK_SIZE - 1;
  const maxY = originY + CHUNK_SIZE - 1;
  const dx = core.x < originX ? originX - core.x : core.x > maxX ? core.x - maxX : 0;
  const dy = core.y < originY ? originY - core.y : core.y > maxY ? core.y - maxY : 0;
  return Math.hypot(dx, dy);
}

function choosePoiCell(seed, chunkX, chunkY, channel, cells, usedIndexes, core, safeRadius) {
  const start = hash32(seed, channel, 'start', chunkX, chunkY) % cells.length;
  const step = 73;
  for (let offset = 0; offset < cells.length; offset += 1) {
    const index = (start + offset * step) % cells.length;
    const cell = cells[index];
    if (usedIndexes.has(index) || isInBaseSafeZone(cell.x, cell.y, core, safeRadius)) continue;
    usedIndexes.add(index);
    return cell;
  }
  return null;
}

function poiAt({ id, kind, cell, zone, profile, name, revealRadius, extra = {} }) {
  return {
    id,
    kind,
    x: cell.x,
    y: cell.y,
    chunkX: floorDiv(cell.x),
    chunkY: floorDiv(cell.y),
    stage: Math.max(zone.stage, profile.tier),
    tier: Math.max(zone.stage, profile.tier),
    zoneId: zone.id,
    name,
    revealRadius,
    ...extra,
  };
}

function validateChunkOrigin(chunkX, chunkY) {
  assertSafeInteger(chunkX, 'chunkX');
  assertSafeInteger(chunkY, 'chunkY');
  const originX = chunkX * CHUNK_SIZE;
  const originY = chunkY * CHUNK_SIZE;
  if (!Number.isSafeInteger(originX) || !Number.isSafeInteger(originX + CHUNK_SIZE - 1)
    || !Number.isSafeInteger(originY) || !Number.isSafeInteger(originY + CHUNK_SIZE - 1)) {
    throw new RangeError('chunk coordinates exceed the safe world-coordinate range');
  }
  return { originX: normalizeZero(originX), originY: normalizeZero(originY) };
}

export function generateChunk({
  seed = DEFAULT_SEED,
  cx,
  cy,
  chunkX = cx,
  chunkY = cy,
  core = CORE_CELL,
  safeRadius = BASE_SAFE_RADIUS,
  generatorVersion = INFINITE_WORLD_GENERATOR_VERSION,
} = {}) {
  if (generatorVersion !== INFINITE_WORLD_GENERATOR_VERSION) {
    throw new RangeError(`unsupported generatorVersion ${generatorVersion}`);
  }
  const normalizedSeed = normalizeSeed(seed);
  assertSafeInteger(core.x, 'core.x');
  assertSafeInteger(core.y, 'core.y');
  if (!Number.isFinite(safeRadius) || safeRadius < 0) {
    throw new TypeError('safeRadius must be a non-negative finite number');
  }
  const { originX, originY } = validateChunkOrigin(chunkX, chunkY);
  const zone = zoneForChunk({ seed: normalizedSeed, chunkX, chunkY, core });
  const biome = BIOMES.find(({ id }) => id === zone.kind);
  const cells = [];
  for (let localY = 0; localY < CHUNK_SIZE; localY += 1) {
    for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
      const x = originX + localX;
      const y = originY + localY;
      cells.push(cellWithTerrain(
        x,
        y,
        localX,
        localY,
        terrainFor(normalizedSeed, x, y, core, safeRadius, biome),
        core,
        safeRadius,
      ));
    }
  }

  const profile = distanceProfileAt(
    originX + Math.floor(CHUNK_SIZE / 2),
    originY + Math.floor(CHUNK_SIZE / 2),
    core,
  );
  const usedIndexes = new Set();
  const pois = [];

  if (zone.boss?.chunkX === chunkX && zone.boss?.chunkY === chunkY) {
    const localX = floorMod(zone.boss.x);
    const localY = floorMod(zone.boss.y);
    const cell = cells[localY * CHUNK_SIZE + localX];
    usedIndexes.add(cell.index);
    pois.push(poiAt({
      id: `poi:boss:${zone.zoneX},${zone.zoneY}`,
      kind: 'boss',
      cell,
      zone,
      profile,
      name: zone.bossName,
      revealRadius: 9,
      extra: { boss: true, regionBoss: true },
    }));
  }

  const hostileBuffer = safeRadius + CHUNK_SIZE;
  if (minimumDistanceToChunk(core, originX, originY) > hostileBuffer
    && randomUnit(normalizedSeed, 'nest-presence', chunkX, chunkY) < profile.nestChance) {
    const cell = choosePoiCell(
      normalizedSeed,
      chunkX,
      chunkY,
      'nest-cell',
      cells,
      usedIndexes,
      core,
      safeRadius,
    );
    if (cell) {
      pois.push(poiAt({
        id: `poi:nest:${cell.x},${cell.y}`,
        kind: 'nest',
        cell,
        zone,
        profile,
        name: `${zone.name}软泥巢`,
        revealRadius: 6 + Math.min(3, Math.floor(profile.distanceBand / 3)),
        extra: { spawnRadiusCells: 1.5 + Math.min(1.5, profile.distanceBand * 0.08) },
      }));
    }
  }

  if (randomUnit(normalizedSeed, 'landmark-presence', chunkX, chunkY) < profile.landmarkChance) {
    const cell = choosePoiCell(
      normalizedSeed,
      chunkX,
      chunkY,
      'landmark-cell',
      cells,
      usedIndexes,
      core,
      safeRadius,
    );
    if (cell) {
      pois.push(poiAt({
        id: `poi:landmark:${cell.x},${cell.y}`,
        kind: 'landmark',
        cell,
        zone,
        profile,
        name: zone.landmarkName,
        revealRadius: 7,
      }));
    }
  }

  // Every POI has a usable approach cell, independent of the surrounding
  // procedural terrain. Replacing only its own cell preserves nearby shapes.
  for (const poi of pois) {
    const localX = floorMod(poi.x);
    const localY = floorMod(poi.y);
    const index = localY * CHUNK_SIZE + localX;
    cells[index] = cellWithTerrain(
      poi.x,
      poi.y,
      localX,
      localY,
      'ground',
      core,
      safeRadius,
    );
  }

  pois.sort((left, right) => left.id.localeCompare(right.id));
  return deepFreeze({
    key: chunkKey(chunkX, chunkY),
    chunkX,
    chunkY,
    cx: chunkX,
    cy: chunkY,
    originX,
    originY,
    minX: originX,
    minY: originY,
    maxXExclusive: originX + CHUNK_SIZE,
    maxYExclusive: originY + CHUNK_SIZE,
    size: CHUNK_SIZE,
    seed: normalizedSeed,
    generatorVersion,
    zone,
    profile,
    cells,
    pois,
  });
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') throw new TypeError('bounds are required');
  const minX = assertFiniteNumber(bounds.minX ?? bounds.x, 'bounds.minX');
  const minY = assertFiniteNumber(bounds.minY ?? bounds.y, 'bounds.minY');
  const maxXExclusive = assertFiniteNumber(
    bounds.maxXExclusive ?? (bounds.x + bounds.width),
    'bounds.maxXExclusive',
  );
  const maxYExclusive = assertFiniteNumber(
    bounds.maxYExclusive ?? (bounds.y + bounds.height),
    'bounds.maxYExclusive',
  );
  if (!(maxXExclusive > minX) || !(maxYExclusive > minY)) {
    throw new RangeError('bounds must have positive width and height');
  }
  for (const [label, value] of [
    ['bounds.minX', Math.floor(minX)],
    ['bounds.minY', Math.floor(minY)],
    ['bounds.maxXExclusive', Math.ceil(maxXExclusive) - 1],
    ['bounds.maxYExclusive', Math.ceil(maxYExclusive) - 1],
  ]) assertSafeInteger(value, label);
  return { minX, minY, maxXExclusive, maxYExclusive };
}

/** Return every chunk touching half-open world bounds. */
export function chunksForBounds(bounds, { paddingChunks = 0 } = {}) {
  const normalized = normalizeBounds(bounds);
  if (!Number.isSafeInteger(paddingChunks) || paddingChunks < 0) {
    throw new TypeError('paddingChunks must be a non-negative safe integer');
  }
  const minChunkX = floorDiv(Math.floor(normalized.minX)) - paddingChunks;
  const minChunkY = floorDiv(Math.floor(normalized.minY)) - paddingChunks;
  const maxChunkX = floorDiv(Math.ceil(normalized.maxXExclusive) - 1) + paddingChunks;
  const maxChunkY = floorDiv(Math.ceil(normalized.maxYExclusive) - 1) + paddingChunks;
  const chunks = [];
  for (let chunkY = minChunkY; chunkY <= maxChunkY; chunkY += 1) {
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
      chunks.push({ chunkX, chunkY, key: chunkKey(chunkX, chunkY) });
    }
  }
  return chunks;
}

function circleTouchesChunk(centerX, centerY, radius, chunkX, chunkY) {
  const originX = chunkX * CHUNK_SIZE;
  const originY = chunkY * CHUNK_SIZE;
  const closestX = Math.max(originX, Math.min(centerX, originX + CHUNK_SIZE));
  const closestY = Math.max(originY, Math.min(centerY, originY + CHUNK_SIZE));
  const dx = centerX - closestX;
  const dy = centerY - closestY;
  return (dx * dx) + (dy * dy) <= radius * radius;
}

function chunksAroundCircle(centerX, centerY, radius, limit) {
  assertFiniteNumber(centerX, 'center.x');
  assertFiniteNumber(centerY, 'center.y');
  if (!Number.isFinite(radius) || radius < 0) {
    throw new TypeError('radiusCells must be a non-negative finite number');
  }
  const cellX = Math.floor(centerX);
  const cellY = Math.floor(centerY);
  assertSafeInteger(cellX, 'center.x');
  assertSafeInteger(cellY, 'center.y');
  const centerChunkX = floorDiv(cellX);
  const centerChunkY = floorDiv(cellY);
  const maxRing = Math.ceil(radius / CHUNK_SIZE) + 1;
  const chunks = [];

  for (let ring = 0; ring <= maxRing; ring += 1) {
    const ringChunks = [];
    if (ring === 0) {
      ringChunks.push({ chunkX: centerChunkX, chunkY: centerChunkY });
    } else {
      for (let offset = -ring; offset <= ring; offset += 1) {
        ringChunks.push({ chunkX: centerChunkX + offset, chunkY: centerChunkY - ring });
        ringChunks.push({ chunkX: centerChunkX + offset, chunkY: centerChunkY + ring });
      }
      for (let offset = -ring + 1; offset <= ring - 1; offset += 1) {
        ringChunks.push({ chunkX: centerChunkX - ring, chunkY: centerChunkY + offset });
        ringChunks.push({ chunkX: centerChunkX + ring, chunkY: centerChunkY + offset });
      }
    }
    for (const candidate of ringChunks) {
      if (!circleTouchesChunk(centerX, centerY, radius, candidate.chunkX, candidate.chunkY)) continue;
      chunks.push({
        ...candidate,
        key: chunkKey(candidate.chunkX, candidate.chunkY),
        distanceSquared: ((candidate.chunkX - centerChunkX) ** 2)
          + ((candidate.chunkY - centerChunkY) ** 2),
      });
    }
    if (chunks.length >= limit) break;
  }

  chunks.sort((left, right) => left.distanceSquared - right.distanceSquared
    || left.chunkY - right.chunkY
    || left.chunkX - right.chunkX);
  return chunks.slice(0, limit);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function deltaKey(x, y) {
  return `${normalizeZero(x)},${normalizeZero(y)}`;
}

function normalizeBuilding(building) {
  const normalized = typeof building === 'string' ? { id: building } : cloneJsonValue(building, 'building');
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)
    || typeof normalized.id !== 'string' || normalized.id.length === 0) {
    throw new TypeError('building must be an object with a non-empty id');
  }
  return deepFreeze(normalized);
}

function normalizeRuntimeOptions(options = {}) {
  const core = {
    x: options.core?.x ?? CORE_CELL.x,
    y: options.core?.y ?? CORE_CELL.y,
  };
  assertSafeInteger(core.x, 'core.x');
  assertSafeInteger(core.y, 'core.y');
  const safeRadius = options.safeRadius ?? BASE_SAFE_RADIUS;
  if (!Number.isFinite(safeRadius) || safeRadius < 0) {
    throw new TypeError('safeRadius must be a non-negative finite number');
  }
  const maxLoadedChunks = options.maxLoadedChunks ?? options.maxCachedChunks
    ?? DEFAULT_MAX_LOADED_CHUNKS;
  if (!Number.isSafeInteger(maxLoadedChunks) || maxLoadedChunks < 1) {
    throw new TypeError('maxLoadedChunks must be a positive safe integer');
  }
  return {
    seed: normalizeSeed(options.seed),
    core: Object.freeze(core),
    safeRadius,
    maxLoadedChunks,
  };
}

export class InfiniteWorld {
  constructor(options = {}) {
    const normalized = normalizeRuntimeOptions(options);
    this.seed = normalized.seed;
    this.core = normalized.core;
    this.safeRadius = normalized.safeRadius;
    this.chunkSize = CHUNK_SIZE;
    this.maxLoadedChunks = normalized.maxLoadedChunks;
    this.generatorVersion = INFINITE_WORLD_GENERATOR_VERSION;
    this._cache = new Map();
    this._accessTick = 0;
    this._deltas = new Map();
    this._discovery = new Map();
    this._poiStates = new Map();
  }

  _touchCache(key, chunk) {
    this._cache.delete(key);
    this._cache.set(key, { chunk, tick: ++this._accessTick });
    while (this._cache.size > this.maxLoadedChunks) {
      const oldestKey = this._cache.keys().next().value;
      this._cache.delete(oldestKey);
    }
    return chunk;
  }

  _baseChunk(chunkX, chunkY) {
    const key = chunkKey(chunkX, chunkY);
    const cached = this._cache.get(key);
    if (cached) return this._touchCache(key, cached.chunk);
    return this._touchCache(key, generateChunk({
      seed: this.seed,
      chunkX,
      chunkY,
      core: this.core,
      safeRadius: this.safeRadius,
      generatorVersion: this.generatorVersion,
    }));
  }

  _resolveCell(baseCell) {
    const delta = this._deltas.get(deltaKey(baseCell.x, baseCell.y));
    const terrainId = delta?.terrainId ?? baseCell.terrainId;
    const terrain = TERRAIN_RULES[terrainId];
    const building = delta?.building ?? null;
    return deepFreeze({
      ...baseCell,
      terrainId,
      ...terrain,
      passable: terrain.passable && !(building?.solid === true),
      buildable: terrain.buildable && !building,
      building,
      discovered: this.isDiscovered(baseCell.x, baseCell.y),
      modified: Boolean(delta),
    });
  }

  peekBaseCell(x, y) {
    const coordinate = worldToChunk(x, y);
    return this._baseChunk(coordinate.chunkX, coordinate.chunkY).cells[coordinate.index];
  }

  getCell(x, y) {
    return this._resolveCell(this.peekBaseCell(x, y));
  }

  getZoneAt(x, y) {
    const coordinate = worldToChunk(x, y);
    return this._baseChunk(coordinate.chunkX, coordinate.chunkY).zone;
  }

  getChunk(chunkX, chunkY) {
    const base = this._baseChunk(chunkX, chunkY);
    return deepFreeze({
      ...base,
      cells: base.cells.map((cell) => this._resolveCell(cell)),
      pois: base.pois.map((poi) => ({
        ...poi,
        discovered: this.isDiscovered(poi.x, poi.y),
        state: this.getPoiState(poi.id),
      })),
    });
  }

  getPoisInChunk(chunkX, chunkY, { discoveredOnly = false } = {}) {
    // POI queries do not need 256 resolved cell objects. Resolve only the
    // handful of POIs so camera browsing stays cheap on mobile runtimes.
    return this._baseChunk(chunkX, chunkY).pois
      .map((poi) => ({
        ...poi,
        discovered: this.isDiscovered(poi.x, poi.y),
        state: this.getPoiState(poi.id),
      }))
      .filter((poi) => !discoveredOnly || poi.discovered);
  }

  getPoisInBounds(bounds, { paddingChunks = 0, discoveredOnly = false } = {}) {
    const normalized = normalizeBounds(bounds);
    let coordinates = chunksForBounds(normalized, { paddingChunks });
    const centerX = (normalized.minX + normalized.maxXExclusive) / 2;
    const centerY = (normalized.minY + normalized.maxYExclusive) / 2;
    coordinates = coordinates
      .map((coordinate) => ({
        ...coordinate,
        distanceSquared: ((coordinate.chunkX * CHUNK_SIZE + CHUNK_SIZE / 2) - centerX) ** 2
          + ((coordinate.chunkY * CHUNK_SIZE + CHUNK_SIZE / 2) - centerY) ** 2,
      }))
      .sort((left, right) => left.distanceSquared - right.distanceSquared
        || left.chunkY - right.chunkY
        || left.chunkX - right.chunkX)
      .slice(0, this.maxLoadedChunks);
    const pois = coordinates.flatMap(({ chunkX, chunkY }) => (
      this.getPoisInChunk(chunkX, chunkY, { discoveredOnly })
    ));
    return pois.filter((poi) => poi.x >= normalized.minX
      && poi.x < normalized.maxXExclusive
      && poi.y >= normalized.minY
      && poi.y < normalized.maxYExclusive);
  }

  _retainOnly(keys) {
    for (const key of this._cache.keys()) {
      if (!keys.has(key)) this._cache.delete(key);
    }
  }

  loadAround(center, radiusCells = CHUNK_SIZE * 2, { resolved = true } = {}) {
    if (!center || typeof center !== 'object') throw new TypeError('center is required');
    const coordinates = chunksAroundCircle(center.x, center.y, radiusCells, this.maxLoadedChunks);
    const requiredKeys = new Set(coordinates.map(({ key }) => key));
    this._retainOnly(requiredKeys);
    return coordinates.map(({ chunkX, chunkY }) => (
      resolved ? this.getChunk(chunkX, chunkY) : this._baseChunk(chunkX, chunkY)
    ));
  }

  loadAroundCamera(camera, radiusOrOptions = CHUNK_SIZE) {
    if (!camera || typeof camera !== 'object') throw new TypeError('camera is required');
    const options = typeof radiusOrOptions === 'number' ? {} : radiusOrOptions;
    const radiusPadding = typeof radiusOrOptions === 'number'
      ? radiusOrOptions
      : options.radiusCells ?? CHUNK_SIZE;
    const loadOptions = { resolved: options.resolved !== false };
    const minX = camera.minX ?? camera.x;
    const minY = camera.minY ?? camera.y;
    const hasBounds = Number.isFinite(camera.maxXExclusive) || Number.isFinite(camera.width);
    if (!hasBounds) return this.loadAround({ x: minX, y: minY }, radiusPadding, loadOptions);
    const maxXExclusive = camera.maxXExclusive ?? (camera.x + camera.width);
    const maxYExclusive = camera.maxYExclusive ?? (camera.y + camera.height);
    const centerX = (minX + maxXExclusive) / 2;
    const centerY = (minY + maxYExclusive) / 2;
    const viewRadius = Math.hypot(maxXExclusive - minX, maxYExclusive - minY) / 2;
    return this.loadAround({ x: centerX, y: centerY }, viewRadius + radiusPadding, loadOptions);
  }

  updateCamera(bounds, { paddingChunks = 1, reveal = false, resolved = false } = {}) {
    const normalized = normalizeBounds(bounds);
    const padding = paddingChunks * CHUNK_SIZE;
    // Rendering only needs immutable chunk metadata for zone decals. Avoid
    // rebuilding and deep-freezing every resolved cell on every animation
    // frame; callers that truly need resolved cells can opt in explicitly.
    const chunks = this.loadAroundCamera(normalized, {
      radiusCells: padding,
      resolved,
    });
    if (reveal) {
      const centerX = Math.floor((normalized.minX + normalized.maxXExclusive) / 2);
      const centerY = Math.floor((normalized.minY + normalized.maxYExclusive) / 2);
      const radius = Math.ceil(Math.hypot(
        normalized.maxXExclusive - normalized.minX,
        normalized.maxYExclusive - normalized.minY,
      ) / 2);
      this.reveal(centerX, centerY, radius);
    }
    return chunks;
  }

  clearCache() {
    this._cache.clear();
  }

  _discoveryRecord(chunkX, chunkY, create = false) {
    const key = chunkKey(chunkX, chunkY);
    let record = this._discovery.get(key);
    if (!record && create) {
      record = { chunkX, chunkY, bits: new Uint32Array(DISCOVERY_WORDS) };
      this._discovery.set(key, record);
    }
    return record ?? null;
  }

  isDiscovered(x, y) {
    const coordinate = worldToChunk(x, y);
    const record = this._discoveryRecord(coordinate.chunkX, coordinate.chunkY);
    if (!record) return false;
    const word = Math.floor(coordinate.index / 32);
    const mask = (1 << (coordinate.index % 32)) >>> 0;
    return (record.bits[word] & mask) !== 0;
  }

  reveal(x, y, radius = 0) {
    assertSafeInteger(x, 'x');
    assertSafeInteger(y, 'y');
    if (!Number.isSafeInteger(radius) || radius < 0) {
      throw new TypeError('radius must be a non-negative safe integer');
    }
    let revealed = 0;
    for (let cellY = y - radius; cellY <= y + radius; cellY += 1) {
      for (let cellX = x - radius; cellX <= x + radius; cellX += 1) {
        const dx = cellX - x;
        const dy = cellY - y;
        if ((dx * dx) + (dy * dy) > radius * radius) continue;
        const coordinate = worldToChunk(cellX, cellY);
        const record = this._discoveryRecord(coordinate.chunkX, coordinate.chunkY, true);
        const word = Math.floor(coordinate.index / 32);
        const mask = (1 << (coordinate.index % 32)) >>> 0;
        if ((record.bits[word] & mask) === 0) {
          record.bits[word] = (record.bits[word] | mask) >>> 0;
          revealed += 1;
        }
      }
    }
    return revealed;
  }

  discoverChunk(chunkX, chunkY) {
    assertSafeInteger(chunkX, 'chunkX');
    assertSafeInteger(chunkY, 'chunkY');
    const record = this._discoveryRecord(chunkX, chunkY, true);
    record.bits.fill(0xffffffff);
    return CHUNK_SIZE * CHUNK_SIZE;
  }

  getCellDelta(x, y) {
    assertSafeInteger(x, 'x');
    assertSafeInteger(y, 'y');
    const delta = this._deltas.get(deltaKey(x, y));
    return delta ? cloneJsonValue(delta) : null;
  }

  applyCellDelta(x, y, patch) {
    assertSafeInteger(x, 'x');
    assertSafeInteger(y, 'y');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new TypeError('patch must be an object');
    }
    const key = deltaKey(x, y);
    const existing = this._deltas.get(key) ?? { x, y };
    const next = { ...existing };
    if (hasOwn(patch, 'terrainId')) {
      if (!TERRAIN_IDS.includes(patch.terrainId)) throw new RangeError(`unknown terrainId ${patch.terrainId}`);
      const baseTerrainId = this.peekBaseCell(x, y).terrainId;
      if (patch.terrainId === baseTerrainId) delete next.terrainId;
      else next.terrainId = patch.terrainId;
    }
    if (hasOwn(patch, 'building')) {
      if (patch.building === null) delete next.building;
      else next.building = normalizeBuilding(patch.building);
    }
    if (!hasOwn(next, 'terrainId') && !hasOwn(next, 'building')) this._deltas.delete(key);
    else this._deltas.set(key, deepFreeze(next));
    return this.getCell(x, y);
  }

  setTerrain(x, y, terrainId) {
    return this.applyCellDelta(x, y, { terrainId });
  }

  harvestCell(x, y) {
    const before = this.getCell(x, y);
    if (!before.harvestable || !before.replacement) return { ok: false, reason: 'not-harvestable', cell: before };
    const cell = this.setTerrain(x, y, before.replacement);
    return { ok: true, yield: cloneJsonValue(before.yield), cell };
  }

  destroyCell(x, y) {
    const before = this.getCell(x, y);
    if (!before.destructible || !before.replacement) return { ok: false, reason: 'not-destructible', cell: before };
    const cell = this.setTerrain(x, y, before.replacement);
    return { ok: true, yield: cloneJsonValue(before.yield), cell };
  }

  buildAt(x, y, building) {
    const before = this.getCell(x, y);
    if (!before.buildable || before.building) return { ok: false, reason: 'not-buildable', cell: before };
    const cell = this.applyCellDelta(x, y, { building: normalizeBuilding(building) });
    return { ok: true, cell };
  }

  removeBuildingAt(x, y) {
    const before = this.getCell(x, y);
    if (!before.building) return { ok: false, reason: 'no-building', cell: before };
    return { ok: true, building: before.building, cell: this.applyCellDelta(x, y, { building: null }) };
  }

  getPoiState(poiId) {
    if (typeof poiId !== 'string' || poiId.length === 0) throw new TypeError('poiId must be non-empty');
    const state = this._poiStates.get(poiId);
    return state ? deepFreeze(cloneJsonValue(state)) : null;
  }

  setPoiState(poiId, patch) {
    if (typeof poiId !== 'string' || poiId.length === 0) throw new TypeError('poiId must be non-empty');
    if (patch === null) {
      this._poiStates.delete(poiId);
      return null;
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new TypeError('POI state patch must be an object or null');
    }
    const next = {
      ...(this._poiStates.get(poiId) ?? {}),
      ...cloneJsonValue(patch, 'POI state'),
    };
    this._poiStates.set(poiId, deepFreeze(next));
    return this.getPoiState(poiId);
  }

  stats() {
    return Object.freeze({
      loadedChunks: this._cache.size,
      maxLoadedChunks: this.maxLoadedChunks,
      modifiedCells: this._deltas.size,
      discoveryChunks: this._discovery.size,
      poiStates: this._poiStates.size,
      accessTick: this._accessTick,
    });
  }

  cacheKeys() {
    return Object.freeze([...this._cache.keys()]);
  }

  serialize() {
    const discovery = [...this._discovery.values()]
      .sort((left, right) => left.chunkY - right.chunkY || left.chunkX - right.chunkX)
      .map(({ chunkX, chunkY, bits }) => ({ chunkX, chunkY, bits: [...bits] }));
    const cellDeltas = [...this._deltas.values()]
      .sort((left, right) => left.y - right.y || left.x - right.x)
      .map((delta) => cloneJsonValue(delta));
    const poiStates = [...this._poiStates.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, state]) => ({ id, state: cloneJsonValue(state) }));
    return deepFreeze({
      schemaVersion: INFINITE_WORLD_SCHEMA_VERSION,
      generatorVersion: this.generatorVersion,
      chunkSize: CHUNK_SIZE,
      seed: this.seed,
      core: { ...this.core },
      safeRadius: this.safeRadius,
      discovery,
      cellDeltas,
      poiStates,
    });
  }

  serializeString() {
    return JSON.stringify(this.serialize());
  }
}

export function createInfiniteWorld(options = {}) {
  return new InfiniteWorld(options);
}

function parseSnapshot(snapshot) {
  let parsed = snapshot;
  if (typeof snapshot === 'string') {
    try {
      parsed = JSON.parse(snapshot);
    } catch {
      throw new TypeError('snapshot must be valid JSON');
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('snapshot must be an object or JSON string');
  }
  return parsed;
}

export function restoreInfiniteWorld(snapshot, options = {}) {
  const parsed = parseSnapshot(snapshot);
  if (parsed.schemaVersion !== INFINITE_WORLD_SCHEMA_VERSION) {
    throw new RangeError(`unsupported schemaVersion ${parsed.schemaVersion}`);
  }
  if (parsed.generatorVersion !== INFINITE_WORLD_GENERATOR_VERSION) {
    throw new RangeError(`unsupported generatorVersion ${parsed.generatorVersion}`);
  }
  if (parsed.chunkSize !== CHUNK_SIZE) throw new RangeError(`unsupported chunkSize ${parsed.chunkSize}`);
  if (!Array.isArray(parsed.discovery)
    || !Array.isArray(parsed.cellDeltas)
    || !Array.isArray(parsed.poiStates)) {
    throw new TypeError('snapshot collections are invalid');
  }

  const world = createInfiniteWorld({
    seed: parsed.seed,
    core: parsed.core,
    safeRadius: parsed.safeRadius,
    maxLoadedChunks: options.maxLoadedChunks ?? options.maxCachedChunks,
  });

  for (const entry of parsed.discovery) {
    assertSafeInteger(entry?.chunkX, 'discovery.chunkX');
    assertSafeInteger(entry?.chunkY, 'discovery.chunkY');
    if (!Array.isArray(entry.bits) || entry.bits.length !== DISCOVERY_WORDS
      || entry.bits.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffffffff)) {
      throw new TypeError('discovery bits are invalid');
    }
    const record = world._discoveryRecord(entry.chunkX, entry.chunkY, true);
    record.bits.set(entry.bits);
  }

  for (const delta of parsed.cellDeltas) {
    assertSafeInteger(delta?.x, 'cellDelta.x');
    assertSafeInteger(delta?.y, 'cellDelta.y');
    const patch = {};
    if (hasOwn(delta, 'terrainId')) patch.terrainId = delta.terrainId;
    if (hasOwn(delta, 'building')) patch.building = delta.building;
    world.applyCellDelta(delta.x, delta.y, patch);
  }

  for (const entry of parsed.poiStates) {
    if (!entry || typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new TypeError('POI state id is invalid');
    }
    world.setPoiState(entry.id, entry.state);
  }
  world.clearCache();
  return world;
}
