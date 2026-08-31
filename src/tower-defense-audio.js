import { AUDIO_ASSET_BY_ID } from './audio-catalog.js';

export const TD_AUDIO_SETTING_KEY = 'slime-fusion-defense-audio-v1';

const BGM_FOR_SCREEN = Object.freeze({
  menu: 'bgm-menu',
  battle: 'bgm-battle',
  result: 'bgm-menu',
});

const THROTTLE_MS = Object.freeze({
  'sfx-attack-plop': 90,
  'sfx-turret-shot': 110,
  'sfx-hit-soft': 90,
  'sfx-enemy-pop': 100,
  'sfx-core-hit': 130,
});

function validStorage(storage) {
  return Boolean(storage
    && typeof storage.get === 'function'
    && typeof storage.set === 'function');
}

function initialEnabled(storage) {
  if (!validStorage(storage)) return true;
  try {
    const value = storage.get(TD_AUDIO_SETTING_KEY, true);
    if (value && typeof value === 'object') return value.enabled !== false;
    return value !== false;
  } catch {
    return true;
  }
}

function cueIdsForEvents(events) {
  const types = new Set(events.map(({ type }) => type));
  const cues = [];
  const push = (cue) => { if (!cues.includes(cue)) cues.push(cue); };
  if (types.has('contract-summon')) push('sfx-summon');
  if (types.has('place') || types.has('tower-move')) push('sfx-deploy-gel');
  if (types.has('build-turret')) push('sfx-turret-build');
  if (types.has('wave-start')) push('sfx-wave-start');
  if (types.has('hero-skill')) push('sfx-hero-skill');
  if (types.has('turret-shot') || types.has('turret-attack')) push('sfx-turret-shot');
  if (types.has('shot') || types.has('soldier-attack')
    || types.has('hero-shot') || types.has('hero-attack')) push('sfx-attack-plop');
  if (types.has('core-hit')) push('sfx-core-hit');
  else if (types.has('enemy-hit') || types.has('tower-hit')
    || types.has('soldier-hit') || types.has('hero-hit')) push('sfx-hit-soft');
  if (types.has('enemy-defeat')) push('sfx-enemy-pop');
  const runEnd = events.find(({ type }) => type === 'run-end');
  if (runEnd) push(runEnd.result === 'victory' ? 'sfx-victory' : 'sfx-defeat');
  else if (types.has('wave-clear')) push('sfx-wave-clear');
  return cues;
}

export class TowerDefenseAudio {
  constructor({ runtime = null, storage = null, paths = {}, now = () => Date.now() } = {}) {
    this.audio = runtime?.audio || null;
    this.storage = storage;
    this.paths = { ...paths };
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.enabled = initialEnabled(storage);
    this.activated = false;
    this.backgrounded = false;
    this.desiredBgmId = 'bgm-menu';
    this.currentBgmId = null;
    this.handles = new Map();
    this.lastPlayedAt = new Map();
  }

  get available() {
    return Boolean(this.audio?.available && typeof this.audio.create === 'function');
  }

  handle(cueId) {
    if (this.handles.has(cueId)) return this.handles.get(cueId);
    const asset = AUDIO_ASSET_BY_ID[cueId];
    const src = this.paths[cueId];
    if (!this.available || !asset || typeof src !== 'string' || !src) return null;
    let handle = null;
    try {
      handle = this.audio.create({
        src,
        loop: asset.loop,
        autoplay: false,
        volume: asset.volume,
      });
    } catch {
      handle = null;
    }
    if (!handle?.available) {
      handle?.destroy?.();
      return null;
    }
    this.handles.set(cueId, handle);
    return handle;
  }

  play(cueId, { restart = true } = {}) {
    if (!this.enabled || !this.activated || this.backgrounded) return false;
    const timestamp = Number(this.now()) || 0;
    const throttle = THROTTLE_MS[cueId] || 0;
    const previous = this.lastPlayedAt.get(cueId);
    if (throttle > 0 && Number.isFinite(previous) && timestamp - previous < throttle) return false;
    const handle = this.handle(cueId);
    if (!handle) return false;
    this.lastPlayedAt.set(cueId, timestamp);
    if (restart) handle.seek?.(0);
    try {
      const request = handle.play?.();
      request?.catch?.(() => {});
    } catch {
      return false;
    }
    return true;
  }

  activate(screen = 'menu') {
    this.activated = true;
    const desired = BGM_FOR_SCREEN[screen] || 'bgm-menu';
    const shouldRetryCurrent = this.currentBgmId === desired;
    this.syncScreen(screen);
    if (shouldRetryCurrent && this.enabled && !this.backgrounded) {
      try {
        const request = this.handles.get(desired)?.play?.();
        request?.catch?.(() => {});
      } catch {
        // A later user gesture can retry again after a transient browser block.
      }
    }
    return this.enabled;
  }

  syncScreen(screen = 'menu') {
    const desired = BGM_FOR_SCREEN[screen] || 'bgm-menu';
    this.desiredBgmId = desired;
    if (!this.enabled || !this.activated || this.backgrounded) return false;
    if (this.currentBgmId === desired) return true;
    if (this.currentBgmId) this.handles.get(this.currentBgmId)?.stop?.();
    const handle = this.handle(desired);
    if (!handle) {
      this.currentBgmId = null;
      return false;
    }
    this.currentBgmId = desired;
    handle.seek?.(0);
    try {
      const request = handle.play?.();
      request?.catch?.(() => {});
    } catch {
      this.currentBgmId = null;
      return false;
    }
    return true;
  }

  consumeEvents(events = [], screen = 'menu') {
    if (!Array.isArray(events)) return [];
    const played = [];
    for (const cueId of cueIdsForEvents(events)) {
      if (this.play(cueId)) played.push(cueId);
    }
    this.syncScreen(screen);
    return played;
  }

  playUiTap() {
    return this.play('sfx-ui-tap');
  }

  setEnabled(enabled, screen = 'menu') {
    this.enabled = enabled !== false;
    try {
      this.storage?.set?.(TD_AUDIO_SETTING_KEY, { enabled: this.enabled });
    } catch {
      // Audio preferences are best-effort and never block play.
    }
    if (!this.enabled) {
      for (const handle of this.handles.values()) handle.pause?.();
      return this.enabled;
    }
    this.activated = true;
    this.currentBgmId = null;
    this.syncScreen(screen);
    this.playUiTap();
    return this.enabled;
  }

  toggle(screen = 'menu') {
    return this.setEnabled(!this.enabled, screen);
  }

  onBackground() {
    this.backgrounded = true;
    if (this.currentBgmId) this.handles.get(this.currentBgmId)?.pause?.();
  }

  onForeground(screen = 'menu') {
    this.backgrounded = false;
    if (!this.enabled || !this.activated) return false;
    if (this.currentBgmId === this.desiredBgmId) {
      const handle = this.handles.get(this.currentBgmId);
      if (handle) {
        try {
          const request = handle.play?.();
          request?.catch?.(() => {});
          return true;
        } catch {
          return false;
        }
      }
    }
    return this.syncScreen(screen);
  }

  dispose() {
    for (const handle of this.handles.values()) handle.destroy?.();
    this.handles.clear();
    this.lastPlayedAt.clear();
    this.currentBgmId = null;
  }
}

export function createTowerDefenseAudio(options) {
  return new TowerDefenseAudio(options);
}
