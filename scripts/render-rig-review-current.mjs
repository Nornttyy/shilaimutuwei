#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AnimationController } from '../src/animation/controller.js';
import { resolveExpressionState } from '../src/animation/expression-mixer.js';
import {
  BOSS_CLIPS,
  BUBBLE_CLIPS,
  BUG_CLIPS,
  CRYSTAL_CLIPS,
  SHELL_CLIPS,
  SPROUT_CLIPS,
  STONE_CLIPS,
  WINDCAP_CLIPS,
} from '../src/animation/clips.js';
import { renderLayeredRig } from '../src/animation/layer-renderer.js';
import {
  BOSS_RIG,
  BUBBLE_RIG,
  BUG_RIG,
  CRYSTAL_RIG,
  SHELL_RIG,
  SPROUT_RIG,
  STONE_RIG,
  WINDCAP_RIG,
} from '../src/animation/rigs.js';
import {
  decodeRgbaPng,
  encodeRgbaPng,
} from './export-rig-layers.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
export const DEFAULT_MANIFEST_PATH = path.join(PROJECT_ROOT, 'assets/rig-parts.json');
export const DEFAULT_OUTPUT_ROOT = path.join(
  PROJECT_ROOT,
  'assets/generated-v2/rig-review-current',
);

export const REVIEW_LAYOUT = Object.freeze({
  cellWidth: 280,
  height: 360,
  headerHeight: 34,
  groundY: 292,
  horizontalMargin: 14,
  topMargin: 12,
  bottomMargin: 12,
  maximumScale: 1.9,
});

const BACKGROUND = Object.freeze([246, 250, 253, 255]);
const HEADER = Object.freeze([220, 235, 246, 255]);
const SEPARATOR = Object.freeze([184, 205, 220, 255]);
const GROUND = Object.freeze([203, 219, 230, 255]);
const LABEL = Object.freeze([27, 60, 83, 255]);
const EPSILON = 1e-7;

const RIGS = Object.freeze({
  shell: SHELL_RIG,
  crystal: CRYSTAL_RIG,
  bubble: BUBBLE_RIG,
  sprout: SPROUT_RIG,
  bug: BUG_RIG,
  windcap: WINDCAP_RIG,
  stone: STONE_RIG,
  boss: BOSS_RIG,
});

const CLIPS = Object.freeze({
  shell: SHELL_CLIPS,
  crystal: CRYSTAL_CLIPS,
  bubble: BUBBLE_CLIPS,
  sprout: SPROUT_CLIPS,
  bug: BUG_CLIPS,
  windcap: WINDCAP_CLIPS,
  stone: STONE_CLIPS,
  boss: BOSS_CLIPS,
});

const FONT = Object.freeze({
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
});

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
            LABEL,
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

function makeSheet(columnCount) {
  if (!Number.isInteger(columnCount) || columnCount <= 0) {
    throw new TypeError('Review sheet columnCount must be a positive integer.');
  }
  const width = REVIEW_LAYOUT.cellWidth * columnCount;
  const sheet = {
    width,
    height: REVIEW_LAYOUT.height,
    pixels: Buffer.alloc(width * REVIEW_LAYOUT.height * 4),
  };
  fillRect(sheet, 0, 0, sheet.width, sheet.height, BACKGROUND);
  fillRect(sheet, 0, 0, sheet.width, REVIEW_LAYOUT.headerHeight, HEADER);
  for (let column = 0; column < columnCount; column += 1) {
    const startX = column * REVIEW_LAYOUT.cellWidth;
    if (column > 0) fillRect(sheet, startX, 0, 1, sheet.height, SEPARATOR);
    fillRect(
      sheet,
      startX + 8,
      REVIEW_LAYOUT.groundY,
      REVIEW_LAYOUT.cellWidth - 16,
      1,
      GROUND,
    );
  }
  return sheet;
}

function frameValue(frame) {
  return Array.isArray(frame) ? frame[1] : frame.value;
}

function frameTime(frame) {
  return Array.isArray(frame) ? frame[0] : frame.time;
}

function idleBlinkTime(clip) {
  const frames = clip.tracks?.eyes?.scaleY;
  if (!Array.isArray(frames) || frames.length === 0) return clip.duration / 2;
  const minimum = frames.reduce((best, frame) => (
    frameValue(frame) < frameValue(best) ? frame : best
  ), frames[0]);
  return frameTime(minimum);
}

function eventTime(clip, eventName, fallbackRatio) {
  return clip.events?.find(({ name }) => name === eventName)?.time
    ?? clip.duration * fallbackRatio;
}

function nearestEventTime(clip, eventName, fallbackRatio) {
  const target = clip.duration * fallbackRatio;
  const events = (clip.events ?? []).filter(({ name }) => name === eventName);
  if (events.length === 0) return target;
  return events.reduce((nearest, event) => (
    Math.abs(event.time - target) < Math.abs(nearest.time - target) ? event : nearest
  ), events[0]).time;
}

function sampleClipPose(clips, name, time) {
  const controller = new AnimationController(clips, { transitionDuration: 0 });
  controller.play(name);
  controller.update(time);
  return controller.sample();
}

function terminalTime(clip) {
  return Math.max(0, clip.duration - Math.min(1 / 60, clip.duration * 0.05));
}

function frameForAction(ownerId, name, clip) {
  if (name === 'idle') {
    return {
      key: name,
      label: 'IDLE BLINK',
      clip: name,
      time: idleBlinkTime(clip),
      expression: 'blink',
    };
  }
  if (name === 'move') {
    return {
      key: name,
      label: 'MOVE STEP',
      clip: name,
      time: nearestEventTime(clip, 'step', 0.7),
      expression: resolveExpressionState({
        ownerId,
        action: name,
        currentTime: 0,
        autoBlink: false,
      }),
    };
  }
  if (name === 'attack') {
    return {
      key: name,
      label: 'ATTACK HIT',
      clip: name,
      time: eventTime(clip, 'hit', 0.62),
      expression: resolveExpressionState({
        ownerId,
        action: name,
        currentTime: 0,
        autoBlink: false,
      }),
    };
  }
  if (name === 'hurt') {
    return {
      key: name,
      label: 'HURT PEAK',
      clip: name,
      time: eventTime(clip, 'hurt-flash', 0.22),
      expression: resolveExpressionState({
        ownerId,
        action: name,
        currentTime: 0,
        autoBlink: false,
      }),
    };
  }
  if (name === 'downed' || name === 'death') {
    return {
      key: name,
      label: `${name.toUpperCase()} END`,
      clip: name,
      time: terminalTime(clip),
      expression: resolveExpressionState({
        ownerId,
        action: name,
        currentTime: 0,
        autoBlink: false,
      }),
    };
  }
  if (name === 'charge') {
    return {
      key: name,
      label: 'CHARGE READY',
      clip: name,
      time: eventTime(clip, 'charge-ready', 1),
      expression: resolveExpressionState({
        ownerId,
        action: name,
        currentTime: 0,
        autoBlink: false,
      }),
    };
  }
  throw new Error(`${ownerId}: no deterministic review selector for clip ${name}.`);
}

function reviewFrames(ownerId, clips) {
  const declaredNames = Object.keys(clips);
  const expectedNames = clips.charge
    ? ['idle', 'move', 'attack', 'hurt', 'death', 'charge']
    : (clips.move
      ? ['idle', 'move', 'attack', 'hurt', 'death']
      : ['idle', 'attack', 'hurt', 'downed']);
  if (
    declaredNames.length !== expectedNames.length
    || declaredNames.some((name) => !expectedNames.includes(name))
  ) {
    throw new Error(
      `${ownerId}: every declared clip needs an explicit review frame; found ${declaredNames.join(', ')}.`,
    );
  }
  return [
    { key: 'bind', label: 'BIND', clip: null, time: 0, expression: 'normal', pose: {} },
    ...expectedNames.map((name) => frameForAction(ownerId, name, clips[name])),
  ].map((frame) => ({
    ...frame,
    pose: frame.pose ?? sampleClipPose(clips, frame.clip, frame.time),
  }));
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

function sameRect(left, right) {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height;
}

function recordFrame(rig, manifestEntry, images, frame) {
  const context = new RecordingContext();
  const rendered = renderLayeredRig(
    context,
    rig,
    frame.pose,
    manifestEntry,
    images,
    frame.expression,
  );
  if (!rendered || context.commands.length === 0) {
    throw new Error(`${rig.id}.${frame.key}: no layered rig commands were recorded.`);
  }
  const bounds = unionBounds(context.commands.map((command) => (
    transformedBounds(command.transform, command.destination)
  )));
  const partsDrawn = manifestEntry.parts
    .filter((part) => context.commands.some((command) => (
      command.image.assetPath === part.path && sameRect(command.source, part.sourceRect)
    )))
    .map(({ id }) => id);
  const variantsDrawn = manifestEntry.parts.flatMap((part) => (
    Object.entries(part.variants ?? {})
      .filter(([, variant]) => context.commands.some((command) => (
        command.image.assetPath === variant.path && sameRect(command.source, variant.sourceRect)
      )))
      .map(([name]) => `${part.id}:${name}`)
  ));
  return { ...frame, commands: context.commands, bounds, partsDrawn, variantsDrawn };
}

function chooseScale(frames) {
  const bounds = unionBounds(frames.map((frame) => frame.bounds));
  const halfWidth = REVIEW_LAYOUT.cellWidth / 2;
  const horizontalExtent = Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX), EPSILON);
  const topExtent = Math.max(0, -bounds.minY);
  const bottomExtent = Math.max(0, bounds.maxY);
  const candidates = [
    REVIEW_LAYOUT.maximumScale,
    (halfWidth - REVIEW_LAYOUT.horizontalMargin) / horizontalExtent,
  ];
  if (topExtent > EPSILON) {
    candidates.push(
      (REVIEW_LAYOUT.groundY - REVIEW_LAYOUT.headerHeight - REVIEW_LAYOUT.topMargin)
        / topExtent,
    );
  }
  if (bottomExtent > EPSILON) {
    candidates.push(
      (REVIEW_LAYOUT.height - REVIEW_LAYOUT.bottomMargin - REVIEW_LAYOUT.groundY)
        / bottomExtent,
    );
  }
  const scale = Math.min(...candidates);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Could not fit review frames.');
  return scale;
}

function pixelBounds(mask, column, sheetWidth) {
  const startX = column * REVIEW_LAYOUT.cellWidth;
  const endX = startX + REVIEW_LAYOUT.cellWidth;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let visiblePixels = 0;
  for (let y = 0; y < REVIEW_LAYOUT.height; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      if (mask[y * sheetWidth + x] === 0) continue;
      visiblePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (visiblePixels === 0) return { visiblePixels, minX: null, minY: null, maxX: null, maxY: null };
  return { visiblePixels, minX, minY, maxX, maxY };
}

function assertColumnRange(bounds, column, label) {
  const minX = column * REVIEW_LAYOUT.cellWidth + 1;
  const maxX = (column + 1) * REVIEW_LAYOUT.cellWidth - 1;
  const minY = REVIEW_LAYOUT.headerHeight;
  const maxY = REVIEW_LAYOUT.height - 1;
  if (
    bounds.minX < minX - EPSILON
    || bounds.maxX > maxX + EPSILON
    || bounds.minY < minY - EPSILON
    || bounds.maxY > maxY + EPSILON
  ) {
    throw new RangeError(`${label}: transformed frame escapes its review column.`);
  }
}

function renderSheet(rig, frames) {
  const sheet = makeSheet(frames.length);
  const mask = new Uint8Array(sheet.width * sheet.height);
  const scale = chooseScale(frames);
  const columns = [];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const startX = index * REVIEW_LAYOUT.cellWidth;
    const originX = startX + REVIEW_LAYOUT.cellWidth / 2;
    const cellTransform = matrix(scale, 0, 0, scale, originX, REVIEW_LAYOUT.groundY);
    const geometricBounds = transformedBounds(cellTransform, {
      x: frame.bounds.minX,
      y: frame.bounds.minY,
      width: frame.bounds.maxX - frame.bounds.minX,
      height: frame.bounds.maxY - frame.bounds.minY,
    });
    assertColumnRange(geometricBounds, index, `${rig.id}.${frame.key}`);
    drawText(sheet, frame.label, originX, 10, 2);
    const clipRect = {
      minX: startX + 1,
      minY: REVIEW_LAYOUT.headerHeight,
      maxX: startX + REVIEW_LAYOUT.cellWidth - 1,
      maxY: REVIEW_LAYOUT.height,
    };
    for (const command of frame.commands) {
      compositeCommand(sheet, mask, command, cellTransform, clipRect);
    }
    const pixels = pixelBounds(mask, index, sheet.width);
    if (pixels.visiblePixels === 0) {
      throw new Error(`${rig.id}.${frame.key}: software composite is empty.`);
    }
    columns.push({
      key: frame.key,
      label: frame.label,
      clip: frame.clip,
      time: Number(frame.time.toFixed(6)),
      expression: frame.expression,
      drawCount: frame.commands.length,
      partsDrawn: frame.partsDrawn,
      variantsDrawn: frame.variantsDrawn,
      geometricBounds: Object.fromEntries(
        Object.entries(geometricBounds).map(([key, value]) => [key, Number(value.toFixed(3))]),
      ),
      pixelBounds: pixels,
    });
  }
  return { sheet, scale, columns };
}

function safeAssetPath(projectRoot, ownerId, assetPath) {
  if (typeof assetPath !== 'string' || !assetPath.endsWith('.png')) {
    throw new Error(`${ownerId}: current manifest asset must be a PNG.`);
  }
  const expectedPrefix = `assets/generated-v2/rig/${ownerId}/`;
  if (!assetPath.startsWith(expectedPrefix) || assetPath.includes('/../')) {
    throw new Error(`${ownerId}: refusing non-current rig asset ${assetPath}.`);
  }
  const resolved = path.resolve(projectRoot, assetPath);
  const allowedDirectory = path.resolve(projectRoot, expectedPrefix);
  if (!resolved.startsWith(`${allowedDirectory}${path.sep}`)) {
    throw new Error(`${ownerId}: asset path escapes its current rig directory.`);
  }
  return resolved;
}

async function loadCurrentImages(projectRoot, ownerId, entry) {
  const assetPaths = new Set();
  for (const part of entry.parts) {
    assetPaths.add(part.path);
    for (const variant of Object.values(part.variants ?? {})) {
      assetPaths.add(variant.path ?? part.path);
    }
  }
  const images = new Map();
  for (const assetPath of [...assetPaths].sort()) {
    const resolved = safeAssetPath(projectRoot, ownerId, assetPath);
    const decoded = decodeRgbaPng(await readFile(resolved), assetPath);
    images.set(assetPath, { ...decoded, assetPath });
  }
  return { images, assetPaths: [...assetPaths].sort() };
}

function rectsOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function visibleSourcePixels(image, rect) {
  let count = 0;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      if (image.pixels[(y * image.width + x) * 4 + 3] > 0) count += 1;
    }
  }
  return count;
}

function assertBossSplit(ownerId, entry, images) {
  if (entry.rigId !== 'boss') return null;
  const split = ['acidShell', 'crown'].map((id) => {
    const part = entry.parts.find((candidate) => candidate.id === id);
    if (!part || part.bone !== id || part.required !== true) {
      throw new Error(`${ownerId}: required ${id} part must use its own ${id} bone.`);
    }
    const expectedPath = `assets/generated-v2/rig/${ownerId}/atlas-layered-v2.png`;
    if (part.path !== expectedPath) {
      throw new Error(`${ownerId}.${id}: expected current ${expectedPath}.`);
    }
    const image = images.get(part.path);
    assertSourceRect(image, part.sourceRect);
    const visiblePixels = visibleSourcePixels(image, part.sourceRect);
    if (visiblePixels === 0) throw new Error(`${ownerId}.${id}: split layer is empty.`);
    return { id, bone: part.bone, sourceRect: { ...part.sourceRect }, visiblePixels };
  });
  if (rectsOverlap(split[0].sourceRect, split[1].sourceRect)) {
    throw new Error(`${ownerId}: acidShell and crown sourceRects overlap in the current atlas.`);
  }
  return {
    sourceRectsDisjoint: true,
    acidShell: split[0],
    crown: split[1],
  };
}

function assertBossFramesContainSplit(ownerId, frames) {
  for (const frame of frames) {
    for (const partId of ['acidShell', 'crown']) {
      if (!frame.partsDrawn.includes(partId)) {
        throw new Error(`${ownerId}.${frame.key}: ${partId} layer was not drawn.`);
      }
    }
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertOutputRoot(outputRoot) {
  const resolved = path.resolve(outputRoot);
  if (resolved === path.resolve(DEFAULT_OUTPUT_ROOT)) return resolved;
  const relative = path.relative(path.resolve(os.tmpdir()), resolved);
  const [temporaryRoot, basename] = relative.split(path.sep);
  if (
    relative.startsWith('..')
    || path.isAbsolute(relative)
    || !temporaryRoot?.startsWith('slime-rig-review-')
    || basename !== 'rig-review-current'
    || relative.split(path.sep).length !== 2
  ) {
    throw new Error('Refusing an unsafe rig-review output directory.');
  }
  return resolved;
}

async function writeAtomically(filePath, bytes) {
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, bytes);
  await rename(temporaryPath, filePath);
}

export async function renderCurrentRigReviews({
  projectRoot = PROJECT_ROOT,
  manifestPath = DEFAULT_MANIFEST_PATH,
  outputRoot = DEFAULT_OUTPUT_ROOT,
} = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedOutputRoot = assertOutputRoot(outputRoot);
  const stagingRoot = `${resolvedOutputRoot}.staging`;
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest?.rigs || typeof manifest.rigs !== 'object') {
    throw new Error('rig-parts.json must contain a rigs object.');
  }
  if (Object.keys(manifest.rigs).length !== 8) {
    throw new Error(`Expected 8 current rigs, found ${Object.keys(manifest.rigs).length}.`);
  }

  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  const report = {
    schemaVersion: 1,
    generatedFrom: 'assets/rig-parts.json + src/animation/rigs.js + src/animation/clips.js',
    background: 'solid-light',
    layout: { ...REVIEW_LAYOUT },
    rigs: {},
  };

  try {
    for (const [ownerId, sourceEntry] of Object.entries(manifest.rigs)) {
      const rig = RIGS[sourceEntry.rigId];
      const clips = CLIPS[sourceEntry.rigId];
      if (!rig || !clips) throw new Error(`${ownerId}: unknown rig id ${sourceEntry.rigId}.`);
      const manifestEntry = hydrateManifestEntry(sourceEntry);
      for (const part of manifestEntry.parts) {
        if (!rig.bones[part.bone]) {
          throw new Error(`${ownerId}.${part.id}: missing current bone ${part.bone}.`);
        }
      }
      const { images, assetPaths } = await loadCurrentImages(
        resolvedProjectRoot,
        ownerId,
        manifestEntry,
      );
      const splitLayers = assertBossSplit(ownerId, manifestEntry, images);
      const frames = reviewFrames(ownerId, clips).map((frame) => (
        recordFrame(rig, manifestEntry, images, frame)
      ));
      if (sourceEntry.rigId === 'boss') assertBossFramesContainSplit(ownerId, frames);
      const { sheet, scale, columns } = renderSheet(rig, frames);
      const png = encodeRgbaPng(sheet);
      const filename = `${ownerId}.png`;
      await writeAtomically(path.join(stagingRoot, filename), png);
      report.rigs[ownerId] = {
        rigId: sourceEntry.rigId,
        file: filename,
        width: sheet.width,
        height: sheet.height,
        scale: Number(scale.toFixed(6)),
        sourceAssets: assetPaths,
        ...(splitLayers == null ? {} : { splitLayers }),
        pngSha256: sha256(png),
        columns,
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
    const report = await renderCurrentRigReviews();
    console.log(`Rendered ${Object.keys(report.rigs).length} current rig review sheets.`);
    console.log(path.relative(PROJECT_ROOT, DEFAULT_OUTPUT_ROOT));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
