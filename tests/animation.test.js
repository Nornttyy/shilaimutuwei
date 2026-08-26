import test from 'node:test';
import assert from 'node:assert/strict';

import { AnimationController } from '../src/animation/controller.js';
import {
  BOSS_CLIPS,
  BUBBLE_CLIPS,
  BUG_CLIPS,
  CRYSTAL_CLIPS,
  SHELL_CLIPS,
  SPROUT_CLIPS,
  STONE_CLIPS,
  WINDCAP_CLIPS,
} from '../src/animation/clips.js';
import {
  BOSS_RIG,
  BUBBLE_RIG,
  BUG_RIG,
  CRYSTAL_RIG,
  SHELL_RIG,
  SPROUT_RIG,
  STONE_RIG,
  WINDCAP_RIG,
} from '../src/animation/rigs.js';

function approximately(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function constantClip(x, { mode = 'loop', priority = 0, duration = 1 } = {}) {
  return {
    duration,
    mode,
    priority,
    tracks: { root: { x } },
  };
}

const RIG_CASES = [
  ['shell', SHELL_RIG, SHELL_CLIPS, ['idle', 'attack', 'hurt', 'downed']],
  ['bug', BUG_RIG, BUG_CLIPS, ['idle', 'move', 'attack', 'hurt', 'death']],
  ['crystal', CRYSTAL_RIG, CRYSTAL_CLIPS, ['idle', 'attack', 'hurt', 'downed']],
  ['bubble', BUBBLE_RIG, BUBBLE_CLIPS, ['idle', 'attack', 'hurt', 'downed']],
  ['sprout', SPROUT_RIG, SPROUT_CLIPS, ['idle', 'attack', 'hurt', 'downed']],
  ['windcap', WINDCAP_RIG, WINDCAP_CLIPS, ['idle', 'move', 'attack', 'hurt', 'death']],
  ['stone', STONE_RIG, STONE_CLIPS, ['idle', 'move', 'attack', 'hurt', 'death']],
  ['boss', BOSS_RIG, BOSS_CLIPS, ['idle', 'move', 'attack', 'hurt', 'death', 'charge']],
];

function assertDeepFrozen(value, label) {
  if (!value || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true, `${label} should be frozen`);
  for (const [key, child] of Object.entries(value)) {
    assertDeepFrozen(child, `${label}.${key}`);
  }
}

test('exports matching shell and bug clip/rig definitions', () => {
  assert.deepEqual(Object.keys(SHELL_CLIPS), ['idle', 'attack', 'hurt', 'downed']);
  assert.deepEqual(Object.keys(BUG_CLIPS), ['idle', 'move', 'attack', 'hurt', 'death']);
  assert.deepEqual(Object.keys(SHELL_RIG.bones), ['root', 'body', 'shell', 'face', 'front']);
  assert.deepEqual(
    Object.keys(BUG_RIG.bones),
    ['root', 'body', 'legsA', 'legsB', 'antennae', 'face'],
  );

  assert.equal(SHELL_RIG.bones.shell.parent, 'body');
  assert.deepEqual(SHELL_RIG.bones.shell.pivot, { x: -23, y: -39 });
  assert.equal(BUG_RIG.bones.antennae.parent, 'body');
  assert.deepEqual(BUG_RIG.bones.antennae.pivot, { x: 0, y: -60 });
  assert.equal(SHELL_CLIPS.attack.events[0].name, 'hit');
  assert.equal(BUG_CLIPS.death.mode, 'hold');
  assert.equal(Object.isFrozen(SHELL_CLIPS.attack.tracks.root.x), true);
  assert.equal(Object.isFrozen(BUG_RIG.bones.face.pivot), true);

  const shell = new AnimationController(SHELL_CLIPS, { base: 'idle' });
  const bug = new AnimationController(BUG_CLIPS, { base: 'move' });
  assert.deepEqual(Object.keys(shell.sample()), Object.keys(SHELL_RIG.bones));
  assert.deepEqual(Object.keys(bug.sample()), Object.keys(BUG_RIG.bones));
});

test('all character rigs have reciprocal trees and bone-complete clips', () => {
  for (const [label, rig, clips, expectedClipNames] of RIG_CASES) {
    const boneNames = Object.keys(rig.bones);
    assert.equal(rig.id, label);
    assert.equal(rig.root, 'root');
    assert.deepEqual(Object.keys(clips), expectedClipNames);
    assert.equal(rig.bones.root.parent, null);

    const visited = new Set();
    const visit = (boneName) => {
      assert.equal(visited.has(boneName), false, `${label} rig must be acyclic`);
      visited.add(boneName);
      const bone = rig.bones[boneName];
      assert.ok(bone, `${label}.${boneName} must exist`);
      for (const childName of bone.children) {
        assert.equal(rig.bones[childName]?.parent, boneName);
        visit(childName);
      }
    };
    visit(rig.root);
    assert.deepEqual([...visited], boneNames, `${label} hierarchy must reach every bone`);

    for (const [clipName, clip] of Object.entries(clips)) {
      assert.deepEqual(
        Object.keys(clip.tracks),
        boneNames,
        `${label}.${clipName} must provide relative tracks for every rig bone`,
      );
      const controller = new AnimationController(clips, {
        base: clipName,
        transitionDuration: 0,
      });
      assert.deepEqual(Object.keys(controller.sample()), boneNames);
    }

    assertDeepFrozen(rig, `${label} rig`);
    assertDeepFrozen(clips, `${label} clips`);
  }
});

test('new rigs preserve the renderer hierarchy and bind-pose pivots', () => {
  assert.deepEqual(Object.keys(CRYSTAL_RIG.bones), ['root', 'body', 'needles', 'face', 'front']);
  assert.deepEqual(Object.keys(BUBBLE_RIG.bones), ['root', 'body', 'bubbles', 'halo', 'face']);
  assert.deepEqual(Object.keys(SPROUT_RIG.bones), ['root', 'body', 'sprout', 'pack', 'face']);
  assert.deepEqual(Object.keys(WINDCAP_RIG.bones), ['root', 'stem', 'cap', 'face']);
  assert.deepEqual(Object.keys(STONE_RIG.bones), ['root', 'body', 'rocks', 'face']);
  assert.deepEqual(
    Object.keys(BOSS_RIG.bones),
    ['root', 'body', 'tentacles', 'crown', 'core', 'face'],
  );

  assert.deepEqual(CRYSTAL_RIG.bones.needles.pivot, { x: 0, y: -58 });
  assert.deepEqual(CRYSTAL_RIG.bones.front.pivot, { x: 40, y: -21 });
  assert.deepEqual(BUBBLE_RIG.bones.bubbles.pivot, { x: 0, y: -65 });
  assert.deepEqual(SPROUT_RIG.bones.pack.pivot, { x: 31.5, y: -20 });
  assert.deepEqual(WINDCAP_RIG.bones.stem.pivot, { x: 0, y: -6 });
  assert.deepEqual(WINDCAP_RIG.bones.cap.pivot, { x: 1, y: -60 });
  assert.deepEqual(STONE_RIG.bones.rocks.pivot, { x: 0, y: -43 });
  assert.deepEqual(BOSS_RIG.bones.tentacles.pivot, { x: 0, y: -6 });
  assert.deepEqual(BOSS_RIG.bones.crown.pivot, { x: 0, y: -91 });
  assert.deepEqual(BOSS_RIG.bones.core.pivot, { x: 0, y: -44 });
  assert.deepEqual(BOSS_RIG.bones.face.pivot, { x: 0, y: -49 });

  for (const rig of [WINDCAP_RIG, STONE_RIG, BOSS_RIG]) {
    assert.equal(rig.facing, -1);
  }
});

test('clip modes, priorities, death timing, and local-forward attacks stay consistent', () => {
  const survivors = [SHELL_CLIPS, CRYSTAL_CLIPS, BUBBLE_CLIPS, SPROUT_CLIPS];
  const enemies = [BUG_CLIPS, WINDCAP_CLIPS, STONE_CLIPS, BOSS_CLIPS];

  for (const clips of [...survivors, ...enemies]) {
    assert.equal(clips.attack.mode, 'once');
    assert.equal(clips.attack.priority, 20);
    assert.equal(clips.hurt.mode, 'once');
    assert.equal(clips.hurt.priority, 40);
  }
  for (const clips of survivors) {
    assert.equal(clips.downed.mode, 'hold');
    assert.equal(clips.downed.priority, 90);
  }
  for (const clips of enemies) {
    assert.equal(clips.death.mode, 'hold');
    assert.equal(clips.death.priority, 100);
  }

  assert.equal(WINDCAP_CLIPS.death.duration, 0.38);
  assert.equal(STONE_CLIPS.death.duration, 0.42);
  assert.equal(BOSS_CLIPS.death.duration, 0.68);
  assert.equal(BOSS_CLIPS.charge.duration, 0.75);
  assert.equal(BOSS_CLIPS.charge.mode, 'hold');

  for (const clips of [WINDCAP_CLIPS, STONE_CLIPS, BOSS_CLIPS]) {
    const forwardValues = clips.attack.tracks.root.x.map((frame) => frame[1]);
    assert.ok(Math.max(...forwardValues) > 0, 'enemy attacks must lunge along local +x');
  }
});

test('boss charge can run as a hold base and freezes at the charged pose', () => {
  const controller = new AnimationController(BOSS_CLIPS, {
    base: 'charge',
    transitionDuration: 0,
  });

  controller.update(4);
  const charged = controller.sample();
  approximately(charged.core.scaleX, 1.28);
  approximately(charged.core.alpha, 1);
  assert.deepEqual(controller.drainEvents().map(({ name }) => name), ['charge-ready']);

  controller.update(4);
  assert.deepEqual(controller.sample(), charged);
  assert.deepEqual(controller.drainEvents(), []);
});

test('samples complete relative transforms with linear and shortest-angle interpolation', () => {
  const degrees = (value) => value * Math.PI / 180;
  const clips = {
    turn: {
      duration: 1,
      mode: 'loop',
      tracks: {
        root: {
          x: [[0, 0], [1, 10]],
          rotation: [[0, degrees(170)], [1, degrees(-170)]],
        },
      },
    },
  };
  const controller = new AnimationController(clips, {
    base: 'turn',
    transitionDuration: 0,
  });

  controller.update(0.5);
  const halfway = controller.sample().root;
  approximately(halfway.x, 5);
  approximately(Math.abs(halfway.rotation), Math.PI);
  assert.deepEqual(
    { y: halfway.y, scaleX: halfway.scaleX, scaleY: halfway.scaleY, alpha: halfway.alpha },
    { y: 0, scaleX: 1, scaleY: 1, alpha: 1 },
  );

  controller.update(0.75);
  approximately(controller.sample().root.x, 2.5, 1e-8);
});

test('setBase switches clips and crossfades from the outgoing pose', () => {
  const controller = new AnimationController({
    first: constantClip(0),
    second: constantClip(10),
  }, { base: 'first', transitionDuration: 0.2 });

  assert.equal(controller.setBase('second'), true);
  assert.equal(controller.baseName, 'second');
  approximately(controller.sample().root.x, 0);

  controller.update(0.1);
  approximately(controller.sample().root.x, 5);
  controller.update(0.1);
  approximately(controller.sample().root.x, 10);
  assert.equal(controller.setBase('second'), false);
  assert.throws(() => controller.setBase('missing'), /Unknown animation clip/);
});

test('play respects priority and restart while once clips return to the base', () => {
  const controller = new AnimationController({
    idle: constantClip(0),
    poke: constantClip(-5, { mode: 'hold', priority: 5 }),
    attack: {
      duration: 1,
      mode: 'once',
      priority: 10,
      tracks: { root: { x: [[0, 0], [1, 10]] } },
    },
    hurt: constantClip(20, { mode: 'hold', priority: 20 }),
  }, { base: 'idle', transitionDuration: 0 });

  assert.equal(controller.play('attack'), true);
  controller.update(0.4);
  approximately(controller.sample().root.x, 4);
  assert.equal(controller.play('poke'), false);
  assert.equal(controller.play('attack', { restart: false }), false);
  approximately(controller.sample().root.x, 4);

  assert.equal(controller.play('attack'), true);
  approximately(controller.sample().root.x, 0);
  controller.update(1);
  assert.equal(controller.current, 'idle');
  assert.equal(controller.actionName, null);
  approximately(controller.sample().root.x, 0);

  assert.equal(controller.play('hurt'), true);
  assert.equal(controller.play('attack'), false);
  controller.update(5);
  assert.equal(controller.current, 'hurt');
  approximately(controller.sample().root.x, 20);
});

test('once completion uses overshoot time for the crossfade back to base', () => {
  const controller = new AnimationController({
    idle: constantClip(0),
    attack: {
      duration: 0.5,
      mode: 'once',
      priority: 10,
      tracks: { root: { x: [[0, 0], [0.5, 10]] } },
    },
  }, { base: 'idle', transitionDuration: 0.2 });

  controller.play('attack');
  controller.update(0.6);
  assert.equal(controller.current, 'idle');
  approximately(controller.sample().root.x, 5);
  controller.update(0.1);
  approximately(controller.sample().root.x, 0);
});

test('finite events fire once per play and restarting creates a fresh event pass', () => {
  const controller = new AnimationController({
    idle: constantClip(0),
    attack: {
      duration: 1,
      mode: 'once',
      priority: 10,
      tracks: { root: { x: 0 } },
      events: [
        { time: 0.2, name: 'windup' },
        { time: 0.8, name: 'hit', payload: { damage: 2 } },
      ],
    },
  }, { base: 'idle', transitionDuration: 0 });

  controller.play('attack');
  controller.update(0.2);
  assert.deepEqual(controller.drainEvents().map(({ name }) => name), ['windup']);
  controller.update(0);
  assert.deepEqual(controller.drainEvents(), []);
  controller.update(0.6);
  const [hit] = controller.drainEvents();
  assert.equal(hit.name, 'hit');
  assert.equal(hit.clip, 'attack');
  assert.equal(hit.cycle, 0);
  assert.deepEqual(hit.payload, { damage: 2 });

  controller.update(1);
  assert.deepEqual(controller.drainEvents(), []);
  controller.play('attack');
  controller.update(0.21);
  assert.deepEqual(controller.drainEvents().map(({ name }) => name), ['windup']);
});

test('loop events fire once at each crossed occurrence without boundary duplicates', () => {
  const controller = new AnimationController({
    move: {
      duration: 0.5,
      mode: 'loop',
      tracks: { root: { y: 0 } },
      events: [{ time: 0.25, name: 'step' }],
    },
  }, { base: 'move', transitionDuration: 0 });

  controller.update(1.3);
  const events = controller.drainEvents();
  assert.deepEqual(events.map(({ name }) => name), ['step', 'step', 'step']);
  assert.deepEqual(events.map(({ cycle }) => cycle), [0, 1, 2]);
  assert.deepEqual(events.map(({ elapsed }) => elapsed), [0.25, 0.75, 1.25]);

  controller.update(0.2);
  assert.deepEqual(controller.drainEvents(), []);
  controller.update(0.25);
  assert.deepEqual(controller.drainEvents().map(({ cycle }) => cycle), [3]);
});

test('hold clips freeze on their last pose and events do not repeat', () => {
  const controller = new AnimationController({
    idle: constantClip(0),
    death: {
      duration: 0.5,
      mode: 'hold',
      priority: 100,
      tracks: { root: { y: [[0, 0], [0.5, 12]] } },
      events: [{ time: 0.5, name: 'death' }],
    },
  }, { base: 'idle', transitionDuration: 0 });

  controller.play('death');
  controller.update(4);
  approximately(controller.sample().root.y, 12);
  assert.deepEqual(controller.drainEvents().map(({ name }) => name), ['death']);
  controller.update(4);
  approximately(controller.sample().root.y, 12);
  assert.deepEqual(controller.drainEvents(), []);
  assert.equal(controller.play('idle'), false);
  assert.throws(() => controller.update(-0.1), /zero or greater/);
});
