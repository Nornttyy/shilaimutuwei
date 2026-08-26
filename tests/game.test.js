import test from 'node:test';
import assert from 'node:assert/strict';

import { SlimeGame } from '../src/game.js';
import { ENEMY_BY_ID, ITEMS, SKILLS, SURVIVORS, WAVES } from '../src/catalog.js';
import {
  BOSS_CLIPS,
  BUBBLE_CLIPS,
  BUG_CLIPS,
  CRYSTAL_CLIPS,
  SHELL_CLIPS,
  SPROUT_CLIPS,
  STONE_CLIPS,
  WINDCAP_CLIPS,
} from '../src/animation/clips.js';

function createGradient() {
  return { addColorStop() {} };
}

function createContext() {
  const functions = new Set([
    'arc', 'beginPath', 'bezierCurveTo', 'clearRect', 'closePath', 'ellipse', 'fill',
    'fillRect', 'fillText', 'lineTo', 'moveTo', 'quadraticCurveTo', 'restore', 'rotate',
    'save', 'scale', 'setLineDash', 'setTransform', 'stroke', 'strokeRect', 'strokeText',
    'translate',
  ]);
  return new Proxy({
    createLinearGradient: createGradient,
    createRadialGradient: createGradient,
    measureText: (text) => ({ width: String(text).length * 16 }),
  }, {
    get(target, property) {
      if (property in target) return target[property];
      if (functions.has(property)) return () => {};
      return undefined;
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}

function createHarness() {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener() {},
    AudioContext: null,
    webkitAudioContext: null,
  };
  const ctx = createContext();
  const canvas = {
    width: 1280,
    height: 720,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    addEventListener() {},
  };
  const game = new SlimeGame(canvas);
  game.modal = null;
  game.state.tutorialSeen = true;
  return { game, storage };
}

test('renders all top-level screens with the zero-dependency canvas renderer', () => {
  const { game } = createHarness();
  assert.doesNotThrow(() => game.render());

  game.openIntel();
  assert.equal(game.state.phase, 'intel');
  assert.doesNotThrow(() => game.render());

  game.beginDefense();
  assert.equal(game.state.phase, 'battle');
  assert.doesNotThrow(() => game.render());

  game.finishDefense(true);
  assert.equal(game.state.phase, 'result');
  assert.doesNotThrow(() => game.render());
});

test('starts an active wave only after the explicit start action', () => {
  const { game } = createHarness();
  assert.equal(game.state.phase, 'build');
  assert.equal(game.state.enemies.length, 0);
  game.openIntel();
  assert.equal(game.state.enemies.length, 0);
  game.beginDefense();
  for (let index = 0; index < 4; index += 1) game.update(0.05);
  assert.equal(game.state.waveIndex, 0);
  assert.equal(game.state.spawnQueue.length, WAVES[0].groups[0].count);
  assert.ok(game.state.enemies.length >= 1);
});

test('targeting a skill pauses, consumes energy, and restores the previous pause state', () => {
  const { game } = createHarness();
  game.openIntel();
  game.beginDefense();
  for (let index = 0; index < 3; index += 1) game.update(0.05);
  const enemy = game.state.enemies[0];
  enemy.x = 4;
  enemy.y = 2;
  const skill = SKILLS.find((card) => card.id === 'skill-jelly-bounce');
  const beforeEnergy = game.state.energy;
  game.selectCombatCard(skill);
  assert.equal(game.state.paused, true);
  game.handleBattleTarget({ x: 4, y: 2 });
  assert.equal(game.state.energy, beforeEnergy - skill.energy);
  assert.equal(game.state.paused, false);
  assert.equal(game.selection, null);
  assert.ok(enemy.x > 4);
});

test('two-step spring pad targeting uses one charge and records its direction', () => {
  const { game } = createHarness();
  game.openIntel();
  game.beginDefense();
  const item = ITEMS.find((card) => card.id === 'item-spring-pad');
  game.selectCombatCard(item);
  game.handleBattleTarget({ x: 2, y: 2 });
  assert.equal(game.selection.step, 1);
  game.handleBattleTarget({ x: 3, y: 2 });
  assert.equal(game.state.items[item.id].charges, item.charges - 1);
  assert.deepEqual(
    Object.fromEntries(Object.entries(game.state.deployables[0]).filter(([key]) => ['type', 'x', 'y', 'dx', 'dy'].includes(key))),
    { type: 'pad', x: 2, y: 2, dx: 1, dy: 0 },
  );
});

test('saving during combat preserves the safe pre-battle layout', () => {
  const { game, storage } = createHarness();
  game.openIntel();
  game.beginDefense();
  const originalCount = game.state.buildings.length;
  game.state.buildings[0].destroyed = true;
  game.save();
  const saved = JSON.parse(storage.values().next().value);
  assert.equal(saved.buildings.length, originalCount);
});

test('all survivor and enemy cards resolve to their rig clip collections', () => {
  const { game } = createHarness();
  const expected = {
    'survivor-shell-shell': SHELL_CLIPS,
    'survivor-crystal-pin': CRYSTAL_CLIPS,
    'survivor-bubble-float': BUBBLE_CLIPS,
    'survivor-moss-sprout': SPROUT_CLIPS,
    'enemy-soft-biter': BUG_CLIPS,
    'enemy-windcap': WINDCAP_CLIPS,
    'enemy-stone-lump': STONE_CLIPS,
    'enemy-acid-shell-king': BOSS_CLIPS,
  };

  for (const [cardId, clips] of Object.entries(expected)) {
    assert.equal(game.animationClipsFor(cardId), clips, `${cardId} should use its own clips`);
  }
  assert.equal(game.animationClipsFor('unknown-card'), null);
});

test('all survivor rigs resolve damage, hurt, and hit particles at the attack hit event', () => {
  const survivorIds = [
    'survivor-shell-shell',
    'survivor-crystal-pin',
    'survivor-bubble-float',
    'survivor-moss-sprout',
  ];

  for (const cardId of survivorIds) {
    const { game } = createHarness();
    const survivor = game.state.survivors.find((candidate) => candidate.cardId === cardId);
    game.spawnEnemy('enemy-soft-biter', survivor.y);
    const enemy = game.state.enemies.at(-1);
    enemy.x = survivor.x + 0.6;
    enemy.y = survivor.y;
    const hpBefore = enemy.hp;
    const particlesBefore = game.state.particles.length;
    const hitTime = game.animationClipsFor(cardId).attack.events.find((event) => event.name === 'hit').time;

    assert.equal(game.performSurvivorAction(survivor), true, `${cardId} should find a target`);
    assert.equal(enemy.hp, hpBefore, `${cardId} damage must wait for its hit pose`);
    assert.equal(game.animators.get(survivor.uid)?.controller.current, 'attack');
    assert.notEqual(game.animators.get(enemy.uid)?.controller.current, 'hurt');

    game.updateEntityAnimations(hitTime - 0.01);
    assert.equal(enemy.hp, hpBefore, `${cardId} must not deal damage before its hit event`);
    assert.equal(game.state.particles.length, particlesBefore, 'hit particles must also wait for impact');

    game.updateEntityAnimations(0.02);
    assert.ok(enemy.hp < hpBefore, `${cardId} damage should resolve when the hit event fires`);
    assert.equal(game.animators.get(enemy.uid)?.controller.current, 'hurt');
    assert.ok(game.state.particles.length > particlesBefore, 'impact should create hit particles');
    const hpAfterHit = enemy.hp;
    game.updateEntityAnimations(game.animationClipsFor(cardId).attack.duration);
    assert.equal(enemy.hp, hpAfterHit, 'a drained hit event must settle exactly once');

    game.damageSurvivor(survivor, survivor.hp);
    assert.equal(survivor.downed, true);
    assert.equal(game.animators.get(survivor.uid)?.controller.current, 'downed');
  }
});

test('sprout healing dispatches its attack clip as a cast animation', () => {
  const { game } = createHarness();
  const sprout = game.state.survivors.find((survivor) => survivor.cardId === 'survivor-moss-sprout');
  const ally = game.state.survivors.find((survivor) => survivor.cardId === 'survivor-crystal-pin');
  const sproutCard = SURVIVORS.find((card) => card.id === sprout.cardId);
  const actionsRequired = sproutCard.ability.actionsRequired;
  sprout.actionCount = actionsRequired - 1;
  ally.hp = Math.floor(ally.maxHp / 2);
  const hpBefore = ally.hp;

  assert.equal(game.performSurvivorAction(sprout), true);
  assert.ok(ally.hp > hpBefore, 'healing should remain immediate');
  assert.equal(sprout.actionCount, actionsRequired);
  assert.equal(game.animators.get(sprout.uid)?.controller.current, 'attack');
});

test('all enemy rigs resolve attack damage at their hit event, then still hurt and die normally', () => {
  const enemyIds = [
    'enemy-soft-biter',
    'enemy-windcap',
    'enemy-stone-lump',
    'enemy-acid-shell-king',
  ];

  for (const enemyId of enemyIds) {
    const { game } = createHarness();
    game.state.phase = 'battle';
    game.spawnEnemy(enemyId, 0);
    const enemy = game.state.enemies.at(-1);
    enemy.x = 0;
    enemy.y = 0;
    enemy.path = [{ x: 0, y: 0 }, { x: -1, y: 0 }];
    enemy.routeTimer = 1;
    const coreBefore = game.state.coreHp;
    const hitTime = game.animationClipsFor(enemyId).attack.events.find((event) => event.name === 'hit').time;

    game.updateEnemies(0.01);
    assert.equal(game.state.coreHp, coreBefore, `${enemyId} damage must wait for its hit pose`);
    assert.equal(game.animators.get(enemy.uid)?.controller.current, 'attack');

    game.updateEntityAnimations(hitTime - 0.01);
    assert.equal(game.state.coreHp, coreBefore, `${enemyId} must not damage the core before hit`);
    game.updateEntityAnimations(0.02);
    assert.ok(game.state.coreHp < coreBefore, `${enemyId} should damage the core on hit`);

    game.damageEnemy(enemy, 1, null);
    assert.equal(game.animators.get(enemy.uid)?.controller.current, 'hurt');
    game.damageEnemy(enemy, enemy.hp, null);
    assert.equal(enemy.dead, true);
    assert.equal(game.animators.get(enemy.uid)?.controller.current, 'death');
  }
});

test('boss charge is a base state that resumes after hurt and exits when interrupted', () => {
  const { game } = createHarness();
  game.spawnEnemy('enemy-acid-shell-king', 2);
  const boss = game.state.enemies.at(-1);
  const card = ENEMY_BY_ID[boss.cardId];
  boss.abilityTimer = 0;

  game.updateEnemyAbility(boss, card, 0.01);
  assert.ok(boss.telegraph > 0);
  game.updateEntityAnimations(0.01);
  let controller = game.animators.get(boss.uid)?.controller;
  assert.equal(controller.baseName, 'charge');
  assert.equal(controller.current, 'charge');

  game.damageEnemy(boss, 1, null);
  assert.equal(controller.current, 'hurt');
  for (let index = 0; index < 100 && controller.actionName; index += 1) {
    game.updateEntityAnimations(0.02);
  }
  assert.equal(controller.actionName, null);
  assert.equal(controller.current, 'charge', 'charge should resume after the hurt reaction');

  boss.stagger = 0.5;
  game.updateEnemyAbility(boss, card, 0.01);
  assert.equal(boss.telegraph, 0);
  assert.equal(boss.telegraphTarget, null);
  game.updateEntityAnimations(0);
  controller = game.animators.get(boss.uid)?.controller;
  assert.equal(controller.baseName, 'idle');
  assert.equal(controller.current, 'hurt', 'the interruption should show a recoil');
  for (let index = 0; index < 100 && controller.actionName; index += 1) {
    game.updateEntityAnimations(0.02);
  }
  assert.equal(controller.current, 'idle');
});

test('each enemy death uses its own visual lifetime for cleanup', () => {
  const durations = {
    'enemy-soft-biter': 0.4,
    'enemy-windcap': 0.38,
    'enemy-stone-lump': 0.42,
    'enemy-acid-shell-king': 0.68,
  };

  for (const [enemyId, duration] of Object.entries(durations)) {
    const { game } = createHarness();
    game.state.phase = 'battle';
    game.spawnEnemy(enemyId, 0);
    const enemy = game.state.enemies.at(-1);
    assert.equal(game.enemyDeathDuration(enemy), duration);
    game.damageEnemy(enemy, enemy.hp, null);

    game.updateEntityAnimations(duration * 0.9);
    game.updateEnemies(0);
    assert.ok(game.state.enemies.includes(enemy), `${enemyId} should remain during its death clip`);

    game.updateEntityAnimations(duration * 0.11);
    game.updateEnemies(0);
    assert.ok(!game.state.enemies.includes(enemy), `${enemyId} should clean up at its own duration`);
  }
});

test('shell attack impact pauses with the rig clock and resolves only after resuming', () => {
  const { game } = createHarness();
  const shell = game.state.survivors.find((survivor) => survivor.cardId === 'survivor-shell-shell');
  game.spawnEnemy('enemy-soft-biter', shell.y);
  const enemy = game.state.enemies.at(-1);
  enemy.x = shell.x + 0.65;
  enemy.y = shell.y;

  const hpBefore = enemy.hp;
  assert.equal(game.performSurvivorAction(shell), true);
  const projectile = game.state.projectiles.at(-1);
  const projectileProgress = projectile.progress;
  assert.equal(enemy.hp, hpBefore, 'damage should wait for the animation event');
  assert.equal(game.animators.get(shell.uid)?.controller.current, 'attack');

  game.state.phase = 'battle';
  game.state.paused = true;
  game.update(0.25);
  assert.equal(enemy.hp, hpBefore, 'pausing must also pause a queued attack impact');
  assert.ok(
    Math.abs(projectile.progress - projectileProgress) < 1e-12,
    'pausing must freeze projectile travel',
  );

  game.state.paused = false;
  game.selection = { kind: 'targeting-test' };
  game.update(0.25);
  assert.ok(
    Math.abs(projectile.progress - projectileProgress) < 1e-12,
    'targeting must freeze projectile travel',
  );

  game.selection = null;
  game.state.survivors.forEach((survivor) => { survivor.cooldown = 999; });
  game.state.buildings.forEach((building) => { building.cooldown = 999; });
  enemy.rooted = 999;
  game.update(0.01);
  assert.ok(projectile.progress > projectileProgress, 'projectile travel should resume with the rig');
  game.updateEntityAnimations(SHELL_CLIPS.attack.events[0].time + 0.01);
  assert.ok(enemy.hp < hpBefore, 'the queued impact should resolve after the hit event resumes');
  assert.equal(game.animators.get(enemy.uid)?.controller.current, 'hurt');

  game.damageEnemy(enemy, enemy.hp, shell);
  assert.equal(enemy.dead, true);
  assert.equal(game.animators.get(enemy.uid)?.controller.current, 'death');
  game.state.paused = true;
  game.update(0.25);
  assert.equal(enemy.deathElapsed, 0, 'death fade should share the paused rig clock');
});

test('a hurt reaction does not erase an attack that already committed to its hit timing', () => {
  const { game } = createHarness();
  const shell = game.state.survivors.find((survivor) => survivor.cardId === 'survivor-shell-shell');
  game.spawnEnemy('enemy-soft-biter', shell.y);
  const enemy = game.state.enemies.at(-1);
  enemy.x = shell.x + 0.65;
  enemy.y = shell.y;
  const hpBefore = enemy.hp;

  assert.equal(game.performSurvivorAction(shell), true);
  game.damageSurvivor(shell, 1);
  assert.equal(
    game.animators.get(shell.uid)?.controller.current,
    'attack',
    'nonlethal damage must not replace a committed attack',
  );
  game.updateEntityAnimations(SHELL_CLIPS.attack.events[0].time - 0.01);
  assert.equal(enemy.hp, hpBefore);
  game.updateEntityAnimations(0.02);

  assert.ok(enemy.hp < hpBefore);
  assert.equal(game.pendingAttackHits.has(shell.uid), false);
});

test('an interrupted attack cannot deal ghost damage without its attack.hit event', () => {
  const { game } = createHarness();
  const shell = game.state.survivors.find((survivor) => survivor.cardId === 'survivor-shell-shell');
  game.spawnEnemy('enemy-soft-biter', shell.y);
  const enemy = game.state.enemies.at(-1);
  enemy.x = shell.x + 0.65;
  enemy.y = shell.y;
  const hpBefore = enemy.hp;

  assert.equal(game.performSurvivorAction(shell), true);
  assert.equal(game.playEntityAnimation(shell, 'hurt'), true, 'the test interruption should replace attack');
  game.updateEntityAnimations(SHELL_CLIPS.attack.events[0].time + 0.05);

  assert.equal(enemy.hp, hpBefore, 'elapsed time alone must never resolve a queued impact');
  assert.equal(game.pendingAttackHits.has(shell.uid), false, 'an interrupted attack must be cancelled');
});

test('death and downed states immediately cancel committed attack impacts', () => {
  const survivorHarness = createHarness();
  const survivorGame = survivorHarness.game;
  const shell = survivorGame.state.survivors.find(
    (survivor) => survivor.cardId === 'survivor-shell-shell',
  );
  survivorGame.spawnEnemy('enemy-soft-biter', shell.y);
  const target = survivorGame.state.enemies.at(-1);
  target.x = shell.x + 0.65;
  target.y = shell.y;
  const targetHp = target.hp;

  assert.equal(survivorGame.performSurvivorAction(shell), true);
  survivorGame.damageSurvivor(shell, shell.hp);
  assert.equal(shell.downed, true);
  assert.equal(survivorGame.pendingAttackHits.has(shell.uid), false);
  survivorGame.updateEntityAnimations(SHELL_CLIPS.attack.duration);
  assert.equal(target.hp, targetHp, 'a downed attacker must not finish its queued impact');

  const enemyHarness = createHarness();
  const enemyGame = enemyHarness.game;
  enemyGame.state.phase = 'battle';
  enemyGame.spawnEnemy('enemy-soft-biter', 0);
  const attacker = enemyGame.state.enemies.at(-1);
  attacker.x = 0;
  attacker.y = 0;
  attacker.path = [{ x: 0, y: 0 }, { x: -1, y: 0 }];
  attacker.routeTimer = 1;
  const coreHp = enemyGame.state.coreHp;

  enemyGame.updateEnemies(0.01);
  assert.equal(enemyGame.pendingAttackHits.has(attacker.uid), true);
  enemyGame.damageEnemy(attacker, attacker.hp, null);
  assert.equal(attacker.dead, true);
  assert.equal(enemyGame.pendingAttackHits.has(attacker.uid), false);
  enemyGame.updateEntityAnimations(BUG_CLIPS.attack.duration);
  assert.equal(enemyGame.state.coreHp, coreHp, 'a dead attacker must not finish its queued impact');
});

test('entity expression mixers follow attacks and reactions with real slot cross-fades', () => {
  const { game } = createHarness();
  const shell = game.state.survivors.find(
    (survivor) => survivor.cardId === 'survivor-shell-shell',
  );

  game.updateEntityAnimations(0);
  assert.equal(game.entityExpressionSample(shell).to, 'normal');

  assert.equal(game.playEntityAnimation(shell, 'attack'), true);
  game.updateEntityAnimations(0.06);
  const attacking = game.entityExpressionSample(shell);
  assert.equal(attacking.from, 'normal');
  assert.equal(attacking.to, 'attack');
  assert.equal(attacking.mix, 0.5);
  assert.deepEqual(attacking.slots.eyes.weights, { from: 0.5, to: 0.5 });
  assert.deepEqual(attacking.slots.mouth.weights, { from: 0.5, to: 0.5 });

  game.updateEntityAnimations(0.06);
  assert.equal(game.entityExpressionSample(shell).from, 'attack');
  assert.equal(game.entityExpressionSample(shell).to, 'attack');

  game.damageSurvivor(shell, 1);
  game.updateEntityAnimations(0.12);
  assert.equal(game.entityExpressionSample(shell).to, 'hurt');

  game.damageSurvivor(shell, shell.hp);
  game.updateEntityAnimations(0.12);
  assert.equal(game.entityExpressionSample(shell).to, 'hurt');
});

test('idle expressions blink on a stable clock and freeze together with paused rigs', () => {
  const { game } = createHarness();
  const shell = game.state.survivors.find(
    (survivor) => survivor.cardId === 'survivor-shell-shell',
  );
  let blinkSample = null;
  for (let step = 0; step < 80; step += 1) {
    game.updateEntityAnimations(0.05);
    const sample = game.entityExpressionSample(shell);
    if (sample.to === 'blink') {
      blinkSample = sample;
      break;
    }
  }
  assert.ok(blinkSample, 'idle should reach the owner-staggered blink state');

  game.state.phase = 'battle';
  game.state.paused = true;
  const frozen = game.entityExpressionSample(shell);
  const frozenAnimationTime = game.animationTime;
  game.time += 10;
  game.update(0.25);
  assert.equal(game.animationTime, frozenAnimationTime, 'the animation clock must stop while paused');
  assert.deepEqual(game.entityExpressionSample(shell), frozen);
});

test('battle pause freezes entity rig time', () => {
  const { game } = createHarness();
  const shell = game.state.survivors.find((survivor) => survivor.cardId === 'survivor-shell-shell');
  game.playEntityAnimation(shell, 'attack');
  game.updateEntityAnimations(0.12);
  const poseBeforePause = game.entityAnimationPose(shell);

  game.state.phase = 'battle';
  game.state.paused = true;
  game.update(0.25);

  assert.deepEqual(game.entityAnimationPose(shell), poseBeforePause);
});

test('a complete assisted defense reaches a result without stalled enemies or waves', () => {
  const { game } = createHarness();
  game.openIntel();
  game.beginDefense();

  let steps = 0;
  while (game.state.phase !== 'result' && steps < 30000) {
    if (game.state.phase === 'between') {
      game.startWave(game.state.waveIndex + 1);
    } else if (game.state.phase === 'battle' && !game.selection) {
      const heal = SKILLS.find((card) => card.id === 'skill-sprout-renewal');
      const hurtSurvivor = game.state.survivors.find((target) => !target.downed && target.hp / target.maxHp < 0.45);
      const hurtBuilding = game.state.buildings.find((target) => !target.destroyed && target.hp / target.maxHp < 0.4);
      if ((hurtSurvivor || hurtBuilding)
        && game.state.energy >= heal.energy
        && game.state.friendlyActions >= game.state.skills[heal.id].readyAtAction) {
        const target = hurtSurvivor || hurtBuilding;
        game.selectCombatCard(heal);
        game.handleBattleTarget({ x: target.x, y: target.y });
      } else {
        const bounce = SKILLS.find((card) => card.id === 'skill-jelly-bounce');
        const threat = game.state.enemies.find((enemy) => !enemy.dead && enemy.x < 2.1);
        if (threat
          && game.state.energy >= bounce.energy
          && game.state.friendlyActions >= game.state.skills[bounce.id].readyAtAction) {
          game.selectCombatCard(bounce);
          game.handleBattleTarget(game.nearestCell(threat));
        }
      }
    }
    game.update(0.05);
    steps += 1;
  }

  assert.ok(steps < 30000, 'the battle loop should reach a terminal result');
  assert.ok(game.state.result);
  assert.equal(game.state.result.victory, true, 'the starter layout plus basic skill use should be winnable');
  assert.ok(game.state.kills > 0);
});

test('the final wave still asks the player to use active cards', () => {
  const { game } = createHarness();
  game.openIntel();
  game.beginDefense();
  let steps = 0;
  while (game.state.phase !== 'result' && steps < 30000) {
    if (game.state.phase === 'between') game.startWave(game.state.waveIndex + 1);
    game.update(0.05);
    steps += 1;
  }
  assert.ok(steps < 30000);
  assert.equal(game.state.result?.victory, false, 'a completely passive run should eventually be overrun');
});

test('the starter layout clears the teaching wave without demanding perfect card use', () => {
  const { game } = createHarness();
  game.openIntel();
  game.beginDefense();
  let steps = 0;
  while (game.state.phase === 'battle' && steps < 12000) {
    game.update(0.05);
    steps += 1;
  }
  assert.equal(game.state.phase, 'between');
  assert.ok(game.state.coreHp > 0);
});
