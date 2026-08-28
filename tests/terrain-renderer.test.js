import test from 'node:test';
import assert from 'node:assert/strict';

import {
  drawTerrainAsset,
  drawOrganicGround,
  drawOrganicTerrainProps,
  isWastelandCell,
  LANDMARK_ASSET_KEYS,
  POI_ASSET_KEYS,
  REGION_ASSET_KEYS,
  landmarkAssetKeyForZone,
  regionAssetKeyForZone,
  TERRAIN_ASSET_KEYS,
  WASTELAND_TERRAIN_ASSET_KEYS,
  terrainAssetKey,
  terrainAssetKeyForCell,
  terrainRenderLayer,
  worldPoiAssetKeys,
} from '../src/terrain-renderer.js';

function createContextSpy() {
  const calls = [];
  const context = {
    calls,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
  };
  for (const method of [
    'beginPath', 'bezierCurveTo', 'closePath', 'fill', 'fillRect', 'lineTo', 'moveTo',
    'clip', 'drawImage', 'quadraticCurveTo', 'restore', 'rotate', 'save', 'scale',
    'stroke', 'strokeRect', 'translate',
  ]) {
    context[method] = (...args) => calls.push({ method, args });
  }
  return context;
}

function readyAssetStore(keys) {
  const requested = [];
  const assets = new Map([...keys].map((key) => [key, {
    key,
    width: 256,
    height: 256,
  }]));
  return {
    requested,
    useOrFallback(key, drawAsset, drawFallback) {
      requested.push(key);
      const asset = assets.get(key);
      if (!asset) {
        drawFallback();
        return false;
      }
      drawAsset(asset);
      return true;
    },
  };
}

function optionsFor(tiles, pixelsPerCell = 48) {
  return {
    tiles,
    visibleBounds: { minX: 0, minY: 0, maxX: tiles[0].length - 1, maxY: tiles.length - 1 },
    pixelsPerCell,
    worldToScreen: ({ x, y }) => ({ x: 18 + x * pixelsPerCell, y: 26 + y * pixelsPerCell }),
    time: 2.4,
  };
}

test('continuous ground never emits square grid outlines', () => {
  const ctx = createContextSpy();
  const result = drawOrganicGround(ctx, optionsFor([
    ['ground', 'ground', 'ground'],
    ['ground', 'ground', 'ground'],
  ]));

  assert.equal(result.cells, 6);
  assert.equal(ctx.calls.filter((call) => call.method === 'strokeRect').length, 0);
  assert.equal(ctx.calls.filter((call) => call.method === 'fillRect').length, 1,
    'the grass is painted as one continuous field rather than tile rectangles');
});

test('resource, obstacle, destructible and permanent terrain each use their own prop renderer', () => {
  const ctx = createContextSpy();
  const tiles = [[
    { kind: 'resource', resourceType: 'crystal' },
    { kind: 'obstacle', variant: 'thorn-bush' },
    { kind: 'destructible', variant: 'breakable-rock' },
    { kind: 'indestructible', variant: 'giant-rock' },
  ]];
  const result = drawOrganicTerrainProps(ctx, optionsFor(tiles));

  assert.deepEqual(
    {
      resource: result.resource,
      obstacle: result.obstacle,
      destructible: result.destructible,
      indestructible: result.indestructible,
    },
    { resource: 1, obstacle: 1, destructible: 1, indestructible: 1 },
  );
  assert.ok(ctx.calls.filter((call) => call.method === 'fill').length >= 12,
    'multi-layer, rounded props should be painted instead of placeholder squares');
  assert.equal(ctx.calls.filter((call) => call.method === 'strokeRect').length, 0);
});

test('joined water cells omit their shared boundary', () => {
  const isolatedContext = createContextSpy();
  const isolated = drawOrganicTerrainProps(isolatedContext, optionsFor([[
    { kind: 'indestructible', variant: 'water' },
    'ground',
    { kind: 'indestructible', variant: 'water' },
  ]]));

  const joinedContext = createContextSpy();
  const joined = drawOrganicTerrainProps(joinedContext, optionsFor([[
    { kind: 'indestructible', variant: 'water' },
    { kind: 'indestructible', variant: 'water' },
  ]]));

  assert.equal(isolated.water, 2);
  assert.equal(joined.water, 2);
  assert.equal(isolated.boundarySegments, 8);
  assert.equal(joined.boundarySegments, 6);
  assert.ok(joined.boundarySegments < isolated.boundarySegments);
});

test('the complete layer accepts terrainAt and runs at min and max camera zoom', () => {
  const terrainAt = (x, y) => {
    if (x === 1 && y === 0) return { kind: 'indestructible', variant: 'cliff' };
    if (x === 0 && y === 1) return { kind: 'resource', resourceType: 'gel' };
    if (x === 1 && y === 1) return { kind: 'destructible', variant: 'fallen-log' };
    return { kind: 'ground' };
  };

  for (const zoom of [0.6, 1.6]) {
    const ctx = createContextSpy();
    const pixelsPerCell = 64 * zoom;
    const result = terrainRenderLayer(ctx, {
      terrainAt,
      visibleBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      pixelsPerCell,
      worldToScreen: ({ x, y }) => ({ x: x * pixelsPerCell, y: y * pixelsPerCell }),
      time: 1234,
    });
    assert.equal(result.ground.cells, 4);
    assert.equal(result.props.cliff, 1);
    assert.equal(result.props.resource, 1);
    assert.equal(result.props.destructible, 1);
    assert.ok(ctx.calls.length > 40);
  }
});

test('terrain PNG contract uses authored ids and the shared helper keeps a bottom anchor', () => {
  assert.deepEqual(TERRAIN_ASSET_KEYS, {
    ground: 'terrain-ground-detail-a',
    'soft-gel': 'terrain-soft-gel-node-a',
    'dew-honey': 'terrain-dew-honey-node-a',
    'crystal-shard': 'terrain-crystal-shard-node-a',
    'thorn-thicket': 'terrain-thorn-thicket-a',
    'brittle-boulder': 'terrain-brittle-boulder-a',
    'deep-water': 'terrain-deep-water-patch-a',
  });
  assert.equal(terrainAssetKey({ terrainId: 'crystal-shard' }), 'terrain-crystal-shard-node-a');
  assert.equal(terrainAssetKey({ variant: 'honey-flower' }), 'terrain-dew-honey-node-a');
  assert.equal(terrainAssetKey('giant-rock'), null);

  const ctx = createContextSpy();
  const store = readyAssetStore(['terrain-soft-gel-node-a']);
  const drawn = drawTerrainAsset(ctx, store, { terrainId: 'soft-gel', visualVariant: 1 }, {
    x: 120,
    y: 180,
    cellSize: 80,
  });

  assert.equal(drawn, true);
  assert.deepEqual(store.requested, ['terrain-soft-gel-node-a']);
  assert.ok(ctx.calls.some(({ method, args }) => method === 'translate'
    && args[0] === 120 && args[1] === 180));
  assert.ok(ctx.calls.some(({ method, args }) => method === 'scale'
    && args[0] === -1 && args[1] === 1), 'visual variant mirrors without changing its anchor');
  const imageCall = ctx.calls.find(({ method }) => method === 'drawImage');
  assert.ok(imageCall.args[2] < 0, 'the image top is above the supplied bottom anchor');
  assert.equal(imageCall.args[2] + imageCall.args[4], 0,
    'the untransformed image bottom lands exactly on the anchor');
});

test('bright infinite-world biome and POI contracts resolve every generated layer', () => {
  assert.deepEqual(REGION_ASSET_KEYS, {
    'gel-garden': 'region-gel-meadow-field-a',
    'dew-grove': 'region-dew-grove-field-a',
    'crystal-meadow': 'region-crystal-bloom-field-a',
    'bubble-wetland': 'region-bubble-heath-field-a',
    'soft-shell-canyon': 'region-shell-canyon-field-a',
  });
  assert.deepEqual(LANDMARK_ASSET_KEYS, {
    'gel-garden': 'landmark-soft-relay-a',
    'dew-grove': 'landmark-dew-canopy-a',
    'crystal-meadow': 'landmark-giant-crystal-bloom-a',
    'bubble-wetland': 'landmark-bubble-arch-a',
    'soft-shell-canyon': 'landmark-boss-shell-grotto-a',
  });
  assert.deepEqual(POI_ASSET_KEYS, {
    nest: ['nest-soft-rift-energy-a', 'nest-soft-rift-frame-a'],
    relay: ['landmark-soft-relay-a'],
    boss: ['landmark-boss-shell-grotto-a'],
  });

  assert.equal(regionAssetKeyForZone('gel-garden'), 'region-gel-meadow-field-a');
  assert.equal(regionAssetKeyForZone({ kind: 'crystal-meadow' }),
    'region-crystal-bloom-field-a');
  assert.equal(regionAssetKeyForZone({ biomeId: 'bubble-wetland' }),
    'region-bubble-heath-field-a');
  assert.equal(regionAssetKeyForZone('unknown'), null);
  assert.equal(landmarkAssetKeyForZone({ zone: { kind: 'dew-grove' } }),
    'landmark-dew-canopy-a');
  assert.deepEqual(worldPoiAssetKeys('nest'),
    ['nest-soft-rift-energy-a', 'nest-soft-rift-frame-a'],
    'the moving energy layer is composited behind the static nest frame');
  assert.deepEqual(worldPoiAssetKeys({ kind: 'landmark' }, { kind: 'soft-shell-canyon' }),
    ['landmark-boss-shell-grotto-a']);
  assert.deepEqual(worldPoiAssetKeys({ kind: 'boss' }), ['landmark-boss-shell-grotto-a']);
  assert.deepEqual(worldPoiAssetKeys({ kind: 'unknown' }), []);
});

test('the retired wasteland key map remains import-compatible but is never selected', () => {
  const world = { width: 24, height: 16 };
  assert.deepEqual(WASTELAND_TERRAIN_ASSET_KEYS, {
    ground: 'terrain-waste-ground-detail-a',
    'soft-gel': 'terrain-waste-soft-gel-cache-a',
    'dew-honey': 'terrain-waste-dew-pod-a',
    'crystal-shard': 'terrain-waste-crystal-scrap-a',
    'thorn-thicket': 'terrain-waste-cable-thicket-a',
    'brittle-boulder': 'terrain-waste-rusted-wreck-a',
    'deep-water': 'terrain-waste-acid-sludge-a',
  });

  const coordinates = [
    { x: 12, y: 8 },
    { x: 23, y: 8 },
    { x: -1_000_000, y: 900_000 },
    { x: 2_000_000, y: -3_000_000 },
  ];
  for (const { x, y } of coordinates) {
    assert.equal(isWastelandCell(x, y, { width: 24, height: 16 }), false);
    for (const terrainId of Object.keys(TERRAIN_ASSET_KEYS)) {
      const key = terrainAssetKeyForCell(terrainId, { x, y, world: { infinite: true } });
      assert.equal(key, TERRAIN_ASSET_KEYS[terrainId]);
      assert.equal(key.startsWith('terrain-waste-'), false);
    }
  }
  assert.equal(terrainAssetKeyForCell({ variant: 'honey-flower', x: 23, y: 8 }, { world }),
    'terrain-dew-honey-node-a');
  assert.equal(terrainAssetKeyForCell('giant-rock', { x: 23, y: 8, world }), null);
});

test('ground detail and all authored props request only bright terrain PNGs', () => {
  const world = { width: 24, height: 16 };
  const groundTiles = Array.from({ length: world.height }, () => Array(world.width).fill('ground'));
  const groundContext = createContextSpy();
  const groundStore = readyAssetStore([TERRAIN_ASSET_KEYS.ground]);
  const ground = drawOrganicGround(groundContext, {
    ...optionsFor(groundTiles),
    world,
    assetStore: groundStore,
  });
  assert.equal(ground.wastelandCells, 0);
  assert.ok(groundStore.requested.includes(TERRAIN_ASSET_KEYS.ground));
  assert.equal(groundStore.requested.some((key) => key.startsWith('terrain-waste-')), false);

  const tiles = Array.from({ length: world.height }, () => Array(world.width).fill('ground'));
  tiles[0][23] = { kind: 'resource', terrainId: 'soft-gel' };
  tiles[1][23] = { kind: 'resource', terrainId: 'dew-honey' };
  tiles[2][23] = { kind: 'resource', terrainId: 'crystal-shard' };
  tiles[3][23] = { kind: 'obstacle', terrainId: 'thorn-thicket' };
  tiles[4][23] = { kind: 'destructible', terrainId: 'brittle-boulder' };
  tiles[5][23] = { kind: 'indestructible', terrainId: 'deep-water' };
  const propKeys = Object.values(TERRAIN_ASSET_KEYS)
    .filter((key) => key !== TERRAIN_ASSET_KEYS.ground);
  const propContext = createContextSpy();
  const propStore = readyAssetStore(propKeys);
  const props = drawOrganicTerrainProps(propContext, {
    ...optionsFor(tiles),
    world,
    assetStore: propStore,
  });

  assert.deepEqual(new Set(propStore.requested), new Set(propKeys));
  assert.equal(props.assetDraws, propKeys.length);
  assert.equal(props.wastelandAssetDraws, 0);
  assert.equal(propStore.requested.some((key) => key.startsWith('terrain-waste-')), false);
  assert.equal(propContext.calls.filter(({ method }) => method === 'drawImage').length, propKeys.length);
});

test('an unavailable bright terrain PNG safely executes the Canvas fallback', () => {
  const ctx = createContextSpy();
  const store = readyAssetStore([]);
  let fallbackCalls = 0;
  const drawn = drawTerrainAsset(ctx, store, {
    terrainId: 'brittle-boulder',
    x: 23,
    y: 8,
  }, {
    x: 100,
    y: 140,
    cellSize: 64,
    world: { width: 24, height: 16 },
    fallback: () => {
      fallbackCalls += 1;
      ctx.beginPath();
      ctx.fill();
    },
  });

  assert.equal(drawn, false);
  assert.deepEqual(store.requested, ['terrain-brittle-boulder-a']);
  assert.equal(fallbackCalls, 1);
  assert.ok(ctx.calls.some(({ method }) => method === 'fill'));
});

test('authored prop PNGs are preferred while an unavailable key keeps the vector fallback', () => {
  const ctx = createContextSpy();
  const store = readyAssetStore([
    'terrain-soft-gel-node-a',
    'terrain-dew-honey-node-a',
    'terrain-crystal-shard-node-a',
    'terrain-thorn-thicket-a',
    // brittle-boulder is deliberately unavailable.
  ]);
  const result = drawOrganicTerrainProps(ctx, {
    ...optionsFor([[
      { kind: 'resource', terrainId: 'soft-gel', visualVariant: 0 },
      { kind: 'resource', terrainId: 'dew-honey', visualVariant: 1 },
      { kind: 'resource', terrainId: 'crystal-shard', visualVariant: 2 },
      { kind: 'obstacle', terrainId: 'thorn-thicket', visualVariant: 3 },
      { kind: 'destructible', terrainId: 'brittle-boulder', visualVariant: 0 },
    ]]),
    assetStore: store,
  });

  assert.deepEqual(store.requested, [
    'terrain-soft-gel-node-a',
    'terrain-dew-honey-node-a',
    'terrain-crystal-shard-node-a',
    'terrain-thorn-thicket-a',
    'terrain-brittle-boulder-a',
  ]);
  assert.equal(result.assetDraws, 4);
  assert.equal(ctx.calls.filter(({ method }) => method === 'drawImage').length, 4);
  assert.ok(ctx.calls.filter(({ method }) => method === 'fill').length >= 3,
    'the missing boulder PNG is still rendered by its multi-layer Canvas fallback');
});

test('joined deep water uses one clipped PNG texture per component, never one pond sprite per cell', () => {
  const ctx = createContextSpy();
  const store = readyAssetStore(['terrain-deep-water-patch-a']);
  const result = drawOrganicTerrainProps(ctx, {
    ...optionsFor([[
      { kind: 'indestructible', terrainId: 'deep-water', visualVariant: 2 },
      { kind: 'indestructible', terrainId: 'deep-water', visualVariant: 1 },
      'ground',
      { kind: 'indestructible', terrainId: 'deep-water', visualVariant: 3 },
    ]]),
    assetStore: store,
  });

  assert.equal(result.water, 3);
  assert.equal(result.waterTextureComponents, 2);
  assert.deepEqual(store.requested, ['terrain-deep-water-patch-a', 'terrain-deep-water-patch-a']);
  assert.equal(ctx.calls.filter(({ method }) => method === 'drawImage').length, 2);
  assert.equal(ctx.calls.filter(({ method }) => method === 'clip').length, 2);
  assert.equal(result.boundarySegments, 10,
    'the two joined cells omit their shared edge while the isolated pool keeps four edges');
});

test('ground-detail PNG scatter is sparse and deterministic at the same world coordinates', () => {
  const tiles = Array.from({ length: 10 }, () => Array(12).fill('ground'));
  const firstContext = createContextSpy();
  const firstStore = readyAssetStore(['terrain-ground-detail-a']);
  const first = drawOrganicGround(firstContext, {
    ...optionsFor(tiles),
    assetStore: firstStore,
  });
  const secondContext = createContextSpy();
  const secondStore = readyAssetStore(['terrain-ground-detail-a']);
  const second = drawOrganicGround(secondContext, {
    ...optionsFor(tiles),
    assetStore: secondStore,
  });

  assert.ok(first.assetDetails > 0);
  assert.ok(first.assetDetails < first.cells / 3, 'details stay sparse enough to hide the grid');
  assert.equal(first.assetDetails, first.details);
  assert.equal(second.assetDetails, first.assetDetails);
  assert.deepEqual(
    firstContext.calls.filter(({ method }) => method === 'translate').map(({ args }) => args),
    secondContext.calls.filter(({ method }) => method === 'translate').map(({ args }) => args),
    'the same cells, jitter, mirror and scale are selected on every draw',
  );
});
