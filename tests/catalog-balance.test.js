import test from 'node:test';
import assert from 'node:assert/strict';

import { ENEMY_BY_ID, WAVES } from '../src/catalog.js';

const waveEnemyCount = (wave) => wave.groups.reduce(
  (total, group) => total + group.count,
  0,
);

const finalSpawnTime = (group) => group.startDelaySeconds
  + Math.max(0, group.count - 1) * group.spawnIntervalSeconds;

test('swarm waves field roughly twice the original roster without extending spawn waits', () => {
  assert.deepEqual(WAVES.map(waveEnemyCount), [22, 32, 41]);
  assert.equal(WAVES.reduce((total, wave) => total + waveEnemyCount(wave), 0), 95);
  assert.deepEqual(
    WAVES.map((wave) => Math.max(...wave.groups.map(finalSpawnTime))),
    [42, 31.5, 47],
  );
});

test('ordinary swarm enemies stay fragile while the boss remains the anchor threat', () => {
  const softBiter = ENEMY_BY_ID['enemy-soft-biter'];
  const windcap = ENEMY_BY_ID['enemy-windcap'];
  const stoneLump = ENEMY_BY_ID['enemy-stone-lump'];
  const boss = ENEMY_BY_ID['enemy-acid-shell-king'];

  assert.deepEqual(
    [softBiter, windcap, stoneLump].map(({ hp, damage }) => ({ hp, damage })),
    [
      { hp: 46, damage: 5 },
      { hp: 32, damage: 4 },
      { hp: 115, damage: 9 },
    ],
  );
  assert.equal(boss.hp, 680);
  assert.equal(boss.damage, 16);
  assert.equal(boss.ability.buildingDamage, 28);
  assert.ok(boss.hp > stoneLump.hp * 5);
  assert.ok(boss.damage > stoneLump.damage);
});
