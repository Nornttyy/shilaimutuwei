import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  RIG_PART_MANIFEST_URL,
  createRigAssetStore,
  createRigAssetStoreFromUrl,
  loadRigPartManifest,
  validateRigPartManifest,
} from '../src/animation/rig-assets.js';

const MANIFEST_SOURCE = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));

const EXPECTED_PART_ORDER = Object.freeze({
  'survivor-shell-shell': ['shell', 'body', 'eyes', 'mouth', 'front'],
  'survivor-crystal-pin': ['needles', 'body', 'eyes', 'mouth', 'front'],
  'survivor-bubble-float': [
    'bubblesBack',
    'ringBack',
    'body',
    'eyes',
    'mouth',
    'ringFront',
  ],
  'survivor-moss-sprout': ['body', 'eyes', 'mouth', 'sprout', 'pack'],
  'enemy-soft-biter': ['legsA', 'legsB', 'antennae', 'body', 'eyes', 'mouth'],
  'enemy-windcap': ['stem', 'cap', 'eyes', 'mouth'],
  'enemy-stone-lump': ['body', 'rocks', 'eyes', 'mouth'],
  'enemy-acid-shell-king': ['tentacles', 'body', 'crown', 'core', 'eyes', 'mouth'],
});

const EXPECTED_GENERATED_BIND_RECTS = Object.freeze({
  'survivor-shell-shell.front': { x: 10, y: -34, width: 38, height: 19 },
  'survivor-crystal-pin.front': { x: 24, y: -33, width: 31, height: 20 },
  'enemy-soft-biter.antennae': { x: -46, y: -104, width: 92, height: 54 },
  'enemy-acid-shell-king.crown': { x: -46, y: -119, width: 80, height: 71 },
});

function sourceRectsOverlap(a, b) {
  return (
    Math.max(a.x, b.x) < Math.min(a.x + a.width, b.x + b.width)
    && Math.max(a.y, b.y) < Math.min(a.y + a.height, b.y + b.height)
  );
}

function cloneManifest(source = MANIFEST_SOURCE) {
  return JSON.parse(JSON.stringify(source));
}

function selectRigs(...ownerIds) {
  const source = cloneManifest();
  source.rigs = Object.fromEntries(ownerIds.map((id) => [id, source.rigs[id]]));
  return source;
}

function fakeImage({ fails = false } = {}) {
  let assignedSrc = '';
  return {
    onload: null,
    onerror: null,
    get src() {
      return assignedSrc;
    },
    set src(value) {
      assignedSrc = value;
      queueMicrotask(() => {
        if (fails) this.onerror?.(new Error(`missing ${value}`));
        else this.onload?.();
      });
    },
  };
}

test('rig-parts contract covers all eight characters in canonical draw order', () => {
  const manifest = validateRigPartManifest(MANIFEST_SOURCE);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.coordinateSpace.origin, 'ground-center');
  assert.equal(manifest.coordinateSpace.canonicalSize, 100);
  assert.equal(manifest.assetPolicy.readiness, 'atomic');
  assert.equal(manifest.assetPolicy.rootBoneHasImage, false);
  assert.equal(manifest.assetPolicy.faceBoneHasImage, false);
  assert.equal(manifest.assetPolicy.bodyIncludesFacialPixels, false);
  assert.deepEqual(Object.keys(manifest.rigs), Object.keys(EXPECTED_PART_ORDER));

  let partCount = 0;
  const atlasPaths = new Set();
  for (const [ownerId, expectedParts] of Object.entries(EXPECTED_PART_ORDER)) {
    const rig = manifest.rigs[ownerId];
    assert.equal(rig.ownerId, ownerId);
    assert.equal(rig.rootBone, 'root');
    assert.equal(rig.faceBone, 'face');
    assert.equal(rig.canonicalFacing, 1);
    assert.equal(rig.atlasPath, `assets/generated-v2/rig/${ownerId}/atlas.png`);
    assert.deepEqual(rig.parts.map(({ id }) => id), expectedParts);
    assert.equal(rig.parts.some(({ bone }) => bone === 'root'), false);
    assert.equal(rig.parts.some(({ bone }) => bone === 'face'), false);

    const eyes = rig.parts.find(({ id }) => id === 'eyes');
    const mouth = rig.parts.find(({ id }) => id === 'mouth');
    assert.deepEqual(
      [eyes?.bone, eyes?.required, mouth?.bone, mouth?.required],
      ['eyes', true, 'mouth', true],
    );

    let previousZ = -Infinity;
    const occupiedSourceRects = new Set();
    const previousSourceRects = [];
    for (const part of rig.parts) {
      partCount += 1;
      assert.equal(part.required, true);
      assert.ok(part.z >= previousZ, `${ownerId}.${part.id} has an invalid draw order`);
      previousZ = part.z;
      assert.equal(
        part.path,
        `assets/generated-v2/rig/${ownerId}/atlas.png`,
      );
      for (const key of ['x', 'y', 'width', 'height']) {
        assert.equal(Number.isFinite(part.bindRect[key]), true);
        assert.equal(Number.isInteger(part.sourceRect[key]), true);
      }
      assert.ok(part.bindRect.width > 0);
      assert.ok(part.bindRect.height > 0);
      assert.ok(part.sourceRect.x >= 0);
      assert.ok(part.sourceRect.y >= 0);
      assert.ok(part.sourceRect.width > 0);
      assert.ok(part.sourceRect.height > 0);
      assert.ok(part.sourceRect.x + part.sourceRect.width <= 768);
      assert.ok(part.sourceRect.y + part.sourceRect.height <= 512);

      const sourceAspect = part.sourceRect.width / part.sourceRect.height;
      const bindAspect = part.bindRect.width / part.bindRect.height;
      assert.ok(
        Math.abs(sourceAspect / bindAspect - 1) < 0.02,
        `${ownerId}.${part.id} sourceRect must match its bindRect aspect ratio`,
      );

      for (const previous of previousSourceRects) {
        assert.equal(
          sourceRectsOverlap(part.sourceRect, previous.sourceRect),
          false,
          `${ownerId}.${part.id} sourceRect overlaps ${previous.id}`,
        );
      }
      previousSourceRects.push(part);

      const sourceRectKey = [
        part.sourceRect.x,
        part.sourceRect.y,
        part.sourceRect.width,
        part.sourceRect.height,
      ].join(':');
      assert.equal(
        occupiedSourceRects.has(sourceRectKey),
        false,
        `${ownerId}.${part.id} reuses atlas sourceRect ${sourceRectKey}`,
      );
      occupiedSourceRects.add(sourceRectKey);
    }
    assert.equal(atlasPaths.has(rig.atlasPath), false, `shared rig atlas: ${rig.atlasPath}`);
    atlasPaths.add(rig.atlasPath);
  }
  assert.equal(partCount, 41);
  assert.equal(atlasPaths.size, 8);
  for (const [partKey, expectedBindRect] of Object.entries(EXPECTED_GENERATED_BIND_RECTS)) {
    const [ownerId, partId] = partKey.split('.');
    const part = manifest.rigs[ownerId].parts.find(({ id }) => id === partId);
    assert.deepEqual(part?.bindRect, expectedBindRect);
  }
  const bubble = manifest.rigs['survivor-bubble-float'];
  assert.deepEqual(
    bubble.parts.find(({ id }) => id === 'ringBack')?.bindRect,
    { x: -58, y: -52, width: 116, height: 50 },
  );
  assert.deepEqual(
    bubble.parts.find(({ id }) => id === 'ringFront')?.bindRect,
    { x: -58, y: -52, width: 116, height: 50 },
  );
  assert.equal(Object.isFrozen(manifest.rigs['survivor-shell-shell'].parts[0].bindRect), true);
  assert.equal(Object.isFrozen(manifest.rigs['survivor-shell-shell'].parts[0].sourceRect), true);
});

test('face stays transform-only and unsafe contracts are rejected', async (t) => {
  await t.test('rejects an image on the root parent', () => {
    const source = cloneManifest();
    source.rigs['survivor-shell-shell'].parts[0].bone = 'root';
    assert.throws(() => validateRigPartManifest(source), /non-visual parent bone/i);
  });

  await t.test('rejects an image on the face parent', () => {
    const source = cloneManifest();
    source.rigs['survivor-shell-shell'].parts[2].bone = 'face';
    assert.throws(() => validateRigPartManifest(source), /non-visual parent bone/i);
  });

  await t.test('requires separate eyes and mouth layers', () => {
    const source = cloneManifest();
    source.rigs['survivor-shell-shell'].parts = source.rigs[
      'survivor-shell-shell'
    ].parts.filter(({ id }) => id !== 'mouth');
    assert.throws(() => validateRigPartManifest(source), /required mouth pixels/i);
  });

  await t.test('rejects pre-mirrored canonical art and unsafe paths', () => {
    const facing = cloneManifest();
    facing.rigs['enemy-soft-biter'].canonicalFacing = -1;
    assert.throws(() => validateRigPartManifest(facing), /canonicalFacing must be \+1/);

    const path = cloneManifest();
    path.rigs['survivor-shell-shell'].parts[0].path = '../shell.png';
    assert.throws(() => validateRigPartManifest(path), /safe project-relative/i);

    const nonAtlas = cloneManifest();
    for (const part of nonAtlas.rigs['survivor-shell-shell'].parts) {
      part.path = 'assets/generated-v2/rig/survivor-shell-shell/sheet.png';
    }
    assert.throws(() => validateRigPartManifest(nonAtlas), /atlas path must be .*\/atlas\.png/i);
  });

  await t.test('rejects visual layers that disagree with z draw order', () => {
    const source = cloneManifest();
    source.rigs['survivor-shell-shell'].parts[2].z = -99;
    assert.throws(() => validateRigPartManifest(source), /ascending draw order/i);
  });

  await t.test('requires one atlas per rig and forbids sharing it across rigs', () => {
    const split = cloneManifest();
    split.rigs['survivor-shell-shell'].parts[0].path =
      'assets/generated-v2/rig/survivor-shell-shell/other-atlas.png';
    assert.throws(() => validateRigPartManifest(split), /share exactly one atlas path/i);

    const shared = cloneManifest();
    const shellAtlas = shared.rigs['survivor-shell-shell'].parts[0].path;
    for (const part of shared.rigs['survivor-crystal-pin'].parts) part.path = shellAtlas;
    assert.throws(() => validateRigPartManifest(shared), /cannot be shared across rigs/i);
  });

  await t.test('requires finite integer atlas crops with positive dimensions', () => {
    const fractional = cloneManifest();
    fractional.rigs['survivor-shell-shell'].parts[0].sourceRect.x = 0.5;
    assert.throws(() => validateRigPartManifest(fractional), /sourceRect\.x must be an integer/i);

    const nonFinite = cloneManifest();
    nonFinite.rigs['survivor-shell-shell'].parts[0].sourceRect.y = Number.NaN;
    assert.throws(() => validateRigPartManifest(nonFinite), /sourceRect\.y must be a finite number/i);

    const negative = cloneManifest();
    negative.rigs['survivor-shell-shell'].parts[0].sourceRect.x = -1;
    assert.throws(() => validateRigPartManifest(negative), /x and y must be non-negative/i);

    const empty = cloneManifest();
    empty.rigs['survivor-shell-shell'].parts[0].sourceRect.width = 0;
    assert.throws(() => validateRigPartManifest(empty), /width and height must be positive/i);
  });
});

test('manifest fetch validates metadata without constructing images', async () => {
  let requestedUrl = null;
  let imageFactoryCalls = 0;
  const fetchImpl = async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => cloneManifest() };
  };

  const manifest = await loadRigPartManifest({ fetchImpl });
  assert.equal(requestedUrl, RIG_PART_MANIFEST_URL);
  assert.equal(Object.keys(manifest.rigs).length, 8);
  assert.equal(imageFactoryCalls, 0);

  const store = await createRigAssetStoreFromUrl({
    fetchImpl,
    imageFactory: () => {
      imageFactoryCalls += 1;
      return fakeImage();
    },
  });
  assert.equal(store.status('survivor-shell-shell').status, 'idle');
  assert.equal(imageFactoryCalls, 0, 'creating a store must not touch image files');
});

test('a complete rig becomes ready once and exposes a renderer-ready bundle', async () => {
  let atlasImage = null;
  let factoryCalls = 0;
  const store = createRigAssetStore(selectRigs('survivor-shell-shell'), {
    resolvePath: (path) => path,
    imageFactory: (part, url) => {
      factoryCalls += 1;
      const image = fakeImage();
      atlasImage = image;
      assert.equal(part.id, 'shell', 'the first atlas layer is the decode representative');
      assert.equal(url, part.path);
      return image;
    },
  });

  const vectorFallback = { kind: 'vector' };
  assert.equal(store.get('survivor-shell-shell', vectorFallback), vectorFallback);
  assert.equal(store.status('survivor-shell-shell').status, 'idle');

  const first = store.load('survivor-shell-shell', { timeoutMs: 100 });
  const concurrent = store.load('survivor-shell-shell', { timeoutMs: 100 });
  assert.equal(first, concurrent, 'concurrent requests must share the atomic load');
  assert.equal(store.status('survivor-shell-shell').status, 'loading');

  const result = await first;
  assert.deepEqual(
    { status: result.status, ready: result.ready, total: result.total, loaded: result.loaded },
    { status: 'ready', ready: true, total: 5, loaded: 5 },
  );
  assert.equal(factoryCalls, 1, 'one shared atlas must be decoded only once');

  const bundle = store.get('survivor-shell-shell');
  assert.equal(bundle.id, 'survivor-shell-shell');
  assert.equal(bundle.rigId, 'shell');
  assert.equal(bundle.rootBone, 'root');
  assert.equal(bundle.faceBone, 'face');
  assert.equal(bundle.canonicalFacing, 1);
  assert.equal(bundle.atlasPath, 'assets/generated-v2/rig/survivor-shell-shell/atlas.png');
  assert.deepEqual(bundle.parts.map(({ id }) => id), EXPECTED_PART_ORDER['survivor-shell-shell']);
  for (const part of bundle.parts) {
    assert.equal(part.image, atlasImage);
    assert.equal(part.image.src, part.path);
  }

  let rendered = null;
  assert.equal(store.useOrFallback('survivor-shell-shell', (readyBundle) => {
    rendered = readyBundle;
  }), true);
  assert.equal(rendered, bundle);
});

test('one failed part sends the entire rig to fallback with no partial bundle', async () => {
  const constructed = [];
  const store = createRigAssetStore(selectRigs('survivor-bubble-float'), {
    resolvePath: (path) => path,
    imageFactory: (part) => {
      constructed.push(part.id);
      return fakeImage({ fails: true });
    },
  });

  const result = await store.load('survivor-bubble-float', { timeoutMs: 100 });
  assert.deepEqual(constructed, ['bubblesBack']);
  assert.equal(result.status, 'fallback');
  assert.equal(result.ready, false);
  assert.equal(result.loaded, 0, 'partial images must never be advertised as loaded');
  assert.ok(result.error instanceof AggregateError);
  assert.match(result.error.message, /failed atlases: .*survivor-bubble-float\/atlas\.png/);

  const vectorFallback = { kind: 'vector' };
  assert.equal(store.get('survivor-bubble-float', vectorFallback), vectorFallback);
  let renderCalls = 0;
  let fallbackStatus = null;
  assert.equal(store.useOrFallback(
    'survivor-bubble-float',
    () => { renderCalls += 1; },
    (status) => { fallbackStatus = status.status; },
  ), false);
  assert.equal(renderCalls, 0);
  assert.equal(fallbackStatus, 'fallback');
});

test('failed rigs retry only when requested and remain atomic after recovery', async () => {
  let shouldFail = true;
  let calls = 0;
  const store = createRigAssetStore(selectRigs('enemy-windcap'), {
    resolvePath: (path) => path,
    imageFactory: () => {
      calls += 1;
      return fakeImage({ fails: shouldFail });
    },
  });

  await store.load('enemy-windcap', { timeoutMs: 100 });
  assert.equal(store.status('enemy-windcap').status, 'fallback');
  const callsAfterFailure = calls;
  await store.load('enemy-windcap', { timeoutMs: 100 });
  assert.equal(calls, callsAfterFailure);

  shouldFail = false;
  const recovered = await store.load('enemy-windcap', {
    timeoutMs: 100,
    retryFailed: true,
  });
  assert.equal(recovered.status, 'ready');
  assert.equal(recovered.loaded, 4);
  assert.ok(store.get('enemy-windcap'));
});

test('preload reports readiness per whole rig across all eight contracts', async () => {
  const store = createRigAssetStore(cloneManifest(), {
    resolvePath: (path) => path,
    imageFactory: (part, url, definition) => fakeImage({
      fails: definition.ownerId === 'enemy-acid-shell-king',
    }),
  });

  const summary = await store.preload({ timeoutMs: 100 });
  assert.deepEqual(
    {
      total: summary.total,
      ready: summary.ready,
      fallback: summary.fallback,
      unknown: summary.unknown,
    },
    { total: 8, ready: 7, fallback: 1, unknown: 0 },
  );
  assert.equal(store.get('enemy-acid-shell-king'), null);
  assert.equal(store.status('enemy-acid-shell-king').loaded, 0);
  assert.equal(store.get('enemy-stone-lump').parts.length, 4);

  const withUnknown = await store.preload({ ids: ['missing-rig'], timeoutMs: 100 });
  assert.deepEqual(
    { total: withUnknown.total, ready: withUnknown.ready, fallback: withUnknown.fallback, unknown: withUnknown.unknown },
    { total: 1, ready: 0, fallback: 0, unknown: 1 },
  );
});

test('an unsupported image runtime safely selects vector fallback', async () => {
  const store = createRigAssetStore(selectRigs('enemy-stone-lump'), {
    resolvePath: (path) => path,
    imageFactory: () => null,
  });
  const result = await store.load('enemy-stone-lump', { timeoutMs: 100 });
  assert.equal(result.status, 'fallback');
  assert.equal(result.ready, false);
  assert.equal(store.get('enemy-stone-lump'), null);
  assert.match(result.error.errors[0].message, /does not provide an Image factory/i);
});
