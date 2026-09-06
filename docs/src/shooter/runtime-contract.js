export const GLTF_MODEL_FORWARD = Object.freeze([0, 0, 1]);
export const GAMEPLAY_MODEL_YAW_OFFSET = Math.PI;

export const PLAYER_CONTROL_NAMES = Object.freeze({
  head: 'CTRL_Head',
  stem: 'CTRL_Stem',
  muzzle: 'CTRL_Muzzle',
  armLeft: 'CTRL_Arm_Left',
  armRight: 'CTRL_Arm_Right',
  leafFronts: Object.freeze([
    'CTRL_Leaf_Front',
    'CTRL_Leaf_Front.001',
    'CTRL_Leaf_Front.002',
    'CTRL_Leaf_Front.003',
  ]),
  leafLeft: 'CTRL_Leaf_Left',
  leafRight: 'CTRL_Leaf_Right',
});

export const PLAYER_RIG_CONTRACT = Object.freeze({
  armature: 'IcePeashooter_Armature',
  muzzleBone: 'Muzzle',
  clips: Object.freeze({
    idle: 'Idle',
    move: 'Move',
    shoot: 'Shoot',
    hit: 'Hit',
  }),
  requiredBones: Object.freeze([
    'Root',
    'LeafBase',
    'Stem',
    'Head',
    'Muzzle',
    'Arm_L',
    'Arm_R',
    'Crown',
    'Leaf_Front',
    'Leaf_FrontLeft',
    'Leaf_FrontRight',
    'Leaf_Left',
    'Leaf_Right',
    'Leaf_BackLeft',
    'Leaf_BackRight',
    'Leaf_Front_001',
    'Leaf_Front_002',
    'Leaf_Front_003',
  ]),
});

export const ARENA_CONTRACT = Object.freeze({
  boundary: 'COLLIDER_ArenaBoundary',
  playerSpawn: 'SPAWN_Player',
  enemySpawnPattern: /^SPAWN_Enemy_\d+$/,
});

export const ENEMY_CONTRACT = Object.freeze({
  collider: 'COLLIDER_Ghoul',
  target: 'TARGET_GhoulCenter',
});
