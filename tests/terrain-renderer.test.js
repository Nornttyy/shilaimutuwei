import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearDiscoveryFogChunkCache,
  DISCOVERY_FOG_CACHE_CAPACITY,
  DISCOVERY_FOG_CACHE_MAX_PIXELS,
  DISCOVERY_FOG_CACHE_TARGET_PIXELS,
  DISCOVERY_FOG_CHUNK_CELLS,
  drawAuthoredDiscoveryFog,
  drawTerrainAsset,
  drawOrganicGround,
  drawOrganicTerrainProps,
  drawWorldAnchoredTerrainTexture,
  isWastelandCell,
  LANDMARK_ASSET_KEYS,
  POI_ASSET_KEYS,
  REGION_ASSET_KEYS,
  landmarkAssetKeyForZone,
  regionAssetKeyForZone,
  TERRAIN_ASSET_KEYS,
  TERRAIN_ASSET_PROFILES,
  TERRAIN_LAYER_ASSET_KEYS,
  WASTELAND_TERRAIN_ASSET_KEYS,
  WORLD_GROUND_TEXTURE_PERIOD_CELLS,
  terrainAssetKey,
  terrainAssetKeyForCell,
  terrainRenderLayer,
  worldPoiAssetKeys,
} from '../src/terrain-renderer.js';

function createContextSpy() {
  const calls = [];
  const alphaStack = [];
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
    'beginPath', 'bezierCurveTo', 'clearRect', 'closePath', 'fill', 'fillRect', 'lineTo', 'moveTo',
    'clip', 'drawImage', 'quadraticCurveTo', 'rotate', 'scale',
    'stroke', 'strokeRect', 'translate',
  ]) {
    context[method] = (...args) => calls.push({ method, args, globalAlpha: context.globalAlpha });
  }
  context.save = () => {
    calls.push({ method: 'save', args: [], globalAlpha: context.globalAlpha });
    alphaStack.push(context.globalAlpha);
  };
  context.restore = () => {
    calls.push({ method: 'restore', args: [], globalAlpha: context.globalAlpha });
    if (alphaStack.length) context.globalAlpha = alphaStack.pop();
  };
  return context;
}

function createCanvasFactorySpy() {
  const canvases = [];
  const factory = (width, height) => {
    const context = createContextSpy();
    const canvas = {
      key: `discovery-fog-cache-${canvases.length}`,
      width,
      height,
      getContext: (kind) => (kind === '2d' ? context : null),
    };
    canvases.push({ canvas, context });
    return canvas;
  };
  return { factory, canvases };
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
    get(key, fallback = null) {
      return assets.get(key) ?? fallback;
    },
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

function texturePlacements(ctx, assetKey) {
  const placements = [];
  let translate = null;
  let scale = null;
  for (const call of ctx.calls) {
    if (call.method === 'translate') translate = call.args;
    if (call.method === 'scale') scale = call.args;
    if (call.method === 'drawImage' && call.args[0]?.key === assetKey) {
      placements.push({ translate, scale, draw: call.args.slice(1) });
    }
  }
  return placements;
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

test('authored ground is a viewport-stable 12-cell mirror tile across negative coordinates', () => {
  const asset = { key: TERRAIN_LAYER_ASSET_KEYS.ground, width: 1024, height: 1024 };
  const worldToScreen = ({ x, y }) => ({ x: 100 + x * 10, y: 200 + y * 10 });
  const wideContext = createContextSpy();
  const wide = drawWorldAnchoredTerrainTexture(wideContext, asset, {
    visibleBounds: { minX: -13, minY: -13, maxX: 13, maxY: 13 },
    pixelsPerCell: 10,
    worldToScreen,
  });
  const narrowContext = createContextSpy();
  drawWorldAnchoredTerrainTexture(narrowContext, asset, {
    visibleBounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    pixelsPerCell: 10,
    worldToScreen,
  });

  assert.equal(WORLD_GROUND_TEXTURE_PERIOD_CELLS, 12);
  assert.deepEqual(
    { minX: wide.minTileX, maxX: wide.maxTileX, minY: wide.minTileY, maxY: wide.maxTileY },
    { minX: -2, maxX: 1, minY: -2, maxY: 1 },
  );
  const widePlacements = texturePlacements(wideContext, asset.key);
  const narrowPlacements = texturePlacements(narrowContext, asset.key);
  assert.equal(widePlacements.length, 16);
  assert.equal(narrowPlacements.length, 4);
  assert.deepEqual(
    narrowPlacements,
    widePlacements.filter(({ translate }) => (
      [-6, 6].includes((translate[0] - 100) / 10)
      && [-6, 6].includes((translate[1] - 200) / 10)
    )),
    'changing visible bounds keeps the same world macro tiles at the same phase',
  );
  assert.deepEqual(
    narrowPlacements.map(({ scale }) => scale),
    [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    'negative and positive neighbors alternate horizontal and vertical mirroring',
  );
  assert.ok(narrowPlacements.every(({ draw }) => draw[2] === 121 && draw[3] === 121),
    'each 12-cell tile receives a one-pixel overlap against sampling cracks');
});

test('ready authored ground has no viewport-relative fill or square base', () => {
  const ctx = createContextSpy();
  const store = readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.ground]);
  const result = drawOrganicGround(ctx, {
    ...optionsFor([
      ['ground', 'ground', 'ground'],
      ['ground', 'ground', 'ground'],
    ]),
    assetStore: store,
  });

  assert.equal(result.authoredGround, true);
  assert.ok(result.groundTextureTiles > 0);
  assert.equal(store.requested[0], TERRAIN_LAYER_ASSET_KEYS.ground);
  assert.equal(ctx.calls.filter(({ method }) => method === 'fillRect').length, 0);
});

test('authored discovery fog caches fixed-ratio sprites without stretching a continuous row', () => {
  clearDiscoveryFogChunkCache();
  const unknown = new Set(['-1,0', '0,0', '1,1']);
  const cacheSurfaces = createCanvasFactorySpy();
  const readyStore = readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.fog]);
  const render = (store, canvasFactory = cacheSurfaces.factory) => {
    const ctx = createContextSpy();
    const result = drawAuthoredDiscoveryFog(ctx, {
      visibleBounds: { minX: -1, minY: 0, maxX: 1, maxY: 1 },
      pixelsPerCell: 50,
      worldToScreen: ({ x, y }) => ({ x: 12 + x * 50, y: 18 + y * 50 }),
      assetStore: store,
      isUndiscovered: (x, y) => unknown.has(`${x},${y}`),
      canvasFactory,
    });
    return { ctx, store, result };
  };
  const first = render(readyStore);
  const second = render(readyStore);

  assert.deepEqual(first.result, {
    cells: 3,
    assetCells: 2,
    fallbackCells: 0,
    usedAsset: true,
    cachedChunks: 2,
    directAssetCells: 0,
    cacheHits: 0,
    cacheMisses: 2,
  });
  assert.deepEqual(second.result, {
    ...first.result,
    cacheHits: 2,
    cacheMisses: 0,
  });
  assert.deepEqual(first.store.requested, [
    TERRAIN_LAYER_ASSET_KEYS.fog,
    TERRAIN_LAYER_ASSET_KEYS.fog,
  ]);
  assert.equal(first.ctx.calls.filter(({ method }) => method === 'fillRect').length, 0);
  const imageCalls = first.ctx.calls.filter(({ method }) => method === 'drawImage');
  assert.equal(imageCalls.length, 2);
  assert.equal(cacheSurfaces.canvases.length, 2,
    'two signed world chunks are built once and reused on the stable frame');
  const internalFogDraws = cacheSurfaces.canvases.flatMap(({ context }) => (
    context.calls.filter(({ method, args }) => (
      method === 'drawImage' && args[0]?.key === TERRAIN_LAYER_ASSET_KEYS.fog
    ))
  ));
  assert.equal(internalFogDraws.length, 3);
  assert.ok(internalFogDraws.every(({ args }) => (
    args[3] === 50 * 1.6
    && args[4] === 50 * 1.2
  )), 'every cache-internal authored sprite keeps its 1.6 x 1.2-cell destination');
  assert.equal(first.ctx.calls.some(({ method, args }) => (
    method === 'drawImage' && args[0]?.key === TERRAIN_LAYER_ASSET_KEYS.fog
  )), false, 'the main canvas composites chunk caches rather than a stretched fog source');
  assert.deepEqual(
    imageCalls.map(({ args }) => args.slice(1)),
    second.ctx.calls.filter(({ method }) => method === 'drawImage').map(({ args }) => args.slice(1)),
    'the same world chunks keep stable screen placement',
  );

  const fallback = render(readyAssetStore([]));
  assert.deepEqual(fallback.result, {
    cells: 3,
    assetCells: 0,
    fallbackCells: 3,
    usedAsset: false,
    cachedChunks: 0,
    directAssetCells: 0,
    cacheHits: 0,
    cacheMisses: 0,
  });
  assert.equal(fallback.ctx.calls.filter(({ method }) => method === 'drawImage').length, 0);
  assert.equal(fallback.ctx.calls.filter(({ method }) => method === 'fillRect').length, 3,
    'square safety fog is emitted only when the authored PNG is unavailable');
});

test('cached and direct fog preserve absolute parity mirrors and per-fragment alpha overlap', () => {
  clearDiscoveryFogChunkCache();
  const unknown = new Set(['5,0', '6,0']);
  const cacheSurfaces = createCanvasFactorySpy();
  const store = readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.fog]);
  const baseOptions = {
    visibleBounds: { minX: 5, minY: 0, maxX: 6, maxY: 0 },
    pixelsPerCell: 64,
    pixelRatio: 2,
    fogAlpha: 0.4,
    worldToScreen: ({ x, y }) => ({ x: x * 64, y: y * 64 }),
    assetStore: store,
    isUndiscovered: (x, y) => unknown.has(`${x},${y}`),
  };

  const cachedContext = createContextSpy();
  const cached = drawAuthoredDiscoveryFog(cachedContext, {
    ...baseOptions,
    canvasFactory: cacheSurfaces.factory,
  });
  assert.equal(cached.cacheMisses, 1);
  assert.equal(cacheSurfaces.canvases.length, 1);
  const internalContext = cacheSurfaces.canvases[0].context;
  assert.deepEqual(
    internalContext.calls.filter(({ method }) => method === 'scale').map(({ args }) => args),
    [[-1, 1], [1, 1]],
    'world x=5 is mirrored and x=6 is not, even though the adaptive chunk starts at x=5',
  );
  const internalDraws = internalContext.calls.filter(({ method }) => method === 'drawImage');
  assert.deepEqual(internalDraws.map(({ globalAlpha }) => globalAlpha), [0.4, 0.4],
    'fogAlpha is applied to every authored fragment before overlap compositing');
  const fragmentCenters = internalContext.calls
    .filter(({ method }) => method === 'translate')
    .map(({ args }) => args[0]);
  assert.ok(internalDraws[0].args[3] > fragmentCenters[1] - fragmentCenters[0],
    'the two independently translucent fragments physically overlap');
  const overlapAlpha = 1 - ((1 - internalDraws[0].globalAlpha)
    * (1 - internalDraws[1].globalAlpha));
  assert.ok(Math.abs(overlapAlpha - 0.64) < 1e-9,
    'two 0.4-alpha fragments compound to 0.64 instead of one 0.4-alpha group');
  const cachedComposite = cachedContext.calls.find(({ method }) => method === 'drawImage');
  assert.equal(cachedComposite.globalAlpha, 1,
    'the main canvas does not apply fogAlpha to the already-composited chunk');

  const directContext = createContextSpy();
  const direct = drawAuthoredDiscoveryFog(directContext, {
    ...baseOptions,
    canvasFactory: () => null,
  });
  assert.equal(direct.directAssetCells, 2);
  assert.deepEqual(
    directContext.calls.filter(({ method }) => method === 'scale').map(({ args }) => args),
    [[-1, 1], [1, 1]],
    'the no-offscreen path uses the same absolute-coordinate mirrors',
  );
  assert.deepEqual(
    directContext.calls.filter(({ method }) => method === 'drawImage')
      .map(({ globalAlpha }) => globalAlpha),
    [0.4, 0.4],
    'the no-offscreen path also applies alpha once per fragment',
  );

  const changedAlpha = drawAuthoredDiscoveryFog(createContextSpy(), {
    ...baseOptions,
    fogAlpha: 0.2,
    canvasFactory: cacheSurfaces.factory,
  });
  const stableChangedAlpha = drawAuthoredDiscoveryFog(createContextSpy(), {
    ...baseOptions,
    fogAlpha: 0.2,
    canvasFactory: cacheSurfaces.factory,
  });
  assert.equal(changedAlpha.cacheMisses, 1,
    'fogAlpha participates in the cache key instead of reusing differently composited pixels');
  assert.equal(stableChangedAlpha.cacheHits, 1);
  assert.equal(cacheSurfaces.canvases.length, 2);
});

test('authored fog falls back per cell at 1.6 x 1.2 when offscreen canvas is unavailable', () => {
  clearDiscoveryFogChunkCache();
  const ctx = createContextSpy();
  const store = readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.fog]);
  const result = drawAuthoredDiscoveryFog(ctx, {
    visibleBounds: { minX: 0, minY: 0, maxX: 7, maxY: 0 },
    pixelsPerCell: 50,
    worldToScreen: ({ x, y }) => ({ x: x * 50, y: y * 50 }),
    assetStore: store,
    isUndiscovered: () => true,
    canvasFactory: () => null,
  });
  const fogDraws = ctx.calls.filter(({ method, args }) => (
    method === 'drawImage' && args[0]?.key === TERRAIN_LAYER_ASSET_KEYS.fog
  ));

  assert.deepEqual(result, {
    cells: 8,
    assetCells: 8,
    fallbackCells: 0,
    usedAsset: true,
    cachedChunks: 0,
    directAssetCells: 8,
    cacheHits: 0,
    cacheMisses: 0,
  });
  assert.equal(fogDraws.length, 8, 'a continuous row remains eight overlapping sprites');
  assert.ok(fogDraws.every(({ args }) => args[3] === 80 && args[4] === 60));
  assert.equal(fogDraws.some(({ args }) => args[3] > 80), false,
    'no source sprite is widened to the length of the undiscovered row');
});

test('minimum-zoom 1280x720 terrain keeps macro texture and dense fog draw calls bounded', () => {
  // This is a count-based mobile render budget, not a wall-clock benchmark.
  // At the minimum supported zoom a 1280x720 viewport plus the one-cell camera
  // guard contains 37x23 logical cells. Growing the infinite world must not
  // increase either budget beyond what one screen can display.
  const pixelsPerCell = 64 * 0.6;
  const bounds = { minX: -1, minY: -1, maxX: 35, maxY: 21 };
  const worldToScreen = ({ x, y }) => ({
    x: x * pixelsPerCell,
    y: y * pixelsPerCell,
  });
  const store = readyAssetStore([
    TERRAIN_LAYER_ASSET_KEYS.ground,
    TERRAIN_LAYER_ASSET_KEYS.fog,
  ]);

  const groundContext = createContextSpy();
  const ground = drawOrganicGround(groundContext, {
    visibleBounds: bounds,
    pixelsPerCell,
    worldToScreen,
    assetStore: store,
  });
  const macroTextureDraws = groundContext.calls.filter(({ method, args }) => (
    method === 'drawImage' && args[0]?.key === TERRAIN_LAYER_ASSET_KEYS.ground
  )).length;
  assert.ok(
    macroTextureDraws <= 12,
    `one minimum-zoom screen may draw at most 12 macro ground tiles, got ${macroTextureDraws}`,
  );
  assert.equal(ground.groundTextureTiles, macroTextureDraws);

  clearDiscoveryFogChunkCache();
  const cacheSurfaces = createCanvasFactorySpy();
  const fogOptions = {
    visibleBounds: bounds,
    pixelsPerCell,
    worldToScreen,
    assetStore: store,
    isUndiscovered: () => true,
    canvasFactory: cacheSurfaces.factory,
  };
  const fogContext = createContextSpy();
  const fog = drawAuthoredDiscoveryFog(fogContext, fogOptions);
  const internalDrawsAfterBuild = cacheSurfaces.canvases.reduce((total, { context }) => (
    total + context.calls.filter(({ method }) => method === 'drawImage').length
  ), 0);
  const stableContext = createContextSpy();
  const stableFog = drawAuthoredDiscoveryFog(stableContext, fogOptions);
  const internalDrawsAfterStableFrame = cacheSurfaces.canvases.reduce((total, { context }) => (
    total + context.calls.filter(({ method }) => method === 'drawImage').length
  ), 0);
  const fogDraws = fogContext.calls.filter(({ method, args }) => (
    method === 'drawImage' && args[0]?.key?.startsWith('discovery-fog-cache-')
  )).length;
  assert.equal(fog.cells, 37 * 23, 'the contract exercises a completely hidden screen');
  assert.ok(
    fogDraws <= 12,
    `dense discovery fog may composite at most 12 visible chunks per screen, got ${fogDraws}`,
  );
  assert.equal(fog.assetCells, fogDraws);
  assert.equal(fog.cachedChunks, fogDraws);
  assert.equal(fog.cacheMisses, fogDraws);
  assert.equal(stableFog.cacheHits, fogDraws);
  assert.equal(stableFog.cacheMisses, 0);
  assert.equal(stableContext.calls.filter(({ method }) => method === 'drawImage').length, fogDraws);
  assert.equal(internalDrawsAfterStableFrame, internalDrawsAfterBuild,
    'a stable frame performs no new per-cell fog rasterization');
  assert.equal(DISCOVERY_FOG_CHUNK_CELLS, 16);
  assert.ok(DISCOVERY_FOG_CACHE_CAPACITY >= fogDraws);
  assert.ok(cacheSurfaces.canvases.every(({ canvas }) => (
    canvas.width <= DISCOVERY_FOG_CACHE_TARGET_PIXELS
      && canvas.height <= DISCOVERY_FOG_CACHE_TARGET_PIXELS
  )), 'normal margin-inclusive fog caches stay within the adaptive surface target');
});

test('fog cache adapts chunk size while matching zoom and DPR physical resolution', () => {
  const cases = [
    { pixelsPerCell: 38.4, pixelRatio: 1 },
    { pixelsPerCell: 64, pixelRatio: 2 },
    { pixelsPerCell: 90, pixelRatio: 3 },
  ];
  let previousChunkCells = Infinity;

  for (const renderCase of cases) {
    clearDiscoveryFogChunkCache();
    const cacheSurfaces = createCanvasFactorySpy();
    const store = readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.fog]);
    const result = drawAuthoredDiscoveryFog(createContextSpy(), {
      visibleBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      pixelsPerCell: renderCase.pixelsPerCell,
      pixelRatio: renderCase.pixelRatio,
      worldToScreen: ({ x, y }) => ({
        x: x * renderCase.pixelsPerCell,
        y: y * renderCase.pixelsPerCell,
      }),
      assetStore: store,
      isUndiscovered: () => true,
      canvasFactory: cacheSurfaces.factory,
    });
    assert.equal(result.cacheMisses, 1);
    assert.equal(result.directAssetCells, 0);
    assert.equal(cacheSurfaces.canvases.length, 1);

    const { canvas, context } = cacheSurfaces.canvases[0];
    const internalDraws = context.calls.filter(({ method }) => method === 'drawImage');
    const chunkCells = Math.sqrt(internalDraws.length);
    const physicalCellPixels = Math.ceil(
      renderCase.pixelsPerCell * renderCase.pixelRatio,
    );
    assert.ok(Number.isInteger(chunkCells));
    assert.ok(chunkCells <= previousChunkCells,
      'higher physical resolution never grows the cached world chunk');
    assert.ok(physicalCellPixels >= renderCase.pixelsPerCell * renderCase.pixelRatio);
    assert.ok(internalDraws.every(({ args }) => (
      args[3] === physicalCellPixels * 1.6
        && args[4] === physicalCellPixels * 1.2
    )), 'cache rasterization is at least as sharp as final direct physical drawing');
    assert.equal(canvas.width, Math.ceil((chunkCells + 0.6) * physicalCellPixels));
    assert.equal(canvas.height, Math.ceil((chunkCells + 0.2) * physicalCellPixels));
    assert.ok(canvas.width <= DISCOVERY_FOG_CACHE_TARGET_PIXELS);
    assert.ok(canvas.height <= DISCOVERY_FOG_CACHE_TARGET_PIXELS);
    previousChunkCells = chunkCells;
  }
});

test('high-DPR viewport may use the 1024px envelope to keep stable composites in the LRU', () => {
  clearDiscoveryFogChunkCache();
  const cacheSurfaces = createCanvasFactorySpy();
  const store = readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.fog]);
  const options = {
    visibleBounds: { minX: -1, minY: -1, maxX: 35, maxY: 21 },
    pixelsPerCell: 38.4,
    pixelRatio: 2,
    worldToScreen: ({ x, y }) => ({ x: x * 38.4, y: y * 38.4 }),
    assetStore: store,
    isUndiscovered: () => true,
    canvasFactory: cacheSurfaces.factory,
  };

  const first = drawAuthoredDiscoveryFog(createContextSpy(), options);
  const stable = drawAuthoredDiscoveryFog(createContextSpy(), options);
  assert.ok(first.cachedChunks <= DISCOVERY_FOG_CACHE_CAPACITY);
  assert.equal(first.cacheMisses, first.cachedChunks);
  assert.equal(stable.cacheHits, first.cachedChunks);
  assert.equal(stable.cacheMisses, 0,
    'the adaptive chunk edge prevents a high-DPR viewport from cycling the LRU');
  assert.ok(cacheSurfaces.canvases.some(({ canvas }) => (
    canvas.width > DISCOVERY_FOG_CACHE_TARGET_PIXELS
  )), 'the viewport uses the optional quality-preserving 768-1024px envelope');
  assert.ok(cacheSurfaces.canvases.every(({ canvas }) => (
    canvas.width <= DISCOVERY_FOG_CACHE_MAX_PIXELS
      && canvas.height <= DISCOVERY_FOG_CACHE_MAX_PIXELS
  )));
});

test('fog cache keys include raster resolution even when adaptive chunk size is unchanged', () => {
  clearDiscoveryFogChunkCache();
  const cacheSurfaces = createCanvasFactorySpy();
  const store = readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.fog]);
  const render = (pixelRatio) => drawAuthoredDiscoveryFog(createContextSpy(), {
    visibleBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    pixelsPerCell: 20,
    pixelRatio,
    worldToScreen: ({ x, y }) => ({ x: x * 20, y: y * 20 }),
    assetStore: store,
    isUndiscovered: () => true,
    canvasFactory: cacheSurfaces.factory,
  });

  assert.equal(render(1).cacheMisses, 1);
  assert.equal(render(2).cacheMisses, 1,
    'the same world chunk is rebuilt rather than upscaling a lower-resolution cache');
  assert.equal(render(2).cacheHits, 1);
  assert.equal(cacheSurfaces.canvases.length, 2);
  assert.equal(
    Math.sqrt(cacheSurfaces.canvases[0].context.calls
      .filter(({ method }) => method === 'drawImage').length),
    DISCOVERY_FOG_CHUNK_CELLS,
  );
  assert.equal(
    Math.sqrt(cacheSurfaces.canvases[1].context.calls
      .filter(({ method }) => method === 'drawImage').length),
    DISCOVERY_FOG_CHUNK_CELLS,
  );
});

test('fog cache never downsamples when one high-DPR cell exceeds its surface budget', () => {
  clearDiscoveryFogChunkCache();
  const store = readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.fog]);

  const oneCellCache = createCanvasFactorySpy();
  const withinHardLimit = drawAuthoredDiscoveryFog(createContextSpy(), {
    visibleBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    pixelsPerCell: 250,
    pixelRatio: 2,
    assetStore: store,
    isUndiscovered: () => true,
    canvasFactory: oneCellCache.factory,
  });
  assert.equal(withinHardLimit.cacheMisses, 1);
  assert.equal(oneCellCache.canvases.length, 1);
  assert.ok(oneCellCache.canvases[0].canvas.width > DISCOVERY_FOG_CACHE_TARGET_PIXELS);
  assert.ok(oneCellCache.canvases[0].canvas.width <= DISCOVERY_FOG_CACHE_MAX_PIXELS);
  assert.deepEqual(
    oneCellCache.canvases[0].context.calls
      .find(({ method }) => method === 'drawImage').args.slice(3, 5),
    [500 * 1.6, 500 * 1.2],
  );

  clearDiscoveryFogChunkCache();
  const tooLargeCache = createCanvasFactorySpy();
  const directContext = createContextSpy();
  const aboveHardLimit = drawAuthoredDiscoveryFog(directContext, {
    visibleBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    pixelsPerCell: 350,
    pixelRatio: 2,
    assetStore: store,
    isUndiscovered: () => true,
    canvasFactory: tooLargeCache.factory,
  });
  assert.equal(aboveHardLimit.cachedChunks, 0);
  assert.equal(aboveHardLimit.directAssetCells, 1);
  assert.equal(tooLargeCache.canvases.length, 0,
    'a too-large cache is skipped rather than allocating or lowering resolution');
  const directDraw = directContext.calls.find(({ method }) => method === 'drawImage');
  assert.deepEqual(directDraw.args.slice(3, 5), [350 * 1.6, 350 * 1.2]);
  assert.ok(directDraw.args[3] * 2 > DISCOVERY_FOG_CACHE_MAX_PIXELS,
    'the main canvas retains the full final physical sprite width');
});

test('revealing one cell invalidates only its signed fog chunk', () => {
  clearDiscoveryFogChunkCache();
  const cacheSurfaces = createCanvasFactorySpy();
  const store = readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.fog]);
  let revealed = false;
  const options = {
    visibleBounds: { minX: 0, minY: 0, maxX: 15, maxY: 15 },
    pixelsPerCell: 40,
    worldToScreen: ({ x, y }) => ({ x: x * 40, y: y * 40 }),
    assetStore: store,
    isUndiscovered: (x, y) => !(revealed && x === 0 && y === 0),
    canvasFactory: cacheSurfaces.factory,
  };

  const first = drawAuthoredDiscoveryFog(createContextSpy(), options);
  const stable = drawAuthoredDiscoveryFog(createContextSpy(), options);
  revealed = true;
  const changed = drawAuthoredDiscoveryFog(createContextSpy(), options);

  assert.equal(first.cells, 256);
  assert.equal(first.cacheMisses, 1);
  assert.equal(stable.cacheHits, 1);
  assert.equal(changed.cells, 255);
  assert.equal(changed.cacheHits, 0);
  assert.equal(changed.cacheMisses, 1);
  assert.equal(cacheSurfaces.canvases.length, 2,
    'the changed content signature replaces that chunk cache exactly once');
  assert.equal(
    cacheSurfaces.canvases[1].context.calls.filter(({ method }) => method === 'drawImage').length,
    255,
  );
});

test('discovery fog cache is a fixed-capacity LRU', () => {
  clearDiscoveryFogChunkCache();
  const cacheSurfaces = createCanvasFactorySpy();
  const store = readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.fog]);
  const renderChunk = (chunkX) => {
    const originX = chunkX * DISCOVERY_FOG_CHUNK_CELLS;
    return drawAuthoredDiscoveryFog(createContextSpy(), {
      visibleBounds: { minX: originX, minY: 0, maxX: originX, maxY: 0 },
      pixelsPerCell: 40,
      worldToScreen: ({ x, y }) => ({ x: x * 40, y: y * 40 }),
      assetStore: store,
      isUndiscovered: (x, y) => x === originX && y === 0,
      canvasFactory: cacheSurfaces.factory,
    });
  };

  for (let chunkX = 0; chunkX < DISCOVERY_FOG_CACHE_CAPACITY; chunkX += 1) {
    assert.equal(renderChunk(chunkX).cacheMisses, 1);
  }
  assert.equal(renderChunk(0).cacheHits, 1, 'touching the oldest entry refreshes it');
  assert.equal(renderChunk(DISCOVERY_FOG_CACHE_CAPACITY).cacheMisses, 1);
  assert.equal(renderChunk(0).cacheHits, 1, 'the refreshed entry survives capacity eviction');
  assert.equal(renderChunk(1).cacheMisses, 1, 'the least-recently-used entry was evicted');
  assert.equal(cacheSurfaces.canvases.length, DISCOVERY_FOG_CACHE_CAPACITY + 2);
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

test('shared authored contact shadows form one pass before every ready terrain prop PNG', () => {
  const terrainIds = [
    'soft-gel',
    'dew-honey',
    'crystal-shard',
    'thorn-thicket',
    'brittle-boulder',
  ];
  const ctx = createContextSpy();
  const store = readyAssetStore([
    TERRAIN_LAYER_ASSET_KEYS.shadow,
    ...terrainIds.map((id) => TERRAIN_ASSET_KEYS[id]),
  ]);
  const result = drawOrganicTerrainProps(ctx, {
    ...optionsFor([terrainIds.map((terrainId) => ({ terrainId }))], 100),
    assetStore: store,
  });
  const imageKeys = ctx.calls
    .filter(({ method }) => method === 'drawImage')
    .map(({ args }) => args[0]?.key);
  const shadowCalls = ctx.calls.filter(({ method, args }) => (
    method === 'drawImage' && args[0]?.key === TERRAIN_LAYER_ASSET_KEYS.shadow
  ));
  const propKeys = terrainIds.map((id) => TERRAIN_ASSET_KEYS[id]);

  assert.equal(result.shadowAssetDraws, terrainIds.length);
  assert.equal(result.shadowFallbackDraws, 0);
  assert.deepEqual(imageKeys.slice(0, terrainIds.length),
    Array(terrainIds.length).fill(TERRAIN_LAYER_ASSET_KEYS.shadow));
  assert.deepEqual(imageKeys.slice(terrainIds.length), propKeys,
    'all contact shadows are composited before the first y-sorted prop image');
  assert.deepEqual(
    shadowCalls.map(({ args }) => [args[2], args[3], args[4]]),
    terrainIds.map((id) => [
      26 + 50
        + TERRAIN_ASSET_PROFILES[id].shadowOffset * 100
        - TERRAIN_ASSET_PROFILES[id].shadowHeight * 50,
      TERRAIN_ASSET_PROFILES[id].shadowWidth * 100,
      TERRAIN_ASSET_PROFILES[id].shadowHeight * 100,
    ]),
  );

  const surfaceContext = createContextSpy();
  const surfaceStore = readyAssetStore([
    TERRAIN_LAYER_ASSET_KEYS.shadow,
    TERRAIN_ASSET_KEYS['deep-water'],
  ]);
  const surface = drawOrganicTerrainProps(surfaceContext, {
    ...optionsFor([['ground', 'deep-water']]),
    assetStore: surfaceStore,
  });
  assert.equal(surface.shadowAssetDraws, 0);
  assert.equal(surface.shadowFallbackDraws, 0);
  assert.equal(surfaceStore.requested.includes(TERRAIN_LAYER_ASSET_KEYS.shadow), false,
    'ground and deep water never request a contact shadow');
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
  assert.deepEqual(TERRAIN_LAYER_ASSET_KEYS, {
    ground: 'terrain-ground-field-v1',
    fog: 'terrain-discovery-fog-cell-v1',
    shadow: 'terrain-prop-contact-shadow-v1',
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

test('infinite-world coordinates deterministically vary authored terrain silhouettes', () => {
  const store = readyAssetStore(['terrain-soft-gel-node-a']);
  const drawAt = (x) => {
    const ctx = createContextSpy();
    drawTerrainAsset(ctx, store, { terrainId: 'soft-gel', x, y: 0 }, {
      x: 80,
      y: 96,
      cellSize: 64,
    });
    return ctx.calls.find(({ method }) => method === 'scale').args;
  };

  assert.deepEqual(drawAt(0), [1, 1]);
  assert.deepEqual(drawAt(2), [-1, 1]);
  assert.deepEqual(drawAt(2), drawAt(2), 'the same world cell stays visually stable');
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

  assert.deepEqual(
    new Set(propStore.requested),
    new Set([...propKeys, TERRAIN_LAYER_ASSET_KEYS.shadow]),
  );
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
    'terrain-prop-contact-shadow-v1',
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
