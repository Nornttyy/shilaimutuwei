import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HERO_TYPES,
  SQUAD_TYPES,
  TD_CONTRACT_RARITIES,
  TD_CONTRACT_START_CURRENCY,
  TD_CONTRACT_SUMMON_COSTS,
  TD_CONTRACT_TYPES,
  TD_CARD_DOCK,
  TD_ENDLESS_SCALE_CAPS,
  TD_ENEMIES,
  TD_FIELD,
  TD_HERO_BOUNDS,
  TD_STAGE_SCALE_CAPS,
  TD_STAGES,
  TD_TURRET_SLOTS,
  TD_VIEW,
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

function travelledForY(lane, y) {
  const metrics = pathMetrics(lane.path);
  const targetY = y ?? lane.path[0].y;
  if (targetY <= lane.path[0].y) return 0;
  if (targetY >= lane.path.at(-1).y) return metrics.total;
  const segment = metrics.segments.find(({ start, end }) => (
    targetY >= start.y && targetY <= end.y
  ));
  assert.ok(segment, `expected path segment at y=${targetY}`);
  const ratio = (targetY - segment.start.y) / (segment.end.y - segment.start.y);
  return segment.from + segment.length * ratio;
}

function enemyAt({
  stage = TD_STAGES[0], laneIndex = 0, y, uid = 'probe-enemy',
  type = 'bug', hp = 100_000, speed = 0,
} = {}) {
  const lane = stage.lanes.find(({ index }) => index === laneIndex);
  assert.ok(lane, `expected lane ${laneIndex}`);
  const travelled = travelledForY(lane, y ?? lane.path[0].y);
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
  assert.deepEqual(Object.fromEntries(Object.entries(HERO_TYPES).map(([type, hero]) => (
    [type, { name: hero.name, rarity: hero.rarity }]
  ))), {
    shell: { name: '壳壳', rarity: 'R' },
    needle: { name: '亮钉', rarity: 'SR' },
    bubble: { name: '泡泡', rarity: 'SSR' },
    sprout: { name: '芽芽', rarity: 'UR' },
  });
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
    const squad = buyTowerDefenseSquad(state, squadType, 1);
    const pad = TD_STAGES[0].pads[1];
    holdCombat(state);
    const enemy = enemyAt({
      laneIndex: pad.laneIndex,
      y: pad.y - (squadType === 'melee' ? 20 : 120),
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
  const melee = buyTowerDefenseSquad(meleeState, 'melee', 1);
  const pad = TD_STAGES[0].pads[1];
  holdCombat(meleeState);
  const meleeEnemy = enemyAt({ laneIndex: 0, y: pad.y - 80, uid: 'melee-target', hp: 1e6 });
  meleeState.enemies = [meleeEnemy];
  melee.cooldown = 0;
  updateTowerDefense(meleeState, 0.05);
  assert.ok(melee.y < melee.deployY);
  assert.equal(meleeState.events.some(({ type }) => type === 'shot'), false);
  for (let tick = 0; tick < 80; tick += 1) updateTowerDefense(meleeState, 0.05);
  const meleeShot = meleeState.events.find(({ type }) => type === 'shot');
  assert.equal(meleeShot.attackMode, 'melee-contact');
  assert.equal(meleeShot.projectileCount, 0);
  assert.ok(meleeEnemy.hp < meleeEnemy.maxHp);

  const rangedState = createBattleState();
  const ranged = buyTowerDefenseSquad(rangedState, 'ranged', 1);
  holdCombat(rangedState);
  const rangedEnemy = enemyAt({ laneIndex: 0, y: pad.y - 74, uid: 'ranged-target', hp: 1e6 });
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
    laneIndex: 0, y: pad.y - 70, uid: 'squad-breaker', type: 'boss',
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
  squad.facing = -1;
  enemy.attackCooldown = 0;
  updateTowerDefense(state, 0.05);
  assert.equal(squad.hp, 0);
  assert.equal(squad.aliveMembers, 0);
  assert.equal(squad.downed, true);
  assert.equal(state.towers.includes(squad), true);
  assert.equal(state.events.filter(({ type }) => type === 'tower-defeat').length, 1);
  assert.equal(state.events.find(({ type }) => type === 'tower-defeat').facing, -1);
  updateTowerDefense(state, 0.05);
  assert.equal(state.events.filter(({ type }) => type === 'tower-defeat').length, 1);

  squad.y = pad.y - 160;
  state.spawnQueue = [];
  state.enemies = [];
  updateTowerDefense(state, 0.05);
  assert.equal(state.phase, 'prep');
  assert.equal(squad.hp, squad.maxHp);
  assert.equal(squad.aliveMembers, 4);
  assert.equal(squad.downed, false);
  assert.equal(squad.y, squad.deployY);
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
  const primary = enemyAt({ laneIndex: 0, y: turret.y - 100, uid: 'mortar-primary' });
  const splash = enemyAt({ laneIndex: 1, y: turret.y - 100, uid: 'mortar-splash' });
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
  state.hero.x = TD_HERO_BOUNDS.maxX - 1;
  state.hero.y = TD_HERO_BOUNDS.maxY - 1;
  updateTowerDefense(state, 0.05);
  assert.deepEqual({ x: state.hero.x, y: state.hero.y }, {
    x: TD_HERO_BOUNDS.maxX, y: TD_HERO_BOUNDS.maxY,
  });
  state.hero.x = TD_HERO_BOUNDS.minX + 1;
  state.hero.y = TD_HERO_BOUNDS.minY + 1;
  setTowerDefenseHeroMovement(state, -1, -1);
  updateTowerDefense(state, 0.05);
  assert.deepEqual({ x: state.hero.x, y: state.hero.y }, {
    x: TD_HERO_BOUNDS.minX, y: TD_HERO_BOUNDS.minY,
  });
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
  const near = enemyAt({ laneIndex: 2, y: hero.y - 90, uid: 'hero-near', hp: 1e6 });
  const far = enemyAt({
    laneIndex: 2, y: hero.y - HERO_TYPES.shell.skillRadius - 80,
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
  squad.y -= 140;
  squad.hp = squad.memberHp;
  squad.aliveMembers = 1;
  state.hero.y -= 200;
  state.spawnQueue = [];
  state.enemies = [];
  updateTowerDefense(state, 0.05);
  assert.equal(state.wave, 1);
  assert.equal(state.phase, 'prep');
  assert.equal(state.waveActive, false);
  assert.equal(state.waveBreak, 0);
  assert.equal(squad.y, squad.deployY);
  assert.equal(squad.hp, squad.maxHp);
  assert.equal(squad.aliveMembers, 4);
  assert.equal(state.hero.y, state.hero.spawnY);
  for (let tick = 0; tick < 300; tick += 1) updateTowerDefense(state, 0.05);
  assert.equal(state.wave, 1);
  assert.equal(state.waveActive, false);
  assert.equal(skipTowerDefenseBreak(state), true);
  assert.equal(state.wave, 2);
  assert.equal(state.phase, 'combat');
});

test('portrait stages share one top entrance, smoothly split into five lanes, then reach the core', () => {
  assert.deepEqual(TD_VIEW, { width: 720, height: 1280 });
  assert.equal(TD_FIELD.y + TD_FIELD.height < TD_CARD_DOCK.y, true);
  for (const stage of TD_STAGES) {
    assert.equal(stage.lanes.length, 5);
    assert.equal(stage.pads.length, 35);
    assert.equal(stage.path, stage.lanes[2].path);
    assert.deepEqual(
      stage.lanes.map(({ path }) => path[0]),
      Array.from({ length: 5 }, () => ({ x: TD_VIEW.width / 2, y: 222 })),
    );
    assert.deepEqual(
      stage.lanes.map(({ path }) => path[1]),
      Array.from({ length: 5 }, () => ({ x: TD_VIEW.width / 2, y: 226 })),
    );
    for (const lane of stage.lanes) {
      assert.ok(lane.path[0].y < lane.path.at(-1).y);
      assert.equal(lane.path.length, 8);
      assert.equal(lane.path.every((point, index) => (
        index === 0 || point.y > lane.path[index - 1].y
      )), true);
      assert.deepEqual(lane.path.at(-2), { x: lane.x, y: 286 });
      assert.deepEqual(lane.path.at(-1), { x: lane.x, y: 1002 });
      const direction = Math.sign(lane.x - TD_VIEW.width / 2);
      assert.equal(lane.path.every((point, index) => (
        index === 0
        || direction === 0
        || Math.sign(point.x - lane.path[index - 1].x) === direction
        || point.x === lane.path[index - 1].x
      )), true);
      if (direction !== 0) {
        const lateralSteps = lane.path.slice(2, -1).map((point, index) => (
          Math.abs(point.x - lane.path[index + 1].x)
        ));
        assert.ok(lateralSteps[0] < lateralSteps[2]);
        assert.ok(lateralSteps.every((step) => step >= 0));
      }
      assert.deepEqual(
        stage.pads.filter(({ laneIndex }) => laneIndex === lane.index)
          .map(({ rowIndex }) => rowIndex),
        [0, 1, 2, 3, 4, 5, 6],
      );
      assert.equal(stage.pads.filter(({ laneIndex }) => laneIndex === lane.index)
        .every(({ x }) => x === lane.x), true);
    }
    assert.equal(new Set(stage.pads.map(({ laneIndex, rowIndex }) => (
      `${laneIndex}:${rowIndex}`
    ))).size, 35);
    assert.ok(TD_TURRET_SLOTS[stage.id].length >= 4);
    const lowestSoldierY = Math.max(...stage.pads.map(({ y }) => y));
    assert.equal(TD_TURRET_SLOTS[stage.id].every(({ y }) => (
      y > lowestSoldierY && y < stage.base.y
    )), true);
    assert.equal(stage.path.at(-1).y < stage.base.y, true);
    assert.equal(stage.base.y < TD_CARD_DOCK.y, true);
    assert.equal(stage.base.goalY, stage.path.at(-1).y);
  }
});

test('ranged squads target only upstream enemies on the same vertical lane', () => {
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
    enemyAt({ laneIndex: 0, y: pad.y - 72, uid: 'same-lane-upstream' }),
    enemyAt({ laneIndex: 0, y: pad.y + 20, uid: 'same-lane-downstream' }),
    enemyAt({ laneIndex: 1, y: pad.y - 24, uid: 'other-lane-upstream' }),
  ];
  state.events = [];
  updateTowerDefense(state, 0.01);
  assert.equal(
    state.events.find(({ type }) => type === 'shot').targetUid,
    'same-lane-upstream',
  );
});

test('outer split uses true range and squads advance diagonally on their own route', () => {
  const state = createBattleState();
  const outerPad = TD_STAGES[0].pads.findIndex(({ laneIndex, rowIndex }) => (
    laneIndex === 0 && rowIndex === 0
  ));
  const squad = buyTowerDefenseSquad(state, 'ranged', outerPad);
  holdCombat(state);
  const trunkEnemy = enemyAt({ laneIndex: 0, y: 222, uid: 'trunk-out-of-range' });
  state.enemies = [trunkEnemy];
  squad.cooldown = 0;
  updateTowerDefense(state, 0.01);
  assert.equal(state.events.some(({ type }) => type === 'shot'), false,
    'route progress alone must not bridge the 272px lateral split');

  const movingState = createBattleState();
  const movingPad = TD_STAGES[0].pads.findIndex(({ laneIndex, rowIndex }) => (
    laneIndex === 0 && rowIndex === 1
  ));
  const melee = buyTowerDefenseSquad(movingState, 'melee', movingPad);
  holdCombat(movingState);
  movingState.enemies = [enemyAt({ laneIndex: 0, y: 222, uid: 'split-target' })];
  const before = { x: melee.x, y: melee.y };
  for (let tick = 0; tick < 30; tick += 1) updateTowerDefense(movingState, 0.05);
  assert.ok(melee.y < before.y);
  assert.ok(melee.x > before.x, 'outer squad follows the diagonal branch toward the trunk');
  const lane = TD_STAGES[0].lanes[0];
  const travelled = travelledForY(lane, melee.y);
  const expected = pointOnPath(lane.path, travelled);
  assert.ok(Math.hypot(melee.x - expected.x, melee.y - expected.y) < 0.01);
});

test('squads lock the foremost lane target on its spawn frame before it enters range', () => {
  const state = createBattleState();
  const padIndex = TD_STAGES[0].pads.findIndex(({ laneIndex, rowIndex }) => (
    laneIndex === 0 && rowIndex === 4
  ));
  const squad = buyTowerDefenseSquad(state, 'ranged', padIndex);
  holdCombat(state);
  const rear = enemyAt({ laneIndex: 0, y: 222, uid: 'rear', hp: 1e6 });
  const front = enemyAt({ laneIndex: 0, y: 250, uid: 'front', hp: 1e6 });
  state.enemies = [rear, front];
  squad.cooldown = 0;
  updateTowerDefense(state, 0.01);
  assert.equal(squad.targetUid, front.uid);
  assert.ok(Number.isFinite(squad.aimAngle));
  assert.equal(squad.facing, 1);
  assert.equal(state.events.some(({ type }) => type === 'shot'), false);
  assert.equal(squad.moving, true);

  front.hp = 0;
  updateTowerDefense(state, 0.01);
  assert.equal(squad.targetUid, rear.uid, 'dead targets are replaced on the next update');
});

test('blockers use projection onto each enemy path and shared-trunk hero blocks all routes', () => {
  const state = createBattleState();
  const outerPad = TD_STAGES[0].pads.findIndex(({ laneIndex, rowIndex }) => (
    laneIndex === 0 && rowIndex === 0
  ));
  const squad = buyTowerDefenseSquad(state, 'melee', outerPad);
  holdCombat(state);
  squad.cooldown = 999;
  state.hero.x = 360;
  state.hero.y = 226;
  state.hero.hp = state.hero.maxHp;
  state.hero.cooldown = 999;
  const enemies = Array.from({ length: 5 }, (_, laneIndex) => enemyAt({
    laneIndex, y: 222, uid: `shared-${laneIndex}`, speed: 20,
  }));
  state.enemies = enemies;
  updateTowerDefense(state, 0.1);
  assert.deepEqual(enemies.map(({ blockedByTowerUid }) => blockedByTowerUid),
    Array.from({ length: 5 }, () => state.hero.uid));
  assert.notEqual(enemies[0].blockedByTowerUid, squad.uid,
    'outer squad cannot contact an enemy hundreds of pixels away on the trunk');
});

test('an unblocked enemy leaks at the bottom endpoint and damages the base', () => {
  const state = createBattleState();
  const lane = TD_STAGES[0].lanes[4];
  const metrics = pathMetrics(lane.path);
  holdCombat(state);
  const enemy = enemyAt({
    laneIndex: 4, y: lane.path.at(-1).y - 0.5,
    uid: 'bottom-leaker', speed: TD_ENEMIES.bug.speed,
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
  const formerEnemyStats = {
    bug: { hp: 40, speed: 36, attackDamage: 9, coreDamage: 1 },
    windcap: { hp: 36, speed: 54, attackDamage: 8, coreDamage: 2 },
    stone: { hp: 140, speed: 26, attackDamage: 18, coreDamage: 2 },
    boss: { hp: 1150, speed: 20, attackDamage: 38, coreDamage: 10 },
  };
  for (const [type, former] of Object.entries(formerEnemyStats)) {
    const strengthened = TD_ENEMIES[type];
    assert.ok(strengthened.hp >= former.hp * 2.2, `${type} health remains visibly stronger`);
    assert.ok(strengthened.attackDamage >= former.attackDamage * 2,
      `${type} contact damage is visibly stronger`);
    assert.ok(strengthened.coreDamage > former.coreDamage,
      `${type} fortress contact is more dangerous`);
    assert.ok(strengthened.speed > former.speed && strengthened.speed <= former.speed * 1.06,
      `${type} speed only rises slightly`);
  }
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

function simulateStarterLineup({ heroActive }) {
  const state = createBattleState({ seed: 0x51A7E });
  const stage = TD_STAGES[0];
  const padIndex = (laneIndex, rowIndex) => stage.pads.findIndex((pad) => (
    pad.laneIndex === laneIndex && pad.rowIndex === rowIndex
  ));
  assert.ok(buyTowerDefenseSquad(state, 'melee', padIndex(0, 0)));
  assert.ok(buyTowerDefenseSquad(state, 'ranged', padIndex(2, 4)));
  assert.ok(buildTowerDefenseTurret(state, 1));
  assert.equal(state.currency, 75);
  if (!heroActive) state.hero.hp = 0;

  let ticks = 0;
  while (!state.result && ticks < 8000) {
    if (!state.waveActive && state.phase === 'prep') {
      assert.equal(startNextTowerDefenseWave(state), true);
    }
    if (heroActive && state.waveActive && state.hero?.hp > 0) {
      const target = [...state.enemies]
        .filter((enemy) => enemy.hp > 0)
        .sort((left, right) => right.travelled - left.travelled)[0];
      if (target) {
        const targetY = Math.min(TD_HERO_BOUNDS.maxY, target.y + 84);
        const dx = target.x - state.hero.x;
        const dy = targetY - state.hero.y;
        const magnitude = Math.hypot(dx, dy) || 1;
        setTowerDefenseHeroMovement(state, dx / magnitude, dy / magnitude);
        const heroDefinition = HERO_TYPES[state.hero.type];
        if (
          state.hero.skillCooldown <= 0
          && Math.hypot(target.x - state.hero.x, target.y - state.hero.y)
            <= heroDefinition.skillRadius
        ) activateTowerDefenseHeroSkill(state);
      } else {
        setTowerDefenseHeroMovement(state, 0, 0);
      }
    }
    updateTowerDefense(state, 0.05);
    ticks += 1;
  }
  assert.ok(ticks < 8000, 'the five-wave simulation cannot deadlock');
  assert.equal(state.enemies.length, 0);
  assert.equal(state.spawnQueue.length, 0);
  return state;
}

test('the starter lineup clears stage one only when the player hero participates', () => {
  const active = simulateStarterLineup({ heroActive: true });
  assert.equal(active.result, 'victory');
  assert.equal(active.wave, 5);
  assert.equal(active.coreHp, 19);
  assert.equal(active.kills, 32);

  const idle = simulateStarterLineup({ heroActive: false });
  assert.equal(idle.result, 'defeat');
  assert.equal(idle.wave, 5);
  assert.equal(idle.coreHp, 0);
  assert.ok(idle.kills < active.kills);
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
  assert.deepEqual(Object.fromEntries(Object.entries(TD_CONTRACT_RARITIES).map(([
    rarity, definition,
  ]) => [rarity, definition.weight])), { R: 60, SR: 27, SSR: 10, UR: 3 });
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
  assert.ok(results.some(({ rarity }) => ['SSR', 'UR'].includes(rarity)));
  assert.equal(results.every(({ type, rarity }) => HERO_TYPES[type].rarity === rarity), true);
  const single = createTowerDefenseState({
    progress: { tutorialSeen: true, summonCurrency: 900, summonRngState: 456 },
  });
  assert.equal(summonTowerDefenseContracts(single, 1).length, 1);
  assert.equal(single.progress.summonCurrency, 800);

  const pity = createTowerDefenseState({
    progress: {
      tutorialSeen: true, summonCurrency: 100, summonPity: 9, summonRngState: 1,
    },
  });
  const guaranteed = summonTowerDefenseContracts(pity, 1)[0];
  assert.ok(['SSR', 'UR'].includes(guaranteed.rarity));
  assert.equal(guaranteed.rarity, HERO_TYPES[guaranteed.type].rarity);
  assert.equal(pity.progress.summonPity, 0);

  const distribution = createTowerDefenseState({
    progress: { tutorialSeen: true, summonCurrency: 40_000, summonRngState: 0xA11CE },
  });
  const rarityCounts = { R: 0, SR: 0, SSR: 0, UR: 0 };
  for (let index = 0; index < 400; index += 1) {
    rarityCounts[summonTowerDefenseContracts(distribution, 1)[0].rarity] += 1;
  }
  assert.ok(rarityCounts.R > rarityCounts.SR);
  assert.ok(rarityCounts.SR > rarityCounts.SSR);
  assert.ok(rarityCounts.SSR > rarityCounts.UR);
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
  assert.ok(results.some(({ rankUps }) => rankUps > 0));
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
