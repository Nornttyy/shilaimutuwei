const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const DEFAULT_WORLD = Object.freeze({
  width: 24,
  height: 16,
});

export const DEFAULT_WORLD_VIEWPORT = Object.freeze({
  x: 22,
  y: 92,
  width: 824,
  height: 486,
  cellSize: 64,
});

function positiveNumber(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeWorld(world = DEFAULT_WORLD) {
  return {
    infinite: world?.infinite === true,
    width: Math.max(1, Math.floor(positiveNumber(world.width, DEFAULT_WORLD.width))),
    height: Math.max(1, Math.floor(positiveNumber(world.height, DEFAULT_WORLD.height))),
  };
}

function normalizeViewport(viewport = DEFAULT_WORLD_VIEWPORT) {
  return {
    x: Number.isFinite(viewport.x) ? viewport.x : DEFAULT_WORLD_VIEWPORT.x,
    y: Number.isFinite(viewport.y) ? viewport.y : DEFAULT_WORLD_VIEWPORT.y,
    width: positiveNumber(viewport.width, DEFAULT_WORLD_VIEWPORT.width),
    height: positiveNumber(viewport.height, DEFAULT_WORLD_VIEWPORT.height),
    cellSize: positiveNumber(viewport.cellSize, DEFAULT_WORLD_VIEWPORT.cellSize),
  };
}

export function cameraVisibleSize(camera, viewport = DEFAULT_WORLD_VIEWPORT) {
  const normalizedViewport = normalizeViewport(viewport);
  const zoom = positiveNumber(camera?.zoom, 1);
  const pixelsPerCell = normalizedViewport.cellSize * zoom;
  return {
    width: normalizedViewport.width / pixelsPerCell,
    height: normalizedViewport.height / pixelsPerCell,
  };
}

export function clampCamera(camera, world = DEFAULT_WORLD, viewport = DEFAULT_WORLD_VIEWPORT) {
  const normalizedWorld = normalizeWorld(world);
  const normalizedViewport = normalizeViewport(viewport);
  const zoom = clamp(positiveNumber(camera?.zoom, 1), 0.6, 1.6);
  const visible = cameraVisibleSize({ zoom }, normalizedViewport);
  if (normalizedWorld.infinite) {
    return {
      x: Number.isFinite(camera?.x) ? camera.x : 0,
      y: Number.isFinite(camera?.y) ? camera.y : 0,
      zoom,
    };
  }
  const maxX = Math.max(0, normalizedWorld.width - visible.width);
  const maxY = Math.max(0, normalizedWorld.height - visible.height);
  return {
    x: clamp(Number.isFinite(camera?.x) ? camera.x : 0, 0, maxX),
    y: clamp(Number.isFinite(camera?.y) ? camera.y : 0, 0, maxY),
    zoom,
  };
}

export function createWorldCamera({
  world = DEFAULT_WORLD,
  viewport = DEFAULT_WORLD_VIEWPORT,
  focus = { x: 4, y: 8 },
  zoom = 1,
} = {}) {
  const visible = cameraVisibleSize({ zoom }, viewport);
  return clampCamera({
    x: (Number.isFinite(focus?.x) ? focus.x : 0) - visible.width / 2,
    y: (Number.isFinite(focus?.y) ? focus.y : 0) - visible.height / 2,
    zoom,
  }, world, viewport);
}

export function worldToScreen(
  point,
  camera,
  viewport = DEFAULT_WORLD_VIEWPORT,
) {
  const normalizedViewport = normalizeViewport(viewport);
  const normalizedCamera = {
    x: Number.isFinite(camera?.x) ? camera.x : 0,
    y: Number.isFinite(camera?.y) ? camera.y : 0,
    zoom: positiveNumber(camera?.zoom, 1),
  };
  const pixelsPerCell = normalizedViewport.cellSize * normalizedCamera.zoom;
  return {
    x: normalizedViewport.x + ((Number(point?.x) || 0) - normalizedCamera.x) * pixelsPerCell,
    y: normalizedViewport.y + ((Number(point?.y) || 0) - normalizedCamera.y) * pixelsPerCell,
  };
}

export function screenToWorld(
  point,
  camera,
  viewport = DEFAULT_WORLD_VIEWPORT,
) {
  const normalizedViewport = normalizeViewport(viewport);
  const normalizedCamera = {
    x: Number.isFinite(camera?.x) ? camera.x : 0,
    y: Number.isFinite(camera?.y) ? camera.y : 0,
    zoom: positiveNumber(camera?.zoom, 1),
  };
  const pixelsPerCell = normalizedViewport.cellSize * normalizedCamera.zoom;
  return {
    x: normalizedCamera.x + ((Number(point?.x) || 0) - normalizedViewport.x) / pixelsPerCell,
    y: normalizedCamera.y + ((Number(point?.y) || 0) - normalizedViewport.y) / pixelsPerCell,
  };
}

export function pointInsideWorldViewport(point, viewport = DEFAULT_WORLD_VIEWPORT) {
  const normalizedViewport = normalizeViewport(viewport);
  return Number.isFinite(point?.x)
    && Number.isFinite(point?.y)
    && point.x >= normalizedViewport.x
    && point.x < normalizedViewport.x + normalizedViewport.width
    && point.y >= normalizedViewport.y
    && point.y < normalizedViewport.y + normalizedViewport.height;
}

export function screenToWorldCell(
  point,
  camera,
  world = DEFAULT_WORLD,
  viewport = DEFAULT_WORLD_VIEWPORT,
) {
  if (!pointInsideWorldViewport(point, viewport)) return null;
  const normalizedWorld = normalizeWorld(world);
  const worldPoint = screenToWorld(point, camera, viewport);
  const cell = { x: Math.floor(worldPoint.x), y: Math.floor(worldPoint.y) };
  if (normalizedWorld.infinite) return cell;
  if (cell.x < 0 || cell.y < 0
    || cell.x >= normalizedWorld.width || cell.y >= normalizedWorld.height) return null;
  return cell;
}

export function panWorldCamera(
  camera,
  deltaPixels,
  world = DEFAULT_WORLD,
  viewport = DEFAULT_WORLD_VIEWPORT,
) {
  const normalizedViewport = normalizeViewport(viewport);
  const zoom = positiveNumber(camera?.zoom, 1);
  const pixelsPerCell = normalizedViewport.cellSize * zoom;
  return clampCamera({
    ...camera,
    x: (camera?.x || 0) - (Number(deltaPixels?.x) || 0) / pixelsPerCell,
    y: (camera?.y || 0) - (Number(deltaPixels?.y) || 0) / pixelsPerCell,
    zoom,
  }, world, normalizedViewport);
}

export function zoomWorldCameraAt(
  camera,
  nextZoom,
  anchor,
  world = DEFAULT_WORLD,
  viewport = DEFAULT_WORLD_VIEWPORT,
) {
  const normalizedViewport = normalizeViewport(viewport);
  const safeAnchor = pointInsideWorldViewport(anchor, normalizedViewport)
    ? anchor
    : {
      x: normalizedViewport.x + normalizedViewport.width / 2,
      y: normalizedViewport.y + normalizedViewport.height / 2,
    };
  const before = screenToWorld(safeAnchor, camera, normalizedViewport);
  const zoom = clamp(positiveNumber(nextZoom, camera?.zoom || 1), 0.6, 1.6);
  const pixelsPerCell = normalizedViewport.cellSize * zoom;
  return clampCamera({
    x: before.x - (safeAnchor.x - normalizedViewport.x) / pixelsPerCell,
    y: before.y - (safeAnchor.y - normalizedViewport.y) / pixelsPerCell,
    zoom,
  }, world, normalizedViewport);
}

export function visibleWorldBounds(
  camera,
  world = DEFAULT_WORLD,
  viewport = DEFAULT_WORLD_VIEWPORT,
  padding = 1,
) {
  const normalizedWorld = normalizeWorld(world);
  const normalizedCamera = clampCamera(camera, normalizedWorld, viewport);
  const visible = cameraVisibleSize(normalizedCamera, viewport);
  if (normalizedWorld.infinite) {
    return {
      minX: Math.floor(normalizedCamera.x) - padding,
      minY: Math.floor(normalizedCamera.y) - padding,
      maxX: Math.ceil(normalizedCamera.x + visible.width) + padding,
      maxY: Math.ceil(normalizedCamera.y + visible.height) + padding,
    };
  }
  return {
    minX: clamp(Math.floor(normalizedCamera.x) - padding, 0, normalizedWorld.width - 1),
    minY: clamp(Math.floor(normalizedCamera.y) - padding, 0, normalizedWorld.height - 1),
    maxX: clamp(Math.ceil(normalizedCamera.x + visible.width) + padding, 0, normalizedWorld.width - 1),
    maxY: clamp(Math.ceil(normalizedCamera.y + visible.height) + padding, 0, normalizedWorld.height - 1),
  };
}

export function worldCellKey(xOrCell, maybeY) {
  const x = typeof xOrCell === 'object' ? xOrCell?.x : xOrCell;
  const y = typeof xOrCell === 'object' ? xOrCell?.y : maybeY;
  return `${x},${y}`;
}
