import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHOOTER_CONFIG } from '../src/shooter/config.js';
import {
  ARENA_CONTRACT,
  ENEMY_CONTRACT,
  GAMEPLAY_MODEL_YAW_OFFSET,
  GLTF_MODEL_FORWARD,
  PLAYER_CONTROL_NAMES,
  PLAYER_RIG_CONTRACT,
} from '../src/shooter/runtime-contract.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetPath = (id) => path.join(root, 'assets', 'generated', '3d', 'shooter', `${id}.glb`);

async function readGlbJson(id) {
  const bytes = await readFile(assetPath(id));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  return JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength).trimEnd());
}

function nodeByName(gltf, name) {
  return gltf.nodes.find((node) => node.name === name);
}

test('the vendored Three.js r180 module has its required core sidecar', async () => {
  const THREE = await import('../src/vendor/three/three.module.min.js');
  assert.equal(THREE.REVISION, '180');
  assert.equal(typeof THREE.WebGLRenderer, 'function');
  assert.equal(typeof THREE.AnimationMixer, 'function');
});

test('player and projectile contracts agree on exported glTF +Z facing', async () => {
  const [player, projectile] = await Promise.all([
    readGlbJson('ice-peashooter'),
    readGlbJson('ice-pea-projectile'),
  ]);
  const requiredControls = Object.values(PLAYER_CONTROL_NAMES).flat();
  const playerNodeNames = new Set(player.nodes.map((node) => node.name));
  for (const name of requiredControls) assert.ok(playerNodeNames.has(name), `missing player control ${name}`);

  const muzzle = nodeByName(player, PLAYER_CONTROL_NAMES.muzzle);
  const projectileRoot = nodeByName(projectile, 'ice-pea-projectile');
  const projectileFront = projectile.nodes
    .filter((node) => node.name.startsWith('Projectile_') && node.translation)
    .reduce((furthest, node) => (node.translation[2] > furthest.translation[2] ? node : furthest));
  const projectileTrail = nodeByName(projectile, 'FX_TrailAnchor');
  assert.ok(muzzle.translation[2] > 0, 'player muzzle must extend along exported +Z');
  assert.match(projectileRoot.extras.front_axis, /\+Z after glTF export/);
  assert.ok(projectileFront.translation[2] > 0, 'projectile front must extend along exported +Z');
  assert.ok(projectileTrail.translation[2] < 0, 'projectile trail must sit behind the +Z tip');
  assert.deepEqual(GLTF_MODEL_FORWARD, [0, 0, 1]);
  assert.equal(GAMEPLAY_MODEL_YAW_OFFSET, Math.PI);
});

test('player GLB carries the complete skinned four-clip runtime rig', async () => {
  const player = await readGlbJson('ice-peashooter');
  const nodeNames = new Set(player.nodes.map((node) => node.name));
  const clipNames = new Set(player.animations?.map((animation) => animation.name));
  const skinnedNodes = player.nodes.filter((node) => Number.isInteger(node.skin));
  const jointNames = new Set(
    (player.skins ?? [])
      .flatMap((skin) => skin.joints)
      .map((index) => player.nodes[index]?.name),
  );

  assert.ok(nodeNames.has(PLAYER_RIG_CONTRACT.armature));
  assert.ok((player.skins?.length ?? 0) > 0, 'player must contain a glTF skin');
  assert.ok(skinnedNodes.length > 0, 'player must bind at least one node to a skin');
  for (const clipName of Object.values(PLAYER_RIG_CONTRACT.clips)) {
    assert.ok(clipNames.has(clipName), `missing player clip ${clipName}`);
  }
  for (const boneName of PLAYER_RIG_CONTRACT.requiredBones) {
    assert.ok(jointNames.has(boneName), `missing player skin joint ${boneName}`);
  }
  assert.ok(PLAYER_RIG_CONTRACT.requiredBones.includes(PLAYER_RIG_CONTRACT.muzzleBone));
  const muzzleBoneIndex = player.nodes.findIndex(
    (node) => node.name === PLAYER_RIG_CONTRACT.muzzleBone && !('mesh' in node),
  );
  const muzzleControlIndex = player.nodes.findIndex((node) => node.name === PLAYER_CONTROL_NAMES.muzzle);
  assert.ok(player.nodes[muzzleBoneIndex].children.includes(muzzleControlIndex));

  for (const skin of player.skins) {
    assert.equal(new Set(skin.joints).size, skin.joints.length, 'skin joints must be unique');
    const inverseBindMatrices = player.accessors[skin.inverseBindMatrices];
    assert.equal(inverseBindMatrices.componentType, 5126);
    assert.equal(inverseBindMatrices.type, 'MAT4');
    assert.equal(inverseBindMatrices.count, skin.joints.length);
  }
  for (const node of skinnedNodes) {
    for (const primitive of player.meshes[node.mesh].primitives) {
      const { POSITION, JOINTS_0, WEIGHTS_0 } = primitive.attributes;
      assert.ok(Number.isInteger(JOINTS_0) && Number.isInteger(WEIGHTS_0));
      assert.equal(player.accessors[JOINTS_0].count, player.accessors[POSITION].count);
      assert.equal(player.accessors[WEIGHTS_0].count, player.accessors[POSITION].count);
    }
  }
  for (const animation of player.animations) {
    const animatedJoints = animation.channels
      .map((channel) => player.nodes[channel.target.node]?.name)
      .filter((name) => jointNames.has(name));
    assert.ok(animatedJoints.length > 0, `${animation.name} must animate a skin joint`);
    assert.ok(animatedJoints.some((name) => name !== 'Root'), `${animation.name} must animate beyond Root`);
    for (const sampler of animation.samplers) {
      assert.ok(player.accessors[sampler.input].count > 1);
      assert.equal(player.accessors[sampler.input].count, player.accessors[sampler.output].count);
    }
  }
});

test('arena contract exposes a scaled player spawn and five enemy lanes', async () => {
  const arena = await readGlbJson('garden-arena');
  const boundary = nodeByName(arena, ARENA_CONTRACT.boundary);
  const playerSpawn = nodeByName(arena, ARENA_CONTRACT.playerSpawn);
  const enemySpawns = arena.nodes
    .filter((node) => ARENA_CONTRACT.enemySpawnPattern.test(node.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  assert.equal(boundary.extras.shape, 'inside_circle');
  assert.ok(boundary.extras.radius > 0);
  assert.ok(playerSpawn);
  assert.equal(enemySpawns.length, 5);
  assert.deepEqual(enemySpawns.map((node) => node.name), [
    'SPAWN_Enemy_01',
    'SPAWN_Enemy_02',
    'SPAWN_Enemy_03',
    'SPAWN_Enemy_04',
    'SPAWN_Enemy_05',
  ]);

  const scale = SHOOTER_CONFIG.arenaRadius / boundary.extras.radius;
  for (const marker of [playerSpawn, ...enemySpawns]) {
    const [x, , z] = marker.translation;
    assert.ok(Math.hypot(x * scale, z * scale) < SHOOTER_CONFIG.arenaRadius);
  }
});

test('garden ghoul target, collider, and skeletal clips match runtime lookup names', async () => {
  const enemy = await readGlbJson('garden-ghoul');
  const target = nodeByName(enemy, ENEMY_CONTRACT.target);
  const collider = nodeByName(enemy, ENEMY_CONTRACT.collider);
  const jointIndices = new Set((enemy.skins ?? []).flatMap((skin) => skin.joints));

  assert.ok(target);
  assert.equal(target.extras.target_role, 'damage_center');
  assert.ok(collider.extras.radius > 0);
  assert.ok(jointIndices.size > 0);
  assert.deepEqual(enemy.animations.map((animation) => animation.name).sort(), [
    'Ghoul_Hit',
    'Ghoul_Hop',
    'Ghoul_Idle',
  ]);
  for (const animation of enemy.animations) {
    assert.ok(animation.channels.length > 0);
    assert.ok(animation.channels.every((channel) => jointIndices.has(channel.target.node)));
  }
});
