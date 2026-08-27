import { createWechatRuntime } from './wechat.js';

const WEB_STORAGE_PREFIX = '__slime_runtime_json_v1__:';

function success(status, extra = {}) {
  return { ok: true, status, ...extra };
}

function failure(code, message, extra = {}) {
  return { ok: false, status: 'unavailable', code, message, ...extra };
}

function safeGlobal(name) {
  try {
    return globalThis[name];
  } catch {
    return undefined;
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function createWebStorage(storage, { prefix = '' } = {}) {
  const available = Boolean(
    storage
    && typeof storage.getItem === 'function'
    && typeof storage.setItem === 'function'
    && typeof storage.removeItem === 'function',
  );
  const storageKey = (key) => {
    if (!nonEmptyString(key)) throw new TypeError('Storage keys must be non-empty strings.');
    return `${prefix}${key}`;
  };

  return {
    available,
    get(key, fallback = null) {
      if (!available) return fallback;
      try {
        const stored = storage.getItem(storageKey(key));
        if (stored === null || stored === undefined) return fallback;
        if (!stored.startsWith(WEB_STORAGE_PREFIX)) return stored;
        return JSON.parse(stored.slice(WEB_STORAGE_PREFIX.length));
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      if (!available) return false;
      try {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) return false;
        storage.setItem(storageKey(key), `${WEB_STORAGE_PREFIX}${serialized}`);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      if (!available) return false;
      try {
        storage.removeItem(storageKey(key));
        return true;
      } catch {
        return false;
      }
    },
    has(key) {
      if (!available) return false;
      try {
        return storage.getItem(storageKey(key)) !== null;
      } catch {
        return false;
      }
    },
  };
}

function createWebLifecycle(windowRef, documentRef) {
  const subscriptions = new Set();
  const subscribe = (target, eventName, listener, mapEvent) => {
    if (!target || typeof target.addEventListener !== 'function' || typeof listener !== 'function') {
      return () => {};
    }
    const wrapped = (event) => {
      try {
        listener(mapEvent ? mapEvent(event) : event);
      } catch {
        // Application lifecycle callbacks are isolated from the platform loop.
      }
    };
    target.addEventListener(eventName, wrapped);
    let active = true;
    const unsubscribe = () => {
      if (!active) return;
      active = false;
      subscriptions.delete(unsubscribe);
      target.removeEventListener?.(eventName, wrapped);
    };
    subscriptions.add(unsubscribe);
    return unsubscribe;
  };

  const visibilitySubscription = (listener) => subscribe(
    documentRef,
    'visibilitychange',
    listener,
    () => ({ source: 'visibilitychange', hidden: Boolean(documentRef?.hidden) }),
  );

  return {
    available: Boolean(windowRef?.addEventListener || documentRef?.addEventListener),
    onShow(listener) {
      const disposers = [
        subscribe(windowRef, 'pageshow', listener, (event) => ({ source: 'pageshow', event })),
        visibilitySubscription((event) => {
          if (event.hidden === false) listener(event);
        }),
      ];
      return () => disposers.forEach((dispose) => dispose());
    },
    onHide(listener) {
      const disposers = [
        subscribe(windowRef, 'pagehide', listener, (event) => ({ source: 'pagehide', event })),
        visibilitySubscription((event) => {
          if (event.hidden === true) listener(event);
        }),
      ];
      return () => disposers.forEach((dispose) => dispose());
    },
    onError(listener) {
      return subscribe(windowRef, 'error', listener);
    },
    dispose() {
      [...subscriptions].forEach((unsubscribe) => unsubscribe());
    },
  };
}

function disabledAudioHandle(reason = 'Audio is unavailable.') {
  const unavailable = () => failure('AUDIO_UNAVAILABLE', reason);
  return {
    available: false,
    play: async () => unavailable(),
    pause: unavailable,
    stop: unavailable,
    seek: unavailable,
    setVolume: unavailable,
    destroy() {},
  };
}

function createWebAudio(AudioClass) {
  const handles = new Set();
  const available = typeof AudioClass === 'function';
  return {
    available,
    create(options = {}) {
      if (!available) return disabledAudioHandle('The browser Audio API is unavailable.');
      let element;
      try {
        element = new AudioClass(nonEmptyString(options.src) ? options.src : undefined);
      } catch (error) {
        return disabledAudioHandle(error?.message || 'Could not create a browser audio element.');
      }
      if (!element) return disabledAudioHandle('The browser returned no audio element.');
      element.loop = options.loop === true;
      element.autoplay = options.autoplay === true;
      if (Number.isFinite(options.volume)) element.volume = Math.min(1, Math.max(0, options.volume));
      if (typeof options.onEnded === 'function') element.addEventListener?.('ended', options.onEnded);
      if (typeof options.onError === 'function') element.addEventListener?.('error', options.onError);

      let destroyed = false;
      const ensureActive = () => (
        destroyed ? failure('AUDIO_DESTROYED', 'This audio handle has been destroyed.') : null
      );
      const handle = {
        available: true,
        async play() {
          const inactive = ensureActive();
          if (inactive) return inactive;
          try {
            await Promise.resolve(element.play());
            return success('requested');
          } catch (error) {
            return failure('AUDIO_REQUEST_FAILED', error?.message || 'Browser audio playback failed.');
          }
        },
        pause() {
          const inactive = ensureActive();
          if (inactive) return inactive;
          try {
            element.pause();
            return success('requested');
          } catch (error) {
            return failure('AUDIO_REQUEST_FAILED', error?.message || 'Could not pause browser audio.');
          }
        },
        stop() {
          const inactive = ensureActive();
          if (inactive) return inactive;
          try {
            element.pause();
            element.currentTime = 0;
            return success('requested');
          } catch (error) {
            return failure('AUDIO_REQUEST_FAILED', error?.message || 'Could not stop browser audio.');
          }
        },
        seek(positionSeconds) {
          const inactive = ensureActive();
          if (inactive) return inactive;
          if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
            return failure('AUDIO_INVALID_SEEK', 'Seek position must be a non-negative number.');
          }
          try {
            element.currentTime = positionSeconds;
            return success('updated');
          } catch (error) {
            return failure('AUDIO_REQUEST_FAILED', error?.message || 'Could not seek browser audio.');
          }
        },
        setVolume(volume) {
          const inactive = ensureActive();
          if (inactive) return inactive;
          if (!Number.isFinite(volume)) {
            return failure('AUDIO_INVALID_VOLUME', 'Volume must be a finite number.');
          }
          try {
            element.volume = Math.min(1, Math.max(0, volume));
            return success('updated');
          } catch (error) {
            return failure('AUDIO_REQUEST_FAILED', error?.message || 'Could not update browser audio volume.');
          }
        },
        destroy() {
          if (destroyed) return;
          destroyed = true;
          handles.delete(handle);
          try {
            element.pause?.();
            element.removeEventListener?.('ended', options.onEnded);
            element.removeEventListener?.('error', options.onError);
            element.removeAttribute?.('src');
            element.load?.();
          } catch {
            // Best-effort browser cleanup.
          }
        },
      };
      handles.add(handle);
      return handle;
    },
    dispose() {
      [...handles].forEach((handle) => handle.destroy());
    },
  };
}

function disabledAd(kind, code, message) {
  return {
    kind,
    enabled: false,
    async show() {
      return failure(code, message, kind === 'rewarded' ? { rewarded: false } : {});
    },
    destroy() {},
  };
}

function disabledPayments(code, message) {
  return {
    enabled: false,
    platform: 'web',
    isIOS: false,
    async isSupported() {
      return failure(code, message, { supported: false });
    },
    async purchase() {
      return failure(code, message, {
        transactionStarted: false,
        verified: false,
        entitlementGranted: false,
      });
    },
  };
}

export function createWebRuntime({
  storage = safeGlobal('localStorage'),
  windowRef = safeGlobal('window'),
  documentRef = safeGlobal('document'),
  AudioClass = safeGlobal('Audio'),
  config = {},
} = {}) {
  const storageAdapter = createWebStorage(storage, { prefix: config.storagePrefix || '' });
  const lifecycle = createWebLifecycle(windowRef, documentRef);
  const audio = createWebAudio(AudioClass);
  const rewarded = disabledAd('rewarded', 'REWARDED_AD_DISABLED', 'No web rewarded-ad provider is configured.');
  const interstitial = disabledAd('interstitial', 'INTERSTITIAL_AD_DISABLED', 'No web interstitial-ad provider is configured.');
  const payments = disabledPayments('PAYMENT_DISABLED', 'No web payment provider is configured.');

  return {
    kind: 'web',
    available: true,
    storage: storageAdapter,
    lifecycle,
    audio,
    ads: { rewarded, interstitial },
    payments,
    capabilities: Object.freeze({
      storage: storageAdapter.available,
      lifecycle: lifecycle.available,
      audio: audio.available,
      rewardedAds: false,
      interstitialAds: false,
      payments: false,
    }),
    dispose() {
      audio.dispose();
      lifecycle.dispose();
    },
  };
}

function looksLikeWechat(wxApi) {
  return Boolean(
    wxApi
    && typeof wxApi === 'object'
    && (
      typeof wxApi.getSystemInfoSync === 'function'
      || typeof wxApi.getDeviceInfo === 'function'
      || typeof wxApi.onShow === 'function'
      || typeof wxApi.getStorageSync === 'function'
    ),
  );
}

/** Creates one stable interface for browser and WeChat Mini Game runtimes. */
export function createPlatformRuntime({
  platform = 'auto',
  wxApi = safeGlobal('wx'),
  config = {},
  ...webOptions
} = {}) {
  if (!['auto', 'web', 'wechat'].includes(platform)) {
    throw new RangeError(`Unknown platform ${platform}.`);
  }
  if (platform === 'wechat' || (platform === 'auto' && looksLikeWechat(wxApi))) {
    return createWechatRuntime({ wxApi, config });
  }
  return createWebRuntime({ ...webOptions, config });
}

export const createRuntime = createPlatformRuntime;
