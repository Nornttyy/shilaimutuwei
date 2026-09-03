import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TD_EQUIPMENT_BY_ID,
  TD_EQUIPMENT_CATALOG,
  TD_EQUIPMENT_RARITIES,
  TD_EQUIPMENT_RARITY_IDS,
  TD_EQUIPMENT_SLOT_IDS,
  TD_EQUIPMENT_SLOTS,
  TD_EQUIPMENT_STAT_IDS,
  aggregateTowerDefenseEquipmentStats,
  drawTowerDefenseEquipment,
  equipTowerDefenseItem,
  grantTowerDefenseEquipment,
  normalizeTowerDefenseEquipmentProgress,
  salvageTowerDefenseEquipment,
  sanitizeTowerDefenseEquipmentInventory,
  setTowerDefenseEquipmentLocked,
  summarizeTowerDefenseEquipmentInventory,
  unequipTowerDefenseItem,
} from '../src/tower-defense-equipment.js';

const rarityRank = (rarity) => TD_EQUIPMENT_RARITIES[rarity].rank;

const item = (uid, definitionId, extra = {}) => ({ uid, definitionId, ...extra });

test('catalog has twelve named definitions with unique formal icons and three stats', () => {
  assert.equal(TD_EQUIPMENT_CATALOG.length, 12);
  assert.deepEqual(TD_EQUIPMENT_SLOT_IDS, ['damage', 'speed', 'health']);
  assert.deepEqual(TD_EQUIPMENT_RARITY_IDS, ['R', 'SR', 'SSR', 'UR']);
  assert.deepEqual(
    TD_EQUIPMENT_SLOT_IDS.map((slotId) => TD_EQUIPMENT_SLOTS[slotId].iconKey),
    ['equipment-damage-charm', 'equipment-speed-charm', 'equipment-health-charm'],
  );
  assert.equal(new Set(TD_EQUIPMENT_CATALOG.map(({ name }) => name)).size, 12);
  assert.equal(new Set(TD_EQUIPMENT_CATALOG.map(({ iconKey }) => iconKey)).size, 12);
  assert.deepEqual(TD_EQUIPMENT_CATALOG.map(({ iconKey }) => iconKey), [
    'equipment-damage-charm',
    'equipment-flame-hammer-v1',
    'equipment-thunder-horn-v1',
    'equipment-star-core-blade-v1',
    'equipment-speed-charm',
    'equipment-wing-bell-v1',
    'equipment-lightning-gear-v1',
    'equipment-time-hourglass-v1',
    'equipment-health-charm',
    'equipment-coral-guard-v1',
    'equipment-crystal-crown-v1',
    'equipment-world-tree-heart-v1',
  ]);

  for (const slotId of TD_EQUIPMENT_SLOT_IDS) {
    const series = TD_EQUIPMENT_CATALOG.filter(({ slot }) => slot === slotId);
    assert.deepEqual(series.map(({ rarity }) => rarity), TD_EQUIPMENT_RARITY_IDS);
    for (const definition of series) {
      assert.deepEqual(Object.keys(definition.stats), TD_EQUIPMENT_STAT_IDS);
      assert.ok(Object.isFrozen(definition));
      assert.ok(Object.isFrozen(definition.stats));
    }
    for (let index = 1; index < series.length; index += 1) {
      for (const statId of TD_EQUIPMENT_STAT_IDS) {
        assert.ok(
          series[index].stats[statId] > series[index - 1].stats[statId],
          `${slotId} ${statId} must visibly improve at ${series[index].rarity}`,
        );
      }
    }
  }
  assert.ok(Object.isFrozen(TD_EQUIPMENT_CATALOG));
  assert.ok(Object.isFrozen(TD_EQUIPMENT_RARITIES.UR.salvage));
});

test('legacy definition IDs hydrate saved equipment into the authored catalog', () => {
  const legacyIds = [
    'damage-r', 'damage-sr', 'damage-ssr', 'damage-ur',
    'speed-r', 'speed-sr', 'speed-ssr', 'speed-ur',
    'health-r', 'health-sr', 'health-ssr', 'health-ur',
  ];
  const normalized = normalizeTowerDefenseEquipmentProgress({
    equipmentItems: legacyIds.map((definitionId, index) => (
      item(`legacy-${index + 1}`, definitionId, {
        name: 'old generated name',
        iconKey: 'old-shared-icon',
        stats: { damagePct: 999999 },
      })
    )),
  });

  assert.deepEqual(normalized.equipmentItems.map(({ definitionId }) => definitionId), legacyIds);
  assert.deepEqual(
    normalized.equipmentItems.map(({ iconKey }) => iconKey),
    legacyIds.map((definitionId) => TD_EQUIPMENT_BY_ID[definitionId].iconKey),
  );
  assert.deepEqual(
    normalized.equipmentItems.map(({ name }) => name),
    legacyIds.map((definitionId) => TD_EQUIPMENT_BY_ID[definitionId].name),
  );
  assert.ok(normalized.equipmentItems.every(({ stats, definitionId }) => (
    stats === TD_EQUIPMENT_BY_ID[definitionId].stats
  )));
});

test('inventory and progress normalization reject forged records and repair references', () => {
  const foreignProgress = { clearedStages: ['stage-1'] };
  const dirty = {
    ...foreignProgress,
    metaCoins: 91.9,
    equipmentEssence: -12,
    equipmentBanner: { rngState: 0, srPity: 500, ssrPity: -4, urPity: 800 },
    equipmentSerial: 2,
    equipmentItems: [
      item('gear-7', 'damage-r', {
        slot: 'health', rarity: 'UR', iconKey: 'forged',
        stats: { damagePct: 999999, attackSpeedPct: 999999, healthPct: 999999 },
      }),
      item('gear-7', 'speed-ur'),
      item('gear-3', 'speed-sr', { locked: true }),
      item('gear-9', 'health-ssr'),
      item('', 'damage-r'),
      item('gear-unknown', 'not-in-catalog'),
      null,
    ],
    equipmentLoadouts: {
      zeta: { damage: 'gear-7', speed: 'gear-3', health: 'gear-9' },
      alpha: { damage: 'gear-7', speed: 'gear-9', health: 'gear-9' },
      'bad hero id': { speed: 'gear-3' },
    },
  };

  const cleanedInventory = sanitizeTowerDefenseEquipmentInventory(dirty.equipmentItems);
  assert.deepEqual(cleanedInventory.map(({ uid }) => uid), ['gear-7', 'gear-3', 'gear-9']);
  const normalized = normalizeTowerDefenseEquipmentProgress(dirty);

  assert.deepEqual(normalized.clearedStages, ['stage-1'], 'unrelated progress survives migration');
  assert.equal(normalized.metaCoins, 91);
  assert.equal(normalized.equipmentEssence, 0);
  assert.deepEqual(
    { ...normalized.equipmentBanner, rngState: normalized.equipmentBanner.rngState > 0 },
    { rngState: true, srPity: 9, ssrPity: 0, urPity: 79 },
  );
  assert.equal(normalized.equipmentSerial, 10);
  assert.deepEqual(normalized.equipmentItems[0], {
    uid: 'gear-7',
    definitionId: 'damage-r',
    slot: 'damage',
    rarity: 'R',
    name: TD_EQUIPMENT_BY_ID['damage-r'].name,
    iconKey: 'equipment-damage-charm',
    stats: TD_EQUIPMENT_BY_ID['damage-r'].stats,
    locked: false,
  });
  assert.equal(normalized.equipmentItems[1].locked, true);
  assert.deepEqual(normalized.equipmentLoadouts.alpha, {
    damage: 'gear-7', speed: null, health: 'gear-9',
  });
  assert.deepEqual(normalized.equipmentLoadouts.zeta, {
    damage: null, speed: 'gear-3', health: null,
  });
  assert.ok(!('bad hero id' in normalized.equipmentLoadouts));
  assert.ok(Object.isFrozen(normalized));
  assert.ok(Object.isFrozen(normalized.equipmentBanner));
  assert.ok(Object.isFrozen(normalized.equipmentItems));
  assert.ok(Object.isFrozen(normalized.equipmentLoadouts.alpha));
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(normalized)));
});

test('equipment pool is deterministic, independent, immutable, and allocates unique IDs', () => {
  const source = {
    selectedHero: 'shell',
    summonRngState: 123,
    summonPity: 7,
    metaCoins: 5000,
    equipmentBanner: { rngState: 0xA11CE, srPity: 0, ssrPity: 0, urPity: 0 },
    equipmentSerial: 4,
    equipmentItems: [item('gear-9', 'health-r')],
  };
  const before = structuredClone(source);
  const left = drawTowerDefenseEquipment(source, 10);
  const right = drawTowerDefenseEquipment(source, 10);

  assert.deepEqual(left, right);
  assert.deepEqual(source, before, 'draw never mutates the caller save');
  assert.equal(left.items.length, 10);
  assert.equal(new Set(left.items.map(({ uid }) => uid)).size, 10);
  assert.ok(left.items.every(({ uid }) => uid !== 'gear-9'));
  assert.ok(left.items.some(({ rarity }) => rarityRank(rarity) >= rarityRank('SR')));
  assert.equal(left.progress.metaCoins, 5000, 'the standalone pool does not charge currency');
  assert.equal(left.progress.summonRngState, 123, 'hero-contract RNG stays independent');
  assert.equal(left.progress.summonPity, 7, 'hero-contract pity stays independent');
  assert.ok(Object.isFrozen(left));
  assert.ok(Object.isFrozen(left.results));
  assert.equal(drawTowerDefenseEquipment(source, 0), null);
  assert.equal(drawTowerDefenseEquipment(source, 101), null);
  assert.equal(drawTowerDefenseEquipment(source, 1.5), null);
});

test('hard pity guarantees SR+ at 10, SSR+ at 30, and UR at 80', () => {
  const sr = drawTowerDefenseEquipment({
    equipmentBanner: { rngState: 1, srPity: 9, ssrPity: 0, urPity: 0 },
  });
  assert.ok(rarityRank(sr.items[0].rarity) >= rarityRank('SR'));
  assert.equal(sr.results[0].guarantee, 'SR+');
  assert.equal(sr.progress.equipmentBanner.srPity, 0);

  const ssr = drawTowerDefenseEquipment({
    equipmentBanner: { rngState: 2, srPity: 0, ssrPity: 29, urPity: 0 },
  });
  assert.ok(rarityRank(ssr.items[0].rarity) >= rarityRank('SSR'));
  assert.equal(ssr.results[0].guarantee, 'SSR+');
  assert.equal(ssr.progress.equipmentBanner.ssrPity, 0);

  const ur = drawTowerDefenseEquipment({
    equipmentBanner: { rngState: 3, srPity: 0, ssrPity: 0, urPity: 79 },
  });
  assert.equal(ur.items[0].rarity, 'UR');
  assert.equal(ur.results[0].guarantee, 'UR');
  assert.deepEqual(
    { ...ur.progress.equipmentBanner, rngState: undefined },
    { rngState: undefined, srPity: 0, ssrPity: 0, urPity: 0 },
  );

  const ten = drawTowerDefenseEquipment({ equipmentBanner: { rngState: 101 } }, 10);
  const thirty = drawTowerDefenseEquipment({ equipmentBanner: { rngState: 202 } }, 30);
  const eighty = drawTowerDefenseEquipment({ equipmentBanner: { rngState: 303 } }, 80);
  assert.ok(ten.items.some(({ rarity }) => rarityRank(rarity) >= rarityRank('SR')));
  assert.ok(thirty.items.some(({ rarity }) => rarityRank(rarity) >= rarityRank('SSR')));
  assert.ok(eighty.items.some(({ rarity }) => rarity === 'UR'));
});

test('earned equipment grants preserve every independent summon pity counter', () => {
  const source = {
    equipmentBanner: { rngState: 0xBEE5, srPity: 9, ssrPity: 29, urPity: 79 },
    equipmentSerial: 2,
    equipmentItems: [item('gear-1', 'speed-r')],
  };
  const snapshot = structuredClone(source);
  const granted = grantTowerDefenseEquipment(source, ['damage-r', 'health-ur']);

  assert.deepEqual(source, snapshot, 'reward grant never mutates its source');
  assert.deepEqual(granted.progress.equipmentBanner,
    normalizeTowerDefenseEquipmentProgress(source).equipmentBanner);
  assert.deepEqual(granted.items.map(({ definitionId }) => definitionId), ['damage-r', 'health-ur']);
  assert.deepEqual(granted.items.map(({ uid }) => uid), ['gear-2', 'gear-3']);
  assert.equal(grantTowerDefenseEquipment(source, ['unknown']), null);
  assert.equal(grantTowerDefenseEquipment(source, []), null);
});

test('equipment summaries stack matching copies and track available inventory', () => {
  const source = {
    equipmentItems: [
      item('gear-4', 'speed-sr'),
      item('gear-1', 'damage-r'),
      item('gear-2', 'damage-r'),
      item('gear-3', 'damage-r'),
    ],
    equipmentLoadouts: {
      shell: { damage: 'gear-1' },
      sprout: { damage: 'gear-2' },
    },
  };
  const summary = summarizeTowerDefenseEquipmentInventory(source);
  const damage = summary.find(({ definitionId }) => definitionId === 'damage-r');
  const speed = summary.find(({ definitionId }) => definitionId === 'speed-sr');

  assert.equal(summary.length, 2);
  assert.deepEqual(summary.map(({ definitionId }) => definitionId), ['damage-r', 'speed-sr'],
    'non-empty stacks follow catalog order rather than save order');
  assert.deepEqual(
    {
      totalCount: damage.totalCount,
      equippedCount: damage.equippedCount,
      availableCount: damage.availableCount,
    },
    { totalCount: 3, equippedCount: 2, availableCount: 1 },
  );
  assert.deepEqual(damage.availableItemUids, ['gear-3']);
  assert.deepEqual(
    {
      totalCount: speed.totalCount,
      equippedCount: speed.equippedCount,
      availableCount: speed.availableCount,
    },
    { totalCount: 1, equippedCount: 0, availableCount: 1 },
  );
  assert.deepEqual(speed.availableItemUids, ['gear-4']);
  assert.ok(Object.isFrozen(summary));
  assert.ok(Object.isFrozen(damage));
  assert.ok(Object.isFrozen(damage.availableItemUids));
});

test('equip consumes a free UID, never steals one, and unequip returns it to the stack', () => {
  const source = normalizeTowerDefenseEquipmentProgress({
    equipmentItems: [
      item('gear-1', 'damage-r'),
      item('gear-2', 'speed-sr'),
      item('gear-3', 'health-ssr'),
      item('gear-4', 'damage-sr'),
      item('gear-5', 'damage-r'),
    ],
  });
  const snapshot = JSON.stringify(source);
  const first = equipTowerDefenseItem(source, 'shell', 'gear-1');
  const target = equipTowerDefenseItem(first.progress, 'sprout', 'gear-4');
  const beforeRejectedSteal = JSON.stringify(target.progress);
  assert.equal(equipTowerDefenseItem(target.progress, 'sprout', 'gear-1'), null);
  assert.equal(JSON.stringify(target.progress), beforeRejectedSteal,
    'an occupied physical copy cannot be moved away from its wearer');
  const equipped = equipTowerDefenseItem(target.progress, 'sprout', 'gear-5');

  assert.equal(equipped.previousHeroId, null);
  assert.equal(equipped.displacedItemUid, 'gear-4');
  assert.equal(equipped.progress.equipmentLoadouts.shell.damage, 'gear-1');
  assert.equal(equipped.progress.equipmentLoadouts.sprout.damage, 'gear-5');
  const fullyUsed = summarizeTowerDefenseEquipmentInventory(equipped.progress);
  assert.deepEqual(
    fullyUsed.find(({ definitionId }) => definitionId === 'damage-r'),
    {
      definitionId: 'damage-r',
      slot: 'damage',
      rarity: 'R',
      name: TD_EQUIPMENT_BY_ID['damage-r'].name,
      iconKey: 'equipment-damage-charm',
      stats: TD_EQUIPMENT_BY_ID['damage-r'].stats,
      totalCount: 2,
      equippedCount: 2,
      availableCount: 0,
      availableItemUids: [],
    },
  );
  assert.equal(equipTowerDefenseItem(equipped.progress, 'shell', 'gear-1'), null,
    'equipping the already selected copy is a no-op');
  const removed = unequipTowerDefenseItem(equipped.progress, 'sprout', 'damage');
  assert.equal(removed.itemUid, 'gear-5');
  assert.equal(removed.progress.equipmentLoadouts.sprout.damage, null);
  const returned = summarizeTowerDefenseEquipmentInventory(removed.progress)
    .find(({ definitionId }) => definitionId === 'damage-r');
  assert.equal(returned.availableCount, 1);
  assert.deepEqual(returned.availableItemUids, ['gear-5']);
  assert.equal(unequipTowerDefenseItem(removed.progress, 'sprout', 'damage'), null);
  assert.equal(equipTowerDefenseItem(source, 'shell', 'missing'), null);
  assert.equal(equipTowerDefenseItem(source, 'bad hero id', 'gear-1'), null);
  assert.equal(JSON.stringify(source), snapshot, 'equipment commands do not mutate their input');
});

test('aggregation sums exactly three equipped slots in basis points', () => {
  const source = {
    equipmentItems: [
      item('gear-1', 'damage-ur'),
      item('gear-2', 'speed-ssr'),
      item('gear-3', 'health-sr'),
      item('gear-4', 'health-ur'),
    ],
    equipmentLoadouts: {
      shell: { damage: 'gear-1', speed: 'gear-2', health: 'gear-3' },
      sprout: { health: 'gear-4' },
    },
  };
  const expected = Object.fromEntries(TD_EQUIPMENT_STAT_IDS.map((statId) => [
    statId,
    TD_EQUIPMENT_BY_ID['damage-ur'].stats[statId]
      + TD_EQUIPMENT_BY_ID['speed-ssr'].stats[statId]
      + TD_EQUIPMENT_BY_ID['health-sr'].stats[statId],
  ]));
  assert.deepEqual(aggregateTowerDefenseEquipmentStats(source, 'shell'), expected);
  assert.deepEqual(
    aggregateTowerDefenseEquipmentStats(source, 'unknown'),
    { damagePct: 0, attackSpeedPct: 0, healthPct: 0 },
  );
  assert.ok(Object.isFrozen(aggregateTowerDefenseEquipmentStats(source, 'shell')));
});

test('locking and salvage are immutable and salvage rejects unsafe batches atomically', () => {
  const base = normalizeTowerDefenseEquipmentProgress({
    metaCoins: 40,
    equipmentEssence: 2,
    equipmentItems: [
      item('gear-1', 'damage-r'),
      item('gear-2', 'speed-sr', { locked: true }),
      item('gear-3', 'damage-ssr'),
      item('gear-4', 'speed-ur'),
    ],
    equipmentLoadouts: { shell: { damage: 'gear-1' } },
  });
  const snapshot = JSON.stringify(base);

  assert.equal(salvageTowerDefenseEquipment(base, ['missing']), null);
  assert.equal(salvageTowerDefenseEquipment(base, ['gear-1']), null, 'equipped item is protected');
  assert.equal(salvageTowerDefenseEquipment(base, ['gear-2']), null, 'locked item is protected');
  assert.equal(salvageTowerDefenseEquipment(base, ['gear-3', 'missing']), null);
  assert.equal(JSON.stringify(base), snapshot);

  const result = salvageTowerDefenseEquipment(base, ['gear-3', 'gear-4', 'gear-3']);
  assert.deepEqual(result.itemUids, ['gear-3', 'gear-4']);
  assert.deepEqual(result.rewards, { metaCoins: 3100, equipmentEssence: 42 });
  assert.equal(result.coins, 3100);
  assert.equal(result.essence, 42);
  assert.equal(result.progress.metaCoins, 3140);
  assert.equal(result.progress.equipmentEssence, 44);
  assert.deepEqual(result.progress.equipmentItems.map(({ uid }) => uid), ['gear-1', 'gear-2']);

  const unlocked = setTowerDefenseEquipmentLocked(base, 'gear-2', false);
  assert.equal(unlocked.equipmentItems.find(({ uid }) => uid === 'gear-2').locked, false);
  assert.equal(base.equipmentItems.find(({ uid }) => uid === 'gear-2').locked, true);
  assert.equal(setTowerDefenseEquipmentLocked(base, 'missing'), null);
});
