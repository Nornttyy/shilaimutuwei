import * as THREE from 'three';
import { cloneNormalized, findClip } from './asset-utils.js';
import {
  GAMEPLAY_MODEL_YAW_OFFSET,
  PLAYER_CONTROL_NAMES,
  PLAYER_RIG_CONTRACT,
} from './runtime-contract.js';

const TEMP_FORWARD = new THREE.Vector3();
const TEMP_RIGHT = new THREE.Vector3();
const TEMP_MOVE = new THREE.Vector3();
const TEMP_TARGET = new THREE.Vector3();
const TEMP_CAMERA = new THREE.Vector3();
const TEMP_CAMERA_HEIGHT = new THREE.Vector3();
const TEMP_MUZZLE = new THREE.Vector3();
const TEMP_DIRECTION = new THREE.Vector3();
const CENTER_SCREEN = new THREE.Vector2(0, 0);

function damp(current, target, smoothing, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-smoothing * dt));
}

function matchesLoadedBoneName(loadedName, contractName) {
  if (loadedName === contractName) return true;
  return loadedName.startsWith(`${contractName}_`)
    && /^\d+$/.test(loadedName.slice(contractName.length + 1));
}

export class PlayerController {
  constructor(asset, scene, camera, config, spawnPosition = null) {
    this.config = config;
    this.cameraConfig = config.camera;
    this.spawnPosition = spawnPosition?.clone?.() ?? new THREE.Vector3(0, 0, 7);
    const model = cloneNormalized(asset, config.player.height, { yawOffset: GAMEPLAY_MODEL_YAW_OFFSET });
    this.root = model.root;
    this.motion = model.motion;
    this.visual = model.visual;
    this.root.name = 'PlayerGameplayRoot';
    this.root.position.copy(this.spawnPosition);
    scene.add(this.root);
    this.camera = camera;
    this.raycaster = new THREE.Raycaster();
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0.06;
    this.walkTime = 0;
    this.recoil = 0;
    this.hitPulse = 0;
    this.moving = 0;

    this.muzzleAnchor = null;
    this.visual.traverse((node) => {
      if (!this.muzzleAnchor
        && node.isBone
        && matchesLoadedBoneName(node.name, PLAYER_RIG_CONTRACT.muzzleBone)) {
        this.muzzleAnchor = node;
      }
    });
    this.muzzleAnchor ??= this.visual.getObjectByName(PLAYER_CONTROL_NAMES.muzzle);
    if (!this.muzzleAnchor) {
      throw new Error(
        `Ice player model is missing ${PLAYER_RIG_CONTRACT.muzzleBone} and ${PLAYER_CONTROL_NAMES.muzzle}.`,
      );
    }
    this.mixer = null;
    this.actions = {};
    this.locomotionAction = null;
    this.oneShotAction = null;
    this.oneShotId = null;
    this.handleMixerFinished = ({ action }) => this.finishOneShot(action);
    this.setupAnimation(asset);
    this.updateCamera(1, true);
  }

  setupAnimation(asset) {
    if (!asset.animations?.length) return;
    const armature = this.visual.getObjectByName(PLAYER_RIG_CONTRACT.armature);
    const bones = new Map();
    let hasSkinnedMesh = false;
    this.visual.traverse((node) => {
      if (node.isBone) bones.set(node.name, node);
      if (node.isSkinnedMesh) hasSkinnedMesh = true;
    });
    const loadedBoneNames = [...bones.keys()];
    const missingBones = PLAYER_RIG_CONTRACT.requiredBones
      .filter((name) => !loadedBoneNames.some((loadedName) => matchesLoadedBoneName(loadedName, name)));
    const actions = {};
    const missingClips = [];
    for (const [id, clipName] of Object.entries(PLAYER_RIG_CONTRACT.clips)) {
      const clip = findClip(asset.animations, [clipName]);
      if (clip) actions[id] = clip;
      else missingClips.push(clipName);
    }
    if (!armature || !hasSkinnedMesh || missingBones.length || missingClips.length) {
      const missing = [
        ...(!armature ? [PLAYER_RIG_CONTRACT.armature] : []),
        ...(!hasSkinnedMesh ? ['skinned mesh'] : []),
        ...missingBones,
        ...missingClips,
      ];
      throw new Error(`Ice player animation contract is incomplete: ${missing.join(', ')}.`);
    }

    // The exported locator is bone-parented to Muzzle and follows its clip safely,
    // while preserving the stable authoring/runtime name used by older assets.
    this.mixer = new THREE.AnimationMixer(this.visual);
    this.actions = Object.fromEntries(
      Object.entries(actions).map(([id, clip]) => [id, this.mixer.clipAction(clip)]),
    );
    this.mixer.addEventListener('finished', this.handleMixerFinished);
    this.setLocomotion(false, true);
  }

  reset() {
    this.root.position.copy(this.spawnPosition);
    this.velocity.set(0, 0, 0);
    this.yaw = 0;
    this.pitch = 0.06;
    this.walkTime = 0;
    this.recoil = 0;
    this.hitPulse = 0;
    this.root.rotation.set(0, 0, 0);
    this.motion.position.set(0, 0, 0);
    this.motion.scale.set(1, 1, 1);
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.locomotionAction = null;
      this.oneShotAction = null;
      this.oneShotId = null;
      this.setLocomotion(false, true);
      this.mixer.update(0);
    }
    this.updateCamera(1, true);
  }

  update(dt, input) {
    const look = input.consumeLook();
    this.yaw -= look.x * this.config.player.mouseSensitivity;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - look.y * this.config.player.mouseSensitivity,
      this.cameraConfig.minPitch,
      this.cameraConfig.maxPitch,
    );

    const movement = input.movement();
    TEMP_FORWARD.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    TEMP_RIGHT.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    TEMP_MOVE.set(0, 0, 0)
      .addScaledVector(TEMP_FORWARD, movement.y)
      .addScaledVector(TEMP_RIGHT, movement.x);
    if (TEMP_MOVE.lengthSq() > 1) TEMP_MOVE.normalize();

    const speed = this.config.player.moveSpeed
      * (movement.sprint && TEMP_MOVE.lengthSq() > 0 ? this.config.player.sprintMultiplier : 1);
    const targetX = TEMP_MOVE.x * speed;
    const targetZ = TEMP_MOVE.z * speed;
    this.velocity.x = damp(this.velocity.x, targetX, this.config.player.acceleration, dt);
    this.velocity.z = damp(this.velocity.z, targetZ, this.config.player.acceleration, dt);
    this.root.position.addScaledVector(this.velocity, dt);

    const radialDistance = Math.hypot(this.root.position.x, this.root.position.z);
    if (radialDistance > this.config.arenaRadius) {
      const scale = this.config.arenaRadius / radialDistance;
      this.root.position.x *= scale;
      this.root.position.z *= scale;
    }

    this.root.rotation.y = this.yaw;
    this.updateAnimation(dt, Math.min(1, this.velocity.length() / this.config.player.moveSpeed));
    this.updateCamera(dt, false);
  }

  updatePresentation(dt) {
    this.velocity.x = damp(this.velocity.x, 0, this.config.player.acceleration, dt);
    this.velocity.z = damp(this.velocity.z, 0, this.config.player.acceleration, dt);
    this.updateAnimation(dt, 0);
    this.updateCamera(dt, false);
  }

  updateAnimation(dt, targetMovement) {
    this.moving = damp(this.moving, targetMovement, 10, dt);
    this.walkTime += dt * (2.2 + this.moving * 7.5);
    this.recoil = Math.max(0, this.recoil - dt * 8.2);
    this.hitPulse = Math.max(0, this.hitPulse - dt * 6.4);
    this.setLocomotion(this.moving > 0.12);
    this.mixer?.update(dt);
    this.animatePresentation();
  }

  animatePresentation() {
    const doubleStride = Math.sin(this.walkTime * 2);
    const idle = Math.sin(this.walkTime * 0.48);
    const hit = this.hitPulse > 0 ? Math.sin(this.hitPulse * Math.PI) : 0;
    this.motion.position.y = Math.abs(doubleStride) * 0.075 * this.moving + idle * 0.018;
    this.motion.scale.x = 1 + Math.abs(doubleStride) * 0.025 * this.moving + this.recoil * 0.025 + hit * 0.035;
    this.motion.scale.y = 1 - Math.abs(doubleStride) * 0.032 * this.moving - this.recoil * 0.04 - hit * 0.025;
    this.motion.scale.z = 1 + Math.abs(doubleStride) * 0.025 * this.moving + this.recoil * 0.04 + hit * 0.035;
  }

  setLocomotion(moving, immediate = false) {
    if (!this.mixer) return;
    const next = moving ? this.actions.move : this.actions.idle;
    if (!next || next === this.locomotionAction) return;
    const previous = this.locomotionAction;
    next.reset();
    next.stopFading();
    next.enabled = true;
    next.clampWhenFinished = false;
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(this.oneShotAction ? 0 : 1);
    next.play();
    if (immediate || !previous || this.oneShotAction) previous?.stop();
    else previous.crossFadeTo(next, 0.18, false);
    this.locomotionAction = next;
  }

  playOneShot(id) {
    if (!this.mixer) return;
    const action = this.actions[id];
    if (!action) return;
    if (this.oneShotId === 'hit' && id === 'shoot') return;
    this.oneShotAction?.stop();
    this.locomotionAction?.stopFading().fadeOut(0.06);
    action.reset();
    action.stopFading();
    action.enabled = true;
    action.clampWhenFinished = false;
    action.setLoop(THREE.LoopOnce, 1);
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.fadeIn(0.04).play();
    this.oneShotAction = action;
    this.oneShotId = id;
  }

  finishOneShot(action) {
    if (action !== this.oneShotAction) return;
    action.stop();
    this.oneShotAction = null;
    this.oneShotId = null;
    this.locomotionAction
      ?.stopFading()
      .setEffectiveWeight(0)
      .fadeIn(0.12)
      .play();
  }

  updateCamera(dt, immediate) {
    TEMP_FORWARD.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    TEMP_RIGHT.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    TEMP_TARGET.copy(this.root.position)
      .addScaledVector(TEMP_FORWARD, 0.7)
      .setY(this.root.position.y + this.cameraConfig.targetHeight + this.pitch * 0.38);
    TEMP_CAMERA.copy(TEMP_TARGET)
      .addScaledVector(TEMP_FORWARD, -this.cameraConfig.distance * Math.cos(this.pitch))
      .addScaledVector(TEMP_RIGHT, this.cameraConfig.shoulder)
      .add(TEMP_CAMERA_HEIGHT.set(
        0,
        this.cameraConfig.height + Math.sin(this.pitch) * this.cameraConfig.distance,
        0,
      ));
    if (immediate) this.camera.position.copy(TEMP_CAMERA);
    else this.camera.position.lerp(TEMP_CAMERA, 1 - Math.exp(-12 * dt));
    this.camera.lookAt(TEMP_TARGET);
  }

  triggerRecoil() {
    this.recoil = 1;
    this.playOneShot('shoot');
  }

  triggerHit() {
    this.hitPulse = 1;
    this.playOneShot('hit');
  }

  getShot() {
    this.root.updateMatrixWorld(true);
    this.muzzleAnchor.getWorldPosition(TEMP_MUZZLE);
    this.raycaster.setFromCamera(CENTER_SCREEN, this.camera);
    TEMP_DIRECTION.copy(this.raycaster.ray.direction).normalize();
    return {
      position: TEMP_MUZZLE.clone().addScaledVector(TEMP_DIRECTION, 0.2),
      direction: TEMP_DIRECTION.clone(),
    };
  }

  dispose() {
    if (!this.mixer) return;
    this.mixer.removeEventListener('finished', this.handleMixerFinished);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.visual);
  }
}
