const byId = (id) => document.getElementById(id);

export class ShooterHud {
  constructor() {
    this.loadingScreen = byId('loadingScreen');
    this.loadingLabel = byId('loadingLabel');
    this.loadingFill = byId('loadingFill');
    this.loadingPercent = byId('loadingPercent');
    this.loadingRetry = byId('loadingRetry');
    this.loadingProgress = this.loadingScreen.querySelector('[role="progressbar"]');
    this.startScreen = byId('startScreen');
    this.startButton = byId('startButton');
    this.hud = byId('hud');
    this.pauseScreen = byId('pauseScreen');
    this.pauseButton = byId('pauseButton');
    this.resumeButton = byId('resumeButton');
    this.resultScreen = byId('resultScreen');
    this.resultKicker = byId('resultKicker');
    this.resultTitle = byId('resultTitle');
    this.resultSummary = byId('resultSummary');
    this.restartButton = byId('restartButton');
    this.healthFill = byId('healthFill');
    this.healthText = byId('healthText');
    this.statusText = byId('statusText');
    this.ammoText = byId('ammoText');
    this.objectiveFill = byId('objectiveFill');
    this.objectiveCount = byId('objectiveCount');
    this.crosshair = byId('crosshair');
    this.hitMarker = byId('hitMarker');
    this.damageVignette = byId('damageVignette');
    this.toastElement = byId('toast');
    this.abilitySlots = new Map(
      [...document.querySelectorAll('[data-ability]')]
        .map((slot) => [slot.dataset.ability, slot]),
    );
    this.toastTimer = 0;
  }

  bind(actions) {
    this.startButton.addEventListener('click', actions.start);
    this.loadingRetry.addEventListener('click', actions.retry);
    this.pauseButton.addEventListener('click', actions.pause);
    this.resumeButton.addEventListener('click', actions.resume);
    this.restartButton.addEventListener('click', actions.restart);
  }

  setLoading(progress, label = '正在整理战场素材') {
    const value = Math.max(0, Math.min(1, Number(progress) || 0));
    const percent = Math.round(value * 100);
    this.loadingLabel.textContent = label;
    this.loadingFill.style.width = `${percent}%`;
    this.loadingPercent.textContent = `${percent}%`;
    this.loadingProgress.setAttribute('aria-valuenow', String(percent));
  }

  setLoadingError(message) {
    this.loadingLabel.textContent = message;
    this.loadingRetry.hidden = false;
  }

  showStart() {
    this.loadingScreen.hidden = true;
    this.startScreen.hidden = false;
    this.hud.hidden = true;
    this.pauseScreen.hidden = true;
    this.resultScreen.hidden = true;
  }

  showGame() {
    this.loadingScreen.hidden = true;
    this.startScreen.hidden = true;
    this.pauseScreen.hidden = true;
    this.resultScreen.hidden = true;
    this.hud.hidden = false;
  }

  showPause() {
    this.pauseScreen.hidden = false;
  }

  hidePause() {
    this.pauseScreen.hidden = true;
  }

  showResult(snapshot) {
    const victory = snapshot.phase === 'victory';
    this.hud.hidden = true;
    this.pauseScreen.hidden = true;
    this.resultScreen.hidden = false;
    this.resultKicker.textContent = victory ? 'CLEAR' : 'RETRY';
    this.resultTitle.textContent = victory ? '花园守住了！' : '防线被突破了';
    this.resultSummary.textContent = `击退 ${snapshot.wave.defeated} 名入侵者 · 得分 ${snapshot.wave.score}`;
  }

  update(snapshot, config) {
    const healthRatio = snapshot.player.health / snapshot.player.maxHealth;
    const waveRatio = snapshot.wave.target > 0 ? snapshot.wave.defeated / snapshot.wave.target : 0;
    this.healthFill.style.width = `${Math.max(0, healthRatio) * 100}%`;
    this.healthText.textContent = String(Math.ceil(snapshot.player.health));
    this.ammoText.textContent = snapshot.player.reloadRemaining > 0 ? '··' : String(snapshot.player.ammo);
    this.objectiveFill.style.width = `${Math.max(0, waveRatio) * 100}%`;
    this.objectiveCount.textContent = `${snapshot.wave.defeated} / ${snapshot.wave.target}`;
    this.statusText.textContent = snapshot.player.reloadRemaining > 0
      ? '正在凝结冰豌豆'
      : healthRatio < 0.32 ? '危险' : '状态良好';
    this.crosshair.classList.toggle('is-reloading', snapshot.player.reloadRemaining > 0);
    this.damageVignette.classList.toggle('is-visible', snapshot.player.damageFlash > 0);

    for (const [id, remaining] of Object.entries(snapshot.abilities)) {
      const slot = this.abilitySlots.get(id);
      if (!slot) continue;
      slot.classList.toggle('is-ready', remaining <= 0);
      const label = slot.querySelector('small');
      if (!label.dataset.name) label.dataset.name = label.textContent;
      label.textContent = remaining > 0 ? `${Math.ceil(remaining)}s` : label.dataset.name;
      slot.style.setProperty('--cooldown', String(remaining / config.abilities[id].cooldown));
    }
  }

  pulseShot() {
    this.crosshair.classList.add('is-hot');
    window.setTimeout(() => this.crosshair.classList.remove('is-hot'), 80);
  }

  pulseHit() {
    this.hitMarker.classList.remove('is-visible');
    void this.hitMarker.offsetWidth;
    this.hitMarker.classList.add('is-visible');
  }

  pulseAbility(id) {
    const slot = this.abilitySlots.get(id);
    if (!slot) return;
    slot.classList.remove('is-pulse');
    void slot.offsetWidth;
    slot.classList.add('is-pulse');
  }

  toast(message, duration = 1.5) {
    this.toastElement.textContent = message;
    this.toastElement.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastElement.hidden = true;
    }, duration * 1000);
  }
}
