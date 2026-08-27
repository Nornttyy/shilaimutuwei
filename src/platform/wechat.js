const DEFAULT_AD_TIMEOUT_MS = 120000;
const DEFAULT_PAYMENT_TIMEOUT_MS = 20000;

function success(status, extra = {}) {
  return { ok: true, status, ...extra };
}

function failure(code, message, extra = {}) {
  return { ok: false, status: 'unavailable', code, message, ...extra };
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function safeCall(callback, ...args) {
  try {
    callback?.(...args);
  } catch {
    // Platform callbacks must not break the game loop.
  }
}

function normalizedTimeout(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function prefixedKey(prefix, key) {
  if (!nonEmptyString(key)) throw new TypeError('Storage keys must be non-empty strings.');
  return `${prefix}${key}`;
}

function createWechatStorage(wxApi, { prefix = '' } = {}) {
  const available = Boolean(
    wxApi
    && typeof wxApi.getStorageSync === 'function'
    && typeof wxApi.setStorageSync === 'function'
    && typeof wxApi.removeStorageSync === 'function',
  );

  return {
    available,
    get(key, fallback = null) {
      if (!available) return fallback;
      try {
        const target = prefixedKey(prefix, key);
        const value = wxApi.getStorageSync(target);
        if (value === '' && typeof wxApi.getStorageInfoSync === 'function') {
          const keys = wxApi.getStorageInfoSync()?.keys;
          if (Array.isArray(keys) && !keys.includes(target)) return fallback;
        }
        return value === undefined || value === null ? fallback : value;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      if (!available) return false;
      try {
        wxApi.setStorageSync(prefixedKey(prefix, key), value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      if (!available) return false;
      try {
        wxApi.removeStorageSync(prefixedKey(prefix, key));
        return true;
      } catch {
        return false;
      }
    },
    has(key) {
      if (!available || typeof wxApi.getStorageInfoSync !== 'function') return false;
      try {
        const target = prefixedKey(prefix, key);
        const keys = wxApi.getStorageInfoSync()?.keys;
        return Array.isArray(keys) && keys.includes(target);
      } catch {
        return false;
      }
    },
  };
}

function createWechatLifecycle(wxApi) {
  const subscriptions = new Set();

  const subscribe = (onName, offName, listener) => {
    if (typeof listener !== 'function' || typeof wxApi?.[onName] !== 'function') return () => {};
    const wrapped = (...args) => safeCall(listener, ...args);
    try {
      wxApi[onName](wrapped);
    } catch {
      return () => {};
    }
    let active = true;
    const unsubscribe = () => {
      if (!active) return;
      active = false;
      subscriptions.delete(unsubscribe);
      try {
        wxApi?.[offName]?.(wrapped);
      } catch {
        // Older runtimes can register lifecycle callbacks without exposing off*.
      }
    };
    subscriptions.add(unsubscribe);
    return unsubscribe;
  };

  return {
    available: Boolean(typeof wxApi?.onShow === 'function' && typeof wxApi?.onHide === 'function'),
    onShow: (listener) => subscribe('onShow', 'offShow', listener),
    onHide: (listener) => subscribe('onHide', 'offHide', listener),
    onError: (listener) => subscribe('onError', 'offError', listener),
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

function createWechatAudio(wxApi) {
  const handles = new Set();
  const available = typeof wxApi?.createInnerAudioContext === 'function';

  return {
    available,
    create(options = {}) {
      if (!available) return disabledAudioHandle('wx.createInnerAudioContext is unavailable.');
      let context;
      try {
        context = wxApi.createInnerAudioContext();
      } catch (error) {
        return disabledAudioHandle(error?.message || 'Could not create a WeChat audio context.');
      }
      if (!context) return disabledAudioHandle('WeChat returned no audio context.');

      if (nonEmptyString(options.src)) context.src = options.src;
      context.loop = options.loop === true;
      context.autoplay = options.autoplay === true;
      if (Number.isFinite(options.volume)) context.volume = Math.min(1, Math.max(0, options.volume));
      if (typeof options.onEnded === 'function') context.onEnded?.(options.onEnded);
      if (typeof options.onError === 'function') context.onError?.(options.onError);

      let destroyed = false;
      const ensureActive = () => (
        destroyed ? failure('AUDIO_DESTROYED', 'This audio handle has been destroyed.') : null
      );
      const invoke = (method, ...args) => {
        const inactive = ensureActive();
        if (inactive) return inactive;
        if (typeof context[method] !== 'function') {
          return failure('AUDIO_METHOD_UNAVAILABLE', `Audio method ${method} is unavailable.`);
        }
        try {
          context[method](...args);
          return success('requested');
        } catch (error) {
          return failure('AUDIO_REQUEST_FAILED', error?.message || `Audio method ${method} failed.`);
        }
      };

      const handle = {
        available: true,
        async play() {
          return invoke('play');
        },
        pause: () => invoke('pause'),
        stop: () => invoke('stop'),
        seek(positionSeconds) {
          if (!Number.isFinite(positionSeconds) || positionSeconds < 0) {
            return failure('AUDIO_INVALID_SEEK', 'Seek position must be a non-negative number.');
          }
          return invoke('seek', positionSeconds);
        },
        setVolume(volume) {
          const inactive = ensureActive();
          if (inactive) return inactive;
          if (!Number.isFinite(volume)) {
            return failure('AUDIO_INVALID_VOLUME', 'Volume must be a finite number.');
          }
          try {
            context.volume = Math.min(1, Math.max(0, volume));
            return success('updated');
          } catch (error) {
            return failure('AUDIO_REQUEST_FAILED', error?.message || 'Could not update volume.');
          }
        },
        destroy() {
          if (destroyed) return;
          destroyed = true;
          handles.delete(handle);
          try {
            context.offEnded?.(options.onEnded);
            context.offError?.(options.onError);
            context.destroy?.();
          } catch {
            // Destruction is best-effort during lifecycle teardown.
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

async function showAdWithLoadFallback(ad) {
  try {
    await Promise.resolve(ad.show());
  } catch (firstError) {
    if (typeof ad.load !== 'function') throw firstError;
    await Promise.resolve(ad.load());
    await Promise.resolve(ad.show());
  }
}

function createRewardedAd(wxApi, adUnitId, timeoutMs) {
  if (!nonEmptyString(adUnitId)) {
    return disabledAd('rewarded', 'REWARDED_AD_DISABLED', 'No rewarded-video ad unit is configured.');
  }
  if (typeof wxApi?.createRewardedVideoAd !== 'function') {
    return disabledAd('rewarded', 'REWARDED_AD_UNAVAILABLE', 'Rewarded-video ads are unavailable.');
  }

  let ad;
  try {
    ad = wxApi.createRewardedVideoAd({ adUnitId: adUnitId.trim() });
  } catch (error) {
    return disabledAd('rewarded', 'REWARDED_AD_CREATE_FAILED', error?.message || 'Could not create rewarded-video ad.');
  }
  if (!ad || typeof ad.show !== 'function') {
    return disabledAd('rewarded', 'REWARDED_AD_CREATE_FAILED', 'WeChat returned no rewarded-video ad instance.');
  }

  let pending = null;
  let destroyed = false;
  const settle = (result) => {
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timeoutId);
    current.resolve(result);
  };
  const onClose = (closeResult) => {
    if (closeResult?.isEnded === true) {
      settle(success('completed', { rewarded: true, platformResult: closeResult }));
      return;
    }
    const verifiedIncomplete = closeResult?.isEnded === false;
    settle(failure(
      verifiedIncomplete ? 'REWARDED_AD_NOT_COMPLETED' : 'REWARDED_AD_COMPLETION_UNVERIFIED',
      verifiedIncomplete
        ? 'The rewarded video was closed before completion.'
        : 'The platform did not verify that the rewarded video completed.',
      { rewarded: false, status: verifiedIncomplete ? 'closed-early' : 'completion-unverified', platformResult: closeResult },
    ));
  };
  const onError = (error) => settle(failure(
    'REWARDED_AD_ERROR',
    error?.errMsg || error?.message || 'The rewarded-video ad failed.',
    { rewarded: false, platformError: error },
  ));
  ad.onClose?.(onClose);
  ad.onError?.(onError);

  return {
    kind: 'rewarded',
    enabled: true,
    show() {
      if (destroyed) {
        return Promise.resolve(failure('REWARDED_AD_DESTROYED', 'The rewarded-video ad has been destroyed.', { rewarded: false }));
      }
      if (pending) {
        return Promise.resolve(failure('REWARDED_AD_BUSY', 'A rewarded-video ad is already active.', { rewarded: false }));
      }
      const resultPromise = new Promise((resolve) => {
        pending = {
          resolve,
          timeoutId: setTimeout(() => settle(failure(
            'REWARDED_AD_TIMEOUT',
            'The rewarded-video ad did not report completion in time.',
            { rewarded: false },
          )), timeoutMs),
        };
      });
      void showAdWithLoadFallback(ad).catch((error) => settle(failure(
        'REWARDED_AD_SHOW_FAILED',
        error?.errMsg || error?.message || 'Could not show the rewarded-video ad.',
        { rewarded: false, platformError: error },
      )));
      return resultPromise;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      settle(failure('REWARDED_AD_DESTROYED', 'The rewarded-video ad was destroyed.', { rewarded: false }));
      try {
        ad.offClose?.(onClose);
        ad.offError?.(onError);
        ad.destroy?.();
      } catch {
        // Best-effort platform cleanup.
      }
    },
  };
}

function createInterstitialAd(wxApi, adUnitId) {
  if (!nonEmptyString(adUnitId)) {
    return disabledAd('interstitial', 'INTERSTITIAL_AD_DISABLED', 'No interstitial ad unit is configured.');
  }
  if (typeof wxApi?.createInterstitialAd !== 'function') {
    return disabledAd('interstitial', 'INTERSTITIAL_AD_UNAVAILABLE', 'Interstitial ads are unavailable.');
  }

  let ad;
  try {
    ad = wxApi.createInterstitialAd({ adUnitId: adUnitId.trim() });
  } catch (error) {
    return disabledAd('interstitial', 'INTERSTITIAL_AD_CREATE_FAILED', error?.message || 'Could not create interstitial ad.');
  }
  if (!ad || typeof ad.show !== 'function') {
    return disabledAd('interstitial', 'INTERSTITIAL_AD_CREATE_FAILED', 'WeChat returned no interstitial ad instance.');
  }

  let busy = false;
  let destroyed = false;
  return {
    kind: 'interstitial',
    enabled: true,
    async show() {
      if (destroyed) return failure('INTERSTITIAL_AD_DESTROYED', 'The interstitial ad has been destroyed.');
      if (busy) return failure('INTERSTITIAL_AD_BUSY', 'An interstitial ad is already being shown.');
      busy = true;
      try {
        await showAdWithLoadFallback(ad);
        return success('shown');
      } catch (error) {
        return failure(
          'INTERSTITIAL_AD_SHOW_FAILED',
          error?.errMsg || error?.message || 'Could not show the interstitial ad.',
          { platformError: error },
        );
      } finally {
        busy = false;
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try {
        ad.destroy?.();
      } catch {
        // Best-effort platform cleanup.
      }
    },
  };
}

function devicePlatform(wxApi) {
  try {
    const device = typeof wxApi?.getDeviceInfo === 'function'
      ? wxApi.getDeviceInfo()
      : wxApi?.getSystemInfoSync?.();
    return String(device?.platform || device?.system || '').toLowerCase();
  } catch {
    return '';
  }
}

function normalizePaymentConfig(config = {}) {
  const source = config.payment && typeof config.payment === 'object' ? config.payment : {};
  const enabled = source.enabled === true;
  const offerId = nonEmptyString(source.offerId) ? source.offerId.trim() : '';
  const zoneId = nonEmptyString(source.zoneId) ? source.zoneId.trim() : '';
  const mode = source.mode ?? 'game';
  const env = source.env ?? 0;
  const currencyType = source.currencyType ?? 'CNY';
  const platform = nonEmptyString(source.platform) ? source.platform.trim() : '';
  const configurationError = mode !== 'game'
    ? 'Payment mode must be "game".'
    : env !== 0 && env !== 1
      ? 'Payment env must be 0 (production) or 1 (sandbox).'
      : currencyType !== 'CNY'
        ? 'Payment currencyType must be "CNY".'
        : platform && platform !== 'android'
          ? 'Payment platform, when provided, must be "android".'
          : '';
  return {
    enabled: enabled && Boolean(offerId && zoneId) && !configurationError,
    explicitlyEnabled: enabled,
    offerId,
    zoneId,
    mode,
    env,
    currencyType,
    platform,
    configurationError,
    timeoutMs: normalizedTimeout(source.timeoutMs, DEFAULT_PAYMENT_TIMEOUT_MS),
  };
}

function explicitMidasSupport(response) {
  const data = response?.data;
  return Boolean(data && data.err_code === 0 && data.allow_pay === true);
}

function createPayments(wxApi, config) {
  const payment = normalizePaymentConfig(config);
  const platform = devicePlatform(wxApi);
  const isIOS = platform.includes('ios') || platform.includes('iphone') || platform.includes('ipad');
  const supportsWithoutCheck = ['android', 'windows', 'ohos', 'harmony']
    .some((name) => platform.includes(name));
  const requestAvailable = typeof wxApi?.requestMidasPayment === 'function';
  const iosCheckAvailable = typeof wxApi?.checkIsSupportMidasPayment === 'function';

  const disabledReason = !payment.explicitlyEnabled
    ? 'Payment is disabled until payment.enabled is explicitly true.'
    : !payment.offerId || !payment.zoneId
      ? 'Payment requires non-empty offerId and zoneId configuration.'
      : payment.configurationError
        ? payment.configurationError
      : !requestAvailable
        ? 'wx.requestMidasPayment is unavailable.'
        : isIOS && !iosCheckAvailable
          ? 'iOS payment requires wx.checkIsSupportMidasPayment.'
          : isIOS && payment.env !== 0
            ? 'iOS payment requires the production Midas environment (env: 0).'
            : !isIOS && !supportsWithoutCheck
              ? 'Payment is disabled because the device platform is not a verified Midas platform.'
              : '';

  const checkIOSSupport = () => new Promise((resolve) => {
    if (typeof wxApi?.checkIsSupportMidasPayment !== 'function') {
      resolve(failure(
        'MIDAS_IOS_CHECK_UNAVAILABLE',
        'iOS payment cannot start without wx.checkIsSupportMidasPayment.',
        { supported: false },
      ));
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };
    const timeoutId = setTimeout(() => finish(failure(
      'MIDAS_SUPPORT_CHECK_TIMEOUT',
      'Midas support detection timed out.',
      { supported: false },
    )), payment.timeoutMs);
    try {
      wxApi.checkIsSupportMidasPayment({
        success(response) {
          const supported = explicitMidasSupport(response);
          finish(supported
            ? success('supported', { supported: true, platformResult: response })
            : failure('MIDAS_NOT_SUPPORTED', 'Midas payment is not supported on this iOS device.', {
              supported: false,
              platformResult: response,
            }));
        },
        fail(error) {
          finish(failure(
            'MIDAS_SUPPORT_CHECK_FAILED',
            error?.errMsg || error?.message || 'Could not verify Midas payment support.',
            { supported: false, platformError: error },
          ));
        },
      });
    } catch (error) {
      finish(failure('MIDAS_SUPPORT_CHECK_FAILED', error?.message || 'Could not verify Midas payment support.', {
        supported: false,
        platformError: error,
      }));
    }
  });

  const isSupported = async () => {
    if (
      !payment.enabled
      || !requestAvailable
      || (isIOS && (!iosCheckAvailable || payment.env !== 0))
      || (!isIOS && !supportsWithoutCheck)
    ) {
      return failure('PAYMENT_DISABLED', disabledReason || 'Payment is not configured.', { supported: false });
    }
    if (isIOS) return checkIOSSupport();
    return success('supported', { supported: true, platform });
  };

  return {
    enabled: payment.enabled
      && requestAvailable
      && (supportsWithoutCheck || (isIOS && iosCheckAvailable && payment.env === 0)),
    platform,
    isIOS,
    isSupported,
    async purchase(options = {}) {
      const support = await isSupported();
      if (!support.ok || support.supported !== true) {
        return { ...support, transactionStarted: false, verified: false, entitlementGranted: false };
      }
      const buyQuantity = Number(options.buyQuantity ?? options.quantity);
      if (!Number.isInteger(buyQuantity) || buyQuantity <= 0) {
        return failure('PAYMENT_INVALID_QUANTITY', 'buyQuantity must be a positive integer.', {
          transactionStarted: false,
          verified: false,
          entitlementGranted: false,
        });
      }
      const outTradeNo = options.outTradeNo;
      if (
        !nonEmptyString(outTradeNo)
        || !/^[A-Za-z0-9|*-][A-Za-z0-9_|*-]{0,31}$/.test(outTradeNo.trim())
      ) {
        return failure(
          'PAYMENT_INVALID_ORDER_ID',
          'A server-issued outTradeNo is required, must be at most 32 allowed characters, and cannot start with an underscore.',
          { transactionStarted: false, verified: false, entitlementGranted: false },
        );
      }

      return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve(result);
        };
        const timeoutId = setTimeout(() => finish(failure(
          'PAYMENT_TIMEOUT',
          'The Midas payment request timed out.',
          { transactionStarted: true, verified: false, entitlementGranted: false },
        )), payment.timeoutMs);
        try {
          const request = {
            mode: payment.mode,
            env: payment.env,
            offerId: payment.offerId,
            currencyType: payment.currencyType,
            buyQuantity,
            zoneId: payment.zoneId,
            success(response) {
              finish(success('platform-accepted', {
                code: 'PAYMENT_PLATFORM_ACCEPTED',
                transactionStarted: true,
                verified: false,
                entitlementGranted: false,
                requiresServerVerification: true,
                platformResult: response,
              }));
            },
            fail(error) {
              finish(failure(
                'PAYMENT_FAILED',
                error?.errMsg || error?.message || 'The Midas payment request failed.',
                {
                  transactionStarted: true,
                  verified: false,
                  entitlementGranted: false,
                  platformError: error,
                },
              ));
            },
          };
          if (payment.platform) request.platform = payment.platform;
          request.outTradeNo = outTradeNo.trim();
          wxApi.requestMidasPayment(request);
        } catch (error) {
          finish(failure('PAYMENT_FAILED', error?.message || 'The Midas payment request failed.', {
            transactionStarted: false,
            verified: false,
            entitlementGranted: false,
            platformError: error,
          }));
        }
      });
    },
  };
}

function adConfig(config = {}) {
  const ads = config.ads && typeof config.ads === 'object' ? config.ads : {};
  return {
    rewardedVideoAdUnitId: ads.rewardedVideoAdUnitId ?? config.rewardedVideoAdUnitId,
    interstitialAdUnitId: ads.interstitialAdUnitId ?? config.interstitialAdUnitId,
    timeoutMs: normalizedTimeout(ads.timeoutMs, DEFAULT_AD_TIMEOUT_MS),
  };
}

/**
 * Creates a defensive adapter around the WeChat Mini Game global API.
 * Ads require an ad-unit id. Payments additionally require payment.enabled,
 * offerId, and zoneId; a client callback never grants an entitlement.
 */
export function createWechatRuntime({ wxApi = globalThis.wx, config = {} } = {}) {
  const adsConfig = adConfig(config);
  const storage = createWechatStorage(wxApi, { prefix: config.storagePrefix || '' });
  const lifecycle = createWechatLifecycle(wxApi);
  const audio = createWechatAudio(wxApi);
  const rewarded = createRewardedAd(wxApi, adsConfig.rewardedVideoAdUnitId, adsConfig.timeoutMs);
  const interstitial = createInterstitialAd(wxApi, adsConfig.interstitialAdUnitId);
  const payments = createPayments(wxApi, config);

  return {
    kind: 'wechat',
    available: Boolean(wxApi && typeof wxApi === 'object'),
    storage,
    lifecycle,
    audio,
    ads: { rewarded, interstitial },
    payments,
    capabilities: Object.freeze({
      storage: storage.available,
      lifecycle: lifecycle.available,
      audio: audio.available,
      rewardedAds: rewarded.enabled,
      interstitialAds: interstitial.enabled,
      payments: payments.enabled,
    }),
    dispose() {
      rewarded.destroy();
      interstitial.destroy();
      audio.dispose();
      lifecycle.dispose();
    },
  };
}
