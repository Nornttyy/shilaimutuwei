import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GRID_HEIGHT,
  GRID_WIDTH,
  GridRuleError,
  canPlaceBuilding,
  createGridState,
  createSeededRng,
  demolishBuilding,
  findGridPath,
  findRightToLeftRoute,
  getBuildingCells,
  getCellsInPattern,
  getTargetableCells,
  getTargetableEntities,
  moveBuilding,
  pickRandom,
  placeBuilding,
  randomInt,
  rotateShape,
  shuffle,
  validateBuildingPlacement,
  validateCellTarget,
  validateShape,
  weightedPick,
} from '../src/core.js';

const catalog = Object.freeze({
  tower: Object.freeze({
    shape: Object.freeze([[0, 0]]),
    blocksPath: true,
    breachCost: 12,
  }),
  fence: Object.freeze({
    shape: Object.freeze([[0, 0], [1, 0]]),
    blocksPath: true,
    breachCost: 5,
  }),
  honey: Object.freeze({
    shape: Object.freeze([[0, 0]]),
    blocksPath: false,
    pathCost: 2,
  }),
  highWall: Object.freeze({
    shape: Object.freeze([[0, 0]]),
    blocksPath: true,
    breachCost: 50,
  }),
  lowWall: Object.freeze({
    shape: Object.freeze([[0, 0]]),
    blocksPath: true,
    breachCost: 1,
  }),
  permanentWall: Object.freeze({
    shape: Object.freeze([[0, 0]]),
    blocksPath: true,
    breachCost: Infinity,
  }),
  tallWall: Object.freeze({
    shape: Object.freeze([
      [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
    ]),
    blocksPath: true,
    breachCost: 7,
  }),
});

function building(id, type, x, y, rotation = 0) {
  return { id, type, x, y, rotation };
}

function gridWith(buildings) {
  return createGridState({ buildings });
}

test('creates the fixed 6x6 battlefield by default', () => {
  const grid = createGridState();
  assert.equal(GRID_WIDTH, 6);
  assert.equal(GRID_HEIGHT, 6);
  assert.deepEqual(grid, { width: 6, height: 6, buildings: [] });
});

test('validates connected shapes and rotates normalized footprints', () => {
  assert.equal(validateShape([[0, 0], [1, 1]]).code, 'DISCONNECTED_SHAPE');
  assert.equal(validateShape([[0, 0], [0, 0]]).code, 'INVALID_SHAPE');

  assert.deepEqual(rotateShape([[0, 0], [1, 0]], 1), [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
  ]);
  assert.deepEqual(rotateShape([[0, 0], [1, 0]], 180), [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ]);
});

test('placement checks rotated bounds, overlap, and duplicate ids', () => {
  const empty = createGridState();
  const first = building('fence-1', 'fence', 1, 1);
  const placed = placeBuilding(empty, first, catalog);

  assert.equal(empty.buildings.length, 0, 'placeBuilding must not mutate its input');
  assert.deepEqual(getBuildingCells(placed.buildings[0], catalog), [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
  ]);

  const overlap = validateBuildingPlacement(
    placed,
    building('tower-1', 'tower', 2, 1),
    catalog,
  );
  assert.equal(overlap.ok, false);
  assert.equal(overlap.code, 'OCCUPIED');
  assert.deepEqual(overlap.conflicts, [{ cell: { x: 2, y: 1 }, buildingId: 'fence-1' }]);

  assert.equal(
    validateBuildingPlacement(placed, building('fence-1', 'tower', 4, 4), catalog).code,
    'DUPLICATE_BUILDING_ID',
  );
  assert.equal(
    validateBuildingPlacement(empty, building('edge', 'fence', 5, 5, 1), catalog).code,
    'OUT_OF_BOUNDS',
  );
  assert.equal(canPlaceBuilding(empty, building('edge', 'fence', 4, 4, 1), catalog), true);
});

test('accepts catalog rectangle footprints and solid/passable navigation fields', () => {
  const productionCatalog = [{
    id: 'building-bouncy-fence',
    type: 'building',
    footprint: { width: 2, height: 1 },
    solid: true,
    passable: false,
    hp: 340,
  }];
  const fence = {
    id: 'placed-fence',
    definitionId: 'building-bouncy-fence',
    x: 2,
    y: 3,
    rotation: 1,
  };
  assert.deepEqual(getBuildingCells(fence, productionCatalog), [
    { x: 2, y: 3 },
    { x: 2, y: 4 },
  ]);
  assert.equal(canPlaceBuilding(createGridState(), fence, productionCatalog), true);
});

test('moving, rotating, and demolishing are immutable operations', () => {
  const initial = placeBuilding(
    placeBuilding(createGridState(), building('fence-1', 'fence', 1, 1), catalog),
    building('tower-1', 'tower', 3, 1),
    catalog,
  );
  const moved = moveBuilding(initial, 'fence-1', { x: 4, y: 4, rotation: 1 }, catalog);

  assert.deepEqual(positionOfId(initial, 'fence-1'), { x: 1, y: 1, rotation: 0 });
  assert.deepEqual(getBuildingCells(moved.buildings[0], catalog), [
    { x: 4, y: 4 },
    { x: 4, y: 5 },
  ]);
  assert.throws(
    () => moveBuilding(initial, 'fence-1', { x: 2, y: 1 }, catalog),
    (error) => error instanceof GridRuleError && error.code === 'OCCUPIED',
  );

  const demolished = demolishBuilding(moved, 'tower-1');
  assert.deepEqual(demolished.buildings.map(({ id }) => id), ['fence-1']);
  assert.equal(moved.buildings.length, 2, 'demolishBuilding must not mutate its input');
});

test('empty right-to-left route is deterministic and stays in the requested row', () => {
  const route = findRightToLeftRoute(createGridState(), catalog, {
    startRow: 2,
    goalRow: 2,
  });

  assert.equal(route.mode, 'open');
  assert.equal(route.requiresBreach, false);
  assert.deepEqual(route.cells, [5, 4, 3, 2, 1, 0].map((x) => ({ x, y: 2 })));
  assert.equal(route.totalCost, 6);
});

test('an available open route is preferred over breaking a shorter wall', () => {
  const wallWithGap = [];
  for (let y = 0; y < 6; y += 1) {
    if (y !== 4) wallWithGap.push(building(`wall-${y}`, 'lowWall', 3, y));
  }
  const route = findRightToLeftRoute(gridWith(wallWithGap), catalog, {
    startRow: 2,
    goalRow: 2,
  });

  assert.equal(route.mode, 'open');
  assert.equal(route.requiresBreach, false);
  assert.ok(route.cells.some((cell) => cell.x === 3 && cell.y === 4));
  assert.ok(!route.cells.some((cell) => cell.x === 3 && cell.y !== 4));
});

test('when sealed, breach routing chooses the lowest total obstruction cost', () => {
  const fullWall = Array.from({ length: 6 }, (_, y) => (
    building(`wall-${y}`, y === 5 ? 'lowWall' : 'highWall', 3, y)
  ));
  const grid = gridWith(fullWall);
  const route = findRightToLeftRoute(grid, catalog, { startRow: 2, goalRow: 2 });

  assert.equal(route.mode, 'breach');
  assert.equal(route.requiresBreach, true);
  assert.deepEqual(route.breachedBuildingIds, ['wall-5']);
  assert.ok(route.cells.some((cell) => cell.x === 3 && cell.y === 5));
  assert.equal(
    findRightToLeftRoute(grid, catalog, {
      startRow: 2,
      goalRow: 2,
      allowBreach: false,
    }),
    null,
  );
});

test('a multi-cell blocker charges breach cost once and permanent blockers remain impassable', () => {
  const tallGrid = gridWith([building('single-wall', 'tallWall', 3, 0)]);
  const route = findRightToLeftRoute(tallGrid, catalog, { startRow: 2, goalRow: 2 });
  assert.equal(route.mode, 'breach');
  assert.deepEqual(route.breachedBuildingIds, ['single-wall']);
  assert.equal(route.totalCost, 13, 'six entered cells plus one seven-point breach');

  const permanent = gridWith(Array.from(
    { length: 6 },
    (_, y) => building(`permanent-${y}`, 'permanentWall', 3, y),
  ));
  assert.equal(
    findGridPath(permanent, catalog, {
      starts: [{ x: 5, y: 2 }],
      goals: [{ x: 0, y: 2 }],
      allowBreaching: true,
    }),
    null,
  );
});

test('target patterns clip to the grid and support lines, areas, and occupancy rules', () => {
  const grid = gridWith([
    building('tower-1', 'tower', 2, 2),
    building('honey-1', 'honey', 1, 1),
  ]);

  assert.deepEqual(getCellsInPattern(grid, { x: 0, y: 0 }, {
    shape: 'diamond',
    radius: 1,
  }), [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ]);
  assert.deepEqual(getCellsInPattern(grid, { x: 3, y: 2 }, {
    shape: 'line',
    direction: 'left',
    length: 3,
  }), [
    { x: 3, y: 2 },
    { x: 2, y: 2 },
    { x: 1, y: 2 },
  ]);

  assert.equal(getTargetableCells(grid, catalog, {
    shape: 'all',
    occupancy: 'empty',
  }).length, 34);
  assert.equal(getTargetableCells(grid, catalog, {
    shape: 'all',
    occupancy: 'walkable',
  }).length, 35, 'walkable terrain buildings remain valid path targets');
  assert.deepEqual(getTargetableCells(grid, catalog, {
    shape: 'all',
    occupancy: 'blocking-building',
  }), [{ x: 2, y: 2 }]);

  assert.equal(validateCellTarget(grid, { x: 2, y: 2 }, catalog, {
    shape: 'all',
    occupancy: 'building',
  }).ok, true);
  assert.equal(validateCellTarget(grid, { x: 4, y: 4 }, catalog, {
    shape: 'all',
    occupancy: 'building',
  }).code, 'INVALID_TARGET');
});

test('entity targeting supports faction, life state, range, cell sets, and exclusions', () => {
  const entities = [
    { id: 'enemy-near', faction: 'enemy', type: 'grunt', x: 2, y: 1, hp: 5 },
    { id: 'enemy-far', faction: 'enemy', type: 'grunt', x: 5, y: 5, hp: 5 },
    { id: 'enemy-down', faction: 'enemy', type: 'grunt', x: 1, y: 2, hp: 0 },
    { id: 'ally', faction: 'ally', type: 'slime', x: 1, y: 1, hp: 5 },
  ];

  assert.deepEqual(getTargetableEntities(entities, {
    faction: 'enemy',
    origin: { x: 1, y: 1 },
    range: 2,
  }).map(({ id }) => id), ['enemy-near']);
  assert.deepEqual(getTargetableEntities(entities, {
    faction: 'enemy',
    aliveOnly: false,
    cells: [{ x: 1, y: 2 }],
  }).map(({ id }) => id), ['enemy-down']);
});

test('seeded random helpers are reproducible, injectable, and non-mutating', () => {
  const first = createSeededRng('slime-haven');
  const second = createSeededRng('slime-haven');
  assert.deepEqual(
    Array.from({ length: 8 }, () => first()),
    Array.from({ length: 8 }, () => second()),
  );

  assert.equal(randomInt(4, 10, () => 0), 4);
  assert.equal(randomInt(4, 10, () => 0.999999), 9);
  assert.equal(pickRandom(['a', 'b', 'c'], () => 0.5), 'b');
  assert.equal(weightedPick([
    { value: 'common', weight: 86.92 },
    { value: 'advanced', weight: 13 },
    { value: 'ultimate', weight: 0.08 },
  ], () => 0.9999), 'ultimate');

  const source = [1, 2, 3, 4, 5];
  const shuffledA = shuffle(source, createSeededRng(42));
  const shuffledB = shuffle(source, createSeededRng(42));
  assert.deepEqual(shuffledA, shuffledB);
  assert.deepEqual(source, [1, 2, 3, 4, 5]);
});

function positionOfId(grid, id) {
  const { x, y, rotation } = grid.buildings.find((candidate) => candidate.id === id);
  return { x, y, rotation };
}
