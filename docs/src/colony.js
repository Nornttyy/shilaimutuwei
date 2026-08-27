const RESOURCE_TYPES = Object.freeze(['gel', 'nectar', 'shard']);

export const COLONY_RESOURCE_TYPES = RESOURCE_TYPES;
export const COLONY_AI_STATES = Object.freeze([
  'idle', 'seek', 'move', 'harvest', 'carry', 'deposit', 'build',
  'rally', 'chase', 'attack', 'rest', 'downed',
]);
export const COLONY_THINK_INTERVAL = 0.25;

export const DEFAULT_COLONY_CONFIG = Object.freeze({
  thinkInterval: COLONY_THINK_INTERVAL,
  jobLockSeconds: 2,
  passiveThreatPerSecond: 0.0025,
  threatWarningThresholds: Object.freeze([0.25, 0.5, 0.75, 1]),
  rallyThreatIntensity: 0.35,
  combatThreatIntensity: 0.55,
  restHealthRatio: 0.3,
  leaveRestHealthRatio: 0.8,
  restHealingPerSecond: 12,
  respawnSeconds: 20,
  respawnNectarCost: 3,
  buildRate: 1,
  obstacleDamagePerSecond: 1,
  defaultHarvestSeconds: 2.5,
  priorities: Object.freeze({ defense: 3, build: 2, gather: 1, clear: 1 }),
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const cellKey = (x, y) => `${x},${y}`;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const isFinitePoint = (point) => Number.isFinite(point?.x) && Number.isFinite(point?.y);
const resourceRecord = (value = {}) => Object.fromEntries(
  RESOURCE_TYPES.map((type) => [type, Math.max(0, Number(value[type]) || 0)]),
);

function mergedConfig(config = {}) {
  return {
    ...DEFAULT_COLONY_CONFIG,
    ...config,
    priorities: { ...DEFAULT_COLONY_CONFIG.priorities, ...(config.priorities || {}) },
    threatWarningThresholds: [
      ...(config.threatWarningThresholds || DEFAULT_COLONY_CONFIG.threatWarningThresholds),
    ].sort((a, b) => a - b),
  };
}

export function normalizeTerrain(tile = null) {
  if (!tile) return { kind: 'ground', passable: true, buildable: true, harvestable: false, destructible: false };
  const kind = tile.kind || tile.type || 'ground';
  const defaults = {
    ground: { passable: true, buildable: true, harvestable: false, destructible: false },
    resource: { passable: true, buildable: false, harvestable: true, destructible: false },
    obstacle: { passable: false, buildable: false, harvestable: false, destructible: false },
    destructible: { passable: false, buildable: false, harvestable: false, destructible: true },
    indestructible: { passable: false, buildable: false, harvestable: false, destructible: false },
  }[kind] || { passable: true, buildable: false, harvestable: false, destructible: false };
  return {
    ...tile,
    kind,
    passable: tile.passable ?? defaults.passable,
    buildable: tile.buildable ?? defaults.buildable,
    harvestable: tile.harvestable ?? defaults.harvestable,
    destructible: tile.destructible ?? defaults.destructible,
  };
}

export function isInsideColonyWorld(state, x, y) {
  return Number.isInteger(x) && Number.isInteger(y)
    && x >= state.bounds.x && y >= state.bounds.y
    && x < state.bounds.x + state.bounds.width
    && y < state.bounds.y + state.bounds.height;
}

export function terrainAt(state, x, y) {
  if (!isInsideColonyWorld(state, x, y)) {
    return normalizeTerrain({ kind: 'indestructible', outside: true });
  }
  const override = state.terrainOverrides.get(cellKey(x, y));
  if (override) return override;
  return normalizeTerrain(state.terrainQuery?.(x, y, state) || null);
}

export function setTerrainAt(state, x, y, tile) {
  if (!isInsideColonyWorld(state, x, y)) return false;
  const normalized = normalizeTerrain(tile);
  state.terrainOverrides.set(cellKey(x, y), normalized);
  state.onTerrainChange?.(x, y, normalized, state);
  return true;
}

function nextUid(state, prefix) {
  state.nextUid += 1;
  return `${prefix}-${state.nextUid}`;
}

export function createColonySlime(spec = {}) {
  if (!isFinitePoint(spec)) throw new TypeError('slime requires finite x/y');
  return {
    uid: spec.uid || null,
    cardId: spec.cardId || 'slime',
    x: spec.x,
    y: spec.y,
    aiState: COLONY_AI_STATES.includes(spec.aiState) ? spec.aiState : 'idle',
    speed: Math.max(0.05, Number(spec.speed) || 1),
    carryCapacity: Math.max(1, Math.floor(Number(spec.carryCapacity) || 1)),
    gatherMultiplier: Math.max(0.05, Number(spec.gatherMultiplier) || 1),
    buildMultiplier: Math.max(0.05, Number(spec.buildMultiplier) || 1),
    hp: Math.max(0, Number(spec.hp) || 100),
    maxHp: Math.max(1, Number(spec.maxHp) || Number(spec.hp) || 100),
    attackDamage: Math.max(0, Number(spec.attackDamage) || 10),
    attackRange: Math.max(0.1, Number(spec.attackRange) || 1.15),
    attackInterval: Math.max(0.05, Number(spec.attackInterval) || 1),
    attackCooldown: 0,
    aggroRange: Math.max(0.5, Number(spec.aggroRange) || 3),
    thinkTimer: 0,
    jobLockUntil: 0,
    job: null,
    path: [],
    carrying: null,
    workRemaining: 0,
    downedElapsed: 0,
  };
}

export function createColonyState(options = {}) {
  const bounds = {
    x: Math.floor(Number(options.bounds?.x) || 0),
    y: Math.floor(Number(options.bounds?.y) || 0),
    width: Math.max(1, Math.floor(Number(options.bounds?.width) || 24)),
    height: Math.max(1, Math.floor(Number(options.bounds?.height) || 16)),
  };
  const state = {
    time: 0,
    bounds,
    config: mergedConfig(options.config),
    resources: resourceRecord(options.resources),
    resourceNodes: [],
    blueprints: [],
    slimes: [],
    threats: [],
    jobs: [],
    rallyPoint: isFinitePoint(options.rallyPoint) ? { ...options.rallyPoint } : { x: bounds.x, y: bounds.y },
    basePosition: isFinitePoint(options.basePosition) ? { ...options.basePosition } : { x: bounds.x, y: bounds.y },
    workPriorities: { ...mergedConfig(options.config).priorities, ...(options.workPriorities || {}) },
    threat: {
      elapsed: 0,
      intensity: clamp(Number(options.threatIntensity) || 0, 0, 1),
      lastCheckedIntensity: 0,
      warned: [],
    },
    terrainQuery: typeof options.terrainQuery === 'function' ? options.terrainQuery : null,
    onTerrainChange: typeof options.onTerrainChange === 'function' ? options.onTerrainChange : null,
    findPath: typeof options.findPath === 'function' ? options.findPath : null,
    terrainOverrides: new Map(),
    terrainReservations: new Map(),
    nextUid: 0,
  };
  if (!isInsideColonyWorld(state, Math.round(state.basePosition.x), Math.round(state.basePosition.y))) {
    throw new RangeError('basePosition must be inside world bounds');
  }
  for (const slime of options.slimes || []) addColonySlime(state, slime);
  for (const node of options.resourceNodes || []) addResourceNode(state, node);
  for (const blueprint of options.blueprints || []) addBlueprint(state, blueprint);
  return state;
}

export function addColonySlime(state, spec) {
  const slime = createColonySlime(spec);
  if (!isInsideColonyWorld(state, Math.round(slime.x), Math.round(slime.y))) {
    throw new RangeError('slime must be inside world bounds');
  }
  slime.uid ||= nextUid(state, 'slime');
  state.slimes.push(slime);
  return slime;
}

export function addResourceNode(state, spec = {}) {
  const x = Math.floor(spec.x);
  const y = Math.floor(spec.y);
  if (!isInsideColonyWorld(state, x, y)) throw new RangeError('resource node must be inside world bounds');
  if (!RESOURCE_TYPES.includes(spec.resourceType)) throw new TypeError('unknown resource type');
  const terrain = terrainAt(state, x, y);
  if (!terrain.passable && !terrain.harvestable) throw new Error('resource node cannot replace blocked terrain');
  const node = {
    uid: spec.uid || nextUid(state, 'node'),
    x, y,
    resourceType: spec.resourceType,
    amount: Math.max(1, Math.floor(Number(spec.amount) || 1)),
    harvestSeconds: Math.max(0.05, Number(spec.harvestSeconds) || state.config.defaultHarvestSeconds),
    reservedBy: null,
  };
  state.resourceNodes.push(node);
  setTerrainAt(state, x, y, { kind: 'resource', resourceType: node.resourceType, harvestable: true, passable: true, buildable: false });
  return node;
}

function footprintCells(spec) {
  const width = Math.max(1, Math.floor(Number(spec.footprint?.width) || 1));
  const height = Math.max(1, Math.floor(Number(spec.footprint?.height) || 1));
  const cells = [];
  for (let dy = 0; dy < height; dy += 1) {
    for (let dx = 0; dx < width; dx += 1) cells.push({ x: Math.floor(spec.x) + dx, y: Math.floor(spec.y) + dy });
  }
  return cells;
}

export function canPlaceBlueprint(state, spec = {}) {
  const cells = footprintCells(spec);
  if (!cells.every(({ x, y }) => isInsideColonyWorld(state, x, y) && terrainAt(state, x, y).buildable)) return false;
  if (state.resourceNodes.some((node) => node.amount > 0 && cells.some((cell) => cell.x === node.x && cell.y === node.y))) return false;
  return !state.blueprints.some((blueprint) => !blueprint.cancelled
    && footprintCells(blueprint).some((occupied) => cells.some((cell) => cell.x === occupied.x && cell.y === occupied.y)));
}

export function addBlueprint(state, spec = {}) {
  if (!canPlaceBlueprint(state, spec)) throw new Error('blueprint placement is not buildable');
  const blueprint = {
    uid: spec.uid || nextUid(state, 'blueprint'),
    cardId: spec.cardId || 'building',
    x: Math.floor(spec.x),
    y: Math.floor(spec.y),
    footprint: {
      width: Math.max(1, Math.floor(Number(spec.footprint?.width) || 1)),
      height: Math.max(1, Math.floor(Number(spec.footprint?.height) || 1)),
    },
    required: resourceRecord(spec.required),
    delivered: resourceRecord(spec.delivered),
    buildSeconds: Math.max(0.05, Number(spec.buildSeconds) || 6),
    buildProgress: Math.max(0, Number(spec.buildProgress) || 0),
    complete: false,
    cancelled: false,
    reservedBy: null,
  };
  state.blueprints.push(blueprint);
  return blueprint;
}

export function setColonyRallyPoint(state, point) {
  const x = Math.floor(point?.x);
  const y = Math.floor(point?.y);
  if (!isInsideColonyWorld(state, x, y) || !terrainAt(state, x, y).passable) return false;
  state.rallyPoint = { x, y };
  return true;
}

export function setColonyWorkPriority(state, kind, priority) {
  if (!(kind in state.workPriorities) || !Number.isFinite(priority)) return false;
  state.workPriorities[kind] = priority;
  return true;
}

export function setColonyThreats(state, threats = []) {
  state.threats = threats.filter((threat) => isFinitePoint(threat)).map((threat, index) => ({
    uid: threat.uid || `threat-${index}`,
    x: threat.x,
    y: threat.y,
    hp: Math.max(0, Number(threat.hp) || 1),
    dead: Boolean(threat.dead),
  }));
}

export function addColonyThreat(state, amount) {
  state.threat.intensity = clamp(state.threat.intensity + (Number(amount) || 0), 0, 1);
  return state.threat.intensity;
}

export function setColonyThreatIntensity(state, intensity, { resetWarnings = false } = {}) {
  if (!Number.isFinite(intensity)) return false;
  state.threat.intensity = clamp(intensity, 0, 1);
  state.threat.lastCheckedIntensity = Math.min(
    state.threat.lastCheckedIntensity,
    state.threat.intensity,
  );
  if (resetWarnings) {
    state.threat.warned = [];
    state.threat.lastCheckedIntensity = state.threat.intensity;
  }
  return true;
}

export function downColonySlime(slime) {
  slime.hp = 0;
  slime.aiState = 'downed';
  slime.downedElapsed = 0;
  slime.path = [];
  slime.job = null;
  slime.carrying = null;
}

function defaultFindPath({ state, from, to, allowGoalBlocked = false }) {
  const start = { x: Math.round(from.x), y: Math.round(from.y) };
  const goal = { x: Math.round(to.x), y: Math.round(to.y) };
  const queue = [start];
  const cameFrom = new Map([[cellKey(start.x, start.y), null]]);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (queue.length) {
    const cell = queue.shift();
    if (cell.x === goal.x && cell.y === goal.y) break;
    for (const [dx, dy] of directions) {
      const next = { x: cell.x + dx, y: cell.y + dy };
      const key = cellKey(next.x, next.y);
      if (cameFrom.has(key) || !isInsideColonyWorld(state, next.x, next.y)) continue;
      const isGoal = next.x === goal.x && next.y === goal.y;
      if (!terrainAt(state, next.x, next.y).passable && !(isGoal && allowGoalBlocked)) continue;
      cameFrom.set(key, cell);
      queue.push(next);
    }
  }
  if (!cameFrom.has(cellKey(goal.x, goal.y))) return [];
  const path = [];
  let cursor = goal;
  while (cursor && !(cursor.x === start.x && cursor.y === start.y)) {
    path.push(cursor);
    cursor = cameFrom.get(cellKey(cursor.x, cursor.y));
  }
  return path.reverse();
}

export function findColonyPath(state, from, to, options = {}) {
  if (!isFinitePoint(from) || !isFinitePoint(to)) return [];
  const goal = { x: Math.round(to.x), y: Math.round(to.y) };
  if (!isInsideColonyWorld(state, goal.x, goal.y)) return [];
  const request = {
    state,
    bounds: { ...state.bounds },
    from: { x: Math.round(from.x), y: Math.round(from.y) },
    to: goal,
    allowGoalBlocked: Boolean(options.allowGoalBlocked),
    terrainAt: (x, y) => terrainAt(state, x, y),
    isPassable: (x, y) => isInsideColonyWorld(state, x, y) && terrainAt(state, x, y).passable,
  };
  const candidate = state.findPath?.(request) ?? defaultFindPath(request);
  if (!Array.isArray(candidate)) return [];
  const path = candidate.map((cell) => ({ x: Math.round(cell.x), y: Math.round(cell.y) }));
  const valid = path.every((cell, index) => isInsideColonyWorld(state, cell.x, cell.y)
    && (terrainAt(state, cell.x, cell.y).passable
      || (options.allowGoalBlocked && index === path.length - 1 && cell.x === goal.x && cell.y === goal.y)));
  return valid ? path : [];
}

function blueprintReady(blueprint) {
  return RESOURCE_TYPES.every((type) => blueprint.delivered[type] >= blueprint.required[type]);
}

function livingThreats(state) {
  return state.threats.filter((threat) => !threat.dead && threat.hp > 0);
}

function releaseReservation(state, slime) {
  if (!slime.job) return;
  if (slime.job.type === 'clear') {
    const key = cellKey(slime.job.x, slime.job.y);
    if (state.terrainReservations.get(key) === slime.uid) state.terrainReservations.delete(key);
    return;
  }
  const target = [...state.resourceNodes, ...state.blueprints].find((entry) => entry.uid === slime.job.targetUid);
  if (target?.reservedBy === slime.uid) target.reservedBy = null;
}

export function rebuildColonyJobs(state) {
  const jobs = [];
  for (const node of state.resourceNodes) {
    if (node.amount > 0) jobs.push({ uid: `gather:${node.uid}`, type: 'gather', targetUid: node.uid, priority: state.workPriorities.gather, reservedBy: node.reservedBy });
  }
  for (const blueprint of state.blueprints) {
    if (blueprint.complete || blueprint.cancelled) continue;
    if (blueprintReady(blueprint)) {
      jobs.push({ uid: `build:${blueprint.uid}`, type: 'build', targetUid: blueprint.uid, priority: state.workPriorities.build, reservedBy: blueprint.reservedBy });
    } else {
      for (const type of RESOURCE_TYPES) {
        const missing = blueprint.required[type] - blueprint.delivered[type];
        if (missing > 0 && state.resources[type] > 0) jobs.push({ uid: `deliver:${blueprint.uid}:${type}`, type: 'deliver', targetUid: blueprint.uid, resourceType: type, priority: state.workPriorities.build, reservedBy: blueprint.reservedBy });
      }
    }
  }
  for (let y = state.bounds.y; y < state.bounds.y + state.bounds.height; y += 1) {
    for (let x = state.bounds.x; x < state.bounds.x + state.bounds.width; x += 1) {
      const terrain = terrainAt(state, x, y);
      if (terrain.destructible) jobs.push({
        uid: `clear:${x}:${y}`,
        type: 'clear',
        x,
        y,
        priority: state.workPriorities.clear,
        reservedBy: state.terrainReservations.get(cellKey(x, y)) || null,
      });
    }
  }
  state.jobs = jobs;
  return jobs;
}

function assignPath(state, slime, destination, options = {}) {
  const path = findColonyPath(state, slime, destination, options);
  if (!path.length && distance(slime, destination) > 0.1) return false;
  slime.path = path;
  slime.destination = { x: destination.x, y: destination.y };
  return true;
}

function chooseJob(state, slime) {
  const nearestThreat = livingThreats(state).sort((a, b) => distance(slime, a) - distance(slime, b))[0];
  if (slime.hp / slime.maxHp < state.config.restHealthRatio) {
    releaseReservation(state, slime);
    slime.job = { type: 'rest' };
    slime.aiState = 'move';
    assignPath(state, slime, state.basePosition);
    return;
  }
  if (nearestThreat && (state.threat.intensity >= state.config.combatThreatIntensity || distance(slime, nearestThreat) <= slime.aggroRange)) {
    releaseReservation(state, slime);
    slime.job = { type: 'combat', targetUid: nearestThreat.uid };
    slime.aiState = distance(slime, nearestThreat) <= slime.attackRange ? 'attack' : 'chase';
    if (slime.aiState === 'chase') assignPath(state, slime, nearestThreat);
    return;
  }
  if (state.threat.intensity >= state.config.rallyThreatIntensity) {
    releaseReservation(state, slime);
    slime.job = { type: 'rally' };
    if (distance(slime, state.rallyPoint) <= 0.1) slime.aiState = 'rally';
    else {
      slime.aiState = 'move';
      assignPath(state, slime, state.rallyPoint);
    }
    return;
  }
  const jobs = rebuildColonyJobs(state)
    .filter((job) => !job.reservedBy || job.reservedBy === slime.uid)
    .sort((a, b) => b.priority - a.priority || distance(slime, jobPosition(state, a)) - distance(slime, jobPosition(state, b)));
  const job = jobs[0];
  if (!job) {
    slime.job = null;
    slime.aiState = 'idle';
    return;
  }
  slime.job = { ...job };
  slime.jobLockUntil = state.time + state.config.jobLockSeconds;
  const target = [...state.resourceNodes, ...state.blueprints].find((entry) => entry.uid === job.targetUid);
  if (target) target.reservedBy = slime.uid;
  if (job.type === 'clear') state.terrainReservations.set(cellKey(job.x, job.y), slime.uid);
  slime.aiState = 'move';
  const destination = job.type === 'deliver'
    ? state.basePosition
    : job.type === 'clear'
      ? clearApproachPosition(state, slime, job)
      : jobPosition(state, job);
  if (!destination || !assignPath(state, slime, destination)) {
    releaseReservation(state, slime);
    slime.job = null;
    slime.aiState = 'idle';
  }
}

function clearApproachPosition(state, slime, job) {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => ({ x: job.x + dx, y: job.y + dy }))
    .filter(({ x, y }) => isInsideColonyWorld(state, x, y) && terrainAt(state, x, y).passable)
    .sort((a, b) => distance(slime, a) - distance(slime, b))[0] || null;
}

function jobPosition(state, job) {
  if (job.type === 'clear') return { x: job.x, y: job.y };
  return [...state.resourceNodes, ...state.blueprints, ...state.threats]
    .find((entry) => entry.uid === job.targetUid) || state.basePosition;
}

function moveSlime(slime, dt) {
  const target = slime.path[0];
  if (!target) return true;
  const dx = target.x - slime.x;
  const dy = target.y - slime.y;
  const length = Math.hypot(dx, dy);
  const amount = Math.min(length, slime.speed * dt);
  if (length > 0) {
    slime.x += dx / length * amount;
    slime.y += dy / length * amount;
  }
  if (amount >= length - 1e-6) {
    slime.x = target.x;
    slime.y = target.y;
    slime.path.shift();
  }
  return slime.path.length === 0;
}

function arrive(state, slime) {
  const job = slime.job;
  if (!job) {
    slime.aiState = 'idle';
    return;
  }
  if (slime.carrying) {
    slime.aiState = 'deposit';
  } else if (job.type === 'rest') {
    slime.aiState = 'rest';
  } else if (job.type === 'rally') {
    slime.aiState = 'rally';
  } else if (job.type === 'combat') {
    slime.aiState = 'attack';
  } else if (job.type === 'gather' || job.type === 'clear') {
    slime.aiState = 'harvest';
    const node = state.resourceNodes.find((entry) => entry.uid === job.targetUid);
    slime.workRemaining = job.type === 'clear'
      ? Math.max(0.05, Number(terrainAt(state, job.x, job.y).durability) || 4) / state.config.obstacleDamagePerSecond
      : node.harvestSeconds / slime.gatherMultiplier;
  } else if (job.type === 'deliver' && !slime.carrying) {
    const blueprint = state.blueprints.find((entry) => entry.uid === job.targetUid);
    const missing = blueprint.required[job.resourceType] - blueprint.delivered[job.resourceType];
    const amount = Math.min(slime.carryCapacity, state.resources[job.resourceType], missing);
    if (amount <= 0) {
      releaseReservation(state, slime);
      slime.job = null;
      slime.aiState = 'idle';
      return;
    }
    state.resources[job.resourceType] -= amount;
    slime.carrying = { resourceType: job.resourceType, amount, destination: 'blueprint' };
    slime.aiState = 'carry';
    assignPath(state, slime, blueprint);
  } else if (job.type === 'deliver') {
    slime.aiState = 'deposit';
  } else if (job.type === 'build') {
    slime.aiState = 'build';
  }
}

function updateSlime(state, slime, dt, events) {
  if (slime.aiState === 'downed') {
    slime.downedElapsed += dt;
    if (slime.downedElapsed >= state.config.respawnSeconds && state.resources.nectar >= state.config.respawnNectarCost) {
      state.resources.nectar -= state.config.respawnNectarCost;
      slime.hp = slime.maxHp * 0.4;
      slime.x = state.basePosition.x;
      slime.y = state.basePosition.y;
      slime.aiState = 'rest';
      events.push({ type: 'slime-respawned', slimeUid: slime.uid });
    }
    return;
  }
  slime.attackCooldown = Math.max(0, slime.attackCooldown - dt);
  slime.thinkTimer -= dt;
  if (slime.thinkTimer <= 0) {
    slime.thinkTimer += state.config.thinkInterval;
    const combatOpportunity = livingThreats(state).some((threat) => distance(slime, threat) <= slime.aggroRange)
      || (livingThreats(state).length > 0 && state.threat.intensity >= state.config.combatThreatIntensity);
    const urgent = slime.hp / slime.maxHp < state.config.restHealthRatio
      || combatOpportunity
      || state.threat.intensity >= state.config.rallyThreatIntensity;
    const invalid = !slime.job
      || (slime.job.type === 'combat' && !livingThreats(state).some((threat) => threat.uid === slime.job.targetUid));
    const mayInterrupt = state.time >= slime.jobLockUntil && urgent;
    if (invalid || mayInterrupt || ['idle', 'seek', 'rally'].includes(slime.aiState)) {
      slime.aiState = 'seek';
      chooseJob(state, slime);
    }
  }
  if (slime.aiState === 'move' || slime.aiState === 'carry' || slime.aiState === 'chase') {
    if (slime.aiState === 'chase') {
      const threat = livingThreats(state).find((entry) => entry.uid === slime.job?.targetUid);
      if (!threat) {
        slime.job = null;
        slime.aiState = 'idle';
        return;
      }
      if (distance(slime, threat) <= slime.attackRange) {
        slime.path = [];
        slime.aiState = 'attack';
        return;
      }
    }
    if (moveSlime(slime, dt)) arrive(state, slime);
  } else if (slime.aiState === 'harvest') {
    slime.workRemaining -= dt;
    if (slime.workRemaining > 0) return;
    if (slime.job.type === 'clear') {
      setTerrainAt(state, slime.job.x, slime.job.y, { kind: 'ground' });
      state.terrainReservations.delete(cellKey(slime.job.x, slime.job.y));
      events.push({ type: 'terrain-cleared', x: slime.job.x, y: slime.job.y, slimeUid: slime.uid });
      slime.job = null;
      slime.aiState = 'idle';
      return;
    }
    const node = state.resourceNodes.find((entry) => entry.uid === slime.job.targetUid);
    if (!node || node.amount <= 0) {
      slime.job = null;
      slime.aiState = 'idle';
      return;
    }
    const amount = Math.min(slime.carryCapacity, node.amount);
    node.amount -= amount;
    slime.carrying = { resourceType: node.resourceType, amount, destination: 'base' };
    if (node.amount <= 0) {
      node.reservedBy = null;
      setTerrainAt(state, node.x, node.y, { kind: 'ground' });
      events.push({ type: 'resource-depleted', nodeUid: node.uid, x: node.x, y: node.y });
    }
    slime.aiState = 'carry';
    assignPath(state, slime, state.basePosition);
  } else if (slime.aiState === 'deposit') {
    if (slime.carrying?.destination === 'blueprint') {
      const blueprint = state.blueprints.find((entry) => entry.uid === slime.job.targetUid);
      blueprint.delivered[slime.carrying.resourceType] += slime.carrying.amount;
      events.push({ type: 'material-delivered', blueprintUid: blueprint.uid, ...slime.carrying });
    } else if (slime.carrying) {
      state.resources[slime.carrying.resourceType] += slime.carrying.amount;
      events.push({ type: 'resource-deposited', slimeUid: slime.uid, ...slime.carrying });
    }
    slime.carrying = null;
    releaseReservation(state, slime);
    slime.job = null;
    slime.aiState = 'idle';
  } else if (slime.aiState === 'build') {
    const blueprint = state.blueprints.find((entry) => entry.uid === slime.job?.targetUid);
    if (!blueprint || blueprint.complete || !blueprintReady(blueprint)) {
      slime.job = null;
      slime.aiState = 'idle';
      return;
    }
    blueprint.buildProgress += dt * state.config.buildRate * slime.buildMultiplier;
    if (blueprint.buildProgress >= blueprint.buildSeconds) {
      blueprint.buildProgress = blueprint.buildSeconds;
      blueprint.complete = true;
      blueprint.reservedBy = null;
      events.push({ type: 'blueprint-completed', blueprintUid: blueprint.uid, cardId: blueprint.cardId });
      slime.job = null;
      slime.aiState = 'idle';
    }
  } else if (slime.aiState === 'attack') {
    const threat = livingThreats(state).find((entry) => entry.uid === slime.job?.targetUid);
    if (!threat) {
      slime.job = null;
      slime.aiState = 'idle';
    } else if (distance(slime, threat) > slime.attackRange) {
      slime.aiState = 'chase';
      assignPath(state, slime, threat);
    } else if (slime.attackCooldown <= 0) {
      threat.hp -= slime.attackDamage;
      slime.attackCooldown = slime.attackInterval;
      events.push({ type: 'threat-hit', threatUid: threat.uid, slimeUid: slime.uid, damage: slime.attackDamage });
      if (threat.hp <= 0) {
        threat.dead = true;
        events.push({ type: 'threat-defeated', threatUid: threat.uid, slimeUid: slime.uid });
      }
    }
  } else if (slime.aiState === 'rest') {
    slime.hp = Math.min(slime.maxHp, slime.hp + state.config.restHealingPerSecond * dt);
    if (slime.hp / slime.maxHp >= state.config.leaveRestHealthRatio) {
      slime.job = null;
      slime.aiState = 'idle';
    }
  }
}

function updateThreatClock(state, dt, events) {
  state.threat.elapsed += dt;
  const before = state.threat.lastCheckedIntensity;
  state.threat.intensity = clamp(state.threat.intensity + state.config.passiveThreatPerSecond * dt, 0, 1);
  for (const threshold of state.config.threatWarningThresholds) {
    if (before < threshold && state.threat.intensity >= threshold && !state.threat.warned.includes(threshold)) {
      state.threat.warned.push(threshold);
      events.push({ type: 'threat-warning', threshold, intensity: state.threat.intensity, elapsed: state.threat.elapsed });
    }
  }
  state.threat.lastCheckedIntensity = state.threat.intensity;
}

export function updateColony(state, dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new TypeError('dt must be a non-negative finite number');
  const events = [];
  if (dt === 0) return events;
  state.time += dt;
  updateThreatClock(state, dt, events);
  for (const slime of state.slimes) updateSlime(state, slime, dt, events);
  return events;
}
