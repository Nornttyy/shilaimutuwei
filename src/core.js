/**
 * Pure gameplay helpers for the 6x6 Slime Haven battlefield.
 *
 * Coordinates use a top-left origin: x grows to the right and y grows down.
 * Rotations are clockwise quarter-turns (0..3); 0/90/180/270 degrees are
 * accepted as a convenience as well.
 */

export const GRID_WIDTH = 6;
export const GRID_HEIGHT = 6;
export const GRID_SIZE = 6;

export const CARDINAL_DIRECTIONS = Object.freeze([
  Object.freeze({ x: -1, y: 0 }), // Prefer progress toward the core.
  Object.freeze({ x: 0, y: -1 }),
  Object.freeze({ x: 0, y: 1 }),
  Object.freeze({ x: 1, y: 0 }),
]);

const DIRECTION_VECTORS = Object.freeze({
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
});

export class GridRuleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GridRuleError';
    this.code = code;
    this.details = details;
  }
}

function isFiniteInteger(value) {
  return Number.isInteger(value) && Number.isFinite(value);
}

function cellKey(cellOrX, maybeY) {
  const x = typeof cellOrX === 'object' ? cellOrX.x : cellOrX;
  const y = typeof cellOrX === 'object' ? cellOrX.y : maybeY;
  return `${x},${y}`;
}

function cloneBuilding(building) {
  const copy = { ...building };
  if (building.position) copy.position = { ...building.position };
  if (building.shape) copy.shape = building.shape.map((cell) => [...cell]);
  return copy;
}

function positionOf(building) {
  return {
    x: building.x ?? building.position?.x,
    y: building.y ?? building.position?.y,
  };
}

function buildingTypeOf(building) {
  return building.definitionId
    ?? building.buildingTypeId
    ?? building.typeId
    ?? building.catalogId
    ?? building.cardId
    ?? building.kind
    ?? building.type;
}

function resolveCatalogEntry(catalog, type) {
  if (!catalog || type == null) return undefined;
  if (catalog instanceof Map) return catalog.get(type);
  if (Array.isArray(catalog)) {
    return catalog.find((entry) => entry.id === type || entry.type === type);
  }
  return catalog[type];
}

function shapeOfDefinition(definition) {
  if (Array.isArray(definition?.shape)) return definition.shape;
  if (Array.isArray(definition?.footprint)) return definition.footprint;

  const footprint = definition?.footprint;
  if (footprint && isFiniteInteger(footprint.width) && isFiniteInteger(footprint.height)
    && footprint.width > 0 && footprint.height > 0) {
    return Array.from({ length: footprint.height }, (_, y) => (
      Array.from({ length: footprint.width }, (__, x) => [x, y])
    )).flat();
  }
  throw new GridRuleError(
    'INVALID_SHAPE',
    'A building definition needs a shape or a positive width/height footprint.',
  );
}

function assertGrid(grid) {
  if (!grid || !isFiniteInteger(grid.width) || !isFiniteInteger(grid.height)
    || grid.width <= 0 || grid.height <= 0 || !Array.isArray(grid.buildings)) {
    throw new GridRuleError(
      'INVALID_GRID',
      'A grid needs positive integer width/height values and a buildings array.',
    );
  }
}

function placementFailure(code, message, details = {}) {
  return { ok: false, code, message, ...details };
}

function throwPlacementFailure(validation) {
  throw new GridRuleError(validation.code, validation.message, validation);
}

function normalizeCellList(cells, grid, label) {
  if (!Array.isArray(cells) || cells.length === 0) {
    throw new GridRuleError('INVALID_PATH_ENDPOINTS', `${label} must contain at least one cell.`);
  }

  const seen = new Set();
  return cells.map((cell) => {
    const normalized = { x: cell?.x, y: cell?.y };
    if (!isCellInBounds(grid, normalized)) {
      throw new GridRuleError(
        'PATH_ENDPOINT_OUT_OF_BOUNDS',
        `${label} contains an out-of-bounds cell.`,
        { cell: normalized },
      );
    }
    const key = cellKey(normalized);
    if (seen.has(key)) return null;
    seen.add(key);
    return normalized;
  }).filter(Boolean);
}

function numberOrDefault(value, fallback, label, { allowInfinity = false } = {}) {
  if (value == null) return fallback;
  const valid = typeof value === 'number'
    && !Number.isNaN(value)
    && value >= 0
    && (Number.isFinite(value) || (allowInfinity && value === Infinity));
  if (!valid) {
    throw new GridRuleError('INVALID_BUILDING_COST', `${label} must be a non-negative number.`);
  }
  return value;
}

function buildingNavigationTraits(definition) {
  const blocksPath = definition.blocksPath
    ?? definition.blocking
    ?? definition.solid
    ?? (definition.passable == null
      ? (definition.walkable == null ? true : !definition.walkable)
      : !definition.passable);
  const breachCost = numberOrDefault(
    definition.breachCost ?? definition.durability ?? definition.maxHp ?? definition.hp,
    10,
    'breachCost',
    { allowInfinity: true },
  );
  const moveCost = numberOrDefault(
    definition.pathCost
      ?? definition.moveCost
      ?? (definition.effect?.speedMultiplier > 0
        ? 1 / definition.effect.speedMultiplier
        : undefined),
    1,
    'pathCost',
  );
  return { blocksPath: Boolean(blocksPath), breachCost, moveCost };
}

function entityPosition(entity) {
  return {
    x: entity?.x ?? entity?.position?.x,
    y: entity?.y ?? entity?.position?.y,
  };
}

function toArray(value) {
  if (value == null) return null;
  return Array.isArray(value) ? value : [value];
}

function readRng(rng) {
  if (typeof rng !== 'function') {
    throw new TypeError('rng must be a function returning a number in [0, 1).');
  }
  const value = rng();
  if (typeof value !== 'number' || value < 0 || value >= 1 || !Number.isFinite(value)) {
    throw new RangeError('rng must return a finite number in [0, 1).');
  }
  return value;
}

/** Create a fresh grid state. Supplied buildings are cloned. */
export function createGridState({
  width = GRID_WIDTH,
  height = GRID_HEIGHT,
  buildings = [],
} = {}) {
  const grid = { width, height, buildings: buildings.map(cloneBuilding) };
  assertGrid(grid);

  const ids = new Set();
  for (const building of grid.buildings) {
    if (typeof building.id !== 'string' || building.id.length === 0) {
      throw new GridRuleError('INVALID_BUILDING_ID', 'Every building needs a non-empty string id.');
    }
    if (ids.has(building.id)) {
      throw new GridRuleError('DUPLICATE_BUILDING_ID', `Duplicate building id: ${building.id}`);
    }
    ids.add(building.id);
  }
  return grid;
}

export function isCellInBounds(grid, cell) {
  return Boolean(
    grid
    && cell
    && isFiniteInteger(cell.x)
    && isFiniteInteger(cell.y)
    && cell.x >= 0
    && cell.x < grid.width
    && cell.y >= 0
    && cell.y < grid.height,
  );
}

/**
 * Validate and normalize a footprint. Footprints are orthogonally connected by
 * default so one building cannot secretly describe several detached blockers.
 */
export function validateShape(shape, { requireConnected = true } = {}) {
  if (!Array.isArray(shape) || shape.length === 0) {
    return placementFailure('INVALID_SHAPE', 'A building shape must contain at least one cell.');
  }

  const cells = [];
  const seen = new Set();
  for (const rawCell of shape) {
    const x = Array.isArray(rawCell) ? rawCell[0] : rawCell?.x;
    const y = Array.isArray(rawCell) ? rawCell[1] : rawCell?.y;
    if (!isFiniteInteger(x) || !isFiniteInteger(y)) {
      return placementFailure('INVALID_SHAPE', 'Shape coordinates must be finite integers.');
    }
    const key = cellKey(x, y);
    if (seen.has(key)) {
      return placementFailure('INVALID_SHAPE', 'A shape cannot contain duplicate cells.');
    }
    seen.add(key);
    cells.push({ x, y });
  }

  if (requireConnected && cells.length > 1) {
    const visited = new Set([cellKey(cells[0])]);
    const queue = [cells[0]];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const direction of CARDINAL_DIRECTIONS) {
        const key = cellKey(current.x + direction.x, current.y + direction.y);
        if (seen.has(key) && !visited.has(key)) {
          visited.add(key);
          queue.push({ x: current.x + direction.x, y: current.y + direction.y });
        }
      }
    }
    if (visited.size !== cells.length) {
      return placementFailure('DISCONNECTED_SHAPE', 'A building shape must be orthogonally connected.');
    }
  }

  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  const normalized = cells
    .map((cell) => ({ x: cell.x - minX, y: cell.y - minY }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const width = Math.max(...normalized.map((cell) => cell.x)) + 1;
  const height = Math.max(...normalized.map((cell) => cell.y)) + 1;
  return { ok: true, cells: normalized, width, height };
}

export function normalizeRotation(rotation = 0) {
  if (!isFiniteInteger(rotation)) {
    throw new GridRuleError('INVALID_ROTATION', 'Rotation must be an integer quarter-turn or degree value.');
  }
  let turns = rotation;
  if (Math.abs(rotation) > 3) {
    if (rotation % 90 !== 0) {
      throw new GridRuleError('INVALID_ROTATION', 'Degree rotations must be multiples of 90.');
    }
    turns = rotation / 90;
  }
  return ((turns % 4) + 4) % 4;
}

export function rotateShape(shape, rotation = 0) {
  const validation = validateShape(shape);
  if (!validation.ok) throwPlacementFailure(validation);

  let cells = validation.cells;
  const turns = normalizeRotation(rotation);
  for (let turn = 0; turn < turns; turn += 1) {
    cells = cells.map((cell) => ({ x: -cell.y, y: cell.x }));
    const minX = Math.min(...cells.map((cell) => cell.x));
    const minY = Math.min(...cells.map((cell) => cell.y));
    cells = cells.map((cell) => ({ x: cell.x - minX, y: cell.y - minY }));
  }
  return cells.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function getShapeBounds(shape, rotation = 0) {
  const cells = rotateShape(shape, rotation);
  return {
    width: Math.max(...cells.map((cell) => cell.x)) + 1,
    height: Math.max(...cells.map((cell) => cell.y)) + 1,
    cells,
  };
}

export function getBuildingDefinition(building, catalog = {}) {
  if (building?.definition?.shape || building?.definition?.footprint) return building.definition;
  const type = typeof building === 'string' ? building : buildingTypeOf(building ?? {});
  const fromCatalog = resolveCatalogEntry(catalog, type);
  if (fromCatalog) return fromCatalog;
  if (building && typeof building === 'object' && building.shape) return building;
  throw new GridRuleError(
    'UNKNOWN_BUILDING_TYPE',
    `Unknown building type: ${String(type)}`,
    { type },
  );
}

export function getBuildingCells(building, catalog = {}) {
  const { x, y } = positionOf(building ?? {});
  if (!isFiniteInteger(x) || !isFiniteInteger(y)) {
    throw new GridRuleError('INVALID_BUILDING_POSITION', 'Building x/y coordinates must be integers.');
  }
  const definition = getBuildingDefinition(building, catalog);
  const shape = rotateShape(shapeOfDefinition(definition), building.rotation ?? 0);
  return shape.map((cell) => ({ x: x + cell.x, y: y + cell.y }));
}

export const getBuildingFootprint = getBuildingCells;

/** Map "x,y" to { building, definition, cell }. */
export function getOccupancyMap(grid, catalog = {}, { ignoreBuildingId = null } = {}) {
  assertGrid(grid);
  const occupancy = new Map();
  for (const building of grid.buildings) {
    if (building.id === ignoreBuildingId) continue;
    const definition = getBuildingDefinition(building, catalog);
    for (const cell of getBuildingCells(building, catalog)) {
      const key = cellKey(cell);
      if (occupancy.has(key)) {
        throw new GridRuleError(
          'OVERLAPPING_GRID_STATE',
          `Buildings overlap at ${key}.`,
          { cell, buildingIds: [occupancy.get(key).building.id, building.id] },
        );
      }
      occupancy.set(key, { building, definition, cell });
    }
  }
  return occupancy;
}

export function getCellOccupant(grid, cell, catalog = {}) {
  if (!isCellInBounds(grid, cell)) return null;
  return getOccupancyMap(grid, catalog).get(cellKey(cell)) ?? null;
}

export function validateBuildingPlacement(
  grid,
  building,
  catalog = {},
  { ignoreBuildingId = null } = {},
) {
  try {
    assertGrid(grid);
    if (!building || typeof building.id !== 'string' || building.id.length === 0) {
      return placementFailure('INVALID_BUILDING_ID', 'A building needs a non-empty string id.');
    }
    const duplicate = grid.buildings.some(
      (candidate) => candidate.id === building.id && candidate.id !== ignoreBuildingId,
    );
    if (duplicate) {
      return placementFailure(
        'DUPLICATE_BUILDING_ID',
        `A building with id ${building.id} already exists.`,
      );
    }

    const cells = getBuildingCells(building, catalog);
    const outside = cells.filter((cell) => !isCellInBounds(grid, cell));
    if (outside.length > 0) {
      return placementFailure(
        'OUT_OF_BOUNDS',
        'The building footprint extends outside the grid.',
        { cells, outside },
      );
    }

    const occupancy = getOccupancyMap(grid, catalog, { ignoreBuildingId });
    const conflicts = cells
      .map((cell) => ({ cell, occupant: occupancy.get(cellKey(cell)) }))
      .filter((entry) => entry.occupant)
      .map((entry) => ({ cell: entry.cell, buildingId: entry.occupant.building.id }));
    if (conflicts.length > 0) {
      return placementFailure(
        'OCCUPIED',
        'The building footprint overlaps another building.',
        { cells, conflicts },
      );
    }

    return { ok: true, cells };
  } catch (error) {
    if (error instanceof GridRuleError) {
      return placementFailure(error.code, error.message, error.details);
    }
    throw error;
  }
}

export function canPlaceBuilding(grid, building, catalog = {}, options = {}) {
  return validateBuildingPlacement(grid, building, catalog, options).ok;
}

/** Return a new grid; the original grid and buildings are never mutated. */
export function placeBuilding(grid, building, catalog = {}) {
  const validation = validateBuildingPlacement(grid, building, catalog);
  if (!validation.ok) throwPlacementFailure(validation);
  const position = positionOf(building);
  const placed = {
    ...cloneBuilding(building),
    x: position.x,
    y: position.y,
    rotation: normalizeRotation(building.rotation ?? 0),
  };
  delete placed.position;
  return { ...grid, buildings: [...grid.buildings, placed] };
}

export function moveBuilding(grid, buildingId, destination, catalog = {}) {
  assertGrid(grid);
  const index = grid.buildings.findIndex((building) => building.id === buildingId);
  if (index < 0) {
    throw new GridRuleError('BUILDING_NOT_FOUND', `Building not found: ${buildingId}`);
  }
  const current = grid.buildings[index];
  const destinationPosition = {
    x: destination?.x ?? destination?.position?.x ?? current.x,
    y: destination?.y ?? destination?.position?.y ?? current.y,
  };
  const candidate = {
    ...current,
    ...destination,
    x: destinationPosition.x,
    y: destinationPosition.y,
    rotation: destination?.rotation ?? current.rotation ?? 0,
  };
  delete candidate.position;
  const validation = validateBuildingPlacement(grid, candidate, catalog, {
    ignoreBuildingId: buildingId,
  });
  if (!validation.ok) throwPlacementFailure(validation);

  const moved = {
    ...candidate,
    rotation: normalizeRotation(candidate.rotation),
  };
  const buildings = grid.buildings.map((building, buildingIndex) => (
    buildingIndex === index ? moved : building
  ));
  return { ...grid, buildings };
}

export function rotateBuilding(grid, buildingId, rotationDelta, catalog = {}) {
  const building = grid.buildings.find((candidate) => candidate.id === buildingId);
  if (!building) {
    throw new GridRuleError('BUILDING_NOT_FOUND', `Building not found: ${buildingId}`);
  }
  const nextRotation = normalizeRotation(
    normalizeRotation(building.rotation ?? 0) + normalizeRotation(rotationDelta),
  );
  return moveBuilding(grid, buildingId, { rotation: nextRotation }, catalog);
}

export function demolishBuilding(grid, buildingId) {
  assertGrid(grid);
  const index = grid.buildings.findIndex((building) => building.id === buildingId);
  if (index < 0) {
    throw new GridRuleError('BUILDING_NOT_FOUND', `Building not found: ${buildingId}`);
  }
  return {
    ...grid,
    buildings: grid.buildings.filter((building) => building.id !== buildingId),
  };
}

export const removeBuilding = demolishBuilding;

/**
 * Build an immutable row-major navigation matrix. A blocking building may be
 * breached unless its breachCost is Infinity.
 */
export function createNavigationGrid(grid, catalog = {}) {
  assertGrid(grid);
  const occupancy = getOccupancyMap(grid, catalog);
  return Array.from({ length: grid.height }, (_, y) => (
    Array.from({ length: grid.width }, (_, x) => {
      const occupied = occupancy.get(cellKey(x, y));
      if (!occupied) {
        return Object.freeze({
          x,
          y,
          buildingId: null,
          blocksPath: false,
          breachCost: 0,
          moveCost: 1,
        });
      }
      const traits = buildingNavigationTraits(occupied.definition);
      return Object.freeze({
        x,
        y,
        buildingId: occupied.building.id,
        buildingType: buildingTypeOf(occupied.building),
        ...traits,
      });
    })
  ));
}

/**
 * Dijkstra pathfinder for arbitrary endpoints. Entering a contiguous blocking
 * building pays its breach cost once, even if its footprint spans several cells.
 */
export function findGridPath(grid, catalog = {}, {
  starts,
  goals,
  allowBreaching = false,
  directions = CARDINAL_DIRECTIONS,
} = {}) {
  assertGrid(grid);
  const normalizedStarts = normalizeCellList(starts, grid, 'starts');
  const normalizedGoals = normalizeCellList(goals, grid, 'goals');
  const goalKeys = new Set(normalizedGoals.map(cellKey));
  const navigation = createNavigationGrid(grid, catalog);
  const queue = [];
  const distances = new Map();
  const previous = new Map();
  let sequence = 0;

  const enqueue = (cell, cost, from = null) => {
    const key = cellKey(cell);
    distances.set(key, cost);
    previous.set(key, from);
    queue.push({ cell, cost, sequence: sequence += 1 });
  };

  for (const start of normalizedStarts) {
    const navigationCell = navigation[start.y][start.x];
    if (navigationCell.blocksPath && (!allowBreaching || navigationCell.breachCost === Infinity)) {
      continue;
    }
    const initialCost = navigationCell.moveCost
      + (navigationCell.blocksPath ? navigationCell.breachCost : 0);
    const key = cellKey(start);
    if (!distances.has(key) || initialCost < distances.get(key)) {
      enqueue(start, initialCost);
    }
  }

  let reached = null;
  while (queue.length > 0) {
    queue.sort((a, b) => (
      a.cost - b.cost
      || a.cell.x - b.cell.x
      || a.cell.y - b.cell.y
      || a.sequence - b.sequence
    ));
    const current = queue.shift();
    const currentKey = cellKey(current.cell);
    if (current.cost !== distances.get(currentKey)) continue;
    if (goalKeys.has(currentKey)) {
      reached = current.cell;
      break;
    }

    const currentNavigation = navigation[current.cell.y][current.cell.x];
    for (const direction of directions) {
      const neighbor = {
        x: current.cell.x + direction.x,
        y: current.cell.y + direction.y,
      };
      if (!isCellInBounds(grid, neighbor)) continue;
      const nextNavigation = navigation[neighbor.y][neighbor.x];
      if (nextNavigation.blocksPath
        && (!allowBreaching || nextNavigation.breachCost === Infinity)) {
        continue;
      }

      const entersNewBlockingBuilding = nextNavigation.blocksPath
        && nextNavigation.buildingId !== currentNavigation.buildingId;
      const edgeCost = nextNavigation.moveCost
        + (entersNewBlockingBuilding ? nextNavigation.breachCost : 0);
      const nextCost = current.cost + edgeCost;
      const neighborKey = cellKey(neighbor);
      if (!distances.has(neighborKey) || nextCost < distances.get(neighborKey)) {
        enqueue(neighbor, nextCost, current.cell);
      }
    }
  }

  if (!reached) return null;

  const path = [];
  let cursor = reached;
  while (cursor) {
    path.push(cursor);
    cursor = previous.get(cellKey(cursor));
  }
  path.reverse();

  const breachedBuildingIds = [];
  const seenBreaches = new Set();
  for (const cell of path) {
    const navigationCell = navigation[cell.y][cell.x];
    if (navigationCell.blocksPath && !seenBreaches.has(navigationCell.buildingId)) {
      seenBreaches.add(navigationCell.buildingId);
      breachedBuildingIds.push(navigationCell.buildingId);
    }
  }

  return {
    cells: path,
    totalCost: distances.get(cellKey(reached)),
    breachedBuildingIds,
    requiresBreach: breachedBuildingIds.length > 0,
  };
}

/**
 * Find a route from the right edge toward the left-side core. Open routes always
 * win; only when no open route exists is the cheapest finite breach route used.
 */
export function findRightToLeftRoute(grid, catalog = {}, options = {}) {
  assertGrid(grid);
  const rows = Array.from({ length: grid.height }, (_, row) => row);
  const startRows = options.startRows ?? options.entryRows
    ?? (options.startRow == null ? rows : [options.startRow]);
  const goalRows = options.goalRows
    ?? (options.goalRow == null ? rows : [options.goalRow]);
  const starts = options.starts
    ?? (options.start ? [options.start] : startRows.map((y) => ({ x: grid.width - 1, y })));
  const goals = options.goals
    ?? (options.goal ? [options.goal] : goalRows.map((y) => ({ x: 0, y })));

  const pathOptions = { starts, goals, directions: options.directions };
  const openRoute = findGridPath(grid, catalog, {
    ...pathOptions,
    allowBreaching: false,
  });
  if (openRoute) return { ...openRoute, mode: 'open' };

  if (options.allowBreach === false || options.allowBreaching === false) return null;
  const breachRoute = findGridPath(grid, catalog, {
    ...pathOptions,
    allowBreaching: true,
  });
  return breachRoute ? { ...breachRoute, mode: 'breach' } : null;
}

export const findRouteRightToLeft = findRightToLeftRoute;
export const findRightToLeftPath = findRightToLeftRoute;

export function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Generate clipped cells for skill and item target previews. */
export function getCellsInPattern(grid, origin = { x: 0, y: 0 }, {
  shape = 'single',
  radius = 0,
  radiusX = radius,
  radiusY = radius,
  direction = 'left',
  length = Math.max(grid.width, grid.height),
  includeOrigin = true,
} = {}) {
  assertGrid(grid);
  if (!isCellInBounds(grid, origin)) {
    throw new GridRuleError('TARGET_ORIGIN_OUT_OF_BOUNDS', 'Target pattern origin is outside the grid.');
  }
  if (!Number.isInteger(radius) || radius < 0
    || !Number.isInteger(radiusX) || radiusX < 0
    || !Number.isInteger(radiusY) || radiusY < 0
    || !Number.isInteger(length) || length < 1) {
    throw new GridRuleError('INVALID_TARGET_PATTERN', 'Target radii must be non-negative and length positive.');
  }

  if (shape === 'line') {
    const vector = typeof direction === 'string' ? DIRECTION_VECTORS[direction] : direction;
    if (!vector || !isFiniteInteger(vector.x) || !isFiniteInteger(vector.y)
      || Math.abs(vector.x) + Math.abs(vector.y) !== 1) {
      throw new GridRuleError('INVALID_TARGET_DIRECTION', 'A line needs a cardinal direction.');
    }
    const cells = [];
    for (let step = includeOrigin ? 0 : 1; step < length + (includeOrigin ? 0 : 1); step += 1) {
      const cell = { x: origin.x + vector.x * step, y: origin.y + vector.y * step };
      if (!isCellInBounds(grid, cell)) break;
      cells.push(cell);
    }
    return cells;
  }

  const cells = [];
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const dx = Math.abs(x - origin.x);
      const dy = Math.abs(y - origin.y);
      let matches = false;
      switch (shape) {
        case 'single': matches = dx === 0 && dy === 0; break;
        case 'diamond': matches = dx + dy <= radius; break;
        case 'square': matches = Math.max(dx, dy) <= radius; break;
        case 'cross': matches = (dx === 0 || dy === 0) && dx + dy <= radius; break;
        case 'row': matches = y === origin.y; break;
        case 'column': matches = x === origin.x; break;
        case 'rectangle': matches = dx <= radiusX && dy <= radiusY; break;
        case 'all': matches = true; break;
        default:
          throw new GridRuleError('INVALID_TARGET_PATTERN', `Unknown target shape: ${shape}`);
      }
      if (matches && (includeOrigin || dx !== 0 || dy !== 0)) cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * Filter cells by a declarative targeting rule.
 * occupancy: any | empty | building | blocking-building | walkable
 */
export function getTargetableCells(grid, catalog = {}, rule = {}) {
  assertGrid(grid);
  const shape = rule.shape ?? (rule.origin ? 'single' : 'all');
  const origin = rule.origin ?? { x: 0, y: 0 };
  const candidates = getCellsInPattern(grid, origin, { ...rule, shape });
  const occupancy = getOccupancyMap(grid, catalog, {
    ignoreBuildingId: rule.ignoreBuildingId ?? null,
  });
  const allowedTypes = toArray(rule.buildingTypes);
  const allowedIds = toArray(rule.buildingIds);

  return candidates.filter((cell) => {
    const occupant = occupancy.get(cellKey(cell)) ?? null;
    const traits = occupant ? buildingNavigationTraits(occupant.definition) : null;
    switch (rule.occupancy ?? rule.requires ?? 'any') {
      case 'any': break;
      case 'empty': if (occupant) return false; break;
      case 'building': if (!occupant) return false; break;
      case 'blocking-building': if (!occupant || !traits.blocksPath) return false; break;
      case 'walkable': if (occupant && traits.blocksPath) return false; break;
      default:
        throw new GridRuleError(
          'INVALID_TARGET_OCCUPANCY',
          `Unknown occupancy rule: ${rule.occupancy ?? rule.requires}`,
        );
    }
    if (allowedTypes && (!occupant || !allowedTypes.includes(buildingTypeOf(occupant.building)))) {
      return false;
    }
    if (allowedIds && (!occupant || !allowedIds.includes(occupant.building.id))) return false;
    return !rule.predicate || rule.predicate(cell, occupant);
  });
}

export function validateCellTarget(grid, cell, catalog = {}, rule = {}) {
  if (!isCellInBounds(grid, cell)) {
    return placementFailure('TARGET_OUT_OF_BOUNDS', 'The target cell is outside the grid.', { cell });
  }
  const targetable = getTargetableCells(grid, catalog, rule);
  if (!targetable.some((candidate) => candidate.x === cell.x && candidate.y === cell.y)) {
    return placementFailure('INVALID_TARGET', 'The cell does not satisfy the targeting rule.', { cell });
  }
  return { ok: true, cell: { x: cell.x, y: cell.y }, occupant: getCellOccupant(grid, cell, catalog) };
}

/** Filter survivor/enemy candidates without mutating or cloning them. */
export function getTargetableEntities(entities, rule = {}) {
  if (!Array.isArray(entities)) throw new TypeError('entities must be an array.');
  const factions = toArray(rule.factions ?? rule.faction);
  const types = toArray(rule.types ?? rule.type);
  const excludedIds = new Set(toArray(rule.excludeIds) ?? []);
  const allowedCellKeys = rule.cells ? new Set(rule.cells.map(cellKey)) : null;
  const metric = rule.metric === 'chebyshev' ? chebyshevDistance : manhattanDistance;

  return entities.filter((entity) => {
    const position = entityPosition(entity);
    if (!isFiniteInteger(position.x) || !isFiniteInteger(position.y)) return false;
    if ((rule.aliveOnly ?? true) && (entity.alive === false || entity.hp <= 0)) return false;
    if (excludedIds.has(entity.id)) return false;
    if (factions && !factions.includes(entity.faction)) return false;
    if (types && !types.includes(entity.type ?? entity.kind)) return false;
    if (allowedCellKeys && !allowedCellKeys.has(cellKey(position))) return false;
    if (rule.origin && rule.range != null && metric(rule.origin, position) > rule.range) return false;
    return !rule.predicate || rule.predicate(entity, position);
  });
}

function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const text = String(seed);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Mulberry32: compact, deterministic and sufficient for gameplay simulation. */
export function createSeededRng(seed = 0) {
  let state = hashSeed(seed);
  const rng = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  rng.getState = () => state;
  return rng;
}

export function randomInt(min, maxExclusive, rng = Math.random) {
  if (!isFiniteInteger(min) || !isFiniteInteger(maxExclusive) || maxExclusive <= min) {
    throw new RangeError('randomInt needs integer bounds with maxExclusive > min.');
  }
  return min + Math.floor(readRng(rng) * (maxExclusive - min));
}

export function pickRandom(items, rng = Math.random) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new RangeError('pickRandom needs a non-empty array.');
  }
  return items[randomInt(0, items.length, rng)];
}

export function shuffle(items, rng = Math.random) {
  if (!Array.isArray(items)) throw new TypeError('shuffle needs an array.');
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = randomInt(0, index + 1, rng);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** Entries can be { value, weight } or any object carrying a weight property. */
export function weightedPick(entries, rng = Math.random) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new RangeError('weightedPick needs a non-empty array.');
  }
  let total = 0;
  for (const entry of entries) {
    if (typeof entry?.weight !== 'number' || !Number.isFinite(entry.weight) || entry.weight < 0) {
      throw new RangeError('Every weighted entry needs a finite, non-negative weight.');
    }
    total += entry.weight;
  }
  if (total <= 0) throw new RangeError('At least one weight must be positive.');

  let roll = readRng(rng) * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll < 0) return Object.hasOwn(entry, 'value') ? entry.value : entry;
  }
  const fallback = entries.at(-1);
  return Object.hasOwn(fallback, 'value') ? fallback.value : fallback;
}
