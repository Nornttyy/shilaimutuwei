function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function completeTracks(bones, tracks) {
  return Object.fromEntries(
    bones.map((bone) => [bone, tracks[bone] ?? { rotation: 0 }]),
  );
}

function completeClipTracks(bones, clips) {
  return Object.fromEntries(
    Object.entries(clips).map(([name, clip]) => [name, {
      ...clip,
      tracks: completeTracks(bones, clip.tracks),
    }]),
  );
}

function clipTime(duration, ratio) {
  return Number((duration * ratio).toFixed(4));
}

function expressionTracks(clipName, duration, blinkAt) {
  if (clipName === 'idle') {
    const blinkHalfWidth = Math.min(0.075, duration * 0.07);
    const blinkStart = Number((blinkAt - blinkHalfWidth).toFixed(4));
    const blinkEnd = Number((blinkAt + blinkHalfWidth).toFixed(4));
    return {
      eyes: {
        rotation: 0,
        scaleY: [[0, 1], [blinkStart, 1], [blinkAt, 0.12], [blinkEnd, 1], [duration, 1]],
      },
      mouth: { rotation: 0 },
    };
  }

  if (clipName === 'attack') {
    const focus = clipTime(duration, 0.3);
    const impact = clipTime(duration, 0.62);
    return {
      eyes: {
        rotation: 0,
        scaleX: [[0, 1], [focus, 1.04], [impact, 1.08], [duration, 1]],
        scaleY: [[0, 1], [focus, 0.82], [impact, 0.7], [duration, 1]],
      },
      mouth: {
        rotation: 0,
        scaleX: [[0, 1], [focus, 0.96], [impact, 1.06], [duration, 1]],
        scaleY: [[0, 1], [focus, 1.08], [impact, 1.36], [duration, 1]],
      },
    };
  }

  if (clipName === 'hurt') {
    const flinch = clipTime(duration, 0.22);
    const recoil = clipTime(duration, 0.55);
    return {
      eyes: {
        rotation: 0,
        scaleX: [[0, 1], [flinch, 1.07], [recoil, 1.02], [duration, 1]],
        scaleY: [[0, 1], [flinch, 0.24], [recoil, 0.5], [duration, 1]],
      },
      mouth: {
        scaleX: [[0, 1], [flinch, 0.72], [recoil, 0.86], [duration, 1]],
        scaleY: [[0, 1], [flinch, 0.82], [recoil, 0.94], [duration, 1]],
        rotation: [[0, 0], [flinch, -0.14], [recoil, 0.06], [duration, 0]],
      },
    };
  }

  if (clipName === 'downed' || clipName === 'death') {
    const close = clipTime(duration, 0.42);
    return {
      eyes: {
        rotation: 0,
        scaleX: [[0, 1], [close, 1.08], [duration, 1.1]],
        scaleY: [[0, 1], [close, 0.2], [duration, 0.12]],
      },
      mouth: {
        scaleX: [[0, 1], [close, 0.82], [duration, 0.76]],
        scaleY: [[0, 1], [duration, 0.86]],
        rotation: [[0, 0], [close, 0.06], [duration, 0.1]],
      },
    };
  }

  return {
    eyes: { rotation: 0 },
    mouth: { rotation: 0 },
  };
}

function withProceduralExpressions(bones, clips, blinkAt) {
  const complete = completeClipTracks(bones, clips);
  return Object.fromEntries(
    Object.entries(complete).map(([clipName, clip]) => [clipName, {
      ...clip,
      tracks: {
        ...clip.tracks,
        ...expressionTracks(clipName, clip.duration, blinkAt),
      },
    }]),
  );
}

const SHELL_BONES = ['root', 'body', 'shell', 'face', 'eyes', 'mouth', 'front'];
const BUG_BONES = ['root', 'body', 'legsA', 'legsB', 'antennae', 'face', 'eyes', 'mouth'];
const CRYSTAL_BONES = ['root', 'body', 'needles', 'face', 'eyes', 'mouth', 'front'];
const BUBBLE_BONES = [
  'root',
  'body',
  'bubbles',
  'bubblesBack',
  'halo',
  'ringBack',
  'ringFront',
  'face',
  'eyes',
  'mouth',
];
const SPROUT_BONES = ['root', 'body', 'sprout', 'pack', 'face', 'eyes', 'mouth'];
const WINDCAP_BONES = ['root', 'stem', 'cap', 'face', 'eyes', 'mouth'];
const STONE_BONES = ['root', 'body', 'rocks', 'face', 'eyes', 'mouth'];
const BOSS_BONES = ['root', 'body', 'tentacles', 'crown', 'core', 'face', 'eyes', 'mouth'];

const shellClips = {
  idle: {
    duration: 1.4,
    mode: 'loop',
    priority: 0,
    tracks: {
      root: {
        y: [[0, 0], [0.7, -1.5], [1.4, 0]],
      },
      body: {
        scaleX: [[0, 1], [0.7, 1.025], [1.4, 1]],
        scaleY: [[0, 1], [0.7, 0.975], [1.4, 1]],
      },
      shell: {
        rotation: [[0, -0.015], [0.7, 0.02], [1.4, -0.015]],
      },
      face: {
        y: [[0, 0], [0.7, -0.4], [1.4, 0]],
      },
      front: {
        rotation: [[0, 0.015], [0.7, -0.025], [1.4, 0.015]],
      },
    },
  },
  attack: {
    duration: 0.46,
    mode: 'once',
    priority: 20,
    tracks: {
      root: {
        x: [[0, 0], [0.12, -2], [0.27, 7], [0.46, 0]],
        y: [[0, 0], [0.12, 1], [0.27, -1], [0.46, 0]],
      },
      body: {
        rotation: [[0, 0], [0.12, -0.09], [0.27, 0.13], [0.46, 0]],
        scaleX: [[0, 1], [0.12, 0.94], [0.27, 1.08], [0.46, 1]],
        scaleY: [[0, 1], [0.12, 1.05], [0.27, 0.94], [0.46, 1]],
      },
      shell: {
        rotation: [[0, 0], [0.12, -0.12], [0.27, 0.08], [0.46, 0]],
      },
      face: {
        x: [[0, 0], [0.12, -1], [0.27, 2], [0.46, 0]],
      },
      front: {
        rotation: [[0, 0], [0.12, -0.15], [0.27, 0.18], [0.46, 0]],
      },
    },
    events: [{ time: 0.27, name: 'hit' }],
  },
  hurt: {
    duration: 0.32,
    mode: 'once',
    priority: 40,
    tracks: {
      root: {
        x: [[0, 0], [0.06, -5], [0.14, 3], [0.22, -1.5], [0.32, 0]],
        rotation: [[0, 0], [0.06, -0.08], [0.14, 0.055], [0.32, 0]],
        alpha: [[0, 1], [0.06, 0.62], [0.14, 1], [0.22, 0.74], [0.32, 1]],
      },
      body: {
        scaleX: [[0, 1], [0.06, 0.92], [0.14, 1.05], [0.32, 1]],
        scaleY: [[0, 1], [0.06, 1.08], [0.14, 0.96], [0.32, 1]],
      },
      shell: {
        rotation: [[0, 0], [0.06, -0.1], [0.14, 0.07], [0.32, 0]],
      },
      face: {
        x: [[0, 0], [0.06, -1.5], [0.14, 0.7], [0.32, 0]],
      },
      front: {
        rotation: [[0, 0], [0.06, -0.13], [0.14, 0.08], [0.32, 0]],
      },
    },
    events: [{ time: 0.06, name: 'hurt-flash' }],
  },
  downed: {
    duration: 0.5,
    mode: 'hold',
    priority: 90,
    tracks: {
      root: {
        y: [[0, 0], [0.22, -2], [0.5, 5]],
        rotation: [[0, 0], [0.22, -0.07], [0.5, -0.23]],
        alpha: [[0, 1], [0.5, 0.82]],
      },
      body: {
        scaleX: [[0, 1], [0.22, 1.08], [0.5, 1.14]],
        scaleY: [[0, 1], [0.22, 0.91], [0.5, 0.72]],
      },
      shell: {
        rotation: [[0, 0], [0.5, -0.12]],
      },
      face: {
        y: [[0, 0], [0.5, 2.5]],
        rotation: [[0, 0], [0.5, 0.08]],
      },
      front: {
        rotation: [[0, 0], [0.5, -0.18]],
      },
    },
    events: [{ time: 0.5, name: 'downed' }],
  },
};

const bugClips = {
  idle: {
    duration: 1.1,
    mode: 'loop',
    priority: 0,
    tracks: {
      root: {
        y: [[0, 0], [0.55, -1], [1.1, 0]],
      },
      body: {
        scaleX: [[0, 1], [0.55, 1.025], [1.1, 1]],
        scaleY: [[0, 1], [0.55, 0.975], [1.1, 1]],
      },
      legsA: {
        rotation: [[0, -0.035], [0.55, 0.035], [1.1, -0.035]],
      },
      legsB: {
        rotation: [[0, 0.035], [0.55, -0.035], [1.1, 0.035]],
      },
      antennae: {
        rotation: [[0, -0.025], [0.55, 0.035], [1.1, -0.025]],
      },
      face: {
        y: [[0, 0], [0.55, -0.35], [1.1, 0]],
      },
    },
  },
  move: {
    duration: 0.56,
    mode: 'loop',
    priority: 0,
    tracks: {
      root: {
        y: [[0, 0], [0.14, -2], [0.28, 0], [0.42, -2], [0.56, 0]],
      },
      body: {
        rotation: [[0, -0.025], [0.14, 0.035], [0.28, -0.025], [0.42, 0.035], [0.56, -0.025]],
        scaleX: [[0, 1.03], [0.14, 0.98], [0.28, 1.03], [0.42, 0.98], [0.56, 1.03]],
        scaleY: [[0, 0.97], [0.14, 1.03], [0.28, 0.97], [0.42, 1.03], [0.56, 0.97]],
      },
      legsA: {
        rotation: [[0, -0.2], [0.14, 0.2], [0.28, -0.2], [0.42, 0.2], [0.56, -0.2]],
      },
      legsB: {
        rotation: [[0, 0.2], [0.14, -0.2], [0.28, 0.2], [0.42, -0.2], [0.56, 0.2]],
      },
      antennae: {
        rotation: [[0, -0.08], [0.14, 0.08], [0.28, -0.08], [0.42, 0.08], [0.56, -0.08]],
      },
      face: {
        y: [[0, 0], [0.14, -0.7], [0.28, 0], [0.42, -0.7], [0.56, 0]],
      },
    },
    events: [
      { time: 0.14, name: 'step' },
      { time: 0.42, name: 'step' },
    ],
  },
  attack: {
    duration: 0.5,
    mode: 'once',
    priority: 20,
    tracks: {
      root: {
        x: [[0, 0], [0.15, -3], [0.29, 8], [0.5, 0]],
        y: [[0, 0], [0.15, 1], [0.29, -1], [0.5, 0]],
      },
      body: {
        rotation: [[0, 0], [0.15, 0.1], [0.29, -0.14], [0.5, 0]],
        scaleX: [[0, 1], [0.15, 0.92], [0.29, 1.1], [0.5, 1]],
        scaleY: [[0, 1], [0.15, 1.07], [0.29, 0.93], [0.5, 1]],
      },
      legsA: {
        rotation: [[0, 0], [0.15, 0.13], [0.29, -0.19], [0.5, 0]],
      },
      legsB: {
        rotation: [[0, 0], [0.15, -0.13], [0.29, 0.19], [0.5, 0]],
      },
      antennae: {
        rotation: [[0, 0], [0.15, 0.17], [0.29, -0.22], [0.5, 0]],
      },
      face: {
        x: [[0, 0], [0.15, 1], [0.29, -2], [0.5, 0]],
      },
    },
    events: [{ time: 0.29, name: 'hit' }],
  },
  hurt: {
    duration: 0.3,
    mode: 'once',
    priority: 40,
    tracks: {
      root: {
        x: [[0, 0], [0.06, -5], [0.13, 3], [0.21, -1.5], [0.3, 0]],
        alpha: [[0, 1], [0.06, 0.58], [0.13, 1], [0.21, 0.72], [0.3, 1]],
      },
      body: {
        rotation: [[0, 0], [0.06, 0.1], [0.13, -0.065], [0.3, 0]],
        scaleX: [[0, 1], [0.06, 0.9], [0.13, 1.06], [0.3, 1]],
        scaleY: [[0, 1], [0.06, 1.1], [0.13, 0.95], [0.3, 1]],
      },
      legsA: {
        rotation: [[0, 0], [0.06, 0.16], [0.13, -0.1], [0.3, 0]],
      },
      legsB: {
        rotation: [[0, 0], [0.06, -0.16], [0.13, 0.1], [0.3, 0]],
      },
      antennae: {
        rotation: [[0, 0], [0.06, 0.2], [0.13, -0.12], [0.3, 0]],
      },
      face: {
        x: [[0, 0], [0.06, 1.5], [0.13, -0.8], [0.3, 0]],
      },
    },
    events: [{ time: 0.06, name: 'hurt-flash' }],
  },
  death: {
    duration: 0.4,
    mode: 'hold',
    priority: 100,
    tracks: {
      root: {
        y: [[0, 0], [0.16, -3], [0.4, 7]],
        rotation: [[0, 0], [0.16, 0.09], [0.4, -0.38]],
        alpha: [[0, 1], [0.3, 1], [0.4, 0.18]],
      },
      body: {
        scaleX: [[0, 1], [0.16, 1.12], [0.4, 1.22]],
        scaleY: [[0, 1], [0.16, 0.86], [0.4, 0.42]],
      },
      legsA: {
        rotation: [[0, 0], [0.16, 0.18], [0.4, 0.34]],
      },
      legsB: {
        rotation: [[0, 0], [0.16, -0.18], [0.4, -0.34]],
      },
      antennae: {
        rotation: [[0, 0], [0.16, 0.22], [0.4, 0.48]],
      },
      face: {
        y: [[0, 0], [0.4, 2.5]],
        rotation: [[0, 0], [0.4, 0.14]],
      },
    },
    events: [{ time: 0.3, name: 'death' }],
  },
};

export const SHELL_CLIPS = deepFreeze(withProceduralExpressions(SHELL_BONES, shellClips, 0.98));
export const BUG_CLIPS = deepFreeze(withProceduralExpressions(BUG_BONES, bugClips, 0.72));

const crystalClips = {
  idle: {
    duration: 1.25,
    mode: 'loop',
    priority: 0,
    tracks: completeTracks(CRYSTAL_BONES, {
      root: { y: [[0, 0], [0.625, -1.2], [1.25, 0]] },
      body: {
        scaleX: [[0, 1], [0.625, 1.02], [1.25, 1]],
        scaleY: [[0, 1], [0.625, 0.98], [1.25, 1]],
      },
      needles: { rotation: [[0, -0.025], [0.625, 0.035], [1.25, -0.025]] },
      face: { y: [[0, 0], [0.625, -0.35], [1.25, 0]] },
      front: { rotation: [[0, 0.015], [0.625, -0.025], [1.25, 0.015]] },
    }),
  },
  attack: {
    duration: 0.38,
    mode: 'once',
    priority: 20,
    tracks: completeTracks(CRYSTAL_BONES, {
      root: {
        x: [[0, 0], [0.11, 1.5], [0.22, -4], [0.38, 0]],
        y: [[0, 0], [0.11, 1], [0.22, -1], [0.38, 0]],
      },
      body: {
        rotation: [[0, 0], [0.11, 0.07], [0.22, -0.1], [0.38, 0]],
        scaleX: [[0, 1], [0.11, 0.94], [0.22, 1.06], [0.38, 1]],
        scaleY: [[0, 1], [0.11, 1.05], [0.22, 0.95], [0.38, 1]],
      },
      needles: {
        x: [[0, 0], [0.11, -3], [0.22, 2], [0.38, 0]],
        rotation: [[0, 0], [0.11, -0.14], [0.22, 0.12], [0.38, 0]],
        scaleY: [[0, 1], [0.11, 0.9], [0.22, 1.1], [0.38, 1]],
      },
      face: { x: [[0, 0], [0.11, 1], [0.22, -1.5], [0.38, 0]] },
      front: { rotation: [[0, 0], [0.11, -0.13], [0.22, 0.15], [0.38, 0]] },
    }),
    events: [{ time: 0.22, name: 'hit' }],
  },
  hurt: {
    duration: 0.28,
    mode: 'once',
    priority: 40,
    tracks: completeTracks(CRYSTAL_BONES, {
      root: {
        x: [[0, 0], [0.06, -5], [0.14, 2.2], [0.28, 0]],
        rotation: [[0, 0], [0.06, -0.08], [0.14, 0.045], [0.28, 0]],
        alpha: [[0, 1], [0.06, 0.6], [0.14, 1], [0.21, 0.76], [0.28, 1]],
      },
      body: {
        scaleX: [[0, 1], [0.06, 0.9], [0.14, 1.05], [0.28, 1]],
        scaleY: [[0, 1], [0.06, 1.09], [0.14, 0.96], [0.28, 1]],
      },
      needles: { rotation: [[0, 0], [0.06, -0.16], [0.14, 0.09], [0.28, 0]] },
      face: { x: [[0, 0], [0.06, -1.5], [0.14, 0.7], [0.28, 0]] },
      front: { rotation: [[0, 0], [0.06, -0.12], [0.14, 0.06], [0.28, 0]] },
    }),
    events: [{ time: 0.06, name: 'hurt-flash' }],
  },
  downed: {
    duration: 0.5,
    mode: 'hold',
    priority: 90,
    tracks: completeTracks(CRYSTAL_BONES, {
      root: {
        y: [[0, 0], [0.2, -2], [0.5, 5]],
        rotation: [[0, 0], [0.2, -0.06], [0.5, -0.2]],
        alpha: [[0, 1], [0.5, 0.82]],
      },
      body: {
        scaleX: [[0, 1], [0.2, 1.08], [0.5, 1.15]],
        scaleY: [[0, 1], [0.2, 0.91], [0.5, 0.7]],
      },
      needles: { rotation: [[0, 0], [0.5, -0.18]] },
      face: { y: [[0, 0], [0.5, 2.4]], rotation: [[0, 0], [0.5, 0.07]] },
      front: { rotation: [[0, 0], [0.5, -0.16]] },
    }),
    events: [{ time: 0.5, name: 'downed' }],
  },
};

const bubbleClips = {
  idle: {
    duration: 1.5,
    mode: 'loop',
    priority: 0,
    tracks: completeTracks(BUBBLE_BONES, {
      root: { y: [[0, 0], [0.75, -1.8], [1.5, 0]] },
      body: {
        scaleX: [[0, 1], [0.75, 1.018], [1.5, 1]],
        scaleY: [[0, 1], [0.75, 0.982], [1.5, 1]],
      },
      bubbles: { y: [[0, 0], [0.75, -2], [1.5, 0]], rotation: [[0, -0.025], [0.75, 0.035], [1.5, -0.025]] },
      halo: { scaleX: [[0, 1], [0.75, 1.03], [1.5, 1]], scaleY: [[0, 1], [0.75, 1.03], [1.5, 1]] },
      face: { y: [[0, 0], [0.75, -0.4], [1.5, 0]] },
    }),
  },
  attack: {
    duration: 0.46,
    mode: 'once',
    priority: 20,
    tracks: completeTracks(BUBBLE_BONES, {
      root: { x: [[0, 0], [0.17, 1], [0.29, -4.5], [0.46, 0]], y: [[0, 0], [0.17, 1], [0.29, -1], [0.46, 0]] },
      body: {
        rotation: [[0, 0], [0.17, 0.07], [0.29, -0.11], [0.46, 0]],
        scaleX: [[0, 1], [0.17, 1.1], [0.29, 0.94], [0.46, 1]],
        scaleY: [[0, 1], [0.17, 1.08], [0.29, 0.96], [0.46, 1]],
      },
      bubbles: { x: [[0, 0], [0.17, -2], [0.29, 3], [0.46, 0]], rotation: [[0, 0], [0.17, -0.12], [0.29, 0.18], [0.46, 0]] },
      halo: { x: [[0, 0], [0.17, 2], [0.29, 5], [0.46, 0]], scaleX: [[0, 1], [0.17, 1.16], [0.29, 0.9], [0.46, 1]], scaleY: [[0, 1], [0.17, 1.16], [0.29, 0.93], [0.46, 1]] },
      face: { x: [[0, 0], [0.17, 1.5], [0.29, -1.5], [0.46, 0]] },
    }),
    events: [{ time: 0.29, name: 'hit' }],
  },
  hurt: {
    duration: 0.3,
    mode: 'once',
    priority: 40,
    tracks: completeTracks(BUBBLE_BONES, {
      root: { x: [[0, 0], [0.06, -5], [0.15, 2.2], [0.3, 0]], alpha: [[0, 1], [0.06, 0.6], [0.15, 1], [0.22, 0.76], [0.3, 1]] },
      body: { scaleX: [[0, 1], [0.06, 0.88], [0.15, 1.06], [0.3, 1]], scaleY: [[0, 1], [0.06, 1.08], [0.15, 0.96], [0.3, 1]] },
      bubbles: { x: [[0, 0], [0.06, -4], [0.15, 2], [0.3, 0]], rotation: [[0, 0], [0.06, -0.18], [0.15, 0.1], [0.3, 0]] },
      halo: { scaleX: [[0, 1], [0.06, 0.78], [0.15, 1.08], [0.3, 1]], scaleY: [[0, 1], [0.06, 1.15], [0.15, 0.95], [0.3, 1]] },
      face: { x: [[0, 0], [0.06, -1.5], [0.15, 0.7], [0.3, 0]] },
    }),
    events: [{ time: 0.06, name: 'hurt-flash' }],
  },
  downed: {
    duration: 0.52,
    mode: 'hold',
    priority: 90,
    tracks: completeTracks(BUBBLE_BONES, {
      root: { y: [[0, 0], [0.22, -2], [0.52, 5]], rotation: [[0, 0], [0.22, -0.05], [0.52, -0.19]], alpha: [[0, 1], [0.52, 0.8]] },
      body: { scaleX: [[0, 1], [0.22, 1.1], [0.52, 1.18]], scaleY: [[0, 1], [0.22, 0.9], [0.52, 0.68]] },
      bubbles: { y: [[0, 0], [0.52, 4]], rotation: [[0, 0], [0.52, -0.2]], alpha: [[0, 1], [0.52, 0.7]] },
      halo: { scaleX: [[0, 1], [0.52, 1.16]], scaleY: [[0, 1], [0.52, 0.72]] },
      face: { y: [[0, 0], [0.52, 2.5]], rotation: [[0, 0], [0.52, 0.08]] },
    }),
    events: [{ time: 0.52, name: 'downed' }],
  },
};

const sproutClips = {
  idle: {
    duration: 1.35,
    mode: 'loop',
    priority: 0,
    tracks: completeTracks(SPROUT_BONES, {
      root: { y: [[0, 0], [0.675, -1.3], [1.35, 0]] },
      body: { scaleX: [[0, 1], [0.675, 1.02], [1.35, 1]], scaleY: [[0, 1], [0.675, 0.98], [1.35, 1]] },
      sprout: { rotation: [[0, -0.035], [0.675, 0.045], [1.35, -0.035]] },
      pack: { rotation: [[0, 0.02], [0.675, -0.03], [1.35, 0.02]] },
      face: { y: [[0, 0], [0.675, -0.35], [1.35, 0]] },
    }),
  },
  attack: {
    duration: 0.46,
    mode: 'once',
    priority: 20,
    tracks: completeTracks(SPROUT_BONES, {
      root: { x: [[0, 0], [0.16, -2], [0.29, 3.5], [0.46, 0]], y: [[0, 0], [0.16, 2], [0.29, -1.5], [0.46, 0]] },
      body: { rotation: [[0, 0], [0.16, -0.09], [0.29, 0.12], [0.46, 0]], scaleX: [[0, 1], [0.16, 1.08], [0.29, 0.95], [0.46, 1]], scaleY: [[0, 1], [0.16, 0.9], [0.29, 1.06], [0.46, 1]] },
      sprout: { y: [[0, 0], [0.16, 3], [0.29, -3], [0.46, 0]], rotation: [[0, 0], [0.16, -0.2], [0.29, 0.24], [0.46, 0]], scaleX: [[0, 1], [0.16, 0.85], [0.29, 1.2], [0.46, 1]] },
      pack: { rotation: [[0, 0], [0.16, -0.12], [0.29, 0.16], [0.46, 0]] },
      face: { x: [[0, 0], [0.16, -1], [0.29, 1.5], [0.46, 0]], y: [[0, 0], [0.16, 1], [0.29, -0.8], [0.46, 0]] },
    }),
    events: [{ time: 0.29, name: 'hit' }],
  },
  hurt: {
    duration: 0.3,
    mode: 'once',
    priority: 40,
    tracks: completeTracks(SPROUT_BONES, {
      root: { x: [[0, 0], [0.06, -5], [0.15, 2.2], [0.3, 0]], rotation: [[0, 0], [0.06, -0.07], [0.15, 0.04], [0.3, 0]], alpha: [[0, 1], [0.06, 0.6], [0.15, 1], [0.22, 0.76], [0.3, 1]] },
      body: { scaleX: [[0, 1], [0.06, 0.9], [0.15, 1.06], [0.3, 1]], scaleY: [[0, 1], [0.06, 1.08], [0.15, 0.96], [0.3, 1]] },
      sprout: { rotation: [[0, 0], [0.06, -0.28], [0.15, 0.12], [0.3, 0]], scaleX: [[0, 1], [0.06, 0.72], [0.15, 0.92], [0.3, 1]] },
      pack: { x: [[0, 0], [0.06, -2], [0.15, 1], [0.3, 0]], rotation: [[0, 0], [0.06, -0.15], [0.15, 0.08], [0.3, 0]] },
      face: { x: [[0, 0], [0.06, -1.5], [0.15, 0.7], [0.3, 0]] },
    }),
    events: [{ time: 0.06, name: 'hurt-flash' }],
  },
  downed: {
    duration: 0.52,
    mode: 'hold',
    priority: 90,
    tracks: completeTracks(SPROUT_BONES, {
      root: { y: [[0, 0], [0.22, -2], [0.52, 5]], rotation: [[0, 0], [0.22, -0.05], [0.52, -0.2]], alpha: [[0, 1], [0.52, 0.82]] },
      body: { scaleX: [[0, 1], [0.22, 1.08], [0.52, 1.16]], scaleY: [[0, 1], [0.22, 0.91], [0.52, 0.7]] },
      sprout: { rotation: [[0, 0], [0.52, -0.26]], scaleX: [[0, 1], [0.52, 0.78]] },
      pack: { rotation: [[0, 0], [0.52, -0.18]] },
      face: { y: [[0, 0], [0.52, 2.4]], rotation: [[0, 0], [0.52, 0.08]] },
    }),
    events: [{ time: 0.52, name: 'downed' }],
  },
};

const windcapClips = {
  idle: {
    duration: 1.1,
    mode: 'loop',
    priority: 0,
    tracks: completeTracks(WINDCAP_BONES, {
      root: { y: [[0, 0], [0.55, -1.2], [1.1, 0]] },
      stem: { scaleX: [[0, 1], [0.55, 1.025], [1.1, 1]], scaleY: [[0, 1], [0.55, 0.975], [1.1, 1]] },
      cap: { rotation: [[0, -0.035], [0.55, 0.045], [1.1, -0.035]], y: [[0, 0], [0.55, -0.5], [1.1, 0]] },
      face: { y: [[0, 0], [0.55, -0.3], [1.1, 0]] },
    }),
  },
  move: {
    duration: 0.34,
    mode: 'loop',
    priority: 0,
    tracks: completeTracks(WINDCAP_BONES, {
      root: { y: [[0, 0], [0.085, -3], [0.17, 0], [0.255, -2], [0.34, 0]] },
      stem: { rotation: [[0, -0.04], [0.085, 0.06], [0.17, -0.04], [0.255, 0.06], [0.34, -0.04]], scaleX: [[0, 1.05], [0.085, 0.96], [0.17, 1.05], [0.255, 0.96], [0.34, 1.05]], scaleY: [[0, 0.95], [0.085, 1.05], [0.17, 0.95], [0.255, 1.05], [0.34, 0.95]] },
      cap: { x: [[0, -1], [0.085, -4], [0.17, -1], [0.255, -4], [0.34, -1]], rotation: [[0, -0.1], [0.085, 0.12], [0.17, -0.1], [0.255, 0.12], [0.34, -0.1]] },
      face: { y: [[0, 0], [0.085, -1], [0.17, 0], [0.255, -0.7], [0.34, 0]] },
    }),
    events: [{ time: 0.085, name: 'step' }, { time: 0.255, name: 'step' }],
  },
  attack: {
    duration: 0.32,
    mode: 'once',
    priority: 20,
    tracks: completeTracks(WINDCAP_BONES, {
      root: { x: [[0, 0], [0.1, -3], [0.2, 10], [0.32, 0]], y: [[0, 0], [0.1, 1], [0.2, -2], [0.32, 0]] },
      stem: { rotation: [[0, 0], [0.1, -0.11], [0.2, 0.15], [0.32, 0]], scaleX: [[0, 1], [0.1, 0.92], [0.2, 1.12], [0.32, 1]], scaleY: [[0, 1], [0.1, 1.08], [0.2, 0.9], [0.32, 1]] },
      cap: { x: [[0, 0], [0.1, -5], [0.2, 4], [0.32, 0]], rotation: [[0, 0], [0.1, -0.2], [0.2, 0.24], [0.32, 0]], scaleX: [[0, 1], [0.1, 1.1], [0.2, 0.92], [0.32, 1]] },
      face: { x: [[0, 0], [0.1, -1], [0.2, 2], [0.32, 0]] },
    }),
    events: [{ time: 0.2, name: 'hit' }],
  },
  hurt: {
    duration: 0.28,
    mode: 'once',
    priority: 40,
    tracks: completeTracks(WINDCAP_BONES, {
      root: { x: [[0, 0], [0.06, -6], [0.14, 2.5], [0.28, 0]], alpha: [[0, 1], [0.06, 0.58], [0.14, 1], [0.21, 0.72], [0.28, 1]] },
      stem: { rotation: [[0, 0], [0.06, -0.16], [0.14, 0.08], [0.28, 0]], scaleX: [[0, 1], [0.06, 0.9], [0.14, 1.06], [0.28, 1]], scaleY: [[0, 1], [0.06, 1.1], [0.14, 0.95], [0.28, 1]] },
      cap: { x: [[0, 0], [0.06, 3], [0.14, -1.5], [0.28, 0]], rotation: [[0, 0], [0.06, 0.18], [0.14, -0.09], [0.28, 0]] },
      face: { x: [[0, 0], [0.06, -1.5], [0.14, 0.7], [0.28, 0]] },
    }),
    events: [{ time: 0.06, name: 'hurt-flash' }],
  },
  death: {
    duration: 0.38,
    mode: 'hold',
    priority: 100,
    tracks: completeTracks(WINDCAP_BONES, {
      root: { y: [[0, 0], [0.14, -2], [0.38, 8]], rotation: [[0, 0], [0.14, 0.06], [0.38, -0.3]], alpha: [[0, 1], [0.3, 1], [0.38, 0.2]] },
      stem: { y: [[0, 0], [0.38, 5]], scaleX: [[0, 1], [0.14, 1.12], [0.38, 1.28]], scaleY: [[0, 1], [0.14, 0.82], [0.38, 0.32]] },
      cap: { y: [[0, 0], [0.14, 3], [0.38, 12]], rotation: [[0, 0], [0.14, 0.08], [0.38, -0.24]], scaleX: [[0, 1], [0.38, 1.16]], scaleY: [[0, 1], [0.38, 0.72]] },
      face: { y: [[0, 0], [0.38, 5]], alpha: [[0, 1], [0.38, 0.45]] },
    }),
    events: [{ time: 0.3, name: 'death' }],
  },
};

const stoneClips = {
  idle: {
    duration: 1.6,
    mode: 'loop',
    priority: 0,
    tracks: completeTracks(STONE_BONES, {
      root: { y: [[0, 0], [0.8, -0.65], [1.6, 0]] },
      body: { scaleX: [[0, 1], [0.8, 1.012], [1.6, 1]], scaleY: [[0, 1], [0.8, 0.988], [1.6, 1]] },
      rocks: { rotation: [[0, -0.012], [0.8, 0.016], [1.6, -0.012]] },
      face: { y: [[0, 0], [0.8, -0.2], [1.6, 0]] },
    }),
  },
  move: {
    duration: 0.5,
    mode: 'loop',
    priority: 0,
    tracks: completeTracks(STONE_BONES, {
      root: { y: [[0, 0], [0.125, -1], [0.25, -2.2], [0.375, 0.8], [0.5, 0]] },
      body: { rotation: [[0, -0.025], [0.125, 0.025], [0.25, 0.05], [0.375, -0.055], [0.5, -0.025]], scaleX: [[0, 1.04], [0.25, 0.98], [0.375, 1.08], [0.5, 1.04]], scaleY: [[0, 0.96], [0.25, 1.03], [0.375, 0.91], [0.5, 0.96]] },
      rocks: { x: [[0, -1], [0.125, 2], [0.25, 4], [0.375, -2], [0.5, -1]], y: [[0, 0], [0.25, -3], [0.375, 1], [0.5, 0]], rotation: [[0, -0.04], [0.25, 0.08], [0.375, -0.09], [0.5, -0.04]] },
      face: { y: [[0, 0], [0.25, -0.5], [0.375, 0.4], [0.5, 0]] },
    }),
    events: [{ time: 0.375, name: 'step' }],
  },
  attack: {
    duration: 0.4,
    mode: 'once',
    priority: 20,
    tracks: completeTracks(STONE_BONES, {
      root: { x: [[0, 0], [0.14, -3], [0.27, 9], [0.4, 0]], y: [[0, 0], [0.14, -2], [0.27, 2], [0.4, 0]] },
      body: { rotation: [[0, 0], [0.14, -0.11], [0.27, 0.16], [0.4, 0]], scaleX: [[0, 1], [0.14, 0.91], [0.27, 1.14], [0.4, 1]], scaleY: [[0, 1], [0.14, 1.1], [0.27, 0.84], [0.4, 1]] },
      rocks: { x: [[0, 0], [0.14, -4], [0.27, 5], [0.4, 0]], y: [[0, 0], [0.14, -5], [0.27, 3], [0.4, 0]], rotation: [[0, 0], [0.14, -0.16], [0.27, 0.2], [0.4, 0]] },
      face: { x: [[0, 0], [0.14, -1], [0.27, 2], [0.4, 0]], y: [[0, 0], [0.14, -1], [0.27, 1], [0.4, 0]] },
    }),
    events: [{ time: 0.27, name: 'hit' }],
  },
  hurt: {
    duration: 0.3,
    mode: 'once',
    priority: 40,
    tracks: completeTracks(STONE_BONES, {
      root: { x: [[0, 0], [0.07, -4], [0.15, 1.8], [0.3, 0]], alpha: [[0, 1], [0.07, 0.62], [0.15, 1], [0.22, 0.76], [0.3, 1]] },
      body: { scaleX: [[0, 1], [0.07, 0.92], [0.15, 1.04], [0.3, 1]], scaleY: [[0, 1], [0.07, 1.07], [0.15, 0.97], [0.3, 1]] },
      rocks: { x: [[0, 0], [0.07, -3], [0.15, 2], [0.3, 0]], y: [[0, 0], [0.07, -2], [0.15, 1], [0.3, 0]], rotation: [[0, 0], [0.07, -0.13], [0.15, 0.08], [0.3, 0]] },
      face: { x: [[0, 0], [0.07, -1.5], [0.15, 0.6], [0.3, 0]] },
    }),
    events: [{ time: 0.07, name: 'hurt-flash' }],
  },
  death: {
    duration: 0.42,
    mode: 'hold',
    priority: 100,
    tracks: completeTracks(STONE_BONES, {
      root: { y: [[0, 0], [0.16, -1], [0.42, 7]], rotation: [[0, 0], [0.16, 0.04], [0.42, -0.18]], alpha: [[0, 1], [0.34, 1], [0.42, 0.2]] },
      body: { scaleX: [[0, 1], [0.16, 1.08], [0.42, 1.2]], scaleY: [[0, 1], [0.16, 0.9], [0.42, 0.5]] },
      rocks: { x: [[0, 0], [0.16, 3], [0.42, 8]], y: [[0, 0], [0.16, 2], [0.42, 11]], rotation: [[0, 0], [0.16, 0.1], [0.42, 0.32]], scaleX: [[0, 1], [0.42, 1.12]], scaleY: [[0, 1], [0.42, 0.72]] },
      face: { y: [[0, 0], [0.42, 4]], alpha: [[0, 1], [0.32, 0.8], [0.42, 0.25]] },
    }),
    events: [{ time: 0.34, name: 'death' }],
  },
};

const bossClips = {
  idle: {
    duration: 1.8,
    mode: 'loop',
    priority: 0,
    tracks: completeTracks(BOSS_BONES, {
      root: { y: [[0, 0], [0.9, -1], [1.8, 0]] },
      body: { scaleX: [[0, 1], [0.9, 1.015], [1.8, 1]], scaleY: [[0, 1], [0.9, 0.985], [1.8, 1]] },
      tentacles: { rotation: [[0, -0.025], [0.9, 0.035], [1.8, -0.025]], scaleX: [[0, 1], [0.9, 1.03], [1.8, 1]] },
      crown: { y: [[0, 0], [0.9, -1], [1.8, 0]], rotation: [[0, -0.015], [0.9, 0.02], [1.8, -0.015]] },
      core: { scaleX: [[0, 1], [0.9, 1.05], [1.8, 1]], scaleY: [[0, 1], [0.9, 1.05], [1.8, 1]], alpha: [[0, 0.82], [0.9, 1], [1.8, 0.82]] },
      face: { y: [[0, 0], [0.9, -0.3], [1.8, 0]] },
    }),
  },
  move: {
    duration: 0.58,
    mode: 'loop',
    priority: 0,
    tracks: completeTracks(BOSS_BONES, {
      root: { y: [[0, 0], [0.145, -1], [0.29, -2], [0.435, 0.7], [0.58, 0]] },
      body: { rotation: [[0, -0.02], [0.145, 0.015], [0.29, 0.035], [0.435, -0.04], [0.58, -0.02]], scaleX: [[0, 1.025], [0.29, 0.98], [0.435, 1.055], [0.58, 1.025]], scaleY: [[0, 0.975], [0.29, 1.025], [0.435, 0.94], [0.58, 0.975]] },
      tentacles: { x: [[0, -1], [0.145, 2], [0.29, 4], [0.435, -2], [0.58, -1]], rotation: [[0, -0.07], [0.29, 0.09], [0.435, -0.11], [0.58, -0.07]] },
      crown: { x: [[0, -1], [0.29, 2], [0.435, -1.5], [0.58, -1]], y: [[0, 0], [0.29, -2], [0.435, 1], [0.58, 0]], rotation: [[0, -0.025], [0.29, 0.055], [0.435, -0.06], [0.58, -0.025]] },
      core: { alpha: [[0, 0.85], [0.29, 1], [0.58, 0.85]] },
      face: { y: [[0, 0], [0.29, -0.5], [0.435, 0.3], [0.58, 0]] },
    }),
    events: [{ time: 0.435, name: 'step' }],
  },
  attack: {
    duration: 0.6,
    mode: 'once',
    priority: 20,
    tracks: completeTracks(BOSS_BONES, {
      root: { x: [[0, 0], [0.18, -4], [0.37, 12], [0.6, 0]], y: [[0, 0], [0.18, 1], [0.37, -2], [0.6, 0]] },
      body: { rotation: [[0, 0], [0.18, -0.1], [0.37, 0.14], [0.6, 0]], scaleX: [[0, 1], [0.18, 0.9], [0.37, 1.15], [0.6, 1]], scaleY: [[0, 1], [0.18, 1.08], [0.37, 0.9], [0.6, 1]] },
      tentacles: { x: [[0, 0], [0.18, -5], [0.37, 6], [0.6, 0]], rotation: [[0, 0], [0.18, -0.18], [0.37, 0.22], [0.6, 0]], scaleX: [[0, 1], [0.18, 0.88], [0.37, 1.18], [0.6, 1]] },
      crown: { x: [[0, 0], [0.18, -3], [0.37, 3], [0.6, 0]], y: [[0, 0], [0.18, -2], [0.37, 1], [0.6, 0]], rotation: [[0, 0], [0.18, -0.12], [0.37, 0.15], [0.6, 0]] },
      core: { scaleX: [[0, 1], [0.18, 0.88], [0.37, 1.16], [0.6, 1]], scaleY: [[0, 1], [0.18, 0.88], [0.37, 1.16], [0.6, 1]], alpha: [[0, 0.85], [0.18, 1], [0.37, 0.9], [0.6, 0.85]] },
      face: { x: [[0, 0], [0.18, -2], [0.37, 3], [0.6, 0]] },
    }),
    events: [{ time: 0.37, name: 'hit' }],
  },
  hurt: {
    duration: 0.32,
    mode: 'once',
    priority: 40,
    tracks: completeTracks(BOSS_BONES, {
      root: { x: [[0, 0], [0.07, -5], [0.16, 2], [0.32, 0]], alpha: [[0, 1], [0.07, 0.58], [0.16, 1], [0.24, 0.72], [0.32, 1]] },
      body: { scaleX: [[0, 1], [0.07, 0.91], [0.16, 1.05], [0.32, 1]], scaleY: [[0, 1], [0.07, 1.08], [0.16, 0.96], [0.32, 1]] },
      tentacles: { x: [[0, 0], [0.07, -3], [0.16, 1.5], [0.32, 0]], rotation: [[0, 0], [0.07, -0.13], [0.16, 0.07], [0.32, 0]] },
      crown: { x: [[0, 0], [0.07, 3], [0.16, -1.5], [0.32, 0]], rotation: [[0, 0], [0.07, 0.14], [0.16, -0.08], [0.32, 0]] },
      core: { scaleX: [[0, 1], [0.07, 0.8], [0.16, 1.12], [0.32, 1]], scaleY: [[0, 1], [0.07, 0.8], [0.16, 1.12], [0.32, 1]], alpha: [[0, 0.85], [0.07, 1], [0.16, 0.7], [0.32, 0.85]] },
      face: { x: [[0, 0], [0.07, -2], [0.16, 0.8], [0.32, 0]] },
    }),
    events: [{ time: 0.07, name: 'hurt-flash' }],
  },
  death: {
    duration: 0.68,
    mode: 'hold',
    priority: 100,
    tracks: completeTracks(BOSS_BONES, {
      root: { y: [[0, 0], [0.2, -2], [0.68, 10]], rotation: [[0, 0], [0.2, 0.04], [0.68, -0.22]], alpha: [[0, 1], [0.55, 1], [0.68, 0.18]] },
      body: { scaleX: [[0, 1], [0.2, 1.08], [0.68, 1.25]], scaleY: [[0, 1], [0.2, 0.9], [0.68, 0.48]] },
      tentacles: { x: [[0, 0], [0.2, 3], [0.68, 8]], y: [[0, 0], [0.2, 2], [0.68, 9]], rotation: [[0, 0], [0.2, 0.1], [0.68, 0.3]], scaleY: [[0, 1], [0.68, 0.58]] },
      crown: { x: [[0, 0], [0.2, -5], [0.68, -16]], y: [[0, 0], [0.2, 4], [0.68, 22]], rotation: [[0, 0], [0.2, -0.18], [0.68, -0.72]], alpha: [[0, 1], [0.55, 0.9], [0.68, 0.35]] },
      core: { scaleX: [[0, 1], [0.2, 0.85], [0.68, 0.55]], scaleY: [[0, 1], [0.2, 0.85], [0.68, 0.55]], alpha: [[0, 0.85], [0.2, 0.5], [0.68, 0.08]] },
      face: { y: [[0, 0], [0.68, 5]], rotation: [[0, 0], [0.68, 0.1]], alpha: [[0, 1], [0.68, 0.35]] },
    }),
    events: [{ time: 0.55, name: 'death' }],
  },
  charge: {
    duration: 0.75,
    mode: 'hold',
    priority: 10,
    tracks: completeTracks(BOSS_BONES, {
      root: { x: [[0, 0], [0.3, -1], [0.75, -3]], y: [[0, 0], [0.3, 1], [0.75, -2]] },
      body: { rotation: [[0, 0], [0.3, -0.035], [0.75, -0.08]], scaleX: [[0, 1], [0.3, 0.98], [0.75, 0.94]], scaleY: [[0, 1], [0.3, 1.03], [0.75, 1.09]] },
      tentacles: { x: [[0, 0], [0.3, -2], [0.75, -5]], y: [[0, 0], [0.3, 1], [0.75, -3]], rotation: [[0, 0], [0.3, -0.08], [0.75, -0.18]], scaleX: [[0, 1], [0.3, 0.96], [0.75, 0.88]], scaleY: [[0, 1], [0.3, 1.05], [0.75, 1.16]] },
      crown: { y: [[0, 0], [0.3, -2], [0.75, -5]], rotation: [[0, 0], [0.3, -0.04], [0.75, -0.1]] },
      core: { scaleX: [[0, 0.88], [0.3, 1.05], [0.75, 1.28]], scaleY: [[0, 0.88], [0.3, 1.05], [0.75, 1.28]], alpha: [[0, 0.55], [0.3, 0.78], [0.75, 1]] },
      face: { x: [[0, 0], [0.3, 1], [0.75, 3]], y: [[0, 0], [0.3, -1], [0.75, -3]], rotation: [[0, 0], [0.3, 0.03], [0.75, 0.08]] },
    }),
    events: [{ time: 0.75, name: 'charge-ready' }],
  },
};

export const CRYSTAL_CLIPS = deepFreeze(withProceduralExpressions(CRYSTAL_BONES, crystalClips, 0.86));
export const BUBBLE_CLIPS = deepFreeze(withProceduralExpressions(BUBBLE_BONES, bubbleClips, 1.12));
export const SPROUT_CLIPS = deepFreeze(withProceduralExpressions(SPROUT_BONES, sproutClips, 0.81));
export const WINDCAP_CLIPS = deepFreeze(withProceduralExpressions(WINDCAP_BONES, windcapClips, 0.66));
export const STONE_CLIPS = deepFreeze(withProceduralExpressions(STONE_BONES, stoneClips, 1.16));
export const BOSS_CLIPS = deepFreeze(withProceduralExpressions(BOSS_BONES, bossClips, 1.28));
