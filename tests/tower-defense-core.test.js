import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TD_ENDLESS_SCALE_CAPS,
  TD_ENEMIES,
  TD_HAND_LIMIT,
  TD_MAX_STAR,
  TD_STAGE_SCALE_CAPS,
  TD_STAGES,
  TOWER_ATTACK_EVOLUTIONS,
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
  towerAttackEvolution,
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

function laneForPad(stage, pad) {
  return stage.lanes.find(({ index }) => index === pad.laneIndex);
}

function travelledForX(lane, x) {
  const start = lane.path[0];
  const end = lane.path.at(-1);
  const direction = Math.sign(end.x - start.x) || -1;
  return Math.max(0, (x - start.x) * direction);
}

function enemyAt({
  stage = TD_STAGES[0],
  laneIndex = 0,
  x,
  uid = 'probe-enemy',
  type = 'bug',
  hp = 100_000,
  speed = 0,
} = {}) {
  const lane = stage.lanes.find(({ index }) => index === laneIndex);
  assert.ok(lane, `expected lane ${laneIndex}`);
  const travelled = travelledForX(lane, x ?? lane.path[0].x);
  const point = pointOnPath(lane.path, travelled);
  const definition = TD_ENEMIES[type];
  return {
    uid,
    type,
    laneIndex,
    travelled,
    x: point.x,
    y: point.y,
    facing: -1,
    hp,
    maxHp: hp,
    speed,
    reward: definition.reward,
    attackDamage: definition.attackDamage,
    attackInterval: definition.attackInterval,
    slowMultiplier: 1,
    slowTime: 0,
    poisonDps: 0,
    poisonTime: 0,
    hitPulse: 0,
    attackCooldown: 0,
    blockedByTowerUid: null,
  };
}

function padCoverageScore(state, towerType, padIndex) {
  const stage = TD_STAGES.find(({ id }) => id === state.stageId);
  const pad = stage.pads[padIndex];
  const lane = laneForPad(stage, pad);
  const metrics = pathMetrics(lane.path);
  let score = 0;
  for (let travelled = 0; travelled <= metrics.total; travelled += 16) {
    const point = pointOnPath(lane.path, travelled);
    const forwardDistance = point.x - pad.x;
    if (forwardDistance >= 0 && forwardDistance <= TOWER_TYPES[towerType].range) score += 1;
  }
  return score;
}

function towerCountByLane(state, laneIndex, ignoredTowerUid = null) {
  const stage = TD_STAGES.find(({ id }) => id === state.stageId);
  return state.towers.filter((tower) => (
    tower.uid !== ignoredTowerUid
    && stage.pads[tower.padIndex]?.laneIndex === laneIndex
  )).length;
}

function distributedPads(stage, count) {
  const pads = [];
  for (let columnIndex = 0; columnIndex < 7 && pads.length < count; columnIndex += 1) {
    for (let laneIndex = 0; laneIndex < 5 && pads.length < count; laneIndex += 1) {
      const pad = stage.pads.find((candidate) => (
        candidate.laneIndex === laneIndex && candidate.columnIndex === columnIndex
      ));
      if (pad) pads.push(pad);
    }
  }
  return pads;
}

function manageSimulatedBoard(state) {
  for (let guard = 0; guard < 100; guard += 1) {
    let changed = false;
    const stage = TD_STAGES.find(({ id }) => id === state.stageId);
    const desiredLaneDepth = stage.index >= 2 ? 2 : 1;
    const undefendedLane = stage.lanes.find(({ index }) => towerCountByLane(state, index) === 0);
    if (undefendedLane) {
      const donor = [...state.towers]
        .filter((tower) => (
          towerCountByLane(state, stage.pads[tower.padIndex].laneIndex) > 1
        ))
        .sort((left, right) => right.star - left.star || right.hp - left.hp)[0];
      if (donor) {
        const occupied = new Set(state.towers.map(({ padIndex }) => padIndex));
        const destination = stage.pads
          .map((pad, padIndex) => ({ pad, padIndex }))
          .filter(({ pad, padIndex }) => (
            pad.laneIndex === undefendedLane.index && !occupied.has(padIndex)
          ))
          .sort((left, right) => (
            padCoverageScore(state, donor.type, right.padIndex)
              - padCoverageScore(state, donor.type, left.padIndex)
          ))[0];
        if (destination && moveTowerToPad(state, donor.uid, destination.padIndex)) {
          changed = true;
        }
      }
    }
    if (changed) continue;

    outer: for (let leftIndex = 0; leftIndex < state.towers.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < state.towers.length; rightIndex += 1) {
        const left = state.towers[leftIndex];
        const right = state.towers[rightIndex];
        if (!canMergeTowers(left, right)) continue;
        const leftLane = stage.pads[left.padIndex].laneIndex;
        const rightLane = stage.pads[right.padIndex].laneIndex;
        const canRemoveLeft = leftLane === rightLane
          || towerCountByLane(state, leftLane, left.uid) >= desiredLaneDepth;
        const canRemoveRight = leftLane === rightLane
          || towerCountByLane(state, rightLane, right.uid) >= desiredLaneDepth;
        if (!canRemoveLeft && !canRemoveRight) continue;
        const leftScore = padCoverageScore(state, left.type, left.padIndex);
        const rightScore = padCoverageScore(state, right.type, right.padIndex);
        const [source, target] = !canRemoveLeft
          ? [right, left]
          : !canRemoveRight
            ? [left, right]
            : leftScore <= rightScore ? [left, right] : [right, left];
        mergeTowers(state, source.uid, target.uid);
        changed = true;
        break outer;
      }
    }
    if (changed) continue;

    for (const card of [...state.hand]) {
      const occupied = new Set(state.towers.map(({ padIndex }) => padIndex));
      const openPads = stage.pads
        .map((_, padIndex) => padIndex)
        .filter((padIndex) => !occupied.has(padIndex));
      const hasUnderDefendedLane = stage.lanes.some(({ index }) => (
        towerCountByLane(state, index) < desiredLaneDepth
      ));
      const mergeTarget = state.towers.find((tower) => canMergeCardIntoTower(card, tower));
      if (mergeTarget && (!hasUnderDefendedLane || !openPads.length)) {
        mergeCardIntoTower(state, card.uid, mergeTarget.uid);
        changed = true;
        break;
      }
      const padIndex = openPads.sort((left, right) => (
        towerCountByLane(state, stage.pads[left].laneIndex)
          - towerCountByLane(state, stage.pads[right].laneIndex)
        || padCoverageScore(state, card.type, right) - padCoverageScore(state, card.type, left)
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

function createAttackProbe(towerType, star, enemyCount = 5) {
  const state = createBattleState();
  const stage = TD_STAGES[0];
  const pad = stage.pads[0];
  const lane = laneForPad(stage, pad);
  state.hand = [{ uid: `probe-card-${towerType}-${star}`, type: towerType, star }];
  const tower = placeTowerFromHand(state, state.hand[0].uid, 0);
  assert.ok(tower);
  state.wave = 1;
  state.waveActive = true;
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', at: 999 }];
  tower.cooldown = 0;
  tower.aimAngle = 0;
  tower.attackPulse = 0;
  state.enemies = Array.from({ length: enemyCount }, (_, index) => {
    const maximumOffset = Math.max(36, TOWER_TYPES[towerType].range - 18);
    const offset = Math.min(maximumOffset, 42 + index * 16);
    return enemyAt({
      stage,
      laneIndex: pad.laneIndex,
      x: pad.x + offset,
      uid: `probe-enemy-${index}`,
      type: 'boss',
      speed: 0,
    });
  });
  assert.equal(lane.index, pad.laneIndex);
  state.events = [];
  state.effects = [];
  updateTowerDefense(state, 0.01);
  return state;
}

function resolveAttackProbe(state) {
  state.towers = [];
  for (let tick = 0; tick < 100 && state.projectiles.length; tick += 1) {
    updateTowerDefense(state, 0.05);
  }
  assert.equal(state.projectiles.length, 0);
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

test('every tower publishes four immutable attack evolutions with distinct star mechanics', () => {
  for (const towerType of Object.keys(TOWER_TYPES)) {
    const steps = TOWER_ATTACK_EVOLUTIONS[towerType];
    assert.equal(steps.length, TD_MAX_STAR);
    assert.equal(Object.isFrozen(steps), true);
    assert.equal(new Set(steps.map(({ attackMode }) => attackMode)).size, TD_MAX_STAR);
    steps.forEach((step, index) => {
      assert.equal(Object.isFrozen(step), true);
      assert.equal(towerAttackEvolution(towerType, index + 1), step);
    });
  }

  assert.deepEqual(TOWER_ATTACK_EVOLUTIONS.shell.map((step) => step.projectileCount), [1, 1, 2, 3]);
  assert.deepEqual(TOWER_ATTACK_EVOLUTIONS.shell.map((step) => step.splashRadius), [49, 62, 70, 80]);
  assert.deepEqual(TOWER_ATTACK_EVOLUTIONS.shell.map((step) => step.knockback), [0, 2, 2.5, 3]);
  assert.deepEqual(TOWER_ATTACK_EVOLUTIONS.needle.map((step) => step.projectileCount), [1, 1, 2, 3]);
  assert.deepEqual(TOWER_ATTACK_EVOLUTIONS.needle.map((step) => step.pierceTargets), [1, 2, 2, 3]);
  assert.deepEqual(TOWER_ATTACK_EVOLUTIONS.bubble.map((step) => step.chainTargets), [0, 1, 2, 3]);
  assert.deepEqual(TOWER_ATTACK_EVOLUTIONS.sprout.map((step) => step.spreadTargets), [0, 1, 2, 3]);
});

test('shot events and projectiles expose the star-specific volley and effect shape', () => {
  const expectedProjectileCounts = {
    shell: [1, 1, 2, 3],
    needle: [1, 1, 2, 3],
    bubble: [1, 1, 1, 1],
    sprout: [1, 1, 1, 1],
  };

  for (const towerType of Object.keys(TOWER_TYPES)) {
    for (let star = 1; star <= TD_MAX_STAR; star += 1) {
      const state = createAttackProbe(towerType, star);
      const evolution = towerAttackEvolution(towerType, star);
      const shot = state.events.find(({ type }) => type === 'shot');
      const expectedCount = expectedProjectileCounts[towerType][star - 1];
      assert.equal(state.projectiles.length, expectedCount, `${towerType} ${star}★ projectile count`);
      assert.equal(shot.star, star);
      assert.equal(shot.effectTier, star);
      assert.equal(shot.attackMode, evolution.attackMode);
      assert.equal(shot.projectileCount, expectedCount);
      assert.equal(shot.patternProjectileCount, evolution.projectileCount);
      assert.equal(shot.projectileUids.length, expectedCount);
      assert.equal(new Set(shot.targetUids).size, expectedCount);
      for (const projectile of state.projectiles) {
        assert.equal(projectile.star, star);
        assert.equal(projectile.effectTier, star);
        assert.equal(projectile.attackMode, evolution.attackMode);
        assert.equal(projectile.patternProjectileCount, evolution.projectileCount);
        assert.equal(projectile.volleyCount, expectedCount);
      }
    }
  }
});

test('bubble chains and seed poison spread to progressively more targets', () => {
  const bubbleCounts = [];
  const poisonCounts = [];
  for (let star = 1; star <= TD_MAX_STAR; star += 1) {
    const bubbleState = resolveAttackProbe(createAttackProbe('bubble', star));
    bubbleCounts.push(bubbleState.enemies.filter(({ slowMultiplier }) => slowMultiplier < 1).length);
    const sproutState = resolveAttackProbe(createAttackProbe('sprout', star));
    poisonCounts.push(sproutState.enemies.filter(({ poisonDps }) => poisonDps > 0).length);
  }
  assert.deepEqual(bubbleCounts, [1, 2, 3, 4]);
  assert.deepEqual(poisonCounts, [1, 2, 3, 4]);
});

test('every stage exposes five right-to-left lanes and a complete five-by-seven pad grid', () => {
  for (const stage of TD_STAGES) {
    assert.equal(stage.lanes.length, 5);
    assert.equal(stage.pads.length, 35);
    assert.deepEqual(stage.lanes.map(({ index }) => index), [0, 1, 2, 3, 4]);
    assert.equal(stage.path, stage.lanes[2].path, 'the legacy path aliases the centre lane');

    for (const lane of stage.lanes) {
      assert.equal(lane.id, `lane-${lane.index}`);
      assert.ok(lane.path.length >= 2);
      assert.ok(lane.path[0].x > lane.path.at(-1).x, 'enemies travel from right to left');
      assert.equal(lane.path.every(({ y }) => y === lane.y), true, 'each route stays horizontal');

      const lanePads = stage.pads.filter(({ laneIndex }) => laneIndex === lane.index);
      assert.equal(lanePads.length, 7);
      assert.deepEqual(lanePads.map(({ columnIndex }) => columnIndex), [0, 1, 2, 3, 4, 5, 6]);
      assert.equal(lanePads.every(({ y }) => y === lane.y), true);
    }

    assert.equal(new Set(stage.pads.map(({ id }) => id)).size, 35);
    assert.equal(new Set(stage.pads.map(({ laneIndex, columnIndex }) => (
      `${laneIndex}:${columnIndex}`
    ))).size, 35);
  }
});

test('towers target only enemies to their right on the same lane', () => {
  const state = createBattleState();
  const stage = TD_STAGES[0];
  const padIndex = stage.pads.findIndex(({ laneIndex, columnIndex }) => (
    laneIndex === 0 && columnIndex === 3
  ));
  const pad = stage.pads[padIndex];
  state.hand = [{ uid: 'lane-target-card', type: 'needle', star: 1 }];
  const tower = placeTowerFromHand(state, 'lane-target-card', padIndex);
  tower.cooldown = 0;
  state.wave = 1;
  state.waveActive = true;
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  state.enemies = [
    enemyAt({
      stage, laneIndex: pad.laneIndex, x: pad.x + 72, uid: 'same-lane-right', speed: 0,
    }),
    enemyAt({
      stage, laneIndex: pad.laneIndex, x: pad.x - 20, uid: 'same-lane-left', speed: 0,
    }),
    enemyAt({
      stage, laneIndex: 1, x: pad.x + 24, uid: 'other-lane-right', speed: 0,
    }),
  ];
  state.events = [];
  state.effects = [];

  updateTowerDefense(state, 0.01);

  const shot = state.events.find(({ type }) => type === 'shot');
  assert.ok(shot);
  assert.equal(shot.targetUid, 'same-lane-right');
  assert.equal(state.projectiles.every(({ targetUid }) => targetUid === 'same-lane-right'), true);
});

test('an enemy on another lane is neither targeted nor blocked by a nearby tower', () => {
  const state = createBattleState();
  const stage = TD_STAGES[0];
  const padIndex = stage.pads.findIndex(({ laneIndex, columnIndex }) => (
    laneIndex === 0 && columnIndex === 3
  ));
  const pad = stage.pads[padIndex];
  state.hand = [{ uid: 'cross-lane-card', type: 'needle', star: 1 }];
  const tower = placeTowerFromHand(state, 'cross-lane-card', padIndex);
  tower.cooldown = 0;
  state.wave = 1;
  state.waveActive = true;
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  const enemy = enemyAt({
    stage,
    laneIndex: 1,
    x: pad.x + 10,
    uid: 'cross-lane-enemy',
    speed: TD_ENEMIES.bug.speed,
  });
  state.enemies = [enemy];
  state.events = [];
  state.effects = [];
  const travelledBefore = enemy.travelled;

  updateTowerDefense(state, 0.05);

  assert.equal(state.events.some(({ type }) => type === 'shot'), false);
  assert.equal(state.projectiles.length, 0);
  assert.equal(enemy.blockedByTowerUid, null);
  assert.ok(enemy.travelled > travelledBefore, 'the other-lane enemy keeps advancing');
  assert.ok(enemy.x < pad.x + 10, 'right-to-left motion lowers x');
});

test('a same-lane enemy stops to attack a tower, defeats it, then resumes advancing', () => {
  const state = createBattleState();
  const stage = TD_STAGES[0];
  const padIndex = stage.pads.findIndex(({ laneIndex, columnIndex }) => (
    laneIndex === 0 && columnIndex === 3
  ));
  const pad = stage.pads[padIndex];
  state.hand = [{ uid: 'block-card', type: 'shell', star: 1 }];
  const tower = placeTowerFromHand(state, 'block-card', padIndex);
  tower.cooldown = 999;
  state.wave = 1;
  state.waveActive = true;
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  const enemy = enemyAt({
    stage,
    laneIndex: pad.laneIndex,
    x: pad.x + 70,
    uid: 'tower-attacker',
    type: 'boss',
    hp: 1_000_000,
    speed: TD_ENEMIES.boss.speed,
  });
  state.enemies = [enemy];
  state.events = [];
  state.effects = [];
  const hpBefore = tower.hp;

  for (let tick = 0; tick < 200 && tower.hp === hpBefore; tick += 1) {
    updateTowerDefense(state, 0.05);
  }

  assert.ok(tower.hp < hpBefore, 'contact attacks reduce tower HP');
  assert.equal(enemy.blockedByTowerUid, tower.uid);
  const firstHit = state.events.find(({ type }) => type === 'tower-hit');
  assert.ok(firstHit);
  assert.equal(firstHit.towerUid, tower.uid);
  assert.equal(firstHit.towerType, tower.type);
  assert.equal(firstHit.enemyUid, enemy.uid);
  assert.ok(firstHit.damage > 0);
  assert.equal(firstHit.maxHp, tower.maxHp);

  tower.hp = 1;
  enemy.attackCooldown = 0;
  for (let tick = 0; tick < 40 && state.towers.includes(tower); tick += 1) {
    updateTowerDefense(state, 0.05);
  }

  assert.equal(state.towers.includes(tower), false);
  const defeat = state.events.find(({ type }) => type === 'tower-defeat');
  assert.deepEqual(defeat, {
    type: 'tower-defeat',
    towerUid: tower.uid,
    towerType: tower.type,
    star: tower.star,
    padIndex,
    enemyUid: enemy.uid,
    x: pad.x,
    y: pad.y,
    laneIndex: pad.laneIndex,
  });
  const travelledAtDefeat = enemy.travelled;
  for (let tick = 0; tick < 4; tick += 1) updateTowerDefense(state, 0.05);
  assert.ok(enemy.travelled > travelledAtDefeat, 'the enemy advances after destroying its blocker');
  assert.equal(enemy.blockedByTowerUid, null);
});

test('an unblocked enemy leaks from the left endpoint and damages the base', () => {
  const state = createBattleState();
  const stage = TD_STAGES[0];
  const lane = stage.lanes[4];
  const metrics = pathMetrics(lane.path);
  state.wave = 1;
  state.waveActive = true;
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  const enemy = enemyAt({
    stage,
    laneIndex: lane.index,
    x: lane.path.at(-1).x + 0.5,
    uid: 'left-leaker',
    type: 'bug',
    speed: TD_ENEMIES.bug.speed,
  });
  state.enemies = [enemy];
  state.events = [];
  state.effects = [];
  const hpBefore = state.coreHp;

  updateTowerDefense(state, 0.05);

  assert.ok(enemy.travelled >= metrics.total);
  assert.equal(enemy.leaked, true);
  assert.equal(state.enemies.includes(enemy), false);
  assert.equal(state.coreHp, hpBefore - TD_ENEMIES.bug.coreDamage);
  assert.deepEqual(state.events.find(({ type }) => type === 'core-hit'), {
    type: 'core-hit', damage: TD_ENEMIES.bug.coreDamage,
  });
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
  assert.ok(TD_ENEMIES.boss.coreDamage >= TD_ENEMIES.bug.coreDamage * 5);
  assert.ok(TD_ENEMIES.boss.attackDamage >= TD_ENEMIES.stone.attackDamage * 2);

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
  assert.equal(stageState.spawnQueue.every(({ laneIndex }) => (
    Number.isInteger(laneIndex) && laneIndex >= 0 && laneIndex < 5
  )), true);
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
    assert.equal(endlessState.spawnQueue.every(({ laneIndex }) => (
      Number.isInteger(laneIndex) && laneIndex >= 0 && laneIndex < 5
    )), true);
  }
});

test('capped endless pressure breaches an undeveloped board while upgraded defenders clear untouched', () => {
  const simulateWave = (waveNumber, star, towerCount) => {
    const state = createBattleState({ mode: 'endless' });
    const stage = TD_STAGES[0];
    state.wave = waveNumber - 1;
    state.towers = distributedPads(stage, towerCount).map((pad, index) => {
      const type = Object.keys(TOWER_TYPES)[index % Object.keys(TOWER_TYPES).length];
      const maxHp = TOWER_TYPES[type].maxHp;
      assert.ok(Number.isFinite(maxHp) && maxHp > 0);
      return {
        uid: `sim-tower-${index}`,
        type,
        star,
        padIndex: stage.pads.indexOf(pad),
        cooldown: 0,
        aimAngle: 0,
        attackPulse: 0,
        hp: maxHp,
        maxHp,
        hitPulse: 0,
      };
    });
    assert.equal(startNextTowerDefenseWave(state), true);
    for (let tick = 0; tick < 20_000 && state.waveActive && !state.result; tick += 1) {
      updateTowerDefense(state, 0.05);
    }
    return state;
  };

  const undeveloped = simulateWave(30, 1, 4);
  assert.ok(
    undeveloped.result === 'defeat' || undeveloped.coreHp < undeveloped.coreMaxHp,
    'an uncovered fifth lane must breach or defeat the base',
  );
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
  assert.equal(idleState.coreHp, 0);
  assert.deepEqual(idleState.progress.clearedStages, []);
  assert.ok(idleState.wave >= 1 && idleState.wave <= TD_STAGES[0].waves.length);
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
      const outcome = JSON.stringify({
        stage: stage.id,
        seed,
        wave: state.wave,
        coreHp: state.coreHp,
        kills: state.kills,
        drawCount: state.drawCount,
        currency: state.currency,
        towers: state.towers.map(({ type, star, padIndex, hp }) => ({
          type, star, padIndex, hp,
        })),
      });
      assert.equal(state.result, 'victory', `${outcome} should remain winnable`);
      assert.ok(state.drawCount > TD_HAND_LIMIT, 'winning requires reinvesting wave rewards');
    }
  }
});

test('combat events carry stable entity ids and death snapshots for skeletal playback', () => {
  const state = createBattleState();
  const stage = TD_STAGES[0];
  state.hand = [{ uid: 'animated-needle-card', type: 'needle', star: TD_MAX_STAR }];
  const tower = placeTowerFromHand(state, 'animated-needle-card', 0);
  assert.ok(tower);
  assert.equal(startNextTowerDefenseWave(state), true);
  const pad = stage.pads[tower.padIndex];
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  state.enemies = [enemyAt({
    stage,
    laneIndex: pad.laneIndex,
    x: pad.x + 70,
    uid: 'animated-enemy',
    type: 'bug',
    hp: 5,
    speed: 0,
  })];
  state.events = [];
  state.effects = [];

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
