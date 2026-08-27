import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createPlatformRuntime,
  createWebRuntime,
} from '../src/platform/runtime.js';
import { createWechatRuntime } from '../src/platform/wechat.js';
import {
  WECHAT_CRITICAL_ASSET_KEYS,
  startWechatGame,
} from '../src/platform/wechat-entry.js';
import { buildWechatPackage } from '../scripts/build-wechat.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TEST_DIRECTORY, '..');

function createMemoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function createEventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    dispatch(name, event = {}) {
      [...(listeners.get(name) || [])].forEach((listener) => listener(event));
    },
  };
}

function createFakeWechatHost() {
  const callbacks = new Map();
  const frames = new Map();
  const cancelledFrames = [];
  const storage = new Map();
  let frameId = 1;
  let canvasCreations = 0;
  const context = {};
  const nativeCanvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    requestAnimationFrame(callback) {
      const id = frameId;
      frameId += 1;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      cancelledFrames.push(id);
      frames.delete(id);
    },
  };
  const subscribe = (name, listener) => {
    if (!callbacks.has(name)) callbacks.set(name, new Set());
    callbacks.get(name).add(listener);
  };
  const unsubscribe = (name, listener) => callbacks.get(name)?.delete(listener);
  const wxApi = {
    createCanvas() {
      canvasCreations += 1;
      return nativeCanvas;
    },
    getWindowInfo: () => ({ windowWidth: 1280, windowHeight: 720, pixelRatio: 2 }),
    getDeviceInfo: () => ({ platform: 'android' }),
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: (key) => storage.delete(key),
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
  };
  for (const [onName, offName] of [
    ['onShow', 'offShow'],
    ['onHide', 'offHide'],
    ['onError', 'offError'],
    ['onTouchStart', 'offTouchStart'],
    ['onTouchMove', 'offTouchMove'],
    ['onTouchEnd', 'offTouchEnd'],
    ['onTouchCancel', 'offTouchCancel'],
    ['onWindowResize', 'offWindowResize'],
  ]) {
    wxApi[onName] = (listener) => subscribe(onName, listener);
    wxApi[offName] = (listener) => unsubscribe(onName, listener);
  }
  return {
    wxApi,
    nativeCanvas,
    context,
    frames,
    cancelledFrames,
    get canvasCreations() { return canvasCreations; },
    emit(name, event = {}) {
      [...(callbacks.get(name) || [])].forEach((listener) => listener(event));
    },
    fireFrame(timestamp = 16) {
      const next = frames.entries().next().value;
      if (!next) return false;
      const [id, callback] = next;
      frames.delete(id);
      callback(timestamp);
      return true;
    },
  };
}

test('web runtime unifies structured local storage, lifecycle, audio, and disabled commerce', async () => {
  const storage = createMemoryStorage();
  const windowRef = createEventTarget();
  const documentRef = Object.assign(createEventTarget(), { hidden: false });
  const audioInstances = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.currentTime = 0;
      this.volume = 1;
      this.events = new Map();
      audioInstances.push(this);
    }
    play() { this.played = true; return Promise.resolve(); }
    pause() { this.paused = true; }
    addEventListener(name, listener) { this.events.set(name, listener); }
    removeEventListener(name) { this.events.delete(name); }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    load() { this.loaded = true; }
  }

  const runtime = createWebRuntime({
    storage,
    windowRef,
    documentRef,
    AudioClass: FakeAudio,
    config: { storagePrefix: 'game:' },
  });
  assert.equal(runtime.kind, 'web');
  assert.equal(runtime.storage.set('save', { coins: 12, units: ['shell'] }), true);
  assert.deepEqual(runtime.storage.get('save'), { coins: 12, units: ['shell'] });
  assert.equal(runtime.storage.has('save'), true);
  assert.equal(runtime.storage.remove('save'), true);
  assert.equal(runtime.storage.get('save', 'missing'), 'missing');

  const lifecycle = [];
  const stopShow = runtime.lifecycle.onShow((event) => lifecycle.push(`show:${event.source}`));
  const stopHide = runtime.lifecycle.onHide((event) => lifecycle.push(`hide:${event.source}`));
  windowRef.dispatch('pageshow');
  documentRef.hidden = true;
  documentRef.dispatch('visibilitychange');
  assert.deepEqual(lifecycle, ['show:pageshow', 'hide:visibilitychange']);
  stopShow();
  stopHide();

  const audio = runtime.audio.create({ src: 'sound.ogg', loop: true, volume: 2 });
  assert.equal((await audio.play()).ok, true);
  assert.equal(audio.seek(3.5).ok, true);
  assert.equal(audio.setVolume(-1).ok, true);
  assert.equal(audioInstances[0].volume, 0);
  assert.equal(audio.stop().ok, true);
  assert.equal(audioInstances[0].currentTime, 0);

  assert.equal(runtime.ads.rewarded.enabled, false);
  assert.equal((await runtime.ads.rewarded.show()).rewarded, false);
  assert.equal(runtime.ads.interstitial.enabled, false);
  assert.equal(runtime.payments.enabled, false);
  assert.equal((await runtime.payments.purchase({ buyQuantity: 1 })).transactionStarted, false);
  runtime.dispose();
});

test('auto runtime selects WeChat and adapts storage, lifecycle, and inner audio', async () => {
  const values = new Map();
  let showListener = null;
  let hideListener = null;
  const audioCalls = [];
  const audioContext = {
    play: () => audioCalls.push('play'),
    pause: () => audioCalls.push('pause'),
    stop: () => audioCalls.push('stop'),
    seek: (time) => audioCalls.push(['seek', time]),
    destroy: () => audioCalls.push('destroy'),
  };
  const wxApi = {
    getDeviceInfo: () => ({ platform: 'android' }),
    getStorageSync: (key) => values.get(key),
    setStorageSync: (key, value) => values.set(key, value),
    removeStorageSync: (key) => values.delete(key),
    getStorageInfoSync: () => ({ keys: [...values.keys()] }),
    onShow: (listener) => { showListener = listener; },
    offShow: (listener) => { if (listener === showListener) showListener = null; },
    onHide: (listener) => { hideListener = listener; },
    offHide: (listener) => { if (listener === hideListener) hideListener = null; },
    createInnerAudioContext: () => audioContext,
  };

  const runtime = createPlatformRuntime({ wxApi, config: { storagePrefix: 'wx:' } });
  assert.equal(runtime.kind, 'wechat');
  assert.equal(runtime.storage.set('save', { wave: 2 }), true);
  assert.deepEqual(values.get('wx:save'), { wave: 2 });
  assert.deepEqual(runtime.storage.get('save'), { wave: 2 });

  const events = [];
  runtime.lifecycle.onShow((options) => events.push(['show', options.scene]));
  runtime.lifecycle.onHide(() => events.push(['hide']));
  showListener({ scene: 1001 });
  hideListener();
  assert.deepEqual(events, [['show', 1001], ['hide']]);

  const audio = runtime.audio.create({ src: 'wxfile://effect.mp3', volume: 0.5 });
  assert.equal((await audio.play()).status, 'requested');
  audio.seek(2);
  audio.pause();
  audio.stop();
  runtime.dispose();
  assert.deepEqual(audioCalls, ['play', ['seek', 2], 'pause', 'stop', 'destroy']);
  assert.equal(showListener, null);
  assert.equal(hideListener, null);
});

test('WeChat game bootstrap creates a canvas, starts frames, bridges touch, and resumes after show', () => {
  const host = createFakeWechatHost();
  const previousWindow = globalThis.window;
  const pointerEvents = [];
  const frameTimes = [];
  let starts = 0;
  let backgrounds = 0;
  let foregrounds = 0;
  let resizes = 0;

  class FakeGame {
    constructor(canvas) {
      this.canvas = canvas;
      canvas.width = 2560;
      canvas.height = 1440;
      for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
        canvas.addEventListener(name, (event) => pointerEvents.push([
          name,
          event.pointerId,
          event.clientX,
          event.clientY,
        ]));
      }
      this.frame = (timestamp) => {
        frameTimes.push(timestamp);
        requestAnimationFrame(this.frame);
      };
    }
    start() {
      starts += 1;
      requestAnimationFrame(this.frame);
    }
    resize() { resizes += 1; }
    onBackground() { backgrounds += 1; }
    onForeground() { foregrounds += 1; }
  }

  const boot = startWechatGame({ wxApi: host.wxApi, GameClass: FakeGame });
  assert.equal(host.canvasCreations, 1);
  assert.equal(starts, 1);
  assert.equal(boot.canvas.getContext('2d'), host.context);
  assert.deepEqual(boot.canvas.getBoundingClientRect(), {
    x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720,
  });
  assert.equal(host.nativeCanvas.width, 2560);
  assert.equal(host.nativeCanvas.height, 1440);
  assert.equal(host.fireFrame(32), true);
  assert.deepEqual(frameTimes, [32]);

  host.emit('onTouchStart', {
    changedTouches: [{ identifier: 7, clientX: 340, clientY: 220 }],
  });
  host.emit('onTouchMove', {
    changedTouches: [{ identifier: 7, clientX: 360, clientY: 230 }],
  });
  host.emit('onTouchEnd', {
    changedTouches: [{ identifier: 7, clientX: 360, clientY: 230 }],
  });
  assert.deepEqual(pointerEvents, [
    ['pointerdown', 7, 340, 220],
    ['pointermove', 7, 360, 230],
    ['pointerup', 7, 360, 230],
  ]);

  assert.equal(host.frames.size, 1, 'the game frame scheduled its successor');
  host.emit('onHide');
  assert.equal(backgrounds, 1);
  assert.equal(boot.surface.frames.paused, true);
  assert.equal(host.frames.size, 0, 'the pending native frame is cancelled in the background');
  host.emit('onShow', { scene: 1001 });
  assert.equal(boot.surface.frames.paused, false);
  assert.equal(host.frames.size, 1, 'the pending game frame is rescheduled on foreground');
  assert.equal(foregrounds, 1);
  assert.ok(resizes >= 1);
  assert.equal(host.fireFrame(48), true);
  assert.deepEqual(frameTimes, [32, 48]);

  boot.dispose();
  assert.equal(globalThis.window, previousWindow);
  assert.ok(backgrounds >= 2, 'disposing performs one final safe background save');
});

test('WeChat waits for critical generated art before exposing the first game frame', async () => {
  const host = createFakeWechatHost();
  const previousWindow = globalThis.window;
  let starts = 0;
  host.wxApi.createImage = () => {
    const image = { onload: null, onerror: null, width: 512, height: 512 };
    Object.defineProperty(image, 'src', {
      set() { queueMicrotask(() => image.onload?.()); },
    });
    return image;
  };
  class FakeGame {
    constructor(canvas) { this.canvas = canvas; }
    setAssetStore(store) { this.assetStore = store; }
    setGeneratedCharacterArtEnabled(enabled) { this.generated = enabled; }
    start() { starts += 1; }
    onBackground() {}
  }

  const [criticalKey] = WECHAT_CRITICAL_ASSET_KEYS;
  const boot = startWechatGame({
    wxApi: host.wxApi,
    GameClass: FakeGame,
    config: {
      assetPaths: { [criticalKey]: `https://cdn.example.com/${criticalKey}.png` },
      criticalAssetKeys: [criticalKey],
      criticalStartupWaitMs: 1000,
    },
  });
  assert.equal(starts, 0, 'the game must not expose procedural character art while PNGs load');
  await boot.ready;
  assert.equal(starts, 1);
  assert.equal(boot.assetStore.status(criticalKey).status, 'loaded');
  assert.equal(boot.game.generated, true);
  boot.dispose();
  assert.equal(globalThis.window, previousWindow);
});

test('ads are never constructed without unit ids and disabled calls never claim success', async () => {
  let rewardedCreations = 0;
  let interstitialCreations = 0;
  const runtime = createWechatRuntime({
    wxApi: {
      getDeviceInfo: () => ({ platform: 'android' }),
      createRewardedVideoAd: () => { rewardedCreations += 1; return {}; },
      createInterstitialAd: () => { interstitialCreations += 1; return {}; },
    },
  });

  assert.equal(runtime.ads.rewarded.enabled, false);
  assert.equal(runtime.ads.interstitial.enabled, false);
  assert.equal((await runtime.ads.rewarded.show()).ok, false);
  assert.equal((await runtime.ads.rewarded.show()).rewarded, false);
  assert.equal((await runtime.ads.interstitial.show()).ok, false);
  assert.equal(rewardedCreations, 0);
  assert.equal(interstitialCreations, 0);
});

test('rewarded ads require an explicit completed close event before granting reward', async () => {
  let closeListener = null;
  let errorListener = null;
  let shows = 0;
  const ad = {
    onClose: (listener) => { closeListener = listener; },
    offClose: () => {},
    onError: (listener) => { errorListener = listener; },
    offError: () => {},
    show: () => { shows += 1; return Promise.resolve(); },
    destroy: () => {},
  };
  const runtime = createWechatRuntime({
    wxApi: {
      getDeviceInfo: () => ({ platform: 'android' }),
      createRewardedVideoAd: ({ adUnitId }) => {
        assert.equal(adUnitId, 'rewarded-unit');
        return ad;
      },
    },
    config: { ads: { rewardedVideoAdUnitId: 'rewarded-unit', timeoutMs: 1000 } },
  });
  assert.equal(typeof errorListener, 'function');

  const skippedPromise = runtime.ads.rewarded.show();
  closeListener({ isEnded: false });
  const skipped = await skippedPromise;
  assert.equal(skipped.ok, false);
  assert.equal(skipped.rewarded, false);
  assert.equal(skipped.code, 'REWARDED_AD_NOT_COMPLETED');

  const unknownPromise = runtime.ads.rewarded.show();
  closeListener(undefined);
  const unknown = await unknownPromise;
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'REWARDED_AD_COMPLETION_UNVERIFIED');

  const completedPromise = runtime.ads.rewarded.show();
  closeListener({ isEnded: true });
  const completed = await completedPromise;
  assert.equal(completed.ok, true);
  assert.equal(completed.rewarded, true);
  assert.equal(shows, 3);
  runtime.dispose();
});

test('interstitial ads report platform show failures and successes without rewards', async () => {
  let fail = true;
  const ad = {
    show() {
      if (fail) return Promise.reject(new Error('not ready'));
      return Promise.resolve();
    },
    load() {
      fail = false;
      return Promise.resolve();
    },
    destroy() {},
  };
  const runtime = createWechatRuntime({
    wxApi: {
      getDeviceInfo: () => ({ platform: 'android' }),
      createInterstitialAd: () => ad,
    },
    config: { ads: { interstitialAdUnitId: 'interstitial-unit' } },
  });
  const shown = await runtime.ads.interstitial.show();
  assert.equal(shown.ok, true);
  assert.equal(shown.status, 'shown');
  assert.equal('rewarded' in shown, false);
});

test('payment stays disabled without explicit complete configuration', async () => {
  let requests = 0;
  const runtime = createWechatRuntime({
    wxApi: {
      getDeviceInfo: () => ({ platform: 'android' }),
      requestMidasPayment: () => { requests += 1; },
    },
    config: { payment: { offerId: 'offer', zoneId: 'zone' } },
  });
  assert.equal(runtime.payments.enabled, false);
  const result = await runtime.payments.purchase({ buyQuantity: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.transactionStarted, false);
  assert.equal(result.entitlementGranted, false);
  assert.equal(requests, 0);
});

test('payment requires a server order id and never grants goods from the client callback', async () => {
  let paymentOptions = null;
  const runtime = createWechatRuntime({
    wxApi: {
      getDeviceInfo: () => ({ platform: 'android' }),
      requestMidasPayment(options) {
        paymentOptions = options;
        options.success({ errMsg: 'requestMidasPayment:ok' });
      },
    },
    config: { payment: { enabled: true, offerId: 'offer', zoneId: 'zone' } },
  });

  const missingOrder = await runtime.payments.purchase({ buyQuantity: 10 });
  assert.equal(missingOrder.ok, false);
  assert.equal(missingOrder.code, 'PAYMENT_INVALID_ORDER_ID');
  assert.equal(missingOrder.transactionStarted, false);
  assert.equal(paymentOptions, null);

  const result = await runtime.payments.purchase({
    buyQuantity: 10,
    outTradeNo: 'order-20260827-001',
  });
  assert.equal(paymentOptions.outTradeNo, 'order-20260827-001');
  assert.equal('platform' in paymentOptions, false);
  assert.equal(result.ok, true);
  assert.equal(result.verified, false);
  assert.equal(result.entitlementGranted, false);
  assert.equal(result.requiresServerVerification, true);
});

test('iOS payment always checks Midas support and never requests when support is not explicit', async () => {
  const calls = [];
  const runtime = createWechatRuntime({
    wxApi: {
      getDeviceInfo: () => ({ platform: 'ios' }),
      checkIsSupportMidasPayment(options) {
        calls.push('check');
        options.success({ data: { err_code: 0, err_msg: 'ok', allow_pay: false } });
      },
      requestMidasPayment() { calls.push('request'); },
    },
    config: {
      payment: { enabled: true, offerId: 'offer', zoneId: '1', timeoutMs: 1000 },
    },
  });
  const result = await runtime.payments.purchase({ buyQuantity: 6 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MIDAS_NOT_SUPPORTED');
  assert.equal(result.transactionStarted, false);
  assert.deepEqual(calls, ['check']);
});

test('iOS payment rejects an unsuccessful support check even when allow_pay is true', async () => {
  const calls = [];
  const runtime = createWechatRuntime({
    wxApi: {
      getDeviceInfo: () => ({ platform: 'ios' }),
      checkIsSupportMidasPayment(options) {
        calls.push('check');
        options.success({ data: { err_code: 1, err_msg: 'check failed', allow_pay: true } });
      },
      requestMidasPayment() { calls.push('request'); },
    },
    config: {
      payment: { enabled: true, offerId: 'offer', zoneId: '1', timeoutMs: 1000 },
    },
  });
  const result = await runtime.payments.purchase({ buyQuantity: 6 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MIDAS_NOT_SUPPORTED');
  assert.equal(result.transactionStarted, false);
  assert.deepEqual(calls, ['check']);
});

test('iOS supported payment returns platform acceptance but never client-verifies entitlement', async () => {
  const calls = [];
  let paymentOptions = null;
  const runtime = createWechatRuntime({
    wxApi: {
      getDeviceInfo: () => ({ platform: 'ios' }),
      checkIsSupportMidasPayment(options) {
        calls.push('check');
        options.success({ data: { err_code: 0, err_msg: 'ok', allow_pay: true } });
      },
      requestMidasPayment(options) {
        calls.push('request');
        paymentOptions = options;
        options.success({ errMsg: 'requestMidasPayment:ok' });
      },
    },
    config: {
      payment: {
        enabled: true,
        offerId: 'offer-1',
        zoneId: 'zone-1',
        env: 0,
        currencyType: 'CNY',
        timeoutMs: 1000,
      },
    },
  });
  const result = await runtime.payments.purchase({
    buyQuantity: 10,
    outTradeNo: 'ios-order-20260827',
  });
  assert.deepEqual(calls, ['check', 'request']);
  assert.equal(paymentOptions.offerId, 'offer-1');
  assert.equal(paymentOptions.zoneId, 'zone-1');
  assert.equal(paymentOptions.outTradeNo, 'ios-order-20260827');
  assert.equal('platform' in paymentOptions, false);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'platform-accepted');
  assert.equal(result.verified, false);
  assert.equal(result.entitlementGranted, false);
  assert.equal(result.requiresServerVerification, true);
});

test('iOS sandbox payment is disabled before capability checks or requests', async () => {
  const calls = [];
  const runtime = createWechatRuntime({
    wxApi: {
      getDeviceInfo: () => ({ platform: 'ios' }),
      checkIsSupportMidasPayment() { calls.push('check'); },
      requestMidasPayment() { calls.push('request'); },
    },
    config: {
      payment: { enabled: true, offerId: 'offer', zoneId: 'zone', env: 1 },
    },
  });
  assert.equal(runtime.payments.enabled, false);
  const result = await runtime.payments.purchase({
    buyQuantity: 10,
    outTradeNo: 'ios-sandbox-order',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PAYMENT_DISABLED');
  assert.equal(result.transactionStarted, false);
  assert.deepEqual(calls, []);
});

test('payment is disabled on an unverified device platform', async () => {
  let requests = 0;
  const runtime = createWechatRuntime({
    wxApi: {
      getDeviceInfo: () => ({ platform: 'devtools' }),
      requestMidasPayment: () => { requests += 1; },
    },
    config: { payment: { enabled: true, offerId: 'offer', zoneId: 'zone' } },
  });
  assert.equal(runtime.payments.enabled, false);
  const result = await runtime.payments.purchase({
    buyQuantity: 10,
    outTradeNo: 'devtools-order',
  });
  assert.equal(result.ok, false);
  assert.equal(result.transactionStarted, false);
  assert.equal(requests, 0);
});

test('iOS payment capability is disabled when checkIsSupportMidasPayment is absent', async () => {
  let requests = 0;
  const runtime = createWechatRuntime({
    wxApi: {
      getDeviceInfo: () => ({ platform: 'ios' }),
      requestMidasPayment: () => { requests += 1; },
    },
    config: { payment: { enabled: true, offerId: 'offer', zoneId: 'zone' } },
  });
  assert.equal(runtime.capabilities.payments, false);
  const support = await runtime.payments.isSupported();
  assert.equal(support.supported, false);
  assert.equal(requests, 0);
});

async function writeJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function listTree(root, relative = '') {
  const current = path.join(root, relative);
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...await listTree(root, child));
    else files.push(child.replaceAll(path.sep, '/'));
  }
  return files.sort();
}

test('WeChat build emits and executes a playable canvas bootstrap with zero packaged PNGs', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'slime-wechat-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeJson(path.join(root, 'package.json'), { type: 'module' });
  await mkdir(path.join(root, 'src', 'platform'), { recursive: true });
  for (const filename of ['runtime.js', 'wechat.js', 'wechat-canvas.js', 'wechat-entry.js']) {
    await writeFile(
      path.join(root, 'src', 'platform', filename),
      await readFile(path.join(PROJECT_ROOT, 'src', 'platform', filename), 'utf8'),
    );
  }
  await writeFile(path.join(root, 'src', 'game.js'), `export class SlimeGame {
  constructor(canvas) {
    this.canvas = canvas;
    globalThis.__WX_FIXTURE_TOUCHES__ = [];
    canvas.addEventListener('pointerdown', (event) => {
      globalThis.__WX_FIXTURE_TOUCHES__.push([event.pointerId, event.clientX, event.clientY]);
    });
  }
  start() {
    globalThis.__WX_FIXTURE_STARTED__ = (globalThis.__WX_FIXTURE_STARTED__ || 0) + 1;
    requestAnimationFrame((timestamp) => { globalThis.__WX_FIXTURE_FRAME__ = timestamp; });
  }
  resize() { globalThis.__WX_FIXTURE_RESIZED__ = true; }
  onBackground() { globalThis.__WX_FIXTURE_BACKGROUNDED__ = true; }
}
`);
  await writeFile(path.join(root, 'src', 'main.js'), 'throw new Error("web only");\n');

  const ordinaryPath = 'assets/generated/effect/effect-test.png';
  const rigPath = 'assets/generated-v2/rig/survivor-test/atlas.png';
  await mkdir(path.join(root, path.dirname(ordinaryPath)), { recursive: true });
  await mkdir(path.join(root, path.dirname(rigPath)), { recursive: true });
  await writeFile(path.join(root, ordinaryPath), Buffer.from('ordinary-png-bytes'));
  await writeFile(path.join(root, rigPath), Buffer.from('rig-png-bytes'));
  await writeJson(path.join(root, 'assets', 'asset-spec.json'), {
    schemaVersion: 1,
    assets: [{
      id: 'effect-test',
      category: 'effect',
      filename: 'effect-test.png',
      path: ordinaryPath,
    }],
  });
  await writeJson(path.join(root, 'assets', 'rig-parts.json'), {
    schemaVersion: 2,
    rigs: {
      'survivor-test': {
        parts: [{ id: 'body', path: rigPath }],
      },
    },
  });

  const result = await buildWechatPackage({
    projectRoot: root,
    assetBaseUrl: 'https://cdn.example.com/game',
    appId: 'wx-test-app',
  });
  assert.equal(result.pngs, 0);
  assert.equal(result.remoteAssets, 2);
  const output = path.join(root, '_wxgame');
  const files = await listTree(output);
  assert.ok(files.includes('game.js'));
  assert.ok(files.includes('game.json'));
  assert.ok(files.includes('project.config.json'));
  assert.ok(files.includes('remote-assets.json'));
  assert.ok(files.includes('src/platform/runtime.js'));
  assert.ok(files.includes('src/platform/wechat-canvas.js'));
  assert.ok(files.includes('src/platform/wechat-entry.js'));
  assert.ok(files.includes('src/game.js'));
  assert.equal(files.includes('src/main.js'), false);
  assert.equal(files.some((filename) => filename.endsWith('.png')), false);

  const manifest = JSON.parse(await readFile(path.join(output, 'remote-assets.json'), 'utf8'));
  assert.equal(manifest.delivery.mode, 'remote');
  assert.equal(manifest.delivery.mainPackagePngCount, 0);
  assert.equal(manifest.delivery.configured, true);
  assert.equal(manifest.assets.length, 2);
  assert.ok(manifest.assets.every(({ url }) => url.startsWith('https://cdn.example.com/game/assets/')));
  assert.ok(manifest.assets.every(({ bytes, sha256 }) => bytes > 0 && /^[a-f0-9]{64}$/.test(sha256)));

  const project = JSON.parse(await readFile(path.join(output, 'project.config.json'), 'utf8'));
  assert.equal(project.appid, 'wx-test-app');
  assert.equal(project.compileType, 'game');
  const entry = await readFile(path.join(output, 'game.js'), 'utf8');
  assert.match(entry, /startWechatGame/);
  assert.match(entry, /__SLIME_WECHAT_BOOT__/);
  assert.match(entry, /__SLIME_WECHAT_CONFIG__/);
  assert.match(entry, /https:\/\/cdn\.example\.com\/game\/assets\/generated\/effect\/effect-test\.png/);

  const host = createFakeWechatHost();
  const previousWx = globalThis.wx;
  globalThis.wx = host.wxApi;
  t.after(() => {
    globalThis.__SLIME_WECHAT_BOOT__?.dispose?.();
    if (previousWx === undefined) delete globalThis.wx;
    else globalThis.wx = previousWx;
    for (const name of [
      '__SLIME_WECHAT_BOOT__', '__SLIME_WECHAT_BOOT_ERROR__', '__SLIME_PLATFORM_RUNTIME__',
      '__SLIME_GAME__', '__WX_FIXTURE_TOUCHES__', '__WX_FIXTURE_STARTED__', '__WX_FIXTURE_FRAME__',
      '__WX_FIXTURE_RESIZED__', '__WX_FIXTURE_BACKGROUNDED__',
    ]) delete globalThis[name];
  });
  await import(`${pathToFileURL(path.join(output, 'game.js')).href}?run=${Date.now()}`);
  assert.equal(host.canvasCreations, 1);
  assert.equal(globalThis.__WX_FIXTURE_STARTED__, 1);
  assert.ok(globalThis.__SLIME_WECHAT_BOOT__?.game);
  assert.equal(host.fireFrame(64), true);
  assert.equal(globalThis.__WX_FIXTURE_FRAME__, 64);
  host.emit('onTouchStart', {
    changedTouches: [{ identifier: 3, clientX: 210, clientY: 160 }],
  });
  assert.deepEqual(globalThis.__WX_FIXTURE_TOUCHES__, [[3, 210, 160]]);
  host.emit('onHide');
  assert.equal(globalThis.__WX_FIXTURE_BACKGROUNDED__, true);
  host.emit('onShow');
  assert.equal(globalThis.__WX_FIXTURE_RESIZED__, true);
});
