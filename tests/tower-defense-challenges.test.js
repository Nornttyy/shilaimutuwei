import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TD_DIFFICULTIES,
  applyTowerDefenseDifficulty,
  dailyChallengeForDay,
  dailyMetaReward,
  endlessMetaReward,
  normalizeTowerDefenseDifficulty,
  storyMetaReward,
} from '../src/tower-defense-challenges.js';

test('difficulty normalization is strict and hard mode raises pressure and rewards', () => {
  assert.equal(normalizeTowerDefenseDifficulty('hard'), 'hard');
  assert.equal(normalizeTowerDefenseDifficulty('normal'), 'simple');
  assert.deepEqual(Object.keys(TD_DIFFICULTIES), ['simple', 'hard']);
  const simple = applyTowerDefenseDifficulty({ hp: 2, speed: 1.2, reward: 1.4 }, 'simple');
  const hard = applyTowerDefenseDifficulty({ hp: 2, speed: 1.2, reward: 1.4 }, 'hard');
  assert.ok(hard.hp > simple.hp);
  assert.ok(hard.speed > simple.speed);
  assert.ok(hard.attack > simple.attack);
  assert.ok(hard.reward > simple.reward);
  const simpleReward = storyMetaReward(10, 'simple', true);
  const hardReward = storyMetaReward(10, 'hard', true);
  assert.ok(hardReward.metaCoins > simpleReward.metaCoins);
  assert.ok(hardReward.summonCurrency > simpleReward.summonCurrency);
  assert.ok(hardReward.equipmentChance > simpleReward.equipmentChance);
  assert.equal(simpleReward.equipmentRolls, 2);
  assert.equal(simpleReward.guaranteedEquipment, 1);
});

test('story first-clear, endless milestones, and daily rewards are bounded', () => {
  assert.ok(storyMetaReward(8, 'simple', true).metaCoins
    > storyMetaReward(8, 'simple', false).metaCoins);
  assert.equal(endlessMetaReward(4).equipmentRolls, 0);
  assert.equal(endlessMetaReward(5).equipmentRolls, 1);
  assert.equal(endlessMetaReward(5).guaranteedEquipment, 1);
  assert.equal(endlessMetaReward(99).equipmentRolls, 3);
  assert.equal(endlessMetaReward(99_999).metaCoins, 5000);
  assert.equal(endlessMetaReward(99_999).summonCurrency, 600);
  const challenge = dailyChallengeForDay('2026-09-03', 20);
  assert.ok(challenge.stageIndex >= 1 && challenge.stageIndex <= 20);
  assert.equal(challenge.difficulty, 'hard');
  assert.deepEqual(challenge, dailyChallengeForDay('2026-09-03', 20));
  assert.notDeepEqual(challenge, dailyChallengeForDay('2026-09-04', 20));
  assert.ok(dailyMetaReward(challenge, false).metaCoins > 0);
  assert.deepEqual(dailyMetaReward(challenge, true), {
    metaCoins: 0, summonCurrency: 0, equipmentRolls: 0,
    guaranteedEquipment: 0, equipmentChance: 0,
  });
});
