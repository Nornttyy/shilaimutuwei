/**
 * Runtime presentation data for the eight generated character standalones.
 *
 * Rig-local bounds keep battlefield art inside the nominal `size` square.
 * Portrait crops remove the deliberately large transparent canvas margins so
 * the same characters remain legible and consistently sized in cards/lists.
 * Both paths preserve each character's authored aspect ratio.
 */

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export const CHARACTER_RENDER_PROFILES = deepFreeze({
  'survivor-shell-shell': {
    gameplayFacing: 1,
    worldBounds: { minX: -91, minY: -120, maxX: 51, maxY: 0 },
    portraitCanvas: { width: 512, height: 512 },
    portraitCrop: { x: 35, y: 183, width: 346, height: 294 },
  },
  'survivor-crystal-pin': {
    gameplayFacing: 1,
    worldBounds: { minX: -77.038, minY: -113.835, maxX: 51, maxY: 0.022 },
    portraitCanvas: { width: 512, height: 512 },
    portraitCrop: { x: 33, y: 145, width: 374, height: 335 },
  },
  'survivor-bubble-float': {
    gameplayFacing: 1,
    worldBounds: { minX: -58, minY: -104, maxX: 58, maxY: 20 },
    portraitCanvas: { width: 512, height: 512 },
    portraitCrop: { x: 53, y: 36, width: 406, height: 418 },
  },
  'survivor-moss-sprout': {
    gameplayFacing: 1,
    worldBounds: { minX: -51, minY: -123.848, maxX: 66.812, maxY: -0.079 },
    portraitCanvas: { width: 512, height: 512 },
    portraitCrop: { x: 83, y: 64, width: 397, height: 416 },
  },
  'enemy-soft-biter': {
    gameplayFacing: -1,
    worldBounds: { minX: -59, minY: -104, maxX: 60, maxY: 12 },
    portraitCanvas: { width: 512, height: 512 },
    portraitCrop: { x: 39, y: 54, width: 423, height: 421 },
  },
  'enemy-windcap': {
    gameplayFacing: -1,
    worldBounds: { minX: -51, minY: -102, maxX: 55, maxY: 8 },
    portraitCanvas: { width: 512, height: 512 },
    portraitCrop: { x: 41, y: 37, width: 415, height: 438 },
  },
  'enemy-stone-lump': {
    gameplayFacing: -1,
    worldBounds: { minX: -51, minY: -80, maxX: 50, maxY: 8 },
    portraitCanvas: { width: 512, height: 512 },
    portraitCrop: { x: 41, y: 123, width: 434, height: 355 },
  },
  'enemy-acid-shell-king': {
    gameplayFacing: -1,
    worldBounds: { minX: -69, minY: -126, maxX: 75, maxY: 20 },
    portraitCanvas: { width: 768, height: 768 },
    portraitCrop: { x: 57, y: 66, width: 632, height: 640 },
  },
});

export function characterRenderProfile(ownerId) {
  return CHARACTER_RENDER_PROFILES[ownerId] ?? null;
}

/** Scale a rig's widest logical span to its nominal 100-unit display box. */
export function characterWorldScale(ownerId) {
  const bounds = characterRenderProfile(ownerId)?.worldBounds;
  if (!bounds) return 1;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const span = Math.max(width, height);
  return Number.isFinite(span) && span > 0 ? 100 / span : 1;
}

/**
 * Return the transparent-margin-free crop, scaled for the actual image size.
 * Canvas drawImage accepts fractional source coordinates, so scaling rather
 * than rounding avoids directional bias at non-canonical resolutions.
 */
export function characterPortraitCrop(ownerId, imageWidth, imageHeight) {
  const profile = characterRenderProfile(ownerId);
  if (!profile) return null;
  const width = Number(imageWidth);
  const height = Number(imageHeight);
  if (!(width > 0) || !(height > 0)) return null;
  const scaleX = width / profile.portraitCanvas.width;
  const scaleY = height / profile.portraitCanvas.height;
  const crop = profile.portraitCrop;
  return {
    x: crop.x * scaleX,
    y: crop.y * scaleY,
    width: crop.width * scaleX,
    height: crop.height * scaleY,
  };
}
