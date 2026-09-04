const IDENTITY_TRANSFORM = Object.freeze({
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  alpha: 1,
});

const CANVAS_METHODS = Object.freeze([
  'save',
  'restore',
  'translate',
  'rotate',
  'scale',
  'drawImage',
]);

const EXPRESSION_SURFACE_CACHE = new Map();
const MAX_EXPRESSION_SURFACE_EDGE = 2048;
const STATIC_PREPARATION_CACHE = new WeakMap();
const VERIFIED_DEEP_FROZEN_DATA = new WeakSet();
const VERIFIED_DEEP_FROZEN_STRUCTURE = new WeakSet();

function isDeepFrozenData(value, seen = new WeakSet()) {
  if (
    value == null
    || (typeof value !== 'object' && typeof value !== 'function')
  ) return true;
  if (VERIFIED_DEEP_FROZEN_DATA.has(value) || seen.has(value)) return true;

  try {
    if (!Object.isFrozen(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (
      prototype !== Object.prototype
      && prototype !== Array.prototype
      && prototype !== null
    ) return false;

    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      // A frozen accessor may still return changing data, so it cannot be a
      // structural cache input even when the containing object is frozen.
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
      if (!isDeepFrozenData(descriptor.value, seen)) return false;
    }
    VERIFIED_DEEP_FROZEN_DATA.add(value);
    return true;
  } catch {
    // Proxies and host objects that cannot be inspected retain prepare-on-use
    // behaviour instead of weakening validation or cache correctness.
    return false;
  }
}

function isDeepFrozenStructure(value, seen = new WeakSet()) {
  if (
    value == null
    || (typeof value !== 'object' && typeof value !== 'function')
  ) return true;
  if (VERIFIED_DEEP_FROZEN_STRUCTURE.has(value) || seen.has(value)) return true;

  try {
    if (!Object.isFrozen(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (
      prototype !== Object.prototype
      && prototype !== Array.prototype
      && prototype !== null
    ) return false;

    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
      // Decoded CanvasImageSource values are live host objects. They are not
      // structural preparation data and are resolved again by materialize on
      // every draw; only their frozen data-property container is trusted.
      if (key === 'image' || key === 'asset') continue;
      if (!isDeepFrozenStructure(descriptor.value, seen)) return false;
    }
    VERIFIED_DEEP_FROZEN_STRUCTURE.add(value);
    return true;
  } catch {
    return false;
  }
}

function stableExpressionInput(expression) {
  return expression == null
    || typeof expression === 'string'
    || isDeepFrozenData(expression);
}

function canCachePreparation(rig, entry, expression) {
  return isDeepFrozenData(rig)
    && isDeepFrozenStructure(entry)
    && stableExpressionInput(expression);
}

function preparedPartsCacheBucket(rig, entry) {
  let byEntry = STATIC_PREPARATION_CACHE.get(rig);
  if (!byEntry) {
    byEntry = new WeakMap();
    STATIC_PREPARATION_CACHE.set(rig, byEntry);
  }
  let bucket = byEntry.get(entry);
  if (!bucket) {
    bucket = [];
    byEntry.set(entry, bucket);
  }
  return bucket;
}

function finiteOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampAlpha(value) {
  return Math.max(0, Math.min(1, finiteOr(value, 1)));
}

function assertCanvasContext(ctx) {
  if (!ctx || typeof ctx !== 'object') {
    throw new TypeError('ctx must be a Canvas 2D-like context.');
  }
  for (const method of CANVAS_METHODS) {
    if (typeof ctx[method] !== 'function') {
      throw new TypeError(`ctx.${method} must be a function.`);
    }
  }
}

function assertRig(rig) {
  if (!rig || typeof rig !== 'object' || !rig.bones || typeof rig.bones !== 'object') {
    throw new TypeError('rig must contain a bones object.');
  }
}

function partsFromEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError('manifestEntry must be an object.');
  }
  const parts = entry.parts ?? entry.layers;
  if (!Array.isArray(parts)) {
    throw new TypeError('manifestEntry.parts must be an array.');
  }
  return parts;
}

function bindRectFor(part, index, suffix = '') {
  const rect = part?.bindRect;
  if (!rect || typeof rect !== 'object') {
    throw new TypeError(`manifestEntry.parts[${index}]${suffix}.bindRect must be an object.`);
  }

  const result = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
  for (const [property, value] of Object.entries(result)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(
        `manifestEntry.parts[${index}]${suffix}.bindRect.${property} must be a finite number.`,
      );
    }
  }
  return result;
}

function sourceRectFor(part, index, suffix = '') {
  const rect = part?.sourceRect;
  if (rect == null) return null;
  if (typeof rect !== 'object') {
    throw new TypeError(`manifestEntry.parts[${index}]${suffix}.sourceRect must be an object.`);
  }

  const result = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
  for (const [property, value] of Object.entries(result)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(
        `manifestEntry.parts[${index}]${suffix}.sourceRect.${property} must be a finite number.`,
      );
    }
  }
  if (result.width <= 0 || result.height <= 0) {
    throw new RangeError(
      `manifestEntry.parts[${index}]${suffix}.sourceRect width and height must be greater than zero.`,
    );
  }
  return result;
}

function boneChainFor(rig, boneName, partLabel) {
  if (typeof boneName !== 'string' || boneName.length === 0) {
    throw new TypeError(`${partLabel}.bone must name a rig bone.`);
  }

  const chain = [];
  const visited = new Set();
  let currentName = boneName;
  while (currentName != null) {
    if (visited.has(currentName)) {
      throw new RangeError(`Rig bone hierarchy contains a cycle at ${currentName}.`);
    }
    visited.add(currentName);

    const bone = rig.bones[currentName];
    if (!bone || typeof bone !== 'object') {
      throw new RangeError(`${partLabel}.bone references unknown rig bone: ${currentName}.`);
    }
    chain.push({ name: currentName, bone });
    currentName = bone.parent;
  }

  chain.reverse();
  if (typeof rig.root === 'string' && chain[0]?.name !== rig.root) {
    throw new RangeError(`${partLabel}.bone is not descended from rig root ${rig.root}.`);
  }
  return chain;
}

function unwrapImage(value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    if (value.image != null) return value.image;
    if (value.asset != null) return value.asset;
  }
  return value;
}

function mappedImage(images, key) {
  if (key == null || images == null) return null;
  if (typeof images.get === 'function') return unwrapImage(images.get(key));
  if (typeof images === 'object') return unwrapImage(images[key]);
  return null;
}

function imageForPart(part, images) {
  if (part.image != null) return unwrapImage(part.image);
  const keys = [part.id, part.assetId, part.key, part.path, part.src];
  for (const key of keys) {
    const image = mappedImage(images, key);
    if (image != null) return image;
  }
  return null;
}

function imageForVariant(part, variantName, variant, images) {
  if (variant.image != null) return unwrapImage(variant.image);
  const keys = [
    `${part.id}:${variantName}`,
    `${part.id}.${variantName}`,
    variant.assetId,
    variant.key,
    variant.path,
    variant.src,
  ];
  for (const key of keys) {
    const image = mappedImage(images, key);
    if (image != null) return image;
  }
  if (variant.path != null && variant.path === part.path) return imageForPart(part, images);
  return null;
}

function zForPart(part, rig) {
  return finiteOr(
    part.z,
    finiteOr(part.layer, finiteOr(rig.bones[part.bone]?.layer, 0)),
  );
}

function expressionSlotsFor(rig, expression) {
  if (expression == null) return null;
  if (typeof expression === 'string') {
    const state = rig.expression?.states?.[expression];
    if (!state || typeof state !== 'object') {
      throw new RangeError(`Unknown expression state: ${expression}.`);
    }
    return state;
  }
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)) {
    throw new TypeError('expression must be a state name or expression sample object.');
  }
  if (expression.slots != null) {
    if (typeof expression.slots !== 'object' || Array.isArray(expression.slots)) {
      throw new TypeError('expression.slots must be an object.');
    }
    return expression.slots;
  }
  if (typeof expression.state === 'string') {
    return expressionSlotsFor(rig, expression.state);
  }
  return expression;
}

function assertWeight(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a finite number between zero and one.`);
  }
  return value;
}

function variantWeightsFor(part, slots) {
  const selection = slots?.[part.id] ?? slots?.[part.bone];
  if (selection == null) return [{ name: 'normal', weight: 1 }];
  if (typeof selection === 'string') return [{ name: selection, weight: 1 }];
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
    throw new TypeError(`expression slot ${part.id} must select a variant.`);
  }
  if (typeof selection.variant === 'string') {
    return [{ name: selection.variant, weight: 1 }];
  }
  if (typeof selection.from !== 'string' || typeof selection.to !== 'string') {
    throw new TypeError(`expression slot ${part.id} must provide from and to variants.`);
  }
  const fromWeight = assertWeight(
    selection.weights?.from,
    `expression slot ${part.id}.weights.from`,
  );
  const toWeight = assertWeight(
    selection.weights?.to,
    `expression slot ${part.id}.weights.to`,
  );
  if (Math.abs(fromWeight + toWeight - 1) > 1e-6) {
    throw new RangeError(`expression slot ${part.id} weights must add up to one.`);
  }
  const weighted = [];
  if (fromWeight > 0) weighted.push({ name: selection.from, weight: fromWeight });
  if (toWeight > 0) weighted.push({ name: selection.to, weight: toWeight });
  return weighted;
}

function descriptorForVariant(part, variantName) {
  const variants = part.variants;
  if (variants && typeof variants === 'object' && !Array.isArray(variants)) {
    if (variants[variantName]) return variants[variantName];
    if (variants.normal) return variants.normal;
  }
  return part;
}

function visualKey(descriptor, image) {
  const source = descriptor.sourceRect;
  const bind = descriptor.bindRect;
  return [
    image,
    descriptor.path,
    source && `${source.x}:${source.y}:${source.width}:${source.height}`,
    bind && `${bind.x}:${bind.y}:${bind.width}:${bind.height}`,
    finiteOr(descriptor.alpha, 1),
  ];
}

function sameVisual(left, right) {
  return left.every((value, index) => value === right[index]);
}

function prepareParts(rig, entry, images, expression) {
  const slots = expressionSlotsFor(rig, expression);
  const sourceParts = partsFromEntry(entry);
  const parts = [];
  for (let index = 0; index < sourceParts.length; index += 1) {
    const part = sourceParts[index];
    if (!part || typeof part !== 'object') {
      throw new TypeError(`manifestEntry.parts[${index}] must be an object.`);
    }
    const label = `manifestEntry.parts[${index}]`;
    const chain = boneChainFor(rig, part.bone, label);
    const z = zForPart(part, rig);
    const weighted = variantWeightsFor(part, slots);
    const prepared = [];

    for (const { name: variantName, weight } of weighted) {
      const descriptor = descriptorForVariant(part, variantName);
      const isBase = descriptor === part;
      const image = isBase
        ? imageForPart(part, images)
        : imageForVariant(part, variantName, descriptor, images);
      const suffix = isBase ? '' : `.variants.${variantName}`;
      const candidate = {
        sequence: prepared.length,
        image,
        rect: bindRectFor(descriptor, index, suffix),
        sourceRect: sourceRectFor(descriptor, index, suffix),
        alpha: (isBase ? 1 : clampAlpha(descriptor.alpha)) * weight,
        visualKey: visualKey(descriptor, image),
      };
      const duplicate = prepared.find((existing) => sameVisual(
        existing.visualKey,
        candidate.visualKey,
      ));
      if (duplicate) duplicate.alpha += candidate.alpha;
      else prepared.push(candidate);
    }
    parts.push({
      index,
      part,
      chain,
      z,
      alpha: clampAlpha(part.alpha),
      variants: prepared,
    });
  }

  // A required missing part must leave the canvas untouched so callers can
  // safely draw the existing vector fallback instead of a partial character.
  if (parts.some(({ part, variants }) => (
    part.required !== false && variants.some(({ image }) => image == null)
  ))) {
    return null;
  }

  const drawable = [];
  for (const prepared of parts) {
    let writeIndex = 0;
    for (const variant of prepared.variants) {
      if (variant.image == null) continue;
      prepared.variants[writeIndex] = variant;
      writeIndex += 1;
    }
    prepared.variants.length = writeIndex;
    if (writeIndex > 0) drawable.push(prepared);
  }
  drawable.sort((left, right) => (
    left.z - right.z
    || left.index - right.index
  ));
  return drawable;
}

function prepareStaticParts(rig, entry, expression) {
  const slots = expressionSlotsFor(rig, expression);
  const sourceParts = partsFromEntry(entry);
  const parts = [];
  for (let index = 0; index < sourceParts.length; index += 1) {
    const part = sourceParts[index];
    if (!part || typeof part !== 'object') {
      throw new TypeError(`manifestEntry.parts[${index}] must be an object.`);
    }
    const label = `manifestEntry.parts[${index}]`;
    const chain = boneChainFor(rig, part.bone, label);
    const variants = variantWeightsFor(part, slots).map(({ name: variantName, weight }) => {
      const descriptor = descriptorForVariant(part, variantName);
      const isBase = descriptor === part;
      const suffix = isBase ? '' : `.variants.${variantName}`;
      return Object.freeze({
        descriptor,
        isBase,
        variantName,
        rect: Object.freeze(bindRectFor(descriptor, index, suffix)),
        sourceRect: sourceRectFor(descriptor, index, suffix),
        alpha: (isBase ? 1 : clampAlpha(descriptor.alpha)) * weight,
      });
    });
    for (const variant of variants) {
      if (variant.sourceRect) Object.freeze(variant.sourceRect);
    }
    Object.freeze(variants);
    for (const link of chain) Object.freeze(link);
    Object.freeze(chain);
    parts.push(Object.freeze({
      index,
      part,
      chain,
      z: zForPart(part, rig),
      alpha: clampAlpha(part.alpha),
      variants,
    }));
  }
  parts.sort((left, right) => left.z - right.z || left.index - right.index);
  return Object.freeze(parts);
}

function materializeStaticParts(staticParts, images) {
  const parts = [];
  for (const staticPart of staticParts) {
    const variants = [];
    for (const prepared of staticPart.variants) {
      const image = prepared.isBase
        ? imageForPart(staticPart.part, images)
        : imageForVariant(
          staticPart.part,
          prepared.variantName,
          prepared.descriptor,
          images,
        );
      const candidate = {
        sequence: variants.length,
        image,
        rect: prepared.rect,
        sourceRect: prepared.sourceRect,
        alpha: prepared.alpha,
        visualKey: visualKey(prepared.descriptor, image),
      };
      const duplicate = variants.find((existing) => sameVisual(
        existing.visualKey,
        candidate.visualKey,
      ));
      if (duplicate) duplicate.alpha += candidate.alpha;
      else variants.push(candidate);
    }
    if (
      staticPart.part.required !== false
      && variants.some(({ image }) => image == null)
    ) return null;

    let writeIndex = 0;
    for (const variant of variants) {
      if (variant.image == null) continue;
      variants[writeIndex] = variant;
      writeIndex += 1;
    }
    variants.length = writeIndex;
    if (writeIndex > 0) parts.push({
      index: staticPart.index,
      part: staticPart.part,
      chain: staticPart.chain,
      z: staticPart.z,
      alpha: staticPart.alpha,
      variants,
    });
  }
  return parts;
}

function preparedPartsFor(rig, entry, images, expression) {
  if (!canCachePreparation(rig, entry, expression)) {
    return prepareParts(rig, entry, images, expression);
  }

  const bucket = preparedPartsCacheBucket(rig, entry);
  let cached = bucket.find((candidate) => candidate.expression === expression);
  if (!cached) {
    cached = Object.freeze({ expression, parts: prepareStaticParts(rig, entry, expression) });
    bucket.push(cached);
  }
  // Images are intentionally resolved on every call. Loader maps and decoded
  // host images need not be frozen, and their readiness must never be hidden
  // by a cache of pose-independent rig metadata.
  return materializeStaticParts(cached.parts, images);
}

function applyBoneTransform(ctx, pose, { name, bone }) {
  const pivot = bone.pivot ?? IDENTITY_TRANSFORM;
  const transform = pose?.[name] ?? IDENTITY_TRANSFORM;
  const pivotX = finiteOr(pivot.x, 0);
  const pivotY = finiteOr(pivot.y, 0);
  const x = finiteOr(transform.x, 0);
  const y = finiteOr(transform.y, 0);

  ctx.translate(pivotX + x, pivotY + y);
  ctx.rotate(finiteOr(transform.rotation, 0));
  ctx.scale(
    finiteOr(transform.scaleX, 1),
    finiteOr(transform.scaleY, 1),
  );
  // Avoid emitting -0 into instrumented Canvas implementations. Browsers
  // treat it as zero, but normalizing keeps the operation stream portable.
  ctx.translate(pivotX === 0 ? 0 : -pivotX, pivotY === 0 ? 0 : -pivotY);
  ctx.globalAlpha *= clampAlpha(transform.alpha);
}

function drawVariant(ctx, prepared) {
  const { x, y, width, height } = prepared.rect;
  if (prepared.sourceRect) {
    const source = prepared.sourceRect;
    ctx.drawImage(
      prepared.image,
      source.x,
      source.y,
      source.width,
      source.height,
      x,
      y,
      width,
      height,
    );
  } else {
    ctx.drawImage(prepared.image, x, y, width, height);
  }
}

function imagePixelWidth(image) {
  return finiteOr(image?.naturalWidth, finiteOr(image?.videoWidth, finiteOr(image?.width, 0)));
}

function imagePixelHeight(image) {
  return finiteOr(image?.naturalHeight, finiteOr(image?.videoHeight, finiteOr(image?.height, 0)));
}

function expressionBlendGeometry(variants) {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  let pixelsPerUnit = 1;
  for (const { image, rect, sourceRect } of variants) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
    const pixelWidth = sourceRect?.width ?? imagePixelWidth(image);
    const pixelHeight = sourceRect?.height ?? imagePixelHeight(image);
    const densityX = pixelWidth / rect.width;
    const densityY = pixelHeight / rect.height;
    if (Number.isFinite(densityX) && densityX > 0) pixelsPerUnit = Math.max(pixelsPerUnit, densityX);
    if (Number.isFinite(densityY) && densityY > 0) pixelsPerUnit = Math.max(pixelsPerUnit, densityY);
  }
  const width = right - left;
  const height = bottom - top;
  if (!(width > 0) || !(height > 0)) {
    throw new RangeError('Expression variant bindRects must have positive dimensions.');
  }
  const surfaceWidth = Math.ceil(width * pixelsPerUnit);
  const surfaceHeight = Math.ceil(height * pixelsPerUnit);
  if (
    surfaceWidth > MAX_EXPRESSION_SURFACE_EDGE
    || surfaceHeight > MAX_EXPRESSION_SURFACE_EDGE
  ) {
    throw new RangeError('Expression blend surface exceeds the supported size.');
  }
  return {
    rect: { x: left, y: top, width, height },
    pixelsPerUnit,
    surfaceWidth,
    surfaceHeight,
  };
}

function createExpressionSurface(ctx, width, height) {
  let canvas = null;
  try {
    if (typeof globalThis.OffscreenCanvas === 'function') {
      canvas = new globalThis.OffscreenCanvas(width, height);
    } else if (typeof globalThis.wx?.createOffscreenCanvas === 'function') {
      canvas = globalThis.wx.createOffscreenCanvas({ type: '2d', width, height });
    } else if (typeof globalThis.wx?.createCanvas === 'function') {
      canvas = globalThis.wx.createCanvas();
      canvas.width = width;
      canvas.height = height;
    } else {
      const documentRef = ctx?.canvas?.ownerDocument ?? globalThis.document;
      if (typeof documentRef?.createElement === 'function') {
        canvas = documentRef.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
      }
    }
  } catch {
    return null;
  }

  let surfaceCtx = null;
  try {
    surfaceCtx = canvas?.getContext?.('2d');
  } catch {
    return null;
  }
  const methods = ['save', 'restore', 'clearRect', 'drawImage'];
  if (!surfaceCtx || methods.some((method) => typeof surfaceCtx[method] !== 'function')) {
    return null;
  }
  return { canvas, ctx: surfaceCtx, width, height };
}

function expressionSurfaceFor(ctx, cacheKey, width, height) {
  const key = `${cacheKey}:${width}x${height}`;
  let surface = EXPRESSION_SURFACE_CACHE.get(key);
  if (!surface) {
    surface = createExpressionSurface(ctx, width, height);
    if (!surface) return null;
    EXPRESSION_SURFACE_CACHE.set(key, surface);
  }
  return surface;
}

function prepareExpressionBlend(ctx, prepared) {
  if (prepared.variants.length < 2) return null;
  const geometry = expressionBlendGeometry(prepared.variants);
  const surface = expressionSurfaceFor(
    ctx,
    prepared.part.id,
    geometry.surfaceWidth,
    geometry.surfaceHeight,
  );
  if (!surface) return null;

  const surfaceCtx = surface.ctx;
  surfaceCtx.save();
  try {
    surfaceCtx.globalAlpha = 1;
    surfaceCtx.globalCompositeOperation = 'source-over';
    surfaceCtx.clearRect(0, 0, surface.width, surface.height);
    prepared.variants.forEach((variant, index) => {
      // On a transparent isolated layer, `lighter` adds premultiplied colour
      // and alpha. With expression weights summing to one, this is the exact
      // linear interpolation; drawing the two images source-over is not (two
      // opaque 50% layers would incorrectly leave only 75% alpha).
      surfaceCtx.globalCompositeOperation = index === 0 ? 'source-over' : 'lighter';
      surfaceCtx.globalAlpha = clampAlpha(variant.alpha);
      const target = {
        x: (variant.rect.x - geometry.rect.x) * geometry.pixelsPerUnit,
        y: (variant.rect.y - geometry.rect.y) * geometry.pixelsPerUnit,
        width: variant.rect.width * geometry.pixelsPerUnit,
        height: variant.rect.height * geometry.pixelsPerUnit,
      };
      drawVariant(surfaceCtx, { ...variant, rect: target });
    });
  } finally {
    surfaceCtx.restore();
  }
  return { surface, rect: geometry.rect };
}

function drawPreparedPart(ctx, pose, prepared, blend = null) {
  ctx.save();
  try {
    for (const bone of prepared.chain) applyBoneTransform(ctx, pose, bone);
    ctx.globalAlpha *= clampAlpha(prepared.alpha);
    if (blend) {
      const { x, y, width, height } = blend.rect;
      ctx.drawImage(
        blend.surface.canvas,
        0,
        0,
        blend.surface.width,
        blend.surface.height,
        x,
        y,
        width,
        height,
      );
    } else {
      const [variant] = prepared.variants;
      ctx.globalAlpha *= clampAlpha(variant.alpha);
      drawVariant(ctx, variant);
    }
  } finally {
    ctx.restore();
  }
}

/**
 * Draws decoded rig-part images in the rig's 100-unit local coordinate space.
 *
 * The caller owns world position, display scale and facing. Each part uses its
 * own logical bindRect and inherits pose transforms from every ancestor bone.
 * Parts with a sourceRect crop their pixels from a shared atlas; standalone
 * part images retain the five-argument drawImage path. `expression` accepts a
 * rig state name, a direct slot map, or `ExpressionMixer.sample()`. Declared
 * variants are first mixed with premultiplied alpha on a cached isolated
 * surface, then composited once; an undeclared variant resolves to the normal
 * base part for backwards compatibility.
 * Returns false without drawing when a required image is unavailable, allowing
 * the caller to use the vector renderer as an atomic fallback.
 */
export function renderLayeredRig(
  ctx,
  rig,
  pose,
  manifestEntry,
  decodedImages = null,
  expression = null,
) {
  assertCanvasContext(ctx);
  assertRig(rig);
  const parts = preparedPartsFor(rig, manifestEntry, decodedImages, expression);
  if (parts == null || parts.length === 0) return false;

  // Allocate and fill every required expression surface before touching the
  // caller's canvas, preserving the renderer's atomic fallback contract.
  let blends = null;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.variants.length < 2) continue;
    const blend = prepareExpressionBlend(ctx, part);
    if (!blend) return false;
    if (!blends) blends = new Array(parts.length).fill(null);
    blends[index] = blend;
  }

  for (let index = 0; index < parts.length; index += 1) {
    drawPreparedPart(ctx, pose, parts[index], blends?.[index]);
  }
  return true;
}

// A drawing-oriented alias keeps call sites readable without creating a
// second implementation or a different contract.
export const drawLayeredRig = renderLayeredRig;
