import { TowerDefenseGame } from '../tower-defense-game.js';
import { createPlatformRuntime } from './runtime.js';
import {
  createWechatCanvasSurface,
  installWechatGameGlobals,
} from './wechat-canvas.js';
import { createRigAssetStore } from '../animation/rig-assets.js';

export const MIN_WECHAT_STARTUP_LOADING_MS = 3000;

export const WECHAT_CRITICAL_ASSET_KEYS = Object.freeze([
  'survivor-shell-shell',
  'survivor-crystal-pin',
  'survivor-bubble-float',
  'survivor-moss-sprout',
  'hero-berry-burst-atlas-v1',
  'hero-dew-bloom-atlas-v1',
  'hero-bell-boom-atlas-v1',
  'hero-drill-gum-atlas-v1',
  'hero-ember-fizz-atlas-v1',
  'hero-ink-splash-atlas-v1',
  'hero-cloud-spin-atlas-v1',
  'hero-frost-drop-atlas-v1',
  'hero-honey-pop-atlas-v1',
  'hero-spark-bean-atlas-v1',
  'hero-star-core-atlas-v1',
  'hero-berry-burst-skill-face-v1',
  'hero-dew-bloom-skill-face-v1',
  'hero-bell-boom-skill-face-v1',
  'hero-drill-gum-skill-face-v1',
  'hero-ember-fizz-skill-face-v1',
  'hero-ink-splash-skill-face-v1',
  'hero-cloud-spin-skill-face-v1',
  'hero-frost-drop-skill-face-v1',
  'hero-honey-pop-skill-face-v1',
  'hero-spark-bean-skill-face-v1',
  'hero-star-core-skill-face-v1',
  'soldier-shield-dun-atlas-v1',
  'soldier-bean-bow-atlas-v1',
  'soldier-bounce-hammer-atlas-v1',
  'soldier-leaf-spinner-atlas-v1',
  'soldier-drill-lancer-atlas-v1',
  'soldier-spore-lobber-atlas-v1',
  'soldier-volt-orbiter-atlas-v1',
  'evolution-shell-armor-v3',
  'evolution-needle-armor-v3',
  'evolution-bubble-armor-v3',
  'evolution-sprout-armor-v3',
  'enemy-soft-biter',
  'enemy-windcap',
  'enemy-stone-lump',
  'enemy-acid-shell-king',
  'enemy-thorn-roller-atlas-v1',
  'enemy-lantern-spore-atlas-v1',
  'enemy-mud-bulwark-atlas-v1',
  'enemy-rift-beacon-king-atlas-v1',
  'town-soft-core',
  'fortress-slime-core',
  'rift-entry-portal',
  'building-mushroom-home',
  'building-honey-plot',
  'building-honey-plot-autotile-v3',
  'building-bubble-tower',
  'building-bouncy-fence',
  'building-bouncy-fence-autotile-v3',
  'building-weather-scout',
  'building-gel-foundation',
  'turret-gel-mortar',
  'turret-gel-mount',
  'turret-bubble-coil',
  'turret-crystal-repeater',
  'turret-gale-fan-atlas-v1',
  'turret-spore-bomber-atlas-v1',
  'turret-thunder-prism-atlas-v1',
  'ui-hero-control-ring',
  'ui-hero-joystick-base',
  'ui-hero-joystick-knob',
  'background-menu-portrait-v1',
  'background-battle-portrait-v1',
  'background-cloud-overlay',
  'region-sunbud-sanctuary-field-a',
  'terrain-ground-field-v1',
  'terrain-discovery-fog-cell-v1',
  'terrain-prop-contact-shadow-v1',
  'terrain-soft-gel-node-a',
  'terrain-dew-honey-node-a',
  'terrain-crystal-shard-node-a',
  'terrain-thorn-thicket-a',
  'terrain-brittle-boulder-a',
  'terrain-deep-water-patch-a',
  'terrain-ground-detail-a',
  'resource-soft-gel-token',
  'resource-dew-honey-token',
  'resource-crystal-shard-token',
  'skill-jelly-bounce-icon',
  'skill-honey-line-icon',
  'skill-soft-swap-icon',
  'skill-sprout-renewal-icon',
  'skill-shell-triple-shock-icon',
  'skill-crystal-rain-icon',
  'skill-bubble-tide-domain-icon',
  'skill-sprout-forest-dance-icon',
  'skill-berry-chain-barrage-icon',
  'skill-dew-garland-icon',
  'skill-bell-sonic-ring-icon',
  'skill-drill-rupture-dash-icon',
  'skill-ember-scorch-line-icon',
  'skill-ink-cone-burst-icon',
  'skill-cloud-vortex-icon',
  'skill-frost-shard-lane-icon',
  'skill-honey-cluster-icon',
  'skill-spark-chain-arc-icon',
  'skill-star-orbit-barrage-icon',
  'item-spring-pad-icon',
  'item-lure-jelly-icon',
  'item-moving-bubble-icon',
  'item-spring-pad-world',
  'item-lure-jelly-world',
  'item-moving-bubble-world',
  'status-shield',
  'status-slow',
  'status-heal',
  'status-marked',
  'status-sticky',
  'status-stun',
  'status-bubble',
  'status-poison',
  'tile-honey-puddle',
  'tile-crystal-spikes',
  'tile-building-rubble',
  'tile-placement-valid',
  'tile-placement-invalid',
  'tile-route-open',
  'tile-route-breach',
  'effect-projectile-goo',
  'effect-projectile-needle',
  'effect-projectile-bubble',
  'effect-projectile-seed',
  'effect-projectile-acid',
  'effect-particle-goo-drop',
  'effect-particle-impact-spark',
  'effect-particle-expanding-ring',
  'effect-particle-healing-leaf',
  'effect-particle-bubble',
  'effect-particle-dust-puff',
  'effect-dynamic-components-v1',
  'effect-reinforcement-projectiles-atlas-v1',
  'effect-skill-shell-impact-v1',
  'effect-skill-crystal-laser-emitter-v1',
  'effect-skill-crystal-laser-hit-v1',
  'effect-skill-bubble-orb-v1',
  'effect-skill-bubble-burst-v1',
  'effect-skill-sprout-thorn-v1',
  'effect-skill-berry-bomb-v1',
  'effect-skill-berry-burst-v1',
  'effect-skill-dew-wave-crest-v1',
  'effect-selection-ring-friendly',
  'effect-target-ring-danger',
  'effect-shield-dome',
  'effect-shield-break-v1',
  'effect-spawn-rift-burst',
  'effect-heal-burst',
  'effect-building-destruction-puff',
  'effect-jelly-bounce-wave',
  'effect-soft-swap-arc',
  'effect-boss-acid-telegraph',
  'effect-honey-draw-trail',
  'effect-damage-cracks-overlay',
  'ui-soft-crystal',
  'ui-gel-energy',
  'ui-card-frame-common',
  'ui-card-frame-deploy',
  'ui-card-frame-item',
  'ui-audio-on',
  'ui-audio-off',
  'ui-tutorial-hand',
  'expedition-route-combat',
  'expedition-route-resource',
  'expedition-route-event',
  'expedition-route-boss',
  'expedition-beacon',
  'upgrade-soft-body',
  'upgrade-jelly-rush',
  'upgrade-shared-sparkle',
  'upgrade-shell-rebound',
  'upgrade-crystal-fork',
  'upgrade-bubble-chain',
  'upgrade-sprout-canopy',
  'upgrade-gel-burst',
  'upgrade-last-bounce',
]);

function safeCall(callback, ...args) {
  try {
    return callback?.(...args);
  } catch {
    return undefined;
  }
}

function normalizedHttpsBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const trimmed = value.trim();
  return /^https:\/\/[^/]+/i.test(trimmed) ? trimmed.replace(/\/$/, '') : '';
}

/** Converts project-relative asset paths into CDN URLs understood by wx.Image. */
export function createWechatRemoteAssetPaths(assetBaseUrl, paths = {}) {
  const baseUrl = normalizedHttpsBaseUrl(assetBaseUrl);
  if (!baseUrl) return Object.freeze({});
  return Object.freeze(Object.fromEntries(Object.entries(paths).flatMap(([key, value]) => {
    if (typeof value !== 'string' || !value || value.includes('..')) return [];
    const relative = value.replace(/^\/+/, '');
    return [[key, `${baseUrl}/${relative}`]];
  })));
}

/** Small wx.Image store with strict, retryable preload for formal game art. */
export function createWechatImageAssetStore(paths = {}, {
  wxApi = globalThis.wx,
  timeoutMs = 12000,
} = {}) {
  const records = new Map(Object.entries(paths).map(([key, url]) => [key, {
    key,
    url,
    image: null,
    status: 'idle',
    promise: null,
  }]));

  const load = (key, { retryFailed = false } = {}) => {
    const record = records.get(key);
    if (!record) return Promise.resolve({ key, status: 'unknown' });
    if (record.status === 'loaded') return Promise.resolve({ ...record });
    if (record.promise) return record.promise;
    if ((record.status === 'failed' || record.status === 'unsupported') && !retryFailed) {
      return Promise.resolve({ ...record });
    }
    if (typeof wxApi?.createImage !== 'function') {
      record.status = 'unsupported';
      return Promise.resolve({ ...record });
    }
    record.status = 'loading';
    record.promise = new Promise((resolve) => {
      let image;
      try {
        image = wxApi.createImage();
      } catch {
        record.status = 'failed';
        resolve({ ...record, promise: null });
        return;
      }
      if (!image || typeof image !== 'object') {
        record.status = 'failed';
        resolve({ ...record, promise: null });
        return;
      }
      let settled = false;
      const finish = (status) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        image.onload = null;
        image.onerror = null;
        record.status = status;
        record.image = status === 'loaded' ? image : null;
        resolve({ ...record, promise: null });
      };
      const timer = setTimeout(() => finish('failed'), Math.max(250, Number(timeoutMs) || 12000));
      image.onload = () => finish('loaded');
      image.onerror = () => finish('failed');
      try {
        image.src = record.url;
      } catch {
        finish('failed');
      }
    }).finally(() => { record.promise = null; });
    return record.promise;
  };

  return {
    get(key, fallback = null) {
      return records.get(key)?.status === 'loaded' ? records.get(key).image : fallback;
    },
    status(key) {
      const record = records.get(key);
      return record ? { key, url: record.url, status: record.status } : { key, status: 'unknown' };
    },
    load,
    async preload({
      keys = [...records.keys()],
      concurrency = 6,
      retryFailed = true,
      onProgress = null,
    } = {}) {
      const selectedKeys = [...new Set(keys)];
      const results = new Array(selectedKeys.length);
      let cursor = 0;
      let completed = 0;
      let loaded = 0;
      let failed = 0;
      let unsupported = 0;
      const reportProgress = (result) => {
        completed += 1;
        if (result.status === 'loaded') loaded += 1;
        else if (result.status === 'unsupported') unsupported += 1;
        else failed += 1;
        safeCall(onProgress, Object.freeze({
          total: selectedKeys.length,
          completed,
          loaded,
          failed,
          unsupported,
          current: result,
        }));
      };
      const workers = Array.from(
        { length: Math.max(1, Math.min(selectedKeys.length || 1, Math.floor(Number(concurrency) || 6))) },
        async () => {
          while (cursor < selectedKeys.length) {
            const index = cursor;
            const key = selectedKeys[index];
            cursor += 1;
            const result = await load(key, { retryFailed });
            results[index] = result;
            reportProgress(result);
          }
        },
      );
      await Promise.all(workers);
      return Object.freeze({
        total: selectedKeys.length,
        loaded,
        failed,
        unsupported,
        results: Object.freeze(results),
      });
    },
    useOrFallback(key, renderAsset, renderFallback = () => {}) {
      const record = records.get(key);
      const image = record?.status === 'loaded' ? record.image : null;
      if (!image) {
        if (record?.status === 'idle') void load(key).catch(() => null);
        renderFallback(this.status(key), null);
        return false;
      }
      try {
        renderAsset(image);
        return true;
      } catch (error) {
        renderFallback(this.status(key), error);
        return false;
      }
    },
  };
}

function resolveWechatAssetConfiguration(config, paths) {
  const configuredPaths = config.assetPaths && typeof config.assetPaths === 'object'
    ? config.assetPaths
    : {};
  const relativePaths = config.assetRelativePaths && typeof config.assetRelativePaths === 'object'
    ? config.assetRelativePaths
    : paths;
  const remotePaths = createWechatRemoteAssetPaths(config.assetBaseUrl, relativePaths);
  const directHttpsPaths = Object.fromEntries(
    Object.entries(relativePaths || {}).filter(([, value]) => (
      typeof value === 'string' && /^https:\/\//i.test(value)
    )),
  );
  // assetRelativePaths is embedded by the build and cannot be narrowed by a
  // runtime criticalAssetKeys override. Explicit URLs may replace individual
  // destinations, but they may not remove the rest of the formal build set.
  const resolvedPaths = Object.freeze({
    ...remotePaths,
    ...directHttpsPaths,
    ...configuredPaths,
  });
  const declaredKeys = Object.freeze([...new Set([
    ...Object.keys(relativePaths || {}),
    ...Object.keys(configuredPaths),
  ])]);
  const missingKeys = declaredKeys.filter(
    (key) => !Object.prototype.hasOwnProperty.call(resolvedPaths, key),
  );
  return {
    paths: resolvedPaths,
    keys: declaredKeys,
    error: missingKeys.length
      ? new Error('正式素材地址未配置，请设置 HTTPS 素材域名后重试。')
      : null,
  };
}

function rigImagePathsFromManifest(manifest) {
  const paths = new Set();
  for (const rig of Object.values(manifest?.rigs || {})) {
    for (const part of rig?.parts || []) {
      if (typeof part?.path === 'string') paths.add(part.path);
      for (const variant of Object.values(part?.variants || {})) {
        const variantPath = variant?.path ?? part?.path;
        if (typeof variantPath === 'string') paths.add(variantPath);
      }
    }
  }
  return Object.freeze([...paths].sort());
}

function resolveWechatRigConfiguration(config) {
  const required = config.rigRequired === true || Boolean(config.rigManifest);
  if (!required) {
    return {
      required: false,
      manifest: null,
      ownerIds: Object.freeze([]),
      imagePaths: Object.freeze({}),
      error: null,
    };
  }
  const manifest = config.rigManifest;
  const ownerIds = Array.isArray(config.rigOwnerIds)
    ? Object.freeze([...new Set(config.rigOwnerIds)])
    : Object.freeze([]);
  const actualOwnerIds = Object.keys(manifest?.rigs || {});
  const resourcePaths = rigImagePathsFromManifest(manifest);
  const configuredImagePaths = config.rigImagePaths && typeof config.rigImagePaths === 'object'
    ? config.rigImagePaths
    : {};
  let error = null;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    error = new Error('微信构建没有提供骨骼素材清单。');
  } else if (
    ownerIds.length === 0
    || actualOwnerIds.length !== ownerIds.length
    || ownerIds.some((ownerId) => !actualOwnerIds.includes(ownerId))
  ) {
    error = new Error('微信骨骼素材 owner 集合不完整。');
  } else if (resourcePaths.length !== ownerIds.length * 2) {
    error = new Error('每套微信骨骼必须提供一张图集和一张表情图。');
  } else if (ownerIds.some((ownerId) => (
    resourcePaths.filter((path) => (
      path.startsWith(`assets/generated-v2/rig/${ownerId}/`)
    )).length !== 2
  ))) {
    error = new Error('微信骨骼图片与 owner 目录不匹配。');
  } else if (
    Object.keys(configuredImagePaths).length !== resourcePaths.length
    || resourcePaths.some((path) => {
      const url = configuredImagePaths[path];
      return typeof url !== 'string'
        || !/^https:\/\//i.test(url)
        || !/[?&]v=[a-f0-9]{12}(?:&|$)/i.test(url);
    })
  ) {
    error = new Error('微信骨骼远程图片映射缺失或没有 SHA 版本参数。');
  }
  return {
    required,
    manifest,
    ownerIds,
    imagePaths: Object.freeze({ ...configuredImagePaths }),
    resourcePaths,
    error,
  };
}

function attachAssetStore(game, assetStore) {
  if (!assetStore) return;
  if (typeof game.setAssetStore === 'function') game.setAssetStore(assetStore);
  else game.assetStore = assetStore;
  game.setGeneratedCharacterArtEnabled?.(true);
}

export function wechatPreloadSucceeded(summary, assetStore, keys) {
  const uniqueKeys = [...new Set(keys)];
  return Boolean(
    summary
    && summary.total === uniqueKeys.length
    && summary.loaded === uniqueKeys.length
    && summary.failed === 0
    && summary.unsupported === 0
    && uniqueKeys.every((key) => assetStore?.status?.(key)?.status === 'loaded')
  );
}

export function wechatRigPreloadSucceeded(summary, rigStore, ownerIds) {
  const requiredOwnerIds = [...new Set(ownerIds)];
  const manifestOwnerIds = Object.keys(rigStore?.manifest?.rigs || {});
  return Boolean(
    summary
    && summary.total === requiredOwnerIds.length
    && summary.ready === requiredOwnerIds.length
    && summary.fallback === 0
    && summary.unknown === 0
    && manifestOwnerIds.length === requiredOwnerIds.length
    && requiredOwnerIds.every((ownerId) => (
      manifestOwnerIds.includes(ownerId) && rigStore?.status?.(ownerId)?.ready === true
    ))
  );
}

function roundedRect(ctx, x, y, width, height, radius, fill, stroke = null, lineWidth = 0) {
  const canDrawPath = [
    'beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'closePath', 'fill',
  ].every((name) => typeof ctx?.[name] === 'function');
  if (!canDrawPath) {
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect?.(x, y, width, height);
    }
    return;
  }
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke && typeof ctx.stroke === 'function') {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/** Canvas-only loading UI used before the game is allowed to exist. */
export function createWechatCanvasLoadingView({ surface }) {
  const canvas = surface?.canvas;
  const nativeCanvas = surface?.nativeCanvas;
  const ctx = canvas?.getContext?.('2d') || null;
  let state = 'idle';
  let completed = 0;
  let total = 0;
  let failed = 0;
  let unsupported = 0;
  let firstFailedKey = '';
  let frameId = 0;
  let retryHandler = null;
  let retryBounds = null;
  let framesDrawn = 0;
  let phase = 0;
  let disposed = false;

  const layout = () => {
    const viewport = surface.viewport();
    const width = Math.max(320, viewport.width);
    const height = Math.max(180, viewport.height);
    const cardWidth = Math.min(460, width - 32);
    const cardHeight = Math.min(340, height - 24);
    const cardX = (width - cardWidth) / 2;
    const cardY = (height - cardHeight) / 2;
    return {
      viewport,
      width,
      height,
      cardWidth,
      cardHeight,
      cardX,
      cardY,
      centerX: width / 2,
      mascotY: cardY + 91,
      titleY: cardY + 178,
      statusY: cardY + 207,
      barX: cardX + 38,
      barY: cardY + 228,
      barWidth: cardWidth - 76,
      barHeight: 16,
      retry: {
        x: width / 2 - 90,
        y: cardY + 263,
        width: 180,
        height: 43,
      },
    };
  };

  const ensureNativeResolution = (viewport) => {
    const pixelRatio = Math.max(1, Number(viewport.pixelRatio) || 1);
    const targetWidth = Math.max(1, Math.round(viewport.width * pixelRatio));
    const targetHeight = Math.max(1, Math.round(viewport.height * pixelRatio));
    if (nativeCanvas.width !== targetWidth) nativeCanvas.width = targetWidth;
    if (nativeCanvas.height !== targetHeight) nativeCanvas.height = targetHeight;
    return pixelRatio;
  };

  const drawSlime = (centerX, centerY, timePhase) => {
    const bounce = Math.sin(timePhase * Math.PI * 2) * 4;
    const slimeY = centerY + bounce;
    if (typeof ctx?.beginPath !== 'function') return;
    ctx.beginPath();
    ctx.moveTo?.(centerX - 46, slimeY + 28);
    ctx.bezierCurveTo?.(
      centerX - 50, slimeY - 18,
      centerX - 31, slimeY - 42,
      centerX, slimeY - 44,
    );
    ctx.bezierCurveTo?.(
      centerX + 34, slimeY - 42,
      centerX + 52, slimeY - 15,
      centerX + 47, slimeY + 28,
    );
    ctx.bezierCurveTo?.(
      centerX + 23, slimeY + 43,
      centerX - 24, slimeY + 43,
      centerX - 46, slimeY + 28,
    );
    ctx.closePath?.();
    ctx.fillStyle = '#4fd49b';
    ctx.fill?.();
    ctx.strokeStyle = '#334750';
    ctx.lineWidth = 4;
    ctx.stroke?.();

    for (const eyeX of [centerX - 17, centerX + 17]) {
      ctx.beginPath();
      ctx.arc?.(eyeX, slimeY - 5, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#334750';
      ctx.fill?.();
    }
    ctx.beginPath();
    ctx.arc?.(centerX, slimeY + 8, 10, 0.15, Math.PI - 0.15);
    ctx.strokeStyle = '#334750';
    ctx.lineWidth = 3;
    ctx.stroke?.();

    const orbit = timePhase * Math.PI * 2;
    const bubbles = [
      [orbit, 60, 8, '#8ceaf1'],
      [orbit + 2.1, 67, 6, '#f6be58'],
      [orbit + 4.2, 57, 5, '#d8a8f4'],
    ];
    for (const [angle, distance, radius, color] of bubbles) {
      ctx.beginPath();
      ctx.arc?.(
        centerX + Math.cos(angle) * distance,
        slimeY + Math.sin(angle) * 31,
        radius,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = color;
      ctx.fill?.();
      ctx.strokeStyle = '#334750';
      ctx.lineWidth = 2;
      ctx.stroke?.();
    }
  };

  const render = (timestamp = Date.now()) => {
    if (disposed || state === 'idle' || !ctx) return;
    const current = layout();
    const pixelRatio = ensureNativeResolution(current.viewport);
    retryBounds = { ...current.retry };
    phase = ((Number(timestamp) || 0) / 1400) % 1;
    framesDrawn += 1;
    safeCall(() => {
      ctx.save?.();
      if (typeof ctx.setTransform === 'function') ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      else ctx.scale?.(pixelRatio, pixelRatio);
      ctx.clearRect?.(0, 0, current.width, current.height);
      ctx.fillStyle = '#a7cf83';
      ctx.fillRect?.(0, 0, current.width, current.height);
      roundedRect(
        ctx,
        current.cardX,
        current.cardY,
        current.cardWidth,
        current.cardHeight,
        28,
        '#fff8e9',
        state === 'error' ? '#9c5457' : '#334750',
        3,
      );
      drawSlime(current.centerX, current.mascotY, phase);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#334750';
      ctx.font = 'bold 21px sans-serif';
      ctx.fillText?.(
        state === 'error' ? '正式素材没有加载完整' : state === 'ready' ? '基地准备完毕' : '正在唤醒史莱姆基地',
        current.centerX,
        current.titleY,
      );
      ctx.fillStyle = state === 'error' ? '#9c5457' : '#667970';
      ctx.font = 'bold 14px sans-serif';
      const missing = Math.max(1, failed + unsupported);
      const statusText = state === 'error'
        ? `${missing} 项素材失败${firstFailedKey ? ` · ${firstFailedKey}` : ''}`
        : state === 'ready'
          ? '史莱姆们已经就位'
          : `正在装载正式素材 ${completed}/${total}`;
      ctx.fillText?.(statusText, current.centerX, current.statusY);

      roundedRect(
        ctx,
        current.barX,
        current.barY,
        current.barWidth,
        current.barHeight,
        8,
        '#dce5ce',
        '#334750',
        2,
      );
      const ratio = total > 0 ? Math.max(0, Math.min(1, completed / total)) : 0;
      const fillWidth = Math.max(0, (current.barWidth - 4) * ratio);
      if (fillWidth > 0) {
        roundedRect(
          ctx,
          current.barX + 2,
          current.barY + 2,
          fillWidth,
          current.barHeight - 4,
          6,
          '#43c98a',
        );
        const shimmerWidth = Math.min(34, fillWidth);
        const travel = Math.max(1, fillWidth + shimmerWidth);
        const shimmerX = current.barX + 2 + ((phase * travel) % travel) - shimmerWidth;
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect?.(
          Math.max(current.barX + 2, shimmerX),
          current.barY + 3,
          Math.max(0, Math.min(shimmerWidth, current.barX + 2 + fillWidth - shimmerX)),
          current.barHeight - 6,
        );
        ctx.globalAlpha = 1;
      }

      if (state === 'error') {
        const pulse = 1 + Math.sin(phase * Math.PI * 2) * 0.025;
        const buttonWidth = current.retry.width * pulse;
        const buttonX = current.centerX - buttonWidth / 2;
        roundedRect(
          ctx,
          buttonX,
          current.retry.y,
          buttonWidth,
          current.retry.height,
          22,
          '#f6be58',
          '#334750',
          2,
        );
        ctx.fillStyle = '#334750';
        ctx.font = 'bold 16px sans-serif';
        ctx.fillText?.('轻触重新加载', current.centerX, current.retry.y + current.retry.height / 2);
      }
      ctx.restore?.();
    });
  };

  const schedule = () => {
    if (disposed || frameId || (state !== 'loading' && state !== 'error')) return;
    frameId = surface.frames.request((timestamp) => {
      frameId = 0;
      render(timestamp);
      schedule();
    });
  };

  const cancelFrame = () => {
    if (!frameId) return;
    surface.frames.cancel(frameId);
    frameId = 0;
  };

  const onPointerUp = (event) => {
    if (state !== 'error' || !retryBounds || typeof retryHandler !== 'function') return;
    const x = Number(event?.clientX);
    const y = Number(event?.clientY);
    if (
      x >= retryBounds.x
      && x <= retryBounds.x + retryBounds.width
      && y >= retryBounds.y
      && y <= retryBounds.y + retryBounds.height
    ) {
      event.preventDefault?.();
      retryHandler();
    }
  };
  canvas?.addEventListener?.('pointerup', onPointerUp);

  return Object.freeze({
    onRetry(handler) {
      retryHandler = typeof handler === 'function' ? handler : null;
    },
    showLoading(nextTotal) {
      cancelFrame();
      state = 'loading';
      total = Math.max(0, Math.floor(Number(nextTotal) || 0));
      completed = 0;
      failed = 0;
      unsupported = 0;
      firstFailedKey = '';
      render(Date.now());
      schedule();
    },
    setProgress(progress = {}) {
      total = Math.max(0, Math.floor(Number(progress.total) || total));
      completed = Math.max(0, Math.min(total, Math.floor(Number(progress.completed) || 0)));
      failed = Math.max(0, Math.floor(Number(progress.failed) || 0));
      unsupported = Math.max(0, Math.floor(Number(progress.unsupported) || 0));
    },
    showFailure(details = {}) {
      cancelFrame();
      state = 'error';
      failed = Math.max(0, Math.floor(Number(details.failed) || 0));
      unsupported = Math.max(0, Math.floor(Number(details.unsupported) || 0));
      firstFailedKey = String(details.firstFailedKey || '');
      render(Date.now());
      schedule();
    },
    showReady(nextTotal = total) {
      cancelFrame();
      state = 'ready';
      total = Math.max(0, Math.floor(Number(nextTotal) || 0));
      completed = total;
      failed = 0;
      unsupported = 0;
      render(Date.now());
    },
    resize() {
      if (state === 'idle') return;
      render(Date.now());
      schedule();
    },
    snapshot() {
      return Object.freeze({
        state,
        total,
        completed,
        failed,
        unsupported,
        firstFailedKey,
        framesDrawn,
        phase,
        retryBounds: retryBounds ? Object.freeze({ ...retryBounds }) : null,
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelFrame();
      canvas?.removeEventListener?.('pointerup', onPointerUp);
      retryHandler = null;
    },
  });
}

/**
 * Creates the actual Mini Game canvas, installs the narrow compatibility
 * surface required by the game, then starts its requestAnimationFrame loop.
 */
export function startWechatGame({
  wxApi = globalThis.wx,
  config = {},
  GameClass = TowerDefenseGame,
  createRuntime = createPlatformRuntime,
  createAssetStoreImpl = createWechatImageAssetStore,
  assetPaths = {},
  minimumLoadingMs = MIN_WECHAT_STARTUP_LOADING_MS,
  now = () => Date.now(),
  wait = (milliseconds) => new Promise((resolve) => {
    globalThis.setTimeout(resolve, Math.max(0, Number(milliseconds) || 0));
  }),
} = {}) {
  if (!wxApi || typeof wxApi !== 'object') {
    throw new Error('The WeChat Mini Game global wx API is unavailable.');
  }
  const runtime = createRuntime({ platform: 'wechat', wxApi, config });
  const surface = createWechatCanvasSurface({ wxApi });
  const environment = installWechatGameGlobals({ wxApi, surface, runtime });
  let game = null;
  let assetStore = null;
  let assetStoreError = null;
  let rigAssetStore = null;
  let rigAssetStoreError = null;
  let disposed = false;
  let started = false;
  let ready = Promise.resolve(null);
  let activeAttempt = null;
  const disposers = [];

  try {
    const assetConfiguration = resolveWechatAssetConfiguration(config, assetPaths);
    const requiredAssetKeys = assetConfiguration.keys;
    const rigConfiguration = resolveWechatRigConfiguration(config);
    const requiredRigOwnerIds = rigConfiguration.ownerIds;
    const totalLoadingUnits = requiredAssetKeys.length + requiredRigOwnerIds.length;
    const ensureAssetStore = () => {
      if (
        assetStore
        && typeof assetStore.preload === 'function'
        && typeof assetStore.status === 'function'
      ) return assetStore;
      assetStore = null;
      assetStoreError = null;
      try {
        assetStore = createAssetStoreImpl(assetConfiguration.paths, {
          wxApi,
          timeoutMs: Number(config.assetLoadTimeoutMs) || 12000,
        });
      } catch (error) {
        assetStoreError = error instanceof Error ? error : new Error('无法创建微信素材加载器。');
        return null;
      }
      if (
        !assetStore
        || typeof assetStore.preload !== 'function'
        || typeof assetStore.status !== 'function'
      ) {
        assetStore = null;
        assetStoreError = new Error('微信素材加载器不可用。');
      }
      return assetStore;
    };
    const ensureRigAssetStore = () => {
      if (
        rigAssetStore
        && typeof rigAssetStore.preload === 'function'
        && typeof rigAssetStore.status === 'function'
      ) return rigAssetStore;
      rigAssetStore = null;
      rigAssetStoreError = null;
      try {
        rigAssetStore = createRigAssetStore(rigConfiguration.manifest, {
          imageFactory: () => wxApi.createImage?.() ?? null,
          resolvePath: (assetPath) => {
            const url = rigConfiguration.imagePaths[assetPath];
            if (!url) throw new Error(`微信骨骼图片地址缺失：${assetPath}`);
            return url;
          },
        });
      } catch (error) {
        rigAssetStoreError = error instanceof Error ? error : new Error('无法创建微信骨骼素材加载器。');
        return null;
      }
      if (
        !rigAssetStore
        || typeof rigAssetStore.preload !== 'function'
        || typeof rigAssetStore.status !== 'function'
      ) {
        rigAssetStore = null;
        rigAssetStoreError = new Error('微信骨骼素材加载器不可用。');
      }
      return rigAssetStore;
    };
    if (requiredAssetKeys.length && !assetConfiguration.error) ensureAssetStore();
    if (requiredRigOwnerIds.length && !rigConfiguration.error) ensureRigAssetStore();
    const loadingView = createWechatCanvasLoadingView({ surface });
    disposers.push(() => loadingView.dispose());

    disposers.push(runtime.lifecycle.onHide((event) => {
      surface.frames.pause();
      environment.setHidden(true, event);
      safeCall(game?.onBackground?.bind(game));
    }));
    disposers.push(runtime.lifecycle.onShow((event) => {
      surface.refreshViewport(event);
      environment.setHidden(false, event);
      environment.dispatchResize(event);
      if (game) {
        game.lastTime = 0;
        safeCall(game.resize?.bind(game));
      } else {
        loadingView.resize();
      }
      surface.frames.resume();
      safeCall(game?.onForeground?.bind(game), event);
    }));

    if (typeof wxApi.onWindowResize === 'function') {
      const onResize = (event) => {
        surface.refreshViewport(event);
        environment.dispatchResize(event);
        if (game) safeCall(game.resize?.bind(game));
        else loadingView.resize();
      };
      wxApi.onWindowResize(onResize);
      disposers.push(() => wxApi.offWindowResize?.(onResize));
    }

    const startLoop = () => {
      if (disposed || started) return game;
      loadingView.showReady(totalLoadingUnits);
      const candidate = new GameClass(surface.canvas, {
        assetStore,
        rigAssetStore,
        generatedCharacterArtEnabled: true,
        runtime,
        audioPaths: config.audioPaths || {},
      });
      attachAssetStore(candidate, assetStore);
      if (rigAssetStore) {
        if (typeof candidate.setRigAssetStore === 'function') candidate.setRigAssetStore(rigAssetStore);
        else candidate.rigAssetStore = rigAssetStore;
      }
      // A complete first frame is part of the startup gate. Never reveal or
      // start a game whose fully loaded formal art cannot render.
      candidate.render?.();
      candidate.start();
      game = candidate;
      started = true;
      globalThis.__SLIME_GAME__ = game;
      return game;
    };

    const showFailure = ({ summary = null, rigSummary = null, error = null } = {}) => {
      const incomplete = requiredAssetKeys
        .map((key) => assetStore?.status?.(key) || { key, status: 'unknown' })
        .filter(({ status }) => status !== 'loaded');
      const incompleteRigs = requiredRigOwnerIds
        .map((ownerId) => rigAssetStore?.status?.(ownerId) || {
          id: ownerId,
          status: 'unknown',
          ready: false,
        })
        .filter(({ ready }) => ready !== true);
      const actualUnsupported = incomplete.filter(({ status }) => status === 'unsupported').length;
      const actualFailed = incomplete.length - actualUnsupported + incompleteRigs.length;
      const details = {
        failed: Math.max(
          actualFailed,
          Math.floor(Number(summary?.failed) || 0)
            + Math.floor(Number(rigSummary?.fallback) || 0)
            + Math.floor(Number(rigSummary?.unknown) || 0),
        ),
        unsupported: Math.max(actualUnsupported, Math.floor(Number(summary?.unsupported) || 0)),
        firstFailedKey: incomplete[0]?.key
          || (incompleteRigs[0]?.id ? `rig:${incompleteRigs[0].id}` : '')
          || error?.message
          || '启动初始化',
      };
      const bootError = error instanceof Error
        ? error
        : new Error(`正式素材加载失败：${details.failed + details.unsupported} 项未就绪。`);
      globalThis.__SLIME_WECHAT_BOOT_ERROR__ = bootError;
      loadingView.showFailure(details);
      return null;
    };

    const runAttempt = async () => {
      if (disposed || started) return game;
      const loadingStartedAt = Number(now()) || 0;
      loadingView.showLoading(totalLoadingUnits);
      if (assetConfiguration.error) return showFailure({ error: assetConfiguration.error });
      if (rigConfiguration.error) return showFailure({ error: rigConfiguration.error });
      if (requiredAssetKeys.length && !ensureAssetStore()) {
        return showFailure({ error: assetStoreError });
      }
      if (requiredRigOwnerIds.length && !ensureRigAssetStore()) {
        return showFailure({ error: rigAssetStoreError });
      }
      let ordinaryCompleted = 0;
      let rigCompleted = 0;
      const reportCombinedProgress = () => loadingView.setProgress({
        total: totalLoadingUnits,
        completed: ordinaryCompleted + rigCompleted,
      });
      const ordinaryPreload = requiredAssetKeys.length
        ? Promise.resolve(assetStore.preload({
          keys: requiredAssetKeys,
          concurrency: Number(config.assetLoadConcurrency) || 6,
          retryFailed: true,
          onProgress: (progress) => {
            ordinaryCompleted = Math.max(ordinaryCompleted, Number(progress?.completed) || 0);
            reportCombinedProgress();
          },
        })).then((summary) => ({ summary, error: null }))
          .catch((error) => ({ summary: null, error }))
        : Promise.resolve({
          summary: Object.freeze({ total: 0, loaded: 0, failed: 0, unsupported: 0 }),
          error: null,
        });
      const rigPreload = requiredRigOwnerIds.length
        ? Promise.resolve(rigAssetStore.preload({
          ids: requiredRigOwnerIds,
          timeoutMs: Number(config.rigLoadTimeoutMs) || 15000,
          concurrency: Number(config.rigLoadConcurrency) || 3,
          retryFailed: true,
          onProgress: (progress) => {
            rigCompleted = Math.max(rigCompleted, Number(progress?.completed) || 0);
            reportCombinedProgress();
          },
        })).then((summary) => ({ summary, error: null }))
          .catch((error) => ({ summary: null, error }))
        : Promise.resolve({
          summary: Object.freeze({ total: 0, ready: 0, fallback: 0, unknown: 0 }),
          error: null,
        });
      const [ordinaryResult, rigResult] = await Promise.all([ordinaryPreload, rigPreload]);
      if (disposed) return null;
      if (ordinaryResult.error || rigResult.error) {
        return showFailure({
          summary: ordinaryResult.summary,
          rigSummary: rigResult.summary,
          error: ordinaryResult.error || rigResult.error,
        });
      }
      if (!wechatPreloadSucceeded(ordinaryResult.summary, assetStore, requiredAssetKeys)) {
        return showFailure({
          summary: ordinaryResult.summary,
          rigSummary: rigResult.summary,
        });
      }
      if (!wechatRigPreloadSucceeded(
        rigResult.summary,
        rigAssetStore,
        requiredRigOwnerIds,
      )) {
        return showFailure({
          summary: ordinaryResult.summary,
          rigSummary: rigResult.summary,
        });
      }
      const elapsedLoadingMs = Math.max(0, (Number(now()) || 0) - loadingStartedAt);
      const remainingLoadingMs = Math.max(
        0,
        Math.floor(Number(minimumLoadingMs) || 0) - elapsedLoadingMs,
      );
      if (remainingLoadingMs > 0) await wait(remainingLoadingMs);
      if (disposed) return null;
      try {
        const nextGame = startLoop();
        delete globalThis.__SLIME_WECHAT_BOOT_ERROR__;
        return nextGame;
      } catch (error) {
        game = null;
        started = false;
        return showFailure({ error });
      }
    };

    const beginAttempt = () => {
      if (disposed) return Promise.resolve(null);
      if (started) return Promise.resolve(game);
      if (activeAttempt) return activeAttempt;
      activeAttempt = runAttempt().finally(() => { activeAttempt = null; });
      ready = activeAttempt;
      return activeAttempt;
    };
    loadingView.onRetry(beginAttempt);

    if (
      Math.floor(Number(minimumLoadingMs) || 0) <= 0
      && requiredAssetKeys.length === 0
      && requiredRigOwnerIds.length === 0
      && !assetConfiguration.error
      && !rigConfiguration.error
    ) {
      ready = Promise.resolve(startLoop());
    } else {
      ready = beginAttempt();
    }

    globalThis.__SLIME_PLATFORM_RUNTIME__ = runtime;

    const boot = {
      get game() { return game; },
      runtime,
      get assetStore() { return assetStore; },
      get rigAssetStore() { return rigAssetStore; },
      get ready() { return ready; },
      retry: beginAttempt,
      get loadingState() { return loadingView.snapshot(); },
      canvas: surface.canvas,
      nativeCanvas: surface.nativeCanvas,
      surface,
      dispose() {
        if (disposed) return;
        disposed = true;
        safeCall(game?.onBackground?.bind(game));
        disposers.splice(0).forEach((dispose) => safeCall(dispose));
        safeCall(surface.dispose);
        safeCall(runtime.dispose?.bind(runtime));
        safeCall(environment.restore);
        if (globalThis.__SLIME_PLATFORM_RUNTIME__ === runtime) {
          delete globalThis.__SLIME_PLATFORM_RUNTIME__;
        }
        if (globalThis.__SLIME_GAME__ === game) delete globalThis.__SLIME_GAME__;
      },
    };
    return boot;
  } catch (error) {
    disposers.splice(0).forEach((dispose) => dispose?.());
    surface.dispose();
    runtime.dispose?.();
    environment.restore();
    throw error;
  }
}
