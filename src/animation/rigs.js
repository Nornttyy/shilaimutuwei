function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

/**
 * Shared facial-part contract for every character rig.
 *
 * `face` stays as the animated parent bone so all existing face tracks remain
 * valid. Renderers may select one eyes and one mouth variant for the resolved
 * state without coupling expression swaps to body animation clips.
 */
export const EXPRESSION_SPEC = deepFreeze({
  defaultState: 'normal',
  faceBone: 'face',
  slots: {
    eyes: {
      bone: 'eyes',
      variants: ['normal', 'blink', 'hurt', 'attack'],
    },
    mouth: {
      bone: 'mouth',
      variants: ['normal', 'open', 'hurt'],
    },
  },
  states: {
    normal: { eyes: 'normal', mouth: 'normal' },
    blink: { eyes: 'blink', mouth: 'normal' },
    hurt: { eyes: 'hurt', mouth: 'hurt' },
    attack: { eyes: 'attack', mouth: 'open' },
  },
  clipStates: {
    attack: 'attack',
    hurt: 'hurt',
    downed: 'hurt',
    death: 'hurt',
  },
});

function expressionBones(layer, eyesPivot, mouthPivot) {
  return {
    eyes: {
      parent: 'face',
      children: [],
      pivot: eyesPivot,
      layer,
    },
    mouth: {
      parent: 'face',
      children: [],
      pivot: mouthPivot,
      layer: layer + 1,
    },
  };
}

const SURVIVOR_EYES_PIVOT = { x: 0, y: -39 };
const SURVIVOR_MOUTH_PIVOT = { x: 0, y: -22.5 };

export const SHELL_RIG = deepFreeze({
  id: 'shell',
  root: 'root',
  expression: EXPRESSION_SPEC,
  bones: {
    root: {
      parent: null,
      children: ['body'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    body: {
      parent: 'root',
      children: ['shell', 'face', 'front'],
      pivot: { x: 0, y: 0 },
      layer: 0,
    },
    shell: {
      parent: 'body',
      children: [],
      pivot: { x: -35, y: -39 },
      layer: -10,
    },
    face: {
      parent: 'body',
      children: ['eyes', 'mouth'],
      pivot: { x: 0, y: -33 },
      layer: 10,
    },
    ...expressionBones(10, SURVIVOR_EYES_PIVOT, SURVIVOR_MOUTH_PIVOT),
    front: {
      parent: 'body',
      children: [],
      pivot: { x: 29, y: -24.5 },
      layer: 20,
    },
  },
});

export const BUG_RIG = deepFreeze({
  id: 'bug',
  root: 'root',
  expression: EXPRESSION_SPEC,
  bones: {
    root: {
      parent: null,
      children: ['body'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    body: {
      parent: 'root',
      children: ['legsA', 'legsB', 'antennae', 'face'],
      pivot: { x: 0, y: 0 },
      layer: 10,
    },
    legsA: {
      parent: 'body',
      children: [],
      pivot: { x: 0, y: -22 },
      layer: -10,
    },
    legsB: {
      parent: 'body',
      children: [],
      pivot: { x: 0, y: -22 },
      layer: -9,
    },
    antennae: {
      parent: 'body',
      children: [],
      pivot: { x: 0, y: -60 },
      layer: 0,
    },
    face: {
      parent: 'body',
      children: ['eyes', 'mouth'],
      pivot: { x: 0, y: -36 },
      layer: 20,
    },
    ...expressionBones(20, { x: 0, y: -41 }, { x: 0, y: -21 }),
  },
});

export const CRYSTAL_RIG = deepFreeze({
  id: 'crystal',
  root: 'root',
  expression: EXPRESSION_SPEC,
  bones: {
    root: {
      parent: null,
      children: ['body'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    body: {
      parent: 'root',
      children: ['needles', 'face', 'front'],
      pivot: { x: 0, y: 0 },
      layer: 0,
    },
    needles: {
      parent: 'body',
      children: [],
      pivot: { x: -35, y: -34 },
      layer: -10,
    },
    face: {
      parent: 'body',
      children: ['eyes', 'mouth'],
      pivot: { x: 0, y: -33 },
      layer: 10,
    },
    ...expressionBones(10, SURVIVOR_EYES_PIVOT, SURVIVOR_MOUTH_PIVOT),
    front: {
      parent: 'body',
      children: [],
      pivot: { x: 40, y: -21 },
      layer: 20,
    },
  },
});

export const BUBBLE_RIG = deepFreeze({
  id: 'bubble',
  root: 'root',
  expression: EXPRESSION_SPEC,
  bones: {
    root: {
      parent: null,
      children: ['body'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    body: {
      parent: 'root',
      children: ['bubbles', 'halo', 'face'],
      pivot: { x: 0, y: 0 },
      layer: 0,
    },
    bubbles: {
      parent: 'body',
      children: ['bubblesBack'],
      pivot: { x: -19, y: -72 },
      layer: -10,
    },
    bubblesBack: {
      parent: 'bubbles',
      children: [],
      pivot: { x: 0, y: 0 },
      layer: -10,
    },
    halo: {
      parent: 'body',
      children: ['ringBack', 'ringFront'],
      pivot: { x: 0, y: -21 },
      layer: 10,
    },
    ringBack: {
      parent: 'halo',
      children: [],
      pivot: { x: 0, y: 0 },
      layer: -5,
    },
    ringFront: {
      parent: 'halo',
      children: [],
      pivot: { x: 0, y: 0 },
      layer: 30,
    },
    face: {
      parent: 'body',
      children: ['eyes', 'mouth'],
      pivot: { x: 0, y: -33 },
      layer: 20,
    },
    ...expressionBones(20, SURVIVOR_EYES_PIVOT, SURVIVOR_MOUTH_PIVOT),
  },
});

export const SPROUT_RIG = deepFreeze({
  id: 'sprout',
  root: 'root',
  expression: EXPRESSION_SPEC,
  bones: {
    root: {
      parent: null,
      children: ['body'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    body: {
      parent: 'root',
      children: ['sprout', 'pack', 'face'],
      pivot: { x: 0, y: 0 },
      layer: 0,
    },
    sprout: {
      parent: 'body',
      children: [],
      pivot: { x: 0, y: -63 },
      layer: 30,
    },
    pack: {
      parent: 'body',
      children: [],
      pivot: { x: 31.5, y: -20 },
      layer: 40,
    },
    face: {
      parent: 'body',
      children: ['eyes', 'mouth'],
      pivot: { x: 0, y: -33 },
      layer: 20,
    },
    ...expressionBones(20, SURVIVOR_EYES_PIVOT, SURVIVOR_MOUTH_PIVOT),
  },
});

export const WINDCAP_RIG = deepFreeze({
  id: 'windcap',
  root: 'root',
  facing: -1,
  expression: EXPRESSION_SPEC,
  bones: {
    root: {
      parent: null,
      children: ['stem'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    stem: {
      parent: 'root',
      children: ['cap', 'face'],
      pivot: { x: 0, y: -6 },
      layer: 0,
    },
    cap: {
      parent: 'stem',
      children: [],
      pivot: { x: 1, y: -60 },
      layer: 10,
    },
    face: {
      parent: 'stem',
      children: ['eyes', 'mouth'],
      pivot: { x: 0, y: -35 },
      layer: 20,
    },
    ...expressionBones(20, { x: 0, y: -38 }, { x: 0, y: -23 }),
  },
});

export const STONE_RIG = deepFreeze({
  id: 'stone',
  root: 'root',
  facing: -1,
  expression: EXPRESSION_SPEC,
  bones: {
    root: {
      parent: null,
      children: ['body'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    body: {
      parent: 'root',
      children: ['rocks', 'face'],
      pivot: { x: 0, y: 0 },
      layer: 0,
    },
    rocks: {
      parent: 'body',
      children: [],
      pivot: { x: 0, y: -43 },
      layer: 10,
    },
    face: {
      parent: 'body',
      children: ['eyes', 'mouth'],
      pivot: { x: 0, y: -34 },
      layer: 20,
    },
    ...expressionBones(20, { x: 0, y: -35.5 }, { x: 0, y: -17.5 }),
  },
});

export const BOSS_RIG = deepFreeze({
  id: 'boss',
  root: 'root',
  facing: -1,
  expression: EXPRESSION_SPEC,
  bones: {
    root: {
      parent: null,
      children: ['body'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    body: {
      parent: 'root',
      children: ['tentacles', 'acidShell', 'core', 'face'],
      pivot: { x: 0, y: 0 },
      layer: 0,
    },
    tentacles: {
      parent: 'body',
      children: [],
      pivot: { x: 0, y: -6 },
      layer: -10,
    },
    acidShell: {
      parent: 'body',
      children: ['crown'],
      pivot: { x: 0, y: -75 },
      layer: 10,
    },
    crown: {
      parent: 'acidShell',
      children: [],
      pivot: { x: 0, y: -100 },
      layer: 20,
    },
    core: {
      parent: 'body',
      children: [],
      pivot: { x: 0, y: -44 },
      layer: 30,
    },
    face: {
      parent: 'body',
      children: ['eyes', 'mouth'],
      pivot: { x: 0, y: -49 },
      layer: 40,
    },
    ...expressionBones(40, { x: 0.5, y: -61 }, { x: 1, y: -19.5 }),
  },
});
