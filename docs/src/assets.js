/**
 * Optional PNG asset loading for the browser and WeChat Mini Game runtimes.
 *
 * The current game remains fully renderable through draw.js. These files are
 * deliberately optional: a missing image, unsupported Image API, or drawing
 * error always leaves callers free to use the existing vector renderer.
 */

const generatedAssetUrl = (fileName) => new URL(`../assets/generated/${fileName}.png`, import.meta.url).href;

export const ASSET_PATHS = Object.freeze({
  'scene-gel-garden': generatedAssetUrl('scene-gel-garden'),
  'town-core': generatedAssetUrl('town-core'),
  'enemy-portal': generatedAssetUrl('enemy-portal'),

  'survivor-shell-shell': generatedAssetUrl('survivor-shell-shell'),
  'survivor-crystal-pin': generatedAssetUrl('survivor-crystal-pin'),
  'survivor-bubble-float': generatedAssetUrl('survivor-bubble-float'),
  'survivor-moss-sprout': generatedAssetUrl('survivor-moss-sprout'),

  'skill-jelly-bounce': generatedAssetUrl('skill-jelly-bounce'),
  'skill-honey-line': generatedAssetUrl('skill-honey-line'),
  'skill-soft-swap': generatedAssetUrl('skill-soft-swap'),
  'skill-sprout-renewal': generatedAssetUrl('skill-sprout-renewal'),

  'item-spring-pad': generatedAssetUrl('item-spring-pad'),
  'item-lure-jelly': generatedAssetUrl('item-lure-jelly'),
  'item-moving-bubble': generatedAssetUrl('item-moving-bubble'),

  'building-mushroom-home': generatedAssetUrl('building-mushroom-home'),
  'building-honey-plot': generatedAssetUrl('building-honey-plot'),
  'building-bubble-tower': generatedAssetUrl('building-bubble-tower'),
  'building-bouncy-fence': generatedAssetUrl('building-bouncy-fence'),
  'building-weather-scout': generatedAssetUrl('building-weather-scout'),

  'enemy-soft-biter': generatedAssetUrl('enemy-soft-biter'),
  'enemy-windcap': generatedAssetUrl('enemy-windcap'),
  'enemy-stone-lump': generatedAssetUrl('enemy-stone-lump'),
  'enemy-acid-shell-king': generatedAssetUrl('enemy-acid-shell-king'),
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

  function load(key, { timeoutMs = 5000, retryFailed = false } = {}) {
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

  async function preload({ keys = Object.keys(paths), timeoutMs = 5000, retryFailed = false } = {}) {
    const uniqueKeys = [...new Set(keys)];
    const results = await Promise.all(
      uniqueKeys.map((key) => load(key, { timeoutMs, retryFailed })),
    );
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
