import {
  drawAssetOrFallback,
  drawBuilding,
  drawCore,
  drawMonster,
  drawParticle,
  drawPortal,
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
  HERO_TYPES,
  TURRET_TYPES,
  TD_ENEMIES,
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
  setTowerDefenseHeroMovement,
  activateTowerDefenseHeroSkill,
  buyTowerDefenseSquad,
  buildTowerDefenseTurret,
  selectTowerDefenseHero,
  towerAttackEvolution,
  towerByPad,
  towerRange,
  tutorialTargetForState,
  updateTowerDefense,
  summonTowerDefenseContracts,
} from './tower-defense-core.js';

const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
const TAU = Math.PI * 2;
const MAX_DPR = 2;
const PAD_RADIUS = 38;
const DRAG_THRESHOLD = 12;
const BATTLE_FIELD = Object.freeze({ top: 68, bottom: 574, left: 0, right: TD_VIEW.width });
const FALLBACK_LANE_Y = Object.freeze([156, 244, 332, 420, 508]);

const COMMAND_DOCK = Object.freeze({
  back: Object.freeze({ x: 14, y: 10, width: 48, height: 48 }),
  currency: Object.freeze({ x: 76, y: 10, width: 152, height: 48 }),
  core: Object.freeze({ x: 242, y: 14, width: 158, height: 40 }),
  wave: Object.freeze({ x: 414, y: 16, width: 590, height: 36 }),
  enemies: Object.freeze({ x: 1018, y: 10, width: 96, height: 48 }),
  mode: Object.freeze({ x: 1128, y: 10, width: 136, height: 48 }),
  refresh: Object.freeze({ x: 16, y: 582, width: 104, height: 124 }),
  shop: Object.freeze([
    Object.freeze({ x: 132, y: 582, width: 140, height: 124 }),
    Object.freeze({ x: 282, y: 582, width: 140, height: 124 }),
    Object.freeze({ x: 432, y: 582, width: 140, height: 124 }),
  ]),
  handZone: Object.freeze({ x: 588, y: 582, width: 376, height: 124 }),
  purchase: Object.freeze({
    melee: Object.freeze({ x: 180, y: 582, width: 240, height: 124 }),
    ranged: Object.freeze({ x: 432, y: 582, width: 240, height: 124 }),
    turret: Object.freeze({ x: 684, y: 582, width: 240, height: 124 }),
  }),
  cards: Object.freeze([
    Object.freeze({ x: 588, y: 582, width: 88, height: 124 }),
    Object.freeze({ x: 684, y: 582, width: 88, height: 124 }),
    Object.freeze({ x: 780, y: 582, width: 88, height: 124 }),
    Object.freeze({ x: 876, y: 582, width: 88, height: 124 }),
  ]),
  draw: Object.freeze({ x: 16, y: 582, width: 104, height: 124 }),
  reclaim: Object.freeze({ x: 974, y: 596, width: 78, height: 96 }),
  selection: Object.freeze({ x: 974, y: 582, width: 78, height: 124 }),
  start: Object.freeze({ x: 1010, y: 582, width: 254, height: 124 }),
});

const MENU_ACTIONS = Object.freeze({
  story: Object.freeze({ x: 282, y: 565, width: 456, height: 104 }),
  endless: Object.freeze({ x: 762, y: 565, width: 236, height: 104 }),
  summon: Object.freeze({ x: 1018, y: 565, width: 180, height: 104 }),
});

const SUMMON_BACK_RECT = Object.freeze({ x: 36, y: 30, width: 112, height: 58 });
const SUMMON_CURRENCY_RECT = Object.freeze({ x: 1012, y: 28, width: 220, height: 62 });
const SUMMON_CONTRACT_RECTS = Object.freeze([
  Object.freeze({ x: 76, y: 174, width: 250, height: 326 }),
  Object.freeze({ x: 369, y: 174, width: 250, height: 326 }),
  Object.freeze({ x: 662, y: 174, width: 250, height: 326 }),
  Object.freeze({ x: 955, y: 174, width: 250, height: 326 }),
]);
const SUMMON_ONE_RECT = Object.freeze({ x: 370, y: 552, width: 250, height: 92 });
const SUMMON_TEN_RECT = Object.freeze({ x: 660, y: 552, width: 250, height: 92 });
const SUMMON_RESULT_CLOSE_RECT = Object.freeze({ x: 490, y: 620, width: 300, height: 62 });
const HERO_JOYSTICK = Object.freeze({
  x: 108, y: 480, radius: 62,
  hit: Object.freeze({ x: 38, y: 410, width: 140, height: 140 }),
});
const HERO_SKILL_RECT = Object.freeze({ x: 1110, y: 420, width: 116, height: 116 });
const GEL_MORTAR_ASSET_LAYOUT = Object.freeze({
  assetWidthScale: 768 / 723,
  assetGroundAnchorY: 665 / 723,
});

const STAGE_SELECT_CARDS = Object.freeze(TD_STAGES.map((_, index) => Object.freeze({
  x: 185 + index * 320,
  y: 196,
  width: 270,
  height: 360,
})));
const STAGE_SELECT_BACK = Object.freeze({ x: 36, y: 30, width: 112, height: 58 });

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

const RARITY_STYLE = Object.freeze({
  common: Object.freeze({ label: '普通', color: '#69B889', deep: '#327559', fill: '#EFF9E8' }),
  rare: Object.freeze({ label: '稀有', color: '#62BFE1', deep: '#32789B', fill: '#EAF8FF' }),
  epic: Object.freeze({ label: '史诗', color: '#9A82E7', deep: '#5947A4', fill: '#F2EEFF' }),
  legendary: Object.freeze({ label: '传说', color: '#F1B94F', deep: '#A56B20', fill: '#FFF4D4' }),
});

function rarityStyle(rarity) {
  const key = String(rarity || 'common').toLowerCase();
  return RARITY_STYLE[key] || RARITY_STYLE.common;
}

function wrappedTextLines(ctx, text, maxWidth, maxLines = 3) {
  const source = String(text || '').trim();
  if (!source) return [];
  const lines = [];
  let current = '';
  for (const character of Array.from(source)) {
    if (character === '\n') {
      if (current) lines.push(current);
      current = '';
      if (lines.length >= maxLines) break;
      continue;
    }
    const candidate = current + character;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = character;
      if (lines.length >= maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    if (source.length > lines.join('').length) {
      while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines;
}

function drawWrappedLabel(ctx, text, x, y, maxWidth, {
  maxLines = 3,
  lineHeight = 28,
  size = 20,
  color = COLORS.ink,
  weight = 750,
} = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  const lines = wrappedTextLines(ctx, text, maxWidth, maxLines);
  ctx.restore();
  lines.forEach((line, index) => label(ctx, line, x, y + index * lineHeight, {
    size, color, weight,
  }));
  return lines.length;
}

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

const HERO_SKILL_ASSET_BY_TYPE = Object.freeze({
  shell: 'skill-jelly-bounce-icon',
  needle: 'skill-honey-line-icon',
  bubble: 'skill-soft-swap-icon',
  sprout: 'skill-sprout-renewal-icon',
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
const slimeVisualType = (type, squadType = null) => {
  if (squadType === 'ranged' || type === 'ranged') return 'needle';
  if (squadType === 'melee' || type === 'melee') return 'shell';
  return TOWER_TYPES[type] ? type : 'shell';
};

function laneDescriptors(stage) {
  const lanes = Array.isArray(stage?.lanes) && stage.lanes.length
    ? stage.lanes.slice(0, 5)
    : FALLBACK_LANE_Y.map((y, laneIndex) => ({ y, laneIndex }));
  return FALLBACK_LANE_Y.map((fallbackY, laneIndex) => {
    const lane = lanes[laneIndex] || {};
    const y = Number.isFinite(Number(lane?.y)) ? Number(lane.y) : fallbackY;
    const providedPath = Array.isArray(lane?.path)
      ? lane.path
      : Array.isArray(lane?.points) ? lane.points : null;
    const points = providedPath?.length >= 2
      ? providedPath
      : [{ x: 108, y }, { x: 1172, y }];
    return { ...lane, laneIndex, y, points };
  });
}

function waveUnitCount(wave) {
  if (!Array.isArray(wave)) return 0;
  return wave.reduce((total, group) => total + Math.max(0, Number(group?.count) || 0), 0);
}

function drawDockShell(ctx, stage, time) {
  ctx.save();
  const topGradient = ctx.createLinearGradient(0, 0, TD_VIEW.width, 0);
  topGradient.addColorStop(0, 'rgba(27, 59, 65, 0.96)');
  topGradient.addColorStop(0.5, 'rgba(45, 86, 76, 0.96)');
  topGradient.addColorStop(1, 'rgba(31, 54, 68, 0.96)');
  ctx.fillStyle = topGradient;
  ctx.fillRect(0, 0, TD_VIEW.width, BATTLE_FIELD.top);

  const bottomGradient = ctx.createLinearGradient(0, BATTLE_FIELD.bottom, TD_VIEW.width, TD_VIEW.height);
  bottomGradient.addColorStop(0, 'rgba(27, 58, 61, 0.98)');
  bottomGradient.addColorStop(0.5, 'rgba(42, 81, 71, 0.98)');
  bottomGradient.addColorStop(1, 'rgba(31, 51, 65, 0.98)');
  ctx.fillStyle = bottomGradient;
  ctx.fillRect(0, BATTLE_FIELD.bottom, TD_VIEW.width, TD_VIEW.height - BATTLE_FIELD.bottom);

  ctx.globalAlpha = 0.12;
  ctx.fillStyle = stage.accent;
  for (let index = 0; index < 10; index += 1) {
    const radius = 15 + (index % 3) * 9;
    const x = 24 + (index * 151) % 1240;
    const y = BATTLE_FIELD.bottom + 18 + (index * 47) % 116
      + Math.sin(time * 0.55 + index) * 4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#DFFFF0';
  ctx.fillRect(0, BATTLE_FIELD.top - 2, TD_VIEW.width, 2);
  ctx.fillRect(0, BATTLE_FIELD.bottom, TD_VIEW.width, 2);
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
    this.keysDown = new Set();
    this.joystick = { active: false, x: 0, y: 0 };
    this.selectedPurchase = null;
    this.selectedCardUid = null;
    this.hoverPoint = null;
    this.menuPage = 'main';
    this.summonResults = [];
    this.shake = 0;
    this.eventCursor = 0;
    this.animationTime = 0;
    this.characterAnimations = new Map();
    this.turretPulses = new Map();
    this.defeatedActors = [];
    this.defeatedTowers = [];
    this.running = false;
    this.backgrounded = false;
    this.frameId = null;
    this.lastTimestamp = 0;
    this.scheduler = frameScheduler(canvas, options);

    this.boundPointerDown = (event) => this.handlePointerDown(event);
    this.boundPointerMove = (event) => this.handlePointerMove(event);
    this.boundPointerUp = (event) => this.handlePointerUp(event);
    this.boundPointerCancel = (event) => this.handlePointerCancel(event);
    this.boundKeyDown = (event) => this.handleKeyDown(event);
    this.boundKeyUp = (event) => this.handleKeyUp(event);
    this.boundWindowBlur = () => this.resetHeroInput();
    this.keyboardTarget = options.keyboardTarget || safeGlobal('window') || canvas;
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
      this.defeatedTowers.length = 0;
      return;
    }
    if (event.type === 'turret-shot' || event.type === 'turret-attack') {
      const key = event.turretUid || event.slotId || event.slotIndex;
      if (key != null) this.turretPulses.set(String(key), 1);
      return;
    }
    if (['hero-shot', 'hero-attack', 'hero-skill'].includes(event.type)) {
      const hero = this.state.hero;
      const type = hero?.type || hero?.heroId || this.state.selectedHeroId;
      const ownerId = TOWER_TYPES[type]?.ownerId;
      if (hero && ownerId) {
        this.playCharacterAnimation(`hero:${hero.uid || type}`, ownerId, 'attack');
      }
      return;
    }
    if (event.type === 'hero-hit') {
      const hero = this.state.hero;
      const type = hero?.type || hero?.heroId || this.state.selectedHeroId;
      const ownerId = TOWER_TYPES[type]?.ownerId;
      if (hero && ownerId) {
        this.playCharacterAnimation(`hero:${hero.uid || type}`, ownerId, 'hurt', {
          restart: false,
        });
      }
      return;
    }
    if (event.type === 'shot' || event.type === 'soldier-attack') {
      const towerUid = event.towerUid || event.soldierUid;
      const tower = this.state.towers.find(({ uid }) => uid === towerUid);
      const ownerId = tower
        && TOWER_TYPES[slimeVisualType(tower.type, tower.squadType)]?.ownerId;
      if (ownerId) {
        this.playCharacterAnimation(`tower:${tower.uid}`, ownerId, 'attack');
        if (tower.kind === 'soldier' || Number.isFinite(Number(tower.aliveMembers))) {
          for (let memberIndex = 0; memberIndex < 4; memberIndex += 1) {
            this.playCharacterAnimation(`squad:${tower.uid}:${memberIndex}`, ownerId, 'attack');
          }
        }
      }
      return;
    }
    if (event.type === 'merge') {
      const tower = this.state.towers.find(({ uid }) => uid === event.towerUid);
      const ownerId = tower
        && TOWER_TYPES[slimeVisualType(tower.type, tower.squadType)]?.ownerId;
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
    if (event.type === 'tower-hit' || event.type === 'soldier-hit') {
      const towerUid = event.towerUid || event.soldierUid;
      const tower = this.state.towers.find(({ uid }) => uid === towerUid);
      const ownerId = tower
        && TOWER_TYPES[slimeVisualType(tower.type, tower.squadType)]?.ownerId;
      if (ownerId) {
        this.playCharacterAnimation(`tower:${tower.uid}`, ownerId, 'hurt', {
          restart: false,
        });
        if (tower.kind === 'soldier' || Number.isFinite(Number(tower.aliveMembers))) {
          for (let memberIndex = 0; memberIndex < 4; memberIndex += 1) {
            this.playCharacterAnimation(`squad:${tower.uid}:${memberIndex}`, ownerId, 'hurt', {
              restart: false,
            });
          }
        }
      }
      return;
    }
    if (event.type === 'enemy-attack') {
      const enemy = this.state.enemies.find(({ uid }) => uid === event.enemyUid);
      const ownerId = enemy && TD_ENEMIES[enemy.type]?.ownerId;
      if (ownerId) {
        this.playCharacterAnimation(`enemy:${enemy.uid}`, ownerId, 'attack', {
          base: 'move',
        });
      }
      return;
    }
    if (event.type === 'tower-defeat' || event.type === 'soldier-defeat') {
      const towerUid = event.towerUid || event.soldierUid;
      const tower = this.state.towers.find(({ uid }) => uid === towerUid);
      const towerType = event.towerType || event.soldierType || tower?.type;
      const visualType = slimeVisualType(towerType, tower?.squadType);
      const definition = TOWER_TYPES[visualType];
      const stage = stageForState(this.state);
      const pad = Number.isInteger(event.padIndex) ? stage.pads[event.padIndex] : null;
      const x = Number.isFinite(event.x) ? event.x : pad?.x;
      const y = Number.isFinite(event.y) ? event.y : pad?.y;
      if (!definition || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const key = `defeated-tower:${towerUid || `${towerType}-${this.state.time}`}`;
      const actor = {
        key,
        type: visualType,
        squadType: ['melee', 'ranged'].includes(towerType) ? towerType : null,
        ownerId: definition.ownerId,
        x,
        y,
        star: clamp(Math.floor(Number(event.star ?? tower?.star) || 1), 1, TD_MAX_STAR),
        age: 0,
        duration: this.animationClipsForOwner(definition.ownerId)?.downed?.duration || 0.52,
      };
      this.defeatedTowers = this.defeatedTowers
        .filter(({ key: currentKey }) => currentKey !== key);
      this.defeatedTowers.push(actor);
      this.playCharacterAnimation(key, actor.ownerId, 'downed');
      this.shake = Math.min(10, this.shake + 3);
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
      const hero = this.state.hero;
      const heroType = hero?.type || hero?.heroId || this.state.selectedHeroId;
      const heroDefinition = TOWER_TYPES[heroType];
      if (hero && heroDefinition) {
        advance(`hero:${hero.uid || heroType}`, heroDefinition.ownerId, 'idle');
      }
      for (const tower of this.state.towers) {
        const visualType = tower.squadType === 'ranged' || tower.type === 'needle'
          ? 'needle' : tower.type === 'shell' ? 'shell' : 'shell';
        const definition = TOWER_TYPES[tower.type] || TOWER_TYPES[visualType];
        advance(`tower:${tower.uid}`, definition.ownerId, 'idle');
        if (tower.kind === 'soldier' || Number.isFinite(Number(tower.aliveMembers))) {
          for (let memberIndex = 0; memberIndex < 4; memberIndex += 1) {
            advance(`squad:${tower.uid}:${memberIndex}`, definition.ownerId, 'idle');
          }
        }
      }
      for (const enemy of this.state.enemies) {
        advance(`enemy:${enemy.uid}`, TD_ENEMIES[enemy.type].ownerId, 'move');
      }
      for (const card of this.state.hand) {
        advance(`card:${card.uid}`, TOWER_TYPES[card.type].ownerId, 'idle');
      }
      for (const offer of this.state.soldierShop || []) {
        const definition = TOWER_TYPES[offer.type];
        if (definition) advance(`offer:${offer.uid}`, definition.ownerId, 'idle');
      }
      for (const type of ['shell', 'needle']) {
        const definition = TOWER_TYPES[type];
        for (let memberIndex = 0; memberIndex < 4; memberIndex += 1) {
          advance(`purchase:${type}:${memberIndex}`, definition.ownerId, 'idle');
        }
      }
      for (const actor of this.defeatedActors) {
        actor.age += delta;
        advance(actor.key, actor.ownerId, 'move');
      }
      for (const actor of this.defeatedTowers) {
        actor.age += delta;
        advance(actor.key, actor.ownerId, 'idle');
      }
      this.defeatedActors = this.defeatedActors.filter(({ age, duration }) => age < duration);
      this.defeatedTowers = this.defeatedTowers.filter(({ age, duration }) => age < duration);
    } else {
      const victory = this.state.result === 'victory';
      const definition = victory ? TOWER_TYPES.shell : TD_ENEMIES.boss;
      advance(
        victory ? 'preview:result:shell' : 'preview:result:boss',
        definition.ownerId,
        'idle',
      );
      this.defeatedActors.length = 0;
      this.defeatedTowers.length = 0;
    }

    for (const [key, pulse] of this.turretPulses) {
      const next = Math.max(0, pulse - delta * 5.5);
      if (next <= 0) this.turretPulses.delete(key);
      else this.turretPulses.set(key, next);
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
    this.keyboardTarget?.addEventListener?.('keydown', this.boundKeyDown, { passive: false });
    this.keyboardTarget?.addEventListener?.('keyup', this.boundKeyUp, { passive: false });
    this.keyboardTarget?.addEventListener?.('blur', this.boundWindowBlur);
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
      if (['run-start', 'wave-clear', 'run-end'].includes(event.type)) {
        this.resetHeroInput();
      }
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
    this.resetHeroInput();
    return this;
  }

  dispose() {
    this.stop();
    this.save();
    this.canvas.removeEventListener?.('pointerdown', this.boundPointerDown);
    this.canvas.removeEventListener?.('pointermove', this.boundPointerMove);
    this.canvas.removeEventListener?.('pointerup', this.boundPointerUp);
    this.canvas.removeEventListener?.('pointercancel', this.boundPointerCancel);
    this.keyboardTarget?.removeEventListener?.('keydown', this.boundKeyDown);
    this.keyboardTarget?.removeEventListener?.('keyup', this.boundKeyUp);
    this.keyboardTarget?.removeEventListener?.('blur', this.boundWindowBlur);
    this.resetHeroInput();
    this.cancelInteraction();
    this.characterAnimations.clear();
    this.turretPulses.clear();
    this.defeatedActors.length = 0;
    this.defeatedTowers.length = 0;
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

  isHeroMovementKey(code) {
    return ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft',
      'ArrowDown', 'ArrowRight'].includes(code);
  }

  syncHeroMovement() {
    let x = 0;
    let y = 0;
    if (this.isHeroControlActive()) {
      if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) x -= 1;
      if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) x += 1;
      if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) y -= 1;
      if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) y += 1;
      if (this.joystick.active) {
        x = this.joystick.x;
        y = this.joystick.y;
      }
    }
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    setTowerDefenseHeroMovement(this.state, x, y);
  }

  updateJoystick(point) {
    const dx = point.x - HERO_JOYSTICK.x;
    const dy = point.y - HERO_JOYSTICK.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const scale = Math.min(1, length / HERO_JOYSTICK.radius);
    this.joystick.active = true;
    this.joystick.x = dx / length * scale;
    this.joystick.y = dy / length * scale;
    this.syncHeroMovement();
  }

  resetHeroInput() {
    this.keysDown.clear();
    this.joystick.active = false;
    this.joystick.x = 0;
    this.joystick.y = 0;
    if (this.state) {
      const reset = setTowerDefenseHeroMovement(this.state, 0, 0);
      if (!reset && this.state.hero) {
        this.state.hero.moveX = 0;
        this.state.hero.moveY = 0;
      }
    }
  }

  handleKeyDown(event) {
    const code = event?.code || event?.key;
    if (!this.isHeroControlActive()) return;
    if (this.isHeroMovementKey(code)) {
      event?.preventDefault?.();
      this.keysDown.add(code);
      this.syncHeroMovement();
      return;
    }
    if ((code === 'Space' || code === ' ') && !event?.repeat) {
      event?.preventDefault?.();
      activateTowerDefenseHeroSkill(this.state);
      this.processEvents();
    }
  }

  handleKeyUp(event) {
    const code = event?.code || event?.key;
    if (!this.isHeroMovementKey(code)) return;
    event?.preventDefault?.();
    this.keysDown.delete(code);
    this.syncHeroMovement();
  }

  hitAt(point, predicate = null) {
    if (!predicate && this.selectedPurchase === 'turret') {
      for (let index = this.hits.length - 1; index >= 0; index -= 1) {
        const hit = this.hits[index];
        if (
          hit.action === 'build-turret'
          && hit.enabled !== false
          && insideRect(point, hit)
        ) return hit;
      }
    }
    for (let index = this.hits.length - 1; index >= 0; index -= 1) {
      const hit = this.hits[index];
      if (hit.enabled === false || !insideRect(point, hit)) continue;
      if (!predicate || predicate(hit)) return hit;
    }
    return null;
  }

  emptyPadHitAt(point) {
    if (!this.isPreparation()) return null;
    const pads = stageForState(this.state).pads || [];
    let best = null;
    let bestDistance = Infinity;
    pads.forEach((pad, padIndex) => {
      if (towerByPad(this.state, padIndex)) return;
      const rect = {
        x: pad.x - PAD_RADIUS,
        y: pad.y - PAD_RADIUS,
        width: PAD_RADIUS * 2,
        height: PAD_RADIUS * 2,
      };
      if (!insideRect(point, rect)) return;
      const distance = pointDistance(point, pad);
      if (distance >= bestDistance) return;
      bestDistance = distance;
      best = {
        id: `pad-${padIndex}`,
        ...rect,
        action: 'pad',
        data: { padIndex },
        enabled: true,
      };
    });
    return best;
  }

  addHit(id, rect, action, data = {}, enabled = true) {
    this.hits.push({ id, ...rect, action, data, enabled });
  }

  summonCurrency() {
    return Math.max(0, Math.floor(Number(this.state.progress?.summonCurrency) || 0));
  }

  tutorialAllows(hit) {
    if (this.state.screen === 'menu' && this.menuPage === 'summon' && this.summonResults.length) {
      return hit?.action === 'summon-result-close';
    }
    const target = tutorialTargetForState(this.state);
    if (!target || this.state.screen === 'result') return true;
    if (!hit) return false;
    if (target.type === 'stage') {
      if (hit.action === 'open-stage-select' || hit.action === 'stage-select-back') return true;
      return hit.action === 'stage' && hit.data.stageIndex === target.stageIndex;
    }
    if (target.type === 'shop') {
      const offer = this.state.soldierShop?.[target.offerIndex || 0];
      return hit.action === 'buy-soldier' && hit.data.offerUid === offer?.uid;
    }
    if (target.type === 'squad') {
      if (this.selectedPurchase !== target.squadType) {
        return hit.action === 'select-purchase'
          && hit.data.purchaseType === target.squadType;
      }
      return hit.action === 'pad' && hit.data.padIndex === target.padIndex;
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
    if (hit?.action === 'hero-skill') {
      this.activateHit(hit);
      return;
    }
    if (this.drag?.kind === 'joystick') return;
    if (hit?.action === 'hero-joystick') {
      this.drag = {
        kind: 'joystick', pointerId: event?.pointerId,
        start: point, point, moved: true,
      };
      this.updateJoystick(point);
    } else if (hit?.action === 'card') {
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
    if (
      this.drag.kind === 'joystick'
      && this.drag.pointerId != null
      && event?.pointerId != null
      && event.pointerId !== this.drag.pointerId
    ) return;
    this.drag.point = point;
    if (this.drag.kind === 'joystick') {
      this.updateJoystick(point);
      return;
    }
    if (pointDistance(point, this.drag.start) >= DRAG_THRESHOLD) this.drag.moved = true;
  }

  handlePointerUp(event) {
    event?.preventDefault?.();
    const point = this.toGamePoint(event);
    if (
      this.drag?.kind === 'joystick'
      && this.drag.pointerId != null
      && event?.pointerId != null
      && event.pointerId !== this.drag.pointerId
    ) {
      this.canvas.releasePointerCapture?.(event.pointerId);
      return;
    }
    const drag = this.drag;
    this.drag = null;
    this.canvas.releasePointerCapture?.(event?.pointerId);
    if (!drag) return;

    if (drag.kind === 'joystick') {
      this.joystick.active = false;
      this.joystick.x = 0;
      this.joystick.y = 0;
      this.syncHeroMovement();
      return;
    }

    if (drag.kind === 'card') {
      const towerHit = this.hitAt(point, (hit) => hit.action === 'tower');
      const padHit = this.hitAt(point, (hit) => hit.action === 'pad')
        || this.emptyPadHitAt(point);
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
      const padHit = this.hitAt(point, (hit) => hit.action === 'pad')
        || this.emptyPadHitAt(point);
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

  handlePointerCancel(event) {
    if (
      this.drag?.kind === 'joystick'
      && this.drag.pointerId != null
      && event?.pointerId != null
      && event.pointerId !== this.drag.pointerId
    ) return;
    this.cancelInteraction();
  }

  cancelInteraction() {
    this.drag = null;
    this.hoverPoint = null;
    this.resetHeroInput();
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
      case 'open-stage-select':
        if (this.state.screen === 'menu') {
          this.menuPage = 'stage-select';
          this.selectedCardUid = null;
          this.state.selectedTowerUid = null;
        }
        break;
      case 'stage-select-back':
        this.menuPage = 'main';
        break;
      case 'open-summon':
        if (this.state.screen === 'menu') {
          this.menuPage = 'summon';
          this.summonResults = [];
          this.state.summonResults = [];
          this.selectedCardUid = null;
          this.state.selectedTowerUid = null;
        }
        break;
      case 'summon-back':
        this.menuPage = 'main';
        this.summonResults = [];
        this.state.summonResults = [];
        break;
      case 'summon-one':
      case 'summon-ten': {
        const count = hit.action === 'summon-ten' ? 10 : 1;
        const results = summonTowerDefenseContracts(this.state, count);
        if (Array.isArray(results) && results.length) this.summonResults = results;
        this.save();
        break;
      }
      case 'summon-result-close':
        this.summonResults = [];
        this.state.summonResults = [];
        break;
      case 'select-hero':
        if (selectTowerDefenseHero(this.state, hit.data.heroType)) {
          this.processEvents();
          this.save();
        }
        break;
      case 'stage':
        if (beginTowerDefenseRun(this.state, {
          mode: 'stage', stageId: hit.data.stageId,
        })) {
          this.menuPage = 'main';
          this.selectedPurchase = null;
          this.selectedCardUid = null;
          this.eventCursor = 0;
        }
        break;
      case 'endless':
        if (this.endlessUnlocked()) {
          beginTowerDefenseRun(this.state, { mode: 'endless', stageId: 'stage-3' });
          this.menuPage = 'main';
          this.selectedPurchase = null;
          this.selectedCardUid = null;
          this.eventCursor = 0;
        }
        break;
      case 'draw': {
        const card = drawTowerCard(this.state);
        if (card) this.selectedCardUid = card.uid;
        break;
      }
      case 'select-purchase':
        this.selectedPurchase = this.selectedPurchase === hit.data.purchaseType
          ? null : hit.data.purchaseType;
        this.selectedCardUid = null;
        this.state.selectedTowerUid = null;
        break;
      case 'build-turret': {
        const turret = this.selectedPurchase === 'turret'
          ? buildTowerDefenseTurret(this.state, hit.data.slotIndex, 'gel-mortar')
          : null;
        if (turret) this.selectedPurchase = null;
        this.processEvents();
        break;
      }
      case 'pad':
        if (['melee', 'ranged'].includes(this.selectedPurchase)) {
          const squad = buyTowerDefenseSquad(
            this.state,
            this.selectedPurchase,
            hit.data.padIndex,
          );
          if (squad) this.selectedPurchase = null;
          this.processEvents();
        }
        else if (this.selectedCardUid) this.placeCard(this.selectedCardUid, hit.data.padIndex);
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
        this.selectedPurchase = null;
        if (this.state.waveBreak > 0) skipTowerDefenseBreak(this.state);
        else startNextTowerDefenseWave(this.state);
        this.processEvents();
        break;
      case 'hero-skill':
        activateTowerDefenseHeroSkill(this.state);
        this.processEvents();
        break;
      case 'battle-menu':
        this.resetHeroInput();
        returnToTowerDefenseMenu(this.state);
        this.menuPage = 'main';
        this.selectedPurchase = null;
        this.selectedCardUid = null;
        this.save();
        break;
      case 'replay':
        replayTowerDefenseRun(this.state);
        this.selectedPurchase = null;
        this.selectedCardUid = null;
        this.eventCursor = 0;
        break;
      case 'result-menu':
        returnToTowerDefenseMenu(this.state);
        this.menuPage = 'main';
        this.selectedPurchase = null;
        this.selectedCardUid = null;
        this.save();
        break;
      case 'next-stage': {
        const stage = stageForState(this.state);
        const next = TD_STAGES[stage.index];
        if (next) beginTowerDefenseRun(this.state, { mode: 'stage', stageId: next.id });
        else returnToTowerDefenseMenu(this.state);
        this.selectedPurchase = null;
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
    if (this.state.screen === 'menu') {
      if (this.menuPage === 'stage-select') this.drawStageSelect(ctx);
      else if (this.menuPage === 'summon') this.drawSummonPage(ctx);
      else this.drawMenu(ctx);
    }
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
      ctx.globalAlpha *= 0.78;
      ctx.drawImage(asset, 0, 0, TD_VIEW.width, TD_VIEW.height);
    }, () => {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#55AE80';
      for (let index = 0; index < 28; index += 1) {
        const x = (index * 173) % TD_VIEW.width;
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

    label(ctx, '史莱姆自走防线', TD_VIEW.width / 2, 58, {
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
    this.addHit('start-story', storyRect, 'open-stage-select');

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

    const summonRect = MENU_ACTIONS.summon;
    const summonHot = Boolean(this.hoverPoint && insideRect(this.hoverPoint, summonRect));
    panel(ctx, summonRect, {
      fill: summonHot ? '#FFF1B8' : '#F7E4A0',
      stroke: summonHot ? '#8E5B20' : '#B57A2C',
      lineWidth: summonHot ? 5 : 3,
      radius: 32,
      shadow: true,
    });
    label(ctx, '英雄召唤', summonRect.x + summonRect.width / 2,
      summonRect.y + 35, {
        size: 21, color: COLORS.ink, weight: 950,
      });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-soft-crystal', (asset) => {
      ctx.drawImage(asset, summonRect.x + 32, summonRect.y + 57, 28, 28);
    }, () => {
      label(ctx, '◆', summonRect.x + 46, summonRect.y + 72, {
        size: 18, color: COLORS.crystal, weight: 950,
      });
    });
    label(ctx, this.summonCurrency(), summonRect.x + 68, summonRect.y + 72, {
      size: 17, align: 'left', color: COLORS.inkSoft, weight: 900,
    });
    this.addHit('open-summon', summonRect, 'open-summon');
  }

  drawSummonPage(ctx) {
    ctx.fillStyle = '#CBE8D0';
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    drawAssetOrFallback(ctx, this.assetStore, 'background-garden-base', (asset) => {
      ctx.drawImage(asset, 0, 0, TD_VIEW.width, TD_VIEW.height);
    }, () => this.drawBackdrop(ctx, 'stage-1'));
    drawAssetOrFallback(ctx, this.assetStore, 'background-cloud-overlay', (asset) => {
      ctx.globalAlpha *= 0.18;
      const drift = Math.sin(this.state.time * 0.08) * 20;
      ctx.drawImage(asset, -18 + drift, -18, 1316, 438);
    }, () => {});

    const wash = ctx.createLinearGradient(0, 0, 0, TD_VIEW.height);
    wash.addColorStop(0, 'rgba(255, 249, 225, 0.78)');
    wash.addColorStop(1, 'rgba(93, 132, 119, 0.34)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);

    panel(ctx, SUMMON_BACK_RECT, {
      fill: '#FFF8E8', stroke: '#85978E', lineWidth: 3, radius: 22, shadow: true,
    });
    label(ctx, '返回', SUMMON_BACK_RECT.x + SUMMON_BACK_RECT.width / 2,
      SUMMON_BACK_RECT.y + SUMMON_BACK_RECT.height / 2, {
        size: 21, color: COLORS.ink, weight: 900,
      });
    this.addHit('summon-back', SUMMON_BACK_RECT, 'summon-back');

    label(ctx, '英雄召唤', TD_VIEW.width / 2, 70, {
      size: 40, color: COLORS.ink, weight: 950,
    });
    label(ctx, '召唤英雄 · 碎片升阶', TD_VIEW.width / 2, 114, {
      size: 17, color: COLORS.inkSoft, weight: 800,
    });

    panel(ctx, SUMMON_CURRENCY_RECT, {
      fill: '#FFF4D0', stroke: '#B57A2C', lineWidth: 3, radius: 24, shadow: true,
    });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-soft-crystal', (asset) => {
      ctx.drawImage(asset, SUMMON_CURRENCY_RECT.x + 14, SUMMON_CURRENCY_RECT.y + 10, 42, 42);
    }, () => {
      label(ctx, '◆', SUMMON_CURRENCY_RECT.x + 35,
        SUMMON_CURRENCY_RECT.y + SUMMON_CURRENCY_RECT.height / 2, {
          size: 24, color: COLORS.crystal, weight: 950,
        });
    });
    label(ctx, this.summonCurrency(), SUMMON_CURRENCY_RECT.x + SUMMON_CURRENCY_RECT.width - 18,
      SUMMON_CURRENCY_RECT.y + SUMMON_CURRENCY_RECT.height / 2 + 1, {
        size: 24, align: 'right', color: COLORS.ink, weight: 950,
      });

    const contractRanks = this.state.progress?.contractRanks || {};
    const contractShards = this.state.progress?.contractShards || {};
    ['shell', 'needle', 'bubble', 'sprout'].forEach((type, index) => {
      const rect = SUMMON_CONTRACT_RECTS[index];
      const definition = TOWER_TYPES[type];
      const heroDefinition = HERO_TYPES[type] || definition;
      const rank = Math.max(0, Math.floor(Number(contractRanks[type]) || 0));
      const shards = Math.max(0, Math.floor(Number(contractShards[type]) || 0));
      const owned = rank > 0;
      const selected = this.state.progress?.selectedHero === type
        || this.state.selectedHeroId === type;
      const hot = owned && Boolean(this.hoverPoint && insideRect(this.hoverPoint, rect));
      panel(ctx, rect, {
        fill: !owned ? '#D8DDD7' : hot ? '#FFFEF2' : '#FFF8E6',
        stroke: selected ? '#E6A83A' : owned ? definition.color : '#89958F',
        lineWidth: selected || hot ? 5 : 3,
        radius: 28,
        shadow: true,
      });
      drawAssetOrFallback(ctx, this.assetStore, 'ui-card-frame-common', (asset) => {
        ctx.globalAlpha *= 0.28;
        ctx.drawImage(asset, rect.x, rect.y, rect.width, rect.height);
      }, () => {});
      label(ctx, heroDefinition.name, rect.x + rect.width / 2, rect.y + 39, {
        size: 25, color: COLORS.ink, weight: 950,
      });
      panel(ctx, { x: rect.x + 62, y: rect.y + 66, width: rect.width - 124, height: 36 }, {
        fill: `${definition.color}33`, stroke: definition.color, lineWidth: 2, radius: 16,
      });
      label(ctx, owned ? `阶级 ${rank}` : '未拥有', rect.x + rect.width / 2, rect.y + 85, {
        size: 15, color: COLORS.ink, weight: 900,
      });
      const animation = this.characterAnimationSample(
        `preview:menu:${definition.id}`,
        definition.ownerId,
      );
      drawSlime(ctx, rect.x + rect.width / 2, rect.y + 256, 118, type, {
        time: this.state.time + index * 0.17,
        facing: index < 2 ? 1 : -1,
        assetStore: this.assetStore,
        ...animation,
        ...this.characterRigOptions(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
      if (!owned) {
        ctx.save();
        ctx.fillStyle = 'rgba(40, 53, 58, 0.48)';
        roundedPath(ctx, rect.x + 15, rect.y + 110, rect.width - 30, 165, 22);
        ctx.fill();
        ctx.restore();
        label(ctx, '锁定', rect.x + rect.width / 2, rect.y + 195, {
          size: 22, color: COLORS.white, weight: 950,
        });
      }
      if (selected) {
        panel(ctx, { x: rect.x + 71, y: rect.y + 272, width: rect.width - 142, height: 30 }, {
          fill: '#F4C94C', stroke: '#9B6E20', lineWidth: 2, radius: 14,
        });
        label(ctx, '出战中', rect.x + rect.width / 2, rect.y + 288, {
          size: 13, color: COLORS.ink, weight: 950,
        });
      }
      label(ctx, `碎片 ${shards}`, rect.x + rect.width / 2, rect.y + rect.height - 27, {
        size: 18, color: COLORS.inkSoft, weight: 900,
      });
      this.addHit(`hero-select-${type}`, rect, 'select-hero', { heroType: type }, owned);
    });

    const currency = this.summonCurrency();
    button(ctx, SUMMON_ONE_RECT, '召唤 1次', {
      enabled: currency >= 100, fill: '#62CFA0', accent: '#277C62', size: 25,
    });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-soft-crystal', (asset) => {
      ctx.globalAlpha *= currency >= 100 ? 0.95 : 0.35;
      ctx.drawImage(asset, SUMMON_ONE_RECT.x + 62, SUMMON_ONE_RECT.y + 57, 25, 25);
    }, () => {});
    label(ctx, '100', SUMMON_ONE_RECT.x + 99, SUMMON_ONE_RECT.y + 70, {
      size: 15, align: 'left', color: currency >= 100 ? COLORS.ink : COLORS.disabled, weight: 900,
    });
    this.addHit('summon-one', SUMMON_ONE_RECT, 'summon-one', {}, currency >= 100);

    button(ctx, SUMMON_TEN_RECT, '召唤 10次', {
      enabled: currency >= 900, fill: '#8E7FE2', accent: '#51438F', size: 25,
    });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-soft-crystal', (asset) => {
      ctx.globalAlpha *= currency >= 900 ? 0.95 : 0.35;
      ctx.drawImage(asset, SUMMON_TEN_RECT.x + 62, SUMMON_TEN_RECT.y + 57, 25, 25);
    }, () => {});
    label(ctx, '900', SUMMON_TEN_RECT.x + 99, SUMMON_TEN_RECT.y + 70, {
      size: 15, align: 'left', color: currency >= 900 ? COLORS.ink : COLORS.disabled, weight: 900,
    });
    this.addHit('summon-ten', SUMMON_TEN_RECT, 'summon-ten', {}, currency >= 900);

    if (this.summonResults.length) this.drawSummonResults(ctx);
  }

  drawSummonResults(ctx) {
    const results = this.summonResults.slice(0, 10);
    this.hits = [];
    ctx.save();
    ctx.fillStyle = 'rgba(22, 34, 42, 0.78)';
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    ctx.restore();

    const modal = { x: 104, y: 52, width: 1072, height: 646 };
    panel(ctx, modal, {
      fill: '#FFF9E9', stroke: '#B88635', lineWidth: 5, radius: 34, shadow: true,
    });
    label(ctx, '召唤结果', TD_VIEW.width / 2, 104, {
      size: 37, color: COLORS.ink, weight: 950,
    });

    const single = results.length === 1;
    const cards = single
      ? [{ x: 470, y: 150, width: 340, height: 404 }]
      : results.map((_, index) => ({
        x: 146 + (index % 5) * 198,
        y: 144 + Math.floor(index / 5) * 214,
        width: 174,
        height: 190,
      }));

    results.forEach((result, index) => {
      const rect = cards[index];
      const definition = TOWER_TYPES[result.type] || TOWER_TYPES.shell;
      const heroDefinition = HERO_TYPES[result.type] || definition;
      const rarity = rarityStyle(result.rarity);
      panel(ctx, rect, {
        fill: rarity.fill, stroke: rarity.color, lineWidth: 4,
        radius: single ? 28 : 20, shadow: true,
      });
      drawAssetOrFallback(ctx, this.assetStore, 'ui-card-frame-common', (asset) => {
        ctx.globalAlpha *= 0.24;
        ctx.drawImage(asset, rect.x, rect.y, rect.width, rect.height);
      }, () => {});
      label(ctx, rarity.label, rect.x + 16, rect.y + 20, {
        size: single ? 18 : 13, align: 'left', color: rarity.deep, weight: 950,
      });
      label(ctx, heroDefinition.name, rect.x + rect.width - 16, rect.y + 20, {
        size: single ? 22 : 15, align: 'right', color: COLORS.ink, weight: 950,
      });
      const animation = this.characterAnimationSample(
        `preview:menu:${definition.id}`,
        definition.ownerId,
      );
      drawSlime(ctx, rect.x + rect.width / 2,
        rect.y + (single ? 272 : 135), single ? 138 : 67, definition.id, {
          time: this.state.time + index * 0.11,
          facing: index % 2 ? -1 : 1,
          assetStore: this.assetStore,
          ...animation,
          ...this.characterRigOptions(definition.ownerId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
        });
      const converted = Math.max(0, Math.floor(Number(result.convertedCurrency) || 0));
      const rankUps = Math.max(0, Math.floor(Number(result.rankUps) || 0));
      const shards = Math.max(0, Math.floor(Number(result.shards) || 0));
      const rewardText = result.unlocked
        ? '新英雄'
        : converted ? `◆ +${converted}` : rankUps ? `升阶 +${rankUps}` : `碎片 +${shards}`;
      label(ctx, rewardText,
        rect.x + rect.width / 2, rect.y + rect.height - (single ? 54 : 28), {
          size: single ? 21 : 14,
          color: result.unlocked ? COLORS.mintDeep : converted ? COLORS.crystal : COLORS.ink,
          weight: 950,
        });
      if (rankUps && !result.unlocked) {
        panel(ctx, {
          x: rect.x + rect.width - (single ? 106 : 66),
          y: rect.y + (single ? 54 : 42),
          width: single ? 88 : 54,
          height: single ? 34 : 26,
        }, {
          fill: '#FFE27A', stroke: '#A66C22', lineWidth: 2, radius: 14,
        });
        label(ctx, `升${rankUps}`, rect.x + rect.width - (single ? 62 : 39),
          rect.y + (single ? 72 : 56), {
            size: single ? 16 : 12, color: COLORS.ink, weight: 950,
          });
      }
    });

    button(ctx, SUMMON_RESULT_CLOSE_RECT, '收下', {
      fill: COLORS.mint, accent: COLORS.mintDeep, size: 24,
    });
    this.addHit('summon-result-close', SUMMON_RESULT_CLOSE_RECT, 'summon-result-close');
  }

  drawStageSelect(ctx) {
    ctx.fillStyle = '#CBE8D0';
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    drawAssetOrFallback(ctx, this.assetStore, 'background-garden-base', (asset) => {
      ctx.drawImage(asset, 0, 0, TD_VIEW.width, TD_VIEW.height);
    }, () => this.drawBackdrop(ctx, 'stage-1'));
    drawAssetOrFallback(ctx, this.assetStore, 'background-cloud-overlay', (asset) => {
      ctx.globalAlpha *= 0.2;
      const drift = Math.sin(this.state.time * 0.08) * 20;
      ctx.drawImage(asset, -18 + drift, -18, 1316, 438);
    }, () => {});

    const wash = ctx.createLinearGradient(0, 0, 0, TD_VIEW.height);
    wash.addColorStop(0, 'rgba(255, 251, 232, 0.62)');
    wash.addColorStop(1, 'rgba(105, 148, 126, 0.3)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);

    panel(ctx, STAGE_SELECT_BACK, {
      fill: '#FFF8E8', stroke: '#85978E', lineWidth: 3, radius: 22, shadow: true,
    });
    label(ctx, '返回', STAGE_SELECT_BACK.x + STAGE_SELECT_BACK.width / 2,
      STAGE_SELECT_BACK.y + STAGE_SELECT_BACK.height / 2, {
        size: 21, color: COLORS.ink, weight: 900,
      });
    this.addHit('stage-select-back', STAGE_SELECT_BACK, 'stage-select-back');

    label(ctx, '选择关卡', TD_VIEW.width / 2, 92, {
      size: 40, color: COLORS.ink, weight: 950,
    });

    TD_STAGES.forEach((stage, index) => {
      const rect = STAGE_SELECT_CARDS[index];
      const unlocked = stage.index <= this.state.progress.unlockedStage;
      const cleared = this.state.progress.clearedStages.includes(stage.id);
      const hot = unlocked && Boolean(this.hoverPoint && insideRect(this.hoverPoint, rect));
      panel(ctx, rect, {
        fill: unlocked ? hot ? '#FFFDF0' : '#FFF8E6' : '#D2D8D4',
        stroke: unlocked ? stage.accent : '#929D97',
        lineWidth: hot ? 6 : 4,
        radius: 30,
        shadow: unlocked,
      });

      const artRect = {
        x: rect.x + 18,
        y: rect.y + 18,
        width: rect.width - 36,
        height: 166,
      };
      ctx.save();
      roundedPath(ctx, artRect.x, artRect.y, artRect.width, artRect.height, 20);
      ctx.clip();
      drawAssetOrFallback(ctx, this.assetStore, STAGE_REGION_ASSET[stage.id], (asset) => {
        ctx.globalAlpha *= unlocked ? 0.94 : 0.28;
        ctx.drawImage(asset, artRect.x, artRect.y, artRect.width, artRect.height);
      }, () => {
        ctx.fillStyle = unlocked ? stage.accent : '#AAB4AF';
        ctx.globalAlpha *= unlocked ? 0.45 : 0.2;
        ctx.fillRect(artRect.x, artRect.y, artRect.width, artRect.height);
      });
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.arc(rect.x + 42, rect.y + 42, 25, 0, TAU);
      ctx.fillStyle = unlocked ? '#FFF4C8' : '#B9C1BD';
      ctx.fill();
      ctx.strokeStyle = unlocked ? stage.accent : '#7E8A85';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      label(ctx, unlocked ? stage.index : '锁', rect.x + 42, rect.y + 42, {
        size: unlocked ? 22 : 16,
        color: unlocked ? stage.accent : '#66736D',
        weight: 950,
      });

      label(ctx, stage.name, rect.x + rect.width / 2, rect.y + 225, {
        size: 27, color: unlocked ? COLORS.ink : '#68746E', weight: 920,
      });
      label(ctx, `${stage.waves.length}波`, rect.x + rect.width / 2, rect.y + 260, {
        size: 17, color: unlocked ? COLORS.inkSoft : '#7A8580', weight: 780,
      });
      const statusRect = {
        x: rect.x + 40,
        y: rect.y + 292,
        width: rect.width - 80,
        height: 48,
      };
      panel(ctx, statusRect, {
        fill: !unlocked ? '#BCC5C0' : cleared ? '#DDF6CD' : stage.accent,
        stroke: !unlocked ? '#8B9791' : cleared ? '#6BAE62' : stage.accent,
        lineWidth: 2,
        radius: 20,
      });
      label(ctx, !unlocked ? '未解锁' : cleared ? '✓ 已通关' : '可挑战',
        rect.x + rect.width / 2, statusRect.y + statusRect.height / 2, {
          size: 18,
          color: !unlocked ? '#68746E' : cleared ? '#397B45' : COLORS.white,
          weight: 900,
        });
      this.addHit(`select-stage-${stage.index}`, rect, 'stage', {
        stageId: stage.id,
        stageIndex: index,
      }, unlocked);
    });
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
    this.drawBattleHud(ctx, stage);
    this.drawHeroControls(ctx);
    this.drawDragPreview(ctx);
  }

  drawHeroControls(ctx) {
    const active = this.isHeroControlActive();
    const hero = this.state.hero || {};
    const heroType = hero.type || hero.heroId || this.state.selectedHeroId || 'shell';
    const definition = TOWER_TYPES[heroType] || TOWER_TYPES.shell;

    ctx.save();
    ctx.globalAlpha = active ? 0.78 : 0.34;
    drawAssetOrFallback(ctx, this.assetStore, 'ui-hero-joystick-base', (asset) => {
      ctx.drawImage(asset,
        HERO_JOYSTICK.x - HERO_JOYSTICK.radius,
        HERO_JOYSTICK.y - HERO_JOYSTICK.radius,
        HERO_JOYSTICK.radius * 2,
        HERO_JOYSTICK.radius * 2);
    }, () => {});
    const knobX = HERO_JOYSTICK.x + this.joystick.x * 34;
    const knobY = HERO_JOYSTICK.y + this.joystick.y * 34;
    drawAssetOrFallback(ctx, this.assetStore, 'ui-hero-joystick-knob', (asset) => {
      ctx.drawImage(asset, knobX - 27, knobY - 27, 54, 54);
    }, () => {});
    ctx.restore();
    this.addHit('hero-joystick', HERO_JOYSTICK.hit, 'hero-joystick', {}, active);

    const cooldown = Math.max(0, Number(
      hero.skillCooldownRemaining ?? hero.skillCooldown ?? this.state.heroSkillCooldown,
    ) || 0);
    const canSkill = active && cooldown <= 0 && Number(hero.hp ?? 1) > 0;
    panel(ctx, HERO_SKILL_RECT, {
      fill: canSkill ? 'rgba(246,255,236,0.92)' : 'rgba(78,94,94,0.72)',
      stroke: canSkill ? definition.color : '#8B9994',
      lineWidth: canSkill ? 5 : 3,
      radius: HERO_SKILL_RECT.width / 2,
      shadow: canSkill,
    });
    const iconKey = HERO_SKILL_ASSET_BY_TYPE[heroType] || HERO_SKILL_ASSET_BY_TYPE.shell;
    drawAssetOrFallback(ctx, this.assetStore, iconKey, (asset) => {
      ctx.globalAlpha *= canSkill ? 1 : 0.42;
      ctx.drawImage(asset, HERO_SKILL_RECT.x + 13, HERO_SKILL_RECT.y + 13,
        HERO_SKILL_RECT.width - 26, HERO_SKILL_RECT.height - 26);
    }, () => {});
    if (cooldown > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(25, 39, 45, 0.56)';
      ctx.beginPath();
      ctx.arc(HERO_SKILL_RECT.x + HERO_SKILL_RECT.width / 2,
        HERO_SKILL_RECT.y + HERO_SKILL_RECT.height / 2,
        HERO_SKILL_RECT.width / 2 - 6, 0, TAU);
      ctx.fill();
      ctx.restore();
      label(ctx, cooldown.toFixed(1),
        HERO_SKILL_RECT.x + HERO_SKILL_RECT.width / 2,
        HERO_SKILL_RECT.y + HERO_SKILL_RECT.height / 2 + 1, {
          size: 24, color: COLORS.white, weight: 950,
        });
    }
    this.addHit('hero-skill', HERO_SKILL_RECT, 'hero-skill', {}, canSkill);
  }

  isPreparation() {
    return this.state.screen === 'battle'
      && this.state.phase === 'prep'
      && !this.state.waveActive
      && !this.state.result;
  }

  isHeroControlActive() {
    return this.state.screen === 'battle'
      && this.state.phase === 'combat'
      && this.state.waveActive
      && !this.state.result
      && Number(this.state.hero?.hp ?? 0) > 0;
  }

  drawBattleHero(ctx) {
    const hero = this.state.hero;
    if (!hero || !Number.isFinite(hero.x) || !Number.isFinite(hero.y)) return;
    const type = hero.type || hero.heroId || this.state.selectedHeroId || 'shell';
    const definition = TOWER_TYPES[type] || TOWER_TYPES.shell;
    const key = `hero:${hero.uid || type}`;
    const animation = this.characterAnimationSample(key, definition.ownerId,
      this.state.waveActive ? 'idle' : 'idle');
    const pulse = 1 + Math.sin(this.state.time * 3.4) * 0.05;
    ctx.save();
    ctx.globalAlpha = 0.82;
    drawAssetOrFallback(ctx, this.assetStore, 'ui-hero-control-ring', (asset) => {
      const width = 150 * pulse;
      const height = 67 * pulse;
      ctx.drawImage(asset, hero.x - width / 2, hero.y - height / 2 + 8, width, height);
    }, () => {});
    ctx.restore();
    drawSlime(ctx, hero.x, hero.y + 10, 98, type, {
      time: this.state.time,
      facing: hero.facing === -1 ? -1 : 1,
      hit: clamp(Number(hero.hitPulse) || 0, 0, 1),
      expression: Number(hero.hitPulse) > 0.35 ? 'hurt' : 'normal',
      assetStore: this.assetStore,
      ...animation,
      ...this.characterRigOptions(definition.ownerId),
      allowGeneratedStandalone: this.generatedCharacterArtEnabled,
    });
    panel(ctx, { x: hero.x - 30, y: hero.y - 96, width: 60, height: 25 }, {
      fill: definition.color, stroke: '#FFFFFF', lineWidth: 2, radius: 12,
    });
    label(ctx, '英雄', hero.x, hero.y - 83, {
      size: 12, color: COLORS.white, weight: 950,
    });
    if (Number.isFinite(hero.hp) && Number.isFinite(hero.maxHp) && hero.maxHp > 0) {
      const ratio = clamp(hero.hp / hero.maxHp, 0, 1);
      const bar = { x: hero.x - 43, y: hero.y - 67, width: 86, height: 8 };
      ctx.fillStyle = 'rgba(28,44,50,0.68)';
      roundedPath(ctx, bar.x, bar.y, bar.width, bar.height, 4);
      ctx.fill();
      if (ratio > 0) {
        ctx.fillStyle = ratio < 0.3 ? COLORS.coral : COLORS.mint;
        roundedPath(ctx, bar.x + 1, bar.y + 1,
          Math.max(2, (bar.width - 2) * ratio), bar.height - 2, 3);
        ctx.fill();
      }
    }
  }

  turretSlots(stage) {
    if (Array.isArray(this.state.turretSlots) && this.state.turretSlots.length) {
      return this.state.turretSlots;
    }
    if (Array.isArray(stage?.turretSlots) && stage.turretSlots.length) return stage.turretSlots;
    return [
      { x: 408, y: 116, type: 'gel-mortar' },
      { x: 872, y: 116, type: 'gel-mortar' },
    ];
  }

  drawTurretSlots(ctx, stage) {
    const slots = this.turretSlots(stage);
    const turrets = Array.isArray(this.state.turrets) ? this.state.turrets : [];
    slots.forEach((slot, slotIndex) => {
      const turret = slot.turret || turrets.find((entry) => (
        entry.slotIndex === slotIndex || entry.slotId === slot.id
      ));
      const x = Number.isFinite(Number(slot.x)) ? Number(slot.x) : 408 + slotIndex * 464;
      const y = Number.isFinite(Number(slot.y)) ? Number(slot.y) : 116;
      const buildingGroundY = y < 200 ? y + 50 : y + 28;
      const type = 'gel-mortar';
      const turretDefinition = TURRET_TYPES[type] || {
        id: type, name: '凝胶迫击炮', cost: 175, color: '#72D7A3',
      };
      const buildingType = 'tower';
      const assetKey = 'turret-gel-mortar';
      if (turret) {
        const pulseKey = String(turret.uid ?? slot.id ?? slotIndex);
        const pulse = clamp(Number(this.turretPulses.get(pulseKey)) || 0, 0, 1);
        if (pulse > 0) {
          ctx.save();
          ctx.globalAlpha = pulse * 0.42;
          ctx.fillStyle = COLORS.blue;
          ctx.beginPath();
          ctx.ellipse(x, buildingGroundY - 8,
            58 + pulse * 18, 26 + pulse * 8, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
        drawBuilding(ctx, x, buildingGroundY, 92 * (1 + pulse * 0.045), buildingType, {
          assetKey,
          assetStore: this.assetStore,
          ...GEL_MORTAR_ASSET_LAYOUT,
          selected: false,
          damage: Number.isFinite(turret.hp) && turret.maxHp > 0
            ? 1 - clamp(turret.hp / turret.maxHp, 0, 1)
            : 0,
        });
        return;
      }

      ctx.save();
      ctx.globalAlpha = this.isPreparation() ? 0.68 : 0.28;
      drawBuilding(ctx, x, buildingGroundY, 86, 'paver', {
        assetKey: 'building-gel-foundation',
        assetStore: this.assetStore,
        ghost: true,
      });
      ctx.strokeStyle = '#E8FFD9';
      ctx.lineWidth = 3;
      ctx.setLineDash?.([8, 7]);
      ctx.beginPath();
      ctx.ellipse(x, buildingGroundY - 8, 48, 21, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash?.([]);
      ctx.restore();
      const cost = Math.max(0, Math.floor(Number(slot.cost) || turretDefinition.cost));
      const buildingSelected = this.selectedPurchase === 'turret';
      label(ctx, this.isPreparation() && buildingSelected
        ? `${turretDefinition.name} ${cost}` : '炮台位', x, y - 26, {
        size: 13, color: this.isPreparation() ? COLORS.cream : COLORS.inkSoft, weight: 900,
      });
      const slotHitId = typeof slot.id === 'string' && slot.id
        ? slot.id : `turret-slot-${slotIndex}`;
      this.addHit(slotHitId, {
        x: x - 54, y: y - 42, width: 108, height: 100,
      }, 'build-turret', {
        slotIndex, slotId: slot.id, turretType: type,
      }, this.isPreparation() && buildingSelected && this.state.currency >= cost);
    });
  }

  drawBattlefield(ctx, stage) {
    this.drawBackdrop(ctx, stage.id);
    ctx.save();
    const fieldWash = ctx.createLinearGradient(0, BATTLE_FIELD.top, 0, BATTLE_FIELD.bottom);
    fieldWash.addColorStop(0, 'rgba(244,255,239,0.22)');
    fieldWash.addColorStop(0.5, 'rgba(232,255,241,0.08)');
    fieldWash.addColorStop(1, 'rgba(48,93,84,0.16)');
    ctx.fillStyle = fieldWash;
    ctx.fillRect(0, BATTLE_FIELD.top, TD_VIEW.width,
      BATTLE_FIELD.bottom - BATTLE_FIELD.top);
    ctx.restore();

    const lanes = laneDescriptors(stage);
    const gatewayY = lanes[Math.floor(lanes.length / 2)]?.y ?? FALLBACK_LANE_Y[2];
    this.drawLaneField(ctx, lanes, stage);
    this.drawLaneGateways(ctx, lanes, stage, gatewayY);

    drawCore(ctx, 76, gatewayY + 60, 118, {
      health: this.state.coreHp / Math.max(1, this.state.coreMaxHp),
      time: this.state.time,
      hit: this.shake > 0 ? 1 : 0,
      assetStore: this.assetStore,
    });
    drawPortal(ctx, 1204, gatewayY + 60, 118, {
      time: this.state.time,
      open: this.state.waveActive || this.state.enemies.length ? 1 : 0.62,
      assetStore: this.assetStore,
    });
    this.drawTurretSlots(ctx, stage);

    if (this.state.selectedTowerUid) {
      const selected = this.state.towers.find((tower) => tower.uid === this.state.selectedTowerUid);
      const pad = selected && stage.pads[selected.padIndex];
      if (selected && pad) {
        const selectedX = this.state.waveActive && Number.isFinite(selected.x) ? selected.x : pad.x;
        const selectedY = this.state.waveActive && Number.isFinite(selected.y) ? selected.y : pad.y;
        ctx.save();
        ctx.globalAlpha = 0.11;
        const selectedDefinition = TOWER_TYPES[
          slimeVisualType(selected.type, selected.squadType)
        ];
        ctx.fillStyle = selectedDefinition.color;
        ctx.beginPath();
        ctx.arc(selectedX, selectedY, towerRange(this.state, selected), 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = selectedDefinition.color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }

    stage.pads
      .map((pad, padIndex) => ({ pad, padIndex }))
      .sort((left, right) => left.pad.y - right.pad.y || left.pad.x - right.pad.x)
      .forEach(({ pad, padIndex }) => this.drawPad(ctx, pad, padIndex));
    [...this.state.enemies]
      .sort((left, right) => left.y - right.y || left.travelled - right.travelled)
      .forEach((enemy) => this.drawEnemy(ctx, enemy));
    this.drawBattleHero(ctx);
    this.drawDefeatedTowers(ctx);
    this.drawDefeatedActors(ctx);
    this.state.projectiles.forEach((projectile) => this.drawShot(ctx, projectile));
    this.drawEffects(ctx);
  }

  drawLaneField(ctx, lanes, stage) {
    ctx.save();
    for (const lane of lanes) {
      const lanePulse = 0.5 + 0.5 * Math.sin(this.state.time * 0.8 + lane.laneIndex * 0.9);
      const laneGradient = ctx.createLinearGradient(72, lane.y, 1208, lane.y);
      laneGradient.addColorStop(0, 'rgba(218,255,228,0.42)');
      laneGradient.addColorStop(0.48, `${stage.accent}24`);
      laneGradient.addColorStop(1, 'rgba(221,219,255,0.42)');
      ctx.fillStyle = laneGradient;
      roundedPath(ctx, 88, lane.y - 34, 1104, 68, 32);
      ctx.fill();
      ctx.globalAlpha = 0.22 + lanePulse * 0.08;
      ctx.strokeStyle = stage.accent;
      ctx.lineWidth = 2;
      roundedPath(ctx, 88, lane.y - 34, 1104, 68, 32);
      ctx.stroke();
      ctx.globalAlpha = 1;
      this.drawPath(ctx, lane.points, lane.laneIndex);

      ctx.save();
      ctx.globalAlpha = 0.68;
      ctx.fillStyle = '#F8FFE9';
      ctx.strokeStyle = stage.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(126, lane.y, 14, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      label(ctx, lane.laneIndex + 1, 126, lane.y + 1, {
        size: 12, color: COLORS.ink, weight: 950,
      });
    }
    ctx.restore();
  }

  drawLaneGateways(ctx, lanes, stage, gatewayY) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const lane of lanes) {
      const branchAlpha = 0.18 + Math.sin(this.state.time * 1.1 + lane.laneIndex) * 0.025;
      ctx.globalAlpha = branchAlpha;
      ctx.strokeStyle = stage.accent;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(76, gatewayY);
      ctx.bezierCurveTo(98, gatewayY, 98, lane.y, 116, lane.y);
      ctx.stroke();
      ctx.strokeStyle = COLORS.crystal;
      ctx.beginPath();
      ctx.moveTo(1164, lane.y);
      ctx.bezierCurveTo(1184, lane.y, 1180, gatewayY, 1204, gatewayY);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPath(ctx, points, laneIndex = 0) {
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
        ctx.globalAlpha *= 0.2;
        ctx.drawImage(asset, -length / 2 - 8, -25, length + 16, 50);
      }, () => {
        ctx.save();
        ctx.strokeStyle = laneIndex % 2
          ? 'rgba(86, 151, 143, 0.18)'
          : 'rgba(76, 143, 105, 0.18)';
        ctx.lineWidth = 34;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 236, 0.5)';
        ctx.lineWidth = 3;
        ctx.setLineDash?.([9, 16]);
        ctx.stroke();
        ctx.restore();
      });
    }
  }

  drawSquadMembers(ctx, squad, x, y) {
    const squadType = squad.squadType || squad.unitType
      || (squad.type === 'needle' ? 'ranged' : 'melee');
    const slimeType = squadType === 'ranged' ? 'needle' : 'shell';
    const definition = TOWER_TYPES[slimeType];
    const aliveMembers = clamp(Math.floor(Number(squad.aliveMembers) || 0), 0, 4);
    const formations = {
      1: [{ x: 0, y: 6, scale: 1 }],
      2: [{ x: -20, y: 5, scale: 1 }, { x: 20, y: 5, scale: 1 }],
      3: [
        { x: 0, y: -16, scale: 0.88 },
        { x: -21, y: 8, scale: 1 },
        { x: 21, y: 8, scale: 1 },
      ],
      4: [
        { x: -18, y: -17, scale: 0.86 },
        { x: 18, y: -17, scale: 0.86 },
        { x: -22, y: 9, scale: 1 },
        { x: 22, y: 9, scale: 1 },
      ],
    };
    const positions = formations[aliveMembers] || [];
    positions.forEach((position, memberIndex) => {
      const animation = this.characterAnimationSample(
        `squad:${squad.uid}:${memberIndex}`,
        definition.ownerId,
      );
      drawSlime(ctx, x + position.x, y + position.y + 13,
        44 * position.scale, slimeType, {
          time: this.state.time + memberIndex * 0.12,
          facing: squad.facing === -1 ? -1 : 1,
          hit: clamp(Number(squad.hitPulse) || 0, 0, 1),
          expression: Number(squad.hitPulse) > 0.35 ? 'hurt' : 'normal',
          assetStore: this.assetStore,
          ...animation,
          ...this.characterRigOptions(definition.ownerId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
        });
    });
  }

  drawPad(ctx, pad, padIndex) {
    const tower = towerByPad(this.state, padIndex);
    const preparation = this.isPreparation();
    const target = tutorialTargetForState(this.state);
    const tutorialPad = target?.type === 'pad' && target.padIndex === padIndex;
    const activeCardUid = preparation
      ? (this.drag?.kind === 'card' ? this.drag.uid : this.selectedCardUid)
      : null;
    const activeCard = this.state.hand.find((card) => card.uid === activeCardUid);
    const activeTowerUid = preparation && this.drag?.kind === 'tower'
      ? this.drag.uid
      : (preparation && !activeCard ? this.state.selectedTowerUid : null);
    const activeTower = this.state.towers.find((candidate) => candidate.uid === activeTowerUid);
    let dropIntent = null;
    if (activeCard) {
      if (!tower) dropIntent = 'place';
      else if (canMergeCardIntoTower(activeCard, tower)) dropIntent = 'merge';
    } else if (activeTower && activeTower.uid !== tower?.uid) {
      if (!tower) dropIntent = 'move';
      else if (canMergeTowers(activeTower, tower)) dropIntent = 'merge';
    }
    if (!tower && ['melee', 'ranged'].includes(this.selectedPurchase)) dropIntent = 'place';
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
    }, 'pad', { padIndex }, preparation && !tower
      && (['melee', 'ranged'].includes(this.selectedPurchase) || Boolean(activeTower)));

    if (!tower) return;
    const squadVisualType = tower.squadType === 'ranged' || tower.type === 'needle'
      ? 'needle' : 'shell';
    const definition = TOWER_TYPES[tower.type] || TOWER_TYPES[squadVisualType];
    const drawX = this.state.waveActive && Number.isFinite(tower.x) ? tower.x : pad.x;
    const drawY = this.state.waveActive && Number.isFinite(tower.y) ? tower.y : pad.y;
    const selected = tower.uid === this.state.selectedTowerUid;
    const animation = this.characterAnimationSample(
      `tower:${tower.uid}`,
      definition.ownerId,
    );
    const isSquad = tower.kind === 'squad' || Number.isFinite(Number(tower.aliveMembers))
      || ['melee', 'ranged'].includes(tower.squadType);
    if (isSquad) {
      this.drawSquadMembers(ctx, tower, drawX, drawY);
    } else {
      drawSlime(ctx, drawX, drawY + 6, 76, tower.type, {
        time: this.state.time,
        phase: padIndex * 0.41,
        star: tower.star,
        facing: tower.facing === -1 ? -1 : 1,
        selected,
        hit: clamp(Number(tower.hitPulse) || 0, 0, 1),
        expression: Number(tower.hitPulse) > 0.35 ? 'hurt' : 'normal',
        assetStore: this.assetStore,
        ...animation,
        ...this.characterRigOptions(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
      const starY = Math.max(BATTLE_FIELD.top + 22, drawY - 70);
      this.drawStars(ctx, drawX, starY, tower.star, definition.color);
    }
    if (Number.isFinite(tower.hp) && Number.isFinite(tower.maxHp) && tower.maxHp > 0) {
      const hpRatio = clamp(tower.hp / tower.maxHp, 0, 1);
      const bar = {
        x: drawX - 29,
        y: Math.max(BATTLE_FIELD.top + 4, drawY - 91),
        width: 58,
        height: 7,
      };
      ctx.save();
      ctx.fillStyle = 'rgba(30, 48, 58, 0.64)';
      roundedPath(ctx, bar.x, bar.y, bar.width, bar.height, 4);
      ctx.fill();
      if (hpRatio > 0) {
        ctx.fillStyle = hpRatio < 0.3 ? COLORS.coral : COLORS.mint;
        roundedPath(ctx, bar.x + 1, bar.y + 1,
          Math.max(2, (bar.width - 2) * hpRatio), bar.height - 2, 3);
        ctx.fill();
      }
      ctx.restore();
    }
    if (dropIntent === 'merge') {
      const mergeTagY = Math.max(BATTLE_FIELD.top + 4, pad.y - 116);
      panel(ctx, { x: pad.x - 24, y: mergeTagY, width: 48, height: 28 }, {
        fill: '#F4C94C', stroke: '#9B6E20', lineWidth: 2, radius: 14,
      });
      label(ctx, `★${tower.star + 1}`, pad.x, mergeTagY + 15, {
        size: 13, color: COLORS.ink, weight: 950,
      });
    }
    this.addHit(`tower-${tower.uid}`, {
      x: drawX - PAD_RADIUS, y: drawY - 76,
      width: PAD_RADIUS * 2, height: 88,
    }, 'tower', { towerUid: tower.uid, padIndex }, preparation);
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
      facing: -1,
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

  drawDefeatedTowers(ctx) {
    for (const actor of this.defeatedTowers) {
      const definition = TOWER_TYPES[actor.type];
      if (!definition) continue;
      const progress = clamp(actor.age / Math.max(0.001, actor.duration), 0, 1);
      const animation = this.characterAnimationSample(actor.key, actor.ownerId);
      ctx.save();
      ctx.globalAlpha *= clamp(1 - Math.max(0, progress - 0.48) / 0.52, 0, 1);
      ctx.translate(Math.sin(progress * 28) * (1 - progress) * 3, progress * 7);
      if (actor.squadType) {
        drawSlime(ctx, actor.x, actor.y + 19, 44, actor.type, {
          time: this.state.time,
          facing: 1,
          expression: 'hurt',
          assetStore: this.assetStore,
          ...animation,
          ...this.characterRigOptions(actor.ownerId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
        });
      } else {
        drawSlime(ctx, actor.x, actor.y + 6, 76, actor.type, {
          time: this.state.time,
          star: actor.star,
          facing: 1,
          expression: 'hurt',
          assetStore: this.assetStore,
          ...animation,
          ...this.characterRigOptions(actor.ownerId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
        });
      }
      ctx.restore();
      if (progress > 0.34) {
        for (let index = 0; index < 3; index += 1) {
          drawParticle(ctx,
            actor.x + (index - 1) * 16,
            actor.y - 12 - progress * (8 + index * 5),
            12 + index * 2,
            'dust', {
              progress,
              alpha: (1 - progress) * 0.62,
              assetStore: this.assetStore,
            });
        }
      }
    }
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

  drawBattleHud(ctx, stage) {
    drawDockShell(ctx, stage, this.state.time);
    drawAssetOrFallback(ctx, this.assetStore, 'ui-soft-crystal', (asset) => {
      ctx.globalAlpha *= 0.34;
      ctx.drawImage(asset, COMMAND_DOCK.mode.x + 4, COMMAND_DOCK.mode.y + 4, 40, 40);
    }, () => {});

    button(ctx, COMMAND_DOCK.back, '‹', {
      fill: '#F5F3DF', color: COLORS.ink, accent: '#8EB2A1', size: 31,
    });
    this.addHit('battle-menu', COMMAND_DOCK.back, 'battle-menu');

    panel(ctx, COMMAND_DOCK.currency, {
      fill: '#EAF7DB', stroke: '#80B668', radius: 17,
    });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-gel-energy', (asset) => {
      ctx.drawImage(asset, COMMAND_DOCK.currency.x + 6, COMMAND_DOCK.currency.y + 5, 38, 38);
    }, () => {
      ctx.fillStyle = COLORS.mint;
      ctx.beginPath();
      ctx.arc(COMMAND_DOCK.currency.x + 25, COMMAND_DOCK.currency.y + 24, 13, 0, TAU);
      ctx.fill();
    });
    label(ctx, this.state.currency,
      COMMAND_DOCK.currency.x + COMMAND_DOCK.currency.width - 14,
      COMMAND_DOCK.currency.y + COMMAND_DOCK.currency.height / 2 + 1, {
        size: 19, align: 'right', color: COLORS.ink, weight: 920,
      });

    const hpRatio = clamp(this.state.coreHp / Math.max(1, this.state.coreMaxHp), 0, 1);
    panel(ctx, COMMAND_DOCK.core, {
      fill: '#182F37', stroke: 'rgba(255,255,255,0.24)', radius: 15,
    });
    if (hpRatio > 0) {
      roundedPath(ctx, COMMAND_DOCK.core.x + 4, COMMAND_DOCK.core.y + 4,
        Math.max(2, (COMMAND_DOCK.core.width - 8) * hpRatio),
        COMMAND_DOCK.core.height - 8, 11);
      ctx.fillStyle = hpRatio < 0.3 ? COLORS.coral : COLORS.mint;
      ctx.fill();
    }
    label(ctx, `♥ ${this.state.coreHp}`, COMMAND_DOCK.core.x + COMMAND_DOCK.core.width / 2,
      COMMAND_DOCK.core.y + COMMAND_DOCK.core.height / 2 + 1, {
        size: 17, color: COLORS.white, weight: 900,
      });

    const enemyCount = this.state.enemies.length + this.state.spawnQueue.length;
    const stageWaveCount = Math.max(1, stage.waves.length);
    const currentWave = Math.max(0, Number(this.state.wave) || 0);
    const activeWave = stage.waves[Math.max(0, currentWave - 1)];
    const trackedTotal = Number(this.state.waveEnemyTotal);
    const activeTotal = Number.isFinite(trackedTotal) && trackedTotal > 0
      ? trackedTotal
      : waveUnitCount(activeWave);
    const trackedResolved = Number(this.state.waveEnemyResolved);
    const activeProgress = this.state.waveActive && activeTotal > 0
      ? clamp(Number.isFinite(trackedResolved)
        ? trackedResolved / activeTotal
        : (activeTotal - enemyCount) / activeTotal, 0, 1)
      : currentWave > 0 ? 1 : 0;
    const waveProgress = this.state.mode === 'endless'
      ? activeProgress
      : clamp(((this.state.waveActive ? Math.max(0, currentWave - 1) : currentWave)
        + (this.state.waveActive ? activeProgress : 0)) / stageWaveCount, 0, 1);

    panel(ctx, COMMAND_DOCK.wave, {
      fill: '#17353C', stroke: 'rgba(225,255,236,0.24)', radius: 17,
    });
    const progressTrack = {
      x: COMMAND_DOCK.wave.x + 68,
      y: COMMAND_DOCK.wave.y + 9,
      width: COMMAND_DOCK.wave.width - 82,
      height: COMMAND_DOCK.wave.height - 18,
    };
    roundedPath(ctx, progressTrack.x, progressTrack.y,
      progressTrack.width, progressTrack.height, 9);
    ctx.fillStyle = 'rgba(230,248,226,0.15)';
    ctx.fill();
    if (waveProgress > 0) {
      roundedPath(ctx, progressTrack.x, progressTrack.y,
        Math.max(4, progressTrack.width * waveProgress), progressTrack.height, 9);
      ctx.fillStyle = stage.accent;
      ctx.fill();
    }
    const waveText = this.state.mode === 'endless'
      ? `∞${Math.max(1, currentWave)}`
      : `${currentWave}/${stage.waves.length}`;
    label(ctx, waveText, COMMAND_DOCK.wave.x + 34,
      COMMAND_DOCK.wave.y + COMMAND_DOCK.wave.height / 2 + 1, {
        size: 16, color: COLORS.white, weight: 900,
      });
    if (this.state.mode !== 'endless') {
      for (let index = 1; index < stageWaveCount; index += 1) {
        const x = progressTrack.x + progressTrack.width * index / stageWaveCount;
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#F6FFE8';
        ctx.beginPath();
        ctx.arc(x, progressTrack.y + progressTrack.height / 2, 2.5, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    panel(ctx, COMMAND_DOCK.enemies, {
      fill: '#E8E7D8', stroke: 'rgba(255,255,255,0.32)', radius: 17,
    });
    label(ctx, `◆ ${enemyCount}`,
      COMMAND_DOCK.enemies.x + COMMAND_DOCK.enemies.width / 2,
      COMMAND_DOCK.enemies.y + COMMAND_DOCK.enemies.height / 2 + 1, {
        size: 17, color: enemyCount ? COLORS.coral : COLORS.inkSoft, weight: 900,
      });

    panel(ctx, COMMAND_DOCK.mode, {
      fill: 'rgba(235,244,225,0.9)', stroke: stage.accent, radius: 17,
    });
    label(ctx, this.state.mode === 'endless' ? '无尽' : stage.name,
      COMMAND_DOCK.mode.x + COMMAND_DOCK.mode.width - 12,
      COMMAND_DOCK.mode.y + COMMAND_DOCK.mode.height / 2 + 1, {
        size: 15, align: 'right', color: COLORS.ink, weight: 900,
      });

    this.drawPreparationDock(ctx, stage);
  }

  drawPreparationDock(ctx, stage) {
    this.drawDirectPurchaseDock(ctx, stage);
    return;
  }

  drawSquadPurchasePreview(ctx, rect, type) {
    const definition = TOWER_TYPES[type] || TOWER_TYPES.shell;
    const positions = [
      { x: -27, y: -18, scale: 0.86 },
      { x: 27, y: -18, scale: 0.86 },
      { x: -28, y: 9, scale: 1 },
      { x: 28, y: 9, scale: 1 },
    ];
    positions.forEach((position, memberIndex) => {
      const key = `purchase:${type}:${memberIndex}`;
      const animation = this.characterAnimationSample(key, definition.ownerId);
      drawSlime(ctx, rect.x + rect.width / 2 + position.x,
        rect.y + 108 + position.y, 38 * position.scale, type, {
          time: this.state.time + memberIndex * 0.13,
          facing: memberIndex % 2 ? -1 : 1,
          assetStore: this.assetStore,
          ...animation,
          ...this.characterRigOptions(definition.ownerId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
        });
    });
  }

  drawDirectPurchaseDock(ctx, stage) {
    const preparation = this.isPreparation();
    if (preparation) {
      panel(ctx, { x: 96, y: 76, width: 274, height: 40 }, {
        fill: 'rgba(255,248,220,0.92)', stroke: '#A57930', lineWidth: 2, radius: 18,
        shadow: true,
      });
      const prepText = this.selectedPurchase === 'melee' || this.selectedPurchase === 'ranged'
        ? '选择空兵位'
        : this.selectedPurchase === 'turret' ? '选择固定炮台位' : '备战';
      label(ctx, prepText, 233, 97, {
        size: 16, color: COLORS.ink, weight: 900,
      });
    }

    const heroType = this.state.hero?.type || this.state.selectedHeroId || 'shell';
    const heroDefinition = TOWER_TYPES[heroType] || TOWER_TYPES.shell;
    panel(ctx, { x: 16, y: 582, width: 148, height: 124 }, {
      fill: 'rgba(244,250,226,0.88)', stroke: heroDefinition.color,
      lineWidth: 3, radius: 22,
    });
    const heroAnimation = this.characterAnimationSample(
      this.state.hero ? `hero:${this.state.hero.uid || heroType}` : `preview:menu:${heroType}`,
      heroDefinition.ownerId,
    );
    drawSlime(ctx, 90, 701, 66, heroType, {
      time: this.state.time,
      facing: 1,
      assetStore: this.assetStore,
      ...heroAnimation,
      ...this.characterRigOptions(heroDefinition.ownerId),
      allowGeneratedStandalone: this.generatedCharacterArtEnabled,
    });
    label(ctx, '英雄', 90, 600, {
      size: 15, color: COLORS.ink, weight: 950,
    });

    const entries = [
      { id: 'melee', label: '近战小队', cost: 100, type: 'shell' },
      { id: 'ranged', label: '远程小队', cost: 150, type: 'needle' },
      { id: 'turret', label: '固定炮台', cost: 175, type: null },
    ];
    entries.forEach((entry) => {
      const rect = COMMAND_DOCK.purchase[entry.id];
      const selected = this.selectedPurchase === entry.id;
      const enabled = preparation && this.state.currency >= entry.cost;
      const hot = enabled && Boolean(this.hoverPoint && insideRect(this.hoverPoint, rect));
      const accent = entry.id === 'melee'
        ? TOWER_TYPES.shell.color
        : entry.id === 'ranged' ? TOWER_TYPES.needle.color : '#6BC9A0';
      panel(ctx, rect, {
        fill: enabled ? selected ? '#FFF2B8' : hot ? '#FFFEF1' : '#FFF8E8' : '#AEBBB5',
        stroke: selected ? '#E0A129' : enabled ? accent : '#74837D',
        lineWidth: selected || hot ? 5 : 2,
        radius: 22,
        shadow: enabled,
      });
      drawAssetOrFallback(ctx, this.assetStore, 'ui-card-frame-common', (asset) => {
        ctx.globalAlpha *= enabled ? 0.23 : 0.1;
        ctx.drawImage(asset, rect.x, rect.y, rect.width, rect.height);
      }, () => {});
      label(ctx, entry.label, rect.x + 14, rect.y + 20, {
        size: 17, align: 'left', color: COLORS.ink, weight: 950,
      });
      drawAssetOrFallback(ctx, this.assetStore, 'ui-gel-energy', (asset) => {
        ctx.globalAlpha *= enabled ? 0.95 : 0.4;
        ctx.drawImage(asset, rect.x + rect.width - 62, rect.y + 7, 24, 24);
      }, () => {});
      label(ctx, entry.cost, rect.x + rect.width - 12, rect.y + 20, {
        size: 15, align: 'right', color: enabled ? COLORS.ink : COLORS.disabled, weight: 950,
      });
      if (entry.type) {
        this.drawSquadPurchasePreview(ctx, rect, entry.type);
      } else {
        drawBuilding(ctx, rect.x + rect.width / 2, rect.y + 119, 88, 'tower', {
          assetKey: 'turret-gel-mortar',
          assetStore: this.assetStore,
          ...GEL_MORTAR_ASSET_LAYOUT,
          disabled: !enabled,
        });
      }
      this.addHit(`purchase-${entry.id}`, rect, 'select-purchase', {
        purchaseType: entry.id,
      }, enabled);
    });

    const legacyCanStart = preparation
      && !(this.state.mode === 'stage' && this.state.wave >= stage.waves.length);
    button(ctx, COMMAND_DOCK.start, preparation ? '开战' : `第${this.state.wave}波`, {
      enabled: legacyCanStart, fill: '#F0B84E', accent: '#B87728', size: 27,
    });
    if (preparation) {
      label(ctx, `${this.state.wave + 1}`, COMMAND_DOCK.start.x + COMMAND_DOCK.start.width / 2,
        COMMAND_DOCK.start.y + COMMAND_DOCK.start.height - 20, {
          size: 13, color: '#714C20', weight: 900,
        });
    }
    this.addHit('start-wave', COMMAND_DOCK.start, 'start-wave', {}, legacyCanStart);

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
      const visualType = slimeVisualType(selectedTower.type, selectedTower.squadType);
      const definition = TOWER_TYPES[visualType];
      const animation = this.characterAnimationSample(
        `tower:${selectedTower.uid}`,
        definition.ownerId,
      );
      drawSlime(ctx, COMMAND_DOCK.selection.x + 38, COMMAND_DOCK.selection.y + 113,
        45, visualType, {
          time: this.state.time,
          star: selectedTower.star,
          facing: 1,
          assetStore: this.assetStore,
          ...animation,
          ...this.characterRigOptions(definition.ownerId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
        });
      label(ctx, definition.name, COMMAND_DOCK.selection.x + 69,
        COMMAND_DOCK.selection.y + 24, {
          size: 18, align: 'left', color: COLORS.ink, weight: 900,
        });
      label(ctx, '★'.repeat(selectedTower.star), COMMAND_DOCK.selection.x + 69,
        COMMAND_DOCK.selection.y + 49, {
          size: 13, align: 'left', color: definition.color, weight: 900,
        });
      const evolution = towerAttackEvolution(visualType, selectedTower.star);
      const attackName = ATTACK_MODE_LABEL[evolution.attackMode] || definition.glyph;
      label(ctx, `${attackName}  ·  ↔`, COMMAND_DOCK.selection.x + COMMAND_DOCK.selection.width - 18,
        COMMAND_DOCK.selection.y + 91, {
          size: 14, align: 'right', color: COLORS.inkSoft, weight: 800,
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
      label(ctx, definition.name, COMMAND_DOCK.selection.x + 64,
        COMMAND_DOCK.selection.y + 31, {
          size: 18, align: 'left', color: COLORS.ink, weight: 900,
        });
      label(ctx, matches.length ? `融  ${matches.length}` : '放', COMMAND_DOCK.selection.x + 64,
        COMMAND_DOCK.selection.y + 66, {
          size: 16, align: 'left', color: matches.length ? COLORS.gold : COLORS.inkSoft, weight: 900,
        });
      label(ctx, '★'.repeat(selectedCard.star), COMMAND_DOCK.selection.x + COMMAND_DOCK.selection.width - 20,
        COMMAND_DOCK.selection.y + 45, {
          size: 17, align: 'right', color: definition.color, weight: 900,
        });
      return;
    }

    Object.values(TOWER_TYPES).forEach((tower, index) => {
      const x = COMMAND_DOCK.selection.x + 26 + index * 42;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = tower.color;
      ctx.beginPath();
      ctx.arc(x, COMMAND_DOCK.selection.y + 42, 14, 0, TAU);
      ctx.fill();
      ctx.restore();
      label(ctx, tower.glyph, x, COMMAND_DOCK.selection.y + 42, {
        size: 13, color: COLORS.white, weight: 950,
      });
      const rate = { shell: 28, needle: 28, bubble: 24, sprout: 20 }[tower.id];
      label(ctx, `${rate}%`, x, COMMAND_DOCK.selection.y + 82, {
        size: 11, color: COLORS.inkSoft, weight: 800,
      });
    });
  }

  drawHandCard(ctx, card, rect, { selected = false, mergeReady = false, dragging = false } = {}) {
    const definition = TOWER_TYPES[card.type];
    const compact = rect.width < 110;
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
    drawSlime(ctx, rect.x + rect.width / 2, rect.y + rect.height - (compact ? 2 : 6),
      compact ? 59 : 82, card.type, {
      time: this.state.time,
      star: card.star,
      facing: 1,
      assetStore: this.assetStore,
      ...animation,
      ...this.characterRigOptions(definition.ownerId),
      allowGeneratedStandalone: this.generatedCharacterArtEnabled,
    });
    label(ctx, definition.name, rect.x + (compact ? 7 : 13), rect.y + 20, {
      size: compact ? 12 : 17, align: 'left', color: COLORS.ink, weight: 900,
    });
    label(ctx, compact ? `★${card.star}` : '★'.repeat(card.star),
      rect.x + rect.width - (compact ? 6 : 12), rect.y + 20, {
        size: compact ? 11 : 14, align: 'right', color: definition.color, weight: 900,
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
      const visualType = slimeVisualType(tower.type, tower.squadType);
      const definition = TOWER_TYPES[visualType];
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
      const isSquad = tower.kind === 'soldier' || Number.isFinite(Number(tower.aliveMembers));
      if (isSquad) {
        this.drawSquadMembers(ctx, tower, this.drag.point.x, this.drag.point.y + 10);
      } else {
        drawSlime(ctx, this.drag.point.x, this.drag.point.y + 30, 76, visualType, {
          time: this.state.time,
          star: tower.star,
          assetStore: this.assetStore,
          ...animation,
          ...this.characterRigOptions(definition.ownerId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
        });
        this.drawStars(ctx, this.drag.point.x, this.drag.point.y - 42,
          tower.star, definition.color);
      }
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
      if (this.menuPage === 'stage-select') {
        const card = STAGE_SELECT_CARDS[target.stageIndex];
        return card ? [{
          x: card.x + card.width / 2,
          y: card.y + card.height / 2,
          radius: 118,
        }] : [];
      }
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
    if (target.type === 'shop') {
      const rect = COMMAND_DOCK.shop[target.offerIndex || 0];
      return rect ? [{
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        radius: 82,
      }] : [];
    }
    if (target.type === 'squad') {
      if (this.selectedPurchase === target.squadType) {
        const pad = stageForState(this.state).pads[target.padIndex];
        return pad ? [{ x: pad.x, y: pad.y - 8, radius: 72 }] : [];
      }
      const rect = COMMAND_DOCK.purchase[target.squadType];
      return rect ? [{
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        radius: 90,
      }] : [];
    }
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
      stage: '1', squad: '近', shop: '买', draw: '抽', pad: '放', fusion: '融', start: '战',
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
