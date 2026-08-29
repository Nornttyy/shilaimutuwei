import {
  drawAssetOrFallback,
  drawCore,
  drawMonster,
  drawParticle,
  drawProjectile,
  drawSlime,
} from './draw.js';
import {
  TD_ENEMIES,
  TD_FIELD,
  TD_STAGE_BY_ID,
  TD_STAGES,
  TD_STORAGE_KEY,
  TD_VIEW,
  TOWER_TYPES,
  beginTowerDefenseRun,
  canMergeTowers,
  createTowerDefenseState,
  drawCostForState,
  drawTowerCard,
  fusionOrbitPoint,
  mergeTowers,
  normalizeTowerDefenseProgress,
  placeTowerFromHand,
  replayTowerDefenseRun,
  returnToTowerDefenseMenu,
  serializeTowerDefenseProgress,
  skipTowerDefenseBreak,
  stageForState,
  startNextTowerDefenseWave,
  towerByPad,
  towerRange,
  tutorialTargetForState,
  updateTowerDefense,
} from './tower-defense-core.js';

const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
const TAU = Math.PI * 2;
const MAX_DPR = 2;
const PANEL_X = TD_FIELD.width;
const PANEL_WIDTH = TD_VIEW.width - PANEL_X;
const PAD_RADIUS = 46;
const DRAG_THRESHOLD = 8;

const COLORS = Object.freeze({
  ink: '#273844',
  inkSoft: '#5E7078',
  cream: '#FFF8E9',
  creamDeep: '#F0E2C5',
  white: '#FFFFFF',
  mint: '#64D3A0',
  mintDeep: '#27866B',
  blue: '#69CFE8',
  crystal: '#8878DB',
  coral: '#E36B72',
  gold: '#E5A93F',
  shadow: 'rgba(30, 48, 58, 0.24)',
  disabled: '#A8B0AD',
});

const STAGE_REGION_ASSET = Object.freeze({
  'stage-1': 'region-gel-meadow-field-a',
  'stage-2': 'region-bubble-heath-field-a',
  'stage-3': 'region-crystal-bloom-field-a',
});

const MONSTER_DRAW_TYPE = Object.freeze({
  bug: 'bug',
  windcap: 'mushroom',
  stone: 'stone',
  boss: 'boss',
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pointDistance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
const insideRect = (point, rect) => (
  point.x >= rect.x && point.x <= rect.x + rect.width
  && point.y >= rect.y && point.y <= rect.y + rect.height
);

function roundedPath(ctx, x, y, width, height, radius = 16) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function panel(ctx, rect, {
  fill = COLORS.cream,
  stroke = 'rgba(39, 56, 68, 0.18)',
  lineWidth = 2,
  radius = 18,
  shadow = false,
} = {}) {
  ctx.save();
  if (shadow) {
    ctx.shadowColor = COLORS.shadow;
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 7;
  }
  roundedPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  if (stroke && lineWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

function label(ctx, text, x, y, {
  size = 24,
  color = COLORS.ink,
  align = 'center',
  baseline = 'middle',
  weight = 700,
  alpha = 1,
} = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(String(text), x, y);
  ctx.restore();
}

function button(ctx, rect, text, {
  enabled = true,
  selected = false,
  fill = COLORS.mint,
  color = COLORS.white,
  accent = COLORS.mintDeep,
  size = 23,
} = {}) {
  panel(ctx, rect, {
    fill: enabled ? (selected ? accent : fill) : '#D8DEDA',
    stroke: enabled ? accent : '#ABB5B1',
    lineWidth: selected ? 4 : 2,
    radius: Math.min(20, rect.height / 2),
    shadow: enabled,
  });
  label(ctx, text, rect.x + rect.width / 2, rect.y + rect.height / 2 + 1, {
    size,
    color: enabled ? color : '#7D8985',
    weight: 800,
  });
}

function safeGlobal(name) {
  try {
    return globalThis[name];
  } catch {
    return undefined;
  }
}

function localStorageAdapter(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return null;
  }
  return {
    get(key, fallback = null) {
      try {
        const raw = storage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        storage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
  };
}

function frameScheduler(canvas, options = {}) {
  const runtime = options.runtime || {};
  const request = options.requestAnimationFrame
    || runtime.requestAnimationFrame
    || canvas?.requestAnimationFrame?.bind(canvas)
    || safeGlobal('requestAnimationFrame')?.bind(globalThis);
  const cancel = options.cancelAnimationFrame
    || runtime.cancelAnimationFrame
    || canvas?.cancelAnimationFrame?.bind(canvas)
    || safeGlobal('cancelAnimationFrame')?.bind(globalThis);
  if (typeof request === 'function') {
    return {
      request: (callback) => request(callback),
      cancel: (id) => {
        if (id != null && typeof cancel === 'function') cancel(id);
      },
    };
  }
  const schedule = safeGlobal('setTimeout');
  const unschedule = safeGlobal('clearTimeout');
  if (typeof schedule === 'function') {
    return {
      request: (callback) => schedule(() => callback(Date.now()), 16),
      cancel: (id) => {
        if (id != null && typeof unschedule === 'function') unschedule(id);
      },
    };
  }
  return { request: () => null, cancel: () => {} };
}

function canvasRect(canvas) {
  let rect = null;
  try {
    rect = canvas?.getBoundingClientRect?.();
  } catch {
    rect = null;
  }
  const width = Number(rect?.width ?? canvas?.clientWidth ?? canvas?.width) || TD_VIEW.width;
  const height = Number(rect?.height ?? canvas?.clientHeight ?? canvas?.height) || TD_VIEW.height;
  return {
    left: Number(rect?.left) || 0,
    top: Number(rect?.top) || 0,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

export class TowerDefenseGame {
  constructor(canvas, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new TypeError('TowerDefenseGame requires a Canvas-like object.');
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('TowerDefenseGame requires a 2D canvas context.');
    this.options = options;
    this.runtime = options.runtime || null;
    this.assetStore = null;
    this.rigAssetStore = null;
    this.generatedCharacterArtEnabled = options.generatedCharacterArtEnabled !== false;
    this.setAssetStore(options.assetStore);
    this.setRigAssetStore(
      typeof options?.get === 'function' ? options : options.rigAssetStore,
    );

    this.storage = this.runtime?.storage
      && typeof this.runtime.storage.get === 'function'
      && typeof this.runtime.storage.set === 'function'
      ? this.runtime.storage
      : localStorageAdapter(options.storage || safeGlobal('localStorage'));
    const progress = this.loadProgress();
    this.state = createTowerDefenseState({
      progress,
      seed: Number.isFinite(Number(options.seed)) ? Number(options.seed) : Date.now(),
    });

    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.pixelRatio = 1;
    this.cssWidth = TD_VIEW.width;
    this.cssHeight = TD_VIEW.height;
    this.hits = [];
    this.drag = null;
    this.selectedCardUid = null;
    this.hoverPoint = null;
    this.shake = 0;
    this.eventCursor = 0;
    this.running = false;
    this.backgrounded = false;
    this.frameId = null;
    this.lastTimestamp = 0;
    this.scheduler = frameScheduler(canvas, options);

    this.boundPointerDown = (event) => this.handlePointerDown(event);
    this.boundPointerMove = (event) => this.handlePointerMove(event);
    this.boundPointerUp = (event) => this.handlePointerUp(event);
    this.boundPointerCancel = () => this.cancelInteraction();
    this.bindInput();
    this.resize();
  }

  setAssetStore(store = null) {
    this.assetStore = store
      && typeof store.get === 'function'
      && typeof store.useOrFallback === 'function'
      ? store
      : null;
    return this;
  }

  setRigAssetStore(store = null) {
    this.rigAssetStore = store && typeof store.get === 'function' ? store : null;
    return this;
  }

  setGeneratedCharacterArtEnabled(enabled = true) {
    this.generatedCharacterArtEnabled = enabled !== false;
    return this;
  }

  rigAsset(ownerId) {
    return this.rigAssetStore?.get(ownerId, null) ?? null;
  }

  loadProgress() {
    try {
      return normalizeTowerDefenseProgress(this.storage?.get(TD_STORAGE_KEY, {}) || {});
    } catch {
      return normalizeTowerDefenseProgress({});
    }
  }

  save() {
    try {
      const progress = serializeTowerDefenseProgress(this.state);
      return this.storage?.set(TD_STORAGE_KEY, progress) ?? false;
    } catch {
      return false;
    }
  }

  bindInput() {
    if (typeof this.canvas.addEventListener !== 'function') return;
    this.canvas.addEventListener('pointerdown', this.boundPointerDown, { passive: false });
    this.canvas.addEventListener('pointermove', this.boundPointerMove, { passive: false });
    this.canvas.addEventListener('pointerup', this.boundPointerUp, { passive: false });
    this.canvas.addEventListener('pointercancel', this.boundPointerCancel, { passive: true });
    this.canvas.addEventListener('contextmenu', (event) => event?.preventDefault?.());
  }

  resize(sizeHint = null) {
    const rect = canvasRect(this.canvas);
    const hintedWidth = Number(sizeHint?.width);
    const hintedHeight = Number(sizeHint?.height);
    this.cssWidth = Number.isFinite(hintedWidth) && hintedWidth > 0 ? hintedWidth : rect.width;
    this.cssHeight = Number.isFinite(hintedHeight) && hintedHeight > 0 ? hintedHeight : rect.height;
    const hintedDpr = Number(sizeHint?.pixelRatio ?? this.options.pixelRatio);
    const globalDpr = Number(safeGlobal('devicePixelRatio'));
    this.pixelRatio = clamp(
      Number.isFinite(hintedDpr) && hintedDpr > 0
        ? hintedDpr
        : Number.isFinite(globalDpr) && globalDpr > 0 ? globalDpr : 1,
      1,
      MAX_DPR,
    );
    this.canvas.width = Math.max(1, Math.round(this.cssWidth * this.pixelRatio));
    this.canvas.height = Math.max(1, Math.round(this.cssHeight * this.pixelRatio));
    this.scale = Math.max(0.01, Math.min(
      this.cssWidth / TD_VIEW.width,
      this.cssHeight / TD_VIEW.height,
    ));
    this.offsetX = (this.cssWidth - TD_VIEW.width * this.scale) / 2;
    this.offsetY = (this.cssHeight - TD_VIEW.height * this.scale) / 2;
    this.render();
    return this;
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this.lastTimestamp = 0;
    this.scheduleFrame();
    return this;
  }

  scheduleFrame() {
    if (!this.running || this.backgrounded || this.frameId != null) return;
    this.frameId = this.scheduler.request((timestamp) => {
      this.frameId = null;
      this.frame(timestamp);
    });
  }

  frame(timestamp) {
    if (!this.running || this.backgrounded) return;
    const now = Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now();
    const dt = this.lastTimestamp > 0
      ? clamp((now - this.lastTimestamp) / 1000, 0, 0.05)
      : 0;
    this.lastTimestamp = now;
    updateTowerDefense(this.state, dt);
    this.processEvents();
    this.shake = Math.max(0, this.shake - dt * 22);
    this.render();
    this.scheduleFrame();
  }

  processEvents() {
    const events = this.state.events.splice(0);
    this.eventCursor = 0;
    for (const event of events) {
      if (event.type === 'core-hit') this.shake = Math.min(10, this.shake + 5);
      if (event.type === 'run-end' || event.type === 'tutorial-complete') this.save();
    }
  }

  onBackground() {
    this.backgrounded = true;
    this.lastTimestamp = 0;
    this.scheduler.cancel(this.frameId);
    this.frameId = null;
    this.cancelInteraction();
    this.save();
    return this;
  }

  onForeground() {
    this.backgrounded = false;
    this.lastTimestamp = 0;
    this.render();
    this.scheduleFrame();
    return this;
  }

  stop() {
    this.running = false;
    this.scheduler.cancel(this.frameId);
    this.frameId = null;
    this.lastTimestamp = 0;
    return this;
  }

  dispose() {
    this.stop();
    this.save();
    this.canvas.removeEventListener?.('pointerdown', this.boundPointerDown);
    this.canvas.removeEventListener?.('pointermove', this.boundPointerMove);
    this.canvas.removeEventListener?.('pointerup', this.boundPointerUp);
    this.canvas.removeEventListener?.('pointercancel', this.boundPointerCancel);
    this.cancelInteraction();
  }

  toGamePoint(eventOrPoint) {
    if (eventOrPoint && Number.isFinite(eventOrPoint.gameX) && Number.isFinite(eventOrPoint.gameY)) {
      return { x: eventOrPoint.gameX, y: eventOrPoint.gameY };
    }
    const rect = canvasRect(this.canvas);
    const touch = eventOrPoint?.changedTouches?.[0] || eventOrPoint?.touches?.[0];
    const clientX = Number(touch?.clientX ?? touch?.pageX ?? eventOrPoint?.clientX ?? eventOrPoint?.x);
    const clientY = Number(touch?.clientY ?? touch?.pageY ?? eventOrPoint?.clientY ?? eventOrPoint?.y);
    return {
      x: (clientX - rect.left - this.offsetX) / this.scale,
      y: (clientY - rect.top - this.offsetY) / this.scale,
    };
  }

  hitAt(point, predicate = null) {
    for (let index = this.hits.length - 1; index >= 0; index -= 1) {
      const hit = this.hits[index];
      if (hit.enabled === false || !insideRect(point, hit)) continue;
      if (!predicate || predicate(hit)) return hit;
    }
    return null;
  }

  addHit(id, rect, action, data = {}, enabled = true) {
    this.hits.push({ id, ...rect, action, data, enabled });
  }

  tutorialAllows(hit) {
    const target = tutorialTargetForState(this.state);
    if (!target || this.state.screen === 'result') return true;
    if (!hit) return false;
    if (target.type === 'stage') {
      return hit.action === 'stage' && hit.data.stageIndex === target.stageIndex;
    }
    if (target.type === 'draw') return hit.action === 'draw';
    if (target.type === 'pad') {
      return hit.action === 'card'
        || (hit.action === 'pad' && hit.data.padIndex === target.padIndex);
    }
    if (target.type === 'fusion') return hit.action === 'tower';
    if (target.type === 'start') return hit.action === 'start-wave';
    return true;
  }

  handlePointerDown(event) {
    event?.preventDefault?.();
    const point = this.toGamePoint(event);
    const hit = this.hitAt(point);
    if (!this.tutorialAllows(hit)) return;
    this.hoverPoint = point;
    if (hit?.action === 'card') {
      this.drag = {
        kind: 'card', uid: hit.data.cardUid, start: point, point, moved: false,
      };
    } else if (hit?.action === 'tower') {
      this.drag = {
        kind: 'tower', uid: hit.data.towerUid, start: point, point, moved: false,
      };
    } else {
      this.drag = { kind: 'tap', hit, start: point, point, moved: false };
    }
    this.canvas.setPointerCapture?.(event?.pointerId);
  }

  handlePointerMove(event) {
    event?.preventDefault?.();
    const point = this.toGamePoint(event);
    this.hoverPoint = point;
    if (!this.drag) return;
    this.drag.point = point;
    if (pointDistance(point, this.drag.start) >= DRAG_THRESHOLD) this.drag.moved = true;
  }

  handlePointerUp(event) {
    event?.preventDefault?.();
    const point = this.toGamePoint(event);
    const drag = this.drag;
    this.drag = null;
    this.canvas.releasePointerCapture?.(event?.pointerId);
    if (!drag) return;

    if (drag.kind === 'card') {
      const padHit = this.hitAt(point, (hit) => hit.action === 'pad');
      if (drag.moved && padHit && this.tutorialAllows(padHit)) {
        this.placeCard(drag.uid, padHit.data.padIndex);
      } else {
        this.selectCard(drag.uid);
      }
      return;
    }
    if (drag.kind === 'tower') {
      const towerHit = this.hitAt(point, (hit) => hit.action === 'tower');
      if (drag.moved && towerHit && towerHit.data.towerUid !== drag.uid) {
        this.tryMerge(drag.uid, towerHit.data.towerUid);
      } else {
        this.selectOrMergeTower(drag.uid);
      }
      return;
    }
    if (!drag.moved && drag.hit && this.tutorialAllows(drag.hit)) this.activateHit(drag.hit);
  }

  cancelInteraction() {
    this.drag = null;
    this.hoverPoint = null;
  }

  selectCard(cardUid) {
    if (!this.state.hand.some((card) => card.uid === cardUid)) return;
    this.selectedCardUid = this.selectedCardUid === cardUid ? null : cardUid;
    this.state.selectedTowerUid = null;
  }

  placeCard(cardUid, padIndex) {
    const tower = placeTowerFromHand(this.state, cardUid, padIndex);
    if (!tower) return false;
    this.selectedCardUid = null;
    this.state.selectedTowerUid = tower.uid;
    return true;
  }

  tryMerge(sourceUid, targetUid) {
    const merged = mergeTowers(this.state, sourceUid, targetUid);
    if (!merged) {
      this.state.selectedTowerUid = targetUid;
      return false;
    }
    this.state.selectedTowerUid = merged.uid;
    return true;
  }

  selectOrMergeTower(towerUid) {
    const selected = this.state.selectedTowerUid;
    this.selectedCardUid = null;
    if (selected && selected !== towerUid) {
      const source = this.state.towers.find((tower) => tower.uid === selected);
      const target = this.state.towers.find((tower) => tower.uid === towerUid);
      if (canMergeTowers(source, target)) {
        this.tryMerge(selected, towerUid);
        return;
      }
    }
    this.state.selectedTowerUid = selected === towerUid ? null : towerUid;
  }

  activateHit(hit) {
    switch (hit.action) {
      case 'stage':
        if (beginTowerDefenseRun(this.state, {
          mode: 'stage', stageId: hit.data.stageId,
        })) {
          this.selectedCardUid = null;
          this.eventCursor = 0;
        }
        break;
      case 'endless':
        if (this.endlessUnlocked()) {
          beginTowerDefenseRun(this.state, { mode: 'endless', stageId: 'stage-3' });
          this.selectedCardUid = null;
          this.eventCursor = 0;
        }
        break;
      case 'draw': {
        const card = drawTowerCard(this.state);
        if (card) this.selectedCardUid = card.uid;
        break;
      }
      case 'pad':
        if (this.selectedCardUid) this.placeCard(this.selectedCardUid, hit.data.padIndex);
        else {
          const tower = towerByPad(this.state, hit.data.padIndex);
          if (tower) this.selectOrMergeTower(tower.uid);
        }
        break;
      case 'tower':
        this.selectOrMergeTower(hit.data.towerUid);
        break;
      case 'start-wave':
        if (this.state.waveBreak > 0) skipTowerDefenseBreak(this.state);
        else startNextTowerDefenseWave(this.state);
        this.processEvents();
        break;
      case 'battle-menu':
        returnToTowerDefenseMenu(this.state);
        this.selectedCardUid = null;
        this.save();
        break;
      case 'replay':
        replayTowerDefenseRun(this.state);
        this.selectedCardUid = null;
        this.eventCursor = 0;
        break;
      case 'result-menu':
        returnToTowerDefenseMenu(this.state);
        this.selectedCardUid = null;
        this.save();
        break;
      case 'next-stage': {
        const stage = stageForState(this.state);
        const next = TD_STAGES[stage.index];
        if (next) beginTowerDefenseRun(this.state, { mode: 'stage', stageId: next.id });
        else returnToTowerDefenseMenu(this.state);
        this.selectedCardUid = null;
        this.eventCursor = 0;
        break;
      }
      default:
        break;
    }
  }

  endlessUnlocked() {
    return this.state.progress.clearedStages.includes('stage-3');
  }

  resetTransform() {
    const ctx = this.ctx;
    if (typeof ctx.setTransform === 'function') {
      ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    } else if (typeof ctx.resetTransform === 'function') {
      ctx.resetTransform();
      ctx.scale(this.pixelRatio, this.pixelRatio);
    }
  }

  render() {
    const ctx = this.ctx;
    this.hits = [];
    this.resetTransform();
    ctx.save();
    ctx.fillStyle = '#D9EEE2';
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    if (this.state.screen === 'menu') this.drawMenu(ctx);
    else if (this.state.screen === 'result') this.drawResult(ctx);
    else this.drawBattle(ctx);
    if (this.state.tutorial.active) this.drawTutorial(ctx);
    ctx.restore();
    return this;
  }

  drawBackdrop(ctx, stageId = 'stage-1') {
    const background = ctx.createLinearGradient(0, 0, TD_VIEW.width, TD_VIEW.height);
    background.addColorStop(0, '#C7EAD4');
    background.addColorStop(0.52, '#E9E7C5');
    background.addColorStop(1, '#BBDDE4');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    const key = STAGE_REGION_ASSET[stageId] || STAGE_REGION_ASSET['stage-1'];
    drawAssetOrFallback(ctx, this.assetStore, key, (asset) => {
      ctx.globalAlpha *= 0.72;
      ctx.drawImage(asset, -70, -40, 1080, 810);
    }, () => {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#55AE80';
      for (let index = 0; index < 22; index += 1) {
        const x = (index * 173) % 960;
        const y = (index * 97) % 720;
        ctx.beginPath();
        ctx.arc(x, y, 22 + (index % 4) * 8, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  drawMenu(ctx) {
    this.drawBackdrop(ctx, 'stage-1');
    ctx.save();
    ctx.fillStyle = 'rgba(255, 251, 237, 0.68)';
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    ctx.restore();

    label(ctx, '史莱姆融合塔防', TD_VIEW.width / 2, 82, {
      size: 48, color: COLORS.ink, weight: 900,
    });
    label(ctx, '抽取 · 放置 · 融合', TD_VIEW.width / 2, 132, {
      size: 21, color: COLORS.inkSoft, weight: 650,
    });

    const portraits = Object.values(TOWER_TYPES);
    portraits.forEach((tower, index) => {
      const x = 505 + index * 90;
      drawSlime(ctx, x, 245, 78, tower.id, {
        time: this.state.time + index * 0.22,
        facing: index < 2 ? 1 : -1,
        assetStore: this.assetStore,
        rigAsset: this.rigAsset(tower.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
    });

    const stageRects = TD_STAGES.map((stage, index) => ({
      x: 64 + index * 300, y: 340, width: 260, height: 236,
    }));
    const endlessRect = { x: 964, y: 340, width: 252, height: 236 };

    TD_STAGES.forEach((stage, index) => {
      const rect = stageRects[index];
      const unlocked = stage.index <= this.state.progress.unlockedStage;
      const cleared = this.state.progress.clearedStages.includes(stage.id);
      panel(ctx, rect, {
        fill: unlocked ? '#FFF9E9' : '#D9DFDA',
        stroke: unlocked ? stage.accent : '#AAB4AF',
        lineWidth: 4,
        radius: 26,
        shadow: unlocked,
      });
      drawAssetOrFallback(ctx, this.assetStore, 'expedition-route-combat', (asset) => {
        ctx.globalAlpha *= unlocked ? 0.86 : 0.32;
        ctx.drawImage(asset, rect.x + 70, rect.y + 24, 120, 104);
      }, () => {
        ctx.save();
        ctx.globalAlpha = unlocked ? 0.26 : 0.12;
        ctx.fillStyle = stage.accent;
        ctx.beginPath();
        ctx.arc(rect.x + rect.width / 2, rect.y + 76, 48, 0, TAU);
        ctx.fill();
        ctx.restore();
      });
      label(ctx, unlocked ? stage.index : '锁', rect.x + rect.width / 2, rect.y + 78, {
        size: unlocked ? 40 : 30,
        color: unlocked ? stage.accent : '#7E8A85',
        weight: 900,
      });
      label(ctx, stage.name, rect.x + rect.width / 2, rect.y + 147, {
        size: 27, color: unlocked ? COLORS.ink : '#7E8A85', weight: 850,
      });
      label(ctx, cleared ? '✓' : `${stage.waves.length}波`, rect.x + rect.width / 2, rect.y + 194, {
        size: cleared ? 28 : 18,
        color: cleared ? COLORS.mintDeep : COLORS.inkSoft,
        weight: 800,
      });
      this.addHit(`stage-${stage.index}`, rect, 'stage', {
        stageId: stage.id, stageIndex: index,
      }, unlocked);
    });

    const endlessUnlocked = this.endlessUnlocked();
    panel(ctx, endlessRect, {
      fill: endlessUnlocked ? '#F8F2FF' : '#D9DFDA',
      stroke: endlessUnlocked ? COLORS.crystal : '#AAB4AF',
      lineWidth: 4,
      radius: 26,
      shadow: endlessUnlocked,
    });
    drawAssetOrFallback(ctx, this.assetStore, 'expedition-route-boss', (asset) => {
      ctx.globalAlpha *= endlessUnlocked ? 0.88 : 0.3;
      ctx.drawImage(asset, endlessRect.x + 66, endlessRect.y + 24, 120, 104);
    }, () => {});
    label(ctx, endlessUnlocked ? '∞' : '锁', endlessRect.x + endlessRect.width / 2, endlessRect.y + 78, {
      size: endlessUnlocked ? 48 : 30,
      color: endlessUnlocked ? COLORS.crystal : '#7E8A85',
      weight: 900,
    });
    label(ctx, '无尽', endlessRect.x + endlessRect.width / 2, endlessRect.y + 147, {
      size: 27, color: endlessUnlocked ? COLORS.ink : '#7E8A85', weight: 850,
    });
    label(ctx, endlessUnlocked ? `最高 ${this.state.progress.bestEndlessWave}` : '通关3解锁',
      endlessRect.x + endlessRect.width / 2, endlessRect.y + 194, {
        size: 18, color: COLORS.inkSoft, weight: 750,
      });
    this.addHit('endless', endlessRect, 'endless', {}, endlessUnlocked);
  }

  drawBattle(ctx) {
    const stage = stageForState(this.state);
    ctx.save();
    if (this.shake > 0) {
      ctx.translate(
        Math.sin(this.state.time * 62) * this.shake,
        Math.cos(this.state.time * 47) * this.shake * 0.55,
      );
    }
    this.drawBattlefield(ctx, stage);
    ctx.restore();
    this.drawSidebar(ctx, stage);
    this.drawDragPreview(ctx);
  }

  drawBattlefield(ctx, stage) {
    this.drawBackdrop(ctx, stage.id);
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,245,0.14)';
    ctx.fillRect(0, 0, TD_FIELD.width, TD_FIELD.height);
    ctx.restore();

    label(ctx, this.state.mode === 'endless' ? '无尽' : stage.name, 30, 28, {
      size: 24, align: 'left', color: COLORS.ink, weight: 900,
    });
    this.drawPath(ctx, stage.path);

    const start = stage.path[0];
    drawParticle(ctx, start.x, start.y - 4, 45, 'ring', {
      time: this.state.time,
      progress: (this.state.time * 0.35) % 1,
      alpha: 0.45,
      color: COLORS.crystal,
      assetStore: this.assetStore,
    });

    const end = stage.path.at(-1);
    drawCore(ctx, Math.min(TD_FIELD.width - 28, end.x + 28), end.y + 18, 96, {
      health: this.state.coreHp / Math.max(1, this.state.coreMaxHp),
      time: this.state.time,
      hit: this.shake > 0 ? 1 : 0,
      assetStore: this.assetStore,
    });

    if (this.state.selectedTowerUid) {
      const selected = this.state.towers.find((tower) => tower.uid === this.state.selectedTowerUid);
      const pad = selected && stage.pads[selected.padIndex];
      if (selected && pad) {
        ctx.save();
        ctx.globalAlpha = 0.11;
        ctx.fillStyle = TOWER_TYPES[selected.type].color;
        ctx.beginPath();
        ctx.arc(pad.x, pad.y, towerRange(this.state, selected), 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = TOWER_TYPES[selected.type].color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }

    stage.pads.forEach((pad, padIndex) => this.drawPad(ctx, pad, padIndex));
    [...this.state.enemies]
      .sort((left, right) => left.y - right.y || left.travelled - right.travelled)
      .forEach((enemy) => this.drawEnemy(ctx, enemy));
    this.state.projectiles.forEach((projectile) => this.drawShot(ctx, projectile));
    this.drawEffects(ctx);
  }

  drawPath(ctx, points) {
    for (let index = 1; index < points.length; index += 1) {
      const left = points[index - 1];
      const right = points[index];
      const dx = right.x - left.x;
      const dy = right.y - left.y;
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      drawAssetOrFallback(ctx, this.assetStore, 'tile-route-open', (asset) => {
        ctx.translate((left.x + right.x) / 2, (left.y + right.y) / 2);
        ctx.rotate(angle);
        ctx.globalAlpha *= 0.72;
        ctx.drawImage(asset, -length / 2 - 8, -20, length + 16, 40);
      }, () => {
        ctx.save();
        ctx.strokeStyle = 'rgba(76, 143, 105, 0.38)';
        ctx.lineWidth = 28;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 226, 0.62)';
        ctx.lineWidth = 4;
        ctx.setLineDash?.([11, 12]);
        ctx.stroke();
        ctx.restore();
      });
    }
  }

  drawPad(ctx, pad, padIndex) {
    const tower = towerByPad(this.state, padIndex);
    const target = tutorialTargetForState(this.state);
    const tutorialPad = target?.type === 'pad' && target.padIndex === padIndex;
    ctx.save();
    ctx.globalAlpha = tower ? 0.34 : tutorialPad ? 0.72 : 0.48;
    ctx.fillStyle = tower ? '#D8F2DC' : '#FFF8DA';
    ctx.strokeStyle = tutorialPad ? COLORS.gold : '#668B78';
    ctx.lineWidth = tutorialPad ? 5 : 2.5;
    ctx.beginPath();
    ctx.ellipse(pad.x, pad.y + 4, PAD_RADIUS, PAD_RADIUS * 0.48, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    this.addHit(`pad-${padIndex}`, {
      x: pad.x - PAD_RADIUS, y: pad.y - PAD_RADIUS,
      width: PAD_RADIUS * 2, height: PAD_RADIUS * 2,
    }, 'pad', { padIndex });

    if (!tower) return;
    const definition = TOWER_TYPES[tower.type];
    const selected = tower.uid === this.state.selectedTowerUid;
    drawSlime(ctx, pad.x, pad.y + 6, 88 + tower.star * 2, tower.type, {
      time: this.state.time,
      phase: padIndex * 0.41,
      facing: Math.cos(tower.aimAngle || 0) >= 0 ? 1 : -1,
      hop: tower.attackPulse * 0.08,
      squash: -tower.attackPulse * 0.08,
      selected,
      assetStore: this.assetStore,
      rigAsset: this.rigAsset(definition.ownerId),
      allowGeneratedStandalone: this.generatedCharacterArtEnabled,
    });
    this.drawStars(ctx, pad.x, pad.y - 78, tower.star, definition.color);
    this.addHit(`tower-${tower.uid}`, {
      x: pad.x - PAD_RADIUS, y: pad.y - 82,
      width: PAD_RADIUS * 2, height: 96,
    }, 'tower', { towerUid: tower.uid, padIndex });
  }

  drawStars(ctx, x, y, count, color) {
    const gap = 13;
    const startX = x - (count - 1) * gap / 2;
    for (let index = 0; index < count; index += 1) {
      ctx.save();
      ctx.translate(startX + index * gap, y);
      ctx.fillStyle = color;
      ctx.strokeStyle = COLORS.white;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let point = 0; point < 10; point += 1) {
        const angle = -Math.PI / 2 + point * Math.PI / 5;
        const radius = point % 2 === 0 ? 7 : 3.2;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (point === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  drawEnemy(ctx, enemy) {
    const definition = TD_ENEMIES[enemy.type] || TD_ENEMIES.bug;
    const type = MONSTER_DRAW_TYPE[enemy.type] || 'bug';
    drawMonster(ctx, enemy.x, enemy.y + definition.size * 0.33, definition.size, type, {
      time: this.state.time,
      phase: Number(enemy.uid.split('-').at(-1)) * 0.31 || 0,
      facing: enemy.facing,
      hit: enemy.hitPulse,
      expression: enemy.hitPulse > 0.35 ? 'hurt' : 'normal',
      assetStore: this.assetStore,
      rigAsset: this.rigAsset(definition.ownerId),
      allowGeneratedStandalone: this.generatedCharacterArtEnabled,
    });
    const width = definition.boss ? 82 : 52;
    const ratio = clamp(enemy.hp / Math.max(1, enemy.maxHp), 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(38,51,60,0.56)';
    roundedPath(ctx, enemy.x - width / 2, enemy.y - definition.size * 0.72, width, 7, 4);
    ctx.fill();
    if (ratio > 0) {
      ctx.fillStyle = ratio < 0.3 ? COLORS.coral : '#74CF7A';
      roundedPath(ctx, enemy.x - width / 2 + 1, enemy.y - definition.size * 0.72 + 1,
        Math.max(2, (width - 2) * ratio), 5, 3);
      ctx.fill();
    }
    ctx.restore();
  }

  drawShot(ctx, projectile) {
    const angle = Math.atan2(projectile.targetY - projectile.y, projectile.targetX - projectile.x);
    drawProjectile(ctx, projectile.x, projectile.y, projectile.type === 'needle' ? 19 : 16,
      projectile.type, {
        angle,
        progress: clamp(projectile.age / 1.2, 0, 1),
        assetStore: this.assetStore,
      });
  }

  drawEffects(ctx) {
    for (const effect of this.state.effects) {
      const progress = clamp(effect.phase ?? effect.age / effect.duration, 0, 1);
      if (effect.type === 'merge') {
        for (let index = 0; index < 4; index += 1) {
          const orbit = fusionOrbitPoint(effect, index * TAU / 4);
          drawParticle(ctx, orbit.x, orbit.y, 18, index % 2 ? 'spark' : 'goo', {
            progress,
            alpha: 1 - progress * 0.72,
            assetStore: this.assetStore,
          });
        }
        drawParticle(ctx, effect.x, effect.y - 22, 48, 'ring', {
          progress,
          alpha: 1 - progress,
          assetStore: this.assetStore,
        });
        continue;
      }
      const type = {
        summon: 'goo', place: 'ring', spawn: 'ring', defeat: 'dust',
        hit: 'spark', 'bubble-hit': 'bubble', 'leaf-hit': 'leaf', 'core-hit': 'spark',
      }[effect.type] || 'spark';
      const size = effect.type === 'defeat' ? 44 : effect.type === 'spawn' ? 36 : 27;
      drawParticle(ctx, effect.x, effect.y, size, type, {
        progress,
        alpha: 1 - progress * 0.78,
        rotation: progress * 1.6,
        assetStore: this.assetStore,
      });
    }
  }

  drawSidebar(ctx, stage) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 249, 232, 0.96)';
    ctx.fillRect(PANEL_X, 0, PANEL_WIDTH, TD_VIEW.height);
    ctx.fillStyle = stage.accent;
    ctx.fillRect(PANEL_X, 0, 8, TD_VIEW.height);
    ctx.restore();

    const backRect = { x: 950, y: 18, width: 54, height: 48 };
    button(ctx, backRect, '‹', {
      fill: '#EEF2E9', color: COLORS.ink, accent: '#AAB8AE', size: 34,
    });
    this.addHit('battle-menu', backRect, 'battle-menu');

    const modeText = this.state.mode === 'endless'
      ? `∞ ${this.state.wave}`
      : `${this.state.wave}/${stage.waves.length}`;
    label(ctx, modeText, 1068, 42, { size: 24, color: COLORS.ink, weight: 900 });

    drawAssetOrFallback(ctx, this.assetStore, 'ui-gel-energy', (asset) => {
      ctx.drawImage(asset, 1172, 18, 48, 48);
    }, () => {
      ctx.fillStyle = COLORS.mint;
      ctx.beginPath();
      ctx.arc(1196, 42, 18, 0, TAU);
      ctx.fill();
    });
    label(ctx, this.state.currency, 1260, 43, {
      size: 21, align: 'right', color: COLORS.ink, weight: 850,
    });

    const hpRatio = clamp(this.state.coreHp / Math.max(1, this.state.coreMaxHp), 0, 1);
    panel(ctx, { x: 952, y: 82, width: 306, height: 50 }, {
      fill: '#E7E3D2', stroke: '#C9BEA4', radius: 16,
    });
    ctx.save();
    roundedPath(ctx, 958, 88, 294 * hpRatio, 38, 12);
    ctx.fillStyle = hpRatio < 0.3 ? COLORS.coral : COLORS.mint;
    ctx.fill();
    ctx.restore();
    label(ctx, `核心 ${this.state.coreHp}`, 1105, 107, {
      size: 18, color: COLORS.ink, weight: 850,
    });

    label(ctx, '卡牌', 958, 158, {
      size: 17, align: 'left', color: COLORS.inkSoft, weight: 800,
    });
    const cardRects = [];
    for (let index = 0; index < 4; index += 1) {
      const rect = { x: 950, y: 174 + index * 88, width: 310, height: 76 };
      cardRects.push(rect);
      const card = this.state.hand[index];
      if (!card) {
        panel(ctx, rect, {
          fill: 'rgba(232, 229, 213, 0.62)',
          stroke: 'rgba(100, 115, 111, 0.22)', radius: 16,
        });
        continue;
      }
      this.drawHandCard(ctx, card, rect, card.uid === this.selectedCardUid);
      this.addHit(`card-${card.uid}`, rect, 'card', { cardUid: card.uid });
    }

    const drawRect = { x: 950, y: 536, width: 310, height: 70 };
    const drawCost = drawCostForState(this.state);
    const canDraw = !this.state.result
      && this.state.hand.length < 4
      && this.state.currency >= drawCost;
    button(ctx, drawRect, `抽取  ${drawCost}`, {
      enabled: canDraw,
      fill: COLORS.mint,
      accent: COLORS.mintDeep,
      size: 24,
    });
    this.addHit('draw', drawRect, 'draw', {}, canDraw);

    const startRect = { x: 950, y: 626, width: 310, height: 70 };
    const canStart = !this.state.waveActive
      && !(this.state.mode === 'stage' && this.state.wave >= stage.waves.length);
    const startText = this.state.waveActive
      ? '战斗中'
      : this.state.waveBreak > 0
        ? `下一波  ${Math.ceil(this.state.waveBreak)}`
        : this.state.wave === 0 ? '开始' : '下一波';
    button(ctx, startRect, startText, {
      enabled: canStart,
      fill: '#F0B84E',
      accent: '#B87728',
      size: 25,
    });
    this.addHit('start-wave', startRect, 'start-wave', {}, canStart);
  }

  drawHandCard(ctx, card, rect, selected) {
    const definition = TOWER_TYPES[card.type];
    panel(ctx, rect, {
      fill: selected ? '#ECFFF3' : '#FFF9E9',
      stroke: selected ? COLORS.mintDeep : '#A8B7A8',
      lineWidth: selected ? 4 : 2,
      radius: 16,
      shadow: selected,
    });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-card-frame-common', (asset) => {
      ctx.globalAlpha *= 0.5;
      ctx.drawImage(asset, rect.x, rect.y, rect.width, rect.height);
    }, () => {});
    drawSlime(ctx, rect.x + 48, rect.y + 65, 58, card.type, {
      time: this.state.time,
      facing: 1,
      assetStore: this.assetStore,
      rigAsset: this.rigAsset(definition.ownerId),
      allowGeneratedStandalone: this.generatedCharacterArtEnabled,
    });
    label(ctx, definition.name, rect.x + 92, rect.y + 29, {
      size: 21, align: 'left', color: COLORS.ink, weight: 850,
    });
    label(ctx, '★', rect.x + 94, rect.y + 55, {
      size: 17, align: 'left', color: definition.color, weight: 900,
    });
    label(ctx, '拖到塔位', rect.x + rect.width - 18, rect.y + 53, {
      size: 14, align: 'right', color: COLORS.inkSoft, weight: 650,
    });
  }

  drawDragPreview(ctx) {
    if (!this.drag?.moved || !this.drag.point) return;
    if (this.drag.kind === 'card') {
      const card = this.state.hand.find((candidate) => candidate.uid === this.drag.uid);
      const definition = card && TOWER_TYPES[card.type];
      if (!card || !definition) return;
      ctx.save();
      ctx.globalAlpha = 0.8;
      drawSlime(ctx, this.drag.point.x, this.drag.point.y + 28, 76, card.type, {
        time: this.state.time,
        assetStore: this.assetStore,
        rigAsset: this.rigAsset(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
      ctx.restore();
    }
    if (this.drag.kind === 'tower') {
      const tower = this.state.towers.find((candidate) => candidate.uid === this.drag.uid);
      if (!tower) return;
      ctx.save();
      ctx.strokeStyle = TOWER_TYPES[tower.type].color;
      ctx.lineWidth = 5;
      ctx.setLineDash?.([10, 8]);
      const pad = stageForState(this.state).pads[tower.padIndex];
      ctx.beginPath();
      ctx.moveTo(pad.x, pad.y - 24);
      ctx.lineTo(this.drag.point.x, this.drag.point.y);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawResult(ctx) {
    const stage = stageForState(this.state);
    this.drawBackdrop(ctx, stage.id);
    ctx.save();
    ctx.fillStyle = 'rgba(38, 52, 62, 0.34)';
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    ctx.restore();

    const rect = { x: 365, y: 94, width: 550, height: 532 };
    panel(ctx, rect, {
      fill: '#FFF9EA',
      stroke: this.state.result === 'victory' ? COLORS.mintDeep : COLORS.coral,
      lineWidth: 5,
      radius: 34,
      shadow: true,
    });
    const victory = this.state.result === 'victory';
    label(ctx, victory ? '守住了' : '再来一次', TD_VIEW.width / 2, 174, {
      size: 45,
      color: victory ? COLORS.mintDeep : COLORS.coral,
      weight: 950,
    });

    if (victory) {
      const definition = TOWER_TYPES.shell;
      drawSlime(ctx, TD_VIEW.width / 2, 350, 142, 'shell', {
        time: this.state.time,
        hop: 0.05,
        assetStore: this.assetStore,
        rigAsset: this.rigAsset(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
    } else {
      const definition = TD_ENEMIES.boss;
      drawMonster(ctx, TD_VIEW.width / 2, 365, 142, 'boss', {
        time: this.state.time,
        facing: -1,
        assetStore: this.assetStore,
        rigAsset: this.rigAsset(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
    }
    label(ctx, `波次 ${this.state.wave}   击破 ${this.state.kills}`, TD_VIEW.width / 2, 404, {
      size: 22, color: COLORS.inkSoft, weight: 750,
    });
    if (this.state.mode === 'endless') {
      label(ctx, `最高 ${this.state.progress.bestEndlessWave}`, TD_VIEW.width / 2, 442, {
        size: 20, color: COLORS.crystal, weight: 800,
      });
    }

    const primaryRect = { x: 430, y: 486, width: 260, height: 76 };
    const menuRect = { x: 710, y: 486, width: 140, height: 76 };
    const nextStage = victory && this.state.mode === 'stage' && TD_STAGES[stage.index];
    button(ctx, primaryRect, nextStage ? '下一关' : '再来', {
      fill: victory ? COLORS.mint : '#E99B72',
      accent: victory ? COLORS.mintDeep : '#A95B45',
      size: 26,
    });
    this.addHit('result-primary', primaryRect, nextStage ? 'next-stage' : 'replay');
    button(ctx, menuRect, '关卡', {
      fill: '#EEF1E8', color: COLORS.ink, accent: '#9EADA5', size: 22,
    });
    this.addHit('result-menu', menuRect, 'result-menu');
  }

  tutorialHoles(target) {
    if (!target) return [];
    if (target.type === 'stage') {
      return [{ x: 64 + target.stageIndex * 300 + 130, y: 458, radius: 156 }];
    }
    if (target.type === 'draw') return [{ x: 1105, y: 571, radius: 180 }];
    if (target.type === 'pad') {
      const pad = stageForState(this.state).pads[target.padIndex];
      return pad ? [{ x: pad.x, y: pad.y - 8, radius: 72 }] : [];
    }
    if (target.type === 'fusion') {
      return this.state.towers.slice(0, 2).map((tower) => {
        const pad = stageForState(this.state).pads[tower.padIndex];
        return { x: pad.x, y: pad.y - 18, radius: 72 };
      });
    }
    if (target.type === 'start') return [{ x: 1105, y: 661, radius: 180 }];
    return [];
  }

  drawTutorial(ctx) {
    const target = tutorialTargetForState(this.state);
    if (!target) return;
    const holes = this.tutorialHoles(target);
    ctx.save();
    ctx.fillStyle = 'rgba(22, 34, 42, 0.68)';
    ctx.beginPath();
    ctx.rect(0, 0, TD_VIEW.width, TD_VIEW.height);
    for (const hole of holes) {
      ctx.moveTo(hole.x + hole.radius, hole.y);
      ctx.arc(hole.x, hole.y, hole.radius, 0, TAU, true);
    }
    try {
      ctx.fill('evenodd');
    } catch {
      ctx.fill();
    }
    ctx.restore();

    const pulse = 1 + Math.sin(this.state.time * 5) * 0.045;
    for (const hole of holes) {
      ctx.save();
      ctx.strokeStyle = '#FFE577';
      ctx.lineWidth = 6;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, hole.radius * pulse, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (target.type === 'fusion' && holes.length >= 2) {
      const left = holes[0];
      const right = holes[1];
      ctx.save();
      ctx.strokeStyle = '#FFE577';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(left.x, left.y - 70);
      ctx.lineTo(right.x, right.y - 70);
      ctx.stroke();
      const angle = Math.atan2(right.y - left.y, right.x - left.x);
      ctx.translate(right.x, right.y - 70);
      ctx.rotate(angle);
      ctx.fillStyle = '#FFE577';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-20, -12);
      ctx.lineTo(-20, 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (holes.length) {
      let handX = holes[0].x;
      let handY = holes[0].y;
      let handAngle = -0.08;
      if (target.type === 'fusion' && holes.length >= 2) {
        const travel = (Math.sin(this.state.time * 2.8 - Math.PI / 2) + 1) / 2;
        handX = holes[0].x + (holes[1].x - holes[0].x) * travel;
        handY = holes[0].y + (holes[1].y - holes[0].y) * travel - 4;
        handAngle = Math.atan2(holes[1].y - holes[0].y, holes[1].x - holes[0].x) - 0.08;
      } else {
        handY += Math.sin(this.state.time * 5) * 5;
      }
      drawAssetOrFallback(ctx, this.assetStore, 'ui-tutorial-hand', (asset) => {
        ctx.translate(handX, handY);
        ctx.rotate(handAngle);
        ctx.scale(pulse, pulse);
        ctx.drawImage(asset, -25, -22, 96, 96);
      }, () => {
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#FFF1CB';
        ctx.strokeStyle = COLORS.ink;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(handX + 20, handY + 22, 16, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    }

    const focus = holes[0] || { x: TD_VIEW.width / 2, y: TD_VIEW.height / 2, radius: 70 };
    const text = {
      stage: '1', draw: '抽', pad: '放', fusion: '融', start: '战',
    }[target.type] || target.label;
    const bubbleY = focus.y > 520 ? focus.y - focus.radius - 48 : focus.y + focus.radius + 48;
    panel(ctx, { x: focus.x - 34, y: bubbleY - 27, width: 68, height: 54 }, {
      fill: '#FFE577', stroke: '#9B7425', lineWidth: 3, radius: 20, shadow: true,
    });
    label(ctx, text, focus.x, bubbleY + 1, {
      size: 25, color: COLORS.ink, weight: 950,
    });
  }
}

export const SlimeTowerDefenseGame = TowerDefenseGame;
export default TowerDefenseGame;
