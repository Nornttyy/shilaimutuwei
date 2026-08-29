import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TD_ENDLESS_SCALE_CAPS,
  TD_ENEMIES,
  TD_HAND_LIMIT,
  TD_MAX_STAR,
  TD_STAGE_SCALE_CAPS,
  TD_STAGES,
  TOWER_TYPES,
  beginTowerDefenseRun,
  canMergeCardIntoTower,
  canMergeTowers,
  createTowerDefenseState,
  drawCostForState,
  drawTowerCard,
  endlessScaleForWave,
  mergeCardIntoTower,
  mergeTowers,
  moveTowerToPad,
  normalizeTowerDefenseProgress,
  pathMetrics,
  placeTowerFromHand,
  pointOnPath,
  reclaimTowerToHand,
  serializeTowerDefenseProgress,
  stageScaleForWave,
  startNextTowerDefenseWave,
  tutorialTargetForState,
  updateTowerDefense,
} from '../src/tower-defense-core.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function createBattleState({ tutorialSeen = true, mode = 'stage', stageId = 'stage-1' } = {}) {
  const unlockedStage = TD_STAGES.find(({ id }) => id === stageId)?.index || 1;
  const state = createTowerDefenseState({
    progress: { tutorialSeen, unlockedStage },
    seed: 0x12345678,
  });
  assert.equal(beginTowerDefenseRun(state, { mode, stageId }), true);
  return state;
}

function padCoverageScore(state, towerType, padIndex) {
  const stage = TD_STAGES.find(({ id }) => id === state.stageId);
  const metrics = pathMetrics(stage.path);
  const pad = stage.pads[padIndex];
  let score = 0;
  for (let travelled = 0; travelled <= metrics.total; travelled += 16) {
    const point = pointOnPath(stage.path, travelled);
    if (Math.hypot(point.x - pad.x, point.y - pad.y) <= TOWER_TYPES[towerType].range) score += 1;
  }
  return score;
}

function manageSimulatedBoard(state) {
  for (let guard = 0; guard < 100; guard += 1) {
    let changed = false;
    outer: for (let leftIndex = 0; leftIndex < state.towers.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < state.towers.length; rightIndex += 1) {
        const left = state.towers[leftIndex];
        const right = state.towers[rightIndex];
        if (!canMergeTowers(left, right)) continue;
        const leftScore = padCoverageScore(state, left.type, left.padIndex);
        const rightScore = padCoverageScore(state, right.type, right.padIndex);
        const [source, target] = leftScore <= rightScore ? [left, right] : [right, left];
        mergeTowers(state, source.uid, target.uid);
        changed = true;
        break outer;
      }
    }
    if (changed) continue;

    for (const card of [...state.hand]) {
      const mergeTarget = state.towers.find((tower) => canMergeCardIntoTower(card, tower));
      if (mergeTarget) {
        mergeCardIntoTower(state, card.uid, mergeTarget.uid);
        changed = true;
        break;
      }
      const occupied = new Set(state.towers.map(({ padIndex }) => padIndex));
      const openPads = TD_STAGES.find(({ id }) => id === state.stageId).pads
        .map((_, padIndex) => padIndex)
        .filter((padIndex) => !occupied.has(padIndex));
      const padIndex = openPads.sort((left, right) => (
        padCoverageScore(state, card.type, right) - padCoverageScore(state, card.type, left)
      ))[0];
      if (padIndex !== undefined) {
        placeTowerFromHand(state, card.uid, padIndex);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
}

function spendSimulatedCurrency(state) {
  manageSimulatedBoard(state);
  for (let guard = 0; guard < 40; guard += 1) {
    if (state.hand.length >= TD_HAND_LIMIT || state.currency < drawCostForState(state)) break;
    if (!drawTowerCard(state)) break;
    manageSimulatedBoard(state);
  }
}

function runUntilResult(state, { engaged = false, maxTicks = 24_000 } = {}) {
  for (let tick = 0; tick < maxTicks && !state.result; tick += 1) {
    if (engaged && tick % 10 === 0) spendSimulatedCurrency(state);
    updateTowerDefense(state, 0.05);
  }
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

test('a placed tower can be reclaimed to a non-full hand without losing its star', () => {
  const state = createBattleState();
  state.hand = [{ uid: 'reclaim-source', type: 'sprout', star: 3 }];
  const tower = placeTowerFromHand(state, 'reclaim-source', 2);
  tower.cooldown = 0.7;
  state.selectedTowerUid = tower.uid;

  const card = reclaimTowerToHand(state, tower.uid);
  assert.ok(card);
  assert.notEqual(card.uid, tower.uid);
  assert.deepEqual({ type: card.type, star: card.star }, { type: 'sprout', star: 3 });
  assert.deepEqual(state.hand, [card]);
  assert.equal(state.towers.length, 0);
  assert.equal(state.selectedTowerUid, null);
  assert.deepEqual(state.events.at(-1), {
    type: 'reclaim',
    towerUid: tower.uid,
    cardUid: card.uid,
    towerType: 'sprout',
    star: 3,
    fromPadIndex: 2,
  });

  const placedAgain = placeTowerFromHand(state, card.uid, 5);
  assert.equal(placedAgain.type, 'sprout');
  assert.equal(placedAgain.star, 3);

  state.hand = Array.from({ length: TD_HAND_LIMIT }, (_, index) => ({
    uid: `blocking-card-${index}`, type: 'bubble', star: 1,
  }));
  const fullHandSnapshot = clone(state);
  assert.equal(reclaimTowerToHand(state, placedAgain.uid), null);
  assert.deepEqual(state, fullHandSnapshot, 'a full hand must reject reclaim atomically');

  state.hand = [];
  assert.equal(startNextTowerDefenseWave(state), true);
  placedAgain.cooldown = 0.1;
  const combatCard = reclaimTowerToHand(state, placedAgain.uid);
  assert.ok(combatCard, 'combat reclaim remains available');
  assert.equal(combatCard.redeployCooldown, 0.65);
  const redeployed = placeTowerFromHand(state, combatCard.uid, 6);
  assert.equal(redeployed.star, 3);
  assert.equal(redeployed.cooldown, 0.65, 'combat reclaim carries a short redeploy delay');
});

test('a compatible hand card can merge directly into a placed tower even on a full board', () => {
  const state = createBattleState();
  state.towers = TD_STAGES[0].pads.map((_, padIndex) => ({
    uid: `board-tower-${padIndex}`,
    type: padIndex === 0 ? 'needle' : 'shell',
    star: padIndex === 0 ? 2 : TD_MAX_STAR,
    padIndex,
    cooldown: 0.8,
    aimAngle: 0,
    attackPulse: 0,
  }));
  const target = state.towers[0];
  state.hand = [
    { uid: 'direct-merge-card', type: 'needle', star: 2 },
    { uid: 'incompatible-card', type: 'bubble', star: 2 },
  ];

  assert.equal(canMergeCardIntoTower(state.hand[0], target), true);
  assert.equal(canMergeCardIntoTower(state.hand[1], target), false);
  const merged = mergeCardIntoTower(state, 'direct-merge-card', target.uid);
  assert.equal(merged, target);
  assert.equal(merged.star, 3);
  assert.equal(merged.cooldown, 0.12);
  assert.equal(state.towers.length, TD_STAGES[0].pads.length);
  assert.deepEqual(state.hand.map(({ uid }) => uid), ['incompatible-card']);
  assert.deepEqual(state.events.at(-1), {
    type: 'merge',
    source: 'hand',
    cardUid: 'direct-merge-card',
    towerUid: target.uid,
    star: 3,
  });

  const mismatchSnapshot = clone(state);
  assert.equal(mergeCardIntoTower(state, 'incompatible-card', target.uid), null);
  assert.deepEqual(state, mismatchSnapshot, 'a mismatched direct fusion must be atomic');

  target.star = TD_MAX_STAR;
  state.hand.push({ uid: 'maximum-card', type: target.type, star: TD_MAX_STAR });
  const maximumSnapshot = clone(state);
  assert.equal(mergeCardIntoTower(state, 'maximum-card', target.uid), null);
  assert.deepEqual(state, maximumSnapshot, 'a maximum-star direct fusion must be atomic');
});

test('a placed tower moves only to a valid empty pad and preserves identity and aim', () => {
  const state = createBattleState();
  state.hand = [
    { uid: 'moving-card', type: 'bubble', star: 2 },
    { uid: 'blocking-card', type: 'shell', star: 1 },
  ];
  const moving = placeTowerFromHand(state, 'moving-card', 0);
  const blocking = placeTowerFromHand(state, 'blocking-card', 1);
  moving.cooldown = 0.73;
  moving.aimAngle = 1.25;

  assert.equal(moveTowerToPad(state, moving.uid, 4), moving);
  assert.equal(moving.padIndex, 4);
  assert.equal(moving.star, 2);
  assert.equal(moving.cooldown, 0.73);
  assert.equal(moving.aimAngle, 1.25);
  assert.deepEqual(state.events.at(-1), {
    type: 'tower-move',
    towerUid: moving.uid,
    fromPadIndex: 0,
    toPadIndex: 4,
  });

  for (const [label, towerUid, padIndex] of [
    ['same pad', moving.uid, 4],
    ['occupied pad', moving.uid, blocking.padIndex],
    ['missing tower', 'unknown-tower', 3],
    ['invalid pad', moving.uid, 999],
  ]) {
    const snapshot = clone(state);
    assert.equal(moveTowerToPad(state, towerUid, padIndex), null, label);
    assert.deepEqual(state, snapshot, `${label} move must be atomic`);
  }

  assert.equal(startNextTowerDefenseWave(state), true);
  moving.cooldown = 0.1;
  assert.equal(moveTowerToPad(state, moving.uid, 3), moving);
  assert.equal(moving.padIndex, 3);
  assert.equal(moving.cooldown, 0.65, 'combat movement applies a short attack delay');
  assert.equal(moving.aimAngle, 1.25);
});

test('authored stages use sharply smaller waves with concentrated elite and boss pressure', () => {
  const countsByWave = TD_STAGES.map((stage) => stage.waves.map(
    (groups) => groups.reduce((sum, entry) => sum + entry.count, 0),
  ));
  assert.deepEqual(countsByWave, [
    [5, 7, 7, 7, 7],
    [8, 8, 8, 8, 8, 8],
    [9, 9, 9, 9, 9, 9, 9],
  ]);
  const totals = countsByWave.map((counts) => counts.reduce((sum, count) => sum + count, 0));
  assert.deepEqual(totals, [33, 48, 63]);
  [93, 145, 230].forEach((previousTotal, stageIndex) => {
    assert.ok(totals[stageIndex] <= previousTotal * 0.4, 'each stage removes at least 60% of its enemies');
  });

  assert.deepEqual(TD_STAGES.map((stage) => (
    stage.waves.at(-1).filter(({ type }) => type === 'boss')
      .reduce((sum, entry) => sum + entry.count, 0)
  )), [1, 1, 2]);
  assert.ok(TD_ENEMIES.stone.hp >= TD_ENEMIES.bug.hp * 3);
  assert.ok(TD_ENEMIES.boss.hp >= TD_ENEMIES.stone.hp * 8);
  assert.ok(TD_ENEMIES.boss.coreDamage >= 10);

  const expectedScales = [
    [{ hp: 1.25, speed: 1.07, reward: 1.2 }, { hp: 1.97, speed: 1.17, reward: 1.52 }],
    [{ hp: 1.59, speed: 1.125, reward: 1.32 }, { hp: 2.49, speed: 1.25, reward: 1.72 }],
    [{ hp: 1.93, speed: 1.18, reward: 1.44 }, { hp: 3.01, speed: 1.33, reward: 1.92 }],
  ];
  TD_STAGES.forEach((stage, index) => {
    assert.deepEqual(stageScaleForWave(stage.index, 1), expectedScales[index][0]);
    assert.deepEqual(
      stageScaleForWave(stage.index, stage.waves.length),
      expectedScales[index][1],
    );
  });
  assert.deepEqual(stageScaleForWave(3, 10_000), TD_STAGE_SCALE_CAPS);
});

test('endless waves cap population and every strength axis while adding periodic bosses', () => {
  const stageState = createBattleState();
  const firstWave = TD_STAGES[0].waves[0];
  const expectedStageSpawns = firstWave.reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(startNextTowerDefenseWave(stageState), true);
  assert.equal(stageState.wave, 1);
  assert.equal(stageState.spawnQueue.length, expectedStageSpawns);
  assert.equal(startNextTowerDefenseWave(stageState), false, 'an active wave cannot be started twice');

  assert.deepEqual(endlessScaleForWave(1), {
    count: 8, hp: 1.35, speed: 1.05, reward: 1.2, bossCount: 0,
  });
  assert.deepEqual(endlessScaleForWave(10), {
    count: 8, hp: 2.385, speed: 1.14, reward: 1.47, bossCount: 1,
  });
  assert.deepEqual(endlessScaleForWave(30), {
    count: 8, hp: 4.685, speed: 1.34, reward: 2.07, bossCount: 2,
  });
  assert.deepEqual(endlessScaleForWave(100), {
    ...TD_ENDLESS_SCALE_CAPS,
  });
  assert.deepEqual(endlessScaleForWave(10_000), {
    ...TD_ENDLESS_SCALE_CAPS,
  });
  assert.equal(Object.isFrozen(endlessScaleForWave(100)), true);

  for (const waveNumber of [1, 10, 30, 100]) {
    const endlessState = createBattleState({ mode: 'endless' });
    endlessState.wave = waveNumber - 1;
    assert.equal(startNextTowerDefenseWave(endlessState), true);
    assert.equal(endlessState.wave, waveNumber);
    assert.equal(
      endlessState.spawnQueue.filter(({ type }) => type === 'boss').length,
      endlessScaleForWave(waveNumber).bossCount,
    );
    assert.equal(endlessState.spawnQueue.length, TD_ENDLESS_SCALE_CAPS.count);
  }
});

test('capped endless pressure defeats an undeveloped board while remaining clearable when upgraded', () => {
  const simulateWave = (waveNumber, star, towerCount) => {
    const state = createBattleState({ mode: 'endless' });
    state.wave = waveNumber - 1;
    state.towers = TD_STAGES[0].pads.slice(0, towerCount).map((_, padIndex) => ({
      uid: `sim-tower-${padIndex}`,
      type: Object.keys(TOWER_TYPES)[padIndex % Object.keys(TOWER_TYPES).length],
      star,
      padIndex,
      cooldown: 0,
      aimAngle: 0,
      attackPulse: 0,
    }));
    assert.equal(startNextTowerDefenseWave(state), true);
    for (let tick = 0; tick < 20_000 && state.waveActive && !state.result; tick += 1) {
      updateTowerDefense(state, 0.05);
    }
    return state;
  };

  const undeveloped = simulateWave(30, 1, 4);
  assert.equal(undeveloped.result, 'defeat');
  assert.ok(undeveloped.kills < TD_ENDLESS_SCALE_CAPS.count);

  const upgraded = simulateWave(100, TD_MAX_STAR, TD_STAGES[0].pads.length);
  assert.equal(upgraded.result, null);
  assert.equal(upgraded.waveActive, false);
  assert.equal(upgraded.kills, TD_ENDLESS_SCALE_CAPS.count);
  assert.equal(upgraded.coreHp, upgraded.coreMaxHp);
});

test('rule simulation defeats tutorial-only idling but clears all stages with continued draws and fusions', () => {
  const idleState = createTowerDefenseState({ seed: 0x51A7E });
  assert.equal(beginTowerDefenseRun(idleState, { stageId: 'stage-1' }), true);
  const firstCard = drawTowerCard(idleState);
  const firstTower = placeTowerFromHand(idleState, firstCard.uid, 0);
  const secondCard = drawTowerCard(idleState);
  assert.ok(mergeCardIntoTower(idleState, secondCard.uid, firstTower.uid));
  assert.equal(startNextTowerDefenseWave(idleState), true);
  runUntilResult(idleState);
  assert.equal(idleState.result, 'defeat');
  assert.equal(idleState.wave, TD_STAGES[0].waves.length);
  assert.equal(idleState.drawCount, 2, 'the forced tutorial pair is deliberately insufficient for idling');

  for (const stage of TD_STAGES) {
    for (const seed of [0x1000, 0x1011, 0x1022]) {
      const state = createTowerDefenseState({
        progress: { tutorialSeen: true, unlockedStage: stage.index },
        seed,
      });
      assert.equal(beginTowerDefenseRun(state, { stageId: stage.id }), true);
      spendSimulatedCurrency(state);
      assert.equal(startNextTowerDefenseWave(state), true);
      runUntilResult(state, { engaged: true });
      assert.equal(state.result, 'victory', `${stage.id} seed ${seed} should remain winnable`);
      assert.ok(state.drawCount > TD_HAND_LIMIT, 'winning requires reinvesting wave rewards');
    }
  }
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

test('tutorial targets draw, place, then fuse the second hand card directly into the first tower', () => {
  const state = createTowerDefenseState({ seed: 0xCAFEBABE });
  assert.deepEqual(tutorialTargetForState(state), { type: 'stage', stageIndex: 0, label: '1' });

  beginTowerDefenseRun(state, { stageId: 'stage-1' });
  assert.deepEqual(tutorialTargetForState(state), { type: 'draw', label: '抽' });

  const firstCard = drawTowerCard(state);
  assert.deepEqual(tutorialTargetForState(state), { type: 'pad', padIndex: 0, label: '放' });
  const firstTower = placeTowerFromHand(state, firstCard.uid, 0);
  assert.deepEqual(tutorialTargetForState(state), { type: 'draw', label: '抽' });

  const secondCard = drawTowerCard(state);
  assert.deepEqual(tutorialTargetForState(state), { type: 'fusion', label: '融' });
  assert.equal(state.towers.length, 1);
  assert.deepEqual(state.hand, [secondCard]);

  const tutorialSnapshot = clone(state);
  assert.equal(placeTowerFromHand(state, secondCard.uid, 1), null);
  assert.equal(reclaimTowerToHand(state, firstTower.uid), null);
  assert.equal(moveTowerToPad(state, firstTower.uid, 1), null);
  assert.deepEqual(state, tutorialSnapshot, 'new board-management commands must not bypass the tutorial');

  const merged = mergeCardIntoTower(state, secondCard.uid, firstTower.uid);
  assert.equal(merged.uid, firstTower.uid);
  assert.equal(merged.star, 2);
  assert.equal(state.towers.length, 1);
  assert.equal(state.hand.length, 0);
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
