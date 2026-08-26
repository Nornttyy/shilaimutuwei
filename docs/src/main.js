import { SlimeGame } from './game.js';
import { createRigAssetStoreFromUrl } from './animation/rig-assets.js';

const canvas = document.querySelector('#game');
const loading = document.querySelector('#loading');

const game = new SlimeGame(canvas);
game.start();

// Layered atlases stay behind an explicit debug switch until every bind pose
// and animation pivot has been visually calibrated. The public build keeps the
// stable vector characters instead of exposing a partially aligned rig.
const layeredRigDebug = new URLSearchParams(window.location.search).get('rigDebug') === '1';
if (layeredRigDebug) {
  void createRigAssetStoreFromUrl()
    .then((store) => {
      game.setRigAssetStore(store);
      return store.preload();
    })
    .catch(() => {
      // Missing manifests or images are non-fatal: draw.js keeps the vector art.
    });
}

requestAnimationFrame(() => loading?.classList.add('hidden'));

window.addEventListener('beforeunload', () => game.save());
window.addEventListener('pagehide', () => game.save());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.onBackground();
});

window.slimeGame = game;
