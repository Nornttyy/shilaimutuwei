/**
 * Deterministic rules for the Fusion Slime tower-defense mode.
 *
 * The canvas shell owns input, animation frames and persistence. This module
 * keeps the run state serialisable and exposes small commands so browser,
 * WeChat and tests all execute the same rules.
 */

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
const scaleValue = (value) => Math.round(value * 1000) / 1000;

export const TD_VIEW = Object.freeze({ width: 1280, height: 720 });
export const TD_FIELD = Object.freeze({ x: 0, y: 0, width: 1280, height: 720 });
export const TD_MAX_STAR = 4;
export const TD_HAND_LIMIT = 4;
export const TD_LANE_COUNT = 5;
export const TD_COLUMN_COUNT = 7;
export const TD_STORAGE_KEY = 'slime-fusion-defense-v1';
export const TD_STAGE_SCALE_CAPS = Object.freeze({ hp: 3.4, speed: 1.4, reward: 2.2 });
export const TD_ENDLESS_SCALE_CAPS = Object.freeze({
  count: 8,
  hp: 7.5,
  speed: 1.55,
  reward: 3,
  bossCount: 2,
});

export const TOWER_TYPES = Object.freeze({
  shell: Object.freeze({
    id: 'shell',
    ownerId: 'survivor-shell-shell',
    name: '壳壳',
    glyph: '盾',
    color: '#62D5A0',
    range: 142,
    interval: 0.78,
    damage: 17,
    maxHp: 260,
    projectile: 'goo',
    projectileSpeed: 480,
    effect: 'splash',
  }),
  needle: Object.freeze({
    id: 'needle',
    ownerId: 'survivor-crystal-pin',
    name: '亮钉',
    glyph: '晶',
    color: '#75CFF4',
    range: 238,
    interval: 1.02,
    damage: 29,
    maxHp: 130,
    projectile: 'needle',
    projectileSpeed: 670,
    effect: 'pierce',
  }),
  bubble: Object.freeze({
    id: 'bubble',
    ownerId: 'survivor-bubble-float',
    name: '浮浮',
    glyph: '泡',
    color: '#75DFF0',
    range: 184,
    interval: 0.58,
    damage: 10,
    maxHp: 155,
    projectile: 'bubble',
    projectileSpeed: 430,
    effect: 'slow',
  }),
  sprout: Object.freeze({
    id: 'sprout',
    ownerId: 'survivor-moss-sprout',
    name: '芽芽',
    glyph: '芽',
    color: '#8EDB70',
    range: 176,
    interval: 0.72,
    damage: 9,
    maxHp: 145,
    projectile: 'seed',
    projectileSpeed: 510,
    effect: 'poison',
  }),
});

const freezeAttackSteps = (steps) => Object.freeze(steps.map((step) => Object.freeze(step)));

/**
 * Star upgrades change how attacks are delivered, not only their damage.
 * These fields are copied onto projectiles so renderers can opt into richer
 * star-specific visuals without changing the deterministic combat rules.
 */
export const TOWER_ATTACK_EVOLUTIONS = Object.freeze({
  shell: freezeAttackSteps([
    {
      attackMode: 'goo-splash', projectileCount: 1, secondaryDamageScale: 0,
      splashRadius: 49, splashDamageScale: 0.52, knockback: 0,
    },
    {
      attackMode: 'goo-shockwave', projectileCount: 1, secondaryDamageScale: 0,
      splashRadius: 62, splashDamageScale: 0.5, knockback: 2,
    },
    {
      attackMode: 'goo-split', projectileCount: 2, secondaryDamageScale: 0.18,
      splashRadius: 70, splashDamageScale: 0.46, knockback: 2.5,
    },
    {
      attackMode: 'goo-cluster', projectileCount: 3, secondaryDamageScale: 0.14,
      splashRadius: 80, splashDamageScale: 0.42, knockback: 3,
    },
  ]),
  needle: freezeAttackSteps([
    {
      attackMode: 'needle-pierce', projectileCount: 1, secondaryDamageScale: 0,
      pierceTargets: 1, pierceDamageScale: 0.68,
    },
    {
      attackMode: 'needle-double', projectileCount: 1, secondaryDamageScale: 0,
      pierceTargets: 2, pierceDamageScale: 0.68,
    },
    {
      attackMode: 'needle-fork', projectileCount: 2, secondaryDamageScale: 0.16,
      pierceTargets: 2, pierceDamageScale: 0.64,
    },
    {
      attackMode: 'needle-fan', projectileCount: 3, secondaryDamageScale: 0.12,
      pierceTargets: 3, pierceDamageScale: 0.6,
    },
  ]),
  bubble: freezeAttackSteps([
    {
      attackMode: 'bubble-slow', projectileCount: 1, secondaryDamageScale: 0,
      chainTargets: 0, chainRadius: 0, chainPower: 0,
    },
    {
      attackMode: 'bubble-chain', projectileCount: 1, secondaryDamageScale: 0,
      chainTargets: 1, chainRadius: 100, chainPower: 0.55,
    },
    {
      attackMode: 'bubble-cascade', projectileCount: 1, secondaryDamageScale: 0,
      chainTargets: 2, chainRadius: 120, chainPower: 0.5,
    },
    {
      attackMode: 'bubble-tide', projectileCount: 1, secondaryDamageScale: 0,
      chainTargets: 3, chainRadius: 145, chainPower: 0.45,
    },
  ]),
  sprout: freezeAttackSteps([
    {
      attackMode: 'seed-poison', projectileCount: 1, secondaryDamageScale: 0,
      spreadTargets: 0, spreadRadius: 0, spreadPoisonScale: 0,
    },
    {
      attackMode: 'seed-branch', projectileCount: 1, secondaryDamageScale: 0,
      spreadTargets: 1, spreadRadius: 96, spreadPoisonScale: 0.3,
    },
    {
      attackMode: 'seed-canopy', projectileCount: 1, secondaryDamageScale: 0,
      spreadTargets: 2, spreadRadius: 118, spreadPoisonScale: 0.28,
    },
    {
      attackMode: 'seed-bloom', projectileCount: 1, secondaryDamageScale: 0,
      spreadTargets: 3, spreadRadius: 144, spreadPoisonScale: 0.25,
    },
  ]),
});

export function towerAttackEvolution(towerType, star = 1) {
  const steps = TOWER_ATTACK_EVOLUTIONS[towerType] || TOWER_ATTACK_EVOLUTIONS.shell;
  const index = clamp(Math.floor(Number(star) || 1), 1, TD_MAX_STAR) - 1;
  return steps[index];
}

export const TOWER_DRAW_WEIGHTS = Object.freeze([
  Object.freeze({ type: 'shell', weight: 28 }),
  Object.freeze({ type: 'needle', weight: 28 }),
  Object.freeze({ type: 'bubble', weight: 24 }),
  Object.freeze({ type: 'sprout', weight: 20 }),
]);

export const TD_ENEMIES = Object.freeze({
  bug: Object.freeze({
    id: 'bug', ownerId: 'enemy-soft-biter', hp: 40, speed: 36, reward: 7,
    size: 58, coreDamage: 1, attackDamage: 9, attackInterval: 1.2, color: '#A77770',
  }),
  windcap: Object.freeze({
    id: 'windcap', ownerId: 'enemy-windcap', hp: 36, speed: 54, reward: 9,
    size: 55, coreDamage: 2, attackDamage: 8, attackInterval: 0.85, color: '#C18BCC',
  }),
  stone: Object.freeze({
    id: 'stone', ownerId: 'enemy-stone-lump', hp: 140, speed: 26, reward: 18,
    size: 68, coreDamage: 2, attackDamage: 18, attackInterval: 1.55, color: '#85848D',
  }),
  boss: Object.freeze({
    id: 'boss', ownerId: 'enemy-acid-shell-king', hp: 1150, speed: 20, reward: 100,
    size: 104, coreDamage: 10, attackDamage: 38, attackInterval: 1.35,
    color: '#778D54', boss: true,
  }),
});

const freezePoints = (points) => Object.freeze(points.map((point) => Object.freeze(point)));
const TD_LANE_Y = Object.freeze([156, 244, 332, 420, 508]);
const TD_COLUMN_X = Object.freeze([200, 340, 480, 620, 760, 900, 1040]);
const TD_LANE_INDICES = Object.freeze(Array.from({ length: TD_LANE_COUNT }, (_, index) => index));

const freezeLanes = () => Object.freeze(TD_LANE_Y.map((y, index) => Object.freeze({
  id: `lane-${index}`,
  index,
  y,
  path: freezePoints([{ x: 1260, y }, { x: 96, y }]),
})));

const freezeLanePads = (lanes) => Object.freeze(lanes.flatMap((lane) => (
  TD_COLUMN_X.map((baseX, columnIndex) => {
    const index = lane.index * TD_COLUMN_COUNT + columnIndex;
    return Object.freeze({
      id: `pad-${index}`,
      x: baseX + (lane.index % 2 === 1 ? 20 : 0),
      y: lane.y,
      laneIndex: lane.index,
      columnIndex,
    });
  })
)));

const group = (type, count, interval, delay = 0, laneIndices = TD_LANE_INDICES) => Object.freeze({
  type,
  count,
  interval,
  delay,
  laneIndices: Object.freeze([...laneIndices]),
});
const wave = (...groups) => Object.freeze(groups);

const laneStage = ({ id, index, name, accent, waves }) => {
  const lanes = freezeLanes();
  return Object.freeze({
    id,
    index,
    name,
    accent,
    lanes,
    // Kept as the middle route for callers that still need generic path
    // geometry. Combat itself always resolves the enemy's authored lane.
    path: lanes[Math.floor(TD_LANE_COUNT / 2)].path,
    pads: freezeLanePads(lanes),
    base: Object.freeze({ x: 58, y: lanes[2].y, goalX: lanes[2].path.at(-1).x }),
    tutorialPadIndex: 0,
    waves: Object.freeze(waves),
  });
};

export const TD_STAGES = Object.freeze([
  laneStage({
    id: 'stage-1',
    index: 1,
    name: '软胶坡',
    accent: '#62D5A0',
    waves: [
      // The tutorial creates one fused defender on pad 0, so the opening
      // group deliberately teaches a single lane before pressure spreads.
      wave(group('bug', 5, 0.9, 0, [0])),
      wave(group('bug', 5, 0.72, 0, [0, 1]), group('windcap', 2, 0.92, 2, [1, 0])),
      wave(group('bug', 4, 0.68, 0, [0, 2, 4]), group('stone', 3, 1.32, 2.4, [4, 2, 0])),
      wave(group('windcap', 3, 0.66, 0, [0, 2, 4]), group('stone', 4, 1.2, 2, [1, 3])),
      wave(
        group('bug', 2, 0.65, 0, [1, 3]),
        group('stone', 4, 1.15, 1.8, [0, 1, 3, 4]),
        group('boss', 1, 0, 5.6, [2]),
      ),
    ],
  }),
  laneStage({
    id: 'stage-2',
    index: 2,
    name: '泡泡湾',
    accent: '#67CFE8',
    waves: [
      wave(group('windcap', 8, 0.72, 0, [0, 1, 2, 3, 4])),
      wave(group('bug', 4, 0.68, 0, [0, 2, 4]), group('windcap', 4, 0.78, 1.6, [1, 3])),
      wave(group('windcap', 4, 0.68, 0, [0, 1, 3, 4]), group('stone', 4, 1.18, 1.9, [2, 4, 0, 3])),
      wave(group('bug', 3, 0.62, 0, [0, 2, 4]), group('stone', 5, 1.12, 1.7, [1, 3, 2, 0, 4])),
      wave(group('windcap', 2, 0.62, 0, [1, 3]), group('stone', 5, 1.08, 1.7), group('boss', 1, 0, 5.4, [2])),
      wave(group('bug', 2, 0.58, 0, [0, 4]), group('stone', 5, 1.04, 1.6), group('boss', 1, 0, 5, [2])),
    ],
  }),
  laneStage({
    id: 'stage-3',
    index: 3,
    name: '晶刺环',
    accent: '#8C80E8',
    waves: [
      wave(group('bug', 5, 0.64, 0), group('windcap', 4, 0.74, 1.4, [4, 2, 0, 3, 1])),
      wave(group('windcap', 5, 0.64, 0), group('stone', 4, 1.1, 1.7, [1, 3, 0, 4])),
      wave(group('bug', 4, 0.58, 0, [0, 2, 4]), group('stone', 5, 1.06, 1.6)),
      wave(group('windcap', 4, 0.58, 0, [4, 2, 0, 3]), group('stone', 5, 1.02, 1.5)),
      wave(group('bug', 3, 0.54, 0, [0, 2, 4]), group('stone', 5, 0.98, 1.4), group('boss', 1, 0, 5, [2])),
      wave(group('windcap', 3, 0.54, 0, [1, 3, 2]), group('stone', 5, 0.96, 1.4), group('boss', 1, 0, 4.6, [2])),
      wave(group('bug', 1, 0.52, 0, [2]), group('stone', 6, 0.92, 1.3), group('boss', 2, 3.6, 4.4, [1, 3])),
    ],
  }),
]);

export const TD_STAGE_BY_ID = Object.freeze(Object.fromEntries(
  TD_STAGES.map((stage) => [stage.id, stage]),
));

const copyProgress = (source = {}) => ({
  unlockedStage: clamp(Math.floor(Number(source.unlockedStage) || 1), 1, TD_STAGES.length),
  clearedStages: [...new Set(Array.isArray(source.clearedStages) ? source.clearedStages : [])]
    .filter((id) => TD_STAGE_BY_ID[id]),
  bestEndlessWave: Math.max(0, Math.floor(Number(source.bestEndlessWave) || 0)),
  tutorialSeen: Boolean(source.tutorialSeen),
});

export function normalizeTowerDefenseProgress(source = {}) {
  const progress = copyProgress(source);
  return Object.freeze({
    ...progress,
    clearedStages: Object.freeze(progress.clearedStages),
  });
}

function seededStep(state) {
  let value = Number(state.rngState) >>> 0;
  value = (Math.imul(value || 0x6D2B79F5, 1664525) + 1013904223) >>> 0;
  state.rngState = value;
  return value / 0x100000000;
}

function nextUid(state, prefix) {
  state.uidCounter += 1;
  return `${prefix}-${state.uidCounter}`;
}

const TOWER_HP_STAR_MULTIPLIER = Object.freeze([0, 1, 1.65, 2.6, 4]);

function maxHpForTower(type, star = 1) {
  const definition = TOWER_TYPES[type] || TOWER_TYPES.shell;
  const level = clamp(Math.floor(Number(star) || 1), 1, TD_MAX_STAR);
  return Math.round(definition.maxHp * TOWER_HP_STAR_MULTIPLIER[level]);
}

function ensureTowerHealth(tower) {
  if (!tower) return null;
  const expectedMaxHp = maxHpForTower(tower.type, tower.star);
  if (!(Number(tower.maxHp) > 0)) tower.maxHp = expectedMaxHp;
  if (!Number.isFinite(Number(tower.hp))) tower.hp = tower.maxHp;
  tower.hp = clamp(Number(tower.hp) || 0, 0, tower.maxHp);
  tower.hitPulse = clamp(Number(tower.hitPulse) || 0, 0, 1);
  return tower;
}

function upgradeTowerHealth(tower, nextStar) {
  ensureTowerHealth(tower);
  const healthRatio = tower.maxHp > 0 ? tower.hp / tower.maxHp : 1;
  tower.star = clamp(Math.floor(Number(nextStar) || tower.star), 1, TD_MAX_STAR);
  tower.maxHp = maxHpForTower(tower.type, tower.star);
  tower.hp = Math.max(1, Math.round(tower.maxHp * healthRatio));
  return tower;
}

function emptyRunState(progress, seed) {
  return {
    screen: 'menu',
    mode: 'stage',
    stageId: 'stage-1',
    progress: copyProgress(progress),
    tutorial: {
      active: !progress.tutorialSeen,
      step: progress.tutorialSeen ? 'done' : 'stage',
      forcedDraws: 0,
    },
    rngState: (Number(seed) >>> 0) || 0x51A7E,
    uidCounter: 0,
    time: 0,
    wave: 0,
    waveActive: false,
    waveElapsed: 0,
    waveBreak: 0,
    waveEnemyTotal: 0,
    waveEnemyResolved: 0,
    spawnQueue: [],
    hand: [],
    towers: [],
    enemies: [],
    projectiles: [],
    effects: [],
    currency: 120,
    drawCount: 0,
    coreHp: 32,
    coreMaxHp: 32,
    kills: 0,
    result: null,
    selectedTowerUid: null,
    events: [],
  };
}

export function createTowerDefenseState({ progress = {}, seed = 0x51A7E } = {}) {
  const normalized = normalizeTowerDefenseProgress(progress);
  return emptyRunState(normalized, seed);
}

export function stageForState(state) {
  return TD_STAGE_BY_ID[state?.stageId] || TD_STAGES[0];
}

export function drawCostForState(state) {
  return Math.min(55, 25 + Math.floor(Math.max(0, state.drawCount) / 3) * 5);
}

function resetRun(state, { mode, stageId }) {
  const preservedProgress = copyProgress(state.progress);
  const preservedTutorial = { ...state.tutorial };
  const preservedRng = state.rngState;
  const next = emptyRunState(preservedProgress, preservedRng);
  Object.assign(state, next, {
    screen: 'battle',
    mode,
    stageId,
    tutorial: preservedTutorial.active
      ? { active: true, step: 'draw-1', forcedDraws: 0 }
      : { active: false, step: 'done', forcedDraws: preservedTutorial.forcedDraws || 0 },
  });
  return state;
}

export function beginTowerDefenseRun(state, { mode = 'stage', stageId = 'stage-1' } = {}) {
  const requestedMode = mode === 'endless' ? 'endless' : 'stage';
  const stage = TD_STAGE_BY_ID[stageId] || TD_STAGES[0];
  if (state.tutorial.active && (requestedMode !== 'stage' || stage.id !== 'stage-1')) return false;
  if (requestedMode === 'stage' && stage.index > state.progress.unlockedStage) return false;
  resetRun(state, { mode: requestedMode, stageId: stage.id });
  state.events.push({ type: 'run-start' });
  return true;
}

function weightedTowerType(state) {
  let roll = seededStep(state) * TOWER_DRAW_WEIGHTS.reduce((sum, entry) => sum + entry.weight, 0);
  for (const entry of TOWER_DRAW_WEIGHTS) {
    roll -= entry.weight;
    if (roll < 0) return entry.type;
  }
  return TOWER_DRAW_WEIGHTS.at(-1).type;
}

export function drawTowerCard(state) {
  if (state.screen !== 'battle' || state.result || state.hand.length >= TD_HAND_LIMIT) return null;
  if (state.tutorial.active && !['draw-1', 'draw-2'].includes(state.tutorial.step)) return null;
  const cost = drawCostForState(state);
  if (state.currency < cost) return null;
  state.currency -= cost;
  state.drawCount += 1;
  const forced = state.tutorial.active && state.tutorial.forcedDraws < 2;
  const type = forced ? 'shell' : weightedTowerType(state);
  if (forced) state.tutorial.forcedDraws += 1;
  const card = { uid: nextUid(state, 'card'), type, star: 1 };
  state.hand.push(card);
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'summon', age: 0, duration: 0.65, x: 80, y: 640,
  });
  state.events.push({ type: 'draw', towerType: type });
  if (state.tutorial.active) {
    if (state.tutorial.step === 'draw-1') state.tutorial.step = 'place-1';
    else if (state.tutorial.step === 'draw-2') state.tutorial.step = 'fuse';
  }
  return card;
}

export function placeTowerFromHand(state, cardUid, padIndex) {
  if (state.screen !== 'battle' || state.result) return null;
  if (state.tutorial.active && state.tutorial.step !== 'place-1') return null;
  const stage = stageForState(state);
  const index = Math.floor(Number(padIndex));
  if (!stage.pads[index] || state.towers.some((tower) => tower.padIndex === index)) return null;
  const handIndex = state.hand.findIndex((card) => card.uid === cardUid);
  if (handIndex < 0) return null;
  const [card] = state.hand.splice(handIndex, 1);
  const maxHp = maxHpForTower(card.type, card.star);
  const healthRatio = clamp(Number(card.healthRatio) || 1, 0.01, 1);
  const tower = {
    uid: nextUid(state, 'tower'),
    type: card.type,
    star: card.star,
    padIndex: index,
    hp: Math.max(1, Math.round(maxHp * healthRatio)),
    maxHp,
    hitPulse: 0,
    cooldown: Math.max(0.16, Number(card.redeployCooldown) || 0),
    aimAngle: 0,
    attackPulse: 0,
  };
  state.towers.push(tower);
  const pad = stage.pads[index];
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'place', age: 0, duration: 0.55, x: pad.x, y: pad.y,
  });
  state.events.push({ type: 'place', towerUid: tower.uid });
  if (state.tutorial.active) {
    if (state.tutorial.step === 'place-1') state.tutorial.step = 'draw-2';
  }
  return tower;
}

export function canMergeTowers(left, right) {
  return Boolean(
    left && right && left.uid !== right.uid
    && left.type === right.type
    && left.star === right.star
    && left.star < TD_MAX_STAR,
  );
}

export function mergeTowers(state, sourceUid, targetUid) {
  if (state.screen !== 'battle' || state.result) return null;
  if (state.tutorial.active && state.tutorial.step !== 'fuse') return null;
  const source = state.towers.find((tower) => tower.uid === sourceUid);
  const target = state.towers.find((tower) => tower.uid === targetUid);
  if (!canMergeTowers(source, target)) return null;
  const sourceIndex = state.towers.indexOf(source);
  state.towers.splice(sourceIndex, 1);
  upgradeTowerHealth(target, target.star + 1);
  target.cooldown = Math.min(target.cooldown, 0.12);
  state.selectedTowerUid = null;
  const pad = stageForState(state).pads[target.padIndex];
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'merge', age: 0, duration: 0.9, x: pad.x, y: pad.y,
  });
  state.events.push({ type: 'merge', towerUid: target.uid, star: target.star });
  if (state.tutorial.active && state.tutorial.step === 'fuse') state.tutorial.step = 'start';
  return target;
}

export function canMergeCardIntoTower(card, tower) {
  return Boolean(
    card && tower && card.uid !== tower.uid
    && card.type === tower.type
    && card.star === tower.star
    && tower.star < TD_MAX_STAR,
  );
}

/**
 * Consumes one compatible hand card and upgrades an already placed tower.
 * This remains available during a wave, matching placed-tower fusion, and is
 * the fusion command used by the shortened first-run tutorial.
 */
export function mergeCardIntoTower(state, cardUid, targetUid) {
  if (state.screen !== 'battle' || state.result) return null;
  if (state.tutorial.active && state.tutorial.step !== 'fuse') return null;
  const cardIndex = state.hand.findIndex((card) => card.uid === cardUid);
  if (cardIndex < 0) return null;
  const card = state.hand[cardIndex];
  const target = state.towers.find((tower) => tower.uid === targetUid);
  if (!canMergeCardIntoTower(card, target)) return null;

  state.hand.splice(cardIndex, 1);
  upgradeTowerHealth(target, target.star + 1);
  target.cooldown = Math.min(target.cooldown, 0.12);
  state.selectedTowerUid = null;
  const pad = stageForState(state).pads[target.padIndex];
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'merge', age: 0, duration: 0.9, x: pad.x, y: pad.y,
  });
  state.events.push({
    type: 'merge',
    source: 'hand',
    cardUid: card.uid,
    towerUid: target.uid,
    star: target.star,
  });
  if (state.tutorial.active && state.tutorial.step === 'fuse') state.tutorial.step = 'start';
  return target;
}

/** Returns a placed tower to the hand without changing its type or star. */
export function reclaimTowerToHand(state, towerUid) {
  if (
    state.screen !== 'battle'
    || state.result
    || state.tutorial.active
    || state.hand.length >= TD_HAND_LIMIT
  ) return null;
  const towerIndex = state.towers.findIndex((tower) => tower.uid === towerUid);
  if (towerIndex < 0) return null;
  const tower = state.towers[towerIndex];
  ensureTowerHealth(tower);
  const sourcePad = stageForState(state).pads[tower.padIndex];
  const healthRatio = tower.maxHp > 0 ? tower.hp / tower.maxHp : 1;
  const card = {
    uid: nextUid(state, 'card'),
    type: tower.type,
    star: tower.star,
    ...(healthRatio < 0.999 ? { healthRatio } : {}),
    ...(state.waveActive ? { redeployCooldown: Math.max(0.65, tower.cooldown) } : {}),
  };

  state.towers.splice(towerIndex, 1);
  state.hand.push(card);
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'reclaim', age: 0, duration: 0.55,
    x: sourcePad.x, y: sourcePad.y,
  });
  if (state.selectedTowerUid === tower.uid) state.selectedTowerUid = null;
  state.events.push({
    type: 'reclaim',
    towerUid: tower.uid,
    cardUid: card.uid,
    towerType: tower.type,
    star: tower.star,
    fromPadIndex: tower.padIndex,
  });
  return card;
}

/** Moves one placed tower to a valid empty pad, preserving identity, star and aim. */
export function moveTowerToPad(state, towerUid, padIndex) {
  if (state.screen !== 'battle' || state.result || state.tutorial.active) return null;
  const stage = stageForState(state);
  const targetPadIndex = Math.floor(Number(padIndex));
  if (!stage.pads[targetPadIndex]) return null;
  const tower = state.towers.find((candidate) => candidate.uid === towerUid);
  if (!tower || tower.padIndex === targetPadIndex) return null;
  if (state.towers.some((candidate) => candidate.padIndex === targetPadIndex)) return null;
  ensureTowerHealth(tower);

  const fromPadIndex = tower.padIndex;
  const sourcePad = stage.pads[fromPadIndex];
  tower.padIndex = targetPadIndex;
  if (state.waveActive) tower.cooldown = Math.max(tower.cooldown, 0.65);
  const pad = stage.pads[targetPadIndex];
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'move-out', age: 0, duration: 0.4,
    x: sourcePad.x, y: sourcePad.y,
  });
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'place', age: 0, duration: 0.45, x: pad.x, y: pad.y,
  });
  state.events.push({
    type: 'tower-move',
    towerUid: tower.uid,
    fromPadIndex,
    toPadIndex: targetPadIndex,
  });
  return tower;
}

export function pathMetrics(points) {
  const segments = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = distance(start, end);
    segments.push({ start, end, length, from: total, to: total + length });
    total += length;
  }
  return { segments, total };
}

export function pointOnPath(points, travelled) {
  const metrics = pathMetrics(points);
  const value = clamp(Number(travelled) || 0, 0, metrics.total);
  const segment = metrics.segments.find((entry) => value <= entry.to) || metrics.segments.at(-1);
  if (!segment) return { ...points[0], angle: 0 };
  const ratio = segment.length > 0 ? (value - segment.from) / segment.length : 0;
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
    y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
    angle: Math.atan2(segment.end.y - segment.start.y, segment.end.x - segment.start.x),
  };
}

export function endlessScaleForWave(waveNumber) {
  const waveIndex = Math.max(1, Math.floor(Number(waveNumber) || 1));
  return Object.freeze({
    // Total spawn slots stay fixed; boss waves replace regular enemies inside this budget.
    count: TD_ENDLESS_SCALE_CAPS.count,
    hp: scaleValue(Math.min(TD_ENDLESS_SCALE_CAPS.hp, 1.35 + (waveIndex - 1) * 0.115)),
    speed: scaleValue(Math.min(TD_ENDLESS_SCALE_CAPS.speed, 1.05 + (waveIndex - 1) * 0.01)),
    reward: scaleValue(Math.min(TD_ENDLESS_SCALE_CAPS.reward, 1.2 + (waveIndex - 1) * 0.03)),
    bossCount: waveIndex % 5 === 0
      ? Math.min(TD_ENDLESS_SCALE_CAPS.bossCount, 1 + Math.floor(waveIndex / 30))
      : 0,
  });
}

function endlessWaveGroups(waveNumber) {
  const scale = endlessScaleForWave(waveNumber);
  const groups = [];
  const regularCount = scale.count - scale.bossCount;
  const stoneShare = Math.min(0.4, 0.16 + Math.max(0, waveNumber - 3) * 0.008);
  const windShare = Math.min(0.38, 0.3 + Math.max(0, waveNumber - 2) * 0.004);
  const stoneCount = waveNumber >= 3 ? Math.floor(regularCount * stoneShare) : 0;
  const windCount = waveNumber >= 2 ? Math.floor(regularCount * windShare) : 0;
  const bugCount = regularCount - stoneCount - windCount;
  if (bugCount) groups.push(group('bug', bugCount, Math.max(0.42, 0.62 - waveNumber * 0.008)));
  if (windCount) groups.push(group('windcap', windCount, Math.max(0.48, 0.7 - waveNumber * 0.007), 1.2));
  if (stoneCount) groups.push(group('stone', stoneCount, Math.max(0.82, 1.22 - waveNumber * 0.01), 1.8));
  if (scale.bossCount) groups.push(group('boss', scale.bossCount, 3.4, 4.6));
  return groups;
}

function queueForWave(state, waveNumber) {
  const groups = state.mode === 'endless'
    ? endlessWaveGroups(waveNumber)
    : (stageForState(state).waves[waveNumber - 1] || []);
  const queue = [];
  groups.forEach((entry, groupIndex) => {
    const laneIndices = entry.laneIndices
      .map((laneIndex) => Math.floor(Number(laneIndex)))
      .filter((laneIndex) => laneIndex >= 0 && laneIndex < TD_LANE_COUNT);
    const availableLanes = laneIndices.length ? laneIndices : TD_LANE_INDICES;
    for (let index = 0; index < entry.count; index += 1) {
      queue.push({
        uid: `spawn-${waveNumber}-${groupIndex}-${index}`,
        type: entry.type,
        at: entry.delay + index * entry.interval,
        laneIndex: availableLanes[(index + groupIndex + waveNumber - 1) % availableLanes.length],
      });
    }
  });
  queue.sort((left, right) => left.at - right.at || left.uid.localeCompare(right.uid));
  return queue;
}

export function startNextTowerDefenseWave(state) {
  if (state.screen !== 'battle' || state.result || state.waveActive) return false;
  if (state.tutorial.active && state.tutorial.step !== 'start') return false;
  const stage = stageForState(state);
  if (state.mode === 'stage' && state.wave >= stage.waves.length) return false;
  state.wave += 1;
  state.waveActive = true;
  state.waveElapsed = 0;
  state.waveBreak = 0;
  state.spawnQueue = queueForWave(state, state.wave);
  state.waveEnemyTotal = state.spawnQueue.length;
  state.waveEnemyResolved = 0;
  state.events.push({ type: 'wave-start', wave: state.wave });
  if (state.tutorial.active && state.tutorial.step === 'start') {
    state.tutorial.active = false;
    state.tutorial.step = 'done';
    state.progress.tutorialSeen = true;
    state.events.push({ type: 'tutorial-complete' });
  }
  return true;
}

export function stageScaleForWave(stageIndex, waveNumber) {
  const stageOffset = clamp(Math.floor(Number(stageIndex) || 1), 1, TD_STAGES.length) - 1;
  const waveOffset = Math.max(1, Math.floor(Number(waveNumber) || 1)) - 1;
  return Object.freeze({
    hp: scaleValue(Math.min(TD_STAGE_SCALE_CAPS.hp, 1.25 + stageOffset * 0.34 + waveOffset * 0.18)),
    speed: scaleValue(Math.min(TD_STAGE_SCALE_CAPS.speed, 1.07 + stageOffset * 0.055 + waveOffset * 0.025)),
    reward: scaleValue(Math.min(TD_STAGE_SCALE_CAPS.reward, 1.2 + stageOffset * 0.12 + waveOffset * 0.08)),
  });
}

function enemyScaleForState(state) {
  if (state.mode === 'endless') return endlessScaleForWave(state.wave);
  return stageScaleForWave(stageForState(state).index, state.wave);
}

function normalizedLaneIndex(stage, laneIndex, y = null) {
  const numeric = Math.floor(Number(laneIndex));
  if (Number.isFinite(numeric) && stage.lanes[numeric]) return numeric;
  if (Number.isFinite(Number(y))) {
    return stage.lanes.reduce((bestIndex, lane, index) => (
      Math.abs(lane.y - y) < Math.abs(stage.lanes[bestIndex].y - y) ? index : bestIndex
    ), 0);
  }
  return 0;
}

function spawnEnemy(state, type, laneIndex = 0) {
  const definition = TD_ENEMIES[type] || TD_ENEMIES.bug;
  const scale = enemyScaleForState(state);
  const maxHp = Math.round(definition.hp * scale.hp);
  const stage = stageForState(state);
  const resolvedLaneIndex = normalizedLaneIndex(stage, laneIndex);
  const lane = stage.lanes[resolvedLaneIndex];
  const enemy = {
    uid: nextUid(state, 'enemy'),
    type: definition.id,
    laneIndex: resolvedLaneIndex,
    travelled: 0,
    x: lane.path[0].x,
    y: lane.path[0].y,
    facing: -1,
    hp: maxHp,
    maxHp,
    speed: definition.speed * scale.speed,
    reward: Math.max(1, Math.round(definition.reward * scale.reward)),
    attackDamage: Math.max(1, Math.round(definition.attackDamage * Math.min(2.2, Math.sqrt(scale.hp)))),
    attackInterval: definition.attackInterval,
    slowMultiplier: 1,
    slowTime: 0,
    poisonDps: 0,
    poisonTime: 0,
    hitPulse: 0,
    attackCooldown: definition.attackInterval,
    blockedByTowerUid: null,
  };
  state.enemies.push(enemy);
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'spawn', age: 0, duration: 0.46,
    x: enemy.x, y: enemy.y,
  });
  return enemy;
}

const starPower = (star) => [0, 1, 1.78, 3.12, 5.35][clamp(Math.floor(star), 1, TD_MAX_STAR)];

function towerPosition(state, tower) {
  return stageForState(state).pads[tower.padIndex];
}

function laneIndexForEnemy(state, enemy) {
  const stage = stageForState(state);
  const laneIndex = normalizedLaneIndex(stage, enemy.laneIndex, enemy.y);
  enemy.laneIndex = laneIndex;
  return laneIndex;
}

function setEnemyTravelled(state, enemy, travelled) {
  const stage = stageForState(state);
  const laneIndex = laneIndexForEnemy(state, enemy);
  const lane = stage.lanes[laneIndex];
  const pathLength = pathMetrics(lane.path).total;
  enemy.travelled = clamp(Number(travelled) || 0, 0, pathLength);
  const point = pointOnPath(lane.path, enemy.travelled);
  enemy.x = point.x;
  enemy.y = point.y;
  enemy.facing = -1;
  return point;
}

function targetForTower(state, tower) {
  const definition = TOWER_TYPES[tower.type];
  const origin = towerPosition(state, tower);
  if (!origin) return null;
  const range = definition.range * (1 + (tower.star - 1) * 0.035);
  let best = null;
  for (const enemy of state.enemies) {
    if (
      enemy.hp <= 0
      || laneIndexForEnemy(state, enemy) !== origin.laneIndex
      || enemy.x < origin.x
      || enemy.x - origin.x > range
    ) continue;
    if (!best || enemy.travelled > best.travelled) best = enemy;
  }
  return best;
}

function volleyTargetsForTower(state, tower, primary, count) {
  if (count <= 1) return [primary];
  const definition = TOWER_TYPES[tower.type];
  const origin = towerPosition(state, tower);
  if (!origin) return [primary];
  const range = definition.range * (1 + (tower.star - 1) * 0.035);
  const extras = state.enemies
    .filter((enemy) => (
      enemy.uid !== primary.uid
      && enemy.hp > 0
      && laneIndexForEnemy(state, enemy) === origin.laneIndex
      && enemy.x >= origin.x
      && enemy.x - origin.x <= range
    ))
    .sort((left, right) => right.travelled - left.travelled)
    .slice(0, count - 1);
  return [primary, ...extras];
}

function fireTower(state, tower, target) {
  const definition = TOWER_TYPES[tower.type];
  const origin = towerPosition(state, tower);
  const damage = definition.damage * starPower(tower.star);
  const evolution = towerAttackEvolution(tower.type, tower.star);
  const {
    projectileCount: patternProjectileCount,
    secondaryDamageScale,
    ...effectShape
  } = evolution;
  const targets = volleyTargetsForTower(state, tower, target, patternProjectileCount);
  const projectiles = targets.map((volleyTarget, volleyIndex) => {
    const damageScale = volleyIndex === 0 ? 1 : secondaryDamageScale;
    return {
      uid: nextUid(state, 'shot'),
      type: definition.projectile,
      effect: definition.effect,
      towerType: tower.type,
      star: tower.star,
      effectTier: tower.star,
      ...effectShape,
      patternProjectileCount,
      volleyIndex,
      volleyCount: targets.length,
      secondary: volleyIndex > 0,
      damageScale,
      targetUid: volleyTarget.uid,
      x: origin.x,
      y: origin.y - 30,
      targetX: volleyTarget.x,
      targetY: volleyTarget.y - 18,
      speed: definition.projectileSpeed,
      damage: damage * damageScale,
      age: 0,
    };
  });
  state.projectiles.push(...projectiles);
  tower.attackPulse = 1;
  tower.aimAngle = Math.atan2(target.y - origin.y, target.x - origin.x);
  state.events.push({
    type: 'shot',
    towerUid: tower.uid,
    towerType: tower.type,
    star: tower.star,
    effectTier: tower.star,
    attackMode: evolution.attackMode,
    projectileCount: projectiles.length,
    patternProjectileCount,
    projectileUids: projectiles.map(({ uid }) => uid),
    targetUid: target.uid,
    targetUids: targets.map(({ uid }) => uid),
  });
}

function damageEnemy(state, enemy, amount, { emitHit = true } = {}) {
  if (!enemy || enemy.hp <= 0) return false;
  const damage = Math.max(0, Number(amount) || 0);
  if (damage <= 0) return false;
  enemy.hp -= damage;
  enemy.hitPulse = 1;
  if (emitHit) {
    state.events.push({
      type: 'enemy-hit',
      enemyUid: enemy.uid,
      enemyType: enemy.type,
      damage,
    });
  }
  if (enemy.hp > 0) return false;
  enemy.hp = 0;
  state.waveEnemyResolved = Math.min(
    Math.max(0, Number(state.waveEnemyTotal) || 0),
    Math.max(0, Number(state.waveEnemyResolved) || 0) + 1,
  );
  state.currency += enemy.reward;
  state.kills += 1;
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'defeat', age: 0, duration: 0.66,
    x: enemy.x, y: enemy.y,
  });
  state.events.push({
    type: 'enemy-defeat',
    enemyUid: enemy.uid,
    enemyType: enemy.type,
    x: enemy.x,
    y: enemy.y,
    facing: enemy.facing,
  });
  return true;
}

function nearbyEffectTargets(state, target, radius, count = Infinity) {
  const targetLaneIndex = laneIndexForEnemy(state, target);
  return state.enemies
    .filter((enemy) => (
      enemy.uid !== target.uid
      && enemy.hp > 0
      && laneIndexForEnemy(state, enemy) === targetLaneIndex
      && Math.abs(enemy.x - target.x) <= radius
    ))
    .sort((left, right) => right.travelled - left.travelled)
    .slice(0, count);
}

function emitProjectileImpact(state, projectile, target, { secondary = false } = {}) {
  state.effects.push({
    uid: nextUid(state, 'fx'),
    type: projectile.effect === 'poison'
      ? 'leaf-hit'
      : projectile.effect === 'slow' ? 'bubble-hit' : 'hit',
    age: 0,
    duration: 0.48,
    x: target.x,
    y: target.y - 18,
    star: projectile.star,
    effectTier: projectile.effectTier,
    attackMode: projectile.attackMode,
    secondary,
  });
}

function applyProjectileHit(state, projectile, target) {
  if (!target || target.hp <= 0) return;
  damageEnemy(state, target, projectile.damage);
  if (projectile.effect === 'splash') {
    const radius = projectile.splashRadius ?? 42 + projectile.star * 7;
    const splashDamageScale = projectile.splashDamageScale ?? 0.52;
    const knockback = Math.max(0, Number(projectile.knockback) || 0);
    if (knockback > 0) setEnemyTravelled(state, target, target.travelled - knockback);
    for (const enemy of nearbyEffectTargets(state, target, radius)) {
      damageEnemy(state, enemy, projectile.damage * splashDamageScale);
    }
  } else if (projectile.effect === 'pierce') {
    const extras = nearbyEffectTargets(
      state,
      target,
      104,
      Math.max(0, Math.floor(projectile.pierceTargets ?? Math.min(3, projectile.star))),
    );
    const pierceDamageScale = projectile.pierceDamageScale ?? 0.68;
    extras.forEach((enemy, index) => damageEnemy(
      state, enemy, projectile.damage * Math.max(0.32, pierceDamageScale - index * 0.12),
    ));
  } else if (projectile.effect === 'slow') {
    const slowMultiplier = Math.max(0.38, 0.7 - projectile.star * 0.055);
    const slowTime = 1.5 + projectile.star * 0.22;
    const rewind = 5 + projectile.star * 2.5;
    target.slowMultiplier = Math.min(target.slowMultiplier, slowMultiplier);
    target.slowTime = Math.max(target.slowTime, slowTime);
    setEnemyTravelled(state, target, target.travelled - rewind);
    const chainTargets = nearbyEffectTargets(
      state,
      target,
      Math.max(0, Number(projectile.chainRadius) || 0),
      Math.max(0, Math.floor(Number(projectile.chainTargets) || 0)),
    );
    const chainPower = clamp(Number(projectile.chainPower) || 0, 0, 1);
    for (const enemy of chainTargets) {
      const chainedSlow = 1 - (1 - slowMultiplier) * chainPower;
      enemy.slowMultiplier = Math.min(enemy.slowMultiplier, chainedSlow);
      enemy.slowTime = Math.max(enemy.slowTime, slowTime * 0.72);
      setEnemyTravelled(state, enemy, enemy.travelled - rewind * chainPower);
      emitProjectileImpact(state, projectile, enemy, { secondary: true });
    }
  } else if (projectile.effect === 'poison') {
    const poisonDps = 4.5 * starPower(projectile.star);
    const poisonTime = 2.5 + projectile.star * 0.35;
    target.poisonDps = Math.max(target.poisonDps, poisonDps);
    target.poisonTime = Math.max(target.poisonTime, poisonTime);
    const spreadTargets = nearbyEffectTargets(
      state,
      target,
      Math.max(0, Number(projectile.spreadRadius) || 0),
      Math.max(0, Math.floor(Number(projectile.spreadTargets) || 0)),
    );
    const spreadPoisonScale = clamp(Number(projectile.spreadPoisonScale) || 0, 0, 1);
    for (const enemy of spreadTargets) {
      enemy.poisonDps = Math.max(enemy.poisonDps, poisonDps * spreadPoisonScale);
      enemy.poisonTime = Math.max(enemy.poisonTime, poisonTime * 0.76);
      emitProjectileImpact(state, projectile, enemy, { secondary: true });
    }
  }
  emitProjectileImpact(state, projectile, target);
}

function updateProjectiles(state, dt) {
  for (const projectile of state.projectiles) {
    projectile.age += dt;
    const target = state.enemies.find((enemy) => enemy.uid === projectile.targetUid && enemy.hp > 0);
    if (target) {
      projectile.targetX = target.x;
      projectile.targetY = target.y - 18;
    }
    const dx = projectile.targetX - projectile.x;
    const dy = projectile.targetY - projectile.y;
    const remaining = Math.hypot(dx, dy);
    const travel = projectile.speed * dt;
    if (remaining <= Math.max(9, travel)) {
      projectile.x = projectile.targetX;
      projectile.y = projectile.targetY;
      projectile.done = true;
      applyProjectileHit(state, projectile, target);
    } else {
      projectile.x += dx / remaining * travel;
      projectile.y += dy / remaining * travel;
    }
  }
  state.projectiles = state.projectiles.filter((projectile) => !projectile.done && projectile.age < 2.4);
}

function updateTowers(state, dt) {
  for (const tower of state.towers) {
    ensureTowerHealth(tower);
    tower.cooldown -= dt;
    tower.attackPulse = Math.max(0, tower.attackPulse - dt * 5.5);
    tower.hitPulse = Math.max(0, tower.hitPulse - dt * 6);
    if (tower.hp <= 0) continue;
    if (tower.cooldown > 0) continue;
    const target = targetForTower(state, tower);
    if (!target) {
      tower.cooldown = Math.min(0.12, tower.cooldown + 0.08);
      continue;
    }
    fireTower(state, tower, target);
    const definition = TOWER_TYPES[tower.type];
    tower.cooldown += definition.interval / (1 + (tower.star - 1) * 0.11);
  }
}

function towerContactTravel(state, enemy, tower) {
  const stage = stageForState(state);
  const pad = stage.pads[tower.padIndex];
  if (!pad || pad.laneIndex !== laneIndexForEnemy(state, enemy)) return null;
  const lane = stage.lanes[pad.laneIndex];
  const definition = TD_ENEMIES[enemy.type] || TD_ENEMIES.bug;
  const contactOffset = 38 + definition.size * 0.18;
  return Math.max(0, lane.path[0].x - (pad.x + contactOffset));
}

function nextBlockingTower(state, enemy) {
  let best = null;
  let bestTravelled = Number.POSITIVE_INFINITY;
  for (const tower of state.towers) {
    ensureTowerHealth(tower);
    if (tower.hp <= 0) continue;
    const contactTravelled = towerContactTravel(state, enemy, tower);
    if (contactTravelled == null || contactTravelled < enemy.travelled - 0.01) continue;
    if (contactTravelled < bestTravelled) {
      best = tower;
      bestTravelled = contactTravelled;
    }
  }
  return best ? { tower: best, travelled: bestTravelled } : null;
}

function damageTower(state, enemy, tower, amount) {
  ensureTowerHealth(tower);
  const damage = Math.max(0, Number(amount) || 0);
  if (tower.hp <= 0 || damage <= 0) return false;
  const pad = towerPosition(state, tower);
  tower.hp = Math.max(0, tower.hp - damage);
  tower.hitPulse = 1;
  state.events.push({
    type: 'enemy-attack',
    enemyUid: enemy.uid,
    towerUid: tower.uid,
    damage,
  });
  state.events.push({
    type: 'tower-hit',
    towerUid: tower.uid,
    towerType: tower.type,
    star: tower.star,
    padIndex: tower.padIndex,
    enemyUid: enemy.uid,
    damage,
    hp: tower.hp,
    maxHp: tower.maxHp,
  });
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'tower-hit', age: 0, duration: 0.42,
    x: pad.x, y: pad.y - 24,
  });
  if (tower.hp > 0) return false;

  const towerIndex = state.towers.indexOf(tower);
  if (towerIndex >= 0) state.towers.splice(towerIndex, 1);
  if (state.selectedTowerUid === tower.uid) state.selectedTowerUid = null;
  enemy.blockedByTowerUid = null;
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'tower-defeat', age: 0, duration: 0.72,
    x: pad.x, y: pad.y,
  });
  state.events.push({
    type: 'tower-defeat',
    towerUid: tower.uid,
    towerType: tower.type,
    star: tower.star,
    padIndex: tower.padIndex,
    enemyUid: enemy.uid,
    x: pad.x,
    y: pad.y,
    laneIndex: pad.laneIndex,
  });
  return true;
}

function updateEnemies(state, dt) {
  const stage = stageForState(state);
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const definition = TD_ENEMIES[enemy.type] || TD_ENEMIES.bug;
    const laneIndex = laneIndexForEnemy(state, enemy);
    const lane = stage.lanes[laneIndex];
    const pathLength = pathMetrics(lane.path).total;
    enemy.hitPulse = Math.max(0, enemy.hitPulse - dt * 6);
    if (enemy.poisonTime > 0) {
      enemy.poisonTime -= dt;
      damageEnemy(state, enemy, enemy.poisonDps * dt, { emitHit: false });
    } else {
      enemy.poisonDps = 0;
    }
    if (enemy.hp <= 0) continue;
    if (enemy.slowTime > 0) enemy.slowTime -= dt;
    else enemy.slowMultiplier = 1;

    const nextTravelled = Math.min(
      pathLength,
      enemy.travelled + enemy.speed * enemy.slowMultiplier * dt,
    );
    const blocker = nextBlockingTower(state, enemy);
    if (blocker && nextTravelled >= blocker.travelled) {
      setEnemyTravelled(state, enemy, blocker.travelled);
      enemy.blockedByTowerUid = blocker.tower.uid;
      const attackInterval = Math.max(
        0.2,
        Number(enemy.attackInterval) || definition.attackInterval,
      );
      if (!Number.isFinite(Number(enemy.attackCooldown))) enemy.attackCooldown = attackInterval;
      enemy.attackCooldown -= dt;
      while (enemy.attackCooldown <= 0 && blocker.tower.hp > 0) {
        damageTower(
          state,
          enemy,
          blocker.tower,
          Number(enemy.attackDamage) || definition.attackDamage,
        );
        enemy.attackCooldown += attackInterval;
      }
    } else {
      enemy.blockedByTowerUid = null;
      setEnemyTravelled(state, enemy, nextTravelled);
    }

    const point = { x: enemy.x, y: enemy.y };
    if (enemy.travelled >= pathLength) {
      enemy.leaked = true;
      state.waveEnemyResolved = Math.min(
        Math.max(0, Number(state.waveEnemyTotal) || 0),
        Math.max(0, Number(state.waveEnemyResolved) || 0) + 1,
      );
      state.coreHp = Math.max(0, state.coreHp - definition.coreDamage);
      state.effects.push({
        uid: nextUid(state, 'fx'), type: 'core-hit', age: 0, duration: 0.7,
        x: point.x, y: point.y,
      });
      state.events.push({ type: 'core-hit', damage: definition.coreDamage });
    }
  }
  state.enemies = state.enemies.filter((enemy) => enemy.hp > 0 && !enemy.leaked);
}

function finishRun(state, result) {
  state.result = result;
  state.waveActive = false;
  state.spawnQueue = [];
  state.projectiles = [];
  state.screen = 'result';
  if (result === 'victory') {
    const stage = stageForState(state);
    if (!state.progress.clearedStages.includes(stage.id)) state.progress.clearedStages.push(stage.id);
    state.progress.unlockedStage = Math.max(
      state.progress.unlockedStage,
      Math.min(TD_STAGES.length, stage.index + 1),
    );
  }
  if (state.mode === 'endless') {
    state.progress.bestEndlessWave = Math.max(state.progress.bestEndlessWave, state.wave);
  }
  state.events.push({ type: 'run-end', result });
}

function completeWave(state) {
  state.waveActive = false;
  state.waveBreak = 2.6;
  state.currency += 24 + state.wave * 4;
  state.coreHp = Math.min(state.coreMaxHp, state.coreHp + 1);
  for (const tower of state.towers) {
    ensureTowerHealth(tower);
    tower.hp = Math.min(tower.maxHp, tower.hp + Math.round(tower.maxHp * 0.2));
  }
  state.events.push({ type: 'wave-clear', wave: state.wave });
  if (state.mode === 'stage' && state.wave >= stageForState(state).waves.length) {
    finishRun(state, 'victory');
  }
}

function updateEffects(state, dt) {
  for (const effect of state.effects) {
    effect.age += dt;
    effect.phase = clamp(effect.age / effect.duration, 0, 1);
    if (effect.type === 'summon') effect.y -= dt * 18;
  }
  state.effects = state.effects.filter((effect) => effect.age < effect.duration);
}

export function updateTowerDefense(state, dt) {
  const delta = clamp(Number(dt) || 0, 0, 0.05);
  if (state.screen !== 'battle' || state.result) {
    state.time += delta;
    updateEffects(state, delta);
    return state;
  }
  state.time += delta;
  updateEffects(state, delta);
  if (state.coreHp <= 0) {
    finishRun(state, 'defeat');
    return state;
  }
  if (!state.waveActive) {
    if (state.waveBreak > 0) {
      state.waveBreak = Math.max(0, state.waveBreak - delta);
      if (state.waveBreak === 0) startNextTowerDefenseWave(state);
    }
    return state;
  }
  state.waveElapsed += delta;
  while (state.spawnQueue.length && state.spawnQueue[0].at <= state.waveElapsed) {
    const spawn = state.spawnQueue.shift();
    spawnEnemy(state, spawn.type, spawn.laneIndex);
  }
  updateEnemies(state, delta);
  updateTowers(state, delta);
  updateProjectiles(state, delta);
  state.enemies = state.enemies.filter((enemy) => enemy.hp > 0 && !enemy.leaked);
  if (state.coreHp <= 0) {
    finishRun(state, 'defeat');
  } else if (!state.spawnQueue.length && !state.enemies.length) {
    completeWave(state);
  }
  return state;
}

export function skipTowerDefenseBreak(state) {
  if (state.screen !== 'battle' || state.waveActive || state.result) return false;
  state.waveBreak = 0;
  return startNextTowerDefenseWave(state);
}

export function returnToTowerDefenseMenu(state) {
  state.screen = 'menu';
  state.result = null;
  state.waveActive = false;
  state.enemies = [];
  state.projectiles = [];
  state.effects = [];
  state.selectedTowerUid = null;
  state.tutorial.step = state.tutorial.active ? 'stage' : 'done';
  return state;
}

export function replayTowerDefenseRun(state) {
  return beginTowerDefenseRun(state, { mode: state.mode, stageId: state.stageId });
}

export function towerByPad(state, padIndex) {
  return state.towers.find((tower) => tower.padIndex === padIndex) || null;
}

export function tutorialTargetForState(state) {
  if (!state.tutorial.active) return null;
  switch (state.tutorial.step) {
    case 'stage': return Object.freeze({ type: 'stage', stageIndex: 0, label: '1' });
    case 'draw-1':
    case 'draw-2': return Object.freeze({ type: 'draw', label: '抽' });
    case 'place-1': {
      const openPad = stageForState(state).pads.findIndex((_, index) => !towerByPad(state, index));
      return Object.freeze({ type: 'pad', padIndex: openPad, label: '放' });
    }
    case 'fuse': return Object.freeze({ type: 'fusion', label: '融' });
    case 'start': return Object.freeze({ type: 'start', label: '战' });
    default: return null;
  }
}

export function serializeTowerDefenseProgress(state) {
  return normalizeTowerDefenseProgress(state?.progress || {});
}

export function towerRange(state, tower) {
  const definition = TOWER_TYPES[tower.type];
  return definition.range * (1 + (tower.star - 1) * 0.035);
}

export function fusionOrbitPoint(effect, timeOffset = 0) {
  const phase = clamp(effect?.phase ?? 0, 0, 1);
  const angle = phase * TAU * 1.8 + timeOffset;
  const radius = (1 - phase) * 44 + 8;
  return {
    x: effect.x + Math.cos(angle) * radius,
    y: effect.y - 24 + Math.sin(angle) * radius * 0.46,
  };
}
