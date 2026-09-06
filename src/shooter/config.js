export const SHOOTER_ASSET_MANIFEST = './assets/3d-manifest.json';

export const SHOOTER_ASSET_IDS = Object.freeze({
  player: 'ice-peashooter',
  arena: 'garden-arena',
  enemy: 'garden-ghoul',
  projectile: 'ice-pea-projectile',
});

export const SHOOTER_CONFIG = Object.freeze({
  fixedStep: 1 / 60,
  maxFrameDelta: 0.1,
  arenaRadius: 17,
  player: Object.freeze({
    maxHealth: 100,
    height: 2.25,
    moveSpeed: 6.4,
    sprintMultiplier: 1.48,
    acceleration: 15,
    mouseSensitivity: 0.00235,
  }),
  camera: Object.freeze({
    fov: 57,
    distance: 5.7,
    shoulder: 0.86,
    height: 2.2,
    targetHeight: 1.35,
    minPitch: -0.5,
    maxPitch: 0.64,
  }),
  weapon: Object.freeze({
    magazine: 12,
    damage: 34,
    fireInterval: 0.22,
    reloadTime: 1.35,
    projectileSpeed: 28,
    projectileLife: 2.4,
    slowDuration: 2.35,
    slowMultiplier: 0.52,
  }),
  wave: Object.freeze({
    enemyCount: 8,
    maxActive: 4,
    spawnInterval: 1.25,
    spawnDelay: 0.7,
    enemyHealth: 92,
    enemySpeed: 2.15,
    enemyDamage: 9,
    enemyAttackRange: 1.42,
    enemyAttackInterval: 1.05,
  }),
  abilities: Object.freeze({
    freeze: Object.freeze({ cooldown: 8, radius: 8, damage: 18, duration: 4.2 }),
    burst: Object.freeze({ cooldown: 5.5, pellets: 5, spread: 0.12, damage: 24 }),
  }),
});
