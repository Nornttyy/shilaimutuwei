#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AnimationController } from '../src/animation/controller.js';
import {
  BUBBLE_CLIPS,
  CRYSTAL_CLIPS,
  SHELL_CLIPS,
  SPROUT_CLIPS,
} from '../src/animation/clips.js';
import { resolveExpressionState } from '../src/animation/expression-mixer.js';
import { renderLayeredRig } from '../src/animation/layer-renderer.js';
import {
  BUBBLE_RIG,
  CRYSTAL_RIG,
  SHELL_RIG,
  SPROUT_RIG,
} from '../src/animation/rigs.js';
import { slimeEvolutionArmorLayout } from '../src/draw.js';
import {
  decodeRgbaPng,
  encodeRgbaPng,
} from './export-rig-layers.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
export const DEFAULT_MANIFEST_PATH = path.join(PROJECT_ROOT, 'assets/rig-parts.json');
export const DEFAULT_OUTPUT_ROOT = path.join(
  PROJECT_ROOT,
  'assets/generated-v2/evolution-armor-review',
);

const LAYOUT = Object.freeze({
  cellWidth: 280,
  height: 340,
  headerHeight: 34,
  groundY: 292,
  horizontalMargin: 14,
  topMargin: 12,
  bottomMargin: 12,
  maximumScale: 1.9,
});

const COLORS = Object.freeze({
  background: Object.freeze([246, 250, 253, 255]),
  header: Object.freeze([220, 235, 246, 255]),
  separator: Object.freeze([184, 205, 220, 255]),
  ground: Object.freeze([203, 219, 230, 255]),
  label: Object.freeze([27, 60, 83, 255]),
});

const CHARACTERS = Object.freeze([
  Object.freeze({
    type: 'shell',
    ownerId: 'survivor-shell-shell',
    rig: SHELL_RIG,
    clips: SHELL_CLIPS,
    atlasPath: 'assets/generated/evolution-armor/shell-evolution-armor-v3.png',
  }),
  Object.freeze({
    type: 'needle',
    ownerId: 'survivor-crystal-pin',
    rig: CRYSTAL_RIG,
    clips: CRYSTAL_CLIPS,
    atlasPath: 'assets/generated/evolution-armor/needle-evolution-armor-v3.png',
  }),
  Object.freeze({
    type: 'bubble',
    ownerId: 'survivor-bubble-float',
    rig: BUBBLE_RIG,
    clips: BUBBLE_CLIPS,
    atlasPath: 'assets/generated/evolution-armor/bubble-evolution-armor-v3.png',
  }),
  Object.freeze({
    type: 'sprout',
    ownerId: 'survivor-moss-sprout',
    rig: SPROUT_RIG,
    clips: SPROUT_CLIPS,
    atlasPath: 'assets/generated/evolution-armor/sprout-evolution-armor-v3.png',
  }),
]);

const FONT = Object.freeze({
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
});

const EPSILON = 1e-7;

function matrix(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
  return { a, b, c, d, e, f };
}

function multiply(left, right) {
  return matrix(
    left.a * right.a + left.c * right.b,
    left.b * right.a + left.d * right.b,
    left.a * right.c + left.c * right.d,
    left.b * right.c + left.d * right.d,
    left.a * right.e + left.c * right.f + left.e,
    left.b * right.e + left.d * right.f + left.f,
  );
}

function translation(x, y) {
  return matrix(1, 0, 0, 1, x, y);
}

function rotation(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return matrix(cosine, sine, -sine, cosine, 0, 0);
}

function scaling(x, y) {
  return matrix(x, 0, 0, y, 0, 0);
}

function transformPoint(transform, x, y) {
  return {
    x: transform.a * x + transform.c * y + transform.e,
    y: transform.b * x + transform.d * y + transform.f,
  };
}

function invert(transform) {
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (Math.abs(determinant) < 1e-12) return null;
  return matrix(
    transform.d / determinant,
    -transform.b / determinant,
    -transform.c / determinant,
    transform.a / determinant,
    (transform.c * transform.f - transform.d * transform.e) / determinant,
    (transform.b * transform.e - transform.a * transform.f) / determinant,
  );
}

function transformedBounds(transform, rect) {
  const points = [
    transformPoint(transform, rect.x, rect.y),
    transformPoint(transform, rect.x + rect.width, rect.y),
    transformPoint(transform, rect.x + rect.width, rect.y + rect.height),
    transformPoint(transform, rect.x, rect.y + rect.height),
  ];
  return {
    minX: Math.min(...points.map(({ x }) => x)),
    minY: Math.min(...points.map(({ y }) => y)),
    maxX: Math.max(...points.map(({ x }) => x)),
    maxY: Math.max(...points.map(({ y }) => y)),
  };
}

function unionBounds(items) {
  if (items.length === 0) throw new Error('Cannot union an empty bounds list.');
  return {
    minX: Math.min(...items.map(({ minX }) => minX)),
    minY: Math.min(...items.map(({ minY }) => minY)),
    maxX: Math.max(...items.map(({ maxX }) => maxX)),
    maxY: Math.max(...items.map(({ maxY }) => maxY)),
  };
}

function sameRect(left, right) {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function assertSourceRect(image, source) {
  if (
    !image
    || !Number.isInteger(image.width)
    || !Number.isInteger(image.height)
    || !Buffer.isBuffer(image.pixels)
  ) {
    throw new TypeError('drawImage received an undecoded RGBA image.');
  }
  if (
    ![source.x, source.y, source.width, source.height].every(Number.isInteger)
    || source.x < 0
    || source.y < 0
    || source.width <= 0
    || source.height <= 0
    || source.x + source.width > image.width
    || source.y + source.height > image.height
  ) {
    throw new RangeError(`${image.assetPath}: sourceRect is outside the decoded PNG.`);
  }
}

class RecordingContext {
  constructor() {
    this.globalAlpha = 1;
    this.transform = matrix();
    this.stack = [];
    this.commands = [];
  }

  save() {
    this.stack.push({ transform: { ...this.transform }, globalAlpha: this.globalAlpha });
  }

  restore() {
    const state = this.stack.pop();
    if (!state) throw new Error('Canvas restore without save.');
    this.transform = state.transform;
    this.globalAlpha = state.globalAlpha;
  }

  translate(x, y) {
    this.transform = multiply(this.transform, translation(x, y));
  }

  rotate(angle) {
    this.transform = multiply(this.transform, rotation(angle));
  }

  scale(x, y) {
    this.transform = multiply(this.transform, scaling(x, y));
  }

  drawImage(image, ...args) {
    let source;
    let destination;
    if (args.length === 4) {
      source = { x: 0, y: 0, width: image.width, height: image.height };
      destination = { x: args[0], y: args[1], width: args[2], height: args[3] };
    } else if (args.length === 8) {
      source = { x: args[0], y: args[1], width: args[2], height: args[3] };
      destination = { x: args[4], y: args[5], width: args[6], height: args[7] };
    } else {
      throw new Error(`Unsupported drawImage argument count: ${args.length}.`);
    }
    assertSourceRect(image, source);
    this.commands.push({
      image,
      source,
      destination,
      transform: { ...this.transform },
      alpha: Math.max(0, Math.min(1, this.globalAlpha)),
    });
  }
}

function hydrateManifestEntry(entry) {
  return {
    ...entry,
    parts: entry.parts.map((part) => ({
      ...part,
      bindRect: { ...part.bindRect },
      sourceRect: { ...part.sourceRect },
      variants: part.variants == null ? undefined : Object.fromEntries(
        Object.entries(part.variants).map(([name, variant]) => [name, {
          ...variant,
          path: variant.path ?? part.path,
          sourceRect: { ...(variant.sourceRect ?? part.sourceRect) },
          bindRect: { ...(variant.bindRect ?? part.bindRect) },
        }]),
      ),
    })),
  };
}

function setPixel(image, x, y, color) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const offset = (y * image.width + x) * 4;
  image.pixels[offset] = color[0];
  image.pixels[offset + 1] = color[1];
  image.pixels[offset + 2] = color[2];
  image.pixels[offset + 3] = color[3];
}

function fillRect(image, x, y, width, height, color) {
  const minX = Math.max(0, Math.floor(x));
  const minY = Math.max(0, Math.floor(y));
  const maxX = Math.min(image.width, Math.ceil(x + width));
  const maxY = Math.min(image.height, Math.ceil(y + height));
  for (let targetY = minY; targetY < maxY; targetY += 1) {
    for (let targetX = minX; targetX < maxX; targetX += 1) {
      setPixel(image, targetX, targetY, color);
    }
  }
}

function drawText(image, text, centerX, topY, pixelSize = 2) {
  const glyphWidth = 5 * pixelSize;
  const gap = pixelSize;
  const width = text.length * glyphWidth + Math.max(0, text.length - 1) * gap;
  let cursor = Math.round(centerX - width / 2);
  for (const character of text) {
    const glyph = FONT[character];
    if (!glyph) throw new Error(`Missing review-sheet glyph: ${character}.`);
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === '1') {
          fillRect(
            image,
            cursor + column * pixelSize,
            topY + row * pixelSize,
            pixelSize,
            pixelSize,
            COLORS.label,
          );
        }
      }
    }
    cursor += glyphWidth + gap;
  }
}

function blendPixel(target, offset, red, green, blue, alpha) {
  if (alpha <= 0) return;
  const sourceAlpha = Math.max(0, Math.min(1, alpha));
  const destinationAlpha = target[offset + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha <= 0) return;
  target[offset] = Math.round(
    (red * sourceAlpha + target[offset] * destinationAlpha * (1 - sourceAlpha)) / outputAlpha,
  );
  target[offset + 1] = Math.round(
    (green * sourceAlpha + target[offset + 1] * destinationAlpha * (1 - sourceAlpha))
      / outputAlpha,
  );
  target[offset + 2] = Math.round(
    (blue * sourceAlpha + target[offset + 2] * destinationAlpha * (1 - sourceAlpha))
      / outputAlpha,
  );
  target[offset + 3] = Math.round(outputAlpha * 255);
}

function compositeCommand(sheet, mask, command, cellTransform, clipRect) {
  if (command.alpha <= 0) return;
  const transform = multiply(cellTransform, command.transform);
  const inverse = invert(transform);
  if (!inverse) return;
  const bounds = transformedBounds(transform, command.destination);
  const minX = Math.max(clipRect.minX, Math.floor(bounds.minX));
  const minY = Math.max(clipRect.minY, Math.floor(bounds.minY));
  const maxX = Math.min(clipRect.maxX, Math.ceil(bounds.maxX));
  const maxY = Math.min(clipRect.maxY, Math.ceil(bounds.maxY));
  const { destination, source, image } = command;

  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const local = transformPoint(inverse, x + 0.5, y + 0.5);
      const u = (local.x - destination.x) / destination.width;
      const v = (local.y - destination.y) / destination.height;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const sourceX = Math.min(
        source.x + source.width - 1,
        source.x + Math.floor(u * source.width),
      );
      const sourceY = Math.min(
        source.y + source.height - 1,
        source.y + Math.floor(v * source.height),
      );
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const sourceAlpha = image.pixels[sourceOffset + 3] / 255 * command.alpha;
      if (sourceAlpha <= 0) continue;
      const targetOffset = (y * sheet.width + x) * 4;
      blendPixel(
        sheet.pixels,
        targetOffset,
        image.pixels[sourceOffset],
        image.pixels[sourceOffset + 1],
        image.pixels[sourceOffset + 2],
        sourceAlpha,
      );
      mask[y * sheet.width + x] = 1;
    }
  }
}

function makeSheet() {
  const width = LAYOUT.cellWidth * 4;
  const sheet = {
    width,
    height: LAYOUT.height,
    pixels: Buffer.alloc(width * LAYOUT.height * 4),
  };
  fillRect(sheet, 0, 0, sheet.width, sheet.height, COLORS.background);
  fillRect(sheet, 0, 0, sheet.width, LAYOUT.headerHeight, COLORS.header);
  for (let column = 0; column < 4; column += 1) {
    const startX = column * LAYOUT.cellWidth;
    if (column > 0) fillRect(sheet, startX, 0, 1, sheet.height, COLORS.separator);
    fillRect(sheet, startX + 8, LAYOUT.groundY, LAYOUT.cellWidth - 16, 1, COLORS.ground);
  }
  return sheet;
}

function recordPose({
  rig,
  manifestEntry,
  images,
  star,
  armorPartIds,
  pose,
  expression,
  poseName,
  time,
}) {
  const context = new RecordingContext();
  const rendered = renderLayeredRig(
    context,
    rig,
    pose,
    manifestEntry,
    images,
    expression,
  );
  if (!rendered || context.commands.length === 0) {
    throw new Error(`${rig.id}.${star}-star.${poseName}: no layered rig commands were recorded.`);
  }
  const bounds = unionBounds(context.commands.map((command) => (
    transformedBounds(command.transform, command.destination)
  )));
  const armorDrawCount = context.commands.filter((command) => (
    armorPartIds.some((partId) => command.image.armorPartId === partId)
  )).length;
  if (armorDrawCount !== armorPartIds.length) {
    throw new Error(
      `${rig.id}.${star}-star.${poseName}: expected ${armorPartIds.length} armor draws, got ${armorDrawCount}.`,
    );
  }
  const armorTransforms = context.commands
    .filter((command) => command.image.armorPartId != null)
    .map((command) => ({
      partId: command.image.armorPartId,
      transform: Object.fromEntries(
        Object.entries(command.transform).map(([key, value]) => [key, Number(value.toFixed(6))]),
      ),
    }));
  return {
    star,
    poseName,
    time,
    expression,
    commands: context.commands,
    bounds,
    armorPartIds,
    armorDrawCount,
    armorTransforms,
  };
}

function sampleAttackHit(character) {
  const attack = character.clips?.attack;
  if (!attack || !(attack.duration > 0)) {
    throw new Error(`${character.ownerId}: missing attack clip.`);
  }
  const hitEvent = attack.events?.find(({ name }) => name === 'hit');
  if (!hitEvent || !(hitEvent.time >= 0) || hitEvent.time > attack.duration) {
    throw new Error(`${character.ownerId}: attack clip must declare an in-range hit event.`);
  }
  const controller = new AnimationController(character.clips, { transitionDuration: 0 });
  controller.play('attack');
  controller.update(hitEvent.time);
  return {
    time: hitEvent.time,
    pose: controller.sample(),
    expression: resolveExpressionState({
      ownerId: character.ownerId,
      action: 'attack',
      currentTime: 0,
      autoBlink: false,
    }),
  };
}

function chooseScale(frames) {
  const bounds = unionBounds(frames.map((frame) => frame.bounds));
  const horizontalExtent = Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX), EPSILON);
  const topExtent = Math.max(0, -bounds.minY);
  const bottomExtent = Math.max(0, bounds.maxY);
  const candidates = [
    LAYOUT.maximumScale,
    (LAYOUT.cellWidth / 2 - LAYOUT.horizontalMargin) / horizontalExtent,
  ];
  if (topExtent > EPSILON) {
    candidates.push(
      (LAYOUT.groundY - LAYOUT.headerHeight - LAYOUT.topMargin) / topExtent,
    );
  }
  if (bottomExtent > EPSILON) {
    candidates.push(
      (LAYOUT.height - LAYOUT.bottomMargin - LAYOUT.groundY) / bottomExtent,
    );
  }
  const scale = Math.min(...candidates);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Could not fit armor review frames.');
  return scale;
}

function pixelBounds(mask, column, sheetWidth) {
  const startX = column * LAYOUT.cellWidth;
  const endX = startX + LAYOUT.cellWidth;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let visiblePixels = 0;
  for (let y = 0; y < LAYOUT.height; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      if (mask[y * sheetWidth + x] === 0) continue;
      visiblePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return visiblePixels === 0
    ? { visiblePixels, minX: null, minY: null, maxX: null, maxY: null }
    : { visiblePixels, minX, minY, maxX, maxY };
}

function renderSheet(frames, requestedScale = null) {
  const sheet = makeSheet();
  const mask = new Uint8Array(sheet.width * sheet.height);
  const scale = requestedScale ?? chooseScale(frames);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new TypeError('Review sheet scale must be a positive finite number.');
  }
  const columns = [];

  frames.forEach((frame, column) => {
    const startX = column * LAYOUT.cellWidth;
    const originX = startX + LAYOUT.cellWidth / 2;
    drawText(sheet, `${frame.star} STAR`, originX, 10, 2);
    const cellTransform = matrix(scale, 0, 0, scale, originX, LAYOUT.groundY);
    const clipRect = {
      minX: startX + 1,
      minY: LAYOUT.headerHeight,
      maxX: startX + LAYOUT.cellWidth - 1,
      maxY: LAYOUT.height,
    };
    for (const command of frame.commands) {
      compositeCommand(sheet, mask, command, cellTransform, clipRect);
    }
    const pixels = pixelBounds(mask, column, sheet.width);
    if (pixels.visiblePixels === 0) {
      throw new Error(`${frame.star}-star review column is empty.`);
    }
    columns.push({
      star: frame.star,
      drawCount: frame.commands.length,
      armorDrawCount: frame.armorDrawCount,
      armorPartIds: frame.armorPartIds,
      poseName: frame.poseName,
      time: Number(frame.time.toFixed(6)),
      expression: frame.expression,
      armorTransforms: frame.armorTransforms,
      rigBounds: Object.fromEntries(
        Object.entries(frame.bounds).map(([key, value]) => [key, Number(value.toFixed(3))]),
      ),
      pixelBounds: pixels,
    });
  });
  return { sheet, scale, columns };
}

function assertProjectAssetPath(projectRoot, assetPath) {
  if (typeof assetPath !== 'string' || !assetPath.endsWith('.png') || assetPath.includes('/../')) {
    throw new Error(`Refusing invalid PNG asset path: ${assetPath}`);
  }
  const resolved = path.resolve(projectRoot, assetPath);
  if (!resolved.startsWith(`${path.resolve(projectRoot, 'assets')}${path.sep}`)) {
    throw new Error(`Asset path escapes project assets: ${assetPath}`);
  }
  return resolved;
}

async function decodeProjectImage(projectRoot, assetPath) {
  const resolved = assertProjectAssetPath(projectRoot, assetPath);
  const decoded = decodeRgbaPng(await readFile(resolved), assetPath);
  return { ...decoded, assetPath };
}

async function loadRigImages(projectRoot, entry) {
  const assetPaths = new Set();
  for (const part of entry.parts) {
    assetPaths.add(part.path);
    for (const variant of Object.values(part.variants ?? {})) {
      assetPaths.add(variant.path ?? part.path);
    }
  }
  const images = new Map();
  for (const assetPath of [...assetPaths].sort()) {
    images.set(assetPath, await decodeProjectImage(projectRoot, assetPath));
  }
  return { images, assetPaths: [...assetPaths].sort() };
}

function armoredEntry(baseEntry, atlas, layout) {
  if (layout.level <= 1) return { entry: baseEntry, armorPartIds: [] };
  const armorParts = layout.slots.map((slot) => ({
    id: slot.partId,
    bone: slot.bone,
    z: slot.z,
    image: Object.assign(Object.create(Object.getPrototypeOf(atlas)), atlas, {
      armorPartId: slot.partId,
    }),
    sourceRect: { ...slot.sourceRect },
    bindRect: { ...slot.bindRect },
    required: true,
  }));
  const parts = [...baseEntry.parts, ...armorParts].sort((left, right) => left.z - right.z);
  const originalPartIds = new Set(baseEntry.parts.map(({ id }) => id));
  if (!baseEntry.parts.every(({ id }) => parts.some((part) => part.id === id))) {
    throw new Error('Armor review unexpectedly removed an original rig part.');
  }
  if (armorParts.some(({ id }) => originalPartIds.has(id))) {
    throw new Error('Armor review part id collides with an original rig part.');
  }
  return {
    entry: { ...baseEntry, parts },
    armorPartIds: armorParts.map(({ id }) => id),
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeAtomically(filePath, bytes) {
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, filePath);
}

function assertDefaultOutputRoot(outputRoot) {
  const resolved = path.resolve(outputRoot);
  if (resolved !== path.resolve(DEFAULT_OUTPUT_ROOT)) {
    throw new Error('Refusing a non-preview evolution armor review output directory.');
  }
  return resolved;
}

export async function renderEvolutionArmorReviews({
  projectRoot = PROJECT_ROOT,
  manifestPath = DEFAULT_MANIFEST_PATH,
  outputRoot = DEFAULT_OUTPUT_ROOT,
} = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedOutputRoot = assertDefaultOutputRoot(outputRoot);
  const stagingRoot = `${resolvedOutputRoot}.staging`;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest?.rigs || typeof manifest.rigs !== 'object') {
    throw new Error('rig-parts.json must contain a rigs object.');
  }

  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  const report = {
    schemaVersion: 2,
    generatedFrom: 'assets/rig-parts.json + src/draw.js slimeEvolutionArmorLayout + v3 armor atlases',
    purpose: 'local bind-pose and attack-hit bone attachment review; not a deployable asset',
    layout: { ...LAYOUT },
    characters: {},
  };

  try {
    for (const character of CHARACTERS) {
      const sourceEntry = manifest.rigs[character.ownerId];
      if (!sourceEntry) throw new Error(`${character.ownerId}: missing rig manifest entry.`);
      const baseEntry = hydrateManifestEntry(sourceEntry);
      for (const part of baseEntry.parts) {
        if (!character.rig.bones[part.bone]) {
          throw new Error(`${character.ownerId}.${part.id}: missing rig bone ${part.bone}.`);
        }
      }
      const { images, assetPaths } = await loadRigImages(resolvedProjectRoot, baseEntry);
      const atlas = await decodeProjectImage(resolvedProjectRoot, character.atlasPath);
      if (atlas.width !== 768 || atlas.height !== 768) {
        throw new Error(`${character.atlasPath}: expected a 768x768 atlas.`);
      }

      const attackHit = sampleAttackHit(character);
      const bindFrames = [];
      const attackFrames = [];
      for (let star = 1; star <= 4; star += 1) {
        const layout = slimeEvolutionArmorLayout(character.type, star);
        if (layout.level !== star || layout.type !== character.type) {
          throw new Error(`${character.type}.${star}-star: runtime armor layout mismatch.`);
        }
        for (const slot of layout.slots) {
          if (!character.rig.bones[slot.bone]) {
            throw new Error(`${character.type}.${slot.id}: missing armor bone ${slot.bone}.`);
          }
          assertSourceRect(atlas, slot.sourceRect);
        }
        const { entry, armorPartIds } = armoredEntry(baseEntry, atlas, layout);
        bindFrames.push(recordPose({
          rig: character.rig,
          manifestEntry: entry,
          images,
          star,
          armorPartIds,
          pose: {},
          expression: 'normal',
          poseName: 'bind',
          time: 0,
        }));
        attackFrames.push(recordPose({
          rig: character.rig,
          manifestEntry: entry,
          images,
          star,
          armorPartIds,
          pose: attackHit.pose,
          expression: attackHit.expression,
          poseName: 'attack-hit',
          time: attackHit.time,
        }));
      }

      const scale = chooseScale([...bindFrames, ...attackFrames]);
      const bindReview = renderSheet(bindFrames, scale);
      const attackReview = renderSheet(attackFrames, scale);
      const bindPng = encodeRgbaPng(bindReview.sheet);
      const attackPng = encodeRgbaPng(attackReview.sheet);
      const bindFilename = `${character.ownerId}.png`;
      const attackFilename = `${character.ownerId}-attack.png`;
      await writeAtomically(path.join(stagingRoot, bindFilename), bindPng);
      await writeAtomically(path.join(stagingRoot, attackFilename), attackPng);
      report.characters[character.ownerId] = {
        type: character.type,
        rigId: sourceEntry.rigId,
        files: {
          bind: bindFilename,
          attackHit: attackFilename,
        },
        width: bindReview.sheet.width,
        height: bindReview.sheet.height,
        scale: Number(scale.toFixed(6)),
        originalPartsPreserved: true,
        sourceAssets: assetPaths,
        armorAtlas: character.atlasPath,
        armorAtlasSha256: sha256(await readFile(path.resolve(resolvedProjectRoot, character.atlasPath))),
        attackHit: {
          clip: 'attack',
          event: 'hit',
          time: Number(attackHit.time.toFixed(6)),
          expression: attackHit.expression,
        },
        sheets: {
          bind: {
            pngSha256: sha256(bindPng),
            columns: bindReview.columns,
          },
          attackHit: {
            pngSha256: sha256(attackPng),
            columns: attackReview.columns,
          },
        },
      };
    }

    await writeAtomically(
      path.join(stagingRoot, 'index.json'),
      Buffer.from(`${JSON.stringify(report, null, 2)}\n`),
    );
    await rm(resolvedOutputRoot, { recursive: true, force: true });
    await rename(stagingRoot, resolvedOutputRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
  return report;
}

function isDirectRun() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  try {
    const report = await renderEvolutionArmorReviews();
    console.log(
      `Rendered ${Object.keys(report.characters).length * 2} evolution armor review sheets.`,
    );
    console.log(path.relative(PROJECT_ROOT, DEFAULT_OUTPUT_ROOT));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
