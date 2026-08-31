import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { AUDIO_ASSETS } from '../src/audio-catalog.js';
import { TowerDefenseAudio, TD_AUDIO_SETTING_KEY } from '../src/tower-defense-audio.js';

test('runtime audio catalog exactly matches the generated formal manifest', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../assets/audio/manifest.json', import.meta.url),
    'utf8',
  ));
  assert.deepEqual(AUDIO_ASSETS.map((asset) => ({ ...asset })), manifest.assets);
});

function fixture({ enabled = true } = {}) {
  const calls = [];
  const handles = new Map();
  const storageValues = new Map([[TD_AUDIO_SETTING_KEY, { enabled }]]);
  const runtime = {
    audio: {
      available: true,
      create(options) {
        calls.push(['create', options.src, options.loop, options.volume]);
        const handle = {
          available: true,
          play: async () => { calls.push(['play', options.src]); },
          pause: () => calls.push(['pause', options.src]),
          stop: () => calls.push(['stop', options.src]),
          seek: (value) => calls.push(['seek', options.src, value]),
          destroy: () => calls.push(['destroy', options.src]),
        };
        handles.set(options.src, handle);
        return handle;
      },
    },
  };
  const storage = {
    get: (key, fallback) => storageValues.has(key) ? storageValues.get(key) : fallback,
    set: (key, value) => { storageValues.set(key, value); return true; },
  };
  const paths = Object.fromEntries([
    'bgm-menu', 'bgm-battle', 'sfx-ui-tap', 'sfx-deploy-gel', 'sfx-turret-build',
    'sfx-wave-start', 'sfx-attack-plop', 'sfx-turret-shot', 'sfx-hit-soft',
    'sfx-enemy-pop', 'sfx-hero-skill', 'sfx-core-hit', 'sfx-wave-clear',
    'sfx-victory', 'sfx-defeat', 'sfx-summon',
  ].map((id) => [id, `${id}.audio`]));
  let now = 1000;
  const director = new TowerDefenseAudio({ runtime, storage, paths, now: () => now });
  return { director, calls, storageValues, advance: (ms) => { now += ms; } };
}

test('BGM waits for a user gesture and follows menu, battle, and background lifecycle', () => {
  const { director, calls } = fixture();
  assert.equal(director.syncScreen('menu'), false);
  assert.equal(calls.length, 0, 'autoplay is never requested before activation');
  director.activate('menu');
  assert.ok(calls.some((call) => call[0] === 'play' && call[1] === 'bgm-menu.audio'));
  const menuPlayCount = calls.filter(([kind, src]) => (
    kind === 'play' && src === 'bgm-menu.audio'
  )).length;
  director.activate('menu');
  assert.equal(calls.filter(([kind, src]) => (
    kind === 'play' && src === 'bgm-menu.audio'
  )).length, menuPlayCount + 1, 'a later gesture retries a browser-blocked BGM request');
  director.syncScreen('battle');
  assert.ok(calls.some((call) => call[0] === 'stop' && call[1] === 'bgm-menu.audio'));
  assert.ok(calls.some((call) => call[0] === 'play' && call[1] === 'bgm-battle.audio'));
  director.onBackground();
  assert.ok(calls.some((call) => call[0] === 'pause' && call[1] === 'bgm-battle.audio'));
  const playCount = calls.filter(([kind]) => kind === 'play').length;
  director.onForeground('battle');
  assert.equal(calls.filter(([kind]) => kind === 'play').length, playCount + 1);
});

test('event batches collapse four soldiers into one throttled combat sound', () => {
  const { director, calls, advance } = fixture();
  director.activate('battle');
  const events = Array.from({ length: 4 }, (_, memberIndex) => ({
    type: 'soldier-attack', memberIndex,
  }));
  assert.deepEqual(director.consumeEvents(events, 'battle'), ['sfx-attack-plop']);
  assert.deepEqual(director.consumeEvents(events, 'battle'), []);
  advance(91);
  assert.deepEqual(director.consumeEvents(events, 'battle'), ['sfx-attack-plop']);
  assert.equal(calls.filter(([kind, src]) => kind === 'play' && src === 'sfx-attack-plop.audio').length, 2);
});

test('run end suppresses wave-clear and selects the matching result cue', () => {
  const { director } = fixture();
  director.activate('battle');
  assert.deepEqual(director.consumeEvents([
    { type: 'wave-clear' },
    { type: 'run-end', result: 'victory' },
  ], 'result'), ['sfx-victory']);
  assert.equal(director.currentBgmId, 'bgm-menu');
});

test('audio toggle is stored, mutes every handle, and can recover', () => {
  const { director, calls, storageValues } = fixture();
  director.activate('menu');
  assert.equal(director.toggle('menu'), false);
  assert.deepEqual(storageValues.get(TD_AUDIO_SETTING_KEY), { enabled: false });
  assert.ok(calls.some(([kind]) => kind === 'pause'));
  assert.equal(director.playUiTap(), false);
  assert.equal(director.toggle('menu'), true);
  assert.deepEqual(storageValues.get(TD_AUDIO_SETTING_KEY), { enabled: true });
  assert.equal(director.playUiTap(), true);
  director.dispose();
  assert.ok(calls.some(([kind]) => kind === 'destroy'));
});
