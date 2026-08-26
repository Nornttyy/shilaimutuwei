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

function createContext({ alpha = 1, failOnImage = null } = {}) {
  const calls = [];
  const stack = [];
  const ctx = {
    globalAlpha: alpha,
    calls,
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
  const ctx = createContext();
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
      ['drawImage', 'expression-sheet', 0, 0, 72, 30, -18, -51, 36, 15, 0.25],
      ['drawImage', 'expression-sheet', 80, 0, 72, 30, -18, -51, 36, 15, 0.75],
    ],
  );
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
