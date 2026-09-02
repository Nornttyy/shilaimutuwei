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
    charge: 'attack',
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
const SHELL_EYES_PIVOT = { x: 18.5, y: -42.5 };
const SHELL_MOUTH_PIVOT = { x: 21, y: -31.5 };

export const SHELL_RIG = deepFreeze({
  id: 'shell',
  root: 'root',
  expression: EXPRESSION_SPEC,
  bones: {
    root: {
      parent: null,
      children: ['motion'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    motion: {
      parent: 'root',
      children: ['deform'],
      pivot: { x: 0, y: 0 },
      layer: -19,
    },
    deform: {
      parent: 'motion',
      children: ['body', 'shellAssembly', 'face'],
      pivot: { x: 0, y: 0 },
      layer: -18,
    },
    body: {
      parent: 'deform',
      children: [],
      pivot: { x: 0, y: 0 },
      layer: 0,
    },
    shellAssembly: {
      parent: 'deform',
      children: ['shellBack', 'shellFront'],
      pivot: { x: -20, y: -63 },
      layer: -10,
    },
    shellBack: {
      parent: 'shellAssembly',
      children: [],
      pivot: { x: -20, y: -63 },
      layer: -10,
    },
    shellFront: {
      parent: 'shellAssembly',
      children: [],
      pivot: { x: -20, y: -63 },
      layer: 5,
    },
    face: {
      parent: 'deform',
      children: ['eyes', 'mouth'],
      pivot: { x: 19, y: -38 },
      layer: 10,
    },
    ...expressionBones(10, SHELL_EYES_PIVOT, SHELL_MOUTH_PIVOT),
  },
});

export const BUG_RIG = deepFreeze({
  id: 'bug',
  root: 'root',
  expression: EXPRESSION_SPEC,
  bones: {
    root: {
      parent: null,
      children: ['motion'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    motion: {
      parent: 'root',
      children: ['body', 'legsA', 'legsB', 'antennae', 'face'],
      pivot: { x: 0, y: 0 },
      layer: -19,
    },
    body: {
      parent: 'motion',
      children: [],
      pivot: { x: 0, y: 0 },
      layer: 10,
    },
    legsA: {
      parent: 'motion',
      children: [],
      pivot: { x: 0, y: -22 },
      layer: -10,
    },
    legsB: {
      parent: 'motion',
      children: [],
      pivot: { x: 0, y: -22 },
      layer: -9,
    },
    antennae: {
      parent: 'motion',
      children: [],
      pivot: { x: 0, y: -60 },
      layer: 0,
    },
    face: {
      parent: 'motion',
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
      children: ['motion'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    motion: {
      parent: 'root',
      children: ['body', 'needles', 'face', 'front'],
      pivot: { x: 0, y: 0 },
      layer: -19,
    },
    body: {
      parent: 'motion',
      children: [],
      pivot: { x: 0, y: 0 },
      layer: 0,
    },
    needles: {
      parent: 'motion',
      children: [
        'needleBottom',
        'needleLower',
        'needleMid',
        'needleMidUpper',
        'needleUpper',
        'needleTall',
        'needleRight',
      ],
      pivot: { x: -24.3, y: -48.4 },
      layer: -10,
    },
    needleBottom: {
      parent: 'needles',
      children: [],
      pivot: { x: -48.525, y: -12.911 },
      layer: -70,
    },
    needleLower: {
      parent: 'needles',
      children: [],
      pivot: { x: -46.051, y: -21.411 },
      layer: -60,
    },
    needleMid: {
      parent: 'needles',
      children: [],
      pivot: { x: -36.475, y: -34.968 },
      layer: -50,
    },
    needleMidUpper: {
      parent: 'needles',
      children: [],
      pivot: { x: -24.316, y: -48.418 },
      layer: -40,
    },
    needleUpper: {
      parent: 'needles',
      children: [],
      pivot: { x: -0.538, y: -64.342 },
      layer: -30,
    },
    needleTall: {
      parent: 'needles',
      children: [],
      pivot: { x: 16.247, y: -62.62 },
      layer: -20,
    },
    needleRight: {
      parent: 'needles',
      children: [],
      pivot: { x: 28.728, y: -61.329 },
      layer: -10,
    },
    face: {
      parent: 'motion',
      children: ['eyes', 'mouth'],
      pivot: { x: 22, y: -34 },
      layer: 10,
    },
    ...expressionBones(
      10,
      { x: 21.242, y: -38.063 },
      { x: 22.854, y: -28.413 },
    ),
    front: {
      parent: 'motion',
      children: [],
      pivot: { x: -19.6, y: -29.4 },
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
      children: ['motion'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    motion: {
      parent: 'root',
      children: ['deform', 'bubbles'],
      pivot: { x: 0, y: 0 },
      layer: -19,
    },
    deform: {
      parent: 'motion',
      children: ['body', 'halo', 'face'],
      pivot: { x: 0, y: 0 },
      layer: -18,
    },
    body: {
      parent: 'deform',
      children: [],
      pivot: { x: 0, y: 0 },
      layer: 0,
    },
    bubbles: {
      parent: 'motion',
      children: ['bubbleLarge', 'bubbleSmall', 'bubbleMedium'],
      pivot: { x: 28, y: -88 },
      layer: -20,
    },
    bubbleLarge: {
      parent: 'bubbles',
      children: [],
      pivot: { x: 28, y: -90 },
      layer: -20,
    },
    bubbleSmall: {
      parent: 'bubbles',
      children: [],
      pivot: { x: 9, y: -91 },
      layer: -19,
    },
    bubbleMedium: {
      parent: 'bubbles',
      children: [],
      pivot: { x: 45.5, y: -82 },
      layer: -18,
    },
    halo: {
      parent: 'deform',
      children: ['ring'],
      pivot: { x: 0, y: -21 },
      layer: 10,
    },
    ring: {
      parent: 'halo',
      children: [],
      pivot: { x: 0, y: 0 },
      layer: 30,
    },
    face: {
      parent: 'deform',
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
      children: ['motion'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    motion: {
      parent: 'root',
      children: ['body', 'sprout', 'pack', 'face'],
      pivot: { x: 0, y: 0 },
      layer: -19,
    },
    body: {
      parent: 'motion',
      children: [],
      pivot: { x: 0, y: 0 },
      layer: 0,
    },
    sprout: {
      parent: 'motion',
      children: ['leafLeft', 'leafRight', 'stemCollar'],
      pivot: { x: 7.5, y: -94.3 },
      layer: 29,
    },
    leafLeft: {
      parent: 'sprout',
      children: [],
      pivot: { x: 6.69, y: -94.39 },
      layer: 30,
    },
    leafRight: {
      parent: 'sprout',
      children: [],
      pivot: { x: 8.162, y: -94.267 },
      layer: 31,
    },
    stemCollar: {
      parent: 'sprout',
      children: [],
      pivot: { x: 6.076, y: -79.292 },
      layer: 32,
    },
    pack: {
      parent: 'motion',
      children: [],
      pivot: { x: 31.7, y: -34.5 },
      layer: 40,
    },
    face: {
      parent: 'motion',
      children: ['eyes', 'mouth'],
      pivot: { x: -10, y: -40 },
      layer: 20,
    },
    ...expressionBones(
      20,
      { x: -9.182, y: -44.067 },
      { x: -11.566, y: -35.133 },
    ),
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
      children: ['motion'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    motion: {
      parent: 'root',
      children: ['stem', 'cap', 'face'],
      pivot: { x: 0, y: 0 },
      layer: -19,
    },
    stem: {
      parent: 'motion',
      children: [],
      pivot: { x: 0, y: -6 },
      layer: 0,
    },
    cap: {
      parent: 'motion',
      children: [],
      pivot: { x: 1, y: -60 },
      layer: 10,
    },
    face: {
      parent: 'motion',
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
      children: ['motion'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    motion: {
      parent: 'root',
      children: ['body', 'rocks', 'face'],
      pivot: { x: 0, y: 0 },
      layer: -19,
    },
    body: {
      parent: 'motion',
      children: [],
      pivot: { x: 0, y: 0 },
      layer: 0,
    },
    rocks: {
      parent: 'motion',
      children: [],
      pivot: { x: 0, y: -43 },
      layer: 10,
    },
    face: {
      parent: 'motion',
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
      children: ['motion'],
      pivot: { x: 0, y: 0 },
      layer: -20,
    },
    motion: {
      parent: 'root',
      children: ['body', 'tentacles', 'acidShell', 'core', 'face'],
      pivot: { x: 0, y: 0 },
      layer: -19,
    },
    body: {
      parent: 'motion',
      children: [],
      pivot: { x: 0, y: 0 },
      layer: 0,
    },
    tentacles: {
      parent: 'motion',
      children: [],
      pivot: { x: 0, y: -6 },
      layer: -10,
    },
    acidShell: {
      parent: 'motion',
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
      parent: 'motion',
      children: [],
      pivot: { x: 0, y: -44 },
      layer: 30,
    },
    face: {
      parent: 'motion',
      children: ['eyes', 'mouth'],
      pivot: { x: 0, y: -49 },
      layer: 40,
    },
    ...expressionBones(40, { x: 0.5, y: -61 }, { x: 1, y: -19.5 }),
  },
});

/** Lightweight rig shared by the melee and ranged four-member soldier atlases. */
export const SOLDIER_RIG = deepFreeze({
  id: 'soldier',
  root: 'root',
  facing: 1,
  expression: {
    defaultState: 'normal',
    faceBone: 'face',
    slots: {
      eyes: { bone: 'eyes', variants: ['normal', 'attack', 'hurt'] },
      mouth: { bone: 'mouth', variants: ['normal', 'attack', 'hurt'] },
    },
    states: {
      normal: { eyes: 'normal', mouth: 'normal' },
      attack: { eyes: 'attack', mouth: 'attack' },
      hurt: { eyes: 'hurt', mouth: 'hurt' },
    },
    clipStates: { attack: 'attack', hurt: 'hurt' },
  },
  bones: {
    root: { parent: null, children: ['motion'], pivot: { x: 0, y: 0 }, layer: -20 },
    motion: {
      parent: 'root', children: ['deform', 'headgear', 'equipment'],
      pivot: { x: 0, y: -48 }, layer: -10,
    },
    deform: {
      parent: 'motion', children: ['body', 'face'], pivot: { x: 0, y: -40 }, layer: 0,
    },
    body: { parent: 'deform', children: [], pivot: { x: 0, y: -40 }, layer: 0 },
    face: {
      parent: 'deform', children: ['eyes', 'mouth'], pivot: { x: 0, y: -42 }, layer: 30,
    },
    eyes: { parent: 'face', children: [], pivot: { x: 0, y: -47 }, layer: 30 },
    mouth: { parent: 'face', children: [], pivot: { x: 0, y: -30 }, layer: 31 },
    headgear: {
      parent: 'motion', children: [], pivot: { x: 0, y: -73 }, layer: 10,
    },
    equipment: {
      parent: 'motion', children: [], pivot: { x: 24, y: -42 }, layer: 20,
    },
  },
});

/**
 * Hero-only variant of the compact 3x3 atlas rig.
 *
 * The production hero body atlas intentionally stays 3x3.  Its fourth facial
 * state lives in a separate 2x1 sidecar, so soldiers and enemies never become
 * coupled to hero skill art or start requesting it at runtime.
 */
export const HERO_ATLAS_RIG = deepFreeze({
  ...SOLDIER_RIG,
  id: 'hero-atlas',
  expression: {
    defaultState: 'normal',
    faceBone: 'face',
    slots: {
      eyes: { bone: 'eyes', variants: ['normal', 'attack', 'skill', 'hurt'] },
      mouth: { bone: 'mouth', variants: ['normal', 'attack', 'skill', 'hurt'] },
    },
    states: {
      normal: { eyes: 'normal', mouth: 'normal' },
      attack: { eyes: 'attack', mouth: 'attack' },
      skill: { eyes: 'skill', mouth: 'skill' },
      hurt: { eyes: 'hurt', mouth: 'hurt' },
    },
    clipStates: { attack: 'attack', skill: 'skill', hurt: 'hurt' },
  },
});
