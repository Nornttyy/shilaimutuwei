import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearDiscoveryFogChunkCache,
  DISCOVERY_FOG_CACHE_CAPACITY,
  DISCOVERY_FOG_CACHE_MARGIN_CELLS,
  DISCOVERY_FOG_CACHE_MAX_PIXELS,
  DISCOVERY_FOG_CACHE_TARGET_PIXELS,
  DISCOVERY_FOG_CHUNK_CELLS,
  DISCOVERY_CLOUD_TEXTURE_PERIOD_X_CELLS,
  DISCOVERY_CLOUD_TEXTURE_PERIOD_Y_CELLS,
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
  WATER_RIPPLE_DENSITY,
  WATER_TEXTURE_PERIOD_X_CELLS,
  WATER_TEXTURE_PERIOD_Y_CELLS,
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
    'clip', 'drawImage', 'quadraticCurveTo', 'rect', 'rotate', 'scale',
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

function waterRippleRecords(ctx) {
  const records = [];
  for (let index = 4; index < ctx.calls.length; index += 1) {
    if (ctx.calls[index].method !== 'stroke') continue;
    const translate = ctx.calls[index - 4];
    const begin = ctx.calls[index - 3];
    const move = ctx.calls[index - 2];
    const curve = ctx.calls[index - 1];
    if (translate?.method !== 'translate'
      || begin?.method !== 'beginPath'
      || move?.method !== 'moveTo'
      || curve?.method !== 'quadraticCurveTo') continue;
    records.push({
      translate: translate.args,
      move: move.args,
      curve: curve.args,
    });
  }
  return records;
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

test('discovery fog caches one joined mask with sparse world-scale cloud texture', () => {
  clearDiscoveryFogChunkCache();
  const unknown = new Set(['-1,0', '0,0', '1,1']);
  const cacheSurfaces = createCanvasFactorySpy();
  const readyStore = readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.fog]);
  const render = (offsetX = 12, offsetY = 18) => {
    const ctx = createContextSpy();
    const result = drawAuthoredDiscoveryFog(ctx, {
      visibleBounds: { minX: -1, minY: 0, maxX: 1, maxY: 1 },
      pixelsPerCell: 50,
      worldToScreen: ({ x, y }) => ({ x: offsetX + x * 50, y: offsetY + y * 50 }),
      assetStore: readyStore,
      isUndiscovered: (x, y) => unknown.has(`${x},${y}`),
      canvasFactory: cacheSurfaces.factory,
    });
    return { ctx, result };
  };
  const first = render();
  const second = render();
  const panned = render(37, -9);

  assert.deepEqual(first.result, {
    cells: 3,
    assetCells: 3,
    fallbackCells: 0,
    usedAsset: true,
    cachedChunks: 2,
    directAssetCells: 0,
    cacheHits: 0,
    cacheMisses: 2,
    maskChunks: 2,
    textureTiles: 2,
    sealedJunctions: 0,
  });
  assert.deepEqual(second.result, {
    ...first.result,
    cacheHits: 2,
    cacheMisses: 0,
  });
  assert.deepEqual(panned.result, second.result);
  assert.deepEqual(readyStore.requested, [
    TERRAIN_LAYER_ASSET_KEYS.fog,
    TERRAIN_LAYER_ASSET_KEYS.fog,
    TERRAIN_LAYER_ASSET_KEYS.fog,
  ]);
  assert.equal(first.ctx.calls.filter(({ method }) => method === 'fillRect').length, 0);
  const imageCalls = first.ctx.calls.filter(({ method }) => method === 'drawImage');
  assert.equal(imageCalls.length, 2);
  assert.equal(cacheSurfaces.canvases.length, 2,
    'two signed world chunks are built once and reused while the camera pans');
  assert.ok(cacheSurfaces.canvases.every(({ context }) => (
    context.calls.filter(({ method }) => method === 'fill').length === 2
  )), 'each chunk receives one organic edge fill and one joined concealment fill');
  assert.ok(cacheSurfaces.canvases.every(({ context }) => (
    context.calls.filter(({ method }) => method === 'fillRect').length === 0
  )), 'the cache never paints one rectangle operation per hidden cell');
  const internalFogDraws = cacheSurfaces.canvases.flatMap(({ context }) => (
    context.calls.filter(({ method, args }) => (
      method === 'drawImage' && args[0]?.key === TERRAIN_LAYER_ASSET_KEYS.fog
    ))
  ));
  assert.equal(internalFogDraws.length, 2);
  assert.ok(internalFogDraws.every(({ args }) => (
    args[3] === 50 * DISCOVERY_CLOUD_TEXTURE_PERIOD_X_CELLS
    && args[4] === 50 * DISCOVERY_CLOUD_TEXTURE_PERIOD_Y_CELLS
  )), 'the authored image is an 8x6-cell macro texture rather than a cell sprite');
  assert.equal(first.ctx.calls.some(({ method, args }) => (
    method === 'drawImage' && args[0]?.key === TERRAIN_LAYER_ASSET_KEYS.fog
  )), false, 'the main canvas composites joined chunk caches, not repeated cell clouds');
  assert.deepEqual(
    imageCalls.map(({ args }) => args.slice(1)),
    second.ctx.calls.filter(({ method }) => method === 'drawImage').map(({ args }) => args.slice(1)),
    'the same world chunks keep stable screen placement',
  );
  const firstPlacements = imageCalls.map(({ args }) => args.slice(1));
  const pannedPlacements = panned.ctx.calls
    .filter(({ method }) => method === 'drawImage')
    .map(({ args }) => args.slice(1));
  assert.deepEqual(
    pannedPlacements.map(([, , width, height], index) => [
      pannedPlacements[index][0] - firstPlacements[index][0],
      pannedPlacements[index][1] - firstPlacements[index][1],
      width,
      height,
    ]),
    firstPlacements.map(([, , width, height]) => [25, -27, width, height]),
    'camera movement only translates cached chunks; it never slides their internal cloud field',
  );
});

test('fog cache gutters preserve organic edges at signed chunk boundaries and reuse stably', () => {
  clearDiscoveryFogChunkCache();
  const pixelsPerCell = 40;
  const hidden = new Set(['-16,0', '15,0']);
  const cacheSurfaces = createCanvasFactorySpy();
  const options = {
    // Keep the explored neighbor beyond each signed chunk edge visible so the
    // preserved halo is exercised inside the viewport, not outside its crop.
    visibleBounds: { minX: -17, minY: 0, maxX: 16, maxY: 0 },
    pixelsPerCell,
    worldToScreen: ({ x, y }) => ({ x: x * pixelsPerCell, y: y * pixelsPerCell }),
    assetStore: readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.fog]),
    isUndiscovered: (x, y) => hidden.has(`${x},${y}`),
    canvasFactory: cacheSurfaces.factory,
  };
  const context = createContextSpy();
  const first = drawAuthoredDiscoveryFog(context, options);
  const callsAfterBuild = cacheSurfaces.canvases.map(({ context: cached }) => cached.calls.length);
  const stable = drawAuthoredDiscoveryFog(createContextSpy(), options);

  assert.equal(DISCOVERY_FOG_CACHE_MARGIN_CELLS, 0.15);
  assert.equal(first.cacheMisses, 2);
  assert.equal(stable.cacheHits, 2);
  assert.equal(stable.cacheMisses, 0);
  assert.equal(cacheSurfaces.canvases.length, 2);
  assert.deepEqual(
    cacheSurfaces.canvases.map(({ context: cached }) => cached.calls.length),
    callsAfterBuild,
    'a stable frame performs no new gutter rasterization',
  );

  const cacheCellPixels = pixelsPerCell;
  const marginPixels = Math.ceil(DISCOVERY_FOG_CACHE_MARGIN_CELLS * cacheCellPixels - 1e-7);
  const corePixels = DISCOVERY_FOG_CHUNK_CELLS * cacheCellPixels;
  const organicXExtents = ({ context: cached }) => {
    const start = cached.calls.findIndex(({ method }) => method === 'beginPath');
    const end = cached.calls.findIndex((call, index) => index > start && call.method === 'fill');
    const xs = [];
    for (const { method, args } of cached.calls.slice(start + 1, end)) {
      if (method === 'moveTo' || method === 'lineTo') xs.push(args[0]);
      if (method === 'quadraticCurveTo') xs.push(args[0], args[2]);
      if (method === 'bezierCurveTo') xs.push(args[0], args[2], args[4]);
    }
    return { min: Math.min(...xs), max: Math.max(...xs) };
  };
  const [negativeBoundary, positiveBoundary] = cacheSurfaces.canvases.map(organicXExtents);
  assert.ok(negativeBoundary.min >= 0 && negativeBoundary.min < marginPixels,
    'the lone negative-chunk boundary cell keeps its organic halo left of the core');
  assert.ok(positiveBoundary.max > marginPixels + corePixels
    && positiveBoundary.max <= cacheSurfaces.canvases[1].canvas.width,
    'the lone positive-chunk boundary cell keeps its organic halo right of the core');

  const composites = context.calls
    .filter(({ method, args }) => method === 'drawImage'
      && args[0]?.key?.startsWith('discovery-fog-cache-'))
    .map(({ args }) => args.slice(1));
  assert.equal(composites.length, 2);
  assert.ok(Math.abs((composites[1][0] - composites[0][0]) - corePixels) < 1e-7,
    'neighboring signed chunks remain anchored one core width apart');
  assert.ok(Math.abs((composites[0][0] + composites[0][2]) - composites[1][0]
    - marginPixels * 2) < 1e-7,
    'neighboring cache gutters overlap continuously without a straight cut or gap');
});

test('cached and direct fog share one group alpha, joined seams, and 2x2 junction sealing', () => {
  clearDiscoveryFogChunkCache();
  const unknown = new Set(['0,0', '1,0', '0,1', '1,1']);
  const cacheSurfaces = createCanvasFactorySpy();
  const store = readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.fog]);
  const baseOptions = {
    visibleBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    pixelsPerCell: 64,
    pixelRatio: 1,
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
  const internalDraws = internalContext.calls.filter(({ method, args }) => (
    method === 'drawImage' && args[0]?.key === TERRAIN_LAYER_ASSET_KEYS.fog
  ));
  assert.equal(internalContext.calls.filter(({ method }) => method === 'fill').length, 2);
  assert.deepEqual(internalDraws.map(({ globalAlpha }) => globalAlpha), [0.4],
    'one group alpha reaches one macro texture instead of compounding four cell clouds');
  assert.deepEqual(
    internalContext.calls.filter(({ method }) => method === 'scale').map(({ args }) => args),
    [[1, 1]],
    'the macro block owns one world-coordinate transform, not an AB cell pattern',
  );
  assert.equal(cached.sealedJunctions, 1,
    'the central four-way crossing receives an explicit anti-pinhole patch');
  const cachedComposite = cachedContext.calls.find(({ method }) => method === 'drawImage');
  assert.equal(cachedComposite.globalAlpha, 1,
    'the main canvas does not apply fogAlpha to the already-composited chunk');

  const directContext = createContextSpy();
  const direct = drawAuthoredDiscoveryFog(directContext, {
    ...baseOptions,
    canvasFactory: () => null,
  });
  assert.equal(direct.directAssetCells, 4);
  assert.equal(direct.sealedJunctions, 1);
  assert.equal(directContext.calls.filter(({ method }) => method === 'fill').length, 2);
  const directDraws = directContext.calls.filter(({ method, args }) => (
    method === 'drawImage' && args[0]?.key === TERRAIN_LAYER_ASSET_KEYS.fog
  ));
  assert.deepEqual(directDraws.map(({ globalAlpha }) => globalAlpha), [0.4]);
  const cacheMarginPixels = Math.ceil(
    DISCOVERY_FOG_CACHE_MARGIN_CELLS * baseOptions.pixelsPerCell - 1e-7,
  );
  const normalizedCachedPlacements = texturePlacements(
    internalContext,
    TERRAIN_LAYER_ASSET_KEYS.fog,
  ).map((placement) => ({
    ...placement,
    translate: placement.translate.map((coordinate) => coordinate - cacheMarginPixels),
  }));
  assert.deepEqual(
    texturePlacements(directContext, TERRAIN_LAYER_ASSET_KEYS.fog),
    normalizedCachedPlacements,
    'after removing the cache gutter, cached and direct paths share one world anchor and 8x6 rectangle',
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

test('missing-art no-offscreen fog remains a continuous joined mask without grid operations', () => {
  clearDiscoveryFogChunkCache();
  const ctx = createContextSpy();
  const result = drawAuthoredDiscoveryFog(ctx, {
    visibleBounds: { minX: 0, minY: 0, maxX: 7, maxY: 1 },
    pixelsPerCell: 50,
    worldToScreen: ({ x, y }) => ({ x: x * 50, y: y * 50 }),
    assetStore: readyAssetStore([]),
    isUndiscovered: () => true,
    canvasFactory: () => null,
  });

  assert.deepEqual(result, {
    cells: 16,
    assetCells: 0,
    fallbackCells: 16,
    usedAsset: false,
    cachedChunks: 0,
    directAssetCells: 0,
    cacheHits: 0,
    cacheMisses: 0,
    maskChunks: 1,
    textureTiles: 0,
    sealedJunctions: 7,
  });
  assert.equal(ctx.calls.filter(({ method }) => method === 'drawImage').length, 0);
  assert.equal(ctx.calls.filter(({ method }) => method === 'fillRect').length, 0);
  assert.equal(ctx.calls.filter(({ method }) => method === 'fill').length, 2,
    'sixteen hidden cells become one organic edge fill and one sealed concealment fill');
  assert.ok(ctx.calls.filter(({ method }) => method === 'lineTo').length > 16 * 4,
    'shared-edge strips and four-way patches explicitly close seams and crossing pinholes');
});

test('discovery cloud macro blocks stay absolutely anchored across negative coordinates and crops', () => {
  const store = readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.fog]);
  const render = (visibleBounds) => {
    const ctx = createContextSpy();
    drawAuthoredDiscoveryFog(ctx, {
      visibleBounds,
      pixelsPerCell: 10,
      worldToScreen: ({ x, y }) => ({ x: 100 + x * 10, y: 200 + y * 10 }),
      assetStore: store,
      isUndiscovered: () => true,
      canvasFactory: () => null,
    });
    return texturePlacements(ctx, TERRAIN_LAYER_ASSET_KEYS.fog);
  };
  const wide = render({ minX: -17, minY: -13, maxX: 17, maxY: 13 });
  const cropped = render({ minX: -9, minY: -7, maxX: 9, maxY: 7 });
  const placementKey = ({ translate, scale, draw }) => JSON.stringify({ translate, scale, draw });
  const wideKeys = new Set(wide.map(placementKey));

  assert.equal(DISCOVERY_CLOUD_TEXTURE_PERIOD_X_CELLS, 8);
  assert.equal(DISCOVERY_CLOUD_TEXTURE_PERIOD_Y_CELLS, 6);
  assert.ok(cropped.every((placement) => wideKeys.has(placementKey(placement))),
    'cropping visible bounds may remove macro blocks but cannot reposition shared ones');
  for (const { translate, scale, draw } of wide) {
    const macroX = (translate[0] - 100) / 10 / 8 - 0.5;
    const macroY = (translate[1] - 200) / 10 / 6 - 0.5;
    assert.ok(Number.isInteger(macroX));
    assert.ok(Number.isInteger(macroY));
    assert.deepEqual(scale, [Math.abs(macroX % 2) === 1 ? -1 : 1,
      Math.abs(macroY % 2) === 1 ? -1 : 1]);
    assert.deepEqual(draw.slice(2), [80, 60]);
  }
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

  const waterContext = createContextSpy();
  const water = drawOrganicTerrainProps(waterContext, {
    visibleBounds: bounds,
    pixelsPerCell,
    worldToScreen,
    assetStore: readyAssetStore([TERRAIN_ASSET_KEYS['deep-water']]),
    terrainAt: (x, y) => ({
      kind: 'indestructible',
      terrainId: 'deep-water',
      x,
      y,
    }),
  });
  const waterTextureDraws = waterContext.calls.filter(({ method, args }) => (
    method === 'drawImage' && args[0]?.key === TERRAIN_ASSET_KEYS['deep-water']
  )).length;
  assert.equal(water.waterTextureTiles, waterTextureDraws);
  assert.equal(water.waterAssetDraws, waterTextureDraws);
  assert.equal(water.assetDraws, waterTextureDraws,
    'water assetDraws counts actual authored PNG draws, not one asset-store lookup');
  assert.equal(
    waterTextureDraws,
    70,
    'only visible water selects the ten-by-seven anchored macro blocks; halo selects none',
  );
  assert.equal(water.waterInteriorCells, water.water);
  assert.equal(water.waterOrganicCells, 0,
    'a fully flooded screen never rebuilds an organic Bezier blob per cell');
  assert.equal(water.waterInteriorRuns, 23,
    'the 851 interior cells collapse into one batched rectangle per visible row');
  assert.equal(water.waterMaskInteriorCells, water.water);
  assert.equal(water.waterMaskOrganicCells, 0);
  const waterPathMethods = new Set([
    'beginPath', 'bezierCurveTo', 'clip', 'closePath', 'fill', 'lineTo', 'moveTo',
    'quadraticCurveTo', 'rect', 'stroke',
  ]);
  const waterPathCalls = waterContext.calls.filter(({ method }) => (
    waterPathMethods.has(method)
  )).length;
  assert.ok(
    waterContext.calls.length <= 1500,
    `one fully flooded screen stays under 1,500 Canvas API calls, got ${waterContext.calls.length}`,
  );
  assert.ok(
    waterPathCalls <= 500,
    `batched base and mask paths stay under 500 path calls, got ${waterPathCalls}`,
  );
  assert.ok(water.waterRipples <= Math.ceil(water.water * 0.12),
    'sparse ripple decoration stays bounded even on a fully flooded screen');

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
  assert.equal(fog.assetCells, fog.cells);
  assert.equal(fog.cachedChunks, fogDraws);
  assert.equal(fog.maskChunks, fogDraws);
  assert.equal(fog.cacheMisses, fogDraws);
  assert.equal(fog.textureTiles, internalDrawsAfterBuild);
  assert.ok(fog.textureTiles < fog.cells / 4,
    '8x6 cloud blocks stay dramatically sparser than the hidden-cell count');
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
  )), 'normal full-resolution fog caches stay within the adaptive surface target');
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
    const internalDraws = context.calls.filter(({ method, args }) => (
      method === 'drawImage' && args[0]?.key === TERRAIN_LAYER_ASSET_KEYS.fog
    ));
    const physicalCellPixels = Math.ceil(
      renderCase.pixelsPerCell * renderCase.pixelRatio,
    );
    const marginPixels = Math.max(
      1,
      Math.ceil(DISCOVERY_FOG_CACHE_MARGIN_CELLS * physicalCellPixels - 1e-7),
    );
    const chunkCells = (canvas.width - marginPixels * 2) / physicalCellPixels;
    assert.ok(Number.isInteger(chunkCells));
    assert.ok(chunkCells <= previousChunkCells,
      'higher physical resolution never grows the cached world chunk');
    assert.ok(physicalCellPixels >= renderCase.pixelsPerCell * renderCase.pixelRatio);
    assert.ok(internalDraws.every(({ args }) => (
      args[3] === physicalCellPixels * DISCOVERY_CLOUD_TEXTURE_PERIOD_X_CELLS
        && args[4] === physicalCellPixels * DISCOVERY_CLOUD_TEXTURE_PERIOD_Y_CELLS
    )), 'cache rasterizes each macro texture at the final physical world scale');
    assert.equal(canvas.width, chunkCells * physicalCellPixels + marginPixels * 2);
    assert.equal(canvas.height, chunkCells * physicalCellPixels + marginPixels * 2);
    assert.ok(marginPixels / physicalCellPixels >= DISCOVERY_FOG_CACHE_MARGIN_CELLS,
      'the physical gutter never rounds below the required organic-mask margin');
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
    cacheSurfaces.canvases[0].canvas.width,
    20 * DISCOVERY_FOG_CHUNK_CELLS
      + Math.ceil(20 * DISCOVERY_FOG_CACHE_MARGIN_CELLS - 1e-7) * 2,
  );
  assert.equal(
    cacheSurfaces.canvases[1].canvas.width,
    40 * DISCOVERY_FOG_CHUNK_CELLS
      + Math.ceil(40 * DISCOVERY_FOG_CACHE_MARGIN_CELLS - 1e-7) * 2,
  );
  assert.equal(
    cacheSurfaces.canvases[1].context.calls.filter(({ method }) => method === 'drawImage').length,
    cacheSurfaces.canvases[0].context.calls.filter(({ method }) => method === 'drawImage').length,
    'DPR changes cache resolution without changing absolute macro-cloud density',
  );
});

test('fog cache never downsamples when one high-DPR cell exceeds its surface budget', () => {
  clearDiscoveryFogChunkCache();
  const store = readyAssetStore([TERRAIN_LAYER_ASSET_KEYS.fog]);

  const oneCellCache = createCanvasFactorySpy();
  const withinHardLimit = drawAuthoredDiscoveryFog(createContextSpy(), {
    visibleBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    pixelsPerCell: 390,
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
    [780 * DISCOVERY_CLOUD_TEXTURE_PERIOD_X_CELLS,
      780 * DISCOVERY_CLOUD_TEXTURE_PERIOD_Y_CELLS],
  );

  clearDiscoveryFogChunkCache();
  const tooLargeCache = createCanvasFactorySpy();
  const directContext = createContextSpy();
  const aboveHardLimit = drawAuthoredDiscoveryFog(directContext, {
    visibleBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    pixelsPerCell: 600,
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
  assert.deepEqual(directDraw.args.slice(3, 5), [
    600 * DISCOVERY_CLOUD_TEXTURE_PERIOD_X_CELLS,
    600 * DISCOVERY_CLOUD_TEXTURE_PERIOD_Y_CELLS,
  ]);
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
    Math.ceil(DISCOVERY_FOG_CHUNK_CELLS / DISCOVERY_CLOUD_TEXTURE_PERIOD_X_CELLS)
      * Math.ceil(DISCOVERY_FOG_CHUNK_CELLS / DISCOVERY_CLOUD_TEXTURE_PERIOD_Y_CELLS),
    'revealing a cell rebuilds the same sparse macro texture, never 255 cell clouds',
  );
  assert.equal(cacheSurfaces.canvases[1].context.calls.filter(({ method }) => method === 'fill').length, 2);
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

test('deep-water macro texture is fixed to absolute world coordinates across visible bounds', () => {
  const waterCells = new Set();
  for (let y = 5; y <= 10; y += 1) {
    for (let x = 9; x <= 14; x += 1) waterCells.add(`${x},${y}`);
  }
  const terrainAt = (x, y) => waterCells.has(`${x},${y}`)
    ? { kind: 'indestructible', terrainId: 'deep-water', x, y }
    : { kind: 'ground', x, y };
  const worldToScreen = ({ x, y }) => ({ x: 17 + x * 50, y: 23 + y * 50 });
  const render = (visibleBounds) => {
    const ctx = createContextSpy();
    const store = readyAssetStore([TERRAIN_ASSET_KEYS['deep-water']]);
    const result = drawOrganicTerrainProps(ctx, {
      visibleBounds,
      pixelsPerCell: 50,
      worldToScreen,
      terrainAt,
      assetStore: store,
    });
    return { ctx, store, result };
  };
  const wide = render({ minX: 9, minY: 5, maxX: 14, maxY: 10 });
  const cropped = render({ minX: 10, minY: 6, maxX: 13, maxY: 9 });
  const widePlacements = texturePlacements(wide.ctx, TERRAIN_ASSET_KEYS['deep-water']);
  const croppedPlacements = texturePlacements(cropped.ctx, TERRAIN_ASSET_KEYS['deep-water']);

  assert.equal(WATER_TEXTURE_PERIOD_X_CELLS, 4);
  assert.equal(WATER_TEXTURE_PERIOD_Y_CELLS, 4);
  assert.deepEqual(croppedPlacements, widePlacements,
    'cropping the same lake cannot recenter, rescale, or re-mirror its macro water detail');
  assert.equal(widePlacements.length, 4);
  assert.ok(widePlacements.every(({ draw }) => (
    draw.length === 4 && draw[2] === 200 && draw[3] === 200
  )), 'every authored water draw keeps one exact, non-overlapping 4x4-cell destination');
  assert.deepEqual(
    new Set(widePlacements.map(({ scale }) => scale.join(','))),
    new Set(['1,-1', '-1,-1', '1,1', '-1,1']),
    'signed macro parity mirrors both axes so adjoining transparent edge pixels meet',
  );
  assert.deepEqual(wide.store.requested, [TERRAIN_ASSET_KEYS['deep-water']],
    'all visible water components share one authored texture pass');
  assert.deepEqual(cropped.store.requested, [TERRAIN_ASSET_KEYS['deep-water']]);
  assert.equal(wide.result.waterTextureComponents, 1);
  assert.equal(wide.result.waterTextureTiles, 4);
  assert.equal(wide.result.waterAssetDraws, 4);
  assert.equal(wide.result.assetDraws, 4);
  assert.equal(wide.ctx.calls.filter(({ method }) => method === 'clip').length, 2,
    'water is clipped to both the visible projection and its connected shoreline mask');

  const negativeContext = createContextSpy();
  drawOrganicTerrainProps(negativeContext, {
    visibleBounds: { minX: -1, minY: -1, maxX: -1, maxY: -1 },
    pixelsPerCell: 50,
    worldToScreen,
    terrainAt: (x, y) => ({
      kind: x === -1 && y === -1 ? 'indestructible' : 'ground',
      terrainId: x === -1 && y === -1 ? 'deep-water' : 'ground',
      x,
      y,
    }),
    assetStore: readyAssetStore([TERRAIN_ASSET_KEYS['deep-water']]),
  });
  assert.deepEqual(
    texturePlacements(negativeContext, TERRAIN_ASSET_KEYS['deep-water']),
    [{ translate: [-83, -77], scale: [-1, -1], draw: [-100, -100, 200, 200] }],
    'floor-based signed macro coordinates keep the -1,-1 water cell in the anchored -1,-1 tile',
  );
});

test('three-way and four-way water vertices receive matching base and texture-mask patches', () => {
  const configurations = [
    {
      name: 'four-way',
      tiles: [
        ['deep-water', 'deep-water'],
        ['deep-water', 'deep-water'],
      ],
    },
    {
      name: 'three-way',
      tiles: [
        ['deep-water', 'deep-water'],
        ['deep-water', 'ground'],
      ],
    },
  ];

  for (const configuration of configurations) {
    const ctx = createContextSpy();
    const result = drawOrganicTerrainProps(ctx, {
      ...optionsFor(configuration.tiles, 100),
      assetStore: readyAssetStore([TERRAIN_ASSET_KEYS['deep-water']]),
    });
    assert.equal(result.waterJunctionPatches, 1, `${configuration.name} base fill`);
    assert.equal(result.waterTextureJunctionPatches, 1, `${configuration.name} texture mask`);
    assert.equal(ctx.calls.filter(({ method }) => method === 'clip').length, 2);
    assert.ok(ctx.calls.filter(({ method }) => method === 'rect').length >= 2,
      `${configuration.name} seals the base and texture mask without a vertex pinhole`);
  }

  const croppedContext = createContextSpy();
  const cropped = drawOrganicTerrainProps(croppedContext, {
    visibleBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    pixelsPerCell: 100,
    worldToScreen: ({ x, y }) => ({ x: x * 100, y: y * 100 }),
    terrainAt: (x, y) => ({ kind: 'indestructible', terrainId: 'deep-water', x, y }),
    assetStore: readyAssetStore([TERRAIN_ASSET_KEYS['deep-water']]),
  });
  assert.equal(cropped.water, 1, 'public terrain work remains scoped to the visible bounds');
  assert.equal(cropped.waterInteriorCells, 1,
    'the halo preserves four-neighbor topology for the one visible water cell');
  assert.equal(cropped.waterOrganicCells, 0);
  assert.equal(cropped.waterJunctionPatches, 0,
    'halo topology cannot add an offscreen junction patch to the visible workload');
  assert.equal(cropped.waterTextureJunctionPatches, 0);
  assert.equal(cropped.waterTextureTiles, 1,
    'halo cells around world origin cannot request negative macro blocks');
  assert.deepEqual(
    texturePlacements(croppedContext, TERRAIN_ASSET_KEYS['deep-water']),
    [{ translate: [200, 200], scale: [1, 1], draw: [-200, -200, 400, 400] }],
  );
});

test('water texture mask joins an organic boundary cell to an interior cell in every direction', () => {
  const interior = { x: 0, y: 0 };
  const waterCells = new Set([
    '0,0', '-1,0', '1,0', '0,-1', '0,1',
  ]);
  const configurations = [
    {
      name: 'boundary right of interior',
      boundary: { x: 1, y: 0 },
      connector: [
        ['moveTo', [50, 15]],
        ['lineTo', [150, 15]],
        ['lineTo', [150, 85]],
        ['lineTo', [50, 85]],
        ['closePath', []],
      ],
    },
    {
      name: 'boundary left of interior',
      boundary: { x: -1, y: 0 },
      connector: [
        ['moveTo', [-50, 15]],
        ['lineTo', [50, 15]],
        ['lineTo', [50, 85]],
        ['lineTo', [-50, 85]],
        ['closePath', []],
      ],
    },
    {
      name: 'boundary below interior',
      boundary: { x: 0, y: 1 },
      connector: [
        ['moveTo', [15, 50]],
        ['lineTo', [15, 150]],
        ['lineTo', [85, 150]],
        ['lineTo', [85, 50]],
        ['closePath', []],
      ],
    },
    {
      name: 'boundary above interior',
      boundary: { x: 0, y: -1 },
      connector: [
        ['moveTo', [15, -50]],
        ['lineTo', [15, 50]],
        ['lineTo', [85, 50]],
        ['lineTo', [85, -50]],
        ['closePath', []],
      ],
    },
  ];

  for (const configuration of configurations) {
    const ctx = createContextSpy();
    const result = drawOrganicTerrainProps(ctx, {
      visibleBounds: {
        minX: Math.min(interior.x, configuration.boundary.x),
        minY: Math.min(interior.y, configuration.boundary.y),
        maxX: Math.max(interior.x, configuration.boundary.x),
        maxY: Math.max(interior.y, configuration.boundary.y),
      },
      pixelsPerCell: 100,
      worldToScreen: ({ x, y }) => ({ x: x * 100, y: y * 100 }),
      terrainAt: (x, y) => ({
        kind: waterCells.has(`${x},${y}`) ? 'indestructible' : 'ground',
        terrainId: waterCells.has(`${x},${y}`) ? 'deep-water' : 'ground',
        x,
        y,
      }),
      assetStore: readyAssetStore([TERRAIN_ASSET_KEYS['deep-water']]),
    });
    assert.equal(result.waterInteriorCells, 1, configuration.name);
    assert.equal(result.waterOrganicCells, 1, configuration.name);
    const clipIndices = ctx.calls.flatMap(({ method }, index) => (
      method === 'clip' ? [index] : []
    ));
    assert.equal(clipIndices.length, 2, configuration.name);
    const maskClipIndex = clipIndices[1];
    let maskStartIndex = maskClipIndex - 1;
    while (maskStartIndex >= 0 && ctx.calls[maskStartIndex].method !== 'beginPath') {
      maskStartIndex -= 1;
    }
    const maskCalls = ctx.calls.slice(maskStartIndex + 1, maskClipIndex);
    const connectorFound = maskCalls.some((_, startIndex) => (
      configuration.connector.every(([method, args], offset) => {
        const call = maskCalls[startIndex + offset];
        return call?.method === method && JSON.stringify(call.args) === JSON.stringify(args);
      })
    ));
    assert.equal(connectorFound, true,
      `${configuration.name} retains a full-width texture connector instead of exposing flat fill`);
  }
});

test('water ripples are sparse, world-stable, and animated instead of repeating once per cell', () => {
  const size = 20;
  const tiles = Array.from({ length: size }, () => Array(size).fill('deep-water'));
  const render = (time) => {
    const ctx = createContextSpy();
    const result = drawOrganicTerrainProps(ctx, {
      ...optionsFor(tiles, 48),
      time,
    });
    return { ctx, result, ripples: waterRippleRecords(ctx) };
  };
  const first = render(0.25);
  const later = render(1.25);

  assert.equal(WATER_RIPPLE_DENSITY, 0.09);
  assert.ok(first.result.waterRipples > 0);
  assert.ok(first.result.waterRipples <= first.result.water * 0.12,
    'roughly nine percent of water cells receive a ripple');
  assert.equal(first.ripples.length, first.result.waterRipples);
  assert.equal(later.ripples.length, first.result.waterRipples);
  assert.deepEqual(
    later.ripples.map(({ translate }) => translate),
    first.ripples.map(({ translate }) => translate),
    'hash-selected ripple cells and offsets remain fixed in world space',
  );
  assert.notDeepEqual(
    later.ripples.map(({ curve }) => curve),
    first.ripples.map(({ curve }) => curve),
    'the retained sparse ripples still animate over time',
  );
  const rippleCells = first.ripples.map(({ translate }) => ({
    x: Math.floor((translate[0] - 18) / 48),
    y: Math.floor((translate[1] - 26) / 48),
  }));
  for (let left = 0; left < rippleCells.length; left += 1) {
    for (let right = left + 1; right < rippleCells.length; right += 1) {
      const dx = Math.abs(rippleCells[left].x - rippleCells[right].x);
      const dy = Math.abs(rippleCells[left].y - rippleCells[right].y);
      assert.ok(Math.max(dx, dy) > 1,
        `ripples at ${JSON.stringify(rippleCells[left])} and ${JSON.stringify(rippleCells[right])} need a one-cell moat`);
    }
  }
  const countInWindow = (startX, startY, width, height) => rippleCells.filter(({ x, y }) => (
    x >= startX && x < startX + width && y >= startY && y < startY + height
  )).length;
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      assert.ok(countInWindow(x, y, 2, 2) <= 1,
        `2x2 water window at ${x},${y} cannot contain a four-ripple cluster`);
    }
  }
  for (let y = 0; y < size - 3; y += 1) {
    for (let x = 0; x < size - 3; x += 1) {
      assert.ok(countInWindow(x, y, 4, 4) <= 4,
        `4x4 water window at ${x},${y} cannot contain an eleven-ripple cluster`);
    }
  }
  assert.equal(
    first.ctx.calls.filter(({ method }) => method === 'stroke').length,
    first.result.boundarySegments + first.result.waterRipples,
    'no hidden per-cell wave stroke remains after the sparse ripple pass',
  );
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
