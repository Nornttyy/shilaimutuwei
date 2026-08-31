export const AUDIO_ASSETS = Object.freeze([
  Object.freeze({ id: 'bgm-menu', path: 'assets/audio/bgm-menu.m4a', kind: 'bgm', loop: true, volume: 0.42 }),
  Object.freeze({ id: 'bgm-battle', path: 'assets/audio/bgm-battle.m4a', kind: 'bgm', loop: true, volume: 0.38 }),
  Object.freeze({ id: 'sfx-ui-tap', path: 'assets/audio/sfx-ui-tap.wav', kind: 'sfx', loop: false, volume: 0.52 }),
  Object.freeze({ id: 'sfx-deploy-gel', path: 'assets/audio/sfx-deploy-gel.wav', kind: 'sfx', loop: false, volume: 0.64 }),
  Object.freeze({ id: 'sfx-turret-build', path: 'assets/audio/sfx-turret-build.wav', kind: 'sfx', loop: false, volume: 0.66 }),
  Object.freeze({ id: 'sfx-wave-start', path: 'assets/audio/sfx-wave-start.wav', kind: 'sfx', loop: false, volume: 0.68 }),
  Object.freeze({ id: 'sfx-attack-plop', path: 'assets/audio/sfx-attack-plop.wav', kind: 'sfx', loop: false, volume: 0.48 }),
  Object.freeze({ id: 'sfx-turret-shot', path: 'assets/audio/sfx-turret-shot.wav', kind: 'sfx', loop: false, volume: 0.52 }),
  Object.freeze({ id: 'sfx-hit-soft', path: 'assets/audio/sfx-hit-soft.wav', kind: 'sfx', loop: false, volume: 0.46 }),
  Object.freeze({ id: 'sfx-enemy-pop', path: 'assets/audio/sfx-enemy-pop.wav', kind: 'sfx', loop: false, volume: 0.56 }),
  Object.freeze({ id: 'sfx-hero-skill', path: 'assets/audio/sfx-hero-skill.wav', kind: 'sfx', loop: false, volume: 0.72 }),
  Object.freeze({ id: 'sfx-core-hit', path: 'assets/audio/sfx-core-hit.wav', kind: 'sfx', loop: false, volume: 0.7 }),
  Object.freeze({ id: 'sfx-wave-clear', path: 'assets/audio/sfx-wave-clear.wav', kind: 'sfx', loop: false, volume: 0.68 }),
  Object.freeze({ id: 'sfx-victory', path: 'assets/audio/sfx-victory.wav', kind: 'sfx', loop: false, volume: 0.72 }),
  Object.freeze({ id: 'sfx-defeat', path: 'assets/audio/sfx-defeat.wav', kind: 'sfx', loop: false, volume: 0.62 }),
  Object.freeze({ id: 'sfx-summon', path: 'assets/audio/sfx-summon.wav', kind: 'sfx', loop: false, volume: 0.7 }),
]);

export const AUDIO_ASSET_BY_ID = Object.freeze(Object.fromEntries(
  AUDIO_ASSETS.map((asset) => [asset.id, asset]),
));

export function audioPathsFromBaseUrl(baseUrl, version = '') {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const suffix = version ? `?v=${encodeURIComponent(version)}` : '';
  return Object.freeze(Object.fromEntries(AUDIO_ASSETS.map((asset) => [
    asset.id,
    base ? `${base}/${asset.path}${suffix}` : `${asset.path}${suffix}`,
  ])));
}
