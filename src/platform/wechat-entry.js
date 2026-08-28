import { SlimeGame } from '../game.js';
import { createPlatformRuntime } from './runtime.js';
import {
  createWechatCanvasSurface,
  installWechatGameGlobals,
} from './wechat-canvas.js';

export const WECHAT_CRITICAL_ASSET_KEYS = Object.freeze([
  'survivor-shell-shell',
  'survivor-crystal-pin',
  'survivor-bubble-float',
  'survivor-moss-sprout',
  'background-garden-base',
  'background-cloud-overlay',
  'background-foreground-grass',
  'town-soft-core',
  'building-mushroom-home',
  'building-honey-plot',
  'building-bubble-tower',
  'building-bouncy-fence',
  'building-weather-scout',
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
  'ui-soft-crystal',
  'ui-audio-on',
  'ui-audio-off',
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

/** Small wx.Image store with key-scoped preload for a generated-art first screen. */
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

  const load = (key) => {
    const record = records.get(key);
    if (!record) return Promise.resolve({ key, status: 'unknown' });
    if (record.status === 'loaded' || record.status === 'failed') return Promise.resolve({ ...record });
    if (record.promise) return record.promise;
    if (typeof wxApi?.createImage !== 'function') {
      record.status = 'failed';
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
    async preload({ keys = [...records.keys()], concurrency = 6 } = {}) {
      const selectedKeys = [...new Set(keys)].filter((key) => records.has(key));
      let cursor = 0;
      const workers = Array.from(
        { length: Math.max(1, Math.min(selectedKeys.length || 1, Math.floor(Number(concurrency) || 6))) },
        async () => {
          while (cursor < selectedKeys.length) {
            const key = selectedKeys[cursor];
            cursor += 1;
            await load(key);
          }
        },
      );
      await Promise.all(workers);
      return {
        total: selectedKeys.length,
        loaded: selectedKeys.filter((key) => records.get(key)?.status === 'loaded').length,
      };
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

function attachAssetStore(game, wxApi, config, createAssetStoreImpl, paths) {
  const configuredPaths = config.assetPaths && typeof config.assetPaths === 'object'
    ? config.assetPaths
    : {};
  const relativePaths = config.assetRelativePaths && typeof config.assetRelativePaths === 'object'
    ? config.assetRelativePaths
    : paths;
  const remotePaths = Object.keys(configuredPaths).length
    ? configuredPaths
    : createWechatRemoteAssetPaths(config.assetBaseUrl, relativePaths);
  if (!Object.keys(remotePaths).length || typeof wxApi?.createImage !== 'function') return null;
  const assetStore = createAssetStoreImpl(remotePaths, {
    wxApi,
    timeoutMs: Number(config.assetLoadTimeoutMs) || 12000,
  });
  if (typeof game.setAssetStore === 'function') game.setAssetStore(assetStore);
  else game.assetStore = assetStore;
  game.setGeneratedCharacterArtEnabled?.(true);
  return assetStore;
}

/**
 * Creates the actual Mini Game canvas, installs the narrow compatibility
 * surface required by SlimeGame, then starts its requestAnimationFrame loop.
 */
export function startWechatGame({
  wxApi = globalThis.wx,
  config = {},
  GameClass = SlimeGame,
  createRuntime = createPlatformRuntime,
  createAssetStoreImpl = createWechatImageAssetStore,
  assetPaths = {},
} = {}) {
  if (!wxApi || typeof wxApi !== 'object') {
    throw new Error('The WeChat Mini Game global wx API is unavailable.');
  }
  const runtime = createRuntime({ platform: 'wechat', wxApi, config });
  const surface = createWechatCanvasSurface({ wxApi });
  const environment = installWechatGameGlobals({ wxApi, surface, runtime });
  let game;
  let assetStore = null;
  let disposed = false;
  let started = false;
  let ready = Promise.resolve(null);
  const disposers = [];

  try {
    game = new GameClass(surface.canvas);
    assetStore = attachAssetStore(
      game,
      wxApi,
      config,
      createAssetStoreImpl,
      assetPaths,
    );

    disposers.push(runtime.lifecycle.onHide((event) => {
      surface.frames.pause();
      environment.setHidden(true, event);
      safeCall(game.onBackground?.bind(game));
    }));
    disposers.push(runtime.lifecycle.onShow((event) => {
      surface.refreshViewport(event);
      environment.setHidden(false, event);
      environment.dispatchResize(event);
      game.lastTime = 0;
      safeCall(game.resize?.bind(game));
      surface.frames.resume();
      safeCall(game.onForeground?.bind(game), event);
    }));

    if (typeof wxApi.onWindowResize === 'function') {
      const onResize = (event) => {
        surface.refreshViewport(event);
        environment.dispatchResize(event);
        safeCall(game.resize?.bind(game));
      };
      wxApi.onWindowResize(onResize);
      disposers.push(() => wxApi.offWindowResize?.(onResize));
    }

    const startLoop = () => {
      if (disposed || started) return game;
      game.start();
      started = true;
      return game;
    };
    if (assetStore && typeof assetStore.preload === 'function') {
      const requestedCriticalKeys = Array.isArray(config.criticalAssetKeys)
        ? config.criticalAssetKeys
        : WECHAT_CRITICAL_ASSET_KEYS;
      const criticalKeys = requestedCriticalKeys.filter(
        (key) => assetStore.status?.(key)?.status !== 'unknown',
      );
      const waitMs = Math.max(500, Number(config.criticalStartupWaitMs) || 7000);
      let waitTimer = null;
      const criticalBudget = new Promise((resolve) => {
        waitTimer = setTimeout(resolve, waitMs);
      });
      const criticalPreload = Promise.resolve(assetStore.preload({
        keys: criticalKeys,
        concurrency: Number(config.assetLoadConcurrency) || 6,
      })).catch(() => null);
      ready = Promise.race([criticalPreload, criticalBudget])
        .finally(() => {
          if (waitTimer !== null) clearTimeout(waitTimer);
        })
        .then(startLoop);
      void ready.catch((error) => {
        globalThis.__SLIME_WECHAT_BOOT_ERROR__ = error;
        safeCall(wxApi.showModal?.bind(wxApi), {
          title: '启动失败',
          content: error?.message || '微信小游戏无法启动',
          showCancel: false,
        });
      });
    } else {
      ready = Promise.resolve(startLoop());
    }
  } catch (error) {
    disposers.splice(0).forEach((dispose) => dispose?.());
    surface.dispose();
    runtime.dispose?.();
    environment.restore();
    throw error;
  }

  const boot = {
    game,
    runtime,
    assetStore,
    ready,
    canvas: surface.canvas,
    nativeCanvas: surface.nativeCanvas,
    surface,
    dispose() {
      if (disposed) return;
      disposed = true;
      safeCall(game.onBackground?.bind(game));
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
  globalThis.__SLIME_PLATFORM_RUNTIME__ = runtime;
  globalThis.__SLIME_GAME__ = game;
  return boot;
}
