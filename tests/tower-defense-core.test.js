import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HERO_TYPES,
  SQUAD_TYPES,
  TD_CONTRACT_START_CURRENCY,
  TD_CONTRACT_SUMMON_COSTS,
  TD_CONTRACT_TYPES,
  TD_ENDLESS_SCALE_CAPS,
  TD_ENEMIES,
  TD_STAGE_SCALE_CAPS,
  TD_STAGES,
  TD_TURRET_SLOTS,
  TOWER_ATTACK_EVOLUTIONS,
  TOWER_TYPES,
  TURRET_TYPES,
  activateTowerDefenseHeroSkill,
  beginTowerDefenseRun,
  buildTowerDefenseTurret,
  buyTowerDefenseSquad,
  createTowerDefenseState,
  endlessScaleForWave,
  moveTowerToPad,
  normalizeTowerDefenseProgress,
  pathMetrics,
  pointOnPath,
  reclaimTowerToHand,
  selectTowerDefenseHero,
  serializeTowerDefenseProgress,
  setTowerDefenseHeroMovement,
  skipTowerDefenseBreak,
  stageScaleForWave,
  startNextTowerDefenseWave,
  summonTowerDefenseContracts,
  towerAttackEvolution,
  tutorialTargetForState,
  updateTowerDefense,
} from '../src/tower-defense-core.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function createBattleState({
  tutorialSeen = true,
  mode = 'stage',
  stageId = 'stage-1',
  progress = {},
  seed = 0x12345678,
} = {}) {
  const unlockedStage = TD_STAGES.find(({ id }) => id === stageId)?.index || 1;
  const state = createTowerDefenseState({
    progress: { tutorialSeen, unlockedStage, ...progress },
    seed,
  });
  assert.equal(beginTowerDefenseRun(state, { mode, stageId }), true);
  return state;
}

function travelledForX(lane, x) {
  const direction = Math.sign(lane.path.at(-1).x - lane.path[0].x) || -1;
  return Math.max(0, (x - lane.path[0].x) * direction);
}

function enemyAt({
  stage = TD_STAGES[0], laneIndex = 0, x, uid = 'probe-enemy',
  type = 'bug', hp = 100_000, speed = 0,
} = {}) {
  const lane = stage.lanes.find(({ index }) => index === laneIndex);
  assert.ok(lane, `expected lane ${laneIndex}`);
  const travelled = travelledForX(lane, x ?? lane.path[0].x);
  const point = pointOnPath(lane.path, travelled);
  const definition = TD_ENEMIES[type];
  return {
    uid, type, laneIndex, travelled, x: point.x, y: point.y, facing: -1,
    hp, maxHp: hp, speed, reward: definition.reward,
    attackDamage: definition.attackDamage, attackInterval: definition.attackInterval,
    slowMultiplier: 1, slowTime: 0, poisonDps: 0, poisonTime: 0,
    hitPulse: 0, attackCooldown: 999, blockedByTowerUid: null,
  };
}

function holdCombat(state) {
  state.phase = 'combat';
  state.waveActive = true;
  state.wave = Math.max(1, state.wave);
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  if (state.hero) state.hero.hp = 0;
  return state;
}

function resolveProjectiles(state, maxTicks = 100) {
  for (let tick = 0; tick < maxTicks && state.projectiles.length; tick += 1) {
    updateTowerDefense(state, 0.05);
  }
}

test('old progress owns only shell and starts with exactly one active hero', () => {
  const state = createTowerDefenseState({ progress: {} });
  assert.equal(state.progress.summonCurrency, TD_CONTRACT_START_CURRENCY);
  assert.deepEqual(state.progress.contractRanks, {
    shell: 1, needle: 0, bubble: 0, sprout: 0,
  });
  assert.equal(state.progress.selectedHero, 'shell');
  assert.deepEqual(state.heroes.filter(({ owned }) => owned).map(({ type }) => type), ['shell']);
  assert.equal(selectTowerDefenseHero(state, 'needle'), false);
  assert.equal(selectTowerDefenseHero(state, 'shell'), true);
  assert.equal(beginTowerDefenseRun(state, { stageId: 'stage-1' }), true);
  assert.equal(state.phase, 'prep');
  assert.equal(state.hero.kind, 'hero');
  assert.equal(state.hero.type, 'shell');
  assert.equal(state.hero.rank, 1);
  assert.equal(state.towers.length, 0);
});

test('direct squad purchase is prep-only, correctly priced, one-cell, and atomic', () => {
  assert.deepEqual(Object.keys(SQUAD_TYPES), ['melee', 'ranged']);
  assert.equal(SQUAD_TYPES.melee.cost, 100);
  assert.equal(SQUAD_TYPES.melee.squadSize, 4);
  assert.equal(SQUAD_TYPES.ranged.cost, 150);
  assert.equal(SQUAD_TYPES.ranged.squadSize, 4);
  const state = createBattleState();
  assert.equal(state.currency, 500);

  const invalid = clone(state);
  assert.equal(buyTowerDefenseSquad(state, 'unknown', 0), null);
  assert.deepEqual(state, invalid);
  const melee = buyTowerDefenseSquad(state, 'melee', 0);
  assert.ok(melee);
  assert.equal(state.currency, 400);
  assert.deepEqual({
    kind: melee.kind, squadType: melee.squadType, squadSize: melee.squadSize,
    maxMembers: melee.maxMembers, aliveMembers: melee.aliveMembers, padIndex: melee.padIndex,
  }, {
    kind: 'soldier', squadType: 'melee', squadSize: 4,
    maxMembers: 4, aliveMembers: 4, padIndex: 0,
  });
  assert.equal(melee.maxHp, SQUAD_TYPES.melee.memberHp * 4);

  const occupied = clone(state);
  assert.equal(buyTowerDefenseSquad(state, 'ranged', 0), null);
  assert.deepEqual(state, occupied);
  assert.ok(buyTowerDefenseSquad(state, 'ranged', 1));
  assert.equal(state.currency, 250);
  assert.equal(state.towers.length, 2, 'two four-member squads occupy two grid cells');

  state.currency = 99;
  const poor = clone(state);
  assert.equal(buyTowerDefenseSquad(state, 'melee', 2), null);
  assert.deepEqual(state, poor);
  assert.equal(startNextTowerDefenseWave(state), true);
  const combat = clone(state);
  assert.equal(buyTowerDefenseSquad(state, 'melee', 2), null);
  assert.deepEqual(state, combat);
});

test('member losses reduce aliveMembers and squad damage linearly', () => {
  for (const squadType of ['melee', 'ranged']) {
    const state = createBattleState();
    const squad = buyTowerDefenseSquad(state, squadType, 0);
    const pad = TD_STAGES[0].pads[0];
    holdCombat(state);
    const enemy = enemyAt({
      laneIndex: pad.laneIndex,
      x: pad.x + (squadType === 'melee' ? 48 : 180),
      uid: `${squadType}-damage-target`, hp: 1_000_000,
    });
    state.enemies = [enemy];
    squad.cooldown = 0;
    state.events = [];
    updateTowerDefense(state, 0.01);
    const full = state.events.find(({ type }) => type === 'shot');
    assert.ok(full);
    assert.equal(full.aliveMembers, 4);
    assert.equal(full.damage, SQUAD_TYPES[squadType].damagePerMember * 4);

    squad.hp = SQUAD_TYPES[squadType].memberHp * 2;
    squad.cooldown = 0;
    enemy.hp = enemy.maxHp;
    state.projectiles = [];
    state.events = [];
    updateTowerDefense(state, 0.01);
    const reduced = state.events.find(({ type }) => type === 'shot');
    assert.ok(reduced);
    assert.equal(squad.aliveMembers, 2);
    assert.equal(reduced.aliveMembers, 2);
    assert.equal(reduced.damage, full.damage / 2);
    assert.equal(reduced.projectileCount, squadType === 'ranged' ? 2 : 0);
    assert.equal(state.projectiles.length, squadType === 'ranged' ? 2 : 0);
  }
});

test('melee closes to contact while ranged fires a long-distance projectile', () => {
  const meleeState = createBattleState();
  const melee = buyTowerDefenseSquad(meleeState, 'melee', 0);
  const pad = TD_STAGES[0].pads[0];
  holdCombat(meleeState);
  const meleeEnemy = enemyAt({ laneIndex: 0, x: pad.x + 190, uid: 'melee-target', hp: 1e6 });
  meleeState.enemies = [meleeEnemy];
  melee.cooldown = 0;
  updateTowerDefense(meleeState, 0.05);
  assert.ok(melee.x > melee.deployX);
  assert.equal(meleeState.events.some(({ type }) => type === 'shot'), false);
  for (let tick = 0; tick < 80; tick += 1) updateTowerDefense(meleeState, 0.05);
  const meleeShot = meleeState.events.find(({ type }) => type === 'shot');
  assert.equal(meleeShot.attackMode, 'melee-contact');
  assert.equal(meleeShot.projectileCount, 0);
  assert.ok(meleeEnemy.hp < meleeEnemy.maxHp);

  const rangedState = createBattleState();
  const ranged = buyTowerDefenseSquad(rangedState, 'ranged', 0);
  holdCombat(rangedState);
  const rangedEnemy = enemyAt({ laneIndex: 0, x: pad.x + 190, uid: 'ranged-target', hp: 1e6 });
  rangedState.enemies = [rangedEnemy];
  ranged.cooldown = 0;
  rangedState.events = [];
  updateTowerDefense(rangedState, 0.01);
  const rangedShot = rangedState.events.find(({ type }) => type === 'shot');
  assert.equal(rangedShot.attackMode, 'ranged-volley');
  assert.equal(rangedShot.projectileCount, 4);
  assert.equal(rangedState.projectiles.length, 4);
  assert.equal(rangedState.projectiles[0].sourceKind, 'squad');
  assert.equal(rangedState.projectiles[0].damage, SQUAD_TYPES.ranged.damagePerMember);
  resolveProjectiles(rangedState);
  assert.ok(rangedEnemy.hp < rangedEnemy.maxHp);
});

test('contact damage downs members once and wave clear revives the retained squad', () => {
  const state = createBattleState();
  const squad = buyTowerDefenseSquad(state, 'melee', 0);
  const pad = TD_STAGES[0].pads[0];
  assert.equal(startNextTowerDefenseWave(state), true);
  state.spawnQueue = [{ uid: 'held-spawn', type: 'boss', laneIndex: 0, at: 999 }];
  state.hero.hp = 0;
  const enemy = enemyAt({
    laneIndex: 0, x: pad.x + 70, uid: 'squad-breaker', type: 'boss',
    hp: 1e6, speed: TD_ENEMIES.boss.speed,
  });
  enemy.attackDamage = SQUAD_TYPES.melee.memberHp + 1;
  enemy.attackCooldown = 0;
  state.enemies = [enemy];
  squad.cooldown = 999;
  state.events = [];
  for (let tick = 0; tick < 80 && squad.aliveMembers === 4; tick += 1) {
    updateTowerDefense(state, 0.05);
  }
  assert.ok(squad.aliveMembers < 4);
  assert.ok(state.events.some(({ type }) => type === 'squad-member-down'));
  assert.equal(enemy.blockedByTowerUid, squad.uid);

  squad.hp = 1;
  enemy.attackCooldown = 0;
  updateTowerDefense(state, 0.05);
  assert.equal(squad.hp, 0);
  assert.equal(squad.aliveMembers, 0);
  assert.equal(squad.downed, true);
  assert.equal(state.towers.includes(squad), true);
  assert.equal(state.events.filter(({ type }) => type === 'tower-defeat').length, 1);
  updateTowerDefense(state, 0.05);
  assert.equal(state.events.filter(({ type }) => type === 'tower-defeat').length, 1);

  squad.x = pad.x + 160;
  state.spawnQueue = [];
  state.enemies = [];
  updateTowerDefense(state, 0.05);
  assert.equal(state.phase, 'prep');
  assert.equal(squad.hp, squad.maxHp);
  assert.equal(squad.aliveMembers, 4);
  assert.equal(squad.downed, false);
  assert.equal(squad.x, squad.deployX);
});

test('gel mortar costs 175, uses fixed slots, cannot move, and splashes across lanes', () => {
  assert.deepEqual(Object.keys(TURRET_TYPES), ['gel-mortar']);
  assert.equal(TURRET_TYPES['gel-mortar'].cost, 175);
  const state = createBattleState();
  const slot = TD_TURRET_SLOTS['stage-1'][0];
  const turret = buildTowerDefenseTurret(state, 0);
  assert.ok(turret);
  assert.equal(state.currency, 325);
  assert.deepEqual({ x: turret.x, y: turret.y, slotIndex: turret.slotIndex }, {
    x: slot.x, y: slot.y, slotIndex: 0,
  });
  for (const [slotIndex, type] of [[0, 'gel-mortar'], [999, 'gel-mortar'], [1, 'cannon']]) {
    const snapshot = clone(state);
    assert.equal(buildTowerDefenseTurret(state, slotIndex, type), null);
    assert.deepEqual(state, snapshot);
  }
  assert.equal(moveTowerToPad(state, turret.uid, 1), null);
  assert.equal(reclaimTowerToHand(state, turret.uid), null);

  assert.equal(startNextTowerDefenseWave(state), true);
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  state.hero.hp = 0;
  const primary = enemyAt({ laneIndex: 0, x: turret.x + 35, uid: 'mortar-primary' });
  const splash = enemyAt({ laneIndex: 1, x: turret.x + 35, uid: 'mortar-splash' });
  state.enemies = [primary, splash];
  turret.cooldown = 0;
  state.events = [];
  updateTowerDefense(state, 0.01);
  assert.ok(state.events.some(({ type, turretUid }) => type === 'turret-shot' && turretUid === turret.uid));
  assert.equal(state.projectiles[0].areaAllLanes, true);
  resolveProjectiles(state);
  assert.ok(primary.hp < primary.maxHp);
  assert.ok(splash.hp < splash.maxHp);

  const combat = clone(state);
  assert.equal(buildTowerDefenseTurret(state, 1), null);
  assert.deepEqual(state, combat);
});

test('hero movement is combat-only, normalized, and clamped to the field', () => {
  const state = createBattleState();
  const prep = clone(state.hero);
  assert.equal(setTowerDefenseHeroMovement(state, 1, 0), false);
  assert.deepEqual(state.hero, prep);
  assert.equal(startNextTowerDefenseWave(state), true);
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  assert.equal(setTowerDefenseHeroMovement(state, 1, 1), state.hero);
  assert.ok(Math.abs(Math.hypot(state.hero.moveX, state.hero.moveY) - 1) < 1e-9);
  state.hero.x = 1189;
  state.hero.y = 534;
  updateTowerDefense(state, 0.05);
  assert.deepEqual({ x: state.hero.x, y: state.hero.y }, { x: 1190, y: 535 });
  state.hero.x = 73;
  state.hero.y = 109;
  setTowerDefenseHeroMovement(state, -1, -1);
  updateTowerDefense(state, 0.05);
  assert.deepEqual({ x: state.hero.x, y: state.hero.y }, { x: 72, y: 108 });
  assert.equal(state.hero.facing, -1);
  state.phase = 'prep';
  const ended = clone(state.hero);
  assert.equal(setTowerDefenseHeroMovement(state, 1, 0), false);
  assert.deepEqual(state.hero, ended);
});

test('hero auto-attacks and its active skill has cooldown and bounded area', () => {
  const state = createBattleState();
  assert.equal(startNextTowerDefenseWave(state), true);
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  const hero = state.hero;
  const near = enemyAt({ laneIndex: 2, x: hero.x + 90, uid: 'hero-near', hp: 1e6 });
  const far = enemyAt({
    laneIndex: 2, x: hero.x + HERO_TYPES.shell.skillRadius + 80,
    uid: 'hero-far', hp: 1e6,
  });
  state.enemies = [near, far];
  hero.cooldown = 0;
  setTowerDefenseHeroMovement(state, -1, 0);
  assert.equal(hero.facing, -1);
  state.events = [];
  updateTowerDefense(state, 0.01);
  const auto = state.events.find(({ type }) => type === 'hero-shot');
  assert.equal(auto.heroUid, hero.uid);
  assert.equal(auto.targetUid, near.uid);
  assert.equal(hero.facing, -1, 'automatic fire must not reverse a moving hero');

  const nearHp = near.hp;
  const farHp = far.hp;
  state.events = [];
  assert.equal(activateTowerDefenseHeroSkill(state), true);
  assert.ok(near.hp < nearHp);
  assert.equal(far.hp, farHp);
  assert.equal(hero.skillCooldown, HERO_TYPES.shell.skillCooldown);
  assert.deepEqual(state.events.find(({ type }) => type === 'hero-skill').targetUids, [near.uid]);
  const cooldown = clone(state);
  assert.equal(activateTowerDefenseHeroSkill(state), false);
  assert.deepEqual(state, cooldown);
});

test('wave clear returns to prep, restores actors, and never auto-starts', () => {
  const state = createBattleState();
  const squad = buyTowerDefenseSquad(state, 'ranged', 0);
  assert.equal(startNextTowerDefenseWave(state), true);
  squad.x += 140;
  squad.hp = squad.memberHp;
  squad.aliveMembers = 1;
  state.hero.x += 200;
  state.spawnQueue = [];
  state.enemies = [];
  updateTowerDefense(state, 0.05);
  assert.equal(state.wave, 1);
  assert.equal(state.phase, 'prep');
  assert.equal(state.waveActive, false);
  assert.equal(state.waveBreak, 0);
  assert.equal(squad.x, squad.deployX);
  assert.equal(squad.hp, squad.maxHp);
  assert.equal(squad.aliveMembers, 4);
  assert.equal(state.hero.x, state.hero.spawnX);
  for (let tick = 0; tick < 300; tick += 1) updateTowerDefense(state, 0.05);
  assert.equal(state.wave, 1);
  assert.equal(state.waveActive, false);
  assert.equal(skipTowerDefenseBreak(state), true);
  assert.equal(state.wave, 2);
  assert.equal(state.phase, 'combat');
});

test('stages retain five right-to-left lanes, 35 pads, and fixed turret slots', () => {
  for (const stage of TD_STAGES) {
    assert.equal(stage.lanes.length, 5);
    assert.equal(stage.pads.length, 35);
    assert.equal(stage.path, stage.lanes[2].path);
    for (const lane of stage.lanes) {
      assert.ok(lane.path[0].x > lane.path.at(-1).x);
      assert.equal(lane.path.every(({ y }) => y === lane.y), true);
      assert.deepEqual(
        stage.pads.filter(({ laneIndex }) => laneIndex === lane.index)
          .map(({ columnIndex }) => columnIndex),
        [0, 1, 2, 3, 4, 5, 6],
      );
    }
    assert.equal(new Set(stage.pads.map(({ laneIndex, columnIndex }) => (
      `${laneIndex}:${columnIndex}`
    ))).size, 35);
    assert.ok(TD_TURRET_SLOTS[stage.id].length >= 4);
  }
});

test('ranged squads target only enemies to their right on the same lane', () => {
  const state = createBattleState();
  const stage = TD_STAGES[0];
  const padIndex = stage.pads.findIndex(({ laneIndex, columnIndex }) => (
    laneIndex === 0 && columnIndex === 3
  ));
  const squad = buyTowerDefenseSquad(state, 'ranged', padIndex);
  const pad = stage.pads[padIndex];
  holdCombat(state);
  squad.cooldown = 0;
  state.enemies = [
    enemyAt({ laneIndex: 0, x: pad.x + 72, uid: 'same-lane-right' }),
    enemyAt({ laneIndex: 0, x: pad.x - 20, uid: 'same-lane-left' }),
    enemyAt({ laneIndex: 1, x: pad.x + 24, uid: 'other-lane-right' }),
  ];
  state.events = [];
  updateTowerDefense(state, 0.01);
  assert.equal(state.events.find(({ type }) => type === 'shot').targetUid, 'same-lane-right');
});

test('an unblocked enemy leaks at the left endpoint and damages the base', () => {
  const state = createBattleState();
  const lane = TD_STAGES[0].lanes[4];
  const metrics = pathMetrics(lane.path);
  holdCombat(state);
  const enemy = enemyAt({
    laneIndex: 4, x: lane.path.at(-1).x + 0.5,
    uid: 'left-leaker', speed: TD_ENEMIES.bug.speed,
  });
  state.enemies = [enemy];
  state.events = [];
  const hp = state.coreHp;
  updateTowerDefense(state, 0.05);
  assert.ok(enemy.travelled >= metrics.total);
  assert.equal(enemy.leaked, true);
  assert.equal(state.coreHp, hp - TD_ENEMIES.bug.coreDamage);
  assert.deepEqual(state.events.find(({ type }) => type === 'core-hit'), {
    type: 'core-hit', damage: TD_ENEMIES.bug.coreDamage,
  });
});

test('authored waves and endless pressure remain sharply capped', () => {
  assert.deepEqual(TD_STAGES.map((stage) => stage.waves.map(
    (groups) => groups.reduce((sum, entry) => sum + entry.count, 0),
  )), [
    [5, 7, 7, 7, 7],
    [8, 8, 8, 8, 8, 8],
    [9, 9, 9, 9, 9, 9, 9],
  ]);
  assert.ok(TD_ENEMIES.stone.hp >= TD_ENEMIES.bug.hp * 3);
  assert.ok(TD_ENEMIES.boss.hp >= TD_ENEMIES.stone.hp * 8);
  assert.deepEqual(stageScaleForWave(3, 10_000), TD_STAGE_SCALE_CAPS);
  assert.deepEqual(endlessScaleForWave(100), { ...TD_ENDLESS_SCALE_CAPS });
  for (const waveNumber of [1, 10, 30, 100]) {
    const state = createBattleState({ mode: 'endless' });
    state.wave = waveNumber - 1;
    assert.equal(startNextTowerDefenseWave(state), true);
    assert.equal(state.spawnQueue.length, TD_ENDLESS_SCALE_CAPS.count);
    assert.equal(state.spawnQueue.filter(({ type }) => type === 'boss').length,
      endlessScaleForWave(waveNumber).bossCount);
  }
});

test('legacy star attack data stays immutable for skeletal presentation', () => {
  for (const towerType of Object.keys(TOWER_TYPES)) {
    const steps = TOWER_ATTACK_EVOLUTIONS[towerType];
    assert.equal(steps.length, 4);
    assert.equal(Object.isFrozen(steps), true);
    assert.equal(new Set(steps.map(({ attackMode }) => attackMode)).size, 4);
    steps.forEach((step, index) => {
      assert.equal(Object.isFrozen(step), true);
      assert.equal(towerAttackEvolution(towerType, index + 1), step);
    });
  }
});

test('contract summons are menu-only, deterministic, atomic, priced, and guaranteed', () => {
  assert.deepEqual(TD_CONTRACT_SUMMON_COSTS, { 1: 100, 10: 900 });
  const poor = createTowerDefenseState({
    progress: { tutorialSeen: true, summonCurrency: 99, summonRngState: 123 },
  });
  const poorSnapshot = clone(poor);
  assert.equal(summonTowerDefenseContracts(poor, 1), null);
  assert.equal(summonTowerDefenseContracts(poor, 3), null);
  assert.deepEqual(poor, poorSnapshot);
  const battle = createBattleState({ progress: { summonCurrency: 5000 } });
  const battleSnapshot = clone(battle);
  assert.equal(summonTowerDefenseContracts(battle, 1), null);
  assert.deepEqual(battle, battleSnapshot);

  const progress = { tutorialSeen: true, summonCurrency: 900, summonRngState: 0xC0A7A5 };
  const left = createTowerDefenseState({ progress });
  const right = createTowerDefenseState({ progress });
  const results = summonTowerDefenseContracts(left, 10);
  assert.equal(results.length, 10);
  assert.deepEqual(results, summonTowerDefenseContracts(right, 10));
  assert.deepEqual(left.progress, right.progress);
  assert.equal(left.progress.summonCurrency, 0);
  assert.ok(results.some(({ rarity }) => rarity === 'epic'));
  const single = createTowerDefenseState({
    progress: { tutorialSeen: true, summonCurrency: 900, summonRngState: 456 },
  });
  assert.equal(summonTowerDefenseContracts(single, 1).length, 1);
  assert.equal(single.progress.summonCurrency, 800);
});

test('summons unlock first, duplicates grant shards/ranks, and selected hero persists', () => {
  const state = createTowerDefenseState({
    progress: { tutorialSeen: true, summonCurrency: 900, summonRngState: 0xC0A7A5 },
  });
  const knownRanks = { ...state.progress.contractRanks };
  const results = summonTowerDefenseContracts(state, 10);
  for (const result of results) {
    if (knownRanks[result.type] === 0) {
      assert.equal(result.unlocked, true);
      assert.equal(result.newRank, 1);
      assert.equal(result.shards, 0);
    } else {
      assert.equal(result.unlocked, false);
      assert.ok(result.drawShards > 0);
    }
    knownRanks[result.type] = result.newRank;
  }
  assert.deepEqual(state.progress.contractRanks, knownRanks);
  assert.ok(results.some(({ rankUps }) => rankUps > 1));
  const unlocked = TD_CONTRACT_TYPES.find((type) => (
    type !== 'shell' && state.progress.contractRanks[type] > 0
  ));
  assert.ok(unlocked);
  assert.equal(selectTowerDefenseHero(state, unlocked), true);
  assert.equal(state.heroes.filter(({ selected }) => selected).length, 1);
  const serialized = serializeTowerDefenseProgress(state);
  const restored = createTowerDefenseState({ progress: JSON.parse(JSON.stringify(serialized)) });
  assert.equal(restored.progress.selectedHero, unlocked);
  assert.equal(restored.heroes.find(({ selected }) => selected).type, unlocked);
  beginTowerDefenseRun(restored, { stageId: 'stage-1' });
  assert.equal(restored.hero.type, unlocked);
});

test('stage and endless outcomes grant persistent summon currency', () => {
  const stage = createBattleState({ progress: { summonCurrency: 0 } });
  stage.wave = TD_STAGES[0].waves.length;
  stage.phase = 'combat';
  stage.waveActive = true;
  stage.spawnQueue = [];
  stage.enemies = [];
  updateTowerDefense(stage, 0.01);
  assert.equal(stage.result, 'victory');
  assert.equal(stage.progress.summonCurrency, 150);
  assert.equal(stage.progress.unlockedStage, 2);
  assert.ok(stage.events.some(({ type, amount }) => (
    type === 'summon-currency-reward' && amount === 150
  )));

  const endless = createBattleState({ mode: 'endless', progress: { summonCurrency: 0 } });
  endless.wave = 9;
  endless.coreHp = 0;
  updateTowerDefense(endless, 0.01);
  assert.equal(endless.result, 'defeat');
  assert.equal(endless.progress.bestEndlessWave, 9);
  assert.equal(endless.progress.summonCurrency, 35 + 9 * 8);
});

test('first-run tutorial buys one melee squad and then starts combat', () => {
  const state = createTowerDefenseState({ seed: 0xCAFEBABE });
  assert.deepEqual(tutorialTargetForState(state), {
    type: 'stage', stageIndex: 0, label: '1',
  });
  assert.equal(beginTowerDefenseRun(state, { stageId: 'stage-1' }), true);
  assert.deepEqual(tutorialTargetForState(state), {
    type: 'squad', squadType: 'melee', padIndex: 0, label: '近',
  });
  assert.ok(buyTowerDefenseSquad(state, 'melee', 0));
  assert.deepEqual(tutorialTargetForState(state), { type: 'start', label: '战' });
  assert.equal(startNextTowerDefenseWave(state), true);
  assert.equal(state.tutorial.active, false);
  assert.equal(state.progress.tutorialSeen, true);
  assert.equal(tutorialTargetForState(state), null);
  assert.ok(state.events.some(({ type }) => type === 'tutorial-complete'));
});

test('progress normalization preserves hero meta and strips transient battle state', () => {
  const dirty = {
    unlockedStage: 99,
    clearedStages: ['stage-2', 'unknown-stage', 'stage-2', 'stage-1'],
    bestEndlessWave: 12.9,
    tutorialSeen: 'yes',
    summonCurrency: 777.9,
    summonPity: 99,
    summonRngState: 12345,
    contractShards: { shell: 2, needle: 5, bubble: 99, unknown: 4 },
    contractRanks: { shell: 3, needle: 2, bubble: 99, sprout: -3 },
    selectedHero: 'needle',
    transientValue: 123,
  };
  const normalized = normalizeTowerDefenseProgress(dirty);
  assert.deepEqual(normalized, {
    unlockedStage: TD_STAGES.length,
    clearedStages: ['stage-2', 'stage-1'],
    bestEndlessWave: 12,
    tutorialSeen: true,
    summonCurrency: 777,
    summonPity: 9,
    summonRngState: 12345,
    contractShards: { shell: 2, needle: 5, bubble: 5, sprout: 0 },
    contractRanks: { shell: 3, needle: 2, bubble: 10, sprout: 0 },
    selectedHero: 'needle',
  });
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.clearedStages), true);
  assert.equal(Object.isFrozen(normalized.contractShards), true);
  assert.equal(Object.isFrozen(normalized.contractRanks), true);
  const state = createTowerDefenseState({ progress: dirty });
  state.currency = 9999;
  state.wave = 44;
  state.towers.push({ uid: 'transient', squadType: 'melee', padIndex: 0 });
  const serialized = serializeTowerDefenseProgress(state);
  assert.deepEqual(serialized, normalized);
  for (const key of ['currency', 'wave', 'towers', 'hero', 'turrets']) {
    assert.equal(Object.hasOwn(serialized, key), false);
  }
  const restored = createTowerDefenseState({ progress: JSON.parse(JSON.stringify(serialized)) });
  assert.deepEqual(serializeTowerDefenseProgress(restored), serialized);
});
