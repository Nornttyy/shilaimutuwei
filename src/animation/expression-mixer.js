import { EXPRESSION_SPEC } from './rigs.js';

export const DEFAULT_EXPRESSION_TRANSITION_DURATION = 0.075;
export const DEFAULT_BLINK_TRANSITION_DURATION = 0.05;
export const MIN_EXPRESSION_TRANSITION_DURATION = 0.03;
export const MAX_EXPRESSION_TRANSITION_DURATION = 0.16;

const DEFAULT_BLINK_INTERVAL = 3.2;
const DEFAULT_BLINK_HOLD = 0.18;
const EPSILON = 1e-10;

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

function assertNonNegative(value, label) {
  assertFiniteNumber(value, label);
  if (value < 0) throw new RangeError(`${label} must be zero or greater.`);
}

function assertTransitionDuration(value, label) {
  assertFiniteNumber(value, label);
  if (
    value < MIN_EXPRESSION_TRANSITION_DURATION
    || value > MAX_EXPRESSION_TRANSITION_DURATION
  ) {
    throw new RangeError(
      `${label} must be between ${MIN_EXPRESSION_TRANSITION_DURATION}`
      + ` and ${MAX_EXPRESSION_TRANSITION_DURATION} seconds.`,
    );
  }
}

function assertOwnerId(ownerId) {
  if (typeof ownerId !== 'string' || ownerId.length === 0) {
    throw new TypeError('ownerId must be a non-empty string.');
  }
}

function assertExpressionSpec(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new TypeError('expression spec must be an object.');
  }
  if (!spec.states || typeof spec.states !== 'object' || Array.isArray(spec.states)) {
    throw new TypeError('expression spec must contain a states object.');
  }
  if (!spec.slots || typeof spec.slots !== 'object' || Array.isArray(spec.slots)) {
    throw new TypeError('expression spec must contain a slots object.');
  }
  if (!Object.hasOwn(spec.states, spec.defaultState)) {
    throw new RangeError('expression spec defaultState must name a known state.');
  }

  for (const [slotName, slot] of Object.entries(spec.slots)) {
    if (!slot || typeof slot !== 'object' || !Array.isArray(slot.variants)) {
      throw new TypeError(`expression spec slot ${slotName} must declare variants.`);
    }
    for (const [stateName, state] of Object.entries(spec.states)) {
      const variant = state?.[slotName];
      if (!slot.variants.includes(variant)) {
        throw new RangeError(
          `expression state ${stateName}.${slotName} must name a declared variant.`,
        );
      }
    }
  }
}

function assertState(spec, state, label = 'targetState') {
  if (typeof state !== 'string' || !Object.hasOwn(spec.states, state)) {
    throw new RangeError(`${label} must name a known expression state.`);
  }
  return state;
}

function ownerFraction(ownerId) {
  // FNV-1a gives every owner a stable blink phase without runtime randomness.
  let hash = 2166136261;
  for (let index = 0; index < ownerId.length; index += 1) {
    hash ^= ownerId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x100000000;
}

function isBlinkMoment(ownerId, currentTime, blinkInterval, blinkHold) {
  // Keep the opening pose readable, then stagger later blinks by character.
  const firstBlink = blinkInterval * (0.42 + ownerFraction(ownerId) * 0.32);
  if (currentTime + EPSILON < firstBlink) return false;
  return (currentTime - firstBlink) % blinkInterval < blinkHold;
}

function smoothstep(progress) {
  return progress * progress * (3 - 2 * progress);
}

function eventExpressionState(events) {
  if (events == null) return null;
  if (!Array.isArray(events)) throw new TypeError('events must be an array.');

  let selected = null;
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    const state = event.expression
      ?? (event.name === 'expression'
        ? (event.state ?? event.payload?.state ?? event.payload?.expression)
        : null);
    if (state != null) selected = state;
  }
  return selected;
}

/**
 * Resolves a shared expression state from gameplay context.
 *
 * Priority is explicit target, latest expression event, clip metadata, then an
 * action mapped through clipStates/direct state names. Normal/default contexts
 * receive a deterministic owner-staggered blink.
 */
export function resolveExpressionState({
  ownerId,
  action = null,
  clipState = null,
  events = null,
  currentTime = 0,
  targetState = null,
  spec = EXPRESSION_SPEC,
  autoBlink = true,
  blinkInterval = DEFAULT_BLINK_INTERVAL,
  blinkHold = DEFAULT_BLINK_HOLD,
} = {}) {
  assertOwnerId(ownerId);
  assertExpressionSpec(spec);
  assertNonNegative(currentTime, 'currentTime');
  assertFiniteNumber(blinkInterval, 'blinkInterval');
  assertFiniteNumber(blinkHold, 'blinkHold');
  if (blinkInterval <= 0) throw new RangeError('blinkInterval must be greater than zero.');
  if (blinkHold <= 0 || blinkHold >= blinkInterval) {
    throw new RangeError('blinkHold must be greater than zero and shorter than blinkInterval.');
  }

  if (targetState != null) return assertState(spec, targetState);

  const eventState = eventExpressionState(events);
  if (eventState != null) return assertState(spec, eventState, 'event expression');
  if (clipState != null) return assertState(spec, clipState, 'clip expression');

  let state = spec.defaultState;
  if (typeof action === 'string' && action.length > 0) {
    const actionState = spec.clipStates?.[action]
      ?? (Object.hasOwn(spec.states, action) ? action : null);
    if (actionState != null) state = assertState(spec, actionState, `clipStates.${action}`);
  }

  if (
    autoBlink
    && state === spec.defaultState
    && Object.hasOwn(spec.states, 'blink')
    && isBlinkMoment(ownerId, currentTime, blinkInterval, blinkHold)
  ) {
    return 'blink';
  }
  return state;
}

/**
 * Cross-fades the independent eyes and mouth slots from EXPRESSION_SPEC.
 *
 * Only two variants per slot are ever required by the renderer. Reversing a
 * transition is exact; a third rapid target is queued until the current pair
 * finishes so retargeting never causes an alpha discontinuity.
 */
export class ExpressionMixer {
  constructor({
    ownerId,
    spec = EXPRESSION_SPEC,
    initialState = spec.defaultState,
    transitionDuration = DEFAULT_EXPRESSION_TRANSITION_DURATION,
    blinkTransitionDuration = Math.min(
      DEFAULT_BLINK_TRANSITION_DURATION,
      transitionDuration,
    ),
    autoBlink = true,
    blinkInterval = DEFAULT_BLINK_INTERVAL,
    blinkHold = DEFAULT_BLINK_HOLD,
  } = {}) {
    assertOwnerId(ownerId);
    assertExpressionSpec(spec);
    assertTransitionDuration(transitionDuration, 'transitionDuration');
    assertTransitionDuration(blinkTransitionDuration, 'blinkTransitionDuration');

    // Validate blink timing eagerly even if context resolution happens later.
    resolveExpressionState({
      ownerId,
      currentTime: 0,
      spec,
      autoBlink: false,
      blinkInterval,
      blinkHold,
    });

    this.ownerId = ownerId;
    this.spec = spec;
    this.transitionDuration = transitionDuration;
    this.blinkTransitionDuration = blinkTransitionDuration;
    this.activeTransitionDuration = transitionDuration;
    this.autoBlink = autoBlink;
    this.blinkInterval = blinkInterval;
    this.blinkHold = blinkHold;

    const state = assertState(spec, initialState, 'initialState');
    this.from = state;
    this.to = state;
    this.mix = 1;
    this.pending = null;
  }

  /** Resolve and select a target from an action/time context. */
  setContext({
    ownerId = this.ownerId,
    action = null,
    clipState = null,
    events = null,
    currentTime = 0,
    targetState = null,
  } = {}) {
    if (ownerId !== this.ownerId) {
      throw new RangeError(`ExpressionMixer belongs to ${this.ownerId}, not ${ownerId}.`);
    }
    return this.setTarget(resolveExpressionState({
      ownerId,
      action,
      clipState,
      events,
      currentTime,
      targetState,
      spec: this.spec,
      autoBlink: this.autoBlink,
      blinkInterval: this.blinkInterval,
      blinkHold: this.blinkHold,
    }));
  }

  /** Select from an AnimationController without consuming its event queue. */
  setAnimationContext(controller, {
    events = null,
    currentTime = 0,
    targetState = null,
  } = {}) {
    if (!controller || typeof controller !== 'object') {
      throw new TypeError('controller must be an AnimationController-like object.');
    }
    return this.setContext({
      action: controller.actionName ?? controller.current ?? null,
      clipState: controller.expressionState ?? null,
      events,
      currentTime,
      targetState,
    });
  }

  /** Select an explicit state without advancing the transition clock. */
  setTarget(targetState) {
    const target = assertState(this.spec, targetState);
    const active = this.from !== this.to && this.mix < 1;

    if (target === this.to) {
      const changed = this.pending != null;
      this.pending = null;
      return changed;
    }

    if (!active) {
      this.from = this.to;
      this.to = target;
      this.mix = 0;
      this.activeTransitionDuration = this._durationFor(this.from, this.to);
      this.pending = null;
      return true;
    }

    if (target === this.from) {
      [this.from, this.to] = [this.to, this.from];
      this.mix = 1 - this.mix;
      this.activeTransitionDuration = this._durationFor(this.from, this.to);
      this.pending = null;
      return true;
    }

    const changed = this.pending !== target;
    this.pending = target;
    return changed;
  }

  _durationFor(from, to) {
    return from === 'blink' || to === 'blink'
      ? this.blinkTransitionDuration
      : this.transitionDuration;
  }

  /** Advance by seconds. Passing zero intentionally freezes all expression state. */
  tick(dt) {
    assertNonNegative(dt, 'dt');
    if (dt === 0) return this;

    let remaining = dt;
    while (remaining > EPSILON && this.from !== this.to && this.mix < 1) {
      const secondsToTarget = (1 - this.mix) * this.activeTransitionDuration;
      const elapsed = Math.min(remaining, secondsToTarget);
      this.mix = Math.min(1, this.mix + elapsed / this.activeTransitionDuration);
      remaining -= elapsed;

      if (this.mix + EPSILON < 1) break;

      this.mix = 1;
      this.from = this.to;
      if (this.pending == null || this.pending === this.to) {
        this.pending = null;
        break;
      }

      this.to = this.pending;
      this.pending = null;
      this.mix = 0;
      this.activeTransitionDuration = this._durationFor(this.from, this.to);
    }
    return this;
  }

  /** Return renderer-ready variant names and normalized cross-fade weights. */
  sample() {
    const mix = smoothstep(Math.max(0, Math.min(1, this.mix)));
    const slots = {};

    for (const [slotName, slot] of Object.entries(this.spec.slots)) {
      const from = this.spec.states[this.from][slotName];
      const to = this.spec.states[this.to][slotName];
      const sameVariant = from === to;
      slots[slotName] = {
        bone: slot.bone,
        from,
        to,
        weights: sameVariant
          ? { from: 1, to: 0 }
          : { from: 1 - mix, to: mix },
      };
    }

    return {
      ownerId: this.ownerId,
      from: this.from,
      to: this.to,
      mix,
      pending: this.pending,
      slots,
    };
  }
}

export function createExpressionMixer(ownerId, options = {}) {
  return new ExpressionMixer({ ...options, ownerId });
}
