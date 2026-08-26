import { SlimeGame } from './game.js';
import { createAssetStore } from './assets.js';
import { createRigAssetStoreFromUrl } from './animation/rig-assets.js';
import { shouldUseGeneratedRigs } from './animation/rig-mode.js';

const canvas = document.querySelector('#game');
const loading = document.querySelector('#loading');

const game = new SlimeGame(canvas);
const assetStore = createAssetStore();

if (typeof game.setAssetStore === 'function') game.setAssetStore(assetStore);
else game.assetStore = assetStore;

async function startGame() {
  const ordinaryAssets = assetStore.preload().catch(() => null);
  const rigAssets = shouldUseGeneratedRigs(window.location.search)
    ? (async () => {
      const store = await createRigAssetStoreFromUrl();
      await store.preload();
      return store;
    })().catch(() => null)
    : Promise.resolve(null);

  const [, rigStore] = await Promise.all([ordinaryAssets, rigAssets]);
  if (rigStore) {
    try {
      game.setRigAssetStore(rigStore);
    } catch {
      // Missing manifests or images are non-fatal: draw.js keeps the vector art.
    }
  }

  game.start();
  requestAnimationFrame(() => loading?.classList.add('hidden'));
}

void startGame();

window.addEventListener('beforeunload', () => game.save());
window.addEventListener('pagehide', () => game.save());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.onBackground();
});

window.slimeGame = game;
