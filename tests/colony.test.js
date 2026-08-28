import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COLONY_AI_STATES,
  COLONY_RESOURCE_TYPES,
  COLONY_THINK_INTERVAL,
  addBlueprint,
  addColonySlime,
  addColonyThreat,
  addResourceNode,
  canPlaceBlueprint,
  cancelColonySlimeWork,
  createColonyState,
  downColonySlime,
  findColonyPath,
  setColonyRallyPoint,
  setColonyThreatIntensity,
  setColonyThreats,
  setTerrainAt,
  terrainAt,
  updateColony,
} from '../src/colony.js';

function advance(state, seconds, dt = 0.05) {
  const events = [];
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) {
    events.push(...updateColony(state, Math.min(dt, seconds - elapsed)));
  }
  return events;
}

test('exports the agreed resources, AI states, and quarter-second think interval', () => {
  assert.deepEqual(COLONY_RESOURCE_TYPES, ['gel', 'nectar', 'shard']);
  assert.equal(COLONY_THINK_INTERVAL, 0.25);
  assert.deepEqual(COLONY_AI_STATES, [
    'idle', 'seek', 'move', 'harvest', 'carry', 'deposit', 'build',
    'rally', 'chase', 'attack', 'rest', 'downed',
  ]);
});

test('supports a 24x16 world, rejects outside entities and has no 6x6 assumptions', () => {
  const state = createColonyState({ bounds: { x: 0, y: 0, width: 24, height: 16 }, basePosition: { x: 1, y: 1 } });
  assert.doesNotThrow(() => addColonySlime(state, { x: 23, y: 15 }));
  assert.doesNotThrow(() => addResourceNode(state, { x: 20, y: 12, resourceType: 'gel', amount: 3 }));
  assert.throws(() => addColonySlime(state, { x: 24, y: 15 }), /inside world/);
  assert.throws(() => addResourceNode(state, { x: -1, y: 2, resourceType: 'gel' }), /inside world/);
  assert.equal(canPlaceBlueprint(state, { x: 23, y: 15, footprint: { width: 2, height: 1 } }), false);
});

test('terrain capabilities govern paths and blueprint placement', () => {
  const state = createColonyState({ bounds: { width: 24, height: 16 }, basePosition: { x: 0, y: 0 } });
  setTerrainAt(state, 3, 2, { kind: 'obstacle' });
  setTerrainAt(state, 4, 2, { kind: 'destructible', durability: 2 });
  setTerrainAt(state, 5, 2, { kind: 'indestructible' });
  setTerrainAt(state, 6, 2, { kind: 'resource', harvestable: true, passable: true });
  assert.equal(terrainAt(state, 3, 2).passable, false);
  assert.equal(terrainAt(state, 4, 2).destructible, true);
  assert.equal(terrainAt(state, 5, 2).destructible, false);
  assert.equal(terrainAt(state, 6, 2).harvestable, true);
  assert.equal(canPlaceBlueprint(state, { x: 2, y: 2 }), true);
  assert.equal(canPlaceBlueprint(state, { x: 3, y: 2 }), false);
  assert.equal(canPlaceBlueprint(state, { x: 4, y: 2 }), false);
  assert.equal(canPlaceBlueprint(state, { x: 5, y: 2 }), false);
  assert.equal(canPlaceBlueprint(state, { x: 6, y: 2 }), false);
  const terrainProject = {
    replacementTerrainId: 'ground',
    allowBuildableGround: false,
    allowHarvestableTerrain: true,
  };
  assert.equal(canPlaceBlueprint(state, { x: 2, y: 2, terrainProject }), false, 'paving clear ground would waste materials');
  assert.equal(canPlaceBlueprint(state, { x: 6, y: 2, terrainProject }), true, 'a passable resource cell can be paved');
  assert.equal(canPlaceBlueprint(state, { x: 3, y: 2, terrainProject }), false, 'permanent blockers cannot be paved');
  addResourceNode(state, { uid: 'paving-node', x: 7, y: 2, resourceType: 'gel', amount: 2 });
  assert.equal(canPlaceBlueprint(state, { x: 7, y: 2, terrainProject }), true, 'the terrain project owns resource cleanup');
  const completed = addBlueprint(state, { uid: 'old-plan', x: 8, y: 2 });
  completed.complete = true;
  assert.equal(canPlaceBlueprint(state, { x: 8, y: 2 }), true, 'completed blueprints never reserve a cell');
  const path = findColonyPath(state, { x: 2, y: 2 }, { x: 7, y: 2 });
  assert.ok(path.length > 5, 'path must route around blocked terrain');
  assert.ok(!path.some(({ x, y }) => y === 2 && [3, 4, 5].includes(x)));
});

test('uses an injected pathfinder and rejects paths containing outside steps', () => {
  let request = null;
  const state = createColonyState({
    bounds: { width: 24, height: 16 },
    basePosition: { x: 1, y: 1 },
    findPath(input) {
      request = input;
      return [{ x: 2, y: 1 }, { x: 99, y: 99 }, { x: 3, y: 1 }];
    },
  });
  const path = findColonyPath(state, { x: 1, y: 1 }, { x: 3, y: 1 });
  assert.equal(request.bounds.width, 24);
  assert.equal(request.bounds.height, 16);
  assert.equal(request.isPassable(2, 1), true);
  assert.deepEqual(path, []);

  state.findPath = ({ to }) => [{ x: 2, y: 1 }, { ...to }];
  assert.deepEqual(
    findColonyPath(state, { x: 1, y: 1 }, { x: 3, y: 1 }),
    [{ x: 2, y: 1 }, { x: 3, y: 1 }],
  );
});

test('slime harvests a node, carries it home, deposits it, and leaves ground', () => {
  const state = createColonyState({
    bounds: { width: 24, height: 16 },
    basePosition: { x: 1, y: 1 },
    config: { passiveThreatPerSecond: 0 },
  });
  addColonySlime(state, { uid: 'worker', x: 1, y: 1, speed: 4, carryCapacity: 2 });
  const node = addResourceNode(state, { uid: 'gel-node', x: 3, y: 1, resourceType: 'gel', amount: 2, harvestSeconds: 0.2 });
  const events = advance(state, 3);
  assert.equal(node.amount, 0);
  assert.equal(state.resources.gel, 2);
  assert.equal(terrainAt(state, 3, 1).kind, 'ground');
  assert.ok(events.some((event) => event.type === 'resource-depleted'));
  assert.ok(events.some((event) => event.type === 'resource-deposited'));
});

test('slime delivers stockpile materials then constructs a blueprint', () => {
  const state = createColonyState({
    bounds: { width: 24, height: 16 },
    basePosition: { x: 1, y: 1 },
    resources: { gel: 2 },
    config: { passiveThreatPerSecond: 0 },
  });
  addColonySlime(state, { uid: 'builder', x: 1, y: 1, speed: 5, carryCapacity: 2, buildMultiplier: 2 });
  const blueprint = addBlueprint(state, { uid: 'hut', cardId: 'building-hut', x: 4, y: 1, required: { gel: 2 }, buildSeconds: 0.5 });
  const events = advance(state, 4);
  assert.equal(state.resources.gel, 0);
  assert.equal(blueprint.delivered.gel, 2);
  assert.equal(blueprint.complete, true);
  assert.ok(events.some((event) => event.type === 'material-delivered'));
  assert.ok(events.some((event) => event.type === 'blueprint-completed'));
});

test('destructible obstacle becomes ground while an indestructible obstacle remains', () => {
  const state = createColonyState({
    bounds: { width: 24, height: 16 },
    basePosition: { x: 1, y: 1 },
    workPriorities: { clear: 5, gather: 1, build: 1 },
    config: { passiveThreatPerSecond: 0, obstacleDamagePerSecond: 10 },
  });
  setTerrainAt(state, 2, 1, { kind: 'destructible', durability: 1 });
  setTerrainAt(state, 3, 1, { kind: 'indestructible' });
  addColonySlime(state, { x: 1, y: 1, speed: 4 });
  const events = advance(state, 1);
  assert.equal(terrainAt(state, 2, 1).kind, 'ground');
  assert.equal(terrainAt(state, 3, 1).kind, 'indestructible');
  assert.ok(events.some((event) => event.type === 'terrain-cleared'));
});

test('quarter-second thinking and job lock prevent per-frame target churn', () => {
  let pathCalls = 0;
  const state = createColonyState({
    bounds: { width: 24, height: 16 },
    basePosition: { x: 1, y: 1 },
    config: { passiveThreatPerSecond: 0, thinkInterval: 0.25, jobLockSeconds: 2 },
    findPath(request) {
      pathCalls += 1;
      return [{ ...request.to }];
    },
  });
  const slime = addColonySlime(state, { uid: 'steady', x: 1, y: 1, speed: 0.1 });
  addResourceNode(state, { x: 10, y: 1, resourceType: 'gel', amount: 5 });
  updateColony(state, 0.01);
  const lockedJob = slime.job.uid;
  const callsAfterThink = pathCalls;
  for (let index = 0; index < 20; index += 1) updateColony(state, 0.01);
  assert.equal(slime.job.uid, lockedJob);
  assert.equal(pathCalls, callsAfterThink, 'movement frames must not repath before the thought lock');
});

test('continuous threat clock emits warnings without any day or night phase', () => {
  const state = createColonyState({
    bounds: { width: 24, height: 16 },
    config: { passiveThreatPerSecond: 0.25, threatWarningThresholds: [0.25, 0.5] },
  });
  const events = updateColony(state, 2.1);
  assert.equal(state.threat.elapsed, 2.1);
  assert.ok(state.threat.intensity > 0.5);
  assert.deepEqual(events.filter((event) => event.type === 'threat-warning').map((event) => event.threshold), [0.25, 0.5]);
  assert.equal('phase' in state, false);
  assert.equal('day' in state, false);
});

test('external threat changes can warn on the next tick and reset for a new incident', () => {
  const state = createColonyState({
    bounds: { width: 24, height: 16 },
    config: { passiveThreatPerSecond: 0, threatWarningThresholds: [0.25, 0.5] },
  });
  addColonyThreat(state, 0.6);
  assert.deepEqual(
    updateColony(state, 0.01).filter((event) => event.type === 'threat-warning').map((event) => event.threshold),
    [0.25, 0.5],
  );
  assert.equal(setColonyThreatIntensity(state, 0, { resetWarnings: true }), true);
  addColonyThreat(state, 0.3);
  assert.deepEqual(
    updateColony(state, 0.01).filter((event) => event.type === 'threat-warning').map((event) => event.threshold),
    [0.25],
  );
});

test('threat intensity drives rally, chase, and attack states', () => {
  const state = createColonyState({
    bounds: { width: 24, height: 16 },
    basePosition: { x: 1, y: 1 },
    rallyPoint: { x: 4, y: 1 },
    config: { passiveThreatPerSecond: 0 },
  });
  const slime = addColonySlime(state, { x: 1, y: 1, speed: 8, attackDamage: 7, attackRange: 1.2 });
  addColonyThreat(state, 0.4);
  updateColony(state, 0.25);
  assert.ok(['move', 'rally'].includes(slime.aiState));
  advance(state, 1);
  assert.equal(slime.aiState, 'rally');
  setColonyThreats(state, [{ uid: 'bug', x: 5, y: 1, hp: 10 }]);
  addColonyThreat(state, 0.3);
  const events = advance(state, 2);
  assert.equal(state.threats[0].dead, true);
  assert.ok(events.some((event) => event.type === 'threat-hit'));
  assert.ok(events.some((event) => event.type === 'threat-defeated'));
});

test('rest and downed recovery consume nectar and return the slime to work', () => {
  const state = createColonyState({
    bounds: { width: 24, height: 16 },
    basePosition: { x: 1, y: 1 },
    resources: { nectar: 3 },
    config: { passiveThreatPerSecond: 0, respawnSeconds: 0.5, restHealingPerSecond: 100 },
  });
  const slime = addColonySlime(state, { x: 4, y: 1, speed: 10, hp: 100, maxHp: 100 });
  downColonySlime(slime);
  const events = advance(state, 1.5);
  assert.equal(state.resources.nectar, 0);
  assert.notEqual(slime.aiState, 'downed');
  assert.ok(slime.hp >= 40);
  assert.ok(events.some((event) => event.type === 'slime-respawned'));
});

test('invalid dt values and blocked rally points are rejected safely', () => {
  const state = createColonyState({ bounds: { width: 24, height: 16 } });
  setTerrainAt(state, 8, 8, { kind: 'indestructible' });
  assert.equal(setColonyRallyPoint(state, { x: 8, y: 8 }), false);
  assert.equal(setColonyRallyPoint(state, { x: 23, y: 15 }), true);
  assert.throws(() => updateColony(state, -1), /dt/);
  assert.throws(() => updateColony(state, Number.NaN), /dt/);
});

test('cancelling autonomous work releases every reservation and conserves carried resources', () => {
  const state = createColonyState({
    bounds: { width: 12, height: 8 },
    basePosition: { x: 1, y: 1 },
    resources: { gel: 2 },
  });
  const slime = addColonySlime(state, { uid: 'worker', x: 1, y: 1 });
  const node = addResourceNode(state, { uid: 'node', x: 3, y: 1, resourceType: 'gel', amount: 3 });
  node.reservedBy = slime.uid;
  slime.job = { type: 'gather', targetUid: node.uid };
  slime.path = [{ x: 2, y: 1 }];
  slime.carrying = { resourceType: 'gel', amount: 3, destination: 'base' };

  assert.equal(cancelColonySlimeWork(state, slime), true);
  assert.equal(node.reservedBy, null);
  assert.equal(state.resources.gel, 5);
  assert.equal(slime.job, null);
  assert.deepEqual(slime.path, []);
  assert.equal(slime.carrying, null);

  slime.job = { type: 'clear', x: 5, y: 3 };
  slime.carrying = { resourceType: 'gel', amount: 2, destination: 'blueprint' };
  state.terrainReservations.set('5,3', slime.uid);
  assert.equal(cancelColonySlimeWork(state, slime, { returnCarrying: false }), true);
  assert.equal(state.terrainReservations.has('5,3'), false);
  assert.equal(state.resources.gel, 5);
});

test('an unreachable near job does not starve a farther reachable resource', () => {
  const state = createColonyState({
    bounds: { width: 12, height: 6 },
    basePosition: { x: 0, y: 1 },
    findPath({ from, to }) {
      if (to.x === 2 && to.y === 1) return [];
      const path = [];
      let x = Math.round(from.x);
      let y = Math.round(from.y);
      while (x !== Math.round(to.x)) {
        x += Math.sign(to.x - x);
        path.push({ x, y });
      }
      while (y !== Math.round(to.y)) {
        y += Math.sign(to.y - y);
        path.push({ x, y });
      }
      return path;
    },
  });
  const slime = addColonySlime(state, { uid: 'worker', x: 0, y: 1 });
  addResourceNode(state, { uid: 'blocked-near', x: 2, y: 1, resourceType: 'gel', amount: 2 });
  addResourceNode(state, { uid: 'reachable-far', x: 6, y: 1, resourceType: 'gel', amount: 2 });

  updateColony(state, 0.25);
  assert.equal(slime.job?.targetUid, 'reachable-far');
});

test('remote workers use the nearest activated depot for gathering and delivery', () => {
  const state = createColonyState({
    bounds: { width: 120, height: 8 },
    basePosition: { x: 1, y: 1 },
    depots: [{ x: 90, y: 1 }],
    config: { passiveThreatPerSecond: 0 },
  });
  const slime = addColonySlime(state, { x: 1, y: 1, speed: 12, carryCapacity: 6 });
  addResourceNode(state, { x: 96, y: 1, resourceType: 'shard', amount: 3, harvestSeconds: 0.1 });

  advance(state, 3);
  assert.equal(state.resources.shard, 3);
  assert.ok(slime.x > 80, 'activated relays should transfer a worker instead of requiring a 90-cell walk');
});

test('a remote depot worker ignores ordinary threats around the original core', () => {
  const state = createColonyState({
    bounds: { width: 120, height: 8 },
    basePosition: { x: 1, y: 1 },
    depots: [{ x: 90, y: 1 }],
    config: { passiveThreatPerSecond: 0 },
  });
  const worker = addColonySlime(state, { x: 90, y: 1, speed: 8, aggroRange: 3 });
  addResourceNode(state, { x: 94, y: 1, resourceType: 'gel', amount: 2, harvestSeconds: 0.1 });
  setColonyThreats(state, [{ uid: 'core-bug', x: 2, y: 1, hp: 50 }]);
  setColonyThreatIntensity(state, 0.68);

  updateColony(state, 0.25);
  assert.equal(worker.job?.type, 'gather');
  assert.equal(worker.job?.targetUid?.startsWith('node-'), true);
});
