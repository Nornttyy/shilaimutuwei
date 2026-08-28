import test from 'node:test';
import assert from 'node:assert/strict';

import { SlimeGame } from '../src/game.js';
import { EXPEDITION_PARTY_RULES } from '../src/expedition-catalog.js';
import { worldPoiAssetKeys } from '../src/terrain-renderer.js';

function installRuntime(storage = new Map()) {
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener() {},
    AudioContext: null,
    webkitAudioContext: null,
  };
  return storage;
}

function createContext() {
  const gradient = () => ({ addColorStop() {} });
  return new Proxy({
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    measureText: (text) => ({ width: String(text).length * 14 }),
  }, {
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

function createFallbackAssetStore() {
  const requests = [];
  return {
    requests,
    get(_key, fallback = null) {
      return fallback;
    },
    useOrFallback(key, _renderAsset, renderFallback) {
      requests.push(key);
      renderFallback?.({ status: 'failed' }, null);
      return false;
    },
  };
}

function createGame(storage = new Map(), context = createContext()) {
  installRuntime(storage);
  const canvas = {
    width: 1280,
    height: 720,
    getContext: () => context,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    addEventListener() {},
    setPointerCapture() {},
  };
  const game = new SlimeGame(canvas);
  game.modal = null;
  game.state.tutorialSeen = true;
  return game;
}

function startDefaultWorldExploration(game) {
  assert.equal(game.openExpedition(), true);
  assert.equal(game.modal.type, 'expedition-squad');
  assert.equal(game.modal.selectedIds.length, EXPEDITION_PARTY_RULES.size);
  assert.equal(game.startExpedition(game.modal.selectedIds), true);
  return game.state.worldExpedition;
}

function advance(game, seconds, step = 0.05) {
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    game.time += step;
    game.update(step);
  }
}

test('three resident slimes start same-map exploration without clearing or snapshotting the base', () => {
  const game = createGame();
  const ids = game.availableExpeditionSlimeIds();
  assert.equal(game.startExpedition(ids.slice(0, 2)), false);
  assert.equal(game.state.worldExpedition, null);

  const buildingUids = game.state.buildings.map(({ uid }) => uid);
  const survivorUids = game.state.survivors.map(({ uid }) => uid);
  const expedition = startDefaultWorldExploration(game);
  assert.equal(game.state.phase, 'build');
  assert.equal(game.state.paused, false);
  assert.equal(game.modal, null);
  assert.equal(game.preBattleSnapshot, null);
  assert.equal(game.state.expeditionRun, null);
  assert.equal(expedition.status, 'choose-site');
  assert.equal(expedition.squadUids.length, 3);
  assert.deepEqual(game.state.buildings.map(({ uid }) => uid), buildingUids);
  assert.deepEqual(game.state.survivors.map(({ uid }) => uid), survivorUids);
});

test('joining an exploration squad releases colony jobs, reservations, and cargo', () => {
  const game = createGame();
  assert.equal(game.openExpedition(), true);
  const selectedCards = new Set(game.modal.selectedIds);
  const squadWorkers = game.state.colony.slimes.filter((slime) => selectedCards.has(slime.cardId));
  const node = game.state.colony.resourceNodes[0];
  node.reservedBy = squadWorkers[0].uid;
  squadWorkers[0].job = { type: 'gather', targetUid: node.uid };
  squadWorkers[0].carrying = { resourceType: 'gel', amount: 2, destination: 'base' };
  const gelBefore = game.state.colony.resources.gel;
  game.state.colony.terrainReservations.set('8,5', squadWorkers[1].uid);
  squadWorkers[1].job = { type: 'clear', x: 8, y: 5 };

  assert.equal(game.startExpedition(game.modal.selectedIds), true);
  assert.equal(node.reservedBy, null);
  assert.equal(game.state.colony.terrainReservations.has('8,5'), false);
  assert.equal(game.state.colony.resources.gel, gelBefore + 2);
  assert.ok(squadWorkers.every((slime) => slime.job === null && slime.carrying === null));
});

test('route cards are replaced by real map sites with generated layered POI art', () => {
  const game = createGame();
  const store = createFallbackAssetStore();
  game.setAssetStore(store);
  const expedition = startDefaultWorldExploration(game);
  const site = expedition.sites[0];
  assert.ok(site);
  const keys = worldPoiAssetKeys(site, site.zoneKind);
  assert.ok(keys.length > 0);

  game.drawWorldPoiMarkers(game.ctx, {
    minX: site.x - 1,
    minY: site.y - 1,
    maxX: site.x + 1,
    maxY: site.y + 1,
  });
  for (const key of keys) assert.ok(store.requests.includes(key));
  if (site.kind === 'nest') {
    assert.ok(store.requests.indexOf(keys[0]) < store.requests.indexOf(keys[1]), 'energy renders behind frame');
  }
  assert.ok(game.hits.some(({ id }) => id === `world-site-${site.id}`));
  assert.equal(game.modal, null, 'no full-screen route-card modal remains');
  game.hits = [];
  game.drawBattlefield(game.ctx);
  assert.ok(store.requests.some((key) => key.startsWith('region-')), 'visible chunks request generated region decals');
  assert.ok(game.hits.some(({ id }) => id === `world-site-${site.id}`), 'normal battlefield render keeps the POI interactive');
});

test('clicking a physical site moves the original survivor UIDs and reveals terrain along the path', () => {
  const game = createGame();
  game.state.colonyDirector.nextPackAt = Infinity;
  const expedition = startDefaultWorldExploration(game);
  const site = expedition.sites[0];
  const squadUids = [...expedition.squadUids];
  const discoveryBefore = game.infiniteWorld.stats().discoveryChunks;

  game.handleBuildCellTap({ x: site.x, y: site.y });
  assert.equal(expedition.status, 'travel');
  advance(game, 4);

  assert.deepEqual(expedition.squadUids, squadUids);
  assert.ok(squadUids.every((uid) => game.state.survivors.some((survivor) => survivor.uid === uid)));
  assert.ok(game.infiniteWorld.stats().discoveryChunks >= discoveryBefore);
  const leaderCell = { x: Math.round(expedition.leader.x), y: Math.round(expedition.leader.y) };
  assert.equal(game.infiniteWorld.isDiscovered(leaderCell.x, leaderCell.y), true);
});

test('site battle happens on the world map while the colony clock and buildings continue', () => {
  const game = createGame();
  game.state.colonyDirector.nextPackAt = Infinity;
  const expedition = startDefaultWorldExploration(game);
  const combatSite = expedition.sites.find(({ kind }) => kind === 'nest' || kind === 'boss');
  assert.ok(combatSite);
  const buildingUids = game.state.buildings.map(({ uid }) => uid);
  const colonyTimeBefore = game.state.colony.time;
  assert.equal(game.selectWorldExpeditionSite(combatSite.id), true);

  let elapsed = 0;
  while (elapsed < 90 && game.state.worldExpedition?.status === 'travel') {
    advance(game, 0.1, 0.05);
    elapsed += 0.1;
  }
  assert.equal(game.state.worldExpedition?.status, 'battle');
  assert.ok(game.state.worldExpedition.enemies.length >= 7);
  const worldEnemy = game.state.worldExpedition.enemies[0];
  const explorer = game.state.survivors.find(({ uid }) => expedition.squadUids.includes(uid));
  const homeGuard = game.state.survivors.find(({ uid }) => !expedition.squadUids.includes(uid));
  const baseEnemy = game.spawnEnemyAtWorld('enemy-soft-biter', { x: homeGuard.x + 0.4, y: homeGuard.y });
  assert.ok(game.findTargetsForAttack(explorer, { rangeTiles: 99 }).some(({ uid }) => uid === worldEnemy.uid));
  assert.ok(game.findTargetsForAttack(homeGuard, { rangeTiles: 3 }).some(({ uid }) => uid === baseEnemy.uid));
  game.updateEntityAnimations(0.12);
  assert.ok(game.animators.has(worldEnemy.uid), 'world enemies keep a live rig animator');
  advance(game, 1.2, 0.05);
  assert.ok(explorer.actionCount > 0 || explorer.attackCount > 0, 'world battle uses the survivor action system');
  assert.doesNotThrow(() => game.drawWorldActors(game.ctx));
  assert.ok(game.state.colony.time > colonyTimeBefore);
  assert.deepEqual(game.state.buildings.map(({ uid }) => uid), buildingUids);
});

test('a complete site loop grants rewards, returns the squad, and never rolls back base changes', () => {
  const game = createGame();
  game.state.colonyDirector.nextPackAt = Infinity;
  const expedition = startDefaultWorldExploration(game);
  const site = expedition.sites.find(({ kind }) => kind === 'landmark') || expedition.sites[0];
  const buildingUids = game.state.buildings.map(({ uid }) => uid);
  const resourcesBefore = { ...game.state.colony.resources };
  assert.equal(game.selectWorldExpeditionSite(site.id), true);

  let elapsed = 0;
  while (elapsed < 240 && game.state.worldExpedition) {
    advance(game, 0.1, 0.05);
    elapsed += 0.1;
  }
  assert.equal(game.state.worldExpedition, null);
  assert.deepEqual(game.state.buildings.map(({ uid }) => uid), buildingUids);
  assert.equal(game.infiniteWorld.getPoiState(site.id)?.cleared, true);
  assert.ok(game.state.expeditionProgress.outposts.some(({ id }) => id === site.id));
  assert.ok(game.state.colony.depots.some(({ x, y }) => x === site.x && y === site.y));
  assert.equal(game.shapingLimit, undefined, '建造不再受定形值上限限制');
  assert.ok(Object.keys(resourcesBefore).some((key) => game.state.colony.resources[key] > resourcesBefore[key]));
  assert.equal(game.state.phase, 'build');
});

test('backgrounding safely recalls a same-map squad without replacing the base', () => {
  const storage = new Map();
  const game = createGame(storage);
  const expedition = startDefaultWorldExploration(game);
  const site = expedition.sites[0];
  game.selectWorldExpeditionSite(site.id);
  advance(game, 2);
  const buildingCards = game.state.buildings.map(({ cardId }) => cardId);

  game.onBackground();
  assert.equal(game.state.worldExpedition, null);
  assert.equal(game.state.phase, 'build');
  assert.deepEqual(game.state.buildings.map(({ cardId }) => cardId), buildingCards);
  assert.equal(game.state.survivors.length, 4);

  const restored = createGame(storage);
  assert.deepEqual(restored.state.buildings.map(({ cardId }) => cardId), buildingCards);
  assert.equal(restored.state.worldExpedition, null);
});

test('manual recall preserves wounds and cancels detached encounter attacks', () => {
  const game = createGame();
  game.state.colonyDirector.nextPackAt = Infinity;
  const expedition = startDefaultWorldExploration(game);
  const site = expedition.sites.find(({ kind }) => kind === 'nest' || kind === 'boss');
  assert.ok(site);
  expedition.targetPoiId = site.id;
  expedition.leader = { x: site.x, y: site.y };
  assert.equal(game.beginWorldSiteEncounter(), true);

  const squad = expedition.squadUids
    .map((survivorUid) => game.state.survivors.find(({ uid }) => uid === survivorUid));
  const attacker = squad.find(({ cardId }) => cardId !== 'survivor-moss-sprout') || squad[0];
  const downed = squad.find(({ uid }) => uid !== attacker.uid);
  const enemy = expedition.enemies[0];
  expedition.enemies.slice(1).forEach((other) => { other.dead = true; });
  enemy.x = attacker.x + 0.2;
  enemy.y = attacker.y;
  enemy.maxHp = 999;
  enemy.hp = 999;

  assert.equal(game.performSurvivorAction(attacker, true), true);
  assert.equal(game.pendingAttackHits.has(attacker.uid), true);
  assert.ok(game.state.projectiles.some(({ sourceUid }) => sourceUid === attacker.uid));
  assert.equal(game.startEntityAttack(enemy, () => game.damageSurvivor(attacker, 7)), true);
  assert.equal(game.pendingAttackHits.has(enemy.uid), true);

  attacker.hp = 3;
  downed.hp = 0;
  downed.downed = true;
  const enemyHpBeforeRecall = enemy.hp;
  const killsBeforeRecall = game.state.kills;
  const energyBeforeRecall = game.state.energy;

  assert.equal(game.finishWorldExpeditionReturn(), true);
  assert.equal(game.state.worldExpedition, null);
  assert.equal(attacker.hp, 3, 'recall is not a free heal');
  assert.equal(downed.hp, 0);
  assert.equal(downed.downed, true, 'recall is not a free revive');
  assert.equal(game.state.colony.slimes.find(({ uid }) => uid === downed.uid).aiState, 'downed');
  assert.ok(expedition.squadUids.every((uid) => !game.pendingAttackHits.has(uid)));
  assert.ok(expedition.enemies.every(({ uid }) => !game.pendingAttackHits.has(uid)));
  assert.ok(game.state.projectiles.every(({ sourceUid, targetUid }) => (
    !expedition.squadUids.includes(sourceUid)
    && !expedition.squadUids.includes(targetUid)
    && !expedition.enemies.some(({ uid }) => uid === sourceUid || uid === targetUid)
  )));

  game.updateEntityAnimations(2);
  assert.equal(enemy.hp, enemyHpBeforeRecall, 'removed enemies cannot receive delayed hits');
  assert.equal(attacker.hp, 3, 'removed enemy attacks cannot hit the recalled squad');
  assert.equal(game.state.kills, killsBeforeRecall);
  assert.equal(game.state.energy, energyBeforeRecall);
});

test('explorers regroup into a compact formation even when assigned across distant bases', () => {
  const game = createGame();
  const expedition = startDefaultWorldExploration(game);
  const members = expedition.squadUids.map((uid) => game.state.survivors.find((survivor) => survivor.uid === uid));
  members[0].x = -500;
  members[0].y = -500;
  members[1].x = 500;
  members[1].y = 500;
  members[2].x = 12;
  members[2].y = 8;
  const site = expedition.sites[0];

  assert.equal(game.selectWorldExpeditionSite(site.id), true);
  const spread = Math.max(...expedition.formation.map(({ dx, dy }) => Math.hypot(dx, dy)));
  assert.ok(spread < 1.1);
  assert.ok(members.every((member) => Math.hypot(
    member.x - expedition.leader.x,
    member.y - expedition.leader.y,
  ) < 1.1));
});

test('generated POIs and activated relays reserve their cell against construction', () => {
  const game = createGame();
  const expedition = startDefaultWorldExploration(game);
  const site = expedition.sites[0];
  game.infiniteWorld.reveal(site.x, site.y, 2);
  game.selection = { kind: 'place-building', cardId: 'building-bubble-tower', rotation: 0 };
  assert.equal(game.selectionCellIsValid(site), false);

  game.state.expeditionProgress.outposts.push({ id: site.id, x: site.x, y: site.y, name: site.name });
  game.syncColonyDepots();
  assert.equal(game.placementWorldCellAt(site.x, site.y).poiReserved, true);
  assert.equal(game.selectionCellIsValid(site), false);
});

test('hundreds of outposts retain depot positions without reintroducing a shaping cap', () => {
  const storage = new Map();
  const game = createGame(storage);
  game.state.expeditionProgress.outposts = Array.from({ length: 300 }, (_, index) => ({
    id: `relay-${index}`,
    x: 1000 + index * 3,
    y: -1000 - index * 2,
    name: `前哨 ${index}`,
  }));
  game.syncColonyDepots();
  game.save();

  const restored = createGame(storage);
  assert.equal(restored.state.expeditionProgress.outposts.length, 300);
  assert.equal(restored.shapingLimit, undefined);
  assert.equal(restored.state.colony.depots.length, 301);
});

test('late exploration advances in a bounded leg from a far frontier instead of routing back to core', () => {
  const game = createGame();
  const frontier = { x: 10000, y: -10000 };
  game.state.expeditionProgress.frontier = frontier;
  game.state.expeditionProgress.attempts = 64;
  assert.equal(game.openExpedition(), true);
  assert.equal(game.startExpedition(game.modal.selectedIds), true);
  const sites = game.state.worldExpedition.sites;
  assert.ok(sites.length > 0);
  assert.ok(sites.every((site) => Math.hypot(site.x - frontier.x, site.y - frontier.y) < 180));
  assert.equal(game.selectWorldExpeditionSite(sites[0].id), true);
  assert.ok(game.state.worldExpedition.path.length < 220);
});
