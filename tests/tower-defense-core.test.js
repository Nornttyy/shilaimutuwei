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
  heroStatsForRank,
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
    berry: { name: '莓莓', rarity: 'SR' },
    dew: { name: '露露', rarity: 'SSR' },
  });
  const state = createTowerDefenseState({ progress: {} });
  assert.equal(state.progress.summonCurrency, TD_CONTRACT_START_CURRENCY);
  assert.deepEqual(state.progress.contractRanks, {
    shell: 1, needle: 0, bubble: 0, sprout: 0, berry: 0, dew: 0,
  });
  assert.equal(state.progress.selectedHero, 'shell');
  assert.deepEqual(state.heroes.filter(({ owned }) => owned).map(({ type }) => type), ['shell']);
  for (const type of TD_CONTRACT_TYPES) {
    const rosterHero = state.heroes.find((hero) => hero.type === type);
    const definition = HERO_TYPES[type];
    assert.deepEqual({
      role: rosterHero.role,
      skillName: rosterHero.skillName,
      skillDescription: rosterHero.skillDescription,
      skillCooldown: rosterHero.skillCooldown,
      skillRadius: rosterHero.skillRadius,
      skillStageCount: rosterHero.skillStageCount,
    }, {
      role: definition.role,
      skillName: definition.skill.name,
      skillDescription: definition.skill.description,
      skillCooldown: definition.skill.cooldown,
      skillRadius: definition.skill.radius,
      skillStageCount: 3,
    }, `${type} roster supplies precise skill information to the UI`);
  }
  assert.equal(selectTowerDefenseHero(state, 'needle'), false);
  assert.equal(selectTowerDefenseHero(state, 'shell'), true);
  assert.equal(beginTowerDefenseRun(state, { stageId: 'stage-1' }), true);
  assert.equal(state.phase, 'prep');
  assert.equal(state.hero.kind, 'hero');
  assert.equal(state.hero.type, 'shell');
  assert.equal(state.hero.rank, 1);
  assert.equal(state.towers.length, 0);
});

test('all six hero ranks use one bounded data-driven combat growth calculation', () => {
  for (const type of TD_CONTRACT_TYPES) {
    const rankOne = heroStatsForRank(type, 1);
    const rankTen = heroStatsForRank(type, 10);
    const skillTotal = (stats, key) => stats.skillSteps.reduce(
      (total, step) => total + Math.max(0, Number(step[key]) || 0),
      0,
    );
    const improved = rankTen.maxHp > rankOne.maxHp
      || rankTen.damage > rankOne.damage
      || rankTen.attackSpeed > rankOne.attackSpeed
      || skillTotal(rankTen, 'damage') > skillTotal(rankOne, 'damage')
      || skillTotal(rankTen, 'poisonDps') > skillTotal(rankOne, 'poisonDps')
      || skillTotal(rankTen, 'healHero') > skillTotal(rankOne, 'healHero')
      || skillTotal(rankTen, 'healMembers') > skillTotal(rankOne, 'healMembers')
      || skillTotal(rankTen, 'shieldHp') > skillTotal(rankOne, 'shieldHp');
    assert.equal(improved, true, `${type} gains a real combat benefit from rank 1 to rank 10`);
    assert.ok(rankTen.maxHp <= HERO_TYPES[type].maxHp * 1.25);
    assert.ok(rankTen.damage <= HERO_TYPES[type].damage * 1.25);
    assert.ok(rankTen.attackSpeed <= (1 / HERO_TYPES[type].interval) * 1.25 + 0.01);
    assert.ok(rankTen.growthSummary.includes('每阶'));

    const ranks = Object.fromEntries(TD_CONTRACT_TYPES.map((heroType) => [
      heroType, heroType === type ? 10 : 0,
    ]));
    const state = createBattleState({
      progress: { selectedHero: type, contractRanks: ranks },
    });
    assert.deepEqual({
      maxHp: state.hero.maxHp,
      damage: state.hero.damage,
      interval: state.hero.interval,
      skillEffect: state.hero.skillEffect,
    }, {
      maxHp: rankTen.maxHp,
      damage: rankTen.damage,
      interval: rankTen.interval,
      skillEffect: rankTen.skillEffect,
    });
    const rosterHero = state.heroes.find((hero) => hero.type === type);
    assert.deepEqual({
      maxHp: rosterHero.maxHp,
      damage: rosterHero.damage,
      interval: rosterHero.interval,
      attackSpeed: rosterHero.attackSpeed,
      skillEffect: rosterHero.skillEffect,
      growthSummary: rosterHero.growthSummary,
    }, {
      maxHp: rankTen.maxHp,
      damage: rankTen.damage,
      interval: rankTen.interval,
      attackSpeed: rankTen.attackSpeed,
      skillEffect: rankTen.skillEffect,
      growthSummary: rankTen.growthSummary,
    }, `${type} roster and simulation expose identical rank stats`);
  }
});

test('direct squad purchase is prep-only, correctly priced, one-cell, and atomic', () => {
  assert.deepEqual(Object.keys(SQUAD_TYPES), ['melee', 'ranged', 'charger', 'leaf']);
  assert.equal(SQUAD_TYPES.melee.cost, 100);
  assert.equal(SQUAD_TYPES.melee.squadSize, 4);
  assert.equal(SQUAD_TYPES.ranged.cost, 150);
  assert.equal(SQUAD_TYPES.ranged.squadSize, 4);
  assert.equal(SQUAD_TYPES.charger.cost, 125);
  assert.equal(SQUAD_TYPES.charger.movementMode, 'contact');
  assert.equal(SQUAD_TYPES.leaf.cost, 165);
  assert.equal(SQUAD_TYPES.leaf.effect, 'poison');
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
  assert.equal(melee.members.length, 4);
  assert.equal(new Set(melee.members.map(({ uid }) => uid)).size, 4);
  assert.equal(new Set(melee.members.map(({ x, y }) => `${x}:${y}`)).size, 4);
  for (const member of melee.members) {
    assert.deepEqual({
      facing: member.facing,
      targetId: member.targetId,
      hp: member.hp,
      alive: member.alive,
      moving: member.moving,
    }, {
      facing: 1,
      targetId: null,
      hp: SQUAD_TYPES.melee.memberHp,
      alive: true,
      moving: false,
    });
    assert.ok(Number.isFinite(member.x));
    assert.ok(Number.isFinite(member.y));
    assert.ok(Number.isFinite(member.attackCooldown));
  }

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
      y: pad.y - 20,
      uid: `${squadType}-damage-target`, hp: 1_000_000,
    });
    state.enemies = [enemy];
    squad.members.forEach((member) => { member.attackCooldown = 0; });
    state.events = [];
    updateTowerDefense(state, 0.01);
    const full = state.events.filter(({ type }) => type === 'shot');
    assert.equal(full.length, 4);
    assert.equal(new Set(full.map(({ soldierUid }) => soldierUid)).size, 4);
    assert.equal(full.reduce((sum, event) => sum + event.damage, 0),
      SQUAD_TYPES[squadType].damagePerMember * 4);

    // Aggregate HP is deliberately written here to cover old battle saves and
    // callers that predate per-member health.
    squad.hp = SQUAD_TYPES[squadType].memberHp * 2;
    squad.members.forEach((member) => { member.attackCooldown = 0; });
    enemy.hp = enemy.maxHp;
    state.projectiles = [];
    state.events = [];
    updateTowerDefense(state, 0.01);
    const reduced = state.events.filter(({ type }) => type === 'shot');
    assert.equal(squad.aliveMembers, 2);
    assert.equal(reduced.length, 2);
    assert.equal(reduced.reduce((sum, event) => sum + event.damage, 0),
      SQUAD_TYPES[squadType].damagePerMember * 2);
    assert.equal(reduced.every(({ aliveMembers }) => aliveMembers === 2), true);
    assert.equal(state.projectiles.length, squadType === 'ranged' ? 2 : 0);
  }
});

test('legacy aggregate squads migrate into independent serialisable members', () => {
  const state = createBattleState();
  const squad = buyTowerDefenseSquad(state, 'ranged', 3);
  const retainedHp = SQUAD_TYPES.ranged.memberHp * 2 + 7;
  delete squad.members;
  squad.hp = retainedHp;
  squad.aliveMembers = 3;
  holdCombat(state);
  updateTowerDefense(state, 0.01);
  assert.equal(squad.members.length, 4);
  assert.equal(squad.hp, retainedHp);
  assert.equal(squad.aliveMembers, 3);
  assert.deepEqual(squad.members.map(({ hp }) => hp), [48, 48, 7, 0]);
  assert.equal(new Set(squad.members.map(({ x, y }) => `${x}:${y}`)).size, 4);
  assert.doesNotThrow(() => JSON.stringify(state));
});

test('melee closes to contact while ranged fires a long-distance projectile', () => {
  const meleeState = createBattleState();
  const melee = buyTowerDefenseSquad(meleeState, 'melee', 1);
  const pad = TD_STAGES[0].pads[1];
  holdCombat(meleeState);
  const meleeEnemy = enemyAt({ laneIndex: 0, y: pad.y - 80, uid: 'melee-target', hp: 1e6 });
  meleeState.enemies = [meleeEnemy];
  melee.members.forEach((member) => { member.attackCooldown = 0; });
  const meleeStarts = melee.members.map(({ x, y }) => ({ x, y }));
  updateTowerDefense(meleeState, 0.05);
  assert.ok(melee.y < melee.deployY);
  for (let tick = 0; tick < 80; tick += 1) updateTowerDefense(meleeState, 0.05);
  const meleeShots = meleeState.events.filter(({ type }) => type === 'shot');
  const meleeShot = meleeShots[0];
  assert.ok(meleeShot);
  assert.equal(meleeShot.attackMode, 'melee-contact');
  assert.equal(meleeShot.projectileCount, 0);
  assert.ok(melee.members.every((member, index) => (
    Math.hypot(member.x - meleeStarts[index].x, member.y - meleeStarts[index].y) > 0
  )));
  assert.ok(meleeEnemy.hp < meleeEnemy.maxHp);

  const rangedState = createBattleState();
  const ranged = buyTowerDefenseSquad(rangedState, 'ranged', 1);
  holdCombat(rangedState);
  const rangedEnemy = enemyAt({ laneIndex: 0, y: pad.y - 74, uid: 'ranged-target', hp: 1e6 });
  rangedState.enemies = [rangedEnemy];
  ranged.members.forEach((member) => { member.attackCooldown = 0; });
  rangedState.events = [];
  updateTowerDefense(rangedState, 0.01);
  const rangedShots = rangedState.events.filter(({ type }) => type === 'shot');
  assert.equal(rangedShots.length, 4);
  assert.equal(rangedShots.every(({ attackMode }) => attackMode === 'ranged-volley'), true);
  assert.equal(rangedShots.every(({ projectileCount }) => projectileCount === 1), true);
  assert.equal(rangedState.projectiles.length, 4);
  assert.equal(rangedState.projectiles[0].sourceKind, 'squad');
  assert.equal(rangedState.projectiles[0].damage, SQUAD_TYPES.ranged.damagePerMember);
  resolveProjectiles(rangedState);
  assert.ok(rangedEnemy.hp < rangedEnemy.maxHp);
});

test('new squads use movementMode and apply their authored contact or poison attacks', () => {
  const chargerState = createBattleState();
  const charger = buyTowerDefenseSquad(chargerState, 'charger', 1);
  const pad = TD_STAGES[0].pads[1];
  holdCombat(chargerState);
  const chargerTarget = enemyAt({
    laneIndex: pad.laneIndex, y: pad.y - 62, uid: 'charger-target', hp: 10_000,
  });
  chargerState.enemies = [chargerTarget];
  charger.members.forEach((member) => { member.attackCooldown = 0; });
  updateTowerDefense(chargerState, 0.05);
  assert.ok(chargerTarget.hp < chargerTarget.maxHp);
  assert.equal(chargerState.projectiles.length, 0);
  assert.equal(chargerState.events.filter(({ attackMode }) => (
    attackMode === 'bounce-hammer'
  )).length > 0, true);

  const leafState = createBattleState();
  const leaf = buyTowerDefenseSquad(leafState, 'leaf', 1);
  holdCombat(leafState);
  const leafTarget = enemyAt({
    laneIndex: pad.laneIndex, y: pad.y - 90, uid: 'leaf-target', hp: 10_000,
  });
  leafState.enemies = [leafTarget];
  leaf.members.forEach((member) => { member.attackCooldown = 0; });
  updateTowerDefense(leafState, 0.01);
  assert.equal(leafState.projectiles.length, 4);
  assert.equal(leafState.projectiles.every(({ effect }) => effect === 'poison'), true);
  resolveProjectiles(leafState);
  assert.ok(leafTarget.hp < leafTarget.maxHp);
  assert.ok(leafTarget.poisonDps > 0);
  assert.ok(leafTarget.poisonTime > 0);
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
  const memberDown = state.events.find(({ type }) => type === 'squad-member-down');
  assert.ok(memberDown);
  assert.ok(memberDown.soldierUid);
  assert.ok(Number.isInteger(memberDown.memberIndex));
  assert.equal(squad.members[memberDown.memberIndex].alive, false);
  assert.equal(squad.members[memberDown.memberIndex].downed, true);
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
  assert.equal(squad.members.every((member) => (
    member.alive && !member.downed && member.hp === member.maxHp
    && member.x === member.deployX && member.y === member.deployY
    && member.targetId === null && member.moving === false
  )), true);
});

test('contact damage keeps the original member index after an earlier member is down', () => {
  const state = createBattleState();
  const squad = buyTowerDefenseSquad(state, 'melee', 0);
  const pad = TD_STAGES[0].pads[0];
  holdCombat(state);
  const enemy = enemyAt({
    laneIndex: 0, y: pad.y, uid: 'index-probe', hp: 1e6, speed: 0,
  });
  enemy.attackDamage = 19;
  enemy.attackCooldown = 0;
  state.enemies = [enemy];
  state.events = [];

  squad.members[0].hp = 0;
  squad.members[0].alive = false;
  squad.members[0].downed = true;
  for (const member of squad.members.slice(1)) {
    member.hp = member.maxHp;
    member.alive = true;
    member.attackCooldown = 999;
  }
  squad.members[1].x = TD_HERO_BOUNDS.maxX;
  squad.members[1].y = TD_HERO_BOUNDS.maxY;
  squad.members[2].x = enemy.x;
  squad.members[2].y = enemy.y;
  squad.members[3].x = TD_HERO_BOUNDS.maxX;
  squad.members[3].y = TD_HERO_BOUNDS.maxY - 80;
  squad.hp = squad.members.reduce((total, member) => total + member.hp, 0);

  const fullMemberHp = squad.members[2].maxHp;
  updateTowerDefense(state, 0.01);
  assert.deepEqual(squad.members.map(({ hp }) => hp), [
    0, fullMemberHp, fullMemberHp - 19, fullMemberHp,
  ]);
  const hit = state.events.find(({ type }) => type === 'tower-hit');
  assert.equal(hit?.soldierUid, squad.members[2].uid);
  assert.equal(hit?.memberIndex, 2);
});

test('gel mortar costs 175, uses fixed slots, cannot move, and splashes across lanes', () => {
  assert.deepEqual(Object.keys(TURRET_TYPES), [
    'gel-mortar', 'bubble-coil', 'crystal-repeater',
  ]);
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

test('new turrets preserve their slow and pierce effects instead of inheriting mortar splash', () => {
  const slowState = createBattleState();
  const slowTurret = buildTowerDefenseTurret(slowState, 0, 'bubble-coil');
  assert.ok(slowTurret);
  holdCombat(slowState);
  const slowTarget = enemyAt({
    laneIndex: 0, y: slowTurret.y - 100, uid: 'slow-target', hp: 10_000,
  });
  slowState.enemies = [slowTarget];
  slowTurret.cooldown = 0;
  updateTowerDefense(slowState, 0.01);
  assert.equal(slowState.projectiles[0].effect, 'slow');
  resolveProjectiles(slowState);
  assert.equal(slowTarget.slowMultiplier, TURRET_TYPES['bubble-coil'].slowMultiplier);
  assert.ok(slowTarget.slowTime > 0);

  const pierceState = createBattleState();
  const pierceTurret = buildTowerDefenseTurret(pierceState, 0, 'crystal-repeater');
  assert.ok(pierceTurret);
  holdCombat(pierceState);
  const primary = enemyAt({
    laneIndex: 0, y: pierceTurret.y - 100, uid: 'pierce-primary', hp: 10_000,
  });
  const secondary = enemyAt({
    laneIndex: 0, y: pierceTurret.y - 150, uid: 'pierce-secondary', hp: 10_000,
  });
  pierceState.enemies = [primary, secondary];
  pierceTurret.cooldown = 0;
  updateTowerDefense(pierceState, 0.01);
  assert.equal(pierceState.projectiles[0].effect, 'pierce');
  resolveProjectiles(pierceState);
  assert.ok(primary.hp < primary.maxHp);
  assert.ok(secondary.hp < secondary.maxHp);
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

test('all six heroes execute serialisable three-step skills with distinct gameplay effects', () => {
  const snapshots = {};
  for (const type of TD_CONTRACT_TYPES) {
    const state = createBattleState({
      progress: {
        contractRanks: { shell: 1, [type]: 1 },
        selectedHero: type,
      },
    });
    const squad = buyTowerDefenseSquad(state, 'melee', 0);
    assert.ok(squad);
    assert.equal(startNextTowerDefenseWave(state), true);
    state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
    state.hero.cooldown = 999;
    state.hero.hp = state.hero.maxHp - 200;
    squad.members.forEach((member) => { member.hp = member.maxHp - 24; });
    squad.hp = squad.members.reduce((total, member) => total + member.hp, 0);
    const target = enemyAt({
      laneIndex: 2,
      y: state.hero.y - 90,
      uid: `${type}-skill-target`,
      hp: 100_000,
      speed: 0,
    });
    target.attackCooldown = 999;
    state.enemies = [target];
    state.events = [];
    const initial = {
      enemyHp: target.hp,
      heroHp: state.hero.hp,
      memberHp: squad.members[0].hp,
    };
    assert.equal(HERO_TYPES[type].skill.steps.length, 3);
    assert.deepEqual(HERO_TYPES[type].skill.steps.map(({ stage }) => stage), [1, 2, 3]);
    assert.ok(HERO_TYPES[type].skill.name.length >= 3);
    assert.ok(HERO_TYPES[type].skill.description.length >= 12);
    assert.equal(activateTowerDefenseHeroSkill(state), true);
    assert.doesNotThrow(() => JSON.stringify(state.heroSkillQueue));
    assert.deepEqual(state.heroSkillQueue.map(({ stage, stepIndex, skillId }) => ({
      stage, stepIndex, skillId,
    })), [1, 2].map((stepIndex) => ({
      stage: stepIndex + 1,
      stepIndex,
      skillId: HERO_TYPES[type].skill.id,
    })));
    assert.equal(state.events.filter(({ type: eventType }) => (
      eventType === 'hero-skill-step'
    )).length, 1);
    const immediateStep = state.events.find(({ type: eventType }) => (
      eventType === 'hero-skill-step'
    ));
    assert.deepEqual({
      stage: immediateStep.stage,
      stepIndex: immediateStep.stepIndex,
      skillName: immediateStep.skillName,
      stepKind: immediateStep.stepKind,
    }, {
      stage: 1,
      stepIndex: 0,
      skillName: HERO_TYPES[type].skill.name,
      stepKind: HERO_TYPES[type].skill.steps[0].kind,
    });
    for (let tick = 0; tick < 22; tick += 1) updateTowerDefense(state, 0.05);
    const steps = state.events.filter(({ type: eventType, heroType }) => (
      eventType === 'hero-skill-step' && heroType === type
    ));
    assert.equal(steps.length, 3, `${type} resolves exactly three authored steps`);
    assert.deepEqual(steps.map(({ stepIndex }) => stepIndex), [0, 1, 2]);
    assert.deepEqual(steps.map(({ stage }) => stage), [1, 2, 3]);
    assert.equal(steps.every(({ skillName }) => skillName === HERO_TYPES[type].skill.name), true);
    assert.equal(state.heroSkillQueue.length, 0);
    assert.ok(target.hp < initial.enemyHp, `${type} deals real skill damage`);
    snapshots[type] = {
      damage: initial.enemyHp - target.hp,
      heroHealing: state.hero.hp - initial.heroHp,
      memberHealing: squad.members[0].hp - initial.memberHp,
      slowMultiplier: target.slowMultiplier,
      slowTime: target.slowTime,
      poisonDps: target.poisonDps,
      poisonTime: target.poisonTime,
      shieldHp: state.hero.shieldHp,
    };
  }

  assert.ok(snapshots.shell.shieldHp > 0);
  assert.equal(snapshots.needle.damage > snapshots.shell.damage * 0.7, true);
  assert.ok(snapshots.bubble.slowMultiplier < 1 && snapshots.bubble.slowTime > 0);
  assert.ok(snapshots.sprout.poisonDps > 0 && snapshots.sprout.poisonTime > 0);
  assert.ok(snapshots.sprout.heroHealing > 0 && snapshots.sprout.memberHealing > 0);
  assert.ok(snapshots.berry.damage > snapshots.dew.damage * 2);
  assert.ok(snapshots.dew.heroHealing > 0 && snapshots.dew.memberHealing > 0);
  assert.ok(snapshots.dew.slowMultiplier < 1);
  assert.equal(new Set(TD_CONTRACT_TYPES.map((type) => HERO_TYPES[type].skill.id)).size, 6);
  assert.equal(new Set(TD_CONTRACT_TYPES.map((type) => HERO_TYPES[type].skill.name)).size, 6);
  assert.equal(new Set(TD_CONTRACT_TYPES.map((type) => HERO_TYPES[type].skill.description)).size, 6);
});

test('queued hero skill steps survive a JSON save and resume in order', () => {
  const state = createBattleState({
    progress: {
      contractRanks: { shell: 1, bubble: 1 },
      selectedHero: 'bubble',
    },
  });
  assert.equal(startNextTowerDefenseWave(state), true);
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  state.hero.cooldown = 999;
  state.enemies = [enemyAt({
    laneIndex: 2, y: state.hero.y - 90, uid: 'saved-skill-target', hp: 100_000, speed: 0,
  })];
  state.enemies[0].attackCooldown = 999;
  assert.equal(activateTowerDefenseHeroSkill(state), true);

  const restored = JSON.parse(JSON.stringify(state));
  for (let tick = 0; tick < 22; tick += 1) updateTowerDefense(restored, 0.05);
  assert.deepEqual(restored.events.filter(({ type }) => type === 'hero-skill-step')
    .map(({ stepIndex }) => stepIndex), [0, 1, 2]);
  assert.equal(restored.heroSkillQueue.length, 0);
});

test('shell skill shield absorbs contact damage before hero health', () => {
  const state = createBattleState();
  assert.equal(startNextTowerDefenseWave(state), true);
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  state.hero.cooldown = 999;
  state.enemies = [enemyAt({
    laneIndex: 2, y: state.hero.y - 90, uid: 'shield-charge', hp: 100_000, speed: 0,
  })];
  state.enemies[0].attackCooldown = 999;
  assert.equal(activateTowerDefenseHeroSkill(state), true);
  for (let tick = 0; tick < 13; tick += 1) updateTowerDefense(state, 0.05);
  assert.equal(state.hero.shieldHp, 180);
  const attacker = enemyAt({
    laneIndex: 2, y: state.hero.y - 60, uid: 'shield-attacker', type: 'boss',
    hp: 100_000, speed: 0,
  });
  const lane = TD_STAGES[0].lanes[2];
  attacker.travelled = travelledForY(lane, state.hero.y) - (36 + TD_ENEMIES.boss.size * 0.18);
  Object.assign(attacker, pointOnPath(lane.path, attacker.travelled));
  attacker.attackDamage = 100;
  attacker.attackCooldown = 0;
  state.enemies = [attacker];
  const hpBefore = state.hero.hp;
  updateTowerDefense(state, 0.01);
  assert.equal(state.hero.hp, hpBefore);
  assert.equal(state.hero.shieldHp, 80);
  const hit = state.events.findLast(({ type }) => type === 'hero-hit');
  assert.deepEqual({ damage: hit.damage, absorbed: hit.absorbed }, {
    damage: 0, absorbed: 100,
  });
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
  assert.equal(squad.members.every((member) => (
    member.hp === member.maxHp && member.alive && !member.downed
    && member.x === member.deployX && member.y === member.deployY
  )), true);
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

test('four members keep separate positions and acquire targets in every direction', () => {
  const state = createBattleState();
  const stage = TD_STAGES[0];
  const padIndex = stage.pads.findIndex(({ laneIndex, rowIndex }) => (
    laneIndex === 2 && rowIndex === 3
  ));
  const squad = buyTowerDefenseSquad(state, 'ranged', padIndex);
  const pad = stage.pads[padIndex];
  holdCombat(state);
  squad.members.forEach((member) => { member.attackCooldown = 999; });
  state.enemies = [
    enemyAt({ laneIndex: 2, y: pad.y - 80, uid: 'north' }),
    enemyAt({ laneIndex: 2, y: pad.y + 80, uid: 'south' }),
    enemyAt({ laneIndex: 1, y: pad.y, uid: 'west' }),
    enemyAt({ laneIndex: 3, y: pad.y, uid: 'east' }),
  ];
  updateTowerDefense(state, 0.01);
  assert.equal(new Set(squad.members.map(({ x, y }) => `${x}:${y}`)).size, 4);
  assert.deepEqual(
    [...squad.members.map(({ targetId }) => targetId)].sort(),
    ['east', 'north', 'south', 'west'],
  );
  const lockedTargets = squad.members.map(({ targetId }) => targetId);
  state.enemies.reverse();
  updateTowerDefense(state, 0.05);
  assert.deepEqual(squad.members.map(({ targetId }) => targetId), lockedTargets,
    'a living target stays locked instead of being replaced by a nearer enemy');
  assert.ok(squad.members.every(({ x, y }) => (
    x >= TD_HERO_BOUNDS.minX && x <= TD_HERO_BOUNDS.maxX
    && y >= TD_HERO_BOUNDS.minY && y <= TD_HERO_BOUNDS.maxY
  )));
});

test('squad members pursue targets directly without leaving the combat bounds', () => {
  const state = createBattleState();
  const outerPad = TD_STAGES[0].pads.findIndex(({ laneIndex, rowIndex }) => (
    laneIndex === 0 && rowIndex === 0
  ));
  const squad = buyTowerDefenseSquad(state, 'ranged', outerPad);
  holdCombat(state);
  const trunkEnemy = enemyAt({ laneIndex: 0, y: 222, uid: 'trunk-out-of-range' });
  state.enemies = [trunkEnemy];
  squad.members.forEach((member) => { member.attackCooldown = 0; });
  updateTowerDefense(state, 0.01);
  assert.equal(squad.members.some(({ moving }) => moving), true);

  const movingState = createBattleState();
  const movingPad = TD_STAGES[0].pads.findIndex(({ laneIndex, rowIndex }) => (
    laneIndex === 0 && rowIndex === 1
  ));
  const melee = buyTowerDefenseSquad(movingState, 'melee', movingPad);
  holdCombat(movingState);
  movingState.enemies = [enemyAt({ laneIndex: 0, y: 222, uid: 'split-target' })];
  const before = melee.members.map(({ x, y }) => ({ x, y }));
  for (let tick = 0; tick < 30; tick += 1) updateTowerDefense(movingState, 0.05);
  melee.members.forEach((member, index) => {
    assert.ok(member.y < before[index].y);
    assert.ok(member.x > before[index].x, 'each member follows its own direct pursuit vector');
    assert.ok(member.x >= TD_HERO_BOUNDS.minX && member.x <= TD_HERO_BOUNDS.maxX);
    assert.ok(member.y >= TD_HERO_BOUNDS.minY && member.y <= TD_HERO_BOUNDS.maxY);
  });
});

test('members lock targets on their first frame and replace only defeated targets', () => {
  const state = createBattleState();
  const padIndex = TD_STAGES[0].pads.findIndex(({ laneIndex, rowIndex }) => (
    laneIndex === 0 && rowIndex === 4
  ));
  const squad = buyTowerDefenseSquad(state, 'ranged', padIndex);
  holdCombat(state);
  const rear = enemyAt({ laneIndex: 0, y: 222, uid: 'rear', hp: 1e6 });
  const front = enemyAt({ laneIndex: 0, y: 250, uid: 'front', hp: 1e6 });
  state.enemies = [rear, front];
  squad.members.forEach((member) => { member.attackCooldown = 0; });
  updateTowerDefense(state, 0.01);
  assert.equal(squad.targetUid, front.uid);
  assert.ok(squad.members.every(({ targetId }) => [front.uid, rear.uid].includes(targetId)));
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
    [8, 8, 8, 8, 8, 7, 9],
    [8, 8, 9, 8, 8, 8, 9],
    [8, 8, 8, 9, 8, 8, 9, 9],
  ]);
  assert.deepEqual(TD_STAGES.map(({ id, index, name }) => ({ id, index, name })), [
    { id: 'stage-1', index: 1, name: '软胶坡' },
    { id: 'stage-2', index: 2, name: '泡泡湾' },
    { id: 'stage-3', index: 3, name: '晶刺环' },
    { id: 'stage-4', index: 4, name: '露蜜林' },
    { id: 'stage-5', index: 5, name: '软壳峡' },
    { id: 'stage-6', index: 6, name: '星胶庭' },
  ]);
  for (const stage of TD_STAGES) {
    assert.equal(TD_TURRET_SLOTS[stage.id].length, 4);
    const finalBossCount = stage.waves.at(-1)
      .filter(({ type }) => type === 'boss')
      .reduce((total, entry) => total + entry.count, 0);
    assert.equal(finalBossCount, 1, `${stage.id} ends with one boss`);
  }
  for (const stage of TD_STAGES.slice(3)) {
    assert.equal(stage.waves.every((groups) => {
      const count = groups.reduce((total, entry) => total + entry.count, 0);
      return count >= 7 && count <= 9;
    }), true);
  }
  assert.ok(TD_ENEMIES.stone.hp >= TD_ENEMIES.bug.hp * 3);
  assert.deepEqual({
    hp: TD_ENEMIES.boss.hp,
    attackDamage: TD_ENEMIES.boss.attackDamage,
    coreDamage: TD_ENEMIES.boss.coreDamage,
    attackInterval: TD_ENEMIES.boss.attackInterval,
  }, { hp: 1850, attackDamage: 32, coreDamage: 10, attackInterval: 1.45 });
  const formerEnemyStats = {
    bug: { hp: 40, speed: 36, attackDamage: 9, coreDamage: 1 },
    windcap: { hp: 36, speed: 54, attackDamage: 8, coreDamage: 2 },
    stone: { hp: 140, speed: 26, attackDamage: 18, coreDamage: 2 },
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
  const firstBossScale = stageScaleForWave(1, 5);
  assert.equal(Math.round(TD_ENEMIES.boss.hp * firstBossScale.hp), 3645);
  assert.equal(Math.round(TD_ENEMIES.boss.attackDamage * Math.sqrt(firstBossScale.hp)), 45);
  assert.deepEqual(stageScaleForWave(6, 10_000), TD_STAGE_SCALE_CAPS);
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

test('the autonomous starter lineup clears stage one and the hero improves the result', () => {
  const active = simulateStarterLineup({ heroActive: true });
  assert.equal(active.result, 'victory');
  assert.equal(active.wave, 5);
  assert.equal(active.coreHp, active.coreMaxHp);
  assert.equal(active.kills, 33);

  const idle = simulateStarterLineup({ heroActive: false });
  assert.equal(idle.result, 'victory');
  assert.equal(idle.wave, 5);
  assert.ok(idle.coreHp > 0);
  assert.ok(idle.coreHp <= active.coreHp);
  assert.ok(idle.kills <= active.kills);
  assert.ok(idle.coreHp < active.coreHp || idle.kills < active.kills);
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
  const typeCounts = Object.fromEntries(TD_CONTRACT_TYPES.map((type) => [type, 0]));
  for (let index = 0; index < 400; index += 1) {
    const result = summonTowerDefenseContracts(distribution, 1)[0];
    rarityCounts[result.rarity] += 1;
    typeCounts[result.type] += 1;
  }
  assert.ok(rarityCounts.R > rarityCounts.SR * 1.5,
    'adding multiple heroes to a rarity must not multiply that rarity weight');
  assert.ok(rarityCounts.SR > rarityCounts.SSR);
  assert.ok(rarityCounts.SSR > rarityCounts.UR);
  for (const type of TD_CONTRACT_TYPES) assert.ok(typeCounts[type] > 0);
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
    contractShards: { shell: 2, needle: 5, bubble: 5, sprout: 0, berry: 0, dew: 0 },
    contractRanks: { shell: 3, needle: 2, bubble: 10, sprout: 0, berry: 0, dew: 0 },
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
