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
  return [
    { name: selection.from, weight: fromWeight },
    { name: selection.to, weight: toWeight },
  ].filter(({ weight }) => weight > 0);
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
  const parts = partsFromEntry(entry).flatMap((part, index) => {
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
        index,
        sequence: prepared.length,
        part,
        image,
        rect: bindRectFor(descriptor, index, suffix),
        sourceRect: sourceRectFor(descriptor, index, suffix),
        chain,
        z,
        alpha: clampAlpha(part.alpha)
          * (isBase ? 1 : clampAlpha(descriptor.alpha))
          * weight,
        visualKey: visualKey(descriptor, image),
      };
      const duplicate = prepared.find((existing) => sameVisual(
        existing.visualKey,
        candidate.visualKey,
      ));
      if (duplicate) duplicate.alpha += candidate.alpha;
      else prepared.push(candidate);
    }
    return prepared;
  });

  // A required missing part must leave the canvas untouched so callers can
  // safely draw the existing vector fallback instead of a partial character.
  if (parts.some(({ part, image }) => part.required !== false && image == null)) {
    return null;
  }

  return parts
    .filter(({ image }) => image != null)
    .sort((left, right) => (
      left.z - right.z
      || left.index - right.index
      || left.sequence - right.sequence
    ));
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

function drawPreparedPart(ctx, pose, prepared) {
  ctx.save();
  try {
    for (const bone of prepared.chain) applyBoneTransform(ctx, pose, bone);
    ctx.globalAlpha *= clampAlpha(prepared.alpha);
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
 * variants are cross-faded as distinct crops/images; an undeclared variant
 * resolves to the normal base part for backwards compatibility.
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
  const parts = prepareParts(rig, manifestEntry, decodedImages, expression);
  if (parts == null || parts.length === 0) return false;

  for (const part of parts) drawPreparedPart(ctx, pose, part);
  return true;
}

// A drawing-oriented alias keeps call sites readable without creating a
// second implementation or a different contract.
export const drawLayeredRig = renderLayeredRig;
