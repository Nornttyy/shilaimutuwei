const AUDIO_MANIFEST = './assets/audio/manifest.json';

export class ShooterAudio {
  constructor() {
    this.entries = new Map();
    this.active = new Set();
    this.music = null;
    this.enabled = true;
  }

  async load() {
    const response = await fetch(AUDIO_MANIFEST, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`音效清单加载失败（${response.status}）`);
    const manifest = await response.json();
    for (const entry of manifest.assets ?? []) this.entries.set(entry.id, entry);
  }

  play(id, volumeScale = 1) {
    if (!this.enabled) return null;
    const entry = this.entries.get(id);
    if (!entry) return null;
    const audio = new Audio(entry.path);
    const baseVolume = Number.isFinite(entry.volume) ? entry.volume : 1;
    audio.volume = Math.max(0, Math.min(1, baseVolume * volumeScale));
    audio.loop = Boolean(entry.loop);
    this.active.add(audio);
    audio.addEventListener('ended', () => this.active.delete(audio), { once: true });
    audio.play().catch(() => this.active.delete(audio));
    return audio;
  }

  startBattleMusic() {
    if (this.music && !this.music.paused) return;
    this.stopMusic();
    this.music = this.play('bgm-battle', 0.72);
  }

  stopMusic() {
    if (!this.music) return;
    this.music.pause();
    this.music.currentTime = 0;
    this.active.delete(this.music);
    this.music = null;
  }

  destroy() {
    for (const audio of this.active) {
      audio.pause();
      audio.currentTime = 0;
    }
    this.active.clear();
    this.music = null;
    this.entries.clear();
  }
}
