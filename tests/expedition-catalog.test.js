import test from 'node:test';
import assert from 'node:assert/strict';

import { ENEMY_BY_ID, SURVIVORS } from '../src/catalog.js';
import { TERRAIN_TYPES } from '../src/colony-catalog.js';
import {
  EXPEDITION_BY_ID,
  EXPEDITION_BOONS,
  EXPEDITION_CATALOG,
  EXPEDITION_ENCOUNTER_BY_ID,
  EXPEDITION_ENCOUNTERS,
  EXPEDITION_PARTY_RULES,
  EXPEDITION_RESOURCE_IDS,
  EXPEDITION_ROUTE_NODE_TYPE_BY_ID,
  EXPEDITION_ROUTE_NODE_TYPES,
  EXPEDITION_ROUTE_OPTION_BY_ID,
  EXPEDITION_ROUTE_OPTIONS,
  EXPEDITION_UPGRADE_BY_ID,
  EXPEDITION_UPGRADE_DRAFT,
  EXPEDITION_UPGRADES,
  FIRST_EXPEDITION,
} from '../src/expedition-catalog.js';

function assertDeepFrozen(value, path = 'catalog') {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true, `${path} must be frozen`);
  for (const [key, child] of Object.entries(value)) {
    assertDeepFrozen(child, `${path}.${key}`);
  }
}

function collectCombats(expedition) {
  const combats = expedition.stages.flatMap((stage) => (
    stage.encounter ? [stage.encounter] : []
  ));
  for (const option of EXPEDITION_ROUTE_OPTIONS) {
    if (option.encounter) combats.push(option.encounter);
    if (option.event?.ambush) combats.push(option.event.ambush);
  }
  return combats;
}

function assertReward(reward, label) {
  assert.ok(reward && typeof reward === 'object', `${label} lacks reward`);
  assert.ok(Number.isFinite(reward.softCrystals) && reward.softCrystals >= 0);
  for (const [resourceId, amount] of Object.entries(reward.resources)) {
    assert.ok(EXPEDITION_RESOURCE_IDS.includes(resourceId), `${label} uses ${resourceId}`);
    assert.ok(Number.isInteger(amount) && amount >= 0, `${label} has invalid ${resourceId}`);
  }
}

test('expedition catalog exports stable deeply immutable indexes', () => {
  assertDeepFrozen(EXPEDITION_CATALOG);
  assert.equal(EXPEDITION_BY_ID[FIRST_EXPEDITION.id], FIRST_EXPEDITION);
  assert.equal(EXPEDITION_ROUTE_NODE_TYPE_BY_ID['route-swarm-battle'].kind, 'combat');
  assert.equal(EXPEDITION_ROUTE_OPTION_BY_ID['route-1-forage'].forkId, 'fork-1');
  assert.equal(EXPEDITION_UPGRADE_BY_ID['upgrade-gel-burst'].rarity, 'advanced');
  assert.throws(() => {
    FIRST_EXPEDITION.duration.targetSeconds = 999;
  }, TypeError);
});

test('party is exactly three unique existing survivor IDs with one reserve choice', () => {
  const survivorIds = new Set(SURVIVORS.map(({ id }) => id));
  assert.equal(EXPEDITION_PARTY_RULES.size, 3);
  assert.equal(EXPEDITION_PARTY_RULES.defaultSlimeIds.length, 3);
  assert.equal(new Set(EXPEDITION_PARTY_RULES.defaultSlimeIds).size, 3);
  assert.equal(EXPEDITION_PARTY_RULES.availableSlimeIds.length, 4);
  for (const slimeId of EXPEDITION_PARTY_RULES.availableSlimeIds) {
    assert.equal(survivorIds.has(slimeId), true, `${slimeId} is not in SURVIVORS`);
  }
});

test('compact state-machine contract preserves route, encounters, boons, and rewards', () => {
  assert.deepEqual(FIRST_EXPEDITION.route, {
    regularSteps: 4,
    choicesPerStep: 3,
    bossStep: 5,
    nodeTypeIds: EXPEDITION_ROUTE_NODE_TYPES.map(({ id }) => id),
  });
  assert.equal(FIRST_EXPEDITION.encounters, EXPEDITION_ENCOUNTERS);
  assert.equal(FIRST_EXPEDITION.boons, EXPEDITION_BOONS);
  assert.equal(FIRST_EXPEDITION.rewards.defeatKeepRatio, 0.5);
  assert.equal(FIRST_EXPEDITION.rewards.abandonKeepRatio, 0.25);
  assertReward(FIRST_EXPEDITION.rewards.victoryBonus, 'victory bonus');

  for (const encounter of FIRST_EXPEDITION.encounters) {
    for (const field of ['id', 'kind', 'weight', 'minStep', 'maxStep', 'power', 'reward']) {
      assert.equal(field in encounter, true, `${encounter.id} lacks ${field}`);
    }
    assert.ok(['battle', 'elite', 'boss'].includes(encounter.kind));
    assert.equal(EXPEDITION_ENCOUNTER_BY_ID[encounter.id], encounter);
    assertReward(encounter.reward, encounter.id);
  }
  for (const boon of FIRST_EXPEDITION.boons) {
    assert.ok(boon.id in EXPEDITION_UPGRADE_BY_ID);
    assert.ok(boon.weight > 0);
    assert.ok(boon.modifiers && typeof boon.modifiers === 'object');
  }
});

test('route has four ordinary or event stages followed by one explicit boss', () => {
  const { stages } = FIRST_EXPEDITION;
  assert.equal(stages.length, 5);
  assert.deepEqual(stages.map(({ index }) => index), [1, 2, 3, 4, 5]);
  assert.ok(stages.slice(0, 4).every(({ kind }) => ['combat', 'route-choice'].includes(kind)));
  assert.equal(stages[4].kind, 'boss');
  assert.equal(stages[4].boss.enemyId, 'enemy-acid-shell-king');
  assert.equal(stages[4].boss.clearCondition, 'defeat-boss');
  assert.deepEqual(stages[4].boss.phaseThresholds, [0.66, 0.33]);

  const bossGroups = stages[4].encounter.groups.filter(({ isBoss }) => isBoss);
  assert.deepEqual(bossGroups, [{
    enemyId: 'enemy-acid-shell-king',
    count: 1,
    startDelaySeconds: 14,
    spawnIntervalSeconds: 0,
    isBoss: true,
  }]);
});

test('each fork offers exactly the three distinct readable route node types', () => {
  assert.equal(EXPEDITION_ROUTE_NODE_TYPES.length, 3);
  assert.deepEqual(
    new Set(EXPEDITION_ROUTE_NODE_TYPES.map(({ kind }) => kind)),
    new Set(['combat', 'resource', 'event']),
  );

  for (const stage of FIRST_EXPEDITION.stages.filter(({ kind }) => kind === 'route-choice')) {
    assert.equal(stage.optionIds.length, 3);
    const options = stage.optionIds.map((id) => EXPEDITION_ROUTE_OPTION_BY_ID[id]);
    assert.ok(options.every(Boolean));
    assert.deepEqual(
      new Set(options.map(({ nodeTypeId }) => nodeTypeId)),
      new Set(EXPEDITION_ROUTE_NODE_TYPES.map(({ id }) => id)),
    );
  }
});

test('all enemy references exist and encounters use numerous weakened monsters', () => {
  const combats = collectCombats(FIRST_EXPEDITION);
  assert.ok(combats.length >= 8);

  for (const encounter of combats) {
    const enemyCount = encounter.groups.reduce((sum, group) => sum + group.count, 0);
    assert.ok(enemyCount >= 9, `encounter only contains ${enemyCount} enemies`);
    assert.ok(encounter.tuning.enemyHpMultiplier <= 0.62);
    assert.ok(encounter.tuning.enemyDamageMultiplier <= 0.55);
    assert.ok(encounter.tuning.maxActiveEnemies >= 16);
    for (const group of encounter.groups) {
      assert.ok(ENEMY_BY_ID[group.enemyId], `${group.enemyId} is not in ENEMIES`);
      assert.ok(Number.isInteger(group.count) && group.count > 0);
    }
  }
});

test('every possible battle grants a three-choice one-pick upgrade draft', () => {
  assert.equal(EXPEDITION_UPGRADE_DRAFT.choices, 3);
  assert.equal(EXPEDITION_UPGRADE_DRAFT.picks, 1);
  assert.equal(EXPEDITION_UPGRADE_DRAFT.timing, 'after-combat-victory');
  assert.equal(EXPEDITION_UPGRADE_DRAFT.poolIds.length, EXPEDITION_UPGRADES.length);

  for (const upgradeId of EXPEDITION_UPGRADE_DRAFT.poolIds) {
    assert.ok(EXPEDITION_UPGRADE_BY_ID[upgradeId], upgradeId);
  }
  for (const encounter of collectCombats(FIRST_EXPEDITION)) {
    assert.equal(encounter.upgradeDraft.choices, 3);
    assert.equal(encounter.upgradeDraft.picks, 1);
    assert.equal(encounter.upgradeDraft.poolIds.length, EXPEDITION_UPGRADES.length);
  }
});

test('route timing targets a complete three-to-five-minute mobile run', () => {
  const { duration, stages } = FIRST_EXPEDITION;
  assert.ok(duration.minSeconds >= 180);
  assert.ok(duration.targetSeconds >= duration.minSeconds);
  assert.ok(duration.maxSeconds <= 300);
  assert.ok(duration.targetSeconds <= duration.maxSeconds);

  const fixedSeconds = stages
    .filter(({ kind }) => kind !== 'route-choice')
    .reduce((sum, stage) => sum + stage.encounter.estimatedDurationSeconds, 0);
  const forks = stages.filter(({ kind }) => kind === 'route-choice');
  const shortest = fixedSeconds + forks.reduce((sum, stage) => (
    sum + Math.min(...stage.optionIds.map((id) => EXPEDITION_ROUTE_OPTION_BY_ID[id].estimatedDurationSeconds))
  ), 0);
  const longest = fixedSeconds + forks.reduce((sum, stage) => (
    sum + Math.max(...stage.optionIds.map((id) => EXPEDITION_ROUTE_OPTION_BY_ID[id].estimatedDurationSeconds))
  ), 0);
  assert.ok(shortest >= duration.minSeconds, `${shortest}s is too short`);
  assert.ok(longest <= duration.maxSeconds, `${longest}s is too long`);
  assert.ok(duration.targetSeconds >= shortest && duration.targetSeconds <= longest + 30);
});

test('rewards reuse colony resource IDs and settle resources plus soft crystals', () => {
  assert.deepEqual(
    [...EXPEDITION_RESOURCE_IDS].sort(),
    Object.values(TERRAIN_TYPES)
      .filter(({ kind }) => kind === 'resource')
      .map(({ yield: output }) => output.resourceId)
      .sort(),
  );

  for (const stage of FIRST_EXPEDITION.stages.filter(({ reward }) => reward)) {
    assertReward(stage.reward, stage.id);
  }
  for (const option of EXPEDITION_ROUTE_OPTIONS) {
    assertReward(option.reward, option.id);
  }
  assertReward(FIRST_EXPEDITION.settlement.completionBonus, 'completion bonus');
  assertReward(FIRST_EXPEDITION.settlement.firstClearBonus, 'first-clear bonus');
  assert.equal(FIRST_EXPEDITION.settlement.delivery, 'after-run');
  assert.deepEqual(FIRST_EXPEDITION.settlement.retention.victory, {
    resourcesMultiplier: 1,
    softCrystalsMultiplier: 1,
  });
  assert.ok(FIRST_EXPEDITION.settlement.firstClearBonus.softCrystals > 0);
});
