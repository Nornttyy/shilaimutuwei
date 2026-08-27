/**
 * Data-only catalog for the first short expedition.
 *
 * The expedition is intentionally expressed as a five-stage route instead of
 * embedding combat code here. Runtime systems may choose any option from a
 * route-choice stage, resolve its encounter, and bank its rewards for the
 * final settlement screen.
 */

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export const EXPEDITION_RESOURCE_IDS = deepFreeze([
  'soft-gel',
  'dew-honey',
  'crystal-shard',
]);

export const EXPEDITION_PARTY_RULES = deepFreeze({
  size: 3,
  availableSlimeIds: [
    'survivor-shell-shell',
    'survivor-crystal-pin',
    'survivor-bubble-float',
    'survivor-moss-sprout',
  ],
  defaultSlimeIds: [
    'survivor-shell-shell',
    'survivor-crystal-pin',
    'survivor-moss-sprout',
  ],
  duplicateSlimesAllowed: false,
  downedRule: 'revive-after-node-at-35-percent-hp',
});

/**
 * These are the three readable decisions shown at every fork. Concrete route
 * options below can change enemies and rewards while preserving this promise.
 */
export const EXPEDITION_ROUTE_NODE_TYPES = deepFreeze([
  {
    id: 'route-swarm-battle',
    kind: 'combat',
    name: '追击虫群',
    shortName: '战斗',
    description: '敌人最多、软晶较多；适合已经成形的攻击组合。',
    rewardFocus: 'soft-crystals',
    danger: 2,
  },
  {
    id: 'route-resource-forage',
    kind: 'resource',
    name: '采集富集地',
    shortName: '采集',
    description: '清理一小群守卫后带回较多基地资源。',
    rewardFocus: 'base-resources',
    danger: 1,
  },
  {
    id: 'route-slime-event',
    kind: 'event',
    name: '回应求救声',
    shortName: '事件',
    description: '作出一次风险选择，可能治疗全队或触发伏击。',
    rewardFocus: 'healing-and-upgrades',
    danger: 1,
  },
]);

export const EXPEDITION_ROUTE_NODE_TYPE_BY_ID = deepFreeze(
  Object.fromEntries(EXPEDITION_ROUTE_NODE_TYPES.map((type) => [type.id, type])),
);

export const EXPEDITION_UPGRADES = deepFreeze([
  {
    id: 'upgrade-soft-body',
    name: '软体增生',
    rarity: 'common',
    target: 'party',
    maxStacks: 3,
    tags: ['survival'],
    modifiers: { maxHpMultiplier: 1.15, currentHpHealPercent: 0.15 },
  },
  {
    id: 'upgrade-jelly-rush',
    name: '果冻冲劲',
    rarity: 'common',
    target: 'party',
    maxStacks: 3,
    tags: ['attack', 'speed'],
    modifiers: { attackIntervalMultiplier: 0.88 },
  },
  {
    id: 'upgrade-shared-sparkle',
    name: '共享亮晶',
    rarity: 'common',
    target: 'party',
    maxStacks: 3,
    tags: ['attack'],
    modifiers: { attackDamageMultiplier: 1.18 },
  },
  {
    id: 'upgrade-shell-rebound',
    name: '壳甲回弹',
    rarity: 'common',
    target: 'survivor-shell-shell',
    maxStacks: 2,
    tags: ['survival', 'control'],
    modifiers: { shieldMultiplier: 1.3, shieldBreakDamage: 22 },
  },
  {
    id: 'upgrade-crystal-fork',
    name: '分叉晶针',
    rarity: 'common',
    target: 'survivor-crystal-pin',
    maxStacks: 2,
    tags: ['attack', 'projectile'],
    modifiers: { extraProjectile: 1, secondaryProjectileDamageMultiplier: 0.55 },
  },
  {
    id: 'upgrade-bubble-chain',
    name: '连环泡泡',
    rarity: 'common',
    target: 'survivor-bubble-float',
    maxStacks: 2,
    tags: ['control', 'area'],
    modifiers: { bubbleChainTargets: 2, chainedDamageMultiplier: 0.65 },
  },
  {
    id: 'upgrade-sprout-canopy',
    name: '萌芽伞盖',
    rarity: 'common',
    target: 'survivor-moss-sprout',
    maxStacks: 2,
    tags: ['healing', 'survival'],
    modifiers: { healMultiplier: 1.3, healSplashPercent: 0.35 },
  },
  {
    id: 'upgrade-gel-burst',
    name: '软胶爆花',
    rarity: 'advanced',
    target: 'party',
    maxStacks: 1,
    tags: ['attack', 'area'],
    modifiers: { defeatedEnemyBurstDamage: 18, burstRadiusTiles: 1.25 },
  },
  {
    id: 'upgrade-last-bounce',
    name: '最后一弹',
    rarity: 'advanced',
    target: 'party',
    maxStacks: 1,
    tags: ['survival'],
    modifiers: { lethalProtectionHits: 1, protectionHealPercent: 0.25 },
  },
]);

export const EXPEDITION_UPGRADE_BY_ID = deepFreeze(
  Object.fromEntries(EXPEDITION_UPGRADES.map((upgrade) => [upgrade.id, upgrade])),
);

/**
 * Compact boon view consumed by the expedition state machine. The full
 * upgrade entries above remain available to UI and combat presentation code.
 */
export const EXPEDITION_BOONS = deepFreeze(EXPEDITION_UPGRADES.map((upgrade) => ({
  id: upgrade.id,
  weight: upgrade.rarity === 'advanced' ? 2 : 6,
  modifiers: upgrade.modifiers,
})));

export const EXPEDITION_UPGRADE_DRAFT = deepFreeze({
  choices: 3,
  picks: 1,
  timing: 'after-combat-victory',
  poolIds: EXPEDITION_UPGRADES.map(({ id }) => id),
  excludeMaxedUpgrades: true,
  requireAtLeastOnePartyCompatibleChoice: true,
  finalBossConversion: {
    // The boss still resolves its three-choice draft, but the selected upgrade
    // is converted to a settlement bonus because no later battle remains.
    kind: 'settlement-bonus',
    softCrystals: 3,
  },
});

const weakSwarmTuning = deepFreeze({
  enemyHpMultiplier: 0.5,
  enemyDamageMultiplier: 0.45,
  enemyRewardMultiplier: 0,
  maxActiveEnemies: 18,
});

const bossTuning = deepFreeze({
  enemyHpMultiplier: 0.62,
  enemyDamageMultiplier: 0.55,
  enemyRewardMultiplier: 0,
  maxActiveEnemies: 16,
});

const draft = () => ({
  ...EXPEDITION_UPGRADE_DRAFT,
  poolIds: [...EXPEDITION_UPGRADE_DRAFT.poolIds],
  finalBossConversion: { ...EXPEDITION_UPGRADE_DRAFT.finalBossConversion },
});

const combat = ({ durationSeconds, groups, boss = false }) => ({
  kind: boss ? 'boss-combat' : 'combat',
  estimatedDurationSeconds: durationSeconds,
  tuning: boss ? bossTuning : weakSwarmTuning,
  groups,
  upgradeDraft: draft(),
});

const reward = (resources, softCrystals) => ({ resources, softCrystals });

/**
 * Every fork offers one option of each node type. Event options deliberately
 * include a possible battle so the runtime can reuse the normal encounter and
 * upgrade-draft flow without making the event outcome deterministic.
 */
export const EXPEDITION_ROUTE_OPTIONS = deepFreeze([
  {
    id: 'route-1-swarm',
    forkId: 'fork-1',
    nodeTypeId: 'route-swarm-battle',
    name: '泡风虫道',
    estimatedDurationSeconds: 38,
    encounter: combat({
      durationSeconds: 38,
      groups: [
        { enemyId: 'enemy-soft-biter', count: 12, spawnIntervalSeconds: 0.55 },
        { enemyId: 'enemy-windcap', count: 7, startDelaySeconds: 5, spawnIntervalSeconds: 0.65 },
      ],
    }),
    reward: reward({ 'soft-gel': 3 }, 6),
  },
  {
    id: 'route-1-forage',
    forkId: 'fork-1',
    nodeTypeId: 'route-resource-forage',
    name: '露蜜浅滩',
    estimatedDurationSeconds: 30,
    encounter: combat({
      durationSeconds: 24,
      groups: [
        { enemyId: 'enemy-soft-biter', count: 9, spawnIntervalSeconds: 0.7 },
      ],
    }),
    reward: reward({ 'soft-gel': 3, 'dew-honey': 5 }, 2),
  },
  {
    id: 'route-1-event',
    forkId: 'fork-1',
    nodeTypeId: 'route-slime-event',
    name: '摇晃的果冻箱',
    estimatedDurationSeconds: 28,
    event: {
      id: 'event-jelly-crate',
      choices: [
        { id: 'open-carefully', name: '小心打开', effect: { healPartyPercent: 0.2 }, reward: reward({ 'soft-gel': 2 }, 2) },
        { id: 'bounce-it-open', name: '弹开箱盖', effect: { randomUpgrade: 1 }, reward: reward({}, 0) },
      ],
      ambushChance: 0.45,
      ambush: combat({
        durationSeconds: 22,
        groups: [{ enemyId: 'enemy-windcap', count: 10, spawnIntervalSeconds: 0.5 }],
      }),
    },
    reward: reward({ 'dew-honey': 2 }, 3),
  },
  {
    id: 'route-2-swarm',
    forkId: 'fork-2',
    nodeTypeId: 'route-swarm-battle',
    name: '石壳围谷',
    estimatedDurationSeconds: 45,
    encounter: combat({
      durationSeconds: 45,
      groups: [
        { enemyId: 'enemy-soft-biter', count: 14, spawnIntervalSeconds: 0.5 },
        { enemyId: 'enemy-stone-lump', count: 3, startDelaySeconds: 8, spawnIntervalSeconds: 3.2 },
      ],
    }),
    reward: reward({ 'crystal-shard': 2 }, 8),
  },
  {
    id: 'route-2-forage',
    forkId: 'fork-2',
    nodeTypeId: 'route-resource-forage',
    name: '晶屑裂谷',
    estimatedDurationSeconds: 35,
    encounter: combat({
      durationSeconds: 28,
      groups: [
        { enemyId: 'enemy-soft-biter', count: 10, spawnIntervalSeconds: 0.6 },
        { enemyId: 'enemy-stone-lump', count: 2, startDelaySeconds: 6, spawnIntervalSeconds: 3 },
      ],
    }),
    reward: reward({ 'soft-gel': 2, 'crystal-shard': 5 }, 3),
  },
  {
    id: 'route-2-event',
    forkId: 'fork-2',
    nodeTypeId: 'route-slime-event',
    name: '迷路的小软壳虫',
    estimatedDurationSeconds: 30,
    event: {
      id: 'event-lost-biter',
      choices: [
        { id: 'feed-it', name: '喂它露蜜', cost: { resources: { 'dew-honey': 1 } }, effect: { healPartyPercent: 0.35 }, reward: reward({}, 4) },
        { id: 'follow-it', name: '跟着它走', effect: { nextBossMinionCountMultiplier: 0.7 }, reward: reward({ 'crystal-shard': 2 }, 1) },
      ],
      ambushChance: 0.35,
      ambush: combat({
        durationSeconds: 24,
        groups: [
          { enemyId: 'enemy-soft-biter', count: 8, spawnIntervalSeconds: 0.55 },
          { enemyId: 'enemy-windcap', count: 6, startDelaySeconds: 3, spawnIntervalSeconds: 0.6 },
        ],
      }),
    },
    reward: reward({ 'soft-gel': 2 }, 4),
  },
]);

export const EXPEDITION_ROUTE_OPTION_BY_ID = deepFreeze(
  Object.fromEntries(EXPEDITION_ROUTE_OPTIONS.map((option) => [option.id, option])),
);

/**
 * Weighted encounter view for deterministic route generation. `power` is a
 * relative director cost, not an enemy stat multiplier; actual weakening is
 * kept in `tuning` so the first run can show large crowds without spikes.
 */
export const EXPEDITION_ENCOUNTERS = deepFreeze([
  {
    id: 'encounter-soft-biter-rush',
    kind: 'battle',
    weight: 7,
    minStep: 1,
    maxStep: 4,
    power: 0.75,
    reward: reward({ 'soft-gel': 3 }, 2),
    tuning: weakSwarmTuning,
    groups: [
      { enemyId: 'enemy-soft-biter', count: 14, spawnIntervalSeconds: 0.52 },
    ],
  },
  {
    id: 'encounter-windcap-crossing',
    kind: 'battle',
    weight: 6,
    minStep: 1,
    maxStep: 4,
    power: 0.9,
    reward: reward({ 'dew-honey': 2 }, 3),
    tuning: weakSwarmTuning,
    groups: [
      { enemyId: 'enemy-soft-biter', count: 8, spawnIntervalSeconds: 0.6 },
      { enemyId: 'enemy-windcap', count: 8, startDelaySeconds: 4, spawnIntervalSeconds: 0.58 },
    ],
  },
  {
    id: 'encounter-stone-escort',
    kind: 'elite',
    weight: 3,
    minStep: 2,
    maxStep: 4,
    power: 1.2,
    reward: reward({ 'soft-gel': 2, 'crystal-shard': 3 }, 5),
    tuning: weakSwarmTuning,
    groups: [
      { enemyId: 'enemy-soft-biter', count: 12, spawnIntervalSeconds: 0.5 },
      { enemyId: 'enemy-stone-lump', count: 3, startDelaySeconds: 7, spawnIntervalSeconds: 3 },
    ],
  },
  {
    id: 'encounter-acid-shell-king',
    kind: 'boss',
    weight: 1,
    minStep: 5,
    maxStep: 5,
    power: 1.8,
    reward: reward({ 'crystal-shard': 3 }, 10),
    tuning: bossTuning,
    groups: [
      { enemyId: 'enemy-soft-biter', count: 12, spawnIntervalSeconds: 0.65 },
      { enemyId: 'enemy-windcap', count: 6, startDelaySeconds: 8, spawnIntervalSeconds: 0.75 },
      { enemyId: 'enemy-acid-shell-king', count: 1, startDelaySeconds: 14, spawnIntervalSeconds: 0, isBoss: true },
    ],
  },
]);

export const EXPEDITION_ENCOUNTER_BY_ID = deepFreeze(
  Object.fromEntries(EXPEDITION_ENCOUNTERS.map((encounter) => [encounter.id, encounter])),
);

export const FIRST_EXPEDITION = deepFreeze({
  id: 'expedition-dewpath-01',
  name: '露径初探',
  description: '带三只史莱姆穿过露蜜草径，在酸壳蜗王筑巢前夺回采集地。',
  recommendedPower: 100,
  duration: {
    minSeconds: 180,
    targetSeconds: 240,
    maxSeconds: 300,
  },
  party: EXPEDITION_PARTY_RULES,
  route: {
    regularSteps: 4,
    choicesPerStep: 3,
    bossStep: 5,
    nodeTypeIds: EXPEDITION_ROUTE_NODE_TYPES.map(({ id }) => id),
  },
  encounters: EXPEDITION_ENCOUNTERS,
  boons: EXPEDITION_BOONS,
  rules: {
    movement: 'automatic',
    combat: 'automatic',
    routeChoice: 'player',
    upgradeChoice: 'player',
    pauseDuringChoices: true,
    normalBattleTuning: weakSwarmTuning,
  },
  stages: [
    {
      id: 'stage-1-meadow-ambush',
      index: 1,
      kind: 'combat',
      name: '草径虫潮',
      encounter: combat({
        durationSeconds: 36,
        groups: [
          { enemyId: 'enemy-soft-biter', count: 12, spawnIntervalSeconds: 0.55 },
          { enemyId: 'enemy-windcap', count: 5, startDelaySeconds: 5, spawnIntervalSeconds: 0.7 },
        ],
      }),
      reward: reward({ 'soft-gel': 3 }, 2),
    },
    {
      id: 'stage-2-fork',
      index: 2,
      kind: 'route-choice',
      name: '露水岔路',
      optionIds: ['route-1-swarm', 'route-1-forage', 'route-1-event'],
    },
    {
      id: 'stage-3-bog-swarm',
      index: 3,
      kind: 'combat',
      name: '泡泡沼口',
      encounter: combat({
        durationSeconds: 44,
        groups: [
          { enemyId: 'enemy-soft-biter', count: 14, spawnIntervalSeconds: 0.48 },
          { enemyId: 'enemy-windcap', count: 8, startDelaySeconds: 6, spawnIntervalSeconds: 0.58 },
        ],
      }),
      reward: reward({ 'dew-honey': 2 }, 3),
    },
    {
      id: 'stage-4-fork',
      index: 4,
      kind: 'route-choice',
      name: '壳纹岔路',
      optionIds: ['route-2-swarm', 'route-2-forage', 'route-2-event'],
    },
    {
      id: 'stage-5-acid-shell-king',
      index: 5,
      kind: 'boss',
      name: '酸壳蜗王',
      encounter: combat({
        durationSeconds: 72,
        boss: true,
        groups: [
          { enemyId: 'enemy-soft-biter', count: 12, spawnIntervalSeconds: 0.65 },
          { enemyId: 'enemy-windcap', count: 6, startDelaySeconds: 8, spawnIntervalSeconds: 0.75 },
          { enemyId: 'enemy-acid-shell-king', count: 1, startDelaySeconds: 14, spawnIntervalSeconds: 0, isBoss: true },
        ],
      }),
      boss: {
        enemyId: 'enemy-acid-shell-king',
        clearCondition: 'defeat-boss',
        telegraphAbility: 'acid-volley',
        phaseThresholds: [0.66, 0.33],
      },
      reward: reward({ 'crystal-shard': 3 }, 10),
    },
  ],
  settlement: {
    delivery: 'after-run',
    completionBonus: reward(
      { 'soft-gel': 4, 'dew-honey': 2, 'crystal-shard': 1 },
      8,
    ),
    firstClearBonus: reward(
      { 'soft-gel': 6, 'dew-honey': 3, 'crystal-shard': 2 },
      12,
    ),
    retention: {
      victory: { resourcesMultiplier: 1, softCrystalsMultiplier: 1 },
      defeat: { resourcesMultiplier: 0.5, softCrystalsMultiplier: 0.5 },
      abandon: { resourcesMultiplier: 0.25, softCrystalsMultiplier: 0.25 },
    },
  },
  rewards: {
    victoryBonus: reward(
      { 'soft-gel': 4, 'dew-honey': 2, 'crystal-shard': 1 },
      8,
    ),
    defeatKeepRatio: 0.5,
    abandonKeepRatio: 0.25,
  },
});

export const EXPEDITIONS = deepFreeze([FIRST_EXPEDITION]);

export const EXPEDITION_BY_ID = deepFreeze(
  Object.fromEntries(EXPEDITIONS.map((expedition) => [expedition.id, expedition])),
);

export const EXPEDITION_CATALOG = deepFreeze({
  resourceIds: EXPEDITION_RESOURCE_IDS,
  partyRules: EXPEDITION_PARTY_RULES,
  routeNodeTypes: EXPEDITION_ROUTE_NODE_TYPES,
  routeNodeTypeById: EXPEDITION_ROUTE_NODE_TYPE_BY_ID,
  routeOptions: EXPEDITION_ROUTE_OPTIONS,
  routeOptionById: EXPEDITION_ROUTE_OPTION_BY_ID,
  upgrades: EXPEDITION_UPGRADES,
  upgradeById: EXPEDITION_UPGRADE_BY_ID,
  boons: EXPEDITION_BOONS,
  upgradeDraft: EXPEDITION_UPGRADE_DRAFT,
  encounters: EXPEDITION_ENCOUNTERS,
  encounterById: EXPEDITION_ENCOUNTER_BY_ID,
  expeditions: EXPEDITIONS,
  expeditionById: EXPEDITION_BY_ID,
});
