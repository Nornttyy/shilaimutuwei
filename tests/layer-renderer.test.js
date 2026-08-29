import test from 'node:test';
import assert from 'node:assert/strict';

import {
  drawLayeredRig,
  renderLayeredRig,
} from '../src/animation/layer-renderer.js';

const TEST_RIG = Object.freeze({
  id: 'test-rig',
  root: 'root',
  bones: Object.freeze({
    root: Object.freeze({ parent: null, pivot: Object.freeze({ x: 0, y: 0 }), layer: -20 }),
    body: Object.freeze({ parent: 'root', pivot: Object.freeze({ x: 10, y: -20 }), layer: 0 }),
    face: Object.freeze({ parent: 'body', pivot: Object.freeze({ x: 14, y: -32 }), layer: 10 }),
  }),
});

const EXPRESSION_RIG = Object.freeze({
  ...TEST_RIG,
  expression: Object.freeze({
    states: Object.freeze({
      normal: Object.freeze({ eyes: 'normal', mouth: 'normal' }),
      blink: Object.freeze({ eyes: 'blink', mouth: 'normal' }),
      attack: Object.freeze({ eyes: 'attack', mouth: 'open' }),
    }),
  }),
});

function createRecordingExpressionSurface(id) {
  const calls = [];
  const stack = [];
  const surfaceCtx = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    save() {
      calls.push(['save']);
      stack.push({
        globalAlpha: this.globalAlpha,
        globalCompositeOperation: this.globalCompositeOperation,
      });
    },
    restore() {
      calls.push(['restore']);
      const state = stack.pop();
      this.globalAlpha = state.globalAlpha;
      this.globalCompositeOperation = state.globalCompositeOperation;
    },
    clearRect(...rect) {
      calls.push(['clearRect', ...rect]);
    },
    drawImage(image, ...rect) {
      calls.push([
        'drawImage',
        image.id,
        ...rect,
        this.globalAlpha,
        this.globalCompositeOperation,
      ]);
    },
  };
  return {
    id,
    width: 0,
    height: 0,
    calls,
    getContext: () => surfaceCtx,
  };
}

function createOnePixelExpressionSurface(id) {
  let premultiplied = [0, 0, 0];
  let alpha = 0;
  const stack = [];
  const surfaceCtx = {
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
      this.globalAlpha = state.globalAlpha;
      this.globalCompositeOperation = state.globalCompositeOperation;
    },
    clearRect() {
      premultiplied = [0, 0, 0];
      alpha = 0;
    },
    drawImage(image) {
      const sourceAlpha = (image.pixel[3] / 255) * this.globalAlpha;
      const source = image.pixel.slice(0, 3).map((value) => (value / 255) * sourceAlpha);
      if (this.globalCompositeOperation === 'lighter') {
        premultiplied = premultiplied.map((value, channel) => (
          Math.min(1, value + source[channel])
        ));
        alpha = Math.min(1, alpha + sourceAlpha);
      } else {
        premultiplied = source.map((value, channel) => (
          value + premultiplied[channel] * (1 - sourceAlpha)
        ));
        alpha = sourceAlpha + alpha * (1 - sourceAlpha);
      }
    },
  };
  return {
    id,
    width: 1,
    height: 1,
    get pixel() {
      return [
        ...premultiplied.map((value) => Math.round((value / Math.max(alpha, 1e-9)) * 255)),
        Math.round(alpha * 255),
      ];
    },
    getContext: () => surfaceCtx,
  };
}

function createContext({
  alpha = 1,
  failOnImage = null,
  expressionSurfaceFactory = null,
} = {}) {
  const calls = [];
  const stack = [];
  const surfaces = [];
  const ctx = {
    globalAlpha: alpha,
    calls,
    surfaces,
    save() {
      calls.push(['save']);
      stack.push({ globalAlpha: this.globalAlpha });
    },
    restore() {
      calls.push(['restore']);
      const state = stack.pop();
      if (!state) throw new Error('restore without save');
      this.globalAlpha = state.globalAlpha;
    },
    translate(x, y) {
      calls.push(['translate', x, y]);
    },
    rotate(value) {
      calls.push(['rotate', value]);
    },
    scale(x, y) {
      calls.push(['scale', x, y]);
    },
    drawImage(image, ...rect) {
      calls.push(['drawImage', image.id, ...rect, this.globalAlpha]);
      if (image === failOnImage) throw new Error('draw failed');
    },
  };
  if (expressionSurfaceFactory) {
    ctx.canvas = {
      ownerDocument: {
        createElement() {
          const surface = expressionSurfaceFactory(`expression-surface-${surfaces.length}`);
          surfaces.push(surface);
          return surface;
        },
      },
    };
  }
  return ctx;
}

function manifest(parts) {
  return { rigId: 'test-rig', parts };
}

function part(id, bone, z, bindRect, overrides = {}) {
  return { id, bone, z, required: true, bindRect, ...overrides };
}

test('draws independent logical bindRects in stable z order', () => {
  const ctx = createContext();
  const images = {
    body: { id: 'body-image' },
    face: { id: 'face-image' },
    shadow: { id: 'shadow-image' },
  };
  const entry = manifest([
    part('face', 'face', 10, { x: -4, y: -35, width: 16, height: 9 }),
    part('body', 'body', 0, { x: -40, y: -72, width: 80, height: 76 }),
    part('shadow', 'root', 0, { x: -24, y: -5, width: 48, height: 10 }),
  ]);

  assert.equal(renderLayeredRig(ctx, TEST_RIG, {}, entry, images), true);
  assert.deepEqual(
    ctx.calls.filter(([name]) => name === 'drawImage'),
    [
      ['drawImage', 'body-image', -40, -72, 80, 76, 1],
      ['drawImage', 'shadow-image', -24, -5, 48, 10, 1],
      ['drawImage', 'face-image', -4, -35, 16, 9, 1],
    ],
  );
  assert.equal(ctx.calls.filter(([name]) => name === 'save').length, 3);
  assert.equal(ctx.calls.filter(([name]) => name === 'restore').length, 3);
  assert.equal(ctx.globalAlpha, 1);
});

test('crops multiple layers from one shared atlas into independent bindRects', () => {
  const ctx = createContext();
  const atlas = { id: 'shared-atlas' };
  const entry = manifest([
    part(
      'eyes',
      'face',
      10,
      { x: -18, y: -51, width: 36, height: 15 },
      { sourceRect: { x: 128, y: 16, width: 72, height: 30 } },
    ),
    part(
      'body',
      'body',
      0,
      { x: -51, y: -81, width: 102, height: 89 },
      { sourceRect: { x: 0, y: 0, width: 204, height: 178 } },
    ),
  ]);

  assert.equal(
    renderLayeredRig(ctx, TEST_RIG, {}, entry, { eyes: atlas, body: atlas }),
    true,
  );
  assert.deepEqual(
    ctx.calls.filter(([name]) => name === 'drawImage'),
    [
      ['drawImage', 'shared-atlas', 0, 0, 204, 178, -51, -81, 102, 89, 1],
      ['drawImage', 'shared-atlas', 128, 16, 72, 30, -18, -51, 36, 15, 1],
    ],
  );
});

test('cross-fades real expression sourceRects instead of scaling one face image', () => {
  const ctx = createContext({ expressionSurfaceFactory: createRecordingExpressionSurface });
  const atlas = { id: 'expression-sheet' };
  const bindRect = { x: -18, y: -51, width: 36, height: 15 };
  const atlasPath = 'assets/test/expressions-v2.png';
  const entry = manifest([
    part('eyes', 'face', 10, bindRect, {
      path: atlasPath,
      sourceRect: { x: 0, y: 0, width: 72, height: 30 },
      variants: {
        blink: {
          name: 'blink',
          path: atlasPath,
          sourceRect: { x: 80, y: 0, width: 72, height: 30 },
          bindRect,
        },
      },
    }),
  ]);
  const expression = {
    slots: {
      eyes: {
        from: 'normal',
        to: 'blink',
        weights: { from: 0.25, to: 0.75 },
      },
    },
  };

  assert.equal(
    renderLayeredRig(ctx, EXPRESSION_RIG, {}, entry, { [atlasPath]: atlas }, expression),
    true,
  );
  assert.deepEqual(
    ctx.calls.filter(([name]) => name === 'drawImage'),
    [
      [
        'drawImage',
        'expression-surface-0',
        0,
        0,
        72,
        30,
        -18,
        -51,
        36,
        15,
        1,
      ],
    ],
  );
  assert.deepEqual(
    ctx.surfaces[0].calls.filter(([name]) => name === 'drawImage'),
    [
      ['drawImage', 'expression-sheet', 0, 0, 72, 30, 0, 0, 72, 30, 0.25, 'source-over'],
      ['drawImage', 'expression-sheet', 80, 0, 72, 30, 0, 0, 72, 30, 0.75, 'lighter'],
    ],
  );
});

test('expression cross-fade is a premultiplied pixel mix with full midpoint alpha', () => {
  const ctx = createContext({ expressionSurfaceFactory: createOnePixelExpressionSurface });
  const normal = { id: 'red-normal', width: 1, height: 1, pixel: [255, 0, 0, 255] };
  const blink = { id: 'blue-blink', width: 1, height: 1, pixel: [0, 0, 255, 255] };
  const bindRect = { x: 0, y: 0, width: 1, height: 1 };
  const entry = manifest([
    part('pixelEyes', 'face', 10, bindRect, {
      image: normal,
      variants: {
        blink: { image: blink, bindRect },
      },
    }),
  ]);

  assert.equal(renderLayeredRig(ctx, EXPRESSION_RIG, {}, entry, null, {
    pixelEyes: {
      from: 'normal',
      to: 'blink',
      weights: { from: 0.5, to: 0.5 },
    },
  }), true);

  // Linear premultiplied interpolation of two opaque pixels stays opaque and
  // produces equal red/blue. Sequential source-over would be [85, 0, 170, 191].
  assert.deepEqual(ctx.surfaces[0].pixel, [128, 0, 128, 255]);
  assert.equal(ctx.calls.filter(([name]) => name === 'drawImage').length, 1);
});

test('draws a standalone expression asset and allows its own logical bindRect', () => {
  const ctx = createContext();
  const normal = { id: 'normal-eyes' };
  const attack = { id: 'attack-eyes' };
  const basePath = 'assets/test/atlas.png';
  const attackPath = 'assets/test/eyes-attack.png';
  const entry = manifest([
    part('eyes', 'face', 10, { x: -18, y: -51, width: 36, height: 15 }, {
      path: basePath,
      sourceRect: { x: 0, y: 0, width: 72, height: 30 },
      variants: {
        attack: {
          name: 'attack',
          path: attackPath,
          sourceRect: null,
          bindRect: { x: -20, y: -53, width: 40, height: 18 },
        },
      },
    }),
  ]);

  assert.equal(renderLayeredRig(
    ctx,
    EXPRESSION_RIG,
    {},
    entry,
    { [basePath]: normal, [attackPath]: attack },
    { eyes: 'attack' },
  ), true);
  assert.deepEqual(
    ctx.calls.find(([name]) => name === 'drawImage'),
    ['drawImage', 'attack-eyes', -20, -53, 40, 18, 1],
  );
});

test('missing undeclared variants safely keep the normal face without double drawing', () => {
  const ctx = createContext();
  const atlas = { id: 'legacy-atlas' };
  const entry = manifest([
    part(
      'eyes',
      'face',
      10,
      { x: -18, y: -51, width: 36, height: 15 },
      {
        image: atlas,
        sourceRect: { x: 0, y: 0, width: 72, height: 30 },
      },
    ),
  ]);

  assert.equal(renderLayeredRig(ctx, EXPRESSION_RIG, {}, entry, null, {
    slots: {
      eyes: {
        from: 'normal',
        to: 'blink',
        weights: { from: 0.4, to: 0.6 },
      },
    },
  }), true);
  assert.deepEqual(
    ctx.calls.filter(([name]) => name === 'drawImage'),
    [['drawImage', 'legacy-atlas', 0, 0, 72, 30, -18, -51, 36, 15, 1]],
  );
});

test('a declared but undecoded expression asset preserves atomic vector fallback', () => {
  const ctx = createContext();
  const basePath = 'assets/test/atlas.png';
  const entry = manifest([
    part('eyes', 'face', 10, { x: -18, y: -51, width: 36, height: 15 }, {
      path: basePath,
      sourceRect: { x: 0, y: 0, width: 72, height: 30 },
      variants: {
        blink: {
          name: 'blink',
          path: 'assets/test/eyes-blink.png',
          sourceRect: null,
          bindRect: { x: -18, y: -51, width: 36, height: 15 },
        },
      },
    }),
  ]);

  assert.equal(renderLayeredRig(
    ctx,
    EXPRESSION_RIG,
    {},
    entry,
    { [basePath]: { id: 'normal' } },
    'blink',
  ), false);
  assert.deepEqual(ctx.calls, []);
});

test('validates every sourceRect before drawing any layer', () => {
  const ctx = createContext();
  const atlas = { id: 'shared-atlas' };
  const entry = manifest([
    part(
      'body',
      'body',
      0,
      { x: -51, y: -81, width: 102, height: 89 },
      { sourceRect: { x: 0, y: 0, width: 204, height: 178 } },
    ),
    part(
      'eyes',
      'face',
      10,
      { x: -18, y: -51, width: 36, height: 15 },
      { sourceRect: { x: 128, y: 16, width: 0, height: 30 } },
    ),
  ]);

  assert.throws(
    () => renderLayeredRig(ctx, TEST_RIG, {}, entry, { body: atlas, eyes: atlas }),
    /sourceRect width and height must be greater than zero/,
  );
  assert.deepEqual(ctx.calls, []);
});

test('applies every ancestor pose around its rig bind pivot', () => {
  const ctx = createContext();
  const faceImage = { id: 'face' };
  const pose = {
    root: { x: 2, y: 3, rotation: 0.1, scaleX: 1.2, scaleY: 0.9, alpha: 0.8 },
    body: { x: -4, y: 5, rotation: -0.2, scaleX: 0.7, scaleY: 1.3, alpha: 0.5 },
    face: { x: 1, y: -2, rotation: 0.3, scaleX: 1.1, scaleY: 0.6, alpha: 0.25 },
  };
  const entry = manifest([
    part('face', 'face', 10, { x: 2, y: -40, width: 18, height: 12 }, { alpha: 0.5 }),
  ]);

  assert.equal(renderLayeredRig(ctx, TEST_RIG, pose, entry, new Map([['face', faceImage]])), true);
  assert.deepEqual(ctx.calls, [
    ['save'],
    ['translate', 2, 3],
    ['rotate', 0.1],
    ['scale', 1.2, 0.9],
    ['translate', 0, 0],
    ['translate', 6, -15],
    ['rotate', -0.2],
    ['scale', 0.7, 1.3],
    ['translate', -10, 20],
    ['translate', 15, -34],
    ['rotate', 0.3],
    ['scale', 1.1, 0.6],
    ['translate', -14, 32],
    ['drawImage', 'face', 2, -40, 18, 12, 0.05],
    ['restore'],
  ]);
  assert.equal(ctx.globalAlpha, 1);
});

test('preserves incoming alpha and clamps invalid or out-of-range bone alpha', () => {
  const ctx = createContext({ alpha: 0.6 });
  const entry = manifest([
    part('body', 'body', 0, { x: -10, y: -20, width: 20, height: 20 }),
    part('face', 'face', 10, { x: -3, y: -8, width: 6, height: 4 }),
  ]);
  const pose = {
    root: { alpha: Number.NaN },
    body: { alpha: 2 },
    face: { alpha: -1 },
  };

  renderLayeredRig(ctx, TEST_RIG, pose, entry, {
    body: { id: 'body' },
    face: { id: 'face' },
  });
  const draws = ctx.calls.filter(([name]) => name === 'drawImage');
  assert.equal(draws[0].at(-1), 0.6);
  assert.equal(draws[1].at(-1), 0);
  assert.equal(ctx.globalAlpha, 0.6);
});

test('accepts ready loader parts with embedded decoded images and layers alias', () => {
  const ctx = createContext();
  const image = { id: 'embedded' };
  const entry = {
    layers: [
      part('body', 'body', 0, { x: -20, y: -30, width: 40, height: 34 }, { image }),
    ],
  };

  assert.equal(drawLayeredRig, renderLayeredRig);
  assert.equal(drawLayeredRig(ctx, TEST_RIG, null, entry), true);
  assert.deepEqual(
    ctx.calls.find(([name]) => name === 'drawImage'),
    ['drawImage', 'embedded', -20, -30, 40, 34, 1],
  );
});

test('one maximum-detail rig frame has explicit bitmap and array-producing pass budgets', () => {
  // Crystal Pin is the largest production rig at eleven visible parts. Two
  // expression slots may each blend two source cells on cached isolated
  // surfaces, but the main canvas must still receive one composite per part.
  const ctx = createContext({ expressionSurfaceFactory: createRecordingExpressionSurface });
  const bodyParts = Array.from({ length: 9 }, (_, index) => part(
    `layer-${index}`,
    'body',
    index,
    { x: -40 + index, y: -70, width: 80, height: 72 },
    { image: { id: `layer-${index}` } },
  ));
  const expressionPart = (id, z) => part(
    id,
    'face',
    z,
    { x: -18, y: -50 + z, width: 36, height: 14 },
    {
      image: { id: `${id}-normal` },
      variants: {
        active: {
          image: { id: `${id}-active` },
          bindRect: { x: -18, y: -50 + z, width: 36, height: 14 },
        },
      },
    },
  );
  const entry = manifest([
    ...bodyParts,
    expressionPart('eyes', 10),
    expressionPart('mouth', 11),
  ]);
  const expression = {
    eyes: { from: 'normal', to: 'active', weights: { from: 0.5, to: 0.5 } },
    mouth: { from: 'normal', to: 'active', weights: { from: 0.5, to: 0.5 } },
  };

  const allocationMethods = ['map', 'filter', 'flatMap', 'slice'];
  const nativeMethods = Object.fromEntries(allocationMethods.map((name) => (
    [name, Array.prototype[name]]
  )));
  let arrayProducingPasses = 0;
  for (const name of allocationMethods) {
    Array.prototype[name] = function observedArrayProducer(...args) {
      arrayProducingPasses += 1;
      return nativeMethods[name].apply(this, args);
    };
  }
  try {
    assert.equal(renderLayeredRig(ctx, EXPRESSION_RIG, {}, entry, null, expression), true);
  } finally {
    for (const name of allocationMethods) Array.prototype[name] = nativeMethods[name];
  }

  const mainCanvasDraws = ctx.calls.filter(([name]) => name === 'drawImage').length;
  const expressionSurfaceDraws = ctx.surfaces.reduce((total, surface) => (
    total + surface.calls.filter(([name]) => name === 'drawImage').length
  ), 0);
  assert.equal(mainCanvasDraws, 11, 'each rig part composites onto the world canvas once');
  assert.equal(expressionSurfaceDraws, 4, 'two face slots blend at most two source cells each');
  assert.ok(
    mainCanvasDraws + expressionSurfaceDraws <= 15,
    'one maximum-detail rig may issue at most fifteen bitmap draws across all canvases',
  );
  assert.ok(
    arrayProducingPasses <= 18,
    `one rig preparation may use at most 18 array-producing passes, got ${arrayProducingPasses}`,
  );
});

test('leaves the canvas untouched when a required decoded part is missing', () => {
  const ctx = createContext({ alpha: 0.75 });
  const entry = manifest([
    part('body', 'body', 0, { x: -20, y: -30, width: 40, height: 34 }),
    part('face', 'face', 10, { x: -4, y: -15, width: 8, height: 6 }),
  ]);

  assert.equal(renderLayeredRig(ctx, TEST_RIG, {}, entry, { body: { id: 'body' } }), false);
  assert.deepEqual(ctx.calls, []);
  assert.equal(ctx.globalAlpha, 0.75);
});

test('skips missing optional parts without blocking required parts', () => {
  const ctx = createContext();
  const entry = manifest([
    part('body', 'body', 0, { x: -20, y: -30, width: 40, height: 34 }),
    part(
      'shine',
      'face',
      20,
      { x: -4, y: -15, width: 8, height: 6 },
      { required: false },
    ),
  ]);

  assert.equal(renderLayeredRig(ctx, TEST_RIG, {}, entry, { body: { id: 'body' } }), true);
  assert.deepEqual(
    ctx.calls.filter(([name]) => name === 'drawImage').map((call) => call[1]),
    ['body'],
  );
});

test('restores canvas state when drawImage throws', () => {
  const image = { id: 'bad-image' };
  const ctx = createContext({ alpha: 0.4, failOnImage: image });
  const entry = manifest([
    part('body', 'body', 0, { x: -20, y: -30, width: 40, height: 34 }),
  ]);

  assert.throws(
    () => renderLayeredRig(ctx, TEST_RIG, { root: { alpha: 0.25 } }, entry, { body: image }),
    /draw failed/,
  );
  assert.deepEqual(ctx.calls.at(-1), ['restore']);
  assert.equal(ctx.globalAlpha, 0.4);
});

test('rejects unknown bones and cyclic ancestor chains before drawing', () => {
  const image = { id: 'part' };
  const entry = manifest([
    part('part', 'missing', 0, { x: 0, y: 0, width: 10, height: 10 }),
  ]);
  const ctx = createContext();
  assert.throws(
    () => renderLayeredRig(ctx, TEST_RIG, {}, entry, { part: image }),
    /unknown rig bone: missing/,
  );
  assert.deepEqual(ctx.calls, []);

  const cyclicRig = {
    root: 'root',
    bones: {
      root: { parent: 'body', pivot: { x: 0, y: 0 } },
      body: { parent: 'root', pivot: { x: 0, y: 0 } },
    },
  };
  const cyclicEntry = manifest([
    part('part', 'body', 0, { x: 0, y: 0, width: 10, height: 10 }),
  ]);
  assert.throws(
    () => renderLayeredRig(ctx, cyclicRig, {}, cyclicEntry, { part: image }),
    /cycle/,
  );
  assert.deepEqual(ctx.calls, []);
});
