import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HERO_TYPES,
  SQUAD_TYPES,
  SQUAD_RARITY_SCALING,
  TD_BATTLE_UPGRADES,
  TD_BATTLE_UPGRADE_BY_ID,
  TD_CONTRACT_RARITIES,
  TD_CONTRACT_START_CURRENCY,
  TD_CONTRACT_SUMMON_COSTS,
  TD_CONTRACT_TYPES,
  TD_EQUIPMENT_SUMMON_COSTS,
  TD_HERO_RARITY_SCALING,
  TD_META_START_COINS,
  TD_RECRUITMENT_POOLS,
  TD_CARD_DOCK,
  TD_ENDLESS_SCALE_CAPS,
  TD_ENEMIES,
  TD_FIELD,
  TD_HERO_BOUNDS,
  TD_RECRUITMENT_POOL,
  TD_SQUAD_TYPES,
  TD_STAGE_SCALE_CAPS,
  TD_STAGES,
  TD_TURRET_SLOTS,
  TD_TURRET_TYPES,
  TD_TUTORIAL_VERSION,
  TD_VIEW,
  TOWER_ATTACK_EVOLUTIONS,
  TOWER_TYPES,
  TURRET_TYPES,
  acknowledgeTowerDefenseTutorialCategory,
  activateTowerDefenseHeroSkill,
  beginTowerDefenseDailyRun,
  beginTowerDefenseRun,
  buildTowerDefenseTurret,
  buyTowerDefenseSquad,
  buyTowerDefenseSquadFusion,
  canMergeTowers,
  chooseTowerDefenseBattleUpgrade,
  chooseTowerDefenseSquadAbility,
  createTowerDefenseState,
  equipTowerDefenseHeroItem,
  endlessScaleForWave,
  exchangeTowerDefenseHero,
  heroExchangeCost,
  heroRankUpCost,
  heroStatsForRank,
  mergeTowers,
  moveTowerToPad,
  normalizeTowerDefenseProgress,
  pathMetrics,
  pointOnPath,
  reclaimTowerToHand,
  replayTowerDefenseRun,
  returnToTowerDefenseMenu,
  selectTowerDefenseHero,
  serializeTowerDefenseProgress,
  setTowerDefenseHeroMovement,
  squadStatsForRank,
  skipTowerDefenseTutorial,
  skipTowerDefenseBreak,
  stageForState,
  stageScaleForWave,
  startNextTowerDefenseWave,
  summonTowerDefenseContracts,
  summonTowerDefenseEquipment,
  towerAttackEvolution,
  towerRange,
  turretStatsForRank,
  tutorialTargetForState,
  updateTowerDefense,
  upgradeTowerDefenseHero,
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
    progress: {
      tutorialSeen,
      tutorialVersion: tutorialSeen ? TD_TUTORIAL_VERSION : 0,
      unlockedStage,
      ...progress,
    },
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

function holdCombatWithHero(state) {
  state.phase = 'combat';
  state.waveActive = true;
  state.wave = Math.max(1, state.wave);
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  state.hero.hp = state.hero.maxHp;
  state.hero.cooldown = 999;
  state.hero.skillCooldown = 999;
  state.hero.moveX = 0;
  state.hero.moveY = 0;
  return state;
}

function resolveProjectiles(state, maxTicks = 100) {
  for (let tick = 0; tick < maxTicks && state.projectiles.length; tick += 1) {
    updateTowerDefense(state, 0.05);
  }
}

test('old progress migrates to the exact starter collection and one active R hero', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(HERO_TYPES).map(([type, hero]) => (
    [type, { name: hero.name, rarity: hero.rarity }]
  ))), {
    shell: { name: '壳壳', rarity: 'R' },
    needle: { name: '亮钉', rarity: 'SR' },
    bubble: { name: '泡泡', rarity: 'SSR' },
    sprout: { name: '芽芽', rarity: 'UR' },
    berry: { name: '莓莓', rarity: 'SR' },
    dew: { name: '露露', rarity: 'SSR' },
    bell: { name: '铃铃', rarity: 'R' },
    drill: { name: '钻钻', rarity: 'R' },
    ember: { name: '燃燃', rarity: 'SR' },
    ink: { name: '墨墨', rarity: 'SR' },
    cloud: { name: '云卷', rarity: 'SR' },
    frost: { name: '霜糖', rarity: 'SSR' },
    honey: { name: '蜜团', rarity: 'SSR' },
    spark: { name: '闪豆', rarity: 'UR' },
    star: { name: '星核', rarity: 'UR' },
  });
  assert.equal(Object.keys(HERO_TYPES).length, 15);
  const state = createTowerDefenseState({ progress: {} });
  assert.equal(state.progress.summonCurrency, TD_CONTRACT_START_CURRENCY);
  assert.equal(state.progress.metaCoins, TD_META_START_COINS);
  assert.deepEqual(state.progress.contractRanks, Object.fromEntries(
    TD_CONTRACT_TYPES.map((type) => [type, type === 'shell' ? 1 : 0]),
  ));
  assert.deepEqual(state.progress.squadRanks, Object.fromEntries(
    TD_SQUAD_TYPES.map((type) => [type, ['melee', 'ranged'].includes(type) ? 1 : 0]),
  ));
  assert.deepEqual(state.progress.turretRanks, Object.fromEntries(
    TD_TURRET_TYPES.map((type) => [type, type === 'gel-mortar' ? 1 : 0]),
  ));
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

test('all fifteen hero ranks use one bounded data-driven combat growth calculation', () => {
  for (const type of TD_CONTRACT_TYPES) {
    assert.equal(HERO_TYPES[type].visualType, type);
    assert.match(HERO_TYPES[type].ownerId, /^survivor-/);
    assert.equal(TOWER_ATTACK_EVOLUTIONS[type].length, 4,
      `${type} owns an explicit attack presentation instead of using a fallback`);
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
      || skillTotal(rankTen, 'tickDamage') > skillTotal(rankOne, 'tickDamage')
      || skillTotal(rankTen, 'poisonDps') > skillTotal(rankOne, 'poisonDps')
      || skillTotal(rankTen, 'shieldHp') > skillTotal(rankOne, 'shieldHp');
    assert.equal(improved, true, `${type} gains a real combat benefit from rank 1 to rank 10`);
    const rarityScale = TD_HERO_RARITY_SCALING[HERO_TYPES[type].rarity];
    assert.equal(rankOne.maxHp, Math.round(HERO_TYPES[type].maxHp * rarityScale.hp));
    assert.equal(rankOne.damage,
      Math.round(HERO_TYPES[type].damage * rarityScale.damage * 1000) / 1000);
    assert.ok(rankTen.maxHp <= HERO_TYPES[type].maxHp * rarityScale.hp * 1.25);
    assert.ok(rankTen.damage <= HERO_TYPES[type].damage * rarityScale.damage * 1.25);
    assert.ok(rankTen.attackSpeed
      <= (1 / HERO_TYPES[type].interval) * rarityScale.attackSpeed * 1.25 + 0.01);
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
  assert.ok(TD_HERO_RARITY_SCALING.UR.damage > TD_HERO_RARITY_SCALING.SSR.damage);
  assert.ok(TD_HERO_RARITY_SCALING.SSR.damage > TD_HERO_RARITY_SCALING.SR.damage);
  assert.ok(TD_HERO_RARITY_SCALING.SR.damage > TD_HERO_RARITY_SCALING.R.damage);
  const plainShell = heroStatsForRank('shell', 1);
  const equippedShell = heroStatsForRank('shell', 1, {
    damagePct: 2000, attackSpeedPct: 1500, healthPct: 2500,
  });
  assert.ok(equippedShell.damage > plainShell.damage);
  assert.ok(equippedShell.attackSpeed > plainShell.attackSpeed);
  assert.ok(equippedShell.maxHp > plainShell.maxHp);
});

test('hero detail summaries include delayed and persistent skill actor damage', () => {
  const actorTypes = [
    'needle', 'bubble', 'sprout', 'berry', 'dew', 'bell', 'drill',
    'ember', 'ink', 'cloud', 'frost', 'honey', 'spark', 'star',
  ];
  for (const type of actorTypes) {
    const stats = heroStatsForRank(type, 1);
    const damageText = stats.skillEffect.match(/伤害 ([\d./]+)/)?.[1];
    assert.ok(damageText, `${type} exposes skill damage in the hero detail`);
    const displayedPeak = Math.max(...damageText.split('/').map(Number));
    const authoredPeak = Math.max(...stats.skillSteps.flatMap((step) => [
      step.damage, step.tickDamage, step.burstDamage, step.returnDamage,
      step.splitDamage, step.landingDamage, step.resonanceDamage,
      step.scorchDamage, step.igniteDamage, step.weakDamage,
      step.tossDamage, step.shatterDamage, step.meteorDamage,
    ].map((value) => Math.max(0, Number(value) || 0))));
    assert.ok(
      displayedPeak > authoredPeak,
      `${type} summary aggregates its repeated or delayed hits instead of showing one raw hit`,
    );
  }
});

test('direct squad purchase is prep-only, correctly priced, one-cell, and atomic', () => {
  assert.deepEqual(Object.keys(SQUAD_TYPES), [
    'melee', 'ranged', 'charger', 'leaf', 'drill-lancer', 'spore-lobber', 'volt-orbiter',
  ]);
  assert.deepEqual(Object.fromEntries(Object.entries(SQUAD_TYPES).map(([type, squad]) => (
    [type, squad.cost]
  ))), {
    melee: 60,
    ranged: 85,
    charger: 75,
    leaf: 95,
    'drill-lancer': 100,
    'spore-lobber': 105,
    'volt-orbiter': 120,
  });
  assert.equal(SQUAD_TYPES.melee.deployMembers, 4);
  assert.equal(SQUAD_TYPES.melee.maxMembers, 4);
  assert.equal(SQUAD_TYPES.melee.squadSize, 4, 'legacy cap remains readable');
  assert.equal(SQUAD_TYPES.ranged.deployMembers, 4);
  assert.equal(SQUAD_TYPES.charger.movementMode, 'contact');
  assert.equal(SQUAD_TYPES.leaf.effect, 'poison');
  assert.equal(SQUAD_TYPES['drill-lancer'].rarity, 'SR');
  assert.equal(SQUAD_TYPES['spore-lobber'].attackMode, 'spore-lob');
  assert.equal(SQUAD_TYPES['volt-orbiter'].chainTargets, 2);
  const state = createBattleState();
  assert.equal(state.currency, 500);

  const invalid = clone(state);
  assert.equal(buyTowerDefenseSquad(state, 'unknown', 0), null);
  assert.deepEqual(state, invalid);
  assert.equal(buyTowerDefenseSquad(state, 'charger', 0), null);
  assert.deepEqual(state, invalid, 'locked squads cannot be bought or mutate the run');
  const melee = buyTowerDefenseSquad(state, 'melee', 0);
  assert.ok(melee);
  assert.equal(state.currency, 440);
  assert.deepEqual({
    kind: melee.kind, squadType: melee.squadType, squadSize: melee.squadSize,
    maxMembers: melee.maxMembers, aliveMembers: melee.aliveMembers, padIndex: melee.padIndex,
  }, {
    kind: 'soldier', squadType: 'melee', squadSize: 4,
    maxMembers: 4, aliveMembers: 4, padIndex: 0,
  });
  assert.equal(melee.maxHp, squadStatsForRank('melee', 1).memberHp * 4);
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
      hp: squadStatsForRank('melee', 1).memberHp,
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
  assert.equal(state.currency, 355);
  assert.equal(state.towers.length, 2, 'two complete squads occupy two grid cells');

  state.currency = 59;
  const poor = clone(state);
  assert.equal(buyTowerDefenseSquad(state, 'melee', 2), null);
  assert.deepEqual(state, poor);
  assert.equal(startNextTowerDefenseWave(state), true);
  const combat = clone(state);
  assert.equal(buyTowerDefenseSquad(state, 'melee', 2), null);
  assert.deepEqual(state, combat);
});

test('a placed slime squad can be reclaimed during preparation for a bounded refund', () => {
  const state = createBattleState();
  const squad = buyTowerDefenseSquad(state, 'melee', 0);
  assert.ok(squad);
  assert.equal(state.currency, 440);

  const reclaimed = reclaimTowerToHand(state, squad.uid);
  assert.equal(reclaimed.uid, squad.uid);
  assert.equal(reclaimed.refund, 45);
  assert.equal(state.currency, 485);
  assert.equal(state.towers.length, 0);
  assert.ok(state.effects.some(({ type }) => type === 'reclaim'));
  assert.ok(state.events.some(({ type, towerUid, refund }) => (
    type === 'reclaim' && towerUid === squad.uid && refund === 45
  )));

  const afterReclaim = clone(state);
  assert.equal(reclaimTowerToHand(state, squad.uid), null);
  assert.deepEqual(state, afterReclaim, 'a stale reclaim cannot pay twice');

  const combatSquad = buyTowerDefenseSquad(state, 'melee', 0);
  assert.ok(combatSquad);
  assert.equal(startNextTowerDefenseWave(state), true);
  const combat = clone(state);
  assert.equal(reclaimTowerToHand(state, combatSquad.uid), null);
  assert.deepEqual(state, combat, 'combat never permits reclaiming a squad');
});

test('squad rarity, rank, and all fourteen fusion choices change shared combat stats', () => {
  assert.deepEqual(SQUAD_RARITY_SCALING, {
    R: { damage: 1, hp: 1, effect: 1 },
    SR: { damage: 1.28, hp: 1.18, effect: 1.25 },
    SSR: { damage: 1.58, hp: 1.35, effect: 1.5 },
    UR: { damage: 1.9, hp: 1.55, effect: 1.8 },
  });
  const combatKeys = [
    'memberHp', 'damagePerMember', 'interval', 'range', 'speed',
    'damageTakenMultiplier', 'projectileCount', 'splashRadius', 'splashDamageScale',
    'poisonDps', 'poisonTime', 'slowMultiplier', 'slowTime', 'rewind',
    'chainTargets', 'chainRadius', 'chainPower',
  ];
  for (const [type, definition] of Object.entries(SQUAD_TYPES)) {
    assert.equal(definition.fusionChoices.length, 2, `${type} has two authored choices`);
    assert.equal(Object.isFrozen(definition.fusionChoices), true);
    assert.equal(definition.fusionChoices.every(({ modifiers }) => Object.isFrozen(modifiers)), true);
    const base = squadStatsForRank(type, 1);
    for (const choice of definition.fusionChoices) {
      const upgraded = squadStatsForRank(type, 1, choice.id);
      assert.equal(upgraded.fusionAbility, choice.id);
      assert.equal(combatKeys.some((key) => upgraded[key] !== base[key]), true,
        `${type}:${choice.id} changes a simulation stat`);
    }
  }

  const rangedOne = squadStatsForRank('ranged', 1);
  const rangedTen = squadStatsForRank('ranged', 10);
  assert.ok(rangedTen.damagePerMember >= rangedOne.damagePerMember * 1.3);
  assert.ok(rangedTen.memberHp >= rangedOne.memberHp * 1.3);
  assert.ok(rangedTen.interval < rangedOne.interval * 0.9);
  assert.equal(squadStatsForRank('leaf', 1).rarityDamageMultiplier, 1.28);
  assert.equal(squadStatsForRank('volt-orbiter', 1).rarityDamageMultiplier, 1.58);
  assert.equal(squadStatsForRank('volt-orbiter', 1).rarityHpMultiplier, 1.35);
  assert.equal(squadStatsForRank('unknown', 1), null);
  assert.equal(
    towerRange(null, { squadType: 'drill-lancer', rank: 1, fusionAbility: 'breakthrough' }),
    squadStatsForRank('drill-lancer', 1, 'breakthrough').range,
  );
});

test('one matching purchase evolves a deployed full squad without a staging pad', () => {
  const state = createBattleState();
  state.currency = 1_000;
  const target = buyTowerDefenseSquad(state, 'melee', 0);
  target.members[0].hp /= 2;
  target.hp = target.members.reduce((total, member) => total + member.hp, 0);
  const targetBeforePurchase = clone(target);
  const memberUids = target.members.map(({ uid }) => uid);
  assert.equal(buyTowerDefenseSquadFusion(state, 'melee', target.uid), target);
  assert.equal(state.currency, 1_000 - SQUAD_TYPES.melee.cost * 2);
  assert.equal(state.towers.length, 1);
  assert.deepEqual(target, targetBeforePurchase,
    'paying for the evolution does not mutate the squad before an ability is chosen');
  assert.deepEqual(state.pendingSquadFusion, {
    sourceMode: 'purchase',
    sourceUid: null,
    targetUid: target.uid,
    squadType: 'melee',
    paidCost: SQUAD_TYPES.melee.cost,
    options: SQUAD_TYPES.melee.fusionChoices.map(({ id, name, description }) => ({
      id, name, description,
    })),
  });
  assert.equal(state.events.some(({ type, directFusion, cost }) => (
    type === 'squad-buy' && directFusion && cost === SQUAD_TYPES.melee.cost
  )), true);
  const invalidChoice = clone(state);
  assert.equal(chooseTowerDefenseSquadAbility(state, 'unknown'), null);
  assert.deepEqual(state, invalidChoice, 'an invalid choice cannot mutate the paid pending fusion');
  assert.equal(startNextTowerDefenseWave(state), false);
  assert.equal(moveTowerToPad(state, target.uid, 4), null);
  assert.equal(buyTowerDefenseSquad(state, 'ranged', 4), null);
  assert.equal(buildTowerDefenseTurret(state, 0), null);

  const chosen = chooseTowerDefenseSquadAbility(state, 'shell-wall');
  const chosenStats = squadStatsForRank('melee', target.rank, 'shell-wall');
  assert.equal(chosen, target);
  assert.equal(state.pendingSquadFusion, null);
  assert.equal(state.towers.length, 1);
  assert.deepEqual(target.members.map(({ uid }) => uid), memberUids);
  assert.equal(target.squadSize, 4);
  assert.equal(target.members.length, 4);
  assert.equal(target.fusionTier, 2);
  assert.equal(target.fusionAbility, 'shell-wall');
  assert.equal(target.maxHp, chosenStats.memberHp * 4);
  assert.equal(target.members.every(({ maxHp }) => maxHp === chosenStats.memberHp), true);
  assert.equal(target.members[0].hp, chosenStats.memberHp / 2,
    'evolution preserves each surviving member health ratio');
  assert.equal(state.events.findLast(({ type }) => type === 'merge').sourceUid, null);
});

test('direct squad evolution rejects invalid purchases atomically', () => {
  const state = createBattleState();
  state.currency = 1_000;
  const target = buyTowerDefenseSquad(state, 'melee', 0);
  for (const [type, uid] of [['ranged', target.uid], ['melee', 'missing']]) {
    const snapshot = clone(state);
    assert.equal(buyTowerDefenseSquadFusion(state, type, uid), null);
    assert.deepEqual(state, snapshot);
  }

  state.currency = SQUAD_TYPES.melee.cost - 1;
  const poor = clone(state);
  assert.equal(buyTowerDefenseSquadFusion(state, 'melee', target.uid), null);
  assert.deepEqual(state, poor);

  state.currency = 1_000;
  target.fusionAbility = 'shell-wall';
  const evolved = clone(state);
  assert.equal(buyTowerDefenseSquadFusion(state, 'melee', target.uid), null);
  assert.deepEqual(state, evolved);
  target.fusionAbility = null;

  assert.equal(startNextTowerDefenseWave(state), true);
  const combat = clone(state);
  assert.equal(buyTowerDefenseSquadFusion(state, 'melee', target.uid), null);
  assert.deepEqual(state, combat);

  const tutorial = createBattleState({ tutorialSeen: false });
  const tutorialTarget = buyTowerDefenseSquad(tutorial, 'melee', 0);
  const tutorialSnapshot = clone(tutorial);
  assert.equal(buyTowerDefenseSquadFusion(tutorial, 'melee', tutorialTarget.uid), null);
  assert.deepEqual(tutorial, tutorialSnapshot);
});

test('physical four-plus-four fusion remains available and consumes its source after choice', () => {
  const state = createBattleState();
  state.currency = 1_000;
  const target = buyTowerDefenseSquad(state, 'melee', 0);
  const source = buyTowerDefenseSquad(state, 'melee', 1);
  const wrongType = buyTowerDefenseSquad(state, 'ranged', 2);
  assert.equal(canMergeTowers(source, target), true);
  assert.equal(canMergeTowers(source, wrongType), false);
  assert.equal(canMergeTowers(source, source), false);
  assert.equal(mergeTowers(state, source.uid, target.uid), target);
  assert.equal(state.towers.length, 3, 'the source remains until an ability is selected');
  assert.deepEqual(state.pendingSquadFusion, {
    sourceUid: source.uid,
    targetUid: target.uid,
    squadType: 'melee',
    options: SQUAD_TYPES.melee.fusionChoices.map(({ id, name, description }) => ({
      id, name, description,
    })),
  });
  assert.equal(chooseTowerDefenseSquadAbility(state, 'shell-wall'), target);
  assert.equal(state.pendingSquadFusion, null);
  assert.equal(state.towers.some(({ uid }) => uid === source.uid), false);
  assert.equal(state.towers.length, 2);
  assert.equal(target.fusionTier, 2);
  assert.equal(target.fusionAbility, 'shell-wall');
  assert.ok(buyTowerDefenseSquad(state, 'melee', 1), 'the consumed source frees its cell');
});

test('a chosen squad ability survives wave clear and revives the full squad', () => {
  const state = createBattleState();
  const target = buyTowerDefenseSquad(state, 'melee', 0);
  assert.equal(buyTowerDefenseSquadFusion(state, 'melee', target.uid), target);
  assert.equal(chooseTowerDefenseSquadAbility(state, 'shell-wall'), target);
  const chosenStats = squadStatsForRank('melee', target.rank, 'shell-wall');
  assert.equal(startNextTowerDefenseWave(state), true);
  state.spawnQueue = [];
  state.enemies = [];
  updateTowerDefense(state, 0.05);
  assert.equal(state.phase, 'prep');
  assert.equal(target.fusionAbility, 'shell-wall');
  assert.equal(target.squadSize, 4);
  assert.equal(target.aliveMembers, 4);
  assert.equal(target.hp, chosenStats.memberHp * 4);
});

test('a selected squad ability drives projectile count, damage, status, and attack interval', () => {
  const state = createBattleState({ progress: { squadRanks: { leaf: 1 } } });
  const target = buyTowerDefenseSquad(state, 'leaf', 1);
  const source = buyTowerDefenseSquad(state, 'leaf', 3);
  assert.equal(mergeTowers(state, source.uid, target.uid), target);
  assert.equal(chooseTowerDefenseSquadAbility(state, 'double-leaf'), target);
  const stats = squadStatsForRank('leaf', 1, 'double-leaf');
  holdCombat(state);
  const pad = TD_STAGES[0].pads[target.padIndex];
  const enemy = enemyAt({
    laneIndex: pad.laneIndex,
    y: pad.y - 90,
    uid: 'double-leaf-target',
    hp: 100_000,
  });
  state.enemies = [enemy];
  target.members.forEach((member) => { member.attackCooldown = 0; });
  state.events = [];
  updateTowerDefense(state, 0.01);
  const shots = state.events.filter(({ type }) => type === 'shot');
  assert.equal(shots.length, 4);
  assert.equal(shots.every(({ projectileCount }) => projectileCount === 2), true);
  assert.equal(shots.every(({ damage }) => damage === stats.damagePerMember * 2), true);
  assert.equal(state.projectiles.length, 8);
  assert.equal(state.projectiles.every(({ damage }) => damage === stats.damagePerMember), true);
  assert.equal(target.members.every(({ attackCooldown }) => attackCooldown === stats.interval), true);
  resolveProjectiles(state);
  assert.ok(enemy.hp < enemy.maxHp);
  assert.equal(enemy.poisonDps, stats.poisonDps);
  assert.equal(enemy.poisonTime > 0, true);
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
      squadStatsForRank(squadType, 1).damagePerMember * 4);

    // Aggregate HP is deliberately written here to cover old battle saves and
    // callers that predate per-member health.
    squad.hp = squadStatsForRank(squadType, 1).memberHp;
    squad.members.forEach((member) => { member.attackCooldown = 0; });
    enemy.hp = enemy.maxHp;
    state.projectiles = [];
    state.events = [];
    updateTowerDefense(state, 0.01);
    const reduced = state.events.filter(({ type }) => type === 'shot');
    assert.equal(squad.aliveMembers, 1);
    assert.equal(reduced.length, 1);
    assert.equal(reduced.reduce((sum, event) => sum + event.damage, 0),
      squadStatsForRank(squadType, 1).damagePerMember);
    assert.equal(reduced.every(({ aliveMembers }) => aliveMembers === 1), true);
    assert.equal(state.projectiles.length, squadType === 'ranged' ? 1 : 0);
  }
});

test('legacy aggregate squads migrate into independent serialisable members', () => {
  const state = createBattleState();
  const squad = buyTowerDefenseSquad(state, 'ranged', 3);
  const retainedHp = SQUAD_TYPES.ranged.memberHp * 2 + 7;
  squad.squadSize = 4;
  squad.maxMembers = 4;
  squad.maxHp = SQUAD_TYPES.ranged.memberHp * 4;
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
  assert.ok(melee.members.some((member, index) => (
    member.y < meleeStarts[index].y
  )));
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
  const unlockedSquads = { charger: 1, leaf: 1 };
  const chargerState = createBattleState({ progress: { squadRanks: unlockedSquads } });
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

  const leafState = createBattleState({ progress: { squadRanks: unlockedSquads } });
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

test('recruited drill, spore, and volt squads deploy as four authored independent soldiers', () => {
  const expected = {
    'drill-lancer': { rarity: 'SR', mode: 'contact', attack: 'drill-lance' },
    'spore-lobber': { rarity: 'SR', mode: 'keep-range', attack: 'spore-lob' },
    'volt-orbiter': { rarity: 'SSR', mode: 'keep-range', attack: 'volt-orbit' },
  };
  for (const [type, authored] of Object.entries(expected)) {
    const state = createBattleState({ progress: { squadRanks: { [type]: 1 } } });
    const squad = buyTowerDefenseSquad(state, type, 1);
    assert.ok(squad);
    assert.equal(squad.rank, 1);
    assert.equal(squad.members.length, 4);
    assert.equal(SQUAD_TYPES[type].rarity, authored.rarity);
    assert.equal(SQUAD_TYPES[type].movementMode, authored.mode);
    assert.equal(SQUAD_TYPES[type].attackMode, authored.attack);
    assert.match(SQUAD_TYPES[type].ownerId, /^soldier-/);
  }
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
  const lastMember = squad.members.find(({ alive }) => alive);
  lastMember.x = enemy.x;
  lastMember.y = enemy.y;
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
  const source = buyTowerDefenseSquad(state, 'melee', 1);
  assert.equal(mergeTowers(state, source.uid, squad.uid), squad);
  assert.equal(squad.members.length, 4);
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
    'gale-fan', 'spore-bomber', 'thunder-prism',
  ]);
  assert.equal(TURRET_TYPES['gel-mortar'].cost, 175);
  const state = createBattleState();
  const lockedSnapshot = clone(state);
  assert.equal(buildTowerDefenseTurret(state, 0, 'bubble-coil'), null);
  assert.deepEqual(state, lockedSnapshot, 'locked turrets cannot be built or mutate the run');
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
  const unlockedTurrets = { 'bubble-coil': 1, 'crystal-repeater': 1 };
  const slowState = createBattleState({ progress: { turretRanks: unlockedTurrets } });
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
  assert.equal(slowTarget.slowMultiplier, turretStatsForRank('bubble-coil', 1).slowMultiplier);
  assert.ok(slowTarget.slowTime > 0);

  const pierceState = createBattleState({ progress: { turretRanks: unlockedTurrets } });
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

test('recruited gale, spore, and thunder turrets keep distinct authored attacks', () => {
  const expected = {
    'gale-fan': { rarity: 'R', effect: 'pierce', attack: 'gale-blade' },
    'spore-bomber': { rarity: 'SR', effect: 'splash', attack: 'spore-bombard' },
    'thunder-prism': { rarity: 'SSR', effect: 'slow', attack: 'thunder-prism-beam' },
  };
  for (const [type, authored] of Object.entries(expected)) {
    const state = createBattleState({ progress: { turretRanks: { [type]: 1 } } });
    const turret = buildTowerDefenseTurret(state, 0, type);
    assert.ok(turret);
    assert.equal(turret.rank, 1);
    assert.equal(TURRET_TYPES[type].rarity, authored.rarity);
    assert.equal(TURRET_TYPES[type].effect, authored.effect);
    assert.equal(TURRET_TYPES[type].attackMode, authored.attack);
    assert.equal(TURRET_TYPES[type].ownerId, `turret-${type}`);
  }
});

test('turret rarity and duplicate ranks produce real battle stat growth', () => {
  const rankOne = turretStatsForRank('bubble-coil', 1);
  const rankTen = turretStatsForRank('bubble-coil', 10);
  const ssrRankOne = turretStatsForRank('thunder-prism', 1);
  assert.ok(rankTen.damage > rankOne.damage);
  assert.ok(rankTen.range > rankOne.range);
  assert.ok(rankTen.interval < rankOne.interval);
  assert.ok(rankTen.chainTargets > rankOne.chainTargets);
  assert.ok(ssrRankOne.damage > TURRET_TYPES['thunder-prism'].damage);

  const state = createBattleState({ progress: { turretRanks: { 'bubble-coil': 10 } } });
  const turret = buildTowerDefenseTurret(state, 0, 'bubble-coil');
  holdCombat(state);
  state.enemies = [enemyAt({
    laneIndex: 0, y: turret.y - 100, uid: 'ranked-turret-target', hp: 100_000,
  })];
  turret.cooldown = 0;
  updateTowerDefense(state, 0.01);
  assert.equal(state.projectiles[0].damage, rankTen.damage);
  assert.ok(Math.abs(turret.cooldown - (rankTen.interval - 0.01)) < 1e-9);
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
  setTowerDefenseHeroMovement(state, 0, 0);
  assert.equal(activateTowerDefenseHeroSkill(state), true);
  const startedCooldown = hero.skillCooldown;
  assert.equal(near.hp, nearHp, 'guard skill waits to counter instead of dealing fake cast damage');
  for (let tick = 0; tick < 46; tick += 1) updateTowerDefense(state, 0.05);
  assert.ok(near.hp < nearHp);
  assert.equal(far.hp, farHp);
  assert.equal(startedCooldown, HERO_TYPES.shell.skillCooldown);
  assert.ok(hero.skillCooldown > 0 && hero.skillCooldown < startedCooldown);
  assert.deepEqual(state.events.find(({ type }) => type === 'hero-skill').targetUids, []);
  assert.ok(state.events.some(({ type, phase }) => (
    type === 'hero-skill-mechanic' && phase === 'counter-release'
  )));
  const cooldown = clone(state);
  assert.equal(activateTowerDefenseHeroSkill(state), false);
  assert.deepEqual(state, cooldown);
});

test('all fifteen heroes own unique serialisable mechanics rather than five recoloured templates', () => {
  const snapshots = {};
  const expectedActions = {
    shell: ['guard-counter', 'guard-brace', 'guard-release'],
    needle: ['prism-beam', 'prism-focus', 'prism-shatter'],
    bubble: ['bubble-prison', 'bubble-tighten', 'bubble-burst-cue'],
    sprout: ['thorn-node', 'thorn-node', 'thorn-triangle'],
    berry: ['bouncing-bomb', 'bomb-bounce-cue', 'bomb-split-cue'],
    dew: ['return-wave', 'wave-turn-cue', 'wave-return-cue'],
    bell: ['resonance-mark', 'resonance-mark', 'resonance-detonate'],
    drill: ['hero-dash', 'dash-bore-cue', 'dash-impact-cue'],
    ember: ['fire-snake', 'snake-turn-cue', 'snake-ignite-cue'],
    ink: ['ink-cone', 'ink-weakpoint-cue', 'ink-trigger-cue'],
    cloud: ['moving-vortex', 'vortex-pull-cue', 'vortex-toss-cue'],
    frost: ['frost-wall', 'wall-grow-cue', 'wall-shatter-cue'],
    honey: ['honey-stack', 'honey-stack', 'honey-stack'],
    spark: ['chain-lightning', 'chain-lightning', 'chain-lightning'],
    star: ['orbit-stars', 'orbit-release-cue', 'meteor-cue'],
  };
  assert.equal(new Set(TD_CONTRACT_TYPES.map((type) => HERO_TYPES[type].skill.mechanic)).size, 15);
  assert.equal(new Set(TD_CONTRACT_TYPES.map((type) => (
    HERO_TYPES[type].skill.steps.map(({ action }) => action).join('|')
  ))).size, 15);
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
    assert.deepEqual(HERO_TYPES[type].skill.steps.map(({ action }) => action), expectedActions[type]);
    assert.equal(HERO_TYPES[type].skill.steps.some((step) => (
      'healHero' in step || 'healMembers' in step
    )), false);
    assert.doesNotMatch(HERO_TYPES[type].skill.description, /治疗|治愈|回复/);
    assert.ok(HERO_TYPES[type].skill.name.length >= 3);
    assert.ok(HERO_TYPES[type].skill.description.length >= 12);
    assert.ok(HERO_TYPES[type].skill.mechanic.length >= 8);
    assert.equal(activateTowerDefenseHeroSkill(state), true);
    assert.doesNotThrow(() => JSON.stringify(state.heroSkillQueue));
    assert.doesNotThrow(() => JSON.stringify(state.heroSkillActors));
    assert.deepEqual(state.heroSkillQueue.map(({ stage, stepIndex, skillId }) => ({
      stage, stepIndex, skillId,
    })), [1, 2].map((stepIndex) => ({
      stage: stepIndex + 1,
      stepIndex,
      skillId: HERO_TYPES[type].skill.id,
    })));
    assert.equal(state.events.find(({ type: eventType }) => eventType === 'hero-skill').mechanic,
      HERO_TYPES[type].skill.mechanic);
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
      action: immediateStep.action,
    }, {
      stage: 1,
      stepIndex: 0,
      skillName: HERO_TYPES[type].skill.name,
      stepKind: HERO_TYPES[type].skill.steps[0].kind,
      action: HERO_TYPES[type].skill.steps[0].action,
    });
    assert.ok(immediateStep.geometry?.origin && immediateStep.geometry?.target);
    assert.equal(
      immediateStep.geometry.radius,
      Math.max(0, Number(HERO_TYPES[type].skill.steps[0].radius) || 0),
      `${type} reports only its real step radius instead of faking the whole cast range`,
    );
    assert.equal(immediateStep.geometry.skillRange, HERO_TYPES[type].skill.radius);
    for (let tick = 0; tick < 90; tick += 1) updateTowerDefense(state, 0.05);
    const steps = state.events.filter(({ type: eventType, heroType }) => (
      eventType === 'hero-skill-step' && heroType === type
    ));
    assert.equal(steps.length, 3, `${type} resolves exactly three authored steps`);
    assert.deepEqual(steps.map(({ stepIndex }) => stepIndex), [0, 1, 2]);
    assert.deepEqual(steps.map(({ stage }) => stage), [1, 2, 3]);
    assert.equal(steps.every(({ skillName }) => skillName === HERO_TYPES[type].skill.name), true);
    assert.equal(state.heroSkillQueue.length, 0);
    assert.ok(target.hp < initial.enemyHp, `${type} deals real skill damage`);
    assert.equal(state.hero.hp, initial.heroHp, `${type} never heals the hero`);
    assert.equal(squad.members[0].hp, initial.memberHp, `${type} never heals soldiers`);
    snapshots[type] = {
      damage: initial.enemyHp - target.hp,
      slowMultiplier: target.slowMultiplier,
      slowTime: target.slowTime,
      poisonDps: target.poisonDps,
      poisonTime: target.poisonTime,
      shieldHp: state.hero.shieldHp,
      phases: state.events
        .filter(({ type: eventType, mechanic }) => (
          eventType === 'hero-skill-mechanic' && mechanic === HERO_TYPES[type].skill.mechanic
        ))
        .map(({ phase }) => phase),
    };
    if (['needle', 'bubble', 'sprout', 'berry', 'dew', 'drill', 'ember', 'cloud', 'frost', 'star'].includes(type)) {
      assert.ok(state.events.some(({ type: eventType }) => eventType === 'hero-skill-tick'));
    }
    assert.ok(snapshots[type].phases.length > 0, `${type} exposes its mechanic phase to rendering`);
    assert.doesNotThrow(() => JSON.stringify(state.events));
  }

  assert.ok(snapshots.shell.phases.includes('counter-release'));
  assert.ok(snapshots.needle.phases.includes('shatter'));
  assert.ok(snapshots.bubble.phases.includes('prison-break'));
  assert.ok(snapshots.sprout.poisonDps > 0 && snapshots.sprout.poisonTime > 0);
  assert.ok(snapshots.berry.phases.includes('final-split'));
  assert.ok(snapshots.dew.phases.includes('turn') && snapshots.dew.phases.includes('return'));
  assert.ok(snapshots.bell.phases.includes('detonate'));
  assert.ok(snapshots.drill.phases.includes('landing'));
  assert.ok(snapshots.ember.phases.includes('scorch'));
  assert.ok(snapshots.ink.phases.includes('mark'));
  assert.ok(snapshots.cloud.phases.includes('toss'));
  assert.ok(snapshots.frost.phases.includes('shatter'));
  assert.ok(snapshots.honey.phases.includes('stack-burst'));
  assert.ok(snapshots.spark.phases.includes('chain'));
  assert.ok(snapshots.star.phases.includes('meteor'));
  assert.equal(new Set(TD_CONTRACT_TYPES.map((type) => HERO_TYPES[type].skill.id)).size, 15);
  assert.equal(new Set(TD_CONTRACT_TYPES.map((type) => HERO_TYPES[type].skill.name)).size, 15);
  assert.equal(new Set(TD_CONTRACT_TYPES.map((type) => HERO_TYPES[type].skill.description)).size, 15);
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
  const uninterrupted = state;
  for (let tick = 0; tick < 70; tick += 1) {
    updateTowerDefense(restored, 0.05);
    updateTowerDefense(uninterrupted, 0.05);
  }
  assert.deepEqual(restored.events.filter(({ type }) => type === 'hero-skill-step')
    .map(({ stepIndex }) => stepIndex), [0, 1, 2]);
  assert.equal(restored.heroSkillQueue.length, 0);
  assert.equal(restored.heroSkillActors.length, 0);
  assert.deepEqual({
    hp: restored.enemies[0].hp,
    travelled: restored.enemies[0].travelled,
    slowMultiplier: restored.enemies[0].slowMultiplier,
    slowTime: restored.enemies[0].slowTime,
  }, {
    hp: uninterrupted.enemies[0].hp,
    travelled: uninterrupted.enemies[0].travelled,
    slowMultiplier: uninterrupted.enemies[0].slowMultiplier,
    slowTime: uninterrupted.enemies[0].slowTime,
  });
});

test('ink basic attacks preserve their own weakpoint while allied shots trigger it', () => {
  const state = createBattleState({
    progress: {
      contractRanks: { shell: 1, ink: 1 },
      selectedHero: 'ink',
    },
  });
  assert.equal(startNextTowerDefenseWave(state), true);
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  state.hero.cooldown = 999;
  const target = enemyAt({
    laneIndex: 2, y: state.hero.y - 90, uid: 'ink-mark-target', hp: 100_000,
    speed: 0.0001,
  });
  state.enemies = [target];
  state.events = [];
  assert.equal(activateTowerDefenseHeroSkill(state), true);
  const weakDamage = target.inkWeakDamage;
  assert.ok(weakDamage > 0);

  const addShot = ({ uid, sourceKind, heroType = null }) => {
    state.projectiles.push({
      uid, type: 'berry', effect: 'pierce', sourceKind, heroType,
      star: 1, effectTier: 1, targetUid: target.uid,
      x: target.x, y: target.y - 18,
      targetX: target.x, targetY: target.y - 18,
      speed: 1, damage: 10, age: 0, maxAge: 1,
    });
    updateTowerDefense(state, 0.05);
  };

  addShot({ uid: 'ink-basic-shot', sourceKind: 'hero', heroType: 'ink' });
  assert.ok(target.inkWeakTime > 0);
  assert.equal(state.events.some(({ type, phase }) => (
    type === 'hero-skill-mechanic' && phase === 'weakpoint-trigger'
  )), false);
  assert.equal(state.events.findLast(({ type }) => type === 'enemy-hit').sourceSkill, 'ink');

  addShot({ uid: 'ally-shot', sourceKind: 'squad' });
  const trigger = state.events.find(({ type, phase }) => (
    type === 'hero-skill-mechanic' && phase === 'weakpoint-trigger'
  ));
  assert.ok(trigger);
  assert.equal(trigger.triggerSource, null);
  assert.equal(trigger.bonusDamage, weakDamage);
  assert.equal(target.inkWeakTime, 0);
});

test('moving skill mechanic events snapshot paths instead of sharing actor arrays', () => {
  for (const { heroType, actorType, phase } of [
    { heroType: 'ember', actorType: 'fire-snake', phase: 'scorch' },
    { heroType: 'cloud', actorType: 'moving-vortex', phase: 'pull' },
  ]) {
    const state = createBattleState({
      progress: {
        contractRanks: { shell: 1, [heroType]: 1 },
        selectedHero: heroType,
      },
    });
    assert.equal(startNextTowerDefenseWave(state), true);
    state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
    state.hero.cooldown = 999;
    state.enemies = [enemyAt({
      laneIndex: 2, y: state.hero.y - 90, uid: `${heroType}-path-target`,
      hp: 100_000, speed: 0.0001,
    })];
    state.events = [];
    assert.equal(activateTowerDefenseHeroSkill(state), true);
    const actor = state.heroSkillActors.find(({ type }) => type === actorType);
    assert.ok(actor);
    let firstEvent = null;
    for (let tick = 0; tick < 20 && !firstEvent; tick += 1) {
      updateTowerDefense(state, 0.05);
      firstEvent = state.events.find(({ type, phase: eventPhase }) => (
        type === 'hero-skill-mechanic' && eventPhase === phase
      ));
    }
    assert.ok(firstEvent?.path?.length > 1);
    assert.notEqual(firstEvent.path, actor.path);
    const savedPath = JSON.stringify(firstEvent.path);
    const savedLength = firstEvent.path.length;
    for (let tick = 0; tick < 10; tick += 1) updateTowerDefense(state, 0.05);
    assert.equal(JSON.stringify(firstEvent.path), savedPath);
    assert.ok(actor.path.length > savedLength);
  }
});

test('needle prism beam etches repeated marks, refracts, then shatters them', () => {
  const state = createBattleState({
    progress: {
      contractRanks: { shell: 1, needle: 1 },
      selectedHero: 'needle',
    },
  });
  assert.equal(startNextTowerDefenseWave(state), true);
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  state.hero.cooldown = 999;
  const target = enemyAt({
    laneIndex: 2, y: state.hero.y - 170, uid: 'beam-inline', hp: 100_000, speed: 0,
  });
  const offAxis = enemyAt({
    laneIndex: 3, y: state.hero.y - 170, uid: 'beam-off-axis', hp: 100_000, speed: 0,
  });
  state.enemies = [target, offAxis];
  const initialTargetHp = target.hp;
  const initialOffAxisHp = offAxis.hp;

  assert.equal(activateTowerDefenseHeroSkill(state), true);
  assert.equal(target.hp, initialTargetHp, 'starting the beam never applies radial damage');
  assert.equal(state.heroSkillActors[0].type, 'prism-beam');
  assert.doesNotThrow(() => JSON.stringify(state.heroSkillActors[0]));
  for (let tick = 0; tick < 3; tick += 1) updateTowerDefense(state, 0.05);
  assert.equal(target.hp, initialTargetHp, 'damage waits for the authored beam tick');
  updateTowerDefense(state, 0.05);
  const hpAfterFirstTick = target.hp;
  assert.ok(hpAfterFirstTick < initialTargetHp);
  for (let tick = 0; tick < 8; tick += 1) updateTowerDefense(state, 0.05);
  assert.ok(target.hp < hpAfterFirstTick, 'the same beam keeps dealing damage over time');
  assert.ok(offAxis.hp < initialOffAxisHp, 'the third etched hit refracts to an off-axis enemy');
  assert.ok(state.events.some(({ type, phase }) => (
    type === 'hero-skill-mechanic' && phase === 'refraction'
  )));
  const actorUid = state.events.find(({ type }) => type === 'hero-skill-tick').actorUid;
  assert.ok(state.events.filter(({ type, actorUid: uid }) => (
    type === 'hero-skill-tick' && uid === actorUid
  )).length >= 2);
});

test('bubble skill captures a fixed group, rewinds it, and bursts by recorded travel', () => {
  const state = createBattleState({
    progress: {
      contractRanks: { shell: 1, bubble: 1 },
      selectedHero: 'bubble',
    },
  });
  assert.equal(startNextTowerDefenseWave(state), true);
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  state.hero.cooldown = 999;
  const inside = enemyAt({
    laneIndex: 2, y: state.hero.y - 140, uid: 'field-inside', hp: 100_000, speed: 0,
  });
  const outside = enemyAt({
    laneIndex: 4, y: state.hero.y - 140, uid: 'field-outside', hp: 100_000, speed: 0,
  });
  state.enemies = [inside, outside];
  const insideHp = inside.hp;
  const outsideHp = outside.hp;

  assert.equal(activateTowerDefenseHeroSkill(state), true);
  assert.equal(state.heroSkillActors.length, 1);
  assert.deepEqual({
    type: state.heroSkillActors[0].type,
    x: state.heroSkillActors[0].x,
    y: state.heroSkillActors[0].y,
  }, { type: 'bubble-prison', x: inside.x, y: inside.y });
  assert.deepEqual(state.heroSkillActors[0].capturedUids, [inside.uid]);
  assert.equal(inside.hp, insideHp);
  for (let tick = 0; tick < 5; tick += 1) updateTowerDefense(state, 0.05);
  const hpAfterFirstTick = inside.hp;
  assert.ok(hpAfterFirstTick < insideHp);
  assert.ok(inside.slowMultiplier < 1);
  for (let tick = 0; tick < 5; tick += 1) updateTowerDefense(state, 0.05);
  assert.ok(inside.hp < hpAfterFirstTick);
  assert.equal(outside.hp, outsideHp);
  const travelledBeforeBreak = inside.travelled;
  for (let tick = 0; tick < 45; tick += 1) updateTowerDefense(state, 0.05);
  const burst = state.events.find(({ type, phase }) => (
    type === 'hero-skill-mechanic' && phase === 'prison-break'
  ));
  assert.ok(burst.bursts[0].rewindDistance > 0);
  assert.ok(inside.travelled <= travelledBeforeBreak);
});

test('berry skill uses one bomb actor for three landings and a final three-way split', () => {
  const state = createBattleState({
    progress: {
      contractRanks: { shell: 1, berry: 1 },
      selectedHero: 'berry',
    },
  });
  assert.equal(startNextTowerDefenseWave(state), true);
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  state.hero.cooldown = 999;
  const primary = enemyAt({
    laneIndex: 2, y: state.hero.y - 140, uid: 'a-bomb-primary', hp: 100_000, speed: 0,
  });
  const bystander = enemyAt({
    laneIndex: 2, y: state.hero.y - 150, uid: 'b-bomb-bystander', hp: 100_000, speed: 0,
  });
  state.enemies = [primary, bystander];
  const bystanderHp = bystander.hp;

  assert.equal(activateTowerDefenseHeroSkill(state), true);
  assert.equal(state.projectiles.length, 0);
  assert.equal(state.heroSkillActors.length, 1);
  const bomb = state.heroSkillActors[0];
  assert.equal(bomb.type, 'berry-bounce');
  assert.equal(bomb.waypoints.length, 3);
  const initialPosition = { x: bomb.x, y: bomb.y };
  updateTowerDefense(state, 0.05);
  assert.notDeepEqual({ x: bomb.x, y: bomb.y }, initialPosition);
  assert.equal(bystander.hp, bystanderHp, 'bombs deal no damage before reaching the ground');
  for (let tick = 0; tick < 31; tick += 1) updateTowerDefense(state, 0.05);
  assert.ok(bystander.hp < bystanderHp);
  const impacts = state.events.filter(({ type, mechanic, phase }) => (
    type === 'hero-skill-mechanic' && mechanic === HERO_TYPES.berry.skill.mechanic
      && ['bounce', 'final-split'].includes(phase)
  ));
  assert.equal(impacts.length, 3);
  assert.equal(impacts.at(-1).splits.length, 3);
});

test('dew tide travels out and back so one enemy can be hit once per direction', () => {
  const state = createBattleState({
    progress: {
      contractRanks: { shell: 1, dew: 1 },
      selectedHero: 'dew',
    },
  });
  assert.equal(startNextTowerDefenseWave(state), true);
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  state.hero.cooldown = 999;
  const target = enemyAt({
    laneIndex: 2, y: state.hero.y - 170, uid: 'wave-inline', hp: 100_000, speed: 0,
  });
  const offAxis = enemyAt({
    laneIndex: 4, y: state.hero.y - 170, uid: 'wave-off-axis', hp: 100_000, speed: 0,
  });
  state.enemies = [target, offAxis];
  const targetHp = target.hp;
  const offAxisHp = offAxis.hp;

  assert.equal(activateTowerDefenseHeroSkill(state), true);
  const firstWave = state.heroSkillActors[0];
  assert.equal(firstWave.type, 'return-wave');
  assert.equal(target.hp, targetHp);
  for (let tick = 0; tick < 6; tick += 1) updateTowerDefense(state, 0.05);
  assert.ok(firstWave.distanceTravelled > 0);
  assert.deepEqual(firstWave.outboundHitUids, [target.uid]);
  assert.ok(Math.abs(
    (targetHp - target.hp) - heroStatsForRank('dew', 1).skillSteps[0].damage,
  ) < 1e-6);
  assert.equal(offAxis.hp, offAxisHp);
  for (let tick = 0; tick < 40; tick += 1) updateTowerDefense(state, 0.05);
  assert.deepEqual(firstWave.returnHitUids, [target.uid]);
  assert.ok(Math.abs(
    (targetHp - target.hp)
      - heroStatsForRank('dew', 1).skillSteps[0].damage
      - heroStatsForRank('dew', 1).skillSteps[0].returnDamage,
  ) < 1e-6);
  assert.ok(state.events.some(({ type, phase }) => type === 'hero-skill-mechanic' && phase === 'turn'));
});

test('frost wall intersects a nearby aimed enemy instead of spawning behind it', () => {
  const state = createBattleState({
    progress: {
      contractRanks: { shell: 1, frost: 1 },
      selectedHero: 'frost',
    },
  });
  assert.equal(startNextTowerDefenseWave(state), true);
  state.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  state.hero.cooldown = 999;
  const target = enemyAt({
    laneIndex: 2, y: state.hero.y - 90, uid: 'near-wall-target', hp: 100_000,
    speed: 0.0001,
  });
  state.enemies = [target];
  const targetHp = target.hp;

  assert.equal(activateTowerDefenseHeroSkill(state), true);
  const wall = state.heroSkillActors.find(({ type }) => type === 'frost-wall');
  assert.ok(wall);
  assert.ok(Math.hypot(wall.x - target.x, wall.y - target.y) < 1e-6);
  updateTowerDefense(state, 0.05);
  assert.ok(target.hp < targetHp);
  assert.deepEqual(wall.crossedUids, [target.uid]);
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
  assert.equal(state.hero.shieldHp, 190);
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
  assert.equal(state.hero.shieldHp, 90);
  const hit = state.events.findLast(({ type }) => type === 'hero-hit');
  assert.deepEqual({ damage: hit.damage, absorbed: hit.absorbed }, {
    damage: 0, absorbed: 100,
  });
  attacker.attackCooldown = 999;
  for (let tick = 0; tick < 45; tick += 1) updateTowerDefense(state, 0.05);
  const counter = state.events.find(({ type, phase }) => (
    type === 'hero-skill-mechanic' && phase === 'counter-release'
  ));
  assert.equal(counter.absorbedDamage, 100);
  assert.ok(counter.damage > HERO_TYPES.shell.skill.steps[0].damage);
});

test('wave clear returns to prep, restores actors, and never auto-starts', () => {
  const state = createBattleState();
  const squad = buyTowerDefenseSquad(state, 'ranged', 0);
  assert.equal(startNextTowerDefenseWave(state), true);
  squad.y -= 140;
  squad.hp = squad.memberHp;
  squad.aliveMembers = 1;
  state.hero.y -= 200;
  state.hero.skillDashTime = 0.47;
  state.heroSkillQueue = [{ uid: 'lingering-queue', remaining: 999 }];
  state.heroSkillActors = [{
    uid: 'lingering-field', type: 'field', age: 0, duration: 10,
    x: 360, y: 500, radius: 100, tickInterval: 1, tickTimer: 0,
    tickDamage: 0, maxTargets: 1,
  }];
  state.projectiles = [{
    uid: 'lingering-projectile', type: 'berry', effect: 'skill-splash',
    groundSplash: true, tracksTarget: false, x: 360, y: 800,
    targetX: 360, targetY: 300, speed: 1, damage: 0,
    splashRadius: 1, maxTargets: 1, age: 0, maxAge: 10,
  }];
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
  assert.equal(state.hero.skillDashTime, 0);
  assert.deepEqual(state.heroSkillQueue, []);
  assert.deepEqual(state.heroSkillActors, []);
  assert.deepEqual(state.projectiles, []);
  for (let tick = 0; tick < 300; tick += 1) updateTowerDefense(state, 0.05);
  assert.equal(state.wave, 1);
  assert.equal(state.waveActive, false);
  assert.equal(skipTowerDefenseBreak(state), true);
  assert.equal(state.wave, 2);
  assert.equal(state.phase, 'combat');
  assert.equal(state.hero.skillDashTime, 0);
});

test('waves two, four, and six offer deterministic run-only choices that block the next wave', () => {
  assert.ok(TD_BATTLE_UPGRADES.length >= 9);
  assert.equal(new Set(TD_BATTLE_UPGRADES.map(({ id }) => id)).size,
    TD_BATTLE_UPGRADES.length);
  assert.equal(Object.isFrozen(TD_BATTLE_UPGRADES), true);
  for (const upgrade of TD_BATTLE_UPGRADES) {
    assert.equal(TD_BATTLE_UPGRADE_BY_ID[upgrade.id], upgrade);
    assert.equal(Object.isFrozen(upgrade), true);
    assert.equal(Object.isFrozen(upgrade.modifiers), true);
    assert.equal(/heal|healing|治疗|恢复|回血/i.test([
      upgrade.id, upgrade.name, upgrade.description, ...Object.keys(upgrade.modifiers),
    ].join(' ')), false, `${upgrade.id} is not a healing choice`);
  }

  for (const wave of [2, 4, 6]) {
    const first = createBattleState({ mode: 'endless', seed: 0xABCD1234 });
    const second = createBattleState({ mode: 'endless', seed: 0xABCD1234 });
    for (const state of [first, second]) {
      state.wave = wave;
      state.phase = 'combat';
      state.waveActive = true;
      state.spawnQueue = [];
      state.enemies = [];
      updateTowerDefense(state, 0.01);
      assert.deepEqual(state.pendingBattleUpgrade?.afterWave, wave);
      assert.equal(state.pendingBattleUpgrade.options.length, 3);
      assert.equal(new Set(state.pendingBattleUpgrade.options).size, 3);
      assert.equal(new Set(state.pendingBattleUpgrade.options.map((id) => (
        TD_BATTLE_UPGRADE_BY_ID[id].target
      ))).size, 3, 'each offer covers three different play styles');
      assert.equal(startNextTowerDefenseWave(state), false);
      assert.deepEqual(state.events.findLast(({ type }) => type === 'battle-upgrade-offer'), {
        type: 'battle-upgrade-offer', afterWave: wave,
        optionIds: [...state.pendingBattleUpgrade.options],
      });
    }
    assert.deepEqual(first.pendingBattleUpgrade, second.pendingBattleUpgrade);
  }

  const stage = createBattleState({ stageId: 'stage-3', seed: 0x13572468 });
  stage.wave = 2;
  stage.phase = 'combat';
  stage.waveActive = true;
  stage.spawnQueue = [];
  stage.enemies = [];
  updateTowerDefense(stage, 0.01);
  const snapshot = clone(stage);
  assert.equal(chooseTowerDefenseBattleUpgrade(stage, 'not-offered'), null);
  assert.deepEqual(stage, snapshot, 'an invalid choice is atomic');
  const upgradeId = stage.pendingBattleUpgrade.options[0];
  const chosen = chooseTowerDefenseBattleUpgrade(stage, upgradeId);
  assert.equal(chosen.id, upgradeId);
  assert.equal(chosen.afterWave, 2);
  assert.equal(chosen.rank, 1);
  assert.equal(stage.pendingBattleUpgrade, null);
  assert.equal(stage.battleUpgradeRanks[upgradeId], 1);
  assert.deepEqual(stage.battleUpgradeHistory, [{ afterWave: 2, id: upgradeId, rank: 1 }]);
  assert.equal(startNextTowerDefenseWave(stage), true);

  const daily = createBattleState({ mode: 'daily' });
  daily.wave = 2;
  daily.phase = 'combat';
  daily.waveActive = true;
  daily.spawnQueue = [];
  daily.enemies = [];
  updateTowerDefense(daily, 0.01);
  assert.equal(daily.pendingBattleUpgrade, null, 'daily rules do not add the ordinary run choice');
});

test('a pending battle choice atomically freezes every preparation layout mutation', () => {
  const state = createBattleState({
    progress: {
      squadRanks: { melee: 1, ranged: 1 },
      turretRanks: { 'gel-mortar': 1 },
    },
  });
  state.currency = 5_000;
  const first = buyTowerDefenseSquad(state, 'melee', 0);
  const second = buyTowerDefenseSquad(state, 'melee', 1);
  const turret = buildTowerDefenseTurret(state, 0, 'gel-mortar');
  assert.ok(first && second && turret);
  state.waveBreak = 1.25;
  state.pendingBattleUpgrade = { afterWave: 2, options: ['hero-force'] };

  const blockedMutations = [
    () => buyTowerDefenseSquad(state, 'ranged', 2),
    () => buildTowerDefenseTurret(state, 1, 'gel-mortar'),
    () => moveTowerToPad(state, first.uid, 3),
    () => mergeTowers(state, first.uid, second.uid),
    () => buyTowerDefenseSquadFusion(state, 'melee', first.uid),
    () => reclaimTowerToHand(state, first.uid),
    () => skipTowerDefenseBreak(state),
  ];
  for (const mutate of blockedMutations) {
    const snapshot = clone(state);
    const result = mutate();
    assert.ok(result == null || result === false);
    assert.deepEqual(state, snapshot);
  }

  assert.ok(chooseTowerDefenseBattleUpgrade(state, 'hero-force'));
  assert.equal(state.pendingBattleUpgrade, null);
  assert.equal(moveTowerToPad(state, first.uid, 3), first,
    'layout mutations resume immediately after the required choice');

  const fusionState = createBattleState({ progress: { squadRanks: { melee: 1 } } });
  fusionState.currency = 5_000;
  const fusionTarget = buyTowerDefenseSquad(fusionState, 'melee', 0);
  assert.equal(buyTowerDefenseSquadFusion(fusionState, 'melee', fusionTarget.uid), fusionTarget);
  fusionState.pendingBattleUpgrade = { afterWave: 2, options: ['hero-force'] };
  const fusionSnapshot = clone(fusionState);
  assert.equal(chooseTowerDefenseSquadAbility(fusionState, 'shell-wall'), null);
  assert.deepEqual(fusionState, fusionSnapshot,
    'an already-open fusion choice cannot bypass the battle-upgrade modal');
  assert.ok(chooseTowerDefenseBattleUpgrade(fusionState, 'hero-force'));
  assert.equal(chooseTowerDefenseSquadAbility(fusionState, 'shell-wall'), fusionTarget);
});

test('every battle upgrade immediately changes its unit snapshot or combat currency', () => {
  const state = createBattleState({
    progress: {
      squadRanks: { melee: 1 },
      turretRanks: { 'gel-mortar': 1 },
    },
  });
  state.currency = 2_000;
  const squad = buyTowerDefenseSquad(state, 'melee', 0);
  const turret = buildTowerDefenseTurret(state, 0, 'gel-mortar');
  const base = {
    heroDamage: state.hero.damage,
    heroInterval: state.hero.interval,
    heroRange: state.hero.range,
    squadDamage: squad.damagePerMember,
    squadInterval: squad.interval,
    squadRange: squad.range,
    squadSpeed: squad.moveSpeed,
    turretDamage: turret.damage,
    turretInterval: turret.interval,
    turretRange: turret.range,
    heroHp: state.hero.hp,
    squadHp: squad.hp,
  };
  const currencyBeforeChoices = state.currency;
  TD_BATTLE_UPGRADES.forEach((upgrade, index) => {
    state.pendingBattleUpgrade = { afterWave: 2 + index, options: [upgrade.id] };
    const chosen = chooseTowerDefenseBattleUpgrade(state, upgrade.id);
    assert.equal(chosen?.id, upgrade.id);
    assert.equal(state.battleUpgradeRanks[upgrade.id], 1);
  });
  assert.ok(state.hero.damage > base.heroDamage);
  assert.ok(state.hero.interval < base.heroInterval);
  assert.ok(state.hero.range > base.heroRange);
  assert.ok(squad.damagePerMember > base.squadDamage);
  assert.ok(squad.interval < base.squadInterval);
  assert.ok(squad.range > base.squadRange);
  assert.ok(squad.moveSpeed > base.squadSpeed);
  assert.ok(turret.damage > base.turretDamage);
  assert.ok(turret.interval < base.turretInterval);
  assert.ok(turret.range > base.turretRange);
  assert.equal(state.hero.hp, base.heroHp, 'battle choices do not heal the hero');
  assert.equal(squad.hp, base.squadHp, 'battle choices do not heal squads');
  assert.equal(state.currency, currencyBeforeChoices + 25 + 80);
  assert.equal(towerRange(state, squad), squad.range);

  replayTowerDefenseRun(state);
  assert.equal(state.pendingBattleUpgrade, null);
  assert.deepEqual(state.battleUpgradeRanks, {});
  assert.deepEqual(state.battleUpgradeHistory, []);
});

test('rich gel increases real defeat income rather than only changing display state', () => {
  const state = createBattleState();
  state.pendingBattleUpgrade = { afterWave: 2, options: ['rich-gel'] };
  assert.ok(chooseTowerDefenseBattleUpgrade(state, 'rich-gel'));
  holdCombatWithHero(state);
  state.hero.cooldown = 0;
  const enemy = enemyAt({
    laneIndex: 2, y: state.hero.y - 80, uid: 'rich-gel-target', hp: 1, speed: 0,
  });
  state.enemies = [enemy];
  const currency = state.currency;
  updateTowerDefense(state, 0.01);
  resolveProjectiles(state);
  assert.equal(state.currency - currency, Math.round(TD_ENEMIES.bug.reward * 1.3));
  assert.equal(state.events.find(({ type }) => type === 'enemy-defeat').reward,
    Math.round(TD_ENEMIES.bug.reward * 1.3));
});

test('menu and defeat transitions clear persistent skill actors and ground projectiles', () => {
  const menuState = createBattleState({
    progress: {
      contractRanks: { shell: 1, bubble: 1 },
      selectedHero: 'bubble',
    },
  });
  assert.equal(startNextTowerDefenseWave(menuState), true);
  menuState.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  menuState.hero.cooldown = 999;
  menuState.enemies = [enemyAt({
    laneIndex: 2, y: menuState.hero.y - 120, uid: 'menu-field-target', speed: 0,
  })];
  assert.equal(activateTowerDefenseHeroSkill(menuState), true);
  assert.ok(menuState.heroSkillActors.length > 0);
  returnToTowerDefenseMenu(menuState);
  assert.deepEqual(menuState.heroSkillQueue, []);
  assert.deepEqual(menuState.heroSkillActors, []);
  assert.deepEqual(menuState.projectiles, []);

  const defeatState = createBattleState({
    progress: {
      contractRanks: { shell: 1, berry: 1 },
      selectedHero: 'berry',
    },
  });
  assert.equal(startNextTowerDefenseWave(defeatState), true);
  defeatState.spawnQueue = [{ uid: 'held-spawn', type: 'bug', laneIndex: 0, at: 999 }];
  defeatState.hero.cooldown = 999;
  defeatState.enemies = [enemyAt({
    laneIndex: 2, y: defeatState.hero.y - 120, uid: 'defeat-bomb-target', speed: 0,
  })];
  assert.equal(activateTowerDefenseHeroSkill(defeatState), true);
  assert.ok(defeatState.heroSkillActors.some(({ type }) => type === 'berry-bounce'));
  defeatState.coreHp = 0;
  updateTowerDefense(defeatState, 0.05);
  assert.equal(defeatState.result, 'defeat');
  assert.deepEqual(defeatState.heroSkillQueue, []);
  assert.deepEqual(defeatState.heroSkillActors, []);
  assert.deepEqual(defeatState.projectiles, []);
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
  const source = buyTowerDefenseSquad(state, 'ranged', 0);
  assert.equal(mergeTowers(state, source.uid, squad.uid), squad);
  assert.equal(squad.members.length, 4);
  const pad = stage.pads[padIndex];
  const rows = [...new Set(squad.members.map(({ y }) => y))].sort((left, right) => left - right);
  assert.equal(rows.length, 2, 'the four soldiers begin in two readable rows');
  assert.ok(rows[1] - rows[0] >= 28, 'the two soldier rows do not overlap');
  rows.forEach((rowY) => {
    const row = squad.members.filter(({ y }) => y === rowY).sort((left, right) => left.x - right.x);
    assert.equal(row.length, 2);
    assert.ok(row[1].x - row[0].x >= 48, 'soldiers in one row keep a body-width gap');
  });
  assert.ok(squad.members.every(({ x, y }) => (
    Math.abs(x - pad.x) <= 26 && Math.abs(y - pad.y) <= 14
  )), 'the wider formation still belongs to one deployment cell');
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

test('lantern and rift boss fire their authored ranged attacks before contact', () => {
  for (const type of ['lantern', 'rift-boss']) {
    const state = holdCombatWithHero(createBattleState());
    state.hero.x = 360;
    state.hero.y = 360;
    const enemy = enemyAt({
      laneIndex: 2, y: 222, uid: `${type}-ranged-probe`, type, hp: 100_000, speed: 0,
    });
    enemy.attackCooldown = 0;
    state.enemies = [enemy];
    state.events = [];
    const heroHp = state.hero.hp;

    updateTowerDefense(state, 0.01);

    const ranged = state.events.find(({ type: eventType }) => (
      eventType === 'enemy-ranged-attack'
    ));
    assert.ok(ranged, `${type} produces a ranged attack event`);
    assert.equal(ranged.enemyUid, enemy.uid);
    assert.equal(ranged.targetUid, state.hero.uid);
    assert.equal(enemy.blockedByTowerUid, null, `${type} attacks before physical contact`);
    const expectedDamage = TD_ENEMIES[type].attackDamage
      * TD_ENEMIES[type].rangedDamageMultiplier;
    assert.ok(Math.abs((heroHp - state.hero.hp) - expectedDamage) < 1e-9);
  }
});

test('thorn periodically charges and applies one stronger impact on contact', () => {
  const state = holdCombatWithHero(createBattleState());
  state.hero.x = 360;
  state.hero.y = 360;
  const enemy = enemyAt({
    laneIndex: 2, y: 222, uid: 'thorn-charge-probe',
    type: 'thorn', hp: 100_000, speed: TD_ENEMIES.thorn.speed,
  });
  enemy.attackCooldown = 999;
  enemy.chargeCooldown = 0;
  enemy.chargeTime = 0;
  state.enemies = [enemy];
  state.events = [];
  const heroHp = state.hero.hp;

  for (let tick = 0; tick < 30 && !state.events.some(({ type }) => (
    type === 'enemy-charge-impact'
  )); tick += 1) updateTowerDefense(state, 0.05);

  assert.ok(state.events.some(({ type }) => type === 'enemy-charge-start'));
  const impact = state.events.find(({ type }) => type === 'enemy-charge-impact');
  assert.ok(impact, 'the charge reaches a blocker before its short burst expires');
  assert.equal(impact.targetUid, state.hero.uid);
  const expectedDamage = TD_ENEMIES.thorn.attackDamage
    * TD_ENEMIES.thorn.chargeImpactMultiplier;
  assert.ok(Math.abs(impact.damage - expectedDamage) < 1e-9);
  assert.ok(Math.abs((heroHp - state.hero.hp) - expectedDamage) < 1e-9,
    'the disabled normal attack proves the damage came from the charge impact');
});

test('acid shell boss warns, guards, then rushes forward with a damaging shockwave', () => {
  const state = holdCombatWithHero(createBattleState());
  state.hero.x = 360;
  state.hero.y = 360;
  state.hero.cooldown = 0;
  const enemy = enemyAt({
    laneIndex: 2, y: 222, uid: 'acid-shell-skill-probe',
    type: 'boss', hp: 100_000, speed: 0,
  });
  enemy.attackCooldown = 999;
  enemy.bossSkillCooldown = 0;
  enemy.bossSkillWarningTime = 0;
  state.enemies = [enemy];
  state.events = [];

  const warningOrigin = { x: enemy.x, y: enemy.y };
  const lane = stageForState(state).lanes[enemy.laneIndex];
  const predictedTravelled = Math.min(
    pathMetrics(lane.path).total,
    enemy.travelled + TD_ENEMIES.boss.bossSkillDashDistance,
  );
  const predictedImpact = pointOnPath(lane.path, predictedTravelled);
  updateTowerDefense(state, 0.01);
  const warning = state.events.find(({ type }) => type === 'boss-skill-warning');
  assert.ok(warning);
  assert.deepEqual({
    enemyUid: warning.enemyUid,
    enemyType: warning.enemyType,
    skillId: warning.skillId,
    targetUid: warning.targetUid,
    targetKind: warning.targetKind,
  }, {
    enemyUid: enemy.uid,
    enemyType: 'boss',
    skillId: 'shell-rush',
    targetUid: null,
    targetKind: null,
  });
  assert.equal(warning.warningDuration, TD_ENEMIES.boss.bossSkillWarning);
  assert.equal(warning.originX, warningOrigin.x);
  assert.equal(warning.originY, warningOrigin.y);
  assert.equal(warning.targetX, predictedImpact.x);
  assert.equal(warning.targetY, predictedImpact.y);
  assert.equal(warning.x, predictedImpact.x);
  assert.equal(warning.y, predictedImpact.y);
  assert.equal(warning.radius, TD_ENEMIES.boss.bossSkillRadius);
  assert.equal(warning.dashDistance, predictedTravelled - enemy.travelled);
  resolveProjectiles(state);
  const guardedHit = state.events.find(({ type, enemyUid }) => (
    type === 'enemy-hit' && enemyUid === enemy.uid
  ));
  assert.ok(guardedHit);
  assert.equal(guardedHit.guardMultiplier, TD_ENEMIES.boss.shellGuardDamageMultiplier);

  const travelledBefore = enemy.travelled;
  const heroHp = state.hero.hp;
  for (let tick = 0; tick < 40 && !state.events.some(({ type }) => (
    type === 'boss-skill-cast'
  )); tick += 1) updateTowerDefense(state, 0.05);
  const cast = state.events.find(({ type }) => type === 'boss-skill-cast');
  assert.ok(cast);
  assert.equal(cast.skillId, 'shell-rush');
  assert.equal(cast.originX, warning.originX);
  assert.equal(cast.originY, warning.originY);
  assert.equal(cast.targetX, warning.targetX);
  assert.equal(cast.targetY, warning.targetY);
  assert.equal(cast.x, warning.targetX);
  assert.equal(cast.y, warning.targetY);
  assert.equal(cast.radius, warning.radius,
    'the telegraphed circle and resolved shockwave share one hit area');
  assert.ok(cast.dashDistance >= TD_ENEMIES.boss.bossSkillDashDistance - 0.01);
  assert.ok(enemy.travelled >= travelledBefore + cast.dashDistance - 0.01);
  assert.ok(cast.targetUids.includes(state.hero.uid));
  assert.ok(state.hero.hp < heroHp, 'the warned shockwave damages a nearby defender');
});

test('rift boss warns its target then temporarily disables exactly that defense unit', () => {
  const state = createBattleState();
  const squad = buyTowerDefenseSquad(state, 'melee', 0);
  const turret = buildTowerDefenseTurret(state, 0, 'gel-mortar');
  holdCombatWithHero(state);
  state.hero.x = 360;
  state.hero.y = 350;
  state.hero.cooldown = 0;
  state.hero.skillCooldown = 0;
  const enemy = enemyAt({
    laneIndex: 2, y: 222, uid: 'rift-lock-skill-probe',
    type: 'rift-boss', hp: 100_000, speed: 0,
  });
  enemy.attackCooldown = 999;
  enemy.bossSkillCooldown = 0;
  enemy.bossSkillWarningTime = 0;
  state.enemies = [enemy];
  state.events = [];

  updateTowerDefense(state, 0.01);
  const warning = state.events.find(({ type }) => type === 'boss-skill-warning');
  assert.ok(warning);
  assert.equal(warning.skillId, 'rift-lock');
  assert.equal(warning.targetUid, state.hero.uid);
  assert.equal(warning.targetKind, 'hero');
  assert.equal(state.hero.disabledTime, 0);

  state.hero.x += 34;
  state.hero.y += 18;
  updateTowerDefense(state, 0.05);
  const warningEffect = state.effects.find(({ type, enemyUid }) => (
    type === 'boss-skill-warning' && enemyUid === enemy.uid
  ));
  assert.ok(warningEffect);
  assert.equal(warningEffect.targetX, state.hero.x);
  assert.equal(warningEffect.targetY, state.hero.y,
    'the visible warning follows the originally locked living unit');

  for (let tick = 0; tick < 40 && !state.events.some(({ type }) => (
    type === 'boss-skill-cast'
  )); tick += 1) updateTowerDefense(state, 0.05);
  const cast = state.events.find(({ type }) => type === 'boss-skill-cast');
  assert.ok(cast);
  assert.equal(cast.skillId, 'rift-lock');
  assert.equal(cast.targetUid, state.hero.uid);
  assert.equal(cast.targetKind, 'hero');
  assert.equal(cast.targetX, state.hero.x);
  assert.equal(cast.targetY, state.hero.y);
  assert.equal(cast.disabledTime, TD_ENEMIES['rift-boss'].bossSkillDisableTime);
  assert.ok(state.hero.disabledTime > 2.4);
  assert.equal(squad.disabledTime, 0);
  assert.equal(turret.disabledTime, 0);
  state.hero.cooldown = 0;
  state.hero.skillCooldown = 0;
  state.projectiles = [];
  assert.equal(activateTowerDefenseHeroSkill(state), false);
  updateTowerDefense(state, 0.05);
  assert.equal(state.projectiles.length, 0, 'a sealed hero cannot auto-attack');

  for (let tick = 0; tick < 70 && state.hero.disabledTime > 0; tick += 1) {
    updateTowerDefense(state, 0.05);
  }
  assert.equal(state.hero.disabledTime, 0);
  updateTowerDefense(state, 0.05);
  assert.ok(state.projectiles.length > 0, 'the hero resumes attacking after the seal expires');
});

test('rift lock cancels when its warned target is lost and never retargets silently', () => {
  const state = createBattleState({ progress: { turretRanks: { 'gel-mortar': 1 } } });
  const turret = buildTowerDefenseTurret(state, 0, 'gel-mortar');
  holdCombatWithHero(state);
  state.hero.x = 360;
  state.hero.y = 350;
  const enemy = enemyAt({
    laneIndex: 2, y: 222, uid: 'rift-lost-target-probe',
    type: 'rift-boss', hp: 100_000, speed: 0,
  });
  enemy.attackCooldown = 999;
  enemy.bossSkillCooldown = 0;
  enemy.bossSkillWarningTime = 0;
  state.enemies = [enemy];
  state.events = [];

  updateTowerDefense(state, 0.01);
  const warning = state.events.find(({ type }) => type === 'boss-skill-warning');
  assert.equal(warning.targetUid, state.hero.uid);
  const warnedPosition = { x: warning.targetX, y: warning.targetY };
  state.hero.hp = 0;

  for (let tick = 0; tick < 40 && !state.events.some(({ type }) => (
    type === 'boss-skill-cancel'
  )); tick += 1) updateTowerDefense(state, 0.05);

  assert.equal(state.events.some(({ type }) => type === 'boss-skill-cast'), false);
  const canceled = state.events.find(({ type }) => type === 'boss-skill-cancel');
  assert.deepEqual(canceled, {
    type: 'boss-skill-cancel', enemyUid: enemy.uid, enemyType: 'rift-boss',
    skillId: 'rift-lock', targetUid: state.hero.uid, targetKind: 'hero',
    targetX: warnedPosition.x, targetY: warnedPosition.y,
    x: enemy.x, y: enemy.y, reason: 'target-lost',
  });
  assert.equal(turret.disabledTime, 0,
    'an unwarned surviving defense is not substituted at cast time');
});

function singleHeroShotDamageAgainst(enemyType) {
  const state = holdCombatWithHero(createBattleState());
  state.hero.x = 360;
  state.hero.y = 600;
  state.hero.cooldown = 0;
  const enemy = enemyAt({
    laneIndex: 2, y: 500, uid: `${enemyType}-armor-probe`,
    type: enemyType, hp: 10_000, speed: 0,
  });
  enemy.attackCooldown = 999;
  state.enemies = [enemy];
  state.events = [];
  updateTowerDefense(state, 0.01);
  assert.equal(state.projectiles.length, 1);
  resolveProjectiles(state);
  return {
    damage: enemy.maxHp - enemy.hp,
    hit: state.events.find(({ type, enemyUid }) => (
      type === 'enemy-hit' && enemyUid === enemy.uid
    )),
  };
}

test('mud and rift boss armor reduce incoming damage without adding a health wall', () => {
  const baseline = singleHeroShotDamageAgainst('bug');
  const mud = singleHeroShotDamageAgainst('mud');
  const rift = singleHeroShotDamageAgainst('rift-boss');

  assert.ok(Math.abs(mud.damage - baseline.damage * (1 - TD_ENEMIES.mud.armorReduction)) < 1e-9);
  assert.ok(Math.abs(
    rift.damage - baseline.damage * (1 - TD_ENEMIES['rift-boss'].armorReduction)
  ) < 1e-9);
  assert.equal(mud.hit.armorReduction, 0.28);
  assert.equal(rift.hit.armorReduction, 0.14);
  assert.ok(TD_ENEMIES.mud.speed < TD_ENEMIES.bug.speed,
    'the armored mud enemy stays visibly heavy and slow');
  assert.ok(TD_ENEMIES['rift-boss'].hp < TD_ENEMIES.boss.hp,
    'the hybrid boss trades some raw health for mechanics');
});

test('authored waves and endless pressure remain sharply capped', () => {
  const authoredWaveTotals = TD_STAGES.map((stage) => stage.waves.map(
    (groups) => groups.reduce((sum, entry) => sum + entry.count, 0),
  ));
  assert.equal(TD_STAGES.length, 20);
  assert.deepEqual(TD_STAGES.map(({ id }) => id), Array.from(
    { length: 20 }, (_, index) => `stage-${index + 1}`,
  ));
  assert.deepEqual(TD_STAGES.map(({ index }) => index), Array.from(
    { length: 20 }, (_, index) => index + 1,
  ));
  assert.equal(new Set(TD_STAGES.map(({ name }) => name)).size, 20);
  assert.equal(TD_STAGES[0].name, '软胶坡');
  assert.equal(TD_STAGES.at(-1).name, '虹胶之巅');
  assert.deepEqual(authoredWaveTotals[0], [5, 7, 7, 7, 7]);
  const establishedEnemyBudget = Math.max(...authoredWaveTotals.slice(0, 6).flat());
  assert.equal(establishedEnemyBudget, 9);
  for (const stage of TD_STAGES) {
    assert.ok(stage.waves.length >= 5 && stage.waves.length <= 7,
      `${stage.id} stays within the five-to-seven-wave story budget`);
    assert.equal(TD_TURRET_SLOTS[stage.id].length, 4);
    const finalBossCount = stage.waves.at(-1)
      .filter(({ type }) => TD_ENEMIES[type]?.boss)
      .reduce((total, entry) => total + entry.count, 0);
    assert.equal(finalBossCount, 1, `${stage.id} ends with one boss`);
    const finalEscortCount = stage.waves.at(-1)
      .filter(({ type }) => !TD_ENEMIES[type]?.boss)
      .reduce((total, entry) => total + entry.count, 0);
    assert.ok(finalEscortCount >= 5, `${stage.id} boss keeps a meaningful escort`);
  }
  for (const totals of authoredWaveTotals) {
    assert.equal(totals.every((count) => count >= 5 && count <= establishedEnemyBudget), true);
  }
  assert.equal(Math.max(...authoredWaveTotals.slice(6).flat()), establishedEnemyBudget,
    'later chapters gain strength without increasing the authored spawn cap');
  assert.ok(TD_ENEMIES.stone.hp >= TD_ENEMIES.bug.hp * 3);
  assert.deepEqual({
    hp: TD_ENEMIES.boss.hp,
    attackDamage: TD_ENEMIES.boss.attackDamage,
    coreDamage: TD_ENEMIES.boss.coreDamage,
    attackInterval: TD_ENEMIES.boss.attackInterval,
  }, { hp: 1050, attackDamage: 32, coreDamage: 10, attackInterval: 1.45 });
  assert.ok(TD_ENEMIES.boss.hp <= 1850 * 0.6,
    'the slime boss durability is visibly lower than the former health wall');
  assert.ok(TD_ENEMIES.boss.hp >= TD_ENEMIES.stone.hp * 3,
    'the lighter boss is still meaningfully sturdier than an elite');
  assert.deepEqual(
    ['thorn', 'lantern', 'mud', 'rift-boss'].map((type) => TD_ENEMIES[type].ownerId),
    ['enemy-thorn-roller', 'enemy-lantern-spore', 'enemy-mud-bulwark', 'enemy-rift-beacon-king'],
  );
  assert.equal(TD_ENEMIES['rift-boss'].boss, true);
  const lateStoryTypes = new Set(TD_STAGES.slice(6).flatMap(({ waves }) => (
    waves.flatMap((groups) => groups.map(({ type }) => type)
  ))));
  for (const type of ['thorn', 'lantern', 'mud', 'rift-boss']) assert.ok(lateStoryTypes.has(type));
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
  assert.equal(Math.round(TD_ENEMIES.boss.hp * firstBossScale.hp), 1712);
  assert.equal(Math.round(TD_ENEMIES.boss.attackDamage * Math.sqrt(firstBossScale.hp)), 41);
  const storyScaleCheckpoints = [1, 5, 10, 15, 20]
    .map((stageIndex) => stageScaleForWave(stageIndex, 1));
  for (let index = 1; index < storyScaleCheckpoints.length; index += 1) {
    assert.ok(storyScaleCheckpoints[index].hp > storyScaleCheckpoints[index - 1].hp);
    assert.ok(storyScaleCheckpoints[index].speed > storyScaleCheckpoints[index - 1].speed);
    assert.ok(storyScaleCheckpoints[index].reward > storyScaleCheckpoints[index - 1].reward);
  }
  assert.ok(stageScaleForWave(19, 7).hp < TD_STAGE_SCALE_CAPS.hp,
    'story health scaling does not flatten before the final chapter');
  assert.deepEqual(stageScaleForWave(20, 7), { hp: 3.397, speed: 1.4, reward: 2.195 });
  assert.deepEqual(stageScaleForWave(20, 10_000), TD_STAGE_SCALE_CAPS);
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
  assert.equal(state.currency, 180);
  if (!heroActive) state.hero.hp = 0;

  let ticks = 0;
  while (!state.result && ticks < 8000) {
    if (!state.waveActive && state.phase === 'prep') {
      if (state.pendingBattleUpgrade) {
        assert.ok(chooseTowerDefenseBattleUpgrade(
          state,
          state.pendingBattleUpgrade.options[0],
        ));
      }
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
  assert.ok(active.coreHp > 0,
    'the starter lineup survives the acid boss rush without making its mechanic cosmetic');
  assert.ok(active.kills >= 32 && active.kills <= 33,
    'the boss rush may be the single enemy that reaches the core');

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
  assert.equal(TD_RECRUITMENT_POOL.length, 28);
  assert.equal(new Set(TD_RECRUITMENT_POOL.map(({ id }) => id)).size, 28);
  assert.deepEqual(new Set(TD_RECRUITMENT_POOL.map(({ kind }) => kind)), new Set([
    'hero', 'squad', 'turret',
  ]));
  assert.equal(TD_RECRUITMENT_POOLS.hero.length, TD_CONTRACT_TYPES.length);
  assert.equal(TD_RECRUITMENT_POOLS.army.length, TD_SQUAD_TYPES.length + TD_TURRET_TYPES.length);
  const recruitmentDefinition = ({ kind, type }) => (
    kind === 'hero' ? HERO_TYPES[type]
      : kind === 'squad' ? SQUAD_TYPES[type] : TURRET_TYPES[type]
  );
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
  assert.ok(results.every(({ kind }) => kind === 'hero'));
  assert.equal(results.every((result) => (
    result.collectibleId === `${result.kind}:${result.type}`
    && recruitmentDefinition(result)?.rarity === result.rarity
  )), true);
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
  assert.equal(guaranteed.rarity, recruitmentDefinition(guaranteed).rarity);
  assert.equal(pity.progress.summonPity, 0);

  const distribution = createTowerDefenseState({
    progress: { tutorialSeen: true, summonCurrency: 40_000, summonRngState: 0xA11CE },
  });
  const rarityCounts = { R: 0, SR: 0, SSR: 0, UR: 0 };
  for (let index = 0; index < 400; index += 1) {
    const result = summonTowerDefenseContracts(distribution, 1)[0];
    rarityCounts[result.rarity] += 1;
  }
  assert.ok(rarityCounts.R > rarityCounts.SR * 1.5,
    'adding multiple collectible types to a rarity must not multiply that rarity weight');
  assert.ok(rarityCounts.SR > rarityCounts.SSR);
  assert.ok(rarityCounts.SSR > rarityCounts.UR);
  const army = createTowerDefenseState({
    progress: {
      tutorialSeen: true, summonCurrency: 18_000,
      summonRngState: 123, summonPity: 4,
      armySummonRngState: 0xA11CE, armySummonPity: 0,
    },
  });
  const armyResults = [];
  for (let index = 0; index < 120; index += 1) {
    armyResults.push(summonTowerDefenseContracts(army, 1, 'army')[0]);
  }
  assert.deepEqual(new Set(armyResults.map(({ kind }) => kind)), new Set(['squad', 'turret']));
  assert.equal(army.progress.summonPity, 4, 'army draws keep the hero pity independent');
  assert.equal(army.progress.summonRngState, 123, 'army draws keep the hero RNG independent');
});

test('separate hero and army summons unlock the right collection while selected hero persists', () => {
  const state = createTowerDefenseState({
    progress: {
      tutorialSeen: true,
      summonCurrency: 900,
      summonRngState: 0xC0A7A5,
      contractRanks: { shell: 1, needle: 1 },
      selectedHero: 'needle',
    },
  });
  const squadBefore = { ...state.progress.squadRanks };
  const turretBefore = { ...state.progress.turretRanks };
  const heroResults = summonTowerDefenseContracts(state, 10, 'hero');
  assert.ok(heroResults.every(({ kind }) => kind === 'hero'));
  assert.deepEqual(state.progress.squadRanks, squadBefore);
  assert.deepEqual(state.progress.turretRanks, turretBefore);
  state.progress.summonCurrency = 900;
  const heroRanksBeforeArmy = { ...state.progress.contractRanks };
  const armyResults = summonTowerDefenseContracts(state, 10, 'army');
  assert.ok(armyResults.every(({ kind }) => ['squad', 'turret'].includes(kind)));
  assert.deepEqual(state.progress.contractRanks, heroRanksBeforeArmy);
  assert.equal(selectTowerDefenseHero(state, 'needle'), true);
  assert.equal(state.heroes.filter(({ selected }) => selected).length, 1);
  const serialized = serializeTowerDefenseProgress(state);
  const restored = createTowerDefenseState({ progress: JSON.parse(JSON.stringify(serialized)) });
  assert.equal(restored.progress.selectedHero, 'needle');
  assert.equal(restored.heroes.find(({ selected }) => selected).type, 'needle');
  beginTowerDefenseRun(restored, { stageId: 'stage-1' });
  assert.equal(restored.hero.type, 'needle');
});

test('hero duplicates become shards and manual rank-up consumes both shards and coins up to rank ten', () => {
  const ranks = Object.fromEntries(TD_CONTRACT_TYPES.map((type) => [type, 1]));
  const state = createTowerDefenseState({
    progress: {
      tutorialSeen: true, tutorialVersion: TD_TUTORIAL_VERSION,
      summonCurrency: 900, metaCoins: 10_000, contractRanks: ranks,
    },
  });
  const summoned = summonTowerDefenseContracts(state, 10, 'hero');
  assert.ok(summoned.every(({ unlocked, newRank, rank }) => !unlocked && newRank === rank));
  assert.ok(Object.values(state.progress.contractShards).some((value) => value > 0));
  assert.ok(state.progress.contractEssence > 0);

  const cost = heroRankUpCost('shell', 1);
  state.progress.contractShards.shell = cost.shards;
  const beforeCoins = state.progress.metaCoins;
  const upgraded = upgradeTowerDefenseHero(state, 'shell');
  assert.equal(upgraded.rank, 2);
  assert.equal(state.progress.contractRanks.shell, 2);
  assert.equal(state.progress.contractShards.shell, 0);
  assert.equal(state.progress.metaCoins, beforeCoins - cost.metaCoins);

  const snapshot = clone(state.progress);
  assert.equal(upgradeTowerDefenseHero(state, 'shell'), null);
  assert.deepEqual(state.progress, snapshot, 'an unaffordable rank-up is atomic');
  const maxed = createTowerDefenseState({
    progress: {
      tutorialSeen: true, tutorialVersion: TD_TUTORIAL_VERSION,
      metaCoins: 100_000, contractRanks: { shell: 9 },
      contractShards: { shell: heroRankUpCost('shell', 9).shards + 5 },
    },
  });
  const maxCost = heroRankUpCost('shell', 9);
  const maxUpgrade = upgradeTowerDefenseHero(maxed, 'shell');
  assert.equal(maxUpgrade.rank, 10);
  assert.equal(maxUpgrade.convertedCoins, 160);
  assert.equal(maxed.progress.contractShards.shell, 0);
  assert.equal(maxed.progress.metaCoins, 100_000 - maxCost.metaCoins + 160);
  assert.equal(heroRankUpCost('shell', 10), null);
  assert.equal(upgradeTowerDefenseHero(maxed, 'shell'), null);
});

test('hero shard exchange unlocks a chosen hero while equipment uses its own pool and affects combat', () => {
  const exchangeCost = heroExchangeCost('needle');
  const state = createTowerDefenseState({
    progress: {
      tutorialSeen: true, tutorialVersion: TD_TUTORIAL_VERSION,
      contractEssence: exchangeCost, summonCurrency: 1080,
    },
  });
  assert.equal(state.progress.contractRanks.needle, 0);
  assert.equal(exchangeTowerDefenseHero(state, 'needle').cost, exchangeCost);
  assert.equal(state.progress.contractRanks.needle, 1);
  assert.equal(state.progress.contractEssence, 0);
  assert.equal(exchangeTowerDefenseHero(state, 'needle'), null);

  assert.deepEqual(TD_EQUIPMENT_SUMMON_COSTS, { 1: 120, 10: 1080 });
  const equipmentResults = summonTowerDefenseEquipment(state, 10);
  assert.equal(equipmentResults.length, 10);
  assert.ok(equipmentResults.every(({ kind, iconKey }) => (
    kind === 'equipment' && /^equipment-/.test(iconKey)
  )));
  assert.equal(state.progress.summonCurrency, 0);
  const firstItem = equipmentResults[0];
  assert.ok(equipTowerDefenseHeroItem(state, 'shell', firstItem.uid));
  const equippedRoster = state.heroes.find(({ type }) => type === 'shell');
  const plain = heroStatsForRank('shell', 1);
  assert.ok(equippedRoster.damage > plain.damage);
  assert.ok(equippedRoster.attackSpeed > plain.attackSpeed);
  assert.ok(equippedRoster.maxHp > plain.maxHp);
  assert.equal(beginTowerDefenseRun(state, { stageId: 'stage-1' }), true);
  assert.equal(state.hero.damage, equippedRoster.damage);
  assert.equal(state.hero.interval, equippedRoster.interval);
  assert.equal(state.hero.maxHp, equippedRoster.maxHp);
});

test('daily challenge can be claimed once per day and always runs on hard difficulty', () => {
  const state = createTowerDefenseState({
    progress: {
      tutorialSeen: true, tutorialVersion: TD_TUTORIAL_VERSION,
      summonCurrency: 0, metaCoins: 0,
    },
  });
  assert.equal(beginTowerDefenseDailyRun(state, '2026-09-03'), true);
  assert.equal(state.mode, 'daily');
  assert.equal(state.difficulty, 'hard');
  assert.equal(state.dailyChallenge.dayKey, '2026-09-03');
  assert.equal(state.dailyChallenge.stageIndex, 1,
    'a new player daily challenge stays inside the unlocked stage range');
  state.wave = stageForState(state).waves.length;
  state.phase = 'combat';
  state.waveActive = true;
  state.spawnQueue = [];
  state.enemies = [];
  updateTowerDefense(state, 0.01);
  assert.equal(state.result, 'victory');
  assert.ok(state.resultRewards.metaCoins > 0);
  assert.equal(state.resultRewards.equipmentItems.length, 1);
  assert.deepEqual(state.progress.dailyClaims, ['2026-09-03']);
  returnToTowerDefenseMenu(state);
  assert.equal(beginTowerDefenseDailyRun(state, '2026-09-03'), true);
  state.wave = stageForState(state).waves.length;
  state.phase = 'combat';
  state.waveActive = true;
  state.spawnQueue = [];
  state.enemies = [];
  updateTowerDefense(state, 0.01);
  assert.deepEqual(state.resultRewards, {
    metaCoins: 0, summonCurrency: 0, equipmentItems: [],
  });
});

test('stage difficulty and endless waves grant persistent coins, crystals, and equipment', () => {
  const stage = createBattleState({
    progress: {
      summonCurrency: 0,
      metaCoins: 0,
      equipmentBanner: { rngState: 55, srPity: 9, ssrPity: 29, urPity: 79 },
    },
  });
  const equipmentPityBefore = clone(stage.progress.equipmentBanner);
  stage.wave = TD_STAGES[0].waves.length;
  stage.phase = 'combat';
  stage.waveActive = true;
  stage.spawnQueue = [];
  stage.enemies = [];
  updateTowerDefense(stage, 0.01);
  assert.equal(stage.result, 'victory');
  assert.equal(stage.progress.summonCurrency, 102);
  assert.equal(stage.progress.metaCoins, 760);
  assert.ok(stage.resultRewards.equipmentItems.length >= 1);
  assert.deepEqual(stage.progress.equipmentBanner, equipmentPityBefore,
    'earned stage gear never advances or consumes equipment summon pity');
  assert.equal(stage.progress.unlockedStage, 2);
  assert.ok(stage.events.some(({ type, metaCoins, summonCurrency }) => (
    type === 'meta-reward' && metaCoins === 760 && summonCurrency === 102
  )));

  const endless = createBattleState({
    mode: 'endless', progress: { summonCurrency: 0, metaCoins: 0 },
  });
  endless.wave = 9;
  endless.coreHp = 0;
  updateTowerDefense(endless, 0.01);
  assert.equal(endless.result, 'defeat');
  assert.equal(endless.progress.bestEndlessWave, 9);
  assert.equal(endless.progress.summonCurrency, 120);
  assert.equal(endless.progress.metaCoins, 970);
  assert.equal(endless.resultRewards.equipmentItems.length, 1);

  const hard = createTowerDefenseState({
    progress: {
      tutorialSeen: true, tutorialVersion: TD_TUTORIAL_VERSION,
      summonCurrency: 0, metaCoins: 0, unlockedStage: 1,
    },
  });
  assert.equal(beginTowerDefenseRun(hard, {
    mode: 'stage', stageId: 'stage-1', difficulty: 'hard',
  }), true);
  hard.wave = TD_STAGES[0].waves.length;
  hard.phase = 'combat';
  hard.waveActive = true;
  hard.spawnQueue = [];
  hard.enemies = [];
  updateTowerDefense(hard, 0.01);
  assert.equal(hard.difficulty, 'hard');
  assert.ok(hard.resultRewards.metaCoins > stage.resultRewards.metaCoins);
  assert.ok(hard.resultRewards.summonCurrency > stage.resultRewards.summonCurrency);
  assert.ok(hard.progress.hardClearedStages.includes('stage-1'));
});

test('versioned tutorial teaches stage, purchase categories, turret prep, combat, movement, and skill without soft-locking', () => {
  const state = createTowerDefenseState({ seed: 0xCAFEBABE });
  assert.deepEqual(tutorialTargetForState(state), {
    type: 'stage', stageIndex: 0, label: '1',
  });
  assert.equal(beginTowerDefenseRun(state, { stageId: 'stage-1' }), true);
  assert.deepEqual(tutorialTargetForState(state), {
    type: 'squad', squadType: 'melee', padIndex: 0, label: '近',
  });
  assert.equal(buildTowerDefenseTurret(state, 0, 'gel-mortar'), null,
    'the turret cannot bypass the required squad lesson');
  assert.ok(buyTowerDefenseSquad(state, 'melee', 0));
  assert.deepEqual(tutorialTargetForState(state), {
    type: 'category', category: 'turret', label: '塔',
  });
  assert.equal(startNextTowerDefenseWave(state), false,
    'combat stays locked until the preparation lessons are complete');
  assert.equal(acknowledgeTowerDefenseTutorialCategory(state, 'squad'), false,
    'the wrong category cannot advance the tutorial');
  assert.equal(acknowledgeTowerDefenseTutorialCategory(state, 'turret'), true);
  assert.equal(acknowledgeTowerDefenseTutorialCategory(state, 'turret'), false,
    'the category acknowledgement is idempotent');
  assert.deepEqual(tutorialTargetForState(state), {
    type: 'turret', turretType: 'gel-mortar', slotIndex: 0, label: '炮',
  });
  assert.equal(buildTowerDefenseTurret(state, 1, 'gel-mortar'), null,
    'the tutorial only accepts its highlighted construction slot');
  assert.equal(buildTowerDefenseTurret(state, 0, 'bubble-coil'), null,
    'the tutorial only accepts the starter turret');
  const tutorialTurret = buildTowerDefenseTurret(state, 0, 'gel-mortar');
  assert.ok(tutorialTurret);
  assert.equal(tutorialTurret.type, 'gel-mortar');
  assert.equal(tutorialTurret.slotIndex, 0);
  assert.equal(state.currency, 265,
    'the guided squad and turret purchases leave enough currency to continue');
  assert.deepEqual(tutorialTargetForState(state), { type: 'start', label: '战' });
  assert.equal(startNextTowerDefenseWave(state), true);
  assert.equal(state.tutorial.active, true);
  assert.equal(state.tutorial.step, 'move');
  assert.equal(state.progress.tutorialSeen, false);
  assert.deepEqual(tutorialTargetForState(state), { type: 'move', label: '移' });

  updateTowerDefense(state, 0.05);
  assert.equal(state.enemies.length, 0, 'the first wave waits for the joystick lesson');
  assert.equal(state.waveElapsed, 0);
  assert.equal(activateTowerDefenseHeroSkill(state), false,
    'skill input is blocked before the joystick lesson');

  assert.ok(setTowerDefenseHeroMovement(state, 1, 0));
  assert.equal(state.tutorial.step, 'skill');
  assert.deepEqual(tutorialTargetForState(state), { type: 'skill-wait', label: '等' });
  assert.equal(activateTowerDefenseHeroSkill(state), false,
    'the skill cannot complete the lesson before an enemy appears');

  updateTowerDefense(state, 0.05);
  assert.deepEqual(tutorialTargetForState(state), { type: 'skill', label: '技' });
  const trainingEnemy = state.enemies.find(({ uid }) => uid === state.tutorial.trainingEnemyUid);
  assert.ok(trainingEnemy, 'the first spawned enemy becomes the protected training target');
  trainingEnemy.hp = 1;
  trainingEnemy.poisonDps = 100_000;
  trainingEnemy.poisonTime = 1;
  updateTowerDefense(state, 0.05);
  assert.equal(trainingEnemy.hp, 1,
    'ordinary damage cannot remove the final training target before the taught skill');
  for (let tick = 0; tick < 180; tick += 1) updateTowerDefense(state, 0.05);
  assert.ok(state.enemies.includes(trainingEnemy));
  assert.equal(trainingEnemy.leaked, undefined,
    'the protected training target cannot leak or soft-lock the required skill');
  assert.ok(trainingEnemy.travelled < pathMetrics(TD_STAGES[0].lanes[0].path).total);

  assert.equal(activateTowerDefenseHeroSkill(state), true);
  assert.equal(state.tutorial.active, false);
  assert.equal(state.tutorial.step, 'done');
  assert.equal(state.progress.tutorialSeen, true);
  assert.equal(state.progress.tutorialVersion, TD_TUTORIAL_VERSION);
  assert.equal(tutorialTargetForState(state), null);
  assert.ok(state.events.some(({ type, skipped }) => (
    type === 'tutorial-complete' && skipped === false
  )));
  assert.equal(serializeTowerDefenseProgress(state).tutorialVersion, TD_TUTORIAL_VERSION);
});

test('tutorial version migration replays once and skip preserves all collection progress', () => {
  const state = createTowerDefenseState({
    progress: {
      tutorialSeen: true,
      unlockedStage: 8,
      clearedStages: ['stage-1', 'stage-2'],
      summonCurrency: 4321,
      contractRanks: { shell: 3, needle: 2 },
      squadRanks: { melee: 4, ranged: 2 },
      turretRanks: { 'gel-mortar': 2 },
      selectedHero: 'needle',
    },
  });
  assert.equal(state.tutorial.active, true,
    'a legacy tutorialSeen flag does not suppress a newer tutorial version');
  assert.equal(state.progress.tutorialVersion, 0);
  const before = clone({
    unlockedStage: state.progress.unlockedStage,
    clearedStages: state.progress.clearedStages,
    summonCurrency: state.progress.summonCurrency,
    contractRanks: state.progress.contractRanks,
    squadRanks: state.progress.squadRanks,
    turretRanks: state.progress.turretRanks,
    selectedHero: state.progress.selectedHero,
  });

  assert.equal(skipTowerDefenseTutorial(state), true);
  assert.equal(skipTowerDefenseTutorial(state), false, 'skip is idempotent after completion');
  assert.equal(state.progress.tutorialSeen, true);
  assert.equal(state.progress.tutorialVersion, TD_TUTORIAL_VERSION);
  assert.deepEqual(clone({
    unlockedStage: state.progress.unlockedStage,
    clearedStages: state.progress.clearedStages,
    summonCurrency: state.progress.summonCurrency,
    contractRanks: state.progress.contractRanks,
    squadRanks: state.progress.squadRanks,
    turretRanks: state.progress.turretRanks,
    selectedHero: state.progress.selectedHero,
  }), before);
  assert.ok(state.events.some(({ type, skipped }) => (
    type === 'tutorial-complete' && skipped === true
  )));
});

test('the extended tutorial replays for version 2 saves exactly once', () => {
  const state = createTowerDefenseState({
    progress: { tutorialSeen: true, tutorialVersion: 2 },
  });
  assert.equal(TD_TUTORIAL_VERSION, 3);
  assert.equal(state.tutorial.active, true);
  assert.deepEqual(tutorialTargetForState(state), {
    type: 'stage', stageIndex: 0, label: '1',
  });
  assert.equal(skipTowerDefenseTutorial(state), true);
  assert.equal(state.progress.tutorialVersion, 3);

  const restored = createTowerDefenseState({
    progress: serializeTowerDefenseProgress(state),
  });
  assert.equal(restored.tutorial.active, false);
  assert.equal(tutorialTargetForState(restored), null);
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
    squadShards: { melee: 2, leaf: 99, unknown: 4 },
    squadRanks: { melee: 3, ranged: 2, leaf: 99, charger: -3 },
    turretShards: { 'gel-mortar': 3, 'bubble-coil': 99 },
    turretRanks: { 'gel-mortar': 4, 'bubble-coil': 2, 'crystal-repeater': 99 },
    selectedHero: 'needle',
    transientValue: 123,
  };
  const normalized = normalizeTowerDefenseProgress(dirty);
  assert.deepEqual({
    unlockedStage: normalized.unlockedStage,
    clearedStages: normalized.clearedStages,
    bestEndlessWave: normalized.bestEndlessWave,
    tutorialSeen: normalized.tutorialSeen,
    tutorialVersion: normalized.tutorialVersion,
    summonCurrency: normalized.summonCurrency,
    summonPity: normalized.summonPity,
    summonRngState: normalized.summonRngState,
    selectedHero: normalized.selectedHero,
  }, {
    unlockedStage: TD_STAGES.length,
    clearedStages: ['stage-2', 'stage-1'],
    bestEndlessWave: 12,
    tutorialSeen: true,
    tutorialVersion: 0,
    summonCurrency: 777,
    summonPity: 9,
    summonRngState: 12345,
    selectedHero: 'needle',
  });
  assert.equal(normalized.metaCoins, TD_META_START_COINS);
  assert.equal(normalized.contractShards.bubble, 99,
    'hero shards remain available for the new variable rank costs');
  assert.equal(normalized.squadShards.leaf, 99);
  assert.equal(normalized.turretShards['bubble-coil'], 99);
  assert.deepEqual(normalized.hardClearedStages, []);
  assert.deepEqual(normalized.dailyClaims, []);
  assert.deepEqual(normalized.equipmentItems, []);
  assert.deepEqual(normalized.equipmentLoadouts, {});
  assert.equal(Object.hasOwn(normalized, 'transientValue'), false);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.clearedStages), true);
  assert.equal(Object.isFrozen(normalized.hardClearedStages), true);
  assert.equal(Object.isFrozen(normalized.dailyClaims), true);
  assert.equal(Object.isFrozen(normalized.contractShards), true);
  assert.equal(Object.isFrozen(normalized.contractRanks), true);
  assert.equal(Object.isFrozen(normalized.squadShards), true);
  assert.equal(Object.isFrozen(normalized.squadRanks), true);
  assert.equal(Object.isFrozen(normalized.turretShards), true);
  assert.equal(Object.isFrozen(normalized.turretRanks), true);
  assert.equal(Object.isFrozen(normalized.equipmentItems), true);
  assert.equal(Object.isFrozen(normalized.equipmentLoadouts), true);
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
