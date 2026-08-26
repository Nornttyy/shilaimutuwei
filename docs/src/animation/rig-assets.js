/**
 * Atomic loader for the transparent image parts attached to animation bones.
 *
 * The JSON manifest is deliberately kept outside the JavaScript bundle so art
 * can be replaced without editing animation code. Loading is rig-atomic: no
 * partially decoded rig is ever returned to a renderer. Facial parts may add a
 * `variants` map; each entry can crop another sheet or load a standalone image.
 */

export const RIG_PART_MANIFEST_URL = new URL(
  '../../assets/rig-parts.json',
  import.meta.url,
).href;

const RIG_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  FALLBACK: 'fallback',
  UNKNOWN: 'unknown',
});

const VERSIONED_ATLAS_PATHS = Object.freeze({
  'enemy-acid-shell-king': 'assets/generated-v2/rig/enemy-acid-shell-king/atlas-layered-v2.png',
  'enemy-windcap': 'assets/generated-v2/rig/enemy-windcap/atlas-layered-v2.png',
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

function normalizeBindRect(source, label) {
  assertObject(source, label);
  const bindRect = {
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
  };
  for (const [key, value] of Object.entries(bindRect)) {
    assertFiniteNumber(value, `${label}.${key}`);
  }
  if (bindRect.width <= 0 || bindRect.height <= 0) {
    throw new RangeError(`${label} width and height must be greater than zero.`);
  }
  return bindRect;
}

function normalizeSourceRect(source, label) {
  assertObject(source, label);
  const sourceRect = {
    x: source.x,
    y: source.y,
    width: source.width,
    height: source.height,
  };
  for (const [key, value] of Object.entries(sourceRect)) {
    assertFiniteNumber(value, `${label}.${key}`);
    if (!Number.isInteger(value)) {
      throw new TypeError(`${label}.${key} must be an integer.`);
    }
  }
  if (sourceRect.x < 0 || sourceRect.y < 0) {
    throw new RangeError(`${label} x and y must be non-negative.`);
  }
  if (sourceRect.width <= 0 || sourceRect.height <= 0) {
    throw new RangeError(`${label} width and height must be positive.`);
  }
  return sourceRect;
}

function assertSafeAssetPath(path, label) {
  assertNonEmptyString(path, label);
  const pathSegments = path.split('/');
  if (
    !path.startsWith('assets/')
    || pathSegments.some((segment) => segment.length === 0 || segment === '..' || segment === '.')
    || path.startsWith('/')
    || /[%\\?#\u0000-\u001F\u007F-\u009F]/.test(path)
    || !/^[A-Za-z0-9._/-]+$/.test(path)
  ) {
    throw new RangeError(`${label} must be a safe project-relative assets path.`);
  }
  return path;
}

function assertOwnedRigFilePath(path, ownerId, label) {
  const ownerDirectory = `assets/generated-v2/rig/${ownerId}/`;
  const fileName = path.startsWith(ownerDirectory)
    ? path.slice(ownerDirectory.length)
    : '';
  if (!fileName || fileName.includes('/')) {
    throw new RangeError(`${label} must be a direct file in its owning rig directory.`);
  }
  return path;
}

function normalizePartVariants(source, label, basePart, ownerId) {
  if (source == null) return {};
  assertObject(source, label);

  return Object.fromEntries(Object.entries(source).map(([variantName, variant]) => {
    assertNonEmptyString(variantName, `${label} variant name`);
    assertObject(variant, `${label}.${variantName}`);

    const variantLabel = `${label}.${variantName}`;
    const path = assertOwnedRigFilePath(
      assertSafeAssetPath(
        variant.path ?? basePart.path,
        `${variantLabel}.path`,
      ),
      ownerId,
      `${variantLabel}.path`,
    );
    const hasSourceRect = variant.sourceRect != null;
    if (path === basePart.path && !hasSourceRect && variantName !== 'normal') {
      throw new RangeError(
        `${variantLabel}.sourceRect is required when a variant uses the base atlas.`,
      );
    }

    const normalized = {
      name: variantName,
      path,
      sourceRect: hasSourceRect
        ? normalizeSourceRect(variant.sourceRect, `${variantLabel}.sourceRect`)
        : (path === basePart.path ? basePart.sourceRect : null),
      bindRect: variant.bindRect == null
        ? basePart.bindRect
        : normalizeBindRect(variant.bindRect, `${variantLabel}.bindRect`),
    };
    if (variant.alpha != null) {
      assertFiniteNumber(variant.alpha, `${variantLabel}.alpha`);
      if (variant.alpha < 0 || variant.alpha > 1) {
        throw new RangeError(`${variantLabel}.alpha must be between zero and one.`);
      }
      normalized.alpha = variant.alpha;
    }
    return [variantName, normalized];
  }));
}

function normalizePart(source, label, nonVisualBones, ownerId) {
  assertObject(source, label);
  assertNonEmptyString(source.id, `${label}.id`);
  assertNonEmptyString(source.bone, `${label}.bone`);
  assertNonEmptyString(source.path, `${label}.path`);
  assertFiniteNumber(source.z, `${label}.z`);
  if (typeof source.required !== 'boolean') {
    throw new TypeError(`${label}.required must be a boolean.`);
  }
  if (nonVisualBones.has(source.bone)) {
    throw new RangeError(`${label} cannot attach an image to a non-visual parent bone.`);
  }

  const normalized = {
    id: source.id,
    bone: source.bone,
    z: source.z,
    path: assertSafeAssetPath(source.path, `${label}.path`),
    required: source.required,
    sourceRect: normalizeSourceRect(source.sourceRect, `${label}.sourceRect`),
    bindRect: normalizeBindRect(source.bindRect, `${label}.bindRect`),
  };
  normalized.variants = normalizePartVariants(
    source.variants,
    `${label}.variants`,
    normalized,
    ownerId,
  );
  if (Object.keys(normalized.variants).length > 0 && !['eyes', 'mouth'].includes(source.id)) {
    throw new RangeError(`${label}.variants are only supported on eyes or mouth parts.`);
  }
  return normalized;
}

function normalizeRig(source, ownerId, atlasOwners) {
  const label = `rigs.${ownerId}`;
  assertObject(source, label);
  assertNonEmptyString(source.rigId, `${label}.rigId`);
  assertNonEmptyString(source.rootBone, `${label}.rootBone`);
  assertNonEmptyString(source.faceBone, `${label}.faceBone`);
  if (source.faceBone === source.rootBone) {
    throw new RangeError(`${label}.faceBone must be distinct from rootBone.`);
  }
  if (source.canonicalFacing !== 1) {
    throw new RangeError(`${label}.canonicalFacing must be +1.`);
  }
  if (!Array.isArray(source.parts) || source.parts.length === 0) {
    throw new TypeError(`${label}.parts must be a non-empty array.`);
  }

  const partIds = new Set();
  const nonVisualBones = new Set([source.rootBone, source.faceBone]);
  let previousZ = -Infinity;
  const parts = source.parts.map((part, index) => {
    const normalized = normalizePart(
      part,
      `${label}.parts[${index}]`,
      nonVisualBones,
      ownerId,
    );
    if (partIds.has(normalized.id)) {
      throw new RangeError(`${label} has duplicate part id: ${normalized.id}.`);
    }
    if (normalized.z < previousZ) {
      throw new RangeError(`${label}.parts must follow ascending draw order by z.`);
    }
    partIds.add(normalized.id);
    previousZ = normalized.z;
    return normalized;
  });

  const atlasPaths = new Set(parts.map(({ path }) => path));
  if (atlasPaths.size !== 1) {
    throw new RangeError(`${label}.parts must share exactly one atlas path.`);
  }
  const [atlasPath] = atlasPaths;
  const existingOwner = atlasOwners.get(atlasPath);
  if (existingOwner && existingOwner !== ownerId) {
    throw new RangeError(
      `Atlas path ${atlasPath} cannot be shared across rigs (${existingOwner} and ${ownerId}).`,
    );
  }
  const expectedAtlasPath = VERSIONED_ATLAS_PATHS[ownerId]
    ?? `assets/generated-v2/rig/${ownerId}/atlas.png`;
  if (atlasPath !== expectedAtlasPath) {
    throw new RangeError(`${label} atlas path must be ${expectedAtlasPath}.`);
  }
  atlasOwners.set(atlasPath, ownerId);

  for (const facialPart of ['eyes', 'mouth']) {
    const part = parts.find(({ id }) => id === facialPart);
    if (!part || part.bone !== facialPart || part.required !== true) {
      throw new RangeError(`${label} must declare required ${facialPart} pixels on its own bone.`);
    }
  }

  return {
    ownerId,
    rigId: source.rigId,
    rootBone: source.rootBone,
    faceBone: source.faceBone,
    canonicalFacing: source.canonicalFacing,
    atlasPath,
    parts,
  };
}

/**
 * Validates and freezes an untrusted rig-parts manifest.
 * The normalized result is safe to share between the loader and renderer.
 */
export function validateRigPartManifest(source) {
  assertObject(source, 'manifest');
  if (source.schemaVersion !== 2) {
    throw new RangeError('manifest.schemaVersion must be 2.');
  }

  assertObject(source.coordinateSpace, 'manifest.coordinateSpace');
  const coordinateSpace = {
    units: source.coordinateSpace.units,
    canonicalSize: source.coordinateSpace.canonicalSize,
    origin: source.coordinateSpace.origin,
    xAxis: source.coordinateSpace.xAxis,
    yAxis: source.coordinateSpace.yAxis,
  };
  for (const key of ['units', 'origin', 'xAxis', 'yAxis']) {
    assertNonEmptyString(coordinateSpace[key], `manifest.coordinateSpace.${key}`);
  }
  assertFiniteNumber(coordinateSpace.canonicalSize, 'manifest.coordinateSpace.canonicalSize');
  if (coordinateSpace.canonicalSize <= 0) {
    throw new RangeError('manifest.coordinateSpace.canonicalSize must be greater than zero.');
  }

  assertObject(source.assetPolicy, 'manifest.assetPolicy');
  if (source.assetPolicy.rootBoneHasImage !== false) {
    throw new RangeError('manifest.assetPolicy.rootBoneHasImage must be false.');
  }
  if (source.assetPolicy.faceBoneHasImage !== false) {
    throw new RangeError('manifest.assetPolicy.faceBoneHasImage must be false.');
  }
  if (source.assetPolicy.bodyIncludesFacialPixels !== false) {
    throw new RangeError('manifest.assetPolicy.bodyIncludesFacialPixels must be false.');
  }
  if (source.assetPolicy.readiness !== 'atomic') {
    throw new RangeError('manifest.assetPolicy.readiness must be atomic.');
  }
  const assetPolicy = {
    container: source.assetPolicy.container,
    colorMode: source.assetPolicy.colorMode,
    transparent: source.assetPolicy.transparent,
    rootBoneHasImage: false,
    faceBoneHasImage: false,
    bodyIncludesFacialPixels: false,
    readiness: 'atomic',
  };

  assertObject(source.rigs, 'manifest.rigs');
  const entries = Object.entries(source.rigs);
  if (entries.length === 0) throw new RangeError('manifest.rigs must not be empty.');
  const atlasOwners = new Map();
  const rigs = Object.fromEntries(
    entries.map(([ownerId, rig]) => {
      assertNonEmptyString(ownerId, 'manifest rig owner id');
      return [ownerId, normalizeRig(rig, ownerId, atlasOwners)];
    }),
  );

  return deepFreeze({
    schemaVersion: 2,
    coordinateSpace,
    assetPolicy,
    rigs,
  });
}

/** Fetches only the JSON contract. It does not create or decode any images. */
export async function loadRigPartManifest({
  url = RIG_PART_MANIFEST_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('This runtime does not provide fetch for the rig-parts manifest.');
  }

  let response;
  try {
    response = await fetchImpl(url);
  } catch (caught) {
    throw normalizeError(caught, `Failed to fetch rig-parts manifest from ${url}`);
  }
  if (!response || response.ok === false || typeof response.json !== 'function') {
    const status = response?.status ? ` (HTTP ${response.status})` : '';
    throw new Error(`Failed to fetch rig-parts manifest${status}.`);
  }

  let source;
  try {
    source = await response.json();
  } catch (caught) {
    throw normalizeError(caught, 'Failed to parse rig-parts manifest JSON.');
  }
  return validateRigPartManifest(source);
}

function runtimeImageFactory() {
  if (typeof globalThis.Image === 'function') return new globalThis.Image();
  if (typeof globalThis.wx?.createImage === 'function') return globalThis.wx.createImage();
  return null;
}

function defaultPathResolver(path) {
  return new URL(`../../${path}`, import.meta.url).href;
}

function normalizeError(error, fallbackMessage) {
  if (error instanceof Error) return error;
  if (typeof error === 'string' && error) return new Error(error);
  return new Error(fallbackMessage);
}

function publicStatus(record) {
  const ready = record.status === RIG_STATUS.READY;
  return Object.freeze({
    id: record.id,
    status: record.status,
    ready,
    total: record.definition?.parts.length ?? 0,
    loaded: ready ? record.definition.parts.length : 0,
    error: record.error,
  });
}

function unknownStatus(id) {
  return Object.freeze({
    id,
    status: RIG_STATUS.UNKNOWN,
    ready: false,
    total: 0,
    loaded: 0,
    error: new Error(`Unknown rig asset id: ${id}`),
  });
}

function assetResourcesFor(definition) {
  const resources = new Map();
  const add = (path, representative) => {
    if (!resources.has(path)) resources.set(path, { path, representative });
  };

  for (const part of definition.parts) {
    add(part.path, part);
    for (const [variantName, variant] of Object.entries(part.variants ?? {})) {
      add(variant.path, {
        ...part,
        ...variant,
        id: `${part.id}:${variantName}`,
        partId: part.id,
        variant: variantName,
      });
    }
  }
  return [...resources.values()];
}

function loadRigImage(
  definition,
  resource,
  { imageFactory, resolvePath, timeoutMs },
) {
  const { path, representative: representativePart } = resource;
  let url;
  try {
    url = resolvePath(path, representativePart, definition);
  } catch (caught) {
    return Promise.resolve({
      path,
      image: null,
      error: normalizeError(caught, `Could not resolve rig image ${path}`),
    });
  }

  let image;
  try {
    image = imageFactory(representativePart, url, definition);
  } catch (caught) {
    return Promise.resolve({
      path,
      image: null,
      error: normalizeError(caught, `Could not create rig image ${path}`),
    });
  }
  if (!image) {
    return Promise.resolve({
      path,
      image: null,
      error: new Error('This runtime does not provide an Image factory.'),
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      resolve({ path, image: error ? null : image, error });
    };

    image.onload = () => finish();
    image.onerror = (event) => finish(normalizeError(
      event,
      `Failed to load rig image ${path} from ${url}`,
    ));
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutId = setTimeout(
        () => finish(new Error(`Timed out loading rig image ${path}`)),
        timeoutMs,
      );
    }

    try {
      image.src = url;
    } catch (caught) {
      finish(normalizeError(caught, `Failed to assign image source for rig image ${path}`));
    }
  });
}

function createReadyBundle(definition, results) {
  const imagesByPath = new Map(results.map(({ path, image }) => [path, image]));
  const parts = definition.parts.map((part) => Object.freeze({
    ...part,
    image: imagesByPath.get(part.path) ?? null,
    variants: Object.freeze(Object.fromEntries(
      Object.entries(part.variants ?? {}).map(([variantName, variant]) => [
        variantName,
        Object.freeze({
          ...variant,
          image: imagesByPath.get(variant.path) ?? null,
        }),
      ]),
    )),
  }));
  return Object.freeze({
    id: definition.ownerId,
    ownerId: definition.ownerId,
    rigId: definition.rigId,
    rootBone: definition.rootBone,
    faceBone: definition.faceBone,
    canonicalFacing: definition.canonicalFacing,
    atlasPath: definition.atlasPath,
    parts: Object.freeze(parts),
  });
}

/**
 * Creates an isolated atomic store from a validated (or raw) manifest.
 * `get()` exposes a bundle only after every declared part has loaded.
 */
export function createRigAssetStore(
  manifestSource,
  {
    imageFactory = runtimeImageFactory,
    resolvePath = defaultPathResolver,
  } = {},
) {
  const manifest = validateRigPartManifest(manifestSource);
  const records = new Map(
    Object.entries(manifest.rigs).map(([id, definition]) => [id, {
      id,
      definition,
      status: RIG_STATUS.IDLE,
      value: null,
      error: null,
      promise: null,
    }]),
  );

  function definition(id) {
    return records.get(id)?.definition ?? null;
  }

  function status(id) {
    const record = records.get(id);
    return record ? publicStatus(record) : unknownStatus(id);
  }

  function get(id, fallback = null) {
    const record = records.get(id);
    return record?.status === RIG_STATUS.READY ? record.value : fallback;
  }

  function load(id, { timeoutMs = 5000, retryFailed = false } = {}) {
    const record = records.get(id);
    if (!record) return Promise.resolve(status(id));
    if (record.status === RIG_STATUS.READY) return Promise.resolve(publicStatus(record));
    if (record.status === RIG_STATUS.LOADING && record.promise) return record.promise;
    if (record.status === RIG_STATUS.FALLBACK && !retryFailed) {
      return Promise.resolve(publicStatus(record));
    }

    record.status = RIG_STATUS.LOADING;
    record.value = null;
    record.error = null;

    const resources = assetResourcesFor(record.definition);
    record.promise = Promise.all(
      resources.map((resource) => loadRigImage(record.definition, resource, {
        imageFactory,
        resolvePath,
        timeoutMs,
      })),
    ).then((results) => {
      const failures = results.filter(({ error }) => error);
      if (failures.length > 0) {
        const failedPaths = failures.map(({ path }) => path).join(', ');
        record.status = RIG_STATUS.FALLBACK;
        record.value = null;
        record.error = new AggregateError(
          failures.map(({ error }) => error),
          `Rig ${id} is incomplete; failed images: ${failedPaths}`,
        );
      } else {
        record.status = RIG_STATUS.READY;
        record.value = createReadyBundle(record.definition, results);
        record.error = null;
      }
      record.promise = null;
      return publicStatus(record);
    });

    return record.promise;
  }

  async function preload({
    ids = Object.keys(manifest.rigs),
    timeoutMs = 5000,
    retryFailed = false,
  } = {}) {
    const uniqueIds = [...new Set(ids)];
    const results = await Promise.all(
      uniqueIds.map((id) => load(id, { timeoutMs, retryFailed })),
    );
    const count = (wanted) => results.filter((result) => result.status === wanted).length;
    return Object.freeze({
      total: results.length,
      ready: count(RIG_STATUS.READY),
      fallback: count(RIG_STATUS.FALLBACK),
      unknown: count(RIG_STATUS.UNKNOWN),
      results: Object.freeze(results),
    });
  }

  /** Calls the layered renderer only for a complete bundle. */
  function useOrFallback(id, renderRig, renderFallback = () => {}) {
    const bundle = get(id);
    if (bundle && typeof renderRig === 'function') {
      try {
        renderRig(bundle);
        return true;
      } catch (caught) {
        renderFallback(status(id), normalizeError(caught, `Failed to render rig ${id}`));
        return false;
      }
    }
    renderFallback(status(id), null);
    return false;
  }

  return Object.freeze({
    manifest,
    definition,
    get,
    load,
    preload,
    status,
    useOrFallback,
  });
}

/** Loads the JSON contract and returns a store without preloading image parts. */
export async function createRigAssetStoreFromUrl({
  url = RIG_PART_MANIFEST_URL,
  fetchImpl = globalThis.fetch,
  imageFactory = runtimeImageFactory,
  resolvePath = defaultPathResolver,
} = {}) {
  const manifest = await loadRigPartManifest({ url, fetchImpl });
  return createRigAssetStore(manifest, { imageFactory, resolvePath });
}
