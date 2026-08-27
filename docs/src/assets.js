/**
 * Optional PNG asset loading for the browser and WeChat Mini Game runtimes.
 *
 * The current game remains fully renderable through draw.js. These files are
 * deliberately optional: a missing image, unsupported Image API, or drawing
 * error always leaves callers free to use the existing vector renderer.
 */

const generatedAssetUrl = (relativePath) => (
  new URL(`../assets/generated/${relativePath}`, import.meta.url).href
);

export const ASSET_LOAD_TIMEOUT_MS = 15000;
export const ASSET_PRELOAD_CONCURRENCY = 8;
export const ASSET_PRELOAD_RETRIES = 1;

const DECLARED_ASSET_PATHS = {
  'survivor-shell-shell': generatedAssetUrl('survivor/survivor-shell-shell.png'),
  'survivor-crystal-pin': generatedAssetUrl('survivor/survivor-crystal-pin.png'),
  'survivor-bubble-float': generatedAssetUrl('survivor/survivor-bubble-float.png'),
  'survivor-moss-sprout': generatedAssetUrl('survivor/survivor-moss-sprout.png'),
  'enemy-soft-biter': generatedAssetUrl('enemy/enemy-soft-biter.png'),
  'enemy-windcap': generatedAssetUrl('enemy/enemy-windcap.png'),
  'enemy-stone-lump': generatedAssetUrl('enemy/enemy-stone-lump.png'),
  'enemy-acid-shell-king': generatedAssetUrl('enemy/enemy-acid-shell-king.png'),
  'building-mushroom-home': generatedAssetUrl('building/building-mushroom-home.png'),
  'building-honey-plot': generatedAssetUrl('building/building-honey-plot.png'),
  'building-bubble-tower': generatedAssetUrl('building/building-bubble-tower.png'),
  'building-bouncy-fence': generatedAssetUrl('building/building-bouncy-fence.png'),
  'building-weather-scout': generatedAssetUrl('building/building-weather-scout.png'),
  'skill-jelly-bounce-icon': generatedAssetUrl('skill/skill-jelly-bounce-icon.png'),
  'skill-honey-line-icon': generatedAssetUrl('skill/skill-honey-line-icon.png'),
  'skill-soft-swap-icon': generatedAssetUrl('skill/skill-soft-swap-icon.png'),
  'skill-sprout-renewal-icon': generatedAssetUrl('skill/skill-sprout-renewal-icon.png'),
  'item-spring-pad-icon': generatedAssetUrl('item/item-spring-pad-icon.png'),
  'item-lure-jelly-icon': generatedAssetUrl('item/item-lure-jelly-icon.png'),
  'item-moving-bubble-icon': generatedAssetUrl('item/item-moving-bubble-icon.png'),
  'item-spring-pad-world': generatedAssetUrl('item/item-spring-pad-world.png'),
  'item-lure-jelly-world': generatedAssetUrl('item/item-lure-jelly-world.png'),
  'item-moving-bubble-world': generatedAssetUrl('item/item-moving-bubble-world.png'),
  'status-shield': generatedAssetUrl('status/status-shield.png'),
  'status-slow': generatedAssetUrl('status/status-slow.png'),
  'status-heal': generatedAssetUrl('status/status-heal.png'),
  'status-marked': generatedAssetUrl('status/status-marked.png'),
  'status-sticky': generatedAssetUrl('status/status-sticky.png'),
  'status-stun': generatedAssetUrl('status/status-stun.png'),
  'status-bubble': generatedAssetUrl('status/status-bubble.png'),
  'status-poison': generatedAssetUrl('status/status-poison.png'),
  'town-soft-core': generatedAssetUrl('core/town-soft-core.png'),
  'rift-entry-portal': generatedAssetUrl('portal/rift-entry-portal.png'),
  'tile-build-light': generatedAssetUrl('tile/tile-build-light.png'),
  'tile-build-dark': generatedAssetUrl('tile/tile-build-dark.png'),
  'tile-honey-puddle': generatedAssetUrl('tile/tile-honey-puddle.png'),
  'tile-crystal-spikes': generatedAssetUrl('tile/tile-crystal-spikes.png'),
  'tile-building-rubble': generatedAssetUrl('tile/tile-building-rubble.png'),
  'tile-placement-valid': generatedAssetUrl('tile/tile-placement-valid.png'),
  'tile-placement-invalid': generatedAssetUrl('tile/tile-placement-invalid.png'),
  'tile-route-open': generatedAssetUrl('tile/tile-route-open.png'),
  'tile-route-breach': generatedAssetUrl('tile/tile-route-breach.png'),
  'background-garden-base': generatedAssetUrl('background/background-garden-base.png'),
  'background-cloud-overlay': generatedAssetUrl('background/background-cloud-overlay.png'),
  'background-foreground-grass': generatedAssetUrl('background/background-foreground-grass.png'),
  'effect-projectile-goo': generatedAssetUrl('effect/effect-projectile-goo.png'),
  'effect-projectile-needle': generatedAssetUrl('effect/effect-projectile-needle.png'),
  'effect-projectile-bubble': generatedAssetUrl('effect/effect-projectile-bubble.png'),
  'effect-projectile-seed': generatedAssetUrl('effect/effect-projectile-seed.png'),
  'effect-projectile-acid': generatedAssetUrl('effect/effect-projectile-acid.png'),
  'effect-particle-goo-drop': generatedAssetUrl('effect/effect-particle-goo-drop.png'),
  'effect-particle-impact-spark': generatedAssetUrl('effect/effect-particle-impact-spark.png'),
  'effect-particle-expanding-ring': generatedAssetUrl('effect/effect-particle-expanding-ring.png'),
  'effect-particle-healing-leaf': generatedAssetUrl('effect/effect-particle-healing-leaf.png'),
  'effect-particle-bubble': generatedAssetUrl('effect/effect-particle-bubble.png'),
  'effect-particle-dust-puff': generatedAssetUrl('effect/effect-particle-dust-puff.png'),
  'effect-dynamic-components-v1': generatedAssetUrl('effect/effect-dynamic-components-v1.png'),
  'effect-selection-ring-friendly': generatedAssetUrl('effect/effect-selection-ring-friendly.png'),
  'effect-target-ring-danger': generatedAssetUrl('effect/effect-target-ring-danger.png'),
  'effect-shield-dome': generatedAssetUrl('effect/effect-shield-dome.png'),
  'effect-spawn-rift-burst': generatedAssetUrl('effect/effect-spawn-rift-burst.png'),
  'effect-heal-burst': generatedAssetUrl('effect/effect-heal-burst.png'),
  'effect-building-destruction-puff': generatedAssetUrl('effect/effect-building-destruction-puff.png'),
  'effect-jelly-bounce-wave': generatedAssetUrl('effect/effect-jelly-bounce-wave.png'),
  'effect-soft-swap-arc': generatedAssetUrl('effect/effect-soft-swap-arc.png'),
  'effect-boss-acid-telegraph': generatedAssetUrl('effect/effect-boss-acid-telegraph.png'),
  'effect-honey-draw-trail': generatedAssetUrl('effect/effect-honey-draw-trail.png'),
  'effect-damage-cracks-overlay': generatedAssetUrl('effect/effect-damage-cracks-overlay.png'),
  'ui-soft-crystal': generatedAssetUrl('ui/ui-soft-crystal.png'),
  'ui-gel-energy': generatedAssetUrl('ui/ui-gel-energy.png'),
  'ui-card-frame-common': generatedAssetUrl('ui/ui-card-frame-common.png'),
  'ui-card-frame-item': generatedAssetUrl('ui/ui-card-frame-item.png'),
  'ui-audio-on': generatedAssetUrl('ui/ui-audio-on.png'),
  'ui-audio-off': generatedAssetUrl('ui/ui-audio-off.png'),
};

export const ASSET_PATHS = Object.freeze({
  ...DECLARED_ASSET_PATHS,
  'scene-gel-garden': DECLARED_ASSET_PATHS['background-garden-base'],
  'town-core': DECLARED_ASSET_PATHS['town-soft-core'],
  'enemy-portal': DECLARED_ASSET_PATHS['rift-entry-portal'],
});

function runtimeImageFactory() {
  if (typeof globalThis.Image === 'function') return new globalThis.Image();
  if (typeof globalThis.wx?.createImage === 'function') return globalThis.wx.createImage();
  return null;
}

function defaultPathResolver(path) {
  return new URL(path, import.meta.url).href;
}

function normalizeError(error, fallbackMessage) {
  if (error instanceof Error) return error;
  if (typeof error === 'string' && error) return new Error(error);
  return new Error(fallbackMessage);
}

function publicRecord(record) {
  return Object.freeze({
    key: record.key,
    url: record.url,
    status: record.status,
    error: record.error,
  });
}

/**
 * Creates an isolated loader. Tests and alternate canvases can inject their
 * own image factory without mutating browser globals.
 */
export function createAssetStore(
  paths = ASSET_PATHS,
  {
    imageFactory = runtimeImageFactory,
    resolvePath = defaultPathResolver,
  } = {},
) {
  const records = new Map(
    Object.entries(paths).map(([key, path]) => {
      let url = null;
      let error = null;
      try {
        url = resolvePath(path, key);
      } catch (caught) {
        error = normalizeError(caught, `Invalid asset path for ${key}`);
      }
      return [key, {
        key,
        url,
        asset: null,
        status: error ? 'failed' : 'idle',
        error,
        promise: null,
      }];
    }),
  );

  function status(key) {
    const record = records.get(key);
    if (record) return publicRecord(record);
    return Object.freeze({
      key,
      url: null,
      status: 'unknown',
      error: new Error(`Unknown asset key: ${key}`),
    });
  }

  function get(key, fallback = null) {
    const record = records.get(key);
    return record?.status === 'loaded' ? record.asset : fallback;
  }

  function load(key, { timeoutMs = ASSET_LOAD_TIMEOUT_MS, retryFailed = false } = {}) {
    const record = records.get(key);
    if (!record) return Promise.resolve(status(key));
    if (record.status === 'loaded') return Promise.resolve(publicRecord(record));
    if (record.status === 'loading' && record.promise) return record.promise;
    if ((record.status === 'failed' || record.status === 'unsupported') && !retryFailed) {
      return Promise.resolve(publicRecord(record));
    }

    record.asset = null;
    record.error = null;
    record.status = 'loading';

    let image;
    try {
      image = imageFactory(key, record.url);
    } catch (caught) {
      record.status = 'failed';
      record.error = normalizeError(caught, `Could not create image for ${key}`);
      return Promise.resolve(publicRecord(record));
    }

    if (!image) {
      record.status = 'unsupported';
      record.error = new Error('This runtime does not provide an Image factory.');
      return Promise.resolve(publicRecord(record));
    }

    record.promise = new Promise((resolve) => {
      let settled = false;
      let timeoutId = null;

      const finish = (nextStatus, error = null) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) clearTimeout(timeoutId);
        image.onload = null;
        image.onerror = null;
        record.status = nextStatus;
        record.error = error;
        record.asset = nextStatus === 'loaded' ? image : null;
        resolve(publicRecord(record));
      };

      image.onload = () => finish('loaded');
      image.onerror = (event) => finish(
        'failed',
        normalizeError(event, `Failed to load asset ${key} from ${record.url}`),
      );

      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timeoutId = setTimeout(
          () => finish('failed', new Error(`Timed out loading asset ${key}`)),
          timeoutMs,
        );
      }

      try {
        image.src = record.url;
      } catch (caught) {
        finish('failed', normalizeError(caught, `Failed to assign image source for ${key}`));
      }
    });

    return record.promise;
  }

  async function preload({
    keys = Object.keys(paths),
    timeoutMs = ASSET_LOAD_TIMEOUT_MS,
    retryFailed = true,
    retryAttempts = ASSET_PRELOAD_RETRIES,
    concurrency = ASSET_PRELOAD_CONCURRENCY,
  } = {}) {
    const uniqueKeys = [...new Set(keys)];
    const results = new Array(uniqueKeys.length);
    const workerCount = Math.min(
      uniqueKeys.length,
      Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1,
    );
    const retries = retryFailed && Number.isFinite(retryAttempts)
      ? Math.max(0, Math.floor(retryAttempts))
      : 0;
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < uniqueKeys.length) {
        const index = nextIndex;
        nextIndex += 1;
        const key = uniqueKeys[index];
        let result = await load(key, { timeoutMs, retryFailed });
        for (let attempt = 0; result.status === 'failed' && attempt < retries; attempt += 1) {
          result = await load(key, { timeoutMs, retryFailed: true });
        }
        results[index] = result;
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    const count = (wanted) => results.filter((result) => wanted.includes(result.status)).length;
    return Object.freeze({
      total: results.length,
      loaded: count(['loaded']),
      failed: count(['failed', 'unknown']),
      unsupported: count(['unsupported']),
      results: Object.freeze(results),
    });
  }

  /**
   * Runs the asset renderer only when an image is ready. Any missing image or
   * renderer exception invokes the vector-safe fallback and returns false.
   */
  function useOrFallback(key, renderAsset, renderFallback = () => {}) {
    const asset = get(key);
    if (asset && typeof renderAsset === 'function') {
      try {
        renderAsset(asset);
        return true;
      } catch (caught) {
        renderFallback(status(key), normalizeError(caught, `Failed to render asset ${key}`));
        return false;
      }
    }
    renderFallback(status(key), null);
    return false;
  }

  return Object.freeze({
    get,
    load,
    preload,
    status,
    useOrFallback,
  });
}

const defaultStore = createAssetStore();

export const preloadAssets = (options) => defaultStore.preload(options);
export const loadAsset = (key, options) => defaultStore.load(key, options);
export const getAsset = (key, fallback = null) => defaultStore.get(key, fallback);
export const getAssetStatus = (key) => defaultStore.status(key);
export const useAssetOrFallback = (key, renderAsset, renderFallback) => (
  defaultStore.useOrFallback(key, renderAsset, renderFallback)
);
