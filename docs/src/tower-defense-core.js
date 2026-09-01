/**
 * Deterministic rules for the hero-led slime squad tower-defense mode.
 *
 * The canvas shell owns input, animation frames and persistence. This module
 * keeps the run state serialisable and exposes small commands so browser,
 * WeChat and tests all execute the same rules.
 */

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
const scaleValue = (value) => Math.round(value * 1000) / 1000;

/** Portrait gameplay coordinates shared by web and WeChat renderers. */
export const TD_VIEW = Object.freeze({ width: 720, height: 1280 });
export const TD_FIELD = Object.freeze({ x: 0, y: 96, width: 720, height: 992 });
export const TD_CARD_DOCK = Object.freeze({ x: 0, y: 1096, width: 720, height: 184 });
export const TD_HERO_BOUNDS = Object.freeze({
  minX: 54,
  maxX: 666,
  minY: 158,
  maxY: 830,
});
export const TD_MAX_STAR = 4;
export const TD_HAND_LIMIT = 4;
export const TD_LANE_COUNT = 5;
export const TD_ROW_COUNT = 7;
// Kept as an alias because older renderers call a deployment row a column.
export const TD_COLUMN_COUNT = TD_ROW_COUNT;
export const TD_STORAGE_KEY = 'slime-fusion-defense-v1';
export const TD_STAGE_SCALE_CAPS = Object.freeze({ hp: 3.4, speed: 1.4, reward: 2.2 });
export const TD_ENDLESS_SCALE_CAPS = Object.freeze({
  count: 8,
  hp: 7.5,
  speed: 1.55,
  reward: 3,
  bossCount: 2,
});

export const TOWER_TYPES = Object.freeze({
  shell: Object.freeze({
    id: 'shell',
    ownerId: 'survivor-shell-shell',
    name: '壳壳',
    glyph: '盾',
    color: '#62D5A0',
    range: 142,
    interval: 0.78,
    damage: 17,
    maxHp: 260,
    projectile: 'goo',
    projectileSpeed: 480,
    effect: 'splash',
  }),
  needle: Object.freeze({
    id: 'needle',
    ownerId: 'survivor-crystal-pin',
    name: '亮钉',
    glyph: '晶',
    color: '#75CFF4',
    range: 238,
    interval: 1.02,
    damage: 29,
    maxHp: 130,
    projectile: 'needle',
    projectileSpeed: 670,
    effect: 'pierce',
  }),
  bubble: Object.freeze({
    id: 'bubble',
    ownerId: 'survivor-bubble-float',
    name: '浮浮',
    glyph: '泡',
    color: '#75DFF0',
    range: 184,
    interval: 0.58,
    damage: 10,
    maxHp: 155,
    projectile: 'bubble',
    projectileSpeed: 430,
    effect: 'slow',
  }),
  sprout: Object.freeze({
    id: 'sprout',
    ownerId: 'survivor-moss-sprout',
    name: '芽芽',
    glyph: '芽',
    color: '#8EDB70',
    range: 176,
    interval: 0.72,
    damage: 9,
    maxHp: 145,
    projectile: 'seed',
    projectileSpeed: 510,
    effect: 'poison',
  }),
  berry: Object.freeze({
    id: 'berry',
    ownerId: 'survivor-berry-burst',
    name: '莓莓',
    glyph: '莓',
    color: '#EF7188',
    range: 226,
    interval: 0.82,
    damage: 38,
    maxHp: 660,
    projectile: 'berry',
    projectileSpeed: 570,
    effect: 'splash',
  }),
  dew: Object.freeze({
    id: 'dew',
    ownerId: 'survivor-dew-bloom',
    name: '露露',
    glyph: '露',
    color: '#72D9C7',
    range: 208,
    interval: 0.64,
    damage: 24,
    maxHp: 750,
    projectile: 'dew',
    projectileSpeed: 520,
    effect: 'slow',
  }),
});

const freezeAttackSteps = (steps) => Object.freeze(steps.map((step) => Object.freeze(step)));

/**
 * Star upgrades change how attacks are delivered, not only their damage.
 * These fields are copied onto projectiles so renderers can opt into richer
 * star-specific visuals without changing the deterministic combat rules.
 */
export const TOWER_ATTACK_EVOLUTIONS = Object.freeze({
  shell: freezeAttackSteps([
    {
      attackMode: 'goo-splash', projectileCount: 1, secondaryDamageScale: 0,
      splashRadius: 49, splashDamageScale: 0.52, knockback: 0,
    },
    {
      attackMode: 'goo-shockwave', projectileCount: 1, secondaryDamageScale: 0,
      splashRadius: 62, splashDamageScale: 0.5, knockback: 2,
    },
    {
      attackMode: 'goo-split', projectileCount: 2, secondaryDamageScale: 0.18,
      splashRadius: 70, splashDamageScale: 0.46, knockback: 2.5,
    },
    {
      attackMode: 'goo-cluster', projectileCount: 3, secondaryDamageScale: 0.14,
      splashRadius: 80, splashDamageScale: 0.42, knockback: 3,
    },
  ]),
  needle: freezeAttackSteps([
    {
      attackMode: 'needle-pierce', projectileCount: 1, secondaryDamageScale: 0,
      pierceTargets: 1, pierceDamageScale: 0.68,
    },
    {
      attackMode: 'needle-double', projectileCount: 1, secondaryDamageScale: 0,
      pierceTargets: 2, pierceDamageScale: 0.68,
    },
    {
      attackMode: 'needle-fork', projectileCount: 2, secondaryDamageScale: 0.16,
      pierceTargets: 2, pierceDamageScale: 0.64,
    },
    {
      attackMode: 'needle-fan', projectileCount: 3, secondaryDamageScale: 0.12,
      pierceTargets: 3, pierceDamageScale: 0.6,
    },
  ]),
  bubble: freezeAttackSteps([
    {
      attackMode: 'bubble-slow', projectileCount: 1, secondaryDamageScale: 0,
      chainTargets: 0, chainRadius: 0, chainPower: 0,
    },
    {
      attackMode: 'bubble-chain', projectileCount: 1, secondaryDamageScale: 0,
      chainTargets: 1, chainRadius: 100, chainPower: 0.55,
    },
    {
      attackMode: 'bubble-cascade', projectileCount: 1, secondaryDamageScale: 0,
      chainTargets: 2, chainRadius: 120, chainPower: 0.5,
    },
    {
      attackMode: 'bubble-tide', projectileCount: 1, secondaryDamageScale: 0,
      chainTargets: 3, chainRadius: 145, chainPower: 0.45,
    },
  ]),
  sprout: freezeAttackSteps([
    {
      attackMode: 'seed-poison', projectileCount: 1, secondaryDamageScale: 0,
      spreadTargets: 0, spreadRadius: 0, spreadPoisonScale: 0,
    },
    {
      attackMode: 'seed-branch', projectileCount: 1, secondaryDamageScale: 0,
      spreadTargets: 1, spreadRadius: 96, spreadPoisonScale: 0.3,
    },
    {
      attackMode: 'seed-canopy', projectileCount: 1, secondaryDamageScale: 0,
      spreadTargets: 2, spreadRadius: 118, spreadPoisonScale: 0.28,
    },
    {
      attackMode: 'seed-bloom', projectileCount: 1, secondaryDamageScale: 0,
      spreadTargets: 3, spreadRadius: 144, spreadPoisonScale: 0.25,
    },
  ]),
  berry: freezeAttackSteps([
    {
      attackMode: 'berry-pop', projectileCount: 1, secondaryDamageScale: 0,
      splashRadius: 52, splashDamageScale: 0.48, knockback: 0,
    },
    {
      attackMode: 'berry-double-pop', projectileCount: 2, secondaryDamageScale: 0.16,
      splashRadius: 60, splashDamageScale: 0.46, knockback: 1,
    },
    {
      attackMode: 'berry-burst', projectileCount: 2, secondaryDamageScale: 0.2,
      splashRadius: 72, splashDamageScale: 0.44, knockback: 2,
    },
    {
      attackMode: 'berry-festival', projectileCount: 3, secondaryDamageScale: 0.16,
      splashRadius: 84, splashDamageScale: 0.42, knockback: 3,
    },
  ]),
  dew: freezeAttackSteps([
    {
      attackMode: 'dew-slow', projectileCount: 1, secondaryDamageScale: 0,
      chainTargets: 0, chainRadius: 0, chainPower: 0,
    },
    {
      attackMode: 'dew-link', projectileCount: 1, secondaryDamageScale: 0,
      chainTargets: 1, chainRadius: 92, chainPower: 0.5,
    },
    {
      attackMode: 'dew-garland', projectileCount: 1, secondaryDamageScale: 0,
      chainTargets: 2, chainRadius: 112, chainPower: 0.48,
    },
    {
      attackMode: 'dew-rain', projectileCount: 1, secondaryDamageScale: 0,
      chainTargets: 3, chainRadius: 136, chainPower: 0.45,
    },
  ]),
});

export function towerAttackEvolution(towerType, star = 1) {
  const steps = TOWER_ATTACK_EVOLUTIONS[towerType] || TOWER_ATTACK_EVOLUTIONS.shell;
  const index = clamp(Math.floor(Number(star) || 1), 1, TD_MAX_STAR) - 1;
  return steps[index];
}

export const TOWER_DRAW_WEIGHTS = Object.freeze([
  Object.freeze({ type: 'shell', weight: 22 }),
  Object.freeze({ type: 'needle', weight: 20 }),
  Object.freeze({ type: 'bubble', weight: 16 }),
  Object.freeze({ type: 'sprout', weight: 14 }),
  Object.freeze({ type: 'berry', weight: 15 }),
  Object.freeze({ type: 'dew', weight: 13 }),
]);

export const TD_CONTRACT_TYPES = Object.freeze(Object.keys(TOWER_TYPES));
export const TD_CONTRACT_MAX_RANK = 10;
export const TD_CONTRACT_SHARDS_PER_RANK = 6;
export const TD_CONTRACT_START_CURRENCY = 900;
export const TD_CONTRACT_SUMMON_COSTS = Object.freeze({ 1: 100, 10: 900 });
export const TD_CONTRACT_RARITIES = Object.freeze({
  R: Object.freeze({ id: 'R', weight: 60, shards: 1 }),
  SR: Object.freeze({ id: 'SR', weight: 27, shards: 2 }),
  SSR: Object.freeze({ id: 'SSR', weight: 10, shards: 4 }),
  UR: Object.freeze({ id: 'UR', weight: 3, shards: 8 }),
});

const freezeHeroSkill = ({ steps, ...skill }) => Object.freeze({
  ...skill,
  // `stage` is intentionally one-based for presentation. `stepIndex` remains
  // the zero-based simulation lookup key carried by queued work.
  steps: Object.freeze(steps.map((step, index) => Object.freeze({
    ...step,
    stage: index + 1,
  }))),
});

export const HERO_TYPES = Object.freeze({
  shell: Object.freeze({
    id: 'shell', ownerId: TOWER_TYPES.shell.ownerId, name: '壳壳', rarity: 'R', glyph: '盾',
    visualType: 'shell', role: '护卫·击退',
    rankGrowth: Object.freeze({
      maxHp: 0.022, summary: '每阶生命 +2.2%',
    }),
    color: TOWER_TYPES.shell.color, maxHp: 900, speed: 165, range: 220,
    interval: 0.72, damage: 28, projectile: 'goo', projectileSpeed: 560,
    effect: 'splash', skillCooldown: 11, skillRadius: 220, skillDamage: 78,
    skill: freezeHeroSkill({
      id: 'shell-triple-quake', name: '壳震三连', cooldown: 11, radius: 220,
      targeting: 'self',
      description: '三道扩张壳震逐步增伤并击退，末段获得胶壳护盾。',
      steps: [
        {
          at: 0, action: 'radial', kind: 'shell-quake',
          radius: 115, damage: 48, knockback: 20,
        },
        {
          at: 0.28, action: 'radial', kind: 'shell-quake',
          radius: 165, damage: 60, knockback: 30,
        },
        {
          at: 0.58, action: 'radial', kind: 'shell-quake',
          radius: 220, damage: 78, knockback: 45,
          shieldHp: 180, shieldDuration: 5,
        },
      ],
    }),
  }),
  needle: Object.freeze({
    id: 'needle', ownerId: TOWER_TYPES.needle.ownerId, name: '亮钉', rarity: 'SR', glyph: '晶',
    visualType: 'needle', role: '远程·群体穿透',
    rankGrowth: Object.freeze({
      attackDamage: 0.022, skillDamage: 0.022,
      summary: '每阶普攻与技能伤害 +2.2%',
    }),
    color: TOWER_TYPES.needle.color, maxHp: 650, speed: 180, range: 315,
    interval: 0.88, damage: 48, projectile: 'needle', projectileSpeed: 760,
    effect: 'pierce', skillCooldown: 11.5, skillRadius: 430, skillDamage: 84,
    skill: freezeHeroSkill({
      id: 'crystal-beam-channel', name: '晶束贯流', cooldown: 11.5, radius: 430,
      targeting: 'direction',
      description: '锁定方向持续发射三段贯穿晶束，光束逐段变宽变强。',
      steps: [
        {
          at: 0, action: 'beam', kind: 'crystal-beam', duration: 0.76,
          length: 430, width: 24, tickInterval: 0.15, tickDamage: 9, maxTargets: 6,
        },
        {
          at: 0.72, action: 'beam', kind: 'crystal-beam-surge', duration: 0.76,
          length: 430, width: 30, tickInterval: 0.15, tickDamage: 10.8, maxTargets: 6,
        },
        {
          at: 1.44, action: 'beam', kind: 'crystal-beam-finale', duration: 0.76,
          length: 430, width: 38, tickInterval: 0.15, tickDamage: 12.6, maxTargets: 6,
        },
      ],
    }),
  }),
  bubble: Object.freeze({
    id: 'bubble', ownerId: TOWER_TYPES.bubble.ownerId, name: '泡泡', rarity: 'SSR', glyph: '泡',
    visualType: 'bubble', role: '控场·回卷连锁',
    rankGrowth: Object.freeze({
      attackSpeed: 0.02, skillDamage: 0.018,
      summary: '每阶普攻速度 +2.0%，技能伤害 +1.8%',
    }),
    color: TOWER_TYPES.bubble.color, maxHp: 710, speed: 192, range: 245,
    interval: 0.48, damage: 18, projectile: 'bubble', projectileSpeed: 500,
    effect: 'slow', skillCooldown: 12, skillRadius: 340, skillDamage: 60,
    skill: freezeHeroSkill({
      id: 'bubble-tidal-field', name: '潮汐泡域', cooldown: 12, radius: 340,
      targeting: 'cluster', clusterRadius: 165,
      description: '在敌群中张开持续伤害泡域，中段回卷，末段群体爆裂。',
      steps: [
        {
          at: 0, action: 'field', kind: 'bubble-field', radius: 165,
          duration: 3, tickInterval: 0.25, tickDamage: 10, maxTargets: 8,
          slowMultiplier: 0.55, slowTime: 0.65, rewind: 2,
        },
        {
          at: 1, action: 'radial', origin: 'target', kind: 'bubble-rewind',
          radius: 165, damage: 0, rewind: 18, maxTargets: 8,
          slowMultiplier: 0.55, slowTime: 1.2,
        },
        {
          at: 2.8, action: 'radial', origin: 'target', kind: 'bubble-burst',
          radius: 185, damage: 60, maxTargets: 8,
          slowMultiplier: 0.55, slowTime: 2.2,
        },
      ],
    }),
  }),
  sprout: Object.freeze({
    id: 'sprout', ownerId: TOWER_TYPES.sprout.ownerId, name: '芽芽', rarity: 'UR', glyph: '芽',
    visualType: 'sprout', role: '毒爆·荆芽定身',
    rankGrowth: Object.freeze({
      skillPoison: 0.025, summary: '每阶技能毒伤 +2.5%',
    }),
    color: TOWER_TYPES.sprout.color, maxHp: 680, speed: 176, range: 255,
    interval: 0.64, damage: 22, projectile: 'seed', projectileSpeed: 590,
    effect: 'poison', skillCooldown: 12, skillRadius: 340, skillDamage: 46,
    skill: freezeHeroSkill({
      id: 'sprout-thorn-bloom', name: '荆芽绽放', cooldown: 12, radius: 340,
      targeting: 'cluster', clusterRadius: 105,
      description: '锁定敌群连续引爆三轮荆芽，造成范围毒伤，末轮定身。',
      steps: [
        {
          at: 0, action: 'radial', origin: 'target', kind: 'sprout-burst',
          radius: 105, damage: 46, poisonDps: 12, poisonTime: 4, maxTargets: 8,
        },
        {
          at: 0.4, action: 'radial', origin: 'target', kind: 'sprout-burst',
          radius: 105, damage: 46, poisonDps: 12, poisonTime: 4, maxTargets: 8,
        },
        {
          at: 0.8, action: 'radial', origin: 'target', kind: 'sprout-root-burst',
          radius: 115, damage: 46, poisonDps: 12, poisonTime: 4,
          rootTime: 1.2, maxTargets: 8,
        },
      ],
    }),
  }),
  berry: Object.freeze({
    id: 'berry', ownerId: TOWER_TYPES.berry.ownerId, name: '莓莓', rarity: 'SR', glyph: '莓',
    visualType: 'berry', role: '爆破·多段群伤',
    rankGrowth: Object.freeze({
      attackDamage: 0.018, skillDamage: 0.018,
      summary: '每阶普攻与技能伤害 +1.8%',
    }),
    color: TOWER_TYPES.berry.color, maxHp: 660, speed: 184, range: 285,
    interval: 0.82, damage: 38, projectile: 'berry', projectileSpeed: 570,
    effect: 'splash', skillCooldown: 11.5, skillRadius: 380, skillDamage: 58,
    skill: freezeHeroSkill({
      id: 'berry-bomb-volley', name: '莓果轰炸', cooldown: 11.5, radius: 380,
      targeting: 'cluster', clusterRadius: 115,
      description: '三轮发射共五枚真实飞行的莓果爆弹，落点造成范围伤害。',
      steps: [
        {
          at: 0, action: 'projectile-volley', kind: 'berry-bomb-volley',
          projectileCount: 2, projectileSpeed: 460, explosionRadius: 72,
          damage: 42, maxTargets: 6,
        },
        {
          at: 0.28, action: 'projectile-volley', kind: 'berry-bomb-volley',
          projectileCount: 2, projectileSpeed: 480, explosionRadius: 80,
          damage: 42, maxTargets: 6,
        },
        {
          at: 0.56, action: 'projectile-volley', kind: 'berry-bomb-finale',
          projectileCount: 1, projectileSpeed: 500, explosionRadius: 100,
          damage: 58, maxTargets: 8, knockback: 18,
        },
      ],
    }),
  }),
  dew: Object.freeze({
    id: 'dew', ownerId: TOWER_TYPES.dew.ownerId, name: '露露', rarity: 'SSR', glyph: '露',
    visualType: 'dew', role: '潮浪·横扫减速',
    rankGrowth: Object.freeze({
      maxHp: 0.014, skillDamage: 0.022,
      summary: '每阶生命 +1.4%，技能伤害 +2.2%',
    }),
    color: TOWER_TYPES.dew.color, maxHp: 750, speed: 188, range: 245,
    interval: 0.64, damage: 24, projectile: 'dew', projectileSpeed: 520,
    effect: 'slow', skillCooldown: 11, skillRadius: 520, skillDamage: 68,
    skill: freezeHeroSkill({
      id: 'dew-tidal-triad', name: '露潮三叠', cooldown: 11, radius: 520,
      targeting: 'direction',
      description: '向锁定方向推出三道逐步变宽的移动潮浪，造成范围伤害并减速。',
      steps: [
        {
          at: 0, action: 'wave', kind: 'dew-wave', damage: 48,
          length: 520, width: 110, speed: 500, angleOffset: -0.08,
          slowMultiplier: 0.65, slowTime: 1.6, maxTargets: 8,
        },
        {
          at: 0.32, action: 'wave', kind: 'dew-wave', damage: 56,
          length: 520, width: 140, speed: 510, angleOffset: 0,
          slowMultiplier: 0.62, slowTime: 1.8, maxTargets: 8,
        },
        {
          at: 0.64, action: 'wave', kind: 'dew-wave-finale', damage: 68,
          length: 540, width: 170, speed: 520, angleOffset: 0.08,
          slowMultiplier: 0.58, slowTime: 2.2, maxTargets: 8,
        },
      ],
    }),
  }),
});

function scaledSkillStep(step, multipliers) {
  return Object.freeze({
    ...step,
    damage: scaleValue((Number(step.damage) || 0) * multipliers.skillDamage),
    tickDamage: scaleValue((Number(step.tickDamage) || 0) * multipliers.skillDamage),
    poisonDps: scaleValue((Number(step.poisonDps) || 0) * multipliers.skillPoison),
    shieldHp: scaleValue((Number(step.shieldHp) || 0) * multipliers.skillShield),
  });
}

function estimatedSkillStepDamage(step) {
  const directDamage = Math.max(0, Number(step.damage) || 0);
  if (step.action === 'projectile-volley') {
    return directDamage * Math.max(1, Math.floor(Number(step.projectileCount) || 1));
  }
  if (step.action === 'beam' || step.action === 'field') {
    const interval = Math.max(0.01, Number(step.tickInterval) || 0.1);
    const ticks = Math.max(0, Math.floor((Number(step.duration) || 0) / interval + 1e-6));
    return Math.max(0, Number(step.tickDamage) || 0) * ticks;
  }
  return directDamage;
}

function skillEffectSummary(skill, steps) {
  const parts = [`${steps.length}段`];
  const damage = steps.map((step) => Math.round(estimatedSkillStepDamage(step))).filter(Boolean);
  if (damage.length) parts.push(`伤害 ${damage.join('/')}`);
  const shield = Math.round(Math.max(0, ...steps.map((step) => step.shieldHp || 0)));
  if (shield) parts.push(`护盾 ${shield}`);
  const poison = scaleValue(Math.max(0, ...steps.map((step) => step.poisonDps || 0)));
  if (poison) parts.push(`毒伤 ${poison}/秒`);
  const slowMultiplier = Math.min(1, ...steps
    .map((step) => Number(step.slowMultiplier))
    .filter((value) => value > 0));
  if (slowMultiplier < 1) parts.push(`减速 ${Math.round((1 - slowMultiplier) * 100)}%`);
  const rewind = Math.round(Math.max(0, ...steps.map((step) => step.rewind || 0)));
  if (rewind) parts.push(`回卷 ${rewind}`);
  const knockback = Math.round(Math.max(0, ...steps.map((step) => step.knockback || 0)));
  if (knockback) parts.push(`击退 ${knockback}`);
  const rootTime = scaleValue(Math.max(0, ...steps.map((step) => step.rootTime || 0)));
  if (rootTime) parts.push(`定身 ${rootTime}秒`);
  return `${skill.name}：${parts.join(' · ')}`;
}

const HERO_STATS_BY_TYPE_AND_RANK = new Map();

/** One shared rank calculation for simulation, persistence-facing roster data, and UI. */
export function heroStatsForRank(type, rank = 1) {
  const definition = HERO_TYPES[type] || HERO_TYPES.shell;
  const resolvedRank = clamp(Math.floor(Number(rank) || 1), 1, TD_CONTRACT_MAX_RANK);
  const cacheKey = `${definition.id}:${resolvedRank}`;
  const cached = HERO_STATS_BY_TYPE_AND_RANK.get(cacheKey);
  if (cached) return cached;
  const growth = definition.rankGrowth || {};
  const multiplier = (key) => 1 + resolvedRank * Math.max(0, Number(growth[key]) || 0);
  const multipliers = Object.freeze({
    maxHp: multiplier('maxHp'),
    attackDamage: multiplier('attackDamage'),
    attackSpeed: multiplier('attackSpeed'),
    skillDamage: multiplier('skillDamage'),
    skillPoison: multiplier('skillPoison'),
    skillShield: multiplier('skillShield'),
  });
  const skillSteps = Object.freeze(definition.skill.steps.map((step) => (
    scaledSkillStep(step, multipliers)
  )));
  const interval = scaleValue(definition.interval / multipliers.attackSpeed);
  const stats = Object.freeze({
    type: definition.id,
    rank: resolvedRank,
    maxHp: Math.round(definition.maxHp * multipliers.maxHp),
    damage: scaleValue(definition.damage * multipliers.attackDamage),
    interval,
    attackSpeed: scaleValue(1 / interval),
    skillSteps,
    skillEffect: skillEffectSummary(definition.skill, skillSteps),
    growthSummary: growth.summary || '升阶强化基础能力',
    multipliers,
  });
  HERO_STATS_BY_TYPE_AND_RANK.set(cacheKey, stats);
  return stats;
}

export const SQUAD_TYPES = Object.freeze({
  melee: Object.freeze({
    id: 'melee', name: '盾墩小队', glyph: '盾', cost: 100,
    squadSize: 4, memberHp: 72, range: 70, interval: 0.62,
    damagePerMember: 11, speed: 88, color: '#62D5A0',
    movementMode: 'contact', attackMode: 'melee-contact', effect: 'direct',
  }),
  ranged: Object.freeze({
    id: 'ranged', name: '豆弩小队', glyph: '弩', cost: 150,
    squadSize: 4, memberHp: 48, range: 265, interval: 0.92,
    damagePerMember: 10, speed: 68, color: '#75CFF4',
    movementMode: 'keep-range', attackMode: 'ranged-volley', effect: 'direct',
    projectile: 'needle', projectileSpeed: 590,
  }),
  charger: Object.freeze({
    id: 'charger', name: '跳槌小队', glyph: '槌', cost: 125,
    squadSize: 4, memberHp: 60, range: 72, interval: 0.52,
    damagePerMember: 9, speed: 116, color: '#EF7188',
    movementMode: 'contact', attackMode: 'bounce-hammer', effect: 'direct',
  }),
  leaf: Object.freeze({
    id: 'leaf', name: '叶旋小队', glyph: '叶', cost: 165,
    squadSize: 4, memberHp: 46, range: 240, interval: 1,
    damagePerMember: 11, speed: 72, color: '#8EDB70',
    movementMode: 'keep-range', attackMode: 'leaf-spinner', effect: 'poison',
    projectile: 'seed', projectileSpeed: 540, poisonDps: 4.5, poisonTime: 2.85,
  }),
});

const SQUAD_MEMBER_OFFSETS = Object.freeze([
  Object.freeze({ x: -24, y: -14 }),
  Object.freeze({ x: 24, y: -14 }),
  Object.freeze({ x: -26, y: 14 }),
  Object.freeze({ x: 26, y: 14 }),
]);

export const TURRET_TYPES = Object.freeze({
  'gel-mortar': Object.freeze({
    id: 'gel-mortar', name: '凝胶迫击炮', glyph: '炮', cost: 175, color: '#72D7A3',
    range: 330, interval: 1.42, damage: 72, splashRadius: 152,
    projectile: 'goo', projectileSpeed: 500, effect: 'splash', splashDamageScale: 0.66,
  }),
  'bubble-coil': Object.freeze({
    id: 'bubble-coil', name: '泡泡缓速塔', glyph: '泡', cost: 160, color: '#75DFF0',
    range: 300, interval: 0.78, damage: 18,
    projectile: 'bubble', projectileSpeed: 450, effect: 'slow',
    slowMultiplier: 0.52, slowTime: 2.4, rewind: 8,
    chainTargets: 2, chainRadius: 115, chainPower: 0.62,
  }),
  'crystal-repeater': Object.freeze({
    id: 'crystal-repeater', name: '晶针连弩塔', glyph: '晶', cost: 210, color: '#8878DB',
    range: 365, interval: 0.56, damage: 22,
    projectile: 'needle', projectileSpeed: 760, effect: 'pierce',
    pierceTargets: 2, pierceRadius: 118, pierceDamageScale: 0.68,
  }),
});

export const TD_ENEMIES = Object.freeze({
  bug: Object.freeze({
    id: 'bug', ownerId: 'enemy-soft-biter', hp: 97, speed: 38, reward: 7,
    size: 58, coreDamage: 2, attackDamage: 19, attackInterval: 1.2, color: '#A77770',
  }),
  windcap: Object.freeze({
    id: 'windcap', ownerId: 'enemy-windcap', hp: 84, speed: 56, reward: 9,
    size: 55, coreDamage: 4, attackDamage: 18, attackInterval: 0.85, color: '#C18BCC',
  }),
  stone: Object.freeze({
    id: 'stone', ownerId: 'enemy-stone-lump', hp: 317, speed: 27.5, reward: 18,
    size: 68, coreDamage: 4, attackDamage: 40, attackInterval: 1.55, color: '#85848D',
  }),
  boss: Object.freeze({
    id: 'boss', ownerId: 'enemy-acid-shell-king', hp: 1850, speed: 21, reward: 100,
    size: 104, coreDamage: 10, attackDamage: 32, attackInterval: 1.45,
    color: '#778D54', boss: true,
  }),
});

const freezePoints = (points) => Object.freeze(points.map((point) => Object.freeze(point)));
const TD_LANE_X = Object.freeze([88, 224, 360, 496, 632]);
const TD_ROW_Y = Object.freeze([270, 360, 450, 540, 630, 720, 810]);
const TD_ENTRY_X = TD_VIEW.width / 2;
// The authored portal ends at y=222. Enemies emerge at its lower lip, share a
// short trunk, then finish fanning out around the first deployment row.
const TD_PATH_START_Y = 222;
const TD_PATH_TRUNK_Y = 226;
const TD_PATH_SPLIT_END_Y = 286;
const TD_PATH_END_Y = 1002;
const TD_LANE_INDICES = Object.freeze(Array.from({ length: TD_LANE_COUNT }, (_, index) => index));

const lanePath = (x) => {
  const spread = x - TD_ENTRY_X;
  const splitPoints = [234, 243, 252, 266, TD_PATH_SPLIT_END_Y].map((y) => {
    const progress = (y - TD_PATH_TRUNK_Y) / (TD_PATH_SPLIT_END_Y - TD_PATH_TRUNK_Y);
    const eased = progress * progress * (3 - 2 * progress);
    return { x: TD_ENTRY_X + spread * eased, y };
  });
  return freezePoints([
    { x: TD_ENTRY_X, y: TD_PATH_START_Y },
    { x: TD_ENTRY_X, y: TD_PATH_TRUNK_Y },
    ...splitPoints,
    { x, y: TD_PATH_END_Y },
  ]);
};

const freezeLanes = () => Object.freeze(TD_LANE_X.map((x, index) => Object.freeze({
  id: `lane-${index}`,
  index,
  x,
  path: lanePath(x),
})));

const freezeLanePads = (lanes) => Object.freeze(lanes.flatMap((lane) => (
  TD_ROW_Y.map((y, rowIndex) => {
    const index = lane.index * TD_ROW_COUNT + rowIndex;
    return Object.freeze({
      id: `pad-${index}`,
      x: lane.x,
      y,
      laneIndex: lane.index,
      rowIndex,
      columnIndex: rowIndex,
    });
  })
)));

const group = (type, count, interval, delay = 0, laneIndices = TD_LANE_INDICES) => Object.freeze({
  type,
  count,
  interval,
  delay,
  laneIndices: Object.freeze([...laneIndices]),
});
const wave = (...groups) => Object.freeze(groups);

const laneStage = ({ id, index, name, accent, waves }) => {
  const lanes = freezeLanes();
  return Object.freeze({
    id,
    index,
    name,
    accent,
    lanes,
    // Kept as the middle route for callers that need generic path geometry.
    // Combat itself always resolves the enemy's authored vertical lane.
    path: lanes[Math.floor(TD_LANE_COUNT / 2)].path,
    pads: freezeLanePads(lanes),
    base: Object.freeze({
      x: TD_VIEW.width / 2,
      y: 1038,
      goalX: lanes[2].x,
      goalY: lanes[2].path.at(-1).y,
    }),
    tutorialPadIndex: 0,
    waves: Object.freeze(waves),
  });
};

export const TD_STAGES = Object.freeze([
  laneStage({
    id: 'stage-1',
    index: 1,
    name: '软胶坡',
    accent: '#62D5A0',
    waves: [
      // The tutorial creates one fused defender on pad 0, so the opening
      // group deliberately teaches a single lane before pressure spreads.
      wave(group('bug', 5, 0.9, 0, [0])),
      wave(group('bug', 5, 0.72, 0, [0, 1]), group('windcap', 2, 0.92, 2, [1, 0])),
      wave(group('bug', 4, 0.68, 0, [0, 2, 4]), group('stone', 3, 1.32, 2.4, [4, 2, 0])),
      wave(group('windcap', 3, 0.66, 0, [0, 2, 4]), group('stone', 4, 1.2, 2, [1, 3])),
      wave(
        group('bug', 2, 0.65, 0, [1, 3]),
        group('stone', 4, 1.15, 1.8, [0, 1, 3, 4]),
        group('boss', 1, 0, 5.6, [2]),
      ),
    ],
  }),
  laneStage({
    id: 'stage-2',
    index: 2,
    name: '泡泡湾',
    accent: '#67CFE8',
    waves: [
      wave(group('windcap', 8, 0.72, 0, [0, 1, 2, 3, 4])),
      wave(group('bug', 4, 0.68, 0, [0, 2, 4]), group('windcap', 4, 0.78, 1.6, [1, 3])),
      wave(group('windcap', 4, 0.68, 0, [0, 1, 3, 4]), group('stone', 4, 1.18, 1.9, [2, 4, 0, 3])),
      wave(group('bug', 3, 0.62, 0, [0, 2, 4]), group('stone', 5, 1.12, 1.7, [1, 3, 2, 0, 4])),
      wave(group('windcap', 2, 0.62, 0, [1, 3]), group('stone', 5, 1.08, 1.7), group('boss', 1, 0, 5.4, [2])),
      wave(group('bug', 2, 0.58, 0, [0, 4]), group('stone', 5, 1.04, 1.6), group('boss', 1, 0, 5, [2])),
    ],
  }),
  laneStage({
    id: 'stage-3',
    index: 3,
    name: '晶刺环',
    accent: '#8C80E8',
    waves: [
      wave(group('bug', 5, 0.64, 0), group('windcap', 4, 0.74, 1.4, [4, 2, 0, 3, 1])),
      wave(group('windcap', 5, 0.64, 0), group('stone', 4, 1.1, 1.7, [1, 3, 0, 4])),
      wave(group('bug', 4, 0.58, 0, [0, 2, 4]), group('stone', 5, 1.06, 1.6)),
      wave(group('windcap', 4, 0.58, 0, [4, 2, 0, 3]), group('stone', 5, 1.02, 1.5)),
      wave(group('bug', 3, 0.54, 0, [0, 2, 4]), group('stone', 5, 0.98, 1.4), group('boss', 1, 0, 5, [2])),
      wave(group('windcap', 3, 0.54, 0, [1, 3, 2]), group('stone', 5, 0.96, 1.4), group('boss', 1, 0, 4.6, [2])),
      wave(group('bug', 2, 0.52, 0, [0, 4]), group('stone', 6, 0.92, 1.3), group('boss', 1, 0, 4.4, [2])),
    ],
  }),
  laneStage({
    id: 'stage-4',
    index: 4,
    name: '露蜜林',
    accent: '#62CFA0',
    waves: [
      wave(group('bug', 4, 0.58, 0, [0, 4]), group('windcap', 4, 0.7, 1.2, [4, 0, 3, 1])),
      wave(group('windcap', 5, 0.6, 0, [0, 4, 1, 3]), group('stone', 3, 1.04, 1.5, [4, 0, 2])),
      wave(group('bug', 3, 0.54, 0, [0, 4]), group('windcap', 3, 0.62, 0.9, [1, 3]), group('stone', 2, 1, 1.8, [4, 0])),
      wave(group('windcap', 4, 0.56, 0, [4, 0, 3, 1]), group('stone', 4, 0.98, 1.4, [0, 4, 1, 3])),
      wave(group('bug', 2, 0.5, 0, [0, 4]), group('windcap', 3, 0.56, 0.7, [1, 3, 2]), group('stone', 3, 0.96, 1.5, [4, 0, 2])),
      wave(group('windcap', 2, 0.52, 0, [0, 4]), group('stone', 4, 0.92, 1.2, [1, 3, 0, 4]), group('boss', 1, 0, 4.5, [2])),
      wave(group('bug', 2, 0.48, 0, [0, 4]), group('windcap', 2, 0.52, 0.6, [1, 3]), group('stone', 4, 0.88, 1.2, [4, 0, 3, 1]), group('boss', 1, 0, 4.3, [2])),
    ],
  }),
  laneStage({
    id: 'stage-5',
    index: 5,
    name: '软壳峡',
    accent: '#D59A55',
    waves: [
      wave(group('bug', 3, 0.54, 0, [0, 2, 4]), group('stone', 5, 0.96, 1.1, [1, 3, 0, 4, 2])),
      wave(group('windcap', 3, 0.54, 0, [1, 3, 2]), group('stone', 5, 0.92, 1.1, [0, 2, 4, 1, 3])),
      wave(group('bug', 2, 0.48, 0, [0, 4]), group('windcap', 2, 0.52, 0.6, [1, 3]), group('stone', 5, 0.9, 1.1, [2, 0, 4, 1, 3])),
      wave(group('windcap', 3, 0.5, 0, [0, 2, 4]), group('stone', 5, 0.86, 1, [1, 3, 2, 0, 4])),
      wave(group('bug', 2, 0.46, 0, [1, 3]), group('stone', 6, 0.84, 0.9, [0, 2, 4, 1, 3])),
      wave(group('windcap', 2, 0.48, 0, [0, 4]), group('stone', 5, 0.82, 0.9, [1, 3, 2, 0, 4]), group('boss', 1, 0, 4.2, [2])),
      wave(group('bug', 1, 0, 0, [2]), group('windcap', 1, 0, 0.5, [2]), group('stone', 6, 0.8, 0.8, [0, 2, 4, 1, 3]), group('boss', 1, 0, 4, [2])),
    ],
  }),
  laneStage({
    id: 'stage-6',
    index: 6,
    name: '星胶庭',
    accent: '#8C80E8',
    waves: [
      wave(group('bug', 3, 0.5, 0, [1, 2, 3]), group('windcap', 3, 0.54, 0.7, [0, 2, 4]), group('stone', 2, 0.88, 1.2, [1, 3])),
      wave(group('windcap', 4, 0.5, 0, [2, 1, 3, 0, 4]), group('stone', 4, 0.84, 0.9, [0, 4, 1, 3])),
      wave(group('bug', 2, 0.44, 0, [2, 0]), group('stone', 6, 0.8, 0.8, [0, 2, 4, 1, 3])),
      wave(group('bug', 2, 0.42, 0, [0, 4]), group('windcap', 2, 0.46, 0.5, [1, 3]), group('stone', 5, 0.78, 0.8, [2, 0, 4, 1, 3])),
      wave(group('windcap', 3, 0.46, 0, [0, 2, 4]), group('stone', 5, 0.76, 0.8, [1, 3, 2, 0, 4])),
      wave(group('bug', 2, 0.4, 0, [0, 4]), group('stone', 5, 0.74, 0.7, [2, 1, 3, 0, 4]), group('boss', 1, 0, 3.9, [2])),
      wave(group('windcap', 2, 0.42, 0, [1, 3]), group('stone', 6, 0.72, 0.7, [0, 2, 4, 1, 3]), group('boss', 1, 0, 3.8, [2])),
      wave(group('bug', 1, 0, 0, [0]), group('windcap', 1, 0, 0.4, [4]), group('stone', 6, 0.7, 0.7, [0, 2, 4, 1, 3]), group('boss', 1, 0, 3.7, [2])),
    ],
  }),
]);

const freezeTurretSlots = (slots) => Object.freeze(slots.map((slot, index) => Object.freeze({
  id: `turret-slot-${index}`,
  index,
  ...slot,
})));

/** Fixed construction points; turrets never occupy soldier deployment pads. */
export const TD_TURRET_SLOTS = Object.freeze({
  'stage-1': freezeTurretSlots([
    { x: 102, y: 914 }, { x: 274, y: 914 }, { x: 446, y: 914 }, { x: 618, y: 914 },
  ]),
  'stage-2': freezeTurretSlots([
    { x: 88, y: 914 }, { x: 264, y: 914 }, { x: 456, y: 914 }, { x: 632, y: 914 },
  ]),
  'stage-3': freezeTurretSlots([
    { x: 110, y: 914 }, { x: 280, y: 914 }, { x: 440, y: 914 }, { x: 610, y: 914 },
  ]),
  'stage-4': freezeTurretSlots([
    { x: 96, y: 914 }, { x: 272, y: 914 }, { x: 448, y: 914 }, { x: 624, y: 914 },
  ]),
  'stage-5': freezeTurretSlots([
    { x: 112, y: 914 }, { x: 282, y: 914 }, { x: 438, y: 914 }, { x: 608, y: 914 },
  ]),
  'stage-6': freezeTurretSlots([
    { x: 92, y: 914 }, { x: 268, y: 914 }, { x: 452, y: 914 }, { x: 628, y: 914 },
  ]),
});

export const TD_STAGE_BY_ID = Object.freeze(Object.fromEntries(
  TD_STAGES.map((stage) => [stage.id, stage]),
));

function contractProgressRecord(source, maxValue) {
  const input = source && typeof source === 'object' ? source : {};
  return Object.fromEntries(TD_CONTRACT_TYPES.map((type) => [
    type,
    clamp(Math.floor(Number(input[type]) || 0), 0, maxValue),
  ]));
}

function contractRankRecord(source) {
  const input = source && typeof source === 'object' ? source : {};
  return Object.fromEntries(TD_CONTRACT_TYPES.map((type) => {
    const fallback = type === 'shell' ? 1 : 0;
    const rawValue = Number.isFinite(Number(input[type])) ? Number(input[type]) : fallback;
    return [type, clamp(Math.floor(rawValue), 0, TD_CONTRACT_MAX_RANK)];
  }));
}

const copyProgress = (source = {}) => {
  const summonCurrency = Number.isFinite(Number(source.summonCurrency))
    ? Math.max(0, Math.floor(Number(source.summonCurrency)))
    : TD_CONTRACT_START_CURRENCY;
  const contractRanks = contractRankRecord(source.contractRanks);
  const requestedHero = TD_CONTRACT_TYPES.includes(source.selectedHero)
    ? source.selectedHero
    : 'shell';
  const selectedHero = contractRanks[requestedHero] > 0
    ? requestedHero
    : TD_CONTRACT_TYPES.find((type) => contractRanks[type] > 0) || 'shell';
  if (contractRanks[selectedHero] <= 0) contractRanks.shell = 1;
  return {
    unlockedStage: clamp(Math.floor(Number(source.unlockedStage) || 1), 1, TD_STAGES.length),
    clearedStages: [...new Set(Array.isArray(source.clearedStages) ? source.clearedStages : [])]
      .filter((id) => TD_STAGE_BY_ID[id]),
    bestEndlessWave: Math.max(0, Math.floor(Number(source.bestEndlessWave) || 0)),
    tutorialSeen: Boolean(source.tutorialSeen),
    summonCurrency,
    summonPity: clamp(Math.floor(Number(source.summonPity) || 0), 0, 9),
    summonRngState: (Number(source.summonRngState) >>> 0) || 0xC0A7A5,
    contractShards: contractProgressRecord(source.contractShards, TD_CONTRACT_SHARDS_PER_RANK - 1),
    contractRanks,
    selectedHero,
  };
};

export function normalizeTowerDefenseProgress(source = {}) {
  const progress = copyProgress(source);
  return Object.freeze({
    ...progress,
    clearedStages: Object.freeze(progress.clearedStages),
    contractShards: Object.freeze(progress.contractShards),
    contractRanks: Object.freeze(progress.contractRanks),
  });
}

function seededStep(state) {
  let value = Number(state.rngState) >>> 0;
  value = (Math.imul(value || 0x6D2B79F5, 1664525) + 1013904223) >>> 0;
  state.rngState = value;
  return value / 0x100000000;
}

function summonSeededStep(progress) {
  let value = Number(progress.summonRngState) >>> 0;
  value = (Math.imul(value || 0xC0A7A5, 1664525) + 1013904223) >>> 0;
  progress.summonRngState = value;
  return value / 0x100000000;
}

function contractRankForState(state, type) {
  return clamp(
    Math.floor(Number(state?.progress?.contractRanks?.[type]) || 0),
    0,
    TD_CONTRACT_MAX_RANK,
  );
}

function nextUid(state, prefix) {
  state.uidCounter += 1;
  return `${prefix}-${state.uidCounter}`;
}

const TOWER_HP_STAR_MULTIPLIER = Object.freeze([0, 1, 1.65, 2.6, 4]);

function maxHpForTower(type, star = 1, state = null) {
  const squad = SQUAD_TYPES[type];
  if (squad) return squad.memberHp * squad.squadSize;
  const definition = TOWER_TYPES[type] || TOWER_TYPES.shell;
  const level = clamp(Math.floor(Number(star) || 1), 1, TD_MAX_STAR);
  return Math.round(definition.maxHp * TOWER_HP_STAR_MULTIPLIER[level]);
}

function ensureTowerHealth(tower, state = null) {
  if (!tower) return null;
  const expectedMaxHp = maxHpForTower(tower.type, tower.star, state);
  if (!(Number(tower.maxHp) > 0)) tower.maxHp = expectedMaxHp;
  if (!Number.isFinite(Number(tower.hp))) tower.hp = tower.maxHp;
  tower.hp = clamp(Number(tower.hp) || 0, 0, tower.maxHp);
  tower.hitPulse = clamp(Number(tower.hitPulse) || 0, 0, 1);
  return tower;
}

function heroRosterForProgress(progress) {
  return TD_CONTRACT_TYPES.map((type) => {
    const definition = HERO_TYPES[type];
    const skill = definition.skill;
    const rank = progress.contractRanks[type];
    const stats = heroStatsForRank(type, Math.max(1, rank));
    return {
      type,
      name: definition.name,
      rarity: definition.rarity,
      role: definition.role,
      skillName: skill.name,
      skillDescription: skill.description,
      skillCooldown: skill.cooldown,
      skillRadius: skill.radius,
      skillStageCount: skill.steps.length,
      skillEffect: stats.skillEffect,
      growthSummary: stats.growthSummary,
      maxHp: stats.maxHp,
      damage: stats.damage,
      interval: stats.interval,
      attackSpeed: stats.attackSpeed,
      rank,
      shards: progress.contractShards[type],
      owned: progress.contractRanks[type] > 0,
      selected: progress.selectedHero === type,
    };
  });
}

function emptyRunState(progress, seed) {
  const copiedProgress = copyProgress(progress);
  return {
    screen: 'menu',
    mode: 'stage',
    stageId: 'stage-1',
    progress: copiedProgress,
    phase: 'prep',
    tutorial: {
      active: !progress.tutorialSeen,
      step: progress.tutorialSeen ? 'done' : 'stage',
      forcedDraws: 0,
    },
    rngState: (Number(seed) >>> 0) || 0x51A7E,
    uidCounter: 0,
    time: 0,
    wave: 0,
    waveActive: false,
    waveElapsed: 0,
    waveBreak: 0,
    waveEnemyTotal: 0,
    waveEnemyResolved: 0,
    spawnQueue: [],
    hand: [],
    towers: [],
    turrets: [],
    turretSlots: TD_TURRET_SLOTS['stage-1'],
    hero: null,
    heroSkillQueue: [],
    heroSkillActors: [],
    selectedHeroId: copiedProgress.selectedHero,
    heroes: heroRosterForProgress(copiedProgress),
    enemies: [],
    projectiles: [],
    effects: [],
    currency: 500,
    drawCount: 0,
    coreHp: 32,
    coreMaxHp: 32,
    kills: 0,
    result: null,
    selectedTowerUid: null,
    summonResults: [],
    events: [],
  };
}

export function createTowerDefenseState({ progress = {}, seed = 0x51A7E } = {}) {
  const normalized = normalizeTowerDefenseProgress(progress);
  return emptyRunState(normalized, seed);
}

export function stageForState(state) {
  return TD_STAGE_BY_ID[state?.stageId] || TD_STAGES[0];
}

export function drawCostForState(state) {
  return Math.min(40, 20 + Math.floor(Math.max(0, state.drawCount) / 4) * 4);
}

function rollContractType(progress) {
  const guaranteedHighRarity = progress.summonPity >= 9;
  const availableRarities = Object.values(TD_CONTRACT_RARITIES).filter(({ id }) => (
    (!guaranteedHighRarity || ['SSR', 'UR'].includes(id))
    && TD_CONTRACT_TYPES.some((type) => HERO_TYPES[type]?.rarity === id)
  ));
  const totalWeight = availableRarities.reduce((total, rarity) => total + rarity.weight, 0);
  let roll = summonSeededStep(progress) * totalWeight;
  let selectedRarity = availableRarities.at(-1)?.id || 'R';
  for (const candidate of availableRarities) {
    roll -= candidate.weight;
    if (roll < 0) {
      selectedRarity = candidate.id;
      break;
    }
  }
  const heroPool = TD_CONTRACT_TYPES.filter((type) => (
    HERO_TYPES[type]?.rarity === selectedRarity
  ));
  const heroIndex = Math.min(
    heroPool.length - 1,
    Math.floor(summonSeededStep(progress) * heroPool.length),
  );
  const type = heroPool[Math.max(0, heroIndex)] || 'shell';
  progress.summonPity = ['SSR', 'UR'].includes(selectedRarity)
    ? 0
    : Math.min(9, progress.summonPity + 1);
  return type;
}

/**
 * Menu-only meta summon. The whole purchase is validated before any RNG or
 * currency mutation, making failed calls atomic and easy to persist safely.
 */
export function summonTowerDefenseContracts(state, count = 1) {
  const summonCount = Number(count) === 10 ? 10 : Number(count) === 1 ? 1 : 0;
  if (state?.screen !== 'menu' || !summonCount) return null;
  const cost = TD_CONTRACT_SUMMON_COSTS[summonCount];
  const progress = copyProgress(state.progress || {});
  if (progress.summonCurrency < cost) return null;

  progress.summonCurrency -= cost;
  const results = [];
  for (let index = 0; index < summonCount; index += 1) {
    const type = rollContractType(progress);
    const rarity = HERO_TYPES[type].rarity;
    const drawShards = TD_CONTRACT_RARITIES[rarity].shards;
    const rank = progress.contractRanks[type];
    const unlocked = rank <= 0;
    const shards = unlocked ? 0 : drawShards;
    let storedShards = progress.contractShards[type] + shards;
    let newRank = rank;
    if (unlocked) newRank = 1;
    while (storedShards >= TD_CONTRACT_SHARDS_PER_RANK && newRank < TD_CONTRACT_MAX_RANK) {
      storedShards -= TD_CONTRACT_SHARDS_PER_RANK;
      newRank += 1;
    }
    let convertedCurrency = 0;
    if (newRank >= TD_CONTRACT_MAX_RANK && storedShards > 0) {
      convertedCurrency = storedShards * 12;
      progress.summonCurrency += convertedCurrency;
      storedShards = 0;
    }
    progress.contractRanks[type] = newRank;
    progress.contractShards[type] = storedShards;
    results.push({
      type,
      rarity,
      shards,
      drawShards,
      rank,
      newRank,
      unlocked,
      rankUp: newRank > rank,
      rankUps: newRank - rank,
      convertedCurrency,
    });
  }
  state.progress = progress;
  state.selectedHeroId = progress.selectedHero;
  state.heroes = heroRosterForProgress(progress);
  state.summonResults = results;
  state.events.push({
    type: 'contract-summon',
    count: summonCount,
    cost,
    results: results.map(({ type, rarity, shards, newRank }) => ({
      type, rarity, shards, newRank,
    })),
  });
  return results;
}

export function selectTowerDefenseHero(state, type) {
  if (state?.screen !== 'menu' || !HERO_TYPES[type]) return false;
  const progress = copyProgress(state.progress || {});
  if (progress.contractRanks[type] <= 0) return false;
  progress.selectedHero = type;
  state.progress = progress;
  state.selectedHeroId = type;
  state.heroes = heroRosterForProgress(progress);
  state.events.push({ type: 'hero-select', heroType: type });
  return true;
}

function resetRun(state, { mode, stageId }) {
  const preservedProgress = copyProgress(state.progress);
  const preservedTutorial = { ...state.tutorial };
  const preservedRng = state.rngState;
  const next = emptyRunState(preservedProgress, preservedRng);
  Object.assign(state, next, {
    screen: 'battle',
    mode,
    stageId,
    tutorial: preservedTutorial.active
      ? { active: true, step: 'squad', forcedDraws: 0 }
      : { active: false, step: 'done', forcedDraws: preservedTutorial.forcedDraws || 0 },
  });
  state.turretSlots = TD_TURRET_SLOTS[stageId] || TD_TURRET_SLOTS['stage-1'];
  state.hero = createHeroForState(state);
  return state;
}

export function beginTowerDefenseRun(state, { mode = 'stage', stageId = 'stage-1' } = {}) {
  const requestedMode = mode === 'endless' ? 'endless' : 'stage';
  const stage = TD_STAGE_BY_ID[stageId] || TD_STAGES[0];
  if (state.tutorial.active && (requestedMode !== 'stage' || stage.id !== 'stage-1')) return false;
  if (requestedMode === 'stage' && stage.index > state.progress.unlockedStage) return false;
  resetRun(state, { mode: requestedMode, stageId: stage.id });
  state.events.push({ type: 'run-start' });
  return true;
}

function createHeroForState(state) {
  const selected = state.progress.contractRanks[state.progress.selectedHero] > 0
    ? state.progress.selectedHero
    : 'shell';
  const definition = HERO_TYPES[selected] || HERO_TYPES.shell;
  const rank = contractRankForState(state, selected);
  const stats = heroStatsForRank(selected, rank);
  const maxHp = stats.maxHp;
  const x = stageForState(state).lanes[Math.floor(TD_LANE_COUNT / 2)].x;
  const y = 820;
  return {
    uid: nextUid(state, 'hero'),
    kind: 'hero',
    type: selected,
    rank,
    damage: stats.damage,
    interval: stats.interval,
    attackSpeed: stats.attackSpeed,
    skillEffect: stats.skillEffect,
    growthSummary: stats.growthSummary,
    x,
    y,
    spawnX: x,
    spawnY: y,
    facing: 1,
    hp: maxHp,
    maxHp,
    moveX: 0,
    moveY: 0,
    cooldown: 0.2,
    skillCooldown: 0,
    shieldHp: 0,
    shieldMaxHp: 0,
    shieldTime: 0,
    attackPulse: 0,
    skillPulse: 0,
    hitPulse: 0,
    aimAngle: 0,
  };
}

/** Directly purchases and deploys one four-member squad during preparation. */
export function buyTowerDefenseSquad(state, squadType, padIndex) {
  if (state?.screen !== 'battle' || state.result || state.phase !== 'prep') return null;
  if (state.tutorial.active && state.tutorial.step !== 'squad') return null;
  const definition = SQUAD_TYPES[squadType];
  const stage = stageForState(state);
  const index = Math.floor(Number(padIndex));
  const pad = stage.pads[index];
  if (state.tutorial.active && (squadType !== 'melee' || index !== stage.tutorialPadIndex)) {
    return null;
  }
  if (!definition || !pad || state.towers.some((squad) => squad.padIndex === index)) return null;
  if (state.currency < definition.cost) return null;

  const maxHp = definition.memberHp * definition.squadSize;
  const squad = {
    uid: nextUid(state, 'squad'),
    kind: 'soldier',
    type: squadType,
    squadType,
    star: 1,
    squadSize: definition.squadSize,
    maxMembers: definition.squadSize,
    aliveMembers: definition.squadSize,
    memberHp: definition.memberHp,
    padIndex: index,
    hp: maxHp,
    maxHp,
    hitPulse: 0,
    cooldown: 0.12,
    targetUid: null,
    facing: 1,
    aimAngle: 0,
    attackPulse: 0,
    x: pad.x,
    y: pad.y,
    deployX: pad.x,
    deployY: pad.y,
    laneIndex: pad.laneIndex,
    moveSpeed: definition.speed,
    moving: false,
    downed: false,
    members: [],
  };
  syncSquadMembers(squad, definition, { reset: true });
  state.currency -= definition.cost;
  state.towers.push(squad);
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'place', age: 0, duration: 0.58,
    x: pad.x, y: pad.y,
  });
  state.events.push({
    type: 'squad-buy', squadUid: squad.uid, squadType,
    padIndex: index, cost: definition.cost, squadSize: definition.squadSize,
  });
  state.events.push({
    type: 'place', towerUid: squad.uid, towerType: squadType, padIndex: index,
  });
  if (state.tutorial.active && state.tutorial.step === 'squad') state.tutorial.step = 'start';
  return squad;
}

export function refreshTowerDefenseSoldierShop() {
  return null;
}

export function buyTowerDefenseSoldier() {
  return null;
}

export function drawTowerCard() {
  return null;
}

export function placeTowerFromHand() {
  return null;
}

export function canMergeTowers() {
  return false;
}

export function mergeTowers() {
  return null;
}

export function canMergeCardIntoTower() {
  return false;
}

export function mergeCardIntoTower() {
  return null;
}

export function reclaimTowerToHand() {
  return null;
}

/** Moves one placed tower to a valid empty pad, preserving identity, star and aim. */
export function moveTowerToPad(state, towerUid, padIndex) {
  if (
    state.screen !== 'battle' || state.result || state.phase !== 'prep'
    || state.tutorial.active
  ) return null;
  const stage = stageForState(state);
  const targetPadIndex = Math.floor(Number(padIndex));
  if (!stage.pads[targetPadIndex]) return null;
  const tower = state.towers.find((candidate) => candidate.uid === towerUid);
  if (!tower || tower.padIndex === targetPadIndex) return null;
  if (state.towers.some((candidate) => candidate.padIndex === targetPadIndex)) return null;
  ensureTowerHealth(tower, state);

  const fromPadIndex = tower.padIndex;
  const sourcePad = stage.pads[fromPadIndex];
  tower.padIndex = targetPadIndex;
  const pad = stage.pads[targetPadIndex];
  tower.x = pad.x;
  tower.y = pad.y;
  tower.deployX = pad.x;
  tower.deployY = pad.y;
  tower.laneIndex = pad.laneIndex;
  syncSquadMembers(tower, SQUAD_TYPES[tower.squadType || tower.type] || SQUAD_TYPES.ranged, {
    reset: true,
  });
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'move-out', age: 0, duration: 0.4,
    x: sourcePad.x, y: sourcePad.y,
  });
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'place', age: 0, duration: 0.45, x: pad.x, y: pad.y,
  });
  state.events.push({
    type: 'tower-move',
    towerUid: tower.uid,
    fromPadIndex,
    toPadIndex: targetPadIndex,
  });
  return tower;
}

export function buildTowerDefenseTurret(state, slotIndex, type = 'gel-mortar') {
  if (state?.screen !== 'battle' || state.result || state.phase !== 'prep') return null;
  if (state.tutorial.active) return null;
  const definition = TURRET_TYPES[type];
  if (!definition) return null;
  const slots = TD_TURRET_SLOTS[state.stageId] || TD_TURRET_SLOTS['stage-1'];
  const index = Math.floor(Number(slotIndex));
  const slot = slots[index];
  if (!slot || state.turrets.some((turret) => turret.slotIndex === index)) return null;
  if (state.currency < definition.cost) return null;
  state.currency -= definition.cost;
  const turret = {
    uid: nextUid(state, 'turret'),
    kind: 'turret',
    type,
    slotIndex: index,
    x: slot.x,
    y: slot.y,
    cooldown: 0.2,
    attackPulse: 0,
    aimAngle: 0,
  };
  state.turrets.push(turret);
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'place', age: 0, duration: 0.62,
    x: slot.x, y: slot.y,
  });
  state.events.push({
    type: 'build-turret', turretUid: turret.uid, turretType: type,
    slotIndex: index, cost: definition.cost,
  });
  return turret;
}

export function setTowerDefenseHeroMovement(state, dx, dy) {
  if (
    state?.screen !== 'battle' || state.result || state.phase !== 'combat'
    || !state.waveActive || !state.hero || state.hero.hp <= 0
  ) return false;
  let moveX = clamp(Number(dx) || 0, -1, 1);
  let moveY = clamp(Number(dy) || 0, -1, 1);
  const magnitude = Math.hypot(moveX, moveY);
  if (magnitude > 1) {
    moveX /= magnitude;
    moveY /= magnitude;
  }
  state.hero.moveX = moveX;
  state.hero.moveY = moveY;
  if (Math.abs(moveX) > 0.01) state.hero.facing = moveX < 0 ? -1 : 1;
  return state.hero;
}

function heroSkillTargetsInCircle(state, center, radius, maxTargets = Infinity) {
  const boundedRadius = Math.max(0, Number(radius) || 0);
  const requestedLimit = Math.floor(Number(maxTargets));
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? requestedLimit
    : state.enemies.length;
  return state.enemies
    .filter((enemy) => enemy.hp > 0 && distance(center, enemy) <= boundedRadius)
    .sort((left, right) => (
      distance(center, left) - distance(center, right)
      || right.travelled - left.travelled
      || String(left.uid).localeCompare(String(right.uid))
    ))
    .slice(0, limit);
}

function heroSkillAimTarget(state, hero, skill) {
  if (skill.targeting === 'self') return null;
  const castRange = Math.max(0, Number(skill.radius) || 0);
  const candidates = state.enemies.filter((enemy) => (
    enemy.hp > 0 && distance(hero, enemy) <= castRange
  ));
  if (!candidates.length) return null;
  if (skill.targeting === 'cluster') {
    const clusterRadius = Math.max(1, Number(skill.clusterRadius) || 100);
    return [...candidates].sort((left, right) => {
      const density = (candidate) => candidates.reduce((count, enemy) => (
        count + (distance(candidate, enemy) <= clusterRadius ? 1 : 0)
      ), 0);
      return density(right) - density(left)
        || distance(hero, left) - distance(hero, right)
        || right.travelled - left.travelled
        || String(left.uid).localeCompare(String(right.uid));
    })[0];
  }
  return [...candidates].sort((left, right) => (
    distance(hero, left) - distance(hero, right)
    || right.travelled - left.travelled
    || String(left.uid).localeCompare(String(right.uid))
  ))[0];
}

function applyHeroSkillStatus(state, enemy, step) {
  if (!enemy || enemy.hp <= 0) return;
  const displacement = Math.max(
    0,
    Number(step.knockback) || Number(step.rewind) || 0,
  );
  if (displacement > 0) setEnemyTravelled(state, enemy, enemy.travelled - displacement);
  if (Number(step.slowMultiplier) > 0) {
    enemy.slowMultiplier = Math.min(
      enemy.slowMultiplier,
      clamp(Number(step.slowMultiplier), 0.05, 1),
    );
    enemy.slowTime = Math.max(enemy.slowTime, Math.max(0, Number(step.slowTime) || 0));
  }
  if (Number(step.poisonDps) > 0) {
    enemy.poisonDps = Math.max(enemy.poisonDps, Number(step.poisonDps));
    enemy.poisonTime = Math.max(enemy.poisonTime, Math.max(0, Number(step.poisonTime) || 0));
  }
  if (Number(step.rootTime) > 0) {
    enemy.slowMultiplier = Math.min(enemy.slowMultiplier, 0.08);
    enemy.slowTime = Math.max(enemy.slowTime, Number(step.rootTime));
  }
}

function applyRadialHeroSkillStep(state, center, step) {
  const targets = heroSkillTargetsInCircle(
    state,
    center,
    step.radius,
    step.maxTargets,
  );
  const damage = Math.max(0, Number(step.damage) || 0);
  for (const enemy of targets) {
    if (damage > 0) damageEnemy(state, enemy, damage);
    applyHeroSkillStatus(state, enemy, step);
  }
  return targets;
}

function spawnHeroSkillActor(state, queuedStep, step, hero) {
  if (!Array.isArray(state.heroSkillActors)) state.heroSkillActors = [];
  const base = {
    uid: nextUid(state, 'skill-actor'),
    heroUid: hero.uid,
    heroType: queuedStep.heroType,
    skillId: queuedStep.skillId,
    stepKind: step.kind,
    stage: step.stage,
    age: 0,
  };
  let actor = null;
  if (step.action === 'beam') {
    const length = Math.max(1, Number(step.length) || 1);
    const originX = hero.x;
    const originY = hero.y - 24;
    actor = {
      ...base,
      type: 'beam',
      duration: Math.max(0.05, Number(step.duration) || 0.5),
      originX,
      originY,
      endX: originX + queuedStep.directionX * length,
      endY: originY + queuedStep.directionY * length,
      directionX: queuedStep.directionX,
      directionY: queuedStep.directionY,
      length,
      width: Math.max(1, Number(step.width) || 1),
      tickInterval: Math.max(0.01, Number(step.tickInterval) || 0.1),
      tickTimer: 0,
      tickDamage: Math.max(0, Number(step.tickDamage) || 0),
      maxTargets: Math.max(1, Math.floor(Number(step.maxTargets) || state.enemies.length || 1)),
      followHero: true,
    };
  } else if (step.action === 'field') {
    actor = {
      ...base,
      type: 'field',
      x: queuedStep.targetX,
      y: queuedStep.targetY,
      radius: Math.max(1, Number(step.radius) || 1),
      duration: Math.max(0.05, Number(step.duration) || 0.5),
      tickInterval: Math.max(0.01, Number(step.tickInterval) || 0.1),
      tickTimer: 0,
      tickDamage: Math.max(0, Number(step.tickDamage) || 0),
      maxTargets: Math.max(1, Math.floor(Number(step.maxTargets) || state.enemies.length || 1)),
      slowMultiplier: Number(step.slowMultiplier) || 0,
      slowTime: Math.max(0, Number(step.slowTime) || 0),
      rewind: Math.max(0, Number(step.rewind) || 0),
    };
  } else if (step.action === 'wave') {
    const angle = Math.atan2(queuedStep.directionY, queuedStep.directionX)
      + (Number(step.angleOffset) || 0);
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const maxDistance = Math.max(1, Number(step.length) || 1);
    const speed = Math.max(1, Number(step.speed) || 1);
    const originX = hero.x;
    const originY = hero.y - 18;
    actor = {
      ...base,
      type: 'wave',
      originX,
      originY,
      x: originX,
      y: originY,
      previousX: originX,
      previousY: originY,
      directionX,
      directionY,
      speed,
      maxDistance,
      distanceTravelled: 0,
      width: Math.max(1, Number(step.width) || 1),
      damage: Math.max(0, Number(step.damage) || 0),
      maxTargets: Math.max(1, Math.floor(Number(step.maxTargets) || state.enemies.length || 1)),
      slowMultiplier: Number(step.slowMultiplier) || 0,
      slowTime: Math.max(0, Number(step.slowTime) || 0),
      hitUids: [],
      duration: maxDistance / speed + 0.1,
    };
  }
  if (actor) state.heroSkillActors.push(actor);
  return actor;
}

function launchHeroSkillProjectiles(state, queuedStep, step, hero, skill) {
  const count = Math.max(1, Math.floor(Number(step.projectileCount) || 1));
  const origin = { x: hero.x, y: hero.y };
  const candidates = state.enemies
    .filter((enemy) => enemy.hp > 0 && distance(origin, enemy) <= skill.radius)
    .sort((left, right) => (
      distance({ x: queuedStep.targetX, y: queuedStep.targetY }, left)
        - distance({ x: queuedStep.targetX, y: queuedStep.targetY }, right)
      || right.travelled - left.travelled
      || String(left.uid).localeCompare(String(right.uid))
    ));
  const offsets = [
    { x: 0, y: 0 }, { x: -18, y: 12 }, { x: 18, y: -10 },
    { x: -28, y: -15 }, { x: 28, y: 16 },
  ];
  const projectiles = [];
  for (let index = 0; index < count; index += 1) {
    const target = candidates[index] || candidates[index % Math.max(1, candidates.length)] || null;
    const offset = target && candidates.length > 1 ? { x: 0, y: 0 } : offsets[index % offsets.length];
    const projectile = {
      uid: nextUid(state, 'skill-shot'),
      type: 'berry',
      effect: 'skill-splash',
      sourceKind: 'hero-skill',
      heroType: queuedStep.heroType,
      skillId: queuedStep.skillId,
      stepKind: step.kind,
      stage: step.stage,
      star: 1,
      effectTier: 1,
      volleyIndex: index,
      volleyCount: count,
      secondary: index > 0,
      groundSplash: true,
      tracksTarget: false,
      targetUid: target?.uid || queuedStep.targetUid || null,
      x: hero.x,
      y: hero.y - 30,
      targetX: (target?.x ?? queuedStep.targetX) + offset.x,
      targetY: (target?.y ?? queuedStep.targetY) + offset.y,
      speed: Math.max(1, Number(step.projectileSpeed) || 460),
      damage: Math.max(0, Number(step.damage) || 0),
      splashRadius: Math.max(1, Number(step.explosionRadius) || 1),
      maxTargets: Math.max(1, Math.floor(Number(step.maxTargets) || state.enemies.length || 1)),
      knockback: Math.max(0, Number(step.knockback) || 0),
      age: 0,
      maxAge: 3,
    };
    state.projectiles.push(projectile);
    projectiles.push(projectile);
    state.events.push({
      type: 'hero-skill-projectile',
      heroUid: hero.uid,
      heroType: queuedStep.heroType,
      skillId: queuedStep.skillId,
      projectileUid: projectile.uid,
      stepKind: step.kind,
      stage: step.stage,
      targetUid: projectile.targetUid,
      targetX: projectile.targetX,
      targetY: projectile.targetY,
    });
  }
  return projectiles;
}

function executeHeroSkillStep(state, queuedStep) {
  const hero = state.hero;
  if (!hero || hero.hp <= 0 || hero.uid !== queuedStep.heroUid) return [];
  const definition = HERO_TYPES[queuedStep.heroType] || HERO_TYPES.shell;
  const skill = definition.skill;
  const stats = heroStatsForRank(queuedStep.heroType, hero.rank);
  const step = stats.skillSteps[queuedStep.stepIndex];
  if (!step) return [];
  const origin = { x: queuedStep.originX, y: queuedStep.originY };
  const targetOrigin = { x: queuedStep.targetX, y: queuedStep.targetY };
  const center = step.origin === 'target' ? targetOrigin : origin;
  const radius = Math.max(0, Number(step.radius) || Number(skill.radius) || 0);
  let targets = [];
  const actorUids = [];
  const projectileUids = [];
  if (step.action === 'radial') {
    targets = applyRadialHeroSkillStep(state, center, step);
  } else if (['beam', 'field', 'wave'].includes(step.action)) {
    const actor = spawnHeroSkillActor(state, queuedStep, step, hero);
    if (actor) actorUids.push(actor.uid);
    const aimed = state.enemies.find((enemy) => (
      enemy.uid === queuedStep.targetUid && enemy.hp > 0
    ));
    if (aimed) targets = [aimed];
  } else if (step.action === 'projectile-volley') {
    const projectiles = launchHeroSkillProjectiles(state, queuedStep, step, hero, skill);
    projectileUids.push(...projectiles.map(({ uid }) => uid));
    const targetIds = new Set(projectiles.map(({ targetUid }) => targetUid).filter(Boolean));
    targets = state.enemies.filter(({ uid }) => targetIds.has(uid));
  }
  if (Number(step.shieldHp) > 0) {
    const grantedShield = Math.max(0, Number(step.shieldHp));
    hero.shieldHp = Math.max(Number(hero.shieldHp) || 0, grantedShield);
    hero.shieldMaxHp = Math.max(Number(hero.shieldMaxHp) || 0, grantedShield);
    hero.shieldTime = Math.max(Number(hero.shieldTime) || 0, Number(step.shieldDuration) || 0);
  }
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'hero-skill-step', age: 0,
    duration: Math.max(0.3, Number(step.visualDuration) || 0.72),
    x: center.x, y: center.y, radius, heroType: queuedStep.heroType,
    skillId: skill.id, skillName: skill.name,
    stage: step.stage, stepIndex: queuedStep.stepIndex, stepKind: step.kind,
    action: step.action, actorUids, projectileUids,
  });
  state.events.push({
    type: 'hero-skill-step', heroUid: hero.uid, heroType: queuedStep.heroType,
    skillId: skill.id, skillName: skill.name,
    stage: step.stage, stepIndex: queuedStep.stepIndex, stepKind: step.kind,
    action: step.action,
    targetUids: targets.map(({ uid }) => uid),
    damage: Math.max(0, Number(step.damage) || 0),
    tickDamage: Math.max(0, Number(step.tickDamage) || 0),
    actorUids, projectileUids,
    shieldHp: Math.max(0, Number(step.shieldHp) || 0),
  });
  return targets.map(({ uid }) => uid);
}

function updateHeroSkillQueue(state, dt) {
  if (!Array.isArray(state.heroSkillQueue)) state.heroSkillQueue = [];
  state.heroSkillQueue.forEach((entry) => {
    entry.remaining = Math.max(-1, (Number(entry.remaining) || 0) - dt);
  });
  const due = state.heroSkillQueue
    .filter(({ remaining }) => remaining <= 0)
    .sort((left, right) => left.stepIndex - right.stepIndex);
  state.heroSkillQueue = state.heroSkillQueue.filter(({ remaining }) => remaining > 0);
  return due.map((entry) => executeHeroSkillStep(state, entry));
}

export function activateTowerDefenseHeroSkill(state) {
  if (
    state?.screen !== 'battle' || state.result || state.phase !== 'combat'
    || !state.waveActive || !state.hero || state.hero.hp <= 0
    || state.hero.skillCooldown > 0
  ) return false;
  const hero = state.hero;
  const definition = HERO_TYPES[hero.type] || HERO_TYPES.shell;
  const skill = definition.skill;
  if (!skill?.steps?.length) return false;
  const aimTarget = heroSkillAimTarget(state, hero, skill);
  if (skill.targeting !== 'self' && !aimTarget) return false;
  const aimX = aimTarget?.x ?? hero.x;
  const aimY = aimTarget?.y ?? hero.y - 1;
  const aimDx = aimX - hero.x;
  const aimDy = aimY - hero.y;
  const aimLength = Math.hypot(aimDx, aimDy) || 1;
  const directionX = aimDx / aimLength;
  const directionY = aimDy / aimLength;
  if (!Array.isArray(state.heroSkillQueue)) state.heroSkillQueue = [];
  const queued = skill.steps.map((step, stepIndex) => ({
    uid: nextUid(state, 'skill'),
    heroUid: hero.uid,
    heroType: hero.type,
    skillId: skill.id,
    stage: step.stage,
    stepIndex,
    remaining: Math.max(0, Number(step.at) || 0),
    originX: hero.x,
    originY: hero.y,
    targetUid: aimTarget?.uid || null,
    targetX: aimX,
    targetY: aimY,
    directionX,
    directionY,
  }));
  state.heroSkillQueue.push(...queued);
  hero.skillCooldown = skill.cooldown;
  hero.skillPulse = 1;
  hero.aimAngle = Math.atan2(directionY, directionX);
  if (skill.targeting !== 'self' && Math.abs(directionX) > 0.01) {
    hero.facing = directionX < 0 ? -1 : 1;
  }
  const activationEvent = {
    type: 'hero-skill', heroUid: hero.uid, heroType: hero.type,
    skillId: skill.id, skillName: skill.name, skillDescription: skill.description,
    stageCount: skill.steps.length, targetUids: [], damage: 0,
  };
  state.events.push(activationEvent);
  const [firstTargets = []] = updateHeroSkillQueue(state, 0);
  activationEvent.targetUids = firstTargets;
  activationEvent.damage = Math.max(
    0,
    estimatedSkillStepDamage(heroStatsForRank(hero.type, hero.rank).skillSteps[0]),
  );
  return true;
}

export function pathMetrics(points) {
  const segments = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = distance(start, end);
    segments.push({ start, end, length, from: total, to: total + length });
    total += length;
  }
  return { segments, total };
}

export function pointOnPath(points, travelled) {
  const metrics = pathMetrics(points);
  const value = clamp(Number(travelled) || 0, 0, metrics.total);
  const segment = metrics.segments.find((entry) => value <= entry.to) || metrics.segments.at(-1);
  if (!segment) return { ...points[0], angle: 0 };
  const ratio = segment.length > 0 ? (value - segment.from) / segment.length : 0;
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
    y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
    angle: Math.atan2(segment.end.y - segment.start.y, segment.end.x - segment.start.x),
  };
}

/** Nearest point on a polyline, including its route-distance coordinate. */
function projectPointToPath(points, actor) {
  const metrics = pathMetrics(points);
  let best = null;
  for (const segment of metrics.segments) {
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared > 0
      ? clamp(((actor.x - segment.start.x) * dx + (actor.y - segment.start.y) * dy) / lengthSquared, 0, 1)
      : 0;
    const point = {
      x: segment.start.x + dx * ratio,
      y: segment.start.y + dy * ratio,
    };
    const transverseDistance = distance(actor, point);
    if (!best || transverseDistance < best.distance) {
      best = {
        ...point,
        distance: transverseDistance,
        travelled: segment.from + segment.length * ratio,
      };
    }
  }
  return best || { ...points[0], distance: distance(actor, points[0]), travelled: 0 };
}

/** Returns route distance at a vertical contact line on a monotonic portrait path. */
function travelledAtPathY(points, y) {
  const metrics = pathMetrics(points);
  const targetY = Number(y);
  if (!Number.isFinite(targetY) || !metrics.segments.length) return 0;
  if (targetY <= points[0].y) return 0;
  if (targetY >= points.at(-1).y) return metrics.total;
  const segment = metrics.segments.find(({ start, end }) => (
    targetY >= Math.min(start.y, end.y) && targetY <= Math.max(start.y, end.y)
  ));
  if (!segment) return 0;
  const deltaY = segment.end.y - segment.start.y;
  const ratio = Math.abs(deltaY) > 1e-6
    ? clamp((targetY - segment.start.y) / deltaY, 0, 1)
    : 0;
  return segment.from + segment.length * ratio;
}

export function endlessScaleForWave(waveNumber) {
  const waveIndex = Math.max(1, Math.floor(Number(waveNumber) || 1));
  return Object.freeze({
    // Total spawn slots stay fixed; boss waves replace regular enemies inside this budget.
    count: TD_ENDLESS_SCALE_CAPS.count,
    hp: scaleValue(Math.min(TD_ENDLESS_SCALE_CAPS.hp, 1.35 + (waveIndex - 1) * 0.115)),
    speed: scaleValue(Math.min(TD_ENDLESS_SCALE_CAPS.speed, 1.05 + (waveIndex - 1) * 0.01)),
    reward: scaleValue(Math.min(TD_ENDLESS_SCALE_CAPS.reward, 1.2 + (waveIndex - 1) * 0.03)),
    bossCount: waveIndex % 5 === 0
      ? Math.min(TD_ENDLESS_SCALE_CAPS.bossCount, 1 + Math.floor(waveIndex / 30))
      : 0,
  });
}

function endlessWaveGroups(waveNumber) {
  const scale = endlessScaleForWave(waveNumber);
  const groups = [];
  const regularCount = scale.count - scale.bossCount;
  const stoneShare = Math.min(0.4, 0.16 + Math.max(0, waveNumber - 3) * 0.008);
  const windShare = Math.min(0.38, 0.3 + Math.max(0, waveNumber - 2) * 0.004);
  const stoneCount = waveNumber >= 3 ? Math.floor(regularCount * stoneShare) : 0;
  const windCount = waveNumber >= 2 ? Math.floor(regularCount * windShare) : 0;
  const bugCount = regularCount - stoneCount - windCount;
  if (bugCount) groups.push(group('bug', bugCount, Math.max(0.42, 0.62 - waveNumber * 0.008)));
  if (windCount) groups.push(group('windcap', windCount, Math.max(0.48, 0.7 - waveNumber * 0.007), 1.2));
  if (stoneCount) groups.push(group('stone', stoneCount, Math.max(0.82, 1.22 - waveNumber * 0.01), 1.8));
  if (scale.bossCount) groups.push(group('boss', scale.bossCount, 3.4, 4.6));
  return groups;
}

function queueForWave(state, waveNumber) {
  const groups = state.mode === 'endless'
    ? endlessWaveGroups(waveNumber)
    : (stageForState(state).waves[waveNumber - 1] || []);
  const queue = [];
  groups.forEach((entry, groupIndex) => {
    const laneIndices = entry.laneIndices
      .map((laneIndex) => Math.floor(Number(laneIndex)))
      .filter((laneIndex) => laneIndex >= 0 && laneIndex < TD_LANE_COUNT);
    const availableLanes = laneIndices.length ? laneIndices : TD_LANE_INDICES;
    for (let index = 0; index < entry.count; index += 1) {
      queue.push({
        uid: `spawn-${waveNumber}-${groupIndex}-${index}`,
        type: entry.type,
        at: entry.delay + index * entry.interval,
        laneIndex: availableLanes[(index + groupIndex + waveNumber - 1) % availableLanes.length],
      });
    }
  });
  queue.sort((left, right) => left.at - right.at || left.uid.localeCompare(right.uid));
  return queue;
}

export function startNextTowerDefenseWave(state) {
  if (
    state.screen !== 'battle' || state.result || state.waveActive
    || state.phase !== 'prep'
  ) return false;
  if (state.tutorial.active && state.tutorial.step !== 'start') return false;
  const stage = stageForState(state);
  if (state.mode === 'stage' && state.wave >= stage.waves.length) return false;
  state.wave += 1;
  state.waveActive = true;
  state.phase = 'combat';
  state.waveElapsed = 0;
  state.waveBreak = 0;
  state.spawnQueue = queueForWave(state, state.wave);
  state.waveEnemyTotal = state.spawnQueue.length;
  state.waveEnemyResolved = 0;
  state.heroSkillQueue = [];
  state.heroSkillActors = [];
  for (const soldier of state.towers) {
    soldier.x = Number.isFinite(Number(soldier.deployX))
      ? soldier.deployX : stage.pads[soldier.padIndex]?.x;
    soldier.y = Number.isFinite(Number(soldier.deployY))
      ? soldier.deployY : stage.pads[soldier.padIndex]?.y;
    soldier.moving = false;
    syncSquadMembers(
      soldier,
      SQUAD_TYPES[soldier.squadType || soldier.type] || SQUAD_TYPES.ranged,
      { reset: true },
    );
  }
  if (state.hero) {
    state.hero.x = state.hero.spawnX;
    state.hero.y = state.hero.spawnY;
    state.hero.moveX = 0;
    state.hero.moveY = 0;
    state.hero.shieldHp = 0;
    state.hero.shieldMaxHp = 0;
    state.hero.shieldTime = 0;
  }
  state.events.push({ type: 'wave-start', wave: state.wave });
  if (state.tutorial.active && state.tutorial.step === 'start') {
    state.tutorial.active = false;
    state.tutorial.step = 'done';
    state.progress.tutorialSeen = true;
    state.events.push({ type: 'tutorial-complete' });
  }
  return true;
}

export function stageScaleForWave(stageIndex, waveNumber) {
  const stageOffset = clamp(Math.floor(Number(stageIndex) || 1), 1, TD_STAGES.length) - 1;
  const waveOffset = Math.max(1, Math.floor(Number(waveNumber) || 1)) - 1;
  return Object.freeze({
    hp: scaleValue(Math.min(TD_STAGE_SCALE_CAPS.hp, 1.25 + stageOffset * 0.34 + waveOffset * 0.18)),
    speed: scaleValue(Math.min(TD_STAGE_SCALE_CAPS.speed, 1.07 + stageOffset * 0.055 + waveOffset * 0.025)),
    reward: scaleValue(Math.min(TD_STAGE_SCALE_CAPS.reward, 1.2 + stageOffset * 0.12 + waveOffset * 0.08)),
  });
}

function enemyScaleForState(state) {
  if (state.mode === 'endless') return endlessScaleForWave(state.wave);
  return stageScaleForWave(stageForState(state).index, state.wave);
}

function normalizedLaneIndex(stage, laneIndex, x = null) {
  const numeric = Math.floor(Number(laneIndex));
  if (Number.isFinite(numeric) && stage.lanes[numeric]) return numeric;
  if (Number.isFinite(Number(x))) {
    return stage.lanes.reduce((bestIndex, lane, index) => (
      Math.abs(lane.x - x) < Math.abs(stage.lanes[bestIndex].x - x) ? index : bestIndex
    ), 0);
  }
  return 0;
}

function spawnEnemy(state, type, laneIndex = 0) {
  const definition = TD_ENEMIES[type] || TD_ENEMIES.bug;
  const scale = enemyScaleForState(state);
  const maxHp = Math.round(definition.hp * scale.hp);
  const stage = stageForState(state);
  const resolvedLaneIndex = normalizedLaneIndex(stage, laneIndex);
  const lane = stage.lanes[resolvedLaneIndex];
  const enemy = {
    uid: nextUid(state, 'enemy'),
    type: definition.id,
    laneIndex: resolvedLaneIndex,
    travelled: 0,
    x: lane.path[0].x,
    y: lane.path[0].y,
    facing: 1,
    travelAngle: Math.PI / 2,
    hp: maxHp,
    maxHp,
    speed: definition.speed * scale.speed,
    reward: Math.max(1, Math.round(definition.reward * scale.reward)),
    attackDamage: Math.max(1, Math.round(definition.attackDamage * Math.min(2.2, Math.sqrt(scale.hp)))),
    attackInterval: definition.attackInterval,
    slowMultiplier: 1,
    slowTime: 0,
    poisonDps: 0,
    poisonTime: 0,
    hitPulse: 0,
    attackCooldown: definition.attackInterval,
    blockedByTowerUid: null,
  };
  state.enemies.push(enemy);
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'spawn', age: 0, duration: 0.46,
    x: enemy.x, y: enemy.y,
  });
  return enemy;
}

const starPower = (star) => [0, 1, 1.78, 3.12, 5.35][clamp(Math.floor(star), 1, TD_MAX_STAR)];

function towerPosition(state, tower) {
  const pad = stageForState(state).pads[tower.padIndex];
  if (!pad) return null;
  return {
    x: Number.isFinite(Number(tower.x)) ? tower.x : pad.x,
    y: Number.isFinite(Number(tower.y)) ? tower.y : pad.y,
    laneIndex: Number.isFinite(Number(tower.laneIndex)) ? tower.laneIndex : pad.laneIndex,
  };
}

function laneIndexForEnemy(state, enemy) {
  const stage = stageForState(state);
  const laneIndex = normalizedLaneIndex(stage, enemy.laneIndex, enemy.x);
  enemy.laneIndex = laneIndex;
  return laneIndex;
}

function setEnemyTravelled(state, enemy, travelled) {
  const stage = stageForState(state);
  const laneIndex = laneIndexForEnemy(state, enemy);
  const lane = stage.lanes[laneIndex];
  const pathLength = pathMetrics(lane.path).total;
  enemy.travelled = clamp(Number(travelled) || 0, 0, pathLength);
  const point = pointOnPath(lane.path, enemy.travelled);
  enemy.x = point.x;
  enemy.y = point.y;
  enemy.travelAngle = point.angle;
  return point;
}

function damageEnemy(state, enemy, amount, { emitHit = true } = {}) {
  if (!enemy || enemy.hp <= 0) return false;
  const damage = Math.max(0, Number(amount) || 0);
  if (damage <= 0) return false;
  enemy.hp -= damage;
  enemy.hitPulse = 1;
  if (emitHit) {
    state.events.push({
      type: 'enemy-hit',
      enemyUid: enemy.uid,
      enemyType: enemy.type,
      damage,
    });
  }
  if (enemy.hp > 0) return false;
  enemy.hp = 0;
  state.waveEnemyResolved = Math.min(
    Math.max(0, Number(state.waveEnemyTotal) || 0),
    Math.max(0, Number(state.waveEnemyResolved) || 0) + 1,
  );
  state.currency += enemy.reward;
  state.kills += 1;
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'defeat', age: 0, duration: 0.66,
    x: enemy.x, y: enemy.y,
  });
  state.events.push({
    type: 'enemy-defeat',
    enemyUid: enemy.uid,
    enemyType: enemy.type,
    x: enemy.x,
    y: enemy.y,
    facing: enemy.facing,
  });
  return true;
}

function nearbyEffectTargets(state, target, radius, count = Infinity, allLanes = false) {
  const targetLaneIndex = laneIndexForEnemy(state, target);
  return state.enemies
    .filter((enemy) => (
      enemy.uid !== target.uid
      && enemy.hp > 0
      && (allLanes
        ? distance(enemy, target) <= radius
        : laneIndexForEnemy(state, enemy) === targetLaneIndex
          && Math.abs(enemy.y - target.y) <= radius)
    ))
    .sort((left, right) => right.travelled - left.travelled)
    .slice(0, count);
}

function emitProjectileImpact(state, projectile, target, { secondary = false } = {}) {
  state.effects.push({
    uid: nextUid(state, 'fx'),
    type: projectile.effect === 'poison'
      ? 'leaf-hit'
      : projectile.effect === 'slow' ? 'bubble-hit' : 'hit',
    age: 0,
    duration: 0.48,
    x: target.x,
    y: target.y - 18,
    star: projectile.star,
    effectTier: projectile.effectTier,
    attackMode: projectile.attackMode,
    secondary,
  });
}

function applyProjectileHit(state, projectile, target) {
  if (!target || target.hp <= 0) return;
  damageEnemy(state, target, projectile.damage);
  if (projectile.effect === 'splash') {
    const radius = projectile.splashRadius ?? 42 + projectile.star * 7;
    const splashDamageScale = projectile.splashDamageScale ?? 0.52;
    const knockback = Math.max(0, Number(projectile.knockback) || 0);
    if (knockback > 0) setEnemyTravelled(state, target, target.travelled - knockback);
    for (const enemy of nearbyEffectTargets(
      state, target, radius, Infinity, Boolean(projectile.areaAllLanes),
    )) {
      damageEnemy(state, enemy, projectile.damage * splashDamageScale);
    }
  } else if (projectile.effect === 'pierce') {
    const extras = nearbyEffectTargets(
      state,
      target,
      Math.max(0, Number(projectile.pierceRadius) || 104),
      Math.max(0, Math.floor(projectile.pierceTargets ?? Math.min(3, projectile.star))),
    );
    const pierceDamageScale = projectile.pierceDamageScale ?? 0.68;
    extras.forEach((enemy, index) => damageEnemy(
      state, enemy, projectile.damage * Math.max(0.32, pierceDamageScale - index * 0.12),
    ));
  } else if (projectile.effect === 'slow') {
    const slowMultiplier = clamp(
      Number(projectile.slowMultiplier) || 0.7 - projectile.star * 0.055,
      0.28,
      1,
    );
    const slowTime = Math.max(0, Number(projectile.slowTime) || 1.5 + projectile.star * 0.22);
    const rewind = Math.max(0, Number(projectile.rewind) || 5 + projectile.star * 2.5);
    target.slowMultiplier = Math.min(target.slowMultiplier, slowMultiplier);
    target.slowTime = Math.max(target.slowTime, slowTime);
    setEnemyTravelled(state, target, target.travelled - rewind);
    const chainTargets = nearbyEffectTargets(
      state,
      target,
      Math.max(0, Number(projectile.chainRadius) || 0),
      Math.max(0, Math.floor(Number(projectile.chainTargets) || 0)),
    );
    const chainPower = clamp(Number(projectile.chainPower) || 0, 0, 1);
    for (const enemy of chainTargets) {
      const chainedSlow = 1 - (1 - slowMultiplier) * chainPower;
      enemy.slowMultiplier = Math.min(enemy.slowMultiplier, chainedSlow);
      enemy.slowTime = Math.max(enemy.slowTime, slowTime * 0.72);
      setEnemyTravelled(state, enemy, enemy.travelled - rewind * chainPower);
      emitProjectileImpact(state, projectile, enemy, { secondary: true });
    }
  } else if (projectile.effect === 'poison') {
    const poisonDps = Math.max(
      0,
      Number(projectile.poisonDps) || 4.5 * starPower(projectile.star)
        * Math.max(1, Number(projectile.poisonMultiplier) || 1),
    );
    const poisonTime = Math.max(
      0,
      Number(projectile.poisonTime) || 2.5 + projectile.star * 0.35,
    );
    target.poisonDps = Math.max(target.poisonDps, poisonDps);
    target.poisonTime = Math.max(target.poisonTime, poisonTime);
    const spreadTargets = nearbyEffectTargets(
      state,
      target,
      Math.max(0, Number(projectile.spreadRadius) || 0),
      Math.max(0, Math.floor(Number(projectile.spreadTargets) || 0)),
    );
    const spreadPoisonScale = clamp(Number(projectile.spreadPoisonScale) || 0, 0, 1);
    for (const enemy of spreadTargets) {
      enemy.poisonDps = Math.max(enemy.poisonDps, poisonDps * spreadPoisonScale);
      enemy.poisonTime = Math.max(enemy.poisonTime, poisonTime * 0.76);
      emitProjectileImpact(state, projectile, enemy, { secondary: true });
    }
  }
  emitProjectileImpact(state, projectile, target);
}

function applyGroundSplashImpact(state, projectile) {
  const center = {
    x: Number(projectile.targetX) || 0,
    y: Number(projectile.targetY) || 0,
  };
  const targets = heroSkillTargetsInCircle(
    state,
    center,
    projectile.splashRadius,
    projectile.maxTargets,
  );
  for (const enemy of targets) {
    damageEnemy(state, enemy, projectile.damage);
    applyHeroSkillStatus(state, enemy, projectile);
  }
  state.effects.push({
    uid: nextUid(state, 'fx'),
    type: 'hero-skill-impact',
    age: 0,
    duration: 0.62,
    x: center.x,
    y: center.y,
    radius: Math.max(1, Number(projectile.splashRadius) || 1),
    heroType: projectile.heroType,
    skillId: projectile.skillId,
    stepKind: projectile.stepKind,
    stage: projectile.stage,
  });
  state.events.push({
    type: 'hero-skill-impact',
    heroType: projectile.heroType,
    skillId: projectile.skillId,
    stepKind: projectile.stepKind,
    stage: projectile.stage,
    projectileUid: projectile.uid,
    x: center.x,
    y: center.y,
    radius: Math.max(1, Number(projectile.splashRadius) || 1),
    damage: Math.max(0, Number(projectile.damage) || 0),
    targetUids: targets.map(({ uid }) => uid),
  });
  return targets;
}

function updateProjectiles(state, dt) {
  for (const projectile of state.projectiles) {
    projectile.age += dt;
    const target = state.enemies.find((enemy) => enemy.uid === projectile.targetUid && enemy.hp > 0);
    if (target && projectile.tracksTarget !== false) {
      projectile.targetX = target.x;
      projectile.targetY = target.y - 18;
    }
    const dx = projectile.targetX - projectile.x;
    const dy = projectile.targetY - projectile.y;
    const remaining = Math.hypot(dx, dy);
    const travel = projectile.speed * dt;
    if (remaining <= Math.max(9, travel)) {
      projectile.x = projectile.targetX;
      projectile.y = projectile.targetY;
      projectile.done = true;
      if (projectile.groundSplash) applyGroundSplashImpact(state, projectile);
      else applyProjectileHit(state, projectile, target);
    } else {
      projectile.x += dx / remaining * travel;
      projectile.y += dy / remaining * travel;
    }
  }
  state.projectiles = state.projectiles.filter((projectile) => (
    !projectile.done && projectile.age < Math.max(0.1, Number(projectile.maxAge) || 2.4)
  ));
}

function pointToSegmentMetrics(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared > 0
    ? clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1)
    : 0;
  const closest = { x: start.x + dx * ratio, y: start.y + dy * ratio };
  return { ratio, distance: distance(point, closest), closest };
}

function actorCollisionPadding(enemy) {
  return (TD_ENEMIES[enemy?.type]?.size || TD_ENEMIES.bug.size) * 0.12;
}

function actorLineTargets(state, start, end, width, maxTargets, excludedUids = []) {
  const excluded = new Set(excludedUids);
  return state.enemies
    .filter((enemy) => enemy.hp > 0 && !excluded.has(enemy.uid))
    .map((enemy) => ({
      enemy,
      metrics: pointToSegmentMetrics(enemy, start, end),
    }))
    .filter(({ enemy, metrics }) => (
      metrics.distance <= Math.max(0.5, width / 2) + actorCollisionPadding(enemy)
    ))
    .sort((left, right) => (
      left.metrics.ratio - right.metrics.ratio
      || right.enemy.travelled - left.enemy.travelled
      || String(left.enemy.uid).localeCompare(String(right.enemy.uid))
    ))
    .slice(0, Math.max(1, Math.floor(Number(maxTargets) || state.enemies.length || 1)))
    .map(({ enemy }) => enemy);
}

function emitHeroSkillActorTick(state, actor, targets, damage) {
  if (!targets.length) return;
  state.events.push({
    type: 'hero-skill-tick',
    actorUid: actor.uid,
    actorType: actor.type,
    heroUid: actor.heroUid,
    heroType: actor.heroType,
    skillId: actor.skillId,
    stepKind: actor.stepKind,
    stage: actor.stage,
    damage: Math.max(0, Number(damage) || 0),
    targetUids: targets.map(({ uid }) => uid),
  });
}

function tickBeamActor(state, actor) {
  const start = { x: actor.originX, y: actor.originY };
  const end = { x: actor.endX, y: actor.endY };
  const targets = actorLineTargets(state, start, end, actor.width, actor.maxTargets);
  const damage = Math.max(0, Number(actor.tickDamage) || 0);
  for (const enemy of targets) damageEnemy(state, enemy, damage);
  emitHeroSkillActorTick(state, actor, targets, damage);
}

function tickFieldActor(state, actor) {
  const targets = heroSkillTargetsInCircle(
    state,
    actor,
    actor.radius,
    actor.maxTargets,
  );
  const damage = Math.max(0, Number(actor.tickDamage) || 0);
  for (const enemy of targets) {
    damageEnemy(state, enemy, damage);
    applyHeroSkillStatus(state, enemy, actor);
  }
  emitHeroSkillActorTick(state, actor, targets, damage);
}

function updateTimedSkillActor(state, actor, dt, tick) {
  const duration = Math.max(0.05, Number(actor.duration) || 0.05);
  const activeDt = Math.min(dt, Math.max(0, duration - actor.age));
  actor.age = Math.min(duration, actor.age + activeDt);
  actor.phase = clamp(actor.age / duration, 0, 1);
  actor.tickTimer = Math.max(0, Number(actor.tickTimer) || 0) + activeDt;
  const interval = Math.max(0.01, Number(actor.tickInterval) || 0.1);
  while (actor.tickTimer + 1e-9 >= interval) {
    actor.tickTimer -= interval;
    tick(state, actor);
  }
  if (actor.age >= duration - 1e-9) actor.done = true;
}

function updateWaveActor(state, actor, dt) {
  const remaining = Math.max(0, actor.maxDistance - actor.distanceTravelled);
  const travel = Math.min(remaining, Math.max(0, actor.speed * dt));
  actor.previousX = actor.x;
  actor.previousY = actor.y;
  actor.distanceTravelled += travel;
  actor.x = actor.originX + actor.directionX * actor.distanceTravelled;
  actor.y = actor.originY + actor.directionY * actor.distanceTravelled;
  actor.age += dt;
  actor.phase = clamp(actor.distanceTravelled / Math.max(1, actor.maxDistance), 0, 1);
  const remainingTargetSlots = Math.max(0, actor.maxTargets - actor.hitUids.length);
  if (travel > 0 && remainingTargetSlots > 0) {
    const targets = actorLineTargets(
      state,
      { x: actor.previousX, y: actor.previousY },
      { x: actor.x, y: actor.y },
      actor.width,
      remainingTargetSlots,
      actor.hitUids,
    );
    for (const enemy of targets) {
      damageEnemy(state, enemy, actor.damage);
      applyHeroSkillStatus(state, enemy, actor);
      actor.hitUids.push(enemy.uid);
    }
    emitHeroSkillActorTick(state, actor, targets, actor.damage);
  }
  if (actor.distanceTravelled >= actor.maxDistance - 1e-9) actor.done = true;
}

function updateHeroSkillActors(state, dt) {
  if (!Array.isArray(state.heroSkillActors)) state.heroSkillActors = [];
  for (const actor of state.heroSkillActors) {
    if (actor.type === 'beam') {
      const hero = state.hero?.uid === actor.heroUid && state.hero.hp > 0 ? state.hero : null;
      if (!hero) {
        actor.done = true;
        continue;
      }
      if (actor.followHero) {
        actor.originX = hero.x;
        actor.originY = hero.y - 24;
        actor.endX = actor.originX + actor.directionX * actor.length;
        actor.endY = actor.originY + actor.directionY * actor.length;
      }
      updateTimedSkillActor(state, actor, dt, tickBeamActor);
    } else if (actor.type === 'field') {
      updateTimedSkillActor(state, actor, dt, tickFieldActor);
    } else if (actor.type === 'wave') {
      updateWaveActor(state, actor, dt);
    } else {
      actor.done = true;
    }
  }
  state.heroSkillActors = state.heroSkillActors.filter(({ done }) => !done);
}

function syncSquadMembers(tower, definition, { reset = false } = {}) {
  const baseX = Number.isFinite(Number(tower.deployX))
    ? Number(tower.deployX) : Number(tower.x) || 0;
  const baseY = Number.isFinite(Number(tower.deployY))
    ? Number(tower.deployY) : Number(tower.y) || 0;
  const aggregateHp = clamp(
    Number.isFinite(Number(tower.hp)) ? Number(tower.hp) : definition.memberHp * definition.squadSize,
    0,
    definition.memberHp * definition.squadSize,
  );
  const previousMembers = Array.isArray(tower.members) ? tower.members : [];
  const hadCompleteMemberState = previousMembers.length === definition.squadSize
    && previousMembers.every((member) => Number.isFinite(Number(member?.hp)));
  tower.members = SQUAD_MEMBER_OFFSETS.slice(0, definition.squadSize).map(
    (offset, memberIndex) => {
      const source = previousMembers.find((member) => member?.memberIndex === memberIndex)
        || previousMembers[memberIndex] || {};
      const deployX = baseX + offset.x;
      const deployY = baseY + offset.y;
      const hp = clamp(
        Number.isFinite(Number(source.hp)) ? Number(source.hp) : definition.memberHp,
        0,
        definition.memberHp,
      );
      return {
        ...source,
        uid: source.uid || `${tower.uid}:member-${memberIndex + 1}`,
        memberIndex,
        x: Number.isFinite(Number(source.x)) ? Number(source.x) : deployX,
        y: Number.isFinite(Number(source.y)) ? Number(source.y) : deployY,
        deployX,
        deployY,
        facing: source.facing === -1 ? -1 : 1,
        targetId: source.targetId ?? null,
        attackCooldown: Number.isFinite(Number(source.attackCooldown))
          ? Math.max(0, Number(source.attackCooldown))
          : Math.max(0, Number(tower.cooldown) || 0.12) + memberIndex * 0.035,
        hp,
        maxHp: definition.memberHp,
        alive: source.alive !== false && hp > 0,
        moving: Boolean(source.moving),
        downed: source.downed === true || hp <= 0,
        aimAngle: Number.isFinite(Number(source.aimAngle)) ? Number(source.aimAngle) : 0,
        attackPulse: clamp(Number(source.attackPulse) || 0, 0, 1),
        hitPulse: clamp(Number(source.hitPulse) || 0, 0, 1),
      };
    },
  );
  if (reset) {
    tower.members.forEach((member, memberIndex) => {
      const offset = SQUAD_MEMBER_OFFSETS[memberIndex];
      member.x = baseX + offset.x;
      member.y = baseY + offset.y;
      member.deployX = baseX + offset.x;
      member.deployY = baseY + offset.y;
      member.hp = definition.memberHp;
      member.maxHp = definition.memberHp;
      member.alive = true;
      member.downed = false;
      member.targetId = null;
      member.moving = false;
      member.aimAngle = 0;
      member.attackPulse = 0;
      member.hitPulse = 0;
      member.attackCooldown = 0.12 + memberIndex * 0.035;
    });
  } else {
    const memberHpTotal = tower.members.reduce((sum, member) => sum + Math.max(0, member.hp), 0);
    // Old saves only have aggregate squad HP. Honour that value on migration,
    // and also keep older UI/debug callers that still write `tower.hp` working.
    if (!hadCompleteMemberState || Math.abs(memberHpTotal - aggregateHp) > 0.01) {
      let remaining = aggregateHp;
      tower.members.forEach((member) => {
        member.hp = Math.min(definition.memberHp, remaining);
        remaining -= member.hp;
        member.alive = member.hp > 0;
        member.downed = !member.alive;
        if (!member.alive) {
          member.targetId = null;
          member.moving = false;
        }
      });
    }
  }
  tower.hp = tower.members.reduce((sum, member) => sum + Math.max(0, member.hp), 0);
  tower.aliveMembers = tower.members.filter((member) => member.alive && member.hp > 0).length;
  tower.downed = tower.aliveMembers === 0;
  return tower.members;
}

function contactDistanceForEnemy(enemy) {
  const definition = TD_ENEMIES[enemy?.type] || TD_ENEMIES.bug;
  return 38 + definition.size * 0.18;
}

function fireSquadMember(state, tower, member, target, definition) {
  const projectiles = [];
  if (definition.movementMode === 'contact') {
    damageEnemy(state, target, definition.damagePerMember);
    state.effects.push({
      uid: nextUid(state, 'fx'), type: 'hit', age: 0, duration: 0.36,
      x: target.x, y: target.y - 18,
    });
  } else {
    const projectile = {
      uid: nextUid(state, 'shot'), type: definition.projectile, effect: definition.effect || 'direct',
      sourceKind: 'squad', squadType: definition.id, towerType: definition.id,
      star: 1, effectTier: 1, attackMode: definition.attackMode,
      patternProjectileCount: 1, volleyIndex: member.memberIndex, volleyCount: 1,
      secondary: false, damageScale: 1 / definition.squadSize,
      targetUid: target.uid, x: member.x, y: member.y - 24,
      targetX: target.x, targetY: target.y - 18,
      speed: definition.projectileSpeed, damage: definition.damagePerMember, age: 0,
      poisonDps: definition.poisonDps,
      poisonTime: definition.poisonTime,
    };
    projectiles.push(projectile);
    state.projectiles.push(projectile);
  }
  member.attackPulse = 1;
  tower.attackPulse = 1;
  state.events.push({
    type: 'shot', towerUid: tower.uid, soldierUid: member.uid,
    memberIndex: member.memberIndex, towerType: definition.id, squadType: definition.id,
    aliveMembers: tower.aliveMembers, star: 1, effectTier: 1,
    attackMode: definition.attackMode, projectileCount: projectiles.length,
    patternProjectileCount: 1, projectileUids: projectiles.map(({ uid }) => uid),
    targetUid: target.uid, targetUids: [target.uid], damage: definition.damagePerMember,
  });
}

function updateTowers(state, dt) {
  for (const tower of state.towers) {
    ensureTowerHealth(tower, state);
    const definition = SQUAD_TYPES[tower.squadType || tower.type] || SQUAD_TYPES.ranged;
    tower.squadSize = definition.squadSize;
    tower.maxMembers = definition.squadSize;
    tower.memberHp = definition.memberHp;
    const members = syncSquadMembers(tower, definition);
    for (const member of members) {
      member.attackPulse = Math.max(0, member.attackPulse - dt * 5.5);
      member.hitPulse = Math.max(0, member.hitPulse - dt * 6);
    }
    tower.attackPulse = Math.max(0, ...members.map(({ attackPulse }) => attackPulse));
    tower.hitPulse = Math.max(0, ...members.map(({ hitPulse }) => hitPulse));
    if (tower.hp <= 0) continue;
    const liveEnemies = state.enemies.filter((enemy) => enemy.hp > 0);
    const targetLoads = new Map();
    for (const member of members.filter(({ alive }) => alive)) {
      const locked = liveEnemies.find(({ uid }) => uid === member.targetId);
      if (locked) targetLoads.set(locked.uid, (targetLoads.get(locked.uid) || 0) + 1);
      else member.targetId = null;
    }
    for (const member of members.filter(({ alive }) => alive)) {
      member.attackCooldown = Math.max(0, member.attackCooldown - dt);
      member.moving = false;
      let target = liveEnemies.find(({ uid }) => uid === member.targetId && member.hp > 0);
      if (target?.hp <= 0) {
        targetLoads.set(target.uid, Math.max(0, (targetLoads.get(target.uid) || 1) - 1));
        member.targetId = null;
        target = null;
      }
      const availableEnemies = liveEnemies.filter((enemy) => enemy.hp > 0);
      if (!target && availableEnemies.length) {
        target = [...availableEnemies].sort((left, right) => {
          const loadDelta = (targetLoads.get(left.uid) || 0) - (targetLoads.get(right.uid) || 0);
          return loadDelta || distance(member, left) - distance(member, right)
            || String(left.uid).localeCompare(String(right.uid));
        })[0];
        member.targetId = target.uid;
        targetLoads.set(target.uid, (targetLoads.get(target.uid) || 0) + 1);
      }
      if (!target) continue;
      const dx = target.x - member.x;
      const dy = target.y - member.y;
      const separation = Math.hypot(dx, dy);
      member.aimAngle = Math.atan2(dy, dx);
      if (Math.abs(dx) > 1) member.facing = dx < 0 ? -1 : 1;
      const preferredGap = definition.movementMode === 'contact'
        ? contactDistanceForEnemy(target)
        : definition.range * 0.82;
      if (separation > preferredGap && separation > 0.001) {
        const travel = Math.min(
          separation - preferredGap,
          (Number(tower.moveSpeed) || definition.speed) * dt,
        );
        member.x = clamp(member.x + dx / separation * travel, TD_HERO_BOUNDS.minX, TD_HERO_BOUNDS.maxX);
        member.y = clamp(member.y + dy / separation * travel, TD_HERO_BOUNDS.minY, TD_HERO_BOUNDS.maxY);
        member.moving = travel > 0;
      }
      if (member.attackCooldown <= 0 && distance(member, target) <= definition.range) {
        fireSquadMember(state, tower, member, target, definition);
        member.attackCooldown = definition.interval;
      }
    }
    const alive = members.filter(({ alive }) => alive);
    tower.targetUid = alive[0]?.targetId || null;
    tower.facing = alive[0]?.facing || tower.facing || 1;
    tower.aimAngle = alive[0]?.aimAngle || 0;
    tower.moving = alive.some(({ moving }) => moving);
    tower.cooldown = alive.length
      ? Math.min(...alive.map(({ attackCooldown }) => attackCooldown))
      : 0;
    tower.attackPulse = Math.max(0, ...alive.map(({ attackPulse }) => attackPulse));
    tower.hitPulse = Math.max(0, ...alive.map(({ hitPulse }) => hitPulse));
    if (alive.length) {
      tower.x = alive.reduce((sum, member) => sum + member.x, 0) / alive.length;
      tower.y = alive.reduce((sum, member) => sum + member.y, 0) / alive.length;
    }
  }
}

function targetForHero(state, hero, range) {
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const targetDistance = distance(hero, enemy);
    if (targetDistance > range || targetDistance >= bestDistance) continue;
    best = enemy;
    bestDistance = targetDistance;
  }
  return best;
}

function fireHero(state, hero, target) {
  const definition = HERO_TYPES[hero.type] || HERO_TYPES.shell;
  const stats = heroStatsForRank(hero.type, hero.rank);
  const evolution = towerAttackEvolution(hero.type, 1);
  const {
    projectileCount: patternProjectileCount,
    secondaryDamageScale,
    ...effectShape
  } = evolution;
  const projectile = {
    uid: nextUid(state, 'shot'),
    type: definition.projectile,
    effect: definition.effect,
    sourceKind: 'hero',
    heroType: hero.type,
    towerType: hero.type,
    star: 1,
    effectTier: 1,
    ...effectShape,
    patternProjectileCount,
    volleyIndex: 0,
    volleyCount: 1,
    secondary: false,
    damageScale: 1,
    targetUid: target.uid,
    x: hero.x,
    y: hero.y - 30,
    targetX: target.x,
    targetY: target.y - 18,
    speed: definition.projectileSpeed,
    damage: stats.damage,
    poisonMultiplier: stats.multipliers.skillPoison,
    age: 0,
  };
  state.projectiles.push(projectile);
  hero.attackPulse = 1;
  hero.aimAngle = Math.atan2(target.y - hero.y, target.x - hero.x);
  if (Math.abs(hero.moveX) <= 0.01 && Math.abs(target.x - hero.x) > 1) {
    hero.facing = target.x < hero.x ? -1 : 1;
  }
  state.events.push({
    type: 'hero-shot', heroUid: hero.uid, heroType: hero.type,
    projectileUid: projectile.uid, targetUid: target.uid,
  });
}

function updateHero(state, dt) {
  const hero = state.hero;
  if (!hero) return;
  hero.shieldTime = Math.max(0, (Number(hero.shieldTime) || 0) - dt);
  if (hero.shieldTime <= 0) {
    hero.shieldHp = 0;
    hero.shieldMaxHp = 0;
  }
  if (hero.hp <= 0) return;
  const definition = HERO_TYPES[hero.type] || HERO_TYPES.shell;
  const stats = heroStatsForRank(hero.type, hero.rank);
  hero.cooldown -= dt;
  hero.skillCooldown = Math.max(0, hero.skillCooldown - dt);
  hero.attackPulse = Math.max(0, hero.attackPulse - dt * 5.5);
  hero.skillPulse = Math.max(0, hero.skillPulse - dt * 2.5);
  hero.hitPulse = Math.max(0, hero.hitPulse - dt * 6);
  hero.x = clamp(
    hero.x + hero.moveX * definition.speed * dt,
    TD_HERO_BOUNDS.minX,
    TD_HERO_BOUNDS.maxX,
  );
  hero.y = clamp(
    hero.y + hero.moveY * definition.speed * dt,
    TD_HERO_BOUNDS.minY,
    TD_HERO_BOUNDS.maxY,
  );
  if (hero.cooldown > 0) return;
  const target = targetForHero(state, hero, definition.range);
  if (!target) {
    hero.cooldown = Math.min(0.12, hero.cooldown + 0.08);
    return;
  }
  fireHero(state, hero, target);
  hero.cooldown += stats.interval;
}

function updateTurrets(state, dt) {
  for (const turret of state.turrets) {
    const definition = TURRET_TYPES[turret.type] || TURRET_TYPES['gel-mortar'];
    turret.cooldown -= dt;
    turret.attackPulse = Math.max(0, turret.attackPulse - dt * 5.5);
    if (turret.cooldown > 0) continue;
    const target = state.enemies
      .filter((enemy) => enemy.hp > 0 && distance(turret, enemy) <= definition.range)
      .sort((left, right) => right.travelled - left.travelled)[0];
    if (!target) {
      turret.cooldown = Math.min(0.14, turret.cooldown + 0.08);
      continue;
    }
    const projectile = {
      uid: nextUid(state, 'shot'),
      type: definition.projectile,
      effect: definition.effect || 'direct',
      sourceKind: 'turret',
      turretType: turret.type,
      towerType: `turret-${turret.type}`,
      star: 1,
      effectTier: 1,
      attackMode: definition.attackMode || `turret-${definition.effect || 'direct'}`,
      splashRadius: definition.splashRadius,
      splashDamageScale: definition.splashDamageScale,
      areaAllLanes: definition.areaAllLanes ?? definition.effect === 'splash',
      pierceTargets: definition.pierceTargets,
      pierceRadius: definition.pierceRadius,
      pierceDamageScale: definition.pierceDamageScale,
      slowMultiplier: definition.slowMultiplier,
      slowTime: definition.slowTime,
      rewind: definition.rewind,
      chainTargets: definition.chainTargets,
      chainRadius: definition.chainRadius,
      chainPower: definition.chainPower,
      targetUid: target.uid,
      x: turret.x,
      y: turret.y - 22,
      targetX: target.x,
      targetY: target.y - 18,
      speed: definition.projectileSpeed,
      damage: definition.damage,
      age: 0,
    };
    state.projectiles.push(projectile);
    turret.attackPulse = 1;
    turret.aimAngle = Math.atan2(target.y - turret.y, target.x - turret.x);
    turret.cooldown += definition.interval;
    state.events.push({
      type: 'turret-shot', turretUid: turret.uid, turretType: turret.type,
      projectileUid: projectile.uid, targetUid: target.uid,
    });
  }
}

function towerContactTravel(state, enemy, tower) {
  const stage = stageForState(state);
  const lane = stage.lanes[laneIndexForEnemy(state, enemy)];
  const contactOffset = contactDistanceForEnemy(enemy);
  const members = Array.isArray(tower.members)
    ? tower.members.filter((member) => member.alive && member.hp > 0)
    : [towerPosition(state, tower)].filter(Boolean);
  let best = null;
  members.forEach((member, filteredMemberIndex) => {
    const projection = projectPointToPath(lane.path, member);
    const touching = distance(member, enemy) <= contactOffset + 1;
    if (!touching && projection.distance > 46) return;
    if (!touching && projection.travelled < enemy.travelled) return;
    const travelled = touching
      ? enemy.travelled
      : Math.max(0, projection.travelled - contactOffset);
    if (travelled < enemy.travelled - 0.01) return;
    const memberIndex = Number.isInteger(member.memberIndex)
      ? member.memberIndex : filteredMemberIndex;
    if (!best || travelled < best.travelled) best = { travelled, memberIndex };
  });
  return best;
}

function nextBlockingTower(state, enemy) {
  let best = null;
  let bestTravelled = Number.POSITIVE_INFINITY;
  let bestMemberIndex = null;
  for (const tower of state.towers) {
    ensureTowerHealth(tower, state);
    if (tower.hp <= 0) continue;
    const contact = towerContactTravel(state, enemy, tower);
    if (!contact || contact.travelled < enemy.travelled - 0.01) continue;
    if (contact.travelled < bestTravelled) {
      best = tower;
      bestTravelled = contact.travelled;
      bestMemberIndex = contact.memberIndex;
    }
  }
  const hero = state.hero;
  if (hero?.hp > 0) {
    const stage = stageForState(state);
    const laneIndex = laneIndexForEnemy(state, enemy);
    const lane = stage.lanes[laneIndex];
    const enemyDefinition = TD_ENEMIES[enemy.type] || TD_ENEMIES.bug;
    const projection = projectPointToPath(lane.path, hero);
    if (projection.distance <= 42) {
      const contactOffset = 36 + enemyDefinition.size * 0.18;
      const heroTravelled = Math.max(0, projection.travelled - contactOffset);
      if (heroTravelled >= enemy.travelled - 0.01 && heroTravelled < bestTravelled) {
        best = hero;
        bestTravelled = heroTravelled;
        bestMemberIndex = null;
      }
    }
  }
  return best ? { tower: best, travelled: bestTravelled, memberIndex: bestMemberIndex } : null;
}

function damageHero(state, enemy, hero, amount) {
  const incomingDamage = Math.max(0, Number(amount) || 0);
  if (!hero || hero.hp <= 0 || incomingDamage <= 0) return false;
  const shieldBefore = Math.max(0, Number(hero.shieldHp) || 0);
  const absorbed = Math.min(shieldBefore, incomingDamage);
  hero.shieldHp = shieldBefore - absorbed;
  const damage = incomingDamage - absorbed;
  hero.hp = Math.max(0, hero.hp - damage);
  hero.hitPulse = 1;
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'hero-hit', age: 0, duration: 0.42,
    x: hero.x, y: hero.y - 24,
  });
  state.events.push({
    type: 'hero-hit', heroUid: hero.uid, heroType: hero.type,
    enemyUid: enemy.uid, damage, incomingDamage, absorbed,
    hp: hero.hp, maxHp: hero.maxHp, shieldHp: hero.shieldHp,
  });
  if (hero.hp > 0) return false;
  hero.moveX = 0;
  hero.moveY = 0;
  enemy.blockedByTowerUid = null;
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'hero-defeat', age: 0, duration: 0.85,
    x: hero.x, y: hero.y,
  });
  state.events.push({
    type: 'hero-defeat', heroUid: hero.uid, heroType: hero.type,
    enemyUid: enemy.uid, x: hero.x, y: hero.y,
  });
  return true;
}

function damageTower(state, enemy, tower, amount, memberIndex = null) {
  ensureTowerHealth(tower, state);
  const damage = Math.max(0, Number(amount) || 0);
  if (tower.hp <= 0 || damage <= 0) return false;
  const pad = towerPosition(state, tower);
  const definition = SQUAD_TYPES[tower.squadType || tower.type] || SQUAD_TYPES.ranged;
  const members = syncSquadMembers(tower, definition);
  const previousAliveMembers = members.filter((candidate) => (
    candidate.alive && candidate.hp > 0
  )).length;
  const member = Number.isInteger(memberIndex) && members[memberIndex]?.alive
    ? members[memberIndex]
    : members.find((candidate) => candidate.alive && candidate.hp > 0);
  if (member) {
    member.hp = Math.max(0, member.hp - damage);
    member.alive = member.hp > 0;
    member.hitPulse = 1;
    if (!member.alive) {
      member.downed = true;
      member.targetId = null;
      member.moving = false;
    }
  }
  tower.hp = members.reduce((sum, candidate) => sum + Math.max(0, candidate.hp), 0);
  tower.aliveMembers = members.filter((candidate) => candidate.alive && candidate.hp > 0).length;
  tower.hitPulse = 1;
  state.events.push({
    type: 'enemy-attack',
    enemyUid: enemy.uid,
    towerUid: tower.uid,
    soldierUid: member?.uid || null,
    memberIndex: member?.memberIndex ?? null,
    damage,
  });
  state.events.push({
    type: 'tower-hit',
    towerUid: tower.uid,
    towerType: tower.type,
    star: tower.star,
    padIndex: tower.padIndex,
    enemyUid: enemy.uid,
    soldierUid: member?.uid || null,
    memberIndex: member?.memberIndex ?? null,
    damage,
    hp: tower.hp,
    maxHp: tower.maxHp,
    aliveMembers: tower.aliveMembers,
  });
  if (tower.aliveMembers < previousAliveMembers) {
    state.events.push({
      type: 'squad-member-down',
      squadUid: tower.uid,
      squadType: definition.id,
      soldierUid: member?.uid || null,
      memberIndex: member?.memberIndex ?? null,
      x: member?.x ?? pad.x,
      y: member?.y ?? pad.y,
      facing: member?.facing === -1 ? -1 : 1,
      lostMembers: previousAliveMembers - tower.aliveMembers,
      aliveMembers: tower.aliveMembers,
      maxMembers: definition.squadSize,
    });
  }
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'tower-hit', age: 0, duration: 0.42,
    x: member?.x ?? pad.x, y: (member?.y ?? pad.y) - 24,
  });
  if (tower.hp > 0) return false;

  tower.downed = true;
  enemy.blockedByTowerUid = null;
  state.effects.push({
    uid: nextUid(state, 'fx'), type: 'tower-defeat', age: 0, duration: 0.72,
    x: pad.x, y: pad.y,
  });
  state.events.push({
    type: 'tower-defeat',
    towerUid: tower.uid,
    towerType: tower.type,
    star: tower.star,
    padIndex: tower.padIndex,
    enemyUid: enemy.uid,
      x: pad.x,
      y: pad.y,
      facing: tower.facing === -1 ? -1 : 1,
      laneIndex: pad.laneIndex,
  });
  return true;
}

function updateEnemies(state, dt) {
  const stage = stageForState(state);
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const definition = TD_ENEMIES[enemy.type] || TD_ENEMIES.bug;
    const laneIndex = laneIndexForEnemy(state, enemy);
    const lane = stage.lanes[laneIndex];
    const pathLength = pathMetrics(lane.path).total;
    enemy.hitPulse = Math.max(0, enemy.hitPulse - dt * 6);
    if (enemy.poisonTime > 0) {
      enemy.poisonTime -= dt;
      damageEnemy(state, enemy, enemy.poisonDps * dt, { emitHit: false });
    } else {
      enemy.poisonDps = 0;
    }
    if (enemy.hp <= 0) continue;
    if (enemy.slowTime > 0) enemy.slowTime -= dt;
    else enemy.slowMultiplier = 1;

    const nextTravelled = Math.min(
      pathLength,
      enemy.travelled + enemy.speed * enemy.slowMultiplier * dt,
    );
    const blocker = nextBlockingTower(state, enemy);
    if (blocker && nextTravelled >= blocker.travelled) {
      setEnemyTravelled(state, enemy, blocker.travelled);
      enemy.blockedByTowerUid = blocker.tower.uid;
      const attackInterval = Math.max(
        0.2,
        Number(enemy.attackInterval) || definition.attackInterval,
      );
      if (!Number.isFinite(Number(enemy.attackCooldown))) enemy.attackCooldown = attackInterval;
      enemy.attackCooldown -= dt;
      while (enemy.attackCooldown <= 0 && blocker.tower.hp > 0) {
        const attackDamage = Number(enemy.attackDamage) || definition.attackDamage;
        if (blocker.tower.kind === 'hero') {
          damageHero(state, enemy, blocker.tower, attackDamage);
        } else {
          damageTower(state, enemy, blocker.tower, attackDamage, blocker.memberIndex);
        }
        enemy.attackCooldown += attackInterval;
      }
    } else {
      enemy.blockedByTowerUid = null;
      setEnemyTravelled(state, enemy, nextTravelled);
    }

    const point = { x: enemy.x, y: enemy.y };
    if (enemy.travelled >= pathLength) {
      enemy.leaked = true;
      state.waveEnemyResolved = Math.min(
        Math.max(0, Number(state.waveEnemyTotal) || 0),
        Math.max(0, Number(state.waveEnemyResolved) || 0) + 1,
      );
      state.coreHp = Math.max(0, state.coreHp - definition.coreDamage);
      state.effects.push({
        uid: nextUid(state, 'fx'), type: 'core-hit', age: 0, duration: 0.7,
        x: point.x, y: point.y,
      });
      state.events.push({ type: 'core-hit', damage: definition.coreDamage });
    }
  }
  state.enemies = state.enemies.filter((enemy) => enemy.hp > 0 && !enemy.leaked);
}

function finishRun(state, result) {
  state.result = result;
  state.waveActive = false;
  state.phase = 'prep';
  state.spawnQueue = [];
  state.projectiles = [];
  state.heroSkillQueue = [];
  state.heroSkillActors = [];
  state.screen = 'result';
  if (result === 'victory') {
    const stage = stageForState(state);
    if (!state.progress.clearedStages.includes(stage.id)) state.progress.clearedStages.push(stage.id);
    state.progress.unlockedStage = Math.max(
      state.progress.unlockedStage,
      Math.min(TD_STAGES.length, stage.index + 1),
    );
  }
  if (state.mode === 'endless') {
    state.progress.bestEndlessWave = Math.max(state.progress.bestEndlessWave, state.wave);
  }
  const summonReward = state.mode === 'endless'
    ? Math.min(300, 35 + Math.max(0, state.wave) * 8)
    : result === 'victory' ? 120 + stageForState(state).index * 30 : 0;
  if (summonReward > 0) {
    state.progress.summonCurrency = Math.max(
      0,
      Math.floor(Number(state.progress.summonCurrency) || 0) + summonReward,
    );
    state.events.push({
      type: 'summon-currency-reward',
      amount: summonReward,
      total: state.progress.summonCurrency,
      mode: state.mode,
      wave: state.wave,
    });
  }
  state.events.push({ type: 'run-end', result });
}

function completeWave(state) {
  state.waveActive = false;
  state.phase = 'prep';
  state.waveBreak = 0;
  state.currency += 24 + state.wave * 4;
  state.coreHp = Math.min(state.coreMaxHp, state.coreHp + 1);
  for (const tower of state.towers) {
    ensureTowerHealth(tower, state);
    const squadDefinition = SQUAD_TYPES[tower.squadType || tower.type] || SQUAD_TYPES.ranged;
    tower.hp = tower.maxHp;
    tower.aliveMembers = squadDefinition.squadSize;
    tower.downed = false;
    const pad = stageForState(state).pads[tower.padIndex];
    tower.x = Number.isFinite(Number(tower.deployX)) ? tower.deployX : pad.x;
    tower.y = Number.isFinite(Number(tower.deployY)) ? tower.deployY : pad.y;
    tower.moving = false;
    tower.cooldown = Math.min(Number(tower.cooldown) || 0, 0.12);
    syncSquadMembers(tower, squadDefinition, { reset: true });
  }
  if (state.hero) {
    state.hero.hp = state.hero.hp <= 0
      ? Math.round(state.hero.maxHp * 0.75)
      : Math.min(state.hero.maxHp, state.hero.hp + Math.round(state.hero.maxHp * 0.35));
    state.hero.x = state.hero.spawnX;
    state.hero.y = state.hero.spawnY;
    state.hero.moveX = 0;
    state.hero.moveY = 0;
    state.hero.cooldown = 0.12;
    state.hero.skillCooldown = 0;
    state.hero.shieldHp = 0;
    state.hero.shieldMaxHp = 0;
    state.hero.shieldTime = 0;
  }
  state.heroSkillQueue = [];
  state.heroSkillActors = [];
  state.projectiles = [];
  state.events.push({ type: 'wave-clear', wave: state.wave });
  if (state.mode === 'stage' && state.wave >= stageForState(state).waves.length) {
    finishRun(state, 'victory');
  }
}

function updateEffects(state, dt) {
  for (const effect of state.effects) {
    effect.age += dt;
    effect.phase = clamp(effect.age / effect.duration, 0, 1);
    if (effect.type === 'summon') effect.y -= dt * 18;
  }
  state.effects = state.effects.filter((effect) => effect.age < effect.duration);
}

export function updateTowerDefense(state, dt) {
  const delta = clamp(Number(dt) || 0, 0, 0.05);
  if (state.screen !== 'battle' || state.result) {
    state.time += delta;
    updateEffects(state, delta);
    return state;
  }
  state.time += delta;
  updateEffects(state, delta);
  if (state.coreHp <= 0) {
    finishRun(state, 'defeat');
    return state;
  }
  if (!state.waveActive) {
    return state;
  }
  state.waveElapsed += delta;
  while (state.spawnQueue.length && state.spawnQueue[0].at <= state.waveElapsed) {
    const spawn = state.spawnQueue.shift();
    spawnEnemy(state, spawn.type, spawn.laneIndex);
  }
  updateHeroSkillQueue(state, delta);
  updateHeroSkillActors(state, delta);
  updateEnemies(state, delta);
  updateTowers(state, delta);
  updateHero(state, delta);
  updateTurrets(state, delta);
  updateProjectiles(state, delta);
  state.enemies = state.enemies.filter((enemy) => enemy.hp > 0 && !enemy.leaked);
  if (state.coreHp <= 0) {
    finishRun(state, 'defeat');
  } else if (!state.spawnQueue.length && !state.enemies.length) {
    completeWave(state);
  }
  return state;
}

export function skipTowerDefenseBreak(state) {
  if (state.screen !== 'battle' || state.waveActive || state.result) return false;
  state.waveBreak = 0;
  return startNextTowerDefenseWave(state);
}

export function returnToTowerDefenseMenu(state) {
  state.screen = 'menu';
  state.result = null;
  state.waveActive = false;
  state.phase = 'prep';
  state.enemies = [];
  state.projectiles = [];
  state.heroSkillQueue = [];
  state.heroSkillActors = [];
  state.effects = [];
  state.selectedTowerUid = null;
  state.selectedHeroId = state.progress.selectedHero;
  state.heroes = heroRosterForProgress(state.progress);
  state.tutorial.step = state.tutorial.active ? 'stage' : 'done';
  return state;
}

export function replayTowerDefenseRun(state) {
  return beginTowerDefenseRun(state, { mode: state.mode, stageId: state.stageId });
}

export function towerByPad(state, padIndex) {
  return state.towers.find((tower) => tower.padIndex === padIndex) || null;
}

export function tutorialTargetForState(state) {
  if (!state.tutorial.active) return null;
  switch (state.tutorial.step) {
    case 'stage': return Object.freeze({ type: 'stage', stageIndex: 0, label: '1' });
    case 'squad': {
      const openPad = stageForState(state).tutorialPadIndex;
      return Object.freeze({
        type: 'squad', squadType: 'melee', padIndex: openPad, label: '近',
      });
    }
    case 'place-1': {
      const openPad = stageForState(state).pads.findIndex((_, index) => !towerByPad(state, index));
      return Object.freeze({ type: 'pad', padIndex: openPad, label: '放' });
    }
    case 'fuse': return Object.freeze({ type: 'fusion', label: '融' });
    case 'start': return Object.freeze({ type: 'start', label: '战' });
    default: return null;
  }
}

export function serializeTowerDefenseProgress(state) {
  return normalizeTowerDefenseProgress(state?.progress || {});
}

export function towerRange(state, tower) {
  const squadDefinition = SQUAD_TYPES[tower.squadType || tower.type];
  if (squadDefinition) return squadDefinition.range;
  const definition = TOWER_TYPES[tower.type];
  return definition.range * (1 + (tower.star - 1) * 0.035);
}

export function fusionOrbitPoint(effect, timeOffset = 0) {
  const phase = clamp(effect?.phase ?? 0, 0, 1);
  const angle = phase * TAU * 1.8 + timeOffset;
  const radius = (1 - phase) * 44 + 8;
  return {
    x: effect.x + Math.cos(angle) * radius,
    y: effect.y - 24 + Math.sin(angle) * radius * 0.46,
  };
}
