import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MANIFEST = JSON.parse(await readFile(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));

function createContext(canvas = null) {
  const stack = [];
  const calls = [];
  const context = {
    canvas,
    calls,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    save() {
      stack.push({
        globalAlpha: this.globalAlpha,
        globalCompositeOperation: this.globalCompositeOperation,
      });
    },
    restore() {
      const state = stack.pop();
      if (!state) throw new Error('restore without save');
      Object.assign(this, state);
    },
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    clearRect() {},
    drawImage(image) {
      calls.push(image);
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    createRadialGradient() {
      return { addColorStop() {} };
    },
    measureText(text) {
      return { width: String(text).length * 10 };
    },
  };
  return new Proxy(context, {
    get(target, property) {
      if (property in target) return target[property];
      return () => {};
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    },
  });
}

function readyBundle(ownerId) {
  const definition = MANIFEST.rigs[ownerId];
  return {
    ownerId,
    rigId: definition.rigId,
    rootBone: definition.rootBone,
    faceBone: definition.faceBone,
    canonicalFacing: definition.canonicalFacing,
    parts: definition.parts.map((part) => ({
      ...part,
      image: { id: `${ownerId}:${part.id}:normal` },
      variants: Object.fromEntries(Object.entries(part.variants || {}).map(
        ([variantName, variant]) => [variantName, {
          ...variant,
          bindRect: variant.bindRect ?? part.bindRect,
          image: { id: `${ownerId}:${part.id}:${variantName}` },
        }],
      )),
    })),
  };
}

test('WeChat 2D offscreen canvases composite strict layered rigs and expression blends', async () => {
  const previousWx = globalThis.wx;
  const hadWx = Object.hasOwn(globalThis, 'wx');
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  const hadOffscreenCanvas = Object.hasOwn(globalThis, 'OffscreenCanvas');
  const createCalls = [];

  delete globalThis.OffscreenCanvas;
  globalThis.wx = {
    createOffscreenCanvas(options) {
      createCalls.push({ ...options });
      const canvas = { ...options, kind: 'wechat-offscreen' };
      const context = createContext(canvas);
      canvas.getContext = (type) => {
        assert.equal(type, '2d');
        return context;
      };
      return canvas;
    },
  };

  try {
    const { drawSlime } = await import(`../src/draw.js?wechat-rig=${Date.now()}`);
    const mainCanvas = { kind: 'main' };
    const mainContext = createContext(mainCanvas);
    const ownerId = 'survivor-shell-shell';

    assert.doesNotThrow(() => drawSlime(mainContext, 100, 120, 96, 'shell', {
      animate: false,
      rigAsset: readyBundle(ownerId),
      requireLayeredRig: true,
      pose: {
        root: { x: 1.5, y: -0.5 },
        shellAssembly: { rotation: 0.02 },
      },
      expressionSample: {
        slots: {
          eyes: {
            from: 'normal',
            to: 'attack',
            weights: { from: 0.5, to: 0.5 },
          },
          mouth: {
            from: 'normal',
            to: 'open',
            weights: { from: 0.5, to: 0.5 },
          },
        },
      },
    }));

    assert.ok(createCalls.length >= 3, 'rig, eyes, and mouth use WeChat offscreen surfaces');
    for (const options of createCalls) {
      assert.equal(options.type, '2d');
      assert.ok(options.width > 0);
      assert.ok(options.height > 0);
    }
    assert.ok(
      mainContext.calls.some((image) => image?.kind === 'wechat-offscreen'),
      'the complete layered rig is composited onto the visible canvas',
    );
  } finally {
    if (hadWx) globalThis.wx = previousWx;
    else delete globalThis.wx;
    if (hadOffscreenCanvas) globalThis.OffscreenCanvas = previousOffscreenCanvas;
    else delete globalThis.OffscreenCanvas;
  }
});
