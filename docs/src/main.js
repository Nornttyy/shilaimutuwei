import { SlimeGame } from './game.js';
import { createRigAssetStoreFromUrl } from './animation/rig-assets.js';

const canvas = document.querySelector('#game');
const loading = document.querySelector('#loading');

const game = new SlimeGame(canvas);
game.start();

// Start rendering immediately. The manifest and all per-character bundles
// load in the background; each card stays entirely vector-rendered until its
// complete rig bundle is decoded.
void createRigAssetStoreFromUrl()
  .then((store) => {
    game.setRigAssetStore(store);
    return store.preload();
  })
  .catch(() => {
    // Missing manifests or images are non-fatal: draw.js keeps the vector art.
  });

requestAnimationFrame(() => loading?.classList.add('hidden'));

window.addEventListener('beforeunload', () => game.save());
window.addEventListener('pagehide', () => game.save());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.onBackground();
});

window.slimeGame = game;
