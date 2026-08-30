import { TowerDefenseGame } from './tower-defense-game.js';
import {
  ALL_RUNTIME_ASSET_KEYS,
  ASSET_CACHE_VERSION,
  TOWER_DEFENSE_ASSET_KEYS,
  createAssetStore,
} from './assets.js';
import { createRigAssetStoreFromUrl } from './animation/rig-assets.js';
import { shouldUseGeneratedRigs } from './animation/rig-mode.js';
import { ENEMIES, SURVIVORS } from './catalog.js';

const clampProgress = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export const MIN_STARTUP_LOADING_MS = 3000;

const waitFor = (milliseconds) => new Promise((resolve) => {
  globalThis.setTimeout(resolve, Math.max(0, Number(milliseconds) || 0));
});

const versionedBrowserUrl = (relativePath) => {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set('v', ASSET_CACHE_VERSION);
  return url.href;
};

export const REQUIRED_RIG_OWNER_IDS = Object.freeze([
  ...SURVIVORS.map(({ id }) => id),
  ...ENEMIES.map(({ id }) => id),
]);

export function criticalPreloadSucceeded(summary, assetStore, keys) {
  const uniqueKeys = [...new Set(keys)];
  return Boolean(
    summary
    && summary.total === uniqueKeys.length
    && summary.loaded === uniqueKeys.length
    && summary.failed === 0
    && summary.unsupported === 0
    && uniqueKeys.every((key) => assetStore.status(key).status === 'loaded')
  );
}

export function rigPreloadSucceeded(rigStore) {
  const rigIds = Object.keys(rigStore?.manifest?.rigs ?? {});
  return Boolean(
    rigIds.length === REQUIRED_RIG_OWNER_IDS.length
    && typeof rigStore?.status === 'function'
    && REQUIRED_RIG_OWNER_IDS.every((id) => (
      rigIds.includes(id) && rigStore.status(id)?.ready === true
    ))
  );
}

export function createDomLoadingView({ root, canvas }) {
  const title = root?.querySelector?.('[data-loading-title]');
  const status = root?.querySelector?.('[data-loading-status]');
  const progress = root?.querySelector?.('[data-loading-progress]');
  const progressFill = root?.querySelector?.('[data-loading-progress-fill]');
  const retry = root?.querySelector?.('[data-loading-retry]');

  const setProgress = ({ completed = 0, total = 0 } = {}) => {
    const safeTotal = Math.max(0, Math.floor(Number(total) || 0));
    const safeCompleted = Math.max(0, Math.min(safeTotal, Math.floor(Number(completed) || 0)));
    const ratio = safeTotal > 0 ? clampProgress(safeCompleted / safeTotal) : 0;
    progress?.setAttribute?.('aria-valuemin', '0');
    progress?.setAttribute?.('aria-valuemax', String(safeTotal));
    progress?.setAttribute?.('aria-valuenow', String(safeCompleted));
    if (progressFill?.style) progressFill.style.width = `${Math.round(ratio * 100)}%`;
    if (status) status.textContent = `正在装载正式素材 ${safeCompleted}/${safeTotal}`;
  };

  return Object.freeze({
    onRetry(handler) {
      retry?.addEventListener?.('click', handler);
    },
    showLoading(total) {
      root?.classList?.remove('hidden', 'is-ready', 'is-error');
      root?.classList?.add('is-loading');
      root?.setAttribute?.('aria-busy', 'true');
      canvas?.classList?.remove('is-ready');
      if (title) title.textContent = '正在唤醒史莱姆基地';
      if (retry) {
        retry.hidden = true;
        retry.disabled = true;
      }
      setProgress({ completed: 0, total });
    },
    setProgress,
    showFailure({ failed = 0, unsupported = 0, firstFailedKey = '' } = {}) {
      const missing = Math.max(1, failed + unsupported);
      root?.classList?.remove('is-loading', 'is-ready');
      root?.classList?.add('is-error');
      root?.setAttribute?.('aria-busy', 'false');
      if (title) title.textContent = '正式素材没有加载完整';
      if (status) {
        status.textContent = firstFailedKey
          ? `${missing} 项素材失败（${firstFailedKey}），请检查网络后重试`
          : `${missing} 项素材失败，请检查网络后重试`;
      }
      if (retry) {
        retry.hidden = false;
        retry.disabled = false;
        retry.focus?.({ preventScroll: true });
      }
    },
    showReady(total) {
      root?.classList?.remove('is-loading', 'is-error');
      root?.classList?.add('is-ready');
      root?.setAttribute?.('aria-busy', 'false');
      setProgress({ completed: total, total });
      if (title) title.textContent = '基地准备完毕';
      if (status) status.textContent = '史莱姆们已经就位';
      if (retry) retry.hidden = true;
    },
    hide() {
      canvas?.classList?.add('is-ready');
      root?.classList?.add('hidden');
    },
  });
}

export function bindBrowserGameLifecycle(game, {
  windowRef = globalThis.window,
  documentRef = globalThis.document,
  requestFrame = (callback) => (
    windowRef?.requestAnimationFrame?.(callback) ?? globalThis.setTimeout(callback, 0)
  ),
} = {}) {
  let resizeQueued = false;
  const save = () => game?.save?.();
  const resize = () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestFrame(() => {
      resizeQueued = false;
      game?.resize?.();
    });
  };
  const visibility = () => {
    if (documentRef?.hidden) game?.onBackground?.();
    else {
      game?.resize?.();
      game?.onForeground?.();
    }
  };

  windowRef?.addEventListener?.('beforeunload', save);
  windowRef?.addEventListener?.('pagehide', save);
  windowRef?.addEventListener?.('resize', resize);
  windowRef?.addEventListener?.('orientationchange', resize);
  documentRef?.addEventListener?.('visibilitychange', visibility);

  return () => {
    windowRef?.removeEventListener?.('beforeunload', save);
    windowRef?.removeEventListener?.('pagehide', save);
    windowRef?.removeEventListener?.('resize', resize);
    windowRef?.removeEventListener?.('orientationchange', resize);
    documentRef?.removeEventListener?.('visibilitychange', visibility);
  };
}

export function createBrowserStartup({
  canvas,
  loadingView,
  assetStore = createAssetStore(),
  criticalKeys = ALL_RUNTIME_ASSET_KEYS,
  createGame = (target, options) => new TowerDefenseGame(target, options),
  useGeneratedCharacterArt = false,
  prepareRigStore = null,
  requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
  minimumLoadingMs = MIN_STARTUP_LOADING_MS,
  now = () => Date.now(),
  wait = waitFor,
  exposeGame = () => {},
  bindLifecycle = () => {},
} = {}) {
  if (!canvas) throw new TypeError('Browser startup requires a game canvas.');
  if (!loadingView) throw new TypeError('Browser startup requires a loading view.');
  const keys = Object.freeze([...new Set(criticalKeys)]);
  let game = null;
  let activeStart = null;

  const runStart = async () => {
    const loadingStartedAt = Number(now()) || 0;
    const requiresRigStore = Boolean(useGeneratedCharacterArt);
    const total = keys.length + (requiresRigStore ? 1 : 0);
    let imageCompleted = 0;
    let rigCompleted = 0;
    const reportProgress = (progress = {}) => {
      imageCompleted = Math.max(imageCompleted, Math.floor(Number(progress.completed) || 0));
      loadingView.setProgress({
        ...progress,
        completed: Math.min(total, imageCompleted + rigCompleted),
        total,
      });
    };
    loadingView.showLoading(total);
    let summary = null;
    const imagePreload = assetStore.preload({
      keys,
      retryFailed: true,
      onProgress: reportProgress,
    })
      .then((result) => {
        summary = result;
        return result;
      })
      .catch(() => null);
    const rigPreload = requiresRigStore
      ? Promise.resolve()
        .then(() => {
          if (typeof prepareRigStore !== 'function') {
            throw new Error('Layered character loader is unavailable.');
          }
          return prepareRigStore();
        })
        .then((store) => {
          if (!rigPreloadSucceeded(store)) {
            throw new Error('Layered character art is incomplete.');
          }
          rigCompleted = 1;
          reportProgress();
          return { store, error: null };
        })
        .catch((error) => ({ store: null, error }))
      : Promise.resolve({ store: null, error: null });

    const [, rigResult] = await Promise.all([imagePreload, rigPreload]);

    if (!criticalPreloadSucceeded(summary, assetStore, keys)) {
      const incompleteRecords = keys
        .map((key) => assetStore.status(key))
        .filter(({ status }) => status !== 'loaded');
      const failedRecord = incompleteRecords[0];
      loadingView.showFailure({
        failed: incompleteRecords.filter(({ status }) => status !== 'unsupported').length,
        unsupported: incompleteRecords.filter(({ status }) => status === 'unsupported').length,
        firstFailedKey: failedRecord?.key || '',
      });
      return null;
    }
    if (requiresRigStore && !rigResult.store) {
      loadingView.showFailure({ failed: 1, firstFailedKey: '角色骨骼图层' });
      return null;
    }

    const elapsedLoadingMs = Math.max(0, (Number(now()) || 0) - loadingStartedAt);
    const remainingLoadingMs = Math.max(
      0,
      Math.floor(Number(minimumLoadingMs) || 0) - elapsedLoadingMs,
    );
    if (remainingLoadingMs > 0) await wait(remainingLoadingMs);

    try {
      const candidate = createGame(canvas, {
        assetStore,
        rigAssetStore: rigResult.store,
      });
      if (typeof candidate.setAssetStore === 'function') candidate.setAssetStore(assetStore);
      else candidate.assetStore = assetStore;
      if (rigResult.store) candidate.setRigAssetStore?.(rigResult.store);
      candidate.setGeneratedCharacterArtEnabled?.(useGeneratedCharacterArt);
      // Prove that the fully loaded art can produce a complete frame while
      // the loading cover is still visible. A renderer failure must not reveal
      // or start a half-initialized game loop.
      candidate.render?.();
      candidate.start();
      game = candidate;
    } catch {
      game = null;
      loadingView.showFailure({ failed: 1, firstFailedKey: '游戏初始化' });
      return null;
    }

    exposeGame(game);
    bindLifecycle(game);
    loadingView.showReady(total);
    requestFrame(() => loadingView.hide());
    return game;
  };

  const start = () => {
    if (game) return Promise.resolve(game);
    if (activeStart) return activeStart;
    activeStart = runStart().finally(() => { activeStart = null; });
    return activeStart;
  };

  loadingView.onRetry(() => start());
  return Object.freeze({
    assetStore,
    start,
    getGame: () => game,
  });
}

function installBrowserEntry() {
  const canvas = document.querySelector('#game');
  const loadingRoot = document.querySelector('#loading');
  if (!canvas || !loadingRoot) return null;
  const assetStore = createAssetStore();
  const useGeneratedCharacterArt = shouldUseGeneratedRigs(
    window.location.search,
    { hostname: window.location.hostname },
  );
  const controller = createBrowserStartup({
    canvas,
    loadingView: createDomLoadingView({ root: loadingRoot, canvas }),
    assetStore,
    criticalKeys: TOWER_DEFENSE_ASSET_KEYS,
    useGeneratedCharacterArt,
    prepareRigStore: async () => {
      const store = await createRigAssetStoreFromUrl({
        url: versionedBrowserUrl('../assets/rig-parts.json'),
        resolvePath: (assetPath) => versionedBrowserUrl(`../${assetPath}`),
      });
      const summary = await store.preload();
      if (summary.total < 1
        || summary.ready !== summary.total
        || summary.fallback > 0
        || summary.unknown > 0) {
        throw new Error('角色骨骼图层没有加载完整。');
      }
      return store;
    },
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    exposeGame: (game) => { window.slimeGame = game; },
    bindLifecycle: (game) => bindBrowserGameLifecycle(game),
  });
  void controller.start();
  return controller;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  installBrowserEntry();
}
