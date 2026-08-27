import { SlimeGame } from './game.js';
import { createAssetStore } from './assets.js';
import { createRigAssetStoreFromUrl } from './animation/rig-assets.js';
import { shouldUseGeneratedRigs } from './animation/rig-mode.js';

const canvas = document.querySelector('#game');
const loading = document.querySelector('#loading');
const STARTUP_WAIT_MS = 20000;

const game = new SlimeGame(canvas);
const assetStore = createAssetStore();
const useGeneratedCharacterArt = shouldUseGeneratedRigs(
  window.location.search,
  { hostname: window.location.hostname },
);

if (typeof game.setAssetStore === 'function') game.setAssetStore(assetStore);
else game.assetStore = assetStore;
game.setGeneratedCharacterArtEnabled(useGeneratedCharacterArt);

async function startGame() {
  const ordinaryAssets = assetStore.preload().catch(() => null);
  const rigAssets = useGeneratedCharacterArt
    ? (async () => {
      const store = await createRigAssetStoreFromUrl();
      game.setRigAssetStore(store);
      await store.preload();
      return store;
    })().catch(() => null)
    : Promise.resolve(null);

  const assetsReady = Promise.all([ordinaryAssets, rigAssets]);
  let startupTimer = null;
  const startupBudget = new Promise((resolve) => {
    startupTimer = window.setTimeout(resolve, STARTUP_WAIT_MS);
  });
  const result = await Promise.race([assetsReady, startupBudget]);
  if (startupTimer !== null) window.clearTimeout(startupTimer);
  const rigStore = Array.isArray(result) ? result[1] : null;
  if (rigStore) {
    try {
      game.setRigAssetStore(rigStore);
    } catch {
      // The generated standalone remains available if an atomic rig cannot attach.
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
