import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AnimationController } from '../src/animation/controller.js';
import { shouldUseGeneratedRigs } from '../src/animation/rig-mode.js';
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
  EXPRESSION_SPEC,
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

test('generated layered rigs are the public default with an explicit vector escape hatch', () => {
  assert.equal(shouldUseGeneratedRigs(''), true);
  assert.equal(shouldUseGeneratedRigs('?rigDebug=1'), true);
  assert.equal(shouldUseGeneratedRigs('?rig=generated'), true);
  assert.equal(shouldUseGeneratedRigs('?rig=vector'), false);
});

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

const ANIMATION_SPEC = JSON.parse(readFileSync(
  new URL('../assets/animation-spec.json', import.meta.url),
  'utf8',
));

const RIG_PARTS_SPEC = JSON.parse(readFileSync(
  new URL('../assets/rig-parts.json', import.meta.url),
  'utf8',
));

const OWNER_ID_BY_RIG = Object.freeze({
  shell: 'survivor-shell-shell',
  crystal: 'survivor-crystal-pin',
  bubble: 'survivor-bubble-float',
  sprout: 'survivor-moss-sprout',
  bug: 'enemy-soft-biter',
  windcap: 'enemy-windcap',
  stone: 'enemy-stone-lump',
  boss: 'enemy-acid-shell-king',
});

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
  assert.deepEqual(
    Object.keys(SHELL_RIG.bones),
    ['root', 'motion', 'body', 'shell', 'face', 'eyes', 'mouth', 'front'],
  );
  assert.deepEqual(
    Object.keys(BUG_RIG.bones),
    ['root', 'motion', 'body', 'legsA', 'legsB', 'antennae', 'face', 'eyes', 'mouth'],
  );

  assert.equal(SHELL_RIG.bones.shell.parent, 'motion');
  assert.deepEqual(SHELL_RIG.bones.shell.pivot, { x: -35, y: -39 });
  assert.equal(BUG_RIG.bones.antennae.parent, 'motion');
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
    assert.deepEqual(rig.bones.root.children, ['motion']);
    assert.equal(rig.bones.motion.parent, 'root');
    assert.deepEqual(rig.bones.motion.pivot, { x: 0, y: 0 });

    const bodyBone = label === 'windcap' ? 'stem' : 'body';
    assert.equal(rig.bones[bodyBone].parent, 'motion');
    assert.deepEqual(rig.bones[bodyBone].children, []);
    assert.equal(rig.bones.face.parent, 'motion');

    for (const boneName of boneNames.filter((name) => name !== bodyBone)) {
      let ancestor = rig.bones[boneName].parent;
      while (ancestor != null) {
        assert.notEqual(
          ancestor,
          bodyBone,
          `${label}.${boneName} must not inherit non-uniform ${bodyBone} squash`,
        );
        ancestor = rig.bones[ancestor].parent;
      }
    }

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
  assert.deepEqual(
    Object.keys(CRYSTAL_RIG.bones),
    [
      'root',
      'motion',
      'body',
      'needles',
      'needleBottom',
      'needleLower',
      'needleMid',
      'needleMidUpper',
      'needleUpper',
      'needleTall',
      'needleRight',
      'face',
      'eyes',
      'mouth',
      'front',
    ],
  );
  assert.deepEqual(
    Object.keys(BUBBLE_RIG.bones),
    [
      'root',
      'motion',
      'body',
      'bubbles',
      'bubblesBack',
      'halo',
      'ringBack',
      'ringFront',
      'face',
      'eyes',
      'mouth',
    ],
  );
  assert.deepEqual(
    Object.keys(SPROUT_RIG.bones),
    [
      'root',
      'motion',
      'body',
      'sprout',
      'leafLeft',
      'leafRight',
      'stemCollar',
      'pack',
      'face',
      'eyes',
      'mouth',
    ],
  );
  assert.deepEqual(
    Object.keys(WINDCAP_RIG.bones),
    ['root', 'motion', 'stem', 'cap', 'face', 'eyes', 'mouth'],
  );
  assert.deepEqual(
    Object.keys(STONE_RIG.bones),
    ['root', 'motion', 'body', 'rocks', 'face', 'eyes', 'mouth'],
  );
  assert.deepEqual(
    Object.keys(BOSS_RIG.bones),
    ['root', 'motion', 'body', 'tentacles', 'acidShell', 'crown', 'core', 'face', 'eyes', 'mouth'],
  );

  assert.deepEqual(CRYSTAL_RIG.bones.needles.pivot, { x: -24.3, y: -48.4 });
  assert.deepEqual(CRYSTAL_RIG.bones.needles.children, [
    'needleBottom',
    'needleLower',
    'needleMid',
    'needleMidUpper',
    'needleUpper',
    'needleTall',
    'needleRight',
  ]);
  assert.deepEqual(CRYSTAL_RIG.bones.needleBottom.pivot, { x: -48.525, y: -12.911 });
  assert.deepEqual(CRYSTAL_RIG.bones.needleRight.pivot, { x: 28.728, y: -61.329 });
  assert.deepEqual(CRYSTAL_RIG.bones.front.pivot, { x: -19.6, y: -29.4 });
  assert.deepEqual(SHELL_RIG.bones.front.pivot, { x: 29, y: -24.5 });
  assert.deepEqual(BUBBLE_RIG.bones.bubbles.pivot, { x: -19, y: -72 });
  assert.deepEqual(BUBBLE_RIG.bones.halo.pivot, { x: 0, y: -21 });
  assert.equal(BUBBLE_RIG.bones.bubblesBack.parent, 'bubbles');
  assert.deepEqual(BUBBLE_RIG.bones.bubblesBack.pivot, { x: 0, y: 0 });
  assert.equal(BUBBLE_RIG.bones.ringBack.parent, 'halo');
  assert.equal(BUBBLE_RIG.bones.ringFront.parent, 'halo');
  assert.deepEqual(SPROUT_RIG.bones.pack.pivot, { x: 31.7, y: -34.5 });
  assert.deepEqual(SPROUT_RIG.bones.sprout.pivot, { x: 7.5, y: -94.3 });
  assert.deepEqual(SPROUT_RIG.bones.sprout.children, ['leafLeft', 'leafRight', 'stemCollar']);
  assert.deepEqual(SPROUT_RIG.bones.leafLeft.pivot, { x: 6.69, y: -94.39 });
  assert.deepEqual(SPROUT_RIG.bones.leafRight.pivot, { x: 8.162, y: -94.267 });
  assert.deepEqual(SPROUT_RIG.bones.stemCollar.pivot, { x: 6.076, y: -79.292 });
  assert.equal(SPROUT_RIG.bones.pack.layer, 40);
  assert.deepEqual(WINDCAP_RIG.bones.stem.pivot, { x: 0, y: -6 });
  assert.deepEqual(WINDCAP_RIG.bones.cap.pivot, { x: 1, y: -60 });
  assert.deepEqual(STONE_RIG.bones.rocks.pivot, { x: 0, y: -43 });
  assert.deepEqual(BOSS_RIG.bones.tentacles.pivot, { x: 0, y: -6 });
  assert.deepEqual(BOSS_RIG.bones.acidShell.pivot, { x: 0, y: -75 });
  assert.equal(BOSS_RIG.bones.acidShell.parent, 'motion');
  assert.deepEqual(BOSS_RIG.bones.crown.pivot, { x: 0, y: -100 });
  assert.equal(BOSS_RIG.bones.crown.parent, 'acidShell');
  assert.deepEqual(BOSS_RIG.bones.core.pivot, { x: 0, y: -44 });
  assert.equal(BOSS_RIG.bones.acidShell.layer, 10);
  assert.equal(BOSS_RIG.bones.crown.layer, 20);
  assert.equal(BOSS_RIG.bones.core.layer, 30);
  assert.deepEqual(BOSS_RIG.bones.face.pivot, { x: 0, y: -49 });

  for (const rig of [WINDCAP_RIG, STONE_RIG, BOSS_RIG]) {
    assert.equal(rig.facing, -1);
  }
});

test('crystal needles and sprout leaves are independently bound and move conservatively', () => {
  const crystalNeedles = [
    'needleBottom',
    'needleLower',
    'needleMid',
    'needleMidUpper',
    'needleUpper',
    'needleTall',
    'needleRight',
  ];
  const sproutParts = ['leafLeft', 'leafRight', 'stemCollar'];
  const crystalManifest = RIG_PARTS_SPEC.rigs['survivor-crystal-pin'].parts;
  const sproutManifest = RIG_PARTS_SPEC.rigs['survivor-moss-sprout'].parts;

  for (const boneName of crystalNeedles) {
    assert.equal(CRYSTAL_RIG.bones[boneName].parent, 'needles');
    assert.equal(
      crystalManifest.find(({ id }) => id === boneName).bone,
      boneName,
    );
    const values = CRYSTAL_CLIPS.attack.tracks[boneName].rotation.flatMap((key) => key.slice(1));
    assert.ok(Math.max(...values.map(Math.abs)) <= 0.014);
  }
  for (const boneName of sproutParts) {
    assert.equal(SPROUT_RIG.bones[boneName].parent, 'sprout');
    assert.equal(
      sproutManifest.find(({ id }) => id === boneName).bone,
      boneName,
    );
  }
  const left = SPROUT_CLIPS.attack.tracks.leafLeft.rotation.map(([, value]) => value);
  const right = SPROUT_CLIPS.attack.tracks.leafRight.rotation.map(([, value]) => value);
  left.forEach((value, index) => approximately(value, -right[index]));
  assert.ok(Math.max(...left.map(Math.abs), ...right.map(Math.abs)) <= 0.025);
});

test('all character faces expose separate expression bones with one shared variant contract', () => {
  assert.deepEqual(EXPRESSION_SPEC.slots, {
    eyes: {
      bone: 'eyes',
      variants: ['normal', 'blink', 'hurt', 'attack'],
    },
    mouth: {
      bone: 'mouth',
      variants: ['normal', 'open', 'hurt'],
    },
  });
  assert.deepEqual(EXPRESSION_SPEC.states, {
    normal: { eyes: 'normal', mouth: 'normal' },
    blink: { eyes: 'blink', mouth: 'normal' },
    hurt: { eyes: 'hurt', mouth: 'hurt' },
    attack: { eyes: 'attack', mouth: 'open' },
  });
  assert.deepEqual(EXPRESSION_SPEC.clipStates, {
    attack: 'attack',
    charge: 'attack',
    hurt: 'hurt',
    downed: 'hurt',
    death: 'hurt',
  });

  for (const [label, rig, clips] of RIG_CASES) {
    assert.equal(rig.expression, EXPRESSION_SPEC);
    assert.deepEqual(rig.bones.face.children, ['eyes', 'mouth']);
    const parts = RIG_PARTS_SPEC.rigs[OWNER_ID_BY_RIG[label]].parts;
    for (const boneName of ['eyes', 'mouth']) {
      assert.equal(rig.bones[boneName].parent, 'face', `${label}.${boneName} parent`);
      assert.deepEqual(rig.bones[boneName].children, []);
      const { bindRect } = parts.find((part) => part.bone === boneName);
      approximately(
        rig.bones[boneName].pivot.x,
        bindRect.x + bindRect.width / 2,
      );
      approximately(
        rig.bones[boneName].pivot.y,
        bindRect.y + bindRect.height / 2,
      );
    }

    for (const [clipName, clip] of Object.entries(clips)) {
      assert.equal(clip.tracks.eyes.rotation, 0, `${label}.${clipName}.eyes.rotation`);
      assert.ok(clip.tracks.mouth.rotation !== undefined, `${label}.${clipName}.mouth.rotation`);
    }
  }

  assertDeepFrozen(EXPRESSION_SPEC, 'expression spec');
});

test('animation briefs and clips share the conservative soft-body policy', () => {
  assert.deepEqual(ANIMATION_SPEC.characterMotionPolicy, {
    style: '保守软体骨骼动画',
    bodyScaleMin: 0.94,
    bodyScaleMax: 1.06,
    deathSilhouette: '保持角色主体、附属物和身份轮廓完整，不拆落、不摊平',
    visibilityOwner: '程序淡出',
    independentParts: '晶针、双叶、茎环等已拆分部件只做轻微且符合角色身份的相对运动',
  });

  const characterOwners = new Set(Object.values(OWNER_ID_BY_RIG));
  const exaggerated = /摊成|摊平|低矮胶|低矮菌帽|强烈压扁|缩入帽下|王冠滑落|岩块依次滑落/;
  for (const animation of ANIMATION_SPEC.animations) {
    if (!characterOwners.has(animation.ownerId)) continue;
    assert.doesNotMatch(animation.brief, exaggerated, animation.id);
  }
  for (const ownerId of [
    'enemy-soft-biter',
    'enemy-windcap',
    'enemy-stone-lump',
    'enemy-acid-shell-king',
  ]) {
    const death = ANIMATION_SPEC.animations.find((animation) => (
      animation.ownerId === ownerId && animation.state === 'death'
    ));
    assert.match(death.brief, /完整|保持/);
    assert.match(death.brief, /淡出/);
  }
});

test('animation asset spec publishes the same expression contract for all eight owners', () => {
  const format = ANIMATION_SPEC.expressionFormat;
  assert.deepEqual(format.owners, [
    'survivor-shell-shell',
    'survivor-crystal-pin',
    'survivor-bubble-float',
    'survivor-moss-sprout',
    'enemy-soft-biter',
    'enemy-windcap',
    'enemy-stone-lump',
    'enemy-acid-shell-king',
  ]);
  assert.equal(format.defaultState, EXPRESSION_SPEC.defaultState);
  assert.equal(format.parentBone, EXPRESSION_SPEC.faceBone);
  assert.deepEqual(format.slots, EXPRESSION_SPEC.slots);
  assert.deepEqual(format.states, EXPRESSION_SPEC.states);
  assert.deepEqual(format.clipStates, EXPRESSION_SPEC.clipStates);
});

test('face parent can animate while independent expression layers stay undeformed', () => {
  assert.deepEqual(SHELL_CLIPS.attack.tracks.face.x, [
    [0, 0],
    [0.12, -0.2],
    [0.27, 0.4],
    [0.46, 0],
  ]);

  const controller = new AnimationController(SHELL_CLIPS, {
    base: 'attack',
    transitionDuration: 0,
  });
  controller.update(0.27);
  const pose = controller.sample();
  approximately(pose.face.x, 0.4);
  assert.equal(pose.eyes.scaleX, 1);
  assert.equal(pose.eyes.scaleY, 1);
  assert.equal(pose.mouth.scaleX, 1);
  assert.equal(pose.mouth.scaleY, 1);
  assert.equal(pose.eyes.x, 0);
  assert.equal(pose.mouth.x, 0);
});

test('all eight owners leave eyes and mouth neutral for image-layer expression replacement', () => {
  for (const [label, , clips] of RIG_CASES) {
    for (const [clipName, clip] of Object.entries(clips)) {
      assert.deepEqual(clip.tracks.eyes, { rotation: 0 }, `${label}.${clipName}.eyes`);
      assert.deepEqual(clip.tracks.mouth, { rotation: 0 }, `${label}.${clipName}.mouth`);
    }
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
  assert.equal(BOSS_CLIPS.death.tracks.crown.x, undefined);
  assert.equal(BOSS_CLIPS.death.tracks.crown.y, undefined);
  assert.deepEqual(BOSS_CLIPS.death.tracks.crown.rotation.at(-1), [0.68, -0.02]);
  assert.equal(BOSS_CLIPS.charge.duration, 0.75);
  assert.equal(BOSS_CLIPS.charge.mode, 'hold');

  for (const clips of [WINDCAP_CLIPS, STONE_CLIPS, BOSS_CLIPS]) {
    const forwardValues = clips.attack.tracks.root.x.map((frame) => frame[1]);
    assert.ok(Math.max(...forwardValues) > 0, 'enemy attacks must lunge along local +x');
  }

  for (const [clips, bodyBone] of [
    [BUG_CLIPS, 'body'],
    [WINDCAP_CLIPS, 'stem'],
    [STONE_CLIPS, 'body'],
    [BOSS_CLIPS, 'body'],
  ]) {
    const finalScaleY = clips.death.tracks[bodyBone].scaleY.at(-1)[1];
    const finalRotation = clips.death.tracks.root.rotation.at(-1)[1];
    assert.ok(finalScaleY >= 0.94, `${bodyBone} death pose must not collapse into a pancake`);
    assert.ok(Math.abs(finalRotation) <= 0.12, 'death pose must not collapse diagonally');
    assert.equal(clips.death.tracks.root.alpha, undefined, 'cleanup owns death visibility');
  }
});

test('body squash and attack hit timing stay inside the conservative animation contract', () => {
  const attackHitTimes = {
    shell: 0.27,
    bug: 0.29,
    crystal: 0.22,
    bubble: 0.29,
    sprout: 0.29,
    windcap: 0.2,
    stone: 0.27,
    boss: 0.37,
  };

  for (const [label, , clips] of RIG_CASES) {
    const bodyBone = label === 'windcap' ? 'stem' : 'body';
    const terminalClip = Object.hasOwn(clips, 'death') ? 'death' : 'downed';

    for (const [clipName, clip] of Object.entries(clips)) {
      const minimum = clipName === terminalClip ? 0.94 : 0.95;
      assert.equal(
        clip.tracks.motion.scaleX,
        undefined,
        `${label}.${clipName}.motion must remain a rigid transform`,
      );
      assert.equal(
        clip.tracks.motion.scaleY,
        undefined,
        `${label}.${clipName}.motion must remain a rigid transform`,
      );
      for (const property of ['scaleX', 'scaleY']) {
        const source = clip.tracks[bodyBone][property] ?? 1;
        const values = Array.isArray(source) ? source.map((frame) => frame[1]) : [source];
        assert.ok(
          Math.min(...values) >= minimum,
          `${label}.${clipName}.${bodyBone}.${property} must stay above ${minimum}`,
        );
        assert.ok(
          Math.max(...values) <= 1.06,
          `${label}.${clipName}.${bodyBone}.${property} must stay below 1.06`,
        );
      }
      assert.equal(
        clip.tracks.root.alpha,
        undefined,
        `${label}.${clipName} must not double-dim renderer-managed opacity`,
      );
    }

    const hit = clips.attack.events.filter(({ name }) => name === 'hit');
    assert.deepEqual(hit, [{ time: attackHitTimes[label], name: 'hit' }]);
  }
});

test('boss charge can run as a hold base and freezes at the charged pose', () => {
  const controller = new AnimationController(BOSS_CLIPS, {
    base: 'charge',
    transitionDuration: 0,
  });

  controller.update(4);
  const charged = controller.sample();
  approximately(charged.core.scaleX, 1.14);
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
