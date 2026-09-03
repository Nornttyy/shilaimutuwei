/**
 * Deterministic, persistence-safe equipment rules for tower-defense heroes.
 *
 * This module deliberately has no dependency on the battle core. Every command
 * accepts a progress object and returns a new progress object, so web, WeChat,
 * tests, and a future server can all wrap the same rules.
 */

const DEFAULT_EQUIPMENT_RNG_SEED = 0xE91A2D5;
const MAX_DRAW_COUNT = 100;
const MAX_SAFE_AMOUNT = Number.MAX_SAFE_INTEGER;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function nonNegativeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return clamp(Math.floor(number), 0, MAX_SAFE_AMOUNT);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const TD_EQUIPMENT_STAT_IDS = Object.freeze([
  'damagePct',
  'attackSpeedPct',
  'healthPct',
]);

export const TD_EQUIPMENT_SLOT_IDS = Object.freeze(['damage', 'speed', 'health']);

export const TD_EQUIPMENT_SLOTS = deepFreeze({
  damage: {
    id: 'damage',
    name: '攻击徽记',
    seriesName: '赤曜徽记',
    iconKey: 'equipment-damage-charm',
    baseStats: { damagePct: 600, attackSpeedPct: 100, healthPct: 200 },
  },
  speed: {
    id: 'speed',
    name: '迅捷徽记',
    seriesName: '流光徽记',
    iconKey: 'equipment-speed-charm',
    baseStats: { damagePct: 200, attackSpeedPct: 450, healthPct: 200 },
  },
  health: {
    id: 'health',
    name: '生命徽记',
    seriesName: '青芽徽记',
    iconKey: 'equipment-health-charm',
    baseStats: { damagePct: 200, attackSpeedPct: 100, healthPct: 800 },
  },
});

export const TD_EQUIPMENT_RARITY_IDS = Object.freeze(['R', 'SR', 'SSR', 'UR']);

export const TD_EQUIPMENT_RARITIES = deepFreeze({
  R: {
    id: 'R', rank: 0, weight: 54, statScale: 1,
    salvage: { metaCoins: 80, equipmentEssence: 1 },
  },
  SR: {
    id: 'SR', rank: 1, weight: 30, statScale: 1.7,
    salvage: { metaCoins: 220, equipmentEssence: 3 },
  },
  SSR: {
    id: 'SSR', rank: 2, weight: 13, statScale: 2.8,
    salvage: { metaCoins: 700, equipmentEssence: 10 },
  },
  UR: {
    id: 'UR', rank: 3, weight: 3, statScale: 4.6,
    salvage: { metaCoins: 2400, equipmentEssence: 32 },
  },
});

/**
 * Authored identity for every catalog entry. Definition IDs stay unchanged so
 * existing saves, stage rewards, and summon results hydrate into the new art.
 */
const TD_EQUIPMENT_IDENTITIES = deepFreeze({
  damage: {
    R: { name: '赤曜徽记', iconKey: 'equipment-damage-charm' },
    SR: { name: '焰心战锤', iconKey: 'equipment-flame-hammer-v1' },
    SSR: { name: '雷鸣战角', iconKey: 'equipment-thunder-horn-v1' },
    UR: { name: '星核光刃', iconKey: 'equipment-star-core-blade-v1' },
  },
  speed: {
    R: { name: '流光徽记', iconKey: 'equipment-speed-charm' },
    SR: { name: '翼风铃', iconKey: 'equipment-wing-bell-v1' },
    SSR: { name: '雷闪齿轮', iconKey: 'equipment-lightning-gear-v1' },
    UR: { name: '时之沙漏', iconKey: 'equipment-time-hourglass-v1' },
  },
  health: {
    R: { name: '青芽徽记', iconKey: 'equipment-health-charm' },
    SR: { name: '珊瑚守卫', iconKey: 'equipment-coral-guard-v1' },
    SSR: { name: '晶辉王冠', iconKey: 'equipment-crystal-crown-v1' },
    UR: { name: '世界树之心', iconKey: 'equipment-world-tree-heart-v1' },
  },
});

function definitionFor(slotId, rarityId) {
  const slot = TD_EQUIPMENT_SLOTS[slotId];
  const rarity = TD_EQUIPMENT_RARITIES[rarityId];
  const identity = TD_EQUIPMENT_IDENTITIES[slotId][rarityId];
  const stats = Object.fromEntries(TD_EQUIPMENT_STAT_IDS.map((statId) => [
    statId,
    Math.round(slot.baseStats[statId] * rarity.statScale),
  ]));
  return deepFreeze({
    id: `${slotId}-${rarityId.toLowerCase()}`,
    slot: slotId,
    rarity: rarityId,
    name: identity.name,
    iconKey: identity.iconKey,
    stats,
  });
}

/** Twelve authored definitions: one R/SR/SSR/UR series for each slot. */
export const TD_EQUIPMENT_CATALOG = Object.freeze(TD_EQUIPMENT_SLOT_IDS.flatMap((slotId) => (
  TD_EQUIPMENT_RARITY_IDS.map((rarityId) => definitionFor(slotId, rarityId))
)));

export const TD_EQUIPMENT_BY_ID = Object.freeze(Object.fromEntries(
  TD_EQUIPMENT_CATALOG.map((definition) => [definition.id, definition]),
));

function validUid(value) {
  return typeof value === 'string'
    && value.trim() === value
    && value.length > 0
    && value.length <= 80;
}

function validHeroId(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)
    && !['constructor', 'prototype', '__proto__'].includes(value);
}

function hydrateItem(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const definition = TD_EQUIPMENT_BY_ID[source.definitionId];
  if (!definition || !validUid(source.uid)) return null;
  return Object.freeze({
    uid: source.uid,
    definitionId: definition.id,
    slot: definition.slot,
    rarity: definition.rarity,
    name: definition.name,
    iconKey: definition.iconKey,
    stats: definition.stats,
    locked: source.locked === true,
  });
}

/**
 * Removes malformed, forged, unknown, and duplicate inventory records.
 * Catalog stats are authoritative, so a save cannot inject impossible values.
 */
export function sanitizeTowerDefenseEquipmentInventory(source = []) {
  if (!Array.isArray(source)) return Object.freeze([]);
  const seen = new Set();
  const items = [];
  for (const candidate of source) {
    const item = hydrateItem(candidate);
    if (!item || seen.has(item.uid)) continue;
    seen.add(item.uid);
    items.push(item);
  }
  return Object.freeze(items);
}

function blankLoadout() {
  return { damage: null, speed: null, health: null };
}

function sanitizeLoadouts(source, itemByUid) {
  const result = {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return Object.freeze(result);
  }
  const equipped = new Set();
  for (const heroId of Object.keys(source).sort()) {
    if (!validHeroId(heroId)) continue;
    const requested = source[heroId];
    if (!requested || typeof requested !== 'object' || Array.isArray(requested)) continue;
    const loadout = blankLoadout();
    for (const slotId of TD_EQUIPMENT_SLOT_IDS) {
      const uid = requested[slotId];
      const item = itemByUid.get(uid);
      if (!item || item.slot !== slotId || equipped.has(uid)) continue;
      loadout[slotId] = uid;
      equipped.add(uid);
    }
    result[heroId] = Object.freeze(loadout);
  }
  return Object.freeze(result);
}

function equipmentSerial(source, items) {
  let serial = Math.max(1, nonNegativeInteger(source, 1));
  for (const { uid } of items) {
    const match = /^gear-(\d+)$/.exec(uid);
    if (match) serial = Math.max(serial, nonNegativeInteger(match[1]) + 1);
  }
  return Math.min(serial, MAX_SAFE_AMOUNT);
}

function bannerFrom(source = {}) {
  const banner = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  return Object.freeze({
    rngState: (Number(banner.rngState) >>> 0) || DEFAULT_EQUIPMENT_RNG_SEED,
    srPity: clamp(Math.floor(Number(banner.srPity) || 0), 0, 9),
    ssrPity: clamp(Math.floor(Number(banner.ssrPity) || 0), 0, 29),
    urPity: clamp(Math.floor(Number(banner.urPity) || 0), 0, 79),
  });
}

/**
 * Normalizes only equipment-owned fields and preserves unrelated progress keys.
 * This is also the save migration boundary for the independent equipment pool.
 */
export function normalizeTowerDefenseEquipmentProgress(source = {}) {
  const input = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const equipmentItems = sanitizeTowerDefenseEquipmentInventory(input.equipmentItems);
  const itemByUid = new Map(equipmentItems.map((item) => [item.uid, item]));
  const equipmentLoadouts = sanitizeLoadouts(input.equipmentLoadouts, itemByUid);
  return Object.freeze({
    ...input,
    metaCoins: nonNegativeInteger(input.metaCoins),
    equipmentEssence: nonNegativeInteger(input.equipmentEssence),
    equipmentBanner: bannerFrom(input.equipmentBanner),
    equipmentSerial: equipmentSerial(input.equipmentSerial, equipmentItems),
    equipmentItems,
    equipmentLoadouts,
  });
}

/**
 * Presents the UID-based inventory as definition stacks without changing the
 * persistence format. `availableCount` is the number of physical copies that
 * can still be equipped; unequipping a UID therefore returns it to the stack.
 */
export function summarizeTowerDefenseEquipmentInventory(source = {}) {
  const progress = normalizeTowerDefenseEquipmentProgress(source);
  const equippedUids = new Set(Object.values(progress.equipmentLoadouts).flatMap((loadout) => (
    TD_EQUIPMENT_SLOT_IDS.map((slotId) => loadout[slotId]).filter(Boolean)
  )));
  const stacks = new Map();

  for (const item of progress.equipmentItems) {
    let stack = stacks.get(item.definitionId);
    if (!stack) {
      stack = {
        totalCount: 0,
        equippedCount: 0,
        availableItemUids: [],
      };
      stacks.set(item.definitionId, stack);
    }
    stack.totalCount += 1;
    if (equippedUids.has(item.uid)) stack.equippedCount += 1;
    else stack.availableItemUids.push(item.uid);
  }

  return Object.freeze(TD_EQUIPMENT_CATALOG.flatMap((definition) => {
    const stack = stacks.get(definition.id);
    if (!stack) return [];
    return [Object.freeze({
      definitionId: definition.id,
      slot: definition.slot,
      rarity: definition.rarity,
      name: definition.name,
      iconKey: definition.iconKey,
      stats: definition.stats,
      totalCount: stack.totalCount,
      equippedCount: stack.equippedCount,
      availableCount: stack.totalCount - stack.equippedCount,
      availableItemUids: Object.freeze(stack.availableItemUids),
    })];
  }));
}

function mutableBanner(progress) {
  return {
    rngState: progress.equipmentBanner.rngState,
    srPity: progress.equipmentBanner.srPity,
    ssrPity: progress.equipmentBanner.ssrPity,
    urPity: progress.equipmentBanner.urPity,
  };
}

function seededStep(banner) {
  const previous = (Number(banner.rngState) >>> 0) || DEFAULT_EQUIPMENT_RNG_SEED;
  banner.rngState = (Math.imul(previous, 1664525) + 1013904223) >>> 0;
  return banner.rngState / 0x100000000;
}

function allowedRaritiesForBanner(banner) {
  if (banner.urPity >= 79) return { ids: ['UR'], guarantee: 'UR' };
  if (banner.ssrPity >= 29) return { ids: ['SSR', 'UR'], guarantee: 'SSR+' };
  if (banner.srPity >= 9) return { ids: ['SR', 'SSR', 'UR'], guarantee: 'SR+' };
  return { ids: TD_EQUIPMENT_RARITY_IDS, guarantee: null };
}

function weightedRarity(ids, roll) {
  const total = ids.reduce((sum, id) => sum + TD_EQUIPMENT_RARITIES[id].weight, 0);
  let cursor = roll * total;
  for (const id of ids) {
    cursor -= TD_EQUIPMENT_RARITIES[id].weight;
    if (cursor < 0) return id;
  }
  return ids.at(-1);
}

function advancePity(banner, rarityId) {
  const rank = TD_EQUIPMENT_RARITIES[rarityId].rank;
  banner.srPity = rank >= TD_EQUIPMENT_RARITIES.SR.rank
    ? 0 : Math.min(9, banner.srPity + 1);
  banner.ssrPity = rank >= TD_EQUIPMENT_RARITIES.SSR.rank
    ? 0 : Math.min(29, banner.ssrPity + 1);
  banner.urPity = rank >= TD_EQUIPMENT_RARITIES.UR.rank
    ? 0 : Math.min(79, banner.urPity + 1);
}

function nextAvailableUid(serial, usedUids) {
  let next = Math.max(1, nonNegativeInteger(serial, 1));
  while (usedUids.has(`gear-${next}`) && next < MAX_SAFE_AMOUNT) next += 1;
  if (usedUids.has(`gear-${next}`)) return null;
  return { uid: `gear-${next}`, nextSerial: Math.min(MAX_SAFE_AMOUNT, next + 1) };
}

/**
 * Draws 1..100 equipment pieces without touching hero-contract RNG or pity.
 * Every consecutive 10 draws contains SR+, 30 contains SSR+, and 80 contains UR.
 */
export function drawTowerDefenseEquipment(source, count = 1) {
  const drawCount = Number(count);
  if (!Number.isInteger(drawCount) || drawCount < 1 || drawCount > MAX_DRAW_COUNT) return null;

  const progress = normalizeTowerDefenseEquipmentProgress(source);
  const banner = mutableBanner(progress);
  const items = [...progress.equipmentItems];
  const usedUids = new Set(items.map(({ uid }) => uid));
  let serial = progress.equipmentSerial;
  const drawRecords = [];

  for (let index = 0; index < drawCount; index += 1) {
    const rarityRule = allowedRaritiesForBanner(banner);
    const rarityId = weightedRarity(rarityRule.ids, seededStep(banner));
    const slotIndex = Math.min(
      TD_EQUIPMENT_SLOT_IDS.length - 1,
      Math.floor(seededStep(banner) * TD_EQUIPMENT_SLOT_IDS.length),
    );
    const slotId = TD_EQUIPMENT_SLOT_IDS[slotIndex];
    const definition = TD_EQUIPMENT_BY_ID[`${slotId}-${rarityId.toLowerCase()}`];
    const allocated = nextAvailableUid(serial, usedUids);
    if (!allocated) return null;
    serial = allocated.nextSerial;
    usedUids.add(allocated.uid);
    const item = hydrateItem({ uid: allocated.uid, definitionId: definition.id, locked: false });
    items.push(item);
    drawRecords.push({ uid: item.uid, guarantee: rarityRule.guarantee });
    advancePity(banner, rarityId);
  }

  const nextProgress = normalizeTowerDefenseEquipmentProgress({
    ...progress,
    equipmentItems: items,
    equipmentSerial: serial,
    equipmentBanner: banner,
  });
  const nextByUid = new Map(nextProgress.equipmentItems.map((item) => [item.uid, item]));
  const results = Object.freeze(drawRecords.map(({ uid, guarantee }) => Object.freeze({
    item: nextByUid.get(uid),
    uid,
    definitionId: nextByUid.get(uid).definitionId,
    slot: nextByUid.get(uid).slot,
    rarity: nextByUid.get(uid).rarity,
    guarantee,
  })));
  return Object.freeze({
    progress: nextProgress,
    items: Object.freeze(results.map(({ item }) => item)),
    results,
  });
}

/**
 * Adds authored equipment rewards without advancing the summon banner or any
 * pity counter. Earned drops therefore cannot consume a paid-pool guarantee.
 */
export function grantTowerDefenseEquipment(source, definitionIds) {
  const requested = typeof definitionIds === 'string' ? [definitionIds] : definitionIds;
  if (!Array.isArray(requested) || requested.length < 1 || requested.length > MAX_DRAW_COUNT) {
    return null;
  }
  if (requested.some((definitionId) => !TD_EQUIPMENT_BY_ID[definitionId])) return null;

  const progress = normalizeTowerDefenseEquipmentProgress(source);
  const items = [...progress.equipmentItems];
  const usedUids = new Set(items.map(({ uid }) => uid));
  let serial = progress.equipmentSerial;
  const grantedUids = [];

  for (const definitionId of requested) {
    const allocated = nextAvailableUid(serial, usedUids);
    if (!allocated) return null;
    serial = allocated.nextSerial;
    usedUids.add(allocated.uid);
    const item = hydrateItem({ uid: allocated.uid, definitionId, locked: false });
    items.push(item);
    grantedUids.push(item.uid);
  }

  const nextProgress = normalizeTowerDefenseEquipmentProgress({
    ...progress,
    equipmentItems: items,
    equipmentSerial: serial,
    equipmentBanner: progress.equipmentBanner,
  });
  const nextByUid = new Map(nextProgress.equipmentItems.map((item) => [item.uid, item]));
  const grantedItems = Object.freeze(grantedUids.map((uid) => nextByUid.get(uid)));
  return Object.freeze({
    progress: nextProgress,
    items: grantedItems,
    results: Object.freeze(grantedItems.map((item) => Object.freeze({
      item,
      uid: item.uid,
      definitionId: item.definitionId,
      slot: item.slot,
      rarity: item.rarity,
      guarantee: null,
    }))),
  });
}

function cloneLoadouts(loadouts) {
  return Object.fromEntries(Object.entries(loadouts).map(([heroId, loadout]) => [
    heroId,
    { ...loadout },
  ]));
}

function equippedLocation(loadouts, itemUid) {
  for (const [heroId, loadout] of Object.entries(loadouts)) {
    for (const slotId of TD_EQUIPMENT_SLOT_IDS) {
      if (loadout[slotId] === itemUid) return { heroId, slot: slotId };
    }
  }
  return null;
}

/** Equips one physical item atomically; an occupied UID cannot be stolen. */
export function equipTowerDefenseItem(source, heroId, itemUid) {
  if (!validHeroId(heroId) || !validUid(itemUid)) return null;
  const progress = normalizeTowerDefenseEquipmentProgress(source);
  const item = progress.equipmentItems.find(({ uid }) => uid === itemUid);
  if (!item) return null;

  const loadouts = cloneLoadouts(progress.equipmentLoadouts);
  const previousLocation = equippedLocation(loadouts, itemUid);
  const target = loadouts[heroId] || blankLoadout();
  if (previousLocation
    && (previousLocation.heroId !== heroId || previousLocation.slot !== item.slot)) return null;
  if (target[item.slot] === itemUid) return null;
  const displacedItemUid = target[item.slot] === itemUid ? null : target[item.slot];

  if (!loadouts[heroId]) loadouts[heroId] = target;
  loadouts[heroId][item.slot] = itemUid;

  const nextProgress = normalizeTowerDefenseEquipmentProgress({
    ...progress,
    equipmentLoadouts: loadouts,
  });
  return Object.freeze({
    progress: nextProgress,
    heroId,
    slot: item.slot,
    itemUid,
    displacedItemUid: displacedItemUid || null,
    previousHeroId: null,
  });
}

export function unequipTowerDefenseItem(source, heroId, slotId) {
  if (!validHeroId(heroId) || !TD_EQUIPMENT_SLOT_IDS.includes(slotId)) return null;
  const progress = normalizeTowerDefenseEquipmentProgress(source);
  const itemUid = progress.equipmentLoadouts[heroId]?.[slotId];
  if (!itemUid) return null;
  const loadouts = cloneLoadouts(progress.equipmentLoadouts);
  loadouts[heroId][slotId] = null;
  const nextProgress = normalizeTowerDefenseEquipmentProgress({
    ...progress,
    equipmentLoadouts: loadouts,
  });
  return Object.freeze({ progress: nextProgress, heroId, slot: slotId, itemUid });
}

export function setTowerDefenseEquipmentLocked(source, itemUid, locked = true) {
  if (!validUid(itemUid)) return null;
  const progress = normalizeTowerDefenseEquipmentProgress(source);
  const itemIndex = progress.equipmentItems.findIndex(({ uid }) => uid === itemUid);
  if (itemIndex < 0) return null;
  const items = progress.equipmentItems.map((item, index) => (
    index === itemIndex ? { ...item, locked: locked !== false } : item
  ));
  return normalizeTowerDefenseEquipmentProgress({ ...progress, equipmentItems: items });
}

/** Returns summed basis-point bonuses for one hero (100 bp = 1%). */
export function aggregateTowerDefenseEquipmentStats(source, heroId) {
  const totals = Object.fromEntries(TD_EQUIPMENT_STAT_IDS.map((statId) => [statId, 0]));
  if (!validHeroId(heroId)) return Object.freeze(totals);
  const progress = normalizeTowerDefenseEquipmentProgress(source);
  const loadout = progress.equipmentLoadouts[heroId];
  if (!loadout) return Object.freeze(totals);
  const itemByUid = new Map(progress.equipmentItems.map((item) => [item.uid, item]));
  for (const slotId of TD_EQUIPMENT_SLOT_IDS) {
    const item = itemByUid.get(loadout[slotId]);
    if (!item) continue;
    for (const statId of TD_EQUIPMENT_STAT_IDS) totals[statId] += item.stats[statId];
  }
  return Object.freeze(totals);
}

/**
 * Atomically dismantles unequipped, unlocked items and deposits both rewards.
 * Any invalid, locked, equipped, or missing UID rejects the whole operation.
 */
export function salvageTowerDefenseEquipment(source, requestedItemUids) {
  const rawUids = typeof requestedItemUids === 'string'
    ? [requestedItemUids]
    : requestedItemUids;
  if (!Array.isArray(rawUids) || rawUids.length === 0 || rawUids.some((uid) => !validUid(uid))) {
    return null;
  }
  const itemUids = [...new Set(rawUids)];
  const progress = normalizeTowerDefenseEquipmentProgress(source);
  const itemByUid = new Map(progress.equipmentItems.map((item) => [item.uid, item]));
  const equippedUids = new Set(Object.values(progress.equipmentLoadouts).flatMap((loadout) => (
    TD_EQUIPMENT_SLOT_IDS.map((slotId) => loadout[slotId]).filter(Boolean)
  )));
  const items = itemUids.map((uid) => itemByUid.get(uid));
  if (items.some((item, index) => (
    !item || item.locked || equippedUids.has(itemUids[index])
  ))) return null;

  const rewards = items.reduce((total, item) => {
    const reward = TD_EQUIPMENT_RARITIES[item.rarity].salvage;
    total.metaCoins += reward.metaCoins;
    total.equipmentEssence += reward.equipmentEssence;
    return total;
  }, { metaCoins: 0, equipmentEssence: 0 });
  const removed = new Set(itemUids);
  const nextProgress = normalizeTowerDefenseEquipmentProgress({
    ...progress,
    metaCoins: Math.min(MAX_SAFE_AMOUNT, progress.metaCoins + rewards.metaCoins),
    equipmentEssence: Math.min(
      MAX_SAFE_AMOUNT,
      progress.equipmentEssence + rewards.equipmentEssence,
    ),
    equipmentItems: progress.equipmentItems.filter(({ uid }) => !removed.has(uid)),
  });
  const frozenRewards = Object.freeze({ ...rewards });
  return Object.freeze({
    progress: nextProgress,
    itemUids: Object.freeze(itemUids),
    items: Object.freeze(items),
    rewards: frozenRewards,
    coins: rewards.metaCoins,
    essence: rewards.equipmentEssence,
  });
}

// Compact aliases make the standalone module convenient outside the TD core.
export const normalizeEquipmentProgress = normalizeTowerDefenseEquipmentProgress;
export const drawEquipment = drawTowerDefenseEquipment;
export const equipItem = equipTowerDefenseItem;
export const unequipItem = unequipTowerDefenseItem;
export const aggregateEquipmentStats = aggregateTowerDefenseEquipmentStats;
export const salvageEquipment = salvageTowerDefenseEquipment;
