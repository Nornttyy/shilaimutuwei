import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_WORLD,
  DEFAULT_WORLD_VIEWPORT,
  cameraVisibleSize,
  clampCamera,
  createWorldCamera,
  panWorldCamera,
  screenToWorldCell,
  visibleWorldBounds,
  worldToScreen,
  zoomWorldCameraAt,
} from '../src/world.js';

test('the large world is wider than the visible base area', () => {
  const visible = cameraVisibleSize({ zoom: 1 });
  assert.equal(DEFAULT_WORLD.width, 24);
  assert.equal(DEFAULT_WORLD.height, 16);
  assert.ok(visible.width < DEFAULT_WORLD.width);
  assert.ok(visible.height < DEFAULT_WORLD.height);
});

test('camera centers on a focus and remains inside world bounds', () => {
  const camera = createWorldCamera({ focus: { x: 12, y: 8 } });
  const visible = cameraVisibleSize(camera);
  assert.ok(Math.abs(camera.x + visible.width / 2 - 12) < 1e-9);
  assert.ok(Math.abs(camera.y + visible.height / 2 - 8) < 1e-9);

  assert.deepEqual(
    clampCamera({ x: -20, y: 99, zoom: 1 }),
    {
      x: 0,
      y: DEFAULT_WORLD.height - visible.height,
      zoom: 1,
    },
  );
});

test('screen and world transforms select the same tile at non-default zoom', () => {
  const camera = createWorldCamera({ focus: { x: 12, y: 8 }, zoom: 1.25 });
  const screen = worldToScreen({ x: 14.5, y: 6.5 }, camera);
  assert.deepEqual(screenToWorldCell(screen, camera), { x: 14, y: 6 });
  assert.equal(screenToWorldCell({ x: 0, y: 0 }, camera), null);
});

test('panning uses screen pixels and clamps at every world edge', () => {
  const start = createWorldCamera({ focus: { x: 12, y: 8 } });
  const moved = panWorldCamera(start, { x: -128, y: 64 });
  assert.equal(moved.x, start.x + 2);
  assert.equal(moved.y, start.y - 1);

  const far = panWorldCamera(start, { x: 99999, y: 99999 });
  assert.equal(far.x, 0);
  assert.equal(far.y, 0);
});

test('zooming keeps the world point below the cursor stable', () => {
  const camera = createWorldCamera({ focus: { x: 12, y: 8 } });
  const anchor = {
    x: DEFAULT_WORLD_VIEWPORT.x + 200,
    y: DEFAULT_WORLD_VIEWPORT.y + 170,
  };
  const beforeCell = screenToWorldCell(anchor, camera);
  const zoomed = zoomWorldCameraAt(camera, 1.5, anchor);
  const afterCell = screenToWorldCell(anchor, zoomed);
  assert.deepEqual(afterCell, beforeCell);
});

test('visible bounds are clipped to arbitrary configured world sizes', () => {
  const world = { width: 40, height: 30 };
  const camera = createWorldCamera({ world, focus: { x: 38, y: 28 } });
  const bounds = visibleWorldBounds(camera, world);
  assert.equal(bounds.maxX, 39);
  assert.equal(bounds.maxY, 29);
  assert.ok(bounds.minX > 0);
  assert.ok(bounds.minY > 0);
});
