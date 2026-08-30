import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectDeclaredAssetPaths,
  collectRigImagePaths,
} from './build-pages.mjs';
import { validateRigPartManifest } from '../src/animation/rig-assets.js';
import { TOWER_DEFENSE_ASSET_KEYS } from '../src/assets.js';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
export const WECHAT_OUTPUT_DIRECTORY = '_wxgame';
export const PRODUCTION_RIG_OWNER_IDS = Object.freeze([
  'survivor-shell-shell',
  'survivor-crystal-pin',
  'survivor-bubble-float',
  'survivor-moss-sprout',
  'enemy-soft-biter',
  'enemy-windcap',
  'enemy-stone-lump',
  'enemy-acid-shell-king',
]);
const ASSET_VERSION_LENGTH = 12;

const REQUIRED_SOURCE_FILES = Object.freeze([
  'src/game.js',
  'src/tower-defense-core.js',
  'src/tower-defense-game.js',
  'src/platform/runtime.js',
  'src/platform/wechat.js',
  'src/platform/wechat-canvas.js',
  'src/platform/wechat-entry.js',
  'src/animation/rig-assets.js',
  'assets/asset-spec.json',
  'assets/rig-parts.json',
]);

function normalizeRelativePath(value, label = 'path') {
  if (typeof value !== 'string' || !value.length || path.isAbsolute(value)) {
    throw new TypeError(`${label} must be a non-empty project-relative path.`);
  }
  const normalized = value.replaceAll('\\', '/');
  if (normalized.split('/').some((segment) => segment === '..' || segment === '')) {
    throw new RangeError(`${label} must not contain empty or parent segments: ${value}`);
  }
  return normalized;
}

function normalizeAssetBaseUrl(value) {
  if (value == null || value === '') return '';
  const url = new URL(String(value));
  if (url.protocol !== 'https:') {
    throw new RangeError('WECHAT_ASSET_BASE_URL must use HTTPS.');
  }
  return url.href.replace(/\/$/, '');
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, 'utf8'));
}

async function sha256(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex');
}

async function describeAsset(projectRoot, assetPath, metadata) {
  const normalized = normalizeRelativePath(assetPath, 'asset path');
  const absolute = path.resolve(projectRoot, ...normalized.split('/'));
  if (!absolute.startsWith(`${path.resolve(projectRoot)}${path.sep}`)) {
    throw new RangeError(`Asset path escapes the project: ${assetPath}`);
  }
  const info = await stat(absolute);
  if (!info.isFile()) throw new TypeError(`Remote asset source is not a file: ${assetPath}`);
  return {
    ...metadata,
    path: normalized,
    bytes: info.size,
    sha256: await sha256(absolute),
  };
}

export async function collectRemoteAssets(projectRoot, assetSpec, rigManifest) {
  const records = new Map();
  const assetsByPath = new Map((assetSpec?.assets || []).map((asset) => [asset.path, asset]));
  for (const assetPath of collectDeclaredAssetPaths(assetSpec)) {
    const asset = assetsByPath.get(assetPath);
    records.set(assetPath, {
      id: asset.id || null,
      kind: 'ordinary',
      category: asset.category || null,
    });
  }
  for (const assetPath of collectRigImagePaths(rigManifest)) {
    const existing = records.get(assetPath);
    records.set(assetPath, existing || {
      id: null,
      kind: 'rig',
      category: 'rig',
    });
  }

  const described = [];
  for (const [assetPath, metadata] of [...records.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    described.push(await describeAsset(projectRoot, assetPath, metadata));
  }
  return described;
}

async function listFiles(directory, relative = '') {
  const current = path.join(directory, relative);
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(directory, child));
    else if (entry.isFile()) files.push(child.replaceAll(path.sep, '/'));
  }
  return files.sort();
}

async function copyRuntimeSources(projectRoot, stagingRoot) {
  const sourceRoot = path.join(projectRoot, 'src');
  const sourceFiles = (await listFiles(sourceRoot))
    .filter((filename) => filename.endsWith('.js') && filename !== 'main.js');
  for (const filename of sourceFiles) {
    const destination = path.join(stagingRoot, 'src', ...filename.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(sourceRoot, ...filename.split('/')), destination);
  }
  return sourceFiles.map((filename) => `src/${filename}`);
}

function versionedRemoteUrl(assetBaseUrl, asset) {
  if (!assetBaseUrl) return asset.path;
  return `${assetBaseUrl}/${asset.path}?v=${asset.sha256.slice(0, ASSET_VERSION_LENGTH)}`;
}

export function packagedAssetPaths(assets, assetBaseUrl) {
  return Object.fromEntries(assets
    .filter((asset) => asset.kind === 'ordinary' && asset.id)
    .map((asset) => [asset.id, versionedRemoteUrl(assetBaseUrl, asset)]));
}

export function packagedRigImagePaths(assets, assetBaseUrl) {
  return Object.freeze(Object.fromEntries(assets
    .filter((asset) => asset.kind === 'rig')
    .map((asset) => [asset.path, versionedRemoteUrl(assetBaseUrl, asset)])));
}

export function selectStartupAssetPaths(paths, requiredKeys) {
  const selected = {};
  for (const key of [...new Set(requiredKeys || [])]) {
    if (!Object.prototype.hasOwnProperty.call(paths, key)) {
      throw new Error(`WeChat startup asset is missing from asset-spec: ${key}`);
    }
    selected[key] = paths[key];
  }
  return Object.freeze(selected);
}

export function assertRigBuildContract(manifest, requiredOwnerIds) {
  const expected = [...new Set(requiredOwnerIds || [])];
  if (!expected.length) throw new Error('WeChat rig build must declare required owner ids.');
  const actual = Object.keys(manifest?.rigs || {});
  if (
    actual.length !== expected.length
    || expected.some((ownerId) => !actual.includes(ownerId))
  ) {
    throw new Error(
      `WeChat rig manifest owner mismatch: expected ${expected.join(', ')}, got ${actual.join(', ')}.`,
    );
  }
  const paths = collectRigImagePaths(manifest);
  for (const ownerId of expected) {
    const prefix = `assets/generated-v2/rig/${ownerId}/`;
    const ownedPaths = paths.filter((assetPath) => assetPath.startsWith(prefix));
    if (ownedPaths.length !== 2) {
      throw new Error(`WeChat rig ${ownerId} must resolve exactly one atlas and one expression PNG.`);
    }
  }
  if (paths.length !== expected.length * 2) {
    throw new Error(`WeChat rig build expected ${expected.length * 2} unique PNGs, got ${paths.length}.`);
  }
  return Object.freeze(paths);
}

function gameEntrySource({
  assetPaths = {},
  assetRelativePaths = {},
  assetBaseUrl = '',
  rigManifest = null,
  rigOwnerIds = [],
  rigImagePaths = {},
} = {}) {
  return `import { startWechatGame } from './src/platform/wechat-entry.js';

const buildConfig = ${JSON.stringify({
    assetPaths,
    assetRelativePaths,
    assetBaseUrl,
    rigRequired: true,
    rigManifest,
    rigOwnerIds,
    rigImagePaths,
  }, null, 2)};
const runtimeConfig = {
  ...buildConfig,
  ...(globalThis.__SLIME_WECHAT_CONFIG__ || {}),
};

try {
  globalThis.__SLIME_WECHAT_BOOT__ = startWechatGame({
    wxApi: globalThis.wx,
    config: runtimeConfig,
  });
} catch (error) {
  globalThis.__SLIME_WECHAT_BOOT_ERROR__ = error;
  globalThis.wx?.showModal?.({
    title: '启动失败',
    content: error?.message || '微信小游戏无法启动',
    showCancel: false,
  });
  throw error;
}
`;
}

function gameConfiguration() {
  return {
    deviceOrientation: 'portrait',
    showStatusBar: false,
    networkTimeout: {
      request: 15000,
      connectSocket: 15000,
      uploadFile: 15000,
      downloadFile: 30000,
    },
  };
}

function projectConfiguration({ appId, projectName }) {
  return {
    appid: appId || 'touristappid',
    compileType: 'game',
    projectname: projectName || 'slime-haven-wechat',
    minigameRoot: './',
    libVersion: 'latest',
    setting: {
      es6: true,
      enhance: true,
      minified: true,
      postcss: false,
      urlCheck: true,
    },
  };
}

function remoteManifest(assets, assetBaseUrl, copiedSources) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    delivery: {
      mode: 'remote',
      configured: Boolean(assetBaseUrl),
      baseUrl: assetBaseUrl || null,
      mainPackagePngCount: 0,
      downloadDomainMustBeWhitelisted: true,
      cacheRecommendation: 'Download on demand, verify sha256, then cache under wx.env.USER_DATA_PATH.',
      fallbackPolicy: 'Missing ordinary or rig art must block startup until a successful retry.',
      notes: [
        'The main package contains JavaScript and manifests only; canonical PNG files are not copied.',
        'Set WECHAT_ASSET_BASE_URL to an HTTPS CDN origin before a production build.',
        'Do not grant paid goods from a client-only callback; payment results require server verification.',
      ],
    },
    code: {
      entry: 'game.js',
      bootstrap: 'src/platform/wechat-entry.js',
      canvasAdapter: 'src/platform/wechat-canvas.js',
      copiedSources,
      webEntryExcluded: 'src/main.js',
    },
    assets: assets.map((asset) => ({
      ...asset,
      url: assetBaseUrl ? versionedRemoteUrl(assetBaseUrl, asset) : null,
    })),
  };
}

function runtimeConfigExample() {
  return {
    storagePrefix: 'slime-haven:',
    assetBaseUrl: 'https://cdn.example.com/slime-haven',
    assetLoadTimeoutMs: 12000,
    assetLoadConcurrency: 6,
    rigLoadTimeoutMs: 15000,
    rigLoadConcurrency: 3,
    ads: {
      rewardedVideoAdUnitId: '',
      interstitialAdUnitId: '',
    },
    payment: {
      enabled: false,
      offerId: '',
      zoneId: '',
      mode: 'game',
      env: 0,
      currencyType: 'CNY',
    },
  };
}

async function assertRequiredSources(projectRoot) {
  for (const filename of REQUIRED_SOURCE_FILES) {
    const info = await stat(path.join(projectRoot, ...filename.split('/'))).catch(() => null);
    if (!info?.isFile()) throw new Error(`Missing WeChat build input: ${filename}`);
  }
}

function resolveOutput(projectRoot, outputDirectory) {
  const root = path.resolve(projectRoot);
  const output = path.resolve(outputDirectory || path.join(root, WECHAT_OUTPUT_DIRECTORY));
  if (output !== path.join(root, WECHAT_OUTPUT_DIRECTORY)) {
    throw new RangeError(`WeChat output must be ${path.join(root, WECHAT_OUTPUT_DIRECTORY)}.`);
  }
  return output;
}

export async function buildWechatPackage({
  projectRoot = DEFAULT_PROJECT_ROOT,
  outputDirectory,
  assetBaseUrl = process.env.WECHAT_ASSET_BASE_URL || '',
  appId = process.env.WECHAT_APP_ID || '',
  projectName = 'slime-haven-wechat',
  requiredRigOwnerIds = PRODUCTION_RIG_OWNER_IDS,
  startupAssetKeys = TOWER_DEFENSE_ASSET_KEYS,
} = {}) {
  const root = path.resolve(projectRoot);
  const output = resolveOutput(root, outputDirectory);
  const staging = path.join(root, `.wxgame-staging-${process.pid}-${Date.now()}`);
  const normalizedBaseUrl = normalizeAssetBaseUrl(assetBaseUrl);
  if (!normalizedBaseUrl) {
    throw new Error('WECHAT_ASSET_BASE_URL is required for the strict remote-art startup gate.');
  }
  await assertRequiredSources(root);

  const assetSpec = await readJson(path.join(root, 'assets', 'asset-spec.json'));
  const rigManifest = validateRigPartManifest(
    await readJson(path.join(root, 'assets', 'rig-parts.json')),
  );
  const rigOwnerIds = Object.freeze([...new Set(requiredRigOwnerIds)]);
  const rigImagePathList = assertRigBuildContract(rigManifest, rigOwnerIds);
  const assets = await collectRemoteAssets(root, assetSpec, rigManifest);
  const allAssetPaths = packagedAssetPaths(assets, normalizedBaseUrl);
  const allAssetRelativePaths = packagedAssetPaths(assets, '');
  const assetPaths = selectStartupAssetPaths(allAssetPaths, startupAssetKeys);
  const assetRelativePaths = selectStartupAssetPaths(allAssetRelativePaths, startupAssetKeys);
  const rigImagePaths = packagedRigImagePaths(assets, normalizedBaseUrl);
  if (
    Object.keys(rigImagePaths).length !== rigImagePathList.length
    || rigImagePathList.some((assetPath) => !rigImagePaths[assetPath])
  ) {
    throw new Error('WeChat rig remote path map does not cover the complete manifest.');
  }
  const startupUrls = [...Object.values(assetPaths), ...Object.values(rigImagePaths)];
  if (new Set(startupUrls).size !== startupUrls.length) {
    throw new Error('WeChat strict startup gate cannot request duplicate remote image URLs.');
  }

  await rm(staging, { recursive: true, force: true });
  try {
    await mkdir(staging, { recursive: true });
    const copiedSources = await copyRuntimeSources(root, staging);
    await mkdir(path.join(staging, 'assets'), { recursive: true });
    await cp(path.join(root, 'assets', 'asset-spec.json'), path.join(staging, 'assets', 'asset-spec.json'));
    await cp(path.join(root, 'assets', 'rig-parts.json'), path.join(staging, 'assets', 'rig-parts.json'));
    await writeFile(path.join(staging, 'game.js'), gameEntrySource({
      assetPaths: normalizedBaseUrl ? assetPaths : {},
      assetRelativePaths,
      assetBaseUrl: normalizedBaseUrl,
      rigManifest,
      rigOwnerIds,
      rigImagePaths,
    }), 'utf8');
    await writeFile(path.join(staging, 'game.json'), `${JSON.stringify(gameConfiguration(), null, 2)}\n`, 'utf8');
    await writeFile(
      path.join(staging, 'project.config.json'),
      `${JSON.stringify(projectConfiguration({ appId, projectName }), null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      path.join(staging, 'remote-assets.json'),
      `${JSON.stringify(remoteManifest(assets, normalizedBaseUrl, copiedSources), null, 2)}\n`,
      'utf8',
    );
    await writeFile(
      path.join(staging, 'runtime-config.example.json'),
      `${JSON.stringify(runtimeConfigExample(), null, 2)}\n`,
      'utf8',
    );

    const outputFiles = await listFiles(staging);
    const packagedPngs = outputFiles.filter((filename) => filename.toLowerCase().endsWith('.png'));
    if (packagedPngs.length) {
      throw new Error(`WeChat main package must not contain PNG files: ${packagedPngs.join(', ')}`);
    }
    for (const required of [
      'game.js',
      'game.json',
      'project.config.json',
      'remote-assets.json',
      'src/game.js',
      'src/animation/rig-assets.js',
      'src/platform/wechat-canvas.js',
      'src/platform/wechat-entry.js',
    ]) {
      if (!outputFiles.includes(required)) throw new Error(`Incomplete WeChat package: missing ${required}`);
    }
    const generatedEntry = await readFile(path.join(staging, 'game.js'), 'utf8');
    if (!generatedEntry.includes('startWechatGame') || !generatedEntry.includes('__SLIME_WECHAT_BOOT__')) {
      throw new Error('Incomplete WeChat package: game.js does not start the game bootstrap.');
    }

    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
    return {
      output,
      files: outputFiles.length,
      pngs: 0,
      remoteAssets: assets.length,
      ordinaryAssets: Object.keys(allAssetPaths).length,
      startupOrdinaryAssets: Object.keys(assetPaths).length,
      rigAssets: Object.keys(rigImagePaths).length,
      remoteBytes: assets.reduce((total, asset) => total + asset.bytes, 0),
      remoteConfigured: Boolean(normalizedBaseUrl),
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const summary = await buildWechatPackage();
  process.stdout.write(
    `Built ${summary.output}: ${summary.files} files, 0 packaged PNGs, ${summary.remoteAssets} remote assets (${summary.remoteBytes} bytes).\n`,
  );
}
