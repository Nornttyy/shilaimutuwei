const TRANSFORM_PROPERTIES = Object.freeze([
  'x',
  'y',
  'rotation',
  'scaleX',
  'scaleY',
  'alpha',
]);

const IDENTITY_TRANSFORM = Object.freeze({
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  alpha: 1,
});

const PLAYBACK_MODES = new Set(['loop', 'once', 'hold']);
const TAU = Math.PI * 2;
const EPSILON = 1e-10;
const NORMALIZED_FROZEN_CLIPS = new WeakMap();

function isDeepFrozenData(value, seen = new WeakSet()) {
  if (
    value == null
    || (typeof value !== 'object' && typeof value !== 'function')
  ) return true;
  if (seen.has(value)) return true;

  try {
    if (!Object.isFrozen(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (
      prototype !== Object.prototype
      && prototype !== Array.prototype
      && prototype !== null
    ) return false;

    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      // Accessors can still return mutable data, so only cache plain frozen data.
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
      if (!isDeepFrozenData(descriptor.value, seen)) return false;
    }
    return true;
  } catch {
    // Unsupported exotic objects retain the original normalize-on-use behavior.
    return false;
  }
}

function assertFiniteNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

function normalizeKeyframes(value, clipName, boneName, property, duration) {
  const label = `${clipName}.${boneName}.${property}`;
  if (typeof value === 'number') {
    assertFiniteNumber(value, label);
    return Object.freeze([{ time: 0, value }]);
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a number or a non-empty keyframe array.`);
  }

  const frames = value.map((frame, index) => {
    const time = Array.isArray(frame) ? frame[0] : frame?.time;
    const frameValue = Array.isArray(frame) ? frame[1] : frame?.value;
    assertFiniteNumber(time, `${label}[${index}].time`);
    assertFiniteNumber(frameValue, `${label}[${index}].value`);
    if (time < 0 || time > duration) {
      throw new RangeError(`${label}[${index}].time must be within the clip duration.`);
    }
    return { time, value: frameValue };
  }).sort((a, b) => a.time - b.time);

  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index - 1].time === frames[index].time) {
      throw new RangeError(`${label} cannot contain duplicate keyframe times.`);
    }
  }
  return Object.freeze(frames.map(Object.freeze));
}

function normalizeClip(name, source) {
  if (!source || typeof source !== 'object') {
    throw new TypeError(`Clip ${name} must be an object.`);
  }
  const duration = source.duration;
  assertFiniteNumber(duration, `${name}.duration`);
  if (duration <= 0) throw new RangeError(`${name}.duration must be greater than zero.`);

  const mode = source.mode
    ?? (source.loop === true ? 'loop' : (source.hold === true ? 'hold' : 'once'));
  if (!PLAYBACK_MODES.has(mode)) {
    throw new RangeError(`${name}.mode must be loop, once, or hold.`);
  }

  const priority = source.priority ?? 0;
  assertFiniteNumber(priority, `${name}.priority`);

  const expression = source.expression ?? null;
  if (expression != null && (typeof expression !== 'string' || expression.length === 0)) {
    throw new TypeError(`${name}.expression must be a non-empty string when provided.`);
  }

  const sourceTracks = source.tracks ?? {};
  if (!sourceTracks || typeof sourceTracks !== 'object' || Array.isArray(sourceTracks)) {
    throw new TypeError(`${name}.tracks must be an object.`);
  }
  const tracks = {};
  for (const [boneName, sourceTrack] of Object.entries(sourceTracks)) {
    if (!sourceTrack || typeof sourceTrack !== 'object' || Array.isArray(sourceTrack)) {
      throw new TypeError(`${name}.${boneName} must be a transform track object.`);
    }
    const track = {};
    for (const [property, value] of Object.entries(sourceTrack)) {
      if (!TRANSFORM_PROPERTIES.includes(property)) {
        throw new RangeError(`${name}.${boneName} has an unsupported property: ${property}.`);
      }
      track[property] = normalizeKeyframes(value, name, boneName, property, duration);
    }
    tracks[boneName] = Object.freeze(track);
  }

  const sourceEvents = source.events ?? [];
  if (!Array.isArray(sourceEvents)) throw new TypeError(`${name}.events must be an array.`);
  const events = sourceEvents.map((event, index) => {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new TypeError(`${name}.events[${index}] must be an object.`);
    }
    assertFiniteNumber(event.time, `${name}.events[${index}].time`);
    if (event.time < 0 || event.time > duration) {
      throw new RangeError(`${name}.events[${index}].time must be within the clip duration.`);
    }
    if (typeof event.name !== 'string' || event.name.length === 0) {
      throw new TypeError(`${name}.events[${index}].name must be a non-empty string.`);
    }
    return Object.freeze({ ...event });
  }).sort((a, b) => a.time - b.time);

  return Object.freeze({
    name,
    duration,
    mode,
    priority,
    expression,
    tracks: Object.freeze(tracks),
    events: Object.freeze(events),
  });
}

function normalizeClips(clips) {
  if (!clips || typeof clips !== 'object' || Array.isArray(clips)) {
    throw new TypeError('clips must be an object keyed by clip name.');
  }
  const cached = NORMALIZED_FROZEN_CLIPS.get(clips);
  if (cached) return cached;

  const entries = Object.entries(clips);
  if (entries.length === 0) throw new RangeError('clips must contain at least one clip.');
  const normalized = new Map(
    entries.map(([name, clip]) => [name, normalizeClip(name, clip)]),
  );
  if (isDeepFrozenData(clips)) NORMALIZED_FROZEN_CLIPS.set(clips, normalized);
  return normalized;
}

function createPlayback(name) {
  return { name, elapsed: 0, firedEvents: new Set() };
}

function shortestAngleDelta(from, to) {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

function interpolate(from, to, amount, isRotation = false) {
  const delta = isRotation ? shortestAngleDelta(from, to) : to - from;
  return from + delta * amount;
}

function sampleKeyframes(frames, time, isRotation) {
  if (frames.length === 1 || time <= frames[0].time) return frames[0].value;
  const last = frames[frames.length - 1];
  if (time >= last.time) return last.value;

  for (let index = 1; index < frames.length; index += 1) {
    const right = frames[index];
    if (time <= right.time) {
      const left = frames[index - 1];
      const amount = (time - left.time) / (right.time - left.time);
      return interpolate(left.value, right.value, amount, isRotation);
    }
  }
  return last.value;
}

function localTime(clip, playback) {
  if (clip.mode === 'loop') return playback.elapsed % clip.duration;
  return Math.min(playback.elapsed, clip.duration);
}

function sampleSparseClip(clip, playback) {
  const time = localTime(clip, playback);
  const pose = {};
  for (const [boneName, track] of Object.entries(clip.tracks)) {
    const transform = {};
    for (const [property, frames] of Object.entries(track)) {
      transform[property] = sampleKeyframes(frames, time, property === 'rotation');
    }
    pose[boneName] = transform;
  }
  return pose;
}

function mergeSparsePose(target, source) {
  for (const [boneName, transform] of Object.entries(source)) {
    target[boneName] = { ...(target[boneName] ?? {}), ...transform };
  }
  return target;
}

function completePose(sparsePose) {
  const pose = {};
  for (const [boneName, transform] of Object.entries(sparsePose)) {
    pose[boneName] = { ...IDENTITY_TRANSFORM, ...transform };
  }
  return pose;
}

function copyPose(pose) {
  return Object.fromEntries(
    Object.entries(pose).map(([boneName, transform]) => [boneName, { ...transform }]),
  );
}

function blendPoses(fromPose, toPose, amount) {
  const result = {};
  const boneNames = new Set([...Object.keys(fromPose), ...Object.keys(toPose)]);
  for (const boneName of boneNames) {
    const from = { ...IDENTITY_TRANSFORM, ...(fromPose[boneName] ?? {}) };
    const to = { ...IDENTITY_TRANSFORM, ...(toPose[boneName] ?? {}) };
    const transform = {};
    for (const property of TRANSFORM_PROPERTIES) {
      transform[property] = interpolate(
        from[property],
        to[property],
        amount,
        property === 'rotation',
      );
    }
    result[boneName] = transform;
  }
  return result;
}

/**
 * Samples relative bone transforms from a small collection of keyframed clips.
 * Rotation values are radians. All returned transforms are deltas from bind pose.
 */
export class AnimationController {
  constructor(clips, { base = null, transitionDuration = 0.06 } = {}) {
    this._clips = normalizeClips(clips);
    assertFiniteNumber(transitionDuration, 'transitionDuration');
    if (transitionDuration < 0) {
      throw new RangeError('transitionDuration must be zero or greater.');
    }

    this.transitionDuration = transitionDuration;
    this._base = null;
    this._action = null;
    this._transition = null;
    this._events = [];

    if (base != null) {
      this._clip(base);
      this._base = createPlayback(base);
    }
  }

  get current() {
    return this._action?.name ?? this._base?.name ?? null;
  }

  get baseName() {
    return this._base?.name ?? null;
  }

  get actionName() {
    return this._action?.name ?? null;
  }

  /** Optional expression state declared by the active action/base clip. */
  get expressionState() {
    if (this._action) return this._clip(this._action.name).expression;
    return this._base ? this._clip(this._base.name).expression : null;
  }

  setBase(name) {
    this._clip(name);
    if (this._base?.name === name) return false;

    const outgoingPose = this.sample();
    this._base = createPlayback(name);
    this._beginTransition(outgoingPose);
    return true;
  }

  play(name, { restart = true } = {}) {
    const clip = this._clip(name);
    const currentClip = this._action ? this._clip(this._action.name) : null;

    if (this._action?.name === name && !restart) return false;
    if (currentClip && currentClip.priority > clip.priority) return false;

    const outgoingPose = this.sample();
    this._action = createPlayback(name);
    this._beginTransition(outgoingPose);
    return true;
  }

  update(dt) {
    assertFiniteNumber(dt, 'dt');
    if (dt < 0) throw new RangeError('dt must be zero or greater.');

    const actionClip = this._action ? this._clip(this._action.name) : null;
    if (actionClip?.mode === 'once') {
      const remaining = Math.max(0, actionClip.duration - this._action.elapsed);
      if (dt + EPSILON >= remaining) {
        this._advanceSegment(remaining);
        const outgoingPose = this.sample();
        this._action = null;
        this._beginTransition(outgoingPose);
        this._advanceSegment(Math.max(0, dt - remaining));
        return this;
      }
    }

    this._advanceSegment(dt);
    return this;
  }

  sample() {
    const currentPose = this._sampleCurrentPose();
    if (!this._transition || this._transition.elapsed >= this._transition.duration) {
      return currentPose;
    }
    return blendPoses(
      this._transition.fromPose,
      currentPose,
      this._transition.elapsed / this._transition.duration,
    );
  }

  drainEvents() {
    const events = this._events;
    this._events = [];
    return events;
  }

  _clip(name) {
    const clip = this._clips.get(name);
    if (!clip) throw new RangeError(`Unknown animation clip: ${name}`);
    return clip;
  }

  _sampleCurrentPose() {
    const sparsePose = {};
    if (this._base) {
      mergeSparsePose(sparsePose, sampleSparseClip(this._clip(this._base.name), this._base));
    }
    if (this._action) {
      mergeSparsePose(sparsePose, sampleSparseClip(this._clip(this._action.name), this._action));
    }
    return completePose(sparsePose);
  }

  _beginTransition(fromPose) {
    if (this.transitionDuration === 0 || Object.keys(fromPose).length === 0) {
      this._transition = null;
      return;
    }
    this._transition = {
      fromPose: copyPose(fromPose),
      elapsed: 0,
      duration: this.transitionDuration,
    };
  }

  _advanceSegment(dt) {
    if (dt <= 0) return;
    this._advanceTransition(dt);
    if (this._base) this._advancePlayback(this._base, dt);
    if (this._action) this._advancePlayback(this._action, dt);
  }

  _advanceTransition(dt) {
    if (!this._transition) return;
    this._transition.elapsed = Math.min(
      this._transition.duration,
      this._transition.elapsed + dt,
    );
    if (this._transition.elapsed >= this._transition.duration) this._transition = null;
  }

  _advancePlayback(playback, dt) {
    const clip = this._clip(playback.name);
    const from = playback.elapsed;
    const to = clip.mode === 'loop'
      ? from + dt
      : Math.min(clip.duration, from + dt);

    if (clip.mode === 'loop') this._emitLoopEvents(clip, from, to);
    else this._emitFiniteEvents(clip, playback, from, to);
    playback.elapsed = to;
  }

  _emitFiniteEvents(clip, playback, from, to) {
    clip.events.forEach((event, index) => {
      if (playback.firedEvents.has(index)) return;
      if (event.time > from + EPSILON && event.time <= to + EPSILON) {
        playback.firedEvents.add(index);
        this._queueEvent(clip, event, 0, event.time);
      }
    });
  }

  _emitLoopEvents(clip, from, to) {
    for (const event of clip.events) {
      const firstCycle = Math.max(
        0,
        Math.floor((from - event.time + EPSILON) / clip.duration) + 1,
      );
      const lastCycle = Math.floor((to - event.time + EPSILON) / clip.duration);
      for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
        const elapsed = cycle * clip.duration + event.time;
        if (elapsed > from + EPSILON && elapsed <= to + EPSILON) {
          this._queueEvent(clip, event, cycle, elapsed);
        }
      }
    }
  }

  _queueEvent(clip, event, cycle, elapsed) {
    this._events.push({ ...event, clip: clip.name, cycle, elapsed });
  }
}
