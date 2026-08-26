import { SlimeGame } from './game.js';

const canvas = document.querySelector('#game');
const loading = document.querySelector('#loading');

// Raster assets are opt-in so the vector game never touches image files by
// default. Enable them explicitly with data-raster-assets="enabled".
if (canvas?.getAttribute('data-raster-assets') === 'enabled') {
  void import('./assets.js').then(({ preloadAssets }) => preloadAssets());
}

const game = new SlimeGame(canvas);
game.start();

requestAnimationFrame(() => loading?.classList.add('hidden'));

window.addEventListener('beforeunload', () => game.save());
window.addEventListener('pagehide', () => game.save());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) game.onBackground();
});

window.slimeGame = game;
