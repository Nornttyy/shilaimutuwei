import {
  SURVIVORS,
  SKILLS,
  ITEMS,
  BUILDINGS,
  ENEMY_BY_ID,
  WAVES,
} from './catalog.js';
import {
  PALETTE,
  roundedRectPath,
  drawRoundedRect,
  drawSlime,
  drawMonster,
  drawBuilding,
  drawCore,
  drawPortal,
  drawStatusIcon,
  drawProjectile,
  drawAssetOrFallback,
} from './draw.js';
import {
  createGridState,
  canPlaceBuilding as coreCanPlaceBuilding,
  findGridPath,
  findRightToLeftRoute,
  normalizeRotation,
} from './core.js';
import { AnimationController } from './animation/controller.js';
import { ExpressionMixer } from './animation/expression-mixer.js';
import { characterPortraitCrop } from './character-render-profiles.js';
import {
  BOSS_CLIPS,
  BUBBLE_CLIPS,
  BUG_CLIPS,
  CRYSTAL_CLIPS,
  SHELL_CLIPS,
  SPROUT_CLIPS,
  STONE_CLIPS,
  WINDCAP_CLIPS,
} from './animation/clips.js';
import {
  DEFAULT_WORLD_VIEWPORT,
  createWorldCamera,
  panWorldCamera,
  pointInsideWorldViewport,
  screenToWorldCell,
  visibleWorldBounds,
  worldToScreen,
  zoomWorldCameraAt,
} from './world.js';
import {
  createInfiniteWorld,
  restoreInfiniteWorld,
} from './infinite-world.js';
import {
  INITIAL_WORLD_TERRAIN,
  BUILDING_RECIPE_BY_ID,
  SLIME_JOBS,
  TERRAIN_TYPES,
  THREAT_CURVE,
  WORLD as COLONY_WORLD,
  terrainAllowsPlacement,
  terrainAt as catalogTerrainAt,
} from './colony-catalog.js';
import {
  drawAuthoredDiscoveryFog,
  drawOrganicGround,
  drawOrganicTerrainProps,
  drawTerrainAsset,
  regionAssetKeyForZone,
  worldPoiAssetKeys,
} from './terrain-renderer.js';
import {
  addBlueprint,
  addResourceNode,
  cancelColonySlimeWork,
  createColonyState,
  downColonySlime,
  setColonyThreatIntensity,
  setColonyThreats,
  setTerrainAt,
  updateColony,
} from './colony.js';
import {
  EXPEDITION_CATALOG,
  EXPEDITION_ENCOUNTER_BY_ID,
  EXPEDITION_PARTY_RULES,
  EXPEDITION_ROUTE_NODE_TYPE_BY_ID,
  EXPEDITION_UPGRADE_BY_ID,
  FIRST_EXPEDITION,
} from './expedition-catalog.js';
import {
  abandonExpedition,
  chooseExpeditionBoon,
  chooseExpeditionRoute,
  claimExpeditionRewards,
  createExpeditionState,
  resolveExpeditionBattle,
  restoreExpeditionState,
  selectExpeditionSquad,
  startExpedition as startExpeditionRun,
} from './expedition.js';

const VIEW = Object.freeze({ width: 1280, height: 720 });
// Match the original high-fidelity renderer: retain up to two physical pixels
// per CSS pixel on every viewport instead of shrinking large canvases to meet
// a pixel budget. Performance work must remove redundant work, not resolution.
const MAX_CANVAS_DPR = 2;
// The authored 24x16 garden remains the starter clearing, while all cells
// beyond it are generated lazily in deterministic chunks.
const WORLD = Object.freeze({ ...COLONY_WORLD, infinite: true });
// The HUD is authored in the fixed VIEW coordinate system, while the world
// viewport expands beyond it on non-16:9 screens so terrain reaches every
// physical edge without stretching character art.
const BOARD = {
  ...DEFAULT_WORLD_VIEWPORT,
  x: 0,
  y: 0,
  width: VIEW.width,
  height: VIEW.height,
  cell: DEFAULT_WORLD_VIEWPORT.cellSize,
  cols: WORLD.width,
  rows: WORLD.height,
};
const CORE_CELL = WORLD.base.core;
const DEFAULT_CAMERA_FOCUS = Object.freeze({ x: CORE_CELL.x + 0.5, y: CORE_CELL.y + 0.5 });
const PANEL = Object.freeze({ x: 866, y: 92, width: 388, height: 486 });
const BOTTOM = Object.freeze({ x: 22, y: 592, width: 1232, height: 110 });
// Every generated building PNG is a complete one-cell module, including its
// own purpose-built base and contact shadow.
const BUILDING_WORLD_SLOT = BOARD.cell;
export const AUTOTILE_FRAME_SIZE = 128;
export const AUTOTILE_MASK_BITS = Object.freeze({
  north: 1,
  east: 2,
  south: 4,
  west: 8,
});
const AUTOTILE_DIRECTIONS = Object.freeze([
  Object.freeze({ dx: 0, dy: -1, bit: AUTOTILE_MASK_BITS.north }),
  Object.freeze({ dx: 1, dy: 0, bit: AUTOTILE_MASK_BITS.east }),
  Object.freeze({ dx: 0, dy: 1, bit: AUTOTILE_MASK_BITS.south }),
  Object.freeze({ dx: -1, dy: 0, bit: AUTOTILE_MASK_BITS.west }),
]);
const AUTOTILE_FRAME_RECTS = Object.freeze(Array.from({ length: 16 }, (_, mask) => (
  Object.freeze({
    x: (mask & 3) * AUTOTILE_FRAME_SIZE,
    y: (mask >> 2) * AUTOTILE_FRAME_SIZE,
    width: AUTOTILE_FRAME_SIZE,
    height: AUTOTILE_FRAME_SIZE,
  })
)));
const BUILDING_AUTOTILE_PROFILE_BY_CARD_ID = Object.freeze({
  'building-honey-plot': Object.freeze({
    group: 'honey-plot',
    assetKey: 'building-honey-plot-autotile-v3',
  }),
  'building-bouncy-fence': Object.freeze({
    group: 'bouncy-fence',
    assetKey: 'building-bouncy-fence-autotile-v3',
  }),
});
const GEL_PAVING_AUTOTILE_ASSET_KEY = 'terrain-gel-paving-autotile-v1';
const GEL_PAVING_MAX_CHUNK_SIZE = 16;
const GEL_PAVING_MAX_SURFACE_EDGE = 768;
const GEL_PAVING_CACHE_BYTE_LIMIT = 24 * 1024 * 1024;
const RGBA_BYTES_PER_PIXEL = 4;
const GEL_PAVING_CELL_RESOLUTION_QUANTUM = 8;
const STORAGE_KEY = 'slime-haven-colony-v2';
const TAU = Math.PI * 2;
const COLONY_RESOURCE_ID = Object.freeze({
  'soft-gel': 'gel',
  'dew-honey': 'nectar',
  'crystal-shard': 'shard',
});
const COLONY_RESOURCE_LABEL = Object.freeze({
  gel: '软胶',
  nectar: '露蜜',
  shard: '晶屑',
});
const RESOURCE_ASSET_BY_ID = Object.freeze({
  gel: 'resource-soft-gel-token',
  'soft-gel': 'resource-soft-gel-token',
  nectar: 'resource-dew-honey-token',
  'dew-honey': 'resource-dew-honey-token',
  shard: 'resource-crystal-shard-token',
  'crystal-shard': 'resource-crystal-shard-token',
  softCrystals: 'ui-soft-crystal',
});
const RESOURCE_COLOR_BY_ID = Object.freeze({
  gel: '#3C9E79',
  'soft-gel': '#3C9E79',
  nectar: '#C58B2E',
  'dew-honey': '#C58B2E',
  shard: '#597EC9',
  'crystal-shard': '#597EC9',
  softCrystals: '#75B6C3',
});
const COLONY_AI_LABEL = Object.freeze({
  idle: '待命', seek: '找工作', move: '赶路', harvest: '采集', carry: '搬运',
  deposit: '入库', build: '施工', rally: '集结', chase: '迎战', attack: '战斗',
  rest: '休养', downed: '倒地',
});
const TERRAIN_HELP = Object.freeze({
  'soft-gel': ['可采集', '史莱姆会自动采集软胶；采完后变成可建造草地。', '◉'],
  'dew-honey': ['可采集', '露蜜花丛会产出露蜜；采完后变成可建造草地。', '✿'],
  'crystal-shard': ['可采集', '晶屑脉产出晶屑，亮钉采集这种资源更快。', '◆'],
  'thorn-thicket': ['纯障碍', '密刺丛不能采集、不能破坏，只用于长期改变路线。', '♣'],
  'brittle-boulder': ['可破坏', '工作史莱姆会自动敲碎脆壳岩，清理后开放土地。', '⬟'],
  'deep-water': ['永久地形', '深水不能建造也不能破坏，会永久分割寻路区域。', '≈'],
});

const EXPEDITION_REWARD_LABEL = Object.freeze({
  'soft-gel': '软胶',
  'dew-honey': '露蜜',
  'crystal-shard': '晶屑',
  softCrystals: '软晶',
});

const EXPEDITION_ROUTE_ASSET_BY_NODE_TYPE = Object.freeze({
  'route-swarm-battle': 'expedition-route-combat',
  'route-resource-forage': 'expedition-route-resource',
  'route-slime-event': 'expedition-route-event',
});

const EXPEDITION_UPGRADE_DESCRIPTION = Object.freeze({
  'upgrade-soft-body': '全队生命上限提高，并立即回复一部分生命。',
  'upgrade-jelly-rush': '全队攻击间隔缩短，出手更加密集。',
  'upgrade-shared-sparkle': '全队造成的攻击伤害提高。',
  'upgrade-shell-rebound': '壳壳护盾更厚，破盾时反击附近敌人。',
  'upgrade-crystal-fork': '亮钉每次射击额外分出一枚晶针。',
  'upgrade-bubble-chain': '泡泡命中后继续弹向附近多个目标。',
  'upgrade-sprout-canopy': '芽芽治疗增强，并把部分治疗扩散给队友。',
  'upgrade-gel-burst': '敌人倒下时引爆软胶，伤害周围虫群。',
  'upgrade-last-bounce': '全队各抵挡一次致命伤并回复生命。',
});

const EXPEDITION_KIND_LABEL = Object.freeze({
  battle: '虫群遭遇',
  elite: '精英遭遇',
  boss: '首领巢穴',
});

function flattenExpeditionRewards(reward = {}) {
  const flattened = {
    ...(reward?.resources && typeof reward.resources === 'object' ? reward.resources : {}),
  };
  for (const [resourceId, amount] of Object.entries(reward || {})) {
    if (resourceId === 'resources' || !Number.isFinite(Number(amount))) continue;
    flattened[resourceId] = (flattened[resourceId] || 0) + Number(amount);
  }
  return flattened;
}

const ENEMY_DEATH_DURATION_BY_ID = Object.freeze({
  'enemy-soft-biter': 0.4,
  'enemy-windcap': 0.38,
  'enemy-stone-lump': 0.42,
  'enemy-acid-shell-king': 0.68,
});

const DYNAMIC_EFFECT_DURATION = Object.freeze({
  impact: 0.3,
  push: 0.46,
  'enemy-pop': 0.58,
  'building-destruction': 0.58,
  'shield-break': 0.56,
  heal: 0.72,
  spawn: 0.56,
  trail: 0.68,
  swap: 0.72,
  place: 0.5,
  'wave-clear': 0.95,
});

const DYNAMIC_EFFECT_ATLAS_KEY = 'effect-dynamic-components-v1';
const DYNAMIC_EFFECT_ATLAS_GRID = 4;
const DYNAMIC_EFFECT_COMPONENT_GENERAL_BUDGET = 48;
const DYNAMIC_EFFECT_COMPONENT_ABILITY_RESERVE = 4;
const DYNAMIC_EFFECT_COMPONENT_WAVE_RESERVE = 12;
const DYNAMIC_EFFECT_COMPONENT_PRIORITY = Object.freeze({
  impact: 0,
  spawn: 1,
  push: 1,
  'enemy-pop': 1,
  'building-destruction': 1,
  'shield-break': 2,
  place: 2,
  heal: 2,
  trail: 2,
  swap: 2,
  'wave-clear': 3,
});
const DYNAMIC_EFFECT_COMPONENTS = Object.freeze({
  'impact-core': Object.freeze({ column: 0, row: 0 }),
  'impact-streak': Object.freeze({ column: 1, row: 0 }),
  'shock-ring': Object.freeze({ column: 2, row: 0 }),
  'gel-drop': Object.freeze({ column: 3, row: 0 }),
  bubble: Object.freeze({ column: 0, row: 1 }),
  leaf: Object.freeze({ column: 1, row: 1 }),
  'heal-spark': Object.freeze({ column: 2, row: 1 }),
  'rift-shard': Object.freeze({ column: 3, row: 1 }),
  honey: Object.freeze({ column: 0, row: 2 }),
  'swap-mint': Object.freeze({ column: 1, row: 2 }),
  'swap-violet': Object.freeze({ column: 2, row: 2 }),
  dust: Object.freeze({ column: 3, row: 2 }),
  ribbon: Object.freeze({ column: 0, row: 3 }),
  confetti: Object.freeze({ column: 1, row: 3 }),
  sparkle: Object.freeze({ column: 2, row: 3 }),
  'place-splash': Object.freeze({ column: 3, row: 3 }),
});

const AUTHORED_DYNAMIC_EFFECT_ASSET_BY_KIND = Object.freeze({
  push: 'effect-jelly-bounce-wave',
  heal: 'effect-heal-burst',
  spawn: 'effect-spawn-rift-burst',
  trail: 'effect-honey-draw-trail',
  swap: 'effect-soft-swap-arc',
  'building-destruction': 'effect-building-destruction-puff',
  'shield-break': 'effect-shield-break-v1',
});

const ANIMATION_CLIPS_BY_CARD_ID = Object.freeze({
  'survivor-shell-shell': SHELL_CLIPS,
  'survivor-crystal-pin': CRYSTAL_CLIPS,
  'survivor-bubble-float': BUBBLE_CLIPS,
  'survivor-moss-sprout': SPROUT_CLIPS,
  'enemy-soft-biter': BUG_CLIPS,
  'enemy-windcap': WINDCAP_CLIPS,
  'enemy-stone-lump': STONE_CLIPS,
  'enemy-acid-shell-king': BOSS_CLIPS,
});

const BUILDING_BY_ID = Object.freeze(Object.fromEntries(BUILDINGS.map((card) => [card.id, card])));
const SURVIVOR_BY_ID = Object.freeze(Object.fromEntries(SURVIVORS.map((card) => [card.id, card])));
const SKILL_BY_ID = Object.freeze(Object.fromEntries(SKILLS.map((card) => [card.id, card])));
const ITEM_BY_ID = Object.freeze(Object.fromEntries(ITEMS.map((card) => [card.id, card])));

const SURVIVOR_VARIANT = Object.freeze({
  'survivor-shell-shell': 'shell',
  'survivor-crystal-pin': 'needle',
  'survivor-bubble-float': 'bubble',
  'survivor-moss-sprout': 'sprout',
});

const ENEMY_VARIANT = Object.freeze({
  'enemy-soft-biter': 'bug',
  'enemy-windcap': 'mushroom',
  'enemy-stone-lump': 'stone',
  'enemy-acid-shell-king': 'boss',
});

const BUILDING_VARIANT = Object.freeze({
  'building-mushroom-home': 'hut',
  'building-honey-plot': 'farm',
  'building-bubble-tower': 'tower',
  'building-bouncy-fence': 'fence',
  'building-weather-scout': 'weather',
  'building-gel-foundation': 'paver',
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * ((t - 1) ** 3) + c1 * ((t - 1) ** 2);
};
const easeOutCubic = (t) => 1 - ((1 - clamp(t, 0, 1)) ** 3);
const effectPhase = (progress, start, end) => clamp((progress - start) / Math.max(0.001, end - start), 0, 1);
const effectNoise = (seed, index = 0) => {
  const value = Math.sin((seed + index * 91.731) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};
const cellKey = (x, y) => `${x},${y}`;

export function cardinalAutotileMask(x, y, hasConnectedCell) {
  if (typeof hasConnectedCell !== 'function') {
    throw new TypeError('cardinalAutotileMask requires a neighbor predicate');
  }
  let mask = 0;
  for (const { dx, dy, bit } of AUTOTILE_DIRECTIONS) {
    if (hasConnectedCell(x + dx, y + dy)) mask |= bit;
  }
  return mask;
}

export function autotileFrameRect(mask) {
  const normalizedMask = Math.max(0, Math.min(15, Math.floor(Number(mask) || 0)));
  return AUTOTILE_FRAME_RECTS[normalizedMask];
}

function createGelPavingChunkSurface(ctx, pixelSize) {
  let canvas = null;
  try {
    if (typeof globalThis.OffscreenCanvas === 'function') {
      canvas = new globalThis.OffscreenCanvas(pixelSize, pixelSize);
    } else {
      const documentRef = ctx?.canvas?.ownerDocument ?? globalThis.document;
      if (typeof documentRef?.createElement === 'function') {
        canvas = documentRef.createElement('canvas');
        canvas.width = pixelSize;
        canvas.height = pixelSize;
      }
    }
  } catch {
    return null;
  }
  let surfaceCtx = null;
  try {
    surfaceCtx = canvas?.getContext?.('2d');
  } catch {
    return null;
  }
  if (!surfaceCtx
    || typeof surfaceCtx.clearRect !== 'function'
    || typeof surfaceCtx.drawImage !== 'function') return null;
  return { canvas, ctx: surfaceCtx, pixelSize };
}

function resizeGelPavingChunkSurface(surface, pixelSize) {
  if (!surface?.canvas) return null;
  if (surface.pixelSize === pixelSize) return surface;
  try {
    surface.canvas.width = pixelSize;
    surface.canvas.height = pixelSize;
    const surfaceCtx = surface.canvas.getContext?.('2d') || surface.ctx;
    if (!surfaceCtx
      || typeof surfaceCtx.clearRect !== 'function'
      || typeof surfaceCtx.drawImage !== 'function') return null;
    surface.ctx = surfaceCtx;
    surface.pixelSize = pixelSize;
    return surface;
  } catch {
    return null;
  }
}

function normalizeSavedCellKey(entry) {
  if (typeof entry === 'string') {
    const match = /^(-?\d+),(-?\d+)$/.exec(entry);
    if (!match) return null;
    const x = Number(match[1]);
    const y = Number(match[2]);
    return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? cellKey(x, y) : null;
  }
  const x = Array.isArray(entry) ? Number(entry[0]) : Number(entry?.x);
  const y = Array.isArray(entry) ? Number(entry[1]) : Number(entry?.y);
  return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? cellKey(x, y) : null;
}

function sortedSavedCells(keys) {
  return [...keys]
    .map((key) => {
      const match = /^(-?\d+),(-?\d+)$/.exec(key);
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.y - right.y || left.x - right.x);
}
const inBoard = (x, y) => WORLD.infinite
  ? Number.isSafeInteger(x) && Number.isSafeInteger(y)
  : x >= 0 && x < BOARD.cols && y >= 0 && y < BOARD.rows;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const uid = (() => {
  let value = 1;
  return (prefix) => `${prefix}-${value++}`;
})();

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const chars = [...text];
  let line = '';
  let lineIndex = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const test = line + chars[index];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + lineIndex * lineHeight);
      lineIndex += 1;
      line = chars[index];
      if (lineIndex >= maxLines - 1) {
        const rest = chars.slice(index + 1).join('');
        let last = line + rest;
        while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) last = last.slice(0, -1);
        ctx.fillText(`${last}…`, x, y + lineIndex * lineHeight);
        return lineIndex + 1;
      }
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y + lineIndex * lineHeight);
  return lineIndex + 1;
}

function imageDimensions(image, fallbackWidth = 1, fallbackHeight = 1) {
  const width = Number(image?.naturalWidth || image?.videoWidth || image?.width) || fallbackWidth;
  const height = Number(image?.naturalHeight || image?.videoHeight || image?.height) || fallbackHeight;
  return { width, height };
}

function drawImageContained(
  ctx,
  image,
  x,
  y,
  width,
  height,
  anchorY = 0.5,
  sourceRect = null,
) {
  const dimensions = imageDimensions(image);
  const source = sourceRect ?? { x: 0, y: 0, ...dimensions };
  const scale = Math.min(width / source.width, height / source.height);
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) * clamp(anchorY, 0, 1);
  if (sourceRect) {
    ctx.drawImage(
      image,
      source.x,
      source.y,
      source.width,
      source.height,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
    );
  } else {
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  }
}

function drawCharacterImageContained(ctx, image, ownerId, x, y, width, height, anchorY = 1) {
  const dimensions = imageDimensions(image);
  drawImageContained(
    ctx,
    image,
    x,
    y,
    width,
    height,
    anchorY,
    characterPortraitCrop(ownerId, dimensions.width, dimensions.height),
  );
}

function drawNineSlice(ctx, image, x, y, width, height) {
  const source = imageDimensions(image, 512, 384);
  const sourceLeft = Math.round(source.width * 0.28);
  const sourceRight = Math.round(source.width * 0.12);
  const sourceTop = Math.round(source.height * 0.24);
  const sourceBottom = Math.round(source.height * 0.24);
  const targetLeft = Math.min(54, Math.max(24, width * 0.38));
  const targetRight = Math.min(18, width * 0.16);
  const targetTop = Math.min(20, height * 0.28);
  const targetBottom = Math.min(20, height * 0.28);
  const sourceColumns = [0, sourceLeft, source.width - sourceRight, source.width];
  const sourceRows = [0, sourceTop, source.height - sourceBottom, source.height];
  const targetColumns = [x, x + targetLeft, x + width - targetRight, x + width];
  const targetRows = [y, y + targetTop, y + height - targetBottom, y + height];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const sourceWidth = sourceColumns[column + 1] - sourceColumns[column];
      const sourceHeight = sourceRows[row + 1] - sourceRows[row];
      const targetWidth = targetColumns[column + 1] - targetColumns[column];
      const targetHeight = targetRows[row + 1] - targetRows[row];
      if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) continue;
      ctx.drawImage(
        image,
        sourceColumns[column],
        sourceRows[row],
        sourceWidth,
        sourceHeight,
        targetColumns[column],
        targetRows[row],
        targetWidth,
        targetHeight,
      );
    }
  }
}

function roundedHit(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

function buildingSupportsRotation(card) {
  return Boolean(card?.footprint && card.footprint.width !== card.footprint.height);
}

function canonicalBuildingRotation(rotation = 0, card = null) {
  if (card && !buildingSupportsRotation(card)) return 0;
  try {
    return (normalizeRotation(Number(rotation) || 0) % 2) * 90;
  } catch {
    return 0;
  }
}

function nextBuildingRotation(card, rotation = 0) {
  if (!buildingSupportsRotation(card)) return 0;
  return (canonicalBuildingRotation(rotation, card) + 90) % 180;
}

function rotatedFootprint(card, rotation = 0) {
  const turns = canonicalBuildingRotation(rotation, card) / 90;
  return turns % 2
    ? { width: card.footprint.height, height: card.footprint.width }
    : { width: card.footprint.width, height: card.footprint.height };
}

function footprintCells(card, x, y, rotation = 0) {
  const shape = rotatedFootprint(card, rotation);
  const cells = [];
  for (let dy = 0; dy < shape.height; dy += 1) {
    for (let dx = 0; dx < shape.width; dx += 1) cells.push({ x: x + dx, y: y + dy });
  }
  return cells;
}

function cloneWorldTerrain(source = INITIAL_WORLD_TERRAIN) {
  return {
    seed: source.seed,
    width: source.width,
    height: source.height,
    cells: source.cells.map((cell) => ({
      ...cell,
      yield: cell.yield ? { ...cell.yield } : null,
      placement: { ...cell.placement },
      path: { ...cell.path },
    })),
  };
}

function worldTerrainFromIds(terrainIds) {
  const terrain = cloneWorldTerrain();
  if (!Array.isArray(terrainIds) || terrainIds.length !== terrain.cells.length) return terrain;
  terrain.cells = terrain.cells.map((cell, index) => {
    const terrainId = terrainIds[index];
    const definition = TERRAIN_TYPES[terrainId];
    if (!definition) return cell;
    return {
      ...cell,
      terrainId,
      passable: definition.passable,
      buildable: definition.buildable,
      harvestable: definition.harvestable,
      destructible: definition.destructible,
      yield: definition.yield ? { ...definition.yield } : null,
      replacement: definition.replacement,
      placement: { buildable: definition.buildable },
      path: { passable: definition.passable },
    };
  });
  return terrain;
}

function replaceWorldTerrainCell(terrain, x, y, terrainId = 'ground') {
  const cell = catalogTerrainAt(terrain, x, y);
  const definition = TERRAIN_TYPES[terrainId];
  if (!cell || !definition) return false;
  const index = y * terrain.width + x;
  terrain.cells[index] = {
    ...cell,
    terrainId,
    passable: definition.passable,
    buildable: definition.buildable,
    harvestable: definition.harvestable,
    destructible: definition.destructible,
    yield: definition.yield ? { ...definition.yield } : null,
    replacement: definition.replacement,
    placement: { buildable: definition.buildable },
    path: { passable: definition.passable },
  };
  return true;
}

function colonyTerrainFromWorldCell(cell) {
  if (!cell) return { kind: 'indestructible', passable: false, buildable: false };
  if (cell.discovered === false) {
    return {
      kind: 'indestructible',
      terrainId: cell.terrainId,
      passable: false,
      buildable: false,
      unexplored: true,
    };
  }
  const definition = TERRAIN_TYPES[cell.terrainId] || TERRAIN_TYPES.ground;
  const kind = definition.kind === 'destructible-obstacle'
    ? 'destructible'
    : definition.kind === 'indestructible-terrain'
      ? 'indestructible'
      : definition.kind;
  return {
    kind,
    terrainId: cell.terrainId,
    passable: definition.passable,
    buildable: definition.buildable,
    harvestable: definition.harvestable,
    destructible: definition.destructible,
    durability: definition.destructible ? 3.2 : undefined,
    yield: definition.yield
      ? {
        resourceType: COLONY_RESOURCE_ID[definition.yield.resourceId] || null,
        amount: Math.max(0, Number(definition.yield.amount) || 0),
      }
      : null,
  };
}

function colonyRecipeResources(recipe = {}) {
  return {
    gel: Math.max(0, Number(recipe['soft-gel']) || 0),
    nectar: Math.max(0, Number(recipe['dew-honey']) || 0),
    shard: Math.max(0, Number(recipe['crystal-shard']) || 0),
  };
}

function buildingMaterialRecipe(cardId) {
  return colonyRecipeResources(BUILDING_RECIPE_BY_ID[cardId]?.recipe);
}

function formatBuildingMaterials(cardId, { compact = false } = {}) {
  const recipe = buildingMaterialRecipe(cardId);
  const labels = compact
    ? { gel: '胶', nectar: '蜜', shard: '晶' }
    : COLONY_RESOURCE_LABEL;
  return Object.entries(recipe)
    .filter(([, amount]) => amount > 0)
    .map(([resourceType, amount]) => `${labels[resourceType]}${amount}`)
    .join(compact ? ' ' : '　');
}

function missingBuildingMaterials(cardId, resources = {}, delivered = {}) {
  return Object.fromEntries(Object.entries(buildingMaterialRecipe(cardId))
    .map(([resourceType, amount]) => [
      resourceType,
      Math.max(
        0,
        amount
          - (Number(delivered[resourceType]) || 0)
          - (Number(resources[resourceType]) || 0),
      ),
    ])
    .filter(([, amount]) => amount > 0));
}

function terrainNavigationEntries(terrain, dynamicCatalog) {
  if (!terrain?.cells) return [];
  return terrain.cells
    .filter((cell) => !cell.passable)
    .map((cell) => {
      const id = `terrain-${cell.x}-${cell.y}`;
      dynamicCatalog[id] = {
        id,
        footprint: { width: 1, height: 1 },
        solid: true,
        passable: false,
        // Monsters route around wilderness. Destructible props are cleared by
        // worker slimes, while water and permanent obstacles can never be breached.
        breachCost: Infinity,
      };
      return { id, catalogId: id, x: cell.x, y: cell.y, rotation: 0 };
    });
}

function terrainCellFromSource(terrain, x, y) {
  if (typeof terrain?.getCell === 'function') return terrain.getCell(x, y);
  return catalogTerrainAt(terrain, x, y);
}

function terrainCellIsBuildable(terrain, x, y) {
  const cell = terrainCellFromSource(terrain, x, y);
  if (!cell || cell.discovered === false) return false;
  if (typeof cell.buildable === 'boolean') return cell.buildable;
  return terrainAllowsPlacement(terrain, x, y);
}

function terrainCellIsPassable(terrain, x, y) {
  const cell = terrainCellFromSource(terrain, x, y);
  if (!cell || cell.discovered === false) return false;
  if (typeof cell.passable === 'boolean') return cell.passable;
  return Boolean(TERRAIN_TYPES[cell.terrainId]?.passable);
}

function terrainCellAllowsProject(terrain, x, y, project = {}) {
  const cell = terrainCellFromSource(terrain, x, y);
  if (!cell || cell.discovered === false || cell.poiReserved || !cell.passable) return false;
  if (cell.buildable) return project.allowBuildableGround !== false;
  if (cell.harvestable) return project.allowHarvestableTerrain === true;
  return project.allowPassableTerrain === true;
}

function buildingAt(buildings, x, y, exceptUid = null) {
  return buildings.find((building) => {
    if (building.uid === exceptUid || building.destroyed) return false;
    const card = BUILDING_BY_ID[building.cardId];
    return footprintCells(card, building.x, building.y, building.rotation).some((cell) => cell.x === x && cell.y === y);
  }) || null;
}

function buildingIsOperational(building) {
  return Boolean(building && !building.destroyed && !building.underConstruction);
}

function operationalBuildingAt(buildings, x, y, exceptUid = null) {
  return buildingAt(buildings.filter(buildingIsOperational), x, y, exceptUid);
}

function canPlace(
  buildings,
  card,
  x,
  y,
  rotation = 0,
  exceptUid = null,
  terrain = INITIAL_WORLD_TERRAIN,
) {
  const cells = footprintCells(card, x, y, rotation);
  const terrainIsEligible = card.terrainProject
    ? (cell) => terrainCellAllowsProject(terrain, cell.x, cell.y, card.terrainProject)
    : (cell) => terrainCellIsBuildable(terrain, cell.x, cell.y);
  if (!cells.every((cell) => inBoard(cell.x, cell.y) && terrainIsEligible(cell))) return false;
  if (cells.some((cell) => cell.x === CORE_CELL.x && cell.y === CORE_CELL.y)) return false;
  if (terrain?.infinite || typeof terrain?.getCell === 'function') {
    return !cells.some((cell) => buildingAt(buildings, cell.x, cell.y, exceptUid));
  }
  const active = buildings
    .filter((building) => !building.destroyed && building.uid !== exceptUid)
    .map((building) => ({
      id: building.uid,
      cardId: building.cardId,
      x: building.x,
      y: building.y,
      rotation: building.rotation,
    }));
  const grid = createGridState({ width: WORLD.width, height: WORLD.height, buildings: active });
  return coreCanPlaceBuilding(grid, {
    id: exceptUid || '__placement-preview__',
    cardId: card.id,
    x,
    y,
    rotation,
  }, BUILDING_BY_ID);
}

function heapPush(heap, entry) {
  heap.push(entry);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].score <= entry.score) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = entry;
}

function heapPop(heap) {
  if (!heap.length) return null;
  const first = heap[0];
  const last = heap.pop();
  if (!heap.length) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= heap.length) break;
    const child = right < heap.length && heap[right].score < heap[left].score ? right : left;
    if (heap[child].score >= last.score) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return first;
}

function infiniteRouteFor(
  buildings,
  start,
  target,
  terrain,
  { allowBuildingBreaching = true } = {},
) {
  const origin = { x: Math.round(start.x), y: Math.round(start.y) };
  const goal = { x: Math.round(target.x), y: Math.round(target.y) };
  if (origin.x === goal.x && origin.y === goal.y) return [origin];
  const span = Math.abs(goal.x - origin.x) + Math.abs(goal.y - origin.y);
  const margin = Math.min(32, Math.max(8, Math.ceil(Math.sqrt(span + 1) * 2)));
  const minX = Math.min(origin.x, goal.x) - margin;
  const maxX = Math.max(origin.x, goal.x) + margin;
  const minY = Math.min(origin.y, goal.y) - margin;
  const maxY = Math.max(origin.y, goal.y) + margin;
  const open = [];
  const originKey = cellKey(origin.x, origin.y);
  const costs = new Map([[originKey, 0]]);
  const cameFrom = new Map([[originKey, null]]);
  heapPush(open, { ...origin, score: span });
  const directions = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let visits = 0;

  while (open.length && visits < 24000) {
    const current = heapPop(open);
    const currentKey = cellKey(current.x, current.y);
    const currentCost = costs.get(currentKey);
    if (!Number.isFinite(currentCost)) continue;
    visits += 1;
    if (current.x === goal.x && current.y === goal.y) break;
    for (const [dx, dy] of directions) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (next.x < minX || next.x > maxX || next.y < minY || next.y > maxY) continue;
      const isGoal = next.x === goal.x && next.y === goal.y;
      const blockingBuilding = buildingAt(buildings, next.x, next.y);
      const blockingCard = blockingBuilding && BUILDING_BY_ID[blockingBuilding.cardId];
      const buildingBlocks = Boolean(blockingCard?.solid);
      if ((!terrainCellIsPassable(terrain, next.x, next.y) && !isGoal)
        || (buildingBlocks && !allowBuildingBreaching && !isGoal)) continue;
      const stepCost = buildingBlocks
        ? 5 + Math.max(1, blockingBuilding.hp || blockingCard.hp || 1) / 80
        : 1;
      const nextCost = currentCost + stepCost;
      const nextKey = cellKey(next.x, next.y);
      if (nextCost >= (costs.get(nextKey) ?? Infinity)) continue;
      costs.set(nextKey, nextCost);
      cameFrom.set(nextKey, current);
      const heuristic = Math.abs(goal.x - next.x) + Math.abs(goal.y - next.y);
      heapPush(open, { ...next, score: nextCost + heuristic });
    }
  }

  const goalKey = cellKey(goal.x, goal.y);
  if (!cameFrom.has(goalKey)) return [origin];
  const path = [];
  let cursor = goal;
  while (cursor) {
    path.push(cursor);
    cursor = cameFrom.get(cellKey(cursor.x, cursor.y));
  }
  path.reverse();
  return path;
}

function routeFor(
  buildings,
  start,
  target = null,
  terrain = INITIAL_WORLD_TERRAIN,
  { allowBuildingBreaching = true } = {},
) {
  const active = buildings.filter(buildingIsOperational);
  const routeTarget = target || CORE_CELL;
  if (terrain?.infinite || typeof terrain?.getCell === 'function') {
    return infiniteRouteFor(active, start, routeTarget, terrain, { allowBuildingBreaching });
  }
  const dynamicCatalog = {};
  const gridBuildings = active.map((building) => {
    const card = BUILDING_BY_ID[building.cardId];
    dynamicCatalog[building.uid] = {
      ...card,
      hp: Math.max(1, building.hp || card.hp),
      breachCost: card.solid ? Math.max(1, building.hp || card.hp) : 0,
    };
    return {
      id: building.uid,
      catalogId: building.uid,
      x: building.x,
      y: building.y,
      rotation: building.rotation,
    };
  });
  gridBuildings.push(...terrainNavigationEntries(terrain, dynamicCatalog));
  const grid = createGridState({
    width: WORLD.width,
    height: WORLD.height,
    buildings: gridBuildings,
  });
  let route;
  if (routeTarget) {
    const pathOptions = { starts: [start], goals: [routeTarget] };
    route = findGridPath(grid, dynamicCatalog, { ...pathOptions, allowBreaching: false })
      || (allowBuildingBreaching
        ? findGridPath(grid, dynamicCatalog, { ...pathOptions, allowBreaching: true })
        : null);
  } else {
    route = findRightToLeftRoute(grid, dynamicCatalog, { start, allowBreach: true });
  }
  const cells = route?.cells || [start];
  return cells;
}

class TinyAudio {
  constructor() {
    this.context = null;
    this.enabled = true;
  }

  unlock() {
    if (!this.enabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === 'suspended') this.context.resume();
  }

  play(kind = 'tap') {
    if (!this.enabled) return;
    this.unlock();
    if (!this.context) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const presets = {
      tap: [420, 520, 0.045, 'sine'],
      place: [270, 390, 0.12, 'triangle'],
      shoot: [560, 350, 0.07, 'sine'],
      bubble: [480, 760, 0.11, 'sine'],
      heal: [430, 680, 0.2, 'sine'],
      hit: [130, 90, 0.055, 'square'],
      warning: [230, 170, 0.2, 'sawtooth'],
      win: [390, 780, 0.45, 'triangle'],
    };
    const [from, to, duration, type] = presets[kind] || presets.tap;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, to), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}

export class SlimeGame {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.assetStore = null;
    this.requestedWorldAssetKeys = new Set();
    this.gelPavingChunkCache = new Map();
    this.gelPavingChunkSurfacePool = [];
    this.gelPavingChunkSurfaceAvailable = null;
    this.gelPavingCacheConfiguration = null;
    this.gelPavingCacheSet = null;
    this.gelPavingCacheSize = -1;
    this.rigAssetStore = null;
    this.generatedCharacterArtEnabled = options?.generatedCharacterArtEnabled !== false;
    this.setRigAssetStore(
      typeof options?.get === 'function' ? options : options?.rigAssetStore,
    );
    this.setAssetStore(options?.assetStore);
    this.audio = new TinyAudio();
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.dpr = 1;
    this.lastTime = 0;
    this.time = 0;
    this.animationTime = 0;
    this.hits = [];
    this.hoverId = null;
    this.hoverCell = null;
    this.pointerDown = null;
    this.pointerDrag = null;
    this.pinchGesture = null;
    this.activePointers = new Map();
    this.visibleWorldPois = [];
    this.infiniteWorld = createInfiniteWorld({
      seed: INITIAL_WORLD_TERRAIN.seed,
      core: CORE_CELL,
      maxLoadedChunks: 81,
    });
    // The starter clearing is immediately known. New territory is revealed by
    // physical exploration rather than by moving the camera over it.
    this.infiniteWorld.reveal(CORE_CELL.x, CORE_CELL.y, 18);
    this.runtimeTerrain = Object.freeze({
      infinite: true,
      getCell: (x, y) => this.placementWorldCellAt(x, y),
    });
    this.camera = createWorldCamera({
      world: WORLD,
      viewport: BOARD,
      focus: DEFAULT_CAMERA_FOCUS,
      zoom: 1,
    });
    this.buildTab = 'buildings';
    this.selection = null;
    this.modal = null;
    this.toast = null;
    this.shake = 0;
    this.preBattleSnapshot = null;
    this.animators = new Map();
    this.expressionMixers = new Map();
    this.pendingAttackHits = new Map();
    this.resetDynamicComponentBudget();
    this.state = this.createState();
    this.load();
    this.initializeColonySimulation();
    this.recoverInterruptedExpedition();
    this.bindEvents();
    this.resize();
  }

  setRigAssetStore(store = null) {
    this.rigAssetStore = store && typeof store.get === 'function' ? store : null;
    return this;
  }

  setAssetStore(store = null) {
    this.assetStore = store
      && typeof store.get === 'function'
      && typeof store.useOrFallback === 'function'
      ? store
      : null;
    this.requestedWorldAssetKeys?.clear();
    this.invalidateGelPavingRenderCache();
    return this;
  }

  releaseGelPavingChunkEntry(entry) {
    const configuration = this.gelPavingCacheConfiguration;
    if (!entry?.surface
      || !configuration
      || entry.surface.pixelSize !== configuration.surfacePixels
      || this.gelPavingChunkSurfacePool.length >= configuration.maxSurfaces) return;
    this.gelPavingChunkSurfacePool.push(entry.surface);
  }

  invalidateGelPavingRenderCache() {
    if (this.gelPavingChunkCache) {
      for (const entry of this.gelPavingChunkCache.values()) {
        this.releaseGelPavingChunkEntry(entry);
      }
      this.gelPavingChunkCache.clear();
    }
    const paved = this.state?.gelPavingCells;
    this.gelPavingCacheSet = paved instanceof Set ? paved : null;
    this.gelPavingCacheSize = paved instanceof Set ? paved.size : -1;
  }

  syncGelPavingRenderCache(paved) {
    if (paved === this.gelPavingCacheSet && paved.size === this.gelPavingCacheSize) return;
    this.invalidateGelPavingRenderCache();
    this.gelPavingCacheSet = paved;
    this.gelPavingCacheSize = paved.size;
  }

  gelPavingPhysicalScale(ctx) {
    const fallback = Math.max(0.01, Number(this.scale) || 1)
      * Math.max(0.01, Number(this.dpr) || 1);
    try {
      const transform = ctx?.getTransform?.();
      const scaleX = Math.hypot(Number(transform?.a) || 0, Number(transform?.b) || 0);
      const scaleY = Math.hypot(Number(transform?.c) || 0, Number(transform?.d) || 0);
      const measured = Math.max(scaleX, scaleY);
      return Number.isFinite(measured) && measured > 0 ? measured : fallback;
    } catch {
      return fallback;
    }
  }

  gelPavingRenderConfiguration(ctx) {
    const requiredPhysicalCellPixels = Math.max(
      1,
      Math.ceil(this.worldPixelsPerCell() * this.gelPavingPhysicalScale(ctx) - 1e-6),
    );
    // Above this point a one-cell surface alone would exceed the texture
    // budget. The direct atlas path remains lossless and avoids allocation.
    if (requiredPhysicalCellPixels > GEL_PAVING_MAX_SURFACE_EDGE) {
      const retainedSurfaces = [
        ...[...this.gelPavingChunkCache.values()]
          .map((entry) => entry.surface)
          .filter(Boolean),
        ...this.gelPavingChunkSurfacePool,
      ];
      for (const surface of retainedSurfaces) {
        try {
          surface.canvas.width = 1;
          surface.canvas.height = 1;
        } catch {
          // Dropping the last reference still lets the runtime reclaim it.
        }
      }
      this.gelPavingChunkCache.clear();
      this.gelPavingChunkSurfacePool.length = 0;
      this.gelPavingCacheConfiguration = null;
      return null;
    }
    // Round upward only: the cached raster never has fewer pixels than its
    // final destination, while 8px buckets avoid reallocating on every tiny
    // pinch-zoom delta.
    const physicalCellPixels = Math.min(
      GEL_PAVING_MAX_SURFACE_EDGE,
      Math.ceil(requiredPhysicalCellPixels / GEL_PAVING_CELL_RESOLUTION_QUANTUM)
        * GEL_PAVING_CELL_RESOLUTION_QUANTUM,
    );
    const chunkSize = Math.max(
      1,
      Math.min(
        GEL_PAVING_MAX_CHUNK_SIZE,
        Math.floor(GEL_PAVING_MAX_SURFACE_EDGE / physicalCellPixels),
      ),
    );
    const surfacePixels = physicalCellPixels * chunkSize;
    const surfaceBytes = surfacePixels * surfacePixels * RGBA_BYTES_PER_PIXEL;
    const maxSurfaces = Math.max(1, Math.floor(GEL_PAVING_CACHE_BYTE_LIMIT / surfaceBytes));
    const key = `${physicalCellPixels}:${chunkSize}:${surfacePixels}`;
    if (this.gelPavingCacheConfiguration?.key === key) {
      return this.gelPavingCacheConfiguration;
    }
    const nextConfiguration = {
      key,
      requiredPhysicalCellPixels,
      physicalCellPixels,
      chunkSize,
      surfacePixels,
      surfaceBytes,
      maxSurfaces,
    };
    // Preserve a bounded pool of canvas objects across zoom buckets. Each is
    // resized lazily before reuse, avoiding a wave of new backing-store
    // allocations while a pinch gesture crosses a resolution threshold.
    const previousSurfaces = [
      ...[...this.gelPavingChunkCache.values()]
        .map((entry) => entry.surface)
        .filter(Boolean),
      ...this.gelPavingChunkSurfacePool,
    ];
    const reusableSurfaces = [];
    let retainedBytes = 0;
    for (const surface of previousSurfaces) {
      const transitionBytes = Math.max(
        surface.pixelSize * surface.pixelSize * RGBA_BYTES_PER_PIXEL,
        surfaceBytes,
      );
      if (reusableSurfaces.length >= maxSurfaces
        || retainedBytes + transitionBytes > GEL_PAVING_CACHE_BYTE_LIMIT) continue;
      reusableSurfaces.push(surface);
      retainedBytes += transitionBytes;
    }
    this.gelPavingChunkCache.clear();
    this.gelPavingChunkSurfacePool.length = 0;
    this.gelPavingChunkSurfacePool.push(...reusableSurfaces);
    this.gelPavingCacheConfiguration = nextConfiguration;
    return this.gelPavingCacheConfiguration;
  }

  requestWorldAssetKeys(keys = []) {
    if (!this.assetStore || typeof this.assetStore.preload !== 'function') return;
    const pending = [...new Set(keys)].filter((key) => (
      typeof key === 'string'
      && key.length > 0
      && !this.requestedWorldAssetKeys.has(key)
    ));
    if (!pending.length) return;
    pending.forEach((key) => this.requestedWorldAssetKeys.add(key));
    void this.assetStore.preload({ keys: pending }).catch(() => {
      pending.forEach((key) => this.requestedWorldAssetKeys.delete(key));
    });
  }

  setGeneratedCharacterArtEnabled(enabled = true) {
    this.generatedCharacterArtEnabled = enabled !== false;
    return this;
  }

  isStarterCell(x, y) {
    return Number.isSafeInteger(x) && Number.isSafeInteger(y)
      && x >= 0 && y >= 0
      && x < this.state.worldTerrain.width && y < this.state.worldTerrain.height;
  }

  worldCellAt(x, y) {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return null;
    const surfaceId = this.state?.gelPavingCells?.has(cellKey(x, y))
      ? 'gel-paving'
      : null;
    if (this.state?.worldTerrain && this.isStarterCell(x, y)) {
      const cell = catalogTerrainAt(this.state.worldTerrain, x, y);
      return cell ? {
        ...cell,
        discovered: true,
        modified: false,
        ...(surfaceId ? { surfaceId } : {}),
      } : null;
    }
    const cell = this.infiniteWorld.getCell(x, y);
    return surfaceId ? { ...cell, surfaceId } : cell;
  }

  placementWorldCellAt(x, y) {
    const cell = this.worldCellAt(x, y);
    if (!cell) return null;
    const reservedByGeneratedPoi = this.infiniteWorld.getPoisInBounds({
      minX: x,
      minY: y,
      maxXExclusive: x + 1,
      maxYExclusive: y + 1,
    }).some((poi) => poi.x === x && poi.y === y);
    const reservedByOutpost = (this.state.expeditionProgress?.outposts || [])
      .some((outpost) => outpost.x === x && outpost.y === y);
    return reservedByGeneratedPoi || reservedByOutpost
      ? { ...cell, buildable: false, poiReserved: true }
      : cell;
  }

  ensureColonyBounds(cells = []) {
    const colony = this.state.colony;
    if (!colony || !cells.length) return colony?.bounds || null;
    const minX = Math.min(colony.bounds.x, ...cells.map((cell) => Math.floor(cell.x)));
    const minY = Math.min(colony.bounds.y, ...cells.map((cell) => Math.floor(cell.y)));
    const maxX = Math.max(
      colony.bounds.x + colony.bounds.width - 1,
      ...cells.map((cell) => Math.floor(cell.x)),
    );
    const maxY = Math.max(
      colony.bounds.y + colony.bounds.height - 1,
      ...cells.map((cell) => Math.floor(cell.y)),
    );
    colony.bounds = {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
    return colony.bounds;
  }

  colonyDepotPositions() {
    return [
      { ...CORE_CELL },
      ...(this.state.expeditionProgress?.outposts || []).map(({ x, y }) => ({ x, y })),
    ];
  }

  syncColonyDepots() {
    const colony = this.state.colony;
    if (!colony) return [];
    const depots = this.colonyDepotPositions();
    this.ensureColonyBounds(depots);
    colony.depots = depots;
    return depots;
  }

  colonyWorkCells() {
    const cells = new Map();
    const add = (x, y) => {
      const cellX = Math.floor(Number(x));
      const cellY = Math.floor(Number(y));
      if (!Number.isSafeInteger(cellX) || !Number.isSafeInteger(cellY)) return;
      const key = cellKey(cellX, cellY);
      if (cells.has(key)) return;
      if (this.worldCellAt(cellX, cellY)?.discovered === false) return;
      cells.set(key, { x: cellX, y: cellY });
    };
    // Keep the authored clearing fully active, then inspect only small circles
    // around actual work locations in generated territory. This stays bounded
    // even when one blueprint is thousands of cells from the core.
    for (let y = 0; y < this.state.worldTerrain.height; y += 1) {
      for (let x = 0; x < this.state.worldTerrain.width; x += 1) add(x, y);
    }
    const colony = this.state.colony;
    const centers = [
      CORE_CELL,
      ...(colony?.slimes || []).filter((slime) => slime.aiState !== 'downed'),
      ...(colony?.blueprints || []).filter((blueprint) => (
        !blueprint.complete && !blueprint.cancelled
      )),
    ];
    for (const center of centers) {
      const originX = Math.round(center.x);
      const originY = Math.round(center.y);
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          if (dx * dx + dy * dy <= 16) add(originX + dx, originY + dy);
        }
      }
    }
    // Activated relays index their nearby breakable obstacles once. Exact
    // pending targets stay eligible without rescanning every historical relay
    // or expanding every resource node into another 9x9 neighborhood.
    for (const target of this.state.expeditionProgress?.activeClearTargets || []) {
      add(target.x, target.y);
    }
    return [...cells.values()];
  }

  indexOutpostClearTargets(outpost, radius = 4) {
    const x = Math.floor(Number(outpost?.x));
    const y = Math.floor(Number(outpost?.y));
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return 0;
    const boundedRadius = clamp(Math.floor(Number(radius) || 0), 1, 6);
    this.revealWorldAround(x, y, boundedRadius, { registerResources: false });
    const targets = this.state.expeditionProgress.activeClearTargets ||= [];
    const seen = new Set(targets.map((target) => cellKey(target.x, target.y)));
    const addedTargets = [];
    let added = 0;
    for (let dy = -boundedRadius; dy <= boundedRadius; dy += 1) {
      for (let dx = -boundedRadius; dx <= boundedRadius; dx += 1) {
        if (dx * dx + dy * dy > boundedRadius * boundedRadius) continue;
        const targetX = x + dx;
        const targetY = y + dy;
        const key = cellKey(targetX, targetY);
        if (seen.has(key) || !this.worldCellAt(targetX, targetY)?.destructible) continue;
        seen.add(key);
        const target = {
          x: targetX,
          y: targetY,
          outpostId: typeof outpost?.id === 'string' ? outpost.id : null,
        };
        targets.push(target);
        addedTargets.push(target);
        added += 1;
      }
    }
    if (addedTargets.length) this.ensureColonyBounds(addedTargets);
    return added;
  }

  registerDiscoveredResourceNodes(cells = [], { limit = Infinity } = {}) {
    const colony = this.state.colony;
    if (!colony) return 0;
    let added = 0;
    for (const point of cells) {
      if (added >= limit) break;
      const x = Math.floor(Number(point?.x));
      const y = Math.floor(Number(point?.y));
      if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || this.isStarterCell(x, y)) continue;
      const cell = this.worldCellAt(x, y);
      const resourceType = COLONY_RESOURCE_ID[cell?.yield?.resourceId];
      if (!cell?.discovered || !cell.harvestable || !resourceType) continue;
      const nodeUid = `infinite-resource-${x}-${y}`;
      if (colony.resourceNodes.some((node) => node.uid === nodeUid
        || (node.x === x && node.y === y && node.amount > 0))) continue;
      this.ensureColonyBounds([{ x, y }]);
      try {
        addResourceNode(colony, {
          uid: nodeUid,
          x,
          y,
          resourceType,
          amount: Math.max(1, Math.floor(Number(cell.yield.amount) || 1)),
          harvestSeconds: Math.max(0.05, Number(cell.yield.gatherSeconds) || 2.5),
        });
        added += 1;
      } catch {
        // Another simulation event may reserve or replace the cell between
        // discovery and registration; the next reveal pass can try again.
      }
    }
    return added;
  }

  revealWorldAround(x, y, radius = 2, { registerResources = true } = {}) {
    const centerX = Math.round(x);
    const centerY = Math.round(y);
    this.infiniteWorld.reveal(centerX, centerY, radius);
    const cells = [];
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius) continue;
        cells.push({ x: centerX + dx, y: centerY + dy });
      }
    }
    // Discovery expands the logical work envelope without making job scans
    // proportional to the huge rectangle; `jobCellProvider` still supplies
    // only the small active neighborhoods above.
    this.ensureColonyBounds(cells);
    if (registerResources) this.registerDiscoveredResourceNodes(cells);
  }

  rigAssetFor(cardId) {
    return this.rigAssetStore?.get(cardId, null) ?? null;
  }

  createState() {
    return {
      phase: 'build',
      paused: false,
      softCrystals: 160,
      coreHp: 1000,
      coreMaxHp: 1000,
      waveIndex: 0,
      waveElapsed: 0,
      spawned: new Set(),
      enemies: [],
      buildings: this.defaultBuildings(),
      survivors: this.defaultSurvivors(),
      worldTerrain: cloneWorldTerrain(),
      // Sparse, player-authored surface overlay. Keys use absolute world
      // coordinates so paving survives chunk eviction without changing the
      // terrain generator or the one-cell building occupancy rules.
      gelPavingCells: new Set(),
      colony: null,
      colonyDirector: {
        elapsed: 0,
        nextPackAt: Math.min(22, THREAT_CURVE.gracePeriodSeconds),
        packIndex: 0,
      },
      skills: Object.fromEntries(SKILLS.map((card) => [card.id, { readyAtAction: 0 }])),
      items: Object.fromEntries(ITEMS.map((card) => [card.id, { charges: card.charges }])),
      energy: 4,
      friendlyActions: 0,
      actionEnergyProgress: 0,
      terrain: [],
      deployables: [],
      projectiles: [],
      particles: [],
      worldEffects: [],
      dynamicEffects: [],
      floaters: [],
      kills: 0,
      rescuedBuildings: 0,
      rewardEarned: 0,
      result: null,
      expeditionRun: null,
      worldExpedition: null,
      expeditionProgress: {
        firstClear: false,
        completions: 0,
        attempts: 0,
        claimedRunIds: [],
        frontier: { ...CORE_CELL },
        outposts: [],
        activeClearTargets: [],
      },
      tutorialSeen: false,
    };
  }

  defaultBuildings() {
    const specs = [
      ['building-mushroom-home', 10, 8, 0],
      ['building-honey-plot', 13, 9, 0],
      ['building-bouncy-fence', 11, 6, 0],
    ];
    return specs.map(([cardId, x, y, rotation]) => {
      const card = BUILDING_BY_ID[cardId];
      return {
        uid: uid('building'), cardId, x, y, rotation,
        hp: card.hp, maxHp: card.hp, cooldown: 0, shotCount: 0,
        shield: 0, seed: 0, fenceTrigger: 1, destroyed: false, placedAt: -10,
      };
    });
  }

  defaultSurvivors() {
    const specs = [
      ['survivor-shell-shell', 11, 8],
      ['survivor-crystal-pin', 13, 6],
      ['survivor-bubble-float', 12, 10],
      ['survivor-moss-sprout', 11, 10],
    ];
    return specs.map(([cardId, x, y]) => {
      const card = SURVIVOR_BY_ID[cardId];
      return {
        uid: uid('survivor'), cardId, x, y,
        facing: 1,
        hp: card.hp, maxHp: card.hp, shield: 0, seed: 0,
        cooldown: Math.random() * 0.4, actionCount: 0, hitCount: 0,
        attackCount: 0, downed: false, hitFlash: 0, placedAt: -10,
      };
    });
  }

  initializeColonySimulation() {
    const startingStockpile = WORLD.base.startingStockpile;
    const resources = this.loadedColonyResources || {
      gel: startingStockpile['soft-gel'],
      nectar: startingStockpile['dew-honey'],
      shard: startingStockpile['crystal-shard'],
    };
    // A blueprint footprint is derived from its current building card, not
    // authoritative save data. This lets catalog footprint migrations release
    // obsolete cells without discarding delivered materials or build progress.
    const persistedBlueprints = (this.loadedColonyBlueprints || []).map((blueprint) => {
      const building = this.state.buildings.find(({ blueprintUid }) => (
        blueprintUid === blueprint?.uid
      ));
      const card = BUILDING_BY_ID[building?.cardId] || BUILDING_BY_ID[blueprint?.cardId];
      if (!card) return blueprint;
      const rotation = canonicalBuildingRotation(building?.rotation ?? 0, card);
      return {
        ...blueprint,
        footprint: rotatedFootprint(card, rotation),
      };
    });
    const authoredResourceNodes = this.state.worldTerrain.cells.flatMap((cell) => {
      const definition = TERRAIN_TYPES[cell.terrainId];
      const resourceType = COLONY_RESOURCE_ID[definition?.yield?.resourceId];
      if (!resourceType || !definition.harvestable) return [];
      return [{
        uid: `world-resource-${cell.x}-${cell.y}`,
        x: cell.x,
        y: cell.y,
        resourceType,
        amount: definition.yield.amount,
        harvestSeconds: definition.yield.gatherSeconds,
      }];
    });
    // New saves persist the exact remainder of authored starter-map nodes.
    // A missing field means a legacy save, so those saves still reconstruct
    // their nodes from the saved terrain exactly as they did before.
    const resourceNodes = Array.isArray(this.loadedStarterResourceNodes)
      ? authoredResourceNodes.flatMap((node) => {
        const persisted = this.loadedStarterResourceNodes.find((candidate) => (
          candidate?.x === node.x
            && candidate?.y === node.y
            && Number(candidate.amount) > 0
        ));
        return persisted
          ? [{ ...node, amount: Math.max(1, Math.floor(Number(persisted.amount))) }]
          : [];
      })
      : authoredResourceNodes;
    resourceNodes.push(...(this.loadedInfiniteResourceNodes || []).filter((node) => (
      Number.isSafeInteger(node?.x)
        && Number.isSafeInteger(node?.y)
        && COLONY_RESOURCE_LABEL[node.resourceType]
        && Number(node.amount) > 0
    )));
    const slimes = this.state.survivors.map((survivor) => {
      const card = SURVIVOR_BY_ID[survivor.cardId];
      const job = SLIME_JOBS.find((profile) => profile.slimeId === survivor.cardId);
      const multiplier = job?.jobBonus?.multiplier || 1;
      return {
        uid: survivor.uid,
        cardId: survivor.cardId,
        x: survivor.x,
        y: survivor.y,
        aiState: survivor.downed || survivor.hp <= 0 ? 'downed' : 'idle',
        speed: job?.moveSpeedCellsPerSecond || 1,
        carryCapacity: job?.carryCapacity || 6,
        gatherMultiplier: job?.jobBonus?.task === 'resource-harvest' ? multiplier : 1,
        buildMultiplier: job?.jobBonus?.task === 'construction' ? multiplier : 1,
        hp: survivor.hp,
        maxHp: survivor.maxHp,
        attackDamage: card.attack.damage,
        attackRange: card.attack.rangeTiles,
        attackInterval: card.attack.intervalSeconds,
        aggroRange: Math.max(3, card.attack.rangeTiles),
      };
    });
    const persistedBlueprintCells = persistedBlueprints.flatMap((blueprint) => {
      const width = Math.max(1, Math.floor(Number(blueprint.footprint?.width) || 1));
      const height = Math.max(1, Math.floor(Number(blueprint.footprint?.height) || 1));
      return [
        { x: blueprint.x, y: blueprint.y },
        { x: blueprint.x + width - 1, y: blueprint.y + height - 1 },
      ];
    });
    const persistedBuildingCells = this.state.buildings.flatMap((building) => {
      const card = BUILDING_BY_ID[building.cardId];
      if (!card) return [];
      return footprintCells(card, building.x, building.y, building.rotation);
    });
    const persistedSurvivorCells = this.state.survivors.map((survivor) => ({
      x: Math.round(survivor.x),
      y: Math.round(survivor.y),
    }));
    const persistedExpansionCells = [
      ...persistedBlueprintCells,
      ...(this.loadedInfiniteResourceNodes || []),
      ...(this.state.expeditionProgress?.activeClearTargets || []),
      ...persistedBuildingCells,
      ...persistedSurvivorCells,
      ...this.colonyDepotPositions(),
      ...(this.state.expeditionProgress?.activeClearTargets || []),
    ].filter((cell) => Number.isSafeInteger(cell?.x) && Number.isSafeInteger(cell?.y));
    const colonyMinX = Math.min(0, ...persistedExpansionCells.map((cell) => cell.x));
    const colonyMinY = Math.min(0, ...persistedExpansionCells.map((cell) => cell.y));
    const colonyMaxX = Math.max(WORLD.width - 1, ...persistedExpansionCells.map((cell) => cell.x));
    const colonyMaxY = Math.max(WORLD.height - 1, ...persistedExpansionCells.map((cell) => cell.y));
    const colony = createColonyState({
      bounds: {
        x: colonyMinX,
        y: colonyMinY,
        width: colonyMaxX - colonyMinX + 1,
        height: colonyMaxY - colonyMinY + 1,
      },
      basePosition: CORE_CELL,
      rallyPoint: WORLD.base.rallyPoint,
      depots: this.colonyDepotPositions(),
      resources,
      resourceNodes,
      blueprints: persistedBlueprints,
      slimes,
      terrainQuery: (x, y) => colonyTerrainFromWorldCell(this.worldCellAt(x, y)),
      jobCellProvider: () => this.colonyWorkCells(),
      findPath: ({ from, to }) => {
        const start = { x: Math.round(from.x), y: Math.round(from.y) };
        const path = routeFor(
          this.state.buildings.filter((building) => !building.underConstruction),
          start,
          { x: Math.round(to.x), y: Math.round(to.y) },
          this.runtimeTerrain,
          { allowBuildingBreaching: false },
        );
        return path[0]?.x === start.x && path[0]?.y === start.y ? path.slice(1) : path;
      },
      config: {
        passiveThreatPerSecond: 0,
        priorities: { defense: 5, build: 4, gather: 3, clear: 2 },
        obstacleDamagePerSecond: 1.25,
      },
    });
    colony.time = this.state.colonyDirector.elapsed;
    colony.threat.elapsed = this.state.colonyDirector.elapsed;
    colony.onTerrainChange = (x, y, tile) => {
      if (tile.kind !== 'ground') return;
      if (this.isStarterCell(x, y)) replaceWorldTerrainCell(this.state.worldTerrain, x, y, 'ground');
      else this.infiniteWorld.setTerrain(x, y, 'ground');
      if (this.selection?.kind === 'inspect-terrain'
        && this.selection.x === x && this.selection.y === y) this.selection = null;
      this.state.enemies.forEach((enemy) => { enemy.routeTimer = 0; });
    };
    this.state.colony = colony;
    this.syncColonyDepots();
    this.loadedColonyResources = null;
    this.loadedColonyBlueprints = null;
    this.loadedStarterResourceNodes = null;
    this.loadedInfiniteResourceNodes = null;
    this.reconcileConstructionBlueprints({ persist: false, notify: false });
    this.syncColonySlimesToSurvivors();
  }

  syncColonySlimesToSurvivors() {
    if (!this.state.colony) return;
    for (const slime of this.state.colony.slimes) {
      const survivor = this.state.survivors.find((item) => item.uid === slime.uid);
      if (!survivor) continue;
      if (this.isWorldExpeditionMember(survivor.uid)) continue;
      this.faceEntityToward(survivor, slime, 1);
      survivor.x = slime.x;
      survivor.y = slime.y;
      survivor.aiState = slime.aiState;
      survivor.job = slime.job ? { ...slime.job } : null;
      survivor.carrying = slime.carrying ? { ...slime.carrying } : null;
      survivor.hp = clamp(slime.hp, 0, survivor.maxHp);
      survivor.downed = slime.aiState === 'downed';
    }
  }

  bindEvents() {
    this.onPointerDown = (event) => {
      event.preventDefault();
      this.audio.unlock();
      const point = this.toGamePoint(event);
      this.pointerDown = point;
      this.activePointers.set(event.pointerId ?? 0, point);
      if (this.activePointers.size === 2) {
        const [first, second] = [...this.activePointers.values()];
        this.pinchGesture = {
          distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
          zoom: this.camera.zoom,
          moved: true,
        };
        this.pointerDrag = null;
        this.canvas.setPointerCapture?.(event.pointerId);
        return;
      }
      if (!this.modal
        && pointInsideWorldViewport(point, BOARD)
        && !this.uiBlocksMapDrag(point)) {
        this.pointerDrag = {
          pointerId: event.pointerId ?? 0,
          start: point,
          last: point,
          moved: false,
        };
      }
      this.canvas.setPointerCapture?.(event.pointerId);
    };
    this.onPointerUp = (event) => {
      event.preventDefault();
      const point = this.toGamePoint(event);
      const pointerId = event.pointerId ?? 0;
      const wasMapDrag = this.pinchGesture?.moved
        || (this.pointerDrag?.pointerId === pointerId && this.pointerDrag.moved);
      if (!wasMapDrag) this.handleTap(point);
      this.activePointers.delete(pointerId);
      if (this.activePointers.size < 2) this.pinchGesture = null;
      if (this.pointerDrag?.pointerId === pointerId) this.pointerDrag = null;
      this.pointerDown = null;
    };
    this.onPointerMove = (event) => {
      const point = this.toGamePoint(event);
      const pointerId = event.pointerId ?? 0;
      if (this.activePointers.has(pointerId)) this.activePointers.set(pointerId, point);
      if (this.pinchGesture && this.activePointers.size >= 2 && !this.selection) {
        const [first, second] = [...this.activePointers.values()];
        const distanceNow = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
        const anchor = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
        this.camera = zoomWorldCameraAt(
          this.camera,
          this.pinchGesture.zoom * (distanceNow / this.pinchGesture.distance),
          anchor,
          WORLD,
          BOARD,
        );
      } else if (this.pointerDrag?.pointerId === pointerId && !this.selection) {
        const totalDistance = Math.hypot(
          point.x - this.pointerDrag.start.x,
          point.y - this.pointerDrag.start.y,
        );
        if (totalDistance > 7) this.pointerDrag.moved = true;
        if (this.pointerDrag.moved) {
          this.camera = panWorldCamera(this.camera, {
            x: point.x - this.pointerDrag.last.x,
            y: point.y - this.pointerDrag.last.y,
          }, WORLD, BOARD);
          this.pointerDrag.last = point;
        }
      }
      this.hoverCell = this.pointToCell(point);
      this.hoverId = this.hits.findLast?.((hit) => hit.enabled !== false && roundedHit(point, hit))?.id
        || [...this.hits].reverse().find((hit) => hit.enabled !== false && roundedHit(point, hit))?.id
        || null;
    };
    this.onPointerCancel = () => {
      this.pointerDown = null;
      this.pointerDrag = null;
      this.pinchGesture = null;
      this.activePointers.clear();
      this.hoverId = null;
      this.hoverCell = null;
    };
    this.onWheel = (event) => {
      const point = this.toGamePoint(event);
      if (!pointInsideWorldViewport(point, BOARD)) return;
      event.preventDefault();
      const zoomFactor = Math.exp(-event.deltaY * 0.0012);
      this.camera = zoomWorldCameraAt(
        this.camera,
        this.camera.zoom * zoomFactor,
        point,
        WORLD,
        BOARD,
      );
    };
    this.canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    this.canvas.addEventListener('pointerup', this.onPointerUp, { passive: false });
    this.canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });
    this.canvas.addEventListener('pointercancel', this.onPointerCancel, { passive: true });
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const zoom = Math.max(0.01, Number(this.camera?.zoom) || 1);
    const previousFocus = {
      x: (Number(this.camera?.x) || 0) + BOARD.width / (BOARD.cellSize * zoom * 2),
      y: (Number(this.camera?.y) || 0) + BOARD.height / (BOARD.cellSize * zoom * 2),
    };
    const deviceDpr = Math.max(1, Number(window.devicePixelRatio) || 1);
    this.dpr = Math.min(MAX_CANVAS_DPR, deviceDpr);
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
    this.scale = Math.max(0.01, Math.min(rect.width / VIEW.width, rect.height / VIEW.height));
    this.offsetX = (rect.width - VIEW.width * this.scale) / 2;
    this.offsetY = (rect.height - VIEW.height * this.scale) / 2;
    BOARD.x = -this.offsetX / this.scale;
    BOARD.y = -this.offsetY / this.scale;
    BOARD.width = rect.width / this.scale;
    BOARD.height = rect.height / this.scale;
    this.camera = createWorldCamera({
      world: WORLD,
      viewport: BOARD,
      focus: previousFocus,
      zoom,
    });
  }

  toGamePoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - this.offsetX) / this.scale,
      y: (event.clientY - rect.top - this.offsetY) / this.scale,
    };
  }

  start() {
    if (!this.state.tutorialSeen) this.modal = { type: 'welcome', page: 0 };
    requestAnimationFrame((time) => this.frame(time));
  }

  frame(timestamp) {
    const dt = Math.min(0.05, Math.max(0, (timestamp - this.lastTime) / 1000 || 0));
    this.lastTime = timestamp;
    this.time += dt;
    this.update(dt);
    this.render();
    requestAnimationFrame((time) => this.frame(time));
  }

  save() {
    try {
      this.reconcileConstructionBlueprints({ persist: false, notify: false });
      let layoutBuildings = this.state.buildings;
      let layoutSurvivors = this.state.survivors;
      if ((this.state.phase === 'battle' || this.state.phase === 'result') && this.preBattleSnapshot) {
        const safeLayout = JSON.parse(this.preBattleSnapshot);
        layoutBuildings = safeLayout.buildings;
        layoutSurvivors = safeLayout.survivors;
      }
      if (this.state.worldExpedition?.squadUids?.length) {
        const away = new Set(this.state.worldExpedition.squadUids);
        let rallyIndex = 0;
        layoutSurvivors = this.state.survivors.map((survivor) => {
          if (!away.has(survivor.uid)) return survivor;
          const index = rallyIndex++;
          return {
            ...survivor,
            x: WORLD.base.rallyPoint.x + (index % 2) * 0.55,
            y: WORLD.base.rallyPoint.y + Math.floor(index / 2) * 0.55,
            expeditionActive: false,
            visualMoving: false,
          };
        });
      }
      // Colony workers are reconstructed on load instead of persisting their
      // frame-by-frame AI state. Refund anything currently in their hands into
      // the saved stockpile snapshot without disturbing the live simulation.
      const colonyResources = this.state.colony
        ? { ...this.state.colony.resources }
        : null;
      if (colonyResources) {
        for (const slime of this.state.colony.slimes || []) {
          const resourceType = slime.carrying?.resourceType;
          if (!Object.hasOwn(colonyResources, resourceType)) continue;
          colonyResources[resourceType] += Math.max(0, Number(slime.carrying.amount) || 0);
        }
      }
      const payload = {
        softCrystals: this.state.softCrystals,
        tutorialSeen: this.state.tutorialSeen,
        terrainIds: this.state.worldTerrain.cells.map((cell) => cell.terrainId),
        infiniteWorld: this.infiniteWorld.serialize(),
        gelPavingCells: sortedSavedCells(this.state.gelPavingCells || []),
        colonyResources,
        colonyBlueprints: (this.state.colony?.blueprints || [])
          .filter((blueprint) => !blueprint.complete && !blueprint.cancelled)
          .map(({ reservedBy: _reservedBy, ...blueprint }) => ({ ...blueprint })),
        starterResourceNodes: (this.state.colony?.resourceNodes || [])
          .filter((node) => node.uid.startsWith('world-resource-') && node.amount > 0)
          .map(({ reservedBy: _reservedBy, ...node }) => ({ ...node })),
        infiniteResourceNodes: (this.state.colony?.resourceNodes || [])
          .filter((node) => node.uid.startsWith('infinite-resource-') && node.amount > 0)
          .map(({ reservedBy: _reservedBy, ...node }) => ({ ...node })),
        colonyDirector: this.state.colonyDirector,
        expeditionProgress: this.state.expeditionProgress,
        expeditionRun: this.isExpeditionActive() ? this.state.expeditionRun : null,
        worldExpedition: null,
        expeditionSnapshot: this.isExpeditionActive() ? this.preBattleSnapshot : null,
        buildings: layoutBuildings.filter((building) => !building.destroyed).map(({ uid: _uid, ...building }) => ({
          ...building,
          rotation: canonicalBuildingRotation(
            building.rotation,
            BUILDING_BY_ID[building.cardId],
          ),
          hp: clamp(
            Number.isFinite(Number(building.hp))
              ? Number(building.hp)
              : BUILDING_BY_ID[building.cardId].hp,
            0,
            BUILDING_BY_ID[building.cardId].hp,
          ),
          maxHp: BUILDING_BY_ID[building.cardId].hp,
          cooldown: 0,
          shotCount: 0,
          fenceTrigger: 1,
        })),
        survivors: layoutSurvivors.map(({ uid: _uid, ...survivor }) => ({
          ...survivor,
          hp: clamp(
            Number.isFinite(Number(survivor.hp))
              ? Number(survivor.hp)
              : SURVIVOR_BY_ID[survivor.cardId].hp,
            0,
            SURVIVOR_BY_ID[survivor.cardId].hp,
          ),
          maxHp: SURVIVOR_BY_ID[survivor.cardId].hp,
          cooldown: 0,
          downed: Boolean(survivor.downed) || Number(survivor.hp) <= 0,
        })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage can be disabled in private browser contexts; gameplay remains usable.
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Number.isFinite(saved.softCrystals)) this.state.softCrystals = saved.softCrystals;
      this.state.tutorialSeen = Boolean(saved.tutorialSeen);
      this.state.worldTerrain = worldTerrainFromIds(saved.terrainIds);
      const savedPaving = Array.isArray(saved.gelPavingCells)
        ? saved.gelPavingCells
        : Array.isArray(saved.pavedCells)
          ? saved.pavedCells
          : [];
      this.state.gelPavingCells = new Set(
        savedPaving.map(normalizeSavedCellKey).filter(Boolean),
      );
      if (saved.infiniteWorld) {
        try {
          this.infiniteWorld = restoreInfiniteWorld(saved.infiniteWorld, { maxLoadedChunks: 81 });
        } catch {
          // A generator-version change should never discard the player's base;
          // keep a fresh surrounding world and continue loading the layout.
          this.infiniteWorld = createInfiniteWorld({
            seed: INITIAL_WORLD_TERRAIN.seed,
            core: CORE_CELL,
            maxLoadedChunks: 81,
          });
          this.infiniteWorld.reveal(CORE_CELL.x, CORE_CELL.y, 18);
        }
      }
      this.loadedColonyResources = saved.colonyResources || null;
      this.loadedColonyBlueprints = Array.isArray(saved.colonyBlueprints)
        ? saved.colonyBlueprints
        : [];
      this.loadedStarterResourceNodes = Array.isArray(saved.starterResourceNodes)
        ? saved.starterResourceNodes
        : null;
      this.loadedInfiniteResourceNodes = Array.isArray(saved.infiniteResourceNodes)
        ? saved.infiniteResourceNodes
        : [];
      if (saved.colonyDirector && Number.isFinite(saved.colonyDirector.elapsed)) {
        this.state.colonyDirector = {
          ...this.state.colonyDirector,
          elapsed: Math.max(0, saved.colonyDirector.elapsed),
          nextPackAt: Math.max(0, Number(saved.colonyDirector.nextPackAt) || 0),
          packIndex: Math.max(0, Math.floor(Number(saved.colonyDirector.packIndex) || 0)),
        };
      }
      if (saved.expeditionProgress && typeof saved.expeditionProgress === 'object') {
        const savedFrontier = saved.expeditionProgress.frontier;
        const activeClearTargets = [];
        const clearTargetKeys = new Set();
        for (const target of saved.expeditionProgress.activeClearTargets || []) {
          if (!Number.isSafeInteger(target?.x) || !Number.isSafeInteger(target?.y)) continue;
          const key = cellKey(target.x, target.y);
          if (clearTargetKeys.has(key)) continue;
          clearTargetKeys.add(key);
          activeClearTargets.push({
            x: target.x,
            y: target.y,
            outpostId: typeof target.outpostId === 'string' ? target.outpostId : null,
          });
        }
        this.state.expeditionProgress = {
          firstClear: Boolean(saved.expeditionProgress.firstClear),
          completions: Math.max(0, Math.floor(Number(saved.expeditionProgress.completions) || 0)),
          attempts: Math.max(0, Math.floor(Number(saved.expeditionProgress.attempts) || 0)),
          claimedRunIds: Array.isArray(saved.expeditionProgress.claimedRunIds)
            ? saved.expeditionProgress.claimedRunIds.filter((id) => typeof id === 'string').slice(-24)
            : [],
          frontier: Number.isSafeInteger(savedFrontier?.x) && Number.isSafeInteger(savedFrontier?.y)
            ? { x: savedFrontier.x, y: savedFrontier.y }
            : { ...CORE_CELL },
          outposts: Array.isArray(saved.expeditionProgress.outposts)
            ? saved.expeditionProgress.outposts
              .filter((outpost) => (
                typeof outpost?.id === 'string'
                && Number.isSafeInteger(outpost.x)
                && Number.isSafeInteger(outpost.y)
              ))
              .map(({ id, x, y, name = '生态前哨' }) => ({ id, x, y, name }))
            : [],
          activeClearTargets,
        };
      }
      if (saved.expeditionRun && typeof saved.expeditionRun === 'object') {
        this.pendingExpeditionRecovery = {
          run: saved.expeditionRun,
          snapshot: typeof saved.expeditionSnapshot === 'string'
            ? saved.expeditionSnapshot
            : null,
        };
      }
      if (Array.isArray(saved.buildings)) {
        // Very early saves could contain an already-completed paving card as
        // a permanent building. Migrate it to the new sparse surface overlay;
        // unfinished paving blueprints keep their normal construction state.
        for (const item of saved.buildings) {
          if (item?.cardId !== 'building-gel-foundation'
            || item.underConstruction === true
            || !Number.isSafeInteger(item.x)
            || !Number.isSafeInteger(item.y)) continue;
          this.state.gelPavingCells.add(cellKey(item.x, item.y));
          if (this.isStarterCell(item.x, item.y)) {
            replaceWorldTerrainCell(this.state.worldTerrain, item.x, item.y, 'ground');
          } else {
            this.infiniteWorld.setTerrain(item.x, item.y, 'ground');
          }
        }
        this.state.buildings = saved.buildings
          .filter((item) => (
            BUILDING_BY_ID[item.cardId]
            && !(item.cardId === 'building-gel-foundation' && item.underConstruction !== true)
          ))
          .map((item) => {
            const card = BUILDING_BY_ID[item.cardId];
            return {
              ...item,
              uid: uid('building'),
              rotation: canonicalBuildingRotation(item.rotation, card),
              hp: clamp(Number.isFinite(Number(item.hp)) ? Number(item.hp) : card.hp, 0, card.hp),
              maxHp: card.hp,
              destroyed: false,
              placedAt: -10,
            };
          });
      }
      if (Array.isArray(saved.survivors) && saved.survivors.length) {
        this.state.survivors = saved.survivors
          .filter((item) => SURVIVOR_BY_ID[item.cardId])
          .map((item) => {
            const card = SURVIVOR_BY_ID[item.cardId];
            const hp = clamp(
              Number.isFinite(Number(item.hp)) ? Number(item.hp) : card.hp,
              0,
              card.hp,
            );
            return {
              ...item,
              uid: uid('survivor'),
              hp,
              maxHp: card.hp,
              downed: Boolean(item.downed) || hp <= 0,
              placedAt: -10,
            };
          });
      }
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Storage can be entirely unavailable; fall back to a fresh in-memory state.
      }
    }
  }

  onBackground() {
    if (this.state.worldExpedition) {
      this.finishWorldExpeditionReturn();
      this.save();
      return;
    }
    if (this.isExpeditionSession()) {
      this.abandonCurrentExpedition({ silent: true, returnToBase: true });
      this.save();
      return;
    }
    if (this.modal?.type === 'expedition-squad') {
      this.modal = null;
      this.state.paused = false;
    }
    if (this.state.phase === 'battle' && this.preBattleSnapshot) this.restoreBattleSnapshot();
    this.save();
  }

  snapshotForBattle() {
    this.preBattleSnapshot = JSON.stringify({
      buildings: this.state.buildings,
      survivors: this.state.survivors,
      coreHp: this.state.coreHp,
      softCrystals: this.state.softCrystals,
      camera: this.camera,
    });
  }

  restoreBattleSnapshot() {
    if (!this.preBattleSnapshot) return;
    const snapshot = JSON.parse(this.preBattleSnapshot);
    this.state.buildings = snapshot.buildings;
    this.state.survivors = snapshot.survivors;
    this.state.coreHp = snapshot.coreHp;
    this.state.softCrystals = snapshot.softCrystals;
    if (snapshot.camera) this.camera = snapshot.camera;
    this.state.phase = 'build';
    this.state.paused = false;
    this.state.enemies = [];
    this.state.projectiles = [];
    this.state.worldEffects = [];
    this.state.dynamicEffects = [];
    this.state.terrain = [];
    this.state.deployables = [];
    this.pendingAttackHits.clear();
    this.expressionMixers.clear();
    this.selection = null;
    this.modal = null;
    this.state.expeditionRun = null;
  }

  restoreExpeditionBaseSnapshot() {
    if (!this.preBattleSnapshot) return false;
    const snapshot = JSON.parse(this.preBattleSnapshot);
    this.state.buildings = snapshot.buildings;
    this.state.survivors = snapshot.survivors;
    this.state.coreHp = snapshot.coreHp;
    if (snapshot.camera) this.camera = snapshot.camera;
    this.state.enemies = [];
    this.state.spawnQueue = [];
    this.state.spawned = new Set();
    this.state.projectiles = [];
    this.state.worldEffects = [];
    this.state.dynamicEffects = [];
    this.state.terrain = [];
    this.state.deployables = [];
    this.pendingAttackHits.clear();
    this.expressionMixers.clear();
    this.animators.clear();
    this.selection = null;
    return true;
  }

  recoverInterruptedExpedition() {
    const pending = this.pendingExpeditionRecovery;
    this.pendingExpeditionRecovery = null;
    if (!pending?.run) return false;
    try {
      const run = restoreExpeditionState(pending.run, EXPEDITION_CATALOG);
      // The normal save payload already restored a fresh base layout with new
      // runtime uids. Snapshot that layout instead of reviving stale battle
      // entity ids from the interrupted session.
      this.snapshotForBattle();
      this.state.expeditionRun = run;
      if (run.status === 'active' || run.status === 'draft') {
        abandonExpedition(run, EXPEDITION_CATALOG);
      }
      this.settleExpeditionRun({ silent: true, returnToBase: true });
      return true;
    } catch {
      this.state.expeditionRun = null;
      this.preBattleSnapshot = null;
      this.state.phase = 'build';
      this.state.paused = false;
      return false;
    }
  }

  handleTap(point) {
    const hit = [...this.hits].reverse().find((candidate) => candidate.enabled !== false && roundedHit(point, candidate));
    if (hit) {
      this.audio.play('tap');
      hit.onTap?.();
      return;
    }
    if (this.modal) return;
    const cell = this.pointToCell(point);
    if (cell) this.handleCellTap(cell);
  }

  pointToCell(point) {
    return screenToWorldCell(point, this.camera, WORLD, BOARD);
  }

  addHit(id, x, y, w, h, onTap, enabled = true) {
    this.hits.push({ id, x, y, w, h, onTap, enabled });
  }

  addUiBlocker(id, x, y, w, h) {
    this.hits.push({
      id,
      x,
      y,
      w,
      h,
      onTap: null,
      enabled: true,
      blocksMapDrag: true,
    });
  }

  uiBlocksMapDrag(point) {
    return this.hits.some((hit) => hit.blocksMapDrag && roundedHit(point, hit));
  }

  showToast(text, tone = 'normal', duration = 2.1) {
    this.toast = { text, tone, expires: this.time + duration };
  }

  isExpeditionActive() {
    return Boolean(this.state.expeditionRun?.status === 'active');
  }

  isExpeditionSession() {
    return Boolean(this.state.expeditionRun || this.state.worldExpedition);
  }

  isWorldExpeditionMember(survivorUid) {
    return Boolean(this.state.worldExpedition?.squadUids?.includes(survivorUid));
  }

  availableExpeditionSlimeIds() {
    const eligible = new Set(EXPEDITION_PARTY_RULES.availableSlimeIds);
    return [...new Set(this.state.survivors
      .filter((survivor) => !survivor.downed && survivor.hp > 0)
      .map(({ cardId }) => cardId)
      .filter((cardId) => eligible.has(cardId)))];
  }

  openExpedition() {
    if (this.state.phase !== 'build' || this.isExpeditionSession()) return false;
    const availableIds = this.availableExpeditionSlimeIds();
    if (availableIds.length < EXPEDITION_PARTY_RULES.size) {
      this.showToast('大世界探索需要三只不同的史莱姆', 'danger');
      return false;
    }
    const defaults = EXPEDITION_PARTY_RULES.defaultSlimeIds
      .filter((cardId) => availableIds.includes(cardId));
    const selectedIds = [...defaults, ...availableIds.filter((id) => !defaults.includes(id))]
      .slice(0, EXPEDITION_PARTY_RULES.size);
    this.selection = null;
    this.state.paused = true;
    this.modal = { type: 'expedition-squad', selectedIds };
    return true;
  }

  toggleExpeditionSlime(cardId) {
    if (this.modal?.type !== 'expedition-squad') return false;
    const availableIds = this.availableExpeditionSlimeIds();
    if (!availableIds.includes(cardId)) return false;
    const selected = new Set(this.modal.selectedIds || []);
    if (selected.has(cardId)) selected.delete(cardId);
    else if (selected.size < EXPEDITION_PARTY_RULES.size) selected.add(cardId);
    else {
      this.showToast('探索小队最多三只，先取消一只', 'danger');
      return false;
    }
    this.modal.selectedIds = [...selected];
    return true;
  }

  startExpedition(squadIds = this.modal?.selectedIds || []) {
    if (this.state.phase !== 'build' || this.isExpeditionSession()) return false;
    const ids = Array.isArray(squadIds) ? squadIds.map(String) : [];
    const availableIds = this.availableExpeditionSlimeIds();
    if (ids.length !== EXPEDITION_PARTY_RULES.size || new Set(ids).size !== ids.length) {
      this.showToast('必须恰好选择三只不同的史莱姆', 'danger');
      return false;
    }
    if (ids.some((cardId) => !availableIds.includes(cardId))) {
      this.showToast('小队里有尚未入住或正在恢复的史莱姆', 'danger');
      return false;
    }

    const attempt = this.state.expeditionProgress.attempts + 1;
    this.state.expeditionProgress.attempts = attempt;
    const squadUids = ids.map((cardId) => (
      this.state.survivors.find((survivor) => survivor.cardId === cardId)?.uid
    )).filter(Boolean);
    const knownSites = this.findNearbyWorldSites(8);
    if (!knownSites.length) {
      this.state.expeditionProgress.attempts = attempt - 1;
      this.state.paused = false;
      this.modal = null;
      this.showToast('附近暂时没有可定位的生态地标，请稍后再试', 'danger');
      return false;
    }
    for (const slime of this.state.colony?.slimes || []) {
      if (squadUids.includes(slime.uid)) cancelColonySlimeWork(this.state.colony, slime);
    }
    this.state.worldExpedition = {
      id: `world-exploration-${attempt}`,
      status: 'choose-site',
      squadUids,
      knownPoiIds: knownSites.map((site) => site.id),
      sites: knownSites,
      origin: { ...(this.state.expeditionProgress.frontier || CORE_CELL) },
      targetPoiId: null,
      path: [],
      pathIndex: 0,
      leader: null,
      formation: [],
      enemies: [],
      rewards: {},
    };
    this.requestWorldAssetKeys(knownSites.flatMap((site) => (
      worldPoiAssetKeys(site, site.zoneKind)
    )));
    this.state.phase = 'build';
    this.state.paused = false;
    this.modal = null;
    this.selection = null;
    for (const survivor of this.state.survivors) {
      if (!squadUids.includes(survivor.uid)) continue;
      survivor.expeditionDamageMultiplier = 1;
      survivor.expeditionAttackIntervalMultiplier = 1;
      survivor.expeditionHealMultiplier = 1;
      survivor.expeditionActive = true;
    }
    this.camera = createWorldCamera({
      world: WORLD,
      viewport: BOARD,
      focus: { x: knownSites[0].x + 0.5, y: knownSites[0].y + 0.5 },
      zoom: this.camera.zoom,
    });
    this.showToast(
      knownSites.length
        ? '探索队已集结：在大地图点击发光的资源地或怪物巢穴'
        : '探索队已集结，向外移动地图寻找生态地标',
      'good',
      3.2,
    );
    this.save();
    return true;
  }

  findNearbyWorldSites(limit = 8) {
    const attempt = Math.max(1, this.state.expeditionProgress.attempts || 1);
    const step = attempt - 1;
    const directions = [
      { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 },
      { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 },
    ];
    const savedFrontier = this.state.expeditionProgress.frontier;
    const frontier = Number.isSafeInteger(savedFrontier?.x) && Number.isSafeInteger(savedFrontier?.y)
      ? savedFrontier
      : CORE_CELL;
    const frontierDx = frontier.x - CORE_CELL.x;
    const frontierDy = frontier.y - CORE_CELL.y;
    const frontierDistance = Math.hypot(frontierDx, frontierDy);
    const fallbackDirection = directions[(step - 1 + directions.length) % directions.length];
    const direction = frontierDistance > 8
      ? { x: frontierDx / frontierDistance, y: frontierDy / frontierDistance }
      : fallbackDirection;
    // Each run advances one bounded leg from the latest activated frontier.
    // This keeps pathfinding and travel time stable even after hundreds of
    // expeditions while the absolute world coordinates continue unbounded.
    const ring = step === 0 && frontierDistance <= 8 ? 0 : 56;
    const focus = {
      x: Math.round(frontier.x + direction.x * ring),
      y: Math.round(frontier.y + direction.y * ring),
    };
    // Query several small deterministic windows instead of one enormous
    // rectangle, so the bounded chunk cache never turns infinity into a
    // hidden 81-chunk ceiling.
    const centers = step === 0 && frontierDistance <= 8
      ? [
        focus,
        { x: focus.x - 36, y: focus.y },
        { x: focus.x + 36, y: focus.y },
        { x: focus.x, y: focus.y - 36 },
        { x: focus.x, y: focus.y + 36 },
      ]
      : [
        focus,
        { x: focus.x + direction.y * 28, y: focus.y - direction.x * 28 },
        { x: focus.x - direction.y * 28, y: focus.y + direction.x * 28 },
      ];
    const found = new Map();
    const collectAround = (center) => {
      const half = 24;
      for (const site of this.infiniteWorld.getPoisInBounds({
        minX: center.x - half,
        minY: center.y - half,
        maxXExclusive: center.x + half,
        maxYExclusive: center.y + half,
      })) {
        if (!['nest', 'landmark', 'boss'].includes(site.kind)) continue;
        if (this.infiniteWorld.getPoiState(site.id)?.cleared === true) continue;
        found.set(site.id, site);
      }
    };
    for (const center of centers) collectAround(center);
    for (let fallbackRing = 1; found.size === 0 && fallbackRing <= 16; fallbackRing += 1) {
      const fallbackDirection = directions[(step + fallbackRing) % directions.length];
      const fallbackRadius = 48 + Math.floor((fallbackRing - 1) / directions.length) * 32;
      collectAround({
        x: frontier.x + fallbackDirection.x * fallbackRadius,
        y: frontier.y + fallbackDirection.y * fallbackRadius,
      });
    }
    return [...found.values()]
      .filter((site) => ['nest', 'landmark', 'boss'].includes(site.kind))
      .filter((site) => this.infiniteWorld.getPoiState(site.id)?.cleared !== true)
      .sort((left, right) => distance(left, focus) - distance(right, focus)
        || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map((site) => {
        const zoneKind = this.infiniteWorld.getZoneAt(site.x, site.y).kind;
        return {
          id: site.id,
          kind: site.kind,
          name: site.name,
          x: site.x,
          y: site.y,
          zoneKind,
          stage: Math.max(1, Math.floor(Number(site.stage) || 1)),
          boss: Boolean(site.boss),
          enemyId: site.enemyId || null,
          revealRadius: site.revealRadius || 6,
        };
      });
  }

  worldExpeditionSite(poiId = this.state.worldExpedition?.targetPoiId) {
    return this.state.worldExpedition?.sites?.find((site) => site.id === poiId) || null;
  }

  explorationTerrainSource() {
    return {
      infinite: true,
      getCell: (x, y) => {
        const cell = this.worldCellAt(x, y);
        return cell ? { ...cell, discovered: true } : null;
      },
    };
  }

  selectWorldExpeditionSite(poiId) {
    const expedition = this.state.worldExpedition;
    const site = this.worldExpeditionSite(poiId);
    if (!expedition || expedition.status !== 'choose-site' || !site) return false;
    const members = expedition.squadUids
      .map((survivorUid) => this.state.survivors.find((survivor) => survivor.uid === survivorUid))
      .filter(Boolean);
    if (!members.length) return false;
    const origin = Number.isSafeInteger(expedition.origin?.x) && Number.isSafeInteger(expedition.origin?.y)
      ? expedition.origin
      : CORE_CELL;
    const leader = { x: origin.x, y: origin.y };
    const path = routeFor(
      this.state.buildings.filter((building) => !building.underConstruction),
      { x: Math.round(leader.x), y: Math.round(leader.y) },
      { x: site.x, y: site.y },
      this.explorationTerrainSource(),
      { allowBuildingBreaching: false },
    );
    if (path.length < 2) {
      this.showToast('这处地标暂时没有可通行的探索路线', 'danger');
      return false;
    }
    expedition.status = 'travel';
    expedition.targetPoiId = poiId;
    expedition.path = path;
    expedition.pathIndex = 0;
    expedition.leader = leader;
    const compactFormation = [
      { dx: 0, dy: 0 },
      { dx: -0.42, dy: 0.38 },
      { dx: 0.42, dy: 0.38 },
    ];
    expedition.formation = members.map((member, index) => ({
      uid: member.uid,
      ...(compactFormation[index] || { dx: 0, dy: 0.72 + index * 0.28 }),
    }));
    for (const formation of expedition.formation) {
      const member = members.find(({ uid: memberUid }) => memberUid === formation.uid);
      if (!member) continue;
      member.x = leader.x + formation.dx;
      member.y = leader.y + formation.dy;
    }
    expedition.enemies = [];
    this.selection = null;
    this.showToast(
      `${distance(origin, CORE_CELL) > 8 ? '已从生态前哨出发，' : ''}探索队正在前往${site.name || '生态地标'}，基地仍会继续运转`,
      'good',
      3,
    );
    return true;
  }

  beginWorldSiteEncounter() {
    const expedition = this.state.worldExpedition;
    const site = this.worldExpeditionSite();
    if (!expedition || !site) return false;
    this.revealWorldAround(site.x, site.y, Math.max(4, site.revealRadius || 6), {
      registerResources: false,
    });
    if (site.kind === 'landmark') {
      this.completeWorldSiteEncounter(true);
      return true;
    }
    const stage = Math.max(1, Math.floor(Number(site.stage) || 1));
    const encounterSize = 7 + Math.min(9, Math.floor((stage - 1) / 2));
    const enemyIds = site.kind === 'boss'
      ? [site.enemyId || 'enemy-acid-shell-king', ...Array(encounterSize - 1).fill('enemy-soft-biter')]
      : Array.from({ length: encounterSize }, (_, index) => (
        index % 4 === 3 ? 'enemy-windcap' : 'enemy-soft-biter'
      ));
    expedition.enemies = enemyIds.map((cardId, index) => {
      const card = ENEMY_BY_ID[cardId];
      const angle = (index / enemyIds.length) * TAU;
      const radius = site.kind === 'boss' && index === 0 ? 0.7 : 1.6 + (index % 2) * 0.45;
      const stageHealth = 1 + Math.min(1.5, (stage - 1) * 0.06);
      const maxHp = Math.max(1, Math.round(
        card.hp * (site.kind === 'boss' && index === 0 ? 0.72 : 0.34) * stageHealth,
      ));
      return {
        uid: uid('world-site-enemy'),
        cardId,
        x: site.x + Math.cos(angle) * radius,
        y: site.y + Math.sin(angle) * radius,
        facing: -1,
        hp: maxHp,
        maxHp,
        damageMultiplier: 1 + Math.min(0.8, (stage - 1) * 0.035),
        cooldown: index * 0.08,
        dead: false,
        deathElapsed: 0,
        hitFlash: 0,
        visualMoving: false,
      };
    });
    for (const survivorUid of expedition.squadUids) {
      const survivor = this.state.survivors.find(({ uid: survivorUidValue }) => (
        survivorUidValue === survivorUid
      ));
      const card = SURVIVOR_BY_ID[survivor?.cardId];
      if (!survivor || !card) continue;
      survivor.cooldown = 0;
      survivor.actionCount ||= 0;
      survivor.attackCount ||= 0;
      survivor.hitCount ||= 0;
      if (card.id === 'survivor-shell-shell') {
        survivor.shield = Math.max(survivor.shield || 0, card.ability.shield);
      }
    }
    expedition.status = 'battle';
    this.showToast(site.kind === 'boss' ? 'Boss栖息地开战！' : '抵达怪物巢穴，探索队自动迎战', 'danger', 2.8);
    return true;
  }

  updateWorldTravel(dt) {
    const expedition = this.state.worldExpedition;
    if (!expedition?.leader || !expedition.path?.length) return;
    const returning = expedition.status === 'return';
    const next = expedition.path[Math.min(expedition.pathIndex + 1, expedition.path.length - 1)];
    const dx = next.x - expedition.leader.x;
    const dy = next.y - expedition.leader.y;
    const length = Math.hypot(dx, dy);
    const amount = Math.min(length, 4.2 * dt);
    if (length > 0.001) {
      expedition.leader.x += (dx / length) * amount;
      expedition.leader.y += (dy / length) * amount;
    }
    if (amount >= length - 0.001) expedition.pathIndex += 1;
    for (const formation of expedition.formation) {
      const survivor = this.state.survivors.find((member) => member.uid === formation.uid);
      if (!survivor) continue;
      this.faceEntityToward(survivor, next, 1);
      survivor.x = expedition.leader.x + formation.dx;
      survivor.y = expedition.leader.y + formation.dy;
      survivor.visualMoving = length > 0.04;
      const revealKey = cellKey(Math.round(survivor.x), Math.round(survivor.y));
      if (survivor.lastWorldRevealKey !== revealKey) {
        survivor.lastWorldRevealKey = revealKey;
        this.revealWorldAround(survivor.x, survivor.y, 2, { registerResources: false });
      }
    }
    if (expedition.pathIndex < expedition.path.length - 1) return;
    if (returning) this.finishWorldExpeditionReturn();
    else this.beginWorldSiteEncounter();
  }

  updateWorldSiteBattle(dt) {
    const expedition = this.state.worldExpedition;
    if (!expedition || expedition.status !== 'battle') return;
    const members = expedition.squadUids
      .map((survivorUid) => this.state.survivors.find((survivor) => survivor.uid === survivorUid))
      .filter(Boolean);
    const livingMembers = members.filter((member) => !member.downed && member.hp > 0);
    const livingEnemies = expedition.enemies.filter((enemy) => !enemy.dead && enemy.hp > 0);
    for (const survivor of livingMembers) {
      survivor.cooldown = Math.max(0, (survivor.cooldown || 0) - dt);
      const card = SURVIVOR_BY_ID[survivor.cardId];
      const target = livingEnemies
        .filter((enemy) => !enemy.dead && enemy.hp > 0)
        .sort((a, b) => distance(survivor, a) - distance(survivor, b))[0];
      if (!target) break;
      this.faceEntityToward(survivor, target, 1);
      const gap = distance(survivor, target);
      if (gap <= card.attack.rangeTiles) {
        survivor.visualMoving = false;
        if (survivor.cooldown <= 0) {
          const acted = this.performSurvivorAction(survivor);
          survivor.cooldown = acted
            ? card.attack.intervalSeconds * (survivor.expeditionAttackIntervalMultiplier || 1)
            : 0.18;
        }
      } else {
        const speed = 1.25 * dt;
        survivor.x += ((target.x - survivor.x) / Math.max(0.001, gap)) * Math.min(speed, gap);
        survivor.y += ((target.y - survivor.y) / Math.max(0.001, gap)) * Math.min(speed, gap);
        survivor.visualMoving = true;
      }
      const revealKey = cellKey(Math.round(survivor.x), Math.round(survivor.y));
      if (survivor.lastWorldRevealKey !== revealKey) {
        survivor.lastWorldRevealKey = revealKey;
        this.revealWorldAround(survivor.x, survivor.y, 2, { registerResources: false });
      }
    }
    for (const enemy of livingEnemies) {
      if (enemy.dead || enemy.hp <= 0) continue;
      enemy.cooldown = Math.max(0, (enemy.cooldown || 0) - dt);
      enemy.hitFlash = Math.max(0, (enemy.hitFlash || 0) - dt * 5);
      const target = livingMembers
        .filter((member) => !member.downed && member.hp > 0)
        .sort((a, b) => distance(enemy, a) - distance(enemy, b))[0];
      if (!target) break;
      this.faceEntityToward(enemy, target, -1);
      const card = ENEMY_BY_ID[enemy.cardId];
      const gap = distance(enemy, target);
      if (gap <= 0.85) {
        enemy.visualMoving = false;
        if (enemy.cooldown <= 0) {
          const started = this.startEntityAttack(enemy, () => {
            if (!target.downed) this.damageSurvivor(
              target,
              card.damage * 0.34 * (enemy.damageMultiplier || 1),
            );
          });
          if (started) enemy.cooldown = card.attackIntervalSeconds;
        }
      } else {
        const speed = Math.min(gap, card.speed * 0.62 * dt);
        enemy.x += ((target.x - enemy.x) / Math.max(0.001, gap)) * speed;
        enemy.y += ((target.y - enemy.y) / Math.max(0.001, gap)) * speed;
        enemy.visualMoving = speed > 0;
      }
    }
    if (expedition.enemies.every((enemy) => enemy.dead || enemy.hp <= 0)) {
      this.completeWorldSiteEncounter(true);
    } else if (members.every((member) => member.downed || member.hp <= 0)) {
      this.completeWorldSiteEncounter(false);
    }
  }

  completeWorldSiteEncounter(victory) {
    const expedition = this.state.worldExpedition;
    const site = this.worldExpeditionSite();
    if (!expedition || !site) return false;
    if (victory) {
      const baseRewards = site.kind === 'boss'
        ? { gel: 18, nectar: 10, shard: 12, softCrystals: 24 }
        : site.kind === 'nest'
          ? { gel: 10, nectar: 5, shard: 4, softCrystals: 6 }
          : { gel: 8, nectar: 7, shard: 5, softCrystals: 3 };
      const rewardMultiplier = 1 + Math.min(2.5, Math.max(0, (site.stage || 1) - 1) * 0.12);
      const rewards = Object.fromEntries(Object.entries(baseRewards).map(([resourceId, amount]) => (
        [resourceId, Math.max(1, Math.round(amount * rewardMultiplier))]
      )));
      this.state.colony.resources.gel += rewards.gel;
      this.state.colony.resources.nectar += rewards.nectar;
      this.state.colony.resources.shard += rewards.shard;
      this.state.softCrystals += rewards.softCrystals;
      expedition.rewards = rewards;
      this.infiniteWorld.setPoiState(site.id, {
        cleared: true,
        clearedAt: this.time,
        x: site.x,
        y: site.y,
      });
      const outposts = this.state.expeditionProgress.outposts ||= [];
      let activatedOutpost = false;
      if (!outposts.some(({ id }) => id === site.id)) {
        outposts.push({ id: site.id, x: site.x, y: site.y, name: site.name || '生态前哨' });
        activatedOutpost = true;
      }
      this.syncColonyDepots();
      // Activating a relay claims only a small local harvest patch. This keeps
      // exploration collectible without accumulating every resource crossed
      // by a long travel corridor as a permanent global job.
      const relayCells = [];
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          if (dx * dx + dy * dy <= 16) relayCells.push({ x: site.x + dx, y: site.y + dy });
        }
      }
      if (activatedOutpost) this.indexOutpostClearTargets(site, 4);
      this.registerDiscoveredResourceNodes(relayCells, { limit: 8 });
      const currentFrontier = this.state.expeditionProgress.frontier || CORE_CELL;
      if (distance(site, CORE_CELL) > distance(currentFrontier, CORE_CELL)) {
        this.state.expeditionProgress.frontier = { x: site.x, y: site.y };
      }
    }
    for (const survivorUid of expedition.squadUids) {
      const survivor = this.state.survivors.find((member) => member.uid === survivorUid);
      if (!survivor) continue;
      survivor.downed = false;
      survivor.hp = Math.max(survivor.maxHp * 0.4, survivor.hp);
    }
    expedition.status = 'return';
    expedition.enemies = [];
    expedition.path = [...expedition.path].reverse();
    expedition.pathIndex = 0;
    expedition.leader = { x: site.x, y: site.y };
    this.showToast(victory ? '探索完成，战利品已入库，小队正在返回' : '探索队安全撤回，基地内容保持不变', victory ? 'good' : 'normal', 3);
    this.save();
    return true;
  }

  finishWorldExpeditionReturn() {
    const expedition = this.state.worldExpedition;
    if (!expedition) return false;
    const encounterEntityIds = new Set([
      ...expedition.squadUids,
      ...(expedition.enemies || []).map((enemy) => enemy.uid),
    ]);
    for (const entityUid of encounterEntityIds) {
      this.pendingAttackHits.delete(entityUid);
      this.animators.delete(entityUid);
      this.expressionMixers.delete(entityUid);
    }
    this.state.projectiles = this.state.projectiles.filter((projectile) => (
      !encounterEntityIds.has(projectile.sourceUid)
      && !encounterEntityIds.has(projectile.targetUid)
    ));
    const rally = WORLD.base.rallyPoint;
    expedition.squadUids.forEach((survivorUid, index) => {
      const survivor = this.state.survivors.find((member) => member.uid === survivorUid);
      const colonySlime = this.state.colony?.slimes.find((member) => member.uid === survivorUid);
      const x = rally.x + (index % 2) * 0.55;
      const y = rally.y + Math.floor(index / 2) * 0.55;
      if (survivor) {
        survivor.x = x;
        survivor.y = y;
        survivor.expeditionActive = false;
        survivor.visualMoving = false;
      }
      if (colonySlime) {
        cancelColonySlimeWork(this.state.colony, colonySlime);
        colonySlime.x = x;
        colonySlime.y = y;
        colonySlime.hp = survivor?.hp ?? colonySlime.hp;
        if (survivor?.downed || colonySlime.hp <= 0) {
          downColonySlime(colonySlime);
        } else {
          colonySlime.aiState = 'idle';
          colonySlime.downedElapsed = 0;
        }
      }
    });
    this.state.worldExpedition = null;
    this.showToast('探索队已返回基地，可以继续选择新的生态地标', 'good');
    this.save();
    return true;
  }

  updateWorldExploration(dt) {
    const expedition = this.state.worldExpedition;
    if (!expedition) return;
    if (expedition.status === 'travel' || expedition.status === 'return') this.updateWorldTravel(dt);
    else if (expedition.status === 'battle') this.updateWorldSiteBattle(dt);
  }

  showExpeditionRouteChoices() {
    const run = this.state.expeditionRun;
    if (!run || run.status !== 'active' || run.phase !== 'route-selection') return false;
    this.state.phase = 'battle';
    this.state.paused = true;
    this.selection = null;
    this.modal = { type: 'expedition-route' };
    return true;
  }

  chooseExpeditionRouteNode(nodeUid) {
    const run = this.state.expeditionRun;
    if (!run || run.phase !== 'route-selection') return false;
    try {
      const encounter = chooseExpeditionRoute(run, nodeUid, EXPEDITION_CATALOG);
      this.startExpeditionEncounter(encounter);
      this.save();
      return true;
    } catch {
      this.showToast('这条路线已经失效，请重新选择', 'danger');
      return false;
    }
  }

  buildExpeditionSpawnQueue(encounter) {
    const groups = Array.isArray(encounter?.groups) ? encounter.groups : [];
    const routeStep = this.state.expeditionRun?.route?.regularWins || 0;
    const queue = [];
    groups.forEach((group, groupIndex) => {
      const count = Math.max(0, Math.floor(Number(group.count) || 0));
      for (let index = 0; index < count; index += 1) {
        queue.push({
          key: `${encounter.uid}-${groupIndex}-${index}`,
          enemyId: group.enemyId,
          row: (routeStep + groupIndex * 2 + index * 3) % 7,
          at: Math.max(0, Number(group.startDelaySeconds) || 0)
            + index * Math.max(0, Number(group.spawnIntervalSeconds) || 0),
        });
      }
    });
    return queue.sort((left, right) => left.at - right.at || left.key.localeCompare(right.key));
  }

  startExpeditionEncounter(encounter = this.state.expeditionRun?.currentEncounter) {
    if (!encounter || this.state.expeditionRun?.phase !== 'encounter') return false;
    this.state.phase = 'battle';
    this.state.paused = false;
    this.modal = null;
    this.selection = null;
    this.state.waveIndex = Math.min(
      WAVES.length - 1,
      this.state.expeditionRun.route.regularWins,
    );
    this.state.waveElapsed = 0;
    this.state.spawnQueue = this.buildExpeditionSpawnQueue(encounter);
    this.state.spawned = new Set();
    this.state.enemies = [];
    this.state.projectiles = [];
    this.state.worldEffects = [];
    this.state.dynamicEffects = [];
    this.state.terrain = [];
    this.state.deployables = [];
    this.pendingAttackHits.clear();
    this.expressionMixers.clear();
    this.state.energy = Math.max(4, this.state.energy || 0);
    this.state.survivors.forEach((survivor) => {
      const card = SURVIVOR_BY_ID[survivor.cardId];
      if (survivor.downed || survivor.hp <= 0) {
        survivor.downed = false;
        survivor.hp = Math.max(1, survivor.maxHp * 0.35);
      }
      survivor.hp = Math.min(survivor.maxHp, survivor.hp + survivor.maxHp * 0.12);
      survivor.cooldown = 0;
      survivor.expeditionPath = [];
      survivor.expeditionRouteGoal = null;
      if (card.id === 'survivor-shell-shell') {
        survivor.shield = Math.max(survivor.shield || 0, card.ability.shield);
      }
    });
    this.showToast(
      encounter.isFinalBoss
        ? '最终首领出现了！守住小队阵线'
        : `远征第 ${this.state.expeditionRun.route.regularWins + 1} 段开始`,
      encounter.isFinalBoss ? 'danger' : 'normal',
      2.6,
    );
    return true;
  }

  finishExpeditionEncounter(victory) {
    const run = this.state.expeditionRun;
    if (!run || run.status !== 'active' || run.phase !== 'encounter') return false;
    this.state.paused = true;
    this.state.enemies = [];
    this.state.spawnQueue = [];
    this.state.spawned = new Set();
    this.pendingAttackHits.clear();
    const rewardMultiplier = run.boons.reduce((multiplier, boon) => {
      const value = Number(boon.modifiers?.rewardMultiplier);
      return multiplier * (Number.isFinite(value) && value > 0 ? value ** boon.stacks : 1);
    }, 1);
    const transition = resolveExpeditionBattle(run, {
      won: Boolean(victory),
      rewardMultiplier,
      summary: { kills: this.state.kills },
    }, EXPEDITION_CATALOG);
    if (run.phase === 'settlement') {
      this.settleExpeditionRun();
      return true;
    }
    this.modal = { type: 'expedition-boon' };
    this.selection = null;
    this.showToast('遭遇胜利！选择一项变异再继续', 'good', 2.8);
    this.save();
    return transition;
  }

  applyExpeditionBoon(boonId) {
    const upgrade = EXPEDITION_UPGRADE_BY_ID[boonId];
    if (!upgrade) return false;
    const modifiers = upgrade.modifiers || {};
    const targets = this.state.survivors.filter((survivor) => (
      upgrade.target === 'party' || upgrade.target === survivor.cardId
    ));
    for (const survivor of targets) {
      if (Number.isFinite(modifiers.maxHpMultiplier)) {
        const previousMax = survivor.maxHp;
        survivor.maxHp *= modifiers.maxHpMultiplier;
        survivor.hp += survivor.maxHp - previousMax;
      }
      if (Number.isFinite(modifiers.currentHpHealPercent)) {
        survivor.hp = Math.min(
          survivor.maxHp,
          survivor.hp + survivor.maxHp * modifiers.currentHpHealPercent,
        );
      }
      if (Number.isFinite(modifiers.attackIntervalMultiplier)) {
        survivor.expeditionAttackIntervalMultiplier *= modifiers.attackIntervalMultiplier;
      }
      if (Number.isFinite(modifiers.attackDamageMultiplier)) {
        survivor.expeditionDamageMultiplier *= modifiers.attackDamageMultiplier;
      }
      if (Number.isFinite(modifiers.shieldMultiplier)) {
        survivor.shield = (survivor.shield || SURVIVOR_BY_ID[survivor.cardId].ability?.shield || 0)
          * modifiers.shieldMultiplier;
      }
      survivor.expeditionShieldBreakDamage = (survivor.expeditionShieldBreakDamage || 0)
        + (Number(modifiers.shieldBreakDamage) || 0);
      survivor.expeditionExtraProjectile = (survivor.expeditionExtraProjectile || 0)
        + (Number(modifiers.extraProjectile) || 0);
      survivor.expeditionSecondaryDamageMultiplier = Number(modifiers.secondaryProjectileDamageMultiplier)
        || survivor.expeditionSecondaryDamageMultiplier;
      survivor.expeditionBubbleChainTargets = (survivor.expeditionBubbleChainTargets || 0)
        + (Number(modifiers.bubbleChainTargets) || 0);
      survivor.expeditionChainedDamageMultiplier = Number(modifiers.chainedDamageMultiplier)
        || survivor.expeditionChainedDamageMultiplier;
      if (Number.isFinite(modifiers.healMultiplier)) {
        survivor.expeditionHealMultiplier *= modifiers.healMultiplier;
      }
      survivor.expeditionHealSplashPercent = Math.max(
        survivor.expeditionHealSplashPercent || 0,
        Number(modifiers.healSplashPercent) || 0,
      );
      survivor.expeditionDefeatedBurstDamage = (survivor.expeditionDefeatedBurstDamage || 0)
        + (Number(modifiers.defeatedEnemyBurstDamage) || 0);
      survivor.expeditionBurstRadiusTiles = Math.max(
        survivor.expeditionBurstRadiusTiles || 0,
        Number(modifiers.burstRadiusTiles) || 0,
      );
      survivor.expeditionLethalProtectionHits = (survivor.expeditionLethalProtectionHits || 0)
        + (Number(modifiers.lethalProtectionHits) || 0);
      survivor.expeditionProtectionHealPercent = Math.max(
        survivor.expeditionProtectionHealPercent || 0,
        Number(modifiers.protectionHealPercent) || 0,
      );
    }
    return true;
  }

  chooseExpeditionUpgrade(boonId) {
    const run = this.state.expeditionRun;
    if (!run || run.phase !== 'boon-selection') return false;
    try {
      chooseExpeditionBoon(run, boonId, EXPEDITION_CATALOG);
      this.applyExpeditionBoon(boonId);
      this.showExpeditionRouteChoices();
      this.showToast(`${EXPEDITION_UPGRADE_BY_ID[boonId]?.name || '变异'}已生效`, 'good');
      this.save();
      return true;
    } catch {
      this.showToast('这个变异选项已经失效', 'danger');
      return false;
    }
  }

  applyExpeditionRewards(rewards = {}) {
    const applied = flattenExpeditionRewards(rewards);
    for (const [resourceId, amount] of Object.entries(applied)) {
      if (resourceId === 'softCrystals') {
        this.state.softCrystals += amount;
        continue;
      }
      const colonyResource = COLONY_RESOURCE_ID[resourceId];
      if (colonyResource && this.state.colony?.resources) {
        this.state.colony.resources[colonyResource] += amount;
      }
    }
    return applied;
  }

  settleExpeditionRun({ silent = false, returnToBase = false } = {}) {
    const run = this.state.expeditionRun;
    if (!run || run.phase !== 'settlement' || !run.settlement) return false;
    this.restoreExpeditionBaseSnapshot();
    const claimedIds = this.state.expeditionProgress.claimedRunIds || [];
    const alreadyClaimed = claimedIds.includes(run.id) || run.settlement.claimed;
    let rewards = flattenExpeditionRewards(run.settlement.rewards);
    let firstClearRewards = {};
    if (!alreadyClaimed) {
      rewards = claimExpeditionRewards(run);
      this.applyExpeditionRewards(rewards);
      if (run.status === 'completed' && !this.state.expeditionProgress.firstClear) {
        firstClearRewards = flattenExpeditionRewards(FIRST_EXPEDITION.settlement.firstClearBonus);
        this.applyExpeditionRewards(firstClearRewards);
        this.state.expeditionProgress.firstClear = true;
      }
      if (run.status === 'completed') this.state.expeditionProgress.completions += 1;
      claimedIds.push(run.id);
      this.state.expeditionProgress.claimedRunIds = claimedIds.slice(-24);
    }
    const combinedRewards = { ...rewards };
    for (const [resourceId, amount] of Object.entries(firstClearRewards)) {
      combinedRewards[resourceId] = (combinedRewards[resourceId] || 0) + amount;
    }
    this.state.result = {
      expedition: true,
      victory: run.status === 'completed',
      outcome: run.status,
      rewards: combinedRewards,
      firstClear: Object.keys(firstClearRewards).length > 0,
      regularWins: run.route.regularWins,
      eliteWins: run.stats.eliteWins,
      kills: this.state.kills,
    };
    this.state.phase = returnToBase ? 'build' : 'result';
    this.state.paused = !returnToBase;
    this.modal = null;
    this.selection = null;
    this.audio.play(run.status === 'completed' ? 'win' : 'warning');
    if (!silent) {
      this.showToast(
        run.status === 'completed' ? '远征完成，资源已送回基地！' : '小队已撤回，保留了部分战利品',
        run.status === 'completed' ? 'good' : 'normal',
        3,
      );
    }
    if (returnToBase) {
      this.state.expeditionRun = null;
      this.state.result = null;
      this.preBattleSnapshot = null;
    }
    this.save();
    return !alreadyClaimed;
  }

  abandonCurrentExpedition({ silent = false, returnToBase = false } = {}) {
    const run = this.state.expeditionRun;
    if (!run) return false;
    if (run.phase !== 'settlement') abandonExpedition(run, EXPEDITION_CATALOG);
    return this.settleExpeditionRun({ silent, returnToBase });
  }

  update(dt) {
    const animationsPaused = this.state.phase === 'battle'
      && (this.state.paused || Boolean(this.selection));
    const animationDt = animationsPaused ? 0 : dt;
    if (this.toast && this.time >= this.toast.expires) this.toast = null;
    this.shake = Math.max(0, this.shake - animationDt * 2.8);
    this.state.particles.forEach((particle) => {
      particle.life -= animationDt;
      particle.x += (particle.vx || 0) * animationDt;
      particle.y += (particle.vy || 0) * animationDt;
      particle.vy = (particle.vy || 0) + (particle.gravity || 0) * animationDt;
    });
    this.state.particles = this.state.particles.filter((particle) => particle.life > 0).slice(-80);
    this.state.floaters.forEach((floater) => {
      floater.life -= animationDt;
      floater.y -= animationDt * 24;
    });
    this.state.floaters = this.state.floaters.filter((floater) => floater.life > 0);
    this.state.projectiles.forEach((projectile) => {
      projectile.progress += animationDt / projectile.duration;
    });
    this.state.projectiles = this.state.projectiles.filter((projectile) => projectile.progress < 1);
    this.state.worldEffects.forEach((effect) => { effect.life -= animationDt; });
    this.state.worldEffects = this.state.worldEffects.filter((effect) => effect.life > 0).slice(-32);
    this.state.dynamicEffects.forEach((effect) => {
      effect.life -= animationDt;
      effect.elapsed += animationDt;
    });
    this.state.dynamicEffects = this.state.dynamicEffects
      .filter((effect) => effect.life > 0)
      .slice(-96);
    this.state.survivors.forEach((survivor) => { survivor.hitFlash = Math.max(0, (survivor.hitFlash || 0) - animationDt * 4); });
    this.state.enemies.forEach((enemy) => { enemy.hitFlash = Math.max(0, (enemy.hitFlash || 0) - animationDt * 5); });

    if (this.state.phase === 'build' && !this.state.paused) {
      this.updateAutonomousColony(dt);
      this.updateWorldExploration(dt);
      this.revealAroundActiveSlimes();
    }
    if (this.state.phase === 'battle' && !this.state.paused && !this.selection) this.updateBattle(dt);

    this.updateEntityAnimations(animationDt);
  }

  updateAutonomousColony(dt) {
    if (!this.state.colony) return;
    this.reconcileConstructionBlueprints({ persist: true, notify: false });
    const allColonySlimes = this.state.colony.slimes;
    const awayUids = new Set(this.state.worldExpedition?.squadUids || []);
    this.state.colony.slimes = allColonySlimes.filter((slime) => !awayUids.has(slime.uid));
    this.updateContinuousThreatDirector(dt);
    const livingEnemies = this.state.enemies.filter((enemy) => !enemy.dead);

    for (const slime of this.state.colony.slimes) {
      const survivor = this.state.survivors.find((item) => item.uid === slime.uid);
      if (!survivor) continue;
      if (survivor.downed && slime.aiState !== 'downed') downColonySlime(slime);
      else if (!survivor.downed && slime.aiState !== 'downed') slime.hp = survivor.hp;
    }

    setColonyThreats(this.state.colony, livingEnemies.map((enemy) => ({
      uid: enemy.uid,
      x: enemy.x,
      y: enemy.y,
      hp: enemy.hp,
      dead: enemy.dead,
    })));
    setColonyThreatIntensity(this.state.colony, livingEnemies.length ? 0.68 : 0.12);
    const events = updateColony(this.state.colony, dt);
    this.state.colony.slimes = allColonySlimes;
    for (const building of this.state.buildings) {
      if (!building.underConstruction) continue;
      const blueprint = this.state.colony.blueprints.find((item) => item.uid === building.blueprintUid);
      if (blueprint) building.buildProgress = clamp(
        blueprint.buildProgress / Math.max(0.01, blueprint.buildSeconds),
        0,
        1,
      );
    }
    this.handleColonyEvents(events);
    this.syncColonySlimesToSurvivors();

    this.updateDeployables(dt);
    this.updateTerrain(dt);
    this.updateSurvivors(dt);
    this.updateBuildings(dt);
    this.updateEnemies(dt);

    if (Math.floor(this.state.colony.time) > Math.floor(this.state.colony.time - dt)
      && Math.floor(this.state.colony.time) % 12 === 0) this.save();
  }

  refundConstructionBlueprint(blueprintUid) {
    const colony = this.state.colony;
    if (!colony || typeof blueprintUid !== 'string') return false;
    const blueprint = colony.blueprints.find(({ uid: candidateUid }) => (
      candidateUid === blueprintUid
    ));
    if (blueprint) {
      for (const resourceType of Object.keys(colony.resources)) {
        colony.resources[resourceType] += Math.max(
          0,
          Number(blueprint.delivered?.[resourceType]) || 0,
        );
      }
      blueprint.cancelled = true;
      blueprint.reservedBy = null;
    }
    for (const slime of colony.slimes) {
      if (slime.job?.targetUid === blueprintUid) cancelColonySlimeWork(colony, slime);
    }
    colony.blueprints = colony.blueprints.filter(({ uid: candidateUid }) => (
      candidateUid !== blueprintUid
    ));
    return Boolean(blueprint);
  }

  cancelConstructionBuilding(building, { persist = false, notify = false } = {}) {
    if (!building?.underConstruction) return false;
    this.refundConstructionBlueprint(building.blueprintUid);
    const index = this.state.buildings.findIndex(({ uid: buildingUid }) => (
      buildingUid === building.uid
    ));
    if (index >= 0) this.state.buildings.splice(index, 1);
    if (this.selection?.uid === building.uid) this.selection = null;
    this.state.enemies.forEach((enemy) => { enemy.routeTimer = 0; });
    if (notify) this.showToast('蓝图已取消，已送达和搬运中的材料已全额退回');
    if (persist) this.save();
    return true;
  }

  reconcileConstructionBlueprints({ persist = false, notify = false } = {}) {
    const colony = this.state.colony;
    if (!colony) return false;
    let changed = false;
    for (const building of [...this.state.buildings]) {
      if (!building.underConstruction) continue;
      const blueprint = colony.blueprints.find(({ uid: blueprintUid }) => (
        blueprintUid === building.blueprintUid
      ));
      const invalid = building.destroyed
        || !blueprint
        || blueprint.cancelled
        || blueprint.cardId !== building.cardId;
      if (!invalid) continue;
      changed = this.cancelConstructionBuilding(building, { notify: false }) || changed;
    }
    const attachedBlueprintUids = new Set(this.state.buildings
      .filter(({ underConstruction, destroyed }) => underConstruction && !destroyed)
      .map(({ blueprintUid }) => blueprintUid));
    for (const blueprint of [...colony.blueprints]) {
      if (blueprint.complete) {
        const building = this.state.buildings.find(({ blueprintUid }) => (
          blueprintUid === blueprint.uid
        ));
        if (!building) {
          this.refundConstructionBlueprint(blueprint.uid);
          changed = true;
          continue;
        }
        colony.blueprints = colony.blueprints.filter(({ uid: blueprintUid }) => (
          blueprintUid !== blueprint.uid
        ));
        if (BUILDING_BY_ID[building.cardId]?.terrainProject) {
          this.completeTerrainProject(building, { persist: false, notify: false });
        } else {
          building.underConstruction = false;
          building.blueprintUid = null;
          building.buildProgress = 1;
          building.placedAt = this.time;
          building.hp = building.maxHp;
        }
        changed = true;
        continue;
      }
      if (attachedBlueprintUids.has(blueprint.uid)) continue;
      this.refundConstructionBlueprint(blueprint.uid);
      changed = true;
    }
    if (changed && notify) this.showToast('失效蓝图已清理，材料已全额退回');
    if (changed && persist) this.save();
    return changed;
  }

  completeTerrainProject(building, { persist = true, notify = true } = {}) {
    const colony = this.state.colony;
    const card = BUILDING_BY_ID[building.cardId];
    if (!colony || !card?.terrainProject) return false;
    const coveredNodes = colony.resourceNodes.filter((node) => (
      node.x === building.x && node.y === building.y
    ));
    const coveredNodeUids = new Set(coveredNodes.map(({ uid: nodeUid }) => nodeUid));
    for (const slime of colony.slimes) {
      if (coveredNodeUids.has(slime.job?.targetUid)) cancelColonySlimeWork(colony, slime);
    }
    const coveredAmount = coveredNodes.reduce((total, node) => total + Math.max(0, node.amount), 0);
    colony.resourceNodes = colony.resourceNodes.filter((node) => !coveredNodeUids.has(node.uid));
    setTerrainAt(colony, building.x, building.y, {
      kind: 'ground',
      terrainId: card.terrainProject.replacementTerrainId || 'ground',
      passable: true,
      buildable: true,
      harvestable: false,
      destructible: false,
    });
    const pavingKey = cellKey(building.x, building.y);
    if (!this.state.gelPavingCells.has(pavingKey)) {
      this.state.gelPavingCells.add(pavingKey);
      this.invalidateGelPavingRenderCache();
    }
    const buildingIndex = this.state.buildings.findIndex(({ uid: buildingUid }) => (
      buildingUid === building.uid
    ));
    if (buildingIndex >= 0) this.state.buildings.splice(buildingIndex, 1);
    if (this.selection?.uid === building.uid) this.selection = null;
    const position = this.cellCenter(building.x, building.y);
    this.spawnDynamicEffect('place', position.x, position.y, {
      color: card.color,
      accent: '#FFF0C4',
      intensity: 0.9,
    });
    if (notify) {
      this.showToast(
        coveredAmount > 0
          ? `铺块施工完成，该格剩余 ${coveredAmount} 份资源已被覆盖`
          : '铺块施工完成，该格现在可以建造',
        'good',
      );
    }
    if (persist) this.save();
    return true;
  }

  revealAroundActiveSlimes() {
    for (const survivor of this.state.survivors) {
      if (!Number.isFinite(survivor.x) || !Number.isFinite(survivor.y)) continue;
      const revealKey = cellKey(Math.round(survivor.x), Math.round(survivor.y));
      if (survivor.lastWorldRevealKey === revealKey) continue;
      survivor.lastWorldRevealKey = revealKey;
      this.revealWorldAround(survivor.x, survivor.y, 2);
    }
  }

  handleColonyEvents(events) {
    for (const event of events) {
      if (event.type === 'threat-hit') {
        const enemy = this.state.enemies.find((item) => item.uid === event.threatUid && !item.dead);
        const survivor = this.state.survivors.find((item) => item.uid === event.slimeUid);
        if (enemy && survivor) {
          this.playEntityAnimation(survivor, 'attack');
          this.damageEnemy(enemy, event.damage, survivor);
        }
      } else if (event.type === 'resource-deposited') {
        const position = this.cellCenter(
          Number.isFinite(event.x) ? event.x : CORE_CELL.x,
          Number.isFinite(event.y) ? event.y : CORE_CELL.y,
        );
        this.spawnDynamicEffect('place', position.x, position.y + 12 * this.camera.zoom, {
          color: event.resourceType === 'shard' ? PALETTE.crystal : event.resourceType === 'nectar' ? '#F6BE58' : PALETTE.heal,
          accent: '#FFF8E9',
          intensity: 0.72,
        });
        this.floatText(
          position.x,
          position.y - 42 * this.camera.zoom,
          `+${event.amount} ${COLONY_RESOURCE_LABEL[event.resourceType]}`,
          '#FFF8E9',
        );
      } else if (event.type === 'material-delivered') {
        const blueprint = this.state.colony.blueprints.find((item) => item.uid === event.blueprintUid);
        if (blueprint) {
          const position = this.cellCenter(blueprint.x, blueprint.y);
          this.spawnDynamicEffect('place', position.x, position.y, {
            color: event.resourceType === 'shard' ? PALETTE.crystal : '#61D6A2',
            accent: '#FFF8E9',
            intensity: 0.62,
          });
        }
      } else if (event.type === 'blueprint-completed') {
        const building = this.state.buildings.find((item) => item.blueprintUid === event.blueprintUid);
        this.state.colony.blueprints = this.state.colony.blueprints.filter(({ uid: blueprintUid }) => (
          blueprintUid !== event.blueprintUid
        ));
        if (building) {
          if (BUILDING_BY_ID[building.cardId]?.terrainProject) {
            this.completeTerrainProject(building);
            continue;
          }
          building.underConstruction = false;
          building.blueprintUid = null;
          building.buildProgress = 1;
          building.placedAt = this.time;
          building.hp = building.maxHp;
          const position = this.entityCanvasPosition(building);
          this.spawnDynamicEffect('place', position.x, position.y, {
            color: BUILDING_BY_ID[building.cardId].color,
            accent: '#FFF0C4',
            intensity: 1.35,
          });
          this.showToast(`${BUILDING_BY_ID[building.cardId].shortName}施工完成`, 'good');
          this.save();
        }
      } else if (event.type === 'resource-depleted' || event.type === 'terrain-cleared') {
        if (event.type === 'resource-depleted') {
          this.state.colony.resourceNodes = this.state.colony.resourceNodes
            .filter((node) => node.uid !== event.nodeUid && node.amount > 0);
        } else {
          this.state.expeditionProgress.activeClearTargets = (
            this.state.expeditionProgress.activeClearTargets || []
          ).filter((target) => target.x !== event.x || target.y !== event.y);
        }
        const position = this.cellCenter(event.x, event.y);
        this.spawnDynamicEffect('enemy-pop', position.x, position.y, {
          color: event.type === 'terrain-cleared' ? '#9EB8AF' : '#61D6A2',
          accent: '#FFF0C4',
          intensity: 0.9,
        });
        this.showToast(
          event.type === 'terrain-cleared' ? '脆壳岩已清理，土地可以建造了' : '资源采集完毕，露出了可用土地',
          'good',
        );
        this.save();
      } else if (event.type === 'slime-respawned') {
        this.showToast('史莱姆在小屋休养后重新出发', 'good');
      }
    }
  }

  updateContinuousThreatDirector(dt) {
    const director = this.state.colonyDirector;
    director.elapsed += dt;
    if (director.elapsed < director.nextPackAt) return;
    const active = this.state.enemies.filter((enemy) => !enemy.dead).length;
    if (active >= 30) {
      director.nextPackAt = director.elapsed + 4;
      return;
    }

    const tier = Math.floor(director.elapsed / 90);
    const count = Math.min(18, 6 + tier * 2);
    const entranceCount = Math.min(2, 1 + Math.floor(tier / 2));
    for (let index = 0; index < count; index += 1) {
      const entrance = WORLD.monsterEntrances[
        (director.packIndex + index % entranceCount) % WORLD.monsterEntrances.length
      ];
      const enemyId = tier >= 7 && index === count - 1
        ? 'enemy-acid-shell-king'
        : tier >= 3 && index % 6 === 0
          ? 'enemy-stone-lump'
          : tier >= 1 && index % 4 === 0
            ? 'enemy-windcap'
            : 'enemy-soft-biter';
      const offset = ((index % 5) - 2) * 0.12;
      const spawn = {
        x: entrance.x + (entrance.edge === 'north' || entrance.edge === 'south' ? offset : 0),
        y: entrance.y + (entrance.edge === 'west' || entrance.edge === 'east' ? offset : 0),
      };
      this.spawnEnemyAtWorld(enemyId, spawn, {
        hpMultiplier: enemyId === 'enemy-acid-shell-king' ? 0.62 : 0.42,
        damageMultiplier: enemyId === 'enemy-acid-shell-king' ? 0.62 : 0.45,
        continuous: true,
      });
    }
    director.packIndex += 1;
    director.nextPackAt = director.elapsed + Math.max(16, 27 - tier * 1.4);
    this.showToast(`荒野出现 ${count} 只弱小怪物，史莱姆会自动迎战`, 'danger', 2.6);
    this.audio.play('warning');
  }

  animationClipsFor(cardId) {
    return ANIMATION_CLIPS_BY_CARD_ID[cardId] || null;
  }

  entityFacing(entity, fallback = 1) {
    const defaultFacing = Number(fallback) < 0 ? -1 : 1;
    return entity?.facing === -1 || entity?.facing === 1
      ? entity.facing
      : defaultFacing;
  }

  faceEntityToward(entity, target, fallback = 1) {
    if (!entity) return Number(fallback) < 0 ? -1 : 1;
    const dx = Number(target?.x) - Number(entity.x);
    if (Number.isFinite(dx) && Math.abs(dx) > 0.001) {
      entity.facing = dx < 0 ? -1 : 1;
    } else if (entity.facing !== -1 && entity.facing !== 1) {
      entity.facing = Number(fallback) < 0 ? -1 : 1;
    }
    return entity.facing;
  }

  enemyDeathDuration(enemyOrCardId) {
    const cardId = typeof enemyOrCardId === 'string' ? enemyOrCardId : enemyOrCardId?.cardId;
    return ENEMY_DEATH_DURATION_BY_ID[cardId] ?? ENEMY_DEATH_DURATION_BY_ID['enemy-soft-biter'];
  }

  animatorFor(entity) {
    if (!entity?.uid) return null;
    const clips = this.animationClipsFor(entity.cardId);
    if (!clips) return null;
    const current = this.animators.get(entity.uid);
    if (current?.cardId === entity.cardId) return current.controller;
    const controller = new AnimationController(clips, {
      base: 'idle',
      transitionDuration: 0.06,
    });
    this.animators.set(entity.uid, { cardId: entity.cardId, controller, wasDowned: false });
    return controller;
  }

  playEntityAnimation(entity, name, options = {}) {
    return this.animatorFor(entity)?.play(name, options) || false;
  }

  startEntityAttack(entity, onHit) {
    const controller = this.animatorFor(entity);
    if (!controller) {
      onHit();
      return true;
    }
    if (!controller.play('attack')) return false;
    const hasHitEvent = this.animationClipsFor(entity.cardId)?.attack?.events
      .some((event) => event.name === 'hit');
    if (!hasHitEvent) {
      onHit();
      return true;
    }
    this.pendingAttackHits.set(entity.uid, { onHit });
    return true;
  }

  resolveEntityAnimationEvents(entity, controller, events) {
    const pending = this.pendingAttackHits.get(entity.uid);
    if (!pending) return;
    if (entity.dead || entity.downed) {
      this.pendingAttackHits.delete(entity.uid);
      return;
    }
    const hitEventFired = events.some((event) => event.clip === 'attack' && event.name === 'hit');
    if (!hitEventFired) {
      if (controller.current !== 'attack') this.pendingAttackHits.delete(entity.uid);
      return;
    }
    this.pendingAttackHits.delete(entity.uid);
    pending.onHit();
  }

  entityAnimationPose(entity) {
    return this.animatorFor(entity)?.sample() || null;
  }

  expressionMixerFor(entity) {
    if (!entity?.uid || !this.animationClipsFor(entity.cardId)) return null;
    const current = this.expressionMixers.get(entity.uid);
    if (current?.cardId === entity.cardId) return current.mixer;
    const mixer = new ExpressionMixer({ ownerId: entity.cardId });
    this.expressionMixers.set(entity.uid, { cardId: entity.cardId, mixer });
    return mixer;
  }

  entityExpressionSample(entity) {
    return this.expressionMixerFor(entity)?.sample() || null;
  }

  updateEntityExpression(entity, controller, events, dt) {
    const mixer = this.expressionMixerFor(entity);
    if (!mixer) return;
    mixer.setAnimationContext(controller, {
      events,
      currentTime: this.animationTime,
    });
    mixer.tick(dt);
  }

  updateEntityAnimations(dt) {
    this.animationTime += dt;
    const liveIds = new Set();
    for (const survivor of this.state.survivors) {
      liveIds.add(survivor.uid);
      const previous = this.animators.get(survivor.uid);
      if (!survivor.downed && previous?.wasDowned) {
        this.animators.delete(survivor.uid);
        this.expressionMixers.delete(survivor.uid);
      }
      const controller = this.animatorFor(survivor);
      if (!controller) continue;
      this.animators.get(survivor.uid).wasDowned = survivor.downed;
      const survivorClips = this.animationClipsFor(survivor.cardId);
      controller.setBase(survivor.visualMoving && survivorClips?.move ? 'move' : 'idle');
      if (survivor.downed) controller.play('downed', { restart: false });
      controller.update(dt);
      const events = controller.drainEvents();
      this.resolveEntityAnimationEvents(survivor, controller, events);
      this.updateEntityExpression(survivor, controller, events, dt);
    }
    const animatedEnemies = [
      ...this.state.enemies,
      ...(this.state.worldExpedition?.enemies || []),
    ];
    for (const enemy of animatedEnemies) {
      liveIds.add(enemy.uid);
      if (enemy.dead) enemy.deathElapsed = (enemy.deathElapsed || 0) + dt;
      const controller = this.animatorFor(enemy);
      if (!controller) continue;
      if (!enemy.dead) {
        const enemyClips = this.animationClipsFor(enemy.cardId);
        const base = enemy.cardId === 'enemy-acid-shell-king' && enemy.telegraph > 0
          ? 'charge'
          : (enemy.visualMoving && enemyClips?.move ? 'move' : 'idle');
        controller.setBase(base);
      }
      controller.update(dt);
      const events = controller.drainEvents();
      this.resolveEntityAnimationEvents(enemy, controller, events);
      this.updateEntityExpression(enemy, controller, events, dt);
    }
    for (const uid of this.animators.keys()) {
      if (!liveIds.has(uid)) {
        this.animators.delete(uid);
        this.expressionMixers.delete(uid);
        this.pendingAttackHits.delete(uid);
      }
    }
    for (const uid of this.expressionMixers.keys()) {
      if (!liveIds.has(uid)) this.expressionMixers.delete(uid);
    }
  }

  updateBattle(dt) {
    this.state.waveElapsed += dt;
    for (const spawn of this.state.spawnQueue || []) {
      if (spawn.at <= this.state.waveElapsed && !this.state.spawned.has(spawn.key)) {
        this.state.spawned.add(spawn.key);
        const tuning = this.isExpeditionActive()
          ? this.state.expeditionRun.currentEncounter?.tuning || {}
          : {};
        this.spawnEnemy(spawn.enemyId, spawn.row, {
          hpMultiplier: tuning.enemyHpMultiplier,
          damageMultiplier: tuning.enemyDamageMultiplier,
          expedition: this.isExpeditionActive(),
        });
      }
    }

    this.updateDeployables(dt);
    this.updateTerrain(dt);
    if (this.isExpeditionActive()) this.updateExpeditionSquad(dt);
    this.updateSurvivors(dt);
    this.updateBuildings(dt);
    this.updateEnemies(dt);

    // A core breach or boss ability can settle an expedition from inside the
    // enemy update. Do not let the rest of this frame fall through into the
    // legacy wave-clear path after the phase has changed to result.
    if (this.state.phase !== 'battle') return;

    if (this.isExpeditionActive()
      && this.state.survivors.length
      && this.state.survivors.every((survivor) => survivor.downed)) {
      this.finishExpeditionEncounter(false);
      return;
    }

    const allSpawned = this.state.spawned.size === (this.state.spawnQueue?.length || 0);
    if (allSpawned && this.state.enemies.length === 0) {
      if (this.isExpeditionActive()) this.finishExpeditionEncounter(true);
      else this.finishWave();
    }
  }

  updateExpeditionSquad(dt) {
    const livingEnemies = this.state.enemies.filter((enemy) => !enemy.dead);
    const rallyPoints = [
      { x: CORE_CELL.x - 1.4, y: CORE_CELL.y - 1.15 },
      { x: CORE_CELL.x - 1.75, y: CORE_CELL.y + 0.15 },
      { x: CORE_CELL.x - 1.35, y: CORE_CELL.y + 1.35 },
    ];
    for (let index = 0; index < this.state.survivors.length; index += 1) {
      const survivor = this.state.survivors[index];
      survivor.visualMoving = false;
      if (survivor.downed) continue;
      const controller = this.animators.get(survivor.uid)?.controller;
      if (controller?.current === 'attack') continue;
      const card = SURVIVOR_BY_ID[survivor.cardId];
      const target = livingEnemies
        .slice()
        .sort((left, right) => distance(survivor, left) - distance(survivor, right))[0];
      const destination = target || rallyPoints[index] || rallyPoints[0];
      const desiredRange = target
        ? clamp(card.attack.rangeTiles * 0.72, 0.78, 2.35)
        : 0.16;
      if (distance(survivor, destination) <= desiredRange) continue;

      survivor.expeditionRouteTimer = (survivor.expeditionRouteTimer || 0) - dt;
      const goalKey = target?.uid || `rally-${index}`;
      if (survivor.expeditionRouteTimer <= 0
        || survivor.expeditionRouteGoal !== goalKey
        || !survivor.expeditionPath?.length) {
        const from = this.nearestCell(survivor);
        const to = {
          x: clamp(Math.round(destination.x), 0, WORLD.width - 1),
          y: clamp(Math.round(destination.y), 0, WORLD.height - 1),
        };
        survivor.expeditionPath = routeFor(
          [],
          from,
          to,
          this.runtimeTerrain,
          { allowBuildingBreaching: false },
        );
        survivor.expeditionRouteTimer = 0.42;
        survivor.expeditionRouteGoal = goalKey;
      }

      const nextCell = survivor.expeditionPath?.[1];
      const moveTarget = nextCell || destination;
      this.faceEntityToward(survivor, moveTarget, 1);
      const dx = moveTarget.x - survivor.x;
      const dy = moveTarget.y - survivor.y;
      const length = Math.hypot(dx, dy);
      if (length <= 0.035) {
        if (nextCell) survivor.expeditionPath.shift();
        continue;
      }
      const speed = survivor.expeditionMoveSpeed || 1.35;
      const amount = Math.min(length, speed * dt);
      survivor.x = clamp(survivor.x + (dx / length) * amount, 0, WORLD.width - 0.01);
      survivor.y = clamp(survivor.y + (dy / length) * amount, 0, WORLD.height - 0.01);
      survivor.visualMoving = amount > 0;
      if (nextCell && amount >= length - 0.001) survivor.expeditionPath.shift();
    }
  }

  spawnEnemy(enemyId, row, options = {}) {
    const worldRow = clamp(CORE_CELL.y - 3 + row, 0, WORLD.height - 1);
    return this.spawnEnemyAtWorld(enemyId, { x: WORLD.width - 0.35, y: worldRow }, options);
  }

  spawnEnemyAtWorld(enemyId, position, options = {}) {
    const card = ENEMY_BY_ID[enemyId];
    if (!card) return null;
    const hpMultiplier = clamp(Number(options.hpMultiplier) || 1, 0.1, 3);
    const maxHp = Math.max(1, Math.round(card.hp * hpMultiplier));
    const enemy = {
      uid: uid('enemy'), cardId: enemyId,
      x: clamp(Number(position?.x) || 0, 0, WORLD.width - 0.01),
      y: clamp(Number(position?.y) || 0, 0, WORLD.height - 0.01),
      facing: -1,
      hp: maxHp, maxHp,
      speed: card.speed, dead: false,
      damageMultiplier: clamp(Number(options.damageMultiplier) || 1, 0.1, 3),
      continuous: Boolean(options.continuous),
      expedition: Boolean(options.expedition),
      attackTimer: 0, routeTimer: 0, path: [],
      stagger: 0, rooted: 0, eating: 0,
      honeyEntries: {}, lastCell: null,
      marked: false, hitFlash: 0,
      deathElapsed: 0,
      abilityTimer: card.ability?.cooldownSeconds || 0,
      telegraph: 0, telegraphTarget: null,
      spawnAt: this.time,
    };
    const weatherScout = this.state.buildings.find((building) => (
      building.cardId === 'building-weather-scout' && buildingIsOperational(building)
    ));
    if (card.elite && weatherScout) {
      enemy.marked = true;
      enemy.markedDamageTakenMultiplier = BUILDING_BY_ID[
        weatherScout.cardId
      ].effect.markedDamageTakenMultiplier;
      this.showToast('气象台已标记精英目标', 'good');
    }
    this.state.enemies.push(enemy);
    const spawnPosition = this.entityCanvasPosition(enemy);
    this.spawnDynamicEffect('spawn', spawnPosition.x, spawnPosition.y, {
      color: card.color,
      accent: card.elite ? '#FFE27A' : '#EFD9FF',
      layer: 'back',
      intensity: card.elite ? 1.55 : 1,
    });
    this.spawnParticles(spawnPosition.x, spawnPosition.y + 28, '#9D7CA8', 8, 55);
    return enemy;
  }

  updateDeployables(dt) {
    this.state.deployables.forEach((item) => {
      item.life = item.life == null ? Infinity : item.life - dt;
    });
    this.state.deployables = this.state.deployables.filter((item) => item.life > 0 && !item.consumed);
  }

  updateTerrain(dt) {
    this.state.terrain.forEach((terrain) => {
      terrain.life = terrain.life == null ? Infinity : terrain.life - dt;
    });
    this.state.terrain = this.state.terrain.filter((terrain) => terrain.life > 0);
  }

  updateSurvivors(dt) {
    for (const survivor of this.state.survivors) {
      if (this.isWorldExpeditionMember(survivor.uid)) continue;
      if (survivor.downed) continue;
      const card = SURVIVOR_BY_ID[survivor.cardId];
      survivor.cooldown -= dt;
      if (survivor.cooldown > 0) continue;
      const acted = this.performSurvivorAction(survivor);
      survivor.cooldown = acted
        ? card.attack.intervalSeconds * (survivor.expeditionAttackIntervalMultiplier || 1)
        : 0.18;
    }
  }

  performSurvivorAction(survivor, forced = false) {
    const card = SURVIVOR_BY_ID[survivor.cardId];
    if (card.id === 'survivor-moss-sprout' && (survivor.actionCount + 1) % card.ability.actionsRequired === 0) {
      const healed = this.sproutHeal(survivor, card);
      if (healed) {
        this.playEntityAnimation(survivor, 'attack');
        survivor.actionCount += 1;
        this.registerFriendlyAction();
        return true;
      }
    }

    const targets = this.findTargetsForAttack(survivor, card.attack);
    if (!targets.length) return false;
    const maxTargets = Math.max(
      card.attack.pierce || 1,
      1 + (survivor.expeditionExtraProjectile || 0),
      1 + (survivor.expeditionBubbleChainTargets || 0),
    );
    const attackTargets = targets.slice(0, maxTargets);
    this.faceEntityToward(survivor, attackTargets[0], 1);
    const nextAttackCount = survivor.attackCount + 1;
    const nextHitCount = survivor.hitCount + 1;
    const crystalCell = card.id === 'survivor-crystal-pin'
      && nextAttackCount % card.ability.attacksRequired === 0
      ? this.nearestCell(attackTargets.at(-1))
      : null;
    const bubblePush = card.id === 'survivor-bubble-float'
      && nextHitCount % card.ability.hitsRequired === 0;
    const hitStarted = this.startEntityAttack(survivor, () => {
      attackTargets.forEach((enemy, index) => {
        const secondaryMultiplier = index === 0
          ? 1
          : survivor.expeditionSecondaryDamageMultiplier
            || survivor.expeditionChainedDamageMultiplier
            || 0.55;
        this.damageEnemy(enemy, card.attack.damage * secondaryMultiplier, survivor);
      });
      if (crystalCell) {
        this.state.terrain.push({ type: 'crystal', x: crystalCell.x, y: crystalCell.y, life: card.ability.spikeLifetimeSeconds, damage: card.ability.spikeDamage });
        const position = this.cellCenter(crystalCell.x, crystalCell.y);
        this.spawnParticles(position.x, position.y, PALETTE.crystal, 7, 40);
      }
      if (bubblePush) {
        this.pushEnemy(attackTargets[0], card.ability.knockbackTiles, 0, card.ability);
        this.audio.play('bubble');
      }
    });
    if (!hitStarted) return false;
    attackTargets.forEach((enemy, index) => {
      const projectileType = card.id.includes('crystal')
        ? 'crystal'
        : card.id.includes('bubble')
          ? 'bubble'
          : card.id.includes('moss-sprout')
            ? 'seed'
            : 'goo';
      this.launchProjectile(survivor, enemy, projectileType, index * 0.04);
    });
    survivor.actionCount += 1;
    survivor.attackCount = nextAttackCount;
    survivor.hitCount = nextHitCount;
    this.registerFriendlyAction();
    if (!forced) this.audio.play('shoot');
    return true;
  }

  sproutHeal(survivor, card) {
    const allies = this.state.survivors
      .filter((target) => !target.downed && distance(survivor, target) <= card.ability.targetRangeTiles)
      .map((target) => ({ kind: 'survivor', target, ratio: target.hp / target.maxHp }));
    const structures = this.state.buildings
      .filter((target) => buildingIsOperational(target)
        && distance(survivor, target) <= card.ability.targetRangeTiles)
      .map((target) => ({ kind: 'building', target, ratio: target.hp / target.maxHp }));
    const choice = [...allies, ...structures].sort((a, b) => a.ratio - b.ratio)[0];
    if (!choice) return false;
    this.faceEntityToward(survivor, choice.target, 1);
    const healAmount = card.ability.heal * (survivor.expeditionHealMultiplier || 1);
    if (choice.ratio >= 0.995) choice.target.seed = Math.max(choice.target.seed || 0, card.ability.fullHealthShield);
    else choice.target.hp = Math.min(choice.target.maxHp, choice.target.hp + healAmount);
    if (survivor.expeditionHealSplashPercent > 0) {
      this.state.survivors
        .filter((ally) => ally.uid !== choice.target.uid && !ally.downed)
        .forEach((ally) => {
          ally.hp = Math.min(
            ally.maxHp,
            ally.hp + healAmount * survivor.expeditionHealSplashPercent,
          );
        });
    }
    const position = this.entityCanvasPosition(choice.target);
    this.spawnDynamicEffect('heal', position.x, position.y - 28, {
      color: PALETTE.heal,
      accent: '#F4FFD2',
      intensity: 1,
    });
    this.spawnParticles(position.x, position.y - 25, PALETTE.heal, 10, 45);
    this.floatText(position.x, position.y - 40, choice.ratio >= 0.995 ? '萌芽' : `+${Math.round(healAmount)}`, PALETTE.heal);
    this.audio.play('heal');
    return true;
  }

  updateBuildings(dt) {
    for (const building of this.state.buildings) {
      building.poisoned = Math.max(0, (building.poisoned || 0) - dt);
      if (building.destroyed || building.underConstruction) continue;
      const card = BUILDING_BY_ID[building.cardId];
      if (!card.attack) continue;
      building.cooldown -= dt;
      if (building.cooldown > 0) continue;
      const target = this.findLaneTargets(building, card.attack.rangeTiles)[0];
      if (!target) {
        building.cooldown = 0.15;
        continue;
      }
      building.shotCount += 1;
      this.launchProjectile(building, target, 'bubble');
      this.damageEnemy(target, card.attack.damage, building);
      if (building.shotCount % card.effect.pushEveryShots === 0) {
        this.pushEnemy(target, card.effect.knockbackTiles, 0, card.effect);
        this.audio.play('bubble');
      }
      building.cooldown = card.attack.intervalSeconds;
      this.registerFriendlyAction();
    }
  }

  updateEnemies(dt) {
    for (const enemy of [...this.state.enemies]) {
      if (this.state.phase !== 'battle' && this.state.phase !== 'build') break;
      if (enemy.dead) continue;
      enemy.visualMoving = false;
      const card = ENEMY_BY_ID[enemy.cardId];
      enemy.stagger = Math.max(0, enemy.stagger - dt);
      enemy.rooted = Math.max(0, enemy.rooted - dt);
      enemy.bubbleStatus = Math.max(0, (enemy.bubbleStatus || 0) - dt);
      enemy.attackTimer = Math.max(0, enemy.attackTimer - dt);
      enemy.routeTimer -= dt;

      if (card.ability) this.updateEnemyAbility(enemy, card, dt);
      if (enemy.dead || enemy.stagger > 0 || enemy.rooted > 0 || enemy.telegraph > 0) continue;
      if (enemy.eating > 0) {
        enemy.eating -= dt;
        continue;
      }

      const current = this.nearestCell(enemy);
      const lure = this.findLureForEnemy(enemy);
      if (lure && current.x === lure.x && current.y === lure.y) {
        lure.consumed = true;
        enemy.eating = lure.eating;
        enemy.routeGoal = null;
        continue;
      }
      if (enemy.routeTimer <= 0 || !enemy.path?.length || enemy.routeGoal !== lure?.uid) {
        enemy.path = routeFor(
          this.state.buildings,
          current,
          lure ? { x: lure.x, y: lure.y } : null,
          this.runtimeTerrain,
        );
        enemy.routeTimer = 0.55;
        enemy.routeGoal = lure?.uid || null;
      }

      const next = enemy.path?.[1];
      const reachedCore = distance(enemy, CORE_CELL) < 0.68
        || (!next && current.x === CORE_CELL.x && current.y === CORE_CELL.y);
      if (reachedCore) {
        this.faceEntityToward(enemy, CORE_CELL, -1);
        if (enemy.attackTimer <= 0) {
          const started = this.startEntityAttack(enemy, () => {
            if (this.state.coreHp > 0) this.damageCore(this.enemyDamage(enemy, card.damage));
          });
          if (started) enemy.attackTimer = card.attackIntervalSeconds;
        }
        continue;
      }
      if (!next) {
        enemy.routeTimer = 0;
        continue;
      }

      const blocker = operationalBuildingAt(this.state.buildings, next.x, next.y);
      if (blocker && BUILDING_BY_ID[blocker.cardId].solid) {
        this.faceEntityToward(enemy, blocker, -1);
        if (blocker.cardId === 'building-bouncy-fence' && blocker.fenceTrigger > 0) {
          blocker.fenceTrigger -= 1;
          this.pushEnemy(enemy, BUILDING_BY_ID[blocker.cardId].effect.knockbackTiles, 0, BUILDING_BY_ID[blocker.cardId].effect);
          enemy.routeTimer = 0;
          this.spawnParticles(this.cellCenter(next.x, next.y).x, this.cellCenter(next.x, next.y).y, '#EAB653', 10, 65);
          continue;
        }
        if (enemy.attackTimer <= 0) {
          const started = this.startEntityAttack(enemy, () => {
            if (buildingIsOperational(blocker)) this.damageBuilding(blocker, this.enemyDamage(enemy, card.damage));
          });
          if (started) enemy.attackTimer = card.attackIntervalSeconds;
        }
        continue;
      }

      const defender = this.state.survivors.find((survivor) => (
        !survivor.downed && distance(survivor, next) < 0.58
      ));
      if (defender && (SURVIVOR_BY_ID[defender.cardId].blockCount > 0 || Math.abs(enemy.x - next.x) < 0.7)) {
        this.faceEntityToward(enemy, defender, -1);
        if (enemy.attackTimer <= 0) {
          const started = this.startEntityAttack(enemy, () => {
            if (!defender.downed) this.damageSurvivor(defender, this.enemyDamage(enemy, card.damage));
          });
          if (started) enemy.attackTimer = card.attackIntervalSeconds;
        }
        continue;
      }

      const speed = card.speed * this.enemySpeedMultiplier(enemy);
      const arrived = this.moveEnemyToward(enemy, next, dt, speed);
      if (arrived) {
        enemy.path.shift();
        enemy.routeTimer = 0;
        this.triggerEnemyCell(enemy, next);
      }
    }
    this.state.enemies = this.state.enemies.filter(
      (enemy) => !enemy.dead || (enemy.deathElapsed || 0) < this.enemyDeathDuration(enemy),
    );
  }

  updateEnemyAbility(enemy, card, dt) {
    if (enemy.stagger > 0 && enemy.telegraph > 0) {
      enemy.telegraph = 0;
      enemy.telegraphTarget = null;
      enemy.abilityTimer = card.ability.cooldownSeconds * 0.65;
      this.playEntityAnimation(enemy, 'hurt');
      this.floatText(this.entityCanvasPosition(enemy).x, this.entityCanvasPosition(enemy).y - 70, '打断！', PALETTE.shield);
      return;
    }
    if (enemy.telegraph > 0) {
      enemy.telegraph -= dt;
      if (enemy.telegraph <= 0 && enemy.telegraphTarget) {
        const target = this.isExpeditionActive()
          ? this.state.survivors.find((survivor) => (
            survivor.uid === enemy.telegraphTarget && !survivor.downed
          ))
          : this.state.buildings.find((building) => (
            building.uid === enemy.telegraphTarget && buildingIsOperational(building)
          ));
        if (target) {
          this.launchProjectile(enemy, target, 'acid');
          target.poisoned = Math.max(target.poisoned || 0, 1.2);
          if (this.isExpeditionActive()) {
            this.damageSurvivor(target, this.enemyDamage(enemy, card.ability.buildingDamage * 0.72));
          } else {
            this.damageBuilding(target, this.enemyDamage(enemy, card.ability.buildingDamage));
          }
          const splashTargets = this.isExpeditionActive()
            ? this.state.survivors.filter((survivor) => !survivor.downed)
            : this.state.buildings.filter(buildingIsOperational);
          for (const other of splashTargets) {
            if (other.uid !== target.uid && distance(other, target) <= card.ability.splashRadiusTiles) {
              other.poisoned = Math.max(other.poisoned || 0, 0.8);
              if (this.isExpeditionActive()) {
                this.damageSurvivor(other, this.enemyDamage(enemy, card.ability.buildingDamage * 0.32));
              } else {
                this.damageBuilding(other, this.enemyDamage(enemy, card.ability.buildingDamage * 0.45));
              }
            }
          }
          const position = this.entityCanvasPosition(target);
          this.spawnParticles(position.x, position.y, '#8DAF55', 15, 85);
          this.shake = 0.55;
          this.audio.play('hit');
        }
        enemy.telegraphTarget = null;
        enemy.abilityTimer = card.ability.cooldownSeconds;
      }
      return;
    }
    enemy.abilityTimer -= dt;
    if (enemy.abilityTimer <= 0) {
      const candidates = this.isExpeditionActive()
        ? this.state.survivors.filter((survivor) => !survivor.downed)
        : this.state.buildings.filter(buildingIsOperational);
      const target = candidates.sort((a, b) => distance(enemy, a) - distance(enemy, b))[0];
      if (target) {
        this.faceEntityToward(enemy, target, -1);
        enemy.telegraph = card.ability.telegraphSeconds;
        enemy.telegraphTarget = target.uid;
        this.showToast(
          this.isExpeditionActive()
            ? '蜗王锁定了远征队！泡泡击退可以打断蓄力'
            : '蜗王正在蓄力！用击退制造失衡可打断',
          'danger',
          2.4,
        );
        this.audio.play('warning');
      }
    }
  }

  activeEnemyPool(entity = null) {
    const worldExpedition = this.state.worldExpedition;
    const belongsToWorldEncounter = Boolean(worldExpedition?.status === 'battle' && entity && (
      worldExpedition.squadUids?.includes(entity.uid)
      || worldExpedition.enemies?.some((enemy) => enemy.uid === entity.uid)
    ));
    if (belongsToWorldEncounter) return worldExpedition.enemies || [];
    return this.state.enemies;
  }

  findTargetsForAttack(attacker, attack) {
    const enemyPool = this.activeEnemyPool(attacker);
    if (this.state.phase === 'build' || this.isExpeditionActive()) {
      return enemyPool
        .filter((enemy) => !enemy.dead && distance(attacker, enemy) <= attack.rangeTiles)
        .sort((a, b) => distance(attacker, a) - distance(attacker, b));
    }
    if (attack.targetRule === 'first-in-lane') return this.findLaneTargets(attacker, attack.rangeTiles);
    return enemyPool
      .filter((enemy) => !enemy.dead && distance(attacker, enemy) <= attack.rangeTiles && enemy.x >= attacker.x - 0.7)
      .sort((a, b) => a.x - b.x || distance(attacker, a) - distance(attacker, b));
  }

  findLaneTargets(attacker, rangeTiles) {
    const enemyPool = this.activeEnemyPool(attacker);
    if (this.state.phase === 'build' || this.isExpeditionActive()) {
      return enemyPool
        .filter((enemy) => !enemy.dead && distance(attacker, enemy) <= rangeTiles)
        .sort((a, b) => distance(attacker, a) - distance(attacker, b));
    }
    return enemyPool
      .filter((enemy) => !enemy.dead && Math.abs(enemy.y - attacker.y) < 0.48 && enemy.x >= attacker.x - 0.55 && enemy.x - attacker.x <= rangeTiles)
      .sort((a, b) => a.x - b.x);
  }

  registerFriendlyAction() {
    this.state.friendlyActions += 1;
    this.state.actionEnergyProgress += 1;
    if (this.state.actionEnergyProgress >= 4) {
      this.state.actionEnergyProgress -= 4;
      this.state.energy = Math.min(10, this.state.energy + 1);
    }
  }

  enemySpeedMultiplier(enemy) {
    const cell = this.nearestCell(enemy);
    let multiplier = 1;
    const building = operationalBuildingAt(this.state.buildings, cell.x, cell.y);
    if (building?.cardId === 'building-honey-plot') multiplier *= BUILDING_BY_ID[building.cardId].effect.speedMultiplier;
    if (this.state.terrain.some((terrain) => terrain.type === 'honey' && terrain.x === cell.x && terrain.y === cell.y)) multiplier *= 0.55;
    return multiplier;
  }

  findLureForEnemy(enemy) {
    return this.state.deployables.find((item) => item.type === 'lure' && !item.consumed && distance(enemy, item) <= item.range);
  }

  moveEnemyToward(enemy, target, dt, speed) {
    this.faceEntityToward(enemy, target, -1);
    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0.035) {
      enemy.x = target.x;
      enemy.y = target.y;
      return true;
    }
    const amount = Math.min(length, speed * dt);
    enemy.x += (dx / length) * amount;
    enemy.y += (dy / length) * amount;
    enemy.visualMoving = amount > 0;
    return amount >= length - 0.001;
  }

  triggerEnemyCell(enemy, cell) {
    const key = cellKey(cell.x, cell.y);
    if (enemy.lastCell === key) return;
    enemy.lastCell = key;

    const pad = this.state.deployables.find((item) => item.type === 'pad' && item.x === cell.x && item.y === cell.y && !item.consumed);
    if (pad) {
      pad.consumed = true;
      this.pushEnemy(enemy, pad.dx * pad.tiles, pad.dy * pad.tiles, { maxPushWeight: 1, heavyStaggerSeconds: 1.2, collisionDamage: 16 });
      this.audio.play('bubble');
    }
    const lure = this.state.deployables.find((item) => item.type === 'lure' && item.x === cell.x && item.y === cell.y && !item.consumed);
    if (lure) {
      lure.consumed = true;
      enemy.eating = lure.eating;
      enemy.routeGoal = null;
      this.floatText(this.entityCanvasPosition(enemy).x, this.entityCanvasPosition(enemy).y - 46, '真香…', '#E3A83C');
    }
    const honey = this.state.terrain.find((terrain) => terrain.type === 'honey' && terrain.x === cell.x && terrain.y === cell.y);
    if (honey) {
      enemy.honeyEntries[key] = (enemy.honeyEntries[key] || 0) + 1;
      if (enemy.honeyEntries[key] >= 2) {
        enemy.rooted = Math.max(enemy.rooted, 1.4);
        enemy.honeyEntries[key] = 0;
        this.floatText(this.entityCanvasPosition(enemy).x, this.entityCanvasPosition(enemy).y - 42, '黏住', '#D99C2E');
      }
    }
    const spike = this.state.terrain.find((terrain) => terrain.type === 'crystal' && terrain.x === cell.x && terrain.y === cell.y);
    if (spike && enemy.justPushed) {
      this.damageEnemy(enemy, spike.damage, spike);
      spike.life = 0;
      this.spawnParticles(this.cellCenter(cell.x, cell.y).x, this.cellCenter(cell.x, cell.y).y, PALETTE.crystal, 10, 70);
    }
    const contact = this.state.survivors.find((survivor) => !survivor.downed && survivor.x === cell.x && survivor.y === cell.y);
    if (contact && SURVIVOR_BY_ID[contact.cardId].blockCount === 0) {
      this.damageSurvivor(
        contact,
        this.enemyDamage(enemy, ENEMY_BY_ID[enemy.cardId].damage * 0.65),
      );
    }
    enemy.justPushed = false;
  }

  damageEnemy(enemy, amount, source) {
    if (enemy.dead) return;
    const multiplier = enemy.marked
      ? enemy.markedDamageTakenMultiplier || 1.15
      : 1;
    const damage = Math.round(
      amount * multiplier * (source?.expeditionDamageMultiplier || 1),
    );
    const enemyCard = ENEMY_BY_ID[enemy.cardId];
    const sourceColor = SURVIVOR_BY_ID[source?.cardId]?.color
      || BUILDING_BY_ID[source?.cardId]?.color
      || (source?.type === 'crystal' ? PALETTE.crystal : null)
      || (source?.type === 'pad' ? PALETTE.bubble : null)
      || source?.color
      || enemyCard.color;
    enemy.hp -= damage;
    enemy.hitFlash = 1;
    const position = this.entityCanvasPosition(enemy);
    this.floatText(position.x, position.y - 40, `-${damage}`, enemy.marked ? '#F4C85E' : '#FFF8E9');
    this.spawnDynamicEffect('impact', position.x, position.y - 24, {
      color: sourceColor,
      accent: enemy.marked ? '#FFE27A' : '#FFF8E9',
      intensity: 0.72 + clamp(damage / Math.max(1, enemy.maxHp), 0, 0.35),
    });
    this.spawnParticles(
      position.x,
      position.y - 10,
      enemyCard.color,
      4,
      32,
      source?.cardId === 'survivor-shell-shell' ? 'effect-particle-goo-drop' : null,
    );
    if (enemy.hp <= 0) {
      enemy.dead = true;
      this.pendingAttackHits.delete(enemy.uid);
      enemy.diedAt = this.time;
      enemy.deathElapsed = 0;
      this.playEntityAnimation(enemy, 'death');
      this.state.kills += 1;
      this.state.energy = Math.min(10, this.state.energy + (enemyCard.elite ? 2 : 1));
      this.spawnDynamicEffect('enemy-pop', position.x, position.y - (enemyCard.elite ? 38 : 20), {
        color: enemyCard.color,
        accent: enemyCard.elite ? '#FFE27A' : '#FFF8E9',
        intensity: enemyCard.elite ? 1.8 : 1,
        duration: enemyCard.elite ? 0.82 : undefined,
      });
      this.spawnParticles(position.x, position.y - 8, '#8B7395', enemyCard.elite ? 18 : 9, 75);
      this.shake = Math.max(this.shake, enemyCard.elite ? 0.52 : 0.2);
      const burstDamage = source?.expeditionDefeatedBurstDamage || 0;
      const burstRadius = source?.expeditionBurstRadiusTiles || 0;
      if (burstDamage > 0 && burstRadius > 0 && !enemy.expeditionBurstResolved) {
        enemy.expeditionBurstResolved = true;
        this.activeEnemyPool(source)
          .filter((other) => !other.dead && distance(enemy, other) <= burstRadius)
          .forEach((other) => this.damageEnemy(other, burstDamage, source));
      }
    } else if (!this.pendingAttackHits.has(enemy.uid)) {
      this.playEntityAnimation(enemy, 'hurt');
      this.shake = Math.max(this.shake, 0.08);
    }
  }

  enemyDamage(enemy, amount) {
    return Math.max(1, Math.round(amount * (enemy?.damageMultiplier ?? 1)));
  }

  damageBuilding(building, amount) {
    if (!buildingIsOperational(building)) return false;
    this.damageFriendly(building, amount, 'building');
    return true;
  }

  damageSurvivor(survivor, amount) {
    survivor.hitFlash = 1;
    const shelter = this.state.buildings.find((building) => {
      if (building.cardId !== 'building-mushroom-home' || !buildingIsOperational(building)) {
        return false;
      }
      const effect = BUILDING_BY_ID[building.cardId].effect;
      return distance(building, survivor) <= effect.protectionRadiusTiles;
    });
    const multiplier = shelter
      ? BUILDING_BY_ID[shelter.cardId].effect.allyDamageMultiplier
      : 1;
    this.damageFriendly(survivor, amount * multiplier, 'survivor');
  }

  damageFriendly(target, amount, kind) {
    if (kind === 'building' && !buildingIsOperational(target)) return;
    let damage = amount;
    if ((target.shield || 0) > 0) {
      const shieldBefore = target.shield;
      const absorbed = Math.min(target.shield, damage);
      target.shield -= absorbed;
      damage -= absorbed;
      if (shieldBefore > 0 && target.shield <= 0) {
        target.shield = 0;
        const shieldPosition = this.entityCanvasPosition(target);
        this.spawnDynamicEffect(
          'shield-break',
          shieldPosition.x,
          shieldPosition.y - (kind === 'building' ? 38 : 30),
          {
            color: PALETTE.shield,
            accent: '#E8FFFF',
            intensity: kind === 'building' ? 1.2 : 1,
          },
        );
      }
      if (target.shield <= 0 && kind === 'survivor' && target.expeditionShieldBreakDamage > 0) {
        const nearby = this.activeEnemyPool(target)
          .filter((enemy) => !enemy.dead)
          .sort((left, right) => distance(target, left) - distance(target, right))[0];
        if (nearby) this.damageEnemy(nearby, target.expeditionShieldBreakDamage, target);
      }
      if (target.shield <= 0 && kind === 'survivor' && target.cardId === 'survivor-shell-shell') {
        const nearby = this.activeEnemyPool(target)
          .find((enemy) => !enemy.dead && distance(enemy, target) <= 1.2);
        if (nearby) this.pushEnemy(nearby, 1, 0, SURVIVOR_BY_ID[target.cardId].ability);
      }
    }
    if (damage <= 0) return;
    target.hp -= damage;
    if (kind === 'survivor' && !this.pendingAttackHits.has(target.uid)) {
      this.playEntityAnimation(target, 'hurt');
    }
    const position = this.entityCanvasPosition(target);
    this.floatText(position.x, position.y - 44, `-${Math.round(damage)}`, PALETTE.danger);
    if (target.hp > 0) return;
    if (kind === 'survivor' && target.expeditionLethalProtectionHits > 0) {
      target.expeditionLethalProtectionHits -= 1;
      target.hp = Math.max(1, target.maxHp * (target.expeditionProtectionHealPercent || 0.25));
      this.floatText(position.x, position.y - 66, '最后一弹', PALETTE.heal);
      this.audio.play('heal');
      return;
    }
    if ((target.seed || 0) > 0) {
      target.seed = 0;
      target.hp = 1;
      this.floatText(position.x, position.y - 66, '萌芽守护', PALETTE.heal);
      this.audio.play('heal');
      return;
    }
    if (kind === 'building') {
      target.destroyed = true;
      target.hp = 0;
      this.spawnDynamicEffect('building-destruction', position.x, position.y - 26, {
        color: BUILDING_BY_ID[target.cardId]?.color || '#B48768',
        accent: '#FFF0C4',
        intensity: 1.25,
      });
    } else {
      target.downed = true;
      target.hp = 0;
      this.pendingAttackHits.delete(target.uid);
      this.playEntityAnimation(target, 'downed');
    }
    this.shake = Math.max(this.shake, 0.35);
    this.audio.play('hit');
  }

  damageCore(amount) {
    this.state.coreHp = Math.max(0, this.state.coreHp - amount);
    this.shake = Math.max(this.shake, 0.55);
    const corePosition = this.cellCenter(CORE_CELL.x, CORE_CELL.y);
    this.floatText(corePosition.x, corePosition.y - 54 * this.camera.zoom, `-${amount}`, PALETTE.danger);
    this.audio.play('hit');
    if (this.state.coreHp <= 0 && this.isExpeditionActive()) {
      this.finishExpeditionEncounter(false);
    } else if (this.state.coreHp <= 0 && this.state.phase === 'build') {
      this.state.enemies.forEach((enemy) => {
        enemy.dead = true;
        enemy.deathElapsed = 0;
      });
      this.state.coreHp = Math.round(this.state.coreMaxHp * 0.35);
      this.showToast('基地核心被冲破，救援泡泡已将怪物弹开', 'danger', 3);
    } else if (this.state.coreHp <= 0) {
      this.finishDefense(false);
    }
  }

  pushEnemy(enemy, dx, dy, effect = {}) {
    const card = ENEMY_BY_ID[enemy.cardId];
    if (card.weight > (effect.maxPushWeight ?? 1)) {
      enemy.stagger = Math.max(enemy.stagger, effect.heavyStaggerSeconds || 0.8);
      enemy.routeTimer = 0;
      const staggerPosition = this.entityCanvasPosition(enemy);
      this.floatText(staggerPosition.x, staggerPosition.y - 50, '失衡', PALETTE.shield);
      this.spawnDynamicEffect('impact', staggerPosition.x, staggerPosition.y - 25, {
        color: PALETTE.bubble,
        accent: PALETTE.shield,
        intensity: 0.95,
      });
      return false;
    }
    const old = { x: enemy.x, y: enemy.y };
    const oldPosition = this.entityCanvasPosition(enemy);
    enemy.x = WORLD.infinite ? enemy.x + dx : clamp(enemy.x + dx, 0, WORLD.width - 0.01);
    enemy.y = WORLD.infinite ? enemy.y + dy : clamp(enemy.y + dy, 0, WORLD.height - 0.01);
    enemy.path = [];
    enemy.routeTimer = 0;
    enemy.justPushed = true;
    enemy.bubbleStatus = Math.max(enemy.bubbleStatus || 0, 0.55);
    const position = this.entityCanvasPosition(enemy);
    const collision = this.activeEnemyPool(enemy)
      .find((other) => other.uid !== enemy.uid && !other.dead && distance(enemy, other) < 0.38);
    if (collision && effect.collisionDamage) {
      this.damageEnemy(enemy, effect.collisionDamage, effect);
      this.damageEnemy(collision, effect.collisionDamage, effect);
      enemy.stagger = Math.max(enemy.stagger, 0.45);
      collision.stagger = Math.max(collision.stagger, 0.45);
      const collisionPosition = this.entityCanvasPosition(collision);
      this.spawnDynamicEffect(
        'impact',
        (position.x + collisionPosition.x) / 2,
        (position.y + collisionPosition.y) / 2 - 24,
        {
          color: PALETTE.bubble,
          accent: '#FFF3A6',
          intensity: 1.5,
          duration: 0.38,
        },
      );
      this.shake = Math.max(this.shake, 0.32);
    }
    const moved = old.x !== enemy.x || old.y !== enemy.y;
    if (moved) {
      this.spawnDynamicEffect('push', oldPosition.x, oldPosition.y - 18, {
        dx: (enemy.x - old.x) * this.worldPixelsPerCell(),
        dy: (enemy.y - old.y) * this.worldPixelsPerCell(),
        color: PALETTE.bubble,
        accent: '#E8FFFF',
        layer: 'back',
        intensity: clamp(Math.hypot(enemy.x - old.x, enemy.y - old.y), 0.75, 1.65),
      });
    }
    this.spawnParticles(position.x, position.y - 15, PALETTE.bubble, 7, 55);
    const cell = this.nearestCell(enemy);
    if (inBoard(cell.x, cell.y)) this.triggerEnemyCell(enemy, cell);
    return moved;
  }

  launchProjectile(source, target, type, delay = 0) {
    const from = this.entityCanvasPosition(source);
    const to = this.entityCanvasPosition(target);
    this.state.projectiles.push({
      uid: uid('projectile'), type, from, to,
      sourceUid: source?.uid || null,
      targetUid: target?.uid || null,
      progress: -delay, duration: type === 'crystal' ? 0.24 : 0.32,
    });
  }

  spawnWorldEffect(assetKey, x, y, width, height, duration = 0.55, options = {}) {
    if (!assetKey || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const maxLife = Math.max(0.05, Number(duration) || 0.55);
    const effect = {
      assetKey,
      x,
      y,
      width: Math.max(1, Number(width) || 1),
      height: Math.max(1, Number(height) || 1),
      rotation: Number(options.rotation) || 0,
      layer: options.layer === 'back' ? 'back' : 'front',
      scaleFrom: Number.isFinite(options.scaleFrom) ? options.scaleFrom : 0.82,
      scaleTo: Number.isFinite(options.scaleTo) ? options.scaleTo : 1.05,
      life: maxLife,
      maxLife,
    };
    this.state.worldEffects.push(effect);
    return effect;
  }

  spawnDynamicEffect(kind, x, y, options = {}) {
    if (!DYNAMIC_EFFECT_DURATION[kind] || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const effectUid = uid('dynamic-effect');
    const defaultDuration = DYNAMIC_EFFECT_DURATION[kind];
    const maxLife = Math.max(0.08, Number(options.duration) || defaultDuration);
    const effect = {
      uid: effectUid,
      kind,
      x,
      y,
      dx: Number(options.dx) || 0,
      dy: Number(options.dy) || 0,
      color: options.color || PALETTE.bubble,
      accent: options.accent || '#FFF8E9',
      layer: options.layer === 'back' ? 'back' : 'front',
      intensity: clamp(Number(options.intensity) || 1, 0.45, 2.2),
      seed: Number.isFinite(options.seed)
        ? options.seed
        : Number(effectUid.split('-').pop()),
      life: maxLife,
      maxLife,
      elapsed: 0,
    };
    this.state.dynamicEffects ??= [];
    this.state.dynamicEffects.push(effect);
    this.state.dynamicEffects = this.state.dynamicEffects.slice(-96);
    return effect;
  }

  spawnParticles(x, y, color, count = 6, speed = 45, assetKey = null) {
    for (let index = 0; index < count && this.state.particles.length < 80; index += 1) {
      const angle = (index / count) * TAU + Math.random() * 0.6;
      const velocity = speed * (0.45 + Math.random() * 0.7);
      this.state.particles.push({
        x, y, color, assetKey,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity - 18,
        gravity: 75,
        size: 2.5 + Math.random() * 4,
        life: 0.38 + Math.random() * 0.35,
        maxLife: 0.7,
      });
    }
  }

  floatText(x, y, text, color) {
    this.state.floaters.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
  }

  nearestCell(entity) {
    return {
      x: WORLD.infinite ? Math.round(entity.x) : clamp(Math.round(entity.x), 0, BOARD.cols - 1),
      y: WORLD.infinite ? Math.round(entity.y) : clamp(Math.round(entity.y), 0, BOARD.rows - 1),
    };
  }

  worldPixelsPerCell() {
    return BOARD.cell * this.camera.zoom;
  }

  isWorldScreenPositionVisible(position, padding = 120) {
    return position.x >= BOARD.x - padding
      && position.x <= BOARD.x + BOARD.width + padding
      && position.y >= BOARD.y - padding
      && position.y <= BOARD.y + BOARD.height + padding;
  }

  terrainRenderCell(x, y) {
    const cell = this.worldCellAt(x, y);
    if (!cell) return null;
    const definition = TERRAIN_TYPES[cell.terrainId] || TERRAIN_TYPES.ground;
    const renderKind = definition.kind === 'destructible-obstacle'
      ? 'destructible'
      : definition.kind === 'indestructible-terrain'
        ? 'indestructible'
        : definition.kind;
    return {
      ...cell,
      kind: renderKind,
      variant: cell.terrainId,
      resourceType: definition.yield?.resourceId,
    };
  }

  cellCenter(x, y) {
    return worldToScreen({ x: x + 0.5, y: y + 0.5 }, this.camera, BOARD);
  }

  entityCanvasPosition(entity) {
    const buildingCard = BUILDING_BY_ID[entity?.cardId];
    if (buildingCard) {
      const shape = rotatedFootprint(buildingCard, entity.rotation);
      const ground = worldToScreen({
        x: entity.x + shape.width / 2,
        y: entity.y + shape.height,
      }, this.camera, BOARD);
      return ground;
    }
    return worldToScreen({ x: entity.x + 0.5, y: entity.y + 0.78 }, this.camera, BOARD);
  }

  createBuildingAutotileIndex(
    buildings = this.state.buildings,
    { excludeUid = null, virtualBuilding = null } = {},
  ) {
    const index = new Map();
    for (const building of buildings || []) {
      if (!building
        || building.uid === excludeUid
        || building.destroyed
        || !Number.isSafeInteger(building.x)
        || !Number.isSafeInteger(building.y)) continue;
      const profile = BUILDING_AUTOTILE_PROFILE_BY_CARD_ID[building.cardId];
      if (profile) index.set(cellKey(building.x, building.y), profile.group);
    }
    if (virtualBuilding
      && Number.isSafeInteger(virtualBuilding.x)
      && Number.isSafeInteger(virtualBuilding.y)) {
      const profile = BUILDING_AUTOTILE_PROFILE_BY_CARD_ID[virtualBuilding.cardId];
      if (profile) index.set(cellKey(virtualBuilding.x, virtualBuilding.y), profile.group);
    }
    return index;
  }

  buildingAutotileMask(building, index = this.createBuildingAutotileIndex()) {
    const profile = BUILDING_AUTOTILE_PROFILE_BY_CARD_ID[building?.cardId];
    if (!profile) return 0;
    return cardinalAutotileMask(building.x, building.y, (x, y) => (
      index.get(cellKey(x, y)) === profile.group
    ));
  }

  acquireGelPavingChunkSurface(ctx, configuration) {
    const pooled = this.gelPavingChunkSurfacePool.pop();
    if (pooled) {
      const resized = resizeGelPavingChunkSurface(pooled, configuration.surfacePixels);
      if (resized) return resized;
    }
    if (this.gelPavingChunkSurfaceAvailable === false) return null;
    const surface = createGelPavingChunkSurface(ctx, configuration.surfacePixels);
    this.gelPavingChunkSurfaceAvailable = Boolean(surface);
    return surface;
  }

  gelPavingChunkEntry(ctx, asset, paved, chunkX, chunkY, configuration) {
    const key = `${configuration.key}:${chunkX},${chunkY}`;
    const cached = this.gelPavingChunkCache.get(key);
    if (cached?.asset === asset) {
      this.gelPavingChunkCache.delete(key);
      this.gelPavingChunkCache.set(key, cached);
      return cached;
    }
    if (cached) {
      this.gelPavingChunkCache.delete(key);
      this.releaseGelPavingChunkEntry(cached);
    }

    const surface = this.acquireGelPavingChunkSurface(ctx, configuration);
    if (!surface) return null;
    surface.ctx.clearRect(0, 0, configuration.surfacePixels, configuration.surfacePixels);
    const originX = chunkX * configuration.chunkSize;
    const originY = chunkY * configuration.chunkSize;
    let tileCount = 0;
    try {
      for (let localY = 0; localY < configuration.chunkSize; localY += 1) {
        const y = originY + localY;
        for (let localX = 0; localX < configuration.chunkSize; localX += 1) {
          const x = originX + localX;
          if (!paved.has(cellKey(x, y))) continue;
          const mask = cardinalAutotileMask(x, y, (neighborX, neighborY) => (
            paved.has(cellKey(neighborX, neighborY))
          ));
          const source = autotileFrameRect(mask);
          surface.ctx.drawImage(
            asset,
            source.x,
            source.y,
            source.width,
            source.height,
            localX * configuration.physicalCellPixels,
            localY * configuration.physicalCellPixels,
            configuration.physicalCellPixels,
            configuration.physicalCellPixels,
          );
          tileCount += 1;
        }
      }
    } catch (error) {
      this.gelPavingChunkSurfacePool.push(surface);
      throw error;
    }
    const entry = {
      asset,
      surface: tileCount > 0 ? surface : null,
      tileCount,
    };
    if (!tileCount) this.gelPavingChunkSurfacePool.push(surface);
    this.gelPavingChunkCache.set(key, entry);
    return entry;
  }

  trimGelPavingChunkCache(configuration) {
    while (this.gelPavingChunkCache.size > configuration.maxSurfaces) {
      const oldestKey = this.gelPavingChunkCache.keys().next().value;
      const oldest = this.gelPavingChunkCache.get(oldestKey);
      this.gelPavingChunkCache.delete(oldestKey);
      this.releaseGelPavingChunkEntry(oldest);
    }
  }

  drawCachedGelPavingChunks(ctx, asset, paved, visibleCells) {
    this.syncGelPavingRenderCache(paved);
    if (this.gelPavingChunkSurfaceAvailable === false) return null;
    const configuration = this.gelPavingRenderConfiguration(ctx);
    if (!configuration) return null;
    const chunkCoordinates = [];
    const requestedKeys = new Set();
    for (let index = 0; index < visibleCells.length; index += 2) {
      const chunkX = Math.floor(visibleCells[index] / configuration.chunkSize);
      const chunkY = Math.floor(visibleCells[index + 1] / configuration.chunkSize);
      const key = `${configuration.key}:${chunkX},${chunkY}`;
      if (requestedKeys.has(key)) continue;
      requestedKeys.add(key);
      chunkCoordinates.push(chunkX, chunkY);
    }
    if (requestedKeys.size > configuration.maxSurfaces) return null;
    for (const [key, entry] of this.gelPavingChunkCache) {
      if (requestedKeys.has(key)) continue;
      this.gelPavingChunkCache.delete(key);
      this.releaseGelPavingChunkEntry(entry);
    }

    const chunks = [];
    try {
      for (let index = 0; index < chunkCoordinates.length; index += 2) {
        const chunkX = chunkCoordinates[index];
        const chunkY = chunkCoordinates[index + 1];
        const entry = this.gelPavingChunkEntry(
          ctx,
          asset,
          paved,
          chunkX,
          chunkY,
          configuration,
        );
        if (!entry) return null;
        chunks.push(chunkX, chunkY, entry);
      }
    } catch {
      this.invalidateGelPavingRenderCache();
      for (const surface of this.gelPavingChunkSurfacePool) {
        try {
          surface.canvas.width = 1;
          surface.canvas.height = 1;
        } catch {
          // The direct atlas fallback remains available without this surface.
        }
      }
      this.gelPavingChunkSurfacePool.length = 0;
      this.gelPavingChunkSurfaceAvailable = false;
      return null;
    }

    const size = this.worldPixelsPerCell();
    let draws = 0;
    for (let index = 0; index < chunks.length; index += 3) {
      const chunkX = chunks[index];
      const chunkY = chunks[index + 1];
      const entry = chunks[index + 2];
      if (!entry.surface || entry.tileCount <= 0) continue;
      const worldX = chunkX * configuration.chunkSize;
      const worldY = chunkY * configuration.chunkSize;
      ctx.drawImage(
        entry.surface.canvas,
        BOARD.x + (worldX - this.camera.x) * size,
        BOARD.y + (worldY - this.camera.y) * size,
        configuration.chunkSize * size,
        configuration.chunkSize * size,
      );
      draws += 1;
    }
    this.trimGelPavingChunkCache(configuration);
    return draws;
  }

  drawGelPaving(ctx, bounds) {
    const paved = this.state.gelPavingCells;
    if (!(paved instanceof Set) || !paved.size || !bounds) {
      return { cells: 0, draws: 0 };
    }
    const rawMinX = Number(bounds.minX);
    const rawMinY = Number(bounds.minY);
    const rawMaxX = Number(bounds.maxX);
    const rawMaxY = Number(bounds.maxY);
    const minX = Math.floor(Number.isFinite(rawMinX) ? rawMinX : 0);
    const minY = Math.floor(Number.isFinite(rawMinY) ? rawMinY : 0);
    const maxX = Math.max(minX, Math.ceil(Number.isFinite(rawMaxX) ? rawMaxX : minX));
    const maxY = Math.max(minY, Math.ceil(Number.isFinite(rawMaxY) ? rawMaxY : minY));
    const cells = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (!paved.has(cellKey(x, y))) continue;
        cells.push(x, y);
      }
    }
    if (!cells.length) return { cells: 0, draws: 0 };

    const size = this.worldPixelsPerCell();
    let draws = 0;
    drawAssetOrFallback(
      ctx,
      this.assetStore,
      GEL_PAVING_AUTOTILE_ASSET_KEY,
      (asset) => {
        const cachedDraws = this.drawCachedGelPavingChunks(ctx, asset, paved, cells);
        if (cachedDraws !== null) {
          draws = cachedDraws;
          return;
        }
        for (let index = 0; index < cells.length; index += 2) {
          const x = cells[index];
          const y = cells[index + 1];
          const mask = cardinalAutotileMask(x, y, (neighborX, neighborY) => (
            paved.has(cellKey(neighborX, neighborY))
          ));
          const source = autotileFrameRect(mask);
          ctx.drawImage(
            asset,
            source.x,
            source.y,
            source.width,
            source.height,
            BOARD.x + (x - this.camera.x) * size,
            BOARD.y + (y - this.camera.y) * size,
            size,
            size,
          );
          draws += 1;
        }
      },
      () => {},
    );
    return { cells: cells.length / 2, draws };
  }

  selectCombatCard(card) {
    if (this.state.phase !== 'battle') return;
    if (card.type === 'skill') {
      const cooldown = Math.max(0, this.state.skills[card.id].readyAtAction - this.state.friendlyActions);
      if (cooldown > 0) {
        this.showToast(`还需 ${cooldown} 次友军行动才能再次使用`, 'danger');
        return;
      }
      if (this.state.energy < card.energy) {
        this.showToast(`凝胶能量不足，需要 ${card.energy} 点`, 'danger');
        return;
      }
    } else if ((this.state.items[card.id]?.charges || 0) <= 0) {
      this.showToast('这件道具本场已经用完了', 'danger');
      return;
    }
    const wasPaused = this.state.paused;
    this.state.paused = true;
    this.selection = { kind: 'target-card', cardType: card.type, cardId: card.id, step: 0, wasPaused };
    this.showToast(this.targetingPrompt(card));
  }

  targetingPrompt(card) {
    const prompts = {
      'skill-jelly-bounce': '点选敌群所在格，向右弹回',
      'skill-honey-line': '先选胶线起点，再点相邻格决定方向',
      'skill-soft-swap': '依次选择两名幸存者',
      'skill-sprout-renewal': '选择需要修复或保护的友方目标',
      'item-spring-pad': '先选软垫位置，再点相邻格决定方向',
      'item-lure-jelly': '选择一个可通行格放置诱饵',
      'item-moving-bubble': '先选幸存者或1×1建筑，再选目的地',
    };
    return prompts[card.id] || '选择一个目标';
  }

  cancelTargeting() {
    if (this.selection?.kind === 'target-card') this.state.paused = this.selection.wasPaused;
    this.selection = null;
    this.showToast('已取消，不消耗卡牌');
  }

  handleBattleTarget(cell) {
    const selection = this.selection;
    if (selection?.kind !== 'target-card') return;
    const card = selection.cardType === 'skill' ? SKILL_BY_ID[selection.cardId] : ITEM_BY_ID[selection.cardId];
    if (!card) return;

    if (card.id === 'skill-jelly-bounce') {
      const affected = this.state.enemies.filter((enemy) => !enemy.dead && Math.abs(enemy.x - cell.x) + Math.abs(enemy.y - cell.y) <= 1.25);
      if (!affected.length) {
        this.showToast('这个范围里没有敌人', 'danger');
        return;
      }
      affected.forEach((enemy) => this.pushEnemy(enemy, card.effect.knockbackTiles, 0, card.effect));
      const position = this.cellCenter(cell.x, cell.y);
      this.spawnDynamicEffect('impact', position.x + 24, position.y - 18, {
        color: PALETTE.bubble,
        accent: '#E8FFFF',
        intensity: 1.65,
        duration: 0.42,
      });
      this.spawnParticles(position.x, position.y, PALETTE.bubble, 14, 80);
      this.consumeCard(card);
      return;
    }

    if (card.id === 'skill-honey-line' || card.id === 'item-spring-pad') {
      if (selection.step === 0) {
        const obstacle = operationalBuildingAt(this.state.buildings, cell.x, cell.y);
        if (obstacle && BUILDING_BY_ID[obstacle.cardId].solid) {
          this.showToast('需要选择可通行的格子', 'danger');
          return;
        }
        selection.origin = cell;
        selection.step = 1;
        this.showToast('再点一个相邻格决定方向');
        return;
      }
      const dx = clamp(cell.x - selection.origin.x, -1, 1);
      const dy = clamp(cell.y - selection.origin.y, -1, 1);
      if (Math.abs(dx) + Math.abs(dy) !== 1) {
        this.showToast('方向格必须紧挨起点', 'danger');
        return;
      }
      if (card.id === 'skill-honey-line') {
        const cells = [0, 1, 2].map((step) => ({ x: selection.origin.x + dx * step, y: selection.origin.y + dy * step }));
        if (!cells.every((target) => inBoard(target.x, target.y))) {
          this.showToast('胶线会超出庭院，请换个方向', 'danger');
          return;
        }
        cells.forEach((target) => this.state.terrain.push({ type: 'honey', ...target, life: card.effect.lifetimeSeconds }));
        const middle = this.cellCenter(selection.origin.x + dx, selection.origin.y + dy);
        this.spawnDynamicEffect('trail', middle.x, middle.y, {
          dx: dx * this.worldPixelsPerCell() * 2.45,
          dy: dy * this.worldPixelsPerCell() * 2.45,
          color: '#F6BE58',
          accent: '#FFF1A8',
          intensity: 1.1,
        });
        this.spawnParticles(
          this.cellCenter(selection.origin.x, selection.origin.y).x,
          this.cellCenter(selection.origin.x, selection.origin.y).y,
          '#F6BE58',
          12,
          55,
        );
      } else {
        this.state.deployables.push({
          uid: uid('pad'), type: 'pad', ...selection.origin,
          dx, dy, tiles: card.effect.knockbackTiles, life: Infinity, consumed: false,
        });
        const position = this.cellCenter(selection.origin.x, selection.origin.y);
        this.spawnDynamicEffect('place', position.x, position.y + 9, {
          color: PALETTE.bubble,
          accent: '#E8FFFF',
        });
      }
      this.consumeCard(card);
      return;
    }

    if (card.id === 'skill-soft-swap') {
      const target = this.state.survivors.find((survivor) => !survivor.downed && survivor.x === cell.x && survivor.y === cell.y);
      if (!target) {
        this.showToast('请选择一名仍在战斗的幸存者', 'danger');
        return;
      }
      if (selection.step === 0) {
        selection.firstUid = target.uid;
        selection.step = 1;
        this.showToast('再选择另一名幸存者');
        return;
      }
      const first = this.state.survivors.find((survivor) => survivor.uid === selection.firstUid);
      if (!first || first.uid === target.uid) {
        this.showToast('请选择另一名幸存者', 'danger');
        return;
      }
      const firstPosition = this.entityCanvasPosition(first);
      const targetPosition = this.entityCanvasPosition(target);
      const effectDx = targetPosition.x - firstPosition.x;
      const effectDy = targetPosition.y - firstPosition.y;
      this.spawnDynamicEffect(
        'swap',
        (firstPosition.x + targetPosition.x) / 2,
        (firstPosition.y + targetPosition.y) / 2 - 24,
        {
          dx: effectDx,
          dy: effectDy,
          color: '#C995F2',
          accent: '#8CEAF1',
          intensity: 1.05,
        },
      );
      [first.x, target.x] = [target.x, first.x];
      [first.y, target.y] = [target.y, first.y];
      this.performSurvivorAction(first, true);
      this.performSurvivorAction(target, true);
      this.consumeCard(card);
      return;
    }

    if (card.id === 'skill-sprout-renewal') {
      const survivor = this.state.survivors.find((target) => !target.downed && target.x === cell.x && target.y === cell.y);
      const building = operationalBuildingAt(this.state.buildings, cell.x, cell.y);
      const target = survivor || building;
      if (!target) {
        this.showToast('这里没有可以修复的目标', 'danger');
        return;
      }
      if (target.hp >= target.maxHp) {
        target.seed = Math.max(target.seed || 0, card.effect.fullHealthShield);
        this.floatText(this.entityCanvasPosition(target).x, this.entityCanvasPosition(target).y - 50, '萌芽守护', PALETTE.heal);
      } else {
        target.hp = Math.min(target.maxHp, target.hp + card.effect.heal);
        this.floatText(this.entityCanvasPosition(target).x, this.entityCanvasPosition(target).y - 50, `+${card.effect.heal}`, PALETTE.heal);
      }
      const position = this.entityCanvasPosition(target);
      this.spawnDynamicEffect('heal', position.x, position.y - 28, {
        color: PALETTE.heal,
        accent: '#F4FFD2',
        intensity: 1.12,
      });
      this.spawnParticles(position.x, position.y - 20, PALETTE.heal, 14, 58);
      this.audio.play('heal');
      this.consumeCard(card);
      return;
    }

    if (card.id === 'item-lure-jelly') {
      const obstacle = operationalBuildingAt(this.state.buildings, cell.x, cell.y);
      if (obstacle && BUILDING_BY_ID[obstacle.cardId].solid) {
        this.showToast('诱饵要放在可通行格', 'danger');
        return;
      }
      this.state.deployables.push({
        uid: uid('lure'), type: 'lure', ...cell,
        life: card.effect.lifetimeSeconds,
        range: card.effect.attractionRangeTiles,
        eating: card.effect.eatingSeconds,
        consumed: false,
      });
      const position = this.cellCenter(cell.x, cell.y);
      this.spawnDynamicEffect('place', position.x, position.y + 18, {
        color: '#E9AA67',
        accent: '#FFF0C4',
        intensity: 0.85,
      });
      this.consumeCard(card);
      return;
    }

    if (card.id === 'item-moving-bubble') {
      if (selection.step === 0) {
        const survivor = this.state.survivors.find((target) => !target.downed && target.x === cell.x && target.y === cell.y);
        const building = operationalBuildingAt(this.state.buildings, cell.x, cell.y);
        if (!survivor && (!building || rotatedFootprint(BUILDING_BY_ID[building.cardId], building.rotation).width !== 1 || rotatedFootprint(BUILDING_BY_ID[building.cardId], building.rotation).height !== 1)) {
          this.showToast('请选择一名幸存者或1×1建筑', 'danger');
          return;
        }
        selection.sourceType = survivor ? 'survivor' : 'building';
        selection.sourceUid = survivor?.uid || building.uid;
        selection.step = 1;
        this.showToast('选择搬家的目的地');
        return;
      }
      let sourceStartPosition = null;
      if (selection.sourceType === 'survivor') {
        const source = this.state.survivors.find((target) => target.uid === selection.sourceUid);
        if (this.state.survivors.some((target) => target.uid !== source.uid && !target.downed && target.x === cell.x && target.y === cell.y)) {
          this.showToast('目的地已经有人驻守', 'danger');
          return;
        }
        sourceStartPosition = this.entityCanvasPosition(source);
        this.faceEntityToward(source, cell, 1);
        source.x = cell.x;
        source.y = cell.y;
      } else {
        const source = this.state.buildings.find((target) => (
          target.uid === selection.sourceUid && buildingIsOperational(target)
        ));
        if (!source) {
          this.showToast('这座建筑尚未完工或已失效', 'danger');
          return;
        }
        const sourceCard = BUILDING_BY_ID[source.cardId];
        if (this.state.enemies.some((enemy) => !enemy.dead && Math.abs(enemy.x - cell.x) < 0.6 && Math.abs(enemy.y - cell.y) < 0.6)) {
          this.showToast('不能把建筑搬到敌人脚下', 'danger');
          return;
        }
        if (!canPlace(
          this.state.buildings,
          sourceCard,
          cell.x,
          cell.y,
          source.rotation,
          source.uid,
          this.runtimeTerrain,
        )) {
          this.showToast('目的地放不下这座建筑', 'danger');
          return;
        }
        sourceStartPosition = this.entityCanvasPosition(source);
        source.x = cell.x;
        source.y = cell.y;
      }
      this.state.enemies.forEach((enemy) => { enemy.routeTimer = 0; });
      const position = this.cellCenter(cell.x, cell.y);
      this.spawnDynamicEffect('push', sourceStartPosition.x, sourceStartPosition.y - 20, {
        dx: position.x - sourceStartPosition.x,
        dy: position.y - sourceStartPosition.y,
        color: PALETTE.bubble,
        accent: '#E8FFFF',
        layer: 'back',
        intensity: 1.25,
        duration: 0.62,
      });
      this.spawnWorldEffect(
        'item-moving-bubble-world',
        position.x,
        position.y - 34,
        112,
        112,
        0.58,
        { layer: 'back', scaleFrom: 0.74, scaleTo: 1.08 },
      );
      this.spawnParticles(position.x, position.y, PALETTE.bubble, 16, 70);
      this.consumeCard(card);
    }
  }

  consumeCard(card) {
    if (card.type === 'skill') {
      this.state.energy -= card.energy;
      this.state.skills[card.id].readyAtAction = this.state.friendlyActions + card.cooldownActions;
    } else {
      this.state.items[card.id].charges -= 1;
    }
    const wasPaused = this.selection.wasPaused;
    this.selection = null;
    this.state.paused = wasPaused;
    this.showToast(`${card.shortName}已生效`, 'good');
    this.audio.play(card.id.includes('sprout') ? 'heal' : 'bubble');
  }

  render() {
    const ctx = this.ctx;
    const cssWidth = this.canvas.width / this.dpr;
    const cssHeight = this.canvas.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    // The procedural world is the page background. The terrain-colored clear
    // also prevents a decorative scene from flashing at the canvas edge while
    // camera shake is active.
    ctx.fillStyle = '#A7CF83';
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    if (this.shake > 0) ctx.translate(
      Math.sin(this.animationTime * 72) * this.shake * 5,
      Math.cos(this.animationTime * 59) * this.shake * 3,
    );
    this.hits = [];
    this.drawBattlefield(ctx);
    this.drawTopHud(ctx);
    this.drawSidePanel(ctx);
    this.drawBottomBar(ctx);
    this.drawTransientUi(ctx);
    if (this.modal?.type === 'expedition-squad') this.drawExpeditionSquadModal(ctx);
    if (this.modal?.type === 'expedition-route') this.drawExpeditionRouteModal(ctx);
    if (this.modal?.type === 'expedition-boon') this.drawExpeditionBoonModal(ctx);
    if (this.modal?.type === 'welcome') this.drawWelcome(ctx);
    if (this.state.phase === 'intel') this.drawIntelModal(ctx);
    if (this.state.phase === 'result') this.drawResultModal(ctx);
    ctx.restore();
  }

  drawBackground(ctx) {
    const renderedBackground = drawAssetOrFallback(
      ctx,
      this.assetStore,
      'background-garden-base',
      (asset) => ctx.drawImage(asset, 0, 0, VIEW.width, VIEW.height),
      () => {},
    );
    if (renderedBackground) {
      drawAssetOrFallback(ctx, this.assetStore, 'background-cloud-overlay', (asset) => {
        const drift = (this.time * 3) % VIEW.width;
        ctx.globalAlpha *= 0.72;
        ctx.drawImage(asset, -drift, 0, VIEW.width, 426);
        ctx.drawImage(asset, VIEW.width - drift, 0, VIEW.width, 426);
      }, () => {});
      return;
    }

    const sky = ctx.createLinearGradient(0, 0, 0, VIEW.height);
    sky.addColorStop(0, '#E7F4EC');
    sky.addColorStop(0.52, '#C8E3CF');
    sky.addColorStop(1, '#8DC67D');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);

    ctx.save();
    ctx.globalAlpha = 0.46;
    ctx.fillStyle = '#FFFFFF';
    for (const cloud of [[140, 86, 82], [525, 48, 58], [1010, 72, 74]]) {
      ctx.beginPath();
      ctx.arc(cloud[0] - cloud[2] * 0.34, cloud[1], cloud[2] * 0.28, 0, TAU);
      ctx.arc(cloud[0], cloud[1] - cloud[2] * 0.12, cloud[2] * 0.4, 0, TAU);
      ctx.arc(cloud[0] + cloud[2] * 0.38, cloud[1], cloud[2] * 0.3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    ctx.fillStyle = '#A3CFAD';
    ctx.beginPath();
    ctx.moveTo(0, 255);
    ctx.quadraticCurveTo(170, 135, 335, 234);
    ctx.quadraticCurveTo(540, 116, 730, 232);
    ctx.quadraticCurveTo(995, 105, 1280, 250);
    ctx.lineTo(1280, 720);
    ctx.lineTo(0, 720);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#72AF76';
    for (let index = 0; index < 18; index += 1) {
      const x = 20 + index * 76 + (index % 3) * 12;
      const y = 195 + (index % 4) * 12;
      ctx.beginPath();
      ctx.arc(x, y, 26 + (index % 3) * 5, 0, TAU);
      ctx.arc(x + 22, y + 5, 21, 0, TAU);
      ctx.fill();
    }

    const ground = ctx.createLinearGradient(0, 260, 0, 720);
    ground.addColorStop(0, '#9DD38A');
    ground.addColorStop(1, '#75B56F');
    ctx.fillStyle = ground;
    ctx.fillRect(0, 245, VIEW.width, 475);

    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#E9F4D9';
    for (let y = 280; y < 590; y += 54) {
      for (let x = 38 + (y % 2) * 14; x < 1240; x += 88) {
        ctx.beginPath();
        ctx.ellipse(x, y, 3, 8, 0.45, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawForeground(ctx) {
    drawAssetOrFallback(ctx, this.assetStore, 'background-foreground-grass', (asset) => {
      ctx.drawImage(asset, 0, VIEW.height - 320, VIEW.width, 320);
    }, () => {});
  }

  drawBattlefield(ctx) {
    this.resetDynamicComponentBudget();
    // Canvas clipping already bounds the scene. Keeping this layer rectangular
    // makes the infinite map fill the complete view beneath the HUD overlays.
    ctx.save();
    ctx.fillStyle = '#A7CF83';
    ctx.fillRect(BOARD.x, BOARD.y, BOARD.width, BOARD.height);

    const bounds = visibleWorldBounds(this.camera, WORLD, BOARD, 1);
    const visibleChunks = this.infiniteWorld.updateCamera({
      minX: bounds.minX,
      minY: bounds.minY,
      maxXExclusive: bounds.maxX + 1,
      maxYExclusive: bounds.maxY + 1,
    }, { paddingChunks: 1, reveal: false });
    const visiblePois = this.worldPoisForBounds(bounds);
    this.visibleWorldPois = visiblePois;
    const tileSize = this.worldPixelsPerCell();
    const terrainOptions = {
      visibleBounds: bounds,
      world: WORLD,
      terrainAt: (x, y) => this.terrainRenderCell(x, y),
      worldToScreen: (point) => worldToScreen(point, this.camera, BOARD),
      pixelsPerCell: tileSize,
      pixelRatio: this.dpr * this.scale,
      time: this.time,
      assetStore: this.assetStore,
    };
    drawOrganicGround(ctx, terrainOptions);
    this.drawWorldRegionDecals(ctx, visibleChunks, bounds);
    this.drawGelPaving(ctx, bounds);

    const corePosition = this.cellCenter(CORE_CELL.x, CORE_CELL.y);
    const portalPositions = WORLD.monsterEntrances.map((entrance) => ({
      entrance,
      position: this.cellCenter(entrance.x, entrance.y),
    }));

    this.drawRoutes(ctx);
    drawOrganicTerrainProps(ctx, terrainOptions);
    this.drawTerrain(ctx);
    this.drawWorldPoiBackEffects(ctx, visiblePois);
    const expeditionBattle = this.state.phase === 'battle' && this.isExpeditionSession();
    const beaconDrawn = expeditionBattle && drawAssetOrFallback(
      ctx,
      this.assetStore,
      'expedition-beacon',
      (asset) => {
        const size = 116 * this.camera.zoom;
        drawImageContained(
          ctx,
          asset,
          corePosition.x - size / 2,
          corePosition.y - size + 30 * this.camera.zoom,
          size,
          size,
          1,
        );
      },
      () => drawCore(ctx, corePosition.x, corePosition.y + 16 * this.camera.zoom, 104 * this.camera.zoom, {
        assetStore: this.assetStore,
        time: this.time,
        health: this.state.coreHp / this.state.coreMaxHp,
        danger: this.state.coreHp / this.state.coreMaxHp < 0.35,
      }),
    );
    if (!expeditionBattle) {
      drawCore(ctx, corePosition.x, corePosition.y + 16 * this.camera.zoom, 104 * this.camera.zoom, {
        assetStore: this.assetStore,
        time: this.time,
        health: this.state.coreHp / this.state.coreMaxHp,
        danger: this.state.coreHp / this.state.coreMaxHp < 0.35,
      });
    } else if (beaconDrawn) {
      this.drawHealthBar(
        ctx,
        corePosition.x,
        corePosition.y - 74 * this.camera.zoom,
        72 * this.camera.zoom,
        this.state.coreHp / this.state.coreMaxHp,
      );
    }
    for (const { position } of portalPositions) {
      if (!this.isWorldScreenPositionVisible(position, 100 * this.camera.zoom)) continue;
      drawPortal(ctx, position.x, position.y + 16 * this.camera.zoom, 82 * this.camera.zoom, {
        assetStore: this.assetStore,
        time: this.time,
        open: this.state.enemies.some((enemy) => !enemy.dead) ? 1 : 0.52,
      });
    }
    this.drawWorldEffects(ctx, 'back');
    this.drawDynamicEffects(ctx, 'back');
    this.drawMovingBubblePreview(ctx);
    this.drawWorldActors(ctx);
    this.drawDynamicEffects(ctx, 'front');
    this.drawWorldEffects(ctx, 'front');
    this.drawProjectilesAndParticles(ctx);
    // Discovery clouds are the final world-space concealment layer. Drawing
    // them after terrain, actors, and effects prevents unknown content from
    // leaking above the fog while the HUD remains fully readable.
    this.drawDiscoveryFog(ctx, bounds);
    this.drawSelectionOverlay(ctx);

    ctx.save();
    ctx.font = `700 ${Math.max(11, 14 * this.camera.zoom)}px "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.inkSoft;
    ctx.fillText(expeditionBattle ? '远征信标' : '基地核心', corePosition.x, corePosition.y + 70 * this.camera.zoom);
    for (const { position } of portalPositions) {
      if (this.isWorldScreenPositionVisible(position, 40 * this.camera.zoom)) {
        ctx.fillText(expeditionBattle ? '探索裂隙' : '生态入口', position.x, position.y + 58 * this.camera.zoom);
      }
    }
    ctx.restore();
    ctx.restore();

    ctx.save();
    this.addUiBlocker('world-status-blocker', BOARD.x + 14, BOARD.y + 92, 270, 34);
    drawRoundedRect(ctx, BOARD.x + 14, BOARD.y + 92, 270, 34, {
      radius: 14,
      fill: 'rgba(35,69,58,0.7)',
    });
    ctx.fillStyle = '#FFF8E9';
    ctx.font = '700 13px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `无限生态世界 · ${this.infiniteWorld.stats().loadedChunks} 区块 · ${Math.round(this.camera.zoom * 100)}%`,
      BOARD.x + 149,
      BOARD.y + 114,
    );
    ctx.restore();
  }

  drawDiscoveryFog(ctx, bounds) {
    const size = this.worldPixelsPerCell();
    return drawAuthoredDiscoveryFog(ctx, {
      visibleBounds: bounds,
      worldToScreen: (point) => worldToScreen(point, this.camera, BOARD),
      pixelsPerCell: size,
      pixelRatio: this.dpr * this.scale,
      assetStore: this.assetStore,
      isUndiscovered: (x, y) => this.worldCellAt(x, y)?.discovered === false,
    });
  }

  drawWorldRegionDecals(ctx, chunks, bounds) {
    const cellSize = this.worldPixelsPerCell();
    this.requestWorldAssetKeys((chunks || []).map((chunk) => (
      regionAssetKeyForZone(chunk.zone)
    )));
    for (const chunk of chunks || []) {
      if (chunk.maxXExclusive <= bounds.minX || chunk.minX > bounds.maxX
        || chunk.maxYExclusive <= bounds.minY || chunk.minY > bounds.maxY) continue;
      const assetKey = regionAssetKeyForZone(chunk.zone);
      if (!assetKey) continue;
      const seed = chunk.chunkX * 131 + chunk.chunkY * 197;
      const offsetX = (effectNoise(seed, 1) - 0.5) * 2.2;
      const offsetY = (effectNoise(seed, 2) - 0.5) * 2.2;
      const center = worldToScreen({
        x: chunk.originX + chunk.size / 2 + offsetX,
        y: chunk.originY + chunk.size / 2 + offsetY,
      }, this.camera, BOARD);
      const width = cellSize * (10.5 + effectNoise(seed, 3) * 3.2);
      const height = width * 0.72;
      drawAssetOrFallback(ctx, this.assetStore, assetKey, (asset) => {
        ctx.globalAlpha *= 0.13;
        drawImageContained(
          ctx,
          asset,
          center.x - width / 2,
          center.y - height / 2,
          width,
          height,
        );
      }, () => {});
    }
  }

  worldPoisForBounds(bounds) {
    const found = new Map();
    for (const poi of this.infiniteWorld.getPoisInBounds({
      minX: bounds.minX,
      minY: bounds.minY,
      maxXExclusive: bounds.maxX + 1,
      maxYExclusive: bounds.maxY + 1,
    }, { discoveredOnly: true })) {
      found.set(poi.id, {
        ...poi,
        zoneKind: this.infiniteWorld.getZoneAt(poi.x, poi.y).kind,
        cleared: poi.state?.cleared === true,
      });
    }
    for (const site of this.state.worldExpedition?.sites || []) {
      if (site.x < bounds.minX || site.x > bounds.maxX
        || site.y < bounds.minY || site.y > bounds.maxY) continue;
      found.set(site.id, {
        ...found.get(site.id),
        ...site,
        cleared: this.infiniteWorld.getPoiState(site.id)?.cleared === true,
      });
    }
    return [...found.values()].sort((left, right) => left.y - right.y || left.x - right.x);
  }

  worldPoiAssetLayers(site) {
    return site.cleared
      ? worldPoiAssetKeys('relay', site.zoneKind)
      : worldPoiAssetKeys(site, site.zoneKind);
  }

  drawWorldPoiBackEffects(ctx, sites = []) {
    this.requestWorldAssetKeys(sites.flatMap((site) => this.worldPoiAssetLayers(site)));
    const zoom = this.camera.zoom;
    for (const site of sites) {
      const position = this.cellCenter(site.x, site.y);
      const pulse = 1 + Math.sin(this.time * 3.4 + site.x * 0.3) * 0.08;
      for (const assetKey of this.worldPoiAssetLayers(site).filter((key) => key.includes('energy'))) {
        const drawSize = 88 * zoom * pulse;
        drawAssetOrFallback(ctx, this.assetStore, assetKey, (asset) => {
          ctx.globalAlpha *= 0.74 + pulse * 0.16;
          drawImageContained(
            ctx,
            asset,
            position.x - drawSize / 2,
            position.y - 18 * zoom - drawSize / 2,
            drawSize,
            drawSize,
          );
        }, () => {});
      }
    }
  }

  drawWorldPoiActor(ctx, site) {
    const expedition = this.state.worldExpedition;
    const selected = expedition?.targetPoiId === site.id;
    const zoom = this.camera.zoom;
    const position = this.cellCenter(site.x, site.y);
    const pulse = 1 + Math.sin(this.time * 3.4 + site.x * 0.3) * 0.08;
    const radius = (site.kind === 'boss' ? 28 : 22) * zoom * pulse;
    const assetKeys = this.worldPoiAssetLayers(site).filter((key) => !key.includes('energy'));
    const baseSize = site.cleared ? 78 : site.kind === 'boss' ? 112 : site.kind === 'landmark' ? 96 : 88;
    const drawSize = baseSize * zoom;
    if (selected) {
      const ringPulse = 1 + Math.sin(this.time * 5) * 0.035;
      const ringWidth = drawSize * 0.96 * ringPulse;
      const ringHeight = ringWidth * 0.5;
      const ringY = position.y + 14 * zoom;
      drawAssetOrFallback(ctx, this.assetStore, 'effect-selection-ring-friendly', (asset) => {
        ctx.globalAlpha *= 0.82 + Math.sin(this.time * 5) * 0.08;
        ctx.drawImage(
          asset,
          position.x - ringWidth / 2,
          ringY - ringHeight / 2,
          ringWidth,
          ringHeight,
        );
      }, () => {
        ctx.strokeStyle = '#FFF0A8';
        ctx.lineWidth = Math.max(2, 3 * zoom);
        ctx.beginPath();
        ctx.ellipse(position.x, ringY, ringWidth / 2, ringHeight / 2, 0, 0, TAU);
        ctx.stroke();
      });
    }
    let authoredDrawn = false;
    for (const assetKey of assetKeys) {
      authoredDrawn = drawAssetOrFallback(ctx, this.assetStore, assetKey, (asset) => {
        ctx.globalAlpha *= selected ? 1 : site.cleared ? 0.82 : 0.94;
        drawImageContained(
          ctx,
          asset,
          position.x - drawSize / 2,
          position.y - 18 * zoom - drawSize / 2,
          drawSize,
          drawSize,
        );
      }, () => {}) || authoredDrawn;
    }
    ctx.save();
    if (!authoredDrawn) {
      ctx.globalAlpha = selected ? 1 : 0.92;
      ctx.fillStyle = site.cleared
        ? 'rgba(97,214,162,0.82)'
        : site.kind === 'boss'
          ? 'rgba(239,137,105,0.92)'
          : site.kind === 'nest'
            ? 'rgba(137,117,221,0.90)'
            : 'rgba(97,214,162,0.92)';
      ctx.strokeStyle = '#FFF8E9';
      ctx.lineWidth = Math.max(2, 3 * zoom);
      ctx.beginPath();
      ctx.arc(position.x, position.y - 18 * zoom, radius, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FFF8E9';
      ctx.font = `900 ${Math.max(12, 17 * zoom)}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(site.cleared ? '站' : site.kind === 'boss' ? '王' : site.kind === 'nest' ? '巢' : '礼', position.x, position.y - 18 * zoom);
    }
    if (selected || site.cleared || zoom >= 0.82) {
      ctx.font = `800 ${Math.max(10, 12 * zoom)}px "PingFang SC", sans-serif`;
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        site.cleared ? '已激活生态前哨' : site.name || (site.kind === 'nest' ? '怪物巢穴' : '资源地'),
        position.x,
        position.y + 22 * zoom,
      );
    }
    ctx.restore();
    const selectable = expedition?.status === 'choose-site'
      && expedition.sites.some(({ id }) => id === site.id)
      && !site.cleared;
    if (selectable) {
      this.addHit(
        `world-site-${site.id}`,
        position.x - radius,
        position.y - 18 * zoom - radius,
        radius * 2,
        radius * 2,
        () => this.selectWorldExpeditionSite(site.id),
      );
    }
  }

  drawWorldPoiMarkers(ctx, bounds) {
    const sites = this.worldPoisForBounds(bounds);
    this.drawWorldPoiBackEffects(ctx, sites);
    sites.forEach((site) => this.drawWorldPoiActor(ctx, site));
  }

  drawRoutes(ctx) {
    // Expedition enemies converge on the temporary beacon from their own
    // encounter queue. The old authored tower-defense lanes are misleading
    // when the player pauses an expedition, so keep them out of this mode.
    if (this.isExpeditionSession()) return;
    if (this.state.phase === 'battle' && !this.state.paused) return;
    const routeStarts = this.state.phase === 'build'
      ? WORLD.monsterEntrances.map(({ x, y }) => ({ x, y }))
      : [...new Set(WAVES[Math.min(this.state.waveIndex, WAVES.length - 1)].groups
        .flatMap((group) => group.rowIndices))]
        .slice(0, 4)
        .map((row) => ({
          x: WORLD.width - 1,
          y: clamp(CORE_CELL.y - 3 + row, 0, WORLD.height - 1),
        }));
    routeStarts.forEach((start, routeIndex) => {
      const path = routeFor(
        this.state.buildings,
        start,
        null,
        this.runtimeTerrain,
      );
      const crossesBuilding = path.some((cell) => BUILDING_BY_ID[
        operationalBuildingAt(this.state.buildings, cell.x, cell.y)?.cardId
      ]?.solid);
      const alpha = (crossesBuilding ? 0.46 : 0.38) - routeIndex * 0.025;
      const points = path.map((cell) => this.cellCenter(cell.x, cell.y));
      for (let index = 1; index < points.length; index += 1) {
        const from = points[index - 1];
        const to = points[index];
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        if (length < 1) continue;
        drawAssetOrFallback(
          ctx,
          this.assetStore,
          crossesBuilding ? 'tile-route-breach' : 'tile-route-open',
          (asset) => {
            ctx.globalAlpha *= alpha;
            ctx.translate((from.x + to.x) / 2, (from.y + to.y) / 2);
            ctx.rotate(Math.atan2(dy, dx));
            ctx.drawImage(asset, -length / 2 - 1, -7 * this.camera.zoom, length + 2, 14 * this.camera.zoom);
          },
          () => {
            ctx.globalAlpha *= alpha;
            ctx.strokeStyle = crossesBuilding ? '#E45F68' : '#43A073';
            ctx.lineWidth = Math.max(2, 4 * this.camera.zoom);
            ctx.lineCap = 'round';
            ctx.setLineDash([10, 10]);
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.stroke();
          },
        );
      }
    });
  }

  drawTerrain(ctx) {
    const zoom = this.camera.zoom;
    for (const terrain of this.state.terrain) {
      const position = this.cellCenter(terrain.x, terrain.y);
      if (!this.isWorldScreenPositionVisible(position, 70 * zoom)) continue;
      if (terrain.type === 'honey') {
        drawAssetOrFallback(ctx, this.assetStore, 'tile-honey-puddle', (asset) => {
          ctx.globalAlpha *= 0.82;
          ctx.drawImage(asset, position.x - 34 * zoom, position.y - 24 * zoom, 68 * zoom, 68 * zoom);
        }, () => {
          ctx.globalAlpha = 0.72;
          ctx.fillStyle = '#E9B84F';
          ctx.strokeStyle = '#AF7C28';
          ctx.lineWidth = 2 * zoom;
          ctx.beginPath();
          ctx.ellipse(position.x, position.y + 17 * zoom, 29 * zoom, 18 * zoom, -0.1, 0, TAU);
          ctx.ellipse(position.x - 18 * zoom, position.y + 9 * zoom, 12 * zoom, 9 * zoom, 0.3, 0, TAU);
          ctx.fill();
          ctx.stroke();
        });
        drawStatusIcon(ctx, position.x + 25 * zoom, position.y - 23 * zoom, 22 * zoom, 'sticky', {
          assetStore: this.assetStore,
          time: this.time,
          shadow: false,
        });
      } else if (terrain.type === 'crystal') {
        drawAssetOrFallback(ctx, this.assetStore, 'tile-crystal-spikes', (asset) => {
          ctx.drawImage(asset, position.x - 30 * zoom, position.y - 30 * zoom, 60 * zoom, 60 * zoom);
        }, () => {
          ctx.translate(position.x, position.y + 22 * zoom);
          ctx.scale(zoom, zoom);
          ctx.fillStyle = PALETTE.crystal;
          ctx.strokeStyle = PALETTE.inkSoft;
          ctx.lineWidth = 2;
          for (const offset of [-15, 0, 15]) {
            ctx.beginPath();
            ctx.moveTo(offset - 7, 8);
            ctx.lineTo(offset, -18 - Math.abs(offset) * 0.25);
            ctx.lineTo(offset + 7, 8);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        });
      }
    }
  }

  drawMovingBubblePreview(ctx) {
    const selection = this.selection;
    if (selection?.kind !== 'target-card'
      || selection.cardId !== 'item-moving-bubble'
      || !selection.sourceUid) return;
    const source = selection.sourceType === 'survivor'
      ? this.state.survivors.find((item) => item.uid === selection.sourceUid)
      : this.state.buildings.find((item) => item.uid === selection.sourceUid);
    if (!source) return;
    const position = this.entityCanvasPosition(source);
    if (!this.isWorldScreenPositionVisible(position)) return;
    const zoom = this.camera.zoom;
    drawAssetOrFallback(ctx, this.assetStore, 'item-moving-bubble-world', (asset) => {
      ctx.globalAlpha *= 0.9;
      ctx.drawImage(asset, position.x - 56 * zoom, position.y - 106 * zoom, 112 * zoom, 112 * zoom);
    }, () => {});
  }

  drawWorldActors(ctx) {
    const actors = [];
    const zoom = this.camera.zoom;
    const buildingAutotileIndex = this.createBuildingAutotileIndex();
    const underAttack = this.state.phase === 'battle'
      || this.state.enemies.some((enemy) => !enemy.dead);
    for (const site of this.visibleWorldPois || []) {
      const position = this.cellCenter(site.x, site.y);
      if (!this.isWorldScreenPositionVisible(position, 120 * zoom)) continue;
      actors.push({ kind: 'poi', entity: site, depth: site.y + 0.72, rank: 1 });
    }
    for (const building of this.state.buildings) {
      const position = this.entityCanvasPosition(building);
      if (!this.isWorldScreenPositionVisible(position, 150 * zoom)) continue;
      const card = BUILDING_BY_ID[building.cardId];
      const shape = rotatedFootprint(card, building.rotation);
      // The body is anchored to the exact cell bottom, but shares the unit's
      // logical contact depth so a slime stationed in the same one-cell module
      // remains visible in front of the structure.
      actors.push({
        kind: 'building',
        entity: building,
        depth: building.y + shape.height - 0.22,
        rank: 0,
      });
    }
    for (const item of this.state.deployables) {
      const position = this.cellCenter(item.x, item.y);
      if (!this.isWorldScreenPositionVisible(position, 80 * zoom)) continue;
      actors.push({ kind: 'deployable', entity: item, depth: item.y + 0.72, rank: 1 });
    }
    for (const survivor of this.state.survivors) {
      const position = this.entityCanvasPosition(survivor);
      if (!this.isWorldScreenPositionVisible(position, 120 * zoom)) continue;
      actors.push({ kind: 'survivor', entity: survivor, depth: survivor.y + 0.78, rank: 2 });
    }
    for (const enemy of this.state.enemies) {
      const position = this.entityCanvasPosition(enemy);
      if (!this.isWorldScreenPositionVisible(position, 160 * zoom)) continue;
      actors.push({ kind: 'enemy', entity: enemy, depth: enemy.y + 0.78, rank: 2 });
    }
    for (const enemy of this.state.worldExpedition?.enemies || []) {
      const position = this.entityCanvasPosition(enemy);
      if (!this.isWorldScreenPositionVisible(position, 160 * zoom)) continue;
      actors.push({ kind: 'enemy', entity: enemy, depth: enemy.y + 0.78, rank: 2 });
    }
    actors.sort((left, right) => (
      left.depth - right.depth
      || left.rank - right.rank
      || (left.entity.x || 0) - (right.entity.x || 0)
    ));
    for (const actor of actors) {
      if (actor.kind === 'building') {
        this.drawBuildings(ctx, [actor.entity], {
          autotileIndex: buildingAutotileIndex,
          underAttack,
        });
      }
      else if (actor.kind === 'deployable') this.drawDeployables(ctx, [actor.entity]);
      else if (actor.kind === 'poi') this.drawWorldPoiActor(ctx, actor.entity);
      else this.drawUnits(ctx, [actor]);
    }
  }

  drawBuildings(
    ctx,
    buildings = this.state.buildings,
    { autotileIndex = null, underAttack: providedUnderAttack = null } = {},
  ) {
    const sorted = buildings.length > 1
      ? [...buildings].sort((a, b) => a.y - b.y || a.x - b.x)
      : buildings;
    const connectionIndex = autotileIndex || this.createBuildingAutotileIndex();
    const zoom = this.camera.zoom;
    const underAttack = typeof providedUnderAttack === 'boolean'
      ? providedUnderAttack
      : this.state.phase === 'battle' || this.state.enemies.some((enemy) => !enemy.dead);
    for (const building of sorted) {
      const position = this.entityCanvasPosition(building);
      if (!this.isWorldScreenPositionVisible(position, 150 * zoom)) continue;
      if (building.destroyed && underAttack) {
        drawAssetOrFallback(ctx, this.assetStore, 'tile-building-rubble', (asset) => {
          ctx.globalAlpha *= 0.72;
          ctx.drawImage(asset, position.x - 34 * zoom, position.y - 39 * zoom, 68 * zoom, 68 * zoom);
        }, () => {
          ctx.globalAlpha = 0.38;
          ctx.fillStyle = '#756B67';
          ctx.beginPath();
          ctx.ellipse(position.x, position.y - 5 * zoom, 30 * zoom, 13 * zoom, 0, 0, TAU);
          ctx.fill();
        });
        continue;
      }
      const card = BUILDING_BY_ID[building.cardId];
      const { x: centerX, y: centerY } = position;
      const selected = this.selection?.uid === building.uid;
      const placeProgress = clamp((this.time - building.placedAt) / 0.24, 0, 1);
      const scale = building.placedAt > 0 ? easeOutBack(placeProgress) : 1;
      ctx.save();
      if (building.underConstruction) ctx.globalAlpha *= 0.58;
      ctx.translate(centerX, centerY);
      ctx.scale(scale * zoom, scale * zoom);
      const autotileProfile = BUILDING_AUTOTILE_PROFILE_BY_CARD_ID[card.id];
      const autotileMask = autotileProfile
        ? this.buildingAutotileMask(building, connectionIndex)
        : 0;
      drawBuilding(ctx, 0, 0, BUILDING_WORLD_SLOT, BUILDING_VARIANT[card.id], {
        assetStore: this.assetStore,
        assetKey: autotileProfile?.assetKey,
        sourceRect: autotileProfile ? autotileFrameRect(autotileMask) : null,
        time: this.time,
        selected,
        active: underAttack && !building.underConstruction,
        ghost: building.underConstruction,
        damage: 1 - building.hp / building.maxHp,
        disabled: building.destroyed,
      });
      ctx.restore();
      if (building.underConstruction) {
        const barWidth = 68 * zoom;
        drawRoundedRect(ctx, centerX - barWidth / 2, centerY - 84 * zoom, barWidth, 9 * zoom, {
          radius: 5 * zoom,
          fill: 'rgba(38,54,66,0.58)',
        });
        drawRoundedRect(
          ctx,
          centerX - barWidth / 2 + zoom,
          centerY - 83 * zoom,
          (barWidth - 2 * zoom) * clamp(building.buildProgress || 0, 0, 1),
          7 * zoom,
          { radius: 4 * zoom, fill: '#F6BE58' },
        );
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#FFF8E9';
        ctx.font = `800 ${Math.max(10, 12 * zoom)}px "PingFang SC", sans-serif`;
        ctx.fillText('施工中', centerX, centerY - 91 * zoom);
        ctx.restore();
        continue;
      }
      if (underAttack && !building.destroyed) {
        this.drawHealthBar(ctx, centerX, centerY - 96 * zoom, 54 * zoom, building.hp / building.maxHp, building.shield > 0);
        let statusX = centerX + 34 * zoom;
        if (building.shield > 0) {
          drawStatusIcon(ctx, statusX, centerY - 84 * zoom, 22 * zoom, 'shield', {
            assetStore: this.assetStore, time: this.time, shadow: false,
          });
          statusX += 22 * zoom;
        }
        if (building.poisoned > 0) {
          drawStatusIcon(ctx, statusX, centerY - 84 * zoom, 22 * zoom, 'poison', {
            assetStore: this.assetStore, time: this.time, shadow: false,
          });
        }
      }
    }
  }

  drawDeployables(ctx, deployables = this.state.deployables) {
    const zoom = this.camera.zoom;
    for (const item of deployables) {
      const position = this.cellCenter(item.x, item.y);
      if (!this.isWorldScreenPositionVisible(position, 80 * zoom)) continue;
      if (item.type === 'pad') {
        drawAssetOrFallback(ctx, this.assetStore, 'item-spring-pad-world', (asset) => {
          ctx.translate(position.x, position.y + 14 * zoom);
          ctx.rotate(Math.atan2(item.dy, item.dx));
          ctx.drawImage(asset, -28 * zoom, -28 * zoom, 56 * zoom, 56 * zoom);
        }, () => {
          ctx.translate(position.x, position.y + 14 * zoom);
          ctx.scale(zoom, zoom);
          ctx.fillStyle = '#79D886';
          ctx.strokeStyle = PALETTE.inkSoft;
          ctx.lineWidth = 3;
          roundedRectPath(ctx, -28, -18, 56, 36, 12);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(item.dx * 17, item.dy * 17);
          ctx.lineTo(-item.dy * 9 - item.dx * 5, item.dx * 9 - item.dy * 5);
          ctx.lineTo(item.dy * 9 - item.dx * 5, -item.dx * 9 - item.dy * 5);
          ctx.closePath();
          ctx.fillStyle = '#FFF8E9';
          ctx.fill();
        });
      } else if (item.type === 'lure') {
        const wobble = Math.sin(this.time * 5) * 3;
        drawAssetOrFallback(ctx, this.assetStore, 'item-lure-jelly-world', (asset) => {
          ctx.translate(position.x, position.y + 10 * zoom);
          ctx.scale(1 - wobble * 0.006, 1 + wobble * 0.006);
          ctx.drawImage(asset, -25 * zoom, -40 * zoom, 50 * zoom, 50 * zoom);
        }, () => {
          ctx.translate(position.x, position.y + 10 * zoom);
          ctx.scale(zoom, zoom);
          ctx.fillStyle = '#F3A85F';
          ctx.strokeStyle = PALETTE.inkSoft;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(-25, 6);
          ctx.quadraticCurveTo(-28, -20 + wobble, 0, -23 - wobble);
          ctx.quadraticCurveTo(28, -20 + wobble, 25, 6);
          ctx.quadraticCurveTo(0, 17, -25, 6);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        });
      }
    }
  }

  drawUnits(ctx, providedUnits = null) {
    const zoom = this.camera.zoom;
    const units = providedUnits
      ? (providedUnits.length > 1 ? [...providedUnits] : providedUnits)
      : [];
    if (!providedUnits) {
      this.state.survivors.forEach((survivor) => units.push({ kind: 'survivor', entity: survivor, depth: survivor.y + 0.15 }));
      this.state.enemies.forEach((enemy) => units.push({ kind: 'enemy', entity: enemy, depth: enemy.y + 0.5 }));
    }
    if (units.length > 1) units.sort((a, b) => a.depth - b.depth);
    for (const unit of units) {
      if (unit.kind === 'survivor') {
        const survivor = unit.entity;
        const position = this.entityCanvasPosition(survivor);
        if (!this.isWorldScreenPositionVisible(position, 120 * zoom)) continue;
        // The sprout's tall leaves share the row above; a small grounded offset
        // keeps them visually separate from a crystal defender in that row.
        if (survivor.cardId === 'survivor-moss-sprout') position.y += 7 * zoom;
        const selected = this.selection?.uid === survivor.uid || this.selection?.firstUid === survivor.uid || this.selection?.sourceUid === survivor.uid;
        drawSlime(ctx, position.x, position.y, 68 * zoom, SURVIVOR_VARIANT[survivor.cardId], {
          assetStore: this.assetStore,
          time: this.time,
          pose: this.entityAnimationPose(survivor),
          expressionSample: this.entityExpressionSample(survivor),
          rigAsset: this.rigAssetFor(survivor.cardId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
          facing: this.entityFacing(survivor, 1),
          selected,
          disabled: survivor.downed,
          hit: survivor.hitFlash,
          shield: clamp((survivor.shield || 0) / 90, 0, 1),
          phase: survivor.x * 0.7 + survivor.y,
        });
        if (survivor.carrying?.resourceType && Number(survivor.carrying.amount) > 0) {
          const cargoSize = 31 * zoom;
          const cargoX = position.x + 29 * zoom;
          const cargoY = position.y - 43 * zoom;
          this.drawResourceToken(ctx, survivor.carrying.resourceType, cargoX, cargoY, cargoSize);
          ctx.save();
          ctx.fillStyle = '#FFF8E9';
          ctx.strokeStyle = PALETTE.inkSoft;
          ctx.lineWidth = Math.max(1.2, 1.7 * zoom);
          ctx.beginPath();
          ctx.arc(cargoX + cargoSize * 0.32, cargoY + cargoSize * 0.3, cargoSize * 0.23, 0, TAU);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = PALETTE.ink;
          ctx.font = `900 ${Math.max(8, 10 * zoom)}px "PingFang SC", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${Math.floor(survivor.carrying.amount)}`, cargoX + cargoSize * 0.32, cargoY + cargoSize * 0.31);
          ctx.restore();
        }
        if (!survivor.downed) this.drawHealthBar(ctx, position.x, position.y - 75 * zoom, 48 * zoom, survivor.hp / survivor.maxHp, survivor.shield > 0);
        let statusX = position.x + 28 * zoom;
        if (survivor.shield > 0) {
          drawStatusIcon(ctx, statusX, position.y - 64 * zoom, 22 * zoom, 'shield', {
            assetStore: this.assetStore, time: this.time, shadow: false,
          });
          statusX += 22 * zoom;
        }
        if (survivor.seed > 0) drawStatusIcon(ctx, statusX, position.y - 64 * zoom, 22 * zoom, 'heal', {
          assetStore: this.assetStore, time: this.time, shadow: false,
        });
      } else {
        const enemy = unit.entity;
        const deathElapsed = enemy.deathElapsed || 0;
        const deathDuration = this.enemyDeathDuration(enemy);
        if (enemy.dead && deathElapsed >= deathDuration) continue;
        const position = this.entityCanvasPosition(enemy);
        if (!this.isWorldScreenPositionVisible(position, 160 * zoom)) continue;
        const card = ENEMY_BY_ID[enemy.cardId];
        const alpha = enemy.dead ? clamp(1 - deathElapsed / deathDuration, 0, 1) : 1;
        drawMonster(ctx, position.x, position.y, (card.elite ? 100 : 62) * zoom, ENEMY_VARIANT[enemy.cardId], {
          assetStore: this.assetStore,
          time: this.time,
          pose: this.entityAnimationPose(enemy),
          expressionSample: this.entityExpressionSample(enemy),
          rigAsset: this.rigAssetFor(enemy.cardId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
          facing: this.entityFacing(enemy, -1),
          alpha,
          hit: enemy.hitFlash,
          targeted: enemy.marked,
          phase: Number(enemy.uid.split('-').pop()) * 0.4,
        });
        if (!enemy.dead) this.drawHealthBar(ctx, position.x, position.y - (card.elite ? 112 : 68) * zoom, (card.elite ? 82 : 46) * zoom, enemy.hp / enemy.maxHp, false, true);
        let iconX = position.x + 27 * zoom;
        if (enemy.marked) {
          drawStatusIcon(ctx, iconX, position.y - 60 * zoom, 22 * zoom, 'marked', {
            assetStore: this.assetStore, time: this.time, shadow: false,
          });
          iconX += 22 * zoom;
        }
        if (enemy.stagger > 0) drawStatusIcon(ctx, iconX, position.y - 60 * zoom, 22 * zoom, 'stun', {
          assetStore: this.assetStore, time: this.time, shadow: false,
        });
        if (enemy.stagger > 0) iconX += 22 * zoom;
        if (enemy.rooted > 0) {
          drawStatusIcon(ctx, iconX, position.y - 60 * zoom, 22 * zoom, 'slow', {
            assetStore: this.assetStore, time: this.time, shadow: false,
          });
          iconX += 22 * zoom;
        }
        if (enemy.bubbleStatus > 0) drawStatusIcon(ctx, iconX, position.y - 60 * zoom, 22 * zoom, 'bubble', {
          assetStore: this.assetStore, time: this.time, shadow: false,
        });
        if (enemy.telegraph > 0) {
          const telegraphProgress = 1 - enemy.telegraph
            / ENEMY_BY_ID[enemy.cardId].ability.telegraphSeconds;
          drawAssetOrFallback(ctx, this.assetStore, 'effect-boss-acid-telegraph', (asset) => {
            ctx.globalAlpha *= 0.6 + Math.sin(this.time * 10) * 0.25;
            ctx.translate(position.x, position.y - 48 * zoom);
            if (typeof ctx.clip === 'function') {
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.arc(0, 0, 54 * zoom, -Math.PI / 2, -Math.PI / 2 + TAU * telegraphProgress);
              ctx.closePath();
              ctx.clip();
            }
            ctx.drawImage(asset, -51 * zoom, -51 * zoom, 102 * zoom, 102 * zoom);
          }, () => {
            ctx.strokeStyle = PALETTE.danger;
            ctx.lineWidth = 4;
            ctx.globalAlpha = 0.6 + Math.sin(this.time * 10) * 0.25;
            ctx.beginPath();
            ctx.arc(
              position.x,
              position.y - 48 * zoom,
              51 * zoom,
              -Math.PI / 2,
              -Math.PI / 2 + TAU * telegraphProgress,
            );
            ctx.stroke();
          });
        }
      }
    }
  }

  drawWorldEffects(ctx, layer) {
    for (const effect of this.state.worldEffects) {
      if (effect.layer !== layer) continue;
      const progress = clamp(1 - effect.life / effect.maxLife, 0, 1);
      const scale = lerp(effect.scaleFrom, effect.scaleTo, progress);
      const fadeIn = clamp(progress * 6, 0, 1);
      const fadeOut = clamp((1 - progress) * 2.4, 0, 1);
      drawAssetOrFallback(ctx, this.assetStore, effect.assetKey, (asset) => {
        ctx.globalAlpha *= fadeIn * fadeOut;
        ctx.translate(effect.x, effect.y);
        ctx.rotate(effect.rotation);
        ctx.scale(scale, scale);
        ctx.drawImage(
          asset,
          -effect.width / 2,
          -effect.height / 2,
          effect.width,
          effect.height,
        );
      }, () => {});
    }
  }

  drawAuthoredDynamicEffect(ctx, effect, progress, options = {}) {
    const assetKey = AUTHORED_DYNAMIC_EFFECT_ASSET_BY_KIND[effect.kind];
    if (!assetKey) return false;
    const reveal = easeOutBack(effectPhase(progress, 0, options.revealEnd ?? 0.72));
    const fadeIn = effectPhase(progress, 0, options.fadeInEnd ?? 0.08);
    const fadeOut = 1 - effectPhase(progress, options.fadeOutStart ?? 0.62, 1);
    const scaleX = lerp(options.scaleFromX ?? 0.5, options.scaleToX ?? 1.06, reveal);
    const scaleY = lerp(options.scaleFromY ?? 0.5, options.scaleToY ?? 1.06, reveal);
    const width = Math.max(1, Number(options.width) || 96);
    const height = Math.max(1, Number(options.height) || width);
    return drawAssetOrFallback(ctx, this.assetStore, assetKey, (asset) => {
      ctx.globalAlpha *= fadeIn * fadeOut * clamp(options.alpha ?? 1, 0, 1);
      ctx.translate(Number(options.x) || 0, Number(options.y) || 0);
      ctx.rotate((Number(options.rotation) || 0) + progress * (Number(options.rotationTravel) || 0));
      ctx.scale(scaleX, scaleY);
      ctx.drawImage(asset, -width / 2, -height / 2, width, height);
    }, () => {});
  }

  resetDynamicComponentBudget() {
    this.dynamicComponentGeneralRemaining = DYNAMIC_EFFECT_COMPONENT_GENERAL_BUDGET;
    this.dynamicComponentAbilityReserveRemaining = DYNAMIC_EFFECT_COMPONENT_ABILITY_RESERVE;
    this.dynamicComponentWaveReserveRemaining = DYNAMIC_EFFECT_COMPONENT_WAVE_RESERVE;
    this.dynamicComponentDrawCount = 0;
    this.dynamicComponentPriority = 0;
  }

  dynamicEffectCullPadding(effect) {
    const travel = Math.hypot(Number(effect?.dx) || 0, Number(effect?.dy) || 0);
    const intensity = clamp(Number(effect?.intensity) || 1, 0.45, 2.2);
    // Push/trail/swap artwork can span the full vector even when its origin is
    // outside the viewport. A conservative travel-aware radius keeps every
    // intersecting pixel while still rejecting effects that are wholly away.
    return 180 + travel * intensity;
  }

  isDynamicEffectVisible(effect) {
    return this.isWorldScreenPositionVisible(
      effect,
      this.dynamicEffectCullPadding(effect),
    );
  }

  drawDynamicComponent(ctx, componentName, options = {}) {
    const cell = DYNAMIC_EFFECT_COMPONENTS[componentName];
    if (!cell) return false;
    const width = Math.max(1, Number(options.width) || 24);
    const height = Math.max(1, Number(options.height) || width);
    const alpha = clamp(Number.isFinite(options.alpha) ? options.alpha : 1, 0, 1);
    if (alpha <= 0) return false;
    const budgetKind = this.dynamicComponentGeneralRemaining > 0
      ? 'general'
      : this.dynamicComponentPriority >= 3 && this.dynamicComponentWaveReserveRemaining > 0
        ? 'wave'
        : this.dynamicComponentPriority >= 2 && this.dynamicComponentAbilityReserveRemaining > 0
          ? 'ability'
          : null;
    if (!budgetKind) return false;
    const x = Number(options.x) || 0;
    const y = Number(options.y) || 0;
    const rotation = Number(options.rotation) || 0;
    const scaleX = Number.isFinite(options.scaleX) ? options.scaleX : 1;
    const scaleY = Number.isFinite(options.scaleY) ? options.scaleY : 1;
    return drawAssetOrFallback(
      ctx,
      this.assetStore,
      DYNAMIC_EFFECT_ATLAS_KEY,
      (asset) => {
        const dimensions = imageDimensions(asset, 1254, 1254);
        const sourceWidth = dimensions.width / DYNAMIC_EFFECT_ATLAS_GRID;
        const sourceHeight = dimensions.height / DYNAMIC_EFFECT_ATLAS_GRID;
        ctx.globalAlpha *= alpha;
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.scale(scaleX, scaleY);
        ctx.drawImage(
          asset,
          cell.column * sourceWidth,
          cell.row * sourceHeight,
          sourceWidth,
          sourceHeight,
          -width / 2,
          -height / 2,
          width,
          height,
        );
        if (budgetKind === 'general') this.dynamicComponentGeneralRemaining -= 1;
        else if (budgetKind === 'wave') this.dynamicComponentWaveReserveRemaining -= 1;
        else this.dynamicComponentAbilityReserveRemaining -= 1;
        this.dynamicComponentDrawCount += 1;
      },
      () => {},
    );
  }

  drawDynamicEffects(ctx, layer) {
    const effects = this.state.dynamicEffects || [];
    let impactCount = 0;
    let pushCount = 0;
    let enemyPopCount = 0;
    for (const effect of effects) {
      if (effect.layer !== layer || !this.isDynamicEffectVisible(effect)) continue;
      if (effect.kind === 'impact') impactCount += 1;
      else if (effect.kind === 'push') pushCount += 1;
      else if (effect.kind === 'enemy-pop') enemyPopCount += 1;
    }
    for (const effect of effects) {
      if (
        effect.layer !== layer
        || !this.isDynamicEffectVisible(effect)
      ) continue;
      const progress = clamp(1 - effect.life / effect.maxLife, 0, 1);
      this.dynamicComponentPriority = DYNAMIC_EFFECT_COMPONENT_PRIORITY[effect.kind] ?? 0;
      ctx.save();
      ctx.translate(effect.x, effect.y);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (effect.kind === 'impact') this.drawDynamicImpact(ctx, effect, progress, impactCount > 6);
      else if (effect.kind === 'push') this.drawDynamicPush(ctx, effect, progress, pushCount > 3);
      else if (effect.kind === 'enemy-pop') this.drawDynamicEnemyPop(ctx, effect, progress, enemyPopCount > 3);
      else if (effect.kind === 'building-destruction') this.drawDynamicBuildingDestruction(ctx, effect, progress);
      else if (effect.kind === 'shield-break') this.drawDynamicShieldBreak(ctx, effect, progress);
      else if (effect.kind === 'heal') this.drawDynamicHeal(ctx, effect, progress);
      else if (effect.kind === 'spawn') this.drawDynamicSpawn(ctx, effect, progress);
      else if (effect.kind === 'trail') this.drawDynamicTrail(ctx, effect, progress);
      else if (effect.kind === 'swap') this.drawDynamicSwap(ctx, effect, progress);
      else if (effect.kind === 'wave-clear') this.drawDynamicWaveClear(ctx, effect, progress);
      else this.drawDynamicPlace(ctx, effect, progress);
      ctx.restore();
    }
    this.dynamicComponentPriority = 0;
  }

  drawDynamicImpact(ctx, effect, progress, reducedIllustration = false) {
    const intensity = effect.intensity;
    const burst = easeOutCubic(effectPhase(progress, 0, 0.72));
    const fade = 1 - effectPhase(progress, 0.46, 1);
    const flash = 1 - effectPhase(progress, 0.02, 0.34);

    ctx.save();
    ctx.globalAlpha *= flash * 0.92;
    ctx.fillStyle = effect.accent;
    ctx.beginPath();
    ctx.ellipse(0, 0, (15 + burst * 9) * intensity, (9 + burst * 5) * intensity, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    this.drawDynamicComponent(ctx, 'impact-core', {
      width: (42 + burst * 18) * intensity,
      height: (42 + burst * 18) * intensity,
      rotation: progress * 0.45,
      alpha: flash,
    });

    ctx.save();
    ctx.globalAlpha *= fade * 0.9;
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = Math.max(2, 5 * intensity * (1 - progress * 0.7));
    ctx.beginPath();
    ctx.ellipse(0, 0, (8 + burst * 45) * intensity, (5 + burst * 26) * intensity, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
    this.drawDynamicComponent(ctx, 'shock-ring', {
      width: (36 + burst * 82) * intensity,
      height: (20 + burst * 45) * intensity,
      rotation: progress * 0.18,
      alpha: fade * 0.9,
    });

    const rayCount = 8;
    for (let index = 0; index < rayCount; index += 1) {
      const stagger = index * 0.014;
      if (progress < stagger) continue;
      const local = effectPhase(progress, stagger, 0.78 + stagger);
      const rayFade = 1 - effectPhase(local, 0.42, 1);
      const angle = (index / rayCount) * TAU + (effectNoise(effect.seed, index) - 0.5) * 0.25;
      const reach = (18 + effectNoise(effect.seed, index + 20) * 15) * intensity * easeOutBack(local);
      const retract = 7 + 14 * effectPhase(local, 0.3, 1);
      ctx.save();
      ctx.rotate(angle);
      ctx.globalAlpha *= rayFade;
      ctx.strokeStyle = index % 3 === 0 ? effect.accent : effect.color;
      ctx.lineWidth = (index % 3 === 0 ? 4.2 : 2.6) * intensity;
      ctx.beginPath();
      ctx.moveTo(Math.max(6, reach - retract), 0);
      ctx.lineTo(reach + 12 * intensity, 0);
      ctx.stroke();
      ctx.restore();
      if (!reducedIllustration && index % 2 === 0) {
        this.drawDynamicComponent(ctx, 'impact-streak', {
          x: Math.cos(angle) * (reach + 5 * intensity),
          y: Math.sin(angle) * (reach + 5 * intensity),
          width: (24 + 12 * (1 - local)) * intensity,
          height: (13 + 5 * (1 - local)) * intensity,
          rotation: angle + 0.7,
          alpha: rayFade,
        });
      }
    }
  }

  drawDynamicPush(ctx, effect, progress, reducedIllustration = false) {
    const length = Math.max(1, Math.hypot(effect.dx, effect.dy));
    if (this.drawAuthoredDynamicEffect(ctx, effect, progress, {
      width: Math.max(118, length * 1.55) * effect.intensity,
      height: Math.max(78, length * 0.82) * effect.intensity,
      rotation: Math.atan2(effect.dy, effect.dx),
      rotationTravel: 0.06,
      scaleFromX: 0.34,
      scaleFromY: 0.68,
      scaleToX: 1.04,
      scaleToY: 1.02,
      fadeOutStart: 0.58,
    })) return;
    const nx = effect.dx / length;
    const ny = effect.dy / length;
    const px = -ny;
    const py = nx;
    const travel = easeOutBack(effectPhase(progress, 0, 0.82));
    const fade = 1 - effectPhase(progress, 0.62, 1);

    const trailCount = reducedIllustration ? 2 : 3;
    for (let index = 0; index < trailCount; index += 1) {
      const local = effectPhase(progress, index * 0.055, 0.82 + index * 0.035);
      if (local <= 0) continue;
      const wave = Math.sin(local * Math.PI) * (10 + index * 4) * (index % 2 ? -1 : 1);
      const endX = effect.dx * easeOutCubic(local);
      const endY = effect.dy * easeOutCubic(local);
      ctx.save();
      ctx.globalAlpha *= fade * (0.8 - index * 0.15);
      ctx.strokeStyle = index === 1 ? effect.accent : effect.color;
      ctx.lineWidth = (8 - index * 2) * effect.intensity * (1 - local * 0.42);
      ctx.beginPath();
      ctx.moveTo(-nx * (8 + index * 7), -ny * (8 + index * 7));
      ctx.quadraticCurveTo(
        endX * 0.48 + px * wave,
        endY * 0.48 + py * wave,
        endX,
        endY,
      );
      ctx.stroke();
      ctx.restore();
    }

    const bubbleCount = reducedIllustration ? 2 : 5;
    for (let index = 0; index < bubbleCount; index += 1) {
      const start = index * 0.035;
      if (progress < start) continue;
      const local = effectPhase(progress, start, 0.78 + index * 0.025);
      const distanceAlong = length * easeOutCubic(local) * (0.32 + index * 0.14);
      const side = (effectNoise(effect.seed, index) - 0.5) * 26;
      const radius = (3 + effectNoise(effect.seed, index + 10) * 4) * effect.intensity;
      ctx.save();
      ctx.globalAlpha *= fade * (1 - local * 0.42);
      ctx.strokeStyle = effect.accent;
      ctx.fillStyle = effect.color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(nx * distanceAlong + px * side, ny * distanceAlong + py * side, radius, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      this.drawDynamicComponent(ctx, 'bubble', {
        x: nx * distanceAlong + px * side,
        y: ny * distanceAlong + py * side,
        width: radius * 4.1,
        height: radius * 4.1,
        rotation: local * (index % 2 ? 0.8 : -0.8),
        alpha: fade * (1 - local * 0.3),
      });
    }

    const rebound = effectPhase(progress, 0.42, 1);
    ctx.save();
    ctx.translate(effect.dx * travel, effect.dy * travel);
    ctx.globalAlpha *= (1 - rebound) * 0.85;
    ctx.strokeStyle = effect.accent;
    ctx.lineWidth = 4 * effect.intensity * (1 - rebound * 0.55);
    ctx.beginPath();
    ctx.ellipse(0, 0, (9 + rebound * 26) * effect.intensity, (14 + rebound * 12) * effect.intensity, Math.atan2(effect.dy, effect.dx), 0, TAU);
    ctx.stroke();
    ctx.restore();
    this.drawDynamicComponent(ctx, 'shock-ring', {
      x: effect.dx * travel,
      y: effect.dy * travel,
      width: (32 + rebound * 46) * effect.intensity,
      height: (18 + rebound * 30) * effect.intensity,
      rotation: Math.atan2(effect.dy, effect.dx),
      alpha: (1 - rebound) * 0.85,
    });
  }

  drawDynamicEnemyPop(ctx, effect, progress, reducedIllustration = false) {
    const charge = effectPhase(progress, 0, 0.2);
    const explode = effectPhase(progress, 0.14, 0.92);
    const fade = 1 - effectPhase(progress, 0.66, 1);

    if (progress < 0.24) {
      ctx.save();
      ctx.globalAlpha *= 1 - effectPhase(progress, 0.16, 0.24);
      ctx.fillStyle = effect.accent;
      ctx.strokeStyle = effect.color;
      ctx.lineWidth = 4 * effect.intensity;
      ctx.beginPath();
      ctx.ellipse(
        0,
        8 * charge,
        (20 + charge * 14) * effect.intensity,
        (20 - charge * 11) * effect.intensity,
        0,
        0,
        TAU,
      );
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      this.drawDynamicComponent(ctx, 'impact-core', {
        y: 8 * charge,
        width: (42 + charge * 18) * effect.intensity,
        height: (42 - charge * 18) * effect.intensity,
        rotation: charge * 0.25,
        alpha: 1 - effectPhase(progress, 0.16, 0.24),
      });
    }

    ctx.save();
    ctx.globalAlpha *= fade * 0.9;
    ctx.strokeStyle = effect.accent;
    ctx.lineWidth = 5 * effect.intensity * (1 - explode * 0.72);
    ctx.beginPath();
    ctx.ellipse(0, 0, (8 + easeOutCubic(explode) * 54) * effect.intensity, (5 + easeOutCubic(explode) * 33) * effect.intensity, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
    this.drawDynamicComponent(ctx, 'shock-ring', {
      width: (26 + easeOutCubic(explode) * 108) * effect.intensity,
      height: (14 + easeOutCubic(explode) * 66) * effect.intensity,
      rotation: explode * 0.3,
      alpha: fade * 0.9,
    });

    const dropletCount = reducedIllustration ? 4 : effect.intensity > 1.4 ? 12 : 8;
    for (let index = 0; index < dropletCount; index += 1) {
      const start = 0.12 + index * 0.008;
      if (progress < start) continue;
      const local = effectPhase(progress, start, 0.94);
      const angle = (index / dropletCount) * TAU + effectNoise(effect.seed, index) * 0.65;
      const reach = (34 + effectNoise(effect.seed, index + 30) * 42) * effect.intensity;
      const distanceOut = easeOutCubic(local) * reach;
      const gravity = local * local * (18 + effectNoise(effect.seed, index + 50) * 22);
      const size = (4 + effectNoise(effect.seed, index + 70) * 6) * effect.intensity * (1 - local * 0.32);
      const x = Math.cos(angle) * distanceOut;
      const y = Math.sin(angle) * distanceOut + gravity;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + local * (index % 2 ? 3 : -3));
      ctx.globalAlpha *= fade;
      ctx.fillStyle = index % 4 === 0 ? effect.accent : effect.color;
      ctx.beginPath();
      ctx.moveTo(-size, 0);
      ctx.quadraticCurveTo(-size * 0.35, -size * 0.9, size * 0.8, -size * 0.25);
      ctx.quadraticCurveTo(size * 1.25, size * 0.4, 0, size * 0.72);
      ctx.quadraticCurveTo(-size * 0.9, size * 0.55, -size, 0);
      ctx.fill();
      ctx.restore();
      if (index < (reducedIllustration ? 4 : 8)) {
        this.drawDynamicComponent(ctx, 'gel-drop', {
          x,
          y,
          width: size * 3.8,
          height: size * 4.4,
          rotation: angle + local * (index % 2 ? 3 : -3),
          alpha: fade,
        });
      }
    }

    const popSparkCount = reducedIllustration ? 0 : 5;
    for (let index = 0; index < popSparkCount; index += 1) {
      const angle = (index / 5) * TAU + 0.5;
      const start = 0.2 + index * 0.02;
      if (progress < start) continue;
      const local = effectPhase(progress, start, 0.82);
      const radius = (24 + index * 8) * easeOutCubic(local) * effect.intensity;
      const size = 5 * (1 - local) * effect.intensity;
      ctx.save();
      ctx.translate(Math.cos(angle) * radius, Math.sin(angle) * radius);
      ctx.rotate(angle + local * 2);
      ctx.globalAlpha *= (1 - local) * fade;
      ctx.fillStyle = effect.accent;
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.5);
      ctx.lineTo(size * 0.5, -size * 0.45);
      ctx.lineTo(size * 1.5, 0);
      ctx.lineTo(size * 0.5, size * 0.45);
      ctx.lineTo(0, size * 1.5);
      ctx.lineTo(-size * 0.5, size * 0.45);
      ctx.lineTo(-size * 1.5, 0);
      ctx.lineTo(-size * 0.5, -size * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (!reducedIllustration) {
        this.drawDynamicComponent(ctx, index % 2 ? 'sparkle' : 'heal-spark', {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          width: size * 4.2,
          height: size * 4.2,
          rotation: angle + local * 2,
          alpha: (1 - local) * fade,
        });
      }
    }
  }

  drawDynamicBuildingDestruction(ctx, effect, progress) {
    if (this.drawAuthoredDynamicEffect(ctx, effect, progress, {
      width: 132 * effect.intensity,
      height: 132 * effect.intensity,
      y: 8,
      rotation: -0.08,
      rotationTravel: 0.2,
      scaleFromX: 0.38,
      scaleFromY: 0.3,
      scaleToX: 1.12,
      scaleToY: 1.08,
      revealEnd: 0.68,
      fadeOutStart: 0.6,
    })) return;
    const burst = easeOutCubic(effectPhase(progress, 0, 0.76));
    const settle = effectPhase(progress, 0.22, 1);
    const fade = 1 - effectPhase(progress, 0.62, 1);

    ctx.save();
    ctx.globalAlpha *= fade * 0.72;
    ctx.strokeStyle = effect.accent;
    ctx.lineWidth = Math.max(2, (6 - burst * 4) * effect.intensity);
    ctx.beginPath();
    ctx.ellipse(
      0,
      13 * effect.intensity,
      (12 + burst * 52) * effect.intensity,
      (5 + burst * 19) * effect.intensity,
      0,
      0,
      TAU,
    );
    ctx.stroke();
    ctx.restore();
    this.drawDynamicComponent(ctx, 'shock-ring', {
      y: 13 * effect.intensity,
      width: (24 + burst * 104) * effect.intensity,
      height: (12 + burst * 42) * effect.intensity,
      rotation: progress * 0.14,
      alpha: fade * 0.72,
    });

    for (let index = 0; index < 6; index += 1) {
      const angle = Math.PI + (index / 5) * Math.PI;
      const noise = effectNoise(effect.seed, index + 90);
      const reach = (24 + noise * 34) * burst * effect.intensity;
      const x = Math.cos(angle) * reach;
      const y = 15 + Math.sin(angle) * reach * 0.42 - settle * (7 + noise * 9);
      const size = (11 + noise * 9) * (1 - settle * 0.32) * effect.intensity;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((noise - 0.5) * 0.8 + progress * (index % 2 ? 0.45 : -0.45));
      ctx.globalAlpha *= fade * (0.74 - index * 0.045);
      ctx.fillStyle = index % 2 ? effect.accent : effect.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, size, size * 0.7, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      this.drawDynamicComponent(ctx, 'dust', {
        x,
        y,
        width: size * 2.8,
        height: size * 2.1,
        rotation: (noise - 0.5) * 0.8 + progress * (index % 2 ? 0.45 : -0.45),
        alpha: fade * (0.74 - index * 0.045),
      });
    }

    for (let index = 0; index < 5; index += 1) {
      const angle = -Math.PI * (0.18 + index * 0.16);
      const noise = effectNoise(effect.seed, index + 120);
      const travel = burst * (30 + noise * 38) * effect.intensity;
      const x = Math.cos(angle) * travel;
      const y = Math.sin(angle) * travel + settle * settle * 42 * effect.intensity;
      const size = (4 + noise * 4) * effect.intensity * (1 - settle * 0.28);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + progress * (index % 2 ? 4 : -4));
      ctx.globalAlpha *= fade;
      ctx.fillStyle = index % 2 ? effect.accent : effect.color;
      ctx.beginPath();
      ctx.moveTo(-size, -size * 0.65);
      ctx.lineTo(size * 0.9, -size * 0.4);
      ctx.lineTo(size * 0.7, size * 0.72);
      ctx.lineTo(-size * 0.8, size * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  drawDynamicShieldBreak(ctx, effect, progress) {
    const segmentedAlpha = progress < 0.12
      ? effectPhase(progress, 0, 0.12)
      : progress < 0.48
        ? 1
        : 1 - effectPhase(progress, 0.48, 1);
    if (this.drawAuthoredDynamicEffect(ctx, effect, progress, {
      width: 124 * effect.intensity,
      height: 124 * effect.intensity,
      rotation: -0.18,
      rotationTravel: 0.62,
      scaleFromX: 0.28,
      scaleFromY: 0.28,
      scaleToX: 1.1,
      scaleToY: 1.1,
      revealEnd: 0.7,
      fadeInEnd: 0.001,
      fadeOutStart: 0.999,
      alpha: segmentedAlpha,
    })) return;

    const spread = easeOutBack(effectPhase(progress, 0, 0.72));
    const fade = segmentedAlpha;
    const ringRadius = (17 + spread * 39) * effect.intensity;
    for (let segment = 0; segment < 3; segment += 1) {
      const start = segment * (TAU / 3) + progress * 0.52 + 0.12;
      ctx.save();
      ctx.globalAlpha *= fade * (0.9 - segment * 0.09);
      ctx.strokeStyle = segment === 1 ? effect.accent : effect.color;
      ctx.lineWidth = Math.max(2, (6 - spread * 3.2) * effect.intensity);
      ctx.beginPath();
      ctx.arc(0, 0, ringRadius, start, start + 1.45);
      ctx.stroke();
      ctx.restore();
    }
    this.drawDynamicComponent(ctx, 'shock-ring', {
      width: ringRadius * 2.15,
      height: ringRadius * 2.15,
      rotation: progress * 0.52,
      alpha: fade * 0.72,
    });

    for (let index = 0; index < 6; index += 1) {
      const angle = (index / 6) * TAU - Math.PI / 2 + progress * 0.62;
      const noise = effectNoise(effect.seed, index + 150);
      const distanceOut = (12 + spread * (31 + noise * 18)) * effect.intensity;
      const width = (9 + noise * 6) * effect.intensity * (1 - progress * 0.18);
      const height = width * (1.45 + noise * 0.35);
      const x = Math.cos(angle) * distanceOut;
      const y = Math.sin(angle) * distanceOut;
      const shardAlpha = fade * (0.96 - index * 0.055);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 2 + progress * (index % 2 ? 1.8 : -1.8));
      ctx.globalAlpha *= shardAlpha;
      ctx.fillStyle = index % 3 === 0 ? effect.accent : effect.color;
      ctx.strokeStyle = '#31566E';
      ctx.lineWidth = Math.max(1.4, 2.2 * effect.intensity);
      ctx.beginPath();
      ctx.moveTo(0, -height / 2);
      ctx.lineTo(width / 2, height * 0.16);
      ctx.quadraticCurveTo(0, height * 0.54, -width / 2, height * 0.16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      this.drawDynamicComponent(ctx, 'impact-streak', {
        x,
        y,
        width: width * 2.5,
        height: height * 1.75,
        rotation: angle + Math.PI / 2 + progress * (index % 2 ? 1.8 : -1.8),
        alpha: shardAlpha,
      });
    }
  }

  drawDynamicHeal(ctx, effect, progress) {
    if (this.drawAuthoredDynamicEffect(ctx, effect, progress, {
      width: 116 * effect.intensity,
      height: 116 * effect.intensity,
      y: lerp(10, -8, easeOutCubic(progress)),
      rotation: -0.12,
      rotationTravel: 0.28,
      scaleFromX: 0.4,
      scaleFromY: 0.34,
      scaleToX: 1.08,
      scaleToY: 1.12,
      fadeOutStart: 0.66,
    })) return;
    const rise = easeOutCubic(progress);
    const fade = 1 - effectPhase(progress, 0.68, 1);
    ctx.save();
    ctx.globalAlpha *= fade * 0.78;
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 4 * (1 - progress * 0.45);
    for (let ring = 0; ring < 2; ring += 1) {
      const ringProgress = effectPhase(progress, ring * 0.12, 0.84);
      ctx.beginPath();
      ctx.ellipse(0, 16 - ringProgress * 22, 13 + ringProgress * 36, 7 + ringProgress * 18, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
    for (let ring = 0; ring < 2; ring += 1) {
      const ringProgress = effectPhase(progress, ring * 0.12, 0.84);
      this.drawDynamicComponent(ctx, 'shock-ring', {
        y: 16 - ringProgress * 22,
        width: 34 + ringProgress * 78,
        height: 18 + ringProgress * 40,
        rotation: (ring % 2 ? -1 : 1) * ringProgress * 0.25,
        alpha: fade * (0.72 - ring * 0.18),
      });
    }

    this.drawDynamicComponent(ctx, 'heal-spark', {
      y: 8 - rise * 42,
      width: (24 + Math.sin(progress * Math.PI) * 18) * effect.intensity,
      height: (24 + Math.sin(progress * Math.PI) * 18) * effect.intensity,
      rotation: progress * 0.8,
      alpha: fade,
    });

    for (let index = 0; index < 8; index += 1) {
      const start = index * 0.045;
      if (progress < start) continue;
      const local = effectPhase(progress, start, 0.9);
      const angle = index * 2.399 + effect.seed * 0.01 + local * 1.8;
      const radius = (12 + index * 3.2) * (0.55 + local * 0.45);
      const x = Math.cos(angle) * radius;
      const y = 18 - rise * (38 + index * 4) + Math.sin(angle) * 5;
      const size = (4 + (index % 3)) * effect.intensity;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 4);
      ctx.globalAlpha *= fade * (0.55 + (1 - local) * 0.45);
      ctx.fillStyle = index % 3 === 0 ? effect.accent : effect.color;
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.quadraticCurveTo(size, -size * 0.25, 0, size);
      ctx.quadraticCurveTo(-size, -size * 0.25, 0, -size);
      ctx.fill();
      ctx.restore();
      this.drawDynamicComponent(ctx, 'leaf', {
        x,
        y,
        width: size * 3.5,
        height: size * 3.8,
        rotation: angle + Math.PI / 4,
        alpha: fade * (0.55 + (1 - local) * 0.45),
      });
    }
  }

  drawDynamicSpawn(ctx, effect, progress) {
    if (this.drawAuthoredDynamicEffect(ctx, effect, progress, {
      width: 142 * effect.intensity,
      height: 142 * effect.intensity,
      rotation: -0.16,
      rotationTravel: 0.42,
      scaleFromX: 0.28,
      scaleFromY: 0.22,
      scaleToX: 1.1,
      scaleToY: 1.06,
      revealEnd: 0.66,
      fadeOutStart: 0.56,
    })) return;
    const open = easeOutBack(effectPhase(progress, 0, 0.7));
    const fade = 1 - effectPhase(progress, 0.58, 1);
    for (let ring = 0; ring < 3; ring += 1) {
      ctx.save();
      ctx.rotate((ring % 2 ? -1 : 1) * progress * (1.8 + ring * 0.35));
      ctx.globalAlpha *= fade * (0.82 - ring * 0.17);
      ctx.strokeStyle = ring === 1 ? effect.accent : effect.color;
      ctx.lineWidth = (7 - ring * 1.6) * effect.intensity;
      ctx.beginPath();
      const radius = (18 + ring * 8 + open * 18) * effect.intensity;
      ctx.arc(0, 0, radius, ring * 0.7, ring * 0.7 + Math.PI * (0.9 + open * 0.35));
      ctx.stroke();
      ctx.restore();
    }
    this.drawDynamicComponent(ctx, 'shock-ring', {
      width: (56 + open * 48) * effect.intensity,
      height: (32 + open * 28) * effect.intensity,
      rotation: progress * 0.7,
      alpha: fade * 0.82,
    });
    for (let index = 0; index < 3; index += 1) {
      const angle = (index / 3) * TAU + progress * (index % 2 ? -1.8 : 1.8);
      const radius = (22 + open * 18) * effect.intensity;
      this.drawDynamicComponent(ctx, 'rift-shard', {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.7,
        width: (25 + open * 11) * effect.intensity,
        height: (31 + open * 14) * effect.intensity,
        rotation: angle + progress * (index % 2 ? -2 : 2),
        alpha: fade * (0.88 - index * 0.12),
      });
    }
    for (let index = 0; index < 7; index += 1) {
      const angle = (index / 7) * TAU + effectNoise(effect.seed, index) * 0.4;
      const start = index * 0.025;
      if (progress < start) continue;
      const local = effectPhase(progress, start, 0.82);
      const radius = lerp(62, 14, easeOutCubic(local)) * effect.intensity;
      ctx.save();
      ctx.translate(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.72);
      ctx.globalAlpha *= fade * (1 - local * 0.25);
      ctx.fillStyle = index % 3 === 0 ? effect.accent : effect.color;
      ctx.beginPath();
      ctx.arc(0, 0, 2.5 + effectNoise(effect.seed, index + 20) * 3.5, 0, TAU);
      ctx.fill();
      ctx.restore();
      if (index < 4) {
        const size = 13 + effectNoise(effect.seed, index + 20) * 9;
        this.drawDynamicComponent(ctx, index % 2 ? 'sparkle' : 'heal-spark', {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius * 0.72,
          width: size,
          height: size,
          rotation: angle + local * 2,
          alpha: fade * (1 - local * 0.25),
        });
      }
    }
  }

  drawDynamicTrail(ctx, effect, progress) {
    const length = Math.max(1, Math.hypot(effect.dx, effect.dy));
    if (this.drawAuthoredDynamicEffect(ctx, effect, progress, {
      width: Math.max(150, length * 1.16) * effect.intensity,
      height: 54 * effect.intensity,
      rotation: Math.atan2(effect.dy, effect.dx),
      rotationTravel: 0.025,
      scaleFromX: 0.06,
      scaleFromY: 0.72,
      scaleToX: 1.03,
      scaleToY: 1.04,
      revealEnd: 0.68,
      fadeOutStart: 0.6,
    })) return;
    const grow = easeOutCubic(effectPhase(progress, 0, 0.68));
    const fade = 1 - effectPhase(progress, 0.62, 1);
    const nx = effect.dx / length;
    const ny = effect.dy / length;
    const px = -ny;
    const py = nx;
    ctx.save();
    ctx.globalAlpha *= fade * 0.8;
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 13 * effect.intensity * (1 - progress * 0.25);
    ctx.beginPath();
    ctx.moveTo(-effect.dx * 0.5, -effect.dy * 0.5);
    ctx.quadraticCurveTo(px * Math.sin(progress * TAU) * 8, py * Math.sin(progress * TAU) * 8, -effect.dx * 0.5 + effect.dx * grow, -effect.dy * 0.5 + effect.dy * grow);
    ctx.stroke();
    ctx.restore();
    for (let index = 0; index < 7; index += 1) {
      const along = clamp(grow * 1.18 - index * 0.13, 0, 1);
      if (along <= 0) continue;
      const side = (effectNoise(effect.seed, index) - 0.5) * 18;
      ctx.save();
      ctx.translate(-effect.dx * 0.5 + effect.dx * along + px * side, -effect.dy * 0.5 + effect.dy * along + py * side);
      ctx.globalAlpha *= fade * (0.45 + along * 0.55);
      ctx.fillStyle = index % 3 === 0 ? effect.accent : effect.color;
      ctx.beginPath();
      ctx.arc(0, 0, 3 + effectNoise(effect.seed, index + 20) * 4, 0, TAU);
      ctx.fill();
      ctx.restore();
      if (index < 5) {
        const x = -effect.dx * 0.5 + effect.dx * along + px * side;
        const y = -effect.dy * 0.5 + effect.dy * along + py * side;
        const size = 18 + effectNoise(effect.seed, index + 20) * 12;
        this.drawDynamicComponent(ctx, 'honey', {
          x,
          y,
          width: size * 1.35,
          height: size,
          rotation: Math.atan2(effect.dy, effect.dx) + (index % 2 ? 0.18 : -0.18),
          alpha: fade * (0.5 + along * 0.5),
        });
      }
    }
  }

  drawDynamicSwap(ctx, effect, progress) {
    const length = Math.max(1, Math.hypot(effect.dx, effect.dy));
    if (this.drawAuthoredDynamicEffect(ctx, effect, progress, {
      width: Math.max(132, length * 1.22) * effect.intensity,
      height: Math.max(86, Math.min(126, length * 0.58)) * effect.intensity,
      rotation: Math.atan2(effect.dy, effect.dx),
      rotationTravel: -0.035,
      scaleFromX: 0.42,
      scaleFromY: 0.62,
      scaleToX: 1.04,
      scaleToY: 1.06,
      fadeOutStart: 0.66,
    })) return;
    const move = easeOutBack(effectPhase(progress, 0, 0.82));
    const fade = 1 - effectPhase(progress, 0.68, 1);
    for (let side = -1; side <= 1; side += 2) {
      const startX = -effect.dx * 0.5 * side;
      const startY = -effect.dy * 0.5 * side;
      const endX = effect.dx * 0.5 * side;
      const endY = effect.dy * 0.5 * side;
      const arc = side * Math.sin(move * Math.PI) * 34;
      const x = lerp(startX, endX, move);
      const y = lerp(startY, endY, move) + arc;
      ctx.save();
      ctx.globalAlpha *= fade;
      ctx.fillStyle = side < 0 ? effect.color : effect.accent;
      ctx.strokeStyle = side < 0 ? effect.accent : effect.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, (8 + Math.sin(move * Math.PI) * 5) * effect.intensity, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      this.drawDynamicComponent(ctx, side < 0 ? 'swap-mint' : 'swap-violet', {
        x,
        y,
        width: (30 + Math.sin(move * Math.PI) * 18) * effect.intensity,
        height: (30 + Math.sin(move * Math.PI) * 18) * effect.intensity,
        rotation: side * progress * 1.4,
        alpha: fade,
      });
    }
    ctx.save();
    ctx.globalAlpha *= fade * 0.55;
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 10]);
    ctx.lineDashOffset = -progress * 36;
    ctx.beginPath();
    ctx.moveTo(-effect.dx * 0.5, -effect.dy * 0.5);
    ctx.quadraticCurveTo(0, -40, effect.dx * 0.5, effect.dy * 0.5);
    ctx.stroke();
    ctx.restore();
    for (let index = 0; index < 3; index += 1) {
      const local = clamp(move - index * 0.16, 0, 1);
      const x = lerp(-effect.dx * 0.5, effect.dx * 0.5, local);
      const y = lerp(-effect.dy * 0.5, effect.dy * 0.5, local) - Math.sin(local * Math.PI) * 40;
      this.drawDynamicComponent(ctx, index % 2 ? 'heal-spark' : 'sparkle', {
        x,
        y,
        width: 12 + index * 3,
        height: 12 + index * 3,
        rotation: progress * (index % 2 ? -2.4 : 2.4),
        alpha: fade * (0.7 - index * 0.12),
      });
    }
  }

  drawDynamicPlace(ctx, effect, progress) {
    const bounce = easeOutBack(effectPhase(progress, 0, 0.72));
    const fade = 1 - effectPhase(progress, 0.62, 1);
    this.drawDynamicComponent(ctx, 'dust', {
      y: 5,
      width: (48 + bounce * 44) * effect.intensity,
      height: (24 + bounce * 18) * effect.intensity,
      scaleX: 0.75 + bounce * 0.25,
      alpha: fade * 0.78,
    });
    this.drawDynamicComponent(ctx, 'place-splash', {
      y: 2 - bounce * 13,
      width: (34 + bounce * 28) * effect.intensity,
      height: (28 + bounce * 24) * effect.intensity,
      alpha: fade * 0.9,
    });
    for (let ring = 0; ring < 2; ring += 1) {
      const local = effectPhase(progress, ring * 0.12, 0.9);
      ctx.save();
      ctx.globalAlpha *= fade * (0.8 - ring * 0.24);
      ctx.strokeStyle = ring ? effect.accent : effect.color;
      ctx.lineWidth = (5 - ring) * effect.intensity * (1 - local * 0.55);
      ctx.beginPath();
      ctx.ellipse(0, 0, (10 + bounce * (35 + ring * 13)) * effect.intensity, (5 + bounce * (13 + ring * 7)) * effect.intensity, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    this.drawDynamicComponent(ctx, 'shock-ring', {
      width: (28 + bounce * 86) * effect.intensity,
      height: (15 + bounce * 38) * effect.intensity,
      rotation: progress * 0.24,
      alpha: fade * 0.78,
    });
    for (let index = 0; index < 6; index += 1) {
      const start = index * 0.035;
      if (progress < start) continue;
      const local = effectPhase(progress, start, 0.86);
      const angle = Math.PI + (index / 5) * Math.PI;
      const radius = easeOutCubic(local) * (25 + index * 4) * effect.intensity;
      ctx.save();
      ctx.translate(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.48 - local * 12);
      ctx.globalAlpha *= fade * (1 - local * 0.25);
      ctx.fillStyle = index % 2 ? effect.color : effect.accent;
      ctx.beginPath();
      ctx.arc(0, 0, 3 + (index % 3), 0, TAU);
      ctx.fill();
      ctx.restore();
      if (index < 3) {
        this.drawDynamicComponent(ctx, index % 2 ? 'sparkle' : 'heal-spark', {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius * 0.48 - local * 12,
          width: 14 + (index % 3) * 4,
          height: 14 + (index % 3) * 4,
          rotation: angle + local * 2,
          alpha: fade * (1 - local * 0.25),
        });
      }
    }
  }

  drawDynamicWaveClear(ctx, effect, progress) {
    const expand = easeOutCubic(progress);
    const fade = 1 - effectPhase(progress, 0.56, 1);
    this.drawDynamicComponent(ctx, 'impact-core', {
      y: -expand * 22,
      width: 56 + Math.sin(progress * Math.PI) * 42,
      height: 56 + Math.sin(progress * Math.PI) * 42,
      rotation: progress * 0.65,
      alpha: fade,
    });
    for (let ring = 0; ring < 3; ring += 1) {
      const local = effectPhase(progress, ring * 0.08, 0.9);
      ctx.save();
      ctx.globalAlpha *= fade * (0.72 - ring * 0.14);
      ctx.strokeStyle = ring === 1 ? effect.accent : effect.color;
      ctx.lineWidth = (8 - ring * 2) * (1 - local * 0.55);
      ctx.beginPath();
      ctx.ellipse(0, 0, 22 + easeOutCubic(local) * (145 + ring * 26), 10 + easeOutCubic(local) * (54 + ring * 12), 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
      this.drawDynamicComponent(ctx, 'shock-ring', {
        width: 44 + easeOutCubic(local) * (290 + ring * 52),
        height: 22 + easeOutCubic(local) * (108 + ring * 24),
        rotation: (ring % 2 ? -1 : 1) * progress * 0.16,
        alpha: fade * (0.68 - ring * 0.14),
      });
    }
    for (let index = 0; index < 11; index += 1) {
      const angle = -Math.PI + (index / 10) * Math.PI;
      const distanceOut = expand * (70 + effectNoise(effect.seed, index) * 90);
      ctx.save();
      ctx.translate(Math.cos(angle) * distanceOut, Math.sin(angle) * distanceOut * 0.45 - expand * 34);
      ctx.rotate(angle + Math.PI / 2 + progress * (index % 2 ? 2 : -2));
      ctx.globalAlpha *= fade;
      ctx.fillStyle = index % 3 === 0 ? effect.accent : effect.color;
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(5, 5);
      ctx.lineTo(0, 8);
      ctx.lineTo(-5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const componentName = index % 4 === 0
        ? 'ribbon'
        : index % 3 === 0
          ? 'sparkle'
          : 'confetti';
      this.drawDynamicComponent(ctx, componentName, {
        x: Math.cos(angle) * distanceOut,
        y: Math.sin(angle) * distanceOut * 0.45 - expand * 34,
        width: componentName === 'ribbon' ? 30 : 17,
        height: componentName === 'ribbon' ? 34 : 20,
        rotation: angle + Math.PI / 2 + progress * (index % 2 ? 2 : -2),
        alpha: fade,
      });
    }
  }

  drawProjectilesAndParticles(ctx) {
    for (const projectile of this.state.projectiles) {
      const progress = clamp(projectile.progress, 0, 1);
      if (projectile.progress < 0) continue;
      const x = lerp(projectile.from.x, projectile.to.x, progress);
      const y = lerp(projectile.from.y - 28, projectile.to.y - 24, progress) - Math.sin(progress * Math.PI) * 16;
      const angle = Math.atan2(projectile.to.y - projectile.from.y, projectile.to.x - projectile.from.x);
      drawProjectile(
        ctx,
        x,
        y,
        projectile.type === 'crystal' ? 17 : 14,
        projectile.type === 'crystal' ? 'needle' : projectile.type,
        { assetStore: this.assetStore, progress, rotation: angle },
      );
    }
    for (const particle of this.state.particles) {
      const alpha = clamp(particle.life / particle.maxLife, 0, 1);
      const assetKey = particle.assetKey || (particle.color === PALETTE.heal
        ? 'effect-particle-healing-leaf'
        : particle.color === PALETTE.bubble
          ? 'effect-particle-bubble'
          : particle.color === PALETTE.crystal
            ? 'effect-particle-impact-spark'
            : null);
      const drawFallback = () => {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = particle.color;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, TAU);
        ctx.fill();
      };
      if (!assetKey) {
        ctx.save();
        drawFallback();
        ctx.restore();
        continue;
      }
      drawAssetOrFallback(ctx, this.assetStore, assetKey, (asset) => {
        ctx.globalAlpha *= alpha;
        const diameter = particle.size * 2.6;
        ctx.drawImage(
          asset,
          particle.x - diameter / 2,
          particle.y - diameter / 2,
          diameter,
          diameter,
        );
      }, drawFallback);
    }
    for (const floater of this.state.floaters) {
      ctx.save();
      ctx.globalAlpha = clamp(floater.life / floater.maxLife, 0, 1);
      ctx.font = '800 18px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(38,54,66,0.72)';
      ctx.strokeText(floater.text, floater.x, floater.y);
      ctx.fillStyle = floater.color;
      ctx.fillText(floater.text, floater.x, floater.y);
      ctx.restore();
    }
  }

  selectionCellIsValid(cell) {
    const selection = this.selection;
    if (!selection || !cell) return false;
    if (selection.kind === 'place-building') {
      const card = BUILDING_BY_ID[selection.cardId];
      return Boolean(card)
        && canPlace(
          this.state.buildings,
          card,
          cell.x,
          cell.y,
          selection.rotation,
          null,
          this.runtimeTerrain,
        );
    }
    if (selection.kind === 'move-building') {
      const building = this.state.buildings.find((item) => item.uid === selection.uid);
      const card = building && BUILDING_BY_ID[building.cardId];
      return Boolean(card)
        && canPlace(
          this.state.buildings,
          card,
          cell.x,
          cell.y,
          selection.rotation ?? building.rotation,
          building.uid,
          this.runtimeTerrain,
        );
    }
    if (selection.kind === 'place-survivor' || selection.kind === 'move-survivor') {
      const survivor = selection.uid
        ? this.state.survivors.find((item) => item.uid === selection.uid)
        : this.state.survivors.find((item) => item.cardId === selection.cardId);
      const terrainCell = this.worldCellAt(cell.x, cell.y);
      const blockingBuilding = operationalBuildingAt(this.state.buildings, cell.x, cell.y);
      return Boolean(survivor)
        && terrainCell?.discovered !== false
        && terrainCellIsPassable(this.runtimeTerrain, cell.x, cell.y)
        && !BUILDING_BY_ID[blockingBuilding?.cardId]?.solid
        && !this.state.survivors.some((item) => (
          item.uid !== survivor.uid && !item.downed && item.x === cell.x && item.y === cell.y
        ));
    }
    if (selection.kind !== 'target-card') return false;
    const card = selection.cardType === 'skill'
      ? SKILL_BY_ID[selection.cardId]
      : ITEM_BY_ID[selection.cardId];
    if (!card) return false;
    if (card.id === 'skill-jelly-bounce') {
      return this.state.enemies.some((enemy) => (
        !enemy.dead && Math.abs(enemy.x - cell.x) + Math.abs(enemy.y - cell.y) <= 1.25
      ));
    }
    if (card.id === 'skill-honey-line' || card.id === 'item-spring-pad') {
      if (selection.step === 0) {
        const obstacle = operationalBuildingAt(this.state.buildings, cell.x, cell.y);
        return !obstacle || !BUILDING_BY_ID[obstacle.cardId].solid;
      }
      const dx = cell.x - selection.origin.x;
      const dy = cell.y - selection.origin.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
      if (card.id === 'item-spring-pad') return true;
      return [0, 1, 2].every((step) => inBoard(
        selection.origin.x + dx * step,
        selection.origin.y + dy * step,
      ));
    }
    if (card.id === 'skill-soft-swap') {
      const target = this.state.survivors.find((item) => (
        !item.downed && item.x === cell.x && item.y === cell.y
      ));
      return Boolean(target) && target.uid !== selection.firstUid;
    }
    if (card.id === 'skill-sprout-renewal') {
      const survivor = this.state.survivors.some((item) => (
        !item.downed && item.x === cell.x && item.y === cell.y
      ));
      const building = operationalBuildingAt(this.state.buildings, cell.x, cell.y);
      return survivor || Boolean(building);
    }
    if (card.id === 'item-lure-jelly') {
      const obstacle = operationalBuildingAt(this.state.buildings, cell.x, cell.y);
      return !obstacle || !BUILDING_BY_ID[obstacle.cardId].solid;
    }
    if (card.id === 'item-moving-bubble') {
      if (selection.step === 0) {
        const survivor = this.state.survivors.some((item) => (
          !item.downed && item.x === cell.x && item.y === cell.y
        ));
        const building = operationalBuildingAt(this.state.buildings, cell.x, cell.y);
        if (survivor) return true;
        if (!building) return false;
        const shape = rotatedFootprint(BUILDING_BY_ID[building.cardId], building.rotation);
        return shape.width === 1 && shape.height === 1;
      }
      if (selection.sourceType === 'survivor') {
        return !this.state.survivors.some((item) => (
          item.uid !== selection.sourceUid && !item.downed && item.x === cell.x && item.y === cell.y
        ));
      }
      const building = this.state.buildings.find((item) => (
        item.uid === selection.sourceUid && buildingIsOperational(item)
      ));
      return Boolean(building)
        && !this.state.enemies.some((enemy) => (
          !enemy.dead && Math.abs(enemy.x - cell.x) < 0.6 && Math.abs(enemy.y - cell.y) < 0.6
        ))
        && canPlace(
          this.state.buildings,
          BUILDING_BY_ID[building.cardId],
          cell.x,
          cell.y,
          building.rotation,
          building.uid,
          this.runtimeTerrain,
        );
    }
    return true;
  }

  drawSelectionOverlay(ctx) {
    const selection = this.selection;
    if (!selection) return;
    const drawCellOverlay = (cell, valid, alpha = 0.8) => {
      if (!cell) return;
      const corner = worldToScreen({ x: cell.x, y: cell.y }, this.camera, BOARD);
      const inset = Math.max(2, 4 * this.camera.zoom);
      const size = this.worldPixelsPerCell();
      const x = corner.x + inset;
      const y = corner.y + inset;
      drawAssetOrFallback(
        ctx,
        this.assetStore,
        valid ? 'tile-placement-valid' : 'tile-placement-invalid',
        (asset) => {
          ctx.globalAlpha *= alpha;
          ctx.drawImage(asset, x, y, size - inset * 2, size - inset * 2);
        },
        () => drawRoundedRect(ctx, x, y, size - inset * 2, size - inset * 2, {
          radius: Math.max(8, 12 * this.camera.zoom),
          fill: valid ? 'rgba(97,214,162,0.28)' : 'rgba(228,95,104,0.25)',
          stroke: valid ? '#61D6A2' : '#E45F68',
          lineWidth: 3,
        }),
      );
    };
    const drawBuildingPlacementPreview = () => {
      if (!this.hoverCell) return false;
      let card = null;
      let rotation = 0;
      if (selection.kind === 'place-building') {
        card = BUILDING_BY_ID[selection.cardId];
        rotation = selection.rotation;
      } else if (selection.kind === 'move-building') {
        const building = this.state.buildings.find((item) => item.uid === selection.uid);
        if (!building) return false;
        card = BUILDING_BY_ID[building.cardId];
        rotation = selection.rotation ?? building.rotation;
      } else {
        return false;
      }
      if (!card) return false;
      const valid = this.selectionCellIsValid(this.hoverCell);
      const previewCells = footprintCells(
        card,
        this.hoverCell.x,
        this.hoverCell.y,
        rotation,
      );
      for (const cell of previewCells) {
        if (inBoard(cell.x, cell.y)) drawCellOverlay(cell, valid);
      }
      const shape = rotatedFootprint(card, rotation);
      const previewGround = worldToScreen({
        x: this.hoverCell.x + shape.width / 2,
        y: this.hoverCell.y + shape.height,
      }, this.camera, BOARD);
      const centerX = previewGround.x;
      const centerY = previewGround.y;
      const autotileProfile = BUILDING_AUTOTILE_PROFILE_BY_CARD_ID[card.id];
      const virtualBuilding = autotileProfile
        ? {
          cardId: card.id,
          x: this.hoverCell.x,
          y: this.hoverCell.y,
        }
        : null;
      const previewAutotileIndex = autotileProfile
        ? this.createBuildingAutotileIndex(this.state.buildings, {
          excludeUid: selection.kind === 'move-building' ? selection.uid : null,
          virtualBuilding,
        })
        : null;
      const previewAutotileMask = autotileProfile
        ? this.buildingAutotileMask(virtualBuilding, previewAutotileIndex)
        : 0;
      drawBuilding(
        ctx,
        centerX,
        centerY,
        BUILDING_WORLD_SLOT * this.camera.zoom,
        BUILDING_VARIANT[card.id],
        {
          assetStore: this.assetStore,
          assetKey: autotileProfile?.assetKey,
          sourceRect: autotileProfile ? autotileFrameRect(previewAutotileMask) : null,
          time: this.time,
          ghost: true,
          valid,
        },
      );
      return true;
    };
    if (selection.kind === 'inspect-terrain') {
      drawCellOverlay({ x: selection.x, y: selection.y }, true, 0.48 + Math.sin(this.time * 4) * 0.08);
      return;
    }
    if (selection.origin) {
      drawCellOverlay(selection.origin, true, 0.56 + Math.sin(this.time * 5) * 0.08);
    }
    const drewBuildingPreview = drawBuildingPlacementPreview();
    if (this.hoverCell && !drewBuildingPreview) {
      drawCellOverlay(this.hoverCell, this.selectionCellIsValid(this.hoverCell));
    }
    if (selection.kind === 'target-card') {
      ctx.save();
      ctx.strokeStyle = '#FFF8E9';
      ctx.lineWidth = 3;
      ctx.setLineDash([7, 6]);
      ctx.strokeRect(BOARD.x + 3, BOARD.y + 3, BOARD.width - 6, BOARD.height - 6);
      ctx.restore();
    }
  }

  drawHealthBar(ctx, x, y, width, ratio, shield = false, hostile = false) {
    const height = 7;
    drawRoundedRect(ctx, x - width / 2, y, width, height, { radius: 4, fill: 'rgba(38,54,66,0.52)' });
    drawRoundedRect(ctx, x - width / 2 + 1, y + 1, (width - 2) * clamp(ratio, 0, 1), height - 2, {
      radius: 3,
      fill: hostile ? (ratio < 0.35 ? PALETTE.danger : '#D59AE8') : (shield ? PALETTE.shield : PALETTE.heal),
    });
  }

  drawResourceToken(ctx, resourceId, centerX, centerY, size) {
    const assetKey = RESOURCE_ASSET_BY_ID[resourceId];
    const color = RESOURCE_COLOR_BY_ID[resourceId] || PALETTE.textMuted;
    return drawAssetOrFallback(ctx, this.assetStore, assetKey, (asset) => {
      drawImageContained(ctx, asset, centerX - size / 2, centerY - size / 2, size, size, 0.5);
    }, () => {
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = PALETTE.inkSoft;
      ctx.lineWidth = Math.max(1.5, size * 0.08);
      ctx.beginPath();
      ctx.arc(centerX, centerY, size * 0.34, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });
  }

  drawTopHud(ctx) {
    this.addUiBlocker('top-hud-blocker', 20, 16, 1240, 64);
    drawRoundedRect(ctx, 20, 16, 1240, 64, {
      radius: 22,
      fill: 'rgba(255,248,233,0.93)',
      stroke: 'rgba(51,71,80,0.2)',
      lineWidth: 2,
    });

    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '800 17px "PingFang SC", sans-serif';
    ctx.fillText(
      this.state.phase === 'battle' && this.isExpeditionSession() ? '信标耐久' : '软核耐久',
      42,
      42,
    );
    ctx.font = '800 14px "PingFang SC", sans-serif';
    ctx.fillStyle = this.state.coreHp / this.state.coreMaxHp < 0.35 ? PALETTE.danger : PALETTE.textMuted;
    ctx.fillText(`${Math.ceil(this.state.coreHp)} / ${this.state.coreMaxHp}`, 42, 64);
    this.drawHealthBar(ctx, 243, 41, 142, this.state.coreHp / this.state.coreMaxHp, false, false);

    const phaseText = {
      build: '基地运转中', intel: '敌情预览', battle: this.state.paused ? '战斗暂停' : '防守进行中',
      between: '波次间整备', result: '防守结算',
    }[this.state.phase];
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 22px "PingFang SC", sans-serif';
    ctx.fillText(this.isExpeditionSession()
      ? (this.state.worldExpedition ? '大世界探索' : this.state.phase === 'result' ? '远征结算' : '小队远征')
      : phaseText, 625, 45);
    ctx.font = '600 14px "PingFang SC", sans-serif';
    ctx.fillStyle = PALETTE.textMuted;
    const expeditionRun = this.state.expeditionRun;
    const worldExpedition = this.state.worldExpedition;
    const worldExpeditionStatus = {
      'choose-site': '请选择地图内的资源地或怪物巢穴',
      travel: '探索队移动中 · 基地同步运转',
      battle: '现场自动战斗 · 仍可建设基地',
      return: '探索队正在返回 · 战利品已入库',
    }[worldExpedition?.status];
    const subtitle = worldExpeditionStatus || (expeditionRun
      ? expeditionRun.currentEncounter?.isFinalBoss || expeditionRun.route.isBossStage
        ? '最终节点 · 酸壳蜗王'
        : `路线 ${Math.min(expeditionRun.route.regularWins + 1, expeditionRun.route.regularSteps)} / ${expeditionRun.route.regularSteps} · 自动战斗`
      : this.state.phase === 'battle' || this.state.phase === 'between'
        ? `第 ${this.state.waveIndex + 1} / ${WAVES.length} 波 · ${WAVES[this.state.waveIndex].name}`
        : '持续白昼 · 自动采集与自动防守');
    ctx.fillText(subtitle, 625, 66);

    const colonyResources = this.state.colony?.resources || { gel: 0, nectar: 0, shard: 0 };
    const resourceHud = [
      ['gel', '#3C9E79'],
      ['nectar', '#C58B2E'],
      ['shard', '#597EC9'],
    ];
    ctx.textAlign = 'left';
    resourceHud.forEach(([resourceType, color], index) => {
      const x = 852 + index * 92;
      this.drawResourceToken(ctx, resourceType, x - 17, 47, 27);
      ctx.fillStyle = color;
      ctx.font = '800 12px "PingFang SC", sans-serif';
      ctx.fillText(COLONY_RESOURCE_LABEL[resourceType], x, 38);
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '900 16px "PingFang SC", sans-serif';
      ctx.fillText(`${Math.floor(colonyResources[resourceType] || 0)}`, x, 58);
    });
    this.drawResourceToken(ctx, 'softCrystals', 1108, 46, 38);
    ctx.fillStyle = '#4E7E8A';
    ctx.font = '800 13px "PingFang SC", sans-serif';
    ctx.fillText(`${this.state.softCrystals}`, 1130, 49);
    ctx.restore();

    this.drawButton(ctx, 'audio-toggle', { x: 1184, y: 26, w: 54, h: 42 }, this.audio.enabled ? '声' : '静', {
      compact: true,
      secondary: true,
      iconAssetKey: this.audio.enabled ? 'ui-audio-on' : 'ui-audio-off',
      title: this.audio.enabled ? '关闭音效' : '开启音效',
    }, () => { this.audio.enabled = !this.audio.enabled; });
  }

  drawSidePanel(ctx) {
    this.addUiBlocker('side-panel-blocker', PANEL.x, PANEL.y, PANEL.width, PANEL.height);
    drawRoundedRect(ctx, PANEL.x, PANEL.y, PANEL.width, PANEL.height, {
      radius: 28,
      fill: 'rgba(255,248,233,0.96)',
      stroke: 'rgba(51,71,80,0.22)',
      lineWidth: 3,
    });
    if (this.state.phase === 'battle' && this.isExpeditionSession()) this.drawExpeditionBattleSide(ctx);
    else if (this.state.phase === 'battle') this.drawBattleSide(ctx);
    else this.drawBuildSide(ctx);
  }

  selectedCard() {
    const selection = this.selection;
    if (!selection) return null;
    if (selection.cardId) return BUILDING_BY_ID[selection.cardId] || SURVIVOR_BY_ID[selection.cardId] || SKILL_BY_ID[selection.cardId] || ITEM_BY_ID[selection.cardId];
    if (selection.uid) {
      const building = this.state.buildings.find((item) => item.uid === selection.uid);
      if (building) return BUILDING_BY_ID[building.cardId];
      const survivor = this.state.survivors.find((item) => item.uid === selection.uid);
      if (survivor) return SURVIVOR_BY_ID[survivor.cardId];
    }
    return null;
  }

  drawBuildSide(ctx) {
    const card = this.selectedCard();
    const terrainCell = this.selection?.kind === 'inspect-terrain'
      ? this.worldCellAt(this.selection.x, this.selection.y)
      : null;
    const terrainDefinition = terrainCell ? TERRAIN_TYPES[terrainCell.terrainId] : null;
    const terrainHelp = terrainDefinition ? TERRAIN_HELP[terrainDefinition.id] : null;
    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 24px "PingFang SC", sans-serif';
    ctx.fillText(
      this.state.phase === 'between'
        ? '慢慢整备'
        : card?.name || terrainDefinition?.name || '你的果冻庭院',
      PANEL.x + 28,
      PANEL.y + 42,
    );

    if (card) {
      const selectedBuilding = card.type === 'building' && this.selection?.uid
        ? this.state.buildings.find((item) => item.uid === this.selection.uid)
        : null;
      const displayedRotation = this.selection?.kind === 'place-building'
        || this.selection?.kind === 'move-building'
        ? this.selection.rotation ?? selectedBuilding?.rotation ?? 0
        : selectedBuilding?.rotation ?? 0;
      drawRoundedRect(ctx, PANEL.x + 26, PANEL.y + 63, 78, 78, {
        radius: 22, fill: card.color, stroke: PALETTE.inkSoft, lineWidth: 3,
      });
      this.drawCardArtwork(ctx, card, {
        x: PANEL.x + 26,
        y: PANEL.y + 63,
        w: 78,
        h: 78,
      }, { padding: 6, fallbackFontSize: 34 });
      ctx.textAlign = 'left';
      ctx.fillStyle = PALETTE.textMuted;
      ctx.font = '700 15px "PingFang SC", sans-serif';
      const meta = card.type === 'building'
        ? `${rotatedFootprint(card, displayedRotation).width}×${rotatedFootprint(card, displayedRotation).height} · ${formatBuildingMaterials(card.id, { compact: true })}`
        : `${COLONY_AI_LABEL[this.state.survivors.find((item) => item.uid === this.selection?.uid)?.aiState] || '自动工作'} · 生命 ${card.hp}`;
      ctx.fillText(meta, PANEL.x + 122, PANEL.y + 84);
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '600 17px "PingFang SC", sans-serif';
      wrapText(ctx, card.description, PANEL.x + 122, PANEL.y + 111, 228, 24, 3);

      if (card.type === 'building') {
        const blueprint = selectedBuilding?.underConstruction
          ? this.state.colony?.blueprints.find(({ uid: blueprintUid }) => (
            blueprintUid === selectedBuilding.blueprintUid
          ))
          : null;
        const missing = missingBuildingMaterials(
          card.id,
          this.state.colony?.resources,
          blueprint?.delivered,
        );
        ctx.fillStyle = '#3C745E';
        ctx.font = '800 14px "PingFang SC", sans-serif';
        const materialStatus = blueprint
          ? Object.entries(blueprint.required)
            .filter(([, amount]) => amount > 0)
            .map(([type, amount]) => `${COLONY_RESOURCE_LABEL[type]}${blueprint.delivered[type] || 0}/${amount}`)
            .join('　')
          : formatBuildingMaterials(card.id);
        ctx.fillText(`${blueprint ? '已送材料' : '施工配方'}　${materialStatus}`, PANEL.x + 26, PANEL.y + 184);
        ctx.fillStyle = Object.keys(missing).length ? '#A97528' : PALETTE.textMuted;
        ctx.font = '700 13px "PingFang SC", sans-serif';
        ctx.fillText(
          Object.keys(missing).length
            ? `缺料 ${Object.entries(missing).map(([type, amount]) => `${COLONY_RESOURCE_LABEL[type]}${amount}`).join(' ')}；可先放蓝图等待采集`
            : '库存充足；放下蓝图后由史莱姆搬运施工',
          PANEL.x + 26,
          PANEL.y + 207,
        );
      }

      const actionY = PANEL.y + 248;
      if (this.selection.kind === 'inspect-building') {
        if (selectedBuilding?.underConstruction) {
          const progress = Math.round((selectedBuilding.buildProgress || 0) * 100);
          ctx.fillStyle = '#A97528';
          ctx.font = '800 15px "PingFang SC", sans-serif';
          ctx.fillText(`施工进度 ${progress}% · 材料由史莱姆自动搬运`, PANEL.x + 26, actionY - 18);
          this.drawButton(ctx, 'cancel-blueprint', {
            x: PANEL.x + 26,
            y: actionY,
            w: 330,
            h: 48,
          }, '取消蓝图并退回已送材料', { danger: true }, () => this.cancelSelectedBlueprint());
        } else {
          const rotatable = card.footprint.width !== card.footprint.height;
          this.drawButton(ctx, 'move-building', {
            x: PANEL.x + 26,
            y: actionY,
            w: rotatable ? 102 : 158,
            h: 48,
          }, '移动', { secondary: true }, () => {
            this.selection = {
              kind: 'move-building',
              uid: this.selection.uid,
              rotation: selectedBuilding?.rotation ?? 0,
            };
            this.showToast('选择新的建筑位置');
          });
          if (rotatable) {
            this.drawButton(ctx, 'rotate-building', { x: PANEL.x + 140, y: actionY, w: 102, h: 48 }, '旋转', { secondary: true }, () => this.rotateSelection());
          }
          this.drawButton(ctx, 'remove-building', {
            x: PANEL.x + (rotatable ? 254 : 198),
            y: actionY,
            w: rotatable ? 102 : 158,
            h: 48,
          }, '收回', { danger: true }, () => this.removeSelectedBuilding());
        }
      } else if (this.selection.kind === 'inspect-survivor') {
        this.drawButton(ctx, 'follow-survivor', { x: PANEL.x + 26, y: actionY, w: 330, h: 48 }, '镜头追踪这只史莱姆', { secondary: true }, () => {
          const survivor = this.state.survivors.find((item) => item.uid === this.selection.uid);
          if (!survivor) return;
          this.camera = createWorldCamera({
            world: WORLD,
            viewport: BOARD,
            focus: { x: survivor.x + 0.5, y: survivor.y + 0.5 },
            zoom: this.camera.zoom,
          });
        });
      } else if (this.selection.kind === 'place-building') {
        const shape = rotatedFootprint(card, this.selection.rotation);
        if (shape.width !== shape.height) {
          this.drawButton(ctx, 'rotate-new', { x: PANEL.x + 26, y: actionY, w: 158, h: 48 }, '旋转蓝图', { secondary: true }, () => this.rotateSelection());
        }
        this.drawButton(ctx, 'cancel-place', { x: PANEL.x + 198, y: actionY, w: 158, h: 48 }, '取消放置', { secondary: true }, () => { this.selection = null; });
      } else if (this.selection.kind === 'move-building') {
        const shape = rotatedFootprint(card, displayedRotation);
        if (shape.width !== shape.height) {
          this.drawButton(ctx, 'rotate-move', { x: PANEL.x + 26, y: actionY, w: 158, h: 48 }, '旋转蓝图', { secondary: true }, () => this.rotateSelection());
        }
        this.drawButton(ctx, 'cancel-move', {
          x: PANEL.x + (shape.width !== shape.height ? 198 : 26),
          y: actionY,
          w: shape.width !== shape.height ? 158 : 330,
          h: 48,
        }, '取消', { secondary: true }, () => { this.selection = null; });
      } else if (this.selection.kind === 'place-survivor' || this.selection.kind === 'move-survivor') {
        this.drawButton(ctx, 'cancel-move', { x: PANEL.x + 26, y: actionY, w: 330, h: 48 }, '取消', { secondary: true }, () => { this.selection = null; });
      }
    } else if (terrainDefinition && terrainHelp) {
      const terrainColor = terrainDefinition.kind === 'resource'
        ? '#61D6A2'
        : terrainDefinition.destructible
          ? '#9EB8AF'
          : terrainDefinition.id === 'deep-water'
            ? '#38BDE8'
            : '#48BD51';
      drawRoundedRect(ctx, PANEL.x + 26, PANEL.y + 63, 78, 78, {
        radius: 24,
        fill: terrainColor,
        stroke: PALETTE.inkSoft,
        lineWidth: 3,
      });
      drawTerrainAsset(ctx, this.assetStore, terrainCell, {
        x: PANEL.x + 65,
        y: PANEL.y + 136,
        width: 68,
        height: 68,
        visualVariant: terrainCell.visualVariant,
        fallback: () => {
          ctx.fillStyle = '#FFF8E9';
          ctx.font = '900 38px "PingFang SC", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(terrainHelp[2], PANEL.x + 65, PANEL.y + 116);
        },
      });
      ctx.textAlign = 'left';
      ctx.fillStyle = terrainColor;
      ctx.font = '800 15px "PingFang SC", sans-serif';
      ctx.fillText(terrainHelp[0], PANEL.x + 122, PANEL.y + 84);
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '600 17px "PingFang SC", sans-serif';
      wrapText(ctx, terrainHelp[1], PANEL.x + 122, PANEL.y + 111, 228, 24, 4);
      drawRoundedRect(ctx, PANEL.x + 26, PANEL.y + 222, 336, 96, {
        radius: 20,
        fill: terrainDefinition.buildable ? '#EDF7E9' : '#F4EFE7',
        stroke: terrainColor,
        lineWidth: 2,
      });
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.font = '700 15px "PingFang SC", sans-serif';
      ctx.fillText(`坐标 ${terrainCell.x + 1}, ${terrainCell.y + 1}`, PANEL.x + 44, PANEL.y + 253);
      ctx.fillText(`可通行：${terrainDefinition.passable ? '是' : '否'}　可建造：${terrainDefinition.buildable ? '是' : '否'}`, PANEL.x + 44, PANEL.y + 279);
      ctx.fillText(`可采集：${terrainDefinition.harvestable ? '是' : '否'}　可破坏：${terrainDefinition.destructible ? '是' : '否'}`, PANEL.x + 44, PANEL.y + 303);
    } else {
      ctx.fillStyle = PALETTE.textMuted;
      ctx.font = '600 17px "PingFang SC", sans-serif';
      wrapText(ctx, '史莱姆会自动采集、建造与守卫基地。准备好后，点右下角“三人探索”，在同一张大地图寻找资源地和怪物巢穴。', PANEL.x + 28, PANEL.y + 82, 330, 27, 5);

      drawRoundedRect(ctx, PANEL.x + 26, PANEL.y + 222, 336, 96, {
        radius: 20, fill: '#EDF7E9', stroke: '#8DBA8A', lineWidth: 2,
      });
      ctx.fillStyle = '#3C745E';
      ctx.font = '800 17px "PingFang SC", sans-serif';
      ctx.fillText('生态地形规则', PANEL.x + 44, PANEL.y + 250);
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.font = '600 14px "PingFang SC", sans-serif';
      ctx.fillText('胶洼 / 花丛 / 晶脉：采完变空地', PANEL.x + 44, PANEL.y + 276);
      ctx.fillText('密刺丛：只改道　脆壳岩：可清理　深水：永久', PANEL.x + 44, PANEL.y + 300);
    }
    ctx.restore();

    ctx.save();
    ctx.font = '800 14px "PingFang SC", sans-serif';
    ctx.fillStyle = PALETTE.textMuted;
    ctx.fillText('仓库材料 · 蓝图可等待采集', PANEL.x + 28, PANEL.y + 368);
    const resourceEntries = Object.entries(COLONY_RESOURCE_LABEL);
    resourceEntries.forEach(([resourceType, label], index) => {
      const x = PANEL.x + 31 + index * 110;
      this.drawResourceToken(ctx, resourceType, x + 8, PANEL.y + 392, 22);
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.font = '800 14px "PingFang SC", sans-serif';
      ctx.fillText(`${label} ${Math.floor(this.state.colony?.resources?.[resourceType] || 0)}`, x + 22, PANEL.y + 397);
    });
    ctx.restore();

    if (this.state.phase === 'between') {
      this.drawButton(ctx, 'next-wave', { x: PANEL.x + 26, y: PANEL.y + 414, w: 336, h: 54 }, `主动开启第 ${this.state.waveIndex + 2} 波`, {}, () => this.startWave(this.state.waveIndex + 1));
    } else {
      this.drawButton(ctx, 'focus-base', { x: PANEL.x + 26, y: PANEL.y + 414, w: 156, h: 54 }, '回到基地', { secondary: true }, () => {
        this.camera = createWorldCamera({
          world: WORLD,
          viewport: BOARD,
          focus: DEFAULT_CAMERA_FOCUS,
          zoom: this.camera.zoom,
        });
      });
      this.drawButton(
        ctx,
        'open-expedition',
        { x: PANEL.x + 194, y: PANEL.y + 414, w: 168, h: 54 },
        this.state.worldExpedition ? '召回小队' : '三人探索',
        {
          secondary: Boolean(this.state.worldExpedition),
          enabled: true,
        },
        () => (this.state.worldExpedition
          ? this.finishWorldExpeditionReturn()
          : this.openExpedition()),
      );
    }
  }

  drawExpeditionBattleSide(ctx) {
    const run = this.state.expeditionRun;
    const encounter = run?.currentEncounter;
    const remaining = this.state.enemies.filter((enemy) => !enemy.dead).length;
    const total = this.state.spawnQueue?.length || 0;
    const spawned = this.state.spawned.size;
    const title = encounter?.isFinalBoss
      ? '酸壳蜗王'
      : EXPEDITION_KIND_LABEL[encounter?.kind] || '远征整备';
    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 24px "PingFang SC", sans-serif';
    ctx.fillText(title, PANEL.x + 28, PANEL.y + 42);
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = '600 16px "PingFang SC", sans-serif';
    wrapText(
      ctx,
      encounter?.isFinalBoss
        ? '最后的首领会带着弱小虫群登场。三只史莱姆会自动走位与攻击。'
        : '小队会自动追击怪物；技能和道具仍由你决定何时使用。',
      PANEL.x + 28,
      PANEL.y + 76,
      330,
      24,
      3,
    );
    drawRoundedRect(ctx, PANEL.x + 26, PANEL.y + 148, 336, 116, {
      radius: 20, fill: '#EAF3F8', stroke: '#83AEC2', lineWidth: 2,
    });
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '800 16px "PingFang SC", sans-serif';
    ctx.fillText(`已入场 ${spawned} / ${total}`, PANEL.x + 44, PANEL.y + 182);
    ctx.fillText(`场上敌人 ${remaining}`, PANEL.x + 44, PANEL.y + 214);
    ctx.fillText(`已选强化 ${run?.boons.length || 0}`, PANEL.x + 204, PANEL.y + 182);
    ctx.fillText(`凝胶能量 ${this.state.energy} / 10`, PANEL.x + 204, PANEL.y + 214);
    drawRoundedRect(ctx, PANEL.x + 44, PANEL.y + 238, 300, 9, { radius: 5, fill: '#CBDDE4' });
    drawRoundedRect(ctx, PANEL.x + 44, PANEL.y + 238, 300 * clamp(spawned / Math.max(1, total), 0, 1), 9, { radius: 5, fill: '#4E9BB1' });
    ctx.fillStyle = this.state.paused ? '#3C745E' : PALETTE.textMuted;
    ctx.font = '700 15px "PingFang SC", sans-serif';
    ctx.fillText(this.state.paused ? '选择界面中，战场已完全冻结。' : '三只史莱姆正在自动战斗。', PANEL.x + 28, PANEL.y + 300);
    this.drawButton(ctx, 'expedition-pause', { x: PANEL.x + 26, y: PANEL.y + 326, w: 336, h: 58 }, this.state.paused ? '继续远征' : '暂停思考', {
      secondary: this.state.paused,
    }, () => this.togglePause());
    this.drawButton(ctx, 'expedition-retreat', { x: PANEL.x + 26, y: PANEL.y + 401, w: 336, h: 48 }, '带着部分战利品撤回', { quiet: true, danger: true }, () => {
      this.modal = { type: 'retreat' };
    });
    ctx.restore();
  }

  drawBattleSide(ctx) {
    const wave = WAVES[this.state.waveIndex];
    const remaining = this.state.enemies.filter((enemy) => !enemy.dead).length;
    const total = this.state.spawnQueue?.length || 0;
    const spawned = this.state.spawned.size;
    const targetingCard = this.selection?.kind === 'target-card' ? this.selectedCard() : null;
    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 24px "PingFang SC", sans-serif';
    ctx.fillText(targetingCard ? targetingCard.name : wave.name, PANEL.x + 28, PANEL.y + 42);

    if (targetingCard) {
      drawRoundedRect(ctx, PANEL.x + 28, PANEL.y + 62, 64, 64, {
        radius: 18, fill: targetingCard.color, stroke: PALETTE.inkSoft, lineWidth: 3,
      });
      this.drawCardArtwork(ctx, targetingCard, {
        x: PANEL.x + 28,
        y: PANEL.y + 62,
        w: 64,
        h: 64,
      }, { padding: 5, fallbackFontSize: 28 });
      ctx.textAlign = 'left';
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.font = '600 16px "PingFang SC", sans-serif';
      wrapText(ctx, this.targetingPrompt(targetingCard), PANEL.x + 110, PANEL.y + 79, 240, 24, 3);

      if (this.selection.origin) {
        ctx.fillStyle = '#3C745E';
        ctx.font = '800 15px "PingFang SC", sans-serif';
        ctx.fillText(`已选起点：第${this.selection.origin.y + 1}行，第${this.selection.origin.x + 1}列`, PANEL.x + 28, PANEL.y + 162);
      }
      this.drawButton(ctx, 'cancel-target', { x: PANEL.x + 28, y: PANEL.y + 401, w: 332, h: 56 }, '取消 · 不消耗', { secondary: true }, () => this.cancelTargeting());
    } else {
      ctx.fillStyle = PALETTE.textMuted;
      ctx.font = '600 16px "PingFang SC", sans-serif';
      wrapText(ctx, wave.description, PANEL.x + 28, PANEL.y + 76, 330, 24, 3);

      drawRoundedRect(ctx, PANEL.x + 26, PANEL.y + 148, 336, 106, {
        radius: 20, fill: '#F2EAF4', stroke: '#B49AC0', lineWidth: 2,
      });
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '800 17px "PingFang SC", sans-serif';
      ctx.fillText(`已入场 ${spawned} / ${total}`, PANEL.x + 44, PANEL.y + 181);
      ctx.fillText(`场上敌人 ${remaining}`, PANEL.x + 44, PANEL.y + 211);
      ctx.fillText(`凝胶能量 ${this.state.energy} / 10`, PANEL.x + 204, PANEL.y + 181);
      ctx.fillText(`已击退 ${this.state.kills}`, PANEL.x + 204, PANEL.y + 211);
      drawRoundedRect(ctx, PANEL.x + 44, PANEL.y + 227, 300, 9, { radius: 5, fill: '#D7CEDC' });
      drawRoundedRect(ctx, PANEL.x + 44, PANEL.y + 227, 300 * clamp(spawned / Math.max(1, total), 0, 1), 9, { radius: 5, fill: '#8975DD' });

      ctx.fillStyle = this.state.paused ? '#3C745E' : PALETTE.textMuted;
      ctx.font = '700 15px "PingFang SC", sans-serif';
      ctx.fillText(this.state.paused ? '战场完全冻结，可以慢慢思考。' : '点技能或道具会自动暂停战场。', PANEL.x + 28, PANEL.y + 294);

      this.drawButton(ctx, 'pause', { x: PANEL.x + 26, y: PANEL.y + 326, w: 336, h: 58 }, this.state.paused ? '继续防守' : '暂停思考', {
        secondary: this.state.paused,
      }, () => this.togglePause());
      this.drawButton(ctx, 'retreat', { x: PANEL.x + 26, y: PANEL.y + 401, w: 336, h: 48 }, '安全撤回庭院', { quiet: true, danger: true }, () => {
        this.modal = { type: 'retreat' };
      });
    }
    ctx.restore();
  }

  drawBottomBar(ctx) {
    this.addUiBlocker('bottom-bar-blocker', BOTTOM.x, BOTTOM.y, BOTTOM.width, BOTTOM.height);
    drawRoundedRect(ctx, BOTTOM.x, BOTTOM.y, BOTTOM.width, BOTTOM.height, {
      radius: 28,
      fill: 'rgba(255,248,233,0.95)',
      stroke: 'rgba(51,71,80,0.22)',
      lineWidth: 3,
    });
    if (this.state.phase === 'battle') this.drawCombatCards(ctx);
    else if (this.isBuildPhase()) this.drawBuildCards(ctx);
    else {
      ctx.save();
      ctx.fillStyle = PALETTE.textMuted;
      ctx.font = '700 17px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        this.state.result?.expedition
          ? '远征战利品已经送回基地。'
          : '准备好后由你亲自开启防守，没有倒计时。',
        VIEW.width / 2,
        BOTTOM.y + 63,
      );
      ctx.restore();
    }
  }

  drawBuildCards(ctx) {
    this.drawTab(ctx, 'tab-buildings', 40, BOTTOM.y + 18, '建筑', this.buildTab === 'buildings', () => { this.buildTab = 'buildings'; this.selection = null; });
    this.drawTab(ctx, 'tab-survivors', 40, BOTTOM.y + 59, '幸存者', this.buildTab === 'survivors', () => { this.buildTab = 'survivors'; this.selection = null; });
    const cards = this.buildTab === 'buildings' ? BUILDINGS : SURVIVORS;
    const cardWidth = this.buildTab === 'buildings' ? 134 : 150;
    const startX = 160;
    cards.forEach((card, index) => {
      const x = startX + index * (cardWidth + 12);
      const selected = this.selectedCard()?.id === card.id;
      const survivor = card.type === 'survivor'
        ? this.state.survivors.find((item) => item.cardId === card.id)
        : null;
      this.drawMiniCard(ctx, `build-card-${card.id}`, { x, y: BOTTOM.y + 13, w: cardWidth, h: 84 }, card, {
        selected,
        meta: card.type === 'building'
          ? formatBuildingMaterials(card.id, { compact: true })
          : COLONY_AI_LABEL[survivor?.aiState] || '自动工作',
      }, () => this.selectBuildCard(card));
    });
  }

  drawCombatCards(ctx) {
    ctx.save();
    drawAssetOrFallback(ctx, this.assetStore, 'ui-gel-energy', (asset) => {
      ctx.drawImage(asset, 37, BOTTOM.y + 18, 74, 74);
    }, () => {
      ctx.fillStyle = '#61D6A2';
      ctx.strokeStyle = PALETTE.inkSoft;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(74, BOTTOM.y + 55, 37, 0, TAU);
      ctx.fill();
      ctx.stroke();
    });
    ctx.fillStyle = '#FFF8E9';
    ctx.font = '900 26px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.state.energy}`, 74, BOTTOM.y + 56);
    ctx.font = '700 12px "PingFang SC", sans-serif';
    ctx.fillText('能量', 74, BOTTOM.y + 76);
    ctx.restore();

    const width = 122;
    SKILLS.forEach((card, index) => {
      const cooldown = Math.max(0, this.state.skills[card.id].readyAtAction - this.state.friendlyActions);
      const enabled = cooldown === 0 && this.state.energy >= card.energy;
      this.drawMiniCard(ctx, `skill-${card.id}`, { x: 130 + index * 132, y: BOTTOM.y + 13, w: width, h: 84 }, card, {
        selected: this.selection?.cardId === card.id,
        disabled: !enabled,
        meta: cooldown > 0 ? `行动 ${cooldown}` : `能量 ${card.energy}`,
      }, () => this.selectCombatCard(card), enabled);
    });

    ctx.save();
    ctx.strokeStyle = 'rgba(51,71,80,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(664, BOTTOM.y + 22);
    ctx.lineTo(664, BOTTOM.y + 88);
    ctx.stroke();
    ctx.restore();

    ITEMS.forEach((card, index) => {
      const charges = this.state.items[card.id]?.charges || 0;
      this.drawMiniCard(ctx, `item-${card.id}`, { x: 680 + index * 154, y: BOTTOM.y + 13, w: 144, h: 84 }, card, {
        selected: this.selection?.cardId === card.id,
        disabled: charges <= 0,
        meta: `剩余 ${charges}`,
        item: true,
      }, () => this.selectCombatCard(card), charges > 0);
    });
  }

  cardGlyph(card) {
    if (card.type === 'building') return '';
    const glyphs = {
      'survivor-shell-shell': '盾', 'survivor-crystal-pin': '晶', 'survivor-bubble-float': '泡', 'survivor-moss-sprout': '芽',
      'skill-jelly-bounce': '弹', 'skill-honey-line': '胶', 'skill-soft-swap': '换', 'skill-sprout-renewal': '春',
      'item-spring-pad': '垫', 'item-lure-jelly': '诱', 'item-moving-bubble': '搬',
    };
    return glyphs[card.id] || '胶';
  }

  cardAssetKey(card) {
    if (card.type === 'skill' || card.type === 'item') return `${card.id}-icon`;
    if (card.type === 'survivor' || card.type === 'building') return card.id;
    return null;
  }

  drawCardArtwork(ctx, card, rect, { padding = 6, fallbackFontSize = 30 } = {}) {
    const drawGlyph = () => {
      ctx.fillStyle = '#FFF8E9';
      ctx.font = `900 ${fallbackFontSize}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.cardGlyph(card), rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
    };
    const assetKey = this.cardAssetKey(card);
    if (!assetKey) {
      ctx.save();
      drawGlyph();
      ctx.restore();
      return false;
    }
    return drawAssetOrFallback(ctx, this.assetStore, assetKey, (asset) => {
      drawCharacterImageContained(
        ctx,
        asset,
        card.id,
        rect.x + padding,
        rect.y + padding,
        Math.max(1, rect.w - padding * 2),
        Math.max(1, rect.h - padding * 2),
        1,
      );
    }, card.type === 'building' ? () => {} : drawGlyph);
  }

  drawMiniCard(ctx, id, rect, card, options, onTap, enabled = true) {
    const hovered = this.hoverId === id;
    const lift = options.selected ? -5 : hovered ? -2 : 0;
    const border = options.item ? '#B48768' : options.selected ? '#3F8B6A' : '#7DA58D';
    ctx.save();
    ctx.globalAlpha = options.disabled ? 0.48 : 1;
    const frameDrawn = drawAssetOrFallback(
      ctx,
      this.assetStore,
      options.item ? 'ui-card-frame-item' : 'ui-card-frame-common',
      (asset) => drawNineSlice(ctx, asset, rect.x, rect.y + lift, rect.w, rect.h),
      () => {
        drawRoundedRect(ctx, rect.x, rect.y + lift, rect.w, rect.h, {
          radius: 18,
          fill: options.selected ? '#F0F8E8' : '#FFF8E9',
          stroke: border,
          lineWidth: options.selected ? 4 : 2.5,
        });
        drawRoundedRect(ctx, rect.x + 8, rect.y + 8 + lift, 46, rect.h - 16, {
          radius: 14, fill: card.color, stroke: 'rgba(51,71,80,0.28)', lineWidth: 2,
        });
      },
    );
    if (frameDrawn && (options.selected || hovered)) {
      drawRoundedRect(ctx, rect.x, rect.y + lift, rect.w, rect.h, {
        radius: 18,
        stroke: options.selected ? '#3F8B6A' : border,
        lineWidth: options.selected ? 4 : 2.5,
      });
    }
    const drawGlyph = () => {
      ctx.fillStyle = '#FFF8E9';
      ctx.font = '900 25px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.cardGlyph(card), rect.x + 31, rect.y + 52 + lift);
    };
    const assetKey = this.cardAssetKey(card);
    if (assetKey) {
      drawAssetOrFallback(ctx, this.assetStore, assetKey, (asset) => {
        drawCharacterImageContained(
          ctx,
          asset,
          card.id,
          rect.x + 11,
          rect.y + 12 + lift,
          40,
          rect.h - 24,
          card.type === 'survivor' || card.type === 'building' ? 1 : 0.5,
        );
      }, card.type === 'building' ? () => {} : drawGlyph);
    } else {
      drawGlyph();
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '800 15px "PingFang SC", sans-serif';
    ctx.fillText(card.shortName, rect.x + 62, rect.y + 31 + lift);
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = '700 12px "PingFang SC", sans-serif';
    ctx.fillText(options.meta || '', rect.x + 62, rect.y + 57 + lift);
    ctx.restore();
    this.addHit(id, rect.x, rect.y - 6, rect.w, rect.h + 8, onTap, enabled);
  }

  drawTab(ctx, id, x, y, label, active, onTap) {
    drawRoundedRect(ctx, x, y, 100, 34, {
      radius: 12,
      fill: active ? '#61D6A2' : 'rgba(107,122,131,0.11)',
      stroke: active ? '#3B8F70' : 'rgba(51,71,80,0.16)',
      lineWidth: 2,
    });
    ctx.save();
    ctx.fillStyle = active ? '#FFF8E9' : PALETTE.inkSoft;
    ctx.font = '800 15px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + 50, y + 23);
    ctx.restore();
    this.addHit(id, x, y, 100, 34, onTap);
  }

  drawButton(ctx, id, rect, label, options = {}, onTap) {
    const enabled = options.enabled !== false;
    const hovered = this.hoverId === id && enabled;
    let fill = options.secondary ? '#E7F3E7' : '#3FA57A';
    let stroke = options.secondary ? '#75A78C' : '#2C735A';
    let color = options.secondary ? '#2F6C57' : '#FFF8E9';
    if (options.danger) {
      fill = options.quiet ? '#F8E7E5' : '#E06B72';
      stroke = '#A94D56';
      color = options.quiet ? '#A94D56' : '#FFF8E9';
    }
    if (!enabled) fill = '#D8D8CF';
    const y = rect.y + (hovered ? -2 : 0);
    drawRoundedRect(ctx, rect.x, y, rect.w, rect.h, {
      radius: options.compact ? 14 : 17,
      fill,
      stroke,
      lineWidth: 2.5,
    });
    if (!options.quiet && enabled) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#FFFFFF';
      roundedRectPath(ctx, rect.x + 4, y + 4, rect.w - 8, Math.max(8, rect.h * 0.35), 12);
      ctx.fill();
      ctx.restore();
    }
    const drawLabel = () => {
      ctx.fillStyle = enabled ? color : '#8A928E';
      ctx.font = `${options.compact ? 800 : 900} ${options.compact ? 16 : 18}px "PingFang SC", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, rect.x + rect.w / 2, y + rect.h / 2 + 1);
    };
    if (options.iconAssetKey) {
      drawAssetOrFallback(ctx, this.assetStore, options.iconAssetKey, (asset) => {
        const iconSize = Math.min(28, rect.h - 12, rect.w - 12);
        drawImageContained(
          ctx,
          asset,
          rect.x + (rect.w - iconSize) / 2,
          y + (rect.h - iconSize) / 2,
          iconSize,
          iconSize,
        );
      }, drawLabel);
    } else {
      ctx.save();
      drawLabel();
      ctx.restore();
    }
    this.addHit(id, rect.x, rect.y - 3, rect.w, rect.h + 6, onTap, enabled);
  }

  drawTransientUi(ctx) {
    if (this.state.phase === 'battle' && this.state.paused && !this.selection) {
      drawRoundedRect(ctx, BOARD.x + 132, BOARD.y + 14, 204, 38, {
        radius: 19, fill: 'rgba(38,54,66,0.82)', stroke: 'rgba(255,248,233,0.6)', lineWidth: 2,
      });
      ctx.save();
      ctx.fillStyle = '#FFF8E9';
      ctx.font = '800 15px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('已暂停 · 时间完全冻结', BOARD.x + 234, BOARD.y + 39);
      ctx.restore();
    }
    if (this.toast) {
      const palette = {
        normal: ['rgba(38,54,66,0.9)', '#FFF8E9'],
        danger: ['rgba(167,63,80,0.94)', '#FFF8E9'],
        good: ['rgba(47,132,97,0.94)', '#FFF8E9'],
      }[this.toast.tone] || ['rgba(38,54,66,0.9)', '#FFF8E9'];
      ctx.save();
      ctx.font = '800 16px "PingFang SC", sans-serif';
      const width = Math.min(590, ctx.measureText(this.toast.text).width + 54);
      drawRoundedRect(ctx, VIEW.width / 2 - width / 2, 91, width, 42, {
        radius: 21, fill: palette[0], stroke: 'rgba(255,255,255,0.48)', lineWidth: 2,
      });
      ctx.fillStyle = palette[1];
      ctx.textAlign = 'center';
      ctx.fillText(this.toast.text, VIEW.width / 2, 118);
      ctx.restore();
    }
    if (this.modal?.type === 'retreat') this.drawRetreatConfirm(ctx);
  }

  drawModalShade(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(28,44,48,0.58)';
    ctx.fillRect(0, 0, VIEW.width, VIEW.height);
    ctx.restore();
    this.addHit('modal-blocker', 0, 0, VIEW.width, VIEW.height, () => {});
  }

  drawWelcome(ctx) {
    this.drawModalShade(ctx);
    const rect = { x: 310, y: 120, w: 660, h: 476 };
    drawRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, {
      radius: 34, fill: '#FFF8E9', stroke: PALETTE.inkSoft, lineWidth: 4,
    });
    const page = this.modal.page || 0;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 34px "PingFang SC", sans-serif';
    ctx.fillText(page === 0 ? '欢迎来到史莱姆基地' : '经营基地，探索大世界', VIEW.width / 2, rect.y + 66);
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = '600 18px "PingFang SC", sans-serif';
    ctx.fillText(page === 0 ? '史莱姆会自己工作，你来决定基地发展和探索方向' : '三只史莱姆在同一张地图行走、开雾并自动战斗', VIEW.width / 2, rect.y + 101);
    ctx.restore();

    if (page === 0) {
      drawSlime(ctx, VIEW.width / 2 - 145, rect.y + 270, 112, 'shell', {
        assetStore: this.assetStore,
        time: this.time,
        phase: 0,
        rigAsset: this.rigAssetFor('survivor-shell-shell'),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
      drawSlime(ctx, VIEW.width / 2 - 48, rect.y + 274, 92, 'needle', {
        assetStore: this.assetStore,
        time: this.time,
        phase: 1,
        rigAsset: this.rigAssetFor('survivor-crystal-pin'),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
      drawSlime(ctx, VIEW.width / 2 + 50, rect.y + 274, 92, 'bubble', {
        assetStore: this.assetStore,
        time: this.time,
        phase: 2,
        rigAsset: this.rigAssetFor('survivor-bubble-float'),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
      drawSlime(ctx, VIEW.width / 2 + 145, rect.y + 272, 98, 'sprout', {
        assetStore: this.assetStore,
        time: this.time,
        phase: 3,
        rigAsset: this.rigAssetFor('survivor-moss-sprout'),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
      ctx.save();
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.font = '700 17px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('基地和四只史莱姆已经准备好，进入后可以立刻派队探索。', VIEW.width / 2, rect.y + 356);
      ctx.restore();
    } else {
      const tips = [
        ['经营', '史莱姆自动采集、搬运和建造'],
        ['组队', '从四只史莱姆中恰好选择三只'],
        ['探索', '点选真实地标，行走开雾并挑战Boss栖息地'],
      ];
      const tutorialArtLayers = [
        [
          { key: 'building-mushroom-home', dx: 10, dy: 0, width: 72, height: 72 },
          { key: 'resource-soft-gel-token', dx: -38, dy: 14, width: 32, height: 32 },
        ],
        [
          { key: 'survivor-shell-shell', dx: -34, dy: 3, width: 52, height: 52, portrait: true },
          { key: 'survivor-crystal-pin', dx: 0, dy: -2, width: 54, height: 54, portrait: true },
          { key: 'survivor-moss-sprout', dx: 34, dy: 3, width: 52, height: 52, portrait: true },
        ],
        [
          { key: 'terrain-discovery-fog-cell-v1', dx: 0, dy: 8, width: 116, height: 66, alpha: 0.72 },
          { key: 'survivor-moss-sprout', dx: -34, dy: 10, width: 44, height: 44, portrait: true },
          { key: 'terrain-crystal-shard-node-a', dx: 30, dy: 1, width: 50, height: 58 },
        ],
      ];
      tips.forEach((tip, index) => {
        const x = rect.x + 44 + index * 196;
        drawRoundedRect(ctx, x, rect.y + 151, 180, 174, {
          radius: 24, fill: index === 0 ? '#EDF7E9' : index === 1 ? '#EAF3F8' : '#F2EAF4',
          stroke: index === 0 ? '#8DBA8A' : index === 1 ? '#83AEC2' : '#B49AC0', lineWidth: 2,
        });
        const artCenterX = x + 90;
        const artCenterY = rect.y + 201;
        let authoredArtDrawn = false;
        for (const layer of tutorialArtLayers[index]) {
          authoredArtDrawn = drawAssetOrFallback(ctx, this.assetStore, layer.key, (asset) => {
            ctx.globalAlpha *= layer.alpha ?? 1;
            const dimensions = imageDimensions(asset, 512, 512);
            const sourceRect = layer.portrait
              ? characterPortraitCrop(layer.key, dimensions.width, dimensions.height)
              : null;
            drawImageContained(
              ctx,
              asset,
              artCenterX + layer.dx - layer.width / 2,
              artCenterY + layer.dy - layer.height / 2,
              layer.width,
              layer.height,
              0.5,
              sourceRect,
            );
          }, () => {}) || authoredArtDrawn;
        }
        ctx.save();
        ctx.fillStyle = PALETTE.ink;
        ctx.textAlign = 'center';
        if (!authoredArtDrawn) {
          ctx.font = '900 24px "PingFang SC", sans-serif';
          ctx.fillText(`${index + 1}`, x + 90, rect.y + 201);
        }
        ctx.font = '900 19px "PingFang SC", sans-serif';
        ctx.fillText(tip[0], x + 90, rect.y + 243);
        ctx.fillStyle = PALETTE.textMuted;
        ctx.font = '600 14px "PingFang SC", sans-serif';
        wrapText(ctx, tip[1], x + 90, rect.y + 275, 142, 22, 3);
        ctx.restore();
      });
    }

    this.drawButton(ctx, 'welcome-next', { x: rect.x + 187, y: rect.y + 392, w: 286, h: 58 }, page === 0 ? '继续' : '开始经营', {}, () => {
      if (page === 0) this.modal.page = 1;
      else {
        this.state.tutorialSeen = true;
        this.modal = null;
        this.save();
        this.showToast('右侧点“三人探索”，马上开始第一次大世界冒险', 'good', 3.4);
      }
    });
  }

  drawExpeditionSquadModal(ctx) {
    this.drawModalShade(ctx);
    const rect = { x: 230, y: 94, w: 820, h: 532 };
    const selected = new Set(this.modal?.selectedIds || []);
    drawRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, {
      radius: 34, fill: '#FFF8E9', stroke: '#4E9BB1', lineWidth: 4,
    });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 30px "PingFang SC", sans-serif';
    ctx.fillText('选择三只探索史莱姆', VIEW.width / 2, rect.y + 58);
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = '600 16px "PingFang SC", sans-serif';
    ctx.fillText(`必须恰好三只 · 已选 ${selected.size} / ${EXPEDITION_PARTY_RULES.size}`, VIEW.width / 2, rect.y + 88);
    ctx.restore();

    this.availableExpeditionSlimeIds().forEach((cardId, index) => {
      const card = SURVIVOR_BY_ID[cardId];
      const x = rect.x + 32 + index * 191;
      const y = rect.y + 122;
      const active = selected.has(cardId);
      drawRoundedRect(ctx, x, y, 174, 250, {
        radius: 24,
        fill: active ? '#E5F7F0' : '#F3F0E9',
        stroke: active ? '#3C9E79' : 'rgba(51,71,80,0.22)',
        lineWidth: active ? 4 : 2,
      });
      this.drawCardArtwork(ctx, card, { x: x + 24, y: y + 20, w: 126, h: 112 }, {
        padding: 5,
        fallbackFontSize: 42,
      });
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '900 19px "PingFang SC", sans-serif';
      ctx.fillText(card.name, x + 87, y + 163);
      ctx.fillStyle = PALETTE.textMuted;
      ctx.font = '600 13px "PingFang SC", sans-serif';
      wrapText(ctx, card.description, x + 87, y + 188, 142, 19, 3);
      ctx.fillStyle = active ? '#2F8060' : PALETTE.textMuted;
      ctx.font = '800 14px "PingFang SC", sans-serif';
      ctx.fillText(active ? '✓ 已加入' : '点击加入', x + 87, y + 232);
      ctx.restore();
      this.addHit(`expedition-squad-${cardId}`, x, y, 174, 250, () => this.toggleExpeditionSlime(cardId));
    });

    this.drawButton(ctx, 'expedition-squad-close', { x: rect.x + 38, y: rect.y + 430, w: 222, h: 58 }, '先留在基地', { secondary: true }, () => {
      this.modal = null;
      this.state.paused = false;
    });
    this.drawButton(ctx, 'expedition-squad-start', { x: rect.x + rect.w - 320, y: rect.y + 430, w: 282, h: 58 }, '进入大世界', {
      enabled: selected.size === EXPEDITION_PARTY_RULES.size,
    }, () => this.startExpedition(this.modal?.selectedIds));
  }

  drawExpeditionRouteModal(ctx) {
    this.drawModalShade(ctx);
    const run = this.state.expeditionRun;
    const choices = run?.route?.choices || [];
    const bossStage = Boolean(run?.route?.isBossStage);
    const rect = { x: 190, y: 88, w: 900, h: 548 };
    drawRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, {
      radius: 34,
      fill: '#FFF8E9',
      stroke: bossStage ? '#A94D56' : '#4E9BB1',
      lineWidth: 4,
    });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = bossStage ? '#A94D56' : PALETTE.ink;
    ctx.font = '900 30px "PingFang SC", sans-serif';
    ctx.fillText(bossStage ? '最终首领就在前方' : '选择下一条远征路线', VIEW.width / 2, rect.y + 58);
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = '600 16px "PingFang SC", sans-serif';
    ctx.fillText(bossStage ? '击败酸壳蜗王即可带回全部战利品' : '战斗自动进行，路线与强化由你决定', VIEW.width / 2, rect.y + 88);
    ctx.restore();

    const cardWidth = bossStage ? 360 : 258;
    const gap = 24;
    const totalWidth = choices.length * cardWidth + Math.max(0, choices.length - 1) * gap;
    choices.forEach((node, index) => {
      const x = VIEW.width / 2 - totalWidth / 2 + index * (cardWidth + gap);
      const y = rect.y + 126;
      const nodeType = EXPEDITION_ROUTE_NODE_TYPE_BY_ID[node.nodeTypeId];
      const encounter = EXPEDITION_ENCOUNTER_BY_ID[node.templateId];
      const accent = node.isFinalBoss ? '#A94D56' : index === 0 ? '#8975DD' : index === 1 ? '#3C9E79' : '#C58B2E';
      drawRoundedRect(ctx, x, y, cardWidth, 310, {
        radius: 26, fill: '#F5F2EA', stroke: accent, lineWidth: 3,
      });
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = accent;
      ctx.font = '900 17px "PingFang SC", sans-serif';
      ctx.fillText(node.isFinalBoss ? '最终 BOSS' : nodeType?.shortName || EXPEDITION_KIND_LABEL[node.kind] || '遭遇', x + cardWidth / 2, y + 30);
      const assetKey = node.isFinalBoss
        ? 'expedition-route-boss'
        : EXPEDITION_ROUTE_ASSET_BY_NODE_TYPE[node.nodeTypeId] || 'expedition-route-combat';
      const iconSize = node.isFinalBoss ? 100 : 92;
      drawAssetOrFallback(ctx, this.assetStore, assetKey, (asset) => {
        drawImageContained(
          ctx,
          asset,
          x + (cardWidth - iconSize) / 2,
          y + 38,
          iconSize,
          iconSize,
          0.5,
        );
      }, () => {
        ctx.fillStyle = accent;
        ctx.font = '900 45px "PingFang SC", sans-serif';
        ctx.fillText(node.isFinalBoss ? '王' : nodeType?.shortName?.slice(0, 1) || '路', x + cardWidth / 2, y + 102);
      });
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '900 21px "PingFang SC", sans-serif';
      ctx.fillText(node.isFinalBoss ? '酸壳蜗王' : nodeType?.name || encounter?.id || '未知路线', x + cardWidth / 2, y + 151);
      ctx.fillStyle = PALETTE.textMuted;
      ctx.font = '600 14px "PingFang SC", sans-serif';
      wrapText(ctx, nodeType?.description || '迎战大群但较弱的怪物，夺回沿途资源。', x + cardWidth / 2, y + 177, cardWidth - 40, 19, 2);
      const rewards = Object.entries(flattenExpeditionRewards(node.reward));
      ctx.fillStyle = '#3C745E';
      ctx.font = '800 14px "PingFang SC", sans-serif';
      ctx.fillText(rewards.map(([id, amount]) => `${EXPEDITION_REWARD_LABEL[id] || id} +${amount}`).join(' · ') || '强化机会', x + cardWidth / 2, y + 221);
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.font = '700 13px "PingFang SC", sans-serif';
      ctx.fillText(`敌群强度 ${node.power}`, x + cardWidth / 2, y + 244);
      ctx.restore();
      this.drawButton(ctx, `expedition-route-${node.uid}`, { x: x + 24, y: y + 252, w: cardWidth - 48, h: 48 }, node.isFinalBoss ? '挑战首领' : '走这条路', {}, () => this.chooseExpeditionRouteNode(node.uid));
    });
    this.drawButton(ctx, 'expedition-route-abandon', { x: rect.x + 34, y: rect.y + 470, w: 190, h: 44 }, '现在撤回', { quiet: true, danger: true }, () => this.abandonCurrentExpedition());
  }

  drawExpeditionBoonModal(ctx) {
    this.drawModalShade(ctx);
    const choices = this.state.expeditionRun?.boonChoices || [];
    const rect = { x: 190, y: 92, w: 900, h: 536 };
    drawRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, {
      radius: 34, fill: '#FFF8E9', stroke: '#8975DD', lineWidth: 4,
    });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 30px "PingFang SC", sans-serif';
    ctx.fillText('战后变异 · 三选一', VIEW.width / 2, rect.y + 58);
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = '600 16px "PingFang SC", sans-serif';
    ctx.fillText('强化只在本次远征生效，选择后继续前进', VIEW.width / 2, rect.y + 88);
    ctx.restore();
    choices.forEach((choice, index) => {
      const upgrade = EXPEDITION_UPGRADE_BY_ID[choice.id];
      const x = rect.x + 42 + index * 276;
      const y = rect.y + 126;
      drawRoundedRect(ctx, x, y, 258, 292, {
        radius: 26,
        fill: upgrade?.rarity === 'advanced' ? '#F2EAF4' : '#EDF7E9',
        stroke: upgrade?.rarity === 'advanced' ? '#8975DD' : '#61A986',
        lineWidth: 3,
      });
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = upgrade?.rarity === 'advanced' ? '#745EC0' : '#3C745E';
      ctx.font = '900 14px "PingFang SC", sans-serif';
      ctx.fillText(upgrade?.rarity === 'advanced' ? '高级变异' : '基础变异', x + 129, y + 26);
      drawAssetOrFallback(ctx, this.assetStore, choice.id, (asset) => {
        drawImageContained(ctx, asset, x + 80, y + 34, 98, 92, 0.5);
      }, () => {
        ctx.fillStyle = upgrade?.rarity === 'advanced' ? '#745EC0' : '#3C745E';
        ctx.font = '900 42px "PingFang SC", sans-serif';
        ctx.fillText('变', x + 129, y + 99);
      });
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '900 20px "PingFang SC", sans-serif';
      ctx.fillText(upgrade?.name || choice.id, x + 129, y + 147);
      ctx.fillStyle = PALETTE.textMuted;
      ctx.font = '700 13px "PingFang SC", sans-serif';
      const targetName = upgrade?.target === 'party'
        ? '全队生效'
        : `${SURVIVOR_BY_ID[upgrade?.target]?.shortName || '指定史莱姆'}专属`;
      ctx.fillText(targetName, x + 129, y + 172);
      ctx.font = '600 13px "PingFang SC", sans-serif';
      wrapText(
        ctx,
        EXPEDITION_UPGRADE_DESCRIPTION[choice.id] || '让小队在本次远征中获得新的能力。',
        x + 129,
        y + 198,
        216,
        18,
        2,
      );
      ctx.restore();
      this.drawButton(ctx, `expedition-boon-${choice.id}`, { x: x + 26, y: y + 230, w: 206, h: 50 }, '选择这项变异', {}, () => this.chooseExpeditionUpgrade(choice.id));
    });
  }

  drawIntelModal(ctx) {
    this.drawModalShade(ctx);
    const rect = { x: 214, y: 102, w: 852, h: 506 };
    drawRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, {
      radius: 34, fill: '#FFF8E9', stroke: PALETTE.inkSoft, lineWidth: 4,
    });
    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 30px "PingFang SC", sans-serif';
    ctx.fillText('敌情预览', rect.x + 34, rect.y + 54);
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = '600 16px "PingFang SC", sans-serif';
    ctx.fillText('三波敌情可随时查看；气象台会在战斗中标记精英目标。', rect.x + 34, rect.y + 82);
    ctx.restore();

    WAVES.forEach((wave, index) => {
      const x = rect.x + 30 + index * 267;
      const y = rect.y + 111;
      drawRoundedRect(ctx, x, y, 247, 256, {
        radius: 24,
        fill: index === 2 ? '#F4EBE5' : '#EDF5EB',
        stroke: index === 2 ? '#C48B78' : '#93B596',
        lineWidth: 2.5,
      });
      ctx.save();
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '900 18px "PingFang SC", sans-serif';
      ctx.fillText(`第${index + 1}波 · ${wave.name}`, x + 18, y + 34);
      ctx.fillStyle = PALETTE.textMuted;
      ctx.font = '600 14px "PingFang SC", sans-serif';
      wrapText(ctx, wave.description, x + 18, y + 62, 211, 21, 3);
      const counts = {};
      wave.groups.forEach((group) => { counts[group.enemyId] = (counts[group.enemyId] || 0) + group.count; });
      let line = 0;
      Object.entries(counts).forEach(([enemyId, count]) => {
        const enemy = ENEMY_BY_ID[enemyId];
        const cy = y + 143 + line * 29;
        drawAssetOrFallback(ctx, this.assetStore, enemyId, (asset) => {
          drawCharacterImageContained(ctx, asset, enemyId, x + 13, cy - 24, 30, 26, 1);
        }, () => {
          ctx.fillStyle = enemy.color;
          ctx.beginPath();
          ctx.arc(x + 28, cy - 5, 8, 0, TAU);
          ctx.fill();
        });
        ctx.fillStyle = PALETTE.inkSoft;
        ctx.font = '700 14px "PingFang SC", sans-serif';
        ctx.fillText(`${enemy.shortName} × ${count}`, x + 46, cy);
        line += 1;
      });
      ctx.restore();
    });

    this.drawButton(ctx, 'intel-back', { x: rect.x + 34, y: rect.y + 414, w: 232, h: 58 }, '返回调整', { secondary: true }, () => { this.state.phase = 'build'; });
    this.drawButton(ctx, 'intel-start', { x: rect.x + rect.w - 316, y: rect.y + 414, w: 282, h: 58 }, '主动开启第一波', {}, () => this.beginDefense());
  }

  drawRetreatConfirm(ctx) {
    this.drawModalShade(ctx);
    const expedition = this.isExpeditionSession();
    const rect = { x: 382, y: 208, w: 516, h: 304 };
    drawRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, {
      radius: 32, fill: '#FFF8E9', stroke: PALETTE.inkSoft, lineWidth: 4,
    });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 28px "PingFang SC", sans-serif';
    ctx.fillText(expedition ? '要结束这次远征吗？' : '要安全撤回吗？', VIEW.width / 2, rect.y + 64);
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = '600 17px "PingFang SC", sans-serif';
    ctx.fillText(expedition ? '小队会安全回到基地，临时变异不会保留。' : '会回到开战前的庭院，不会永久损坏建筑。', VIEW.width / 2, rect.y + 104);
    ctx.fillText(expedition ? '已获得战利品会按撤回比例结算一次。' : '本次尚未结算的软晶不会获得。', VIEW.width / 2, rect.y + 132);
    ctx.restore();
    this.drawButton(ctx, 'retreat-cancel', { x: rect.x + 34, y: rect.y + 206, w: 208, h: 58 }, expedition ? '继续远征' : '继续防守', { secondary: true }, () => { this.modal = null; });
    this.drawButton(ctx, 'retreat-confirm', { x: rect.x + 274, y: rect.y + 206, w: 208, h: 58 }, '确认撤回', { danger: true }, () => {
      this.modal = null;
      if (expedition) this.abandonCurrentExpedition();
      else this.retreatToBuild();
    });
  }

  drawResultModal(ctx) {
    const result = this.state.result;
    if (result?.expedition) {
      this.drawExpeditionResultModal(ctx, result);
      return;
    }
    this.drawModalShade(ctx);
    const rect = { x: 314, y: 111, w: 652, h: 500 };
    drawRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, {
      radius: 36,
      fill: '#FFF8E9',
      stroke: result.victory ? '#3F8B6A' : '#A94D56',
      lineWidth: 5,
    });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = result.victory ? '#2F8060' : '#A94D56';
    ctx.font = '900 36px "PingFang SC", sans-serif';
    ctx.fillText(result.victory ? '果冻庭院守住了！' : '这次先撤回吧', VIEW.width / 2, rect.y + 70);
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = '600 17px "PingFang SC", sans-serif';
    ctx.fillText(result.victory ? '布局、击退和暂停出牌一起完成了防守。' : '城镇已经恢复到开战前，可以重新布阵。', VIEW.width / 2, rect.y + 105);
    ctx.restore();

    const stats = [
      ['软核剩余', `${Math.round(result.coreRatio * 100)}%`],
      ['击退敌人', `${result.kills}`],
      ['保住建筑', `${result.buildingsLeft}`],
    ];
    stats.forEach((stat, index) => {
      const x = rect.x + 38 + index * 195;
      drawRoundedRect(ctx, x, rect.y + 144, 180, 104, {
        radius: 22, fill: index === 0 ? '#EDF7E9' : '#EEF1F4', stroke: 'rgba(51,71,80,0.16)', lineWidth: 2,
      });
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.textMuted;
      ctx.font = '700 14px "PingFang SC", sans-serif';
      ctx.fillText(stat[0], x + 90, rect.y + 177);
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '900 27px "PingFang SC", sans-serif';
      ctx.fillText(stat[1], x + 90, rect.y + 220);
      ctx.restore();
    });

    drawRoundedRect(ctx, rect.x + 38, rect.y + 278, rect.w - 76, 72, {
      radius: 22, fill: '#E7F5F7', stroke: '#75B6C3', lineWidth: 2,
    });
    this.drawResourceToken(ctx, 'softCrystals', rect.x + 80, rect.y + 314, 38);
    ctx.save();
    ctx.fillStyle = '#4E7E8A';
    ctx.font = '800 18px "PingFang SC", sans-serif';
    ctx.fillText('本局获得', rect.x + 106, rect.y + 322);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 27px "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`+${result.reward} 软晶`, rect.x + rect.w - 62, rect.y + 324);
    ctx.restore();

    this.drawButton(ctx, 'result-return', { x: rect.x + 170, y: rect.y + 400, w: 312, h: 60 }, '回到庭院重新布置', {}, () => this.returnToTown());
  }

  drawExpeditionResultModal(ctx, result) {
    this.drawModalShade(ctx);
    const victory = result.outcome === 'completed';
    const rect = { x: 294, y: 104, w: 692, h: 512 };
    drawRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, {
      radius: 36,
      fill: '#FFF8E9',
      stroke: victory ? '#3F8B6A' : '#C58B2E',
      lineWidth: 5,
    });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = victory ? '#2F8060' : '#A97528';
    ctx.font = '900 34px "PingFang SC", sans-serif';
    ctx.fillText(victory ? '远征完成！' : result.outcome === 'failed' ? '小队已撤离' : '安全返回基地', VIEW.width / 2, rect.y + 66);
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = '600 16px "PingFang SC", sans-serif';
    ctx.fillText(victory ? '酸壳蜗王已经退去，全部战利品已入库。' : '保留的战利品已经结算，基地没有受到损伤。', VIEW.width / 2, rect.y + 100);
    if (result.firstClear) {
      ctx.fillStyle = '#8975DD';
      ctx.font = '900 15px "PingFang SC", sans-serif';
      ctx.fillText('首次通关奖励已包含在下方', VIEW.width / 2, rect.y + 130);
    }
    ctx.restore();

    const entries = Object.entries(result.rewards || {});
    entries.slice(0, 4).forEach(([resourceId, amount], index) => {
      const width = 136;
      const gap = 16;
      const x = VIEW.width / 2 - (Math.min(entries.length, 4) * width + (Math.min(entries.length, 4) - 1) * gap) / 2
        + index * (width + gap);
      drawRoundedRect(ctx, x, rect.y + 164, width, 112, {
        radius: 22,
        fill: resourceId === 'softCrystals' ? '#E7F5F7' : '#EDF7E9',
        stroke: resourceId === 'softCrystals' ? '#75B6C3' : '#8DBA8A',
        lineWidth: 2,
      });
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.textMuted;
      ctx.font = '700 14px "PingFang SC", sans-serif';
      ctx.fillText(EXPEDITION_REWARD_LABEL[resourceId] || resourceId, x + width / 2, rect.y + 189);
      this.drawResourceToken(ctx, resourceId, x + width / 2, rect.y + 221, 34);
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '900 27px "PingFang SC", sans-serif';
      ctx.fillText(`+${Math.floor(amount)}`, x + width / 2, rect.y + 266);
      ctx.restore();
    });
    drawRoundedRect(ctx, rect.x + 48, rect.y + 312, rect.w - 96, 74, {
      radius: 22, fill: '#F2EAF4', stroke: '#B49AC0', lineWidth: 2,
    });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.inkSoft;
    ctx.font = '800 16px "PingFang SC", sans-serif';
    ctx.fillText(`完成路线 ${result.regularWins} 段 · 精英胜利 ${result.eliteWins} 次 · 击退 ${result.kills} 只`, VIEW.width / 2, rect.y + 357);
    ctx.restore();
    this.drawButton(ctx, 'expedition-result-return', { x: rect.x + 190, y: rect.y + 424, w: 312, h: 60 }, '返回基地继续经营', {}, () => this.returnToTown());
  }

  isBuildPhase() {
    return this.state.phase === 'build' || this.state.phase === 'between';
  }

  handleCellTap(cell) {
    if (this.isBuildPhase()) {
      this.handleBuildCellTap(cell);
      return;
    }
    if (this.state.phase === 'battle' && this.selection) this.handleBattleTarget(cell);
  }

  handleBuildCellTap(cell) {
    const selection = this.selection;
    const worldSite = this.state.worldExpedition?.status === 'choose-site'
      ? this.state.worldExpedition.sites?.find((site) => site.x === cell.x && site.y === cell.y)
      : null;
    if (worldSite && (!selection || selection.kind.startsWith('inspect-'))) {
      this.selectWorldExpeditionSite(worldSite.id);
      return;
    }
    if (selection?.kind === 'place-building') {
      const card = BUILDING_BY_ID[selection.cardId];
      const rotation = canonicalBuildingRotation(selection.rotation, card);
      if (!canPlace(
        this.state.buildings,
        card,
        cell.x,
        cell.y,
        rotation,
        null,
        this.runtimeTerrain,
      )) {
        this.showToast('这里放不下，换个位置试试', 'danger');
        return;
      }
      const shape = rotatedFootprint(card, rotation);
      const occupiedCells = footprintCells(card, cell.x, cell.y, rotation);
      this.ensureColonyBounds(occupiedCells);
      const recipe = BUILDING_RECIPE_BY_ID[card.id];
      if (!recipe || !this.state.colony) {
        this.showToast('这座建筑还没有可用的材料配方', 'danger');
        return;
      }
      let blueprint;
      try {
        blueprint = addBlueprint(this.state.colony, {
          cardId: card.id,
          x: cell.x,
          y: cell.y,
          footprint: shape,
          required: colonyRecipeResources(recipe.recipe),
          buildSeconds: recipe.constructionSeconds,
          terrainProject: card.terrainProject || null,
        });
      } catch {
        this.showToast('这块土地暂时不能放蓝图', 'danger');
        return;
      }
      this.state.buildings.push({
        uid: uid('building'), cardId: card.id, x: cell.x, y: cell.y,
        rotation, hp: card.hp, maxHp: card.hp,
        cooldown: 0, shotCount: 0, shield: 0, seed: 0,
        fenceTrigger: 1, destroyed: false, placedAt: this.time,
        underConstruction: true,
        blueprintUid: blueprint.uid,
        buildProgress: 0,
        terrainProject: Boolean(card.terrainProject),
      });
      const effectPosition = worldToScreen({
        x: cell.x + shape.width / 2,
        y: cell.y + shape.height,
      }, this.camera, BOARD);
      this.spawnDynamicEffect('place', effectPosition.x, effectPosition.y - 2, {
        color: card.color,
        accent: '#FFF0C4',
        intensity: clamp(shape.width * 0.82, 0.9, 1.55),
      });
      this.audio.play('place');
      const missing = missingBuildingMaterials(card.id, this.state.colony.resources);
      const waitHint = Object.keys(missing).length ? '，缺料时会等待采集' : '';
      this.showToast(card.terrainProject
        ? `铺块蓝图已放下，会覆盖该格未采资源${waitHint}`
        : `${card.shortName}蓝图已放下，史莱姆会搬材料施工${waitHint}`);
      this.save();
      return;
    }

    if (selection?.kind === 'move-building') {
      const building = this.state.buildings.find((item) => item.uid === selection.uid);
      if (!building) return;
      const card = BUILDING_BY_ID[building.cardId];
      const rotation = canonicalBuildingRotation(selection.rotation ?? building.rotation, card);
      if (!canPlace(
        this.state.buildings,
        card,
        cell.x,
        cell.y,
        rotation,
        building.uid,
        this.runtimeTerrain,
      )) {
        this.showToast('这个位置会和其他建筑重叠', 'danger');
        return;
      }
      building.x = cell.x;
      building.y = cell.y;
      building.rotation = rotation;
      this.ensureColonyBounds(footprintCells(card, cell.x, cell.y, rotation));
      building.placedAt = this.time;
      const shape = rotatedFootprint(card, rotation);
      const position = worldToScreen({
        x: cell.x + shape.width / 2,
        y: cell.y + shape.height,
      }, this.camera, BOARD);
      this.spawnDynamicEffect('place', position.x, position.y, {
        color: card.color,
        accent: '#FFF0C4',
        intensity: clamp(shape.width * 0.82, 0.9, 1.55),
      });
      this.selection = { kind: 'inspect-building', uid: building.uid };
      this.audio.play('place');
      this.save();
      return;
    }

    if (selection?.kind === 'place-survivor' || selection?.kind === 'move-survivor') {
      const survivor = selection.uid
        ? this.state.survivors.find((item) => item.uid === selection.uid)
        : this.state.survivors.find((item) => item.cardId === selection.cardId);
      if (!survivor) return;
      const terrainCell = this.worldCellAt(cell.x, cell.y);
      const blockingBuilding = operationalBuildingAt(this.state.buildings, cell.x, cell.y);
      if (terrainCell?.discovered === false
        || !terrainCellIsPassable(this.runtimeTerrain, cell.x, cell.y)
        || BUILDING_BY_ID[blockingBuilding?.cardId]?.solid) {
        this.showToast('史莱姆只能驻守在已探索的可通行地面', 'danger');
        return;
      }
      if (this.state.survivors.some((item) => item.uid !== survivor.uid && item.x === cell.x && item.y === cell.y)) {
        this.showToast('一个格子只能驻守一名幸存者', 'danger');
        return;
      }
      this.ensureColonyBounds([{ x: cell.x, y: cell.y }]);
      this.faceEntityToward(survivor, cell, 1);
      const colonySlime = this.state.colony?.slimes.find((item) => item.uid === survivor.uid);
      if (colonySlime) {
        cancelColonySlimeWork(this.state.colony, colonySlime);
        colonySlime.x = cell.x;
        colonySlime.y = cell.y;
      }
      survivor.x = cell.x;
      survivor.y = cell.y;
      survivor.placedAt = this.time;
      const position = this.cellCenter(cell.x, cell.y);
      this.spawnDynamicEffect('place', position.x, position.y + 20, {
        color: SURVIVOR_BY_ID[survivor.cardId].color,
        accent: '#F4FFD2',
        intensity: 0.95,
      });
      this.selection = { kind: 'inspect-survivor', uid: survivor.uid };
      this.audio.play('place');
      this.save();
      return;
    }

    const survivor = this.state.survivors.find((item) => item.x === cell.x && item.y === cell.y);
    if (survivor) {
      this.selection = { kind: 'inspect-survivor', uid: survivor.uid };
      return;
    }
    const building = buildingAt(this.state.buildings, cell.x, cell.y);
    if (building) {
      this.selection = { kind: 'inspect-building', uid: building.uid };
      return;
    }
    const terrainCell = this.worldCellAt(cell.x, cell.y);
    if (terrainCell?.discovered === false) {
      this.selection = null;
      this.showToast('这里尚未探索，派史莱姆靠近后会逐步发现', 'normal');
      return;
    }
    if (terrainCell?.terrainId !== 'ground') {
      this.selection = {
        kind: 'inspect-terrain',
        x: cell.x,
        y: cell.y,
        terrainId: terrainCell.terrainId,
      };
      const definition = TERRAIN_TYPES[terrainCell.terrainId];
      const help = TERRAIN_HELP[terrainCell.terrainId];
      this.showToast(`${definition.name} · ${help?.[0] || '荒野地形'}`);
      return;
    }
    this.selection = null;
  }

  selectBuildCard(card) {
    if (!this.isBuildPhase()) return;
    if (card.type === 'building') {
      this.selection = { kind: 'place-building', cardId: card.id, rotation: 0 };
      this.showToast(card.terrainProject
        ? '选择已探索的资源格铺地；剩余未采资源会被覆盖'
        : `选择格子放置${card.shortName}`);
    } else {
      const survivor = this.state.survivors.find((item) => item.cardId === card.id);
      if (!survivor) return;
      this.selection = { kind: 'inspect-survivor', uid: survivor.uid };
      this.camera = createWorldCamera({
        world: WORLD,
        viewport: BOARD,
        focus: { x: survivor.x + 0.5, y: survivor.y + 0.5 },
        zoom: this.camera.zoom,
      });
      this.showToast(`${card.shortName}正在${COLONY_AI_LABEL[survivor.aiState] || '自动工作'}`);
    }
  }

  rotateSelection() {
    if (this.selection?.kind === 'place-building') {
      const card = BUILDING_BY_ID[this.selection.cardId];
      this.selection.rotation = nextBuildingRotation(card, this.selection.rotation);
      return;
    }
    if (this.selection?.kind === 'move-building') {
      const building = this.state.buildings.find((item) => item.uid === this.selection.uid);
      if (!building) return;
      const card = BUILDING_BY_ID[building.cardId];
      this.selection.rotation = nextBuildingRotation(
        card,
        this.selection.rotation ?? building.rotation,
      );
      return;
    }
    if (this.selection?.kind === 'inspect-building') {
      const building = this.state.buildings.find((item) => item.uid === this.selection.uid);
      if (!building) return;
      const card = BUILDING_BY_ID[building.cardId];
      if (!buildingSupportsRotation(card)) return;
      this.selection = {
        kind: 'move-building',
        uid: building.uid,
        rotation: nextBuildingRotation(card, building.rotation),
      };
      this.showToast('选择旋转后的建筑位置');
    }
  }

  removeSelectedBuilding() {
    if (this.selection?.kind !== 'inspect-building') return;
    const index = this.state.buildings.findIndex((item) => item.uid === this.selection.uid);
    if (index < 0) return;
    if (this.state.buildings[index].underConstruction) {
      this.cancelConstructionBuilding(this.state.buildings[index], { persist: true, notify: true });
      return;
    }
    const [removed] = this.state.buildings.splice(index, 1);
    const refund = Object.fromEntries(Object.entries(buildingMaterialRecipe(removed.cardId))
      .map(([resourceType, amount]) => [resourceType, Math.floor(amount * 0.5)])
      .filter(([, amount]) => amount > 0));
    for (const [resourceType, amount] of Object.entries(refund)) {
      this.state.colony.resources[resourceType] += amount;
    }
    const refundText = Object.entries(refund)
      .map(([resourceType, amount]) => `${COLONY_RESOURCE_LABEL[resourceType]}${amount}`)
      .join(' ');
    this.showToast(`${BUILDING_BY_ID[removed.cardId].shortName}已拆除${refundText ? `，回收 ${refundText}` : ''}`);
    this.selection = null;
    this.save();
  }

  cancelSelectedBlueprint() {
    if (this.selection?.kind !== 'inspect-building' || !this.state.colony) return;
    const building = this.state.buildings.find((item) => (
      item.uid === this.selection.uid && item.underConstruction
    ));
    if (building) this.cancelConstructionBuilding(building, { persist: true, notify: true });
  }

  openIntel() {
    if (!this.state.survivors.length) {
      this.showToast('至少需要一名幸存者驻守', 'danger');
      return;
    }
    this.selection = null;
    this.state.phase = 'intel';
    this.state.waveIndex = 0;
    this.state.rewardEarned = 0;
    this.state.result = null;
  }

  beginDefense() {
    this.snapshotForBattle();
    this.state.coreHp = this.state.coreMaxHp;
    this.state.waveIndex = 0;
    this.state.kills = 0;
    this.state.rewardEarned = 0;
    this.resetCombatCards();
    this.startWave(0);
  }

  resetCombatCards() {
    this.state.skills = Object.fromEntries(SKILLS.map((card) => [card.id, { readyAtAction: 0 }]));
    this.state.items = Object.fromEntries(ITEMS.map((card) => [card.id, { charges: card.charges }]));
    this.state.friendlyActions = 0;
    this.state.actionEnergyProgress = 0;
    this.state.energy = WAVES[0].startEnergy;
  }

  buildSpawnQueue(wave) {
    const queue = [];
    wave.groups.forEach((group, groupIndex) => {
      for (let index = 0; index < group.count; index += 1) {
        queue.push({
          key: `${wave.id}-${groupIndex}-${index}`,
          enemyId: group.enemyId,
          row: group.rowIndices[index % group.rowIndices.length],
          at: group.startDelaySeconds + index * group.spawnIntervalSeconds,
        });
      }
    });
    return queue.sort((a, b) => a.at - b.at);
  }

  startWave(index) {
    const wave = WAVES[index];
    if (!wave) return;
    this.reconcileConstructionBlueprints({ persist: false, notify: false });
    this.state.phase = 'battle';
    this.state.paused = false;
    this.state.waveIndex = index;
    this.state.waveElapsed = 0;
    this.state.spawnQueue = this.buildSpawnQueue(wave);
    this.state.spawned = new Set();
    this.state.enemies = [];
    this.state.projectiles = [];
    this.state.worldEffects = [];
    this.state.dynamicEffects = [];
    this.state.terrain = this.state.terrain.filter((terrain) => terrain.persistent);
    this.state.deployables = [];
    this.pendingAttackHits.clear();
    this.expressionMixers.clear();
    this.state.energy = Math.max(this.state.energy || 0, wave.startEnergy);
    this.selection = null;

    this.state.buildings.forEach((building) => {
      if (building.underConstruction) return;
      const card = BUILDING_BY_ID[building.cardId];
      building.destroyed = false;
      building.hp = Math.max(building.hp, card.hp * 0.4);
      building.maxHp = card.hp;
      building.fenceTrigger = card.id === 'building-bouncy-fence' ? 1 : 0;
      building.cooldown = Math.random() * 0.35;
      building.shotCount = 0;
    });
    this.state.survivors.forEach((survivor) => {
      const card = SURVIVOR_BY_ID[survivor.cardId];
      survivor.downed = false;
      survivor.hp = Math.max(survivor.hp, card.hp * 0.45);
      survivor.maxHp = card.hp;
      survivor.cooldown = Math.random() * 0.4;
      survivor.actionCount = 0;
      survivor.hitCount = 0;
      survivor.attackCount = 0;
      if (card.id === 'survivor-shell-shell') survivor.shield = card.ability.shield;
    });
    this.showToast(`第 ${index + 1} 波 · ${wave.name}`);
  }

  togglePause() {
    if (this.state.phase !== 'battle') return;
    this.state.paused = !this.state.paused;
    if (!this.state.paused) this.selection = null;
  }

  retreatToBuild() {
    this.restoreBattleSnapshot();
    this.preBattleSnapshot = null;
    this.showToast('已安全撤回，城镇没有永久损伤');
  }

  finishWave() {
    const wave = WAVES[this.state.waveIndex];
    this.state.rewardEarned += wave.clearReward;
    this.spawnDynamicEffect(
      'wave-clear',
      BOARD.x + BOARD.width / 2,
      BOARD.y + BOARD.height / 2,
      {
        color: '#76DBA0',
        accent: '#FFF2A4',
        intensity: 1.15,
      },
    );
    this.shake = Math.max(this.shake, 0.28);
    if (this.state.waveIndex >= WAVES.length - 1) {
      this.finishDefense(true);
      return;
    }
    this.state.phase = 'between';
    this.state.paused = true;
    this.selection = null;
    this.state.buildings.forEach((building) => {
      if (building.underConstruction) return;
      const card = BUILDING_BY_ID[building.cardId];
      building.destroyed = false;
      building.hp = clamp(building.hp + card.hp * 0.22, card.hp * 0.32, card.hp);
    });
    this.state.survivors.forEach((survivor) => {
      const card = SURVIVOR_BY_ID[survivor.cardId];
      survivor.downed = false;
      survivor.hp = clamp(survivor.hp + card.hp * 0.25, card.hp * 0.38, card.hp);
    });
    this.audio.play('win');
    this.showToast(`第 ${this.state.waveIndex + 1} 波守住了，可以慢慢调整布局`, 'good', 3);
  }

  finishDefense(victory) {
    const participation = victory ? this.state.rewardEarned : Math.max(12, Math.round(this.state.rewardEarned * 0.25));
    const coreRatio = clamp(this.state.coreHp / this.state.coreMaxHp, 0, 1);
    this.state.result = {
      victory,
      reward: participation,
      coreRatio,
      kills: this.state.kills,
      buildingsLeft: this.state.buildings.filter(buildingIsOperational).length,
    };
    this.state.softCrystals += participation;
    this.state.phase = 'result';
    this.state.paused = true;
    this.pendingAttackHits.clear();
    this.expressionMixers.clear();
    this.selection = null;
    this.audio.play(victory ? 'win' : 'warning');
    this.save();
  }

  returnToTown() {
    if (this.state.result?.expedition || this.state.expeditionRun?.phase === 'settlement') {
      this.state.phase = 'build';
      this.state.paused = false;
      this.state.result = null;
      this.state.expeditionRun = null;
      this.state.enemies = [];
      this.state.spawnQueue = [];
      this.state.spawned = new Set();
      this.state.projectiles = [];
      this.state.worldEffects = [];
      this.state.dynamicEffects = [];
      this.state.terrain = [];
      this.state.deployables = [];
      this.state.coreHp = this.state.coreMaxHp;
      this.preBattleSnapshot = null;
      this.modal = null;
      this.selection = null;
      this.save();
      return;
    }
    const crystals = this.state.softCrystals;
    if (this.preBattleSnapshot && !this.state.result?.victory) {
      const snapshot = JSON.parse(this.preBattleSnapshot);
      this.state.buildings = snapshot.buildings.map((building) => ({
        ...building,
        hp: BUILDING_BY_ID[building.cardId].hp,
        maxHp: BUILDING_BY_ID[building.cardId].hp,
        destroyed: false,
      }));
      this.state.survivors = snapshot.survivors.map((survivor) => ({
        ...survivor,
        hp: SURVIVOR_BY_ID[survivor.cardId].hp,
        maxHp: SURVIVOR_BY_ID[survivor.cardId].hp,
        downed: false,
      }));
    } else {
      this.state.buildings.forEach((building) => {
        const card = BUILDING_BY_ID[building.cardId];
        building.hp = card.hp;
        building.maxHp = card.hp;
        building.destroyed = false;
      });
      this.state.survivors.forEach((survivor) => {
        const card = SURVIVOR_BY_ID[survivor.cardId];
        survivor.hp = card.hp;
        survivor.maxHp = card.hp;
        survivor.downed = false;
      });
    }
    this.state.softCrystals = crystals;
    this.state.coreHp = this.state.coreMaxHp;
    this.state.phase = 'build';
    this.state.result = null;
    this.state.enemies = [];
    this.state.projectiles = [];
    this.state.worldEffects = [];
    this.state.dynamicEffects = [];
    this.state.terrain = [];
    this.state.deployables = [];
    this.state.kills = 0;
    this.preBattleSnapshot = null;
    this.save();
  }
}
