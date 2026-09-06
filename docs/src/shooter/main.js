import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { ShooterAudio } from './audio.js';
import { SHOOTER_ASSET_IDS, SHOOTER_ASSET_MANIFEST, SHOOTER_CONFIG } from './config.js';
import { ShooterHud } from './hud.js';
import { ShooterGame } from './shooter-game.js';

const MINIMUM_LOADING_TIME = 3000;
const REQUIRED_IDS = Object.freeze(Object.values(SHOOTER_ASSET_IDS));

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function readManifest() {
  const response = await fetch(SHOOTER_ASSET_MANIFEST, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`3D 素材清单加载失败（${response.status}）`);
  const manifest = await response.json();
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.assets)) {
    throw new Error('3D 素材清单格式不正确。');
  }
  const entries = new Map();
  for (const asset of manifest.assets) {
    if (typeof asset?.id === 'string' && typeof asset?.path === 'string') entries.set(asset.id, asset);
  }
  for (const id of REQUIRED_IDS) {
    if (!entries.has(id)) throw new Error(`缺少正式 3D 素材：${id}`);
  }
  return entries;
}

async function loadAssets(hud) {
  const startedAt = performance.now();
  hud.setLoading(0.05, '正在读取 3D 素材清单');
  const entries = await readManifest();
  const loader = new GLTFLoader();
  const loaded = new Map();
  let completed = 0;

  await Promise.all(REQUIRED_IDS.map(async (id) => {
    const entry = entries.get(id);
    const gltf = await loader.loadAsync(entry.path);
    if (!gltf.scene) throw new Error(`3D 素材没有场景：${id}`);
    loaded.set(id, gltf);
    completed += 1;
    hud.setLoading(0.12 + (completed / REQUIRED_IDS.length) * 0.78, `载入正式素材 ${completed}/${REQUIRED_IDS.length}`);
  }));

  const audio = new ShooterAudio();
  try {
    await audio.load();
  } catch (error) {
    console.warn(error);
  }
  hud.setLoading(0.94, '正在布置花园战场');
  const remaining = Math.max(0, MINIMUM_LOADING_TIME - (performance.now() - startedAt));
  await delay(remaining);
  hud.setLoading(1, '准备完成');
  await delay(180);

  return {
    assets: {
      player: loaded.get(SHOOTER_ASSET_IDS.player),
      arena: loaded.get(SHOOTER_ASSET_IDS.arena),
      enemy: loaded.get(SHOOTER_ASSET_IDS.enemy),
      projectile: loaded.get(SHOOTER_ASSET_IDS.projectile),
    },
    audio,
  };
}

async function boot() {
  const hud = new ShooterHud();
  try {
    const { assets, audio } = await loadAssets(hud);
    const game = new ShooterGame({
      canvas: document.getElementById('shooterCanvas'),
      assets,
      hud,
      audio,
      config: SHOOTER_CONFIG,
    });
    hud.bind({
      start: () => game.start(),
      pause: () => game.pause(),
      resume: () => game.resume(),
      restart: () => game.restart(),
      retry: () => window.location.reload(),
    });
    hud.showStart();
    window.__iceGardenGame = game;
  } catch (error) {
    console.error(error);
    hud.setLoadingError(error instanceof Error ? error.message : '加载失败，请重试。');
  }
}

boot();
