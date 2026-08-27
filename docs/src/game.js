import {
  SURVIVORS,
  SKILLS,
  ITEMS,
  BUILDINGS,
  ENEMY_BY_ID,
  WAVES,
  SHAPING_BUDGET,
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

const VIEW = Object.freeze({ width: 1280, height: 720 });
const BOARD = Object.freeze({ x: 198, y: 103, cell: 78, cols: 6, rows: 6 });
const PANEL = Object.freeze({ x: 866, y: 92, width: 388, height: 486 });
const BOTTOM = Object.freeze({ x: 22, y: 592, width: 1232, height: 110 });
const STORAGE_KEY = 'slime-haven-prototype-v1';
const TAU = Math.PI * 2;

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
  heal: 0.72,
  spawn: 0.56,
  trail: 0.68,
  swap: 0.72,
  place: 0.5,
  'wave-clear': 0.95,
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
const inBoard = (x, y) => x >= 0 && x < BOARD.cols && y >= 0 && y < BOARD.rows;
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

function buildingAt(buildings, x, y, exceptUid = null) {
  return buildings.find((building) => {
    if (building.uid === exceptUid || building.destroyed) return false;
    const card = BUILDING_BY_ID[building.cardId];
    return footprintCells(card, building.x, building.y, building.rotation).some((cell) => cell.x === x && cell.y === y);
  }) || null;
}

function canPlace(buildings, card, x, y, rotation = 0, exceptUid = null) {
  const active = buildings
    .filter((building) => !building.destroyed && building.uid !== exceptUid)
    .map((building) => ({
      id: building.uid,
      cardId: building.cardId,
      x: building.x,
      y: building.y,
      rotation: building.rotation,
    }));
  const grid = createGridState({ buildings: active });
  return coreCanPlaceBuilding(grid, {
    id: exceptUid || '__placement-preview__',
    cardId: card.id,
    x,
    y,
    rotation,
  }, BUILDING_BY_ID);
}

function routeFor(buildings, start, target = null) {
  const active = buildings.filter((building) => !building.destroyed);
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
  const grid = createGridState({ buildings: gridBuildings });
  let route;
  if (target) {
    const pathOptions = { starts: [start], goals: [target] };
    route = findGridPath(grid, dynamicCatalog, { ...pathOptions, allowBreaching: false })
      || findGridPath(grid, dynamicCatalog, { ...pathOptions, allowBreaching: true });
  } else {
    route = findRightToLeftRoute(grid, dynamicCatalog, { start, allowBreach: true });
  }
  const cells = route?.cells || [start];
  return target ? cells : [...cells, { x: -1, y: cells.at(-1)?.y ?? start.y }];
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
    this.buildTab = 'buildings';
    this.selection = null;
    this.modal = null;
    this.toast = null;
    this.shake = 0;
    this.preBattleSnapshot = null;
    this.animators = new Map();
    this.expressionMixers = new Map();
    this.pendingAttackHits = new Map();
    this.state = this.createState();
    this.load();
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
    return this;
  }

  setGeneratedCharacterArtEnabled(enabled = true) {
    this.generatedCharacterArtEnabled = enabled !== false;
    return this;
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
      tutorialSeen: false,
    };
  }

  defaultBuildings() {
    const specs = [
      ['building-weather-scout', 0, 0, 0],
      ['building-mushroom-home', 1, 2, 0],
      ['building-bubble-tower', 3, 1, 0],
      ['building-honey-plot', 2, 4, 0],
      ['building-bouncy-fence', 4, 3, 0],
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
      ['survivor-shell-shell', 3, 3],
      ['survivor-crystal-pin', 1, 1],
      ['survivor-bubble-float', 2, 5],
      ['survivor-moss-sprout', 1, 2],
    ];
    return specs.map(([cardId, x, y]) => {
      const card = SURVIVOR_BY_ID[cardId];
      return {
        uid: uid('survivor'), cardId, x, y,
        hp: card.hp, maxHp: card.hp, shield: 0, seed: 0,
        cooldown: Math.random() * 0.4, actionCount: 0, hitCount: 0,
        attackCount: 0, downed: false, hitFlash: 0, placedAt: -10,
      };
    });
  }

  bindEvents() {
    this.onPointerDown = (event) => {
      event.preventDefault();
      this.audio.unlock();
      const point = this.toGamePoint(event);
      this.pointerDown = point;
    };
    this.onPointerUp = (event) => {
      event.preventDefault();
      const point = this.toGamePoint(event);
      this.handleTap(point);
      this.pointerDown = null;
    };
    this.onPointerMove = (event) => {
      const point = this.toGamePoint(event);
      this.hoverCell = this.pointToCell(point);
      this.hoverId = this.hits.findLast?.((hit) => hit.enabled !== false && roundedHit(point, hit))?.id
        || [...this.hits].reverse().find((hit) => hit.enabled !== false && roundedHit(point, hit))?.id
        || null;
    };
    this.onPointerCancel = () => {
      this.pointerDown = null;
      this.hoverId = null;
      this.hoverCell = null;
    };
    this.canvas.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    this.canvas.addEventListener('pointerup', this.onPointerUp, { passive: false });
    this.canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });
    this.canvas.addEventListener('pointercancel', this.onPointerCancel, { passive: true });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
    this.scale = Math.min(rect.width / VIEW.width, rect.height / VIEW.height);
    this.offsetX = (rect.width - VIEW.width * this.scale) / 2;
    this.offsetY = (rect.height - VIEW.height * this.scale) / 2;
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
      let layoutBuildings = this.state.buildings;
      let layoutSurvivors = this.state.survivors;
      if ((this.state.phase === 'battle' || this.state.phase === 'result') && this.preBattleSnapshot) {
        const safeLayout = JSON.parse(this.preBattleSnapshot);
        layoutBuildings = safeLayout.buildings;
        layoutSurvivors = safeLayout.survivors;
      }
      const payload = {
        softCrystals: this.state.softCrystals,
        tutorialSeen: this.state.tutorialSeen,
        buildings: layoutBuildings.filter((building) => !building.destroyed).map(({ uid: _uid, ...building }) => ({
          ...building,
          rotation: canonicalBuildingRotation(
            building.rotation,
            BUILDING_BY_ID[building.cardId],
          ),
          hp: BUILDING_BY_ID[building.cardId].hp,
          maxHp: BUILDING_BY_ID[building.cardId].hp,
          cooldown: 0,
          shotCount: 0,
          fenceTrigger: 1,
        })),
        survivors: layoutSurvivors.map(({ uid: _uid, ...survivor }) => ({
          ...survivor,
          hp: SURVIVOR_BY_ID[survivor.cardId].hp,
          maxHp: SURVIVOR_BY_ID[survivor.cardId].hp,
          cooldown: 0,
          downed: false,
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
      if (Array.isArray(saved.buildings) && saved.buildings.length) {
        this.state.buildings = saved.buildings
          .filter((item) => BUILDING_BY_ID[item.cardId])
          .map((item) => ({
            ...item,
            uid: uid('building'),
            rotation: canonicalBuildingRotation(item.rotation, BUILDING_BY_ID[item.cardId]),
            destroyed: false,
            placedAt: -10,
          }));
      }
      if (Array.isArray(saved.survivors) && saved.survivors.length) {
        this.state.survivors = saved.survivors
          .filter((item) => SURVIVOR_BY_ID[item.cardId])
          .map((item) => ({ ...item, uid: uid('survivor'), downed: false, placedAt: -10 }));
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
    if (this.state.phase === 'battle' && this.preBattleSnapshot) this.restoreBattleSnapshot();
    this.save();
  }

  snapshotForBattle() {
    this.preBattleSnapshot = JSON.stringify({
      buildings: this.state.buildings,
      survivors: this.state.survivors,
      coreHp: this.state.coreHp,
      softCrystals: this.state.softCrystals,
    });
  }

  restoreBattleSnapshot() {
    if (!this.preBattleSnapshot) return;
    const snapshot = JSON.parse(this.preBattleSnapshot);
    this.state.buildings = snapshot.buildings;
    this.state.survivors = snapshot.survivors;
    this.state.coreHp = snapshot.coreHp;
    this.state.softCrystals = snapshot.softCrystals;
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
    const x = Math.floor((point.x - BOARD.x) / BOARD.cell);
    const y = Math.floor((point.y - BOARD.y) / BOARD.cell);
    return inBoard(x, y) ? { x, y } : null;
  }

  addHit(id, x, y, w, h, onTap, enabled = true) {
    this.hits.push({ id, x, y, w, h, onTap, enabled });
  }

  showToast(text, tone = 'normal', duration = 2.1) {
    this.toast = { text, tone, expires: this.time + duration };
  }

  shapingUsed() {
    return this.state.buildings
      .filter((building) => !building.destroyed)
      .reduce((total, building) => total + BUILDING_BY_ID[building.cardId].cost, 0);
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

    if (this.state.phase === 'battle' && !this.state.paused && !this.selection) this.updateBattle(dt);

    this.updateEntityAnimations(animationDt);
  }

  animationClipsFor(cardId) {
    return ANIMATION_CLIPS_BY_CARD_ID[cardId] || null;
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
      controller.setBase('idle');
      if (survivor.downed) controller.play('downed', { restart: false });
      controller.update(dt);
      const events = controller.drainEvents();
      this.resolveEntityAnimationEvents(survivor, controller, events);
      this.updateEntityExpression(survivor, controller, events, dt);
    }
    for (const enemy of this.state.enemies) {
      liveIds.add(enemy.uid);
      if (enemy.dead) enemy.deathElapsed = (enemy.deathElapsed || 0) + dt;
      const controller = this.animatorFor(enemy);
      if (!controller) continue;
      if (!enemy.dead) {
        const base = enemy.cardId === 'enemy-acid-shell-king' && enemy.telegraph > 0
          ? 'charge'
          : (enemy.visualMoving ? 'move' : 'idle');
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
        this.spawnEnemy(spawn.enemyId, spawn.row);
      }
    }

    this.updateDeployables(dt);
    this.updateTerrain(dt);
    this.updateSurvivors(dt);
    this.updateBuildings(dt);
    this.updateEnemies(dt);

    const allSpawned = this.state.spawned.size === (this.state.spawnQueue?.length || 0);
    if (allSpawned && this.state.enemies.length === 0) this.finishWave();
  }

  spawnEnemy(enemyId, row) {
    const card = ENEMY_BY_ID[enemyId];
    const enemy = {
      uid: uid('enemy'), cardId: enemyId,
      x: 6.35, y: row,
      hp: card.hp, maxHp: card.hp,
      speed: card.speed, dead: false,
      attackTimer: 0, routeTimer: 0, path: [],
      stagger: 0, rooted: 0, eating: 0,
      honeyEntries: {}, lastCell: null,
      marked: false, hitFlash: 0,
      deathElapsed: 0,
      abilityTimer: card.ability?.cooldownSeconds || 0,
      telegraph: 0, telegraphTarget: null,
      spawnAt: this.time,
    };
    if (card.elite && this.state.buildings.some((building) => building.cardId === 'building-weather-scout' && !building.destroyed)) {
      enemy.marked = true;
      this.showToast('气象台已标记酸壳蜗王', 'good');
    }
    this.state.enemies.push(enemy);
    const spawnPosition = {
      x: BOARD.x + BOARD.cell * 6.65,
      y: this.cellCenter(0, row).y - 28,
    };
    this.spawnDynamicEffect('spawn', spawnPosition.x, spawnPosition.y, {
      color: card.color,
      accent: card.elite ? '#FFE27A' : '#EFD9FF',
      layer: 'back',
      intensity: card.elite ? 1.55 : 1,
    });
    this.spawnParticles(spawnPosition.x, spawnPosition.y + 28, '#9D7CA8', 8, 55);
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
      if (survivor.downed) continue;
      const card = SURVIVOR_BY_ID[survivor.cardId];
      survivor.cooldown -= dt;
      if (survivor.cooldown > 0) continue;
      const acted = this.performSurvivorAction(survivor);
      survivor.cooldown = acted ? card.attack.intervalSeconds : 0.18;
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
    const maxTargets = card.attack.pierce || 1;
    const attackTargets = targets.slice(0, maxTargets);
    const nextAttackCount = survivor.attackCount + 1;
    const nextHitCount = survivor.hitCount + 1;
    const crystalCell = card.id === 'survivor-crystal-pin'
      && nextAttackCount % card.ability.attacksRequired === 0
      ? this.nearestCell(attackTargets.at(-1))
      : null;
    const bubblePush = card.id === 'survivor-bubble-float'
      && nextHitCount % card.ability.hitsRequired === 0;
    const hitStarted = this.startEntityAttack(survivor, () => {
      attackTargets.forEach((enemy) => this.damageEnemy(enemy, card.attack.damage, survivor));
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
      .filter((target) => !target.destroyed && distance(survivor, target) <= card.ability.targetRangeTiles)
      .map((target) => ({ kind: 'building', target, ratio: target.hp / target.maxHp }));
    const choice = [...allies, ...structures].sort((a, b) => a.ratio - b.ratio)[0];
    if (!choice) return false;
    if (choice.ratio >= 0.995) choice.target.seed = Math.max(choice.target.seed || 0, card.ability.fullHealthShield);
    else choice.target.hp = Math.min(choice.target.maxHp, choice.target.hp + card.ability.heal);
    const position = this.entityCanvasPosition(choice.target);
    this.spawnDynamicEffect('heal', position.x, position.y - 28, {
      color: PALETTE.heal,
      accent: '#F4FFD2',
      intensity: 1,
    });
    this.spawnParticles(position.x, position.y - 25, PALETTE.heal, 10, 45);
    this.floatText(position.x, position.y - 40, choice.ratio >= 0.995 ? '萌芽' : `+${card.ability.heal}`, PALETTE.heal);
    this.audio.play('heal');
    return true;
  }

  updateBuildings(dt) {
    for (const building of this.state.buildings) {
      building.poisoned = Math.max(0, (building.poisoned || 0) - dt);
      if (building.destroyed) continue;
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
      if (this.state.phase !== 'battle') break;
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

      if (enemy.x > 5) {
        const entryBlocker = buildingAt(this.state.buildings, 5, Math.round(enemy.y));
        if (entryBlocker && BUILDING_BY_ID[entryBlocker.cardId].solid && !entryBlocker.destroyed) {
          if (enemy.attackTimer <= 0) {
            const started = this.startEntityAttack(enemy, () => {
              if (!entryBlocker.destroyed) this.damageBuilding(entryBlocker, card.damage);
            });
            if (started) enemy.attackTimer = card.attackIntervalSeconds;
          }
          continue;
        }
        this.moveEnemyToward(enemy, { x: 5, y: Math.round(enemy.y) }, dt, card.speed);
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
        enemy.path = routeFor(this.state.buildings, current, lure ? { x: lure.x, y: lure.y } : null);
        enemy.routeTimer = 0.55;
        enemy.routeGoal = lure?.uid || null;
      }

      const next = enemy.path?.[1];
      if (!next) continue;
      if (next.x < 0) {
        if (enemy.attackTimer <= 0) {
          const started = this.startEntityAttack(enemy, () => {
            if (this.state.coreHp > 0) this.damageCore(card.damage);
          });
          if (started) enemy.attackTimer = card.attackIntervalSeconds;
        }
        continue;
      }

      const blocker = buildingAt(this.state.buildings, next.x, next.y);
      if (blocker && BUILDING_BY_ID[blocker.cardId].solid && !blocker.destroyed) {
        if (blocker.cardId === 'building-bouncy-fence' && blocker.fenceTrigger > 0) {
          blocker.fenceTrigger -= 1;
          this.pushEnemy(enemy, BUILDING_BY_ID[blocker.cardId].effect.knockbackTiles, 0, BUILDING_BY_ID[blocker.cardId].effect);
          enemy.routeTimer = 0;
          this.spawnParticles(this.cellCenter(next.x, next.y).x, this.cellCenter(next.x, next.y).y, '#EAB653', 10, 65);
          continue;
        }
        if (enemy.attackTimer <= 0) {
          const started = this.startEntityAttack(enemy, () => {
            if (!blocker.destroyed) this.damageBuilding(blocker, card.damage);
          });
          if (started) enemy.attackTimer = card.attackIntervalSeconds;
        }
        continue;
      }

      const defender = this.state.survivors.find((survivor) => !survivor.downed && survivor.x === next.x && survivor.y === next.y);
      if (defender && (SURVIVOR_BY_ID[defender.cardId].blockCount > 0 || Math.abs(enemy.x - next.x) < 0.7)) {
        if (enemy.attackTimer <= 0) {
          const started = this.startEntityAttack(enemy, () => {
            if (!defender.downed) this.damageSurvivor(defender, card.damage);
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
        const target = this.state.buildings.find((building) => building.uid === enemy.telegraphTarget && !building.destroyed);
        if (target) {
          this.launchProjectile(enemy, target, 'acid');
          target.poisoned = Math.max(target.poisoned || 0, 1.2);
          this.damageBuilding(target, card.ability.buildingDamage);
          for (const other of this.state.buildings) {
            if (other.uid !== target.uid && !other.destroyed && distance(other, target) <= card.ability.splashRadiusTiles) {
              other.poisoned = Math.max(other.poisoned || 0, 0.8);
              this.damageBuilding(other, Math.round(card.ability.buildingDamage * 0.45));
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
      const candidates = this.state.buildings.filter((building) => !building.destroyed);
      const target = candidates.sort((a, b) => distance(enemy, a) - distance(enemy, b))[0];
      if (target) {
        enemy.telegraph = card.ability.telegraphSeconds;
        enemy.telegraphTarget = target.uid;
        this.showToast('蜗王正在蓄力！用击退制造失衡可打断', 'danger', 2.4);
        this.audio.play('warning');
      }
    }
  }

  findTargetsForAttack(attacker, attack) {
    if (attack.targetRule === 'first-in-lane') return this.findLaneTargets(attacker, attack.rangeTiles);
    return this.state.enemies
      .filter((enemy) => !enemy.dead && distance(attacker, enemy) <= attack.rangeTiles && enemy.x >= attacker.x - 0.7)
      .sort((a, b) => a.x - b.x || distance(attacker, a) - distance(attacker, b));
  }

  findLaneTargets(attacker, rangeTiles) {
    return this.state.enemies
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
    const building = buildingAt(this.state.buildings, cell.x, cell.y);
    if (building?.cardId === 'building-honey-plot') multiplier *= BUILDING_BY_ID[building.cardId].effect.speedMultiplier;
    if (this.state.terrain.some((terrain) => terrain.type === 'honey' && terrain.x === cell.x && terrain.y === cell.y)) multiplier *= 0.55;
    return multiplier;
  }

  findLureForEnemy(enemy) {
    return this.state.deployables.find((item) => item.type === 'lure' && !item.consumed && distance(enemy, item) <= item.range);
  }

  moveEnemyToward(enemy, target, dt, speed) {
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
      this.damageSurvivor(contact, Math.max(1, Math.round(ENEMY_BY_ID[enemy.cardId].damage * 0.65)));
    }
    enemy.justPushed = false;
  }

  damageEnemy(enemy, amount, source) {
    if (enemy.dead) return;
    const multiplier = enemy.marked ? 1.15 : 1;
    const damage = Math.round(amount * multiplier);
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
    } else if (!this.pendingAttackHits.has(enemy.uid)) {
      this.playEntityAnimation(enemy, 'hurt');
      this.shake = Math.max(this.shake, 0.08);
    }
  }

  damageBuilding(building, amount) {
    this.damageFriendly(building, amount, 'building');
  }

  damageSurvivor(survivor, amount) {
    survivor.hitFlash = 1;
    this.damageFriendly(survivor, amount, 'survivor');
  }

  damageFriendly(target, amount, kind) {
    let damage = amount;
    if ((target.shield || 0) > 0) {
      const absorbed = Math.min(target.shield, damage);
      target.shield -= absorbed;
      damage -= absorbed;
      if (target.shield <= 0 && kind === 'survivor' && target.cardId === 'survivor-shell-shell') {
        const nearby = this.state.enemies.find((enemy) => !enemy.dead && distance(enemy, target) <= 1.2);
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
      this.spawnDynamicEffect('enemy-pop', position.x, position.y - 26, {
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
    this.floatText(118, 340, `-${amount}`, PALETTE.danger);
    this.audio.play('hit');
    if (this.state.coreHp <= 0) this.finishDefense(false);
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
    enemy.x = clamp(enemy.x + dx, 0, 6.25);
    enemy.y = clamp(enemy.y + dy, 0, 5);
    enemy.path = [];
    enemy.routeTimer = 0;
    enemy.justPushed = true;
    enemy.bubbleStatus = Math.max(enemy.bubbleStatus || 0, 0.55);
    const position = this.entityCanvasPosition(enemy);
    const collision = this.state.enemies.find((other) => other.uid !== enemy.uid && !other.dead && distance(enemy, other) < 0.38);
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
        dx: (enemy.x - old.x) * BOARD.cell,
        dy: (enemy.y - old.y) * BOARD.cell,
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
      x: clamp(Math.round(entity.x), 0, BOARD.cols - 1),
      y: clamp(Math.round(entity.y), 0, BOARD.rows - 1),
    };
  }

  cellCenter(x, y) {
    return {
      x: BOARD.x + (x + 0.5) * BOARD.cell,
      y: BOARD.y + (y + 0.5) * BOARD.cell,
    };
  }

  entityCanvasPosition(entity) {
    const buildingCard = BUILDING_BY_ID[entity?.cardId];
    if (buildingCard) {
      const shape = rotatedFootprint(buildingCard, entity.rotation);
      return {
        x: BOARD.x + (entity.x + shape.width / 2) * BOARD.cell,
        y: BOARD.y + (entity.y + shape.height) * BOARD.cell - 15,
      };
    }
    return {
      x: BOARD.x + (entity.x + 0.5) * BOARD.cell,
      y: BOARD.y + (entity.y + 0.78) * BOARD.cell,
    };
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
        if (buildingAt(this.state.buildings, cell.x, cell.y) && BUILDING_BY_ID[buildingAt(this.state.buildings, cell.x, cell.y).cardId].solid) {
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
          dx: dx * BOARD.cell * 2.45,
          dy: dy * BOARD.cell * 2.45,
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
      const building = buildingAt(this.state.buildings, cell.x, cell.y);
      const target = survivor || (building && !building.destroyed ? building : null);
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
      const obstacle = buildingAt(this.state.buildings, cell.x, cell.y);
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
        const building = buildingAt(this.state.buildings, cell.x, cell.y);
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
        source.x = cell.x;
        source.y = cell.y;
      } else {
        const source = this.state.buildings.find((target) => target.uid === selection.sourceUid);
        const sourceCard = BUILDING_BY_ID[source.cardId];
        if (this.state.enemies.some((enemy) => !enemy.dead && Math.abs(enemy.x - cell.x) < 0.6 && Math.abs(enemy.y - cell.y) < 0.6)) {
          this.showToast('不能把建筑搬到敌人脚下', 'danger');
          return;
        }
        if (!canPlace(this.state.buildings, sourceCard, cell.x, cell.y, source.rotation, source.uid)) {
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
    ctx.fillStyle = PALETTE.mist;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    if (this.shake > 0) ctx.translate(
      Math.sin(this.animationTime * 72) * this.shake * 5,
      Math.cos(this.animationTime * 59) * this.shake * 3,
    );
    this.hits = [];
    this.drawBackground(ctx);
    this.drawBattlefield(ctx);
    this.drawForeground(ctx);
    this.drawTopHud(ctx);
    this.drawSidePanel(ctx);
    this.drawBottomBar(ctx);
    this.drawTransientUi(ctx);
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
    drawRoundedRect(ctx, BOARD.x - 20, BOARD.y - 18, BOARD.cell * 6 + 40, BOARD.cell * 6 + 36, {
      radius: 28,
      fill: 'rgba(255,248,233,0.78)',
      stroke: 'rgba(51,71,80,0.18)',
      lineWidth: 3,
    });

    for (let row = 0; row < BOARD.rows; row += 1) {
      for (let col = 0; col < BOARD.cols; col += 1) {
        const x = BOARD.x + col * BOARD.cell;
        const y = BOARD.y + row * BOARD.cell;
        const alpha = this.state.phase === 'battle' ? 0.7 : 1;
        drawAssetOrFallback(
          ctx,
          this.assetStore,
          (row + col) % 2 ? 'tile-build-dark' : 'tile-build-light',
          (asset) => {
            ctx.globalAlpha *= alpha;
            ctx.drawImage(asset, x + 3, y + 3, BOARD.cell - 6, BOARD.cell - 6);
          },
          () => drawRoundedRect(ctx, x + 3, y + 3, BOARD.cell - 6, BOARD.cell - 6, {
            radius: 14,
            fill: (row + col) % 2
              ? `rgba(223,204,162,${alpha})`
              : `rgba(235,221,187,${alpha})`,
            stroke: this.state.phase === 'battle'
              ? 'rgba(51,71,80,0.06)'
              : 'rgba(51,71,80,0.13)',
            lineWidth: 2,
          }),
        );
      }
    }

    const corePosition = { x: 116, y: BOARD.y + BOARD.cell * 3.55 };
    const portalPosition = { x: BOARD.x + BOARD.cell * 6 + 91, y: BOARD.y + BOARD.cell * 3.62 };

    this.drawRoutes(ctx);
    this.drawTerrain(ctx);
    drawCore(ctx, corePosition.x, corePosition.y, 118, {
      assetStore: this.assetStore,
      time: this.time,
      health: this.state.coreHp / this.state.coreMaxHp,
      danger: this.state.coreHp / this.state.coreMaxHp < 0.35,
    });
    drawPortal(ctx, portalPosition.x, portalPosition.y, 138, {
      assetStore: this.assetStore,
      time: this.time,
      open: this.state.phase === 'battle' ? 1 : 0.62,
    });
    this.drawWorldEffects(ctx, 'back');
    this.drawDynamicEffects(ctx, 'back');
    this.drawMovingBubblePreview(ctx);
    this.drawWorldActors(ctx);
    this.drawDynamicEffects(ctx, 'front');
    this.drawWorldEffects(ctx, 'front');
    this.drawProjectilesAndParticles(ctx);
    this.drawSelectionOverlay(ctx);

    ctx.save();
    ctx.font = '700 15px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.inkSoft;
    ctx.fillText('软核', corePosition.x, BOARD.y + BOARD.cell * 5.93);
    ctx.fillText('裂隙入口', portalPosition.x, BOARD.y + BOARD.cell * 5.93);
    ctx.restore();
  }

  drawRoutes(ctx) {
    if (this.state.phase === 'battle' && !this.state.paused) return;
    const routeWaveIndex = this.state.phase === 'between' ? this.state.waveIndex + 1 : this.state.waveIndex;
    const wave = WAVES[Math.min(routeWaveIndex, WAVES.length - 1)];
    const rows = [...new Set(wave.groups.flatMap((group) => group.rowIndices))].slice(0, 4);
    rows.forEach((row, routeIndex) => {
      const path = routeFor(this.state.buildings, { x: 5, y: row });
      const crossesBuilding = path.some((cell) => cell.x >= 0 && BUILDING_BY_ID[buildingAt(this.state.buildings, cell.x, cell.y)?.cardId]?.solid);
      const alpha = (crossesBuilding ? 0.48 : 0.45) - routeIndex * 0.05;
      const points = [
        { x: BOARD.x + BOARD.cell * 6 + 48, y: this.cellCenter(0, row).y },
        ...path.map((cell) => (cell.x < 0
          ? { x: BOARD.x - 48, y: this.cellCenter(0, cell.y).y }
          : this.cellCenter(cell.x, cell.y))),
      ];
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
            ctx.drawImage(asset, -length / 2 - 1, -9, length + 2, 18);
          },
          () => {
            ctx.globalAlpha *= alpha;
            ctx.strokeStyle = crossesBuilding ? '#E45F68' : '#43A073';
            ctx.lineWidth = 5;
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
    for (const terrain of this.state.terrain) {
      const position = this.cellCenter(terrain.x, terrain.y);
      if (terrain.type === 'honey') {
        drawAssetOrFallback(ctx, this.assetStore, 'tile-honey-puddle', (asset) => {
          ctx.globalAlpha *= 0.82;
          ctx.drawImage(asset, position.x - 34, position.y - 24, 68, 68);
        }, () => {
          ctx.globalAlpha = 0.72;
          ctx.fillStyle = '#E9B84F';
          ctx.strokeStyle = '#AF7C28';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(position.x, position.y + 17, 29, 18, -0.1, 0, TAU);
          ctx.ellipse(position.x - 18, position.y + 9, 12, 9, 0.3, 0, TAU);
          ctx.fill();
          ctx.stroke();
        });
        drawStatusIcon(ctx, position.x + 25, position.y - 23, 22, 'sticky', {
          assetStore: this.assetStore,
          time: this.time,
          shadow: false,
        });
      } else if (terrain.type === 'crystal') {
        drawAssetOrFallback(ctx, this.assetStore, 'tile-crystal-spikes', (asset) => {
          ctx.drawImage(asset, position.x - 30, position.y - 30, 60, 60);
        }, () => {
          ctx.translate(position.x, position.y + 22);
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
    drawAssetOrFallback(ctx, this.assetStore, 'item-moving-bubble-world', (asset) => {
      ctx.globalAlpha *= 0.9;
      ctx.drawImage(asset, position.x - 56, position.y - 106, 112, 112);
    }, () => {});
  }

  drawWorldActors(ctx) {
    const actors = [];
    for (const building of this.state.buildings) {
      const card = BUILDING_BY_ID[building.cardId];
      const shape = rotatedFootprint(card, building.rotation);
      // Match the building's visible ground contact (centerY is 15px above the
      // footprint edge). Equal-depth units then paint after the structure, so a
      // survivor stationed inside a home remains visible instead of vanishing behind it.
      actors.push({
        kind: 'building',
        entity: building,
        depth: building.y + shape.height - 0.22,
        rank: 0,
      });
    }
    for (const item of this.state.deployables) {
      actors.push({ kind: 'deployable', entity: item, depth: item.y + 0.72, rank: 1 });
    }
    for (const survivor of this.state.survivors) {
      actors.push({ kind: 'survivor', entity: survivor, depth: survivor.y + 0.78, rank: 2 });
    }
    for (const enemy of this.state.enemies) {
      actors.push({ kind: 'enemy', entity: enemy, depth: enemy.y + 0.78, rank: 2 });
    }
    actors.sort((left, right) => (
      left.depth - right.depth
      || left.rank - right.rank
      || (left.entity.x || 0) - (right.entity.x || 0)
    ));
    for (const actor of actors) {
      if (actor.kind === 'building') this.drawBuildings(ctx, [actor.entity]);
      else if (actor.kind === 'deployable') this.drawDeployables(ctx, [actor.entity]);
      else this.drawUnits(ctx, [actor]);
    }
  }

  drawBuildings(ctx, buildings = this.state.buildings) {
    const sorted = [...buildings].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const building of sorted) {
      if (building.destroyed && this.state.phase === 'battle') {
        const position = this.entityCanvasPosition(building);
        drawAssetOrFallback(ctx, this.assetStore, 'tile-building-rubble', (asset) => {
          ctx.globalAlpha *= 0.72;
          ctx.drawImage(asset, position.x - 34, position.y - 39, 68, 68);
        }, () => {
          ctx.globalAlpha = 0.38;
          ctx.fillStyle = '#756B67';
          ctx.beginPath();
          ctx.ellipse(position.x, position.y - 5, 30, 13, 0, 0, TAU);
          ctx.fill();
        });
        continue;
      }
      const card = BUILDING_BY_ID[building.cardId];
      const { x: centerX, y: centerY } = this.entityCanvasPosition(building);
      const selected = this.selection?.uid === building.uid;
      const placeProgress = clamp((this.time - building.placedAt) / 0.24, 0, 1);
      const scale = building.placedAt > 0 ? easeOutBack(placeProgress) : 1;
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.scale(scale, scale);
      drawBuilding(ctx, 0, 0, card.footprint.width > 1 ? 104 : 88, BUILDING_VARIANT[card.id], {
        assetStore: this.assetStore,
        time: this.time,
        selected,
        active: this.state.phase === 'battle',
        damage: 1 - building.hp / building.maxHp,
        disabled: building.destroyed,
      });
      ctx.restore();
      if (this.state.phase === 'battle' && !building.destroyed) {
        this.drawHealthBar(ctx, centerX, centerY - 96, 54, building.hp / building.maxHp, building.shield > 0);
        let statusX = centerX + 34;
        if (building.shield > 0) {
          drawStatusIcon(ctx, statusX, centerY - 84, 22, 'shield', {
            assetStore: this.assetStore, time: this.time, shadow: false,
          });
          statusX += 22;
        }
        if (building.poisoned > 0) {
          drawStatusIcon(ctx, statusX, centerY - 84, 22, 'poison', {
            assetStore: this.assetStore, time: this.time, shadow: false,
          });
        }
      }
    }
  }

  drawDeployables(ctx, deployables = this.state.deployables) {
    for (const item of deployables) {
      const position = this.cellCenter(item.x, item.y);
      if (item.type === 'pad') {
        drawAssetOrFallback(ctx, this.assetStore, 'item-spring-pad-world', (asset) => {
          ctx.translate(position.x, position.y + 14);
          ctx.rotate(Math.atan2(item.dy, item.dx));
          ctx.drawImage(asset, -28, -28, 56, 56);
        }, () => {
          ctx.translate(position.x, position.y + 14);
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
          ctx.translate(position.x, position.y + 10);
          ctx.scale(1 - wobble * 0.006, 1 + wobble * 0.006);
          ctx.drawImage(asset, -25, -40, 50, 50);
        }, () => {
          ctx.translate(position.x, position.y + 10);
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
    const units = providedUnits ? [...providedUnits] : [];
    if (!providedUnits) {
      this.state.survivors.forEach((survivor) => units.push({ kind: 'survivor', entity: survivor, depth: survivor.y + 0.15 }));
      this.state.enemies.forEach((enemy) => units.push({ kind: 'enemy', entity: enemy, depth: enemy.y + 0.5 }));
    }
    units.sort((a, b) => a.depth - b.depth);
    for (const unit of units) {
      if (unit.kind === 'survivor') {
        const survivor = unit.entity;
        const position = this.entityCanvasPosition(survivor);
        // The sprout's tall leaves share the row above; a small grounded offset
        // keeps them visually separate from a crystal defender in that row.
        if (survivor.cardId === 'survivor-moss-sprout') position.y += 7;
        const selected = this.selection?.uid === survivor.uid || this.selection?.firstUid === survivor.uid || this.selection?.sourceUid === survivor.uid;
        drawSlime(ctx, position.x, position.y, 68, SURVIVOR_VARIANT[survivor.cardId], {
          assetStore: this.assetStore,
          time: this.time,
          pose: this.entityAnimationPose(survivor),
          expressionSample: this.entityExpressionSample(survivor),
          rigAsset: this.rigAssetFor(survivor.cardId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
          selected,
          disabled: survivor.downed,
          hit: survivor.hitFlash,
          shield: clamp((survivor.shield || 0) / 90, 0, 1),
          phase: survivor.x * 0.7 + survivor.y,
        });
        if (!survivor.downed) this.drawHealthBar(ctx, position.x, position.y - 75, 48, survivor.hp / survivor.maxHp, survivor.shield > 0);
        let statusX = position.x + 28;
        if (survivor.shield > 0) {
          drawStatusIcon(ctx, statusX, position.y - 64, 22, 'shield', {
            assetStore: this.assetStore, time: this.time, shadow: false,
          });
          statusX += 22;
        }
        if (survivor.seed > 0) drawStatusIcon(ctx, statusX, position.y - 64, 22, 'heal', {
          assetStore: this.assetStore, time: this.time, shadow: false,
        });
      } else {
        const enemy = unit.entity;
        const deathElapsed = enemy.deathElapsed || 0;
        const deathDuration = this.enemyDeathDuration(enemy);
        if (enemy.dead && deathElapsed >= deathDuration) continue;
        const position = this.entityCanvasPosition(enemy);
        const card = ENEMY_BY_ID[enemy.cardId];
        const alpha = enemy.dead ? clamp(1 - deathElapsed / deathDuration, 0, 1) : 1;
        drawMonster(ctx, position.x, position.y, card.elite ? 100 : 62, ENEMY_VARIANT[enemy.cardId], {
          assetStore: this.assetStore,
          time: this.time,
          pose: this.entityAnimationPose(enemy),
          expressionSample: this.entityExpressionSample(enemy),
          rigAsset: this.rigAssetFor(enemy.cardId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
          alpha,
          hit: enemy.hitFlash,
          targeted: enemy.marked,
          phase: Number(enemy.uid.split('-').pop()) * 0.4,
        });
        if (!enemy.dead) this.drawHealthBar(ctx, position.x, position.y - (card.elite ? 112 : 68), card.elite ? 82 : 46, enemy.hp / enemy.maxHp, false, true);
        let iconX = position.x + 27;
        if (enemy.marked) {
          drawStatusIcon(ctx, iconX, position.y - 60, 22, 'marked', {
            assetStore: this.assetStore, time: this.time, shadow: false,
          });
          iconX += 22;
        }
        if (enemy.stagger > 0) drawStatusIcon(ctx, iconX, position.y - 60, 22, 'stun', {
          assetStore: this.assetStore, time: this.time, shadow: false,
        });
        if (enemy.stagger > 0) iconX += 22;
        if (enemy.rooted > 0) {
          drawStatusIcon(ctx, iconX, position.y - 60, 22, 'slow', {
            assetStore: this.assetStore, time: this.time, shadow: false,
          });
          iconX += 22;
        }
        if (enemy.bubbleStatus > 0) drawStatusIcon(ctx, iconX, position.y - 60, 22, 'bubble', {
          assetStore: this.assetStore, time: this.time, shadow: false,
        });
        if (enemy.telegraph > 0) {
          const telegraphProgress = 1 - enemy.telegraph
            / ENEMY_BY_ID[enemy.cardId].ability.telegraphSeconds;
          drawAssetOrFallback(ctx, this.assetStore, 'effect-boss-acid-telegraph', (asset) => {
            ctx.globalAlpha *= 0.6 + Math.sin(this.time * 10) * 0.25;
            ctx.translate(position.x, position.y - 48);
            if (typeof ctx.clip === 'function') {
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.arc(0, 0, 54, -Math.PI / 2, -Math.PI / 2 + TAU * telegraphProgress);
              ctx.closePath();
              ctx.clip();
            }
            ctx.drawImage(asset, -51, -51, 102, 102);
          }, () => {
            ctx.strokeStyle = PALETTE.danger;
            ctx.lineWidth = 4;
            ctx.globalAlpha = 0.6 + Math.sin(this.time * 10) * 0.25;
            ctx.beginPath();
            ctx.arc(
              position.x,
              position.y - 48,
              51,
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

  drawDynamicEffects(ctx, layer) {
    for (const effect of this.state.dynamicEffects || []) {
      if (effect.layer !== layer) continue;
      const progress = clamp(1 - effect.life / effect.maxLife, 0, 1);
      ctx.save();
      ctx.translate(effect.x, effect.y);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (effect.kind === 'impact') this.drawDynamicImpact(ctx, effect, progress);
      else if (effect.kind === 'push') this.drawDynamicPush(ctx, effect, progress);
      else if (effect.kind === 'enemy-pop') this.drawDynamicEnemyPop(ctx, effect, progress);
      else if (effect.kind === 'heal') this.drawDynamicHeal(ctx, effect, progress);
      else if (effect.kind === 'spawn') this.drawDynamicSpawn(ctx, effect, progress);
      else if (effect.kind === 'trail') this.drawDynamicTrail(ctx, effect, progress);
      else if (effect.kind === 'swap') this.drawDynamicSwap(ctx, effect, progress);
      else if (effect.kind === 'wave-clear') this.drawDynamicWaveClear(ctx, effect, progress);
      else this.drawDynamicPlace(ctx, effect, progress);
      ctx.restore();
    }
  }

  drawDynamicImpact(ctx, effect, progress) {
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

    ctx.save();
    ctx.globalAlpha *= fade * 0.9;
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = Math.max(2, 5 * intensity * (1 - progress * 0.7));
    ctx.beginPath();
    ctx.ellipse(0, 0, (8 + burst * 45) * intensity, (5 + burst * 26) * intensity, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

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
    }
  }

  drawDynamicPush(ctx, effect, progress) {
    const length = Math.max(1, Math.hypot(effect.dx, effect.dy));
    const nx = effect.dx / length;
    const ny = effect.dy / length;
    const px = -ny;
    const py = nx;
    const travel = easeOutBack(effectPhase(progress, 0, 0.82));
    const fade = 1 - effectPhase(progress, 0.62, 1);

    for (let index = 0; index < 3; index += 1) {
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

    for (let index = 0; index < 5; index += 1) {
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
  }

  drawDynamicEnemyPop(ctx, effect, progress) {
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
    }

    ctx.save();
    ctx.globalAlpha *= fade * 0.9;
    ctx.strokeStyle = effect.accent;
    ctx.lineWidth = 5 * effect.intensity * (1 - explode * 0.72);
    ctx.beginPath();
    ctx.ellipse(0, 0, (8 + easeOutCubic(explode) * 54) * effect.intensity, (5 + easeOutCubic(explode) * 33) * effect.intensity, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

    const dropletCount = effect.intensity > 1.4 ? 12 : 8;
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
    }

    for (let index = 0; index < 5; index += 1) {
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
    }
  }

  drawDynamicHeal(ctx, effect, progress) {
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
    }
  }

  drawDynamicSpawn(ctx, effect, progress) {
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
    }
  }

  drawDynamicTrail(ctx, effect, progress) {
    const grow = easeOutCubic(effectPhase(progress, 0, 0.68));
    const fade = 1 - effectPhase(progress, 0.62, 1);
    const length = Math.max(1, Math.hypot(effect.dx, effect.dy));
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
    }
  }

  drawDynamicSwap(ctx, effect, progress) {
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
  }

  drawDynamicPlace(ctx, effect, progress) {
    const bounce = easeOutBack(effectPhase(progress, 0, 0.72));
    const fade = 1 - effectPhase(progress, 0.62, 1);
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
    }
  }

  drawDynamicWaveClear(ctx, effect, progress) {
    const expand = easeOutCubic(progress);
    const fade = 1 - effectPhase(progress, 0.56, 1);
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
        && this.shapingUsed() + card.cost <= SHAPING_BUDGET
        && canPlace(this.state.buildings, card, cell.x, cell.y, selection.rotation);
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
        );
    }
    if (selection.kind === 'place-survivor' || selection.kind === 'move-survivor') {
      const survivor = selection.uid
        ? this.state.survivors.find((item) => item.uid === selection.uid)
        : this.state.survivors.find((item) => item.cardId === selection.cardId);
      return Boolean(survivor)
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
        const obstacle = buildingAt(this.state.buildings, cell.x, cell.y);
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
      const building = buildingAt(this.state.buildings, cell.x, cell.y);
      return survivor || Boolean(building && !building.destroyed);
    }
    if (card.id === 'item-lure-jelly') {
      const obstacle = buildingAt(this.state.buildings, cell.x, cell.y);
      return !obstacle || !BUILDING_BY_ID[obstacle.cardId].solid;
    }
    if (card.id === 'item-moving-bubble') {
      if (selection.step === 0) {
        const survivor = this.state.survivors.some((item) => (
          !item.downed && item.x === cell.x && item.y === cell.y
        ));
        const building = buildingAt(this.state.buildings, cell.x, cell.y);
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
      const building = this.state.buildings.find((item) => item.uid === selection.sourceUid);
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
        );
    }
    return true;
  }

  drawSelectionOverlay(ctx) {
    const selection = this.selection;
    if (!selection) return;
    const drawCellOverlay = (cell, valid, alpha = 0.8) => {
      if (!cell) return;
      const x = BOARD.x + cell.x * BOARD.cell + 5;
      const y = BOARD.y + cell.y * BOARD.cell + 5;
      drawAssetOrFallback(
        ctx,
        this.assetStore,
        valid ? 'tile-placement-valid' : 'tile-placement-invalid',
        (asset) => {
          ctx.globalAlpha *= alpha;
          ctx.drawImage(asset, x, y, BOARD.cell - 10, BOARD.cell - 10);
        },
        () => drawRoundedRect(ctx, x, y, BOARD.cell - 10, BOARD.cell - 10, {
          radius: 13,
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
      for (const cell of footprintCells(
        card,
        this.hoverCell.x,
        this.hoverCell.y,
        rotation,
      )) {
        if (inBoard(cell.x, cell.y)) drawCellOverlay(cell, valid);
      }
      const shape = rotatedFootprint(card, rotation);
      const centerX = BOARD.x + (this.hoverCell.x + shape.width / 2) * BOARD.cell;
      const centerY = BOARD.y + (this.hoverCell.y + shape.height) * BOARD.cell - 15;
      drawBuilding(
        ctx,
        centerX,
        centerY,
        card.footprint.width > 1 ? 104 : 88,
        BUILDING_VARIANT[card.id],
        {
          assetStore: this.assetStore,
          time: this.time,
          ghost: true,
          valid,
        },
      );
      return true;
    };
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
      ctx.strokeRect(BOARD.x + 3, BOARD.y + 3, BOARD.cell * 6 - 6, BOARD.cell * 6 - 6);
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

  drawTopHud(ctx) {
    drawRoundedRect(ctx, 20, 16, 1240, 64, {
      radius: 22,
      fill: 'rgba(255,248,233,0.93)',
      stroke: 'rgba(51,71,80,0.2)',
      lineWidth: 2,
    });

    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '800 17px "PingFang SC", sans-serif';
    ctx.fillText('软核耐久', 42, 42);
    ctx.font = '800 14px "PingFang SC", sans-serif';
    ctx.fillStyle = this.state.coreHp / this.state.coreMaxHp < 0.35 ? PALETTE.danger : PALETTE.textMuted;
    ctx.fillText(`${Math.ceil(this.state.coreHp)} / ${this.state.coreMaxHp}`, 42, 64);
    this.drawHealthBar(ctx, 243, 41, 142, this.state.coreHp / this.state.coreMaxHp, false, false);

    const phaseText = {
      build: '自由建造', intel: '敌情预览', battle: this.state.paused ? '战斗暂停' : '防守进行中',
      between: '波次间整备', result: '防守结算',
    }[this.state.phase];
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 22px "PingFang SC", sans-serif';
    ctx.fillText(phaseText, 625, 45);
    ctx.font = '600 14px "PingFang SC", sans-serif';
    ctx.fillStyle = PALETTE.textMuted;
    const subtitle = this.state.phase === 'battle' || this.state.phase === 'between'
      ? `第 ${this.state.waveIndex + 1} / ${WAVES.length} 波 · ${WAVES[this.state.waveIndex].name}`
      : '果冻庭院 · 没有倒计时';
    ctx.fillText(subtitle, 625, 66);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#4E7E8A';
    ctx.font = '800 16px "PingFang SC", sans-serif';
    drawAssetOrFallback(ctx, this.assetStore, 'ui-soft-crystal', (asset) => {
      ctx.drawImage(asset, 1000, 25, 24, 24);
      ctx.fillText('软晶', 1028, 42);
    }, () => ctx.fillText('◆ 软晶', 1004, 42));
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 20px "PingFang SC", sans-serif';
    ctx.fillText(`${this.state.softCrystals}`, 1078, 43);
    ctx.restore();

    this.drawButton(ctx, 'audio-toggle', { x: 1184, y: 26, w: 54, h: 42 }, this.audio.enabled ? '声' : '静', {
      compact: true,
      secondary: true,
      iconAssetKey: this.audio.enabled ? 'ui-audio-on' : 'ui-audio-off',
      title: this.audio.enabled ? '关闭音效' : '开启音效',
    }, () => { this.audio.enabled = !this.audio.enabled; });
  }

  drawSidePanel(ctx) {
    drawRoundedRect(ctx, PANEL.x, PANEL.y, PANEL.width, PANEL.height, {
      radius: 28,
      fill: 'rgba(255,248,233,0.96)',
      stroke: 'rgba(51,71,80,0.22)',
      lineWidth: 3,
    });
    if (this.state.phase === 'battle') this.drawBattleSide(ctx);
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
    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 24px "PingFang SC", sans-serif';
    ctx.fillText(this.state.phase === 'between' ? '慢慢整备' : (card ? card.name : '你的果冻庭院'), PANEL.x + 28, PANEL.y + 42);

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
        ? `${rotatedFootprint(card, displayedRotation).width}×${rotatedFootprint(card, displayedRotation).height} · 定形值 ${card.cost}`
        : `驻守单位 · 生命 ${card.hp}`;
      ctx.fillText(meta, PANEL.x + 122, PANEL.y + 84);
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '600 17px "PingFang SC", sans-serif';
      wrapText(ctx, card.description, PANEL.x + 122, PANEL.y + 111, 228, 24, 3);

      const actionY = PANEL.y + 248;
      if (this.selection.kind === 'inspect-building') {
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
      } else if (this.selection.kind === 'inspect-survivor') {
        this.drawButton(ctx, 'move-survivor', { x: PANEL.x + 26, y: actionY, w: 158, h: 48 }, '更换驻守位', { secondary: true }, () => {
          this.selection = { kind: 'move-survivor', uid: this.selection.uid };
          this.showToast('选择新的驻守位置');
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
    } else {
      ctx.fillStyle = PALETTE.textMuted;
      ctx.font = '600 17px "PingFang SC", sans-serif';
      wrapText(ctx, '自由移动、旋转和收回建筑，不花软晶，也没有等待时间。绿色虚线是开放路线，红色虚线表示怪物会破坏建筑开路。', PANEL.x + 28, PANEL.y + 82, 330, 27, 5);

      drawRoundedRect(ctx, PANEL.x + 26, PANEL.y + 222, 336, 96, {
        radius: 20, fill: '#EDF7E9', stroke: '#8DBA8A', lineWidth: 2,
      });
      ctx.fillStyle = '#3C745E';
      ctx.font = '800 17px "PingFang SC", sans-serif';
      ctx.fillText('本版推荐组合', PANEL.x + 44, PANEL.y + 250);
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.font = '600 15px "PingFang SC", sans-serif';
      ctx.fillText('围栏改道 → 水塔击退 → 菜圃减速', PANEL.x + 44, PANEL.y + 278);
      ctx.fillText('亮钉晶刺 → 浮浮把敌人撞回晶刺', PANEL.x + 44, PANEL.y + 302);
    }
    ctx.restore();

    const used = this.shapingUsed();
    ctx.save();
    ctx.font = '800 15px "PingFang SC", sans-serif';
    ctx.fillStyle = PALETTE.textMuted;
    ctx.fillText(`定形值 ${used} / ${SHAPING_BUDGET}`, PANEL.x + 28, PANEL.y + 370);
    drawRoundedRect(ctx, PANEL.x + 28, PANEL.y + 382, 330, 10, { radius: 5, fill: '#D8D8C9' });
    drawRoundedRect(ctx, PANEL.x + 28, PANEL.y + 382, 330 * clamp(used / SHAPING_BUDGET, 0, 1), 10, {
      radius: 5, fill: used >= SHAPING_BUDGET ? '#E3A83C' : '#61D6A2',
    });
    ctx.restore();

    if (this.state.phase === 'between') {
      this.drawButton(ctx, 'next-wave', { x: PANEL.x + 26, y: PANEL.y + 414, w: 336, h: 54 }, `主动开启第 ${this.state.waveIndex + 2} 波`, {}, () => this.startWave(this.state.waveIndex + 1));
    } else {
      this.drawButton(ctx, 'open-intel', { x: PANEL.x + 26, y: PANEL.y + 414, w: 336, h: 54 }, '查看敌情', {}, () => this.openIntel());
    }
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
      ctx.fillText('准备好后由你亲自开启防守，没有倒计时。', VIEW.width / 2, BOTTOM.y + 63);
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
      this.drawMiniCard(ctx, `build-card-${card.id}`, { x, y: BOTTOM.y + 13, w: cardWidth, h: 84 }, card, {
        selected,
        meta: card.type === 'building' ? `${card.cost} 定形` : `${card.hp} 生命`,
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
    const glyphs = {
      'survivor-shell-shell': '盾', 'survivor-crystal-pin': '晶', 'survivor-bubble-float': '泡', 'survivor-moss-sprout': '芽',
      'skill-jelly-bounce': '弹', 'skill-honey-line': '胶', 'skill-soft-swap': '换', 'skill-sprout-renewal': '春',
      'item-spring-pad': '垫', 'item-lure-jelly': '诱', 'item-moving-bubble': '搬',
      'building-mushroom-home': '屋', 'building-honey-plot': '圃', 'building-bubble-tower': '塔',
      'building-bouncy-fence': '栏', 'building-weather-scout': '测',
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
    }, drawGlyph);
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
      }, drawGlyph);
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
    ctx.fillText(page === 0 ? '欢迎来到果冻庭院' : '这里没有时间压力', VIEW.width / 2, rect.y + 66);
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = '600 18px "PingFang SC", sans-serif';
    ctx.fillText(page === 0 ? '一座可以自由搭建、只在你准备好时才开战的小镇' : '暂停、思考、改布局，然后亲手开启下一波', VIEW.width / 2, rect.y + 101);
    ctx.restore();

    if (page === 0) {
      drawSlime(ctx, VIEW.width / 2 - 145, rect.y + 270, 112, 'shell', {
        time: this.time,
        phase: 0,
        rigAsset: this.rigAssetFor('survivor-shell-shell'),
      });
      drawSlime(ctx, VIEW.width / 2 - 48, rect.y + 274, 92, 'needle', {
        time: this.time,
        phase: 1,
        rigAsset: this.rigAssetFor('survivor-crystal-pin'),
      });
      drawSlime(ctx, VIEW.width / 2 + 50, rect.y + 274, 92, 'bubble', {
        time: this.time,
        phase: 2,
        rigAsset: this.rigAssetFor('survivor-bubble-float'),
      });
      drawSlime(ctx, VIEW.width / 2 + 145, rect.y + 272, 98, 'sprout', {
        time: this.time,
        phase: 3,
        rigAsset: this.rigAssetFor('survivor-moss-sprout'),
      });
      ctx.save();
      ctx.fillStyle = PALETTE.inkSoft;
      ctx.font = '700 17px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('一套能立即开玩的阵型已经替你摆好，也可以随意调整。', VIEW.width / 2, rect.y + 356);
      ctx.restore();
    } else {
      const tips = [
        ['建造', '移动、旋转、拆除都免费'],
        ['开战', '防守永远由你主动开启'],
        ['出牌', '点技能或道具会自动暂停'],
      ];
      tips.forEach((tip, index) => {
        const x = rect.x + 44 + index * 196;
        drawRoundedRect(ctx, x, rect.y + 151, 180, 174, {
          radius: 24, fill: index === 0 ? '#EDF7E9' : index === 1 ? '#EAF3F8' : '#F2EAF4',
          stroke: index === 0 ? '#8DBA8A' : index === 1 ? '#83AEC2' : '#B49AC0', lineWidth: 2,
        });
        ctx.save();
        ctx.fillStyle = PALETTE.ink;
        ctx.font = '900 24px "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${index + 1}`, x + 90, rect.y + 201);
        ctx.font = '900 19px "PingFang SC", sans-serif';
        ctx.fillText(tip[0], x + 90, rect.y + 243);
        ctx.fillStyle = PALETTE.textMuted;
        ctx.font = '600 14px "PingFang SC", sans-serif';
        wrapText(ctx, tip[1], x + 90, rect.y + 275, 142, 22, 3);
        ctx.restore();
      });
    }

    this.drawButton(ctx, 'welcome-next', { x: rect.x + 187, y: rect.y + 392, w: 286, h: 58 }, page === 0 ? '继续' : '开始布置', {}, () => {
      if (page === 0) this.modal.page = 1;
      else {
        this.state.tutorialSeen = true;
        this.modal = null;
        this.save();
        this.showToast('先看看现成阵型，准备好就查看敌情', 'good', 3);
      }
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
    ctx.fillText('侦察气象台已标出入口行；三波之间不会自动倒计时。', rect.x + 34, rect.y + 82);
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
    const rect = { x: 382, y: 208, w: 516, h: 304 };
    drawRoundedRect(ctx, rect.x, rect.y, rect.w, rect.h, {
      radius: 32, fill: '#FFF8E9', stroke: PALETTE.inkSoft, lineWidth: 4,
    });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 28px "PingFang SC", sans-serif';
    ctx.fillText('要安全撤回吗？', VIEW.width / 2, rect.y + 64);
    ctx.fillStyle = PALETTE.textMuted;
    ctx.font = '600 17px "PingFang SC", sans-serif';
    ctx.fillText('会回到开战前的庭院，不会永久损坏建筑。', VIEW.width / 2, rect.y + 104);
    ctx.fillText('本次尚未结算的软晶不会获得。', VIEW.width / 2, rect.y + 132);
    ctx.restore();
    this.drawButton(ctx, 'retreat-cancel', { x: rect.x + 34, y: rect.y + 206, w: 208, h: 58 }, '继续防守', { secondary: true }, () => { this.modal = null; });
    this.drawButton(ctx, 'retreat-confirm', { x: rect.x + 274, y: rect.y + 206, w: 208, h: 58 }, '确认撤回', { danger: true }, () => { this.modal = null; this.retreatToBuild(); });
  }

  drawResultModal(ctx) {
    this.drawModalShade(ctx);
    const result = this.state.result;
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
    ctx.save();
    ctx.fillStyle = '#4E7E8A';
    ctx.font = '800 18px "PingFang SC", sans-serif';
    ctx.fillText('◆ 本局获得', rect.x + 62, rect.y + 322);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 27px "PingFang SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`+${result.reward} 软晶`, rect.x + rect.w - 62, rect.y + 324);
    ctx.restore();

    this.drawButton(ctx, 'result-return', { x: rect.x + 170, y: rect.y + 400, w: 312, h: 60 }, '回到庭院重新布置', {}, () => this.returnToTown());
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
    if (selection?.kind === 'place-building') {
      const card = BUILDING_BY_ID[selection.cardId];
      const rotation = canonicalBuildingRotation(selection.rotation, card);
      if (this.shapingUsed() + card.cost > SHAPING_BUDGET) {
        this.showToast(`定形值不足，还需要 ${card.cost} 点`, 'danger');
        this.audio.play('warning');
        return;
      }
      if (!canPlace(this.state.buildings, card, cell.x, cell.y, rotation)) {
        this.showToast('这里放不下，换个位置试试', 'danger');
        return;
      }
      this.state.buildings.push({
        uid: uid('building'), cardId: card.id, x: cell.x, y: cell.y,
        rotation, hp: card.hp, maxHp: card.hp,
        cooldown: 0, shotCount: 0, shield: 0, seed: 0,
        fenceTrigger: 1, destroyed: false, placedAt: this.time,
      });
      const shape = rotatedFootprint(card, rotation);
      const effectPosition = {
        x: BOARD.x + (cell.x + shape.width / 2) * BOARD.cell,
        y: BOARD.y + (cell.y + shape.height) * BOARD.cell - 8,
      };
      this.spawnDynamicEffect('place', effectPosition.x, effectPosition.y - 2, {
        color: card.color,
        accent: '#FFF0C4',
        intensity: clamp(shape.width * 0.82, 0.9, 1.55),
      });
      this.audio.play('place');
      this.showToast(`${card.shortName}安顿好了`);
      this.save();
      return;
    }

    if (selection?.kind === 'move-building') {
      const building = this.state.buildings.find((item) => item.uid === selection.uid);
      if (!building) return;
      const card = BUILDING_BY_ID[building.cardId];
      const rotation = canonicalBuildingRotation(selection.rotation ?? building.rotation, card);
      if (!canPlace(this.state.buildings, card, cell.x, cell.y, rotation, building.uid)) {
        this.showToast('这个位置会和其他建筑重叠', 'danger');
        return;
      }
      building.x = cell.x;
      building.y = cell.y;
      building.rotation = rotation;
      building.placedAt = this.time;
      const shape = rotatedFootprint(card, rotation);
      const position = {
        x: BOARD.x + (cell.x + shape.width / 2) * BOARD.cell,
        y: BOARD.y + (cell.y + shape.height) * BOARD.cell - 8,
      };
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
      if (this.state.survivors.some((item) => item.uid !== survivor.uid && item.x === cell.x && item.y === cell.y)) {
        this.showToast('一个格子只能驻守一名幸存者', 'danger');
        return;
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
    this.selection = null;
  }

  selectBuildCard(card) {
    if (!this.isBuildPhase()) return;
    if (card.type === 'building') {
      this.selection = { kind: 'place-building', cardId: card.id, rotation: 0 };
      this.showToast(`选择格子放置${card.shortName}`);
    } else {
      const survivor = this.state.survivors.find((item) => item.cardId === card.id);
      this.selection = { kind: 'place-survivor', cardId: card.id, uid: survivor?.uid };
      this.showToast(`选择${card.shortName}的新驻守位置`);
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
    const [removed] = this.state.buildings.splice(index, 1);
    this.showToast(`${BUILDING_BY_ID[removed.cardId].shortName}已收回，定形值全部返还`);
    this.selection = null;
    this.save();
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
      const card = BUILDING_BY_ID[building.cardId];
      building.destroyed = false;
      building.hp = Math.max(building.hp, card.hp * 0.4);
      building.maxHp = card.hp;
      building.fenceTrigger = card.id === 'building-bouncy-fence' ? 1 : 0;
      building.cooldown = Math.random() * 0.35;
      building.shotCount = 0;
      if (card.id === 'building-mushroom-home') building.shield = card.effect.shieldPerWave;
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
      const home = buildingAt(this.state.buildings, survivor.x, survivor.y);
      if (home?.cardId === 'building-mushroom-home') survivor.shield += BUILDING_BY_ID[home.cardId].effect.shieldPerWave;
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
      BOARD.x + (BOARD.cols * BOARD.cell) / 2,
      BOARD.y + (BOARD.rows * BOARD.cell) / 2,
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
      buildingsLeft: this.state.buildings.filter((building) => !building.destroyed).length,
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
