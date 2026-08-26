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
} from './draw.js';
import {
  createGridState,
  canPlaceBuilding as coreCanPlaceBuilding,
  findGridPath,
  findRightToLeftRoute,
} from './core.js';
import { AnimationController } from './animation/controller.js';
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

function roundedHit(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

function rotatedFootprint(card, rotation = 0) {
  const turn = Math.abs(rotation / 90) % 2;
  return turn
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
    this.rigAssetStore = null;
    this.setRigAssetStore(
      typeof options?.get === 'function' ? options : options?.rigAssetStore,
    );
    this.audio = new TinyAudio();
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.dpr = 1;
    this.lastTime = 0;
    this.time = 0;
    this.hits = [];
    this.hoverId = null;
    this.pointerDown = null;
    this.buildTab = 'buildings';
    this.selection = null;
    this.modal = null;
    this.toast = null;
    this.shake = 0;
    this.preBattleSnapshot = null;
    this.animators = new Map();
    this.state = this.createState();
    this.load();
    this.bindEvents();
    this.resize();
  }

  setRigAssetStore(store = null) {
    this.rigAssetStore = store && typeof store.get === 'function' ? store : null;
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
      ['building-bouncy-fence', 4, 3, 90],
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
      this.hoverId = this.hits.findLast?.((hit) => hit.enabled !== false && roundedHit(point, hit))?.id
        || [...this.hits].reverse().find((hit) => hit.enabled !== false && roundedHit(point, hit))?.id
        || null;
    };
    this.onPointerCancel = () => {
      this.pointerDown = null;
      this.hoverId = null;
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
          .map((item) => ({ ...item, uid: uid('building'), destroyed: false, placedAt: -10 }));
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
    this.state.terrain = [];
    this.state.deployables = [];
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
    if (this.toast && this.time >= this.toast.expires) this.toast = null;
    this.shake = Math.max(0, this.shake - dt * 2.8);
    this.state.particles.forEach((particle) => {
      particle.life -= dt;
      particle.x += (particle.vx || 0) * dt;
      particle.y += (particle.vy || 0) * dt;
      particle.vy = (particle.vy || 0) + (particle.gravity || 0) * dt;
    });
    this.state.particles = this.state.particles.filter((particle) => particle.life > 0).slice(-80);
    this.state.floaters.forEach((floater) => {
      floater.life -= dt;
      floater.y -= dt * 24;
    });
    this.state.floaters = this.state.floaters.filter((floater) => floater.life > 0);
    this.state.projectiles.forEach((projectile) => { projectile.progress += dt / projectile.duration; });
    this.state.projectiles = this.state.projectiles.filter((projectile) => projectile.progress < 1);
    this.state.survivors.forEach((survivor) => { survivor.hitFlash = Math.max(0, (survivor.hitFlash || 0) - dt * 4); });
    this.state.enemies.forEach((enemy) => { enemy.hitFlash = Math.max(0, (enemy.hitFlash || 0) - dt * 5); });

    if (this.state.phase === 'battle' && !this.state.paused && !this.selection) this.updateBattle(dt);

    const animationsPaused = this.state.phase === 'battle' && (this.state.paused || Boolean(this.selection));
    this.updateEntityAnimations(animationsPaused ? 0 : dt);
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

  entityAnimationPose(entity) {
    return this.animatorFor(entity)?.sample() || null;
  }

  updateEntityAnimations(dt) {
    const liveIds = new Set();
    for (const survivor of this.state.survivors) {
      liveIds.add(survivor.uid);
      const previous = this.animators.get(survivor.uid);
      if (!survivor.downed && previous?.wasDowned) this.animators.delete(survivor.uid);
      const controller = this.animatorFor(survivor);
      if (!controller) continue;
      this.animators.get(survivor.uid).wasDowned = survivor.downed;
      controller.setBase('idle');
      if (survivor.downed) controller.play('downed', { restart: false });
      controller.update(dt);
      controller.drainEvents();
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
      controller.drainEvents();
    }
    for (const uid of this.animators.keys()) {
      if (!liveIds.has(uid)) this.animators.delete(uid);
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
    this.spawnParticles(BOARD.x + BOARD.cell * 6.65, this.cellCenter(0, row).y, '#9D7CA8', 8, 55);
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
    this.playEntityAnimation(survivor, 'attack');
    const maxTargets = card.attack.pierce || 1;
    targets.slice(0, maxTargets).forEach((enemy, index) => {
      this.launchProjectile(survivor, enemy, card.id.includes('crystal') ? 'crystal' : card.id.includes('bubble') ? 'bubble' : 'goo', index * 0.04);
      this.damageEnemy(enemy, card.attack.damage, survivor);
    });
    survivor.actionCount += 1;
    survivor.attackCount += 1;
    survivor.hitCount += 1;

    if (card.id === 'survivor-crystal-pin' && survivor.attackCount % card.ability.attacksRequired === 0) {
      const target = targets[Math.min(targets.length - 1, maxTargets - 1)];
      const cell = this.nearestCell(target);
      this.state.terrain.push({ type: 'crystal', x: cell.x, y: cell.y, life: card.ability.spikeLifetimeSeconds, damage: card.ability.spikeDamage });
      this.spawnParticles(this.cellCenter(cell.x, cell.y).x, this.cellCenter(cell.x, cell.y).y, PALETTE.crystal, 7, 40);
    }
    if (card.id === 'survivor-bubble-float' && survivor.hitCount % card.ability.hitsRequired === 0) {
      this.pushEnemy(targets[0], card.ability.knockbackTiles, 0, card.ability);
      this.audio.play('bubble');
    }
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
    this.spawnParticles(position.x, position.y - 25, PALETTE.heal, 10, 45);
    this.floatText(position.x, position.y - 40, choice.ratio >= 0.995 ? '萌芽' : `+${card.ability.heal}`, PALETTE.heal);
    this.audio.play('heal');
    return true;
  }

  updateBuildings(dt) {
    for (const building of this.state.buildings) {
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
            this.playEntityAnimation(enemy, 'attack');
            this.damageBuilding(entryBlocker, card.damage);
            enemy.attackTimer = card.attackIntervalSeconds;
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
          this.playEntityAnimation(enemy, 'attack');
          this.damageCore(card.damage);
          enemy.attackTimer = card.attackIntervalSeconds;
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
          this.playEntityAnimation(enemy, 'attack');
          this.damageBuilding(blocker, card.damage);
          enemy.attackTimer = card.attackIntervalSeconds;
        }
        continue;
      }

      const defender = this.state.survivors.find((survivor) => !survivor.downed && survivor.x === next.x && survivor.y === next.y);
      if (defender && (SURVIVOR_BY_ID[defender.cardId].blockCount > 0 || Math.abs(enemy.x - next.x) < 0.7)) {
        if (enemy.attackTimer <= 0) {
          this.playEntityAnimation(enemy, 'attack');
          this.damageSurvivor(defender, card.damage);
          enemy.attackTimer = card.attackIntervalSeconds;
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
          this.damageBuilding(target, card.ability.buildingDamage);
          for (const other of this.state.buildings) {
            if (other.uid !== target.uid && !other.destroyed && distance(other, target) <= card.ability.splashRadiusTiles) {
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
    enemy.hp -= damage;
    enemy.hitFlash = 1;
    const position = this.entityCanvasPosition(enemy);
    this.floatText(position.x, position.y - 40, `-${damage}`, enemy.marked ? '#F4C85E' : '#FFF8E9');
    this.spawnParticles(position.x, position.y - 10, ENEMY_BY_ID[enemy.cardId].color, 4, 32);
    if (enemy.hp <= 0) {
      enemy.dead = true;
      enemy.diedAt = this.time;
      enemy.deathElapsed = 0;
      this.playEntityAnimation(enemy, 'death');
      this.state.kills += 1;
      this.state.energy = Math.min(10, this.state.energy + (ENEMY_BY_ID[enemy.cardId].elite ? 2 : 1));
      this.spawnParticles(position.x, position.y - 8, '#8B7395', ENEMY_BY_ID[enemy.cardId].elite ? 18 : 9, 75);
    } else {
      this.playEntityAnimation(enemy, 'hurt');
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
    if (kind === 'survivor') this.playEntityAnimation(target, 'hurt');
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
    } else {
      target.downed = true;
      target.hp = 0;
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
      this.floatText(this.entityCanvasPosition(enemy).x, this.entityCanvasPosition(enemy).y - 50, '失衡', PALETTE.shield);
      return false;
    }
    const old = { x: enemy.x, y: enemy.y };
    enemy.x = clamp(enemy.x + dx, 0, 6.25);
    enemy.y = clamp(enemy.y + dy, 0, 5);
    enemy.path = [];
    enemy.routeTimer = 0;
    enemy.justPushed = true;
    const collision = this.state.enemies.find((other) => other.uid !== enemy.uid && !other.dead && distance(enemy, other) < 0.38);
    if (collision && effect.collisionDamage) {
      this.damageEnemy(enemy, effect.collisionDamage, effect);
      this.damageEnemy(collision, effect.collisionDamage, effect);
      enemy.stagger = Math.max(enemy.stagger, 0.45);
      collision.stagger = Math.max(collision.stagger, 0.45);
    }
    const position = this.entityCanvasPosition(enemy);
    this.spawnParticles(position.x, position.y - 15, PALETTE.bubble, 7, 55);
    const cell = this.nearestCell(enemy);
    if (inBoard(cell.x, cell.y)) this.triggerEnemyCell(enemy, cell);
    return old.x !== enemy.x || old.y !== enemy.y;
  }

  launchProjectile(source, target, type, delay = 0) {
    const from = this.entityCanvasPosition(source);
    const to = this.entityCanvasPosition(target);
    this.state.projectiles.push({
      uid: uid('projectile'), type, from, to,
      progress: -delay, duration: type === 'crystal' ? 0.24 : 0.32,
    });
  }

  spawnParticles(x, y, color, count = 6, speed = 45) {
    for (let index = 0; index < count && this.state.particles.length < 80; index += 1) {
      const angle = (index / count) * TAU + Math.random() * 0.6;
      const velocity = speed * (0.45 + Math.random() * 0.7);
      this.state.particles.push({
        x, y, color,
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
      this.spawnParticles(this.cellCenter(cell.x, cell.y).x, this.cellCenter(cell.x, cell.y).y, PALETTE.bubble, 14, 80);
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
        this.spawnParticles(this.cellCenter(selection.origin.x, selection.origin.y).x, this.cellCenter(selection.origin.x, selection.origin.y).y, '#F6BE58', 12, 55);
      } else {
        this.state.deployables.push({
          uid: uid('pad'), type: 'pad', ...selection.origin,
          dx, dy, tiles: card.effect.knockbackTiles, life: Infinity, consumed: false,
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
      this.spawnParticles(this.entityCanvasPosition(target).x, this.entityCanvasPosition(target).y - 20, PALETTE.heal, 14, 58);
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
      if (selection.sourceType === 'survivor') {
        const source = this.state.survivors.find((target) => target.uid === selection.sourceUid);
        if (this.state.survivors.some((target) => target.uid !== source.uid && !target.downed && target.x === cell.x && target.y === cell.y)) {
          this.showToast('目的地已经有人驻守', 'danger');
          return;
        }
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
        source.x = cell.x;
        source.y = cell.y;
      }
      this.state.enemies.forEach((enemy) => { enemy.routeTimer = 0; });
      this.spawnParticles(this.cellCenter(cell.x, cell.y).x, this.cellCenter(cell.x, cell.y).y, PALETTE.bubble, 16, 70);
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
    if (this.shake > 0) ctx.translate(Math.sin(this.time * 72) * this.shake * 5, Math.cos(this.time * 59) * this.shake * 3);
    this.hits = [];
    this.drawBackground(ctx);
    this.drawBattlefield(ctx);
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
        drawRoundedRect(ctx, x + 3, y + 3, BOARD.cell - 6, BOARD.cell - 6, {
          radius: 14,
          fill: (row + col) % 2 ? `rgba(223,204,162,${alpha})` : `rgba(235,221,187,${alpha})`,
          stroke: this.state.phase === 'battle' ? 'rgba(51,71,80,0.06)' : 'rgba(51,71,80,0.13)',
          lineWidth: 2,
        });
      }
    }

    this.drawRoutes(ctx);
    this.drawTerrain(ctx);
    this.drawBuildings(ctx);
    this.drawDeployables(ctx);
    this.drawUnits(ctx);
    this.drawProjectilesAndParticles(ctx);
    this.drawSelectionOverlay(ctx);

    const corePosition = { x: 116, y: BOARD.y + BOARD.cell * 3.55 };
    drawCore(ctx, corePosition.x, corePosition.y, 118, {
      time: this.time,
      health: this.state.coreHp / this.state.coreMaxHp,
      danger: this.state.coreHp / this.state.coreMaxHp < 0.35,
    });
    drawPortal(ctx, BOARD.x + BOARD.cell * 6 + 91, BOARD.y + BOARD.cell * 3.62, 138, {
      time: this.time,
      open: this.state.phase === 'battle' ? 1 : 0.62,
    });

    ctx.save();
    ctx.font = '700 15px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = PALETTE.inkSoft;
    ctx.fillText('软核', corePosition.x, BOARD.y + BOARD.cell * 5.93);
    ctx.fillText('裂隙入口', BOARD.x + BOARD.cell * 6 + 91, BOARD.y + BOARD.cell * 5.93);
    ctx.restore();
  }

  drawRoutes(ctx) {
    if (this.state.phase === 'battle' && !this.state.paused) return;
    const routeWaveIndex = this.state.phase === 'between' ? this.state.waveIndex + 1 : this.state.waveIndex;
    const wave = WAVES[Math.min(routeWaveIndex, WAVES.length - 1)];
    const rows = [...new Set(wave.groups.flatMap((group) => group.rowIndices))].slice(0, 4);
    ctx.save();
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([10, 10]);
    rows.forEach((row, routeIndex) => {
      const path = routeFor(this.state.buildings, { x: 5, y: row });
      const crossesBuilding = path.some((cell) => cell.x >= 0 && BUILDING_BY_ID[buildingAt(this.state.buildings, cell.x, cell.y)?.cardId]?.solid);
      ctx.strokeStyle = crossesBuilding ? `rgba(228,95,104,${0.48 - routeIndex * 0.05})` : `rgba(67,160,115,${0.45 - routeIndex * 0.05})`;
      ctx.beginPath();
      path.forEach((cell, index) => {
        const position = cell.x < 0
          ? { x: BOARD.x - 48, y: this.cellCenter(0, cell.y).y }
          : this.cellCenter(cell.x, cell.y);
        if (index === 0) ctx.moveTo(BOARD.x + BOARD.cell * 6 + 48, position.y);
        ctx.lineTo(position.x, position.y);
      });
      ctx.stroke();
    });
    ctx.restore();
  }

  drawTerrain(ctx) {
    for (const terrain of this.state.terrain) {
      const position = this.cellCenter(terrain.x, terrain.y);
      if (terrain.type === 'honey') {
        ctx.save();
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = '#E9B84F';
        ctx.strokeStyle = '#AF7C28';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(position.x, position.y + 17, 29, 18, -0.1, 0, TAU);
        ctx.ellipse(position.x - 18, position.y + 9, 12, 9, 0.3, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        drawStatusIcon(ctx, position.x + 25, position.y - 23, 22, 'sticky', { time: this.time, shadow: false });
      } else if (terrain.type === 'crystal') {
        ctx.save();
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
        ctx.restore();
      }
    }
  }

  drawBuildings(ctx) {
    const sorted = [...this.state.buildings].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const building of sorted) {
      if (building.destroyed && this.state.phase === 'battle') {
        const position = this.entityCanvasPosition(building);
        ctx.save();
        ctx.globalAlpha = 0.38;
        ctx.fillStyle = '#756B67';
        ctx.beginPath();
        ctx.ellipse(position.x, position.y - 5, 30, 13, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
        continue;
      }
      const card = BUILDING_BY_ID[building.cardId];
      const shape = rotatedFootprint(card, building.rotation);
      const centerX = BOARD.x + (building.x + shape.width / 2) * BOARD.cell;
      const centerY = BOARD.y + (building.y + shape.height) * BOARD.cell - 15;
      const selected = this.selection?.uid === building.uid;
      const placeProgress = clamp((this.time - building.placedAt) / 0.24, 0, 1);
      const scale = building.placedAt > 0 ? easeOutBack(placeProgress) : 1;
      ctx.save();
      ctx.translate(centerX, centerY);
      if (building.rotation % 180 === 90 && (card.footprint.width !== card.footprint.height)) ctx.rotate(Math.PI / 2);
      ctx.scale(scale, scale);
      drawBuilding(ctx, 0, 0, card.footprint.width > 1 ? 104 : 88, BUILDING_VARIANT[card.id], {
        time: this.time,
        selected,
        active: this.state.phase === 'battle',
        damage: 1 - building.hp / building.maxHp,
        disabled: building.destroyed,
      });
      ctx.restore();
      if (this.state.phase === 'battle' && !building.destroyed) this.drawHealthBar(ctx, centerX, centerY - 96, 54, building.hp / building.maxHp, building.shield > 0);
    }
  }

  drawDeployables(ctx) {
    for (const item of this.state.deployables) {
      const position = this.cellCenter(item.x, item.y);
      if (item.type === 'pad') {
        ctx.save();
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
        ctx.restore();
      } else if (item.type === 'lure') {
        const wobble = Math.sin(this.time * 5) * 3;
        ctx.save();
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
        ctx.restore();
      }
    }
  }

  drawUnits(ctx) {
    const units = [];
    this.state.survivors.forEach((survivor) => units.push({ kind: 'survivor', entity: survivor, depth: survivor.y + 0.15 }));
    this.state.enemies.forEach((enemy) => units.push({ kind: 'enemy', entity: enemy, depth: enemy.y + 0.5 }));
    units.sort((a, b) => a.depth - b.depth);
    for (const unit of units) {
      if (unit.kind === 'survivor') {
        const survivor = unit.entity;
        const position = this.entityCanvasPosition(survivor);
        const selected = this.selection?.uid === survivor.uid || this.selection?.firstUid === survivor.uid || this.selection?.sourceUid === survivor.uid;
        drawSlime(ctx, position.x, position.y, 68, SURVIVOR_VARIANT[survivor.cardId], {
          time: this.time,
          pose: this.entityAnimationPose(survivor),
          rigAsset: this.rigAssetFor(survivor.cardId),
          selected,
          disabled: survivor.downed,
          hit: survivor.hitFlash,
          shield: clamp((survivor.shield || 0) / 90, 0, 1),
          phase: survivor.x * 0.7 + survivor.y,
        });
        if (!survivor.downed) this.drawHealthBar(ctx, position.x, position.y - 75, 48, survivor.hp / survivor.maxHp, survivor.shield > 0);
        if (survivor.seed > 0) drawStatusIcon(ctx, position.x + 28, position.y - 64, 22, 'heal', { time: this.time, shadow: false });
      } else {
        const enemy = unit.entity;
        const deathElapsed = enemy.deathElapsed || 0;
        const deathDuration = this.enemyDeathDuration(enemy);
        if (enemy.dead && deathElapsed >= deathDuration) continue;
        const position = this.entityCanvasPosition(enemy);
        const card = ENEMY_BY_ID[enemy.cardId];
        const alpha = enemy.dead ? clamp(1 - deathElapsed / deathDuration, 0, 1) : 1;
        drawMonster(ctx, position.x, position.y, card.elite ? 100 : 62, ENEMY_VARIANT[enemy.cardId], {
          time: this.time,
          pose: this.entityAnimationPose(enemy),
          rigAsset: this.rigAssetFor(enemy.cardId),
          facing: -1,
          alpha,
          hit: enemy.hitFlash,
          selected: enemy.marked,
          phase: Number(enemy.uid.split('-').pop()) * 0.4,
        });
        if (!enemy.dead) this.drawHealthBar(ctx, position.x, position.y - (card.elite ? 112 : 68), card.elite ? 82 : 46, enemy.hp / enemy.maxHp, false, true);
        let iconX = position.x + 27;
        if (enemy.marked) { drawStatusIcon(ctx, iconX, position.y - 60, 22, 'marked', { time: this.time, shadow: false }); iconX += 22; }
        if (enemy.stagger > 0) drawStatusIcon(ctx, iconX, position.y - 60, 22, 'stun', { time: this.time, shadow: false });
        if (enemy.telegraph > 0) {
          ctx.save();
          ctx.strokeStyle = PALETTE.danger;
          ctx.lineWidth = 4;
          ctx.globalAlpha = 0.6 + Math.sin(this.time * 10) * 0.25;
          ctx.beginPath();
          ctx.arc(position.x, position.y - 48, 51, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - enemy.telegraph / ENEMY_BY_ID[enemy.cardId].ability.telegraphSeconds));
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  drawProjectilesAndParticles(ctx) {
    for (const projectile of this.state.projectiles) {
      const progress = clamp(projectile.progress, 0, 1);
      if (projectile.progress < 0) continue;
      const x = lerp(projectile.from.x, projectile.to.x, progress);
      const y = lerp(projectile.from.y - 28, projectile.to.y - 24, progress) - Math.sin(progress * Math.PI) * 16;
      const angle = Math.atan2(projectile.to.y - projectile.from.y, projectile.to.x - projectile.from.x);
      drawProjectile(ctx, x, y, projectile.type === 'crystal' ? 17 : 14, projectile.type === 'crystal' ? 'needle' : projectile.type, { progress, rotation: angle });
    }
    for (const particle of this.state.particles) {
      ctx.save();
      ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, TAU);
      ctx.fill();
      ctx.restore();
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

  drawSelectionOverlay(ctx) {
    const selection = this.selection;
    if (!selection) return;
    const highlightCell = (cell, color = '#61D6A2', alpha = 0.28) => {
      drawRoundedRect(ctx, BOARD.x + cell.x * BOARD.cell + 5, BOARD.y + cell.y * BOARD.cell + 5, BOARD.cell - 10, BOARD.cell - 10, {
        radius: 13, fill: color.replace(')', `,${alpha})`).replace('rgb', 'rgba'), stroke: color, lineWidth: 3,
      });
    };
    if (selection.origin) {
      ctx.save();
      ctx.globalAlpha = 0.33 + Math.sin(this.time * 5) * 0.08;
      ctx.fillStyle = '#61D6A2';
      roundedRectPath(ctx, BOARD.x + selection.origin.x * BOARD.cell + 5, BOARD.y + selection.origin.y * BOARD.cell + 5, BOARD.cell - 10, BOARD.cell - 10, 13);
      ctx.fill();
      ctx.restore();
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
    ctx.fillText('◆ 软晶', 1004, 42);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = '900 20px "PingFang SC", sans-serif';
    ctx.fillText(`${this.state.softCrystals}`, 1078, 43);
    ctx.restore();

    this.drawButton(ctx, 'audio-toggle', { x: 1184, y: 26, w: 54, h: 42 }, this.audio.enabled ? '声' : '静', {
      compact: true,
      secondary: true,
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
      const glyph = this.cardGlyph(card);
      drawRoundedRect(ctx, PANEL.x + 26, PANEL.y + 63, 78, 78, {
        radius: 22, fill: card.color, stroke: PALETTE.inkSoft, lineWidth: 3,
      });
      ctx.fillStyle = '#FFF8E9';
      ctx.font = '900 34px "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(glyph, PANEL.x + 65, PANEL.y + 116);
      ctx.textAlign = 'left';
      ctx.fillStyle = PALETTE.textMuted;
      ctx.font = '700 15px "PingFang SC", sans-serif';
      const meta = card.type === 'building'
        ? `${rotatedFootprint(card, this.selection?.rotation || 0).width}×${rotatedFootprint(card, this.selection?.rotation || 0).height} · 定形值 ${card.cost}`
        : `驻守单位 · 生命 ${card.hp}`;
      ctx.fillText(meta, PANEL.x + 122, PANEL.y + 84);
      ctx.fillStyle = PALETTE.ink;
      ctx.font = '600 17px "PingFang SC", sans-serif';
      wrapText(ctx, card.description, PANEL.x + 122, PANEL.y + 111, 228, 24, 3);

      const actionY = PANEL.y + 248;
      if (this.selection.kind === 'inspect-building') {
        this.drawButton(ctx, 'move-building', { x: PANEL.x + 26, y: actionY, w: 102, h: 48 }, '移动', { secondary: true }, () => {
          this.selection = { kind: 'move-building', uid: this.selection.uid };
          this.showToast('选择新的建筑位置');
        });
        this.drawButton(ctx, 'rotate-building', { x: PANEL.x + 140, y: actionY, w: 102, h: 48 }, '旋转', { secondary: true }, () => this.rotateSelection());
        this.drawButton(ctx, 'remove-building', { x: PANEL.x + 254, y: actionY, w: 102, h: 48 }, '收回', { danger: true }, () => this.removeSelectedBuilding());
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
      } else if (this.selection.kind === 'place-survivor' || this.selection.kind === 'move-survivor' || this.selection.kind === 'move-building') {
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
      ctx.fillStyle = '#FFF8E9';
      ctx.textAlign = 'center';
      ctx.font = '900 28px "PingFang SC", sans-serif';
      ctx.fillText(this.cardGlyph(targetingCard), PANEL.x + 60, PANEL.y + 105);
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
    ctx.fillStyle = '#61D6A2';
    ctx.strokeStyle = PALETTE.inkSoft;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(74, BOTTOM.y + 55, 37, 0, TAU);
    ctx.fill();
    ctx.stroke();
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

  drawMiniCard(ctx, id, rect, card, options, onTap, enabled = true) {
    const hovered = this.hoverId === id;
    const lift = options.selected ? -5 : hovered ? -2 : 0;
    const border = options.item ? '#B48768' : options.selected ? '#3F8B6A' : '#7DA58D';
    ctx.save();
    ctx.globalAlpha = options.disabled ? 0.48 : 1;
    drawRoundedRect(ctx, rect.x, rect.y + lift, rect.w, rect.h, {
      radius: 18,
      fill: options.selected ? '#F0F8E8' : '#FFF8E9',
      stroke: border,
      lineWidth: options.selected ? 4 : 2.5,
    });
    drawRoundedRect(ctx, rect.x + 8, rect.y + 8 + lift, 46, rect.h - 16, {
      radius: 14, fill: card.color, stroke: 'rgba(51,71,80,0.28)', lineWidth: 2,
    });
    ctx.fillStyle = '#FFF8E9';
    ctx.font = '900 25px "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.cardGlyph(card), rect.x + 31, rect.y + 52 + lift);
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
    ctx.save();
    ctx.fillStyle = enabled ? color : '#8A928E';
    ctx.font = `${options.compact ? 800 : 900} ${options.compact ? 16 : 18}px "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rect.x + rect.w / 2, y + rect.h / 2 + 1);
    ctx.restore();
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
        ctx.fillStyle = enemy.color;
        ctx.beginPath();
        ctx.arc(x + 28, cy - 5, 8, 0, TAU);
        ctx.fill();
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
      if (this.shapingUsed() + card.cost > SHAPING_BUDGET) {
        this.showToast(`定形值不足，还需要 ${card.cost} 点`, 'danger');
        this.audio.play('warning');
        return;
      }
      if (!canPlace(this.state.buildings, card, cell.x, cell.y, selection.rotation)) {
        this.showToast('这里放不下，换个位置试试', 'danger');
        return;
      }
      this.state.buildings.push({
        uid: uid('building'), cardId: card.id, x: cell.x, y: cell.y,
        rotation: selection.rotation, hp: card.hp, maxHp: card.hp,
        cooldown: 0, shotCount: 0, shield: 0, seed: 0,
        fenceTrigger: 1, destroyed: false, placedAt: this.time,
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
      if (!canPlace(this.state.buildings, card, cell.x, cell.y, building.rotation, building.uid)) {
        this.showToast('这个位置会和其他建筑重叠', 'danger');
        return;
      }
      building.x = cell.x;
      building.y = cell.y;
      building.placedAt = this.time;
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
      this.selection.rotation = (this.selection.rotation + 90) % 180;
      return;
    }
    if (this.selection?.kind === 'inspect-building') {
      const building = this.state.buildings.find((item) => item.uid === this.selection.uid);
      if (!building) return;
      const nextRotation = (building.rotation + 90) % 180;
      const card = BUILDING_BY_ID[building.cardId];
      if (!canPlace(this.state.buildings, card, building.x, building.y, nextRotation, building.uid)) {
        this.showToast('旋转后会和其他建筑重叠', 'danger');
        return;
      }
      building.rotation = nextRotation;
      building.placedAt = this.time;
      this.audio.play('place');
      this.save();
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
    this.state.terrain = this.state.terrain.filter((terrain) => terrain.persistent);
    this.state.deployables = [];
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
    this.state.terrain = [];
    this.state.deployables = [];
    this.state.kills = 0;
    this.preBattleSnapshot = null;
    this.save();
  }
}
