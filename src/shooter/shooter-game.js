import * as THREE from 'three';
import { clone as cloneSkeleton } from '../vendor/three/addons/utils/SkeletonUtils.js';
import { cloneArena, cloneNormalized, configureModel, findClip, maxDimension } from './asset-utils.js';
import { ShooterCore } from './core.js';
import { ShooterInput } from './input.js';
import { PlayerController } from './player-controller.js';
import {
  ARENA_CONTRACT,
  ENEMY_CONTRACT,
  GAMEPLAY_MODEL_YAW_OFFSET,
  GLTF_MODEL_FORWARD,
} from './runtime-contract.js';
import { VfxSystem } from './vfx.js';

const PROJECTILE_FORWARD = new THREE.Vector3(...GLTF_MODEL_FORWARD);
const TEMP_A = new THREE.Vector3();
const TEMP_B = new THREE.Vector3();
const TEMP_C = new THREE.Vector3();
const TEMP_QUATERNION = new THREE.Quaternion();

function dampAngle(current, target, smoothing, dt) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-smoothing * dt));
}

function centerAndScale(object, targetSize) {
  object.updateMatrixWorld(true);
  const dimension = maxDimension(object);
  if (!Number.isFinite(dimension) || dimension <= 0) throw new Error('Projectile has invalid bounds.');
  object.scale.setScalar(targetSize / dimension);
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  const center = bounds.getCenter(new THREE.Vector3());
  object.position.sub(center);
  return object;
}

function getWorldMarker(root, name) {
  const marker = root.getObjectByName(name);
  if (!marker) throw new Error(`3D arena is missing ${name}.`);
  return marker.getWorldPosition(new THREE.Vector3());
}

function getEnemySpawnPoints(arena) {
  const markers = [];
  arena.traverse((node) => {
    if (ARENA_CONTRACT.enemySpawnPattern.test(node.name)) markers.push(node);
  });
  markers.sort((left, right) => left.name.localeCompare(right.name));
  if (markers.length === 0) throw new Error('3D arena has no enemy spawn markers.');
  return markers.map((marker) => marker.getWorldPosition(new THREE.Vector3()));
}

class EnemyActor {
  constructor(asset, config, position, index) {
    const model = cloneNormalized(asset, 1.9, { yawOffset: GAMEPLAY_MODEL_YAW_OFFSET });
    this.root = model.root;
    this.motion = model.motion;
    this.visual = model.visual;
    this.root.position.copy(position);
    this.root.name = `GardenGhoul_${index}`;
    this.health = config.wave.enemyHealth;
    this.maxHealth = config.wave.enemyHealth;
    this.attackRemaining = 0.4 + Math.random() * 0.25;
    this.frozenRemaining = 0;
    this.hurtPulse = 0;
    this.age = Math.random() * 10;
    this.dead = false;
    this.removeRemaining = 0;
    this.config = config;
    this.hitTarget = this.visual.getObjectByName(ENEMY_CONTRACT.target);
    const collider = this.visual.getObjectByName(ENEMY_CONTRACT.collider);
    const authoredRadius = Number(collider?.userData?.radius);
    if (!this.hitTarget || !Number.isFinite(authoredRadius) || authoredRadius <= 0) {
      throw new Error('Garden ghoul is missing its target or collider contract.');
    }
    this.hitRadius = authoredRadius * model.scale;
    this.mixer = asset.animations?.length ? new THREE.AnimationMixer(this.visual) : null;
    this.actions = {};
    this.locomotionAction = null;
    if (this.mixer) {
      for (const [id, names] of Object.entries({
        idle: ['idle'],
        walk: ['walk', 'move', 'run', 'hop'],
        attack: ['attack', 'bite'],
        hit: ['hit', 'hurt'],
        death: ['death', 'die'],
      })) {
        const clip = findClip(asset.animations, names);
        if (clip) this.actions[id] = this.mixer.clipAction(clip);
      }
      this.setLocomotion(true, true);
    }
  }

  update(dt, playerPosition, core) {
    this.age += dt;
    this.hurtPulse = Math.max(0, this.hurtPulse - dt * 5.8);
    this.frozenRemaining = Math.max(0, this.frozenRemaining - dt);
    if (this.dead) {
      this.mixer?.update(dt);
      this.removeRemaining -= dt;
      this.root.rotation.z += dt * 2.2;
      this.motion.scale.multiplyScalar(Math.max(0.15, 1 - dt * 4));
      this.motion.position.y += dt * 0.7;
      return;
    }

    TEMP_A.copy(playerPosition).sub(this.root.position);
    TEMP_A.y = 0;
    const distance = TEMP_A.length();
    const desiredYaw = Math.atan2(TEMP_A.x, -TEMP_A.z);
    this.root.rotation.y = dampAngle(this.root.rotation.y, desiredYaw, 10, dt);
    const slow = this.frozenRemaining > 0 ? this.config.weapon.slowMultiplier : 1;
    const moving = distance > this.config.wave.enemyAttackRange;
    this.setLocomotion(moving);
    if (moving) {
      TEMP_A.normalize();
      this.root.position.addScaledVector(TEMP_A, this.config.wave.enemySpeed * slow * dt);
      this.attackRemaining = Math.min(this.attackRemaining, 0.25);
    } else {
      this.attackRemaining -= dt;
      if (this.attackRemaining <= 0) {
        this.attackRemaining += this.config.wave.enemyAttackInterval;
        core.damagePlayer(this.config.wave.enemyDamage);
        this.playOneShot('attack');
      }
    }
    this.mixer?.update(dt);

    if (!this.mixer) {
      const stride = Math.sin(this.age * 7.5);
      this.motion.position.y = Math.abs(stride) * 0.07;
      this.motion.rotation.z = stride * 0.045;
    }
    const pulse = this.hurtPulse > 0 ? Math.sin(this.hurtPulse * Math.PI) * 0.12 : 0;
    const frozenPulse = this.frozenRemaining > 0 ? Math.sin(this.age * 10) * 0.018 : 0;
    this.motion.scale.set(1 + pulse + frozenPulse, 1 - pulse * 0.7, 1 + pulse + frozenPulse);
  }

  setLocomotion(moving, immediate = false) {
    if (!this.mixer) return;
    const next = moving
      ? (this.actions.walk ?? this.actions.idle)
      : (this.actions.idle ?? this.actions.walk);
    if (!next || next === this.locomotionAction) return;
    next.reset();
    next.enabled = true;
    next.clampWhenFinished = false;
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    if (immediate || !this.locomotionAction) {
      this.locomotionAction?.stop();
      next.play();
    } else {
      this.locomotionAction.fadeOut(0.12);
      next.fadeIn(0.12).play();
    }
    this.locomotionAction = next;
  }

  playOneShot(id) {
    const action = this.actions[id];
    if (!action) return;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = false;
    action.enabled = true;
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.fadeIn(0.06).play();
  }

  getHitPosition(target) {
    return this.hitTarget.getWorldPosition(target);
  }

  takeDamage(amount, freezeDuration = 0) {
    if (this.dead) return false;
    this.health = Math.max(0, this.health - amount);
    this.frozenRemaining = Math.max(this.frozenRemaining, freezeDuration);
    this.hurtPulse = 1;
    this.playOneShot('hit');
    if (this.health > 0) return false;
    this.dead = true;
    this.removeRemaining = 0.52;
    this.actions.walk?.stop();
    this.actions.idle?.stop();
    this.playOneShot('death');
    return true;
  }

  dispose() {
    this.mixer?.stopAllAction();
    this.mixer?.uncacheRoot(this.visual);
  }
}

export class ShooterGame {
  constructor({ canvas, assets, hud, audio, config }) {
    this.canvas = canvas;
    this.assets = assets;
    this.hud = hud;
    this.audio = audio;
    this.config = config;
    this.core = new ShooterCore(config);
    this.accumulator = 0;
    this.enemies = [];
    this.projectiles = [];
    this.spawnIndex = 0;
    this.running = true;
    this.lastRenderTime = performance.now();

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.13;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x69bfd0);
    this.scene.fog = new THREE.Fog(0x75cad1, 24, 48);
    this.camera = new THREE.PerspectiveCamera(config.camera.fov, 1, 0.08, 90);

    this.installLighting();
    this.arena = cloneArena(assets.arena, config.arenaRadius);
    this.arena.name = 'GardenArena_Runtime';
    this.scene.add(this.arena);
    this.arena.updateMatrixWorld(true);
    this.playerSpawn = getWorldMarker(this.arena, ARENA_CONTRACT.playerSpawn);
    this.enemySpawnPoints = getEnemySpawnPoints(this.arena);

    this.player = new PlayerController(assets.player, this.scene, this.camera, config, this.playerSpawn);
    this.projectileTemplate = centerAndScale(
      configureModel(cloneSkeleton(this.assets.projectile.scene)),
      1,
    );
    this.vfx = new VfxSystem(this.scene);
    this.input = new ShooterInput(canvas, {
      onPointerLockChange: (locked) => this.handlePointerLockChange(locked),
    });

    this.resize = this.resize.bind(this);
    this.frame = this.frame.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.frameRequest = requestAnimationFrame(this.frame);
  }

  installLighting() {
    const sky = new THREE.HemisphereLight(0xdafaff, 0x376b35, 2.05);
    this.scene.add(sky);
    const sun = new THREE.DirectionalLight(0xfff1ca, 3.2);
    sun.position.set(-9, 17, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -22;
    sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22;
    sun.shadow.camera.bottom = -22;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 52;
    sun.shadow.bias = -0.00035;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x6aefff, 1.25);
    rim.position.set(10, 7, -12);
    this.scene.add(rim);
  }

  start() {
    this.clearActors();
    this.input.releaseAll();
    this.core.reset();
    this.core.start();
    this.player.reset();
    this.hud.showGame();
    this.hud.update(this.core.snapshot(), this.config);
    this.audio.startBattleMusic();
    this.audio.play('sfx-wave-start');
    this.input.lock();
    this.accumulator = 0;
  }

  pause() {
    if (this.core.phase !== 'playing') return;
    this.core.pause();
    this.input.releaseAll();
    this.input.unlock();
    this.hud.showPause();
  }

  resume() {
    if (this.core.phase !== 'paused') return;
    this.core.resume();
    this.hud.hidePause();
    this.input.lock();
  }

  restart() {
    this.start();
  }

  handlePointerLockChange(locked) {
    if (!locked) this.input.releaseAll();
    if (!locked && this.core.phase === 'playing') {
      this.core.pause();
      this.hud.showPause();
    }
  }

  frame(timestamp) {
    if (!this.running) return;
    this.frameRequest = requestAnimationFrame(this.frame);
    const rawDelta = Math.min(this.config.maxFrameDelta, Math.max(0, (timestamp - this.lastRenderTime) / 1000));
    this.lastRenderTime = timestamp;
    if (this.core.phase === 'playing') {
      this.accumulator = Math.min(this.accumulator + rawDelta, this.config.fixedStep * 4);
      while (this.core.phase === 'playing' && this.accumulator >= this.config.fixedStep) {
        this.update(this.config.fixedStep);
        this.accumulator -= this.config.fixedStep;
      }
    } else {
      this.player.updatePresentation(rawDelta);
      this.vfx.update(rawDelta, this.camera);
    }
    this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    this.core.tick(dt);
    this.player.update(dt, this.input);
    if (this.input.consumePressed('KeyR')) this.core.startReload();
    if (this.input.consumePressed('KeyQ')) this.useFreezeAbility();
    if (this.input.consumePressed('KeyE')) this.useBurstAbility();
    if (this.input.firing && this.core.tryFire()) this.fireProjectile();

    this.updateProjectiles(dt);
    this.updateEnemies(dt);
    this.vfx.update(dt, this.camera);
    this.processCoreEvents();
    this.hud.update(this.core.snapshot(), this.config);
  }

  processCoreEvents() {
    for (const event of this.core.drainEvents()) {
      if (event.type === 'spawn-request' && this.core.confirmEnemySpawn()) this.spawnEnemy();
      if (event.type === 'shot') {
        this.hud.pulseShot();
        this.audio.play('sfx-turret-shot', 0.78);
      }
      if (event.type === 'reload-start') this.hud.toast('凝结冰豌豆…', 1.1);
      if (event.type === 'player-hit') {
        this.player.triggerHit();
        this.audio.play('sfx-core-hit', 0.72);
      }
      if (event.type === 'enemy-defeated') this.audio.play('sfx-enemy-pop', 0.74);
      if (event.type === 'victory' || event.type === 'defeat') this.finish(event.type);
    }
  }

  spawnEnemy() {
    const position = this.enemySpawnPoints[this.spawnIndex % this.enemySpawnPoints.length].clone();
    const actor = new EnemyActor(this.assets.enemy, this.config, position, this.spawnIndex);
    this.spawnIndex += 1;
    this.enemies.push(actor);
    this.scene.add(actor.root);
    this.vfx.spawnRing(position, 0.9, 0xb4ff45, true);
  }

  fireProjectile({ direction, damage, strong = false } = {}) {
    const shot = this.player.getShot();
    this.player.triggerRecoil();
    this.spawnProjectile(shot.position, direction ?? shot.direction, damage ?? this.config.weapon.damage, strong);
    this.vfx.spawnMuzzle(shot.position, direction ?? shot.direction);
  }

  spawnProjectile(position, direction, damage, strong) {
    const normalizedDirection = direction.clone();
    if (normalizedDirection.lengthSq() <= Number.EPSILON) {
      throw new TypeError('Projectile direction must be non-zero.');
    }
    normalizedDirection.normalize();
    const root = new THREE.Group();
    const visual = new THREE.Group();
    visual.add(cloneSkeleton(this.projectileTemplate));
    visual.scale.setScalar(strong ? 0.48 : 0.34);
    root.add(visual);
    root.position.copy(position);
    TEMP_QUATERNION.setFromUnitVectors(PROJECTILE_FORWARD, normalizedDirection);
    root.quaternion.copy(TEMP_QUATERNION);
    this.scene.add(root);
    this.projectiles.push({
      root,
      direction: normalizedDirection,
      damage,
      strong,
      life: this.config.weapon.projectileLife,
      trailRemaining: 0,
    });
  }

  updateProjectiles(dt) {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.life -= dt;
      projectile.root.position.addScaledVector(
        projectile.direction,
        this.config.weapon.projectileSpeed * (projectile.strong ? 1.16 : 1) * dt,
      );
      projectile.root.rotateZ(dt * 8);
      projectile.trailRemaining -= dt;
      if (projectile.trailRemaining <= 0) {
        projectile.trailRemaining += 0.045;
        this.vfx.spawnTrail(projectile.root.position);
      }

      let hit = null;
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        enemy.getHitPosition(TEMP_A);
        const projectileRadius = projectile.strong ? 0.24 : 0.17;
        const hitRadius = enemy.hitRadius + projectileRadius;
        if (TEMP_A.distanceToSquared(projectile.root.position) <= hitRadius * hitRadius) {
          hit = enemy;
          break;
        }
      }
      if (hit) {
        const killed = hit.takeDamage(projectile.damage, this.config.weapon.slowDuration);
        this.hud.pulseHit();
        this.audio.play('sfx-hit-soft', 0.72);
        this.vfx.spawnImpact(projectile.root.position, projectile.strong);
        if (killed) this.core.defeatEnemy(projectile.strong ? 140 : 100);
        this.removeProjectile(index);
      } else if (projectile.life <= 0 || projectile.root.position.lengthSq() > 48 * 48) {
        this.removeProjectile(index);
      }
    }
  }

  removeProjectile(index) {
    const [projectile] = this.projectiles.splice(index, 1);
    if (projectile) this.scene.remove(projectile.root);
  }

  updateEnemies(dt) {
    for (let index = this.enemies.length - 1; index >= 0; index -= 1) {
      const enemy = this.enemies[index];
      enemy.update(dt, this.player.root.position, this.core);
      if (enemy.dead && enemy.removeRemaining <= 0) {
        this.scene.remove(enemy.root);
        enemy.dispose();
        this.enemies.splice(index, 1);
      }
    }
  }

  useFreezeAbility() {
    if (!this.core.tryUseAbility('freeze')) return;
    const ability = this.config.abilities.freeze;
    this.hud.pulseAbility('freeze');
    this.audio.play('sfx-hero-skill');
    this.vfx.spawnFreezeNova(this.player.root.position, ability.radius);
    for (const enemy of this.enemies) {
      if (enemy.dead || enemy.root.position.distanceTo(this.player.root.position) > ability.radius) continue;
      const killed = enemy.takeDamage(ability.damage, ability.duration);
      if (killed) this.core.defeatEnemy(130);
    }
  }

  useBurstAbility() {
    if (!this.core.tryUseAbility('burst')) return;
    const ability = this.config.abilities.burst;
    const shot = this.player.getShot();
    const right = TEMP_B.set(1, 0, 0).applyQuaternion(this.camera.quaternion).clone();
    const up = TEMP_C.set(0, 1, 0).applyQuaternion(this.camera.quaternion).clone();
    for (let index = 0; index < ability.pellets; index += 1) {
      const offset = index - (ability.pellets - 1) / 2;
      const direction = shot.direction.clone()
        .addScaledVector(right, offset * ability.spread)
        .addScaledVector(up, -Math.abs(offset) * ability.spread * 0.1)
        .normalize();
      this.spawnProjectile(shot.position, direction, ability.damage, true);
    }
    this.player.triggerRecoil();
    this.vfx.spawnMuzzle(shot.position, shot.direction);
    this.vfx.spawnImpact(shot.position, true);
    this.hud.pulseAbility('burst');
    this.audio.play('sfx-hero-skill');
  }

  finish(type) {
    this.input.releaseAll();
    this.input.unlock();
    this.audio.stopMusic();
    this.audio.play(type === 'victory' ? 'sfx-victory' : 'sfx-defeat');
    this.hud.showResult(this.core.snapshot());
  }

  clearActors() {
    for (const enemy of this.enemies) {
      this.scene.remove(enemy.root);
      enemy.dispose();
    }
    for (const projectile of this.projectiles) this.scene.remove(projectile.root);
    this.enemies.length = 0;
    this.projectiles.length = 0;
    this.spawnIndex = 0;
    this.vfx?.clear();
  }

  resize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.frameRequest);
    this.clearActors();
    this.input.destroy();
    this.player.dispose();
    this.vfx.dispose();
    this.audio.destroy?.();
    window.removeEventListener('resize', this.resize);
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }
}
