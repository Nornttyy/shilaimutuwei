/**
 * Pure expedition-run state machine.
 *
 * Rendering and combat simulation deliberately live outside this module. A
 * caller selects a route node, runs the encounter in its own battle scene,
 * then reports victory or defeat here. The returned state only contains plain
 * JSON values so it can be written directly to local storage or a cloud save.
 */

export const EXPEDITION_STATE_VERSION = 1;
export const EXPEDITION_MAX_SQUAD_SIZE = 3;
export const EXPEDITION_PHASES = Object.freeze([
  'squad-selection',
  'route-selection',
  'encounter',
  'boon-selection',
  'settlement',
]);
export const EXPEDITION_STATUSES = Object.freeze([
  'draft',
  'active',
  'completed',
  'failed',
  'abandoned',
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export const DEFAULT_EXPEDITION_CATALOG = deepFreeze({
  id: 'expedition-default-v1',
  route: {
    regularSteps: 4,
    choicesPerStep: 3,
    boonChoices: 3,
    powerGrowthPerStep: 0.18,
  },
  encounters: [
    {
      id: 'dew-drop-swarm',
      kind: 'battle',
      weight: 5,
      power: 38,
      enemies: ['enemy-soft-biter', 'enemy-soft-biter', 'enemy-windcap'],
      reward: { gel: 4 },
    },
    {
      id: 'moss-bug-march',
      kind: 'battle',
      weight: 5,
      power: 42,
      enemies: ['enemy-windcap', 'enemy-windcap', 'enemy-soft-biter'],
      reward: { nectar: 3 },
    },
    {
      id: 'crystal-crawlers',
      kind: 'battle',
      weight: 4,
      power: 46,
      enemies: ['enemy-stone-lump', 'enemy-soft-biter'],
      reward: { shard: 2 },
    },
    {
      id: 'mud-hop-pack',
      kind: 'battle',
      weight: 4,
      power: 44,
      enemies: ['enemy-soft-biter', 'enemy-soft-biter', 'enemy-windcap'],
      reward: { gel: 2, nectar: 2 },
    },
    {
      id: 'thorn-guard',
      kind: 'elite',
      weight: 2,
      minStep: 1,
      power: 62,
      enemies: ['enemy-stone-lump', 'enemy-windcap', 'enemy-windcap'],
      reward: { gel: 4, shard: 3 },
    },
    {
      id: 'prism-shell-elite',
      kind: 'elite',
      weight: 2,
      minStep: 2,
      power: 70,
      enemies: ['enemy-stone-lump', 'enemy-stone-lump', 'enemy-soft-biter'],
      reward: { nectar: 4, shard: 3 },
    },
    {
      id: 'corrupted-crown',
      kind: 'boss',
      weight: 1,
      power: 118,
      enemies: ['enemy-acid-shell-king'],
      reward: { gel: 12, nectar: 8, shard: 6 },
    },
  ],
  boons: [
    { id: 'springy-strikes', weight: 4, modifiers: { attackMultiplier: 1.18 } },
    { id: 'rapid-bubbles', weight: 4, modifiers: { attackSpeedMultiplier: 1.15 } },
    { id: 'gel-armor', weight: 4, modifiers: { maxHpMultiplier: 1.2 } },
    { id: 'dew-mending', weight: 3, modifiers: { postBattleHealRatio: 0.2 } },
    { id: 'crystal-echo', weight: 3, modifiers: { skillDamageMultiplier: 1.25 } },
    { id: 'sticky-opening', weight: 3, modifiers: { openingSlowSeconds: 3 } },
    { id: 'shared-shine', weight: 2, modifiers: { teamAuraMultiplier: 1.12 } },
    { id: 'lucky-pouch', weight: 2, modifiers: { rewardMultiplier: 1.15 } },
  ],
  rewards: {
    victoryBonus: { gel: 16, nectar: 10, shard: 6 },
    completionMultiplier: 1,
    defeatKeepRatio: 0.35,
    abandonKeepRatio: 0.2,
  },
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function jsonClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function normalizeSeed(value) {
  if (typeof value === 'string') {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) || 0x6d2b79f5;
  }
  const numeric = Number(value);
  return (Number.isFinite(numeric) ? Math.trunc(numeric) >>> 0 : 0x6d2b79f5) || 0x6d2b79f5;
}

function rewardRecord(value = {}) {
  const flattened = {
    ...(value?.resources && typeof value.resources === 'object' ? value.resources : {}),
    ...Object.fromEntries(Object.entries(value || {}).filter(([key]) => key !== 'resources')),
  };
  const entries = Object.entries(flattened)
    .filter(([key, amount]) => key && Number.isFinite(Number(amount)) && Number(amount) > 0)
    .map(([key, amount]) => [key, Number(amount)])
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function addRewards(target, source, multiplier = 1) {
  for (const [key, amount] of Object.entries(rewardRecord(source))) {
    target[key] = (Number(target[key]) || 0) + amount * multiplier;
  }
  return target;
}

function scaledRewards(source, multiplier) {
  return Object.fromEntries(Object.entries(rewardRecord(source)).map(([key, amount]) => [
    key,
    Math.max(0, Math.floor(amount * multiplier + 1e-9)),
  ]).filter(([, amount]) => amount > 0));
}

function catalogEntry(catalog, expeditionId = null) {
  if (catalog?.route && Array.isArray(catalog?.encounters)) return catalog;
  if (Array.isArray(catalog?.expeditions)) {
    const selected = expeditionId
      ? catalog.expeditions.find(({ id }) => id === expeditionId)
      : catalog.expeditions[0];
    if (!selected) throw new Error(`unknown expedition catalog entry: ${expeditionId}`);
    return selected;
  }
  return catalog;
}

function normalizeCatalog(source = DEFAULT_EXPEDITION_CATALOG, expeditionId = null) {
  const catalog = catalogEntry(source, expeditionId);
  if (!catalog || typeof catalog !== 'object') throw new TypeError('expedition catalog must be an object');
  const route = catalog.route || {};
  const normalized = {
    id: String(catalog.id || catalog.version || 'expedition-catalog'),
    route: {
      regularSteps: Math.max(1, Math.floor(Number(route.regularSteps ?? route.steps) || 4)),
      choicesPerStep: clamp(Math.floor(Number(route.choicesPerStep) || 3), 1, 3),
      boonChoices: clamp(Math.floor(Number(route.boonChoices) || 3), 1, 3),
      powerGrowthPerStep: Math.max(0, Number(route.powerGrowthPerStep) || 0),
      nodeTypeIds: Array.isArray(route.nodeTypeIds) ? route.nodeTypeIds.map(String) : [],
    },
    encounters: (catalog.encounters || []).map((entry, index) => ({
      id: String(entry.id || `encounter-${index + 1}`),
      kind: ['battle', 'elite', 'boss'].includes(entry.kind) ? entry.kind : 'battle',
      weight: Math.max(0.0001, Number(entry.weight) || 1),
      minStep: Math.max(0, Math.floor(Number(entry.minStep) || 0)),
      maxStep: Number.isFinite(Number(entry.maxStep))
        ? Math.max(0, Math.floor(Number(entry.maxStep)))
        : Number.POSITIVE_INFINITY,
      power: Math.max(0.0001, Number(entry.power) || 1),
      enemies: jsonClone(entry.enemies || entry.enemyIds || []),
      groups: jsonClone(entry.groups || []),
      tuning: jsonClone(entry.tuning || {}),
      estimatedDurationSeconds: Math.max(0, Number(entry.estimatedDurationSeconds) || 0),
      reward: rewardRecord(entry.reward),
      metadata: jsonClone(entry.metadata || {}),
    })),
    boons: (catalog.boons || catalog.buffs || []).map((entry, index) => ({
      id: String(entry.id || `boon-${index + 1}`),
      weight: Math.max(0.0001, Number(entry.weight) || 1),
      maxStacks: Math.max(1, Math.floor(Number(entry.maxStacks) || 1)),
      modifiers: jsonClone(entry.modifiers || {}),
      metadata: jsonClone(entry.metadata || {}),
    })),
    rewards: {
      victoryBonus: rewardRecord(catalog.rewards?.victoryBonus),
      completionMultiplier: Math.max(0, Number(catalog.rewards?.completionMultiplier) || 1),
      defeatKeepRatio: clamp(Number(catalog.rewards?.defeatKeepRatio) || 0, 0, 1),
      abandonKeepRatio: clamp(Number(catalog.rewards?.abandonKeepRatio) || 0, 0, 1),
    },
  };
  const regular = normalized.encounters.filter(({ kind }) => kind !== 'boss');
  const bosses = normalized.encounters.filter(({ kind }) => kind === 'boss');
  if (!regular.length) throw new Error('expedition catalog requires a regular encounter');
  if (!bosses.length) throw new Error('expedition catalog requires a boss encounter');
  if (normalized.boons.length < normalized.route.boonChoices) {
    throw new Error('expedition catalog does not contain enough boons');
  }
  return normalized;
}

function catalogForState(state, catalog) {
  const normalized = normalizeCatalog(catalog, state.catalogId);
  if (state.catalogId !== normalized.id) {
    throw new Error(`expedition catalog mismatch: expected ${state.catalogId}, received ${normalized.id}`);
  }
  return normalized;
}

function nextRandom(state) {
  let value = state.rngState >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rngState = (value >>> 0) || 0x6d2b79f5;
  state.rngDraws += 1;
  return state.rngState / 0x100000000;
}

function weightedPickIndex(state, entries) {
  const total = entries.reduce((sum, entry) => sum + Math.max(0.0001, Number(entry.weight) || 1), 0);
  let cursor = nextRandom(state) * total;
  for (let index = 0; index < entries.length; index += 1) {
    cursor -= Math.max(0.0001, Number(entries[index].weight) || 1);
    if (cursor < 0) return index;
  }
  return entries.length - 1;
}

function weightedSample(state, entries, count) {
  const pool = [...entries];
  const selected = [];
  while (pool.length && selected.length < count) {
    const index = weightedPickIndex(state, pool);
    selected.push(pool[index]);
    pool.splice(index, 1);
  }
  return selected;
}

function weightedRouteSample(state, entries, count) {
  const selected = weightedSample(state, entries, count);
  while (selected.length < count) selected.push(entries[weightedPickIndex(state, entries)]);
  return selected;
}

function normalizeRoster(roster = []) {
  const seen = new Set();
  return roster.map((entry) => {
    const normalized = typeof entry === 'string' ? { id: entry } : jsonClone(entry);
    const id = String(normalized?.id || normalized?.uid || normalized?.cardId || '');
    if (!id) throw new TypeError('every expedition roster entry requires an id');
    if (seen.has(id)) throw new Error(`duplicate expedition roster id: ${id}`);
    seen.add(id);
    return { ...normalized, id };
  });
}

function assertPhase(state, phase) {
  if (state.phase !== phase) throw new Error(`expedition phase must be ${phase}, received ${state.phase}`);
}

function makeRouteNode(state, encounter, step, slot, catalog) {
  const isBoss = encounter.kind === 'boss';
  const growth = isBoss ? 1 : 1 + step * catalog.route.powerGrowthPerStep;
  return {
    uid: `route-${step + 1}-${slot + 1}-${state.nextNodeId++}`,
    templateId: encounter.id,
    step,
    slot,
    kind: encounter.kind,
    nodeTypeId: catalog.route.nodeTypeIds[slot % catalog.route.nodeTypeIds.length] || null,
    isFinalBoss: isBoss,
    power: Math.max(0.0001, Math.round(encounter.power * growth * 1000) / 1000),
    enemies: jsonClone(encounter.enemies),
    groups: jsonClone(encounter.groups),
    tuning: jsonClone(encounter.tuning),
    estimatedDurationSeconds: encounter.estimatedDurationSeconds,
    reward: rewardRecord(encounter.reward),
    metadata: jsonClone(encounter.metadata),
  };
}

function generateRouteChoices(state, catalog) {
  const step = state.route.regularWins;
  let candidates;
  let choiceCount;
  if (step >= catalog.route.regularSteps) {
    candidates = catalog.encounters.filter(({ kind }) => kind === 'boss');
    choiceCount = 1;
  } else {
    const catalogStep = step + 1;
    candidates = catalog.encounters.filter(({ kind, minStep, maxStep }) => (
      kind !== 'boss' && catalogStep >= minStep && catalogStep <= maxStep
    ));
    if (!candidates.length) throw new Error(`no expedition encounters are eligible for step ${step}`);
    choiceCount = catalog.route.choicesPerStep;
  }
  state.route.choices = weightedRouteSample(state, candidates, choiceCount)
    .map((encounter, slot) => makeRouteNode(state, encounter, step, slot, catalog));
  state.route.isBossStage = step >= catalog.route.regularSteps;
  state.phase = 'route-selection';
  return state.route.choices;
}

function generateBoonChoices(state, catalog) {
  const stacks = Object.fromEntries(state.boons.map((boon) => [boon.id, boon.stacks]));
  let eligible = catalog.boons.filter((boon) => (stacks[boon.id] || 0) < boon.maxStacks);
  if (eligible.length < catalog.route.boonChoices) eligible = catalog.boons;
  state.boonChoices = weightedSample(state, eligible, catalog.route.boonChoices).map((boon) => ({
    id: boon.id,
    modifiers: jsonClone(boon.modifiers),
    metadata: jsonClone(boon.metadata),
  }));
  state.phase = 'boon-selection';
  return state.boonChoices;
}

function finishExpedition(state, outcome, catalog) {
  const ratios = {
    completed: catalog.rewards.completionMultiplier,
    failed: catalog.rewards.defeatKeepRatio,
    abandoned: catalog.rewards.abandonKeepRatio,
  };
  const rewards = scaledRewards(state.runLoot, ratios[outcome]);
  if (outcome === 'completed') addRewards(rewards, catalog.rewards.victoryBonus);
  state.status = outcome;
  state.phase = 'settlement';
  state.route.choices = [];
  state.boonChoices = [];
  state.currentEncounter = null;
  state.settlement = {
    outcome,
    rewards: rewardRecord(rewards),
    claimed: false,
    regularWins: state.route.regularWins,
    eliteWins: state.stats.eliteWins,
    bossDefeated: state.stats.bossWins > 0,
  };
  return state.settlement;
}

export function createExpeditionState(options = {}, injectedCatalog = null) {
  const catalog = normalizeCatalog(
    injectedCatalog || options.catalog || DEFAULT_EXPEDITION_CATALOG,
    options.expeditionId || null,
  );
  const seed = normalizeSeed(options.seed);
  const state = {
    version: EXPEDITION_STATE_VERSION,
    id: String(options.id || `expedition-${seed.toString(16).padStart(8, '0')}`),
    catalogId: catalog.id,
    seed,
    rngState: seed,
    rngDraws: 0,
    nextNodeId: 1,
    status: 'draft',
    phase: 'squad-selection',
    roster: normalizeRoster(options.roster),
    squad: [],
    route: {
      regularSteps: catalog.route.regularSteps,
      regularWins: 0,
      isBossStage: false,
      choices: [],
      history: [],
    },
    currentEncounter: null,
    boonChoices: [],
    boons: [],
    runLoot: {},
    settlement: null,
    stats: {
      routeSelections: 0,
      encountersWon: 0,
      encountersLost: 0,
      eliteWins: 0,
      bossWins: 0,
      boonsChosen: 0,
    },
  };
  if (options.squad?.length) selectExpeditionSquad(state, options.squad);
  return state;
}

export function selectExpeditionSquad(state, slimeIds = []) {
  assertPhase(state, 'squad-selection');
  if (state.status !== 'draft') throw new Error('only a draft expedition can change its squad');
  if (!Array.isArray(slimeIds)) throw new TypeError('expedition squad must be an array of slime ids');
  const ids = slimeIds.map(String);
  if (ids.length > EXPEDITION_MAX_SQUAD_SIZE) {
    throw new RangeError(`expedition squad cannot exceed ${EXPEDITION_MAX_SQUAD_SIZE} slimes`);
  }
  if (new Set(ids).size !== ids.length) throw new Error('expedition squad cannot contain duplicate slimes');
  const available = new Set(state.roster.map(({ id }) => id));
  const missing = ids.find((id) => !available.has(id));
  if (missing) throw new Error(`slime is not in the expedition roster: ${missing}`);
  state.squad = ids;
  return [...state.squad];
}

export function startExpedition(state, injectedCatalog = DEFAULT_EXPEDITION_CATALOG) {
  assertPhase(state, 'squad-selection');
  if (state.status !== 'draft') throw new Error('expedition has already started');
  if (state.squad.length < 1) throw new Error('expedition requires at least one slime');
  if (state.squad.length > EXPEDITION_MAX_SQUAD_SIZE) throw new Error('expedition squad is too large');
  const catalog = catalogForState(state, injectedCatalog);
  state.status = 'active';
  return generateRouteChoices(state, catalog);
}

export function chooseExpeditionRoute(state, nodeUid, injectedCatalog = DEFAULT_EXPEDITION_CATALOG) {
  assertPhase(state, 'route-selection');
  if (state.status !== 'active') throw new Error('expedition is not active');
  catalogForState(state, injectedCatalog);
  const node = state.route.choices.find(({ uid }) => uid === nodeUid);
  if (!node) throw new Error(`unknown expedition route node: ${nodeUid}`);
  const historyEntry = { ...jsonClone(node), outcome: 'active' };
  state.route.history.push(historyEntry);
  state.route.choices = [];
  state.stats.routeSelections += 1;
  state.currentEncounter = {
    uid: `encounter-${historyEntry.uid}`,
    nodeUid: historyEntry.uid,
    templateId: historyEntry.templateId,
    kind: historyEntry.kind,
    nodeTypeId: historyEntry.nodeTypeId,
    isFinalBoss: historyEntry.isFinalBoss,
    power: historyEntry.power,
    enemies: jsonClone(historyEntry.enemies),
    groups: jsonClone(historyEntry.groups),
    tuning: jsonClone(historyEntry.tuning),
    estimatedDurationSeconds: historyEntry.estimatedDurationSeconds,
    reward: rewardRecord(historyEntry.reward),
    status: 'active',
  };
  state.phase = 'encounter';
  return state.currentEncounter;
}

function normalizeBattleOutcome(result) {
  if (typeof result === 'string') return { outcome: result };
  if (typeof result?.won === 'boolean') return { ...result, outcome: result.won ? 'victory' : 'defeat' };
  return result || {};
}

export function resolveExpeditionBattle(state, battleResult, injectedCatalog = DEFAULT_EXPEDITION_CATALOG) {
  assertPhase(state, 'encounter');
  if (state.status !== 'active' || !state.currentEncounter) throw new Error('expedition encounter is not active');
  const catalog = catalogForState(state, injectedCatalog);
  const result = normalizeBattleOutcome(battleResult);
  const outcome = result.outcome === 'win' ? 'victory' : result.outcome === 'loss' ? 'defeat' : result.outcome;
  if (!['victory', 'defeat'].includes(outcome)) throw new TypeError('battle outcome must be victory or defeat');
  const encounter = state.currentEncounter;
  encounter.status = outcome;
  encounter.summary = jsonClone(result.summary || {});
  const history = state.route.history.find(({ uid }) => uid === encounter.nodeUid);
  if (history) history.outcome = outcome;

  if (outcome === 'defeat') {
    state.stats.encountersLost += 1;
    return finishExpedition(state, 'failed', catalog);
  }

  state.stats.encountersWon += 1;
  if (encounter.kind === 'elite') state.stats.eliteWins += 1;
  if (encounter.isFinalBoss) state.stats.bossWins += 1;
  const rewardMultiplier = clamp(Number(result.rewardMultiplier) || 1, 0, 100);
  addRewards(state.runLoot, encounter.reward, rewardMultiplier);
  addRewards(state.runLoot, result.bonusReward);

  if (encounter.isFinalBoss) return finishExpedition(state, 'completed', catalog);

  state.route.regularWins += 1;
  state.currentEncounter = null;
  return generateBoonChoices(state, catalog);
}

export function chooseExpeditionBoon(state, boonId, injectedCatalog = DEFAULT_EXPEDITION_CATALOG) {
  assertPhase(state, 'boon-selection');
  if (state.status !== 'active') throw new Error('expedition is not active');
  const catalog = catalogForState(state, injectedCatalog);
  const choice = state.boonChoices.find(({ id }) => id === boonId);
  if (!choice) throw new Error(`unknown expedition boon: ${boonId}`);
  let owned = state.boons.find(({ id }) => id === choice.id);
  if (owned) {
    owned.stacks += 1;
  } else {
    owned = { id: choice.id, stacks: 1, modifiers: jsonClone(choice.modifiers) };
    state.boons.push(owned);
  }
  state.stats.boonsChosen += 1;
  state.boonChoices = [];
  generateRouteChoices(state, catalog);
  return owned;
}

export function abandonExpedition(state, injectedCatalog = DEFAULT_EXPEDITION_CATALOG) {
  if (state.phase === 'settlement') throw new Error('expedition has already settled');
  const catalog = catalogForState(state, injectedCatalog);
  return finishExpedition(state, 'abandoned', catalog);
}

export function claimExpeditionRewards(state) {
  assertPhase(state, 'settlement');
  if (!state.settlement) throw new Error('expedition has no settlement');
  if (state.settlement.claimed) throw new Error('expedition rewards have already been claimed');
  state.settlement.claimed = true;
  return jsonClone(state.settlement.rewards);
}

export function serializeExpeditionState(state) {
  return JSON.stringify(state);
}

export function restoreExpeditionState(snapshot, injectedCatalog = DEFAULT_EXPEDITION_CATALOG) {
  const parsed = typeof snapshot === 'string' ? JSON.parse(snapshot) : jsonClone(snapshot);
  if (!parsed || typeof parsed !== 'object') throw new TypeError('expedition snapshot must be an object or JSON string');
  if (parsed.version !== EXPEDITION_STATE_VERSION) throw new Error('unsupported expedition state version');
  if (!EXPEDITION_PHASES.includes(parsed.phase)) throw new Error(`invalid expedition phase: ${parsed.phase}`);
  if (!EXPEDITION_STATUSES.includes(parsed.status)) throw new Error(`invalid expedition status: ${parsed.status}`);
  const catalog = catalogForState(parsed, injectedCatalog);
  if (!Array.isArray(parsed.squad) || parsed.squad.length > EXPEDITION_MAX_SQUAD_SIZE) {
    throw new Error('invalid expedition squad in snapshot');
  }
  if (parsed.route?.regularSteps !== catalog.route.regularSteps) {
    throw new Error('expedition route length does not match catalog');
  }
  parsed.seed = normalizeSeed(parsed.seed);
  parsed.rngState = normalizeSeed(parsed.rngState);
  parsed.rngDraws = Math.max(0, Math.floor(Number(parsed.rngDraws) || 0));
  parsed.nextNodeId = Math.max(1, Math.floor(Number(parsed.nextNodeId) || 1));
  return parsed;
}

// Concise aliases for callers that model the expedition as a generic run.
export const createExpedition = createExpeditionState;
export const chooseRouteNode = chooseExpeditionRoute;
export const resolveBattle = resolveExpeditionBattle;
export const chooseBoon = chooseExpeditionBoon;
