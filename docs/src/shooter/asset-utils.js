import * as THREE from 'three';
import { clone as cloneSkeleton } from '../vendor/three/addons/utils/SkeletonUtils.js';
import { ARENA_CONTRACT } from './runtime-contract.js';

export function configureModel(model) {
  model.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    node.frustumCulled = true;
  });
  return model;
}

export function cloneNormalized(asset, targetHeight, { yawOffset = 0 } = {}) {
  const root = new THREE.Group();
  const motion = new THREE.Group();
  const visual = configureModel(cloneSkeleton(asset.scene));
  visual.rotation.y = yawOffset;
  motion.add(visual);
  root.add(motion);
  root.updateMatrixWorld(true);

  const initialBounds = new THREE.Box3().setFromObject(visual);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(initialSize.y) || initialSize.y <= 0) {
    throw new Error('3D character has invalid bounds.');
  }
  const scale = targetHeight / initialSize.y;
  visual.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(visual);
  const center = bounds.getCenter(new THREE.Vector3());
  visual.position.x -= center.x;
  visual.position.z -= center.z;
  visual.position.y -= bounds.min.y;
  root.updateMatrixWorld(true);
  return { root, motion, visual, scale };
}

export function cloneArena(asset, targetPlayRadius) {
  const root = configureModel(cloneSkeleton(asset.scene));
  root.updateMatrixWorld(true);
  const boundary = root.getObjectByName(ARENA_CONTRACT.boundary);
  const authoredRadius = Number(boundary?.userData?.radius);
  if (!boundary || !Number.isFinite(authoredRadius) || authoredRadius <= 0) {
    throw new Error(`3D arena is missing a valid ${ARENA_CONTRACT.boundary}.`);
  }
  if (!Number.isFinite(targetPlayRadius) || targetPlayRadius <= 0) {
    throw new TypeError('3D arena target play radius must be positive.');
  }
  root.scale.setScalar(targetPlayRadius / authoredRadius);
  root.updateMatrixWorld(true);
  const center = boundary.getWorldPosition(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.updateMatrixWorld(true);
  return root;
}

export function findClip(clips, names) {
  const normalizedNames = names.map((name) => name.toLowerCase());
  for (const name of normalizedNames) {
    const exact = clips.find((clip) => clip.name.toLowerCase() === name);
    if (exact) return exact;
  }
  return clips.find((clip) => normalizedNames.some((name) => clip.name.toLowerCase().includes(name))) ?? null;
}

export function maxDimension(object) {
  object.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z);
}
