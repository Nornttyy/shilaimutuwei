function safeCall(callback, ...args) {
  try {
    callback?.(...args);
  } catch {
    // One platform listener must never break touch delivery or the frame loop.
  }
}

function finitePositive(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function readWindowInfo(wxApi, hint = null) {
  let info = hint?.size || hint || null;
  if (!info || (!info.windowWidth && !info.screenWidth)) {
    try {
      info = wxApi?.getWindowInfo?.() || wxApi?.getSystemInfoSync?.() || {};
    } catch {
      info = {};
    }
  }
  const pixelRatio = finitePositive(info.pixelRatio, 1);
  return {
    width: finitePositive(info.windowWidth ?? info.screenWidth, 720),
    height: finitePositive(info.windowHeight ?? info.screenHeight, 1280),
    pixelRatio,
  };
}

function createListenerHub() {
  const listeners = new Map();
  return {
    add(name, listener) {
      if (typeof listener !== 'function') return;
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    remove(name, listener) {
      listeners.get(name)?.delete(listener);
    },
    dispatch(name, event = {}) {
      for (const listener of [...(listeners.get(name) || [])]) safeCall(listener, event);
    },
    clear() {
      listeners.clear();
    },
  };
}

function createFrameScheduler(wxApi, nativeCanvas) {
  const inheritedRequest = typeof globalThis.requestAnimationFrame === 'function'
    ? globalThis.requestAnimationFrame.bind(globalThis)
    : null;
  const inheritedCancel = typeof globalThis.cancelAnimationFrame === 'function'
    ? globalThis.cancelAnimationFrame.bind(globalThis)
    : null;
  const requestNative = typeof nativeCanvas?.requestAnimationFrame === 'function'
    ? nativeCanvas.requestAnimationFrame.bind(nativeCanvas)
    : typeof wxApi?.requestAnimationFrame === 'function'
      ? wxApi.requestAnimationFrame.bind(wxApi)
      : inheritedRequest
        || ((callback) => setTimeout(() => callback(Date.now()), 16));
  const cancelNative = typeof nativeCanvas?.cancelAnimationFrame === 'function'
    ? nativeCanvas.cancelAnimationFrame.bind(nativeCanvas)
    : typeof wxApi?.cancelAnimationFrame === 'function'
      ? wxApi.cancelAnimationFrame.bind(wxApi)
      : inheritedCancel || clearTimeout;

  const pending = new Map();
  let nextId = 1;
  let paused = false;
  let disposed = false;

  const schedule = (record) => {
    if (paused || disposed || record.nativeId != null) return;
    record.generation += 1;
    const generation = record.generation;
    record.nativeId = requestNative((timestamp) => {
      if (disposed || paused || record.generation !== generation || !pending.has(record.id)) return;
      pending.delete(record.id);
      record.nativeId = null;
      record.callback(Number.isFinite(timestamp) ? timestamp : Date.now());
    });
  };

  return {
    request(callback) {
      if (typeof callback !== 'function' || disposed) return 0;
      const record = {
        id: nextId,
        callback,
        nativeId: null,
        generation: 0,
      };
      nextId += 1;
      pending.set(record.id, record);
      schedule(record);
      return record.id;
    },
    cancel(id) {
      const record = pending.get(id);
      if (!record) return;
      pending.delete(id);
      record.generation += 1;
      if (record.nativeId != null) safeCall(cancelNative, record.nativeId);
      record.nativeId = null;
    },
    pause() {
      if (paused || disposed) return;
      paused = true;
      for (const record of pending.values()) {
        record.generation += 1;
        if (record.nativeId != null) safeCall(cancelNative, record.nativeId);
        record.nativeId = null;
      }
    },
    resume() {
      if (!paused || disposed) return;
      paused = false;
      for (const record of pending.values()) schedule(record);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const record of pending.values()) {
        record.generation += 1;
        if (record.nativeId != null) safeCall(cancelNative, record.nativeId);
      }
      pending.clear();
    },
    get paused() {
      return paused;
    },
    get pendingCount() {
      return pending.size;
    },
  };
}

function touchList(event) {
  const source = event?.changedTouches;
  if (source && Number(source.length) > 0) return Array.from(source);
  return [];
}

function pointerEventFromTouch(type, touch, originalEvent, index) {
  const clientX = Number(touch?.clientX ?? touch?.pageX ?? touch?.x ?? 0);
  const clientY = Number(touch?.clientY ?? touch?.pageY ?? touch?.y ?? 0);
  return {
    type,
    pointerId: Number(touch?.identifier ?? touch?.id ?? index + 1),
    pointerType: 'touch',
    isPrimary: index === 0,
    clientX: Number.isFinite(clientX) ? clientX : 0,
    clientY: Number.isFinite(clientY) ? clientY : 0,
    buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    originalEvent,
    preventDefault() {
      safeCall(originalEvent?.preventDefault?.bind(originalEvent));
    },
    stopPropagation() {
      safeCall(originalEvent?.stopPropagation?.bind(originalEvent));
    },
  };
}

/**
 * Wraps the native WeChat canvas with the small DOM-like surface SlimeGame
 * expects, and bridges wx touch callbacks into pointer events.
 */
export function createWechatCanvasSurface({ wxApi = globalThis.wx } = {}) {
  if (!wxApi || typeof wxApi.createCanvas !== 'function') {
    throw new Error('wx.createCanvas is required to start the WeChat Mini Game.');
  }
  const nativeCanvas = wxApi.createCanvas();
  if (!nativeCanvas || typeof nativeCanvas.getContext !== 'function') {
    throw new Error('wx.createCanvas returned an invalid Canvas instance.');
  }

  const listeners = createListenerHub();
  const frames = createFrameScheduler(wxApi, nativeCanvas);
  let viewport = readWindowInfo(wxApi);
  const canvas = {
    getContext: (...args) => nativeCanvas.getContext(...args),
    getBoundingClientRect() {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: viewport.width,
        bottom: viewport.height,
        width: viewport.width,
        height: viewport.height,
      };
    },
    addEventListener(name, listener) {
      listeners.add(name, listener);
    },
    removeEventListener(name, listener) {
      listeners.remove(name, listener);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    requestAnimationFrame: (callback) => frames.request(callback),
    cancelAnimationFrame: (id) => frames.cancel(id),
  };
  Object.defineProperties(canvas, {
    width: {
      enumerable: true,
      get: () => nativeCanvas.width,
      set: (value) => { nativeCanvas.width = value; },
    },
    height: {
      enumerable: true,
      get: () => nativeCanvas.height,
      set: (value) => { nativeCanvas.height = value; },
    },
    clientWidth: { enumerable: true, get: () => viewport.width },
    clientHeight: { enumerable: true, get: () => viewport.height },
  });

  const subscriptions = [];
  const bridgeTouch = (onName, offName, pointerType) => {
    if (typeof wxApi[onName] !== 'function') return;
    const listener = (event) => {
      touchList(event).forEach((touch, index) => {
        listeners.dispatch(pointerType, pointerEventFromTouch(pointerType, touch, event, index));
      });
    };
    wxApi[onName](listener);
    subscriptions.push(() => safeCall(wxApi[offName]?.bind(wxApi), listener));
  };
  bridgeTouch('onTouchStart', 'offTouchStart', 'pointerdown');
  bridgeTouch('onTouchMove', 'offTouchMove', 'pointermove');
  bridgeTouch('onTouchEnd', 'offTouchEnd', 'pointerup');
  bridgeTouch('onTouchCancel', 'offTouchCancel', 'pointercancel');

  return {
    canvas,
    nativeCanvas,
    frames,
    refreshViewport(hint = null) {
      viewport = readWindowInfo(wxApi, hint);
      return { ...viewport };
    },
    viewport() {
      return { ...viewport };
    },
    dispose() {
      subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
      listeners.clear();
      frames.dispose();
    },
  };
}

function storageFacade(storage) {
  return {
    getItem(key) {
      const value = storage?.get?.(String(key), null);
      if (value === null || value === undefined) return null;
      return typeof value === 'string' ? value : JSON.stringify(value);
    },
    setItem(key, value) {
      storage?.set?.(String(key), String(value));
    },
    removeItem(key) {
      storage?.remove?.(String(key));
    },
    clear() {
      // The game owns individual keys; clearing all Mini Game storage would be unsafe.
    },
  };
}

/** Installs only the browser-shaped globals required by the existing game. */
export function installWechatGameGlobals({ wxApi, surface, runtime }) {
  const windowEvents = createListenerHub();
  const documentEvents = createListenerHub();
  const previous = new Map();
  const install = (name, value) => {
    previous.set(name, {
      existed: Object.prototype.hasOwnProperty.call(globalThis, name),
      value: globalThis[name],
    });
    globalThis[name] = value;
  };

  const localStorage = storageFacade(runtime?.storage);
  const documentRef = {
    hidden: false,
    addEventListener: (name, listener) => documentEvents.add(name, listener),
    removeEventListener: (name, listener) => documentEvents.remove(name, listener),
    dispatchEvent(event) {
      documentEvents.dispatch(event?.type, event);
      return true;
    },
    querySelector(selector) {
      return selector === '#game' || selector === 'canvas' ? surface.canvas : null;
    },
    createElement(tagName) {
      return String(tagName).toLowerCase() === 'canvas' ? wxApi.createCanvas() : null;
    },
  };
  const windowRef = {
    addEventListener: (name, listener) => windowEvents.add(name, listener),
    removeEventListener: (name, listener) => windowEvents.remove(name, listener),
    dispatchEvent(event) {
      windowEvents.dispatch(event?.type, event);
      return true;
    },
    requestAnimationFrame: (callback) => surface.frames.request(callback),
    cancelAnimationFrame: (id) => surface.frames.cancel(id),
    setTimeout: globalThis.setTimeout?.bind(globalThis),
    clearTimeout: globalThis.clearTimeout?.bind(globalThis),
    localStorage,
    document: documentRef,
    AudioContext: undefined,
    webkitAudioContext: undefined,
  };
  Object.defineProperties(windowRef, {
    devicePixelRatio: { enumerable: true, get: () => surface.viewport().pixelRatio },
    innerWidth: { enumerable: true, get: () => surface.viewport().width },
    innerHeight: { enumerable: true, get: () => surface.viewport().height },
  });
  windowRef.window = windowRef;

  install('wx', wxApi);
  install('window', windowRef);
  install('document', documentRef);
  install('localStorage', localStorage);
  install('requestAnimationFrame', windowRef.requestAnimationFrame);
  install('cancelAnimationFrame', windowRef.cancelAnimationFrame);

  return {
    window: windowRef,
    document: documentRef,
    localStorage,
    setHidden(hidden, platformEvent = null) {
      const next = Boolean(hidden);
      if (documentRef.hidden === next) return;
      documentRef.hidden = next;
      documentEvents.dispatch('visibilitychange', {
        type: 'visibilitychange',
        hidden: next,
        platformEvent,
      });
    },
    dispatchResize(platformEvent = null) {
      windowEvents.dispatch('resize', { type: 'resize', platformEvent });
    },
    restore() {
      for (const [name, entry] of previous) {
        if (entry.existed) globalThis[name] = entry.value;
        else delete globalThis[name];
      }
      windowEvents.clear();
      documentEvents.clear();
    },
  };
}
