import test from 'node:test';
import assert from 'node:assert/strict';

import { SHOOTER_CONFIG } from '../src/shooter/config.js';
import { ShooterCore } from '../src/shooter/core.js';

function advance(core, seconds, step = 0.05) {
  let remaining = seconds;
  while (remaining > 0) {
    const delta = Math.min(step, remaining);
    core.tick(delta);
    remaining -= delta;
  }
}

test('shooter session starts with a full magazine and configured wave', () => {
  const core = new ShooterCore(SHOOTER_CONFIG);
  core.start();
  const state = core.snapshot();
  assert.equal(state.phase, 'playing');
  assert.equal(state.player.health, 100);
  assert.equal(state.player.ammo, SHOOTER_CONFIG.weapon.magazine);
  assert.equal(state.wave.target, SHOOTER_CONFIG.wave.enemyCount);
});

test('weapon cadence, ammo, and reload are deterministic', () => {
  const core = new ShooterCore(SHOOTER_CONFIG);
  core.start();
  assert.equal(core.tryFire(), true);
  assert.equal(core.tryFire(), false);
  advance(core, SHOOTER_CONFIG.weapon.fireInterval);
  assert.equal(core.tryFire(), true);

  while (core.player.ammo > 0) {
    advance(core, SHOOTER_CONFIG.weapon.fireInterval);
    core.tryFire();
  }
  assert.ok(core.player.reloadRemaining > 0);
  advance(core, SHOOTER_CONFIG.weapon.reloadTime);
  assert.equal(core.player.reloadRemaining, 0);
  assert.equal(core.player.ammo, SHOOTER_CONFIG.weapon.magazine);
});

test('wave requests never exceed its active cap and wins after all defeats', () => {
  const core = new ShooterCore(SHOOTER_CONFIG);
  core.start();
  for (let index = 0; index < SHOOTER_CONFIG.wave.maxActive; index += 1) {
    advance(core, index === 0 ? SHOOTER_CONFIG.wave.spawnDelay : SHOOTER_CONFIG.wave.spawnInterval);
    const request = core.drainEvents().find(({ type }) => type === 'spawn-request');
    assert.ok(request);
    assert.equal(core.confirmEnemySpawn(), true);
  }
  advance(core, SHOOTER_CONFIG.wave.spawnInterval * 2);
  assert.equal(core.drainEvents().some(({ type }) => type === 'spawn-request'), false);

  while (core.wave.spawned < core.wave.target) {
    core.defeatEnemy();
    core.drainEvents();
    advance(core, SHOOTER_CONFIG.wave.spawnInterval);
    if (core.drainEvents().some(({ type }) => type === 'spawn-request')) core.confirmEnemySpawn();
  }
  while (core.wave.active > 0) core.defeatEnemy();
  assert.equal(core.phase, 'victory');
  assert.equal(core.wave.defeated, core.wave.target);
});

test('ability cooldowns and player defeat honor phase state', () => {
  const core = new ShooterCore(SHOOTER_CONFIG);
  core.start();
  assert.equal(core.tryUseAbility('freeze'), true);
  assert.equal(core.tryUseAbility('freeze'), false);
  advance(core, SHOOTER_CONFIG.abilities.freeze.cooldown);
  assert.equal(core.tryUseAbility('freeze'), true);
  core.damagePlayer(999);
  assert.equal(core.phase, 'defeat');
  assert.equal(core.tryFire(), false);
});

test('spawn confirmations reject stale requests and never exceed the active cap', () => {
  const core = new ShooterCore(SHOOTER_CONFIG);
  core.start();
  for (let index = 0; index < SHOOTER_CONFIG.wave.maxActive; index += 1) {
    assert.equal(core.confirmEnemySpawn(), true);
  }
  assert.equal(core.confirmEnemySpawn(), false);
  assert.equal(core.wave.active, SHOOTER_CONFIG.wave.maxActive);

  core.pause();
  core.wave.active -= 1;
  assert.equal(core.confirmEnemySpawn(), false);
  assert.equal(core.wave.spawned, SHOOTER_CONFIG.wave.maxActive);
});

test('invalid scores stay finite and defeated sessions reject further enemy mutations', () => {
  const core = new ShooterCore(SHOOTER_CONFIG);
  core.start();
  assert.equal(core.confirmEnemySpawn(), true);
  assert.equal(core.defeatEnemy(Number.NaN), true);
  assert.equal(core.wave.score, 0);
  assert.ok(Number.isFinite(core.wave.score));

  core.damagePlayer(Infinity);
  assert.equal(core.phase, 'playing');
  core.damagePlayer(core.player.maxHealth);
  assert.equal(core.phase, 'defeat');
  assert.equal(core.defeatEnemy(100), false);
});
