import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [html, css] = await Promise.all([
  readFile(path.join(root, 'shooter.html'), 'utf8'),
  readFile(path.join(root, 'shooter.css'), 'utf8'),
]);

test('shooter HUD keeps every runtime DOM hook unique', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'DOM ids must stay unique');

  for (const id of [
    'shooterApp',
    'shooterCanvas',
    'loadingScreen',
    'loadingLabel',
    'loadingPercent',
    'loadingFill',
    'loadingRetry',
    'startScreen',
    'startButton',
    'hud',
    'objectiveLabel',
    'objectiveCount',
    'objectiveFill',
    'pauseButton',
    'healthText',
    'healthFill',
    'statusText',
    'ammoText',
    'crosshair',
    'hitMarker',
    'damageVignette',
    'pauseScreen',
    'resumeButton',
    'resultScreen',
    'resultKicker',
    'resultTitle',
    'resultSummary',
    'restartButton',
    'toast',
  ]) {
    assert.ok(ids.includes(id), `missing runtime hook #${id}`);
  }

  assert.deepEqual(
    [...html.matchAll(/\bdata-ability="([^"]+)"/g)].map((match) => match[1]).sort(),
    ['burst', 'freeze'],
  );
});

test('shooter HUD uses code-native combat shapes instead of the glossy sprite sheet', () => {
  assert.doesNotMatch(html + css, /ui-shooter-frost-icons-v1|portrait-gem|返回原游戏|试玩/);
  assert.doesNotMatch(css, /\burl\s*\(|\bbackground-image\s*:/i);

  for (const selector of [
    '.player-panel',
    '.player-crest',
    '.ammo-panel',
    '.ability-slot',
    '.freeze-icon',
    '.burst-icon',
    '.reload-icon',
    '.crosshair',
  ]) {
    assert.match(css, new RegExp(`\\${selector}\\s*\\{`), `missing ${selector}`);
  }

  assert.equal((html.match(/class="ability-slot\b/g) ?? []).length, 3);
  assert.equal((html.match(/class="crosshair-(?:top|right|bottom|left)"/g) ?? []).length, 4);
  assert.doesNotMatch(css, /\.ability-panel\s*\{\s*display:\s*none/);
  assert.match(css, /@media \(max-width: 680px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('shooter HUD preserves runtime state selectors', () => {
  for (const state of ['is-ready', 'is-pulse', 'is-hot', 'is-reloading', 'is-visible']) {
    assert.match(css, new RegExp(`\\.${state}\\b`), `missing .${state}`);
  }
  assert.match(css, /--cooldown\s*:/);
});
