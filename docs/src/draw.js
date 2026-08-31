import { renderLayeredRig } from './animation/layer-renderer.js';
import {
  BOSS_RIG,
  BUBBLE_RIG,
  BUG_RIG,
  CRYSTAL_RIG,
  SHELL_RIG,
  SOLDIER_RIG,
  SPROUT_RIG,
  STONE_RIG,
  WINDCAP_RIG,
} from './animation/rigs.js';
import { SOLDIER_CLIPS } from './animation/clips.js';
import { AnimationController } from './animation/controller.js';
import {
  characterExportedFacing,
  characterFacingMultiplier,
  characterPortraitCrop,
  characterWorldScale,
  resolveCharacterGameplayFacing,
} from './character-render-profiles.js';

/**
 * Zero-dependency Canvas 2D art kit for the Slime Town prototype.
 *
 * Coordinate convention:
 * - Characters and buildings use (x, y) as their ground-centre anchor.
 * - Portal uses (x, y) as its ground-centre anchor.
 * - Status icons and particles use (x, y) as their visual centre.
 * - `size` is a nominal height/footprint in CSS pixels.
 *
 * All functions preserve the incoming canvas state. Animation is caller-driven:
 * pass `time` in seconds, `progress` in the 0..1 range, or explicit state values.
 */

export const PALETTE = Object.freeze({
  mist: '#DDEFE5',
  forest: '#B6D9C4',
  grass: '#8DC67D',
  tileLight: '#EBDDBB',
  tileDark: '#DFCCA2',
  panel: '#FFF8E9',
  ink: '#263642',
  inkSoft: '#52646C',
  textMuted: '#6B7A83',
  friendly: '#61D6A2',
  friendlyDeep: '#2F9B78',
  friendlyLight: '#C9FFE5',
  bubble: '#65CBE4',
  bubbleDeep: '#328FB5',
  crystal: '#8975DD',
  crystalLight: '#C5B9FF',
  sprout: '#78C96C',
  sproutDeep: '#3E9254',
  shell: '#E6AE61',
  shellDeep: '#A96845',
  enemy: '#675775',
  enemyDeep: '#40374F',
  enemyLight: '#A48EAE',
  danger: '#E45F68',
  dangerDeep: '#A73F50',
  shield: '#54A9D7',
  heal: '#51B978',
  currency: '#64C9E2',
  normal: '#7DA58D',
  advanced: '#7966D0',
  ultimate: '#E3A83C',
  ultimateLight: '#FFF0A2',
  cream: '#FFF1CF',
  white: '#FFFFFF',
});

const TAU = Math.PI * 2;
const KAPPA = 0.5522847498307936;
const RIG_SURFACE = Object.freeze({
  // Preserve two source pixels per logical unit before the complete layered
  // rig is composited onto the main canvas. Performance work may skip hidden
  // actors and redundant paints, but must not downsample visible characters.
  width: 512,
  height: 512,
  pixelsPerUnit: 2,
  originX: 256,
  originY: 384,
});

let sharedRigSurface = null;

const SLIME_RIG_BY_VARIANT = Object.freeze({
  shell: SHELL_RIG,
  needle: CRYSTAL_RIG,
  bubble: BUBBLE_RIG,
  sprout: SPROUT_RIG,
});

const SLIME_OWNER_BY_VARIANT = Object.freeze({
  shell: 'survivor-shell-shell',
  needle: 'survivor-crystal-pin',
  bubble: 'survivor-bubble-float',
  sprout: 'survivor-moss-sprout',
});

const MONSTER_RIG_BY_TYPE = Object.freeze({
  bug: BUG_RIG,
  mushroom: WINDCAP_RIG,
  stone: STONE_RIG,
  boss: BOSS_RIG,
});

const MONSTER_OWNER_BY_TYPE = Object.freeze({
  bug: 'enemy-soft-biter',
  mushroom: 'enemy-windcap',
  stone: 'enemy-stone-lump',
  boss: 'enemy-acid-shell-king',
});

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const safeNumber = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

/**
 * Draw one optional generated image atomically. Missing assets, unsupported
 * stores, and drawImage exceptions all execute the complete vector fallback.
 */
export function drawAssetOrFallback(ctx, assetStore, key, drawAsset, drawFallback) {
  const fallback = () => {
    ctx.save();
    try {
      drawFallback?.();
    } finally {
      ctx.restore();
    }
  };
  if (!assetStore || typeof assetStore.useOrFallback !== 'function') {
    fallback();
    return false;
  }
  return assetStore.useOrFallback(
    key,
    (asset) => {
      ctx.save();
      try {
        drawAsset(asset);
      } finally {
        ctx.restore();
      }
    },
    fallback,
  );
}

function drawGeneratedCharacterStandalone(ctx, assetStore, ownerId, size, requestedFacing) {
  return drawAssetOrFallback(ctx, assetStore, ownerId, (asset) => {
    const imageWidth = Number(asset?.naturalWidth || asset?.width);
    const imageHeight = Number(asset?.naturalHeight || asset?.height);
    const crop = characterPortraitCrop(ownerId, imageWidth, imageHeight);
    if (!crop) throw new TypeError(`Generated standalone ${ownerId} has invalid dimensions.`);
    const fit = size / Math.max(crop.width, crop.height);
    const width = crop.width * fit;
    const height = crop.height * fit;
    ctx.scale(characterFacingMultiplier(
      ownerId,
      characterExportedFacing(ownerId),
      requestedFacing,
    ), 1);
    ctx.drawImage(
      asset,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      -width / 2,
      -height,
      width,
      height,
    );
  }, () => {});
}

function createRigSurface(ctx) {
  let canvas = null;
  try {
    if (typeof globalThis.OffscreenCanvas === 'function') {
      canvas = new globalThis.OffscreenCanvas(RIG_SURFACE.width, RIG_SURFACE.height);
    } else if (typeof globalThis.wx?.createOffscreenCanvas === 'function') {
      canvas = globalThis.wx.createOffscreenCanvas({
        type: '2d',
        width: RIG_SURFACE.width,
        height: RIG_SURFACE.height,
      });
    } else if (typeof globalThis.wx?.createCanvas === 'function') {
      // The visible WeChat canvas is created by the platform bootstrap first;
      // subsequent canvases are offscreen on older base libraries.
      canvas = globalThis.wx.createCanvas();
      canvas.width = RIG_SURFACE.width;
      canvas.height = RIG_SURFACE.height;
    } else {
      const documentRef = ctx?.canvas?.ownerDocument ?? globalThis.document;
      if (typeof documentRef?.createElement === 'function') {
        canvas = documentRef.createElement('canvas');
        canvas.width = RIG_SURFACE.width;
        canvas.height = RIG_SURFACE.height;
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
  const requiredMethods = [
    'save',
    'restore',
    'translate',
    'rotate',
    'scale',
    'drawImage',
    'clearRect',
  ];
  if (
    !surfaceCtx
    || requiredMethods.some((method) => typeof surfaceCtx[method] !== 'function')
    || (
      typeof surfaceCtx.resetTransform !== 'function'
      && typeof surfaceCtx.setTransform !== 'function'
    )
  ) return null;
  return { canvas, ctx: surfaceCtx };
}

function rigSurfaceFor(ctx) {
  if (!sharedRigSurface) sharedRigSurface = createRigSurface(ctx);
  return sharedRigSurface;
}

function clearRigSurface(surface) {
  const { ctx } = surface;
  if (typeof ctx.resetTransform === 'function') ctx.resetTransform();
  else ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, RIG_SURFACE.width, RIG_SURFACE.height);
}

function isCompatibleRigAsset(rig, rigAsset) {
  return Boolean(
    rigAsset
    && rigAsset.rigId === rig.id
    && [-1, 1].includes(rigAsset.canonicalFacing),
  );
}

function renderCompatibleRigAsset(
  ctx,
  rig,
  pose,
  rigAsset,
  expression = null,
) {
  if (!isCompatibleRigAsset(rig, rigAsset)) return false;

  const surface = rigSurfaceFor(ctx);
  if (!surface) return false;
  let rendered = false;
  let surfaceSaved = false;
  try {
    clearRigSurface(surface);
    surface.ctx.save();
    surfaceSaved = true;
    surface.ctx.translate(RIG_SURFACE.originX, RIG_SURFACE.originY);
    surface.ctx.scale(RIG_SURFACE.pixelsPerUnit, RIG_SURFACE.pixelsPerUnit);
    rendered = renderLayeredRig(
      surface.ctx,
      rig,
      pose ?? {},
      rigAsset,
      null,
      expression,
    );
  } catch {
    rendered = false;
  } finally {
    if (surfaceSaved) {
      try {
        surface.ctx.restore();
      } catch {
        rendered = false;
      }
    }
  }
  if (!rendered) {
    try {
      clearRigSurface(surface);
    } catch {
      // A lost offscreen context still leaves the main canvas untouched.
    }
    return false;
  }

  const localWidth = RIG_SURFACE.width / RIG_SURFACE.pixelsPerUnit;
  const localHeight = RIG_SURFACE.height / RIG_SURFACE.pixelsPerUnit;
  const localX = -RIG_SURFACE.originX / RIG_SURFACE.pixelsPerUnit;
  const localY = -RIG_SURFACE.originY / RIG_SURFACE.pixelsPerUnit;
  try {
    ctx.drawImage(surface.canvas, localX, localY, localWidth, localHeight);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply one pose bone as an offset from its bind pose. Bone transforms are
 * intentionally incremental: an omitted bone (or an empty transform) is the
 * identity. The fixed pivot keeps rotations and scales attached to the drawn
 * part instead of orbiting around the character's ground anchor.
 */
function withPoseBone(ctx, pose, name, pivotX, pivotY, draw) {
  const bone = pose?.[name] || {};
  const x = safeNumber(bone.x, 0);
  const y = safeNumber(bone.y, 0);
  const rotation = safeNumber(bone.rotation, 0);
  const scaleX = safeNumber(bone.scaleX, 1);
  const scaleY = safeNumber(bone.scaleY, 1);
  const alpha = clamp(safeNumber(bone.alpha, 1));

  ctx.save();
  ctx.translate(pivotX + x, pivotY + y);
  ctx.rotate(rotation);
  ctx.scale(scaleX, scaleY);
  ctx.translate(-pivotX, -pivotY);
  ctx.globalAlpha *= alpha;
  draw();
  ctx.restore();
}

function resolveVariant(variantOrOptions, maybeOptions, fallback) {
  if (typeof variantOrOptions === 'string') {
    return [variantOrOptions, maybeOptions || {}];
  }
  const options = variantOrOptions || {};
  return [options.variant || options.type || fallback, options];
}

function polygonPath(ctx, points) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.closePath();
}

export function ellipsePath(ctx, x, y, radiusX, radiusY) {
  const ox = radiusX * KAPPA;
  const oy = radiusY * KAPPA;
  ctx.beginPath();
  ctx.moveTo(x - radiusX, y);
  ctx.bezierCurveTo(x - radiusX, y - oy, x - ox, y - radiusY, x, y - radiusY);
  ctx.bezierCurveTo(x + ox, y - radiusY, x + radiusX, y - oy, x + radiusX, y);
  ctx.bezierCurveTo(x + radiusX, y + oy, x + ox, y + radiusY, x, y + radiusY);
  ctx.bezierCurveTo(x - ox, y + radiusY, x - radiusX, y + oy, x - radiusX, y);
  ctx.closePath();
}

export function roundedRectPath(ctx, x, y, width, height, radius = 8) {
  const r = Math.min(Math.abs(width) / 2, Math.abs(height) / 2, Math.max(0, radius));
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

export function drawRoundedRect(ctx, x, y, width, height, options = {}) {
  const {
    radius = 8,
    fill = null,
    stroke = null,
    lineWidth = 1,
    alpha = 1,
  } = options;
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  roundedRectPath(ctx, x, y, width, height, radius);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke && lineWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

export function drawSoftShadow(ctx, x, y, size, options = {}) {
  const alpha = clamp(options.alpha ?? 0.2);
  const width = safeNumber(options.width, size * 0.72);
  const height = safeNumber(options.height, size * 0.16);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = options.color || PALETTE.ink;
  if ('filter' in ctx && options.blur !== false) ctx.filter = `blur(${Math.max(1, size * 0.025)}px)`;
  ellipsePath(ctx, x, y, width / 2, height / 2);
  ctx.fill();
  ctx.restore();
}

function drawSelectionRing(ctx, x, y, size, options) {
  if (!options.selected && !options.targeted) return;
  const time = safeNumber(options.time, 0);
  const pulse = 1 + Math.sin(time * 5) * 0.035;
  drawAssetOrFallback(
    ctx,
    options.assetStore,
    options.targeted ? 'effect-target-ring-danger' : 'effect-selection-ring-friendly',
    (asset) => {
      ctx.translate(x, y);
      ctx.scale(pulse, pulse);
      ctx.globalAlpha *= 0.82;
      ctx.drawImage(asset, -size * 0.5, -size * 0.25, size, size * 0.5);
    },
    () => {
      ctx.translate(x, y);
      ctx.scale(pulse, pulse);
      ctx.strokeStyle = options.targeted
        ? PALETTE.danger
        : (options.selectionColor || PALETTE.currency);
      ctx.lineWidth = Math.max(2, size * 0.035);
      ctx.globalAlpha *= 0.82;
      ellipsePath(ctx, 0, 0, size * 0.47, size * 0.16);
      ctx.stroke();
    },
  );
}

function gooBodyPath(ctx, widen = 0) {
  const side = 42 + widen;
  ctx.beginPath();
  ctx.moveTo(-side, -9);
  ctx.bezierCurveTo(-49 - widen, -25, -40 - widen, -55, -21, -68);
  ctx.bezierCurveTo(-9, -78, 8, -79, 21, -69);
  ctx.bezierCurveTo(40 + widen, -56, 49 + widen, -25, side, -8);
  ctx.bezierCurveTo(36, 3, 22, 5, 0, 5);
  ctx.bezierCurveTo(-23, 5, -36, 3, -side, -9);
  ctx.closePath();
}

function drawFace(ctx, expression = 'normal', options = {}) {
  const eyeY = -39;
  const eyeSpacing = options.eyeSpacing ?? 13;
  const eyeScale = options.eyeScale ?? 1;
  ctx.save();
  ctx.fillStyle = options.eyeColor || PALETTE.ink;

  if (expression === 'hurt') {
    ctx.strokeStyle = options.eyeColor || PALETTE.ink;
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    for (const direction of [-1, 1]) {
      const ex = direction * eyeSpacing;
      ctx.beginPath();
      ctx.moveTo(ex - 3.5, eyeY - 3);
      ctx.lineTo(ex + 3.5, eyeY + 3);
      ctx.moveTo(ex + 3.5, eyeY - 3);
      ctx.lineTo(ex - 3.5, eyeY + 3);
      ctx.stroke();
    }
  } else {
    for (const direction of [-1, 1]) {
      const ex = direction * eyeSpacing;
      ellipsePath(ctx, ex, eyeY, 4.3 * eyeScale, 6.5 * eyeScale);
      ctx.fill();
      ctx.fillStyle = PALETTE.white;
      ctx.globalAlpha *= 0.82;
      ellipsePath(ctx, ex - 1.4, eyeY - 2.2, 1.25, 1.8);
      ctx.fill();
      ctx.globalAlpha /= 0.82;
      ctx.fillStyle = options.eyeColor || PALETTE.ink;
    }
  }

  ctx.strokeStyle = options.mouthColor || PALETTE.inkSoft;
  ctx.lineWidth = 2.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (expression === 'happy') {
    ctx.moveTo(-6, -25);
    ctx.quadraticCurveTo(0, -19, 6, -25);
  } else if (expression === 'hurt') {
    ctx.moveTo(-5, -20);
    ctx.quadraticCurveTo(0, -26, 5, -20);
  } else if (expression === 'angry') {
    ctx.moveTo(-5, -22);
    ctx.lineTo(5, -22);
  } else {
    ctx.moveTo(-5, -24);
    ctx.quadraticCurveTo(0, -20, 5, -24);
  }
  ctx.stroke();
  ctx.restore();
}

function drawGooBodyLocal(ctx, options = {}) {
  const base = options.color || PALETTE.friendly;
  const deep = options.deepColor || PALETTE.friendlyDeep;
  const light = options.lightColor || PALETTE.friendlyLight;
  const outline = options.outline || PALETTE.inkSoft;
  const widen = options.widen || 0;

  const gradient = ctx.createLinearGradient(-22, -76, 24, 6);
  gradient.addColorStop(0, light);
  gradient.addColorStop(0.18, base);
  gradient.addColorStop(0.74, base);
  gradient.addColorStop(1, deep);
  gooBodyPath(ctx, widen);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = options.lineWidth || 4;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha *= 0.42;
  ctx.fillStyle = PALETTE.white;
  ellipsePath(ctx, -18, -58, 9.5, 5.5);
  ctx.rotate(-0.3);
  ctx.fill();
  ctx.globalAlpha *= 0.55;
  ellipsePath(ctx, -29, -43, 3, 6);
  ctx.fill();
  ctx.restore();

  if ((options.hit || 0) > 0) {
    ctx.save();
    ctx.globalAlpha *= clamp(options.hit) * 0.72;
    ctx.fillStyle = PALETTE.white;
    gooBodyPath(ctx, widen);
    ctx.fill();
    ctx.restore();
  }

  if (options.face !== false) {
    drawFace(ctx, options.expression || 'normal', options);
  }
}

/** Draw a generic friendly goo blob. */
export function drawGooBlob(ctx, x, y, size, options = {}) {
  const time = safeNumber(options.time, 0);
  const idle = options.animate === false ? 0 : Math.sin(time * 3.1 + (options.phase || 0)) * 0.025;
  const squash = clamp(safeNumber(options.squash, 0) + idle, -0.18, 0.2);
  const hop = safeNumber(options.hop, 0) * size;
  drawSelectionRing(ctx, x, y, size, options);
  drawSoftShadow(ctx, x, y + size * 0.015, size, {
    width: size * (0.7 + squash * 0.4),
    height: size * 0.14,
    alpha: 0.2 * (1 - clamp(options.hop || 0) * 0.45),
  });
  ctx.save();
  ctx.globalAlpha *= options.disabled ? 0.48 : clamp(options.alpha ?? 1);
  ctx.translate(x, y - hop);
  const unit = size / 100;
  const facing = options.facing === -1 ? -1 : 1;
  ctx.scale(unit * facing * (1 + squash * 0.55), unit * (1 - squash));
  drawGooBodyLocal(ctx, options);
  ctx.restore();
}

function drawCrystal(ctx, points, fill, stroke = PALETTE.inkSoft, lineWidth = 3) {
  polygonPath(ctx, points);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.save();
  ctx.globalAlpha *= 0.5;
  ctx.strokeStyle = PALETTE.white;
  ctx.lineWidth = Math.max(1, lineWidth * 0.45);
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  ctx.lineTo(points[1][0], points[1][1]);
  ctx.stroke();
  ctx.restore();
}

function drawShellRear(ctx) {
  ctx.save();
  ctx.translate(-23, -39);
  const gradient = ctx.createRadialGradient(-8, -10, 2, 0, 0, 32);
  gradient.addColorStop(0, PALETTE.cream);
  gradient.addColorStop(0.38, PALETTE.shell);
  gradient.addColorStop(1, PALETTE.shellDeep);
  ellipsePath(ctx, 0, 0, 31, 29);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.strokeStyle = '#8B5944';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(9, -4);
  ctx.bezierCurveTo(8, -15, -9, -17, -14, -7);
  ctx.bezierCurveTo(-21, 6, -4, 16, 9, 10);
  ctx.bezierCurveTo(20, 5, 20, -7, 15, -13);
  ctx.stroke();
  ctx.restore();
}

function drawNeedleRear(ctx) {
  drawCrystal(ctx, [[-31, -48], [-52, -61], [-40, -31]], PALETTE.crystal);
  drawCrystal(ctx, [[-7, -70], [-2, -94], [9, -70]], PALETTE.crystalLight);
  drawCrystal(ctx, [[29, -51], [50, -67], [42, -34]], PALETTE.crystal);
}

function drawBubbleRear(ctx, time, animate = true) {
  const bubbles = [
    [-29, -66, 10, 0.4],
    [26, -77, 8, 1.7],
    [39, -49, 6, 2.6],
  ];
  for (const [bx, by, radius, phase] of bubbles) {
    const floatY = animate ? Math.sin(time * 2.2 + phase) * 2 : 0;
    ctx.save();
    ctx.globalAlpha *= 0.68;
    ctx.fillStyle = '#BDEFFF';
    ctx.strokeStyle = PALETTE.bubbleDeep;
    ctx.lineWidth = 2.4;
    ellipsePath(ctx, bx, by + floatY, radius, radius);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha *= 0.75;
    ctx.fillStyle = PALETTE.white;
    ellipsePath(ctx, bx - radius * 0.28, by - radius * 0.28 + floatY, radius * 0.22, radius * 0.28);
    ctx.fill();
    ctx.restore();
  }
}

function drawSproutTop(ctx, time, animate = true) {
  ctx.save();
  ctx.translate(0, -70);
  ctx.rotate(animate ? Math.sin(time * 2.4) * 0.05 : 0);
  ctx.strokeStyle = PALETTE.sproutDeep;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 5);
  ctx.quadraticCurveTo(-1, -6, 1, -14);
  ctx.stroke();
  ctx.fillStyle = PALETTE.sprout;
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.bezierCurveTo(-7, -18, -21, -17, -20, -5);
  ctx.bezierCurveTo(-12, 0, -5, -2, 0, -7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(1, -11);
  ctx.bezierCurveTo(9, -21, 22, -17, 20, -6);
  ctx.bezierCurveTo(14, 0, 6, -3, 1, -11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawSlimeAccessoryFront(ctx, variant, options) {
  if (variant === 'shell') {
    ctx.save();
    ctx.fillStyle = PALETTE.shell;
    ctx.strokeStyle = PALETTE.inkSoft;
    ctx.lineWidth = 3;
    roundedRectPath(ctx, -39, -27, 11, 22, 5);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else if (variant === 'needle') {
    drawCrystal(ctx, [[30, -23], [51, -31], [37, -10]], PALETTE.crystalLight, PALETTE.inkSoft, 2.8);
  } else if (variant === 'bubble') {
    ctx.save();
    ctx.globalAlpha *= 0.64;
    const halo = ctx.createRadialGradient(-8, -54, 4, 0, -48, 34);
    halo.addColorStop(0, 'rgba(255,255,255,0.1)');
    halo.addColorStop(1, '#BCEEFF');
    ellipsePath(ctx, 0, -48, 35, 31);
    ctx.fillStyle = halo;
    ctx.fill();
    ctx.strokeStyle = PALETTE.bubbleDeep;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = PALETTE.bubbleDeep;
    ellipsePath(ctx, 8, -23, 4, 3);
    ctx.fill();
    ctx.restore();
  } else if (variant === 'sprout') {
    ctx.save();
    ctx.fillStyle = '#D9A961';
    ctx.strokeStyle = PALETTE.inkSoft;
    ctx.lineWidth = 2.8;
    roundedRectPath(ctx, 23, -31, 17, 22, 6);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = PALETTE.cream;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(27, -25);
    ctx.lineTo(36, -16);
    ctx.stroke();
    ctx.restore();
  }
}

const SHELL_POSE_PIVOTS = Object.freeze({
  root: [0, 0],
  body: [0, 0],
  shell: [-23, -39],
  face: [0, -33],
  front: [-33.5, -16],
});

const CRYSTAL_POSE_PIVOTS = Object.freeze({
  root: [0, 0],
  body: [0, 0],
  needles: [0, -58],
  face: [0, -33],
  front: [40, -21],
});

const BUBBLE_POSE_PIVOTS = Object.freeze({
  root: [0, 0],
  body: [0, 0],
  bubbles: [0, -65],
  halo: [0, -48],
  face: [0, -33],
});

const SPROUT_POSE_PIVOTS = Object.freeze({
  root: [0, 0],
  body: [0, 0],
  sprout: [0, -70],
  pack: [31.5, -20],
  face: [0, -33],
});

function resolveSlimeBodyOptions(options, colors) {
  const [color, deepColor, lightColor] = colors;
  return {
    ...options,
    color,
    deepColor,
    lightColor,
    expression: options.expression || (options.hit > 0.5 ? 'hurt' : 'normal'),
  };
}

function drawShellSlimePosedLocal(ctx, options, colors) {
  const bodyOptions = resolveSlimeBodyOptions(options, colors);
  const pose = options.pose;

  withPoseBone(ctx, pose, 'root', ...SHELL_POSE_PIVOTS.root, () => {
    withPoseBone(ctx, pose, 'body', ...SHELL_POSE_PIVOTS.body, () => {
      withPoseBone(ctx, pose, 'shell', ...SHELL_POSE_PIVOTS.shell, () => {
        drawShellRear(ctx);
      });

      drawGooBodyLocal(ctx, { ...bodyOptions, face: false });

      if (options.face !== false) {
        withPoseBone(ctx, pose, 'face', ...SHELL_POSE_PIVOTS.face, () => {
          drawFace(ctx, bodyOptions.expression, bodyOptions);
        });
      }

      withPoseBone(ctx, pose, 'front', ...SHELL_POSE_PIVOTS.front, () => {
        drawSlimeAccessoryFront(ctx, 'shell', options);
      });
    });
  });
}

function drawCrystalSlimePosedLocal(ctx, options, colors) {
  const bodyOptions = resolveSlimeBodyOptions(options, colors);
  const pose = options.pose;

  withPoseBone(ctx, pose, 'root', ...CRYSTAL_POSE_PIVOTS.root, () => {
    withPoseBone(ctx, pose, 'body', ...CRYSTAL_POSE_PIVOTS.body, () => {
      withPoseBone(ctx, pose, 'needles', ...CRYSTAL_POSE_PIVOTS.needles, () => {
        drawNeedleRear(ctx);
      });

      drawGooBodyLocal(ctx, { ...bodyOptions, face: false });

      if (options.face !== false) {
        withPoseBone(ctx, pose, 'face', ...CRYSTAL_POSE_PIVOTS.face, () => {
          drawFace(ctx, bodyOptions.expression, bodyOptions);
        });
      }

      withPoseBone(ctx, pose, 'front', ...CRYSTAL_POSE_PIVOTS.front, () => {
        drawSlimeAccessoryFront(ctx, 'needle', options);
      });
    });
  });
}

function drawBubbleSlimePosedLocal(ctx, options, colors) {
  const bodyOptions = resolveSlimeBodyOptions(options, colors);
  const pose = options.pose;

  withPoseBone(ctx, pose, 'root', ...BUBBLE_POSE_PIVOTS.root, () => {
    withPoseBone(ctx, pose, 'body', ...BUBBLE_POSE_PIVOTS.body, () => {
      withPoseBone(ctx, pose, 'bubbles', ...BUBBLE_POSE_PIVOTS.bubbles, () => {
        drawBubbleRear(ctx, 0, false);
      });

      drawGooBodyLocal(ctx, { ...bodyOptions, face: false });

      if (options.face !== false) {
        withPoseBone(ctx, pose, 'face', ...BUBBLE_POSE_PIVOTS.face, () => {
          drawFace(ctx, bodyOptions.expression, bodyOptions);
        });
      }

      withPoseBone(ctx, pose, 'halo', ...BUBBLE_POSE_PIVOTS.halo, () => {
        drawSlimeAccessoryFront(ctx, 'bubble', options);
      });
    });
  });
}

function drawSproutSlimePosedLocal(ctx, options, colors) {
  const bodyOptions = resolveSlimeBodyOptions(options, colors);
  const pose = options.pose;

  withPoseBone(ctx, pose, 'root', ...SPROUT_POSE_PIVOTS.root, () => {
    withPoseBone(ctx, pose, 'body', ...SPROUT_POSE_PIVOTS.body, () => {
      drawGooBodyLocal(ctx, { ...bodyOptions, face: false });

      if (options.face !== false) {
        withPoseBone(ctx, pose, 'face', ...SPROUT_POSE_PIVOTS.face, () => {
          drawFace(ctx, bodyOptions.expression, bodyOptions);
        });
      }

      withPoseBone(ctx, pose, 'sprout', ...SPROUT_POSE_PIVOTS.sprout, () => {
        drawSproutTop(ctx, 0, false);
      });
      withPoseBone(ctx, pose, 'pack', ...SPROUT_POSE_PIVOTS.pack, () => {
        drawSlimeAccessoryFront(ctx, 'sprout', options);
      });
    });
  });
}

export function slimeEvolutionProfile(variant, star = 1) {
  const type = ['shell', 'needle', 'bubble', 'sprout'].includes(variant) ? variant : 'shell';
  const level = clamp(Math.floor(safeNumber(star, 1)), 1, 4);
  return Object.freeze({
    type,
    level,
    surfaceLayers: level >= 2 ? 3 : 0,
    internalOnly: false,
    changesSilhouette: false,
    componentReplacements: 0,
    armorLayers: level >= 2 ? 3 : 0,
    basePartsPreserved: true,
    addsVolume: false,
    mainRings: type === 'bubble' ? 1 : 0,
  });
}

const SLIME_EVOLUTION_ARMOR_ATLAS_KEY = Object.freeze({
  shell: 'evolution-shell-armor-v3',
  needle: 'evolution-needle-armor-v3',
  bubble: 'evolution-bubble-armor-v3',
  sprout: 'evolution-sprout-armor-v3',
});

const SLIME_EVOLUTION_ATLAS_SIZE = 768;
const SLIME_EVOLUTION_CELL_SIZE = 256;
const EMPTY_EVOLUTION_CELLS = Object.freeze({});
const EMPTY_EVOLUTION_SLOTS = Object.freeze([]);

function evolutionRect(x, y, width, height) {
  return Object.freeze({ x, y, width, height });
}

function evolutionArmorSlot(id, bone, z, bindRect) {
  return Object.freeze({
    id,
    bone,
    z,
    bindRect: evolutionRect(bindRect.x, bindRect.y, bindRect.width, bindRect.height),
  });
}

// Every slot is an additive, physical armour cutout. The original rig parts
// remain present at every star, so upgrading never redraws the slime, its
// expression, or its signature accessory. Z values place each guard directly
// above the authored part it protects while keeping body armour below the
// independent eyes and mouth layers.
const SLIME_EVOLUTION_ARMOR_SLOTS = Object.freeze({
  shell: Object.freeze([
    evolutionArmorSlot('rear', 'shellBack', -9, {
      x: -91, y: -120, width: 124, height: 110,
    }),
    evolutionArmorSlot('body', 'body', 4, {
      x: -48, y: -24, width: 96, height: 24,
    }),
    evolutionArmorSlot('front', 'shellFront', 6, {
      x: -54, y: -91, width: 58, height: 46,
    }),
  ]),
  needle: Object.freeze([
    evolutionArmorSlot('rear', 'needles', -5, {
      x: -77.038, y: -113.835, width: 118.155, height: 106.126,
    }),
    evolutionArmorSlot('body', 'body', 5, {
      x: -46, y: -22, width: 92, height: 22,
    }),
    evolutionArmorSlot('front', 'front', 31, {
      x: -22.38, y: -32.709, width: 28.75, height: 22.75,
    }),
  ]),
  bubble: Object.freeze([
    evolutionArmorSlot('rear', 'bubbles', -23, {
      x: 3, y: -104, width: 52, height: 31,
    }),
    evolutionArmorSlot('body', 'body', 5, {
      x: -47, y: -24, width: 94, height: 32,
    }),
    // The base ring stays in the rig. This cell contains disconnected clamp
    // plates only, never another closed ring.
    evolutionArmorSlot('front', 'ring', 31, {
      x: -58, y: -30, width: 116, height: 50,
    }),
  ]),
  sprout: Object.freeze([
    evolutionArmorSlot('rear', 'sprout', 33, {
      x: -31, y: -112, width: 76, height: 38,
    }),
    evolutionArmorSlot('body', 'body', 5, {
      x: -47, y: -26.079, width: 94, height: 26,
    }),
    evolutionArmorSlot('front', 'pack', 41, {
      x: 12.812, y: -52.348, width: 48, height: 43,
    }),
  ]),
});

function createSlimeEvolutionArmorLayout(variant, star) {
  const type = ['shell', 'needle', 'bubble', 'sprout'].includes(variant) ? variant : 'shell';
  const level = clamp(Math.floor(safeNumber(star, 1)), 1, 4);
  const key = SLIME_EVOLUTION_ARMOR_ATLAS_KEY[type];
  if (level <= 1) {
    return Object.freeze({
      type,
      level,
      key,
      atlasSize: SLIME_EVOLUTION_ATLAS_SIZE,
      cellSize: SLIME_EVOLUTION_CELL_SIZE,
      row: null,
      cells: EMPTY_EVOLUTION_CELLS,
      slots: EMPTY_EVOLUTION_SLOTS,
    });
  }

  const row = level - 2;
  const cells = {};
  const slots = SLIME_EVOLUTION_ARMOR_SLOTS[type].map((slot, column) => {
    const sourceRect = evolutionRect(
      column * SLIME_EVOLUTION_CELL_SIZE,
      row * SLIME_EVOLUTION_CELL_SIZE,
      SLIME_EVOLUTION_CELL_SIZE,
      SLIME_EVOLUTION_CELL_SIZE,
    );
    cells[slot.id] = sourceRect;
    return Object.freeze({
      ...slot,
      partId: `armor-${type}-${slot.id}-${level}-star`,
      sourceRect,
    });
  });
  return Object.freeze({
    type,
    level,
    key,
    atlasSize: SLIME_EVOLUTION_ATLAS_SIZE,
    cellSize: SLIME_EVOLUTION_CELL_SIZE,
    row,
    cells: Object.freeze(cells),
    slots: Object.freeze(slots),
  });
}

const SLIME_EVOLUTION_ARMOR_LAYOUTS = Object.freeze(Object.fromEntries(
  Object.keys(SLIME_EVOLUTION_ARMOR_ATLAS_KEY).map((type) => [
    type,
    Object.freeze(Object.fromEntries(
      [1, 2, 3, 4].map((level) => [
        level,
        createSlimeEvolutionArmorLayout(type, level),
      ]),
    )),
  ]),
));

export function slimeEvolutionArmorLayout(variant, star = 1) {
  const type = ['shell', 'needle', 'bubble', 'sprout'].includes(variant) ? variant : 'shell';
  const level = clamp(Math.floor(safeNumber(star, 1)), 1, 4);
  return SLIME_EVOLUTION_ARMOR_LAYOUTS[type][level];
}

// Compatibility alias for callers that consumed the earlier layout helper.
// The returned v3 slots are additive armour and never contain `replaces`.
export const slimeEvolutionComponentLayout = slimeEvolutionArmorLayout;

function resolveSlimeEvolutionArmorAtlas(assetStore, layout) {
  if (layout.level <= 1 || !assetStore || typeof assetStore.useOrFallback !== 'function') {
    return null;
  }
  let atlas = null;
  const { key } = layout;
  assetStore.useOrFallback(key, (asset) => {
    const width = Number(asset?.naturalWidth || asset?.width);
    const height = Number(asset?.naturalHeight || asset?.height);
    if (width < SLIME_EVOLUTION_ATLAS_SIZE || height < SLIME_EVOLUTION_ATLAS_SIZE) {
      throw new TypeError(
        `Evolution armor atlas ${key} must be at least ${SLIME_EVOLUTION_ATLAS_SIZE}x${SLIME_EVOLUTION_ATLAS_SIZE}.`,
      );
    }
    atlas = asset;
  }, () => {});
  return atlas;
}

const ARMORED_RIG_ASSET_CACHE = new WeakMap();

function armoredSlimeRigAsset(rigAsset, atlas, layout) {
  if (!rigAsset || !atlas || !Array.isArray(rigAsset.parts) || layout.level <= 1) return null;
  let cache = ARMORED_RIG_ASSET_CACHE.get(rigAsset);
  if (!cache) {
    cache = new Map();
    ARMORED_RIG_ASSET_CACHE.set(rigAsset, cache);
  }
  const cacheKey = `${layout.type}:${layout.level}`;
  const cached = cache.get(cacheKey);
  if (cached?.atlas === atlas) return cached.rigAsset;

  const parts = [...rigAsset.parts];
  for (const slot of layout.slots) {
    parts.push(Object.freeze({
      id: slot.partId,
      bone: slot.bone,
      z: slot.z,
      image: atlas,
      sourceRect: slot.sourceRect,
      bindRect: slot.bindRect,
      required: true,
    }));
  }
  parts.sort((left, right) => safeNumber(left.z, 0) - safeNumber(right.z, 0));
  const armored = Object.freeze({
    ...rigAsset,
    parts: Object.freeze(parts),
  });
  cache.set(cacheKey, Object.freeze({ atlas, rigAsset: armored }));
  return armored;
}

/**
 * Draw one of four friendly slimes.
 * `variantOrOptions`: 'shell' | 'needle' | 'bubble' | 'sprout', or an options object.
 */
export function drawSlime(ctx, x, y, size, variantOrOptions = 'shell', maybeOptions = {}) {
  const [variantRaw, options] = resolveVariant(variantOrOptions, maybeOptions, 'shell');
  const variant = ['shell', 'needle', 'bubble', 'sprout'].includes(variantRaw) ? variantRaw : 'shell';
  const time = safeNumber(options.time, 0);
  const idle = options.animate === false || options.pose
    ? 0
    : Math.sin(time * 3.1 + (options.phase || 0)) * 0.025;
  const squash = clamp(safeNumber(options.squash, 0) + idle, -0.18, 0.2);
  const hop = safeNumber(options.hop, 0) * size;
  const colors = {
    shell: [PALETTE.friendly, PALETTE.friendlyDeep, PALETTE.friendlyLight],
    needle: ['#75D5C6', '#338F89', '#D0FFF4'],
    bubble: [PALETTE.bubble, PALETTE.bubbleDeep, '#D6F8FF'],
    sprout: ['#82D47D', PALETTE.sproutDeep, '#DBFFD0'],
  };
  const [color, deepColor, lightColor] = colors[variant];
  const ownerId = SLIME_OWNER_BY_VARIANT[variant];
  const requestedFacing = resolveCharacterGameplayFacing(ownerId, options.facing);
  const evolution = slimeEvolutionProfile(variant, options.star);
  const evolutionLayout = slimeEvolutionArmorLayout(variant, evolution.level);
  const evolutionAtlas = resolveSlimeEvolutionArmorAtlas(
    options.assetStore,
    evolutionLayout,
  );
  const rigAsset = evolution.level <= 1
    ? options.rigAsset
    : armoredSlimeRigAsset(options.rigAsset, evolutionAtlas, evolutionLayout);

  drawSelectionRing(ctx, x, y, size, options);
  drawSoftShadow(ctx, x, y + size * 0.015, size, {
    width: size * (variant === 'shell' ? 0.84 : 0.72),
    height: size * 0.15,
    alpha: 0.21 * (1 - clamp(options.hop || 0) * 0.45),
  });
  if ((options.shield || 0) > 0) {
    drawAssetOrFallback(ctx, options.assetStore, 'effect-shield-dome', (asset) => {
      ctx.globalAlpha *= clamp(options.shield) * 0.58;
      ctx.drawImage(asset, x - size * 0.55, y - size * 0.98, size * 1.1, size * 1.1);
    }, () => {
      ctx.globalAlpha *= clamp(options.shield) * 0.55;
      ctx.strokeStyle = PALETTE.shield;
      ctx.lineWidth = Math.max(2, size * 0.035);
      ellipsePath(ctx, x, y - size * 0.39, size * 0.48, size * 0.44);
      ctx.stroke();
    });
  }

  ctx.save();
  ctx.globalAlpha *= options.disabled ? 0.48 : clamp(options.alpha ?? 1);
  ctx.translate(x, y - hop);
  const unit = size / 100;
  const rigScale = characterWorldScale(ownerId);
  let renderedRig = false;
  const rig = SLIME_RIG_BY_VARIANT[variant];
  if (isCompatibleRigAsset(rig, rigAsset)) {
    ctx.save();
    ctx.scale(
      unit * rigScale * characterFacingMultiplier(
        ownerId,
        rigAsset.canonicalFacing,
        requestedFacing,
      ) * (1 + squash * 0.55),
      unit * rigScale * (1 - squash),
    );
    renderedRig = renderCompatibleRigAsset(
      ctx,
      rig,
      options.pose,
      rigAsset,
      options.expressionSample
        ?? options.expression
        ?? (options.hit > 0.5 ? 'hurt' : null),
    );
    ctx.restore();
  }
  if (options.requireLayeredRig === true && !renderedRig) {
    ctx.restore();
    throw new Error(`Required layered rig could not render: ${ownerId}`);
  }
  const renderedStandalone = renderedRig || options.allowGeneratedStandalone === false
    ? false
    : drawGeneratedCharacterStandalone(ctx, options.assetStore, ownerId, size, requestedFacing);
  if (!renderedRig && !renderedStandalone) {
    ctx.save();
    ctx.scale(unit * requestedFacing * (1 + squash * 0.55), unit * (1 - squash));
    if (options.pose) {
      if (variant === 'shell') drawShellSlimePosedLocal(ctx, options, colors[variant]);
      if (variant === 'needle') drawCrystalSlimePosedLocal(ctx, options, colors[variant]);
      if (variant === 'bubble') drawBubbleSlimePosedLocal(ctx, options, colors[variant]);
      if (variant === 'sprout') drawSproutSlimePosedLocal(ctx, options, colors[variant]);
    } else {
      if (variant === 'shell') drawShellRear(ctx);
      if (variant === 'needle') drawNeedleRear(ctx);
      if (variant === 'bubble') drawBubbleRear(ctx, time);

      drawGooBodyLocal(ctx, {
        ...options,
        color,
        deepColor,
        lightColor,
        expression: options.expression || (options.hit > 0.5 ? 'hurt' : 'normal'),
      });
      if (variant === 'sprout') drawSproutTop(ctx, time);
      drawSlimeAccessoryFront(ctx, variant, options);
    }
    ctx.restore();
  }
  ctx.restore();
}

export const drawShellSlime = (ctx, x, y, size, options = {}) => drawSlime(ctx, x, y, size, 'shell', options);
export const drawNeedleSlime = (ctx, x, y, size, options = {}) => drawSlime(ctx, x, y, size, 'needle', options);
export const drawBubbleSlime = (ctx, x, y, size, options = {}) => drawSlime(ctx, x, y, size, 'bubble', options);
export const drawSproutSlime = (ctx, x, y, size, options = {}) => drawSlime(ctx, x, y, size, 'sprout', options);

const SOLDIER_ATLAS_SIZE = 1254;
const SOLDIER_ATLAS_CELL = 418;
const SOLDIER_ATLAS_CACHE = new WeakMap();
const SOLDIER_LAYER_INDEX = Object.freeze({
  body: 0,
  headgear: 1,
  equipment: 2,
  normalEyes: 3,
  normalMouth: 4,
  attackEyes: 5,
  attackMouth: 6,
  hurtEyes: 7,
  hurtMouth: 8,
});
const SOLDIER_BIND_RECT = Object.freeze({ x: -60, y: -120, width: 120, height: 120 });

function soldierSourceRect(index) {
  return Object.freeze({
    x: (index % 3) * SOLDIER_ATLAS_CELL,
    y: Math.floor(index / 3) * SOLDIER_ATLAS_CELL,
    width: SOLDIER_ATLAS_CELL,
    height: SOLDIER_ATLAS_CELL,
  });
}

function soldierAtlasPart(id, bone, index, z, bindRect) {
  return Object.freeze({
    id, bone, z, required: true,
    sourceRect: soldierSourceRect(index),
    bindRect,
  });
}

function soldierRigAssetFor(atlas) {
  let rigAsset = SOLDIER_ATLAS_CACHE.get(atlas);
  if (rigAsset) return rigAsset;
  const faceVariant = (index) => Object.freeze({
    image: atlas,
    sourceRect: soldierSourceRect(index),
    bindRect: SOLDIER_BIND_RECT,
  });
  rigAsset = Object.freeze({
    rigId: SOLDIER_RIG.id,
    canonicalFacing: 1,
    parts: Object.freeze([
      { ...soldierAtlasPart('body', 'body', SOLDIER_LAYER_INDEX.body, 0, SOLDIER_BIND_RECT), image: atlas },
      { ...soldierAtlasPart('headgear', 'headgear', SOLDIER_LAYER_INDEX.headgear, 10, SOLDIER_BIND_RECT), image: atlas },
      { ...soldierAtlasPart('equipment', 'equipment', SOLDIER_LAYER_INDEX.equipment, 20, SOLDIER_BIND_RECT), image: atlas },
      Object.freeze({
        id: 'eyes', bone: 'eyes', z: 30, required: true, image: atlas,
        variants: Object.freeze({
          normal: faceVariant(SOLDIER_LAYER_INDEX.normalEyes),
          attack: faceVariant(SOLDIER_LAYER_INDEX.attackEyes),
          hurt: faceVariant(SOLDIER_LAYER_INDEX.hurtEyes),
        }),
      }),
      Object.freeze({
        id: 'mouth', bone: 'mouth', z: 31, required: true, image: atlas,
        variants: Object.freeze({
          normal: faceVariant(SOLDIER_LAYER_INDEX.normalMouth),
          attack: faceVariant(SOLDIER_LAYER_INDEX.attackMouth),
          hurt: faceVariant(SOLDIER_LAYER_INDEX.hurtMouth),
        }),
      }),
    ]),
  });
  SOLDIER_ATLAS_CACHE.set(atlas, rigAsset);
  return rigAsset;
}

function soldierAnimationSample(options) {
  if (options.pose && typeof options.pose === 'object') {
    const expression = options.expressionSample
      ?? options.expression
      ?? (options.hit > 0 ? 'hurt' : options.attackPulse > 0 ? 'attack' : 'normal');
    return { pose: options.pose, expression };
  }
  const requested = typeof options.state === 'string'
    ? options.state
    : options.hit > 0
      ? 'hurt'
      : options.attackPulse > 0
        ? 'attack'
        : options.moving
          ? 'move'
          : 'idle';
  const state = Object.hasOwn(SOLDIER_CLIPS, requested) ? requested : 'idle';
  const clip = SOLDIER_CLIPS[state];
  const pulse = state === 'hurt'
    ? clamp(safeNumber(options.hit, 1))
    : state === 'attack'
      ? clamp(safeNumber(options.attackPulse, 1))
      : null;
  const sampleTime = pulse == null
    ? clip.mode === 'loop'
      ? ((safeNumber(options.time, 0) % clip.duration) + clip.duration) % clip.duration
      : clamp(safeNumber(options.time, 0), 0, clip.duration)
    : (1 - pulse) * clip.duration;
  const controller = new AnimationController(SOLDIER_CLIPS, {
    base: state,
    transitionDuration: 0,
  });
  controller.update(sampleTime);
  return {
    pose: controller.sample(),
    expression: options.expression || clip.expression || 'normal',
  };
}

/**
 * Draw a formal 3x3 soldier skeletal atlas. The caller supplies the ordinary
 * asset-store key, so melee/ranged art stays independent from hero rig assets.
 */
export function drawSoldier(ctx, x, y, size, options = {}) {
  const assetKey = options.assetKey;
  const facing = safeNumber(options.facing, 1) < 0 ? -1 : 1;
  const fallbackVariant = options.variant === 'needle' || options.squadType === 'ranged'
    ? 'needle'
    : 'shell';
  const kind = fallbackVariant === 'needle' ? 'ranged' : 'melee';
  const fallback = () => drawSlime(ctx, x, y, size, fallbackVariant, {
    time: options.time,
    facing,
    hit: options.hit,
    attackPulse: options.attackPulse,
    animate: options.animate,
    assetStore: null,
    allowGeneratedStandalone: false,
  });
  if (!assetKey || !options.assetStore || typeof options.assetStore.useOrFallback !== 'function') {
    fallback();
    return false;
  }
  let rendered = false;
  const result = options.assetStore.useOrFallback(assetKey, (atlas) => {
    const width = Number(atlas?.naturalWidth || atlas?.width);
    const height = Number(atlas?.naturalHeight || atlas?.height);
    if (width !== SOLDIER_ATLAS_SIZE || height !== SOLDIER_ATLAS_SIZE) {
      throw new TypeError(
        `Soldier atlas ${assetKey} must be exactly ${SOLDIER_ATLAS_SIZE}x${SOLDIER_ATLAS_SIZE}.`,
      );
    }
    const sample = soldierAnimationSample(options);
    ctx.save();
    try {
      ctx.translate(x, y);
      ctx.scale((size / 100) * facing, size / 100);
      rendered = renderCompatibleRigAsset(
        ctx,
        SOLDIER_RIG,
        sample.pose,
        soldierRigAssetFor(atlas),
        sample.expression,
      );
    } finally {
      ctx.restore();
    }
    if (!rendered) throw new Error(`Soldier atlas ${assetKey} could not render atomically.`);
  }, fallback);
  return rendered && result !== false;
}

function drawEnemyEye(ctx, x, y, radius = 5, pupilOffset = -1) {
  ctx.save();
  ctx.fillStyle = '#F4EAF2';
  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 2.2;
  ellipsePath(ctx, x, y, radius, radius * 1.12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = PALETTE.dangerDeep;
  ellipsePath(ctx, x + pupilOffset, y + 0.6, radius * 0.4, radius * 0.53);
  ctx.fill();
  ctx.restore();
}

function enemyBlobPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(-44, -7);
  ctx.bezierCurveTo(-51, -24, -38, -43, -31, -55);
  ctx.bezierCurveTo(-19, -75, -4, -62, 8, -72);
  ctx.bezierCurveTo(23, -82, 34, -58, 43, -47);
  ctx.bezierCurveTo(56, -30, 43, -8, 34, -3);
  ctx.bezierCurveTo(18, 6, 6, 0, -7, 5);
  ctx.bezierCurveTo(-22, 10, -39, 5, -44, -7);
  ctx.closePath();
}

function drawBugMonsterLegacyLocal(ctx, options) {
  ctx.save();
  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      const yy = -34 + i * 15;
      ctx.beginPath();
      ctx.moveTo(side * 29, yy);
      ctx.quadraticCurveTo(side * (48 + i * 2), yy + 3, side * (51 - i * 2), yy + 13);
      ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.moveTo(-21, -58);
  ctx.quadraticCurveTo(-33, -80, -45, -76);
  ctx.moveTo(19, -62);
  ctx.quadraticCurveTo(31, -83, 43, -77);
  ctx.stroke();
  ctx.fillStyle = PALETTE.danger;
  for (const ax of [-45, 43]) {
    ellipsePath(ctx, ax, ax < 0 ? -76 : -77, 4, 4);
    ctx.fill();
  }
  ctx.restore();

  const gradient = ctx.createLinearGradient(-25, -72, 28, 5);
  gradient.addColorStop(0, PALETTE.enemyLight);
  gradient.addColorStop(0.55, PALETTE.enemy);
  gradient.addColorStop(1, PALETTE.enemyDeep);
  enemyBlobPath(ctx);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha *= 0.28;
  ctx.fillStyle = '#DCCCE3';
  ellipsePath(ctx, -19, -57, 8, 4);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#51445E';
  for (const spot of [[-28, -27, 5], [22, -53, 6], [31, -18, 4]]) {
    ellipsePath(ctx, spot[0], spot[1], spot[2], spot[2] * 0.75);
    ctx.fill();
  }
  drawEnemyEye(ctx, -13, -39, 5.5);
  drawEnemyEye(ctx, 11, -42, 5.5);

  ctx.strokeStyle = PALETTE.dangerDeep;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-7, -24);
  ctx.lineTo(0, -19);
  ctx.lineTo(8, -25);
  ctx.stroke();
}

const BUG_POSE_PIVOTS = Object.freeze({
  root: [0, 0],
  body: [0, 0],
  legsA: [0, -22],
  legsB: [0, -22],
  antennae: [0, -60],
  face: [0, -36],
});

function drawBugLegGroupLocal(ctx, group) {
  ctx.save();
  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      // Alternating tripods make legsA/legsB useful for a readable walk cycle.
      const belongsToA = side < 0 ? i % 2 === 0 : i % 2 === 1;
      if ((group === 'A') !== belongsToA) continue;
      const yy = -34 + i * 15;
      ctx.beginPath();
      ctx.moveTo(side * 29, yy);
      ctx.quadraticCurveTo(side * (48 + i * 2), yy + 3, side * (51 - i * 2), yy + 13);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBugAntennaeLocal(ctx) {
  ctx.save();
  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-21, -58);
  ctx.quadraticCurveTo(-33, -80, -45, -76);
  ctx.moveTo(19, -62);
  ctx.quadraticCurveTo(31, -83, 43, -77);
  ctx.stroke();
  ctx.fillStyle = PALETTE.danger;
  for (const ax of [-45, 43]) {
    ellipsePath(ctx, ax, ax < 0 ? -76 : -77, 4, 4);
    ctx.fill();
  }
  ctx.restore();
}

function drawBugBodyLocal(ctx) {
  const gradient = ctx.createLinearGradient(-25, -72, 28, 5);
  gradient.addColorStop(0, PALETTE.enemyLight);
  gradient.addColorStop(0.55, PALETTE.enemy);
  gradient.addColorStop(1, PALETTE.enemyDeep);
  enemyBlobPath(ctx);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha *= 0.28;
  ctx.fillStyle = '#DCCCE3';
  ellipsePath(ctx, -19, -57, 8, 4);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#51445E';
  for (const spot of [[-28, -27, 5], [22, -53, 6], [31, -18, 4]]) {
    ellipsePath(ctx, spot[0], spot[1], spot[2], spot[2] * 0.75);
    ctx.fill();
  }
}

function drawBugFaceLocal(ctx) {
  drawEnemyEye(ctx, -13, -39, 5.5);
  drawEnemyEye(ctx, 11, -42, 5.5);

  ctx.strokeStyle = PALETTE.dangerDeep;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-7, -24);
  ctx.lineTo(0, -19);
  ctx.lineTo(8, -25);
  ctx.stroke();
}

function drawBugMonsterPosedLocal(ctx, options) {
  const pose = options.pose;
  withPoseBone(ctx, pose, 'root', ...BUG_POSE_PIVOTS.root, () => {
    withPoseBone(ctx, pose, 'body', ...BUG_POSE_PIVOTS.body, () => {
      withPoseBone(ctx, pose, 'legsA', ...BUG_POSE_PIVOTS.legsA, () => {
        drawBugLegGroupLocal(ctx, 'A');
      });
      withPoseBone(ctx, pose, 'legsB', ...BUG_POSE_PIVOTS.legsB, () => {
        drawBugLegGroupLocal(ctx, 'B');
      });
      withPoseBone(ctx, pose, 'antennae', ...BUG_POSE_PIVOTS.antennae, () => {
        drawBugAntennaeLocal(ctx);
      });
      drawBugBodyLocal(ctx);
      withPoseBone(ctx, pose, 'face', ...BUG_POSE_PIVOTS.face, () => {
        drawBugFaceLocal(ctx);
      });
    });
  });
}

function drawBugMonsterLocal(ctx, options) {
  if (options.pose) drawBugMonsterPosedLocal(ctx, options);
  else drawBugMonsterLegacyLocal(ctx, options);
}

function mushroomStemPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(-21, -6);
  ctx.bezierCurveTo(-27, -25, -19, -51, -12, -61);
  ctx.lineTo(15, -60);
  ctx.bezierCurveTo(21, -43, 29, -18, 23, -5);
  ctx.quadraticCurveTo(8, 5, -21, -6);
  ctx.closePath();
}

function drawMushroomStemLocal(ctx) {
  ctx.fillStyle = '#D3B7B1';
  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 4;
  mushroomStemPath(ctx);
  ctx.fill();
  ctx.stroke();
}

function drawMushroomCapLocal(ctx) {
  const capGradient = ctx.createLinearGradient(-20, -94, 25, -49);
  capGradient.addColorStop(0, '#B77E99');
  capGradient.addColorStop(0.6, '#8A536E');
  capGradient.addColorStop(1, PALETTE.enemyDeep);
  ctx.beginPath();
  ctx.moveTo(-47, -56);
  ctx.bezierCurveTo(-43, -82, -25, -99, 1, -99);
  ctx.bezierCurveTo(28, -98, 47, -77, 51, -54);
  ctx.bezierCurveTo(30, -44, 13, -48, 0, -51);
  ctx.bezierCurveTo(-17, -46, -31, -45, -47, -56);
  ctx.closePath();
  ctx.fillStyle = capGradient;
  ctx.fill();
  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = '#EAB4B1';
  for (const spot of [[-24, -73, 7], [4, -87, 6], [26, -65, 8]]) {
    ellipsePath(ctx, spot[0], spot[1], spot[2], spot[2] * 0.65);
    ctx.fill();
  }
}

function drawMushroomFaceLocal(ctx) {
  drawEnemyEye(ctx, -9, -38, 4.6);
  drawEnemyEye(ctx, 10, -39, 4.6);
  ctx.strokeStyle = PALETTE.dangerDeep;
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(-5, -23);
  ctx.quadraticCurveTo(1, -29, 7, -22);
  ctx.stroke();
}

const WINDCAP_POSE_PIVOTS = Object.freeze({
  root: [0, 0],
  stem: [0, -6],
  cap: [1, -60],
  face: [0, -35],
});

function drawMushroomMonsterLegacyLocal(ctx, options) {
  const sway = Math.sin(safeNumber(options.time, 0) * 2.3 + (options.phase || 0)) * 0.035;
  ctx.save();
  ctx.rotate(sway);
  drawMushroomStemLocal(ctx);
  drawMushroomCapLocal(ctx);
  drawMushroomFaceLocal(ctx);
  ctx.restore();
}

function drawMushroomMonsterPosedLocal(ctx, options) {
  const pose = options.pose;
  withPoseBone(ctx, pose, 'root', ...WINDCAP_POSE_PIVOTS.root, () => {
    withPoseBone(ctx, pose, 'stem', ...WINDCAP_POSE_PIVOTS.stem, () => {
      drawMushroomStemLocal(ctx);
      withPoseBone(ctx, pose, 'cap', ...WINDCAP_POSE_PIVOTS.cap, () => {
        drawMushroomCapLocal(ctx);
      });
      withPoseBone(ctx, pose, 'face', ...WINDCAP_POSE_PIVOTS.face, () => {
        drawMushroomFaceLocal(ctx);
      });
    });
  });
}

function drawMushroomMonsterLocal(ctx, options) {
  if (options.pose) drawMushroomMonsterPosedLocal(ctx, options);
  else drawMushroomMonsterLegacyLocal(ctx, options);
}

function stoneBodyPath(ctx) {
  polygonPath(ctx, [[-45, -6], [-48, -40], [-31, -63], [-12, -58], [2, -77], [21, -65], [40, -51], [47, -17], [34, 1], [-22, 5]]);
}

function drawStoneBodyLocal(ctx) {
  ctx.fillStyle = '#655B69';
  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  stoneBodyPath(ctx);
  ctx.fill();
  ctx.stroke();
}

function drawStoneRocksLocal(ctx) {
  ctx.fillStyle = '#807483';
  polygonPath(ctx, [[-39, -38], [-27, -59], [-11, -55], [-4, -34], [-15, -18], [-37, -20]]);
  ctx.fill();
  polygonPath(ctx, [[4, -72], [20, -61], [35, -48], [27, -27], [7, -31], [-2, -48]]);
  ctx.fill();
  ctx.strokeStyle = '#A79BA9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-23, -53);
  ctx.lineTo(-13, -35);
  ctx.lineTo(-18, -21);
  ctx.moveTo(15, -59);
  ctx.lineTo(9, -47);
  ctx.lineTo(21, -39);
  ctx.lineTo(16, -28);
  ctx.stroke();
}

function drawStoneFaceLocal(ctx) {
  ctx.fillStyle = '#D9C66A';
  ctx.shadowColor = '#EACB61';
  ctx.shadowBlur = 6;
  polygonPath(ctx, [[-22, -38], [-11, -42], [-13, -29], [-23, -27]]);
  ctx.fill();
  polygonPath(ctx, [[9, -43], [22, -42], [19, -29], [8, -31]]);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-8, -16);
  ctx.lineTo(7, -18);
  ctx.stroke();
}

const STONE_POSE_PIVOTS = Object.freeze({
  root: [0, 0],
  body: [0, 0],
  rocks: [0, -43],
  face: [0, -34],
});

function drawStoneMonsterLegacyLocal(ctx) {
  drawStoneBodyLocal(ctx);
  drawStoneRocksLocal(ctx);
  drawStoneFaceLocal(ctx);
}

function drawStoneMonsterPosedLocal(ctx, options) {
  const pose = options.pose;
  withPoseBone(ctx, pose, 'root', ...STONE_POSE_PIVOTS.root, () => {
    withPoseBone(ctx, pose, 'body', ...STONE_POSE_PIVOTS.body, () => {
      drawStoneBodyLocal(ctx);
      withPoseBone(ctx, pose, 'rocks', ...STONE_POSE_PIVOTS.rocks, () => {
        drawStoneRocksLocal(ctx);
      });
      withPoseBone(ctx, pose, 'face', ...STONE_POSE_PIVOTS.face, () => {
        drawStoneFaceLocal(ctx);
      });
    });
  });
}

function drawStoneMonsterLocal(ctx, options) {
  if (options.pose) drawStoneMonsterPosedLocal(ctx, options);
  else drawStoneMonsterLegacyLocal(ctx);
}

function drawBossTentaclesLocal(ctx) {
  ctx.save();
  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  for (const tentacle of [
    [-32, -15, -60, 4],
    [-10, -8, -18, 13],
    [17, -9, 25, 13],
    [36, -18, 61, 0],
  ]) {
    ctx.beginPath();
    ctx.moveTo(tentacle[0], tentacle[1]);
    ctx.quadraticCurveTo((tentacle[0] + tentacle[2]) / 2, tentacle[3] - 10, tentacle[2], tentacle[3]);
    ctx.stroke();
  }
  ctx.restore();
}

function bossBodyPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(-56, -7);
  ctx.bezierCurveTo(-66, -36, -47, -66, -29, -77);
  ctx.bezierCurveTo(-15, -96, 5, -82, 17, -93);
  ctx.bezierCurveTo(38, -100, 54, -72, 61, -49);
  ctx.bezierCurveTo(72, -22, 53, 3, 27, 2);
  ctx.bezierCurveTo(7, 12, -7, 2, -25, 7);
  ctx.bezierCurveTo(-42, 10, -52, 2, -56, -7);
  ctx.closePath();
}

function drawBossBodyLocal(ctx) {
  const gradient = ctx.createRadialGradient(-18, -70, 8, 8, -41, 69);
  gradient.addColorStop(0, '#A0779D');
  gradient.addColorStop(0.52, '#694C6C');
  gradient.addColorStop(1, '#372D48');
  bossBodyPath(ctx);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 5;
  ctx.stroke();
}

function drawBossCrownLocal(ctx) {
  ctx.fillStyle = '#54415E';
  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 4;
  polygonPath(ctx, [[-34, -76], [-42, -108], [-20, -91], [-7, -115], [7, -91], [27, -111], [30, -79]]);
  ctx.fill();
  ctx.stroke();
}

function drawBossCoreLocal(ctx, pulse = 1) {
  ctx.save();
  ctx.translate(0, -44);
  ctx.scale(pulse, pulse);
  ctx.shadowColor = PALETTE.danger;
  ctx.shadowBlur = 12;
  ctx.fillStyle = PALETTE.danger;
  polygonPath(ctx, [[0, -14], [11, -3], [7, 12], [0, 18], [-9, 10], [-11, -4]]);
  ctx.fill();
  ctx.strokeStyle = '#F9A2A8';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

function drawBossFaceLocal(ctx) {
  drawEnemyEye(ctx, -27, -51, 5.5, 1);
  drawEnemyEye(ctx, 27, -53, 5.5, -1);
  drawEnemyEye(ctx, 0, -70, 4.5, 0);
  ctx.strokeStyle = PALETTE.danger;
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-12, -22);
  ctx.quadraticCurveTo(0, -12, 14, -24);
  ctx.stroke();
}

const BOSS_POSE_PIVOTS = Object.freeze({
  root: [0, 0],
  body: [0, 0],
  tentacles: [0, -6],
  crown: [0, -91],
  core: [0, -44],
  face: [0, -49],
});

function drawBossMonsterLegacyLocal(ctx, options) {
  const time = safeNumber(options.time, 0);
  const pulse = 1 + Math.sin(time * 2.5) * 0.035;
  drawBossTentaclesLocal(ctx);
  drawBossBodyLocal(ctx);
  drawBossCrownLocal(ctx);
  drawBossCoreLocal(ctx, pulse);
  drawBossFaceLocal(ctx);
}

function drawBossMonsterPosedLocal(ctx, options) {
  const pose = options.pose;
  withPoseBone(ctx, pose, 'root', ...BOSS_POSE_PIVOTS.root, () => {
    withPoseBone(ctx, pose, 'body', ...BOSS_POSE_PIVOTS.body, () => {
      withPoseBone(ctx, pose, 'tentacles', ...BOSS_POSE_PIVOTS.tentacles, () => {
        drawBossTentaclesLocal(ctx);
      });
      drawBossBodyLocal(ctx);
      withPoseBone(ctx, pose, 'crown', ...BOSS_POSE_PIVOTS.crown, () => {
        drawBossCrownLocal(ctx);
      });
      withPoseBone(ctx, pose, 'core', ...BOSS_POSE_PIVOTS.core, () => {
        drawBossCoreLocal(ctx, 1);
      });
      withPoseBone(ctx, pose, 'face', ...BOSS_POSE_PIVOTS.face, () => {
        drawBossFaceLocal(ctx);
      });
    });
  });
}

function drawBossMonsterLocal(ctx, options) {
  if (options.pose) drawBossMonsterPosedLocal(ctx, options);
  else drawBossMonsterLegacyLocal(ctx, options);
}

/**
 * Draw one of four hostile silhouettes.
 * `typeOrOptions`: 'bug' | 'mushroom' | 'stone' | 'boss', or an options object.
 */
export function drawMonster(ctx, x, y, size, typeOrOptions = 'bug', maybeOptions = {}) {
  const [typeRaw, options] = resolveVariant(typeOrOptions, maybeOptions, 'bug');
  const type = ['bug', 'mushroom', 'stone', 'boss'].includes(typeRaw) ? typeRaw : 'bug';
  const time = safeNumber(options.time, 0);
  const idle = options.animate === false || options.pose
    ? 0
    : Math.sin(time * (type === 'stone' ? 1.6 : 3) + (options.phase || 0)) * 0.02;
  const squash = clamp(safeNumber(options.squash, 0) + idle, -0.14, 0.16);
  const hop = safeNumber(options.hop, 0) * size;
  const visualSize = type === 'boss' ? size * 1.08 : size;

  drawSelectionRing(ctx, x, y, visualSize, {
    ...options,
    selectionColor: options.selectionColor || PALETTE.danger,
  });
  drawSoftShadow(ctx, x, y + visualSize * 0.015, visualSize, {
    width: visualSize * (type === 'boss' ? 0.9 : 0.74),
    height: visualSize * 0.16,
    alpha: 0.24,
  });

  ctx.save();
  ctx.globalAlpha *= options.disabled ? 0.5 : clamp(options.alpha ?? 1);
  ctx.translate(x, y - hop);
  const ownerId = MONSTER_OWNER_BY_TYPE[type];
  const requestedFacing = resolveCharacterGameplayFacing(ownerId, options.facing);
  const rigUnit = size / 100;
  const rigScale = characterWorldScale(ownerId);
  const fallbackUnit = visualSize / 100;
  let renderedRig = false;
  const rig = MONSTER_RIG_BY_TYPE[type];
  if (isCompatibleRigAsset(rig, options.rigAsset)) {
    ctx.save();
    ctx.scale(
      rigUnit * rigScale * characterFacingMultiplier(
        ownerId,
        options.rigAsset.canonicalFacing,
        requestedFacing,
      ) * (1 + squash * 0.5),
      rigUnit * rigScale * (1 - squash),
    );
    renderedRig = renderCompatibleRigAsset(
      ctx,
      rig,
      options.pose,
      options.rigAsset,
      options.expressionSample
        ?? options.expression
        ?? (options.hit > 0.5 ? 'hurt' : null),
    );
    ctx.restore();
  }
  if (options.requireLayeredRig === true && !renderedRig) {
    ctx.restore();
    throw new Error(`Required layered rig could not render: ${ownerId}`);
  }
  const renderedStandalone = renderedRig || options.allowGeneratedStandalone === false
    ? false
    : drawGeneratedCharacterStandalone(
      ctx,
      options.assetStore,
      ownerId,
      visualSize,
      requestedFacing,
    );
  if (!renderedRig && !renderedStandalone) {
    ctx.save();
    ctx.scale(
      fallbackUnit * requestedFacing * (1 + squash * 0.5),
      fallbackUnit * (1 - squash),
    );
    if (type === 'bug') drawBugMonsterLocal(ctx, options);
    if (type === 'mushroom') drawMushroomMonsterLocal(ctx, options);
    if (type === 'stone') drawStoneMonsterLocal(ctx, options);
    if (type === 'boss') drawBossMonsterLocal(ctx, options);
    ctx.restore();
  }

  if ((options.hit || 0) > 0 && !renderedStandalone) {
    ctx.save();
    const hitUnit = renderedRig ? rigUnit * rigScale : fallbackUnit;
    ctx.scale(hitUnit * requestedFacing * (1 + squash * 0.5), hitUnit * (1 - squash));
    ctx.globalAlpha *= clamp(options.hit) * 0.5;
    ctx.fillStyle = PALETTE.white;
    if (options.pose) {
      const posedHitShape = {
        bug: [BUG_POSE_PIVOTS, 'body', enemyBlobPath],
        mushroom: [WINDCAP_POSE_PIVOTS, 'stem', mushroomStemPath],
        stone: [STONE_POSE_PIVOTS, 'body', stoneBodyPath],
        boss: [BOSS_POSE_PIVOTS, 'body', bossBodyPath],
      }[type];
      const [pivots, bodyBone, path] = posedHitShape;
      withPoseBone(ctx, options.pose, 'root', ...pivots.root, () => {
        withPoseBone(ctx, options.pose, bodyBone, ...pivots[bodyBone], () => {
          path(ctx);
          ctx.fill();
        });
      });
    } else {
      if (type === 'bug') enemyBlobPath(ctx);
      else {
        ellipsePath(ctx, 0, type === 'boss' ? -45 : -43, type === 'boss' ? 55 : 42, type === 'boss' ? 52 : 42);
      }
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();

  if ((options.shield || 0) > 0) {
    ctx.save();
    ctx.globalAlpha *= clamp(options.shield) * 0.5;
    ctx.strokeStyle = '#B69AD0';
    ctx.lineWidth = Math.max(2, visualSize * 0.035);
    ellipsePath(ctx, x, y - visualSize * 0.42, visualSize * 0.5, visualSize * 0.46);
    ctx.stroke();
    ctx.restore();
  }
}

export const drawBugMonster = (ctx, x, y, size, options = {}) => drawMonster(ctx, x, y, size, 'bug', options);
export const drawMushroomMonster = (ctx, x, y, size, options = {}) => drawMonster(ctx, x, y, size, 'mushroom', options);
export const drawStoneMonster = (ctx, x, y, size, options = {}) => drawMonster(ctx, x, y, size, 'stone', options);
export const drawBossMonster = (ctx, x, y, size, options = {}) => drawMonster(ctx, x, y, size, 'boss', options);

function drawToyFoundationLocal(ctx, width = 88, options = {}) {
  const top = options.top || PALETTE.tileLight;
  const front = options.front || '#C7AD7E';
  ctx.save();
  ctx.fillStyle = front;
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 3.5;
  roundedRectPath(ctx, -width / 2 - 4, -18, width + 8, 23, 9);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = top;
  roundedRectPath(ctx, -width / 2, -23, width, 19, 8);
  ctx.fill();
  ctx.stroke();
  ctx.save();
  ctx.globalAlpha *= 0.36;
  ctx.strokeStyle = PALETTE.white;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-width / 2 + 10, -19);
  ctx.lineTo(width / 2 - 10, -19);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function drawHutLocal(ctx, options) {
  drawToyFoundationLocal(ctx, 84);
  ctx.fillStyle = '#F1D69A';
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 3.6;
  roundedRectPath(ctx, -31, -67, 62, 50, 12);
  ctx.fill();
  ctx.stroke();

  const roofGradient = ctx.createLinearGradient(-28, -105, 26, -55);
  roofGradient.addColorStop(0, '#F39A85');
  roofGradient.addColorStop(1, '#C9676C');
  ctx.beginPath();
  ctx.moveTo(-43, -67);
  ctx.bezierCurveTo(-40, -91, -22, -107, 1, -108);
  ctx.bezierCurveTo(27, -106, 42, -89, 45, -65);
  ctx.bezierCurveTo(27, -56, -21, -55, -43, -67);
  ctx.closePath();
  ctx.fillStyle = roofGradient;
  ctx.fill();
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = PALETTE.cream;
  for (const spot of [[-20, -82, 7], [6, -95, 6], [24, -76, 8]]) {
    ellipsePath(ctx, spot[0], spot[1], spot[2], spot[2] * 0.62);
    ctx.fill();
  }

  ctx.fillStyle = '#8A6850';
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 3;
  roundedRectPath(ctx, -11, -48, 22, 31, 9);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = PALETTE.ultimateLight;
  ellipsePath(ctx, 5, -32, 2.4, 2.4);
  ctx.fill();
  ctx.fillStyle = '#9BD9E6';
  roundedRectPath(ctx, -27, -56, 12, 13, 4);
  ctx.fill();
  ctx.stroke();
}

function drawFarmLocal(ctx, options) {
  drawToyFoundationLocal(ctx, 98, { top: '#C99C65', front: '#A87852' });
  ctx.save();
  ctx.strokeStyle = '#815C43';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (const xx of [-29, 0, 29]) {
    ctx.beginPath();
    ctx.moveTo(xx - 12, -15);
    ctx.lineTo(xx + 11, -42);
    ctx.stroke();
  }
  const sway = Math.sin(safeNumber(options.time, 0) * 2.1) * 1.5;
  for (const plant of [[-29, -34], [0, -46], [29, -35]]) {
    ctx.save();
    ctx.translate(plant[0], plant[1]);
    ctx.rotate(sway * 0.015);
    ctx.strokeStyle = PALETTE.sproutDeep;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.lineTo(0, -8);
    ctx.stroke();
    ctx.fillStyle = PALETTE.sprout;
    ctx.strokeStyle = PALETTE.inkSoft;
    ctx.lineWidth = 1.8;
    ellipsePath(ctx, -5, -3, 6, 3.5);
    ctx.fill();
    ctx.stroke();
    ellipsePath(ctx, 5, -7, 6, 3.5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PALETTE.ultimate;
    ellipsePath(ctx, 0, -11, 5, 5);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawTowerLocal(ctx, options) {
  drawToyFoundationLocal(ctx, 77);
  ctx.save();
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-20, -20);
  ctx.lineTo(-13, -59);
  ctx.moveTo(20, -20);
  ctx.lineTo(13, -59);
  ctx.moveTo(-16, -39);
  ctx.lineTo(16, -39);
  ctx.stroke();

  const tankGradient = ctx.createRadialGradient(-12, -80, 5, 3, -72, 38);
  tankGradient.addColorStop(0, '#E5FAFF');
  tankGradient.addColorStop(0.35, PALETTE.bubble);
  tankGradient.addColorStop(1, PALETTE.bubbleDeep);
  ellipsePath(ctx, 0, -77, 35, 31);
  ctx.fillStyle = tankGradient;
  ctx.fill();
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.globalAlpha *= 0.5;
  ctx.fillStyle = PALETTE.white;
  ellipsePath(ctx, -12, -88, 8, 5);
  ctx.fill();
  ctx.globalAlpha /= 0.5;

  ctx.fillStyle = PALETTE.bubbleDeep;
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 3;
  roundedRectPath(ctx, 28, -79, 23, 11, 5);
  ctx.fill();
  ctx.stroke();
  if (options.active) {
    ctx.globalAlpha *= 0.7;
    ctx.strokeStyle = '#BDEFFF';
    ctx.lineWidth = 3;
    ellipsePath(ctx, 51, -74, 7 + Math.sin(safeNumber(options.time, 0) * 6) * 2, 7);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFenceLocal(ctx, options) {
  drawToyFoundationLocal(ctx, 106, { top: '#D8C89B', front: '#BDA772' });
  ctx.save();
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineJoin = 'round';
  const posts = [-42, 42];
  for (const xx of posts) {
    ctx.fillStyle = '#D7925D';
    ctx.lineWidth = 3.2;
    roundedRectPath(ctx, xx - 8, -74, 16, 59, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PALETTE.cream;
    polygonPath(ctx, [[xx - 9, -72], [xx, -83], [xx + 9, -72]]);
    ctx.fill();
    ctx.stroke();
  }
  const gelGradient = ctx.createLinearGradient(0, -66, 0, -26);
  gelGradient.addColorStop(0, '#D8FFF0');
  gelGradient.addColorStop(0.35, PALETTE.friendly);
  gelGradient.addColorStop(1, PALETTE.friendlyDeep);
  ctx.fillStyle = gelGradient;
  ctx.lineWidth = 4;
  roundedRectPath(ctx, -37, -61, 74, 28, 12);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha *= 0.42;
  ctx.fillStyle = PALETTE.white;
  roundedRectPath(ctx, -27, -56, 34, 5, 3);
  ctx.fill();
  ctx.restore();
}

function drawWeatherLocal(ctx, options) {
  drawToyFoundationLocal(ctx, 78);
  const time = safeNumber(options.time, 0);
  ctx.save();
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-21, -19);
  ctx.lineTo(0, -71);
  ctx.lineTo(23, -18);
  ctx.moveTo(-13, -39);
  ctx.lineTo(15, -39);
  ctx.stroke();

  ctx.save();
  ctx.translate(0, -71);
  ctx.rotate(options.active ? time * 0.7 : Math.sin(time) * 0.08);
  ctx.fillStyle = PALETTE.cream;
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(-4, 0);
  ctx.quadraticCurveTo(-35, -20, -37, -1);
  ctx.quadraticCurveTo(-31, 17, -4, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = PALETTE.crystal;
  ellipsePath(ctx, 0, 0, 8, 8);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -79);
  ctx.lineTo(0, -111);
  ctx.stroke();
  ctx.fillStyle = PALETTE.danger;
  ctx.beginPath();
  ctx.moveTo(2, -108);
  ctx.quadraticCurveTo(23, -113, 29, -101);
  ctx.quadraticCurveTo(17, -95, 2, -99);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawDamageCracksLocal(ctx, damage = 0) {
  if (damage <= 0.25) return;
  ctx.save();
  ctx.globalAlpha *= clamp((damage - 0.25) / 0.75) * 0.8;
  ctx.strokeStyle = PALETTE.dangerDeep;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(20, -56);
  ctx.lineTo(12, -46);
  ctx.lineTo(20, -39);
  ctx.lineTo(14, -30);
  if (damage > 0.65) {
    ctx.moveTo(-26, -48);
    ctx.lineTo(-15, -39);
    ctx.lineTo(-21, -29);
  }
  ctx.stroke();
  ctx.restore();
}

function drawDamageCracksAsset(ctx, asset, damage, x, y, width, height) {
  if (damage <= 0.25) return;
  const sourceWidth = Number(asset?.naturalWidth || asset?.width) || 512;
  const sourceHeight = Number(asset?.naturalHeight || asset?.height) || 512;
  const halfWidth = sourceWidth / 2;
  const severe = damage > 0.65;
  ctx.globalAlpha *= clamp((damage - 0.25) / 0.75) * 0.86;
  ctx.drawImage(
    asset,
    severe ? halfWidth : 0,
    0,
    halfWidth,
    sourceHeight,
    x,
    y,
    width,
    height,
  );
}

const BUILDING_ASSET_BY_TYPE = Object.freeze({
  hut: 'building-mushroom-home',
  farm: 'building-honey-plot',
  tower: 'building-bubble-tower',
  fence: 'building-bouncy-fence',
  weather: 'building-weather-scout',
  paver: 'building-gel-foundation',
});

const BUILDING_GROUND_ANCHOR_Y = 246 / 256;

/**
 * Draw one formal generated building sprite, including the terrain paver.
 * `typeOrOptions`: 'hut' | 'farm' | 'tower' | 'fence' | 'weather' | 'paver', or an options object.
 */
export function drawBuilding(ctx, x, y, size, typeOrOptions = 'hut', maybeOptions = {}) {
  const [typeRaw, options] = resolveVariant(typeOrOptions, maybeOptions, 'hut');
  const type = ['hut', 'farm', 'tower', 'fence', 'weather', 'paver'].includes(typeRaw) ? typeRaw : 'hut';
  const footprintScale = 1;
  const assetKey = typeof options.assetKey === 'string' && options.assetKey
    ? options.assetKey
    : BUILDING_ASSET_BY_TYPE[type];
  const sourceRect = options.sourceRect
    && Number.isFinite(options.sourceRect.x)
    && Number.isFinite(options.sourceRect.y)
    && Number.isFinite(options.sourceRect.width)
    && Number.isFinite(options.sourceRect.height)
    ? options.sourceRect
    : null;
  const assetWidthScale = Number.isFinite(Number(options.assetWidthScale))
    && Number(options.assetWidthScale) > 0
    ? Number(options.assetWidthScale)
    : 1;
  const assetGroundAnchorY = Number.isFinite(Number(options.assetGroundAnchorY))
    ? clamp(Number(options.assetGroundAnchorY), 0, 1)
    : BUILDING_GROUND_ANCHOR_Y;
  const assetWidth = size * assetWidthScale;
  drawSelectionRing(ctx, x, y - size * 0.25, size * footprintScale, options);

  ctx.save();
  ctx.globalAlpha *= options.ghost ? 0.55 : (options.disabled ? 0.48 : clamp(options.alpha ?? 1));
  ctx.translate(x, y);
  // Placeable buildings are production art: if a required PNG cannot be
  // decoded, keep the slot empty instead of silently changing its appearance
  // to one of the old procedural stand-ins.
  drawAssetOrFallback(ctx, options.assetStore, assetKey, (asset) => {
    if (sourceRect) {
      ctx.drawImage(
        asset,
        sourceRect.x,
        sourceRect.y,
        sourceRect.width,
        sourceRect.height,
        -assetWidth / 2,
        -size,
        assetWidth,
        size,
      );
    } else {
      ctx.drawImage(
        asset,
        -assetWidth / 2,
        -size * assetGroundAnchorY,
        assetWidth,
        size,
      );
    }
  }, () => {});
  const damage = clamp(options.damage || 0);
  if (damage > 0.25) {
    drawAssetOrFallback(ctx, options.assetStore, 'effect-damage-cracks-overlay', (asset) => {
      drawDamageCracksAsset(
        ctx,
        asset,
        damage,
        -size * 0.24,
        -size * 0.88,
        size * 0.48,
        size * 0.82,
      );
    }, () => drawDamageCracksLocal(ctx, damage));
  }
  ctx.restore();
}

export const drawHut = (ctx, x, y, size, options = {}) => drawBuilding(ctx, x, y, size, 'hut', options);
export const drawFarm = (ctx, x, y, size, options = {}) => drawBuilding(ctx, x, y, size, 'farm', options);
export const drawTower = (ctx, x, y, size, options = {}) => drawBuilding(ctx, x, y, size, 'tower', options);
export const drawFence = (ctx, x, y, size, options = {}) => drawBuilding(ctx, x, y, size, 'fence', options);
export const drawWeatherStation = (ctx, x, y, size, options = {}) => drawBuilding(ctx, x, y, size, 'weather', options);

function drawCoreDamageLocal(ctx, health) {
  if (health >= 0.7) return;
  ctx.save();
  ctx.globalAlpha *= clamp((0.7 - health) / 0.7);
  ctx.strokeStyle = PALETTE.dangerDeep;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(5, -94);
  ctx.lineTo(-4, -77);
  ctx.lineTo(8, -68);
  ctx.lineTo(1, -52);
  if (health < 0.3) {
    ctx.moveTo(-17, -77);
    ctx.lineTo(-8, -66);
    ctx.lineTo(-16, -52);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw the town core. `size` is the authored height; `assetWidthScale` allows a
 * wider formal asset while its bottom-centre anchor and legacy square default
 * stay unchanged. Health is represented by `options.health` in the 0..1 range.
 */
export function drawCore(ctx, x, y, size, options = {}) {
  const health = clamp(options.health ?? 1);
  const time = safeNumber(options.time, 0);
  const pulse = 1 + Math.sin(time * 2.7) * 0.035 * health;
  const assetKey = typeof options.assetKey === 'string' && options.assetKey
    ? options.assetKey
    : 'town-soft-core';
  const assetWidthScale = Number.isFinite(Number(options.assetWidthScale))
    && Number(options.assetWidthScale) > 0
    ? Number(options.assetWidthScale)
    : 1;
  const assetWidth = size * assetWidthScale;
  drawSelectionRing(ctx, x, y, size * 1.05, options);
  drawSoftShadow(ctx, x, y + size * 0.02, size, {
    width: size * 0.88 * assetWidthScale,
    height: size * 0.19,
    alpha: 0.24,
  });

  const renderedAsset = drawAssetOrFallback(ctx, options.assetStore, assetKey, (asset) => {
    ctx.globalAlpha *= clamp(options.alpha ?? 1);
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);
    ctx.drawImage(asset, -assetWidth * 0.5, -size, assetWidth, size);
  }, () => {});
  if (renderedAsset) {
    ctx.save();
    ctx.globalAlpha *= clamp(options.alpha ?? 1);
    ctx.translate(x, y);
    ctx.scale(size / 120, size / 120);
    const damage = 1 - health;
    drawAssetOrFallback(ctx, options.assetStore, 'effect-damage-cracks-overlay', (asset) => {
      drawDamageCracksAsset(ctx, asset, damage, -27.5, -113, 55, 110);
    }, () => drawCoreDamageLocal(ctx, health));
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.globalAlpha *= clamp(options.alpha ?? 1);
  ctx.translate(x, y);
  const unit = size / 120;
  ctx.scale(unit, unit);

  ctx.fillStyle = '#B18D69';
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 4;
  roundedRectPath(ctx, -49, -21, 98, 25, 11);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = PALETTE.tileLight;
  roundedRectPath(ctx, -44, -29, 88, 19, 9);
  ctx.fill();
  ctx.stroke();

  for (const side of [-1, 1]) {
    ctx.fillStyle = '#6BAA7A';
    ctx.beginPath();
    ctx.moveTo(side * 27, -27);
    ctx.quadraticCurveTo(side * 55, -46, side * 48, -83);
    ctx.quadraticCurveTo(side * 29, -72, side * 24, -44);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(0, -61);
  ctx.scale(pulse, pulse);
  ctx.shadowColor = health < 0.3 ? PALETTE.danger : PALETTE.currency;
  ctx.shadowBlur = 18;
  const orbGradient = ctx.createRadialGradient(-12, -14, 4, 4, 3, 43);
  orbGradient.addColorStop(0, PALETTE.white);
  orbGradient.addColorStop(0.25, health < 0.3 ? '#FFA2A7' : '#A9F5FF');
  orbGradient.addColorStop(0.68, health < 0.3 ? PALETTE.danger : PALETTE.currency);
  orbGradient.addColorStop(1, health < 0.3 ? PALETTE.dangerDeep : '#347FA6');
  ellipsePath(ctx, 0, 0, 35, 39);
  ctx.fillStyle = orbGradient;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.globalAlpha *= 0.48;
  ctx.fillStyle = PALETTE.white;
  ellipsePath(ctx, -12, -15, 9, 6);
  ctx.fill();
  ctx.restore();

  const damage = 1 - health;
  drawAssetOrFallback(ctx, options.assetStore, 'effect-damage-cracks-overlay', (asset) => {
    drawDamageCracksAsset(ctx, asset, damage, -27.5, -113, 55, 110);
  }, () => drawCoreDamageLocal(ctx, health));
  ctx.restore();
}

/** Draw the hostile right-side portal. `options.open` controls its energy intensity. */
export function drawPortal(ctx, x, y, size, options = {}) {
  const time = safeNumber(options.time, 0);
  const open = clamp(options.open ?? 1);
  const pulse = 1 + Math.sin(time * 3.4) * 0.035 * open;
  drawSoftShadow(ctx, x, y + size * 0.01, size, {
    width: size * 0.82,
    height: size * 0.18,
    alpha: 0.28 * open,
  });

  const renderedAsset = drawAssetOrFallback(ctx, options.assetStore, 'rift-entry-portal', (asset) => {
    ctx.globalAlpha *= clamp(options.alpha ?? 1) * (0.55 + open * 0.45);
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);
    ctx.drawImage(asset, -size * 0.5, -size, size, size);
  }, () => {});
  if (renderedAsset) return;

  ctx.save();
  ctx.globalAlpha *= clamp(options.alpha ?? 1);
  ctx.translate(x, y);
  const unit = size / 120;
  ctx.scale(unit, unit);

  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-42, -7);
  ctx.bezierCurveTo(-52, -47, -43, -99, 0, -108);
  ctx.bezierCurveTo(43, -99, 52, -47, 42, -7);
  ctx.stroke();
  ctx.strokeStyle = '#8C70A5';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.save();
  ctx.translate(0, -51);
  ctx.scale(pulse, pulse);
  const portalGradient = ctx.createRadialGradient(0, 0, 4, 0, 0, 47);
  portalGradient.addColorStop(0, '#271F3A');
  portalGradient.addColorStop(0.55, '#4F3968');
  portalGradient.addColorStop(0.82, '#8965AE');
  portalGradient.addColorStop(1, 'rgba(137,101,174,0)');
  ctx.globalAlpha *= 0.45 + open * 0.55;
  ellipsePath(ctx, 0, 0, 39 * Math.max(0.08, open), 52);
  ctx.fillStyle = portalGradient;
  ctx.fill();
  ctx.shadowColor = PALETTE.crystal;
  ctx.shadowBlur = 12;
  ctx.strokeStyle = '#B693DD';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = '#D8C2F3';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i += 1) {
    const phase = time * (1.2 + i * 0.15) + i * 2.1;
    const radiusX = 13 + i * 8 + Math.sin(phase) * 2;
    const radiusY = 20 + i * 8;
    ctx.globalAlpha *= i === 0 ? 0.72 : 0.82;
    ctx.beginPath();
    ctx.arc(0, 0, radiusX, phase, phase + Math.PI * 1.2);
    ctx.stroke();
    ctx.globalAlpha /= i === 0 ? 0.72 : 0.82;
    if (radiusY) { /* Keeps the loop deterministic while retaining a compact spiral. */ }
  }
  ctx.restore();

  ctx.fillStyle = '#51415F';
  ctx.strokeStyle = PALETTE.enemyDeep;
  ctx.lineWidth = 3;
  for (const rock of [[-45, -10, 17], [-24, -4, 13], [27, -5, 15], [47, -11, 18]]) {
    polygonPath(ctx, [
      [rock[0] - rock[2], rock[1]],
      [rock[0] - rock[2] * 0.45, rock[1] - rock[2]],
      [rock[0] + rock[2] * 0.55, rock[1] - rock[2] * 0.9],
      [rock[0] + rock[2], rock[1]],
    ]);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

const STATUS_COLORS = Object.freeze({
  shield: [PALETTE.shield, '#D9F5FF'],
  slow: ['#5C8DD0', '#DFECFF'],
  heal: [PALETTE.heal, '#E0FFE9'],
  marked: [PALETTE.danger, '#FFE1E3'],
  sticky: [PALETTE.ultimate, '#FFF0B8'],
  stun: ['#E8B73D', '#FFF4A7'],
  bubble: [PALETTE.bubble, '#D9F8FF'],
  poison: ['#8061A7', '#E9D8FF'],
});

function drawShieldSymbol(ctx, radius) {
  ctx.beginPath();
  ctx.moveTo(0, -radius * 0.54);
  ctx.lineTo(radius * 0.48, -radius * 0.3);
  ctx.lineTo(radius * 0.39, radius * 0.28);
  ctx.quadraticCurveTo(0, radius * 0.67, -radius * 0.39, radius * 0.28);
  ctx.lineTo(-radius * 0.48, -radius * 0.3);
  ctx.closePath();
}

function drawStatusSymbol(ctx, type, radius) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.6, radius * 0.17);
  if (type === 'shield') {
    drawShieldSymbol(ctx, radius);
    ctx.stroke();
  } else if (type === 'slow') {
    for (let i = 0; i < 3; i += 1) {
      ctx.save();
      ctx.rotate(i * Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(-radius * 0.55, 0);
      ctx.lineTo(radius * 0.55, 0);
      ctx.moveTo(radius * 0.27, 0);
      ctx.lineTo(radius * 0.42, -radius * 0.17);
      ctx.moveTo(radius * 0.27, 0);
      ctx.lineTo(radius * 0.42, radius * 0.17);
      ctx.stroke();
      ctx.restore();
    }
  } else if (type === 'heal') {
    ctx.beginPath();
    ctx.moveTo(-radius * 0.5, 0);
    ctx.lineTo(radius * 0.5, 0);
    ctx.moveTo(0, -radius * 0.5);
    ctx.lineTo(0, radius * 0.5);
    ctx.stroke();
  } else if (type === 'marked') {
    ellipsePath(ctx, 0, 0, radius * 0.42, radius * 0.42);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-radius * 0.69, 0);
    ctx.lineTo(-radius * 0.29, 0);
    ctx.moveTo(radius * 0.29, 0);
    ctx.lineTo(radius * 0.69, 0);
    ctx.moveTo(0, -radius * 0.69);
    ctx.lineTo(0, -radius * 0.29);
    ctx.moveTo(0, radius * 0.29);
    ctx.lineTo(0, radius * 0.69);
    ctx.stroke();
  } else if (type === 'sticky') {
    ctx.beginPath();
    ctx.moveTo(0, -radius * 0.62);
    ctx.bezierCurveTo(radius * 0.2, -radius * 0.26, radius * 0.52, radius * 0.04, radius * 0.42, radius * 0.35);
    ctx.bezierCurveTo(radius * 0.32, radius * 0.72, -radius * 0.35, radius * 0.7, -radius * 0.44, radius * 0.34);
    ctx.bezierCurveTo(-radius * 0.53, radius * 0.03, -radius * 0.18, -radius * 0.31, 0, -radius * 0.62);
    ctx.closePath();
    ctx.stroke();
  } else if (type === 'stun') {
    polygonPath(ctx, [
      [radius * 0.08, -radius * 0.72],
      [-radius * 0.47, radius * 0.05],
      [-radius * 0.08, radius * 0.02],
      [-radius * 0.2, radius * 0.71],
      [radius * 0.5, -radius * 0.15],
      [radius * 0.08, -radius * 0.08],
    ]);
    ctx.stroke();
  } else if (type === 'bubble') {
    ellipsePath(ctx, 0, 0, radius * 0.57, radius * 0.57);
    ctx.stroke();
    ellipsePath(ctx, -radius * 0.19, -radius * 0.2, radius * 0.12, radius * 0.17);
    ctx.fill();
  } else if (type === 'poison') {
    ellipsePath(ctx, 0, -radius * 0.1, radius * 0.43, radius * 0.38);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-radius * 0.23, radius * 0.21);
    ctx.lineTo(-radius * 0.35, radius * 0.58);
    ctx.moveTo(radius * 0.23, radius * 0.21);
    ctx.lineTo(radius * 0.35, radius * 0.58);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ellipsePath(ctx, -radius * 0.16, -radius * 0.12, radius * 0.07, radius * 0.09);
    ctx.fill();
    ellipsePath(ctx, radius * 0.16, -radius * 0.12, radius * 0.07, radius * 0.09);
    ctx.fill();
  }
}

/**
 * Draw a compact, colour-and-shape coded status badge.
 * Supported types: shield, slow, heal, marked, sticky, stun, bubble, poison.
 */
export function drawStatusIcon(ctx, x, y, size, typeOrOptions = 'shield', maybeOptions = {}) {
  const [typeRaw, options] = resolveVariant(typeOrOptions, maybeOptions, 'shield');
  const type = STATUS_COLORS[typeRaw] ? typeRaw : 'shield';
  const [base, light] = STATUS_COLORS[type];
  const radius = size / 2;
  const time = safeNumber(options.time, 0);
  const pulse = options.pulse ? 1 + Math.sin(time * 5) * 0.06 : 1;
  const renderedAsset = drawAssetOrFallback(ctx, options.assetStore, `status-${type}`, (asset) => {
    ctx.globalAlpha *= clamp(options.alpha ?? 1);
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);
    if (options.shadow !== false) {
      ctx.shadowColor = 'rgba(38,54,66,0.26)';
      ctx.shadowBlur = size * 0.15;
      ctx.shadowOffsetY = size * 0.08;
    }
    ctx.drawImage(asset, -radius, -radius, size, size);
  }, () => {});
  if (renderedAsset) {
    const stacks = clamp(Math.round(options.stacks || 0), 0, 3);
    if (stacks > 0) {
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = PALETTE.panel;
      ctx.strokeStyle = PALETTE.inkSoft;
      ctx.lineWidth = Math.max(1, size * 0.035);
      const dotRadius = size * 0.085;
      for (let i = 0; i < stacks; i += 1) {
        const dx = (i - (stacks - 1) / 2) * dotRadius * 2.2;
        ellipsePath(ctx, dx, radius * 0.76, dotRadius, dotRadius);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    return;
  }
  ctx.save();
  ctx.globalAlpha *= clamp(options.alpha ?? 1);
  ctx.translate(x, y);
  ctx.scale(pulse, pulse);
  if (options.shadow !== false) {
    ctx.shadowColor = 'rgba(38,54,66,0.26)';
    ctx.shadowBlur = size * 0.15;
    ctx.shadowOffsetY = size * 0.08;
  }
  const gradient = ctx.createLinearGradient(-radius, -radius, radius, radius);
  gradient.addColorStop(0, light);
  gradient.addColorStop(0.42, base);
  gradient.addColorStop(1, base);
  ellipsePath(ctx, 0, 0, radius * 0.88, radius * 0.88);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = PALETTE.inkSoft;
  ctx.lineWidth = Math.max(1.5, size * 0.075);
  ctx.stroke();
  ctx.strokeStyle = type === 'slow' || type === 'bubble' ? PALETTE.white : PALETTE.ink;
  ctx.fillStyle = ctx.strokeStyle;
  drawStatusSymbol(ctx, type, radius * 0.74);

  const stacks = clamp(Math.round(options.stacks || 0), 0, 3);
  if (stacks > 0) {
    ctx.fillStyle = PALETTE.panel;
    ctx.strokeStyle = PALETTE.inkSoft;
    ctx.lineWidth = Math.max(1, size * 0.035);
    const dotRadius = size * 0.085;
    for (let i = 0; i < stacks; i += 1) {
      const dx = (i - (stacks - 1) / 2) * dotRadius * 2.2;
      ellipsePath(ctx, dx, radius * 0.76, dotRadius, dotRadius);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Draw a small world-space health bar without text. */
export function drawHealthBar(ctx, x, y, width, health, options = {}) {
  const value = clamp(health);
  const height = safeNumber(options.height, Math.max(5, width * 0.09));
  ctx.save();
  ctx.globalAlpha *= clamp(options.alpha ?? 1);
  roundedRectPath(ctx, x - width / 2, y - height / 2, width, height, height / 2);
  ctx.fillStyle = options.track || 'rgba(38,54,66,0.72)';
  ctx.fill();
  if (value > 0) {
    const inset = Math.max(1, height * 0.18);
    const fillWidth = Math.max(height - inset * 2, (width - inset * 2) * value);
    roundedRectPath(ctx, x - width / 2 + inset, y - height / 2 + inset, fillWidth, height - inset * 2, (height - inset * 2) / 2);
    ctx.fillStyle = options.color || (value < 0.3 ? PALETTE.danger : PALETTE.heal);
    ctx.fill();
  }
  ctx.restore();
}

/** Tear-shaped goo particle. Caller supplies world position and animation progress. */
export function drawGooParticle(ctx, x, y, size, options = {}) {
  const progress = clamp(options.progress ?? 0);
  const stretch = safeNumber(options.stretch, 1 + progress * 0.55);
  ctx.save();
  ctx.globalAlpha *= clamp(options.alpha ?? (1 - progress));
  ctx.translate(x, y);
  ctx.rotate(safeNumber(options.rotation, 0));
  ctx.scale(1, stretch);
  const radius = size / 2;
  ctx.beginPath();
  ctx.moveTo(0, -radius * 1.15);
  ctx.bezierCurveTo(radius * 0.72, -radius * 0.25, radius, radius * 0.42, 0, radius);
  ctx.bezierCurveTo(-radius, radius * 0.42, -radius * 0.72, -radius * 0.25, 0, -radius * 1.15);
  ctx.closePath();
  ctx.fillStyle = options.color || PALETTE.friendly;
  ctx.fill();
  if (options.stroke !== false) {
    ctx.strokeStyle = options.outline || PALETTE.inkSoft;
    ctx.lineWidth = Math.max(1, size * 0.12);
    ctx.stroke();
  }
  ctx.restore();
}

/** Four-point impact sparkle. */
export function drawSparkParticle(ctx, x, y, size, options = {}) {
  const progress = clamp(options.progress ?? 0);
  const scale = 0.55 + Math.sin(progress * Math.PI) * 0.65;
  ctx.save();
  ctx.globalAlpha *= clamp(options.alpha ?? (1 - progress * 0.8));
  ctx.translate(x, y);
  ctx.rotate(safeNumber(options.rotation, progress * 1.4));
  ctx.scale(scale, scale);
  polygonPath(ctx, [[0, -size], [size * 0.22, -size * 0.22], [size, 0], [size * 0.22, size * 0.22], [0, size], [-size * 0.22, size * 0.22], [-size, 0], [-size * 0.22, -size * 0.22]]);
  ctx.fillStyle = options.color || PALETTE.ultimateLight;
  ctx.fill();
  if (options.stroke) {
    ctx.strokeStyle = options.stroke;
    ctx.lineWidth = Math.max(1, size * 0.08);
    ctx.stroke();
  }
  ctx.restore();
}

/** Expanding hit/heal ring. */
export function drawRingParticle(ctx, x, y, size, options = {}) {
  const progress = clamp(options.progress ?? 0);
  const radius = size * (0.3 + progress * 0.7);
  ctx.save();
  ctx.globalAlpha *= clamp(options.alpha ?? (1 - progress));
  ctx.strokeStyle = options.color || PALETTE.currency;
  ctx.lineWidth = Math.max(1, size * 0.12 * (1 - progress * 0.55));
  ellipsePath(ctx, x, y, radius, radius * (options.flatten ?? 0.45));
  ctx.stroke();
  ctx.restore();
}

/** Tiny leaf for healing, farms and sprout effects. */
export function drawLeafParticle(ctx, x, y, size, options = {}) {
  const progress = clamp(options.progress ?? 0);
  ctx.save();
  ctx.globalAlpha *= clamp(options.alpha ?? (1 - progress * 0.75));
  ctx.translate(x, y);
  ctx.rotate(safeNumber(options.rotation, progress * 2.2));
  ctx.fillStyle = options.color || PALETTE.sprout;
  ctx.strokeStyle = options.outline || PALETTE.sproutDeep;
  ctx.lineWidth = Math.max(1, size * 0.09);
  ctx.beginPath();
  ctx.moveTo(-size * 0.62, size * 0.18);
  ctx.bezierCurveTo(-size * 0.3, -size * 0.72, size * 0.55, -size * 0.55, size * 0.63, -size * 0.05);
  ctx.bezierCurveTo(size * 0.24, size * 0.6, -size * 0.37, size * 0.6, -size * 0.62, size * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-size * 0.44, size * 0.17);
  ctx.lineTo(size * 0.39, -size * 0.22);
  ctx.stroke();
  ctx.restore();
}

/** Transparent bubble particle. */
export function drawBubbleParticle(ctx, x, y, size, options = {}) {
  const progress = clamp(options.progress ?? 0);
  ctx.save();
  ctx.globalAlpha *= clamp(options.alpha ?? (0.75 - progress * 0.55));
  ctx.fillStyle = options.fill || '#C9F5FF';
  ctx.strokeStyle = options.color || PALETTE.bubbleDeep;
  ctx.lineWidth = Math.max(1, size * 0.09);
  ellipsePath(ctx, x, y, size * 0.5, size * 0.5);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha *= 0.78;
  ctx.fillStyle = PALETTE.white;
  ellipsePath(ctx, x - size * 0.16, y - size * 0.16, size * 0.09, size * 0.12);
  ctx.fill();
  ctx.restore();
}

/** Soft ground puff. */
export function drawDustParticle(ctx, x, y, size, options = {}) {
  const progress = clamp(options.progress ?? 0);
  ctx.save();
  ctx.globalAlpha *= clamp(options.alpha ?? (0.45 * (1 - progress)));
  ctx.fillStyle = options.color || PALETTE.tileDark;
  ellipsePath(ctx, x, y, size * (0.4 + progress * 0.75), size * (0.22 + progress * 0.28));
  ctx.fill();
  ctx.restore();
}

/**
 * Draw a compact projectile: goo | needle | bubble | seed | acid.
 *
 * Preferred form: drawProjectile(ctx, x, y, size, type, options).
 * For simple entity renderers, drawProjectile(ctx, projectileObject) is also accepted;
 * the object may contain x, y, size/radius, type/variant, rotation and progress.
 */
export function drawProjectile(ctx, xOrProjectile, y, size, typeOrOptions = 'goo', maybeOptions = {}) {
  let x = xOrProjectile;
  let projectileSize = size;
  let type = typeOrOptions;
  let options = maybeOptions;
  if (xOrProjectile && typeof xOrProjectile === 'object') {
    const projectile = xOrProjectile;
    x = safeNumber(projectile.x, 0);
    y = safeNumber(projectile.y, 0);
    projectileSize = safeNumber(projectile.size ?? projectile.radius, 12);
    type = projectile.type || projectile.variant || 'goo';
    options = projectile;
  } else if (typeof typeOrOptions === 'object') {
    options = typeOrOptions || {};
    type = options.type || options.variant || 'goo';
  }
  x = safeNumber(x, 0);
  y = safeNumber(y, 0);
  projectileSize = Math.max(1, safeNumber(projectileSize, 12));
  const knownType = ['goo', 'needle', 'bubble', 'seed', 'acid'].includes(type) ? type : 'goo';
  const rotation = safeNumber(options.rotation ?? options.angle, 0);
  const progress = clamp(options.progress ?? 0);
  const star = clamp(Math.floor(safeNumber(options.star, 1)), 1, 4);

  ctx.save();
  ctx.globalAlpha *= clamp(options.alpha ?? 1);
  ctx.translate(x, y);
  ctx.rotate(rotation);
  if (star >= 2) {
    const glow = knownType === 'needle' ? '#AFA8FF'
      : knownType === 'bubble' ? '#95EAFF'
        : knownType === 'seed' ? '#B9ED7B' : '#8DE4BE';
    ctx.shadowColor = glow;
    ctx.shadowBlur = projectileSize * (0.34 + star * 0.12);
  }
  if (star >= 3) {
    ctx.save();
    ctx.globalAlpha *= 0.5;
    ctx.fillStyle = knownType === 'seed' ? '#FFF0A0' : '#E9FFFF';
    for (let index = 0; index < star - 1; index += 1) {
      const trailX = -projectileSize * (0.75 + index * 0.48);
      const trailY = (index % 2 ? 1 : -1) * projectileSize * 0.22;
      ctx.beginPath();
      ctx.arc(trailX, trailY, projectileSize * (0.14 + index * 0.025), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  if (star >= 4) {
    ctx.save();
    ctx.globalAlpha *= 0.42;
    ctx.strokeStyle = knownType === 'needle' ? '#D8D4FF'
      : knownType === 'seed' ? '#DBFFA9' : '#C8F8FF';
    ctx.lineWidth = Math.max(1.5, projectileSize * 0.11);
    ctx.beginPath();
    ctx.ellipse(0, 0, projectileSize * 0.92, projectileSize * 0.6, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  const imageScale = knownType === 'needle' ? 1.55 : knownType === 'bubble' ? 1.65 : 1.4;
  const renderedAsset = drawAssetOrFallback(
    ctx,
    options.assetStore,
    `effect-projectile-${knownType}`,
    (asset) => {
      const imageSize = projectileSize * imageScale;
      ctx.drawImage(asset, -imageSize / 2, -imageSize / 2, imageSize, imageSize);
    },
    () => {},
  );
  if (renderedAsset) {
    ctx.restore();
    return;
  }
  if (knownType === 'needle') {
    ctx.shadowColor = PALETTE.crystal;
    ctx.shadowBlur = projectileSize * 0.35;
    drawCrystal(ctx, [
      [-projectileSize * 0.72, -projectileSize * 0.25],
      [projectileSize * 0.78, 0],
      [-projectileSize * 0.72, projectileSize * 0.25],
      [-projectileSize * 0.35, 0],
    ], options.color || PALETTE.crystalLight, options.outline || PALETTE.crystal, Math.max(1, projectileSize * 0.11));
  } else if (knownType === 'bubble') {
    drawBubbleParticle(ctx, 0, 0, projectileSize * 1.55, {
      ...options,
      progress,
      alpha: options.alpha ?? 0.86,
    });
  } else if (knownType === 'seed') {
    ctx.fillStyle = options.color || '#A87643';
    ctx.strokeStyle = options.outline || PALETTE.inkSoft;
    ctx.lineWidth = Math.max(1, projectileSize * 0.11);
    ellipsePath(ctx, 0, 0, projectileSize * 0.48, projectileSize * 0.34);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PALETTE.sprout;
    ctx.beginPath();
    ctx.moveTo(-projectileSize * 0.05, -projectileSize * 0.27);
    ctx.quadraticCurveTo(projectileSize * 0.18, -projectileSize * 0.72, projectileSize * 0.5, -projectileSize * 0.46);
    ctx.quadraticCurveTo(projectileSize * 0.29, -projectileSize * 0.15, -projectileSize * 0.05, -projectileSize * 0.27);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    const acid = knownType === 'acid';
    ctx.shadowColor = acid ? '#B284D0' : PALETTE.friendly;
    ctx.shadowBlur = projectileSize * 0.35;
    const gradient = ctx.createRadialGradient(-projectileSize * 0.18, -projectileSize * 0.2, 1, 0, 0, projectileSize * 0.58);
    gradient.addColorStop(0, PALETTE.white);
    gradient.addColorStop(0.25, acid ? '#D9B7EA' : PALETTE.friendlyLight);
    gradient.addColorStop(1, options.color || (acid ? '#795595' : PALETTE.friendly));
    ellipsePath(ctx, 0, 0, projectileSize * (0.54 + progress * 0.06), projectileSize * 0.43);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = options.outline || (acid ? PALETTE.enemyDeep : PALETTE.friendlyDeep);
    ctx.lineWidth = Math.max(1, projectileSize * 0.1);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * General particle dispatcher: goo | spark | ring | leaf | bubble | dust.
 * It deliberately manages no lifetime or position; the game loop stays in control.
 */
export function drawParticle(ctx, x, y, size, typeOrOptions = 'goo', maybeOptions = {}) {
  const [typeRaw, options] = resolveVariant(typeOrOptions, maybeOptions, 'goo');
  const type = ['goo', 'spark', 'ring', 'leaf', 'bubble', 'dust'].includes(typeRaw) ? typeRaw : 'goo';
  const assetKey = {
    goo: 'effect-particle-goo-drop',
    spark: 'effect-particle-impact-spark',
    ring: 'effect-particle-expanding-ring',
    leaf: 'effect-particle-healing-leaf',
    bubble: 'effect-particle-bubble',
    dust: 'effect-particle-dust-puff',
  }[type];
  const progress = clamp(options.progress ?? 0);
  const renderedAsset = drawAssetOrFallback(ctx, options.assetStore, assetKey, (asset) => {
    ctx.globalAlpha *= clamp(options.alpha ?? (1 - progress));
    ctx.translate(x, y);
    ctx.rotate(safeNumber(options.rotation, 0));
    const width = size * (type === 'ring' || type === 'dust' ? 2 : 1.35);
    const height = size * (type === 'ring' || type === 'dust' ? 1 : 1.35);
    ctx.drawImage(asset, -width / 2, -height / 2, width, height);
  }, () => {});
  if (renderedAsset) return;
  if (type === 'goo') drawGooParticle(ctx, x, y, size, options);
  if (type === 'spark') drawSparkParticle(ctx, x, y, size, options);
  if (type === 'ring') drawRingParticle(ctx, x, y, size, options);
  if (type === 'leaf') drawLeafParticle(ctx, x, y, size, options);
  if (type === 'bubble') drawBubbleParticle(ctx, x, y, size, options);
  if (type === 'dust') drawDustParticle(ctx, x, y, size, options);
}
