/**
 * PNG asset loading for the browser and WeChat Mini Game runtimes.
 *
 * The loader supports both focused groups and the complete canonical image
 * set. Browser startup waits for the complete set; focused groups remain
 * useful to platform builds and isolated tests.
 */

export const ASSET_CACHE_VERSION = 'soft-gel-20260830-v8';

const generatedAssetUrl = (relativePath) => {
  const url = new URL(`../assets/generated/${relativePath}`, import.meta.url);
  url.searchParams.set('v', ASSET_CACHE_VERSION);
  return url.href;
};

export const ASSET_LOAD_TIMEOUT_MS = 15000;
export const ASSET_PRELOAD_CONCURRENCY = 8;
export const ASSET_PRELOAD_RETRIES = 1;

export const CRITICAL_STARTUP_ASSET_KEYS = Object.freeze([
  'survivor-shell-shell',
  'survivor-crystal-pin',
  'survivor-bubble-float',
  'survivor-moss-sprout',
  'evolution-shell-armor-v3',
  'evolution-needle-armor-v3',
  'evolution-bubble-armor-v3',
  'evolution-sprout-armor-v3',
  'enemy-soft-biter',
  'enemy-windcap',
  'enemy-stone-lump',
  'enemy-acid-shell-king',
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
  'ui-hero-control-ring',
  'ui-hero-joystick-base',
  'ui-hero-joystick-knob',
  'background-cloud-overlay',
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
  'ui-card-melee-squad',
  'ui-card-ranged-squad',
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

/**
 * Bright world art used by the procedural infinite map. Keeping this semantic
 * group exported lets constrained runtimes choose staged loading even though
 * the browser's strict startup currently preloads every canonical image.
 */
export const INFINITE_WORLD_ASSET_KEYS = Object.freeze([
  'region-gel-meadow-field-a',
  'region-dew-grove-field-a',
  'region-crystal-bloom-field-a',
  'region-bubble-heath-field-a',
  'region-shell-canyon-field-a',
  'nest-soft-rift-energy-a',
  'nest-soft-rift-frame-a',
  'landmark-soft-relay-a',
  'landmark-giant-crystal-bloom-a',
  'landmark-dew-canopy-a',
  'landmark-bubble-arch-a',
  'landmark-boss-shell-grotto-a',
]);

/** Formal art used by the standalone fusion tower-defense entry. */
export const TOWER_DEFENSE_ASSET_KEYS = Object.freeze([
  'survivor-shell-shell',
  'survivor-crystal-pin',
  'survivor-bubble-float',
  'survivor-moss-sprout',
  'evolution-shell-armor-v3',
  'evolution-needle-armor-v3',
  'evolution-bubble-armor-v3',
  'evolution-sprout-armor-v3',
  'enemy-soft-biter',
  'enemy-windcap',
  'enemy-stone-lump',
  'enemy-acid-shell-king',
  'town-soft-core',
  'fortress-slime-core',
  'rift-entry-portal',
  'building-gel-foundation',
  'turret-gel-mortar',
  'turret-gel-mount',
  'ui-hero-control-ring',
  'ui-hero-joystick-base',
  'ui-hero-joystick-knob',
  'background-garden-base',
  'background-cloud-overlay',
  'region-gel-meadow-field-a',
  'region-bubble-heath-field-a',
  'region-crystal-bloom-field-a',
  'tile-build-light',
  'tile-build-dark',
  'tile-placement-valid',
  'tile-placement-invalid',
  'tile-route-open',
  'tile-route-breach',
  'effect-projectile-goo',
  'effect-projectile-needle',
  'effect-projectile-bubble',
  'effect-projectile-seed',
  'effect-particle-impact-spark',
  'effect-particle-goo-drop',
  'effect-particle-expanding-ring',
  'effect-particle-healing-leaf',
  'effect-particle-bubble',
  'effect-particle-dust-puff',
  'effect-dynamic-components-v1',
  'effect-selection-ring-friendly',
  'effect-target-ring-danger',
  'effect-spawn-rift-burst',
  'effect-soft-swap-arc',
  'effect-damage-cracks-overlay',
  'skill-jelly-bounce-icon',
  'skill-honey-line-icon',
  'skill-soft-swap-icon',
  'skill-sprout-renewal-icon',
  'ui-soft-crystal',
  'ui-gel-energy',
  'ui-card-frame-common',
  'ui-card-frame-deploy',
  'ui-card-melee-squad',
  'ui-card-ranged-squad',
  'ui-audio-on',
  'ui-audio-off',
  'ui-tutorial-hand',
  'expedition-beacon',
  'expedition-route-combat',
  'expedition-route-boss',
  'upgrade-shared-sparkle',
]);

const DECLARED_ASSET_PATHS = {
  'survivor-shell-shell': generatedAssetUrl('survivor/survivor-shell-shell.png'),
  'survivor-crystal-pin': generatedAssetUrl('survivor/survivor-crystal-pin.png'),
  'survivor-bubble-float': generatedAssetUrl('survivor/survivor-bubble-float.png'),
  'survivor-moss-sprout': generatedAssetUrl('survivor/survivor-moss-sprout.png'),
  'evolution-shell-armor-v3': generatedAssetUrl('evolution-armor/shell-evolution-armor-v3.png'),
  'evolution-needle-armor-v3': generatedAssetUrl('evolution-armor/needle-evolution-armor-v3.png'),
  'evolution-bubble-armor-v3': generatedAssetUrl('evolution-armor/bubble-evolution-armor-v3.png'),
  'evolution-sprout-armor-v3': generatedAssetUrl('evolution-armor/sprout-evolution-armor-v3.png'),
  'enemy-soft-biter': generatedAssetUrl('enemy/enemy-soft-biter.png'),
  'enemy-windcap': generatedAssetUrl('enemy/enemy-windcap.png'),
  'enemy-stone-lump': generatedAssetUrl('enemy/enemy-stone-lump.png'),
  'enemy-acid-shell-king': generatedAssetUrl('enemy/enemy-acid-shell-king.png'),
  'building-mushroom-home': generatedAssetUrl('building/building-mushroom-home-v2.png'),
  'building-honey-plot': generatedAssetUrl('building/building-honey-plot-v2.png'),
  'building-honey-plot-autotile-v3': generatedAssetUrl('building/building-honey-plot-autotile-v3.png'),
  'building-bubble-tower': generatedAssetUrl('building/building-bubble-tower-v2.png'),
  'building-bouncy-fence': generatedAssetUrl('building/building-bouncy-fence-v2.png'),
  'building-bouncy-fence-autotile-v3': generatedAssetUrl('building/building-bouncy-fence-autotile-v3.png'),
  'building-weather-scout': generatedAssetUrl('building/building-weather-scout-v2.png'),
  'building-gel-foundation': generatedAssetUrl('building/building-gel-foundation-v2.png'),
  'turret-gel-mortar': generatedAssetUrl('turret/turret-gel-mortar-v1.png'),
  'turret-gel-mount': generatedAssetUrl('turret/turret-gel-mount-v1.png'),
  'ui-hero-control-ring': generatedAssetUrl('ui/ui-hero-control-ring-v1.png'),
  'ui-hero-joystick-base': generatedAssetUrl('ui/ui-hero-joystick-base-v1.png'),
  'ui-hero-joystick-knob': generatedAssetUrl('ui/ui-hero-joystick-knob-v1.png'),
  'terrain-gel-paving-autotile-v1': generatedAssetUrl('terrain/terrain-gel-paving-autotile-v1.png'),
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
  'fortress-slime-core': generatedAssetUrl('core/fortress-slime-core-v1.png'),
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
  'terrain-ground-field-v1': generatedAssetUrl('terrain/terrain-ground-field-v1.png'),
  'terrain-discovery-fog-cell-v1': generatedAssetUrl('terrain/terrain-discovery-cloud-field-v2.png'),
  'terrain-prop-contact-shadow-v1': generatedAssetUrl('terrain/terrain-prop-contact-shadow-v1.png'),
  'terrain-soft-gel-node-a': generatedAssetUrl('terrain/terrain-soft-gel-node-v2.png'),
  'terrain-dew-honey-node-a': generatedAssetUrl('terrain/terrain-dew-honey-node-v2.png'),
  'terrain-crystal-shard-node-a': generatedAssetUrl('terrain/terrain-crystal-shard-node-v2.png'),
  'terrain-thorn-thicket-a': generatedAssetUrl('terrain/terrain-thorn-thicket-v2.png'),
  'terrain-brittle-boulder-a': generatedAssetUrl('terrain/terrain-brittle-boulder-v2.png'),
  'terrain-deep-water-patch-a': generatedAssetUrl('terrain/terrain-deep-water-surface-overlay-v3.png'),
  'terrain-ground-detail-a': generatedAssetUrl('terrain/terrain-ground-detail-v2.png'),
  'terrain-waste-ground-detail-a': generatedAssetUrl('terrain-waste/terrain-waste-ground-detail-a.png'),
  'terrain-waste-soft-gel-cache-a': generatedAssetUrl('terrain-waste/terrain-waste-soft-gel-cache-a.png'),
  'terrain-waste-dew-pod-a': generatedAssetUrl('terrain-waste/terrain-waste-dew-pod-a.png'),
  'terrain-waste-crystal-scrap-a': generatedAssetUrl('terrain-waste/terrain-waste-crystal-scrap-a.png'),
  'terrain-waste-cable-thicket-a': generatedAssetUrl('terrain-waste/terrain-waste-cable-thicket-a.png'),
  'terrain-waste-rusted-wreck-a': generatedAssetUrl('terrain-waste/terrain-waste-rusted-wreck-a.png'),
  'terrain-waste-acid-sludge-a': generatedAssetUrl('terrain-waste/terrain-waste-acid-sludge-a.png'),
  'region-gel-meadow-field-a': generatedAssetUrl('region/region-gel-meadow-field-a.png'),
  'region-dew-grove-field-a': generatedAssetUrl('region/region-dew-grove-field-a.png'),
  'region-crystal-bloom-field-a': generatedAssetUrl('region/region-crystal-bloom-field-a.png'),
  'region-bubble-heath-field-a': generatedAssetUrl('region/region-bubble-heath-field-a.png'),
  'region-shell-canyon-field-a': generatedAssetUrl('region/region-shell-canyon-field-a.png'),
  'nest-soft-rift-frame-a': generatedAssetUrl('nest/nest-soft-rift-frame-a.png'),
  'nest-soft-rift-energy-a': generatedAssetUrl('nest/nest-soft-rift-energy-a.png'),
  'landmark-soft-relay-a': generatedAssetUrl('landmark/landmark-soft-relay-a.png'),
  'landmark-giant-crystal-bloom-a': generatedAssetUrl('landmark/landmark-giant-crystal-bloom-a.png'),
  'landmark-dew-canopy-a': generatedAssetUrl('landmark/landmark-dew-canopy-a.png'),
  'landmark-bubble-arch-a': generatedAssetUrl('landmark/landmark-bubble-arch-a.png'),
  'landmark-boss-shell-grotto-a': generatedAssetUrl('landmark/landmark-boss-shell-grotto-a.png'),
  'resource-soft-gel-token': generatedAssetUrl('resource/resource-soft-gel-token.png'),
  'resource-dew-honey-token': generatedAssetUrl('resource/resource-dew-honey-token.png'),
  'resource-crystal-shard-token': generatedAssetUrl('resource/resource-crystal-shard-token.png'),
  'expedition-route-combat': generatedAssetUrl('expedition/expedition-route-combat.png'),
  'expedition-route-resource': generatedAssetUrl('expedition/expedition-route-resource.png'),
  'expedition-route-event': generatedAssetUrl('expedition/expedition-route-event.png'),
  'expedition-route-boss': generatedAssetUrl('expedition/expedition-route-boss.png'),
  'expedition-beacon': generatedAssetUrl('expedition/expedition-beacon.png'),
  'upgrade-soft-body': generatedAssetUrl('expedition/upgrade-soft-body.png'),
  'upgrade-jelly-rush': generatedAssetUrl('expedition/upgrade-jelly-rush.png'),
  'upgrade-shared-sparkle': generatedAssetUrl('expedition/upgrade-shared-sparkle.png'),
  'upgrade-shell-rebound': generatedAssetUrl('expedition/upgrade-shell-rebound.png'),
  'upgrade-crystal-fork': generatedAssetUrl('expedition/upgrade-crystal-fork.png'),
  'upgrade-bubble-chain': generatedAssetUrl('expedition/upgrade-bubble-chain.png'),
  'upgrade-sprout-canopy': generatedAssetUrl('expedition/upgrade-sprout-canopy.png'),
  'upgrade-gel-burst': generatedAssetUrl('expedition/upgrade-gel-burst.png'),
  'upgrade-last-bounce': generatedAssetUrl('expedition/upgrade-last-bounce.png'),
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
  'effect-shield-break-v1': generatedAssetUrl('effect/effect-shield-break-v1.png'),
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
  'ui-card-frame-deploy': generatedAssetUrl('ui/ui-card-frame-deploy-v1.png'),
  'ui-card-melee-squad': generatedAssetUrl('ui/ui-card-melee-squad-v1.png'),
  'ui-card-ranged-squad': generatedAssetUrl('ui/ui-card-ranged-squad-v1.png'),
  'ui-card-frame-item': generatedAssetUrl('ui/ui-card-frame-item.png'),
  'ui-audio-on': generatedAssetUrl('ui/ui-audio-on.png'),
  'ui-audio-off': generatedAssetUrl('ui/ui-audio-off.png'),
  'ui-tutorial-hand': generatedAssetUrl('ui/ui-tutorial-hand.png'),
};

/**
 * Every unique runtime image, excluding compatibility aliases that point at
 * the same files. Browser startup uses this list so no renderer can briefly
 * expose its fallback while a formal PNG is still streaming.
 */
export const ALL_RUNTIME_ASSET_KEYS = Object.freeze(Object.keys(DECLARED_ASSET_PATHS));

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
    onProgress = null,
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
    let completed = 0;
    let loaded = 0;
    let failed = 0;
    let unsupported = 0;

    const reportProgress = (result) => {
      completed += 1;
      if (result.status === 'loaded') loaded += 1;
      else if (result.status === 'unsupported') unsupported += 1;
      else failed += 1;
      if (typeof onProgress !== 'function') return;
      try {
        onProgress(Object.freeze({
          total: uniqueKeys.length,
          completed,
          loaded,
          failed,
          unsupported,
          current: result,
        }));
      } catch {
        // A UI observer must never turn a successfully loaded image into a
        // failed preload operation.
      }
    };

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
        reportProgress(result);
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
    if (records.get(key)?.status === 'idle') void load(key).catch(() => null);
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
