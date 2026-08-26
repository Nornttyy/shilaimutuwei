import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

const MANIFEST = JSON.parse(readFileSync(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));

const IDENTITY = Object.freeze({
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  alpha: 1,
});

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

const TRANSFORM_KEYS = Object.freeze([
  'x',
  'y',
  'rotation',
  'scaleX',
  'scaleY',
  'alpha',
]);

const PRIMARY_GROUND_BONES = new Set(['root', 'motion', 'body', 'stem']);
const SAMPLE_RATE = 180;
const EPSILON = 1e-8;
// Mirrors draw.js' 512px offscreen surface, 2 pixels per local unit and
// ground origin at (256, 384). Geometry outside this viewport is actually
// clipped before the composed character reaches the main canvas.
const RIG_RENDER_VIEWPORT = Object.freeze({
  minX: -128,
  minY: -192,
  maxX: 128,
  maxY: 64,
});

const CLIP_AMPLITUDE_LIMITS = Object.freeze([
  { rigId: 'crystal', clipName: 'attack', bone: 'needles', property: 'x', maxAbs: 0.5 },
  { rigId: 'sprout', clipName: '*', bone: 'sprout', property: 'y', maxAbs: 0.5 },
  { rigId: 'bug', clipName: '*', bone: 'legsA', property: 'rotation', maxAbs: 0.07 },
  { rigId: 'bug', clipName: '*', bone: 'legsB', property: 'rotation', maxAbs: 0.07 },
  { rigId: 'bug', clipName: '*', bone: 'antennae', property: 'rotation', maxAbs: 0.1 },
  { rigId: 'bubble', clipName: '*', bone: 'halo', property: 'x', maxAbs: 1 },
  { rigId: 'bubble', clipName: '*', bone: 'halo', property: 'scaleX', maxAbs: 1.04 },
  { rigId: 'bubble', clipName: '*', bone: 'halo', property: 'scaleY', maxAbs: 1.04 },
  { rigId: 'windcap', clipName: 'attack', bone: 'cap', property: 'x', maxAbs: 1.2 },
  { rigId: 'windcap', clipName: 'attack', bone: 'cap', property: 'rotation', maxAbs: 0.08 },
  { rigId: 'stone', clipName: 'death', bone: 'rocks', property: 'x', maxAbs: 0.5 },
  { rigId: 'stone', clipName: 'death', bone: 'rocks', property: 'y', maxAbs: 0.5 },
  { rigId: 'stone', clipName: 'death', bone: 'rocks', property: 'rotation', maxAbs: 0.02 },
  { rigId: 'boss', clipName: '*', bone: 'tentacles', property: 'x', maxAbs: 3 },
  { rigId: 'boss', clipName: '*', bone: 'tentacles', property: 'y', maxAbs: 3 },
  { rigId: 'boss', clipName: '*', bone: 'tentacles', property: 'rotation', maxAbs: 0.12 },
  { rigId: 'boss', clipName: '*', bone: 'acidShell', property: 'x', maxAbs: 1.2 },
  { rigId: 'boss', clipName: '*', bone: 'acidShell', property: 'y', maxAbs: 1 },
  { rigId: 'boss', clipName: '*', bone: 'acidShell', property: 'rotation', maxAbs: 0.03 },
  { rigId: 'boss', clipName: '*', bone: 'crown', property: 'x', maxAbs: 1.8 },
  { rigId: 'boss', clipName: '*', bone: 'crown', property: 'y', maxAbs: 1.5 },
  { rigId: 'boss', clipName: '*', bone: 'crown', property: 'rotation', maxAbs: 0.05 },
  { rigId: 'boss', clipName: 'charge', bone: 'core', property: 'scaleX', maxAbs: 1.14 },
  { rigId: 'boss', clipName: 'charge', bone: 'core', property: 'scaleY', maxAbs: 1.14 },
]);

const CLIP_MINIMUM_LIMITS = Object.freeze([
  { rigId: 'bubble', clipName: 'hurt', bone: 'halo', property: 'scaleX', min: 0.99 },
]);

const NON_ACCESSORY_PARTS = new Set(['body', 'eyes', 'mouth']);

function number(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function frameTime(frame) {
  return Array.isArray(frame) ? frame[0] : frame.time;
}

function frameValue(frame) {
  return Array.isArray(frame) ? frame[1] : frame.value;
}

function trackValues(track, property) {
  const source = track?.[property];
  if (typeof source === 'number') return [source];
  if (Array.isArray(source) && source.length > 0) return source.map(frameValue);
  return [IDENTITY[property]];
}

function shortestAngleDelta(from, to) {
  const tau = Math.PI * 2;
  let delta = (to - from) % tau;
  if (delta > Math.PI) delta -= tau;
  if (delta < -Math.PI) delta += tau;
  return delta;
}

function sampleProperty(source, time, isRotation = false) {
  if (typeof source === 'number') return source;
  if (!Array.isArray(source) || source.length === 0) return undefined;
  if (time <= frameTime(source[0])) return frameValue(source[0]);
  const last = source.at(-1);
  if (time >= frameTime(last)) return frameValue(last);

  for (let index = 1; index < source.length; index += 1) {
    const right = source[index];
    if (time <= frameTime(right)) {
      const left = source[index - 1];
      const amount = (time - frameTime(left)) / (frameTime(right) - frameTime(left));
      const from = frameValue(left);
      const delta = isRotation
        ? shortestAngleDelta(from, frameValue(right))
        : frameValue(right) - from;
      return from + delta * amount;
    }
  }
  return frameValue(last);
}

function samplePose(rig, clip, time) {
  const pose = {};
  for (const boneName of Object.keys(rig.bones)) {
    const track = clip.tracks[boneName] ?? {};
    const transform = { ...IDENTITY };
    for (const property of TRANSFORM_KEYS) {
      const sampled = sampleProperty(track[property], time, property === 'rotation');
      if (sampled !== undefined) transform[property] = sampled;
    }
    pose[boneName] = transform;
  }
  return pose;
}

function sampleTimes(clip) {
  const steps = Math.max(48, Math.ceil(clip.duration * SAMPLE_RATE));
  const times = new Set([0, clip.duration]);
  for (let step = 0; step <= steps; step += 1) {
    times.add((clip.duration * step) / steps);
  }
  for (const track of Object.values(clip.tracks)) {
    for (const source of Object.values(track)) {
      if (!Array.isArray(source)) continue;
      for (const frame of source) times.add(frameTime(frame));
    }
  }
  return [...times].sort((left, right) => left - right);
}

function identityMatrix() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function multiply(left, right) {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function translate(x, y) {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

function rotate(angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { a: cosine, b: sine, c: -sine, d: cosine, e: 0, f: 0 };
}

function scale(x, y) {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

function boneMatrix(bone, transform) {
  const pivotX = number(bone.pivot?.x);
  const pivotY = number(bone.pivot?.y);
  return [
    translate(pivotX + transform.x, pivotY + transform.y),
    rotate(transform.rotation),
    scale(transform.scaleX, transform.scaleY),
    translate(-pivotX, -pivotY),
  ].reduce(multiply, identityMatrix());
}

function chainFor(rig, boneName) {
  const result = [];
  const visited = new Set();
  let cursor = boneName;
  while (cursor != null) {
    assert.ok(!visited.has(cursor), `${rig.id}.${boneName} contains a hierarchy cycle`);
    visited.add(cursor);
    const bone = rig.bones[cursor];
    assert.ok(bone, `${rig.id}.${boneName} references missing bone ${cursor}`);
    result.push(cursor);
    cursor = bone.parent;
  }
  return result.reverse();
}

function worldMatrix(rig, pose, boneName) {
  return chainFor(rig, boneName).reduce(
    (matrix, name) => multiply(matrix, boneMatrix(rig.bones[name], pose[name])),
    identityMatrix(),
  );
}

function transformPoint(matrix, x, y) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

function rectBounds(rect, matrix = identityMatrix()) {
  const points = [
    transformPoint(matrix, rect.x, rect.y),
    transformPoint(matrix, rect.x + rect.width, rect.y),
    transformPoint(matrix, rect.x + rect.width, rect.y + rect.height),
    transformPoint(matrix, rect.x, rect.y + rect.height),
  ];
  return {
    minX: Math.min(...points.map(({ x }) => x)),
    minY: Math.min(...points.map(({ y }) => y)),
    maxX: Math.max(...points.map(({ x }) => x)),
    maxY: Math.max(...points.map(({ y }) => y)),
  };
}

function unionBounds(bounds) {
  assert.ok(bounds.length > 0, 'cannot union an empty bounds list');
  return {
    minX: Math.min(...bounds.map(({ minX }) => minX)),
    minY: Math.min(...bounds.map(({ minY }) => minY)),
    maxX: Math.max(...bounds.map(({ maxX }) => maxX)),
    maxY: Math.max(...bounds.map(({ maxY }) => maxY)),
  };
}

function centerOf(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function descendantsOf(rig, ancestorName) {
  const descendants = new Set([ancestorName]);
  const visit = (boneName) => {
    for (const childName of rig.bones[boneName].children) {
      descendants.add(childName);
      visit(childName);
    }
  };
  visit(ancestorName);
  return descendants;
}

function movingBones(clips) {
  const result = new Set();
  for (const clip of Object.values(clips)) {
    for (const [boneName, track] of Object.entries(clip.tracks)) {
      for (const [property, source] of Object.entries(track)) {
        const identity = IDENTITY[property];
        const values = typeof source === 'number'
          ? [source]
          : source.map(frameValue);
        if (values.some((value) => Math.abs(value - identity) > EPSILON)) {
          result.add(boneName);
        }
      }
    }
  }
  return result;
}

function boundsContainsPoint(bounds, point, paddingX = 0, paddingY = paddingX) {
  return point.x >= bounds.minX - paddingX
    && point.x <= bounds.maxX + paddingX
    && point.y >= bounds.minY - paddingY
    && point.y <= bounds.maxY + paddingY;
}

function exceedsViewport(bounds, padding = 0.25) {
  return bounds.minX < RIG_RENDER_VIEWPORT.minX - padding
    || bounds.maxX > RIG_RENDER_VIEWPORT.maxX + padding
    || bounds.minY < RIG_RENDER_VIEWPORT.minY - padding
    || bounds.maxY > RIG_RENDER_VIEWPORT.maxY + padding;
}

function formatNumber(value) {
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  return rounded.toFixed(1);
}

function formatBounds(bounds) {
  return `[${formatNumber(bounds.minX)},${formatNumber(bounds.minY)} → ${formatNumber(bounds.maxX)},${formatNumber(bounds.maxY)}]`;
}

function formatRange(min, max) {
  return `[${formatNumber(min)},${formatNumber(max)}]`;
}

function recordExtreme(target, value, label, choose = Math.max) {
  if (target.value == null || choose(target.value, value) === value) {
    target.value = value;
    target.label = label;
  }
}

function analyzeClip(rig, parts, clipName, clip) {
  const staticCenters = new Map(parts.map((part) => [part.id, centerOf(part.bindRect)]));
  const sampledPartBounds = new Map(parts.map((part) => [part.id, []]));
  const allBounds = [];
  const rootX = { min: Infinity, max: -Infinity };
  const rootY = { min: Infinity, max: -Infinity };
  const scaleRange = { min: Infinity, max: -Infinity, minLabel: '', maxLabel: '' };
  const rotation = { value: null, label: '' };
  const localMove = { value: null, label: '' };
  const layerTravel = { value: null, label: '' };

  for (const time of sampleTimes(clip)) {
    const pose = samplePose(rig, clip, time);
    rootX.min = Math.min(rootX.min, pose[rig.root].x);
    rootX.max = Math.max(rootX.max, pose[rig.root].x);
    rootY.min = Math.min(rootY.min, pose[rig.root].y);
    rootY.max = Math.max(rootY.max, pose[rig.root].y);

    for (const [boneName, transform] of Object.entries(pose)) {
      const move = Math.hypot(transform.x, transform.y);
      recordExtreme(localMove, move, `${boneName}@${formatNumber(time)}s`);
      recordExtreme(rotation, Math.abs(transform.rotation), `${boneName}@${formatNumber(time)}s`);
      for (const property of ['scaleX', 'scaleY']) {
        const value = transform[property];
        if (value < scaleRange.min) {
          scaleRange.min = value;
          scaleRange.minLabel = `${boneName}.${property}@${formatNumber(time)}s`;
        }
        if (value > scaleRange.max) {
          scaleRange.max = value;
          scaleRange.maxLabel = `${boneName}.${property}@${formatNumber(time)}s`;
        }
      }
      assert.ok(
        transform.alpha >= 0 && transform.alpha <= 1,
        `${rig.id}.${clipName}.${boneName} alpha ${transform.alpha} is outside [0, 1]`,
      );
    }

    const frameBounds = [];
    for (const part of parts) {
      const matrix = worldMatrix(rig, pose, part.bone);
      const bounds = rectBounds(part.bindRect, matrix);
      frameBounds.push(bounds);
      sampledPartBounds.get(part.id).push(bounds);
      const center = staticCenters.get(part.id);
      const worldCenter = transformPoint(matrix, center.x, center.y);
      recordExtreme(
        layerTravel,
        Math.hypot(worldCenter.x - center.x, worldCenter.y - center.y),
        `${part.id}@${formatNumber(time)}s`,
      );
    }
    allBounds.push(unionBounds(frameBounds));
  }

  return {
    bounds: unionBounds(allBounds),
    rootX,
    rootY,
    scaleRange,
    rotation,
    localMove,
    layerTravel,
    partBounds: Object.fromEntries(
      [...sampledPartBounds].map(([partId, bounds]) => [partId, unionBounds(bounds)]),
    ),
  };
}

function validateSourceAspect(ownerId, part, issues) {
  if (!part.sourceRect) return;
  const sourceAspect = part.sourceRect.width / part.sourceRect.height;
  const bindAspect = part.bindRect.width / part.bindRect.height;
  const mismatch = Math.abs(Math.log(sourceAspect / bindAspect));
  if (mismatch > Math.log(1.06)) {
    issues.push(
      `[ASPECT_STRETCH] ${ownerId}.${part.id} source ratio ${sourceAspect.toFixed(3)} differs from bind ratio ${bindAspect.toFixed(3)} by ${(Math.abs(sourceAspect / bindAspect - 1) * 100).toFixed(1)}%`,
    );
  }
}

function validateMotionPivots(ownerId, rig, clips, parts, issues) {
  const animated = movingBones(clips);
  for (const boneName of animated) {
    if (PRIMARY_GROUND_BONES.has(boneName)) continue;
    const descendants = descendantsOf(rig, boneName);
    const controlledParts = parts.filter((part) => descendants.has(part.bone));
    if (controlledParts.length === 0) continue;
    const bounds = unionBounds(controlledParts.map((part) => rectBounds(part.bindRect)));
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const pivot = rig.bones[boneName].pivot ?? { x: 0, y: 0 };
    if (!boundsContainsPoint(bounds, pivot, width * 0.2, height * 0.2)) {
      issues.push(
        `[PIVOT_OUTSIDE] ${ownerId}.${boneName} animated pivot (${formatNumber(pivot.x)},${formatNumber(pivot.y)}) is far from descendant bounds ${formatBounds(bounds)} (${controlledParts.map(({ id }) => id).join(', ')})`,
      );
    }
  }
}

function validateFacialCenters(ownerId, rig, parts, issues) {
  for (const part of parts.filter(({ id }) => id === 'eyes' || id === 'mouth')) {
    const center = centerOf(part.bindRect);
    const pivot = rig.bones[part.bone].pivot ?? { x: 0, y: 0 };
    const drift = Math.hypot(center.x - pivot.x, center.y - pivot.y);
    if (drift > 0.01) {
      issues.push(
        `[FACE_CENTER_DRIFT] ${ownerId}.${part.id} pivot (${formatNumber(pivot.x)},${formatNumber(pivot.y)}) is ${drift.toFixed(3)} units from bind centre (${formatNumber(center.x)},${formatNumber(center.y)})`,
      );
    }
  }
}

function validateAccessoryViewport(ownerId, clipName, parts, extrema, issues) {
  for (const part of parts.filter(({ id }) => !NON_ACCESSORY_PARTS.has(id))) {
    const bounds = extrema.partBounds[part.id];
    if (exceedsViewport(bounds)) {
      issues.push(
        `[ACCESSORY_OVERFLOW] ${ownerId}.${clipName}.${part.id} bounds ${formatBounds(bounds)} exceed renderer viewport ${formatBounds(RIG_RENDER_VIEWPORT)}`,
      );
    }
  }
}

function validateClipAmplitude(ownerId, rig, clipName, clip, issues) {
  for (const limit of CLIP_AMPLITUDE_LIMITS) {
    if (limit.rigId !== rig.id) continue;
    if (limit.clipName !== '*' && limit.clipName !== clipName) continue;
    const values = trackValues(clip.tracks[limit.bone], limit.property);
    const maximum = Math.max(...values.map(Math.abs));
    if (maximum > limit.maxAbs + EPSILON) {
      issues.push(
        `[CLIP_AMPLITUDE] ${ownerId}.${clipName}.${limit.bone}.${limit.property} reaches ${maximum.toFixed(3)}, limit ${limit.maxAbs.toFixed(3)}`,
      );
    }
  }

  for (const limit of CLIP_MINIMUM_LIMITS) {
    if (limit.rigId !== rig.id || limit.clipName !== clipName) continue;
    const minimum = Math.min(...trackValues(clip.tracks[limit.bone], limit.property));
    if (minimum < limit.min - EPSILON) {
      issues.push(
        `[CLIP_MINIMUM] ${ownerId}.${clipName}.${limit.bone}.${limit.property} falls to ${minimum.toFixed(3)}, minimum ${limit.min.toFixed(3)}`,
      );
    }
  }
}

function validateClipExtremes(ownerId, rig, clipName, extrema, staticBounds, issues) {
  const isBoss = rig.id === 'boss';
  const staticWidth = staticBounds.maxX - staticBounds.minX;
  const staticHeight = staticBounds.maxY - staticBounds.minY;
  const animatedWidth = extrema.bounds.maxX - extrema.bounds.minX;
  const animatedHeight = extrema.bounds.maxY - extrema.bounds.minY;

  if (exceedsViewport(extrema.bounds)) {
    issues.push(
      `[CLIP_OVERFLOW] ${ownerId}.${clipName} bounds ${formatBounds(extrema.bounds)} exceed renderer viewport ${formatBounds(RIG_RENDER_VIEWPORT)} and will be clipped`,
    );
  }
  if (animatedWidth > staticWidth * 1.65 || animatedHeight > staticHeight * 1.65) {
    issues.push(
      `[CLIP_PROPORTION] ${ownerId}.${clipName} expands ${formatNumber(animatedWidth / staticWidth)}× wide and ${formatNumber(animatedHeight / staticHeight)}× tall`,
    );
  }
  if (extrema.localMove.value > (isBoss ? 22 : 16)) {
    issues.push(
      `[LOCAL_TRANSLATION] ${ownerId}.${clipName} reaches ${formatNumber(extrema.localMove.value)} units at ${extrema.localMove.label}`,
    );
  }
  if (extrema.scaleRange.min <= 0 || extrema.scaleRange.max > 1.6) {
    issues.push(
      `[SCALE_RANGE] ${ownerId}.${clipName} scale ${formatRange(extrema.scaleRange.min, extrema.scaleRange.max)} at ${extrema.scaleRange.minLabel}/${extrema.scaleRange.maxLabel}`,
    );
  }
  if (extrema.rotation.value > 1.25) {
    issues.push(
      `[ROTATION_RANGE] ${ownerId}.${clipName} reaches ${formatNumber(extrema.rotation.value * 180 / Math.PI)}° at ${extrema.rotation.label}`,
    );
  }
}

function analyzeOwner(ownerId, entry) {
  const rig = RIGS[entry.rigId];
  const clips = CLIPS[entry.rigId];
  assert.ok(rig, `${ownerId} references unknown rig ${entry.rigId}`);
  assert.ok(clips, `${ownerId} has no clips for rig ${entry.rigId}`);
  assert.ok(entry.parts.length > 0, `${ownerId} must contain visible parts`);

  const issues = [];
  const layerLines = [];
  for (const part of entry.parts) {
    assert.ok(rig.bones[part.bone], `${ownerId}.${part.id} references missing bone ${part.bone}`);
    assert.ok(part.bindRect.width > 0 && part.bindRect.height > 0, `${ownerId}.${part.id} has an empty bindRect`);
    validateSourceAspect(ownerId, part, issues);
    const chain = chainFor(rig, part.bone);
    const pivotChain = chain.map((boneName) => {
      const pivot = rig.bones[boneName].pivot ?? { x: 0, y: 0 };
      return `${boneName}(${formatNumber(pivot.x)},${formatNumber(pivot.y)})`;
    }).join(' > ');
    layerLines.push(
      `  layer ${part.id.padEnd(12)} z=${String(part.z).padStart(3)} bind=[${formatNumber(part.bindRect.x)},${formatNumber(part.bindRect.y)},${formatNumber(part.bindRect.width)},${formatNumber(part.bindRect.height)}] final=${formatBounds(rectBounds(part.bindRect))} chain=${pivotChain}`,
    );
  }

  validateMotionPivots(ownerId, rig, clips, entry.parts, issues);
  validateFacialCenters(ownerId, rig, entry.parts, issues);
  const staticBounds = unionBounds(entry.parts.map((part) => rectBounds(part.bindRect)));
  if (!boundsContainsPoint(RIG_RENDER_VIEWPORT, {
    x: staticBounds.minX,
    y: staticBounds.minY,
  }) || !boundsContainsPoint(RIG_RENDER_VIEWPORT, {
    x: staticBounds.maxX,
    y: staticBounds.maxY,
  })) {
    issues.push(
      `[STATIC_OVERFLOW] ${ownerId} bind-pose bounds ${formatBounds(staticBounds)} exceed renderer viewport ${formatBounds(RIG_RENDER_VIEWPORT)}`,
    );
  }
  const clipLines = [];
  for (const [clipName, clip] of Object.entries(clips)) {
    const extrema = analyzeClip(rig, entry.parts, clipName, clip);
    validateClipAmplitude(ownerId, rig, clipName, clip, issues);
    validateClipExtremes(ownerId, rig, clipName, extrema, staticBounds, issues);
    validateAccessoryViewport(ownerId, clipName, entry.parts, extrema, issues);
    clipLines.push(
      `  clip  ${clipName.padEnd(8)} bounds=${formatBounds(extrema.bounds)} rootX=${formatRange(extrema.rootX.min, extrema.rootX.max)} rootY=${formatRange(extrema.rootY.min, extrema.rootY.max)} scale=${formatRange(extrema.scaleRange.min, extrema.scaleRange.max)} maxRot=${formatNumber(extrema.rotation.value * 180 / Math.PI)}°(${extrema.rotation.label}) maxLocalMove=${formatNumber(extrema.localMove.value)}(${extrema.localMove.label}) maxLayerTravel=${formatNumber(extrema.layerTravel.value)}(${extrema.layerTravel.label})`,
    );
  }

  return {
    report: [
      `\n[RIG-DEBUG] ${ownerId} rig=${rig.id} static=${formatBounds(staticBounds)} viewport=${formatBounds(RIG_RENDER_VIEWPORT)}`,
      ...layerLines,
      ...clipLines,
      ...(issues.length === 0 ? ['  status OK'] : issues.map((issue) => `  WARN  ${issue}`)),
    ].join('\n'),
    issues,
  };
}

const RESULTS = Object.entries(MANIFEST.rigs).map(([ownerId, entry]) => ({
  ownerId,
  ...analyzeOwner(ownerId, entry),
}));

// This harness deliberately prints geometry, not pixels. It catches assembly
// errors that a drawImage call-count mock cannot observe and never decodes or
// displays legacy previews or atlas images.
console.log(RESULTS.map(({ report }) => report).join('\n'));

test('alignment audit anchors and foreground layers stay calibrated', () => {
  const part = (ownerId, partId) => MANIFEST.rigs[ownerId].parts.find(({ id }) => id === partId);

  assert.deepEqual(part('survivor-shell-shell', 'shellBack').bindRect, {
    x: -91, y: -120, width: 124, height: 110,
  });
  assert.deepEqual(SHELL_RIG.bones.shellAssembly.pivot, { x: -20, y: -63 });
  assert.deepEqual(SHELL_RIG.bones.shellBack.pivot, { x: -20, y: -63 });
  assert.deepEqual(SHELL_RIG.bones.shellFront.pivot, { x: -20, y: -63 });
  assert.deepEqual(SHELL_RIG.bones.face.pivot, { x: 19, y: -38 });
  assert.deepEqual(SHELL_RIG.bones.eyes.pivot, { x: 18.5, y: -42.5 });
  assert.deepEqual(SHELL_RIG.bones.mouth.pivot, { x: 21, y: -31.5 });
  assert.equal(part('survivor-shell-shell', 'shellFront').z, 5);
  assert.ok(
    part('survivor-shell-shell', 'shellFront').z
      < part('survivor-shell-shell', 'eyes').z,
  );

  assert.deepEqual(part('survivor-bubble-float', 'bubbleLarge').bindRect, {
    x: 14, y: -104, width: 28, height: 28,
  });
  assert.deepEqual(part('survivor-bubble-float', 'bubbleMedium').bindRect, {
    x: 36, y: -91, width: 19, height: 18,
  });
  assert.deepEqual(part('survivor-bubble-float', 'bubbleSmall').bindRect, {
    x: 3, y: -97, width: 12, height: 12,
  });
  assert.equal(part('survivor-bubble-float', 'ring').bindRect.y, -30);
  assert.deepEqual(BUBBLE_RIG.bones.bubbles.pivot, { x: 28, y: -88 });
  assert.deepEqual(BUBBLE_RIG.bones.halo.pivot, { x: 0, y: -21 });

  assert.deepEqual(CRYSTAL_RIG.bones.needles.pivot, { x: -24.3, y: -48.4 });
  assert.deepEqual(CRYSTAL_RIG.bones.needleMidUpper.pivot, { x: -24.316, y: -48.418 });
  assert.deepEqual(SPROUT_RIG.bones.sprout.pivot, { x: 7.5, y: -94.3 });
  assert.deepEqual(SPROUT_RIG.bones.leafLeft.pivot, { x: 6.69, y: -94.39 });
  assert.deepEqual(SPROUT_RIG.bones.leafRight.pivot, { x: 8.162, y: -94.267 });
  assert.equal(
    SPROUT_RIG.bones.pack.layer,
    part('survivor-moss-sprout', 'pack').z,
  );

  assert.deepEqual([
    centerOf(part('enemy-soft-biter', 'legsA').bindRect).x,
    centerOf(part('enemy-soft-biter', 'legsB').bindRect).x,
  ], [-4, 4]);

  assert.deepEqual(part('enemy-acid-shell-king', 'acidShell').bindRect, {
    x: -48, y: -107.65, width: 96, height: 65.3,
  });
  assert.deepEqual(part('enemy-acid-shell-king', 'crown').bindRect, {
    x: -19, y: -126, width: 38, height: 26.51,
  });
  assert.equal(BOSS_RIG.bones.acidShell.layer, part('enemy-acid-shell-king', 'acidShell').z);
  assert.equal(BOSS_RIG.bones.crown.layer, part('enemy-acid-shell-king', 'crown').z);
  assert.equal(BOSS_RIG.bones.core.layer, part('enemy-acid-shell-king', 'core').z);
  assert.equal(BOSS_RIG.bones.crown.parent, 'acidShell');
  assert.deepEqual(BOSS_RIG.bones.crown.pivot, { x: 0, y: -100 });
  assert.ok(BOSS_RIG.bones.acidShell.layer < BOSS_RIG.bones.crown.layer);
  assert.ok(BOSS_RIG.bones.crown.layer < BOSS_RIG.bones.core.layer);
});

for (const { ownerId, issues } of RESULTS) {
  test(`${ownerId} layered rig remains geometrically sane through every clip`, () => {
    assert.deepEqual(
      issues,
      [],
      `${ownerId} rig geometry warnings:\n${issues.join('\n')}`,
    );
  });
}
