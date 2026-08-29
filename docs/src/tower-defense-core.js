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

export const TD_VIEW = Object.freeze({ width: 1280, height: 720 });
export const TD_FIELD = Object.freeze({ x: 0, y: 0, width: 930, height: 720 });
export const TD_MAX_STAR = 4;
export const TD_HAND_LIMIT = 4;
export const TD_STORAGE_KEY = 'slime-fusion-defense-v1';

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
    projectile: 'seed',
    projectileSpeed: 510,
    effect: 'poison',
  }),
});

export const TOWER_DRAW_WEIGHTS = Object.freeze([
  Object.freeze({ type: 'shell', weight: 28 }),
  Object.freeze({ type: 'needle', weight: 28 }),
  Object.freeze({ type: 'bubble', weight: 24 }),
  Object.freeze({ type: 'sprout', weight: 20 }),
]);

export const TD_ENEMIES = Object.freeze({
  bug: Object.freeze({
    id: 'bug', ownerId: 'enemy-soft-biter', hp: 28, speed: 50, reward: 5,
    size: 58, coreDamage: 1, color: '#A77770',
  }),
  windcap: Object.freeze({
    id: 'windcap', ownerId: 'enemy-windcap', hp: 22, speed: 78, reward: 6,
    size: 55, coreDamage: 1, color: '#C18BCC',
  }),
  stone: Object.freeze({
    id: 'stone', ownerId: 'enemy-stone-lump', hp: 86, speed: 34, reward: 10,
    size: 68, coreDamage: 2, color: '#85848D',
  }),
  boss: Object.freeze({
    id: 'boss', ownerId: 'enemy-acid-shell-king', hp: 390, speed: 27, reward: 45,
    size: 104, coreDamage: 5, color: '#778D54', boss: true,
  }),
});

const freezePoints = (points) => Object.freeze(points.map((point) => Object.freeze(point)));
const freezePads = (pads) => Object.freeze(pads.map((pad, index) => Object.freeze({
  id: `pad-${index}`,
  x: pad[0],
  y: pad[1],
})));
const group = (type, count, interval, delay = 0) => Object.freeze({
  type, count, interval, delay,
});
const wave = (...groups) => Object.freeze(groups);

export const TD_STAGES = Object.freeze([
  Object.freeze({
    id: 'stage-1',
    index: 1,
    name: '软胶坡',
    accent: '#62D5A0',
    path: freezePoints([
      { x: 18, y: 122 }, { x: 252, y: 122 }, { x: 252, y: 344 },
      { x: 494, y: 344 }, { x: 494, y: 154 }, { x: 708, y: 154 },
      { x: 708, y: 520 }, { x: 866, y: 520 },
    ]),
    pads: freezePads([
      [132, 228], [354, 234], [388, 454], [590, 250], [604, 472],
      [804, 382], [823, 608], [148, 486], [376, 92],
    ]),
    waves: Object.freeze([
      wave(group('bug', 10, 0.72)),
      wave(group('bug', 14, 0.62), group('windcap', 5, 0.92, 2.4)),
      wave(group('bug', 16, 0.54), group('stone', 4, 1.8, 3.8)),
      wave(group('windcap', 14, 0.52), group('stone', 6, 1.55, 2.8)),
      wave(group('bug', 18, 0.46), group('stone', 5, 1.45, 3.2), group('boss', 1, 0, 9.8)),
    ]),
  }),
  Object.freeze({
    id: 'stage-2',
    index: 2,
    name: '泡泡湾',
    accent: '#67CFE8',
    path: freezePoints([
      { x: 18, y: 548 }, { x: 192, y: 548 }, { x: 192, y: 210 },
      { x: 404, y: 210 }, { x: 404, y: 498 }, { x: 616, y: 498 },
      { x: 616, y: 112 }, { x: 854, y: 112 },
    ]),
    pads: freezePads([
      [94, 422], [290, 420], [302, 102], [502, 332], [512, 596],
      [714, 276], [752, 516], [836, 212], [88, 112],
    ]),
    waves: Object.freeze([
      wave(group('windcap', 12, 0.68)),
      wave(group('bug', 16, 0.56), group('windcap', 10, 0.7, 1.8)),
      wave(group('stone', 8, 1.35), group('windcap', 12, 0.56, 2.2)),
      wave(group('bug', 22, 0.43), group('stone', 7, 1.2, 3)),
      wave(group('windcap', 20, 0.43), group('stone', 9, 1.08, 3.2)),
      wave(group('bug', 20, 0.4), group('stone', 8, 1.05, 3), group('boss', 1, 0, 8.6)),
    ]),
  }),
  Object.freeze({
    id: 'stage-3',
    index: 3,
    name: '晶刺环',
    accent: '#8C80E8',
    path: freezePoints([
      { x: 18, y: 118 }, { x: 176, y: 118 }, { x: 176, y: 574 },
      { x: 366, y: 574 }, { x: 366, y: 210 }, { x: 548, y: 210 },
      { x: 548, y: 558 }, { x: 730, y: 558 }, { x: 730, y: 132 },
      { x: 866, y: 132 },
    ]),
    pads: freezePads([
      [84, 260], [278, 312], [274, 660], [460, 390], [460, 105],
      [642, 358], [642, 646], [826, 320], [836, 586],
    ]),
    waves: Object.freeze([
      wave(group('bug', 18, 0.52), group('windcap', 8, 0.72, 2)),
      wave(group('stone', 10, 1.2), group('windcap', 14, 0.54, 2.4)),
      wave(group('bug', 26, 0.4), group('stone', 8, 1.05, 3)),
      wave(group('windcap', 25, 0.38), group('stone', 10, 0.98, 2.4)),
      wave(group('bug', 28, 0.36), group('stone', 12, 0.92, 3)),
      wave(group('windcap', 26, 0.35), group('boss', 1, 0, 7.4)),
      wave(group('bug', 30, 0.32), group('stone', 12, 0.86, 2.8), group('boss', 2, 4.6, 7.2)),
    ]),
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
    spawnQueue: [],
    hand: [],
    towers: [],
    enemies: [],
    projectiles: [],
    effects: [],
    currency: 120,
    drawCount: 0,
    coreHp: 20,
    coreMaxHp: 20,
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
    uid: nextUid(state, 'fx'), type: 'summon', age: 0, duration: 0.65, x: 1074, y: 612,
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
  const tower = {
    uid: nextUid(state, 'tower'),
    type: card.type,
    star: card.star,
    padIndex: index,
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
  target.star += 1;
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
  target.star += 1;
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
  const sourcePad = stageForState(state).pads[tower.padIndex];
  const card = {
    uid: nextUid(state, 'card'),
    type: tower.type,
    star: tower.star,
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
    count: 8 + waveIndex * 3 + Math.floor(waveIndex ** 1.2),
    hp: 1 + (waveIndex - 1) * 0.115 + (waveIndex - 1) ** 2 * 0.0048,
    speed: Math.min(1.68, 1 + (waveIndex - 1) * 0.018),
    reward: Math.max(0.48, 1 - (waveIndex - 1) * 0.012),
    bossCount: waveIndex % 5 === 0 ? Math.max(1, Math.floor(waveIndex / 15) + 1) : 0,
  });
}

function endlessWaveGroups(waveNumber) {
  const scale = endlessScaleForWave(waveNumber);
  const groups = [];
  const stoneCount = waveNumber >= 3 ? Math.floor(scale.count * Math.min(0.32, 0.1 + waveNumber * 0.008)) : 0;
  const windCount = waveNumber >= 2 ? Math.floor(scale.count * 0.34) : 0;
  const bugCount = Math.max(5, scale.count - stoneCount - windCount);
  groups.push(group('bug', bugCount, Math.max(0.24, 0.58 - waveNumber * 0.009)));
  if (windCount) groups.push(group('windcap', windCount, Math.max(0.28, 0.66 - waveNumber * 0.008), 1.4));
  if (stoneCount) groups.push(group('stone', stoneCount, Math.max(0.62, 1.35 - waveNumber * 0.014), 2.8));
  if (scale.bossCount) groups.push(group('boss', scale.bossCount, 3.8, 5.8));
  return groups;
}

function queueForWave(state, waveNumber) {
  const groups = state.mode === 'endless'
    ? endlessWaveGroups(waveNumber)
    : (stageForState(state).waves[waveNumber - 1] || []);
  const queue = [];
  groups.forEach((entry, groupIndex) => {
    for (let index = 0; index < entry.count; index += 1) {
      queue.push({
        uid: `spawn-${waveNumber}-${groupIndex}-${index}`,
        type: entry.type,
        at: entry.delay + index * entry.interval,
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
  state.events.push({ type: 'wave-start', wave: state.wave });
  if (state.tutorial.active && state.tutorial.step === 'start') {
    state.tutorial.active = false;
    state.tutorial.step = 'done';
    state.progress.tutorialSeen = true;
    state.events.push({ type: 'tutorial-complete' });
  }
  return true;
}

function enemyScaleForState(state) {
  if (state.mode === 'endless') return endlessScaleForWave(state.wave);
  const stage = stageForState(state);
  return {
    hp: 1 + (stage.index - 1) * 0.16 + (state.wave - 1) * 0.075,
    speed: 1 + (stage.index - 1) * 0.045 + (state.wave - 1) * 0.012,
    reward: 1,
  };
}

function spawnEnemy(state, type) {
  const definition = TD_ENEMIES[type] || TD_ENEMIES.bug;
  const scale = enemyScaleForState(state);
  const maxHp = Math.round(definition.hp * scale.hp);
  const enemy = {
    uid: nextUid(state, 'enemy'),
    type: definition.id,
    travelled: 0,
    x: stageForState(state).path[0].x,
    y: stageForState(state).path[0].y,
    facing: 1,
    hp: maxHp,
    maxHp,
    speed: definition.speed * scale.speed,
    reward: Math.max(1, Math.round(definition.reward * scale.reward)),
    slowMultiplier: 1,
    slowTime: 0,
    poisonDps: 0,
    poisonTime: 0,
    hitPulse: 0,
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

function targetForTower(state, tower) {
  const definition = TOWER_TYPES[tower.type];
  const origin = towerPosition(state, tower);
  const range = definition.range * (1 + (tower.star - 1) * 0.035);
  let best = null;
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0 || distance(origin, enemy) > range) continue;
    if (!best || enemy.travelled > best.travelled) best = enemy;
  }
  return best;
}

function fireTower(state, tower, target) {
  const definition = TOWER_TYPES[tower.type];
  const origin = towerPosition(state, tower);
  const damage = definition.damage * starPower(tower.star);
  const projectile = {
    uid: nextUid(state, 'shot'),
    type: definition.projectile,
    effect: definition.effect,
    towerType: tower.type,
    star: tower.star,
    targetUid: target.uid,
    x: origin.x,
    y: origin.y - 30,
    targetX: target.x,
    targetY: target.y - 18,
    speed: definition.projectileSpeed,
    damage,
    age: 0,
  };
  state.projectiles.push(projectile);
  tower.attackPulse = 1;
  tower.aimAngle = Math.atan2(target.y - origin.y, target.x - origin.x);
  state.events.push({
    type: 'shot',
    towerUid: tower.uid,
    towerType: tower.type,
    targetUid: target.uid,
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

function applyProjectileHit(state, projectile, target) {
  if (!target || target.hp <= 0) return;
  damageEnemy(state, target, projectile.damage);
  if (projectile.effect === 'splash') {
    const radius = 42 + projectile.star * 7;
    for (const enemy of state.enemies) {
      if (enemy.uid !== target.uid && enemy.hp > 0 && distance(enemy, target) <= radius) {
        damageEnemy(state, enemy, projectile.damage * 0.52);
      }
    }
  } else if (projectile.effect === 'pierce') {
    const extras = state.enemies
      .filter((enemy) => enemy.uid !== target.uid && enemy.hp > 0 && distance(enemy, target) <= 104)
      .sort((left, right) => right.travelled - left.travelled)
      .slice(0, Math.min(3, projectile.star));
    extras.forEach((enemy, index) => damageEnemy(
      state, enemy, projectile.damage * Math.max(0.38, 0.68 - index * 0.12),
    ));
  } else if (projectile.effect === 'slow') {
    target.slowMultiplier = Math.min(target.slowMultiplier, Math.max(0.38, 0.7 - projectile.star * 0.055));
    target.slowTime = Math.max(target.slowTime, 1.5 + projectile.star * 0.22);
    target.travelled = Math.max(0, target.travelled - 5 - projectile.star * 2.5);
  } else if (projectile.effect === 'poison') {
    target.poisonDps = Math.max(target.poisonDps, 4.5 * starPower(projectile.star));
    target.poisonTime = Math.max(target.poisonTime, 2.5 + projectile.star * 0.35);
  }
  state.effects.push({
    uid: nextUid(state, 'fx'),
    type: projectile.effect === 'poison' ? 'leaf-hit' : projectile.effect === 'slow' ? 'bubble-hit' : 'hit',
    age: 0,
    duration: 0.48,
    x: target.x,
    y: target.y - 18,
  });
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
    tower.cooldown -= dt;
    tower.attackPulse = Math.max(0, tower.attackPulse - dt * 5.5);
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

function updateEnemies(state, dt) {
  const path = stageForState(state).path;
  const pathLength = pathMetrics(path).total;
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
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
    enemy.travelled += enemy.speed * enemy.slowMultiplier * dt;
    const previousX = enemy.x;
    const point = pointOnPath(path, enemy.travelled);
    enemy.x = point.x;
    enemy.y = point.y;
    if (Math.abs(enemy.x - previousX) > 0.01) enemy.facing = enemy.x >= previousX ? 1 : -1;
    if (enemy.travelled >= pathLength) {
      enemy.leaked = true;
      const definition = TD_ENEMIES[enemy.type];
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
  state.currency += 20 + state.wave * 3;
  state.coreHp = Math.min(state.coreMaxHp, state.coreHp + 1);
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
    spawnEnemy(state, spawn.type);
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
