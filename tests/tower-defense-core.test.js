import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TD_HAND_LIMIT,
  TD_MAX_STAR,
  TD_STAGES,
  beginTowerDefenseRun,
  canMergeTowers,
  createTowerDefenseState,
  drawCostForState,
  drawTowerCard,
  endlessScaleForWave,
  mergeTowers,
  normalizeTowerDefenseProgress,
  placeTowerFromHand,
  serializeTowerDefenseProgress,
  startNextTowerDefenseWave,
  tutorialTargetForState,
  updateTowerDefense,
} from '../src/tower-defense-core.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function createBattleState({ tutorialSeen = true, mode = 'stage', stageId = 'stage-1' } = {}) {
  const state = createTowerDefenseState({
    progress: { tutorialSeen },
    seed: 0x12345678,
  });
  assert.equal(beginTowerDefenseRun(state, { mode, stageId }), true);
  return state;
}

test('failed draws are atomic and a successful draw spends exactly its quoted cost', () => {
  const menuState = createTowerDefenseState({ progress: { tutorialSeen: true } });
  const menuSnapshot = clone(menuState);
  assert.equal(drawTowerCard(menuState), null);
  assert.deepEqual(menuState, menuSnapshot, 'drawing outside battle must not mutate state');

  const state = createBattleState();
  state.currency = drawCostForState(state) - 1;
  const poorSnapshot = clone(state);
  assert.equal(drawTowerCard(state), null);
  assert.deepEqual(state, poorSnapshot, 'an unaffordable draw must not spend RNG, ids, or currency');

  state.currency = 999;
  state.hand = Array.from({ length: TD_HAND_LIMIT }, (_, index) => ({
    uid: `full-${index}`,
    type: 'shell',
    star: 1,
  }));
  const fullSnapshot = clone(state);
  assert.equal(drawTowerCard(state), null);
  assert.deepEqual(state, fullSnapshot, 'a full hand must reject the draw without side effects');

  state.hand = [];
  const cost = drawCostForState(state);
  const currencyBefore = state.currency;
  const drawCountBefore = state.drawCount;
  const card = drawTowerCard(state);
  assert.ok(card);
  assert.equal(state.currency, currencyBefore - cost);
  assert.equal(state.drawCount, drawCountBefore + 1);
  assert.deepEqual(state.hand, [card]);
  assert.equal(state.events.at(-1).type, 'draw');
});

test('the first two tutorial draws are fixed shells and do not consume random state', () => {
  const state = createTowerDefenseState({ seed: 0xDEADBEEF });
  assert.equal(beginTowerDefenseRun(state, { stageId: 'stage-1' }), true);
  const initialRngState = state.rngState;

  const first = drawTowerCard(state);
  assert.equal(first.type, 'shell');
  assert.equal(state.tutorial.forcedDraws, 1);
  assert.equal(state.rngState, initialRngState);
  const firstTower = placeTowerFromHand(state, first.uid, 0);
  assert.ok(firstTower);

  const second = drawTowerCard(state);
  assert.equal(second.type, 'shell');
  assert.equal(state.tutorial.forcedDraws, 2);
  assert.equal(state.rngState, initialRngState);
});

test('placement is atomic and fusion requires distinct towers of the same type and star', () => {
  const state = createBattleState();
  state.hand = [
    { uid: 'card-shell-a', type: 'shell', star: 1 },
    { uid: 'card-shell-b', type: 'shell', star: 1 },
    { uid: 'card-bubble', type: 'bubble', star: 1 },
    { uid: 'card-shell-two', type: 'shell', star: 2 },
  ];

  const shellA = placeTowerFromHand(state, 'card-shell-a', 0);
  assert.ok(shellA);
  const occupiedSnapshot = clone(state);
  assert.equal(placeTowerFromHand(state, 'card-shell-b', 0), null);
  assert.deepEqual(state, occupiedSnapshot, 'placing onto an occupied pad must not consume the card');

  const shellB = placeTowerFromHand(state, 'card-shell-b', 1);
  const bubble = placeTowerFromHand(state, 'card-bubble', 2);
  const shellTwo = placeTowerFromHand(state, 'card-shell-two', 3);
  assert.ok(shellB && bubble && shellTwo);
  assert.equal(state.hand.length, 0);

  assert.equal(canMergeTowers(shellA, shellA), false, 'a tower cannot merge into itself');
  assert.equal(canMergeTowers(shellA, bubble), false, 'different types cannot merge');
  assert.equal(canMergeTowers(shellA, shellTwo), false, 'different stars cannot merge');
  assert.equal(canMergeTowers(shellA, shellB), true);

  const invalidMergeSnapshot = clone(state);
  assert.equal(mergeTowers(state, shellA.uid, bubble.uid), null);
  assert.deepEqual(state, invalidMergeSnapshot, 'a rejected fusion must leave both towers untouched');

  const merged = mergeTowers(state, shellA.uid, shellB.uid);
  assert.equal(merged.uid, shellB.uid);
  assert.equal(merged.star, 2);
  assert.equal(merged.padIndex, 1);
  assert.equal(state.towers.some(({ uid }) => uid === shellA.uid), false);
  assert.equal(state.events.at(-1).type, 'merge');
});

test('fusion reaches the declared maximum star and rejects further merging atomically', () => {
  const state = createBattleState();
  state.towers = [
    { uid: 'star-three-a', type: 'needle', star: TD_MAX_STAR - 1, padIndex: 0, cooldown: 1 },
    { uid: 'star-three-b', type: 'needle', star: TD_MAX_STAR - 1, padIndex: 1, cooldown: 1 },
  ];

  const maximum = mergeTowers(state, 'star-three-a', 'star-three-b');
  assert.equal(maximum.star, TD_MAX_STAR);
  state.towers.push({
    uid: 'star-four-peer',
    type: 'needle',
    star: TD_MAX_STAR,
    padIndex: 2,
    cooldown: 1,
  });

  assert.equal(canMergeTowers(maximum, state.towers.at(-1)), false);
  const snapshot = clone(state);
  assert.equal(mergeTowers(state, maximum.uid, 'star-four-peer'), null);
  assert.deepEqual(state, snapshot);
  assert.equal(TD_MAX_STAR, 4);
});

test('stage waves use authored groups while endless waves grow and add periodic bosses', () => {
  const stageState = createBattleState();
  const firstWave = TD_STAGES[0].waves[0];
  const expectedStageSpawns = firstWave.reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(startNextTowerDefenseWave(stageState), true);
  assert.equal(stageState.wave, 1);
  assert.equal(stageState.spawnQueue.length, expectedStageSpawns);
  assert.equal(startNextTowerDefenseWave(stageState), false, 'an active wave cannot be started twice');

  const waveOne = endlessScaleForWave(1);
  const waveFive = endlessScaleForWave(5);
  const waveFifteen = endlessScaleForWave(15);
  const lateWave = endlessScaleForWave(10_000);
  assert.ok(waveFive.count > waveOne.count);
  assert.ok(waveFive.hp > waveOne.hp);
  assert.ok(waveFive.speed > waveOne.speed);
  assert.ok(waveFive.reward < waveOne.reward);
  assert.equal(waveOne.bossCount, 0);
  assert.equal(waveFive.bossCount, 1);
  assert.equal(waveFifteen.bossCount, 2);
  assert.equal(lateWave.speed, 1.68);
  assert.equal(lateWave.reward, 0.48);

  const endlessState = createBattleState({ mode: 'endless' });
  endlessState.wave = 4;
  assert.equal(startNextTowerDefenseWave(endlessState), true);
  assert.equal(endlessState.wave, 5);
  assert.equal(
    endlessState.spawnQueue.filter(({ type }) => type === 'boss').length,
    waveFive.bossCount,
  );
  assert.equal(endlessState.spawnQueue.length, waveFive.count + waveFive.bossCount);
});

test('combat events carry stable entity ids and death snapshots for skeletal playback', () => {
  const state = createBattleState();
  state.hand = [{ uid: 'animated-needle-card', type: 'needle', star: TD_MAX_STAR }];
  const tower = placeTowerFromHand(state, 'animated-needle-card', 0);
  assert.ok(tower);
  assert.equal(startNextTowerDefenseWave(state), true);

  for (let index = 0; index < 40; index += 1) {
    updateTowerDefense(state, 0.05);
    if (state.events.some(({ type }) => type === 'enemy-defeat')) break;
  }

  const shot = state.events.find(({ type }) => type === 'shot');
  const hit = state.events.find(({ type }) => type === 'enemy-hit');
  const defeat = state.events.find(({ type }) => type === 'enemy-defeat');
  assert.equal(shot.towerUid, tower.uid);
  assert.equal(typeof shot.targetUid, 'string');
  assert.equal(hit.enemyUid, shot.targetUid);
  assert.equal(defeat.enemyUid, hit.enemyUid);
  assert.equal(defeat.enemyType, 'bug');
  assert.equal(Number.isFinite(defeat.x), true);
  assert.equal(Number.isFinite(defeat.y), true);
  assert.ok([-1, 1].includes(defeat.facing));
});

test('stage victory records the clear and unlocks only the next authored stage', () => {
  const locked = createTowerDefenseState({ progress: { tutorialSeen: true } });
  const lockedSnapshot = clone(locked);
  assert.equal(beginTowerDefenseRun(locked, { stageId: 'stage-2' }), false);
  assert.deepEqual(locked, lockedSnapshot);

  const state = createBattleState();
  const stage = TD_STAGES[0];
  state.wave = stage.waves.length;
  state.waveActive = true;
  state.spawnQueue = [];
  state.enemies = [];
  updateTowerDefense(state, 0.01);

  assert.equal(state.result, 'victory');
  assert.equal(state.screen, 'result');
  assert.deepEqual(state.progress.clearedStages, ['stage-1']);
  assert.equal(state.progress.unlockedStage, 2);
  assert.equal(beginTowerDefenseRun(state, { stageId: 'stage-2' }), true);
});

test('defeat ends the run without unlocking stages and records the endless best wave', () => {
  const state = createBattleState({ mode: 'endless' });
  state.wave = 9;
  state.coreHp = 0;
  updateTowerDefense(state, 0.01);

  assert.equal(state.result, 'defeat');
  assert.equal(state.screen, 'result');
  assert.equal(state.progress.unlockedStage, 1);
  assert.deepEqual(state.progress.clearedStages, []);
  assert.equal(state.progress.bestEndlessWave, 9);
});

test('tutorial targets follow completed actions and disappear only after combat starts', () => {
  const state = createTowerDefenseState({ seed: 0xCAFEBABE });
  assert.deepEqual(tutorialTargetForState(state), { type: 'stage', stageIndex: 0, label: '1' });

  beginTowerDefenseRun(state, { stageId: 'stage-1' });
  assert.deepEqual(tutorialTargetForState(state), { type: 'draw', label: '抽' });

  const firstCard = drawTowerCard(state);
  assert.deepEqual(tutorialTargetForState(state), { type: 'pad', padIndex: 0, label: '放' });
  const firstTower = placeTowerFromHand(state, firstCard.uid, 0);
  assert.deepEqual(tutorialTargetForState(state), { type: 'draw', label: '抽' });

  const secondCard = drawTowerCard(state);
  assert.deepEqual(tutorialTargetForState(state), { type: 'pad', padIndex: 1, label: '放' });
  const secondTower = placeTowerFromHand(state, secondCard.uid, 1);
  assert.deepEqual(tutorialTargetForState(state), { type: 'fusion', label: '融' });

  mergeTowers(state, firstTower.uid, secondTower.uid);
  assert.deepEqual(tutorialTargetForState(state), { type: 'start', label: '战' });
  assert.equal(state.progress.tutorialSeen, false);

  assert.equal(startNextTowerDefenseWave(state), true);
  assert.equal(state.tutorial.active, false);
  assert.equal(state.tutorial.step, 'done');
  assert.equal(state.progress.tutorialSeen, true);
  assert.equal(tutorialTargetForState(state), null);
  assert.equal(state.events.some(({ type }) => type === 'tutorial-complete'), true);
});

test('progress serialization normalizes, freezes, and round-trips only persistent fields', () => {
  const dirtyProgress = {
    unlockedStage: 99,
    clearedStages: ['stage-2', 'unknown-stage', 'stage-2', 'stage-1'],
    bestEndlessWave: 12.9,
    tutorialSeen: 'yes',
    transientValue: 123,
  };
  const normalized = normalizeTowerDefenseProgress(dirtyProgress);
  assert.deepEqual(normalized, {
    unlockedStage: TD_STAGES.length,
    clearedStages: ['stage-2', 'stage-1'],
    bestEndlessWave: 12,
    tutorialSeen: true,
  });
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.clearedStages), true);

  const state = createTowerDefenseState({ progress: dirtyProgress });
  state.currency = 9999;
  state.wave = 44;
  state.towers.push({ uid: 'transient', type: 'shell', star: 4, padIndex: 0 });
  const serialized = serializeTowerDefenseProgress(state);
  assert.deepEqual(serialized, normalized);
  assert.equal(Object.hasOwn(serialized, 'currency'), false);
  assert.equal(Object.hasOwn(serialized, 'wave'), false);
  assert.equal(Object.hasOwn(serialized, 'towers'), false);

  const json = JSON.stringify(serialized);
  const restored = createTowerDefenseState({ progress: JSON.parse(json) });
  assert.deepEqual(serializeTowerDefenseProgress(restored), serialized);
});
