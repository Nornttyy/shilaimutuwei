import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PNG_SIGNATURE,
  parsePng,
  verifyAssets,
} from '../scripts/verify-assets.mjs';
import {
  ASSET_LOAD_TIMEOUT_MS,
  ASSET_PATHS,
  ASSET_PRELOAD_CONCURRENCY,
  ASSET_PRELOAD_RETRIES,
  CRITICAL_STARTUP_ASSET_KEYS,
  createAssetStore,
} from '../src/assets.js';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const PROJECT_ASSET_SPEC = JSON.parse(await readFile(
  new URL('../assets/asset-spec.json', import.meta.url),
  'utf8',
));

test('the workspace asset manifest strictly validates all 105 finished PNGs', async () => {
  const result = await verifyAssets({ cwd: PROJECT_ROOT, allowMissingSpec: false });
  assert.equal(result.ok, true, formatErrors(result));
  assert.equal(result.skipped, false);
  assert.equal(result.summary.declaredAssets, 105);
  assert.equal(result.summary.checkedAssets, 105);
  assert.deepEqual(result.errors, [], formatErrors(result));
  assert.deepEqual(result.warnings, [], formatErrors(result));
});

test('PNG metadata parser reads dimensions, color type, and alpha', () => {
  const rgba = createPng({ width: 3, height: 2, colorType: 6 });
  const rgb = createPng({ width: 4, height: 1, colorType: 2 });

  assert.deepEqual(selectMetadata(parsePng(rgba)), {
    width: 3,
    height: 2,
    bitDepth: 8,
    colorType: 6,
    colorTypeName: 'RGBA',
    hasAlphaChannel: true,
  });
  assert.deepEqual(selectMetadata(parsePng(rgb)), {
    width: 4,
    height: 1,
    bitDepth: 8,
    colorType: 2,
    colorTypeName: 'RGB',
    hasAlphaChannel: false,
  });
  assert.throws(() => parsePng(Buffer.from('not a png')), /signature/i);
});

test('validates RGBA foregrounds while allowing RGB or RGBA backgrounds', async () => {
  await withTempProject(async ({ root, assets }) => {
    const foreground = createPng({ width: 2, height: 3, colorType: 6 });
    const background = createPng({ width: 8, height: 4, colorType: 2 });
    await writeFile(path.join(assets, 'slime.png'), foreground);
    await writeFile(path.join(assets, 'background.png'), background);
    await writeManifest(assets, {
      schemaVersion: 1,
      assets: [
        {
          id: 'slime-shell',
          path: 'assets/slime.png',
          width: 2,
          height: 3,
          category: 'survivor',
          maxBytes: foreground.length + 10,
        },
        {
          id: 'garden-background',
          path: 'assets/background.png',
          width: 8,
          height: 4,
          category: 'background',
          maxBytes: background.length + 10,
        },
      ],
    });

    const result = await verifyAssets({ cwd: root, allowMissingSpec: false });
    assert.equal(result.ok, true, formatErrors(result));
    assert.equal(result.summary.checkedAssets, 2);
    assert.equal(result.summary.totalBytes, foreground.length + background.length);
    assert.deepEqual(result.assets.map(({ colorType }) => colorType), [6, 2]);
  });
});

test('reports required fields, duplicate ids, dimensions, RGBA, and file size together', async () => {
  await withTempProject(async ({ root, assets }) => {
    const rgbForeground = createPng({ width: 1, height: 1, colorType: 2 });
    await writeFile(path.join(assets, 'rgb-foreground.png'), rgbForeground);
    await writeManifest(assets, {
      assets: [
        {
          id: 'duplicate',
          path: 'assets/rgb-foreground.png',
          width: 2,
          height: 1,
          category: 'building',
          maxBytes: 10,
        },
        {
          id: 'duplicate',
          path: 'assets/missing.png',
          width: 1,
          height: 1,
          category: 'item',
          maxBytes: 1024,
        },
        {
          id: 'missing-fields',
          path: 'assets/rgb-foreground.png',
          width: 1,
        },
      ],
    });

    const result = await verifyAssets({ cwd: root, allowMissingSpec: false });
    assert.equal(result.ok, false);
    const codes = new Set(result.errors.map(({ code }) => code));
    for (const requiredCode of [
      'DUPLICATE_ID',
      'FILE_NOT_FOUND',
      'FILE_TOO_LARGE',
      'WIDTH_MISMATCH',
      'PNG_RGBA_REQUIRED',
      'MISSING_FIELD',
    ]) {
      assert.ok(codes.has(requiredCode), `expected ${requiredCode}; got ${[...codes].join(', ')}`);
    }
  });
});

test('rejects invalid PNG headers and unsafe manifest paths', async () => {
  await withTempProject(async ({ root, assets }) => {
    const corrupt = Buffer.from('this has a png extension but no png header');
    await writeFile(path.join(assets, 'corrupt.png'), corrupt);
    await writeManifest(assets, {
      assets: [
        {
          id: 'corrupt',
          path: 'assets/corrupt.png',
          width: 1,
          height: 1,
          category: 'effect',
          maxBytes: 1024,
        },
        {
          id: 'escape',
          path: '../outside.png',
          width: 1,
          height: 1,
          category: 'effect',
          maxBytes: 1024,
        },
      ],
    });

    const result = await verifyAssets({ cwd: root, allowMissingSpec: false });
    assert.ok(result.errors.some(({ code }) => code === 'INVALID_PNG'));
    assert.ok(result.errors.some(({ code }) => code === 'UNSAFE_PATH'));
  });
});

test('missing asset-spec is skippable by default and an error in strict mode', async () => {
  await withTempProject(async ({ root }) => {
    const skipped = await verifyAssets({ cwd: root, allowMissingSpec: true });
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.warnings[0].code, 'SPEC_NOT_FOUND');

    const strict = await verifyAssets({ cwd: root, allowMissingSpec: false });
    assert.equal(strict.ok, false);
    assert.equal(strict.errors[0].code, 'SPEC_READ_FAILED');
  }, { writeAssetsDirectory: false });
});

test('runtime asset map covers all 105 canonical nested paths and three aliases', () => {
  assert.equal(PROJECT_ASSET_SPEC.assets.length, 105);
  for (const asset of PROJECT_ASSET_SPEC.assets) {
    assert.equal(typeof ASSET_PATHS[asset.id], 'string', `missing runtime asset: ${asset.id}`);
    assert.ok(
      new URL(ASSET_PATHS[asset.id]).pathname.endsWith(`/${asset.path}`),
      `unexpected runtime path for ${asset.id}: ${ASSET_PATHS[asset.id]}`,
    );
  }
  assert.equal(Object.keys(ASSET_PATHS).length, 108);
  assert.equal(ASSET_PATHS['scene-gel-garden'], ASSET_PATHS['background-garden-base']);
  assert.equal(ASSET_PATHS['town-core'], ASSET_PATHS['town-soft-core']);
  assert.equal(ASSET_PATHS['enemy-portal'], ASSET_PATHS['rift-entry-portal']);
});

test('shared resource tokens cover HUD, cargo, and expedition reward ids', () => {
  const resourceIds = [
    'resource-soft-gel-token',
    'resource-dew-honey-token',
    'resource-crystal-shard-token',
  ];
  const assets = PROJECT_ASSET_SPEC.assets.filter(({ id }) => resourceIds.includes(id));
  assert.deepEqual(assets.map(({ id }) => id), resourceIds);
  for (const asset of assets) {
    assert.equal(asset.category, 'resource');
    assert.equal(asset.transparent, true);
    assert.deepEqual(asset.recommendedCanvas, { width: 512, height: 512 });
    assert.equal(Math.max(asset.width, asset.height), 512);
    assert.equal(asset.path, `assets/generated/resource/${asset.filename}`);
    assert.match(asset.runtimeDisplaySize, /HUD.*搬运物/);
    assert.equal(typeof ASSET_PATHS[asset.id], 'string');
  }
});

test('expedition routes, beacon, and all nine boon illustrations have stable contracts', () => {
  const expeditionIds = [
    'expedition-route-combat',
    'expedition-route-resource',
    'expedition-route-event',
    'expedition-route-boss',
    'expedition-beacon',
    'upgrade-soft-body',
    'upgrade-jelly-rush',
    'upgrade-shared-sparkle',
    'upgrade-shell-rebound',
    'upgrade-crystal-fork',
    'upgrade-bubble-chain',
    'upgrade-sprout-canopy',
    'upgrade-gel-burst',
    'upgrade-last-bounce',
  ];
  const expeditionAssets = PROJECT_ASSET_SPEC.assets
    .filter(({ id }) => expeditionIds.includes(id));

  assert.deepEqual(expeditionAssets.map(({ id }) => id), expeditionIds);
  assert.equal(new Set(expeditionAssets.map(({ path }) => path)).size, expeditionIds.length);
  for (const asset of expeditionAssets) {
    assert.equal(asset.category, 'expedition');
    assert.equal(asset.transparent, true);
    assert.deepEqual(asset.recommendedCanvas, { width: 512, height: 512 });
    assert.equal(Math.max(asset.width, asset.height), 512);
    assert.ok(asset.width >= 341 && asset.height >= 341);
    assert.equal(asset.filename, `${asset.id}.png`);
    assert.equal(asset.path, `assets/generated/expedition/${asset.filename}`);
    assert.equal(typeof ASSET_PATHS[asset.id], 'string');
    assert.ok(new URL(ASSET_PATHS[asset.id]).pathname.endsWith(`/${asset.path}`));
    assert.match(asset.runtimeDisplaySize, /逻辑像素/);
    assert.match(asset.brief, /文字/);
  }
  assert.ok(PROJECT_ASSET_SPEC.generatedFrom.includes('src/expedition-catalog.js'));
  assert.match(
    expeditionAssets.find(({ id }) => id === 'upgrade-bubble-chain').brief,
    /不能.*双环|绝不能.*双环/,
  );
});

test('bright soft-gel waste terrain variants preserve the seven terrain semantics', () => {
  const sourceIdsByAssetId = {
    'terrain-waste-ground-detail-a': 'ground:decoration:waste-a',
    'terrain-waste-soft-gel-cache-a': 'soft-gel:waste-cache-a',
    'terrain-waste-dew-pod-a': 'dew-honey:waste-pod-a',
    'terrain-waste-crystal-scrap-a': 'crystal-shard:waste-scrap-a',
    'terrain-waste-cable-thicket-a': 'thorn-thicket:waste-cable-thicket-a',
    'terrain-waste-rusted-wreck-a': 'brittle-boulder:waste-rusted-wreck-a',
    'terrain-waste-acid-sludge-a': 'deep-water:waste-acid-sludge-a',
  };
  const wasteAssets = PROJECT_ASSET_SPEC.assets.filter(
    ({ id }) => id in sourceIdsByAssetId,
  );

  assert.deepEqual(wasteAssets.map(({ id }) => id), Object.keys(sourceIdsByAssetId));
  assert.equal(new Set(wasteAssets.map(({ path }) => path)).size, 7);
  for (const asset of wasteAssets) {
    assert.equal(asset.category, 'terrain-waste');
    assert.equal(asset.sourceId, sourceIdsByAssetId[asset.id]);
    assert.equal(asset.transparent, true);
    assert.deepEqual(asset.recommendedCanvas, { width: 512, height: 512 });
    assert.equal(Math.max(asset.width, asset.height), 512);
    assert.ok(asset.width >= 341 && asset.height >= 341);
    assert.equal(asset.filename, `${asset.id}.png`);
    assert.equal(asset.path, `assets/generated/terrain-waste/${asset.filename}`);
    assert.equal(typeof ASSET_PATHS[asset.id], 'string');
    assert.ok(new URL(ASSET_PATHS[asset.id]).pathname.endsWith(`/${asset.path}`));
    assert.match(asset.runtimeDisplaySize, /逻辑像素/);
    for (const direction of [
      '固定白昼',
      '高饱和',
      '光泽',
      '粗深蓝灰描边',
      '三段明暗',
      '低细节',
      '透明底',
      '无文字',
    ]) {
      assert.match(asset.brief, new RegExp(direction), `${asset.id} lacks ${direction}`);
    }
  }
  assert.match(
    wasteAssets.find(({ id }) => id === 'terrain-waste-acid-sludge-a').brief,
    /绝不能画成方块/,
  );
  for (const asset of wasteAssets.filter(({ id }) => id !== 'terrain-waste-acid-sludge-a')) {
    assert.match(asset.brief, /干燥|不漏液|不外溢|没有液体/, `${asset.id} must stay dry`);
  }
  assert.match(
    wasteAssets.find(({ id }) => id === 'terrain-waste-soft-gel-cache-a').brief,
    /一小块.*半固体.*不外溢/,
  );
});

test('organic terrain PNG contracts stay transparent and match the colony sources', () => {
  const terrainIds = [
    'terrain-soft-gel-node-a',
    'terrain-dew-honey-node-a',
    'terrain-crystal-shard-node-a',
    'terrain-thorn-thicket-a',
    'terrain-brittle-boulder-a',
    'terrain-deep-water-patch-a',
    'terrain-ground-detail-a',
  ];
  const terrainAssets = PROJECT_ASSET_SPEC.assets.filter(({ id }) => terrainIds.includes(id));

  assert.deepEqual(terrainAssets.map(({ id }) => id), terrainIds);
  for (const asset of terrainAssets) {
    assert.equal(asset.category, 'terrain');
    assert.equal(asset.transparent, true);
    assert.deepEqual(asset.recommendedCanvas, { width: 512, height: 512 });
    assert.match(asset.runtimeDisplaySize, /逻辑像素/);
    assert.match(asset.view, /对齐地面格中心/);
    assert.match(asset.brief, /方块/);
  }

  assert.ok(PROJECT_ASSET_SPEC.generatedFrom.includes('src/colony-catalog.js'));
  assert.ok(PROJECT_ASSET_SPEC.generatedFrom.includes('src/terrain-renderer.js'));
  const fence = PROJECT_ASSET_SPEC.assets.find(({ id }) => id === 'building-bouncy-fence');
  assert.match(fence.runtimeDisplaySize, /2×1地块/);
  assert.match(fence.brief, /一个完整建筑对象/);
});

test('browser startup waits only for generated first-screen art and streams the rest', async () => {
  const source = await readFile(path.join(PROJECT_ROOT, 'src/main.js'), 'utf8');
  assert.match(source, /import \{[\s\S]*createAssetStore,[\s\S]*\} from '\.\/assets\.js';/);
  assert.match(source, /game\.setAssetStore\(assetStore\)|game\.assetStore = assetStore/);
  assert.match(source, /hostname: window\.location\.hostname/);
  assert.match(source, /const STARTUP_WAIT_MS = 8000/);
  assert.match(source, /game\.setGeneratedCharacterArtEnabled\(useGeneratedCharacterArt\)/);
  assert.match(source, /Promise\.race\(\[criticalAssets, startupBudget\]\)/);
  assert.match(source, /keys: CRITICAL_STARTUP_ASSET_KEYS/);
  const criticalPreloadIndex = source.indexOf('assetStore.preload({');
  const attachRigIndex = source.indexOf('game.setRigAssetStore(store)');
  const preloadRigIndex = source.indexOf('await store.preload()');
  const startIndex = source.indexOf('game.start()');
  const backgroundPreloadIndex = source.lastIndexOf('assetStore.preload()');
  assert.ok(criticalPreloadIndex >= 0 && criticalPreloadIndex < startIndex);
  assert.ok(backgroundPreloadIndex > startIndex);
  assert.ok(attachRigIndex >= 0 && attachRigIndex < preloadRigIndex);
  assert.ok(CRITICAL_STARTUP_ASSET_KEYS.length >= 20);
  CRITICAL_STARTUP_ASSET_KEYS.forEach((key) => {
    assert.equal(typeof ASSET_PATHS[key], 'string', `critical asset ${key}`);
  });
});

test('ordinary preload uses patient defaults, bounded concurrency, and one transient retry', async () => {
  assert.equal(ASSET_LOAD_TIMEOUT_MS, 15000);
  assert.equal(ASSET_PRELOAD_CONCURRENCY, 8);
  assert.equal(ASSET_PRELOAD_RETRIES, 1);

  const paths = Object.fromEntries(
    Array.from({ length: 6 }, (_, index) => [`asset-${index}`, `asset-${index}.png`]),
  );
  const attempts = new Map();
  let active = 0;
  let peakActive = 0;
  const store = createAssetStore(paths, {
    resolvePath: (value) => value,
    imageFactory: (key) => {
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      return trackedImage({
        fails: key === 'asset-2' && attempt === 1,
        onStart: () => {
          active += 1;
          peakActive = Math.max(peakActive, active);
        },
        onFinish: () => { active -= 1; },
      });
    },
  });

  const summary = await store.preload({ timeoutMs: 100, concurrency: 2 });
  assert.deepEqual(
    selectSummary(summary),
    { total: 6, loaded: 6, failed: 0, unsupported: 0 },
  );
  assert.equal(attempts.get('asset-2'), 2);
  assert.equal([...attempts.values()].filter((attempt) => attempt === 2).length, 1);
  assert.ok(peakActive > 1, 'the worker pool should load independent images in parallel');
  assert.ok(peakActive <= 2, `expected at most two active images, observed ${peakActive}`);
});

test('isolated asset store loads in parallel and keeps failures recoverable', async () => {
  const images = new Map();
  const store = createAssetStore(
    { good: 'good.png', missing: 'missing.png' },
    {
      resolvePath: (value) => value,
      imageFactory: (key) => {
        const image = fakeImage({ fails: key === 'missing' });
        images.set(key, image);
        return image;
      },
    },
  );

  const summary = await store.preload({ timeoutMs: 100 });
  assert.deepEqual(
    selectSummary(summary),
    { total: 2, loaded: 1, failed: 1, unsupported: 0 },
  );
  assert.equal(store.get('good'), images.get('good'));
  assert.equal(images.get('good').currentSrc, 'good.png');
  const fallback = { kind: 'vector-fallback' };
  assert.equal(store.get('missing', fallback), fallback);
  assert.equal(store.status('missing').status, 'failed');
});

test('asset renderer safely falls back for failed, unknown, and throwing renderers', async () => {
  const store = createAssetStore(
    { loaded: 'loaded.png', failed: 'failed.png' },
    {
      resolvePath: (value) => value,
      imageFactory: (key) => fakeImage({ fails: key === 'failed' }),
    },
  );
  await store.preload({ timeoutMs: 100 });

  const fallbacks = [];
  assert.equal(store.useOrFallback('failed', () => {}, (status, error) => {
    fallbacks.push({ status: status.status, error });
  }), false);
  assert.equal(store.useOrFallback('unknown', () => {}, (status, error) => {
    fallbacks.push({ status: status.status, error });
  }), false);
  const rendererError = new Error('canvas rejected image');
  assert.equal(store.useOrFallback('loaded', () => {
    throw rendererError;
  }, (status, error) => {
    fallbacks.push({ status: status.status, error });
  }), false);

  assert.deepEqual(fallbacks.map(({ status }) => status), ['failed', 'unknown', 'loaded']);
  assert.equal(fallbacks[0].error, null);
  assert.equal(fallbacks[1].error, null);
  assert.equal(fallbacks[2].error, rendererError);
});

test('asset store reports unsupported runtimes without rejecting preload', async () => {
  const store = createAssetStore(
    { optional: 'optional.png' },
    { resolvePath: (value) => value, imageFactory: () => null },
  );
  const summary = await store.preload({ timeoutMs: 100 });
  assert.deepEqual(
    selectSummary(summary),
    { total: 1, loaded: 0, failed: 0, unsupported: 1 },
  );
  assert.equal(store.get('optional'), null);
  assert.equal(store.status('optional').status, 'unsupported');
});

async function withTempProject(callback, { writeAssetsDirectory = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'slime-asset-qa-'));
  const assets = path.join(root, 'assets');
  try {
    if (writeAssetsDirectory) await mkdir(assets, { recursive: true });
    await callback({ root, assets });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeManifest(assetsDirectory, manifest) {
  await writeFile(
    path.join(assetsDirectory, 'asset-spec.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

function selectMetadata(metadata) {
  const {
    width,
    height,
    bitDepth,
    colorType,
    colorTypeName,
    hasAlphaChannel,
  } = metadata;
  return { width, height, bitDepth, colorType, colorTypeName, hasAlphaChannel };
}

function formatErrors(result) {
  return result.errors.map(({ code, id, message }) => (
    `[${code}]${id ? ` ${id}:` : ''} ${message}`
  )).join('\n');
}

function selectSummary(summary) {
  const { total, loaded, failed, unsupported } = summary;
  return { total, loaded, failed, unsupported };
}

function fakeImage({ fails = false } = {}) {
  let source = '';
  return {
    onload: null,
    onerror: null,
    get currentSrc() {
      return source;
    },
    get src() {
      return source;
    },
    set src(value) {
      source = value;
      queueMicrotask(() => {
        if (fails) this.onerror?.(new Error(`missing ${value}`));
        else this.onload?.();
      });
    },
  };
}

function trackedImage({ fails = false, onStart = () => {}, onFinish = () => {} } = {}) {
  let source = '';
  return {
    onload: null,
    onerror: null,
    get src() {
      return source;
    },
    set src(value) {
      source = value;
      onStart();
      setTimeout(() => {
        onFinish();
        if (fails) this.onerror?.(new Error(`missing ${value}`));
        else this.onload?.();
      }, 2);
    },
  };
}

function createPng({ width, height, colorType }) {
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!channels) throw new Error('Test PNG helper supports RGB and RGBA only.');

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rows = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * channels + 1);
    rows[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = rowOffset + 1 + x * channels;
      rows[pixelOffset] = (50 + x * 17) % 256;
      rows[pixelOffset + 1] = (120 + y * 23) % 256;
      rows[pixelOffset + 2] = 190;
      if (channels === 4) rows[pixelOffset + 3] = (x + y) % 2 ? 180 : 255;
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
