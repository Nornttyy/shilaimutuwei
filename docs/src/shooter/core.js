const PHASES = new Set(['menu', 'playing', 'paused', 'victory', 'defeat']);

function finiteNonNegative(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export class ShooterCore {
  constructor(config) {
    if (!config?.player || !config?.weapon || !config?.wave || !config?.abilities) {
      throw new TypeError('ShooterCore requires player, weapon, wave, and ability config.');
    }
    this.config = config;
    this.reset();
  }

  reset() {
    const { player, weapon, wave, abilities } = this.config;
    this.phase = 'menu';
    this.elapsed = 0;
    this.player = {
      health: player.maxHealth,
      maxHealth: player.maxHealth,
      ammo: weapon.magazine,
      magazine: weapon.magazine,
      weaponCooldown: 0,
      reloadRemaining: 0,
      damageFlash: 0,
    };
    this.wave = {
      target: wave.enemyCount,
      spawned: 0,
      active: 0,
      defeated: 0,
      spawnRemaining: wave.spawnDelay,
      score: 0,
    };
    this.abilities = Object.fromEntries(Object.entries(abilities).map(([id]) => [id, 0]));
    this.events = [];
    return this.snapshot();
  }

  start() {
    if (this.phase === 'victory' || this.phase === 'defeat') this.reset();
    this.setPhase('playing');
    this.events.push({ type: 'started' });
  }

  setPhase(phase) {
    if (!PHASES.has(phase)) throw new TypeError(`Unknown shooter phase: ${phase}`);
    this.phase = phase;
  }

  pause() {
    if (this.phase === 'playing') this.setPhase('paused');
  }

  resume() {
    if (this.phase === 'paused') this.setPhase('playing');
  }

  tick(deltaSeconds) {
    if (this.phase !== 'playing') return;
    const dt = Math.min(0.1, finiteNonNegative(deltaSeconds));
    this.elapsed += dt;
    this.player.weaponCooldown = Math.max(0, this.player.weaponCooldown - dt);
    this.player.damageFlash = Math.max(0, this.player.damageFlash - dt);

    if (this.player.reloadRemaining > 0) {
      this.player.reloadRemaining = Math.max(0, this.player.reloadRemaining - dt);
      if (this.player.reloadRemaining === 0) {
        this.player.ammo = this.player.magazine;
        this.events.push({ type: 'reload-complete' });
      }
    }

    for (const id of Object.keys(this.abilities)) {
      this.abilities[id] = Math.max(0, this.abilities[id] - dt);
    }

    if (this.wave.spawned < this.wave.target && this.wave.active < this.config.wave.maxActive) {
      this.wave.spawnRemaining -= dt;
      if (this.wave.spawnRemaining <= 0) {
        this.wave.spawnRemaining += this.config.wave.spawnInterval;
        this.events.push({ type: 'spawn-request' });
      }
    }
  }

  confirmEnemySpawn() {
    if (
      this.phase !== 'playing'
      || this.wave.spawned >= this.wave.target
      || this.wave.active >= this.config.wave.maxActive
    ) return false;
    this.wave.spawned += 1;
    this.wave.active += 1;
    return true;
  }

  tryFire() {
    if (
      this.phase !== 'playing'
      || this.player.reloadRemaining > 0
      || this.player.weaponCooldown > 0
    ) return false;

    if (this.player.ammo <= 0) {
      this.startReload();
      return false;
    }

    this.player.ammo -= 1;
    this.player.weaponCooldown = this.config.weapon.fireInterval;
    this.events.push({ type: 'shot' });
    if (this.player.ammo === 0) this.startReload();
    return true;
  }

  startReload() {
    if (
      this.phase !== 'playing'
      || this.player.reloadRemaining > 0
      || this.player.ammo >= this.player.magazine
    ) return false;
    this.player.reloadRemaining = this.config.weapon.reloadTime;
    this.events.push({ type: 'reload-start' });
    return true;
  }

  tryUseAbility(id) {
    const ability = this.config.abilities[id];
    if (this.phase !== 'playing' || !ability || this.abilities[id] > 0) return false;
    this.abilities[id] = ability.cooldown;
    this.events.push({ type: 'ability', id });
    return true;
  }

  damagePlayer(amount) {
    if (this.phase !== 'playing') return 0;
    const damage = finiteNonNegative(amount);
    const previous = this.player.health;
    this.player.health = Math.max(0, previous - damage);
    const applied = previous - this.player.health;
    if (applied > 0) {
      this.player.damageFlash = 0.22;
      this.events.push({ type: 'player-hit', amount: applied });
    }
    if (this.player.health === 0) {
      this.setPhase('defeat');
      this.events.push({ type: 'defeat' });
    }
    return applied;
  }

  defeatEnemy(score = 100) {
    if (this.phase !== 'playing' || this.wave.active <= 0) return false;
    this.wave.active -= 1;
    this.wave.defeated += 1;
    this.wave.score += Math.round(finiteNonNegative(score));
    this.events.push({ type: 'enemy-defeated' });
    if (
      this.wave.spawned >= this.wave.target
      && this.wave.defeated >= this.wave.target
      && this.wave.active === 0
      && this.phase === 'playing'
    ) {
      this.setPhase('victory');
      this.events.push({ type: 'victory' });
    }
    return true;
  }

  drainEvents() {
    return this.events.splice(0);
  }

  snapshot() {
    return {
      phase: this.phase,
      elapsed: this.elapsed,
      player: { ...this.player },
      wave: { ...this.wave },
      abilities: { ...this.abilities },
    };
  }
}
