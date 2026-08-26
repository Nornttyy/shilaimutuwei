import { SlimeGame } from './game.js';
import { createRigAssetStoreFromUrl } from './animation/rig-assets.js';
import { shouldUseGeneratedRigs } from './animation/rig-mode.js';

const canvas = document.querySelector('#game');
const loading = document.querySelector('#loading');

const game = new SlimeGame(canvas);

async function startGame() {
  if (shouldUseGeneratedRigs(window.location.search)) {
    try {
      const store = await createRigAssetStoreFromUrl();
      game.setRigAssetStore(store);
      await store.preload();
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
