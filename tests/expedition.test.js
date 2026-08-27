import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_EXPEDITION_CATALOG,
  EXPEDITION_MAX_SQUAD_SIZE,
  abandonExpedition,
  chooseExpeditionBoon,
  chooseExpeditionRoute,
  claimExpeditionRewards,
  createExpeditionState,
  resolveExpeditionBattle,
  restoreExpeditionState,
  selectExpeditionSquad,
  serializeExpeditionState,
  startExpedition,
} from '../src/expedition.js';
import { EXPEDITION_CATALOG, FIRST_EXPEDITION } from '../src/expedition-catalog.js';

const roster = [
  { id: 'shell', level: 3 },
  { id: 'bubble', level: 2 },
  { id: 'sprout', level: 2 },
  { id: 'crystal', level: 1 },
];

const shortCatalog = {
  id: 'test-expedition-v1',
  route: { regularSteps: 1, choicesPerStep: 3, boonChoices: 3, powerGrowthPerStep: 0.2 },
  encounters: [
    { id: 'left', kind: 'battle', weight: 1, power: 10, reward: { gel: 10 } },
    { id: 'middle', kind: 'battle', weight: 1, power: 11, reward: { nectar: 6 } },
    { id: 'right', kind: 'elite', weight: 1, power: 15, reward: { shard: 4 } },
    { id: 'boss', kind: 'boss', weight: 1, power: 30, reward: { gel: 20, shard: 5 } },
  ],
  boons: [
    { id: 'attack', modifiers: { attackMultiplier: 1.2 } },
    { id: 'health', modifiers: { maxHpMultiplier: 1.2 } },
    { id: 'speed', modifiers: { attackSpeedMultiplier: 1.2 } },
  ],
  rewards: {
    victoryBonus: { nectar: 9 },
    completionMultiplier: 1,
    defeatKeepRatio: 0.5,
    abandonKeepRatio: 0.25,
  },
};

function createStarted(seed = 123, catalog = shortCatalog) {
  const state = createExpeditionState({ seed, roster, squad: ['shell', 'bubble', 'sprout'] }, catalog);
  startExpedition(state, catalog);
  return state;
}

test('selects one to three unique roster slimes before starting', () => {
  const state = createExpeditionState({ seed: 1, roster });
  assert.equal(EXPEDITION_MAX_SQUAD_SIZE, 3);
  assert.deepEqual(selectExpeditionSquad(state, ['shell']), ['shell']);
  assert.deepEqual(selectExpeditionSquad(state, ['shell', 'bubble', 'sprout']), ['shell', 'bubble', 'sprout']);
  assert.throws(() => selectExpeditionSquad(state, ['shell', 'bubble', 'sprout', 'crystal']), /cannot exceed 3/);
  assert.throws(() => selectExpeditionSquad(state, ['shell', 'shell']), /duplicate/);
  assert.throws(() => selectExpeditionSquad(state, ['missing']), /not in the expedition roster/);

  const empty = createExpeditionState({ roster });
  assert.throws(() => startExpedition(empty), /at least one slime/);
  assert.equal(state.status, 'draft');
  startExpedition(state);
  assert.equal(state.status, 'active');
  assert.equal(state.phase, 'route-selection');
  assert.throws(() => selectExpeditionSquad(state, ['crystal']), /phase must be squad-selection/);
});

test('same catalog and seed generate the same route choices', () => {
  const left = createStarted('repeatable-seed');
  const right = createStarted('repeatable-seed');
  assert.deepEqual(left.route.choices, right.route.choices);
  assert.equal(left.route.choices.length, 3);
  assert.deepEqual(new Set(left.route.choices.map(({ templateId }) => templateId)).size, 3);
});

test('choosing a route node creates an external-battle-friendly encounter', () => {
  const state = createStarted();
  const selected = state.route.choices[1];
  const encounter = chooseExpeditionRoute(state, selected.uid, shortCatalog);
  assert.equal(state.phase, 'encounter');
  assert.equal(encounter.templateId, selected.templateId);
  assert.equal(encounter.power, selected.power);
  assert.deepEqual(encounter.reward, selected.reward);
  assert.equal(state.route.choices.length, 0);
  assert.equal(state.route.history[0].outcome, 'active');
  assert.throws(() => chooseExpeditionRoute(state, 'missing', shortCatalog), /phase must be route-selection/);
});

test('a regular victory offers exactly three boons and the chosen boon advances the route', () => {
  const state = createStarted();
  const node = state.route.choices[0];
  chooseExpeditionRoute(state, node.uid, shortCatalog);
  const choices = resolveExpeditionBattle(state, { won: true, bonusReward: { gel: 2 } }, shortCatalog);
  assert.equal(state.phase, 'boon-selection');
  assert.equal(choices.length, 3);
  assert.equal(state.route.regularWins, 1);
  assert.equal(state.route.history[0].outcome, 'victory');
  assert.equal(state.runLoot.gel || 0, (node.reward.gel || 0) + 2);

  const selectedBoon = choices[0];
  const owned = chooseExpeditionBoon(state, selectedBoon.id, shortCatalog);
  assert.equal(owned.id, selectedBoon.id);
  assert.equal(owned.stacks, 1);
  assert.equal(state.phase, 'route-selection');
  assert.equal(state.route.isBossStage, true);
  assert.equal(state.route.choices.length, 1);
  assert.equal(state.route.choices[0].isFinalBoss, true);
});

test('final boss victory completes the run, settles rewards, and allows one claim', () => {
  const state = createStarted(7);
  chooseExpeditionRoute(state, state.route.choices[0].uid, shortCatalog);
  resolveExpeditionBattle(state, 'victory', shortCatalog);
  chooseExpeditionBoon(state, state.boonChoices[0].id, shortCatalog);
  const bossReward = { ...state.route.choices[0].reward };
  chooseExpeditionRoute(state, state.route.choices[0].uid, shortCatalog);
  const settlement = resolveExpeditionBattle(state, 'victory', shortCatalog);

  assert.equal(state.status, 'completed');
  assert.equal(state.phase, 'settlement');
  assert.equal(settlement.bossDefeated, true);
  assert.equal(settlement.rewards.nectar, (state.runLoot.nectar || 0) + 9);
  assert.ok(settlement.rewards.gel >= (bossReward.gel || 0));
  assert.deepEqual(claimExpeditionRewards(state), settlement.rewards);
  assert.equal(state.settlement.claimed, true);
  assert.throws(() => claimExpeditionRewards(state), /already been claimed/);
});

test('defeat keeps the configured share of earned loot', () => {
  const state = createStarted(11);
  state.runLoot = { gel: 9, nectar: 5 };
  chooseExpeditionRoute(state, state.route.choices[0].uid, shortCatalog);
  const settlement = resolveExpeditionBattle(state, { outcome: 'defeat' }, shortCatalog);
  assert.equal(state.status, 'failed');
  assert.deepEqual(settlement.rewards, { gel: 4, nectar: 2 });
  assert.equal(state.stats.encountersLost, 1);
});

test('abandonment settles a smaller share and locks further play', () => {
  const state = createStarted(19);
  state.runLoot = { gel: 12, shard: 7 };
  const settlement = abandonExpedition(state, shortCatalog);
  assert.equal(state.status, 'abandoned');
  assert.deepEqual(settlement.rewards, { gel: 3, shard: 1 });
  assert.throws(() => abandonExpedition(state, shortCatalog), /already settled/);
  assert.throws(() => chooseExpeditionRoute(state, 'anything', shortCatalog), /phase must be route-selection/);
});

test('JSON restoration preserves deterministic future route generation', () => {
  const original = createStarted('save-seed');
  const selectedUid = original.route.choices[0].uid;
  chooseExpeditionRoute(original, selectedUid, shortCatalog);
  resolveExpeditionBattle(original, 'victory', shortCatalog);
  const snapshot = serializeExpeditionState(original);
  assert.doesNotMatch(snapshot, /function|Map|Set/);
  const restored = restoreExpeditionState(snapshot, shortCatalog);
  assert.deepEqual(restored, original);

  const boonId = original.boonChoices[0].id;
  chooseExpeditionBoon(original, boonId, shortCatalog);
  chooseExpeditionBoon(restored, boonId, shortCatalog);
  assert.deepEqual(restored.route.choices, original.route.choices);
  assert.equal(serializeExpeditionState(restored), serializeExpeditionState(original));
});

test('custom catalogs are injected and mismatched catalogs are rejected', () => {
  const state = createStarted(31, shortCatalog);
  assert.equal(state.catalogId, shortCatalog.id);
  assert.throws(() => chooseExpeditionRoute(state, state.route.choices[0].uid, DEFAULT_EXPEDITION_CATALOG), /catalog mismatch/);
  assert.throws(() => restoreExpeditionState(state, DEFAULT_EXPEDITION_CATALOG), /catalog mismatch/);
});

test('accepts the shared catalog root and flattens its settlement reward format', () => {
  const state = createExpeditionState({
    seed: 37,
    expeditionId: FIRST_EXPEDITION.id,
    roster: FIRST_EXPEDITION.party.availableSlimeIds,
    squad: FIRST_EXPEDITION.party.defaultSlimeIds,
  }, EXPEDITION_CATALOG);
  startExpedition(state, EXPEDITION_CATALOG);
  assert.equal(state.catalogId, FIRST_EXPEDITION.id);
  assert.equal(state.route.choices.length, 3);
  assert.deepEqual(
    new Set(state.route.choices.map(({ nodeTypeId }) => nodeTypeId)),
    new Set(FIRST_EXPEDITION.route.nodeTypeIds),
  );
  chooseExpeditionRoute(state, state.route.choices[0].uid, EXPEDITION_CATALOG);
  assert.ok(state.currentEncounter.groups.length > 0);
  resolveExpeditionBattle(state, 'victory', EXPEDITION_CATALOG);
  assert.ok(Object.keys(state.runLoot).some((id) => ['soft-gel', 'dew-honey', 'crystal-shard', 'softCrystals'].includes(id)));
});

test('state is composed entirely of save-friendly JSON values', () => {
  const state = createStarted(41);
  const roundTrip = JSON.parse(JSON.stringify(state));
  assert.deepEqual(roundTrip, state);
  assert.equal(typeof state.rngState, 'number');
  assert.equal(typeof state.route.choices[0].uid, 'string');
});
