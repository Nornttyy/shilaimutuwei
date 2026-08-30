import {
  drawAssetOrFallback,
  drawCore,
  drawMonster,
  drawParticle,
  drawProjectile,
  drawSlime,
} from './draw.js';
import { AnimationController } from './animation/controller.js';
import { ExpressionMixer } from './animation/expression-mixer.js';
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
  TD_ENEMIES,
  TD_FIELD,
  TD_MAX_STAR,
  TD_STAGE_BY_ID,
  TD_STAGES,
  TD_STORAGE_KEY,
  TD_VIEW,
  TOWER_TYPES,
  beginTowerDefenseRun,
  canMergeCardIntoTower,
  canMergeTowers,
  createTowerDefenseState,
  drawCostForState,
  drawTowerCard,
  fusionOrbitPoint,
  mergeCardIntoTower,
  mergeTowers,
  moveTowerToPad,
  normalizeTowerDefenseProgress,
  placeTowerFromHand,
  replayTowerDefenseRun,
  reclaimTowerToHand,
  returnToTowerDefenseMenu,
  serializeTowerDefenseProgress,
  skipTowerDefenseBreak,
  stageForState,
  startNextTowerDefenseWave,
  towerAttackEvolution,
  towerByPad,
  towerRange,
  tutorialTargetForState,
  updateTowerDefense,
} from './tower-defense-core.js';

const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
const TAU = Math.PI * 2;
const MAX_DPR = 2;
const PANEL_X = TD_FIELD.width;
const PAD_RADIUS = 46;
const DRAG_THRESHOLD = 12;

const COMMAND_DOCK = Object.freeze({
  back: Object.freeze({ x: 946, y: 14, width: 50, height: 50 }),
  wave: Object.freeze({ x: 1004, y: 14, width: 92, height: 50 }),
  enemies: Object.freeze({ x: 1104, y: 14, width: 58, height: 50 }),
  currency: Object.freeze({ x: 1170, y: 14, width: 94, height: 50 }),
  core: Object.freeze({ x: 946, y: 74, width: 318, height: 34 }),
  handZone: Object.freeze({ x: 946, y: 118, width: 318, height: 294 }),
  cards: Object.freeze([
    Object.freeze({ x: 946, y: 118, width: 154, height: 142 }),
    Object.freeze({ x: 1110, y: 118, width: 154, height: 142 }),
    Object.freeze({ x: 946, y: 270, width: 154, height: 142 }),
    Object.freeze({ x: 1110, y: 270, width: 154, height: 142 }),
  ]),
  selection: Object.freeze({ x: 946, y: 424, width: 318, height: 88 }),
  draw: Object.freeze({ x: 946, y: 524, width: 318, height: 70 }),
  reclaim: Object.freeze({ x: 946, y: 608, width: 80, height: 80 }),
  start: Object.freeze({ x: 1038, y: 608, width: 226, height: 80 }),
});

const MENU_ACTIONS = Object.freeze({
  story: Object.freeze({ x: 282, y: 565, width: 456, height: 104 }),
  endless: Object.freeze({ x: 762, y: 565, width: 236, height: 104 }),
});

const COLORS = Object.freeze({
  ink: '#273844',
  inkSoft: '#5E7078',
  cream: '#FFF8E9',
  creamDeep: '#F0E2C5',
  white: '#FFFFFF',
  mint: '#64D3A0',
  mintDeep: '#27866B',
  blue: '#69CFE8',
  crystal: '#8878DB',
  coral: '#E36B72',
  gold: '#E5A93F',
  shadow: 'rgba(30, 48, 58, 0.24)',
  disabled: '#A8B0AD',
});

const STAGE_REGION_ASSET = Object.freeze({
  'stage-1': 'region-gel-meadow-field-a',
  'stage-2': 'region-bubble-heath-field-a',
  'stage-3': 'region-crystal-bloom-field-a',
});

const MONSTER_DRAW_TYPE = Object.freeze({
  bug: 'bug',
  windcap: 'mushroom',
  stone: 'stone',
  boss: 'boss',
});

const ANIMATION_CLIPS_BY_OWNER_ID = Object.freeze({
  'survivor-shell-shell': SHELL_CLIPS,
  'survivor-crystal-pin': CRYSTAL_CLIPS,
  'survivor-bubble-float': BUBBLE_CLIPS,
  'survivor-moss-sprout': SPROUT_CLIPS,
  'enemy-soft-biter': BUG_CLIPS,
  'enemy-windcap': WINDCAP_CLIPS,
  'enemy-stone-lump': STONE_CLIPS,
  'enemy-acid-shell-king': BOSS_CLIPS,
});

const ENEMY_DEATH_DURATION_BY_TYPE = Object.freeze({
  bug: BUG_CLIPS.death.duration,
  windcap: WINDCAP_CLIPS.death.duration,
  stone: STONE_CLIPS.death.duration,
  boss: BOSS_CLIPS.death.duration,
});

const ATTACK_MODE_LABEL = Object.freeze({
  'goo-splash': '胶爆',
  'goo-shockwave': '震波',
  'goo-split': '双爆',
  'goo-cluster': '集束',
  'needle-pierce': '晶穿',
  'needle-double': '双穿',
  'needle-fork': '分叉',
  'needle-fan': '扇射',
  'bubble-slow': '泡缚',
  'bubble-chain': '连锁',
  'bubble-cascade': '泡瀑',
  'bubble-tide': '泡潮',
  'seed-poison': '种毒',
  'seed-branch': '分枝',
  'seed-canopy': '树冠',
  'seed-bloom': '绽放',
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pointDistance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
const insideRect = (point, rect) => (
  point.x >= rect.x && point.x <= rect.x + rect.width
  && point.y >= rect.y && point.y <= rect.y + rect.height
);

function drawDockShell(ctx, stage, time) {
  const gradient = ctx.createLinearGradient(PANEL_X, 0, TD_VIEW.width, TD_VIEW.height);
  gradient.addColorStop(0, '#234B50');
  gradient.addColorStop(0.55, '#315E57');
  gradient.addColorStop(1, '#203F4A');
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(PANEL_X + 18, 0);
  ctx.bezierCurveTo(PANEL_X - 8, 112, PANEL_X + 8, 232, PANEL_X + 2, 348);
  ctx.bezierCurveTo(PANEL_X - 5, 474, PANEL_X + 14, 602, PANEL_X + 8, TD_VIEW.height);
  ctx.lineTo(TD_VIEW.width, TD_VIEW.height);
  ctx.lineTo(TD_VIEW.width, 0);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.globalAlpha = 0.13;
  ctx.fillStyle = stage.accent;
  for (let index = 0; index < 7; index += 1) {
    const radius = 22 + (index % 3) * 13;
    const x = 972 + (index * 73) % 290;
    const y = 60 + (index * 137) % 640 + Math.sin(time * 0.55 + index) * 5;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function animationPhaseForKey(key) {
  let hash = 2166136261;
  for (const character of String(key)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1700) / 1000;
}

function roundedPath(ctx, x, y, width, height, radius = 16) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function panel(ctx, rect, {
  fill = COLORS.cream,
  stroke = 'rgba(39, 56, 68, 0.18)',
  lineWidth = 2,
  radius = 18,
  shadow = false,
} = {}) {
  ctx.save();
  if (shadow) {
    ctx.shadowColor = COLORS.shadow;
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 7;
  }
  roundedPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  if (stroke && lineWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

function label(ctx, text, x, y, {
  size = 24,
  color = COLORS.ink,
  align = 'center',
  baseline = 'middle',
  weight = 700,
  alpha = 1,
} = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(String(text), x, y);
  ctx.restore();
}

function button(ctx, rect, text, {
  enabled = true,
  selected = false,
  fill = COLORS.mint,
  color = COLORS.white,
  accent = COLORS.mintDeep,
  size = 23,
} = {}) {
  panel(ctx, rect, {
    fill: enabled ? (selected ? accent : fill) : '#D8DEDA',
    stroke: enabled ? accent : '#ABB5B1',
    lineWidth: selected ? 4 : 2,
    radius: Math.min(20, rect.height / 2),
    shadow: enabled,
  });
  label(ctx, text, rect.x + rect.width / 2, rect.y + rect.height / 2 + 1, {
    size,
    color: enabled ? color : '#7D8985',
    weight: 800,
  });
}

function safeGlobal(name) {
  try {
    return globalThis[name];
  } catch {
    return undefined;
  }
}

function localStorageAdapter(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return null;
  }
  return {
    get(key, fallback = null) {
      try {
        const raw = storage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        storage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
  };
}

function frameScheduler(canvas, options = {}) {
  const runtime = options.runtime || {};
  const request = options.requestAnimationFrame
    || runtime.requestAnimationFrame
    || canvas?.requestAnimationFrame?.bind(canvas)
    || safeGlobal('requestAnimationFrame')?.bind(globalThis);
  const cancel = options.cancelAnimationFrame
    || runtime.cancelAnimationFrame
    || canvas?.cancelAnimationFrame?.bind(canvas)
    || safeGlobal('cancelAnimationFrame')?.bind(globalThis);
  if (typeof request === 'function') {
    return {
      request: (callback) => request(callback),
      cancel: (id) => {
        if (id != null && typeof cancel === 'function') cancel(id);
      },
    };
  }
  const schedule = safeGlobal('setTimeout');
  const unschedule = safeGlobal('clearTimeout');
  if (typeof schedule === 'function') {
    return {
      request: (callback) => schedule(() => callback(Date.now()), 16),
      cancel: (id) => {
        if (id != null && typeof unschedule === 'function') unschedule(id);
      },
    };
  }
  return { request: () => null, cancel: () => {} };
}

function canvasRect(canvas) {
  let rect = null;
  try {
    rect = canvas?.getBoundingClientRect?.();
  } catch {
    rect = null;
  }
  const width = Number(rect?.width ?? canvas?.clientWidth ?? canvas?.width) || TD_VIEW.width;
  const height = Number(rect?.height ?? canvas?.clientHeight ?? canvas?.height) || TD_VIEW.height;
  return {
    left: Number(rect?.left) || 0,
    top: Number(rect?.top) || 0,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

export class TowerDefenseGame {
  constructor(canvas, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new TypeError('TowerDefenseGame requires a Canvas-like object.');
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('TowerDefenseGame requires a 2D canvas context.');
    this.options = options;
    this.runtime = options.runtime || null;
    this.assetStore = null;
    this.rigAssetStore = null;
    this.generatedCharacterArtEnabled = options.generatedCharacterArtEnabled !== false;
    this.setAssetStore(options.assetStore);
    this.setRigAssetStore(
      typeof options?.get === 'function' ? options : options.rigAssetStore,
    );

    this.storage = this.runtime?.storage
      && typeof this.runtime.storage.get === 'function'
      && typeof this.runtime.storage.set === 'function'
      ? this.runtime.storage
      : localStorageAdapter(options.storage || safeGlobal('localStorage'));
    const progress = this.loadProgress();
    this.state = createTowerDefenseState({
      progress,
      seed: Number.isFinite(Number(options.seed)) ? Number(options.seed) : Date.now(),
    });

    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.pixelRatio = 1;
    this.cssWidth = TD_VIEW.width;
    this.cssHeight = TD_VIEW.height;
    this.hits = [];
    this.drag = null;
    this.selectedCardUid = null;
    this.hoverPoint = null;
    this.shake = 0;
    this.eventCursor = 0;
    this.animationTime = 0;
    this.characterAnimations = new Map();
    this.defeatedActors = [];
    this.running = false;
    this.backgrounded = false;
    this.frameId = null;
    this.lastTimestamp = 0;
    this.scheduler = frameScheduler(canvas, options);

    this.boundPointerDown = (event) => this.handlePointerDown(event);
    this.boundPointerMove = (event) => this.handlePointerMove(event);
    this.boundPointerUp = (event) => this.handlePointerUp(event);
    this.boundPointerCancel = () => this.cancelInteraction();
    this.bindInput();
    this.resize();
  }

  setAssetStore(store = null) {
    this.assetStore = store
      && typeof store.get === 'function'
      && typeof store.useOrFallback === 'function'
      ? store
      : null;
    return this;
  }

  setRigAssetStore(store = null) {
    this.rigAssetStore = store && typeof store.get === 'function' ? store : null;
    return this;
  }

  setGeneratedCharacterArtEnabled(enabled = true) {
    this.generatedCharacterArtEnabled = enabled !== false;
    return this;
  }

  rigAsset(ownerId) {
    return this.rigAssetStore?.get(ownerId, null) ?? null;
  }

  characterRigOptions(ownerId) {
    const rigAsset = this.rigAsset(ownerId);
    return {
      rigAsset,
      requireLayeredRig: Boolean(
        rigAsset || this.rigAssetStore?.manifest?.rigs?.[ownerId],
      ),
    };
  }

  animationClipsForOwner(ownerId) {
    return ANIMATION_CLIPS_BY_OWNER_ID[ownerId] || null;
  }

  characterAnimationFor(key, ownerId, base = 'idle') {
    if (typeof key !== 'string' || !key || typeof ownerId !== 'string' || !ownerId) return null;
    const clips = this.animationClipsForOwner(ownerId);
    if (!clips || !Object.hasOwn(clips, base)) return null;
    const current = this.characterAnimations.get(key);
    if (current?.ownerId === ownerId) {
      current.controller.setBase(base);
      return current;
    }

    const controller = new AnimationController(clips, {
      base,
      transitionDuration: 0.06,
    });
    const phase = animationPhaseForKey(key);
    controller.update(phase);
    controller.drainEvents();
    const entry = {
      key,
      ownerId,
      phase,
      controller,
      expressionMixer: new ExpressionMixer({ ownerId }),
    };
    this.characterAnimations.set(key, entry);
    return entry;
  }

  playCharacterAnimation(key, ownerId, action, {
    base = 'idle',
    restart = true,
  } = {}) {
    const entry = this.characterAnimationFor(key, ownerId, base);
    if (!entry || !Object.hasOwn(this.animationClipsForOwner(ownerId), action)) return false;
    return entry.controller.play(action, { restart });
  }

  characterAnimationSample(key, ownerId, base = 'idle') {
    const entry = this.characterAnimationFor(key, ownerId, base);
    if (!entry) return { pose: null, expressionSample: null };
    return {
      pose: entry.controller.sample(),
      expressionSample: entry.expressionMixer.sample(),
    };
  }

  processCharacterAnimationEvent(event) {
    if (!event || typeof event.type !== 'string') return;
    if (event.type === 'run-start') {
      this.defeatedActors.length = 0;
      return;
    }
    if (event.type === 'shot') {
      const tower = this.state.towers.find(({ uid }) => uid === event.towerUid);
      const ownerId = tower && TOWER_TYPES[tower.type]?.ownerId;
      if (ownerId) this.playCharacterAnimation(`tower:${tower.uid}`, ownerId, 'attack');
      return;
    }
    if (event.type === 'merge') {
      const tower = this.state.towers.find(({ uid }) => uid === event.towerUid);
      const ownerId = tower && TOWER_TYPES[tower.type]?.ownerId;
      if (ownerId) this.playCharacterAnimation(`tower:${tower.uid}`, ownerId, 'attack');
      return;
    }
    if (event.type === 'enemy-hit') {
      const enemy = this.state.enemies.find(({ uid }) => uid === event.enemyUid);
      const ownerId = enemy && TD_ENEMIES[enemy.type]?.ownerId;
      if (ownerId) {
        this.playCharacterAnimation(`enemy:${enemy.uid}`, ownerId, 'hurt', {
          base: 'move',
          restart: false,
        });
      }
      return;
    }
    if (event.type !== 'enemy-defeat') return;
    const definition = TD_ENEMIES[event.enemyType];
    if (
      !definition
      || typeof event.enemyUid !== 'string'
      || !Number.isFinite(event.x)
      || !Number.isFinite(event.y)
    ) return;
    const key = `defeated:${event.enemyUid}`;
    const actor = {
      key,
      type: definition.id,
      ownerId: definition.ownerId,
      x: event.x,
      y: event.y,
      facing: event.facing === -1 ? -1 : 1,
      age: 0,
      duration: ENEMY_DEATH_DURATION_BY_TYPE[definition.id] || 0.5,
    };
    this.defeatedActors = this.defeatedActors.filter(({ key: currentKey }) => currentKey !== key);
    this.defeatedActors.push(actor);
    this.playCharacterAnimation(key, actor.ownerId, 'death', { base: 'move' });
  }

  updateCharacterAnimations(dt) {
    const delta = clamp(Number(dt) || 0, 0, 0.05);
    this.animationTime += delta;
    const liveKeys = new Set();
    const advance = (key, ownerId, base = 'idle') => {
      const entry = this.characterAnimationFor(key, ownerId, base);
      if (!entry) return;
      liveKeys.add(key);
      entry.controller.update(delta);
      const events = entry.controller.drainEvents();
      entry.expressionMixer.setAnimationContext(entry.controller, {
        events,
        currentTime: this.animationTime + entry.phase,
      });
      entry.expressionMixer.tick(delta);
    };

    if (this.state.screen === 'menu') {
      for (const tower of Object.values(TOWER_TYPES)) {
        advance(`preview:menu:${tower.id}`, tower.ownerId, 'idle');
      }
    } else if (this.state.screen === 'battle') {
      for (const tower of this.state.towers) {
        advance(`tower:${tower.uid}`, TOWER_TYPES[tower.type].ownerId, 'idle');
      }
      for (const enemy of this.state.enemies) {
        advance(`enemy:${enemy.uid}`, TD_ENEMIES[enemy.type].ownerId, 'move');
      }
      for (const card of this.state.hand) {
        advance(`card:${card.uid}`, TOWER_TYPES[card.type].ownerId, 'idle');
      }
      for (const actor of this.defeatedActors) {
        actor.age += delta;
        advance(actor.key, actor.ownerId, 'move');
      }
      this.defeatedActors = this.defeatedActors.filter(({ age, duration }) => age < duration);
    } else {
      const victory = this.state.result === 'victory';
      const definition = victory ? TOWER_TYPES.shell : TD_ENEMIES.boss;
      advance(
        victory ? 'preview:result:shell' : 'preview:result:boss',
        definition.ownerId,
        'idle',
      );
      this.defeatedActors.length = 0;
    }

    for (const key of this.characterAnimations.keys()) {
      if (!liveKeys.has(key)) this.characterAnimations.delete(key);
    }
  }

  loadProgress() {
    try {
      return normalizeTowerDefenseProgress(this.storage?.get(TD_STORAGE_KEY, {}) || {});
    } catch {
      return normalizeTowerDefenseProgress({});
    }
  }

  save() {
    try {
      const progress = serializeTowerDefenseProgress(this.state);
      return this.storage?.set(TD_STORAGE_KEY, progress) ?? false;
    } catch {
      return false;
    }
  }

  bindInput() {
    if (typeof this.canvas.addEventListener !== 'function') return;
    this.canvas.addEventListener('pointerdown', this.boundPointerDown, { passive: false });
    this.canvas.addEventListener('pointermove', this.boundPointerMove, { passive: false });
    this.canvas.addEventListener('pointerup', this.boundPointerUp, { passive: false });
    this.canvas.addEventListener('pointercancel', this.boundPointerCancel, { passive: true });
    this.canvas.addEventListener('contextmenu', (event) => event?.preventDefault?.());
  }

  resize(sizeHint = null) {
    const rect = canvasRect(this.canvas);
    const hintedWidth = Number(sizeHint?.width);
    const hintedHeight = Number(sizeHint?.height);
    this.cssWidth = Number.isFinite(hintedWidth) && hintedWidth > 0 ? hintedWidth : rect.width;
    this.cssHeight = Number.isFinite(hintedHeight) && hintedHeight > 0 ? hintedHeight : rect.height;
    const hintedDpr = Number(sizeHint?.pixelRatio ?? this.options.pixelRatio);
    const globalDpr = Number(safeGlobal('devicePixelRatio'));
    this.pixelRatio = clamp(
      Number.isFinite(hintedDpr) && hintedDpr > 0
        ? hintedDpr
        : Number.isFinite(globalDpr) && globalDpr > 0 ? globalDpr : 1,
      1,
      MAX_DPR,
    );
    this.canvas.width = Math.max(1, Math.round(this.cssWidth * this.pixelRatio));
    this.canvas.height = Math.max(1, Math.round(this.cssHeight * this.pixelRatio));
    this.scale = Math.max(0.01, Math.min(
      this.cssWidth / TD_VIEW.width,
      this.cssHeight / TD_VIEW.height,
    ));
    this.offsetX = (this.cssWidth - TD_VIEW.width * this.scale) / 2;
    this.offsetY = (this.cssHeight - TD_VIEW.height * this.scale) / 2;
    this.render();
    return this;
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this.lastTimestamp = 0;
    this.scheduleFrame();
    return this;
  }

  scheduleFrame() {
    if (!this.running || this.backgrounded || this.frameId != null) return;
    this.frameId = this.scheduler.request((timestamp) => {
      this.frameId = null;
      this.frame(timestamp);
    });
  }

  frame(timestamp) {
    if (!this.running || this.backgrounded) return;
    const now = Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now();
    const dt = this.lastTimestamp > 0
      ? clamp((now - this.lastTimestamp) / 1000, 0, 0.05)
      : 0;
    this.lastTimestamp = now;
    updateTowerDefense(this.state, dt);
    this.processEvents();
    this.updateCharacterAnimations(dt);
    this.shake = Math.max(0, this.shake - dt * 22);
    this.render();
    this.scheduleFrame();
  }

  processEvents() {
    const events = this.state.events.splice(0);
    this.eventCursor = 0;
    for (const event of events) {
      this.processCharacterAnimationEvent(event);
      if (event.type === 'core-hit') this.shake = Math.min(10, this.shake + 5);
      if (event.type === 'run-end' || event.type === 'tutorial-complete') this.save();
    }
    return events;
  }

  onBackground() {
    this.backgrounded = true;
    this.lastTimestamp = 0;
    this.scheduler.cancel(this.frameId);
    this.frameId = null;
    this.cancelInteraction();
    this.save();
    return this;
  }

  onForeground() {
    this.backgrounded = false;
    this.lastTimestamp = 0;
    this.render();
    this.scheduleFrame();
    return this;
  }

  stop() {
    this.running = false;
    this.scheduler.cancel(this.frameId);
    this.frameId = null;
    this.lastTimestamp = 0;
    return this;
  }

  dispose() {
    this.stop();
    this.save();
    this.canvas.removeEventListener?.('pointerdown', this.boundPointerDown);
    this.canvas.removeEventListener?.('pointermove', this.boundPointerMove);
    this.canvas.removeEventListener?.('pointerup', this.boundPointerUp);
    this.canvas.removeEventListener?.('pointercancel', this.boundPointerCancel);
    this.cancelInteraction();
    this.characterAnimations.clear();
    this.defeatedActors.length = 0;
  }

  toGamePoint(eventOrPoint) {
    if (eventOrPoint && Number.isFinite(eventOrPoint.gameX) && Number.isFinite(eventOrPoint.gameY)) {
      return { x: eventOrPoint.gameX, y: eventOrPoint.gameY };
    }
    const rect = canvasRect(this.canvas);
    const touch = eventOrPoint?.changedTouches?.[0] || eventOrPoint?.touches?.[0];
    const clientX = Number(touch?.clientX ?? touch?.pageX ?? eventOrPoint?.clientX ?? eventOrPoint?.x);
    const clientY = Number(touch?.clientY ?? touch?.pageY ?? eventOrPoint?.clientY ?? eventOrPoint?.y);
    return {
      x: (clientX - rect.left - this.offsetX) / this.scale,
      y: (clientY - rect.top - this.offsetY) / this.scale,
    };
  }

  hitAt(point, predicate = null) {
    for (let index = this.hits.length - 1; index >= 0; index -= 1) {
      const hit = this.hits[index];
      if (hit.enabled === false || !insideRect(point, hit)) continue;
      if (!predicate || predicate(hit)) return hit;
    }
    return null;
  }

  addHit(id, rect, action, data = {}, enabled = true) {
    this.hits.push({ id, ...rect, action, data, enabled });
  }

  tutorialAllows(hit) {
    const target = tutorialTargetForState(this.state);
    if (!target || this.state.screen === 'result') return true;
    if (!hit) return false;
    if (target.type === 'stage') {
      return hit.action === 'stage' && hit.data.stageIndex === target.stageIndex;
    }
    if (target.type === 'draw') return hit.action === 'draw';
    if (target.type === 'pad') {
      return hit.action === 'card'
        || (hit.action === 'pad' && hit.data.padIndex === target.padIndex);
    }
    if (target.type === 'fusion') return hit.action === 'card' || hit.action === 'tower';
    if (target.type === 'start') return hit.action === 'start-wave';
    return true;
  }

  handlePointerDown(event) {
    event?.preventDefault?.();
    const point = this.toGamePoint(event);
    const hit = this.hitAt(point);
    if (!this.tutorialAllows(hit)) return;
    this.hoverPoint = point;
    if (hit?.action === 'card') {
      this.drag = {
        kind: 'card', uid: hit.data.cardUid, start: point, point, moved: false,
      };
    } else if (hit?.action === 'tower') {
      this.drag = {
        kind: 'tower', uid: hit.data.towerUid, start: point, point, moved: false,
      };
    } else {
      this.drag = { kind: 'tap', hit, start: point, point, moved: false };
    }
    this.canvas.setPointerCapture?.(event?.pointerId);
  }

  handlePointerMove(event) {
    event?.preventDefault?.();
    const point = this.toGamePoint(event);
    this.hoverPoint = point;
    if (!this.drag) return;
    this.drag.point = point;
    if (pointDistance(point, this.drag.start) >= DRAG_THRESHOLD) this.drag.moved = true;
  }

  handlePointerUp(event) {
    event?.preventDefault?.();
    const point = this.toGamePoint(event);
    const drag = this.drag;
    this.drag = null;
    this.canvas.releasePointerCapture?.(event?.pointerId);
    if (!drag) return;

    if (drag.kind === 'card') {
      const towerHit = this.hitAt(point, (hit) => hit.action === 'tower');
      const padHit = this.hitAt(point, (hit) => hit.action === 'pad');
      if (drag.moved && towerHit && this.tutorialAllows(towerHit)) {
        this.tryMergeCard(drag.uid, towerHit.data.towerUid);
      } else if (drag.moved && padHit && this.tutorialAllows(padHit)) {
        this.placeCard(drag.uid, padHit.data.padIndex);
      } else {
        this.selectCard(drag.uid);
      }
      return;
    }
    if (drag.kind === 'tower') {
      const towerHit = this.hitAt(point, (hit) => hit.action === 'tower');
      const padHit = this.hitAt(point, (hit) => hit.action === 'pad');
      if (drag.moved && insideRect(point, COMMAND_DOCK.reclaim)) {
        this.reclaimTower(drag.uid);
      } else if (drag.moved && towerHit && towerHit.data.towerUid !== drag.uid) {
        this.tryMerge(drag.uid, towerHit.data.towerUid);
      } else if (drag.moved && padHit) {
        this.moveTower(drag.uid, padHit.data.padIndex);
      } else {
        this.selectOrMergeTower(drag.uid);
      }
      return;
    }
    if (!drag.moved && drag.hit && this.tutorialAllows(drag.hit)) this.activateHit(drag.hit);
  }

  cancelInteraction() {
    this.drag = null;
    this.hoverPoint = null;
  }

  selectCard(cardUid) {
    if (!this.state.hand.some((card) => card.uid === cardUid)) return;
    this.selectedCardUid = this.selectedCardUid === cardUid ? null : cardUid;
    this.state.selectedTowerUid = null;
  }

  placeCard(cardUid, padIndex) {
    const tower = placeTowerFromHand(this.state, cardUid, padIndex);
    if (!tower) return false;
    this.selectedCardUid = null;
    this.state.selectedTowerUid = tower.uid;
    return true;
  }

  tryMerge(sourceUid, targetUid) {
    const merged = mergeTowers(this.state, sourceUid, targetUid);
    if (!merged) return false;
    this.state.selectedTowerUid = merged.uid;
    return true;
  }

  tryMergeCard(cardUid, targetUid) {
    const merged = mergeCardIntoTower(this.state, cardUid, targetUid);
    if (!merged) return false;
    this.selectedCardUid = null;
    this.state.selectedTowerUid = merged.uid;
    return true;
  }

  moveTower(towerUid, padIndex) {
    const moved = moveTowerToPad(this.state, towerUid, padIndex);
    if (!moved) return false;
    this.selectedCardUid = null;
    this.state.selectedTowerUid = moved.uid;
    return true;
  }

  reclaimTower(towerUid) {
    const card = reclaimTowerToHand(this.state, towerUid);
    if (!card) return false;
    this.state.selectedTowerUid = null;
    this.selectedCardUid = card.uid;
    return true;
  }

  selectOrMergeTower(towerUid) {
    const selected = this.state.selectedTowerUid;
    if (this.selectedCardUid) {
      this.tryMergeCard(this.selectedCardUid, towerUid);
      return;
    }
    if (selected && selected !== towerUid) {
      const source = this.state.towers.find((tower) => tower.uid === selected);
      const target = this.state.towers.find((tower) => tower.uid === towerUid);
      if (canMergeTowers(source, target)) {
        this.tryMerge(selected, towerUid);
        return;
      }
    }
    this.state.selectedTowerUid = selected === towerUid ? null : towerUid;
  }

  activateHit(hit) {
    switch (hit.action) {
      case 'stage':
        if (beginTowerDefenseRun(this.state, {
          mode: 'stage', stageId: hit.data.stageId,
        })) {
          this.selectedCardUid = null;
          this.eventCursor = 0;
        }
        break;
      case 'endless':
        if (this.endlessUnlocked()) {
          beginTowerDefenseRun(this.state, { mode: 'endless', stageId: 'stage-3' });
          this.selectedCardUid = null;
          this.eventCursor = 0;
        }
        break;
      case 'draw': {
        const card = drawTowerCard(this.state);
        if (card) this.selectedCardUid = card.uid;
        break;
      }
      case 'pad':
        if (this.selectedCardUid) this.placeCard(this.selectedCardUid, hit.data.padIndex);
        else if (this.state.selectedTowerUid) {
          this.moveTower(this.state.selectedTowerUid, hit.data.padIndex);
        }
        else {
          const tower = towerByPad(this.state, hit.data.padIndex);
          if (tower) this.selectOrMergeTower(tower.uid);
        }
        break;
      case 'tower':
        this.selectOrMergeTower(hit.data.towerUid);
        break;
      case 'reclaim':
        if (this.state.selectedTowerUid) this.reclaimTower(this.state.selectedTowerUid);
        break;
      case 'start-wave':
        if (this.state.waveBreak > 0) skipTowerDefenseBreak(this.state);
        else startNextTowerDefenseWave(this.state);
        this.processEvents();
        break;
      case 'battle-menu':
        returnToTowerDefenseMenu(this.state);
        this.selectedCardUid = null;
        this.save();
        break;
      case 'replay':
        replayTowerDefenseRun(this.state);
        this.selectedCardUid = null;
        this.eventCursor = 0;
        break;
      case 'result-menu':
        returnToTowerDefenseMenu(this.state);
        this.selectedCardUid = null;
        this.save();
        break;
      case 'next-stage': {
        const stage = stageForState(this.state);
        const next = TD_STAGES[stage.index];
        if (next) beginTowerDefenseRun(this.state, { mode: 'stage', stageId: next.id });
        else returnToTowerDefenseMenu(this.state);
        this.selectedCardUid = null;
        this.eventCursor = 0;
        break;
      }
      default:
        break;
    }
  }

  endlessUnlocked() {
    return this.state.progress.clearedStages.includes('stage-3');
  }

  resetTransform() {
    const ctx = this.ctx;
    if (typeof ctx.setTransform === 'function') {
      ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    } else if (typeof ctx.resetTransform === 'function') {
      ctx.resetTransform();
      ctx.scale(this.pixelRatio, this.pixelRatio);
    }
  }

  render() {
    const ctx = this.ctx;
    this.hits = [];
    this.resetTransform();
    ctx.save();
    ctx.fillStyle = '#D9EEE2';
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    if (this.state.screen === 'menu') this.drawMenu(ctx);
    else if (this.state.screen === 'result') this.drawResult(ctx);
    else this.drawBattle(ctx);
    if (this.state.tutorial.active) this.drawTutorial(ctx);
    ctx.restore();
    return this;
  }

  drawBackdrop(ctx, stageId = 'stage-1') {
    const background = ctx.createLinearGradient(0, 0, TD_VIEW.width, TD_VIEW.height);
    background.addColorStop(0, '#C7EAD4');
    background.addColorStop(0.52, '#E9E7C5');
    background.addColorStop(1, '#BBDDE4');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    const key = STAGE_REGION_ASSET[stageId] || STAGE_REGION_ASSET['stage-1'];
    drawAssetOrFallback(ctx, this.assetStore, key, (asset) => {
      ctx.globalAlpha *= 0.72;
      ctx.drawImage(asset, -70, -40, 1080, 810);
    }, () => {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#55AE80';
      for (let index = 0; index < 22; index += 1) {
        const x = (index * 173) % 960;
        const y = (index * 97) % 720;
        ctx.beginPath();
        ctx.arc(x, y, 22 + (index % 4) * 8, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  menuStoryStage() {
    if (this.state.tutorial.active) return TD_STAGES[0];
    const unlocked = TD_STAGES.filter((stage) => (
      stage.index <= this.state.progress.unlockedStage
    ));
    const uncleared = unlocked.filter((stage) => (
      !this.state.progress.clearedStages.includes(stage.id)
    ));
    return uncleared.at(-1) || unlocked.at(-1) || TD_STAGES[0];
  }

  drawMenu(ctx) {
    ctx.fillStyle = '#CBE8D0';
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    drawAssetOrFallback(ctx, this.assetStore, 'background-garden-base', (asset) => {
      ctx.drawImage(asset, 0, 0, TD_VIEW.width, TD_VIEW.height);
    }, () => this.drawBackdrop(ctx, 'stage-1'));
    drawAssetOrFallback(ctx, this.assetStore, 'background-cloud-overlay', (asset) => {
      ctx.globalAlpha *= 0.24;
      const drift = Math.sin(this.state.time * 0.08) * 20;
      ctx.drawImage(asset, -18 + drift, -18, 1316, 438);
    }, () => {});

    const wash = ctx.createLinearGradient(0, 0, 0, TD_VIEW.height);
    wash.addColorStop(0, 'rgba(255, 251, 231, 0.42)');
    wash.addColorStop(0.64, 'rgba(232, 247, 221, 0.18)');
    wash.addColorStop(1, 'rgba(57, 98, 87, 0.2)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);

    label(ctx, '史莱姆融合塔防', TD_VIEW.width / 2, 58, {
      size: 42, color: COLORS.ink, weight: 950,
    });
    TD_STAGES.forEach((stage, index) => {
      const x = 612 + index * 28;
      const cleared = this.state.progress.clearedStages.includes(stage.id);
      const unlocked = stage.index <= this.state.progress.unlockedStage;
      ctx.save();
      if (unlocked && !cleared) {
        ctx.shadowColor = stage.accent;
        ctx.shadowBlur = 11;
      }
      ctx.beginPath();
      ctx.arc(x, 108, 7, 0, TAU);
      ctx.fillStyle = cleared ? stage.accent : unlocked ? '#FFF8DF' : '#AAB5AF';
      ctx.fill();
      ctx.strokeStyle = unlocked ? stage.accent : '#87948E';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    });

    const corePulse = 1 + Math.sin(this.state.time * 1.8) * 0.018;
    ctx.save();
    ctx.translate(640, 314);
    ctx.scale(corePulse, corePulse);
    const halo = ctx.createRadialGradient(0, 0, 18, 0, 0, 164);
    halo.addColorStop(0, 'rgba(214, 255, 236, 0.58)');
    halo.addColorStop(0.55, 'rgba(105, 217, 183, 0.22)');
    halo.addColorStop(1, 'rgba(105, 217, 183, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.ellipse(0, 0, 164, 132, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    const ringPhase = (this.state.time % 3) / 3;
    ctx.save();
    ctx.globalAlpha = (1 - ringPhase) * 0.18;
    ctx.strokeStyle = '#D8FFE9';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(640, 314, 95 + ringPhase * 80, 74 + ringPhase * 62, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

    drawCore(ctx, 640, 414, 260, {
      time: this.state.time,
      health: 1,
      assetStore: this.assetStore,
    });

    const squad = [
      { type: 'shell', x: 360, y: 486, size: 142, facing: 1 },
      { type: 'bubble', x: 505, y: 498, size: 132, facing: 1 },
      { type: 'sprout', x: 775, y: 498, size: 132, facing: -1 },
      { type: 'needle', x: 920, y: 486, size: 142, facing: -1 },
    ];
    squad.forEach((member, index) => {
      const tower = TOWER_TYPES[member.type];
      const animation = this.characterAnimationSample(
        'preview:menu:' + tower.id,
        tower.ownerId,
      );
      drawSlime(ctx, member.x, member.y, member.size, member.type, {
        time: this.state.time + index * 0.22,
        facing: member.facing,
        assetStore: this.assetStore,
        ...animation,
        ...this.characterRigOptions(tower.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
    });

    const storyStage = this.menuStoryStage();
    const storyRect = MENU_ACTIONS.story;
    const storyHot = Boolean(this.hoverPoint && insideRect(this.hoverPoint, storyRect));
    panel(ctx, storyRect, {
      fill: storyHot ? '#75DDB0' : '#64D3A0',
      stroke: storyHot ? '#176E59' : COLORS.mintDeep,
      lineWidth: storyHot ? 5 : 3,
      radius: 32,
      shadow: true,
    });
    label(ctx, '开始闯关', storyRect.x + storyRect.width / 2 - 20,
      storyRect.y + storyRect.height / 2, {
        size: 32, color: COLORS.white, weight: 950,
      });
    const allCleared = TD_STAGES.every((stage) => (
      this.state.progress.clearedStages.includes(stage.id)
    ));
    ctx.save();
    ctx.beginPath();
    ctx.arc(storyRect.x + storyRect.width - 54,
      storyRect.y + storyRect.height / 2, 28, 0, TAU);
    ctx.fillStyle = '#FFF4C8';
    ctx.fill();
    ctx.strokeStyle = '#2C8B6E';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
    label(ctx, allCleared ? '3↻' : String(storyStage.index),
      storyRect.x + storyRect.width - 54,
      storyRect.y + storyRect.height / 2, {
        size: allCleared ? 18 : 24, color: COLORS.mintDeep, weight: 950,
      });
    this.addHit('start-story', storyRect, 'stage', {
      stageId: storyStage.id,
      stageIndex: storyStage.index - 1,
    });

    const endlessUnlocked = this.endlessUnlocked();
    const endlessRect = MENU_ACTIONS.endless;
    const endlessHot = endlessUnlocked
      && Boolean(this.hoverPoint && insideRect(this.hoverPoint, endlessRect));
    panel(ctx, endlessRect, {
      fill: endlessUnlocked
        ? endlessHot ? '#9388EC' : '#8175DC'
        : '#CED5D1',
      stroke: endlessUnlocked ? '#4F438E' : '#929E98',
      lineWidth: endlessHot ? 5 : 3,
      radius: 32,
      shadow: endlessUnlocked,
    });
    label(ctx, endlessUnlocked ? '∞  无尽模式' : '锁  无尽模式',
      endlessRect.x + endlessRect.width / 2,
      endlessRect.y + endlessRect.height / 2 - (endlessUnlocked ? 0 : 8), {
        size: endlessUnlocked ? 27 : 24,
        color: endlessUnlocked ? COLORS.white : '#75817B',
        weight: 950,
      });
    if (!endlessUnlocked) {
      label(ctx, '3 ✓', endlessRect.x + endlessRect.width / 2,
        endlessRect.y + endlessRect.height - 22, {
          size: 13, color: '#75817B', weight: 850,
        });
    }
    this.addHit('endless', endlessRect, 'endless', {}, endlessUnlocked);
  }
  drawBattle(ctx) {
    const stage = stageForState(this.state);
    ctx.save();
    if (this.shake > 0) {
      ctx.translate(
        Math.sin(this.state.time * 62) * this.shake,
        Math.cos(this.state.time * 47) * this.shake * 0.55,
      );
    }
    this.drawBattlefield(ctx, stage);
    ctx.restore();
    this.drawSidebar(ctx, stage);
    this.drawDragPreview(ctx);
  }

  drawBattlefield(ctx, stage) {
    this.drawBackdrop(ctx, stage.id);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,245,0.14)';
    ctx.fillRect(0, 0, TD_FIELD.width, TD_FIELD.height);
    ctx.restore();

    label(ctx, this.state.mode === 'endless' ? '无尽' : stage.name, 30, 28, {
      size: 24, align: 'left', color: COLORS.ink, weight: 900,
    });
    this.drawPath(ctx, stage.path);

    const start = stage.path[0];
    drawParticle(ctx, start.x, start.y - 4, 45, 'ring', {
      time: this.state.time,
      progress: (this.state.time * 0.35) % 1,
      alpha: 0.45,
      color: COLORS.crystal,
      assetStore: this.assetStore,
    });

    const end = stage.path.at(-1);
    drawCore(ctx, Math.min(TD_FIELD.width - 28, end.x + 28), end.y + 18, 96, {
      health: this.state.coreHp / Math.max(1, this.state.coreMaxHp),
      time: this.state.time,
      hit: this.shake > 0 ? 1 : 0,
      assetStore: this.assetStore,
    });

    if (this.state.selectedTowerUid) {
      const selected = this.state.towers.find((tower) => tower.uid === this.state.selectedTowerUid);
      const pad = selected && stage.pads[selected.padIndex];
      if (selected && pad) {
        ctx.save();
        ctx.globalAlpha = 0.11;
        ctx.fillStyle = TOWER_TYPES[selected.type].color;
        ctx.beginPath();
        ctx.arc(pad.x, pad.y, towerRange(this.state, selected), 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = TOWER_TYPES[selected.type].color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }

    stage.pads.forEach((pad, padIndex) => this.drawPad(ctx, pad, padIndex));
    [...this.state.enemies]
      .sort((left, right) => left.y - right.y || left.travelled - right.travelled)
      .forEach((enemy) => this.drawEnemy(ctx, enemy));
    this.drawDefeatedActors(ctx);
    this.state.projectiles.forEach((projectile) => this.drawShot(ctx, projectile));
    this.drawEffects(ctx);
  }

  drawPath(ctx, points) {
    for (let index = 1; index < points.length; index += 1) {
      const left = points[index - 1];
      const right = points[index];
      const dx = right.x - left.x;
      const dy = right.y - left.y;
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      drawAssetOrFallback(ctx, this.assetStore, 'tile-route-open', (asset) => {
        ctx.translate((left.x + right.x) / 2, (left.y + right.y) / 2);
        ctx.rotate(angle);
        ctx.globalAlpha *= 0.72;
        ctx.drawImage(asset, -length / 2 - 8, -20, length + 16, 40);
      }, () => {
        ctx.save();
        ctx.strokeStyle = 'rgba(76, 143, 105, 0.38)';
        ctx.lineWidth = 28;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 226, 0.62)';
        ctx.lineWidth = 4;
        ctx.setLineDash?.([11, 12]);
        ctx.stroke();
        ctx.restore();
      });
    }
  }

  drawPad(ctx, pad, padIndex) {
    const tower = towerByPad(this.state, padIndex);
    const target = tutorialTargetForState(this.state);
    const tutorialPad = target?.type === 'pad' && target.padIndex === padIndex;
    const activeCardUid = this.drag?.kind === 'card' ? this.drag.uid : this.selectedCardUid;
    const activeCard = this.state.hand.find((card) => card.uid === activeCardUid);
    const activeTowerUid = this.drag?.kind === 'tower'
      ? this.drag.uid
      : (!activeCard ? this.state.selectedTowerUid : null);
    const activeTower = this.state.towers.find((candidate) => candidate.uid === activeTowerUid);
    let dropIntent = null;
    if (activeCard) {
      if (!tower) dropIntent = 'place';
      else if (canMergeCardIntoTower(activeCard, tower)) dropIntent = 'merge';
    } else if (activeTower && activeTower.uid !== tower?.uid) {
      if (!tower) dropIntent = 'move';
      else if (canMergeTowers(activeTower, tower)) dropIntent = 'merge';
    }
    const hoverRect = {
      x: pad.x - PAD_RADIUS,
      y: pad.y - PAD_RADIUS,
      width: PAD_RADIUS * 2,
      height: PAD_RADIUS * 2,
    };
    const hot = Boolean(this.drag?.moved && this.hoverPoint && insideRect(this.hoverPoint, hoverRect));
    const pulse = 1 + Math.sin(this.state.time * 6 + padIndex) * 0.055;
    const visualRadius = dropIntent ? PAD_RADIUS * pulse : PAD_RADIUS;
    ctx.save();
    ctx.globalAlpha = dropIntent ? (hot ? 0.94 : 0.72) : tower ? 0.34 : tutorialPad ? 0.72 : 0.48;
    ctx.fillStyle = dropIntent === 'merge'
      ? '#FFE59A'
      : dropIntent === 'move'
        ? '#D8EFFF'
        : dropIntent === 'place'
          ? '#D8F6D9'
          : tower ? '#D8F2DC' : '#FFF8DA';
    ctx.strokeStyle = tutorialPad
      ? COLORS.gold
      : dropIntent === 'merge'
        ? '#D79B26'
        : dropIntent === 'move'
          ? '#4E9CC9'
          : dropIntent === 'place'
            ? COLORS.mintDeep
            : '#668B78';
    ctx.lineWidth = tutorialPad || dropIntent ? (hot ? 7 : 5) : 2.5;
    ctx.beginPath();
    ctx.ellipse(pad.x, pad.y + 4, visualRadius, visualRadius * 0.48, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    if (dropIntent === 'merge') {
      ctx.globalAlpha *= 0.68;
      ctx.beginPath();
      ctx.ellipse(pad.x, pad.y + 4, visualRadius + 9, (visualRadius + 9) * 0.48, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();

    this.addHit(`pad-${padIndex}`, {
      x: pad.x - PAD_RADIUS, y: pad.y - PAD_RADIUS,
      width: PAD_RADIUS * 2, height: PAD_RADIUS * 2,
    }, 'pad', { padIndex });

    if (!tower) return;
    const definition = TOWER_TYPES[tower.type];
    const selected = tower.uid === this.state.selectedTowerUid;
    const animation = this.characterAnimationSample(
      `tower:${tower.uid}`,
      definition.ownerId,
    );
    drawSlime(ctx, pad.x, pad.y + 6, 88 + tower.star * 2, tower.type, {
      time: this.state.time,
      phase: padIndex * 0.41,
      star: tower.star,
      facing: Math.cos(tower.aimAngle || 0) >= 0 ? 1 : -1,
      selected,
      assetStore: this.assetStore,
      ...animation,
      ...this.characterRigOptions(definition.ownerId),
      allowGeneratedStandalone: this.generatedCharacterArtEnabled,
    });
    this.drawStars(ctx, pad.x, pad.y - 78, tower.star, definition.color);
    if (dropIntent === 'merge') {
      panel(ctx, { x: pad.x - 24, y: pad.y - 116, width: 48, height: 28 }, {
        fill: '#F4C94C', stroke: '#9B6E20', lineWidth: 2, radius: 14,
      });
      label(ctx, `★${tower.star + 1}`, pad.x, pad.y - 101, {
        size: 13, color: COLORS.ink, weight: 950,
      });
    }
    this.addHit(`tower-${tower.uid}`, {
      x: pad.x - PAD_RADIUS, y: pad.y - 82,
      width: PAD_RADIUS * 2, height: 96,
    }, 'tower', { towerUid: tower.uid, padIndex });
  }

  drawStars(ctx, x, y, count, color) {
    const gap = 13;
    const startX = x - (count - 1) * gap / 2;
    for (let index = 0; index < count; index += 1) {
      ctx.save();
      ctx.translate(startX + index * gap, y);
      ctx.fillStyle = color;
      ctx.strokeStyle = COLORS.white;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let point = 0; point < 10; point += 1) {
        const angle = -Math.PI / 2 + point * Math.PI / 5;
        const radius = point % 2 === 0 ? 7 : 3.2;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (point === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  drawEnemy(ctx, enemy) {
    const definition = TD_ENEMIES[enemy.type] || TD_ENEMIES.bug;
    const type = MONSTER_DRAW_TYPE[enemy.type] || 'bug';
    const animation = this.characterAnimationSample(
      `enemy:${enemy.uid}`,
      definition.ownerId,
      'move',
    );
    drawMonster(ctx, enemy.x, enemy.y + definition.size * 0.33, definition.size, type, {
      time: this.state.time,
      phase: Number(enemy.uid.split('-').at(-1)) * 0.31 || 0,
      facing: enemy.facing,
      hit: enemy.hitPulse,
      expression: enemy.hitPulse > 0.35 ? 'hurt' : 'normal',
      assetStore: this.assetStore,
      ...animation,
      ...this.characterRigOptions(definition.ownerId),
      allowGeneratedStandalone: this.generatedCharacterArtEnabled,
    });
    const width = definition.boss ? 82 : 52;
    const ratio = clamp(enemy.hp / Math.max(1, enemy.maxHp), 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(38,51,60,0.56)';
    roundedPath(ctx, enemy.x - width / 2, enemy.y - definition.size * 0.72, width, 7, 4);
    ctx.fill();
    if (ratio > 0) {
      ctx.fillStyle = ratio < 0.3 ? COLORS.coral : '#74CF7A';
      roundedPath(ctx, enemy.x - width / 2 + 1, enemy.y - definition.size * 0.72 + 1,
        Math.max(2, (width - 2) * ratio), 5, 3);
      ctx.fill();
    }
    ctx.restore();
  }

  drawDefeatedActors(ctx) {
    for (const actor of this.defeatedActors) {
      const definition = TD_ENEMIES[actor.type] || TD_ENEMIES.bug;
      const type = MONSTER_DRAW_TYPE[actor.type] || 'bug';
      const animation = this.characterAnimationSample(
        actor.key,
        actor.ownerId,
        'move',
      );
      const fadeStart = actor.duration * 0.72;
      const alpha = actor.age <= fadeStart
        ? 1
        : clamp(1 - (actor.age - fadeStart) / Math.max(0.001, actor.duration - fadeStart), 0, 1);
      drawMonster(ctx, actor.x, actor.y + definition.size * 0.33, definition.size, type, {
        time: this.state.time,
        facing: actor.facing,
        alpha,
        assetStore: this.assetStore,
        ...animation,
        ...this.characterRigOptions(actor.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
    }
  }

  drawShot(ctx, projectile) {
    const angle = Math.atan2(projectile.targetY - projectile.y, projectile.targetX - projectile.x);
    const star = clamp(Math.floor(projectile.star || 1), 1, TD_MAX_STAR);
    const baseSize = projectile.type === 'needle' ? 19 : 16;
    const evolvedSize = (baseSize + (star - 1) * 1.8) * (projectile.secondary ? 0.82 : 1);
    drawProjectile(ctx, projectile.x, projectile.y, evolvedSize,
      projectile.type, {
        angle,
        star,
        alpha: projectile.secondary ? 0.82 : 1,
        progress: clamp(projectile.age / 1.2, 0, 1),
        assetStore: this.assetStore,
      });
  }

  drawEffects(ctx) {
    for (const effect of this.state.effects) {
      const progress = clamp(effect.phase ?? effect.age / effect.duration, 0, 1);
      if (effect.type === 'merge') {
        for (let index = 0; index < 4; index += 1) {
          const orbit = fusionOrbitPoint(effect, index * TAU / 4);
          drawParticle(ctx, orbit.x, orbit.y, 18, index % 2 ? 'spark' : 'goo', {
            progress,
            alpha: 1 - progress * 0.72,
            assetStore: this.assetStore,
          });
        }
        drawParticle(ctx, effect.x, effect.y - 22, 48, 'ring', {
          progress,
          alpha: 1 - progress,
          assetStore: this.assetStore,
        });
        continue;
      }
      const type = {
        summon: 'goo', place: 'ring', spawn: 'ring', defeat: 'dust',
        reclaim: 'bubble', 'move-out': 'ring',
        hit: 'spark', 'bubble-hit': 'bubble', 'leaf-hit': 'leaf', 'core-hit': 'spark',
      }[effect.type] || 'spark';
      const effectStar = clamp(Math.floor(effect.star || 1), 1, TD_MAX_STAR);
      const baseSize = effect.type === 'defeat' ? 44 : effect.type === 'spawn' ? 36 : 27;
      const size = baseSize * (1 + (effectStar - 1) * 0.11);
      drawParticle(ctx, effect.x, effect.y, size, type, {
        progress,
        alpha: (effect.secondary ? 0.72 : 1) * (1 - progress * 0.78),
        rotation: progress * 1.6,
        assetStore: this.assetStore,
      });
      if (effectStar >= 3 && ['hit', 'bubble-hit', 'leaf-hit'].includes(effect.type)) {
        const satellites = effectStar - 2;
        for (let index = 0; index < satellites; index += 1) {
          const angle = progress * 3.2 + index * TAU / satellites;
          drawParticle(ctx,
            effect.x + Math.cos(angle) * (12 + progress * 18),
            effect.y + Math.sin(angle) * (8 + progress * 12),
            11 + effectStar * 2,
            type, {
              progress,
              alpha: (1 - progress) * 0.58,
              assetStore: this.assetStore,
            });
        }
      }
    }
  }

  drawSidebar(ctx, stage) {
    drawDockShell(ctx, stage, this.state.time);
    drawAssetOrFallback(ctx, this.assetStore, 'ui-soft-crystal', (asset) => {
      ctx.globalAlpha *= 0.12;
      ctx.drawImage(asset, 1172, -20, 112, 112);
    }, () => {});

    button(ctx, COMMAND_DOCK.back, '‹', {
      fill: '#F5F3DF', color: COLORS.ink, accent: '#8EB2A1', size: 32,
    });
    this.addHit('battle-menu', COMMAND_DOCK.back, 'battle-menu');

    const modeText = this.state.mode === 'endless'
      ? `∞${Math.max(1, this.state.wave)}`
      : `${this.state.wave}/${stage.waves.length}`;
    panel(ctx, COMMAND_DOCK.wave, {
      fill: '#F8F2DA', stroke: stage.accent, lineWidth: 3, radius: 18,
    });
    label(ctx, modeText, COMMAND_DOCK.wave.x + COMMAND_DOCK.wave.width / 2,
      COMMAND_DOCK.wave.y + COMMAND_DOCK.wave.height / 2, {
        size: 21, color: COLORS.ink, weight: 900,
      });

    const enemyCount = this.state.enemies.length + this.state.spawnQueue.length;
    panel(ctx, COMMAND_DOCK.enemies, {
      fill: '#E8E7D8', stroke: 'rgba(255,255,255,0.32)', radius: 18,
    });
    label(ctx, `×${enemyCount}`, COMMAND_DOCK.enemies.x + COMMAND_DOCK.enemies.width / 2,
      COMMAND_DOCK.enemies.y + COMMAND_DOCK.enemies.height / 2, {
        size: 18, color: enemyCount ? COLORS.coral : COLORS.inkSoft, weight: 900,
      });

    panel(ctx, COMMAND_DOCK.currency, {
      fill: '#EAF7DB', stroke: '#80B668', radius: 18,
    });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-gel-energy', (asset) => {
      ctx.drawImage(asset, COMMAND_DOCK.currency.x + 4, COMMAND_DOCK.currency.y + 6, 38, 38);
    }, () => {
      ctx.fillStyle = COLORS.mint;
      ctx.beginPath();
      ctx.arc(COMMAND_DOCK.currency.x + 23, COMMAND_DOCK.currency.y + 25, 14, 0, TAU);
      ctx.fill();
    });
    label(ctx, this.state.currency, COMMAND_DOCK.currency.x + COMMAND_DOCK.currency.width - 9,
      COMMAND_DOCK.currency.y + COMMAND_DOCK.currency.height / 2 + 1, {
        size: 18, align: 'right', color: COLORS.ink, weight: 900,
      });

    const hpRatio = clamp(this.state.coreHp / Math.max(1, this.state.coreMaxHp), 0, 1);
    panel(ctx, COMMAND_DOCK.core, {
      fill: '#182F37', stroke: 'rgba(255,255,255,0.22)', radius: 15,
    });
    ctx.save();
    roundedPath(ctx, COMMAND_DOCK.core.x + 4, COMMAND_DOCK.core.y + 4,
      Math.max(0, (COMMAND_DOCK.core.width - 8) * hpRatio), COMMAND_DOCK.core.height - 8, 11);
    ctx.fillStyle = hpRatio < 0.3 ? COLORS.coral : COLORS.mint;
    ctx.fill();
    ctx.restore();
    label(ctx, `♥  ${this.state.coreHp}`, COMMAND_DOCK.core.x + COMMAND_DOCK.core.width / 2,
      COMMAND_DOCK.core.y + COMMAND_DOCK.core.height / 2 + 1, {
        size: 17, color: COLORS.white, weight: 900,
      });

    for (let index = 0; index < COMMAND_DOCK.cards.length; index += 1) {
      const rect = COMMAND_DOCK.cards[index];
      const card = this.state.hand[index];
      if (!card) {
        panel(ctx, rect, {
          fill: 'rgba(238, 240, 220, 0.16)',
          stroke: 'rgba(220, 246, 226, 0.24)', radius: 24,
        });
        drawAssetOrFallback(ctx, this.assetStore, 'ui-card-frame-common', (asset) => {
          ctx.globalAlpha *= 0.12;
          ctx.drawImage(asset, rect.x, rect.y, rect.width, rect.height);
        }, () => {});
        ctx.save();
        ctx.globalAlpha = 0.2;
        ctx.strokeStyle = '#DDF4DA';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(rect.x + rect.width / 2, rect.y + rect.height / 2 + 12, 27, 14, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      const mergeReady = this.state.towers.some((tower) => canMergeCardIntoTower(card, tower));
      this.drawHandCard(ctx, card, rect, {
        selected: card.uid === this.selectedCardUid,
        mergeReady,
        dragging: this.drag?.kind === 'card' && this.drag.uid === card.uid && this.drag.moved,
      });
      this.addHit(`card-${card.uid}`, rect, 'card', { cardUid: card.uid });
    }

    this.drawSelectionPanel(ctx);

    const drawCost = drawCostForState(this.state);
    const canDraw = !this.state.result
      && this.state.hand.length < 4
      && this.state.currency >= drawCost;
    button(ctx, COMMAND_DOCK.draw, `抽  ${drawCost}`, {
      enabled: canDraw,
      fill: COLORS.mint,
      accent: COLORS.mintDeep,
      size: 25,
    });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-gel-energy', (asset) => {
      ctx.globalAlpha *= canDraw ? 0.96 : 0.35;
      ctx.drawImage(asset, COMMAND_DOCK.draw.x + 72, COMMAND_DOCK.draw.y + 15, 42, 42);
    }, () => {});
    this.addHit('draw', COMMAND_DOCK.draw, 'draw', {}, canDraw);

    const reclaimableTower = this.state.towers.find((tower) => (
      tower.uid === (this.drag?.kind === 'tower' ? this.drag.uid : this.state.selectedTowerUid)
    ));
    const canReclaim = Boolean(reclaimableTower)
      && this.state.hand.length < 4;
    const reclaimHot = this.drag?.kind === 'tower'
      && this.drag.moved
      && insideRect(this.drag.point, COMMAND_DOCK.reclaim);
    button(ctx, COMMAND_DOCK.reclaim, canReclaim ? '↩' : '·', {
      enabled: canReclaim,
      selected: reclaimHot,
      fill: '#E6DCA8',
      color: COLORS.ink,
      accent: '#B98C3A',
      size: 32,
    });
    if (canReclaim) label(ctx, '收', COMMAND_DOCK.reclaim.x + COMMAND_DOCK.reclaim.width / 2,
      COMMAND_DOCK.reclaim.y + COMMAND_DOCK.reclaim.height - 13, {
        size: 12, color: reclaimHot ? COLORS.white : COLORS.inkSoft, weight: 900,
      });
    this.addHit('reclaim', COMMAND_DOCK.reclaim, 'reclaim', {}, canReclaim);

    const canStart = !this.state.waveActive
      && !(this.state.mode === 'stage' && this.state.wave >= stage.waves.length);
    const startText = this.state.waveActive
      ? `●  ${this.state.wave}`
      : this.state.waveBreak > 0
        ? `≫  ${this.state.wave + 1}`
        : this.state.wave === 0 ? '▶  1' : `▶  ${this.state.wave + 1}`;
    button(ctx, COMMAND_DOCK.start, startText, {
      enabled: canStart,
      fill: '#F0B84E',
      accent: '#B87728',
      size: 27,
    });
    this.addHit('start-wave', COMMAND_DOCK.start, 'start-wave', {}, canStart);
  }

  drawSelectionPanel(ctx) {
    const selectedTower = this.state.towers.find((tower) => tower.uid === this.state.selectedTowerUid);
    const selectedCard = this.state.hand.find((card) => card.uid === this.selectedCardUid);
    panel(ctx, COMMAND_DOCK.selection, {
      fill: 'rgba(248, 246, 222, 0.94)',
      stroke: selectedTower || selectedCard ? '#8ED7A7' : 'rgba(255,255,255,0.24)',
      lineWidth: selectedTower || selectedCard ? 3 : 2,
      radius: 24,
    });

    if (selectedTower) {
      const definition = TOWER_TYPES[selectedTower.type];
      const animation = this.characterAnimationSample(
        `tower:${selectedTower.uid}`,
        definition.ownerId,
      );
      drawSlime(ctx, COMMAND_DOCK.selection.x + 43, COMMAND_DOCK.selection.y + 76,
        54, selectedTower.type, {
          time: this.state.time,
          star: selectedTower.star,
          assetStore: this.assetStore,
          ...animation,
          ...this.characterRigOptions(definition.ownerId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
        });
      label(ctx, definition.name, COMMAND_DOCK.selection.x + 82,
        COMMAND_DOCK.selection.y + 24, {
          size: 20, align: 'left', color: COLORS.ink, weight: 900,
        });
      label(ctx, '★'.repeat(selectedTower.star), COMMAND_DOCK.selection.x + 82,
        COMMAND_DOCK.selection.y + 49, {
          size: 15, align: 'left', color: definition.color, weight: 900,
        });
      const evolution = towerAttackEvolution(selectedTower.type, selectedTower.star);
      const attackName = ATTACK_MODE_LABEL[evolution.attackMode] || definition.glyph;
      label(ctx, `${attackName}  ·  ↔`, COMMAND_DOCK.selection.x + COMMAND_DOCK.selection.width - 18,
        COMMAND_DOCK.selection.y + 47, {
          size: 15, align: 'right', color: COLORS.inkSoft, weight: 800,
        });
      return;
    }

    if (selectedCard) {
      const definition = TOWER_TYPES[selectedCard.type];
      const matches = this.state.towers.filter((tower) => canMergeCardIntoTower(selectedCard, tower));
      label(ctx, definition.glyph, COMMAND_DOCK.selection.x + 34,
        COMMAND_DOCK.selection.y + COMMAND_DOCK.selection.height / 2, {
          size: 28, color: definition.color, weight: 950,
        });
      label(ctx, definition.name, COMMAND_DOCK.selection.x + 68,
        COMMAND_DOCK.selection.y + 31, {
          size: 20, align: 'left', color: COLORS.ink, weight: 900,
        });
      label(ctx, matches.length ? `融  ${matches.length}` : '放', COMMAND_DOCK.selection.x + 68,
        COMMAND_DOCK.selection.y + 59, {
          size: 16, align: 'left', color: matches.length ? COLORS.gold : COLORS.inkSoft, weight: 900,
        });
      label(ctx, '★'.repeat(selectedCard.star), COMMAND_DOCK.selection.x + COMMAND_DOCK.selection.width - 20,
        COMMAND_DOCK.selection.y + 45, {
          size: 17, align: 'right', color: definition.color, weight: 900,
        });
      return;
    }

    Object.values(TOWER_TYPES).forEach((tower, index) => {
      const x = COMMAND_DOCK.selection.x + 42 + index * 78;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = tower.color;
      ctx.beginPath();
      ctx.arc(x, COMMAND_DOCK.selection.y + 34, 16, 0, TAU);
      ctx.fill();
      ctx.restore();
      label(ctx, tower.glyph, x, COMMAND_DOCK.selection.y + 34, {
        size: 15, color: COLORS.white, weight: 950,
      });
      const rate = { shell: 28, needle: 28, bubble: 24, sprout: 20 }[tower.id];
      label(ctx, `${rate}%`, x, COMMAND_DOCK.selection.y + 65, {
        size: 13, color: COLORS.inkSoft, weight: 800,
      });
    });
  }

  drawHandCard(ctx, card, rect, { selected = false, mergeReady = false, dragging = false } = {}) {
    const definition = TOWER_TYPES[card.type];
    ctx.save();
    if (dragging) ctx.globalAlpha *= 0.42;
    panel(ctx, rect, {
      fill: selected ? '#E9FFF1' : mergeReady ? '#FFF4C9' : '#FFF9E9',
      stroke: selected ? COLORS.mintDeep : mergeReady ? COLORS.gold : '#A8B7A8',
      lineWidth: selected || mergeReady ? 4 : 2,
      radius: 24,
      shadow: selected,
    });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-card-frame-common', (asset) => {
      ctx.globalAlpha *= 0.38;
      ctx.drawImage(asset, rect.x, rect.y, rect.width, rect.height);
    }, () => {});
    const animation = this.characterAnimationSample(
      `card:${card.uid}`,
      definition.ownerId,
    );
    drawSlime(ctx, rect.x + rect.width / 2, rect.y + rect.height - 6, 82, card.type, {
      time: this.state.time,
      star: card.star,
      facing: 1,
      assetStore: this.assetStore,
      ...animation,
      ...this.characterRigOptions(definition.ownerId),
      allowGeneratedStandalone: this.generatedCharacterArtEnabled,
    });
    label(ctx, definition.name, rect.x + 13, rect.y + 20, {
      size: 17, align: 'left', color: COLORS.ink, weight: 900,
    });
    label(ctx, '★'.repeat(card.star), rect.x + rect.width - 12, rect.y + 20, {
      size: 14, align: 'right', color: definition.color, weight: 900,
    });
    if (mergeReady) {
      panel(ctx, { x: rect.x + rect.width - 42, y: rect.y + rect.height - 41, width: 32, height: 32 }, {
        fill: '#F4C94C', stroke: '#A87922', lineWidth: 2, radius: 16,
      });
      label(ctx, '融', rect.x + rect.width - 26, rect.y + rect.height - 24, {
        size: 15, color: COLORS.ink, weight: 950,
      });
    }
    ctx.restore();
  }

  drawDragPreview(ctx) {
    if (!this.drag?.moved || !this.drag.point) return;
    if (this.drag.kind === 'card') {
      const card = this.state.hand.find((candidate) => candidate.uid === this.drag.uid);
      const definition = card && TOWER_TYPES[card.type];
      if (!card || !definition) return;
      const animation = this.characterAnimationSample(
        `card:${card.uid}`,
        definition.ownerId,
      );
      ctx.save();
      ctx.globalAlpha = 0.8;
      drawSlime(ctx, this.drag.point.x, this.drag.point.y + 28, 76, card.type, {
        time: this.state.time,
        star: card.star,
        assetStore: this.assetStore,
        ...animation,
        ...this.characterRigOptions(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
      ctx.restore();
    }
    if (this.drag.kind === 'tower') {
      const tower = this.state.towers.find((candidate) => candidate.uid === this.drag.uid);
      if (!tower) return;
      const definition = TOWER_TYPES[tower.type];
      const animation = this.characterAnimationSample(
        `tower:${tower.uid}`,
        definition.ownerId,
      );
      ctx.save();
      ctx.strokeStyle = definition.color;
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.58;
      ctx.setLineDash?.([10, 8]);
      const pad = stageForState(this.state).pads[tower.padIndex];
      ctx.beginPath();
      ctx.moveTo(pad.x, pad.y - 24);
      ctx.lineTo(this.drag.point.x, this.drag.point.y);
      ctx.stroke();
      ctx.setLineDash?.([]);
      drawSlime(ctx, this.drag.point.x, this.drag.point.y + 30, 76, tower.type, {
        time: this.state.time,
        star: tower.star,
        assetStore: this.assetStore,
        ...animation,
        ...this.characterRigOptions(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
      this.drawStars(ctx, this.drag.point.x, this.drag.point.y - 42, tower.star, definition.color);
      ctx.restore();
    }
  }

  drawResult(ctx) {
    const stage = stageForState(this.state);
    this.drawBackdrop(ctx, stage.id);
    ctx.save();
    ctx.fillStyle = 'rgba(38, 52, 62, 0.34)';
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    ctx.restore();

    const rect = { x: 365, y: 94, width: 550, height: 532 };
    panel(ctx, rect, {
      fill: '#FFF9EA',
      stroke: this.state.result === 'victory' ? COLORS.mintDeep : COLORS.coral,
      lineWidth: 5,
      radius: 34,
      shadow: true,
    });
    const victory = this.state.result === 'victory';
    label(ctx, victory ? '守住了' : '再来一次', TD_VIEW.width / 2, 174, {
      size: 45,
      color: victory ? COLORS.mintDeep : COLORS.coral,
      weight: 950,
    });

    if (victory) {
      const definition = TOWER_TYPES.shell;
      const animation = this.characterAnimationSample(
        'preview:result:shell',
        definition.ownerId,
      );
      drawSlime(ctx, TD_VIEW.width / 2, 350, 142, 'shell', {
        time: this.state.time,
        star: TD_MAX_STAR,
        assetStore: this.assetStore,
        ...animation,
        ...this.characterRigOptions(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
    } else {
      const definition = TD_ENEMIES.boss;
      const animation = this.characterAnimationSample(
        'preview:result:boss',
        definition.ownerId,
      );
      drawMonster(ctx, TD_VIEW.width / 2, 365, 142, 'boss', {
        time: this.state.time,
        facing: -1,
        assetStore: this.assetStore,
        ...animation,
        ...this.characterRigOptions(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
    }
    label(ctx, `波次 ${this.state.wave}   击破 ${this.state.kills}`, TD_VIEW.width / 2, 404, {
      size: 22, color: COLORS.inkSoft, weight: 750,
    });
    if (this.state.mode === 'endless') {
      label(ctx, `最高 ${this.state.progress.bestEndlessWave}`, TD_VIEW.width / 2, 442, {
        size: 20, color: COLORS.crystal, weight: 800,
      });
    }

    const primaryRect = { x: 430, y: 486, width: 260, height: 76 };
    const menuRect = { x: 710, y: 486, width: 140, height: 76 };
    const nextStage = victory && this.state.mode === 'stage' && TD_STAGES[stage.index];
    button(ctx, primaryRect, nextStage ? '下一关' : '再来', {
      fill: victory ? COLORS.mint : '#E99B72',
      accent: victory ? COLORS.mintDeep : '#A95B45',
      size: 26,
    });
    this.addHit('result-primary', primaryRect, nextStage ? 'next-stage' : 'replay');
    button(ctx, menuRect, '关卡', {
      fill: '#EEF1E8', color: COLORS.ink, accent: '#9EADA5', size: 22,
    });
    this.addHit('result-menu', menuRect, 'result-menu');
  }

  tutorialHoles(target) {
    if (!target) return [];
    if (target.type === 'stage') {
      return [{
        x: MENU_ACTIONS.story.x + MENU_ACTIONS.story.width / 2,
        y: MENU_ACTIONS.story.y + MENU_ACTIONS.story.height / 2,
        radius: 88,
      }];
    }
    if (target.type === 'draw') return [{
      x: COMMAND_DOCK.draw.x + COMMAND_DOCK.draw.width / 2,
      y: COMMAND_DOCK.draw.y + COMMAND_DOCK.draw.height / 2,
      radius: 92,
    }];
    if (target.type === 'pad') {
      const pad = stageForState(this.state).pads[target.padIndex];
      return pad ? [{ x: pad.x, y: pad.y - 8, radius: 72 }] : [];
    }
    if (target.type === 'fusion') {
      const card = this.state.hand[0];
      const cardIndex = card ? this.state.hand.indexOf(card) : -1;
      const cardRect = cardIndex >= 0 ? COMMAND_DOCK.cards[cardIndex] : null;
      const tower = this.state.towers[0];
      const pad = tower ? stageForState(this.state).pads[tower.padIndex] : null;
      const holes = [];
      if (cardRect) holes.push({
        x: cardRect.x + cardRect.width / 2,
        y: cardRect.y + cardRect.height / 2,
        radius: 74,
      });
      if (pad) holes.push({ x: pad.x, y: pad.y - 18, radius: 62 });
      return holes;
    }
    if (target.type === 'start') return [{
      x: COMMAND_DOCK.start.x + COMMAND_DOCK.start.width / 2,
      y: COMMAND_DOCK.start.y + COMMAND_DOCK.start.height / 2,
      radius: 92,
    }];
    return [];
  }

  drawTutorial(ctx) {
    const target = tutorialTargetForState(this.state);
    if (!target) return;
    const holes = this.tutorialHoles(target);
    ctx.save();
    ctx.fillStyle = 'rgba(22, 34, 42, 0.68)';
    ctx.beginPath();
    ctx.rect(0, 0, TD_VIEW.width, TD_VIEW.height);
    for (const hole of holes) {
      ctx.moveTo(hole.x + hole.radius, hole.y);
      ctx.arc(hole.x, hole.y, hole.radius, 0, TAU, true);
    }
    try {
      ctx.fill('evenodd');
    } catch {
      ctx.fill();
    }
    ctx.restore();

    const pulse = 1 + Math.sin(this.state.time * 5) * 0.045;
    for (const hole of holes) {
      ctx.save();
      ctx.strokeStyle = '#FFE577';
      ctx.lineWidth = 6;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, hole.radius * pulse, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (target.type === 'fusion' && holes.length >= 2) {
      const left = holes[0];
      const right = holes[1];
      ctx.save();
      ctx.strokeStyle = '#FFE577';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(left.x, left.y - 70);
      ctx.lineTo(right.x, right.y - 70);
      ctx.stroke();
      const angle = Math.atan2(right.y - left.y, right.x - left.x);
      ctx.translate(right.x, right.y - 70);
      ctx.rotate(angle);
      ctx.fillStyle = '#FFE577';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-20, -12);
      ctx.lineTo(-20, 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (holes.length) {
      let handX = holes[0].x;
      let handY = holes[0].y;
      let handAngle = -0.08;
      if (target.type === 'fusion' && holes.length >= 2) {
        const travel = (Math.sin(this.state.time * 2.8 - Math.PI / 2) + 1) / 2;
        handX = holes[0].x + (holes[1].x - holes[0].x) * travel;
        handY = holes[0].y + (holes[1].y - holes[0].y) * travel - 4;
        handAngle = Math.atan2(holes[1].y - holes[0].y, holes[1].x - holes[0].x) - 0.08;
      } else {
        handY += Math.sin(this.state.time * 5) * 5;
      }
      drawAssetOrFallback(ctx, this.assetStore, 'ui-tutorial-hand', (asset) => {
        ctx.translate(handX, handY);
        ctx.rotate(handAngle);
        ctx.scale(pulse, pulse);
        ctx.drawImage(asset, -25, -22, 96, 96);
      }, () => {
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#FFF1CB';
        ctx.strokeStyle = COLORS.ink;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(handX + 20, handY + 22, 16, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    }

    const focus = holes[0] || { x: TD_VIEW.width / 2, y: TD_VIEW.height / 2, radius: 70 };
    const text = {
      stage: '1', draw: '抽', pad: '放', fusion: '融', start: '战',
    }[target.type] || target.label;
    const bubbleY = focus.y > 520 ? focus.y - focus.radius - 48 : focus.y + focus.radius + 48;
    panel(ctx, { x: focus.x - 34, y: bubbleY - 27, width: 68, height: 54 }, {
      fill: '#FFE577', stroke: '#9B7425', lineWidth: 3, radius: 20, shadow: true,
    });
    label(ctx, text, focus.x, bubbleY + 1, {
      size: 25, color: COLORS.ink, weight: 950,
    });
  }
}

export const SlimeTowerDefenseGame = TowerDefenseGame;
export default TowerDefenseGame;
