const TAU = Math.PI * 2;

const COLORS = Object.freeze({
  grass: '#7ddc72',
  grassLight: '#a8ec7f',
  grassDark: '#54bd67',
  grassInk: 'rgba(35, 121, 75, 0.24)',
  water: '#38bde8',
  waterDeep: '#168bd4',
  waterLight: '#8beaff',
  waterInk: '#157bb5',
  wasteGround: '#c7dc72',
  wasteGroundLight: '#e6ef9a',
  wasteWater: '#b8ea4f',
  wasteWaterLight: '#efff9a',
  wasteWaterInk: '#638f2f',
  cliff: '#b99a78',
  cliffLight: '#e0c49a',
  cliffDark: '#846c5b',
  cliffInk: '#655445',
  shadow: 'rgba(36, 76, 59, 0.22)',
  ink: '#214d51',
  shine: 'rgba(255, 255, 235, 0.82)',
});

const CARDINAL_DIRECTIONS = Object.freeze([
  { name: 'top', dx: 0, dy: -1 },
  { name: 'right', dx: 1, dy: 0 },
  { name: 'bottom', dx: 0, dy: 1 },
  { name: 'left', dx: -1, dy: 0 },
]);

/**
 * Public asset contract for authored terrain PNGs. `game.js` can reuse this
 * mapping (or `drawTerrainAsset`) for inspector cards, so the world and UI do
 * not quietly drift to different artwork.
 */
export const TERRAIN_ASSET_KEYS = Object.freeze({
  ground: 'terrain-ground-detail-a',
  'soft-gel': 'terrain-soft-gel-node-a',
  'dew-honey': 'terrain-dew-honey-node-a',
  'crystal-shard': 'terrain-crystal-shard-node-a',
  'thorn-thicket': 'terrain-thorn-thicket-a',
  'brittle-boulder': 'terrain-brittle-boulder-a',
  'deep-water': 'terrain-deep-water-patch-a',
});

/** Authored art used by whole-map rendering rather than one logical terrain cell. */
export const TERRAIN_LAYER_ASSET_KEYS = Object.freeze({
  ground: 'terrain-ground-field-v1',
  fog: 'terrain-discovery-fog-cell-v1',
  shadow: 'terrain-prop-contact-shadow-v1',
});

/** One authored ground field spans this many world cells on each axis. */
export const WORLD_GROUND_TEXTURE_PERIOD_CELLS = 12;

/** Large organic decals for the five deterministic infinite-world biomes. */
export const REGION_ASSET_KEYS = Object.freeze({
  'gel-garden': 'region-gel-meadow-field-a',
  'dew-grove': 'region-dew-grove-field-a',
  'crystal-meadow': 'region-crystal-bloom-field-a',
  'bubble-wetland': 'region-bubble-heath-field-a',
  'soft-shell-canyon': 'region-shell-canyon-field-a',
});

/** Bright landmark cutouts keyed by their owning infinite-world biome. */
export const LANDMARK_ASSET_KEYS = Object.freeze({
  'gel-garden': 'landmark-soft-relay-a',
  'dew-grove': 'landmark-dew-canopy-a',
  'crystal-meadow': 'landmark-giant-crystal-bloom-a',
  'bubble-wetland': 'landmark-bubble-arch-a',
  'soft-shell-canyon': 'landmark-boss-shell-grotto-a',
});

/**
 * POI layer contract. Nest energy is deliberately listed before its frame so
 * callers always composite the moving glow behind the solid authored shell.
 */
export const POI_ASSET_KEYS = Object.freeze({
  nest: Object.freeze(['nest-soft-rift-energy-a', 'nest-soft-rift-frame-a']),
  relay: Object.freeze(['landmark-soft-relay-a']),
  boss: Object.freeze(['landmark-boss-shell-grotto-a']),
});

/** @deprecated Retained only so old saves/imports do not lose their key map. */
export const WASTELAND_TERRAIN_ASSET_KEYS = Object.freeze({
  ground: 'terrain-waste-ground-detail-a',
  'soft-gel': 'terrain-waste-soft-gel-cache-a',
  'dew-honey': 'terrain-waste-dew-pod-a',
  'crystal-shard': 'terrain-waste-crystal-scrap-a',
  'thorn-thicket': 'terrain-waste-cable-thicket-a',
  'brittle-boulder': 'terrain-waste-rusted-wreck-a',
  'deep-water': 'terrain-waste-acid-sludge-a',
});

const DEFAULT_WASTELAND_WORLD = Object.freeze({ width: 24, height: 16 });

export const TERRAIN_ASSET_PROFILES = Object.freeze({
  ground: Object.freeze({ width: 0.72, height: 0.47, groundOffset: 0.16 }),
  'soft-gel': Object.freeze({
    width: 0.875,
    height: 0.75,
    groundOffset: 0.43,
    shadowWidth: 0.84,
    shadowHeight: 0.24,
    shadowOffset: 0.31,
  }),
  'dew-honey': Object.freeze({
    width: 0.906,
    height: 0.844,
    groundOffset: 0.43,
    shadowWidth: 0.76,
    shadowHeight: 0.22,
    shadowOffset: 0.29,
  }),
  'crystal-shard': Object.freeze({
    width: 0.813,
    height: 0.875,
    groundOffset: 0.43,
    shadowWidth: 0.92,
    shadowHeight: 0.26,
    shadowOffset: 0.29,
  }),
  'thorn-thicket': Object.freeze({
    width: 1.03,
    height: 0.78,
    groundOffset: 0.43,
    shadowWidth: 0.9,
    shadowHeight: 0.24,
    shadowOffset: 0.3,
  }),
  'brittle-boulder': Object.freeze({
    width: 0.906,
    height: 0.719,
    groundOffset: 0.43,
    shadowWidth: 0.96,
    shadowHeight: 0.28,
    shadowOffset: 0.29,
  }),
  'deep-water': Object.freeze({ width: 1, height: 1, groundOffset: 0.5 }),
});

const VISUAL_VARIANT_SCALE = Object.freeze([0.94, 1.03, 0.98, 1.06]);

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hash2d(x, y, salt = 0) {
  let value = Math.imul((x | 0) + 374761393, 668265263)
    ^ Math.imul((y | 0) + 1442695041, 2246822519)
    ^ Math.imul(salt + 31, 3266489917);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function animationTime(value) {
  const time = finite(value, 0);
  return Math.abs(time) > 10000 ? time / 1000 : time;
}

function canonicalTerrainId(tileOrId) {
  const source = typeof tileOrId === 'string'
    ? tileOrId
    : tileOrId?.terrainId
      || tileOrId?.id
      || tileOrId?.variant
      || tileOrId?.resourceType
      || tileOrId?.type
      || '';
  const id = String(source).toLowerCase();
  if (TERRAIN_ASSET_KEYS[id]) return id;
  if (/crystal|gem|ore/.test(id)) return 'crystal-shard';
  if (/dew|honey|nectar|flower/.test(id)) return 'dew-honey';
  if (/gel|slime/.test(id)) return 'soft-gel';
  if (/thorn|thicket|bramble/.test(id)) return 'thorn-thicket';
  if (/brittle|breakable|boulder/.test(id)) return 'brittle-boulder';
  if (/deep-water|water|river|pond|stream|lake/.test(id)) return 'deep-water';
  if (/ground|grass|soil/.test(id)) return 'ground';
  return null;
}

/** Resolve either an authored terrain id or a renderer tile to its PNG key. */
export function terrainAssetKey(tileOrId) {
  const terrainId = canonicalTerrainId(tileOrId);
  return terrainId ? TERRAIN_ASSET_KEYS[terrainId] : null;
}

function canonicalZoneId(zoneOrId) {
  const source = typeof zoneOrId === 'string'
    ? zoneOrId
    : zoneOrId?.kind
      || zoneOrId?.biomeId
      || zoneOrId?.biome
      || zoneOrId?.zoneKind
      || zoneOrId?.zone?.kind
      || '';
  const id = String(source).toLowerCase();
  if (REGION_ASSET_KEYS[id]) return id;
  if (/gel|garden|花园|花圃/.test(id)) return 'gel-garden';
  if (/dew|honey|grove|露蜜|露珠/.test(id)) return 'dew-grove';
  if (/crystal|晶/.test(id)) return 'crystal-meadow';
  if (/bubble|wetland|泡泡|湿地/.test(id)) return 'bubble-wetland';
  if (/shell|canyon|壳|峡谷/.test(id)) return 'soft-shell-canyon';
  return null;
}

/** Resolve a generated organic field decal for an infinite-world zone. */
export function regionAssetKeyForZone(zoneOrId) {
  const zoneId = canonicalZoneId(zoneOrId);
  return zoneId ? REGION_ASSET_KEYS[zoneId] : null;
}

/** Resolve a generated landmark cutout for an infinite-world zone. */
export function landmarkAssetKeyForZone(zoneOrId) {
  const zoneId = canonicalZoneId(zoneOrId);
  return zoneId ? LANDMARK_ASSET_KEYS[zoneId] : null;
}

/**
 * Resolve ordered generated layers for a world POI. Pass the owning chunk's
 * `zone` as the second argument when resolving a natural landmark.
 */
export function worldPoiAssetKeys(poiOrKind, zoneOrId = null) {
  const poi = poiOrKind && typeof poiOrKind === 'object' ? poiOrKind : null;
  const kind = String(poi?.kind ?? poiOrKind ?? '').toLowerCase();
  if (kind === 'nest') return POI_ASSET_KEYS.nest;
  if (kind === 'boss') return POI_ASSET_KEYS.boss;
  if (kind === 'relay' || kind === 'soft-relay') return POI_ASSET_KEYS.relay;
  if (kind === 'landmark') {
    const key = landmarkAssetKeyForZone(zoneOrId ?? poi?.zone ?? poi?.biome);
    return key ? Object.freeze([key]) : Object.freeze([]);
  }
  return Object.freeze([]);
}

function normalizeWorldSize(world = DEFAULT_WASTELAND_WORLD) {
  return {
    width: Math.max(1, Math.floor(finite(world?.width, DEFAULT_WASTELAND_WORLD.width))),
    height: Math.max(1, Math.floor(finite(world?.height, DEFAULT_WASTELAND_WORLD.height))),
  };
}

/**
 * @deprecated The abandoned finite-map wasteland classifier is intentionally
 * disabled. Infinite world coordinates always use the bright biome system.
 */
export function isWastelandCell() {
  return false;
}

/** Resolve the bright authored PNG for a terrain type at any world cell. */
export function terrainAssetKeyForCell(tileOrId) {
  const terrainId = canonicalTerrainId(tileOrId);
  return terrainId ? TERRAIN_ASSET_KEYS[terrainId] : null;
}

function normalizedVisualVariant(tileOrId, suppliedVariant) {
  const authoredVariant = typeof tileOrId === 'object' ? tileOrId?.visualVariant : null;
  const coordinateVariant = typeof tileOrId === 'object'
    && Number.isFinite(tileOrId?.x)
    && Number.isFinite(tileOrId?.y)
    ? Math.floor(hash2d(tileOrId.x, tileOrId.y, 79) * VISUAL_VARIANT_SCALE.length)
    : 0;
  const raw = suppliedVariant ?? authoredVariant ?? coordinateVariant;
  const numeric = Number.isFinite(Number(raw)) ? Math.floor(Number(raw)) : 0;
  return ((numeric % VISUAL_VARIANT_SCALE.length) + VISUAL_VARIANT_SCALE.length)
    % VISUAL_VARIANT_SCALE.length;
}

function useTerrainAsset(ctx, assetStore, key, drawAsset, drawFallback = () => {}) {
  const fallback = () => {
    ctx.save();
    try {
      drawFallback();
    } finally {
      ctx.restore();
    }
  };
  if (!key || !assetStore || typeof assetStore.useOrFallback !== 'function') {
    fallback();
    return false;
  }
  return assetStore.useOrFallback(key, (asset) => {
    ctx.save();
    try {
      drawAsset(asset);
    } finally {
      ctx.restore();
    }
  }, fallback);
}

function getReadyAsset(assetStore, key) {
  if (!key || typeof assetStore?.get !== 'function') return null;
  try {
    return assetStore.get(key) || null;
  } catch {
    return null;
  }
}

/**
 * Draw one terrain cutout using a bottom-centre ground anchor. This helper is
 * intentionally usable outside the map renderer (for example in the right
 * inspector panel). Missing/unready PNGs always execute `fallback`.
 */
export function drawTerrainAsset(ctx, assetStore, tileOrId, options = {}) {
  if (!ctx) throw new TypeError('drawTerrainAsset requires a Canvas 2D context');
  const terrainId = canonicalTerrainId(tileOrId);
  const key = terrainId ? terrainAssetKeyForCell(tileOrId, {
    x: options.worldX,
    y: options.worldY,
    world: options.world,
  }) : null;
  const profile = TERRAIN_ASSET_PROFILES[terrainId] || TERRAIN_ASSET_PROFILES.ground;
  const cellSize = Math.max(2, finite(options.cellSize ?? options.pixelsPerCell, 64));
  const visualVariant = normalizedVisualVariant(tileOrId, options.visualVariant);
  const variantScale = VISUAL_VARIANT_SCALE[visualVariant];
  const width = Math.max(1, finite(options.width, cellSize * profile.width * variantScale));
  const height = Math.max(1, finite(options.height, cellSize * profile.height * variantScale));
  const x = finite(options.x, 0);
  const y = finite(options.y, 0);
  const mirror = visualVariant % 2 === 1 ? -1 : 1;
  const alpha = clamp(finite(options.alpha, 1), 0, 1);

  return useTerrainAsset(ctx, assetStore, key, (asset) => {
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    ctx.scale(mirror, 1);
    ctx.drawImage(asset, -width / 2, -height, width, height);
  }, options.fallback);
}

function normalizeBounds(options) {
  const source = options.visibleBounds || options.bounds || {};
  const inferred = inferTileBounds(options.tiles);
  const minX = Math.floor(finite(source.minX, inferred.minX));
  const minY = Math.floor(finite(source.minY, inferred.minY));
  const maxX = Math.max(minX, Math.ceil(finite(source.maxX, inferred.maxX)));
  const maxY = Math.max(minY, Math.ceil(finite(source.maxY, inferred.maxY)));
  return { minX, minY, maxX, maxY };
}

function inferTileBounds(tiles) {
  if (Array.isArray(tiles) && Array.isArray(tiles[0])) {
    return {
      minX: 0,
      minY: 0,
      maxX: Math.max(0, ...tiles.map((row) => (Array.isArray(row) ? row.length - 1 : 0))),
      maxY: Math.max(0, tiles.length - 1),
    };
  }
  if (Array.isArray(tiles)) {
    const positioned = tiles.filter((tile) => Number.isFinite(tile?.x) && Number.isFinite(tile?.y));
    if (positioned.length) {
      return {
        minX: Math.min(...positioned.map((tile) => tile.x)),
        minY: Math.min(...positioned.map((tile) => tile.y)),
        maxX: Math.max(...positioned.map((tile) => tile.x)),
        maxY: Math.max(...positioned.map((tile) => tile.y)),
      };
    }
  }
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function normalizeTile(raw, x, y) {
  if (raw == null || raw === false) return { x, y, kind: 'ground', variant: 'grass' };
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase();
    const terrainId = canonicalTerrainId(lower);
    const kind = ['soft-gel', 'dew-honey', 'crystal-shard'].includes(terrainId)
      ? 'resource'
      : terrainId === 'thorn-thicket'
        ? 'obstacle'
        : terrainId === 'brittle-boulder'
          ? 'destructible'
          : /water|river|pond|lake|cliff|ridge|bedrock|mountain/.test(lower)
      ? 'indestructible'
      : /resource|crystal|dew|gel|wood|timber|herb|ore/.test(lower)
        ? 'resource'
        : /destruct|breakable|rubble|log|bramble/.test(lower)
          ? 'destructible'
          : /obstacle|bush|stump|shrub/.test(lower)
            ? 'obstacle'
            : 'ground';
    return { x, y, kind, variant: lower };
  }
  const terrain = raw.terrain && typeof raw.terrain === 'object' ? raw.terrain : raw;
  const explicitKind = String(terrain.kind || terrain.category || '').toLowerCase();
  const variant = String(
    terrain.variant
      || terrain.resourceType
      || terrain.terrainType
      || terrain.terrainId
      || terrain.type
      || terrain.id
      || 'grass',
  ).toLowerCase();
  const kind = ['ground', 'resource', 'obstacle', 'destructible', 'indestructible'].includes(explicitKind)
    ? explicitKind
    : normalizeTile(variant, x, y).kind;
  return { ...terrain, x: finite(raw.x, x), y: finite(raw.y, y), kind, variant };
}

function createTerrainLookup(options) {
  const direct = typeof options.terrainAt === 'function' ? options.terrainAt : null;
  let tiles = options.tiles;
  if (tiles && !Array.isArray(tiles) && !(tiles instanceof Map) && tiles.tiles) tiles = tiles.tiles;
  const positioned = Array.isArray(tiles)
    && !Array.isArray(tiles[0])
    && tiles.some((tile) => Number.isFinite(tile?.x) && Number.isFinite(tile?.y))
    ? new Map(tiles.map((tile) => [`${tile.x},${tile.y}`, tile]))
    : null;
  const flatWidth = Math.max(1, Math.floor(finite(options.world?.width, options.width || 1)));

  return (x, y) => {
    let raw;
    if (direct) {
      raw = direct(x, y);
    } else if (tiles instanceof Map) {
      raw = tiles.get(`${x},${y}`) ?? tiles.get(y * flatWidth + x);
    } else if (positioned) {
      raw = positioned.get(`${x},${y}`);
    } else if (Array.isArray(tiles) && Array.isArray(tiles[0])) {
      raw = tiles[y]?.[x];
    } else if (Array.isArray(tiles)) {
      raw = tiles[y * flatWidth + x];
    } else if (tiles && typeof tiles === 'object') {
      raw = tiles[`${x},${y}`] ?? tiles[y]?.[x];
    }
    return normalizeTile(raw, x, y);
  };
}

function createProjector(options) {
  const supplied = typeof options.worldToScreen === 'function' ? options.worldToScreen : null;
  const pixelsPerCell = Math.max(2, finite(options.pixelsPerCell, 64));
  const originX = finite(options.origin?.x, 0);
  const originY = finite(options.origin?.y, 0);
  const project = supplied
    ? (x, y) => supplied({ x, y })
    : (x, y) => ({ x: originX + x * pixelsPerCell, y: originY + y * pixelsPerCell });
  return { project, pixelsPerCell };
}

function isOddInteger(value) {
  return Math.abs(Math.trunc(value) % 2) === 1;
}

function clipProjectedBounds(ctx, bounds, project) {
  if (typeof ctx.clip !== 'function') return;
  const first = project(bounds.minX, bounds.minY);
  const second = project(bounds.maxX + 1, bounds.maxY + 1);
  const left = Math.min(first.x, second.x);
  const right = Math.max(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const bottom = Math.max(first.y, second.y);
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, bottom);
  ctx.lineTo(left, bottom);
  ctx.closePath();
  ctx.clip();
}

/**
 * Tiles one authored image in absolute world space. Adjacent macro tiles mirror
 * over their shared axis, so even a source whose opposite edges differ joins
 * continuously. Tile identity depends only on world coordinates, never on the
 * current viewport, including west/north of the origin.
 */
export function drawWorldAnchoredTerrainTexture(ctx, asset, options = {}) {
  if (!ctx) throw new TypeError('drawWorldAnchoredTerrainTexture requires a Canvas 2D context');
  if (!asset) return { tiles: 0 };
  const bounds = normalizeBounds(options);
  const { project } = createProjector(options);
  const periodCells = Math.max(1, finite(
    options.periodCells,
    WORLD_GROUND_TEXTURE_PERIOD_CELLS,
  ));
  const overlapPixels = Math.max(0, finite(options.overlapPixels, 1));
  const minTileX = Math.floor(bounds.minX / periodCells);
  const minTileY = Math.floor(bounds.minY / periodCells);
  const maxTileX = Math.ceil((bounds.maxX + 1) / periodCells) - 1;
  const maxTileY = Math.ceil((bounds.maxY + 1) / periodCells) - 1;
  let tiles = 0;

  ctx.save();
  clipProjectedBounds(ctx, bounds, project);
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const worldX = tileX * periodCells;
      const worldY = tileY * periodCells;
      const first = project(worldX, worldY);
      const second = project(worldX + periodCells, worldY + periodCells);
      const width = Math.abs(second.x - first.x) + overlapPixels;
      const height = Math.abs(second.y - first.y) + overlapPixels;
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.scale(isOddInteger(tileX) ? -1 : 1, isOddInteger(tileY) ? -1 : 1);
      ctx.drawImage(asset, -width / 2, -height / 2, width, height);
      ctx.restore();
      tiles += 1;
    }
  }
  ctx.restore();
  return {
    tiles,
    minTileX,
    minTileY,
    maxTileX,
    maxTileY,
    periodCells,
  };
}

function ellipsePath(ctx, x, y, rx, ry) {
  const k = 0.5522847498;
  ctx.beginPath();
  ctx.moveTo(x - rx, y);
  ctx.bezierCurveTo(x - rx, y - ry * k, x - rx * k, y - ry, x, y - ry);
  ctx.bezierCurveTo(x + rx * k, y - ry, x + rx, y - ry * k, x + rx, y);
  ctx.bezierCurveTo(x + rx, y + ry * k, x + rx * k, y + ry, x, y + ry);
  ctx.bezierCurveTo(x - rx * k, y + ry, x - rx, y + ry * k, x - rx, y);
  ctx.closePath();
}

function roundedBlobPath(ctx, x, y, radius, seed, lobes = 7, squash = 0.78) {
  const points = [];
  for (let index = 0; index < lobes; index += 1) {
    const angle = (index / lobes) * TAU;
    const jitter = 0.86 + hash2d(seed, index, 19) * 0.25;
    points.push({
      x: x + Math.cos(angle) * radius * jitter,
      y: y + Math.sin(angle) * radius * squash * jitter,
    });
  }
  ctx.beginPath();
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const mid = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
    if (index === 0) ctx.moveTo(mid.x, mid.y);
    ctx.quadraticCurveTo(next.x, next.y, (next.x + points[(index + 2) % points.length].x) / 2,
      (next.y + points[(index + 2) % points.length].y) / 2);
  }
  ctx.closePath();
}

function polygon(ctx, points) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
  ctx.closePath();
}

function paintBlob(ctx, x, y, radius, seed, fill, stroke = COLORS.ink, lineWidth = 2, squash = 0.78) {
  roundedBlobPath(ctx, x, y, radius, seed, 7, squash);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke && lineWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function paintShadow(ctx, x, y, width, height) {
  ellipsePath(ctx, x, y, width, height);
  ctx.fillStyle = COLORS.shadow;
  ctx.fill();
}

function variantIncludes(tile, pattern) {
  const source = `${tile.variant || ''} ${tile.resourceType || ''} ${tile.type || ''} ${tile.id || ''}`;
  return pattern.test(source.toLowerCase());
}

function isWater(tile) {
  return tile.kind === 'indestructible' && variantIncludes(tile, /water|river|pond|stream|lake/);
}

function isCliff(tile) {
  return tile.kind === 'indestructible' && variantIncludes(tile, /cliff|ridge|ledge/);
}

function drawGroundDetail(ctx, x, y, cell, seed, time, wasteland = false) {
  const sway = Math.sin(time * 1.1 + seed * 8) * cell * 0.018;
  if (hash2d(seed, 7, 83) < 0.43) {
    ctx.strokeStyle = wasteland ? 'rgba(105, 128, 47, 0.3)' : COLORS.grassInk;
    ctx.lineWidth = Math.max(1, cell * 0.025);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - cell * 0.1, y + cell * 0.12);
    ctx.quadraticCurveTo(x - cell * 0.1 + sway, y - cell * 0.1, x - cell * 0.18 + sway, y - cell * 0.19);
    ctx.moveTo(x - cell * 0.08, y + cell * 0.12);
    ctx.quadraticCurveTo(x + sway, y - cell * 0.06, x + cell * 0.08 + sway, y - cell * 0.15);
    ctx.stroke();
  } else {
    ellipsePath(ctx, x, y, cell * 0.14, cell * 0.055);
    ctx.fillStyle = wasteland
      ? (hash2d(seed, 13, 41) > 0.5 ? 'rgba(255, 246, 145, 0.34)' : 'rgba(126, 177, 70, 0.25)')
      : (hash2d(seed, 13, 41) > 0.5 ? 'rgba(255, 238, 125, 0.22)' : 'rgba(49, 157, 96, 0.18)');
    ctx.fill();
  }
}

function fillOrganicCell(ctx, x, y, cell, neighbors, colors, seed) {
  const radius = cell * 0.49;
  paintBlob(ctx, x, y, radius, seed, colors.fill, null, 0, 0.94);
  ctx.fillStyle = colors.fill;
  for (const neighbor of CARDINAL_DIRECTIONS) {
    if (!neighbors[neighbor.name]) continue;
    const half = cell * 0.51;
    const cross = cell * 0.34;
    ctx.beginPath();
    if (neighbor.name === 'top' || neighbor.name === 'bottom') {
      const endY = y + neighbor.dy * half;
      ctx.moveTo(x - cross, y);
      ctx.lineTo(x - cross, endY);
      ctx.quadraticCurveTo(x, endY + neighbor.dy * cell * 0.05, x + cross, endY);
      ctx.lineTo(x + cross, y);
    } else {
      const endX = x + neighbor.dx * half;
      ctx.moveTo(x, y - cross);
      ctx.lineTo(endX, y - cross);
      ctx.quadraticCurveTo(endX + neighbor.dx * cell * 0.05, y, endX, y + cross);
      ctx.lineTo(x, y + cross);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function exposedBoundaryPath(ctx, side, x, y, cell, seed) {
  const half = cell * 0.49;
  const inset = cell * (0.32 + hash2d(seed, side.length, 53) * 0.025);
  const bulge = cell * (0.025 + hash2d(seed, side.length, 59) * 0.025);
  ctx.beginPath();
  if (side === 'top') {
    ctx.moveTo(x - inset, y - half + bulge);
    ctx.quadraticCurveTo(x, y - half - bulge, x + inset, y - half + bulge);
  } else if (side === 'right') {
    ctx.moveTo(x + half - bulge, y - inset);
    ctx.quadraticCurveTo(x + half + bulge, y, x + half - bulge, y + inset);
  } else if (side === 'bottom') {
    ctx.moveTo(x + inset, y + half - bulge);
    ctx.quadraticCurveTo(x, y + half + bulge, x - inset, y + half - bulge);
  } else {
    ctx.moveTo(x - half + bulge, y + inset);
    ctx.quadraticCurveTo(x - half - bulge, y, x - half + bulge, y - inset);
  }
}

function connectedNeighbors(tile, lookup, matcher) {
  const neighbors = {};
  for (const direction of CARDINAL_DIRECTIONS) {
    neighbors[direction.name] = matcher(lookup(tile.x + direction.dx, tile.y + direction.dy));
  }
  return neighbors;
}

function drawConnectedSurfaceFill(ctx, tile, options, neighbors, palette) {
  const { project, pixelsPerCell: cell } = options;
  const center = project(tile.x + 0.5, tile.y + 0.5);
  const seed = Math.floor(hash2d(tile.x, tile.y, 17) * 100000);
  fillOrganicCell(ctx, center.x, center.y, cell, neighbors, palette, seed);
}

function drawConnectedSurfaceOutline(ctx, tile, options, neighbors, matcher, palette, time) {
  const { project, pixelsPerCell: cell } = options;
  const center = project(tile.x + 0.5, tile.y + 0.5);
  const seed = Math.floor(hash2d(tile.x, tile.y, 17) * 100000);
  let boundarySegments = 0;
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = Math.max(1.25, cell * 0.055);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const direction of CARDINAL_DIRECTIONS) {
    if (neighbors[direction.name]) continue;
    exposedBoundaryPath(ctx, direction.name, center.x, center.y, cell, seed);
    ctx.stroke();
    boundarySegments += 1;
  }

  if (matcher === isWater) {
    const wave = Math.sin(time * 1.7 + tile.x * 0.8 + tile.y * 0.43);
    ctx.strokeStyle = palette.light;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, cell * 0.028);
    ctx.beginPath();
    ctx.moveTo(center.x - cell * 0.23, center.y + wave * cell * 0.035);
    ctx.quadraticCurveTo(center.x, center.y - cell * 0.075 + wave * cell * 0.02,
      center.x + cell * 0.2, center.y - cell * 0.015);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else {
    ctx.strokeStyle = palette.light;
    ctx.lineWidth = Math.max(1, cell * 0.035);
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(center.x - cell * 0.23, center.y - cell * 0.18);
    ctx.quadraticCurveTo(center.x - cell * 0.04, center.y - cell * 0.29, center.x + cell * 0.19, center.y - cell * 0.18);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  return boundarySegments;
}

function drawConnectedSurface(ctx, tile, options, lookup, matcher, palette, time) {
  const neighbors = connectedNeighbors(tile, lookup, matcher);
  drawConnectedSurfaceFill(ctx, tile, options, neighbors, palette);
  return drawConnectedSurfaceOutline(ctx, tile, options, neighbors, matcher, palette, time);
}

function appendEllipseSubpath(ctx, x, y, rx, ry) {
  const k = 0.5522847498;
  ctx.moveTo(x - rx, y);
  ctx.bezierCurveTo(x - rx, y - ry * k, x - rx * k, y - ry, x, y - ry);
  ctx.bezierCurveTo(x + rx * k, y - ry, x + rx, y - ry * k, x + rx, y);
  ctx.bezierCurveTo(x + rx, y + ry * k, x + rx * k, y + ry, x, y + ry);
  ctx.bezierCurveTo(x - rx * k, y + ry, x - rx, y + ry * k, x - rx, y);
  ctx.closePath();
}

function appendConnectorSubpath(ctx, start, end, cell) {
  const halfWidth = cell * 0.35;
  if (Math.abs(start.x - end.x) > Math.abs(start.y - end.y)) {
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    ctx.moveTo(left, start.y - halfWidth);
    ctx.lineTo(right, end.y - halfWidth);
    ctx.lineTo(right, end.y + halfWidth);
    ctx.lineTo(left, start.y + halfWidth);
  } else {
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    ctx.moveTo(start.x - halfWidth, top);
    ctx.lineTo(end.x - halfWidth, bottom);
    ctx.lineTo(end.x + halfWidth, bottom);
    ctx.lineTo(start.x + halfWidth, top);
  }
  ctx.closePath();
}

function connectedComponents(tiles, matcher) {
  const matching = new Map(
    tiles.filter(matcher).map((tile) => [`${tile.x},${tile.y}`, tile]),
  );
  const visited = new Set();
  const result = [];
  for (const tile of matching.values()) {
    const startKey = `${tile.x},${tile.y}`;
    if (visited.has(startKey)) continue;
    const component = [];
    const queue = [tile];
    visited.add(startKey);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      component.push(current);
      for (const direction of CARDINAL_DIRECTIONS) {
        const key = `${current.x + direction.dx},${current.y + direction.dy}`;
        const neighbor = matching.get(key);
        if (!neighbor || visited.has(key)) continue;
        visited.add(key);
        queue.push(neighbor);
      }
    }
    result.push(component);
  }
  return result;
}

function drawImageCover(ctx, asset, x, y, width, height) {
  const sourceWidth = finite(asset?.naturalWidth || asset?.width, 0);
  const sourceHeight = finite(asset?.naturalHeight || asset?.height, 0);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    ctx.drawImage(asset, x, y, width, height);
    return;
  }
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = width / height;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;
  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / targetRatio;
    sy = (sourceHeight - sh) / 2;
  }
  ctx.drawImage(asset, sx, sy, sw, sh, x, y, width, height);
}

function drawConnectedWaterTexture(
  ctx,
  component,
  projection,
  assetStore,
  assetKey = TERRAIN_ASSET_KEYS['deep-water'],
  alpha = 0.34,
) {
  if (!component.length) return false;
  const { project, pixelsPerCell: cell } = projection;
  const xs = component.map((tile) => tile.x);
  const ys = component.map((tile) => tile.y);
  const topLeft = project(Math.min(...xs), Math.min(...ys));
  const bottomRight = project(Math.max(...xs) + 1, Math.max(...ys) + 1);
  const padding = cell * 0.08;
  const left = Math.min(topLeft.x, bottomRight.x) - padding;
  const top = Math.min(topLeft.y, bottomRight.y) - padding;
  const width = Math.abs(bottomRight.x - topLeft.x) + padding * 2;
  const height = Math.abs(bottomRight.y - topLeft.y) + padding * 2;
  const componentKeys = new Set(component.map((tile) => `${tile.x},${tile.y}`));
  const visualVariant = normalizedVisualVariant(component[0]);
  const mirror = visualVariant % 2 === 1 ? -1 : 1;
  const variantScale = VISUAL_VARIANT_SCALE[visualVariant];

  return useTerrainAsset(ctx, assetStore, assetKey, (asset) => {
    ctx.beginPath();
    for (const tile of component) {
      const center = project(tile.x + 0.5, tile.y + 0.5);
      appendEllipseSubpath(ctx, center.x, center.y, cell * 0.5, cell * 0.48);
      for (const direction of CARDINAL_DIRECTIONS) {
        if (direction.name !== 'right' && direction.name !== 'bottom') continue;
        if (!componentKeys.has(`${tile.x + direction.dx},${tile.y + direction.dy}`)) continue;
        const neighbor = project(tile.x + direction.dx + 0.5, tile.y + direction.dy + 0.5);
        appendConnectorSubpath(ctx, center, neighbor, cell);
      }
    }
    ctx.clip?.();
    ctx.globalAlpha *= clamp(finite(alpha, 0.34), 0, 0.75);
    ctx.translate(left + width / 2, top + height / 2);
    ctx.scale(mirror * variantScale, variantScale);
    drawImageCover(ctx, asset, -width / 2, -height / 2, width, height);
  });
}

function drawCrystalResource(ctx, tile, center, cell, time) {
  const seed = Math.floor(hash2d(tile.x, tile.y, 29) * 10000);
  const pulse = 1 + Math.sin(time * 2.25 + seed) * 0.025;
  const scale = cell * pulse;
  paintShadow(ctx, center.x, center.y + scale * 0.29, scale * 0.46, scale * 0.13);
  const shards = [
    { ox: -0.2, oy: 0.08, width: 0.23, height: 0.48, color: '#8a57f2' },
    { ox: 0.02, oy: -0.03, width: 0.27, height: 0.66, color: '#26c5f5' },
    { ox: 0.25, oy: 0.09, width: 0.2, height: 0.43, color: '#bf63ff' },
  ];
  for (const shard of shards) {
    const x = center.x + shard.ox * scale;
    const y = center.y + shard.oy * scale;
    const w = shard.width * scale;
    const h = shard.height * scale;
    polygon(ctx, [
      { x, y: y - h * 0.62 },
      { x: x + w * 0.54, y: y - h * 0.06 },
      { x: x + w * 0.38, y: y + h * 0.38 },
      { x: x - w * 0.42, y: y + h * 0.38 },
      { x: x - w * 0.55, y: y - h * 0.05 },
    ]);
    ctx.fillStyle = shard.color;
    ctx.fill();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = Math.max(1.2, cell * 0.045);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - w * 0.2, y - h * 0.04);
    ctx.lineTo(x, y - h * 0.47);
    ctx.lineTo(x + w * 0.14, y - h * 0.1);
    ctx.strokeStyle = COLORS.shine;
    ctx.lineWidth = Math.max(1, cell * 0.025);
    ctx.stroke();
  }
}

function drawTreeResource(ctx, tile, center, cell, time) {
  const seed = Math.floor(hash2d(tile.x, tile.y, 31) * 10000);
  const sway = Math.sin(time * 0.9 + seed) * cell * 0.025;
  paintShadow(ctx, center.x, center.y + cell * 0.36, cell * 0.48, cell * 0.14);
  ctx.strokeStyle = '#744728';
  ctx.lineWidth = Math.max(3, cell * 0.16);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(center.x, center.y + cell * 0.34);
  ctx.quadraticCurveTo(center.x - sway * 0.2, center.y + cell * 0.05, center.x + sway, center.y - cell * 0.18);
  ctx.stroke();
  const canopy = [
    { x: -0.28, y: -0.25, r: 0.34, color: '#3fbf58' },
    { x: 0.08, y: -0.34, r: 0.39, color: '#66d957' },
    { x: 0.34, y: -0.2, r: 0.3, color: '#31aa59' },
    { x: 0.02, y: -0.05, r: 0.42, color: '#54ca52' },
  ];
  for (let index = 0; index < canopy.length; index += 1) {
    const blob = canopy[index];
    paintBlob(ctx, center.x + blob.x * cell + sway, center.y + blob.y * cell,
      blob.r * cell, seed + index, blob.color, COLORS.ink, Math.max(1.2, cell * 0.035), 0.82);
  }
  ellipsePath(ctx, center.x - cell * 0.15 + sway, center.y - cell * 0.37, cell * 0.13, cell * 0.065);
  ctx.fillStyle = COLORS.shine;
  ctx.fill();
}

function drawGelResource(ctx, tile, center, cell, time) {
  const seed = Math.floor(hash2d(tile.x, tile.y, 37) * 10000);
  const bob = Math.sin(time * 1.8 + seed) * cell * 0.025;
  paintShadow(ctx, center.x, center.y + cell * 0.31, cell * 0.42, cell * 0.12);
  paintBlob(ctx, center.x, center.y + bob, cell * 0.46, seed, '#34d9d2', COLORS.ink,
    Math.max(1.3, cell * 0.045), 0.72);
  paintBlob(ctx, center.x + cell * 0.27, center.y + cell * 0.1 + bob, cell * 0.2, seed + 2,
    '#5ce9a3', COLORS.ink, Math.max(1, cell * 0.03), 0.8);
  ellipsePath(ctx, center.x - cell * 0.14, center.y - cell * 0.18 + bob, cell * 0.14, cell * 0.07);
  ctx.fillStyle = COLORS.shine;
  ctx.fill();
}

function drawPlantResource(ctx, tile, center, cell, time) {
  const seed = Math.floor(hash2d(tile.x, tile.y, 41) * 10000);
  const sway = Math.sin(time * 1.2 + seed) * cell * 0.035;
  paintShadow(ctx, center.x, center.y + cell * 0.29, cell * 0.38, cell * 0.11);
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = Math.max(1.5, cell * 0.045);
  ctx.beginPath();
  ctx.moveTo(center.x, center.y + cell * 0.28);
  ctx.quadraticCurveTo(center.x, center.y, center.x + sway, center.y - cell * 0.27);
  ctx.stroke();
  for (const [index, direction] of [-1, 1].entries()) {
    const x = center.x + direction * cell * 0.19 + sway * 0.6;
    const y = center.y - cell * (0.03 + index * 0.13);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(direction * (0.42 + sway / cell));
    ellipsePath(ctx, 0, 0, cell * 0.27, cell * 0.13);
    ctx.fillStyle = direction < 0 ? '#8de64c' : '#47ca4f';
    ctx.fill();
    ctx.strokeStyle = COLORS.ink;
    ctx.lineWidth = Math.max(1, cell * 0.03);
    ctx.stroke();
    ctx.restore();
  }
}

function drawResource(ctx, tile, center, cell, time) {
  if (variantIncludes(tile, /crystal|gem|ore/)) drawCrystalResource(ctx, tile, center, cell, time);
  else if (variantIncludes(tile, /wood|timber|tree/)) drawTreeResource(ctx, tile, center, cell, time);
  else if (variantIncludes(tile, /herb|leaf|seed|plant|dew|honey|flower|nectar/)) drawPlantResource(ctx, tile, center, cell, time);
  else drawGelResource(ctx, tile, center, cell, time);
}

function drawBushObstacle(ctx, tile, center, cell, time) {
  const seed = Math.floor(hash2d(tile.x, tile.y, 43) * 10000);
  const sway = Math.sin(time * 1.05 + seed) * cell * 0.015;
  paintShadow(ctx, center.x, center.y + cell * 0.3, cell * 0.45, cell * 0.12);
  const blobs = [
    [-0.29, 0.02, 0.31, '#329e55'],
    [-0.04, -0.13, 0.38, '#48bd51'],
    [0.29, 0.01, 0.32, '#2e9a5d'],
    [0.05, 0.12, 0.34, '#60c94f'],
  ];
  blobs.forEach(([ox, oy, radius, color], index) => {
    paintBlob(ctx, center.x + ox * cell + sway, center.y + oy * cell, radius * cell,
      seed + index, color, COLORS.ink, Math.max(1.2, cell * 0.035), 0.78);
  });
  if (variantIncludes(tile, /thorn|bramble/)) {
    ctx.fillStyle = '#f3d15e';
    for (let index = 0; index < 4; index += 1) {
      const angle = index * 1.6 + seed;
      const x = center.x + Math.cos(angle) * cell * 0.3;
      const y = center.y + Math.sin(angle) * cell * 0.19;
      polygon(ctx, [
        { x, y: y - cell * 0.1 },
        { x: x + cell * 0.05, y: y + cell * 0.035 },
        { x: x - cell * 0.05, y: y + cell * 0.035 },
      ]);
      ctx.fill();
    }
  }
}

function drawStumpObstacle(ctx, tile, center, cell) {
  paintShadow(ctx, center.x, center.y + cell * 0.3, cell * 0.43, cell * 0.13);
  paintBlob(ctx, center.x, center.y + cell * 0.07, cell * 0.43, tile.x * 31 + tile.y,
    '#9a6036', COLORS.ink, Math.max(1.3, cell * 0.045), 0.72);
  ellipsePath(ctx, center.x, center.y - cell * 0.08, cell * 0.37, cell * 0.2);
  ctx.fillStyle = '#d99b53';
  ctx.fill();
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = Math.max(1.2, cell * 0.04);
  ctx.stroke();
  ellipsePath(ctx, center.x, center.y - cell * 0.08, cell * 0.2, cell * 0.09);
  ctx.strokeStyle = '#a96737';
  ctx.lineWidth = Math.max(1, cell * 0.025);
  ctx.stroke();
}

function drawObstacle(ctx, tile, center, cell, time) {
  if (variantIncludes(tile, /stump|ruin|post/)) drawStumpObstacle(ctx, tile, center, cell);
  else drawBushObstacle(ctx, tile, center, cell, time);
}

function drawBreakableRock(ctx, tile, center, cell, time) {
  const seed = Math.floor(hash2d(tile.x, tile.y, 47) * 10000);
  const wobble = Math.sin(time * 0.7 + seed) * cell * 0.005;
  paintShadow(ctx, center.x, center.y + cell * 0.29, cell * 0.48, cell * 0.14);
  const stones = [
    [-0.23, 0.1, 0.34, '#8aa3a1'],
    [0.08, -0.07, 0.43, '#9eb8af'],
    [0.34, 0.13, 0.27, '#6f9290'],
  ];
  stones.forEach(([ox, oy, radius, color], index) => {
    paintBlob(ctx, center.x + ox * cell + wobble, center.y + oy * cell, radius * cell,
      seed + index, color, COLORS.ink, Math.max(1.2, cell * 0.04), 0.72);
  });
  ctx.strokeStyle = '#dcebc9';
  ctx.lineWidth = Math.max(1, cell * 0.025);
  ctx.beginPath();
  ctx.moveTo(center.x - cell * 0.02, center.y - cell * 0.34);
  ctx.lineTo(center.x - cell * 0.13, center.y - cell * 0.18);
  ctx.lineTo(center.x + cell * 0.02, center.y - cell * 0.13);
  ctx.stroke();
}

function drawBreakableLog(ctx, tile, center, cell) {
  const angle = (hash2d(tile.x, tile.y, 61) - 0.5) * 0.28;
  paintShadow(ctx, center.x, center.y + cell * 0.27, cell * 0.58, cell * 0.13);
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(angle);
  paintBlob(ctx, 0, 0, cell * 0.56, tile.x * 19 + tile.y, '#a86332', COLORS.ink,
    Math.max(1.3, cell * 0.045), 0.35);
  ellipsePath(ctx, cell * 0.43, 0, cell * 0.18, cell * 0.25);
  ctx.fillStyle = '#dda052';
  ctx.fill();
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = Math.max(1.2, cell * 0.035);
  ctx.stroke();
  ellipsePath(ctx, cell * 0.43, 0, cell * 0.09, cell * 0.13);
  ctx.strokeStyle = '#a86332';
  ctx.stroke();
  ctx.restore();
}

function drawDestructible(ctx, tile, center, cell, time) {
  if (variantIncludes(tile, /log|wood|timber/)) drawBreakableLog(ctx, tile, center, cell);
  else if (variantIncludes(tile, /bramble|thorn|vine/)) drawBushObstacle(ctx, tile, center, cell, time);
  else drawBreakableRock(ctx, tile, center, cell, time);
}

function drawPermanentRock(ctx, tile, center, cell) {
  const seed = Math.floor(hash2d(tile.x, tile.y, 67) * 10000);
  const size = clamp(finite(tile.scale || tile.size, 1.2), 0.9, 1.75);
  paintShadow(ctx, center.x, center.y + cell * 0.34, cell * 0.66 * size, cell * 0.17 * size);
  paintBlob(ctx, center.x, center.y - cell * 0.02, cell * 0.62 * size, seed,
    '#687d82', COLORS.ink, Math.max(1.5, cell * 0.055), 0.72);
  paintBlob(ctx, center.x - cell * 0.16 * size, center.y - cell * 0.18 * size, cell * 0.36 * size,
    seed + 1, '#8fa2a1', null, 0, 0.6);
  ctx.strokeStyle = '#c2d5c5';
  ctx.lineWidth = Math.max(1.2, cell * 0.03);
  ctx.beginPath();
  ctx.moveTo(center.x - cell * 0.34, center.y - cell * 0.18);
  ctx.quadraticCurveTo(center.x - cell * 0.09, center.y - cell * 0.42, center.x + cell * 0.18, center.y - cell * 0.3);
  ctx.stroke();
}

function drawPermanentTerrain(ctx, tile, center, cell, time) {
  if (variantIncludes(tile, /tree|ancient/)) drawTreeResource(ctx, tile, center, cell * 1.15, time);
  else drawPermanentRock(ctx, tile, center, cell);
}

/**
 * Paints a single continuous grass field plus sparse organic ground detail.
 * No per-tile outlines are emitted; the logical grid therefore remains invisible.
 */
export function drawOrganicGround(ctx, options = {}) {
  if (!ctx) throw new TypeError('drawOrganicGround requires a Canvas 2D context');
  const bounds = normalizeBounds(options);
  const { project, pixelsPerCell: cell } = createProjector(options);
  const world = normalizeWorldSize(options.world);
  const time = animationTime(options.time);
  const topLeft = project(bounds.minX, bounds.minY);
  const bottomRight = project(bounds.maxX + 1, bounds.maxY + 1);
  const width = bottomRight.x - topLeft.x;
  const height = bottomRight.y - topLeft.y;

  ctx.save();
  let groundTextureTiles = 0;
  const authoredGround = useTerrainAsset(
    ctx,
    options.assetStore,
    TERRAIN_LAYER_ASSET_KEYS.ground,
    (asset) => {
      const texture = drawWorldAnchoredTerrainTexture(ctx, asset, {
        ...options,
        visibleBounds: bounds,
        periodCells: WORLD_GROUND_TEXTURE_PERIOD_CELLS,
      });
      groundTextureTiles = texture.tiles;
    },
    () => {
      ctx.fillStyle = options.groundColor || COLORS.grass;
      ctx.fillRect(topLeft.x, topLeft.y, width, height);

      ctx.globalAlpha = 0.2;
      ctx.fillStyle = COLORS.grassLight;
      ctx.beginPath();
      ctx.moveTo(topLeft.x, topLeft.y + height * 0.18);
      ctx.bezierCurveTo(topLeft.x + width * 0.26, topLeft.y - height * 0.03,
        topLeft.x + width * 0.54, topLeft.y + height * 0.37,
        bottomRight.x, topLeft.y + height * 0.16);
      ctx.lineTo(bottomRight.x, topLeft.y + height * 0.42);
      ctx.bezierCurveTo(topLeft.x + width * 0.64, topLeft.y + height * 0.58,
        topLeft.x + width * 0.3, topLeft.y + height * 0.28,
        topLeft.x, topLeft.y + height * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    },
  );

  // A connected translucent wash makes the biome read as one soft, irregular
  // frontier instead of a row of recoloured square tiles. It remains useful
  // even while the optional wasteland PNGs are still loading or unavailable.
  let wastelandCells = 0;
  ctx.globalAlpha = 0.58;
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (!isWastelandCell(x, y, world)) continue;
      const center = project(x + 0.5, y + 0.5);
      const neighbors = Object.fromEntries(CARDINAL_DIRECTIONS.map((direction) => [
        direction.name,
        isWastelandCell(x + direction.dx, y + direction.dy, world),
      ]));
      fillOrganicCell(
        ctx,
        center.x,
        center.y,
        cell,
        neighbors,
        { fill: COLORS.wasteGround },
        Math.floor(hash2d(x, y, 937) * 100000),
      );
      wastelandCells += 1;
    }
  }
  ctx.globalAlpha = 1;

  let details = 0;
  let assetDetails = 0;
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      // Low-density and coordinate-seeded: camera motion or reloads cannot
      // reshuffle the decorative marks, and the hidden grid never reads as a
      // repeated one-sprite-per-cell checkerboard.
      if (hash2d(x, y, 71) > 0.22) continue;
      const jitterX = (hash2d(x, y, 73) - 0.5) * cell * 0.72;
      const jitterY = (hash2d(x, y, 79) - 0.5) * cell * 0.66;
      const center = project(x + 0.5, y + 0.5);
      const detailX = center.x + jitterX;
      const detailY = center.y + jitterY;
      const wasteland = isWastelandCell(x, y, world);
      const usedAsset = drawTerrainAsset(ctx, options.assetStore, {
        terrainId: 'ground',
        x,
        y,
        visualVariant: Math.floor(hash2d(x, y, 89) * VISUAL_VARIANT_SCALE.length),
      }, {
        x: detailX,
        y: detailY + cell * TERRAIN_ASSET_PROFILES.ground.groundOffset,
        cellSize: cell,
        world,
        alpha: 0.74,
        fallback: () => drawGroundDetail(
          ctx,
          detailX,
          detailY,
          cell,
          x * 97 + y * 53,
          time,
          wasteland,
        ),
      });
      if (usedAsset) assetDetails += 1;
      details += 1;
    }
  }
  ctx.restore();
  return {
    cells: (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1),
    wastelandCells,
    details,
    assetDetails,
    authoredGround,
    groundTextureTiles,
  };
}

function discoveryPredicate(options) {
  if (typeof options.isUndiscovered === 'function') {
    return (x, y) => options.isUndiscovered(x, y) === true;
  }
  if (typeof options.discoveryAt === 'function') {
    return (x, y) => {
      const discovery = options.discoveryAt(x, y);
      return typeof discovery === 'boolean'
        ? discovery === false
        : discovery?.discovered === false;
    };
  }
  if (typeof options.terrainAt === 'function') {
    return (x, y) => options.terrainAt(x, y)?.discovered === false;
  }
  return () => false;
}

function drawSafeDiscoveryFog(ctx, cells, project, cell) {
  for (const { x, y } of cells) {
    const corner = project(x, y);
    ctx.fillStyle = 'rgba(52, 92, 83, 0.50)';
    ctx.fillRect(corner.x, corner.y, cell + 1, cell + 1);
    ctx.fillStyle = 'rgba(218, 244, 211, 0.10)';
    ellipsePath(
      ctx,
      corner.x + cell * 0.34,
      corner.y + cell * 0.38,
      cell * 0.15,
      cell * 0.15,
    );
    ctx.fill();
  }
}

/**
 * Draws discovery fog as deterministic, overlapping authored cutouts. The
 * square fill is deliberately fallback-only so a ready PNG never reveals the
 * underlying logical grid. `isUndiscovered(x, y)` is the preferred predicate;
 * `discoveryAt` and a cell-returning `terrainAt` are accepted for adapters.
 */
export function drawAuthoredDiscoveryFog(ctx, options = {}) {
  if (!ctx) throw new TypeError('drawAuthoredDiscoveryFog requires a Canvas 2D context');
  const bounds = normalizeBounds(options);
  const { project, pixelsPerCell: cell } = createProjector(options);
  const isUndiscovered = discoveryPredicate(options);
  const cells = [];
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (isUndiscovered(x, y)) cells.push({ x, y });
    }
  }
  if (!cells.length) {
    return {
      cells: 0,
      assetCells: 0,
      fallbackCells: 0,
      usedAsset: false,
    };
  }

  let assetCells = 0;
  let fallbackCells = 0;
  const fogWidth = cell * Math.max(1.01, finite(options.fogWidthCells, 1.6));
  const fogHeight = cell * Math.max(1.01, finite(options.fogHeightCells, 1.2));
  const fogAlpha = clamp(finite(options.fogAlpha, 0.9), 0, 1);
  const usedAsset = useTerrainAsset(
    ctx,
    options.assetStore,
    TERRAIN_LAYER_ASSET_KEYS.fog,
    (asset) => {
      ctx.globalAlpha *= fogAlpha;
      for (const { x, y } of cells) {
        const center = project(x + 0.5, y + 0.5);
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.scale(isOddInteger(x + y) ? -1 : 1, 1);
        ctx.drawImage(asset, -fogWidth / 2, -fogHeight / 2, fogWidth, fogHeight);
        ctx.restore();
        assetCells += 1;
      }
    },
    () => {
      drawSafeDiscoveryFog(ctx, cells, project, cell);
      fallbackCells = cells.length;
    },
  );

  return {
    cells: cells.length,
    assetCells,
    fallbackCells,
    usedAsset,
  };
}

/**
 * Paints connected water/cliffs first, then y-sorted resource and obstacle props.
 * Every prop is larger than, overlaps, or visually escapes its logical cell.
 */
export function drawOrganicTerrainProps(ctx, options = {}) {
  if (!ctx) throw new TypeError('drawOrganicTerrainProps requires a Canvas 2D context');
  const bounds = normalizeBounds(options);
  const lookup = createTerrainLookup(options);
  const projection = createProjector(options);
  const world = normalizeWorldSize(options.world);
  const time = animationTime(options.time);
  const stats = {
    resource: 0,
    obstacle: 0,
    destructible: 0,
    indestructible: 0,
    water: 0,
    cliff: 0,
    boundarySegments: 0,
    assetDraws: 0,
    waterTextureComponents: 0,
    wastelandAssetDraws: 0,
    shadowAssetDraws: 0,
    shadowFallbackDraws: 0,
  };
  const tiles = [];
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) tiles.push(lookup(x, y));
  }

  ctx.save();
  const waterSurfaces = [];
  for (const tile of tiles) {
    if (isWater(tile)) {
      stats.water += 1;
      stats.indestructible += 1;
      const neighbors = connectedNeighbors(tile, lookup, isWater);
      const wasteland = isWastelandCell(tile.x, tile.y, world);
      const palette = wasteland
        ? {
          fill: COLORS.wasteWater,
          light: COLORS.wasteWaterLight,
          ink: COLORS.wasteWaterInk,
        }
        : {
          fill: COLORS.water,
          light: COLORS.waterLight,
          ink: COLORS.waterInk,
        };
      drawConnectedSurfaceFill(ctx, tile, projection, neighbors, palette);
      waterSurfaces.push({ tile, neighbors, palette });
    }
  }
  const waterTiles = tiles.filter(isWater);
  for (const wasteland of [false, true]) {
    const regionTiles = waterTiles.filter((tile) => (
      isWastelandCell(tile.x, tile.y, world) === wasteland
    ));
    for (const component of connectedComponents(regionTiles, () => true)) {
      const assetKey = terrainAssetKeyForCell(component[0], { world });
      const usedAsset = drawConnectedWaterTexture(
        ctx,
        component,
        projection,
        options.assetStore,
        assetKey,
        options.waterTextureAlpha,
      );
      if (usedAsset) {
        stats.assetDraws += 1;
        stats.waterTextureComponents += 1;
        if (wasteland) stats.wastelandAssetDraws += 1;
      }
    }
  }
  for (const { tile, neighbors, palette } of waterSurfaces) {
    stats.boundarySegments += drawConnectedSurfaceOutline(
      ctx,
      tile,
      projection,
      neighbors,
      isWater,
      palette,
      time,
    );
  }
  for (const tile of tiles) {
    if (isCliff(tile)) {
      stats.cliff += 1;
      stats.indestructible += 1;
      stats.boundarySegments += drawConnectedSurface(ctx, tile, projection, lookup, isCliff, {
        fill: COLORS.cliff,
        light: COLORS.cliffLight,
        ink: COLORS.cliffInk,
      }, time);
    }
  }

  const props = tiles
    .filter((tile) => tile.kind !== 'ground' && !isWater(tile) && !isCliff(tile))
    .sort((left, right) => (left.y - right.y) || (left.x - right.x));
  const authoredPropShadows = props.flatMap((tile) => {
    const terrainId = canonicalTerrainId(tile);
    const profile = TERRAIN_ASSET_PROFILES[terrainId];
    if (!profile?.shadowWidth || !profile?.shadowHeight
      || !getReadyAsset(options.assetStore, terrainAssetKeyForCell(tile))) return [];
    return [{
      center: projection.project(tile.x + 0.5, tile.y + 0.5),
      profile,
    }];
  });
  if (authoredPropShadows.length) {
    const usedShadowAsset = useTerrainAsset(
      ctx,
      options.assetStore,
      TERRAIN_LAYER_ASSET_KEYS.shadow,
      (asset) => {
        ctx.globalAlpha *= clamp(finite(options.propShadowAlpha, 1), 0, 1);
        for (const { center, profile } of authoredPropShadows) {
          const width = projection.pixelsPerCell * profile.shadowWidth;
          const height = projection.pixelsPerCell * profile.shadowHeight;
          const y = center.y + projection.pixelsPerCell * profile.shadowOffset;
          ctx.drawImage(asset, center.x - width / 2, y - height / 2, width, height);
        }
      },
      () => {
        for (const { center, profile } of authoredPropShadows) {
          paintShadow(
            ctx,
            center.x,
            center.y + projection.pixelsPerCell * profile.shadowOffset,
            projection.pixelsPerCell * profile.shadowWidth / 2,
            projection.pixelsPerCell * profile.shadowHeight / 2,
          );
        }
      },
    );
    if (usedShadowAsset) stats.shadowAssetDraws = authoredPropShadows.length;
    else stats.shadowFallbackDraws = authoredPropShadows.length;
  }
  for (const tile of props) {
    const center = projection.project(tile.x + 0.5, tile.y + 0.5);
    const terrainId = canonicalTerrainId(tile);
    const profile = TERRAIN_ASSET_PROFILES[terrainId];
    const drawFallback = () => {
      if (tile.kind === 'resource') {
        drawResource(ctx, tile, center, projection.pixelsPerCell, time);
      } else if (tile.kind === 'obstacle') {
        drawObstacle(ctx, tile, center, projection.pixelsPerCell, time);
      } else if (tile.kind === 'destructible') {
        drawDestructible(ctx, tile, center, projection.pixelsPerCell, time);
      } else if (tile.kind === 'indestructible') {
        drawPermanentTerrain(ctx, tile, center, projection.pixelsPerCell, time);
      }
    };
    const usedAsset = profile && terrainId !== 'deep-water'
      ? drawTerrainAsset(ctx, options.assetStore, tile, {
        x: center.x,
        y: center.y + projection.pixelsPerCell * profile.groundOffset,
        cellSize: projection.pixelsPerCell,
        world,
        fallback: drawFallback,
      })
      : (drawFallback(), false);
    if (usedAsset) {
      stats.assetDraws += 1;
      if (isWastelandCell(tile.x, tile.y, world)) stats.wastelandAssetDraws += 1;
    }
    if (tile.kind === 'resource') {
      stats.resource += 1;
    } else if (tile.kind === 'obstacle') {
      stats.obstacle += 1;
    } else if (tile.kind === 'destructible') {
      stats.destructible += 1;
    } else if (tile.kind === 'indestructible') {
      stats.indestructible += 1;
    }
  }
  ctx.restore();
  return stats;
}

/** Paints the complete organic terrain layer in its correct order. */
export function terrainRenderLayer(ctx, options = {}) {
  const ground = drawOrganicGround(ctx, options);
  const props = drawOrganicTerrainProps(ctx, options);
  return { ground, props };
}

export const ORGANIC_TERRAIN_COLORS = COLORS;
