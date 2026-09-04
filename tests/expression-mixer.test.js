import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createExpressionMixer,
  DEFAULT_BLINK_TRANSITION_DURATION,
  DEFAULT_EXPRESSION_TRANSITION_DURATION,
  ExpressionMixer,
  resolveExpressionState,
} from '../src/animation/expression-mixer.js';
import { AnimationController } from '../src/animation/controller.js';
import { EXPRESSION_SPEC } from '../src/animation/rigs.js';

const OWNER = 'survivor-bubble-float';

function approximately(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test('resolves action states and gives an explicit target priority', () => {
  assert.equal(resolveExpressionState({
    ownerId: OWNER,
    action: 'attack',
    currentTime: 0,
    autoBlink: false,
  }), 'attack');
  assert.equal(resolveExpressionState({
    ownerId: OWNER,
    action: 'death',
    currentTime: 0,
    autoBlink: false,
  }), 'hurt');
  assert.equal(resolveExpressionState({
    ownerId: 'enemy-acid-shell-king',
    action: 'charge',
    currentTime: 0,
    autoBlink: false,
  }), 'attack');
  assert.equal(resolveExpressionState({
    ownerId: OWNER,
    action: 'attack',
    currentTime: 0,
    targetState: 'blink',
  }), 'blink');
  assert.equal(resolveExpressionState({
    ownerId: OWNER,
    action: 'idle',
    currentTime: 0,
    autoBlink: false,
  }), 'normal');
});

test('uses owner and current time for deterministic staggered blinking', () => {
  const states = [];
  for (let time = 0; time < 3.2; time += 0.01) {
    states.push(resolveExpressionState({ ownerId: OWNER, currentTime: time }));
  }
  assert.equal(states[0], 'normal');
  assert.ok(states.includes('blink'));
  assert.deepEqual(
    states,
    states.map((state, index) => resolveExpressionState({
      ownerId: OWNER,
      currentTime: index * 0.01,
    })),
  );
});

test('caches validation for a deeply frozen expression specification', () => {
  let slotReads = 0;
  const frozenSpec = new Proxy(EXPRESSION_SPEC, {
    get(target, property, receiver) {
      if (property === 'slots') slotReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });

  const context = {
    ownerId: OWNER,
    currentTime: 0,
    targetState: 'normal',
    spec: frozenSpec,
    autoBlink: false,
  };
  assert.equal(resolveExpressionState(context), 'normal');
  const readsAfterFirstValidation = slotReads;
  assert.ok(readsAfterFirstValidation > 0);

  assert.equal(resolveExpressionState(context), 'normal');
  assert.equal(slotReads, readsAfterFirstValidation);
});

test('mutable and shallow-frozen expression specifications are always revalidated', () => {
  const createMutableSpec = () => ({
    defaultState: 'normal',
    slots: {
      eyes: { bone: 'eyes', variants: ['normal', 'hurt'] },
    },
    states: {
      normal: { eyes: 'normal' },
      hurt: { eyes: 'hurt' },
    },
    clipStates: { hurt: 'hurt' },
  });
  const contextFor = (spec) => ({
    ownerId: OWNER,
    currentTime: 0,
    spec,
    autoBlink: false,
  });

  const mutable = createMutableSpec();
  const mutableMixer = new ExpressionMixer({
    ownerId: OWNER,
    spec: mutable,
    autoBlink: false,
  });
  assert.equal(resolveExpressionState(contextFor(mutable)), 'normal');
  mutable.states.normal.eyes = 'missing';
  assert.throws(
    () => resolveExpressionState(contextFor(mutable)),
    /must name a declared variant/,
  );
  assert.throws(
    () => mutableMixer.setContext({ currentTime: 0 }),
    /must name a declared variant/,
  );

  const shallowFrozen = Object.freeze(createMutableSpec());
  assert.equal(resolveExpressionState(contextFor(shallowFrozen)), 'normal');
  shallowFrozen.states.normal.eyes = 'missing';
  assert.throws(
    () => resolveExpressionState(contextFor(shallowFrozen)),
    /must name a declared variant/,
  );
});

test('cross-fades independent eye and mouth variants in 0.075 seconds', () => {
  const mixer = createExpressionMixer(OWNER, { autoBlink: false });
  assert.equal(DEFAULT_EXPRESSION_TRANSITION_DURATION, 0.075);
  assert.equal(mixer.setTarget('attack'), true);

  mixer.tick(0.0375);
  const halfway = mixer.sample();
  assert.equal(halfway.from, 'normal');
  assert.equal(halfway.to, 'attack');
  approximately(halfway.mix, 0.5);
  assert.deepEqual(halfway.slots.eyes, {
    bone: 'eyes',
    from: 'normal',
    to: 'attack',
    weights: { from: 0.5, to: 0.5 },
  });
  assert.deepEqual(halfway.slots.mouth, {
    bone: 'mouth',
    from: 'normal',
    to: 'open',
    weights: { from: 0.5, to: 0.5 },
  });

  mixer.tick(0.0375);
  const complete = mixer.sample();
  assert.equal(complete.from, 'attack');
  assert.equal(complete.to, 'attack');
  assert.equal(complete.mix, 1);
  assert.equal(complete.slots.eyes.weights.from, 1);
  assert.equal(complete.slots.eyes.weights.to, 0);
});

test('uses a shorter blink fade while shared slot variants stay opaque', () => {
  const mixer = createExpressionMixer(OWNER, { autoBlink: false });
  assert.equal(DEFAULT_BLINK_TRANSITION_DURATION, 0.05);
  assert.equal(mixer.blinkTransitionDuration, 0.05);
  mixer.setTarget('blink');
  mixer.tick(0.025);

  const sample = mixer.sample();
  assert.deepEqual(sample.slots.eyes.weights, { from: 0.5, to: 0.5 });
  assert.equal(sample.slots.eyes.to, 'blink');
  assert.equal(sample.slots.mouth.from, 'normal');
  assert.equal(sample.slots.mouth.to, 'normal');
  assert.deepEqual(sample.slots.mouth.weights, { from: 1, to: 0 });
});

test('tick(0) freezes from, to, mix, pending, and slot weights', () => {
  const mixer = createExpressionMixer(OWNER, { autoBlink: false });
  mixer.setTarget('attack');
  mixer.tick(0.035);
  mixer.setTarget('hurt');
  const before = mixer.sample();

  assert.equal(mixer.tick(0), mixer);
  assert.deepEqual(mixer.sample(), before);
});

test('reverses an in-flight two-state fade without a visible weight jump', () => {
  const mixer = createExpressionMixer(OWNER, { autoBlink: false });
  mixer.setTarget('attack');
  mixer.tick(0.03);
  const before = mixer.sample();

  mixer.setTarget('normal');
  const after = mixer.sample();
  assert.equal(after.from, 'attack');
  assert.equal(after.to, 'normal');
  approximately(after.slots.eyes.weights.from, before.slots.eyes.weights.to);
  approximately(after.slots.eyes.weights.to, before.slots.eyes.weights.from);
  approximately(after.slots.mouth.weights.from, before.slots.mouth.weights.to);
  approximately(after.slots.mouth.weights.to, before.slots.mouth.weights.from);
});

test('queues a third rapid target so a two-layer renderer never snaps', () => {
  const mixer = createExpressionMixer(OWNER, { autoBlink: false });
  mixer.setTarget('attack');
  mixer.tick(0.03);
  const beforeRetarget = mixer.sample();

  assert.equal(mixer.setTarget('hurt'), true);
  assert.deepEqual(mixer.sample().slots, beforeRetarget.slots);
  assert.equal(mixer.sample().pending, 'hurt');

  // Finish attack and consume the overshoot in the queued attack -> hurt fade.
  mixer.tick(0.09);
  const after = mixer.sample();
  assert.equal(after.from, 'attack');
  assert.equal(after.to, 'hurt');
  assert.equal(after.pending, null);
  assert.ok(after.mix > 0 && after.mix < 1);
});

test('rapid pending targets coalesce to the latest request and can be cancelled', () => {
  const mixer = createExpressionMixer(OWNER, { autoBlink: false });
  mixer.setTarget('attack');
  mixer.tick(0.02);
  mixer.setTarget('hurt');
  mixer.setTarget('blink');
  assert.equal(mixer.pending, 'blink');

  // Asking for the active destination cancels the queued third state.
  assert.equal(mixer.setTarget('attack'), true);
  assert.equal(mixer.pending, null);
});

test('setContext maps gameplay actions while owner identity stays isolated', () => {
  const mixer = new ExpressionMixer({ ownerId: OWNER, autoBlink: false });
  assert.equal(mixer.setContext({ action: 'hurt', currentTime: 4 }), true);
  assert.equal(mixer.to, 'hurt');
  assert.equal(mixer.setContext({
    action: 'hurt',
    currentTime: 4,
    targetState: 'normal',
  }), true);
  assert.equal(mixer.to, 'normal');

  assert.throws(() => mixer.setContext({
    ownerId: 'enemy-soft-biter',
    action: 'attack',
  }), /belongs to survivor-bubble-float/);
});

test('clip metadata and expression events select real variants with explicit priority', () => {
  assert.equal(resolveExpressionState({
    ownerId: OWNER,
    action: 'idle',
    clipState: 'attack',
    currentTime: 0,
    autoBlink: false,
  }), 'attack');
  assert.equal(resolveExpressionState({
    ownerId: OWNER,
    action: 'attack',
    clipState: 'attack',
    events: [{ name: 'expression', state: 'hurt' }],
    currentTime: 0,
    autoBlink: false,
  }), 'hurt');
  assert.equal(resolveExpressionState({
    ownerId: OWNER,
    clipState: 'attack',
    events: [{ name: 'cue', expression: 'hurt' }],
    targetState: 'normal',
    currentTime: 0,
    autoBlink: false,
  }), 'normal');
});

test('AnimationController exposes clip expression metadata for the mixer', () => {
  const controller = new AnimationController({
    idle: {
      duration: 1,
      mode: 'loop',
      expression: 'normal',
      tracks: {},
    },
    cast: {
      duration: 0.5,
      mode: 'once',
      priority: 20,
      expression: 'attack',
      tracks: {},
      events: [{ time: 0.2, name: 'expression', state: 'hurt' }],
    },
  }, { base: 'idle', transitionDuration: 0 });
  const mixer = createExpressionMixer(OWNER, { autoBlink: false });

  assert.equal(controller.expressionState, 'normal');
  controller.play('cast');
  assert.equal(controller.expressionState, 'attack');
  mixer.setAnimationContext(controller);
  assert.equal(mixer.to, 'attack');

  controller.update(0.2);
  const events = controller.drainEvents();
  mixer.setAnimationContext(controller, { events });
  assert.equal(mixer.pending, 'hurt', 'event retargeting uses the existing two-layer queue');

  controller.update(1);
  assert.equal(controller.expressionState, 'normal');

  const mappedController = new AnimationController({
    idle: {
      duration: 1,
      mode: 'loop',
      expression: 'normal',
      tracks: {},
    },
    attack: {
      duration: 0.5,
      mode: 'once',
      priority: 20,
      tracks: {},
    },
  }, { base: 'idle', transitionDuration: 0 });
  const mappedMixer = createExpressionMixer(OWNER, { autoBlink: false });
  mappedController.play('attack');
  assert.equal(mappedController.expressionState, null);
  mappedMixer.setAnimationContext(mappedController);
  assert.equal(mappedMixer.to, 'attack', 'an action mapping survives absent clip metadata');
});

test('rejects unsafe clocks, unknown states, and out-of-band durations', () => {
  assert.throws(() => createExpressionMixer('', {}), /ownerId/);
  assert.throws(
    () => createExpressionMixer(OWNER, { transitionDuration: 0.02 }),
    /between 0.03 and 0.16/,
  );
  assert.throws(
    () => createExpressionMixer(OWNER, { transitionDuration: 0.17 }),
    /between 0.03 and 0.16/,
  );
  assert.throws(
    () => createExpressionMixer(OWNER, { blinkTransitionDuration: 0.02 }),
    /between 0.03 and 0.16/,
  );

  const mixer = createExpressionMixer(OWNER, { autoBlink: false });
  assert.throws(() => mixer.tick(-0.01), /zero or greater/);
  assert.throws(() => mixer.setTarget('surprised'), /known expression state/);
  assert.throws(() => mixer.setContext({ currentTime: Number.NaN }), /finite number/);
  assert.throws(
    () => mixer.setContext({ events: [{ name: 'expression', state: 'surprised' }] }),
    /event expression must name a known expression state/,
  );
  assert.throws(
    () => new AnimationController({
      idle: { duration: 1, mode: 'loop', expression: {}, tracks: {} },
    }),
    /expression must be a non-empty string/,
  );
});
