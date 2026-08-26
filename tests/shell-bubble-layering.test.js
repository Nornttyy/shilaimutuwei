import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AnimationController } from '../src/animation/controller.js';
import { BUBBLE_CLIPS, SHELL_CLIPS } from '../src/animation/clips.js';
import { BUBBLE_RIG, SHELL_RIG } from '../src/animation/rigs.js';
import {
  cropRgba,
  decodeRgbaPng,
} from '../scripts/export-rig-layers.mjs';

const MANIFEST = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));

const SHELL_OWNER = 'survivor-shell-shell';
const BUBBLE_OWNER = 'survivor-bubble-float';
const SHELL_PART_ORDER = Object.freeze([
  'shellBack',
  'body',
  'shellFront',
  'eyes',
  'mouth',
]);
const SHELL_Z_ORDER = Object.freeze([-10, 0, 5, 10, 20]);
const SHELL_ATLAS_PATH = 'assets/generated-v2/rig/survivor-shell-shell/atlas-layered-v3.png';
const SHELL_CONTRACT = Object.freeze({
  shellBack: Object.freeze({
    sourceRect: Object.freeze({ x: 4, y: 4, width: 496, height: 440 }),
    bindRect: Object.freeze({ x: -91, y: -120, width: 124, height: 110 }),
  }),
  body: Object.freeze({
    sourceRect: Object.freeze({ x: 508, y: 4, width: 408, height: 280 }),
    bindRect: Object.freeze({ x: -51, y: -70, width: 102, height: 70 }),
  }),
  shellFront: Object.freeze({
    sourceRect: Object.freeze({ x: 508, y: 292, width: 320, height: 256 }),
    bindRect: Object.freeze({ x: -44, y: -92, width: 80, height: 64 }),
  }),
  eyes: Object.freeze({
    sourceRect: Object.freeze({ x: 836, y: 292, width: 172, height: 84 }),
    bindRect: Object.freeze({ x: -3, y: -53, width: 43, height: 21 }),
  }),
  mouth: Object.freeze({
    sourceRect: Object.freeze({ x: 836, y: 384, width: 64, height: 60 }),
    bindRect: Object.freeze({ x: 13, y: -39, width: 16, height: 15 }),
  }),
});
const BUBBLE_PART_ORDER = Object.freeze([
  'bubbleLarge',
  'bubbleSmall',
  'bubbleMedium',
  'body',
  'eyes',
  'mouth',
  'ring',
]);
const BUBBLE_IDS = Object.freeze(['bubbleLarge', 'bubbleSmall', 'bubbleMedium']);
const FORBIDDEN_ASSET_SEGMENT = /(?:^|[\/_.-])(?:review|preview|candidates?)(?:[\/_.-]|$)/i;
const PRODUCTION_RIG_PNG = /^assets\/generated-v2\/rig\/([^/]+)\/[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/;
const ALPHA_THRESHOLD = 96;
const LOGICAL_SAMPLES_PER_UNIT = 8;
const imageCache = new Map();

function assertFiniteRect(rect, label) {
  assert.ok(rect && typeof rect === 'object', `${label} must be an object`);
  for (const key of ['x', 'y', 'width', 'height']) {
    assert.equal(Number.isFinite(rect[key]), true, `${label}.${key} must be finite`);
  }
  assert.ok(rect.width > 0, `${label}.width must be positive`);
  assert.ok(rect.height > 0, `${label}.height must be positive`);
}

function rectsOverlap(left, right) {
  return (
    left.x < right.x + right.width
    && right.x < left.x + left.width
    && left.y < right.y + right.height
    && right.y < left.y + left.height
  );
}

function assertIndependentSourceCells(parts, label) {
  for (const [index, part] of parts.entries()) {
    assertFiniteRect(part.sourceRect, `${label}.${part.id}.sourceRect`);
    assertFiniteRect(part.bindRect, `${label}.${part.id}.bindRect`);
    for (let otherIndex = index + 1; otherIndex < parts.length; otherIndex += 1) {
      const other = parts[otherIndex];
      if (part.path !== other.path) continue;
      assert.equal(
        rectsOverlap(part.sourceRect, other.sourceRect),
        false,
        `${label}.${part.id} and ${other.id} must use independent atlas cells`,
      );
    }
  }
}

async function productionImage(assetPath, ownerId) {
  assert.equal(
    FORBIDDEN_ASSET_SEGMENT.test(assetPath),
    false,
    `${ownerId} must not read a review, preview, or candidate image`,
  );
  const match = assetPath.match(PRODUCTION_RIG_PNG);
  assert.ok(match, `${ownerId} image must be a direct production rig PNG`);
  assert.equal(match[1], ownerId, `${ownerId} image must stay in its owner directory`);

  let image = imageCache.get(assetPath);
  if (!image) {
    image = decodeRgbaPng(
      await readFile(new URL(`../${assetPath}`, import.meta.url)),
      `${ownerId}:${assetPath}`,
    );
    imageCache.set(assetPath, image);
  }
  return image;
}

async function cropPart(part, ownerId, label = part.id) {
  return cropRgba(
    await productionImage(part.path, ownerId),
    part.sourceRect,
    `${ownerId}:${label}`,
  );
}

function pixelCount(image, predicate) {
  let count = 0;
  for (let offset = 0; offset < image.pixels.length; offset += 4) {
    if (predicate(
      image.pixels[offset],
      image.pixels[offset + 1],
      image.pixels[offset + 2],
      image.pixels[offset + 3],
    )) count += 1;
  }
  return count;
}

function visiblePixelCount(image, threshold = 0) {
  return pixelCount(image, (_red, _green, _blue, alpha) => alpha > threshold);
}

function connectedComponents(image, predicate, minimumArea = 1) {
  const seen = new Uint8Array(image.width * image.height);
  const components = [];
  for (let start = 0; start < seen.length; start += 1) {
    const startOffset = start * 4;
    if (seen[start] || !predicate(
      image.pixels[startOffset],
      image.pixels[startOffset + 1],
      image.pixels[startOffset + 2],
      image.pixels[startOffset + 3],
    )) continue;

    const queue = [start];
    seen[start] = 1;
    let area = 0;
    let left = image.width;
    let top = image.height;
    let right = -1;
    let bottom = -1;
    while (queue.length > 0) {
      const current = queue.pop();
      const x = current % image.width;
      const y = Math.floor(current / image.width);
      area += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);

      for (let nextY = Math.max(0, y - 1); nextY <= Math.min(image.height - 1, y + 1); nextY += 1) {
        for (let nextX = Math.max(0, x - 1); nextX <= Math.min(image.width - 1, x + 1); nextX += 1) {
          const next = nextY * image.width + nextX;
          if (seen[next]) continue;
          const nextOffset = next * 4;
          if (!predicate(
            image.pixels[nextOffset],
            image.pixels[nextOffset + 1],
            image.pixels[nextOffset + 2],
            image.pixels[nextOffset + 3],
          )) continue;
          seen[next] = 1;
          queue.push(next);
        }
      }
    }

    if (area >= minimumArea) {
      components.push({
        area,
        left,
        top,
        right: right + 1,
        bottom: bottom + 1,
      });
    }
  }
  return components.sort((left, right) => right.area - left.area);
}

function alphaComponents(image) {
  const minimumArea = Math.max(12, Math.floor(image.width * image.height / 200));
  return connectedComponents(
    image,
    (_red, _green, _blue, alpha) => alpha >= 32,
    minimumArea,
  );
}

function orangeShellPixels(image) {
  return pixelCount(image, (red, green, blue, alpha) => (
    alpha >= ALPHA_THRESHOLD
    && red >= 120
    && red > green * 1.12
    && green > blue * 1.05
    && red - blue >= 50
  ));
}

function darkInkComponents(image) {
  const minimumArea = Math.max(24, Math.floor(image.width * image.height / 1000));
  return connectedComponents(
    image,
    (red, green, blue, alpha) => (
      alpha >= ALPHA_THRESHOLD
      && red < 55
      && green < 75
      && blue < 110
    ),
    minimumArea,
  );
}

function pixelHash(image) {
  return createHash('sha256').update(image.pixels).digest('hex');
}

function identityMatrix() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function multiplyMatrices(left, right) {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function boneMatrix(bone, transform = {}) {
  const pivotX = bone.pivot?.x ?? 0;
  const pivotY = bone.pivot?.y ?? 0;
  const x = transform.x ?? 0;
  const y = transform.y ?? 0;
  const rotation = transform.rotation ?? 0;
  const scaleX = transform.scaleX ?? 1;
  const scaleY = transform.scaleY ?? 1;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const a = cosine * scaleX;
  const b = sine * scaleX;
  const c = -sine * scaleY;
  const d = cosine * scaleY;
  return {
    a,
    b,
    c,
    d,
    e: pivotX + x - a * pivotX - c * pivotY,
    f: pivotY + y - b * pivotX - d * pivotY,
  };
}

function matrixForBone(rig, pose, boneName) {
  const chain = [];
  const visited = new Set();
  let current = boneName;
  while (current != null) {
    assert.equal(visited.has(current), false, `bone cycle at ${current}`);
    visited.add(current);
    const bone = rig.bones[current];
    assert.ok(bone, `missing rig bone ${current}`);
    chain.push({ name: current, bone });
    current = bone.parent;
  }
  chain.reverse();
  return chain.reduce(
    (matrix, { name, bone }) => multiplyMatrices(matrix, boneMatrix(bone, pose[name])),
    identityMatrix(),
  );
}

function invertMatrix(matrix) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  assert.ok(Math.abs(determinant) > 1e-9, 'layer transform must be invertible');
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
  };
}

function transformPoint(matrix, x, y) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

function transformedBounds(rect, matrix) {
  const points = [
    transformPoint(matrix, rect.x, rect.y),
    transformPoint(matrix, rect.x + rect.width, rect.y),
    transformPoint(matrix, rect.x, rect.y + rect.height),
    transformPoint(matrix, rect.x + rect.width, rect.y + rect.height),
  ];
  return {
    left: Math.min(...points.map(({ x }) => x)),
    top: Math.min(...points.map(({ y }) => y)),
    right: Math.max(...points.map(({ x }) => x)),
    bottom: Math.max(...points.map(({ y }) => y)),
  };
}

function resolvedDescriptor(part, state, rig = SHELL_RIG) {
  const slotName = rig.expression.states[state]?.[part.id] ?? 'normal';
  const variant = slotName === 'normal' ? null : part.variants?.[slotName];
  assert.ok(slotName === 'normal' || variant, `${part.id} must define ${slotName}`);
  return {
    path: variant?.path ?? part.path,
    sourceRect: variant?.sourceRect ?? part.sourceRect,
    bindRect: variant?.bindRect ?? part.bindRect,
    bone: part.bone,
  };
}

function alphaAtLogicalPoint(descriptor, image, inverseMatrix, worldX, worldY) {
  const local = transformPoint(inverseMatrix, worldX, worldY);
  const rect = descriptor.bindRect;
  const relativeX = (local.x - rect.x) / rect.width;
  const relativeY = (local.y - rect.y) / rect.height;
  if (relativeX < 0 || relativeY < 0 || relativeX >= 1 || relativeY >= 1) return 0;
  const source = descriptor.sourceRect;
  const sourceX = source.x + Math.min(source.width - 1, Math.floor(relativeX * source.width));
  const sourceY = source.y + Math.min(source.height - 1, Math.floor(relativeY * source.height));
  return image.pixels[(sourceY * image.width + sourceX) * 4 + 3];
}

function firstSampleAtOrAfter(value) {
  const step = 1 / LOGICAL_SAMPLES_PER_UNIT;
  let sample = (Math.floor(value * LOGICAL_SAMPLES_PER_UNIT) + 0.5) * step;
  if (sample < value) sample += step;
  return sample;
}

async function logicalAlphaOverlap(left, right, pose, rig = SHELL_RIG, ownerId = SHELL_OWNER) {
  const leftImage = await productionImage(left.path, ownerId);
  const rightImage = await productionImage(right.path, ownerId);
  const leftMatrix = matrixForBone(rig, pose, left.bone);
  const rightMatrix = matrixForBone(rig, pose, right.bone);
  const leftBounds = transformedBounds(left.bindRect, leftMatrix);
  const rightBounds = transformedBounds(right.bindRect, rightMatrix);
  const intersection = {
    left: Math.max(leftBounds.left, rightBounds.left),
    top: Math.max(leftBounds.top, rightBounds.top),
    right: Math.min(leftBounds.right, rightBounds.right),
    bottom: Math.min(leftBounds.bottom, rightBounds.bottom),
  };
  if (intersection.left >= intersection.right || intersection.top >= intersection.bottom) return 0;

  const leftInverse = invertMatrix(leftMatrix);
  const rightInverse = invertMatrix(rightMatrix);
  const step = 1 / LOGICAL_SAMPLES_PER_UNIT;
  let overlap = 0;
  const startX = firstSampleAtOrAfter(intersection.left);
  const startY = firstSampleAtOrAfter(intersection.top);
  for (let y = startY; y < intersection.bottom; y += step) {
    for (let x = startX; x < intersection.right; x += step) {
      if (
        alphaAtLogicalPoint(left, leftImage, leftInverse, x, y) >= ALPHA_THRESHOLD
        && alphaAtLogicalPoint(right, rightImage, rightInverse, x, y) >= ALPHA_THRESHOLD
      ) overlap += 1;
    }
  }
  return overlap;
}

async function logicalVisibleFraction(
  descriptor,
  higherDescriptors,
  pose,
  rig,
  ownerId,
) {
  const image = await productionImage(descriptor.path, ownerId);
  const matrix = matrixForBone(rig, pose, descriptor.bone);
  const inverse = invertMatrix(matrix);
  const bounds = transformedBounds(descriptor.bindRect, matrix);
  const higher = await Promise.all(higherDescriptors.map(async (candidate) => {
    const candidateMatrix = matrixForBone(rig, pose, candidate.bone);
    return {
      descriptor: candidate,
      image: await productionImage(candidate.path, ownerId),
      inverse: invertMatrix(candidateMatrix),
      bounds: transformedBounds(candidate.bindRect, candidateMatrix),
    };
  }));

  const step = 1 / LOGICAL_SAMPLES_PER_UNIT;
  let support = 0;
  let visible = 0;
  for (let y = firstSampleAtOrAfter(bounds.top); y < bounds.bottom; y += step) {
    for (let x = firstSampleAtOrAfter(bounds.left); x < bounds.right; x += step) {
      if (alphaAtLogicalPoint(descriptor, image, inverse, x, y) < ALPHA_THRESHOLD) continue;
      support += 1;
      const covered = higher.some((candidate) => (
        x >= candidate.bounds.left
        && x < candidate.bounds.right
        && y >= candidate.bounds.top
        && y < candidate.bounds.bottom
        && alphaAtLogicalPoint(
          candidate.descriptor,
          candidate.image,
          candidate.inverse,
          x,
          y,
        ) >= ALPHA_THRESHOLD
      ));
      if (!covered) visible += 1;
    }
  }
  assert.ok(support > 0, `${descriptor.bone} must have logical alpha support`);
  return visible / support;
}

function clipSampleTimes(clip) {
  const times = new Set([0, clip.duration]);
  for (const track of Object.values(clip.tracks)) {
    for (const value of Object.values(track)) {
      if (!Array.isArray(value)) continue;
      for (const frame of value) times.add(Array.isArray(frame) ? frame[0] : frame.time);
    }
  }
  for (let index = 1; index < 12; index += 1) times.add(clip.duration * index / 12);
  return [...times].sort((left, right) => left - right);
}

function poseAt(clips, clipName, time) {
  const controller = new AnimationController(clips, {
    base: clipName,
    transitionDuration: 0,
  });
  controller.update(time);
  return controller.sample();
}

function assertMatrixApproximatelyEqual(actual, expected, label, epsilon = 1e-9) {
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) <= epsilon,
      `${label}.${key}: expected ${expected[key]}, received ${actual[key]}`,
    );
  }
}

function transformValues(track, property) {
  const value = track?.[property];
  if (typeof value === 'number') return [value];
  if (!Array.isArray(value)) return [];
  return value.map((frame) => (Array.isArray(frame) ? frame[1] : frame.value));
}

test('Shell production atlas exposes clean rear, body, foreground, and face cells', async () => {
  const parts = MANIFEST.rigs[SHELL_OWNER].parts;
  assert.deepEqual(parts.map(({ id }) => id), SHELL_PART_ORDER);
  assert.deepEqual(parts.map(({ z }) => z), SHELL_Z_ORDER);
  assert.ok(parts.every(({ path }) => path === SHELL_ATLAS_PATH));
  assertIndependentSourceCells(parts, 'shell');

  const crops = new Map();
  for (const part of parts) {
    assert.deepEqual(part.sourceRect, SHELL_CONTRACT[part.id].sourceRect);
    assert.deepEqual(part.bindRect, SHELL_CONTRACT[part.id].bindRect);
    assert.equal(part.bone, part.id, `${part.id} must own an independent bone`);
    const crop = await cropPart(part, SHELL_OWNER);
    crops.set(part.id, crop);
    assert.ok(visiblePixelCount(crop) > 0, `${part.id} must contain visible pixels`);
    assert.ok(
      visiblePixelCount(crop) < crop.width * crop.height,
      `${part.id} must preserve transparent padding`,
    );
  }
  assert.equal(new Set([...crops.values()].map(pixelHash)).size, parts.length);

  for (const id of ['shellBack', 'shellFront']) {
    const crop = crops.get(id);
    const visible = visiblePixelCount(crop, ALPHA_THRESHOLD);
    assert.ok(orangeShellPixels(crop) > visible * 0.2, `${id} must retain caramel shell pixels`);
  }

  const body = crops.get('body');
  assert.equal(orangeShellPixels(body), 0, 'body must not retain baked caramel shell pixels');
  const bodyInk = darkInkComponents(body);
  assert.equal(bodyInk.length, 1, 'body must contain only its connected outer ink contour');
  assert.ok(bodyInk[0].right - bodyInk[0].left > body.width * 0.8);
  assert.ok(bodyInk[0].bottom - bodyInk[0].top > body.height * 0.7);
});

test('Shell foreground stays below normal, attack, and hurt expressions through every pose', async () => {
  const parts = MANIFEST.rigs[SHELL_OWNER].parts;
  const frontPart = parts.find(({ id }) => id === 'shellFront');
  const eyesPart = parts.find(({ id }) => id === 'eyes');
  const mouthPart = parts.find(({ id }) => id === 'mouth');
  assert.ok(frontPart && eyesPart && mouthPart);
  assert.ok(frontPart.z < eyesPart.z);
  assert.ok(frontPart.z < mouthPart.z);

  const cases = [
    { label: 'bind normal', state: 'normal', pose: {} },
    { label: 'bind attack', state: 'attack', pose: {} },
    { label: 'bind hurt', state: 'hurt', pose: {} },
  ];
  for (const [clipName, state] of [['idle', 'normal'], ['attack', 'attack'], ['hurt', 'hurt']]) {
    for (const time of clipSampleTimes(SHELL_CLIPS[clipName])) {
      cases.push({
        label: `${clipName}@${time.toFixed(4)}`,
        state,
        pose: poseAt(SHELL_CLIPS, clipName, time),
      });
    }
  }

  const front = resolvedDescriptor(frontPart, 'normal');
  for (const sample of cases) {
    const eyes = resolvedDescriptor(eyesPart, sample.state);
    const mouth = resolvedDescriptor(mouthPart, sample.state);
    assert.ok(
      await logicalAlphaOverlap(front, front, sample.pose) > 0,
      `${sample.label}: shellFront must retain alpha support`,
    );
    assert.ok(
      await logicalVisibleFraction(
        eyes,
        [mouth],
        sample.pose,
        SHELL_RIG,
        SHELL_OWNER,
      ) > 0.999,
      `${sample.label}: final composition must retain the complete eye alpha`,
    );
    assert.ok(
      await logicalVisibleFraction(
        mouth,
        [],
        sample.pose,
        SHELL_RIG,
        SHELL_OWNER,
      ) > 0.999,
      `${sample.label}: final composition must retain the complete mouth alpha`,
    );
  }
});

test('Shell shares deformation and keeps the large rear and foreground shell attached as one assembly', async () => {
  assert.deepEqual(SHELL_RIG.bones.motion.children, ['deform']);
  assert.equal(SHELL_RIG.bones.deform.parent, 'motion');
  assert.deepEqual(SHELL_RIG.bones.deform.children, ['body', 'shellAssembly', 'face']);
  assert.equal(SHELL_RIG.bones.body.parent, 'deform');
  assert.equal(SHELL_RIG.bones.face.parent, 'deform');
  assert.equal(SHELL_RIG.bones.shellAssembly.parent, 'deform');
  assert.deepEqual(SHELL_RIG.bones.shellAssembly.children, ['shellBack', 'shellFront']);
  assert.equal(SHELL_RIG.bones.shellBack.parent, 'shellAssembly');
  assert.equal(SHELL_RIG.bones.shellFront.parent, 'shellAssembly');

  const parts = MANIFEST.rigs[SHELL_OWNER].parts;
  const body = resolvedDescriptor(parts.find(({ id }) => id === 'body'), 'normal');
  const back = resolvedDescriptor(parts.find(({ id }) => id === 'shellBack'), 'normal');
  const front = resolvedDescriptor(parts.find(({ id }) => id === 'shellFront'), 'normal');
  assert.deepEqual(SHELL_RIG.bones.shellBack.pivot, SHELL_RIG.bones.shellAssembly.pivot);
  assert.deepEqual(SHELL_RIG.bones.shellFront.pivot, SHELL_RIG.bones.shellAssembly.pivot);

  for (const [clipName, clip] of Object.entries(SHELL_CLIPS)) {
    const deformScale = [
      ...transformValues(clip.tracks.deform, 'scaleX'),
      ...transformValues(clip.tracks.deform, 'scaleY'),
    ];
    assert.ok(deformScale.every((value) => value >= 0.94 && value <= 1.06));
    assert.ok(transformValues(clip.tracks.shellFront, 'rotation').every(
      (value) => value === 0,
    ));
    assert.ok(transformValues(clip.tracks.shellBack, 'rotation').every(
      (value) => value === 0,
    ));

    for (const time of clipSampleTimes(clip)) {
      const pose = poseAt(SHELL_CLIPS, clipName, time);
      assertMatrixApproximatelyEqual(
        matrixForBone(SHELL_RIG, pose, 'shellBack'),
        matrixForBone(SHELL_RIG, pose, 'shellFront'),
        `${clipName}@${time.toFixed(4)} shell assembly seam`,
      );
    }
  }

  const representativePoses = [
    {},
    poseAt(SHELL_CLIPS, 'idle', SHELL_CLIPS.idle.duration / 2),
    poseAt(SHELL_CLIPS, 'attack', 0.27),
    poseAt(SHELL_CLIPS, 'hurt', 0.06),
    poseAt(SHELL_CLIPS, 'downed', SHELL_CLIPS.downed.duration),
  ];
  const rearVisibility = [];
  for (const pose of representativePoses) {
    assert.ok(
      await logicalAlphaOverlap(back, body, pose, SHELL_RIG, SHELL_OWNER) > 0,
      'the large rear shell must meet the slime body instead of floating away',
    );
    assert.ok(
      await logicalAlphaOverlap(front, body, pose, SHELL_RIG, SHELL_OWNER) > 0,
      'the foreground harness must stay seated on the slime body',
    );
    rearVisibility.push(await logicalVisibleFraction(
      back,
      [body, front],
      pose,
      SHELL_RIG,
      SHELL_OWNER,
    ));
  }
  assert.ok(
    Math.min(...rearVisibility) > 0.25,
    'the oversized spiral shell must keep a readable defensive silhouette',
  );
});

test('Bubble production atlas gives every bubble its own cell and bone', async () => {
  const parts = MANIFEST.rigs[BUBBLE_OWNER].parts;
  assert.deepEqual(parts.map(({ id }) => id), BUBBLE_PART_ORDER);
  assert.ok(parts.every(({ path }) => path === parts[0].path));
  assertIndependentSourceCells(parts, 'bubble');

  const bubbles = BUBBLE_IDS.map((id) => parts.find((part) => part.id === id));
  assert.ok(bubbles.every(Boolean));
  assert.deepEqual(bubbles.map(({ bone }) => bone), BUBBLE_IDS);
  assert.equal('bubblesBack' in BUBBLE_RIG.bones, false);
  assert.equal(new Set(bubbles.map(({ bone }) => bone)).size, BUBBLE_IDS.length);
  assert.equal(new Set(bubbles.map(({ sourceRect }) => JSON.stringify(sourceRect))).size, BUBBLE_IDS.length);
  assert.equal(new Set(bubbles.map(({ bindRect }) => JSON.stringify(bindRect))).size, BUBBLE_IDS.length);

  for (const bubble of bubbles) {
    assert.ok(BUBBLE_RIG.bones[bubble.bone], `${bubble.id} runtime bone must exist`);
    const crop = await cropPart(bubble, BUBBLE_OWNER);
    assert.ok(visiblePixelCount(crop) > 0, `${bubble.id} must contain visible pixels`);
    assert.ok(visiblePixelCount(crop) < crop.width * crop.height);
    assert.equal(
      alphaComponents(crop).length,
      1,
      `${bubble.id} cell must contain exactly one substantial bubble component`,
    );
  }

  const ring = parts.find(({ id }) => id === 'ring');
  const body = parts.find(({ id }) => id === 'body');
  const eyes = parts.find(({ id }) => id === 'eyes');
  const mouth = parts.find(({ id }) => id === 'mouth');
  assert.ok(ring && body && eyes && mouth);
  assert.ok(body.z < eyes.z && eyes.z < mouth.z, 'face must render over the body');
  assert.ok(mouth.z < ring.z, 'the sole outer ring must be a foreground layer');
  assert.equal(ring.bone, 'ring');
  assert.deepEqual(parts.filter(({ id }) => /^ring/i.test(id)).map(({ id }) => id), ['ring']);
  assert.ok(BUBBLE_RIG.bones.ring);
  assert.equal('ringBack' in BUBBLE_RIG.bones, false);
  assert.equal('ringFront' in BUBBLE_RIG.bones, false);
});

test('Bubble ring preserves face visibility for normal, attack, and hurt expressions', async () => {
  const parts = MANIFEST.rigs[BUBBLE_OWNER].parts;
  const ringPart = parts.find(({ id }) => id === 'ring');
  const eyesPart = parts.find(({ id }) => id === 'eyes');
  const mouthPart = parts.find(({ id }) => id === 'mouth');
  assert.ok(ringPart && eyesPart && mouthPart);
  assert.ok(ringPart.z > eyesPart.z && ringPart.z > mouthPart.z);

  const cases = [
    { label: 'bind normal', state: 'normal', pose: {} },
    { label: 'bind attack', state: 'attack', pose: {} },
    { label: 'bind hurt', state: 'hurt', pose: {} },
  ];
  for (const [clipName, state] of [['idle', 'normal'], ['attack', 'attack'], ['hurt', 'hurt']]) {
    for (const time of clipSampleTimes(BUBBLE_CLIPS[clipName])) {
      cases.push({
        label: `${clipName}@${time.toFixed(4)}`,
        state,
        pose: poseAt(BUBBLE_CLIPS, clipName, time),
      });
    }
  }

  const ring = resolvedDescriptor(ringPart, 'normal', BUBBLE_RIG);
  for (const sample of cases) {
    const eyes = resolvedDescriptor(eyesPart, sample.state, BUBBLE_RIG);
    const mouth = resolvedDescriptor(mouthPart, sample.state, BUBBLE_RIG);
    assert.equal(
      await logicalAlphaOverlap(
        ring,
        eyes,
        sample.pose,
        BUBBLE_RIG,
        BUBBLE_OWNER,
      ),
      0,
      `${sample.label}: ring must stay outside eye alpha`,
    );
    assert.equal(
      await logicalAlphaOverlap(
        ring,
        mouth,
        sample.pose,
        BUBBLE_RIG,
        BUBBLE_OWNER,
      ),
      0,
      `${sample.label}: ring must stay outside mouth alpha`,
    );
  }
});

test('Bubble keeps one outer ring and all three bubbles visible', async () => {
  assert.deepEqual(BUBBLE_RIG.bones.motion.children, ['deform', 'bubbles']);
  assert.equal(BUBBLE_RIG.bones.deform.parent, 'motion');
  assert.deepEqual(BUBBLE_RIG.bones.deform.children, ['body', 'halo', 'face']);
  assert.equal(BUBBLE_RIG.bones.body.parent, 'deform');
  assert.equal(BUBBLE_RIG.bones.face.parent, 'deform');
  assert.equal(BUBBLE_RIG.bones.halo.parent, 'deform');
  assert.deepEqual(BUBBLE_RIG.bones.halo.children, ['ring']);
  assert.deepEqual(BUBBLE_RIG.bones.bubbles.children, BUBBLE_IDS);
  for (const id of BUBBLE_IDS) assert.equal(BUBBLE_RIG.bones[id].parent, 'bubbles');

  const parts = MANIFEST.rigs[BUBBLE_OWNER].parts;
  const descriptors = new Map(parts.map((part) => [
    part.id,
    resolvedDescriptor(part, 'normal', BUBBLE_RIG),
  ]));
  const minimumVisible = new Map(BUBBLE_IDS.map((id) => [id, 1]));

  for (const [clipName, clip] of Object.entries(BUBBLE_CLIPS)) {
    const deformScale = [
      ...transformValues(clip.tracks.deform, 'scaleX'),
      ...transformValues(clip.tracks.deform, 'scaleY'),
    ];
    assert.ok(deformScale.every((value) => value >= 0.94 && value <= 1.06));
    for (const id of BUBBLE_IDS) {
      const track = clip.tracks[id];
      assert.ok(transformValues(track, 'x').every((value) => Math.abs(value) <= 0.5));
      assert.ok(transformValues(track, 'y').every((value) => Math.abs(value) <= 0.5));
      assert.ok(transformValues(track, 'rotation').every((value) => Math.abs(value) <= 0.015));
    }

    for (const time of clipSampleTimes(clip)) {
      const pose = poseAt(BUBBLE_CLIPS, clipName, time);
      for (const id of BUBBLE_IDS) {
        const part = parts.find((candidate) => candidate.id === id);
        const higher = parts
          .filter((candidate) => candidate.z > part.z)
          .map((candidate) => descriptors.get(candidate.id));
        const fraction = await logicalVisibleFraction(
          descriptors.get(id),
          higher,
          pose,
          BUBBLE_RIG,
          BUBBLE_OWNER,
        );
        minimumVisible.set(id, Math.min(minimumVisible.get(id), fraction));
      }
    }
  }

  for (const [id, fraction] of minimumVisible) {
    assert.ok(
      fraction >= 0.72,
      `${id} must remain independently readable; minimum visible alpha was ${fraction.toFixed(3)}`,
    );
  }
});
