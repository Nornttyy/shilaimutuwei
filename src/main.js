import { SlimeGame } from './game.js';
import {
  CRITICAL_STARTUP_ASSET_KEYS,
  createAssetStore,
} from './assets.js';
import { createRigAssetStoreFromUrl } from './animation/rig-assets.js';
import { shouldUseGeneratedRigs } from './animation/rig-mode.js';

const canvas = document.querySelector('#game');
const loading = document.querySelector('#loading');
const STARTUP_WAIT_MS = 8000;

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
  const criticalAssets = assetStore.preload({
    keys: CRITICAL_STARTUP_ASSET_KEYS,
  }).catch(() => null);
  const rigAssets = useGeneratedCharacterArt
    ? (async () => {
      const store = await createRigAssetStoreFromUrl();
      game.setRigAssetStore(store);
      await store.preload();
      return store;
    })().catch(() => null)
    : Promise.resolve(null);
  void rigAssets;

  let startupTimer = null;
  const startupBudget = new Promise((resolve) => {
    startupTimer = window.setTimeout(resolve, STARTUP_WAIT_MS);
  });
  await Promise.race([criticalAssets, startupBudget]);
  if (startupTimer !== null) window.clearTimeout(startupTimer);

  game.start();
  requestAnimationFrame(() => loading?.classList.add('hidden'));
  void assetStore.preload().catch(() => null);
}

void startGame();

window.addEventListener('beforeunload', () => game.save());
window.addEventListener('pagehide', () => game.save());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.onBackground();
});

window.slimeGame = game;
