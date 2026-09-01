import {
  drawAtlasCharacter,
  drawAssetOrFallback,
  drawBuilding,
  drawCore,
  drawLayeredTurret,
  drawMonster,
  drawParticle,
  drawPortal,
  drawProjectile,
  drawSlime,
  drawSoldier,
} from './draw.js';
import { AnimationController } from './animation/controller.js';
import { ExpressionMixer } from './animation/expression-mixer.js';
import {
  BOSS_CLIPS,
  BUBBLE_CLIPS,
  BUG_CLIPS,
  CRYSTAL_CLIPS,
  SHELL_CLIPS,
  SOLDIER_CLIPS,
  SPROUT_CLIPS,
  STONE_CLIPS,
  WINDCAP_CLIPS,
} from './animation/clips.js';
import { SOLDIER_RIG } from './animation/rigs.js';
import { createTowerDefenseAudio } from './tower-defense-audio.js';
import {
  HERO_TYPES,
  SQUAD_TYPES,
  TURRET_TYPES,
  TD_ENEMIES,
  TD_MAX_STAR,
  TD_STAGE_BY_ID,
  TD_STAGES,
  TD_STORAGE_KEY,
  TD_VIEW,
  TOWER_TYPES,
  beginTowerDefenseRun,
  canMergeCardIntoTower,
  canMergeTowers,
  createTowerDefenseState,
  drawCostForState,
  drawTowerCard,
  fusionOrbitPoint,
  heroStatsForRank,
  mergeCardIntoTower,
  mergeTowers,
  moveTowerToPad,
  normalizeTowerDefenseProgress,
  placeTowerFromHand,
  replayTowerDefenseRun,
  reclaimTowerToHand,
  returnToTowerDefenseMenu,
  serializeTowerDefenseProgress,
  skipTowerDefenseBreak,
  stageForState,
  startNextTowerDefenseWave,
  setTowerDefenseHeroMovement,
  activateTowerDefenseHeroSkill,
  buyTowerDefenseSquad,
  buildTowerDefenseTurret,
  selectTowerDefenseHero,
  towerAttackEvolution,
  towerByPad,
  towerRange,
  tutorialTargetForState,
  updateTowerDefense,
  summonTowerDefenseContracts,
} from './tower-defense-core.js';

const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
const TAU = Math.PI * 2;
const MAX_DPR = 2;
const PAD_RADIUS = 38;
const DRAG_THRESHOLD = 12;
const LONG_PRESS_MOVE_MS = 450;
const LONG_PRESS_DRIFT = 18;
const SQUAD_MEMBER_RENDER_SIZE = 52;
const SQUAD_MEMBER_DEFEAT_SIZE = 52;
const SQUAD_PURCHASE_PREVIEW_SIZE = 44;
const SQUAD_GRID_RENDER_Y_OFFSET = 16;
const SUMMON_ENERGY_DURATION = 0.72;
const SUMMON_RIFT_DURATION = 0.78;
const SUMMON_REVEAL_CARD_DURATION = 0.5;
const SUMMON_REVEAL_STAGGER = 0.075;
const BATTLE_FIELD = Object.freeze({ top: 96, bottom: 1088, left: 0, right: TD_VIEW.width });
const FALLBACK_LANE_X = Object.freeze([88, 224, 360, 496, 632]);
const DEPLOY_GRID_ROWS = Object.freeze([270, 360, 450, 540, 630, 720, 810]);
const DEPLOY_CELL_SIZE = Object.freeze({ width: 136, height: 90 });
const DEPLOY_HIGHLIGHT_SIZE = Object.freeze({ width: 120, height: 80 });

const COMMAND_DOCK = Object.freeze({
  back: Object.freeze({ x: 12, y: 18, width: 48, height: 56 }),
  currency: Object.freeze({ x: 72, y: 18, width: 138, height: 56 }),
  core: Object.freeze({ x: 222, y: 22, width: 132, height: 48 }),
  wave: Object.freeze({ x: 366, y: 24, width: 214, height: 44 }),
  enemies: Object.freeze({ x: 592, y: 18, width: 116, height: 56 }),
  mode: Object.freeze({ x: 484, y: 71, width: 96, height: 20 }),
  refresh: Object.freeze({ x: 12, y: 1104, width: 156, height: 164 }),
  shop: Object.freeze([
    Object.freeze({ x: 12, y: 1104, width: 156, height: 164 }),
    Object.freeze({ x: 180, y: 1104, width: 156, height: 164 }),
    Object.freeze({ x: 348, y: 1104, width: 156, height: 164 }),
  ]),
  handZone: Object.freeze({ x: 12, y: 1104, width: 492, height: 164 }),
  purchaseTabs: Object.freeze({
    squad: Object.freeze({ x: 8, y: 1104, width: 240, height: 40 }),
    turret: Object.freeze({ x: 256, y: 1104, width: 240, height: 40 }),
  }),
  purchaseTrack: Object.freeze({ x: 8, y: 1150, width: 488, height: 118 }),
  cards: Object.freeze([
    Object.freeze({ x: 12, y: 1104, width: 114, height: 164 }),
    Object.freeze({ x: 132, y: 1104, width: 114, height: 164 }),
    Object.freeze({ x: 252, y: 1104, width: 114, height: 164 }),
    Object.freeze({ x: 372, y: 1104, width: 114, height: 164 }),
  ]),
  draw: Object.freeze({ x: 12, y: 1104, width: 156, height: 164 }),
  reclaim: Object.freeze({ x: 512, y: 1104, width: 84, height: 72 }),
  selection: Object.freeze({ x: 512, y: 1184, width: 196, height: 84 }),
  start: Object.freeze({ x: 512, y: 1104, width: 196, height: 164 }),
});

const MENU_ACTIONS = Object.freeze({
  story: Object.freeze({ x: 48, y: 898, width: 624, height: 108 }),
  endless: Object.freeze({ x: 48, y: 1026, width: 230, height: 98 }),
  roster: Object.freeze({ x: 290, y: 1026, width: 178, height: 98 }),
  summon: Object.freeze({ x: 480, y: 1026, width: 192, height: 98 }),
});
const AUDIO_TOGGLE_RECT = Object.freeze({ x: 658, y: 100, width: 46, height: 46 });

const SUMMON_BACK_RECT = Object.freeze({ x: 22, y: 28, width: 104, height: 58 });
const SUMMON_CURRENCY_RECT = Object.freeze({ x: 490, y: 28, width: 208, height: 62 });
const ROSTER_BACK_RECT = Object.freeze({ x: 22, y: 28, width: 104, height: 58 });
const ROSTER_PAGE_SIZE = 8;
const ROSTER_HERO_GRID = Object.freeze({
  x: 24, y: 152, columns: 4, rows: 2, width: 159, height: 146, gapX: 12, gapY: 12,
});
const ROSTER_PREVIOUS_RECT = Object.freeze({ x: 222, y: 468, width: 72, height: 44 });
const ROSTER_NEXT_RECT = Object.freeze({ x: 426, y: 468, width: 72, height: 44 });
const ROSTER_DETAIL_RECT = Object.freeze({ x: 32, y: 526, width: 656, height: 690 });
const ROSTER_DEPLOY_RECT = Object.freeze({ x: 398, y: 1114, width: 252, height: 72 });
const SUMMON_ONE_RECT = Object.freeze({ x: 54, y: 1018, width: 286, height: 104 });
const SUMMON_TEN_RECT = Object.freeze({ x: 380, y: 1018, width: 286, height: 104 });
const SUMMON_RESULT_CLOSE_RECT = Object.freeze({ x: 210, y: 1158, width: 300, height: 72 });
const SUMMON_SKIP_RECT = Object.freeze({ x: 570, y: 34, width: 118, height: 56 });
const HERO_JOYSTICK = Object.freeze({
  x: 102, y: 1190, radius: 64,
  hit: Object.freeze({ x: 30, y: 1118, width: 144, height: 144 }),
});
const HERO_SKILL_RECT = Object.freeze({ x: 578, y: 1132, width: 116, height: 116 });
const GEL_MORTAR_ASSET_LAYOUT = Object.freeze({
  assetWidthScale: 768 / 723,
  assetGroundAnchorY: 665 / 723,
});
const FORTRESS_CORE_ASSET_LAYOUT = Object.freeze({
  assetWidthScale: 768 / 512,
});
const SKILL_RENDER_LIMITS = Object.freeze({
  actors: 8,
  impacts: 12,
  motes: 36,
  projectileTrails: 18,
  components: 24,
});
const SKILL_COMPONENT_ASSETS = Object.freeze({
  shellImpact: 'effect-skill-shell-impact-v1',
  crystalLaserEmitter: 'effect-skill-crystal-laser-emitter-v1',
  crystalLaserHit: 'effect-skill-crystal-laser-hit-v1',
  bubbleOrb: 'effect-skill-bubble-orb-v1',
  bubbleBurst: 'effect-skill-bubble-burst-v1',
  sproutThorn: 'effect-skill-sprout-thorn-v1',
  berryBomb: 'effect-skill-berry-bomb-v1',
  berryBurst: 'effect-skill-berry-burst-v1',
  dewWaveCrest: 'effect-skill-dew-wave-crest-v1',
  bellSonicRing: 'skill-bell-sonic-ring-icon',
  drillRupture: 'skill-drill-rupture-dash-icon',
  emberScorch: 'skill-ember-scorch-line-icon',
  inkCone: 'skill-ink-cone-burst-icon',
  cloudVortex: 'skill-cloud-vortex-icon',
  frostShard: 'skill-frost-shard-lane-icon',
  honeyCluster: 'skill-honey-cluster-icon',
  sparkChain: 'skill-spark-chain-arc-icon',
  starOrbit: 'skill-star-orbit-barrage-icon',
});
const EXPANDED_SKILL_COMPONENT_BY_TYPE = Object.freeze({
  bell: SKILL_COMPONENT_ASSETS.bellSonicRing,
  drill: SKILL_COMPONENT_ASSETS.drillRupture,
  ember: SKILL_COMPONENT_ASSETS.emberScorch,
  ink: SKILL_COMPONENT_ASSETS.inkCone,
  cloud: SKILL_COMPONENT_ASSETS.cloudVortex,
  frost: SKILL_COMPONENT_ASSETS.frostShard,
  honey: SKILL_COMPONENT_ASSETS.honeyCluster,
  spark: SKILL_COMPONENT_ASSETS.sparkChain,
  star: SKILL_COMPONENT_ASSETS.starOrbit,
});
const REINFORCEMENT_PROJECTILE_ATLAS_KEY = 'effect-reinforcement-projectiles-atlas-v1';
const REINFORCEMENT_PROJECTILE_SOURCE_SIZE = Object.freeze({ width: 768, height: 512 });
const REINFORCEMENT_PROJECTILE_STYLE = Object.freeze({
  spore: Object.freeze({ column: 0, row: 0, width: 54, height: 36, spinRate: 1.35 }),
  gale: Object.freeze({ column: 1, row: 0, width: 62, height: 41, spinRate: 6.4 }),
  volt: Object.freeze({ column: 0, row: 1, width: 56, height: 37, spinRate: -4.8 }),
  thunder: Object.freeze({ column: 1, row: 1, width: 66, height: 44, spinRate: 0.42 }),
});
const REINFORCEMENT_PROJECTILE_BY_SQUAD = Object.freeze({
  'spore-lobber': 'spore',
  'volt-orbiter': 'volt',
});
const REINFORCEMENT_PROJECTILE_BY_TURRET = Object.freeze({
  'spore-bomber': 'spore',
  'gale-fan': 'gale',
  'thunder-prism': 'thunder',
});
const REINFORCEMENT_PROJECTILE_BY_ENEMY = Object.freeze({
  lantern: 'spore',
  'rift-boss': 'thunder',
});
const SKILL_VISUAL_STYLE = Object.freeze({
  shell: Object.freeze({ color: '#51D9A2', light: '#DFFFF0', deep: '#197B64' }),
  needle: Object.freeze({ color: '#7D80F5', light: '#E7F9FF', deep: '#3948A9' }),
  bubble: Object.freeze({ color: '#4CCFE9', light: '#E0FCFF', deep: '#237FA9' }),
  sprout: Object.freeze({ color: '#7CDA5A', light: '#EFFFAC', deep: '#367E3C' }),
  berry: Object.freeze({ color: '#F06D88', light: '#FFF0B8', deep: '#A8325B' }),
  dew: Object.freeze({ color: '#58D9D0', light: '#E8FFFF', deep: '#247F86' }),
  bell: Object.freeze({ color: '#F0B84D', light: '#FFF3B7', deep: '#9A5A23' }),
  drill: Object.freeze({ color: '#E68A5B', light: '#FFE1BD', deep: '#91472D' }),
  ember: Object.freeze({ color: '#F0694D', light: '#FFF0A8', deep: '#A8342E' }),
  ink: Object.freeze({ color: '#6F6BD7', light: '#EAE5FF', deep: '#38347F' }),
  cloud: Object.freeze({ color: '#80D6D3', light: '#ECFFFF', deep: '#347D8A' }),
  frost: Object.freeze({ color: '#70BCEF', light: '#F0FCFF', deep: '#3568A5' }),
  honey: Object.freeze({ color: '#F0B941', light: '#FFF3AF', deep: '#9D6722' }),
  spark: Object.freeze({ color: '#F2D94F', light: '#FFFBD1', deep: '#8D7322' }),
  star: Object.freeze({ color: '#9D83F2', light: '#F3ECFF', deep: '#59449F' }),
});
const GEL_MOUNT_ASSET_LAYOUT = Object.freeze({
  width: 118,
  height: 118 * 400 / 768,
});

const STAGE_SELECT_PAGE_SIZE = 6;
const STAGE_SELECT_CARDS = Object.freeze(Array.from({ length: STAGE_SELECT_PAGE_SIZE }, (_, index) => Object.freeze({
  x: 28 + (index % 2) * 346,
  y: 152 + Math.floor(index / 2) * 326,
  width: 318,
  height: 302,
})));
const STAGE_SELECT_BACK = Object.freeze({ x: 22, y: 28, width: 104, height: 58 });
const STAGE_SELECT_PREVIOUS = Object.freeze({ x: 222, y: 1140, width: 96, height: 58 });
const STAGE_SELECT_NEXT = Object.freeze({ x: 402, y: 1140, width: 96, height: 58 });

const COLORS = Object.freeze({
  ink: '#273844',
  inkSoft: '#5E7078',
  cream: '#FFF8E9',
  creamDeep: '#F0E2C5',
  white: '#FFFFFF',
  mint: '#64D3A0',
  mintDeep: '#27866B',
  blue: '#69CFE8',
  crystal: '#8878DB',
  coral: '#E36B72',
  gold: '#E5A93F',
  shadow: 'rgba(30, 48, 58, 0.24)',
  disabled: '#A8B0AD',
});

const RARITY_STYLE = Object.freeze({
  R: Object.freeze({ label: 'R', color: '#69C995', deep: '#236D51', fill: '#E9FFF1' }),
  SR: Object.freeze({ label: 'SR', color: '#55C8F0', deep: '#246F98', fill: '#E7F8FF' }),
  SSR: Object.freeze({ label: 'SSR', color: '#A27CF3', deep: '#5941A4', fill: '#F1EBFF' }),
  UR: Object.freeze({ label: 'UR', color: '#FFBF46', deep: '#9A5C15', fill: '#FFF0BE' }),
});

function rarityStyle(rarity) {
  const key = String(rarity || 'R').toUpperCase();
  const aliases = { COMMON: 'R', RARE: 'SR', EPIC: 'SSR', LEGENDARY: 'UR' };
  return RARITY_STYLE[aliases[key] || key] || RARITY_STYLE.R;
}

function rosterHeroRect(index) {
  const column = index % ROSTER_HERO_GRID.columns;
  const row = Math.floor(index / ROSTER_HERO_GRID.columns);
  return {
    x: ROSTER_HERO_GRID.x + column * (ROSTER_HERO_GRID.width + ROSTER_HERO_GRID.gapX),
    y: ROSTER_HERO_GRID.y + row * (ROSTER_HERO_GRID.height + ROSTER_HERO_GRID.gapY),
    width: ROSTER_HERO_GRID.width,
    height: ROSTER_HERO_GRID.height,
  };
}

function drawLockedMonochrome(ctx, draw) {
  const previousFilter = typeof ctx.filter === 'string' ? ctx.filter : 'none';
  ctx.save();
  try {
    // Collapse every visible RGB value to one gray while preserving alpha.
    // A grayscale filter alone leaves bright eyes and dark mouths readable.
    ctx.filter = 'brightness(0) invert(0.55)';
    draw();
  } finally {
    ctx.restore();
    // Some lightweight and older Canvas implementations do not restore custom
    // properties. Reset explicitly so one locked portrait cannot gray the page.
    try {
      ctx.filter = previousFilter;
    } catch {
      // The card still uses an entirely gray palette if Canvas filters are absent.
    }
  }
}

function easeOutCubic(value) {
  const t = clamp(Number(value) || 0, 0, 1);
  return 1 - (1 - t) ** 3;
}

function wrappedTextLines(ctx, text, maxWidth, maxLines = 3) {
  const source = String(text || '').trim();
  if (!source) return [];
  const lines = [];
  let current = '';
  for (const character of Array.from(source)) {
    if (character === '\n') {
      if (current) lines.push(current);
      current = '';
      if (lines.length >= maxLines) break;
      continue;
    }
    const candidate = current + character;
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = character;
      if (lines.length >= maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    let last = lines[maxLines - 1];
    if (source.length > lines.join('').length) {
      while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines;
}

function drawWrappedLabel(ctx, text, x, y, maxWidth, {
  maxLines = 3,
  lineHeight = 28,
  size = 20,
  color = COLORS.ink,
  weight = 750,
} = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  const lines = wrappedTextLines(ctx, text, maxWidth, maxLines);
  ctx.restore();
  lines.forEach((line, index) => label(ctx, line, x, y + index * lineHeight, {
    size, color, weight,
  }));
  return lines.length;
}

const STAGE_REGION_ASSET = Object.freeze({
  'stage-1': 'region-gel-meadow-field-a',
  'stage-2': 'region-bubble-heath-field-a',
  'stage-3': 'region-crystal-bloom-field-a',
  'stage-4': 'region-dew-grove-field-a',
  'stage-5': 'region-shell-canyon-field-a',
  'stage-6': 'region-sunbud-sanctuary-field-a',
  'stage-7': 'region-dew-grove-field-a',
  'stage-8': 'region-bubble-heath-field-a',
  'stage-9': 'region-shell-canyon-field-a',
  'stage-10': 'region-bubble-heath-field-a',
  'stage-11': 'region-crystal-bloom-field-a',
  'stage-12': 'region-dew-grove-field-a',
  'stage-13': 'region-gel-meadow-field-a',
  'stage-14': 'region-bubble-heath-field-a',
  'stage-15': 'region-sunbud-sanctuary-field-a',
  'stage-16': 'region-shell-canyon-field-a',
  'stage-17': 'region-crystal-bloom-field-a',
  'stage-18': 'region-dew-grove-field-a',
  'stage-19': 'region-sunbud-sanctuary-field-a',
  'stage-20': 'region-crystal-bloom-field-a',
});

function stageRegionAssetKey(stageOrId) {
  const stage = typeof stageOrId === 'string' ? TD_STAGE_BY_ID[stageOrId] : stageOrId;
  const stageId = typeof stageOrId === 'string' ? stageOrId : stage?.id;
  return stage?.regionAssetKey || stage?.backgroundAssetKey
    || STAGE_REGION_ASSET[stageId] || STAGE_REGION_ASSET['stage-1'];
}

const MONSTER_DRAW_TYPE = Object.freeze({
  bug: 'bug',
  windcap: 'mushroom',
  stone: 'stone',
  boss: 'boss',
});

const ENEMY_ATLAS_ASSET_BY_TYPE = Object.freeze({
  thorn: 'enemy-thorn-roller-atlas-v1',
  lantern: 'enemy-lantern-spore-atlas-v1',
  mud: 'enemy-mud-bulwark-atlas-v1',
  'rift-boss': 'enemy-rift-beacon-king-atlas-v1',
});

const HERO_SKILL_ASSET_BY_TYPE = Object.freeze({
  shell: 'skill-shell-triple-shock-icon',
  needle: 'skill-crystal-rain-icon',
  bubble: 'skill-bubble-tide-domain-icon',
  sprout: 'skill-sprout-forest-dance-icon',
  berry: 'skill-berry-chain-barrage-icon',
  dew: 'skill-dew-garland-icon',
  bell: 'skill-bell-sonic-ring-icon',
  drill: 'skill-drill-rupture-dash-icon',
  ember: 'skill-ember-scorch-line-icon',
  ink: 'skill-ink-cone-burst-icon',
  cloud: 'skill-cloud-vortex-icon',
  frost: 'skill-frost-shard-lane-icon',
  honey: 'skill-honey-cluster-icon',
  spark: 'skill-spark-chain-arc-icon',
  star: 'skill-star-orbit-barrage-icon',
});

const HERO_ATLAS_ASSET_BY_TYPE = Object.freeze({
  berry: 'hero-berry-burst-atlas-v1',
  dew: 'hero-dew-bloom-atlas-v1',
  bell: 'hero-bell-boom-atlas-v1',
  drill: 'hero-drill-gum-atlas-v1',
  ember: 'hero-ember-fizz-atlas-v1',
  ink: 'hero-ink-splash-atlas-v1',
  cloud: 'hero-cloud-spin-atlas-v1',
  frost: 'hero-frost-drop-atlas-v1',
  honey: 'hero-honey-pop-atlas-v1',
  spark: 'hero-spark-bean-atlas-v1',
  star: 'hero-star-core-atlas-v1',
});

const HERO_SKILL_DESCRIPTION_BY_TYPE = Object.freeze({
  shell: '震开周围敌人，造成范围伤害并将它们击退。',
  needle: '引爆周围晶针，对范围内敌人造成高额伤害。',
  bubble: '释放减速泡潮，造成范围伤害并大幅减速敌人。',
  sprout: '播撒毒芽，造成范围伤害并让敌人持续中毒。',
});

function heroSkillDescription(type, definition) {
  const authored = definition?.skill?.description || definition?.skillDescription;
  if (typeof authored === 'string' && authored.trim()) return authored.trim();
  return HERO_SKILL_DESCRIPTION_BY_TYPE[type]
    || `对周围敌人造成 ${Math.round(Number(definition?.skillDamage) || 0)} 点范围伤害。`;
}

const SOLDIER_VISUALS = Object.freeze({
  melee: Object.freeze({
    id: 'melee', ownerId: 'soldier-shield-dun',
    assetKey: 'soldier-shield-dun-atlas-v1', name: '盾墩小队', shortName: '盾墩',
    color: '#E66A73', fallbackType: 'shell', legacyType: 'shell',
  }),
  ranged: Object.freeze({
    id: 'ranged', ownerId: 'soldier-bean-bow',
    assetKey: 'soldier-bean-bow-atlas-v1', name: '豆弩小队', shortName: '豆弩',
    color: '#EFA52E', fallbackType: 'needle', legacyType: 'needle',
  }),
  charger: Object.freeze({
    id: 'charger', ownerId: 'soldier-bounce-hammer',
    assetKey: 'soldier-bounce-hammer-atlas-v1', name: '跳槌小队', shortName: '跳槌',
    color: '#F08B55', fallbackType: 'shell',
  }),
  leaf: Object.freeze({
    id: 'leaf', ownerId: 'soldier-leaf-spinner',
    assetKey: 'soldier-leaf-spinner-atlas-v1', name: '叶旋小队', shortName: '叶旋',
    color: '#79C95E', fallbackType: 'sprout',
  }),
  'drill-lancer': Object.freeze({
    id: 'drill-lancer', ownerId: 'soldier-drill-lancer',
    assetKey: 'soldier-drill-lancer-atlas-v1', name: '钻枪小队', shortName: '钻枪',
    color: '#E78B5C',
  }),
  'spore-lobber': Object.freeze({
    id: 'spore-lobber', ownerId: 'soldier-spore-lobber',
    assetKey: 'soldier-spore-lobber-atlas-v1', name: '孢投小队', shortName: '孢投',
    color: '#B58BD8',
  }),
  'volt-orbiter': Object.freeze({
    id: 'volt-orbiter', ownerId: 'soldier-volt-orbiter',
    assetKey: 'soldier-volt-orbiter-atlas-v1', name: '电环小队', shortName: '电环',
    color: '#F1D84F',
  }),
});

const TURRET_VISUALS = Object.freeze({
  'gel-mortar': Object.freeze({
    assetKey: 'turret-gel-mortar', layout: GEL_MORTAR_ASSET_LAYOUT,
  }),
  'bubble-coil': Object.freeze({
    assetKey: 'turret-bubble-coil', layout: GEL_MORTAR_ASSET_LAYOUT,
  }),
  'crystal-repeater': Object.freeze({
    assetKey: 'turret-crystal-repeater', layout: GEL_MORTAR_ASSET_LAYOUT,
  }),
  'gale-fan': Object.freeze({
    assetKey: 'turret-gale-fan-atlas-v1', layered: true,
  }),
  'spore-bomber': Object.freeze({
    assetKey: 'turret-spore-bomber-atlas-v1', layered: true,
  }),
  'thunder-prism': Object.freeze({
    assetKey: 'turret-thunder-prism-atlas-v1', layered: true,
  }),
});

const PURCHASE_ITEMS = Object.freeze([
  Object.freeze({ id: 'melee', kind: 'squad', type: 'melee' }),
  Object.freeze({ id: 'ranged', kind: 'squad', type: 'ranged' }),
  Object.freeze({ id: 'charger', kind: 'squad', type: 'charger' }),
  Object.freeze({ id: 'leaf', kind: 'squad', type: 'leaf' }),
  Object.freeze({ id: 'turret', kind: 'turret', type: 'gel-mortar', shortName: '凝胶炮' }),
  Object.freeze({ id: 'bubble-coil', kind: 'turret', type: 'bubble-coil', shortName: '泡泡塔' }),
  Object.freeze({
    id: 'crystal-repeater', kind: 'turret', type: 'crystal-repeater', shortName: '晶连弩',
  }),
  Object.freeze({ id: 'drill-lancer', kind: 'squad', type: 'drill-lancer' }),
  Object.freeze({ id: 'spore-lobber', kind: 'squad', type: 'spore-lobber' }),
  Object.freeze({ id: 'volt-orbiter', kind: 'squad', type: 'volt-orbiter' }),
  Object.freeze({ id: 'gale-fan', kind: 'turret', type: 'gale-fan', shortName: '风旋塔' }),
  Object.freeze({
    id: 'spore-bomber', kind: 'turret', type: 'spore-bomber', shortName: '孢子榴塔',
  }),
  Object.freeze({
    id: 'thunder-prism', kind: 'turret', type: 'thunder-prism', shortName: '雷棱塔',
  }),
]);

const PURCHASE_CATEGORIES = Object.freeze({
  squad: Object.freeze({ id: 'squad', label: '小兵' }),
  turret: Object.freeze({ id: 'turret', label: '炮台' }),
});
const PURCHASE_CARD_WIDTH = 126;
const PURCHASE_CARD_HEIGHT = 112;
const PURCHASE_CARD_GAP = 10;

const PURCHASE_ITEM_BY_ID = Object.freeze(Object.fromEntries(
  PURCHASE_ITEMS.map((entry) => [entry.id, entry]),
));
const SQUAD_TYPE_BY_LEGACY_TYPE = Object.freeze(Object.fromEntries(
  Object.values(SOLDIER_VISUALS)
    .filter(({ legacyType }) => typeof legacyType === 'string')
    .map(({ id, legacyType }) => [legacyType, id]),
));
const ATLAS_CHARACTER_OWNER_IDS = Object.freeze(Object.fromEntries([
  ...Object.values(SOLDIER_VISUALS).map(({ ownerId }) => [ownerId, true]),
  ...Object.keys(HERO_ATLAS_ASSET_BY_TYPE)
    .map((type) => [HERO_TYPES[type]?.ownerId, true])
    .filter(([ownerId]) => typeof ownerId === 'string'),
  ...Object.values(TD_ENEMIES)
    .filter(({ id }) => Object.hasOwn(ENEMY_ATLAS_ASSET_BY_TYPE, id))
    .map(({ ownerId }) => [ownerId, true]),
]));

const isSquadType = (type) => typeof type === 'string'
  && Object.hasOwn(SOLDIER_VISUALS, type)
  && Object.hasOwn(SQUAD_TYPES, type);
const purchaseItemFor = (id) => PURCHASE_ITEM_BY_ID[id] || null;
const squadTypeForPurchase = (id) => {
  const entry = purchaseItemFor(id);
  return entry?.kind === 'squad' && isSquadType(entry.type) ? entry.type : null;
};
const turretTypeForPurchase = (id) => {
  const entry = purchaseItemFor(id);
  return entry?.kind === 'turret' && TURRET_TYPES[entry.type] ? entry.type : null;
};
const turretVisualFor = (type) => TURRET_VISUALS[type] || null;

const ANIMATION_CLIPS_BY_OWNER_ID = Object.freeze({
  'survivor-shell-shell': SHELL_CLIPS,
  'survivor-crystal-pin': CRYSTAL_CLIPS,
  'survivor-bubble-float': BUBBLE_CLIPS,
  'survivor-moss-sprout': SPROUT_CLIPS,
  'soldier-shield-dun': SOLDIER_CLIPS,
  'soldier-bean-bow': SOLDIER_CLIPS,
  'soldier-bounce-hammer': SOLDIER_CLIPS,
  'soldier-leaf-spinner': SOLDIER_CLIPS,
  'survivor-berry-burst': SOLDIER_CLIPS,
  'survivor-dew-bloom': SOLDIER_CLIPS,
  'survivor-bell-boom': SOLDIER_CLIPS,
  'survivor-drill-gum': SOLDIER_CLIPS,
  'survivor-ember-fizz': SOLDIER_CLIPS,
  'survivor-ink-splash': SOLDIER_CLIPS,
  'survivor-cloud-spin': SOLDIER_CLIPS,
  'survivor-frost-drop': SOLDIER_CLIPS,
  'survivor-honey-pop': SOLDIER_CLIPS,
  'survivor-spark-bean': SOLDIER_CLIPS,
  'survivor-star-core': SOLDIER_CLIPS,
  'soldier-drill-lancer': SOLDIER_CLIPS,
  'soldier-spore-lobber': SOLDIER_CLIPS,
  'soldier-volt-orbiter': SOLDIER_CLIPS,
  'enemy-soft-biter': BUG_CLIPS,
  'enemy-windcap': WINDCAP_CLIPS,
  'enemy-stone-lump': STONE_CLIPS,
  'enemy-acid-shell-king': BOSS_CLIPS,
  'enemy-thorn-roller': SOLDIER_CLIPS,
  'enemy-lantern-spore': SOLDIER_CLIPS,
  'enemy-mud-bulwark': SOLDIER_CLIPS,
  'enemy-rift-beacon-king': SOLDIER_CLIPS,
});

const ENEMY_DEATH_DURATION_BY_TYPE = Object.freeze({
  bug: BUG_CLIPS.death.duration,
  windcap: WINDCAP_CLIPS.death.duration,
  stone: STONE_CLIPS.death.duration,
  boss: BOSS_CLIPS.death.duration,
  thorn: SOLDIER_CLIPS.downed.duration,
  lantern: SOLDIER_CLIPS.downed.duration,
  mud: SOLDIER_CLIPS.downed.duration,
  'rift-boss': SOLDIER_CLIPS.downed.duration,
});

const ATTACK_MODE_LABEL = Object.freeze({
  'goo-splash': '胶爆',
  'goo-shockwave': '震波',
  'goo-split': '双爆',
  'goo-cluster': '集束',
  'needle-pierce': '晶穿',
  'needle-double': '双穿',
  'needle-fork': '分叉',
  'needle-fan': '扇射',
  'bubble-slow': '泡缚',
  'bubble-chain': '连锁',
  'bubble-cascade': '泡瀑',
  'bubble-tide': '泡潮',
  'seed-poison': '种毒',
  'seed-branch': '分枝',
  'seed-canopy': '树冠',
  'seed-bloom': '绽放',
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (from, to, progress) => from + (to - from) * progress;
const finiteNumber = (...values) => {
  const value = values.find((candidate) => (
    candidate !== null && candidate !== '' && Number.isFinite(Number(candidate))
  ));
  return value == null ? 0 : Number(value);
};
const skillProgress = (effect) => clamp(
  finiteNumber(effect?.phase, finiteNumber(effect?.age, effect?.elapsed)
    / Math.max(0.001, finiteNumber(effect?.duration, effect?.maxAge, 1))),
  0,
  1,
);
const skillHeroType = (effect) => {
  if (SKILL_VISUAL_STYLE[effect?.heroType]) return effect.heroType;
  const kind = String(effect?.stepKind || effect?.skillId || effect?.kind || '');
  if (kind.includes('crystal')) return 'needle';
  if (kind.includes('bubble')) return 'bubble';
  if (kind.includes('sprout')) return 'sprout';
  if (kind.includes('berry')) return 'berry';
  if (kind.includes('dew')) return 'dew';
  if (kind.includes('bell')) return 'bell';
  if (kind.includes('drill')) return 'drill';
  if (kind.includes('ember')) return 'ember';
  if (kind.includes('ink')) return 'ink';
  if (kind.includes('cloud')) return 'cloud';
  if (kind.includes('frost')) return 'frost';
  if (kind.includes('honey')) return 'honey';
  if (kind.includes('spark')) return 'spark';
  if (kind.includes('star')) return 'star';
  return 'shell';
};
const skillStyle = (effect) => SKILL_VISUAL_STYLE[skillHeroType(effect)];
const skillNoise = (seed, index) => {
  const value = Math.sin((finiteNumber(seed, 1) + index * 17.17) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};
const isHeroSkillProjectile = (projectile) => (
  projectile?.sourceKind === 'hero-skill'
  || String(projectile?.kind || '').includes('skill-projectile')
  || String(projectile?.type || '').includes('skill-projectile')
);
const reinforcementProjectileStyleFor = (projectile) => {
  const visualId = REINFORCEMENT_PROJECTILE_BY_SQUAD[projectile?.squadType]
    || REINFORCEMENT_PROJECTILE_BY_TURRET[projectile?.turretType];
  return REINFORCEMENT_PROJECTILE_STYLE[visualId] || null;
};
const heroSkillEffectLayer = (effect) => {
  if (effect?.type !== 'hero-skill-step') return 'front';
  const kind = String(effect.stepKind || '');
  if (kind.includes('field') || kind.includes('quake') || kind.includes('root')) return 'back';
  if (skillHeroType(effect) === 'sprout' && kind.includes('burst')) return 'back';
  return 'front';
};
const pointDistance = (left, right) => Math.hypot(left.x - right.x, left.y - right.y);
const insideRect = (point, rect) => (
  point.x >= rect.x && point.x <= rect.x + rect.width
  && point.y >= rect.y && point.y <= rect.y + rect.height
);
const intersectRects = (left, right) => {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const edgeX = Math.min(left.x + left.width, right.x + right.width);
  const edgeY = Math.min(left.y + left.height, right.y + right.height);
  if (edgeX <= x || edgeY <= y) return null;
  return { x, y, width: edgeX - x, height: edgeY - y };
};
const squadTypeFor = (type, squadType = null) => {
  if (isSquadType(squadType)) return squadType;
  if (isSquadType(type)) return type;
  return SQUAD_TYPE_BY_LEGACY_TYPE[squadType]
    || SQUAD_TYPE_BY_LEGACY_TYPE[type]
    || 'melee';
};
const soldierVisualFor = (type, squadType = null) => (
  SOLDIER_VISUALS[squadTypeFor(type, squadType)] || SOLDIER_VISUALS.melee
);
const slimeVisualType = (type, squadType = null) => {
  if (isSquadType(squadType) || isSquadType(type)) {
    return soldierVisualFor(type, squadType).fallbackType;
  }
  return TOWER_TYPES[type] ? type : 'shell';
};
const isSquadTower = (tower) => Boolean(
  tower && (
    tower.kind === 'soldier'
    || Number.isFinite(Number(tower.aliveMembers))
    || isSquadType(tower.squadType)
    || isSquadType(tower.type)
  )
);
const squadMemberAnimationKey = (squad, member, fallbackIndex = 0) => {
  const memberIdentity = member?.uid ?? member?.memberIndex ?? fallbackIndex;
  return `squad:${squad.uid}:${memberIdentity}`;
};

function laneDescriptors(stage) {
  const lanes = Array.isArray(stage?.lanes) && stage.lanes.length
    ? stage.lanes.slice(0, 5)
    : FALLBACK_LANE_X.map((x, laneIndex) => ({ x, laneIndex }));
  return FALLBACK_LANE_X.map((fallbackX, laneIndex) => {
    const lane = lanes[laneIndex] || {};
    const x = Number.isFinite(Number(lane?.x)) ? Number(lane.x) : fallbackX;
    const providedPath = Array.isArray(lane?.path)
      ? lane.path
      : Array.isArray(lane?.points) ? lane.points : null;
    const points = providedPath?.length >= 2
      ? providedPath
      : [{ x, y: 132 }, { x, y: 1002 }];
    return { ...lane, laneIndex, x, points };
  });
}

function waveUnitCount(wave) {
  if (!Array.isArray(wave)) return 0;
  return wave.reduce((total, group) => total + Math.max(0, Number(group?.count) || 0), 0);
}

function drawDockShell(ctx, stage, time) {
  ctx.save();
  const topGradient = ctx.createLinearGradient(0, 0, TD_VIEW.width, 0);
  topGradient.addColorStop(0, 'rgba(27, 59, 65, 0.96)');
  topGradient.addColorStop(0.5, 'rgba(45, 86, 76, 0.96)');
  topGradient.addColorStop(1, 'rgba(31, 54, 68, 0.96)');
  ctx.fillStyle = topGradient;
  ctx.fillRect(0, 0, TD_VIEW.width, BATTLE_FIELD.top);

  const bottomGradient = ctx.createLinearGradient(0, BATTLE_FIELD.bottom, TD_VIEW.width, TD_VIEW.height);
  bottomGradient.addColorStop(0, 'rgba(27, 58, 61, 0.98)');
  bottomGradient.addColorStop(0.5, 'rgba(42, 81, 71, 0.98)');
  bottomGradient.addColorStop(1, 'rgba(31, 51, 65, 0.98)');
  ctx.fillStyle = bottomGradient;
  ctx.fillRect(0, BATTLE_FIELD.bottom, TD_VIEW.width, TD_VIEW.height - BATTLE_FIELD.bottom);

  ctx.globalAlpha = 0.12;
  ctx.fillStyle = stage.accent;
  for (let index = 0; index < 7; index += 1) {
    const radius = 15 + (index % 3) * 9;
    const x = 24 + (index * 113) % 690;
    const y = BATTLE_FIELD.bottom + 18 + (index * 47) % 166
      + Math.sin(time * 0.55 + index) * 4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#DFFFF0';
  ctx.fillRect(0, BATTLE_FIELD.top - 2, TD_VIEW.width, 2);
  ctx.fillRect(0, BATTLE_FIELD.bottom, TD_VIEW.width, 2);
  ctx.restore();
}

function animationPhaseForKey(key) {
  let hash = 2166136261;
  for (const character of String(key)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1700) / 1000;
}

function roundedPath(ctx, x, y, width, height, radius = 16) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function panel(ctx, rect, {
  fill = COLORS.cream,
  stroke = 'rgba(39, 56, 68, 0.18)',
  lineWidth = 2,
  radius = 18,
  shadow = false,
} = {}) {
  ctx.save();
  if (shadow) {
    ctx.shadowColor = COLORS.shadow;
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 7;
  }
  roundedPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  if (stroke && lineWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

function drawCoverImage(ctx, asset, rect = {
  x: 0, y: 0, width: TD_VIEW.width, height: TD_VIEW.height,
}) {
  const sourceWidth = Number(asset?.naturalWidth || asset?.videoWidth || asset?.width);
  const sourceHeight = Number(asset?.naturalHeight || asset?.videoHeight || asset?.height);
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    ctx.drawImage(asset, rect.x, rect.y, rect.width, rect.height);
    return;
  }
  const scale = Math.max(rect.width / sourceWidth, rect.height / sourceHeight);
  const cropWidth = rect.width / scale;
  const cropHeight = rect.height / scale;
  const cropX = (sourceWidth - cropWidth) / 2;
  const cropY = (sourceHeight - cropHeight) / 2;
  ctx.drawImage(asset, cropX, cropY, cropWidth, cropHeight,
    rect.x, rect.y, rect.width, rect.height);
}

function label(ctx, text, x, y, {
  size = 24,
  color = COLORS.ink,
  align = 'center',
  baseline = 'middle',
  weight = 700,
  alpha = 1,
} = {}) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.fillText(String(text), x, y);
  ctx.restore();
}

function button(ctx, rect, text, {
  enabled = true,
  selected = false,
  fill = COLORS.mint,
  color = COLORS.white,
  accent = COLORS.mintDeep,
  size = 23,
} = {}) {
  panel(ctx, rect, {
    fill: enabled ? (selected ? accent : fill) : '#D8DEDA',
    stroke: enabled ? accent : '#ABB5B1',
    lineWidth: selected ? 4 : 2,
    radius: Math.min(20, rect.height / 2),
    shadow: enabled,
  });
  label(ctx, text, rect.x + rect.width / 2, rect.y + rect.height / 2 + 1, {
    size,
    color: enabled ? color : '#7D8985',
    weight: 800,
  });
}

function safeGlobal(name) {
  try {
    return globalThis[name];
  } catch {
    return undefined;
  }
}

function localStorageAdapter(storage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return null;
  }
  return {
    get(key, fallback = null) {
      try {
        const raw = storage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        storage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
  };
}

function frameScheduler(canvas, options = {}) {
  const runtime = options.runtime || {};
  const request = options.requestAnimationFrame
    || runtime.requestAnimationFrame
    || canvas?.requestAnimationFrame?.bind(canvas)
    || safeGlobal('requestAnimationFrame')?.bind(globalThis);
  const cancel = options.cancelAnimationFrame
    || runtime.cancelAnimationFrame
    || canvas?.cancelAnimationFrame?.bind(canvas)
    || safeGlobal('cancelAnimationFrame')?.bind(globalThis);
  if (typeof request === 'function') {
    return {
      request: (callback) => request(callback),
      cancel: (id) => {
        if (id != null && typeof cancel === 'function') cancel(id);
      },
    };
  }
  const schedule = safeGlobal('setTimeout');
  const unschedule = safeGlobal('clearTimeout');
  if (typeof schedule === 'function') {
    return {
      request: (callback) => schedule(() => callback(Date.now()), 16),
      cancel: (id) => {
        if (id != null && typeof unschedule === 'function') unschedule(id);
      },
    };
  }
  return { request: () => null, cancel: () => {} };
}

function canvasRect(canvas) {
  let rect = null;
  try {
    rect = canvas?.getBoundingClientRect?.();
  } catch {
    rect = null;
  }
  const width = Number(rect?.width ?? canvas?.clientWidth ?? canvas?.width) || TD_VIEW.width;
  const height = Number(rect?.height ?? canvas?.clientHeight ?? canvas?.height) || TD_VIEW.height;
  return {
    left: Number(rect?.left) || 0,
    top: Number(rect?.top) || 0,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

export class TowerDefenseGame {
  constructor(canvas, options = {}) {
    if (!canvas || typeof canvas.getContext !== 'function') {
      throw new TypeError('TowerDefenseGame requires a Canvas-like object.');
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    if (!this.ctx) throw new Error('TowerDefenseGame requires a 2D canvas context.');
    this.options = options;
    this.runtime = options.runtime || null;
    this.assetStore = null;
    this.rigAssetStore = null;
    this.generatedCharacterArtEnabled = options.generatedCharacterArtEnabled !== false;
    this.setAssetStore(options.assetStore);
    this.setRigAssetStore(
      typeof options?.get === 'function' ? options : options.rigAssetStore,
    );

    this.storage = this.runtime?.storage
      && typeof this.runtime.storage.get === 'function'
      && typeof this.runtime.storage.set === 'function'
      ? this.runtime.storage
      : localStorageAdapter(options.storage || safeGlobal('localStorage'));
    this.audio = createTowerDefenseAudio({
      runtime: this.runtime,
      storage: this.storage,
      paths: options.audioPaths || {},
      now: options.audioNow,
    });
    const progress = this.loadProgress();
    this.state = createTowerDefenseState({
      progress,
      seed: Number.isFinite(Number(options.seed)) ? Number(options.seed) : Date.now(),
    });

    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.pixelRatio = 1;
    this.cssWidth = TD_VIEW.width;
    this.cssHeight = TD_VIEW.height;
    this.hits = [];
    this.drag = null;
    this.keysDown = new Set();
    this.joystick = { active: false, x: 0, y: 0 };
    this.selectedPurchase = null;
    this.purchaseCategory = 'squad';
    this.purchaseTrackOffsets = { squad: 0, turret: 0 };
    this.selectedCardUid = null;
    this.hoverPoint = null;
    this.menuPage = 'main';
    this.stageSelectPage = 0;
    this.rosterInspectType = this.state.progress?.selectedHero || Object.keys(HERO_TYPES)[0] || 'shell';
    this.rosterPage = 0;
    this.summonResults = [];
    this.summonAnimation = null;
    const performanceClock = safeGlobal('performance');
    this.interactionNow = typeof options.now === 'function'
      ? options.now
      : () => (typeof performanceClock?.now === 'function'
        ? performanceClock.now()
        : Date.now());
    this.shake = 0;
    this.eventCursor = 0;
    this.animationTime = 0;
    this.characterAnimations = new Map();
    this.turretPulses = new Map();
    this.defeatedActors = [];
    this.defeatedTowers = [];
    this.skillRenderBudget = null;
    this.running = false;
    this.backgrounded = false;
    this.frameId = null;
    this.lastTimestamp = 0;
    this.scheduler = frameScheduler(canvas, options);

    this.boundPointerDown = (event) => this.handlePointerDown(event);
    this.boundPointerMove = (event) => this.handlePointerMove(event);
    this.boundPointerUp = (event) => this.handlePointerUp(event);
    this.boundPointerCancel = (event) => this.handlePointerCancel(event);
    this.boundKeyDown = (event) => this.handleKeyDown(event);
    this.boundKeyUp = (event) => this.handleKeyUp(event);
    this.boundWindowBlur = () => this.resetHeroInput();
    this.keyboardTarget = options.keyboardTarget || safeGlobal('window') || canvas;
    this.bindInput();
    this.resize();
  }

  setAssetStore(store = null) {
    this.assetStore = store
      && typeof store.get === 'function'
      && typeof store.useOrFallback === 'function'
      ? store
      : null;
    return this;
  }

  setRigAssetStore(store = null) {
    this.rigAssetStore = store && typeof store.get === 'function' ? store : null;
    return this;
  }

  setGeneratedCharacterArtEnabled(enabled = true) {
    this.generatedCharacterArtEnabled = enabled !== false;
    return this;
  }

  rigAsset(ownerId) {
    return this.rigAssetStore?.get(ownerId, null) ?? null;
  }

  characterRigOptions(ownerId) {
    const rigAsset = this.rigAsset(ownerId);
    return {
      rigAsset,
      requireLayeredRig: Boolean(
        rigAsset || this.rigAssetStore?.manifest?.rigs?.[ownerId],
      ),
    };
  }

  animationClipsForOwner(ownerId) {
    return ANIMATION_CLIPS_BY_OWNER_ID[ownerId] || null;
  }

  characterAnimationFor(key, ownerId, base = 'idle') {
    if (typeof key !== 'string' || !key || typeof ownerId !== 'string' || !ownerId) return null;
    const clips = this.animationClipsForOwner(ownerId);
    if (!clips || !Object.hasOwn(clips, base)) return null;
    const current = this.characterAnimations.get(key);
    if (current?.ownerId === ownerId) {
      current.controller.setBase(base);
      return current;
    }

    const controller = new AnimationController(clips, {
      base,
      transitionDuration: 0.06,
    });
    const phase = animationPhaseForKey(key);
    controller.update(phase);
    controller.drainEvents();
    const entry = {
      key,
      ownerId,
      phase,
      controller,
      expressionMixer: new ExpressionMixer({
        ownerId,
        spec: ATLAS_CHARACTER_OWNER_IDS[ownerId] ? SOLDIER_RIG.expression : undefined,
      }),
    };
    this.characterAnimations.set(key, entry);
    return entry;
  }

  playCharacterAnimation(key, ownerId, action, {
    base = 'idle',
    restart = true,
  } = {}) {
    const entry = this.characterAnimationFor(key, ownerId, base);
    if (!entry || !Object.hasOwn(this.animationClipsForOwner(ownerId), action)) return false;
    return entry.controller.play(action, { restart });
  }

  characterAnimationSample(key, ownerId, base = 'idle') {
    const entry = this.characterAnimationFor(key, ownerId, base);
    if (!entry) return { pose: null, expressionSample: null };
    return {
      pose: entry.controller.sample(),
      expressionSample: entry.expressionMixer.sample(),
    };
  }

  processCharacterAnimationEvent(event) {
    if (!event || typeof event.type !== 'string') return;
    if (event.type === 'run-start') {
      this.defeatedActors.length = 0;
      this.defeatedTowers.length = 0;
      return;
    }
    if (event.type === 'turret-shot' || event.type === 'turret-attack') {
      const key = event.turretUid || event.slotId || event.slotIndex;
      if (key != null) this.turretPulses.set(String(key), 1);
      return;
    }
    if (['hero-shot', 'hero-attack', 'hero-skill'].includes(event.type)) {
      const hero = this.state.hero;
      const type = hero?.type || hero?.heroId || this.state.selectedHeroId;
      const ownerId = (HERO_TYPES[type] || TOWER_TYPES[type])?.ownerId;
      if (hero && ownerId) {
        this.playCharacterAnimation(`hero:${hero.uid || type}`, ownerId, 'attack');
      }
      return;
    }
    if (event.type === 'hero-hit') {
      const hero = this.state.hero;
      const type = hero?.type || hero?.heroId || this.state.selectedHeroId;
      const ownerId = (HERO_TYPES[type] || TOWER_TYPES[type])?.ownerId;
      if (hero && ownerId) {
        this.playCharacterAnimation(`hero:${hero.uid || type}`, ownerId, 'hurt', {
          restart: false,
        });
      }
      return;
    }
    if (event.type === 'shot' || event.type === 'soldier-attack') {
      const towerUid = event.towerUid || event.soldierUid;
      const tower = this.state.towers.find(({ uid }) => uid === towerUid);
      const squad = isSquadTower(tower);
      const ownerId = tower && (squad
        ? soldierVisualFor(tower.type, tower.squadType)?.ownerId
        : TOWER_TYPES[slimeVisualType(tower.type, tower.squadType)]?.ownerId);
      if (ownerId) {
        if (squad) {
          const member = Number.isInteger(event.memberIndex)
            ? tower.members?.[event.memberIndex]
            : tower.members?.find(({ uid }) => uid === event.soldierUid);
          if (member) {
            this.playCharacterAnimation(
              squadMemberAnimationKey(tower, member, event.memberIndex), ownerId, 'attack',
            );
          } else {
            for (let memberIndex = 0; memberIndex < 4; memberIndex += 1) {
              this.playCharacterAnimation(
                squadMemberAnimationKey(tower, null, memberIndex), ownerId, 'attack',
              );
            }
          }
        } else {
          this.playCharacterAnimation(`tower:${tower.uid}`, ownerId, 'attack');
        }
      }
      return;
    }
    if (event.type === 'merge') {
      const tower = this.state.towers.find(({ uid }) => uid === event.towerUid);
      const ownerId = tower && (isSquadTower(tower)
        ? soldierVisualFor(tower.type, tower.squadType)?.ownerId
        : TOWER_TYPES[slimeVisualType(tower.type, tower.squadType)]?.ownerId);
      if (ownerId) this.playCharacterAnimation(`tower:${tower.uid}`, ownerId, 'attack');
      return;
    }
    if (event.type === 'enemy-hit') {
      const enemy = this.state.enemies.find(({ uid }) => uid === event.enemyUid);
      const ownerId = enemy && TD_ENEMIES[enemy.type]?.ownerId;
      if (ownerId) {
        this.playCharacterAnimation(`enemy:${enemy.uid}`, ownerId, 'hurt', {
          base: 'move',
          restart: false,
        });
      }
      return;
    }
    if (event.type === 'tower-hit' || event.type === 'soldier-hit') {
      const towerUid = event.towerUid || event.soldierUid;
      const tower = this.state.towers.find(({ uid }) => uid === towerUid);
      const squad = isSquadTower(tower);
      const ownerId = tower && (squad
        ? soldierVisualFor(tower.type, tower.squadType)?.ownerId
        : TOWER_TYPES[slimeVisualType(tower.type, tower.squadType)]?.ownerId);
      if (ownerId) {
        if (squad) {
          const member = Number.isInteger(event.memberIndex)
            ? tower.members?.[event.memberIndex]
            : tower.members?.find(({ uid }) => uid === event.soldierUid);
          if (member) {
            this.playCharacterAnimation(
              squadMemberAnimationKey(tower, member, event.memberIndex), ownerId, 'hurt', {
                restart: false,
              },
            );
          } else {
            for (let memberIndex = 0; memberIndex < 4; memberIndex += 1) {
              this.playCharacterAnimation(squadMemberAnimationKey(tower, null, memberIndex), ownerId, 'hurt', {
                restart: false,
              });
            }
          }
        } else {
          this.playCharacterAnimation(`tower:${tower.uid}`, ownerId, 'hurt', {
              restart: false,
          });
        }
      }
      return;
    }
    if (event.type === 'enemy-attack') {
      const enemy = this.state.enemies.find(({ uid }) => uid === event.enemyUid);
      const ownerId = enemy && TD_ENEMIES[enemy.type]?.ownerId;
      if (ownerId) {
        this.playCharacterAnimation(`enemy:${enemy.uid}`, ownerId, 'attack', {
          base: 'move',
        });
      }
      return;
    }
    if (event.type === 'squad-member-down') {
      const tower = this.state.towers.find(({ uid }) => uid === event.squadUid);
      const squadType = squadTypeFor(tower?.type, event.squadType || tower?.squadType);
      const definition = soldierVisualFor(tower?.type, squadType);
      if (
        !definition
        || typeof event.soldierUid !== 'string'
        || !Number.isFinite(event.x)
        || !Number.isFinite(event.y)
      ) return;
      const key = `defeated-member:${event.soldierUid}`;
      const actor = {
        key,
        squadUid: event.squadUid,
        memberDown: true,
        type: definition.fallbackType,
        squadType,
        ownerId: definition.ownerId,
        x: event.x,
        y: event.y,
        facing: event.facing === -1 ? -1 : 1,
        star: 1,
        age: 0,
        duration: this.animationClipsForOwner(definition.ownerId)?.downed?.duration || 0.52,
      };
      this.defeatedTowers = this.defeatedTowers
        .filter(({ key: currentKey }) => currentKey !== key);
      this.defeatedTowers.push(actor);
      this.playCharacterAnimation(key, actor.ownerId, 'downed');
      return;
    }
    if (event.type === 'tower-defeat' || event.type === 'soldier-defeat') {
      const towerUid = event.towerUid || event.soldierUid;
      const tower = this.state.towers.find(({ uid }) => uid === towerUid);
      const towerType = event.towerType || event.soldierType || tower?.type;
      const squad = isSquadTower(tower) || isSquadType(towerType);
      const squadType = squad ? squadTypeFor(towerType, tower?.squadType) : null;
      const soldierVisual = squad ? soldierVisualFor(towerType, squadType) : null;
      const visualType = slimeVisualType(towerType, tower?.squadType);
      const definition = soldierVisual || TOWER_TYPES[visualType];
      const stage = stageForState(this.state);
      const pad = Number.isInteger(event.padIndex) ? stage.pads[event.padIndex] : null;
      const x = Number.isFinite(event.x) ? event.x : pad?.x;
      const y = Number.isFinite(event.y) ? event.y : pad?.y;
      if (!definition || !Number.isFinite(x) || !Number.isFinite(y)) return;
      if (squad && this.defeatedTowers.some((actor) => (
        actor.memberDown && actor.squadUid === towerUid
      ))) {
        this.shake = Math.min(10, this.shake + 3);
        return;
      }
      const key = `defeated-tower:${towerUid || `${towerType}-${this.state.time}`}`;
      const actor = {
        key,
        type: soldierVisual?.fallbackType || towerType || visualType,
        squadType,
        ownerId: definition.ownerId,
        x,
        y,
        facing: (event.facing ?? tower?.facing) === -1 ? -1 : 1,
        star: clamp(Math.floor(Number(event.star ?? tower?.star) || 1), 1, TD_MAX_STAR),
        age: 0,
        duration: this.animationClipsForOwner(definition.ownerId)?.downed?.duration || 0.52,
      };
      this.defeatedTowers = this.defeatedTowers
        .filter(({ key: currentKey }) => currentKey !== key);
      this.defeatedTowers.push(actor);
      this.playCharacterAnimation(key, actor.ownerId, 'downed');
      this.shake = Math.min(10, this.shake + 3);
      return;
    }
    if (event.type !== 'enemy-defeat') return;
    const definition = TD_ENEMIES[event.enemyType];
    if (
      !definition
      || typeof event.enemyUid !== 'string'
      || !Number.isFinite(event.x)
      || !Number.isFinite(event.y)
    ) return;
    const key = `defeated:${event.enemyUid}`;
    const actor = {
      key,
      type: definition.id,
      ownerId: definition.ownerId,
      x: event.x,
      y: event.y,
      facing: event.facing === -1 ? -1 : 1,
      age: 0,
      duration: ENEMY_DEATH_DURATION_BY_TYPE[definition.id] || 0.5,
    };
    this.defeatedActors = this.defeatedActors.filter(({ key: currentKey }) => currentKey !== key);
    this.defeatedActors.push(actor);
    const clips = this.animationClipsForOwner(actor.ownerId);
    const deathAction = clips && Object.hasOwn(clips, 'death') ? 'death' : 'downed';
    this.playCharacterAnimation(key, actor.ownerId, deathAction, { base: 'move' });
  }

  updateCharacterAnimations(dt) {
    const delta = clamp(Number(dt) || 0, 0, 0.05);
    this.animationTime += delta;
    this.updateSummonAnimation(delta);
    const liveKeys = new Set();
    const advance = (key, ownerId, base = 'idle') => {
      const entry = this.characterAnimationFor(key, ownerId, base);
      if (!entry) return;
      liveKeys.add(key);
      entry.controller.update(delta);
      const events = entry.controller.drainEvents();
      entry.expressionMixer.setAnimationContext(entry.controller, {
        events,
        currentTime: this.animationTime + entry.phase,
      });
      entry.expressionMixer.tick(delta);
    };

    if (this.state.screen === 'menu' && ['roster', 'summon'].includes(this.menuPage)) {
      for (const heroDefinition of Object.values(HERO_TYPES)) {
        advance(`preview:menu:${heroDefinition.id}`, heroDefinition.ownerId, 'idle');
      }
    } else if (this.state.screen === 'battle') {
      const hero = this.state.hero;
      const heroType = hero?.type || hero?.heroId || this.state.selectedHeroId;
      const heroDefinition = HERO_TYPES[heroType] || TOWER_TYPES[heroType];
      if (hero && heroDefinition) {
        const heroBase = Math.hypot(Number(hero.moveX) || 0, Number(hero.moveY) || 0) > 0.01
          ? 'move' : 'idle';
        advance(`hero:${hero.uid || heroType}`, heroDefinition.ownerId, heroBase);
      }
      for (const tower of this.state.towers) {
        const squad = isSquadTower(tower);
        const visualType = slimeVisualType(tower.type, tower.squadType);
        const definition = squad
          ? soldierVisualFor(tower.type, tower.squadType)
          : TOWER_TYPES[tower.type] || TOWER_TYPES[visualType];
        if (squad) {
          const members = Array.isArray(tower.members)
            ? tower.members
            : Array.from({ length: 4 }, (_, memberIndex) => ({ memberIndex }));
          for (const [memberIndex, member] of members.entries()) {
            if (member.alive === false || Number(member.hp) <= 0) continue;
            advance(
              squadMemberAnimationKey(tower, member, memberIndex),
              definition.ownerId,
              member.moving ? 'move' : 'idle',
            );
          }
        } else {
          advance(`tower:${tower.uid}`, definition.ownerId, tower.moving ? 'move' : 'idle');
        }
      }
      for (const enemy of this.state.enemies) {
        advance(`enemy:${enemy.uid}`, TD_ENEMIES[enemy.type].ownerId, 'move');
      }
      for (const card of this.state.hand) {
        advance(`card:${card.uid}`, TOWER_TYPES[card.type].ownerId, 'idle');
      }
      for (const offer of this.state.soldierShop || []) {
        const definition = TOWER_TYPES[offer.type];
        if (definition) advance(`offer:${offer.uid}`, definition.ownerId, 'idle');
      }
      for (const definition of Object.values(SOLDIER_VISUALS)) {
        const { id: type } = definition;
        for (let memberIndex = 0; memberIndex < 4; memberIndex += 1) {
          advance(`purchase:${type}:${memberIndex}`, definition.ownerId, 'idle');
        }
      }
      for (const actor of this.defeatedActors) {
        actor.age += delta;
        advance(actor.key, actor.ownerId, 'move');
      }
      for (const actor of this.defeatedTowers) {
        actor.age += delta;
        advance(actor.key, actor.ownerId, 'idle');
      }
      this.defeatedActors = this.defeatedActors.filter(({ age, duration }) => age < duration);
      this.defeatedTowers = this.defeatedTowers.filter(({ age, duration }) => age < duration);
    } else {
      const victory = this.state.result === 'victory';
      const definition = victory ? TOWER_TYPES.shell : TD_ENEMIES.boss;
      advance(
        victory ? 'preview:result:shell' : 'preview:result:boss',
        definition.ownerId,
        'idle',
      );
      this.defeatedActors.length = 0;
      this.defeatedTowers.length = 0;
    }

    for (const [key, pulse] of this.turretPulses) {
      const next = Math.max(0, pulse - delta * 5.5);
      if (next <= 0) this.turretPulses.delete(key);
      else this.turretPulses.set(key, next);
    }

    for (const key of this.characterAnimations.keys()) {
      if (!liveKeys.has(key)) this.characterAnimations.delete(key);
    }
  }

  summonAnimationDuration(count = 1) {
    const resultCount = Number(count) === 10 ? 10 : 1;
    return SUMMON_ENERGY_DURATION + SUMMON_RIFT_DURATION
      + SUMMON_REVEAL_CARD_DURATION + (resultCount - 1) * SUMMON_REVEAL_STAGGER;
  }

  updateSummonAnimation(dt) {
    if (!this.summonAnimation) return false;
    this.summonAnimation.elapsed += Math.max(0, Number(dt) || 0);
    if (this.summonAnimation.elapsed < this.summonAnimationDuration(
      this.summonAnimation.results.length,
    )) return true;
    this.completeSummonAnimation();
    return false;
  }

  completeSummonAnimation() {
    if (!this.summonAnimation) return false;
    this.summonResults = [...this.summonAnimation.results];
    this.summonAnimation = null;
    return true;
  }

  loadProgress() {
    try {
      const stored = this.storage?.get(TD_STORAGE_KEY, {}) || {};
      const progress = typeof stored === 'string' ? JSON.parse(stored) : stored;
      return normalizeTowerDefenseProgress(progress);
    } catch {
      return normalizeTowerDefenseProgress({});
    }
  }

  save() {
    try {
      const progress = serializeTowerDefenseProgress(this.state);
      return this.storage?.set(TD_STORAGE_KEY, progress) ?? false;
    } catch {
      return false;
    }
  }

  bindInput() {
    if (typeof this.canvas.addEventListener !== 'function') return;
    this.canvas.addEventListener('pointerdown', this.boundPointerDown, { passive: false });
    this.canvas.addEventListener('pointermove', this.boundPointerMove, { passive: false });
    this.canvas.addEventListener('pointerup', this.boundPointerUp, { passive: false });
    this.canvas.addEventListener('pointercancel', this.boundPointerCancel, { passive: true });
    this.canvas.addEventListener('contextmenu', (event) => event?.preventDefault?.());
    this.keyboardTarget?.addEventListener?.('keydown', this.boundKeyDown, { passive: false });
    this.keyboardTarget?.addEventListener?.('keyup', this.boundKeyUp, { passive: false });
    this.keyboardTarget?.addEventListener?.('blur', this.boundWindowBlur);
  }

  resize(sizeHint = null) {
    const rect = canvasRect(this.canvas);
    const hintedWidth = Number(sizeHint?.width);
    const hintedHeight = Number(sizeHint?.height);
    this.cssWidth = Number.isFinite(hintedWidth) && hintedWidth > 0 ? hintedWidth : rect.width;
    this.cssHeight = Number.isFinite(hintedHeight) && hintedHeight > 0 ? hintedHeight : rect.height;
    const hintedDpr = Number(sizeHint?.pixelRatio ?? this.options.pixelRatio);
    const globalDpr = Number(safeGlobal('devicePixelRatio'));
    this.pixelRatio = clamp(
      Number.isFinite(hintedDpr) && hintedDpr > 0
        ? hintedDpr
        : Number.isFinite(globalDpr) && globalDpr > 0 ? globalDpr : 1,
      1,
      MAX_DPR,
    );
    this.canvas.width = Math.max(1, Math.round(this.cssWidth * this.pixelRatio));
    this.canvas.height = Math.max(1, Math.round(this.cssHeight * this.pixelRatio));
    this.scale = Math.max(0.01, Math.min(
      this.cssWidth / TD_VIEW.width,
      this.cssHeight / TD_VIEW.height,
    ));
    this.offsetX = (this.cssWidth - TD_VIEW.width * this.scale) / 2;
    this.offsetY = (this.cssHeight - TD_VIEW.height * this.scale) / 2;
    this.render();
    return this;
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this.lastTimestamp = 0;
    this.scheduleFrame();
    return this;
  }

  scheduleFrame() {
    if (!this.running || this.backgrounded || this.frameId != null) return;
    this.frameId = this.scheduler.request((timestamp) => {
      this.frameId = null;
      this.frame(timestamp);
    });
  }

  frame(timestamp) {
    if (!this.running || this.backgrounded) return;
    const now = Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now();
    const dt = this.lastTimestamp > 0
      ? clamp((now - this.lastTimestamp) / 1000, 0, 0.05)
      : 0;
    this.lastTimestamp = now;
    updateTowerDefense(this.state, dt);
    this.processEvents();
    this.updateCharacterAnimations(dt);
    this.shake = Math.max(0, this.shake - dt * 22);
    this.render();
    this.scheduleFrame();
  }

  processEvents() {
    const events = this.state.events.splice(0);
    this.eventCursor = 0;
    for (const event of events) {
      this.processCharacterAnimationEvent(event);
      if (event.type === 'core-hit') this.shake = Math.min(10, this.shake + 5);
      if (['run-start', 'wave-clear', 'run-end'].includes(event.type)) {
        this.resetHeroInput();
      }
      if (event.type === 'run-end' || event.type === 'tutorial-complete') this.save();
    }
    this.audio.consumeEvents(events, this.state.screen);
    return events;
  }

  onBackground() {
    this.backgrounded = true;
    this.lastTimestamp = 0;
    this.scheduler.cancel(this.frameId);
    this.frameId = null;
    this.cancelInteraction();
    this.audio.onBackground();
    this.save();
    return this;
  }

  onForeground() {
    this.backgrounded = false;
    this.lastTimestamp = 0;
    this.audio.onForeground(this.state.screen);
    this.render();
    this.scheduleFrame();
    return this;
  }

  stop() {
    this.running = false;
    this.scheduler.cancel(this.frameId);
    this.frameId = null;
    this.lastTimestamp = 0;
    this.resetHeroInput();
    return this;
  }

  dispose() {
    this.stop();
    this.save();
    this.canvas.removeEventListener?.('pointerdown', this.boundPointerDown);
    this.canvas.removeEventListener?.('pointermove', this.boundPointerMove);
    this.canvas.removeEventListener?.('pointerup', this.boundPointerUp);
    this.canvas.removeEventListener?.('pointercancel', this.boundPointerCancel);
    this.keyboardTarget?.removeEventListener?.('keydown', this.boundKeyDown);
    this.keyboardTarget?.removeEventListener?.('keyup', this.boundKeyUp);
    this.keyboardTarget?.removeEventListener?.('blur', this.boundWindowBlur);
    this.resetHeroInput();
    this.cancelInteraction();
    this.characterAnimations.clear();
    this.turretPulses.clear();
    this.defeatedActors.length = 0;
    this.defeatedTowers.length = 0;
    this.audio.dispose();
  }

  toGamePoint(eventOrPoint) {
    if (eventOrPoint && Number.isFinite(eventOrPoint.gameX) && Number.isFinite(eventOrPoint.gameY)) {
      return { x: eventOrPoint.gameX, y: eventOrPoint.gameY };
    }
    const rect = canvasRect(this.canvas);
    const touch = eventOrPoint?.changedTouches?.[0] || eventOrPoint?.touches?.[0];
    const clientX = Number(touch?.clientX ?? touch?.pageX ?? eventOrPoint?.clientX ?? eventOrPoint?.x);
    const clientY = Number(touch?.clientY ?? touch?.pageY ?? eventOrPoint?.clientY ?? eventOrPoint?.y);
    return {
      x: (clientX - rect.left - this.offsetX) / this.scale,
      y: (clientY - rect.top - this.offsetY) / this.scale,
    };
  }

  isHeroMovementKey(code) {
    return ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft',
      'ArrowDown', 'ArrowRight'].includes(code);
  }

  syncHeroMovement() {
    let x = 0;
    let y = 0;
    if (this.isHeroControlActive()) {
      if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) x -= 1;
      if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) x += 1;
      if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) y -= 1;
      if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) y += 1;
      if (this.joystick.active) {
        x = this.joystick.x;
        y = this.joystick.y;
      }
    }
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    setTowerDefenseHeroMovement(this.state, x, y);
  }

  updateJoystick(point) {
    const dx = point.x - HERO_JOYSTICK.x;
    const dy = point.y - HERO_JOYSTICK.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const scale = Math.min(1, length / HERO_JOYSTICK.radius);
    this.joystick.active = true;
    this.joystick.x = dx / length * scale;
    this.joystick.y = dy / length * scale;
    this.syncHeroMovement();
  }

  resetHeroInput() {
    this.keysDown.clear();
    this.joystick.active = false;
    this.joystick.x = 0;
    this.joystick.y = 0;
    if (this.state) {
      const reset = setTowerDefenseHeroMovement(this.state, 0, 0);
      if (!reset && this.state.hero) {
        this.state.hero.moveX = 0;
        this.state.hero.moveY = 0;
      }
    }
  }

  handleKeyDown(event) {
    const code = event?.code || event?.key;
    if (!this.isHeroControlActive()) return;
    if (this.isHeroMovementKey(code)) {
      event?.preventDefault?.();
      this.keysDown.add(code);
      this.syncHeroMovement();
      return;
    }
    if ((code === 'Space' || code === ' ') && !event?.repeat) {
      event?.preventDefault?.();
      activateTowerDefenseHeroSkill(this.state);
      this.processEvents();
    }
  }

  handleKeyUp(event) {
    const code = event?.code || event?.key;
    if (!this.isHeroMovementKey(code)) return;
    event?.preventDefault?.();
    this.keysDown.delete(code);
    this.syncHeroMovement();
  }

  purchaseItemsForCategory(category = this.purchaseCategory) {
    const resolved = PURCHASE_CATEGORIES[category] ? category : 'squad';
    const ranks = resolved === 'squad'
      ? this.state.progress?.squadRanks || {}
      : this.state.progress?.turretRanks || {};
    return PURCHASE_ITEMS.filter(({ kind, type }) => (
      kind === resolved && Math.max(0, Math.floor(Number(ranks[type]) || 0)) > 0
    ));
  }

  purchaseTrackMaxOffset(category = this.purchaseCategory) {
    const itemCount = this.purchaseItemsForCategory(category).length;
    const contentWidth = itemCount > 0
      ? itemCount * PURCHASE_CARD_WIDTH + (itemCount - 1) * PURCHASE_CARD_GAP
      : 0;
    return Math.max(0, contentWidth - COMMAND_DOCK.purchaseTrack.width);
  }

  purchaseTrackOffset(category = this.purchaseCategory) {
    const resolved = PURCHASE_CATEGORIES[category] ? category : 'squad';
    return clamp(
      Number(this.purchaseTrackOffsets[resolved]) || 0,
      0,
      this.purchaseTrackMaxOffset(resolved),
    );
  }

  setPurchaseTrackOffset(category, offset) {
    const resolved = PURCHASE_CATEGORIES[category] ? category : 'squad';
    const next = clamp(Number(offset) || 0, 0, this.purchaseTrackMaxOffset(resolved));
    this.purchaseTrackOffsets[resolved] = next;
    return next;
  }

  purchaseCardRect(entry, category = entry?.kind) {
    const entries = this.purchaseItemsForCategory(category);
    const index = entries.indexOf(entry);
    if (index < 0) return null;
    return {
      x: COMMAND_DOCK.purchaseTrack.x
        + index * (PURCHASE_CARD_WIDTH + PURCHASE_CARD_GAP)
        - this.purchaseTrackOffset(category),
      y: COMMAND_DOCK.purchaseTrack.y + 3,
      width: PURCHASE_CARD_WIDTH,
      height: PURCHASE_CARD_HEIGHT,
    };
  }

  hitAt(point, predicate = null) {
    if (!predicate && turretTypeForPurchase(this.selectedPurchase)) {
      for (let index = this.hits.length - 1; index >= 0; index -= 1) {
        const hit = this.hits[index];
        if (
          hit.action === 'build-turret'
          && hit.enabled !== false
          && insideRect(point, hit)
        ) return hit;
      }
    }
    for (let index = this.hits.length - 1; index >= 0; index -= 1) {
      const hit = this.hits[index];
      if (hit.enabled === false || !insideRect(point, hit)) continue;
      if (!predicate || predicate(hit)) return hit;
    }
    return null;
  }

  emptyPadHitAt(point) {
    if (!this.isPreparation()) return null;
    const pads = stageForState(this.state).pads || [];
    let best = null;
    let bestDistance = Infinity;
    pads.forEach((pad, padIndex) => {
      if (towerByPad(this.state, padIndex)) return;
      const rect = {
        x: pad.x - DEPLOY_CELL_SIZE.width / 2,
        y: pad.y - DEPLOY_CELL_SIZE.height / 2,
        width: DEPLOY_CELL_SIZE.width,
        height: DEPLOY_CELL_SIZE.height,
      };
      if (!insideRect(point, rect)) return;
      const distance = pointDistance(point, pad);
      if (distance >= bestDistance) return;
      bestDistance = distance;
      best = {
        id: `pad-${padIndex}`,
        ...rect,
        action: 'pad',
        data: { padIndex },
        enabled: true,
      };
    });
    return best;
  }

  emptyTurretSlotHitAt(point, requestedType = null) {
    if (!this.isPreparation()) return null;
    const turretType = TURRET_TYPES[requestedType]
      ? requestedType
      : turretTypeForPurchase(this.selectedPurchase) || 'gel-mortar';
    const stage = stageForState(this.state);
    const slots = this.turretSlots(stage);
    const turrets = Array.isArray(this.state.turrets) ? this.state.turrets : [];
    for (let slotIndex = slots.length - 1; slotIndex >= 0; slotIndex -= 1) {
      const slot = slots[slotIndex];
      if (turrets.some((turret) => (
        turret.slotIndex === slotIndex || (slot.id && turret.slotId === slot.id)
      ))) continue;
      const x = Number.isFinite(Number(slot.x)) ? Number(slot.x) : 102 + slotIndex * 172;
      const y = Number.isFinite(Number(slot.y)) ? Number(slot.y) : 914;
      const rect = { x: x - 54, y: y - 42, width: 108, height: 100 };
      if (!insideRect(point, rect)) continue;
      return {
        id: typeof slot.id === 'string' && slot.id ? slot.id : `turret-slot-${slotIndex}`,
        ...rect,
        action: 'build-turret',
        data: { slotIndex, slotId: slot.id, turretType },
        enabled: true,
      };
    }
    return null;
  }

  addHit(id, rect, action, data = {}, enabled = true) {
    this.hits.push({ id, ...rect, action, data, enabled });
  }

  summonCurrency() {
    return Math.max(0, Math.floor(Number(this.state.progress?.summonCurrency) || 0));
  }

  tutorialAllows(hit) {
    if (hit?.action === 'toggle-audio') return true;
    if (this.state.screen === 'menu' && this.menuPage === 'summon' && this.summonAnimation) {
      return hit?.action === 'summon-animation-skip';
    }
    if (this.state.screen === 'menu' && this.menuPage === 'summon' && this.summonResults.length) {
      return hit?.action === 'summon-result-close';
    }
    const target = tutorialTargetForState(this.state);
    if (!target || this.state.screen === 'result') return true;
    if (!hit) return false;
    if (target.type === 'stage') {
      if (hit.action === 'open-stage-select' || hit.action === 'stage-select-back') return true;
      return hit.action === 'stage' && hit.data.stageIndex === target.stageIndex;
    }
    if (target.type === 'shop') {
      const offer = this.state.soldierShop?.[target.offerIndex || 0];
      return hit.action === 'buy-soldier' && hit.data.offerUid === offer?.uid;
    }
    if (target.type === 'squad') {
      if (this.selectedPurchase !== target.squadType) {
        return hit.action === 'select-purchase'
          && hit.data.purchaseType === target.squadType;
      }
      return hit.action === 'pad' && hit.data.padIndex === target.padIndex;
    }
    if (target.type === 'draw') return hit.action === 'draw';
    if (target.type === 'pad') {
      return hit.action === 'card'
        || (hit.action === 'pad' && hit.data.padIndex === target.padIndex);
    }
    if (target.type === 'fusion') return hit.action === 'card' || hit.action === 'tower';
    if (target.type === 'start') return hit.action === 'start-wave';
    return true;
  }

  updateLongPressState(now = this.interactionNow()) {
    const drag = this.drag;
    if (drag?.kind !== 'tower' || drag.longPressReady || drag.longPressCancelled) return false;
    const elapsed = Math.max(0, Number(now) - Number(drag.pressStartedAt));
    drag.longPressProgress = clamp(elapsed / LONG_PRESS_MOVE_MS, 0, 1);
    if (drag.longPressProgress < 1) return false;
    drag.longPressReady = true;
    drag.moved = pointDistance(drag.point, drag.start) >= DRAG_THRESHOLD;
    return true;
  }

  handlePointerDown(event) {
    event?.preventDefault?.();
    this.audio.activate(this.state.screen);
    const point = this.toGamePoint(event);
    const hit = this.hitAt(point);
    if (!this.tutorialAllows(hit)) return;
    this.hoverPoint = point;
    if (this.drag) return;
    if (hit?.action === 'hero-skill') {
      this.activateHit(hit);
      return;
    }
    if (hit?.action === 'hero-joystick') {
      this.drag = {
        kind: 'joystick', pointerId: event?.pointerId,
        start: point, point, moved: true,
      };
      this.updateJoystick(point);
    } else if (hit?.action === 'purchase-track') {
      const category = PURCHASE_CATEGORIES[hit.data.purchaseCategory]
        ? hit.data.purchaseCategory : this.purchaseCategory;
      this.drag = {
        kind: 'purchase-scroll', category, pointerId: event?.pointerId,
        scrollStart: this.purchaseTrackOffset(category),
        start: point, point, moved: false,
      };
    } else if (hit?.action === 'select-purchase') {
      const purchase = purchaseItemFor(hit.data.purchaseType);
      const category = PURCHASE_CATEGORIES[purchase?.kind]
        ? purchase.kind : this.purchaseCategory;
      this.drag = {
        kind: 'purchase', purchaseType: hit.data.purchaseType,
        category, scrollStart: this.purchaseTrackOffset(category), gesture: null,
        pointerId: event?.pointerId, hit, start: point, point, moved: false,
      };
    } else if (hit?.action === 'card') {
      this.drag = {
        kind: 'card', uid: hit.data.cardUid, pointerId: event?.pointerId,
        start: point, point, moved: false,
      };
    } else if (hit?.action === 'tower') {
      this.drag = {
        kind: 'tower', uid: hit.data.towerUid, pointerId: event?.pointerId,
        start: point, point, moved: false,
        pressStartedAt: this.interactionNow(), longPressProgress: 0,
        longPressReady: false, longPressCancelled: false,
      };
    } else {
      this.drag = {
        kind: 'tap', pointerId: event?.pointerId,
        hit, start: point, point, moved: false,
      };
    }
    this.canvas.setPointerCapture?.(event?.pointerId);
  }

  handlePointerMove(event) {
    event?.preventDefault?.();
    if (
      this.drag?.pointerId != null
      && event?.pointerId != null
      && event.pointerId !== this.drag.pointerId
    ) return;
    const point = this.toGamePoint(event);
    this.hoverPoint = point;
    if (!this.drag) return;
    this.drag.point = point;
    if (this.drag.kind === 'joystick') {
      this.updateJoystick(point);
      return;
    }
    if (this.drag.kind === 'tower') {
      const distance = pointDistance(point, this.drag.start);
      this.updateLongPressState();
      if (!this.drag.longPressReady) {
        if (distance >= LONG_PRESS_DRIFT) {
          this.drag.longPressCancelled = true;
          this.drag.longPressProgress = 0;
        }
        return;
      }
      if (distance >= DRAG_THRESHOLD) this.drag.moved = true;
      return;
    }
    if (this.drag.kind === 'purchase-scroll') {
      const deltaX = point.x - this.drag.start.x;
      this.drag.moved = this.drag.moved || Math.abs(deltaX) >= DRAG_THRESHOLD;
      this.setPurchaseTrackOffset(
        this.drag.category,
        this.drag.scrollStart - deltaX,
      );
      return;
    }
    if (this.drag.kind === 'purchase') {
      const deltaX = point.x - this.drag.start.x;
      const deltaY = point.y - this.drag.start.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);
      if (!this.drag.gesture && Math.max(absX, absY) >= DRAG_THRESHOLD) {
        this.drag.moved = true;
        if (absX >= absY * 1.35) this.drag.gesture = 'scroll';
        else if (absY >= absX * 1.15) this.drag.gesture = 'deploy';
      }
      if (this.drag.gesture === 'scroll') {
        this.drag.kind = 'purchase-scroll';
        this.drag.moved = true;
        this.setPurchaseTrackOffset(
          this.drag.category,
          this.drag.scrollStart - deltaX,
        );
        return;
      }
      if (this.drag.gesture === 'deploy') this.drag.moved = true;
      return;
    }
    if (pointDistance(point, this.drag.start) >= DRAG_THRESHOLD) this.drag.moved = true;
  }

  handlePointerUp(event) {
    event?.preventDefault?.();
    if (
      this.drag?.pointerId != null
      && event?.pointerId != null
      && event.pointerId !== this.drag.pointerId
    ) {
      this.canvas.releasePointerCapture?.(event.pointerId);
      return;
    }
    const point = this.toGamePoint(event);
    this.updateLongPressState();
    const drag = this.drag;
    this.drag = null;
    this.canvas.releasePointerCapture?.(event?.pointerId);
    if (!drag) return;

    if (drag.kind === 'joystick') {
      this.joystick.active = false;
      this.joystick.x = 0;
      this.joystick.y = 0;
      this.syncHeroMovement();
      return;
    }

    if (drag.kind === 'purchase-scroll') return;

    if (drag.kind === 'purchase') {
      if (!drag.moved) {
        if (drag.hit && this.tutorialAllows(drag.hit)) this.activateHit(drag.hit);
        return;
      }
      if (drag.gesture !== 'deploy') return;
      const purchase = purchaseItemFor(drag.purchaseType);
      if (purchase?.kind === 'turret') {
        const turretHit = this.emptyTurretSlotHitAt(point, purchase.type);
        if (turretHit) buildTowerDefenseTurret(
          this.state, turretHit.data.slotIndex, purchase.type,
        );
      } else if (purchase?.kind === 'squad' && isSquadType(purchase.type)) {
        const padHit = this.emptyPadHitAt(point);
        const target = tutorialTargetForState(this.state);
        const tutorialMatches = !target || target.type !== 'squad'
          || (target.squadType === purchase.type && target.padIndex === padHit?.data.padIndex);
        if (padHit && tutorialMatches) {
          buyTowerDefenseSquad(this.state, purchase.type, padHit.data.padIndex);
        }
      }
      this.selectedPurchase = null;
      this.processEvents();
      return;
    }

    if (drag.kind === 'card') {
      const towerHit = this.hitAt(point, (hit) => hit.action === 'tower');
      const padHit = this.hitAt(point, (hit) => hit.action === 'pad')
        || this.emptyPadHitAt(point);
      if (drag.moved && towerHit && this.tutorialAllows(towerHit)) {
        this.tryMergeCard(drag.uid, towerHit.data.towerUid);
      } else if (drag.moved && padHit && this.tutorialAllows(padHit)) {
        this.placeCard(drag.uid, padHit.data.padIndex);
      } else {
        this.selectCard(drag.uid);
      }
      return;
    }
    if (drag.kind === 'tower') {
      const towerHit = this.hitAt(point, (hit) => hit.action === 'tower');
      const padHit = this.hitAt(point, (hit) => hit.action === 'pad')
        || this.emptyPadHitAt(point);
      if (drag.moved && insideRect(point, COMMAND_DOCK.reclaim)) {
        this.reclaimTower(drag.uid);
      } else if (drag.moved && towerHit && towerHit.data.towerUid !== drag.uid) {
        this.tryMerge(drag.uid, towerHit.data.towerUid);
      } else if (drag.moved && padHit) {
        this.moveTower(drag.uid, padHit.data.padIndex);
      } else {
        this.selectOrMergeTower(drag.uid);
      }
      return;
    }
    if (!drag.moved && drag.hit && this.tutorialAllows(drag.hit)) this.activateHit(drag.hit);
  }

  handlePointerCancel(event) {
    if (
      this.drag?.pointerId != null
      && event?.pointerId != null
      && event.pointerId !== this.drag.pointerId
    ) return;
    this.cancelInteraction();
  }

  cancelInteraction() {
    this.drag = null;
    this.hoverPoint = null;
    this.resetHeroInput();
  }

  selectCard(cardUid) {
    if (!this.state.hand.some((card) => card.uid === cardUid)) return;
    this.selectedCardUid = this.selectedCardUid === cardUid ? null : cardUid;
    this.state.selectedTowerUid = null;
  }

  placeCard(cardUid, padIndex) {
    const tower = placeTowerFromHand(this.state, cardUid, padIndex);
    if (!tower) return false;
    this.selectedCardUid = null;
    this.state.selectedTowerUid = tower.uid;
    return true;
  }

  tryMerge(sourceUid, targetUid) {
    const merged = mergeTowers(this.state, sourceUid, targetUid);
    if (!merged) return false;
    this.state.selectedTowerUid = merged.uid;
    return true;
  }

  tryMergeCard(cardUid, targetUid) {
    const merged = mergeCardIntoTower(this.state, cardUid, targetUid);
    if (!merged) return false;
    this.selectedCardUid = null;
    this.state.selectedTowerUid = merged.uid;
    return true;
  }

  moveTower(towerUid, padIndex) {
    const moved = moveTowerToPad(this.state, towerUid, padIndex);
    if (!moved) return false;
    this.selectedCardUid = null;
    this.state.selectedTowerUid = moved.uid;
    return true;
  }

  reclaimTower(towerUid) {
    const card = reclaimTowerToHand(this.state, towerUid);
    if (!card) return false;
    this.state.selectedTowerUid = null;
    this.selectedCardUid = card.uid;
    return true;
  }

  selectOrMergeTower(towerUid) {
    const selected = this.state.selectedTowerUid;
    if (this.selectedCardUid) {
      this.tryMergeCard(this.selectedCardUid, towerUid);
      return;
    }
    if (selected && selected !== towerUid) {
      const source = this.state.towers.find((tower) => tower.uid === selected);
      const target = this.state.towers.find((tower) => tower.uid === towerUid);
      if (canMergeTowers(source, target)) {
        this.tryMerge(selected, towerUid);
        return;
      }
    }
    this.state.selectedTowerUid = selected === towerUid ? null : towerUid;
  }

  activateHit(hit) {
    if (hit.action === 'toggle-audio') {
      if (this.audio.enabled) this.audio.playUiTap();
      this.audio.toggle(this.state.screen);
      return;
    }
    this.audio.playUiTap();
    switch (hit.action) {
      case 'open-stage-select':
        if (this.state.screen === 'menu') {
          this.menuPage = 'stage-select';
          this.stageSelectPage = 0;
          this.selectedCardUid = null;
          this.state.selectedTowerUid = null;
        }
        break;
      case 'stage-select-back':
        this.menuPage = 'main';
        break;
      case 'stage-select-previous':
        if (this.menuPage === 'stage-select') {
          this.stageSelectPage = Math.max(0, this.stageSelectPage - 1);
        }
        break;
      case 'stage-select-next':
        if (this.menuPage === 'stage-select') {
          const pageCount = Math.max(1, Math.ceil(TD_STAGES.length / STAGE_SELECT_PAGE_SIZE));
          this.stageSelectPage = Math.min(pageCount - 1, this.stageSelectPage + 1);
        }
        break;
      case 'open-roster':
        if (this.state.screen === 'menu') {
          this.menuPage = 'roster';
          const heroTypes = Object.keys(HERO_TYPES);
          const selectedType = this.state.progress?.selectedHero || this.state.selectedHeroId;
          this.rosterInspectType = heroTypes.includes(selectedType)
            ? selectedType : heroTypes[0] || 'shell';
          this.rosterPage = Math.floor(
            Math.max(0, heroTypes.indexOf(this.rosterInspectType)) / ROSTER_PAGE_SIZE,
          );
          this.selectedCardUid = null;
          this.state.selectedTowerUid = null;
        }
        break;
      case 'roster-back':
        this.menuPage = 'main';
        break;
      case 'inspect-hero':
        if (this.menuPage === 'roster' && HERO_TYPES[hit.data.heroType]) {
          this.rosterInspectType = hit.data.heroType;
        }
        break;
      case 'roster-previous':
        if (this.menuPage === 'roster') this.rosterPage = Math.max(0, this.rosterPage - 1);
        break;
      case 'roster-next':
        if (this.menuPage === 'roster') {
          const pageCount = Math.max(1, Math.ceil(Object.keys(HERO_TYPES).length / ROSTER_PAGE_SIZE));
          this.rosterPage = Math.min(pageCount - 1, this.rosterPage + 1);
        }
        break;
      case 'open-summon':
        if (this.state.screen === 'menu') {
          this.menuPage = 'summon';
          this.summonResults = [];
          this.summonAnimation = null;
          this.state.summonResults = [];
          this.selectedCardUid = null;
          this.state.selectedTowerUid = null;
        }
        break;
      case 'summon-back':
        this.menuPage = 'main';
        this.summonResults = [];
        this.summonAnimation = null;
        this.state.summonResults = [];
        break;
      case 'summon-one':
      case 'summon-ten': {
        if (this.summonAnimation || this.summonResults.length) break;
        const count = hit.action === 'summon-ten' ? 10 : 1;
        const results = summonTowerDefenseContracts(this.state, count);
        if (Array.isArray(results) && results.length) {
          this.summonResults = [];
          this.summonAnimation = { results: [...results], elapsed: 0 };
        }
        this.save();
        break;
      }
      case 'summon-animation-skip':
        this.completeSummonAnimation();
        break;
      case 'summon-result-close':
        this.summonResults = [];
        this.summonAnimation = null;
        this.state.summonResults = [];
        break;
      case 'select-hero':
        if (this.menuPage === 'roster'
          && selectTowerDefenseHero(this.state, hit.data.heroType)) {
          this.processEvents();
          this.save();
        }
        break;
      case 'stage':
        if (beginTowerDefenseRun(this.state, {
          mode: 'stage', stageId: hit.data.stageId,
        })) {
          this.menuPage = 'main';
          this.selectedPurchase = null;
          this.selectedCardUid = null;
          this.eventCursor = 0;
        }
        break;
      case 'endless':
        if (this.endlessUnlocked()) {
          beginTowerDefenseRun(this.state, {
            mode: 'endless', stageId: TD_STAGES.at(-1)?.id || TD_STAGES[0]?.id,
          });
          this.menuPage = 'main';
          this.selectedPurchase = null;
          this.selectedCardUid = null;
          this.eventCursor = 0;
        }
        break;
      case 'draw': {
        const card = drawTowerCard(this.state);
        if (card) this.selectedCardUid = card.uid;
        break;
      }
      case 'select-purchase-category': {
        const category = hit.data.purchaseCategory;
        if (!PURCHASE_CATEGORIES[category]) break;
        this.purchaseCategory = category;
        const selected = purchaseItemFor(this.selectedPurchase);
        if (selected && selected.kind !== category) this.selectedPurchase = null;
        this.selectedCardUid = null;
        this.state.selectedTowerUid = null;
        break;
      }
      case 'select-purchase':
        this.selectedPurchase = this.selectedPurchase === hit.data.purchaseType
          ? null : hit.data.purchaseType;
        this.selectedCardUid = null;
        this.state.selectedTowerUid = null;
        break;
      case 'build-turret': {
        const turretType = turretTypeForPurchase(this.selectedPurchase);
        const turret = turretType && turretType === hit.data.turretType
          ? buildTowerDefenseTurret(this.state, hit.data.slotIndex, turretType)
          : null;
        if (turret) this.selectedPurchase = null;
        this.processEvents();
        break;
      }
      case 'pad': {
        const squadType = squadTypeForPurchase(this.selectedPurchase);
        if (squadType) {
          const squad = buyTowerDefenseSquad(
            this.state,
            squadType,
            hit.data.padIndex,
          );
          if (squad) this.selectedPurchase = null;
          this.processEvents();
        }
        else if (this.selectedCardUid) this.placeCard(this.selectedCardUid, hit.data.padIndex);
        else {
          const tower = towerByPad(this.state, hit.data.padIndex);
          if (tower) this.selectOrMergeTower(tower.uid);
        }
        break;
      }
      case 'tower':
        this.selectOrMergeTower(hit.data.towerUid);
        break;
      case 'reclaim':
        if (this.state.selectedTowerUid) this.reclaimTower(this.state.selectedTowerUid);
        break;
      case 'start-wave':
        this.selectedPurchase = null;
        if (this.state.waveBreak > 0) skipTowerDefenseBreak(this.state);
        else startNextTowerDefenseWave(this.state);
        this.processEvents();
        break;
      case 'hero-skill':
        activateTowerDefenseHeroSkill(this.state);
        this.processEvents();
        break;
      case 'battle-menu':
        this.resetHeroInput();
        returnToTowerDefenseMenu(this.state);
        this.menuPage = 'main';
        this.selectedPurchase = null;
        this.selectedCardUid = null;
        this.save();
        break;
      case 'replay':
        replayTowerDefenseRun(this.state);
        this.selectedPurchase = null;
        this.selectedCardUid = null;
        this.eventCursor = 0;
        break;
      case 'result-menu':
        returnToTowerDefenseMenu(this.state);
        this.menuPage = 'main';
        this.selectedPurchase = null;
        this.selectedCardUid = null;
        this.save();
        break;
      case 'next-stage': {
        const stage = stageForState(this.state);
        const next = TD_STAGES[stage.index];
        if (next) beginTowerDefenseRun(this.state, { mode: 'stage', stageId: next.id });
        else returnToTowerDefenseMenu(this.state);
        this.selectedPurchase = null;
        this.selectedCardUid = null;
        this.eventCursor = 0;
        break;
      }
      default:
        break;
    }
  }

  endlessUnlocked() {
    const finalStageId = TD_STAGES.at(-1)?.id;
    return Boolean(finalStageId && this.state.progress.clearedStages.includes(finalStageId));
  }

  resetTransform() {
    const ctx = this.ctx;
    if (typeof ctx.setTransform === 'function') {
      ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    } else if (typeof ctx.resetTransform === 'function') {
      ctx.resetTransform();
      ctx.scale(this.pixelRatio, this.pixelRatio);
    }
  }

  render() {
    const ctx = this.ctx;
    this.audio.syncScreen(this.state.screen);
    this.updateLongPressState();
    this.hits = [];
    this.resetTransform();
    ctx.save();
    ctx.fillStyle = '#D9EEE2';
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    if (this.state.screen === 'menu') {
      if (this.menuPage === 'stage-select') this.drawStageSelect(ctx);
      else if (this.menuPage === 'summon') this.drawSummonPage(ctx);
      else if (this.menuPage === 'roster') this.drawHeroRosterPage(ctx);
      else this.drawMenu(ctx);
    }
    else if (this.state.screen === 'result') this.drawResult(ctx);
    else this.drawBattle(ctx);
    this.drawAudioToggle(ctx);
    if (this.state.tutorial.active) this.drawTutorial(ctx);
    ctx.restore();
    return this;
  }

  drawAudioToggle(ctx) {
    const rect = AUDIO_TOGGLE_RECT;
    ctx.save();
    ctx.shadowColor = 'rgba(22, 54, 58, 0.22)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    panel(ctx, rect, {
      fill: 'rgba(255, 248, 233, 0.92)',
      stroke: this.audio.enabled ? '#4A9B79' : '#87948E',
      radius: 15,
    });
    ctx.shadowColor = 'transparent';
    const assetKey = this.audio.enabled ? 'ui-audio-on' : 'ui-audio-off';
    drawAssetOrFallback(ctx, this.assetStore, assetKey, (asset) => {
      ctx.drawImage(asset, rect.x + 7, rect.y + 7, rect.width - 14, rect.height - 14);
    }, () => {
      label(ctx, this.audio.enabled ? '♪' : '×', rect.x + rect.width / 2,
        rect.y + rect.height / 2 + 1, {
          size: 24, color: this.audio.enabled ? COLORS.mintDeep : COLORS.inkSoft, weight: 950,
        });
    });
    ctx.restore();
    this.addHit('audio-toggle', rect, 'toggle-audio');
  }

  drawBackdrop(ctx, stageId = 'stage-1') {
    const background = ctx.createLinearGradient(0, 0, TD_VIEW.width, TD_VIEW.height);
    background.addColorStop(0, '#C7EAD4');
    background.addColorStop(0.52, '#E9E7C5');
    background.addColorStop(1, '#BBDDE4');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    const key = stageRegionAssetKey(stageId);
    drawAssetOrFallback(ctx, this.assetStore, key, (asset) => {
      ctx.globalAlpha *= 0.78;
      drawCoverImage(ctx, asset);
    }, () => {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#55AE80';
      for (let index = 0; index < 28; index += 1) {
        const x = (index * 173) % TD_VIEW.width;
        const y = (index * 97) % TD_VIEW.height;
        ctx.beginPath();
        ctx.arc(x, y, 22 + (index % 4) * 8, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  drawFriendlyCharacter(ctx, x, y, size, type, options = {}) {
    const atlasAssetKey = HERO_ATLAS_ASSET_BY_TYPE[type];
    if (atlasAssetKey) {
      return drawAtlasCharacter(ctx, x, y, size, {
        ...options,
        assetKey: atlasAssetKey,
        assetStore: this.assetStore,
      });
    }
    return drawSlime(ctx, x, y, size, type, {
      ...options,
      assetStore: this.assetStore,
    });
  }

  menuStoryStage() {
    if (this.state.tutorial.active) return TD_STAGES[0];
    const unlocked = TD_STAGES.filter((stage) => (
      stage.index <= this.state.progress.unlockedStage
    ));
    const uncleared = unlocked.filter((stage) => (
      !this.state.progress.clearedStages.includes(stage.id)
    ));
    return uncleared.at(-1) || unlocked.at(-1) || TD_STAGES[0];
  }

  drawMenuTacticalDiorama(ctx) {
    const columns = 5;
    const rows = 5;
    const cellWidth = 96;
    const cellHeight = 66;
    const gapX = 2;
    const gapY = 10;
    const startX = (TD_VIEW.width - (columns * cellWidth + (columns - 1) * gapX)) / 2;
    const startY = 272;

    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#214F4D';
    ctx.beginPath();
    ctx.ellipse(TD_VIEW.width / 2, 620, 284, 176, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    const tilePositions = {
      'tile-build-light': [],
      'tile-build-dark': [],
    };
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const key = (row + column) % 2 ? 'tile-build-dark' : 'tile-build-light';
        tilePositions[key].push({
          x: startX + column * (cellWidth + gapX),
          y: startY + row * (cellHeight + gapY),
        });
      }
    }
    for (const [key, positions] of Object.entries(tilePositions)) {
      drawAssetOrFallback(ctx, this.assetStore, key, (asset) => {
        ctx.globalAlpha *= 0.72;
        for (const { x, y } of positions) {
          ctx.drawImage(asset, x, y, cellWidth, cellHeight);
        }
      }, () => {});
    }

    drawAssetOrFallback(ctx, this.assetStore, 'tile-route-open', (asset) => {
      ctx.save();
      ctx.globalAlpha *= 0.92;
      ctx.translate(TD_VIEW.width / 2, 512);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(asset, -190, -14, 380, 28);
      ctx.restore();
      ctx.globalAlpha *= 0.7;
      ctx.drawImage(asset, 174, 515, 372, 26);
    }, () => {});

    drawAssetOrFallback(ctx, this.assetStore, 'turret-gel-mount', (asset) => {
      ctx.globalAlpha *= 0.92;
      for (const x of [174, 546]) {
        ctx.drawImage(asset, x - 51, 559, 102, 53);
      }
    }, () => {});

    drawPortal(ctx, TD_VIEW.width / 2, 424, 158, {
      time: this.state.time,
      open: 0.86 + Math.sin(this.state.time * 1.7) * 0.08,
      assetStore: this.assetStore,
    });
    drawCore(ctx, TD_VIEW.width / 2, 824, 242, {
      assetKey: 'fortress-slime-core',
      ...FORTRESS_CORE_ASSET_LAYOUT,
      time: this.state.time,
      health: 1,
      assetStore: this.assetStore,
    });
  }

  drawMenu(ctx) {
    ctx.fillStyle = '#B9E4D2';
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    drawAssetOrFallback(ctx, this.assetStore, 'background-menu-portrait-v1', (asset) => {
      drawCoverImage(ctx, asset);
    }, () => {
      drawAssetOrFallback(ctx, this.assetStore, 'background-garden-base', (asset) => {
        drawCoverImage(ctx, asset);
      }, () => this.drawBackdrop(ctx, 'stage-1'));
    });

    const wash = ctx.createLinearGradient(0, 0, 0, TD_VIEW.height);
    wash.addColorStop(0, 'rgba(255, 252, 232, 0.5)');
    wash.addColorStop(0.5, 'rgba(226, 251, 231, 0.08)');
    wash.addColorStop(0.77, 'rgba(33, 85, 78, 0.08)');
    wash.addColorStop(1, 'rgba(18, 53, 60, 0.38)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);

    label(ctx, '史莱姆守望团', TD_VIEW.width / 2, 112, {
      size: 46, color: COLORS.ink, weight: 950,
    });
    const stageMarkerGap = TD_STAGES.length > 1
      ? Math.min(28, 238 / (TD_STAGES.length - 1)) : 0;
    const stageMarkerStart = TD_VIEW.width / 2
      - stageMarkerGap * Math.max(0, TD_STAGES.length - 1) / 2;
    TD_STAGES.forEach((stage, index) => {
      const x = stageMarkerStart + index * stageMarkerGap;
      const cleared = this.state.progress.clearedStages.includes(stage.id);
      const unlocked = stage.index <= this.state.progress.unlockedStage;
      ctx.save();
      if (unlocked && !cleared) {
        ctx.shadowColor = stage.accent;
        ctx.shadowBlur = 11;
      }
      ctx.beginPath();
      ctx.moveTo(x, 161);
      ctx.lineTo(x + 9, 170);
      ctx.lineTo(x, 179);
      ctx.lineTo(x - 9, 170);
      ctx.closePath();
      ctx.fillStyle = cleared ? stage.accent : unlocked ? '#FFF8DF' : '#AAB5AF';
      ctx.fill();
      ctx.strokeStyle = unlocked ? stage.accent : '#87948E';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    });

    this.drawMenuTacticalDiorama(ctx);

    const storyStage = this.menuStoryStage();
    const storyRect = MENU_ACTIONS.story;
    const storyHot = Boolean(this.hoverPoint && insideRect(this.hoverPoint, storyRect));
    ctx.save();
    ctx.shadowColor = 'rgba(17, 59, 58, 0.34)';
    ctx.shadowBlur = storyHot ? 22 : 14;
    ctx.shadowOffsetY = 8;
    roundedPath(ctx, storyRect.x, storyRect.y, storyRect.width, storyRect.height, 32);
    ctx.fillStyle = storyHot ? '#75DDB0' : '#64D3A0';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = storyHot ? '#176E59' : COLORS.mintDeep;
    ctx.lineWidth = storyHot ? 5 : 3;
    ctx.stroke();
    ctx.globalAlpha = 0.48;
    ctx.strokeStyle = '#E9FFF1';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(storyRect.x + 38, storyRect.y + 20);
    ctx.lineTo(storyRect.x + storyRect.width - 98, storyRect.y + 20);
    ctx.stroke();
    ctx.restore();
    label(ctx, '开始闯关', storyRect.x + storyRect.width / 2 - 20,
      storyRect.y + storyRect.height / 2, {
        size: 32, color: COLORS.white, weight: 950,
      });
    const allCleared = TD_STAGES.every((stage) => (
      this.state.progress.clearedStages.includes(stage.id)
    ));
    ctx.save();
    ctx.beginPath();
    const stageBadgeX = storyRect.x + storyRect.width - 54;
    const stageBadgeY = storyRect.y + storyRect.height / 2;
    ctx.moveTo(stageBadgeX, stageBadgeY - 31);
    ctx.lineTo(stageBadgeX + 31, stageBadgeY);
    ctx.lineTo(stageBadgeX, stageBadgeY + 31);
    ctx.lineTo(stageBadgeX - 31, stageBadgeY);
    ctx.closePath();
    ctx.fillStyle = '#FFF4C8';
    ctx.fill();
    ctx.strokeStyle = '#2C8B6E';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
    label(ctx, allCleared ? `${TD_STAGES.length}↻` : String(storyStage.index),
      storyRect.x + storyRect.width - 54,
      storyRect.y + storyRect.height / 2, {
        size: allCleared ? 18 : 24, color: COLORS.mintDeep, weight: 950,
    });
    this.addHit('start-story', storyRect, 'open-stage-select');

    const secondaryShelf = {
      x: MENU_ACTIONS.endless.x,
      y: MENU_ACTIONS.endless.y,
      width: MENU_ACTIONS.summon.x + MENU_ACTIONS.summon.width - MENU_ACTIONS.endless.x,
      height: MENU_ACTIONS.endless.height,
    };
    ctx.save();
    roundedPath(ctx, secondaryShelf.x, secondaryShelf.y,
      secondaryShelf.width, secondaryShelf.height, 28);
    ctx.fillStyle = 'rgba(245, 249, 224, 0.88)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(42, 78, 73, 0.68)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(67, 102, 91, 0.3)';
    ctx.lineWidth = 2;
    [284, 474].forEach((separatorX) => {
      ctx.beginPath();
      ctx.moveTo(separatorX, secondaryShelf.y + 18);
      ctx.lineTo(separatorX, secondaryShelf.y + secondaryShelf.height - 18);
      ctx.stroke();
    });
    ctx.restore();

    const endlessUnlocked = this.endlessUnlocked();
    const endlessRect = MENU_ACTIONS.endless;
    const endlessHot = endlessUnlocked
      && Boolean(this.hoverPoint && insideRect(this.hoverPoint, endlessRect));
    if (endlessHot) {
      ctx.save();
      ctx.strokeStyle = '#8175DC';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(endlessRect.x + 34, endlessRect.y + endlessRect.height - 13);
      ctx.lineTo(endlessRect.x + endlessRect.width - 34,
        endlessRect.y + endlessRect.height - 13);
      ctx.stroke();
      ctx.restore();
    }
    label(ctx, endlessUnlocked ? '∞  无尽模式' : '锁  无尽模式',
      endlessRect.x + endlessRect.width / 2,
      endlessRect.y + endlessRect.height / 2 - (endlessUnlocked ? 0 : 8), {
        size: endlessUnlocked ? 22 : 20,
        color: endlessUnlocked ? '#5B4EAA' : '#75817B',
        weight: 950,
      });
    if (!endlessUnlocked) {
      label(ctx, `${TD_STAGES.length} ✓`, endlessRect.x + endlessRect.width / 2,
        endlessRect.y + endlessRect.height - 22, {
          size: 13, color: '#75817B', weight: 850,
        });
    }
    this.addHit('endless', endlessRect, 'endless', {}, endlessUnlocked);

    const rosterRect = MENU_ACTIONS.roster;
    const rosterHot = Boolean(this.hoverPoint && insideRect(this.hoverPoint, rosterRect));
    const selectedHeroType = this.state.progress?.selectedHero
      || this.state.selectedHeroId || 'shell';
    const selectedHero = HERO_TYPES[selectedHeroType] || HERO_TYPES.shell;
    const selectedRarity = rarityStyle(selectedHero.rarity);
    if (rosterHot) {
      ctx.save();
      ctx.strokeStyle = selectedRarity.color;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(rosterRect.x + 24, rosterRect.y + rosterRect.height - 13);
      ctx.lineTo(rosterRect.x + rosterRect.width - 24,
        rosterRect.y + rosterRect.height - 13);
      ctx.stroke();
      ctx.restore();
    }
    label(ctx, '英雄编队', rosterRect.x + rosterRect.width / 2,
      rosterRect.y + 34, {
        size: 20, color: COLORS.ink, weight: 950,
      });
    label(ctx, `${selectedRarity.label} · ${selectedHero.name}`,
      rosterRect.x + rosterRect.width / 2, rosterRect.y + 70, {
        size: 15, color: selectedRarity.deep, weight: 900,
      });
    this.addHit('open-roster', rosterRect, 'open-roster');

    const summonRect = MENU_ACTIONS.summon;
    const summonHot = Boolean(this.hoverPoint && insideRect(this.hoverPoint, summonRect));
    if (summonHot) {
      ctx.save();
      ctx.strokeStyle = '#D49A35';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(summonRect.x + 28, summonRect.y + summonRect.height - 13);
      ctx.lineTo(summonRect.x + summonRect.width - 28,
        summonRect.y + summonRect.height - 13);
      ctx.stroke();
      ctx.restore();
    }
    label(ctx, '战团招募', summonRect.x + summonRect.width / 2,
      summonRect.y + 35, {
        size: 18, color: COLORS.ink, weight: 950,
      });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-soft-crystal', (asset) => {
      ctx.drawImage(asset, summonRect.x + 32, summonRect.y + 57, 28, 28);
    }, () => {
      label(ctx, '◆', summonRect.x + 46, summonRect.y + 72, {
        size: 18, color: COLORS.crystal, weight: 950,
      });
    });
    label(ctx, this.summonCurrency(), summonRect.x + 68, summonRect.y + 72, {
      size: 17, align: 'left', color: COLORS.inkSoft, weight: 900,
    });
    this.addHit('open-summon', summonRect, 'open-summon');
  }

  drawRosterHeroPortrait(ctx, type, x, y, size, { locked = false, phase = 0 } = {}) {
    const heroDefinition = HERO_TYPES[type] || TOWER_TYPES[type] || HERO_TYPES.shell;
    const visualType = heroDefinition?.visualType || type;
    const ownerId = heroDefinition?.ownerId || TOWER_TYPES[visualType]?.ownerId;
    const drawPortrait = () => {
      if (HERO_ATLAS_ASSET_BY_TYPE[visualType] || TOWER_TYPES[visualType]) {
        const animation = ownerId
          ? this.characterAnimationSample(`preview:roster:${type}`, ownerId)
          : {};
        this.drawFriendlyCharacter(ctx, x, y, size, visualType, {
          time: this.state.time + phase,
          facing: phase % 0.34 > 0.17 ? -1 : 1,
          ...animation,
          ...this.characterRigOptions(ownerId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
        });
        return;
      }

      const portraitAssetKey = heroDefinition?.portraitAssetKey
        || heroDefinition?.assetKey || ownerId;
      if (!portraitAssetKey) return;
      drawAssetOrFallback(ctx, this.assetStore, portraitAssetKey, (asset) => {
        const sourceWidth = Number(asset?.naturalWidth || asset?.width) || 1;
        const sourceHeight = Number(asset?.naturalHeight || asset?.height) || 1;
        const fit = size / Math.max(sourceWidth, sourceHeight);
        const width = sourceWidth * fit;
        const height = sourceHeight * fit;
        ctx.drawImage(asset, x - width / 2, y - height, width, height);
      }, () => {});
    };
    if (locked) drawLockedMonochrome(ctx, drawPortrait);
    else drawPortrait();
  }

  drawHeroRosterPage(ctx) {
    ctx.fillStyle = '#B9E4D2';
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    drawAssetOrFallback(ctx, this.assetStore, 'background-menu-portrait-v1', (asset) => {
      drawCoverImage(ctx, asset);
    }, () => this.drawBackdrop(ctx, 'stage-1'));
    const wash = ctx.createLinearGradient(0, 0, 0, TD_VIEW.height);
    wash.addColorStop(0, 'rgba(248,255,237,0.82)');
    wash.addColorStop(0.62, 'rgba(168,232,207,0.44)');
    wash.addColorStop(1, 'rgba(39,72,78,0.48)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);

    panel(ctx, ROSTER_BACK_RECT, {
      fill: '#FFF8E8', stroke: '#85978E', lineWidth: 3, radius: 22, shadow: true,
    });
    label(ctx, '返回', ROSTER_BACK_RECT.x + ROSTER_BACK_RECT.width / 2,
      ROSTER_BACK_RECT.y + ROSTER_BACK_RECT.height / 2, {
        size: 21, color: COLORS.ink, weight: 900,
      });
    this.addHit('roster-back', ROSTER_BACK_RECT, 'roster-back');
    label(ctx, '英雄编队', TD_VIEW.width / 2, 72, {
      size: 40, color: COLORS.ink, weight: 950,
    });
    label(ctx, '已解锁英雄可查看数值与技能', TD_VIEW.width / 2, 116, {
      size: 17, color: COLORS.inkSoft, weight: 850,
    });

    const heroTypes = Object.keys(HERO_TYPES);
    const contractRanks = this.state.progress?.contractRanks || {};
    const selectedType = this.state.progress?.selectedHero
      || this.state.selectedHeroId || heroTypes[0] || 'shell';
    if (!heroTypes.includes(this.rosterInspectType)) this.rosterInspectType = selectedType;
    const pageCount = Math.max(1, Math.ceil(heroTypes.length / ROSTER_PAGE_SIZE));
    this.rosterPage = clamp(Math.floor(Number(this.rosterPage) || 0), 0, pageCount - 1);
    const pageStart = this.rosterPage * ROSTER_PAGE_SIZE;
    const visibleTypes = heroTypes.slice(pageStart, pageStart + ROSTER_PAGE_SIZE);
    let ownedCount = 0;
    heroTypes.forEach((type) => {
      if (Math.max(0, Math.floor(Number(contractRanks[type]) || 0)) > 0) ownedCount += 1;
    });
    visibleTypes.forEach((type, index) => {
      const rect = rosterHeroRect(index);
      const heroDefinition = HERO_TYPES[type] || TOWER_TYPES[type];
      const rank = Math.max(0, Math.floor(Number(contractRanks[type]) || 0));
      const owned = rank > 0;
      const selected = type === selectedType;
      const inspected = type === this.rosterInspectType;
      const hot = Boolean(this.hoverPoint && insideRect(this.hoverPoint, rect));
      const rarity = rarityStyle(heroDefinition.rarity);
      panel(ctx, rect, {
        fill: owned ? selected ? '#FFF4CC' : '#F5FFF5' : '#C8CCCA',
        stroke: !owned ? inspected ? '#555D5A' : '#7B827F'
          : inspected ? '#2F8B72' : selected ? '#E5A93F' : rarity.color,
        lineWidth: inspected || hot ? 5 : selected ? 4 : 3,
        radius: 22,
        shadow: owned,
      });
      if (owned) {
        panel(ctx, { x: rect.x + 10, y: rect.y + 9, width: 44, height: 26 }, {
          fill: rarity.fill,
          stroke: rarity.color, lineWidth: 2, radius: 11,
        });
        label(ctx, rarity.label, rect.x + 32, rect.y + 22, {
          size: rarity.label.length > 2 ? 11 : 14,
          color: rarity.deep, weight: 950,
        });
      }
      label(ctx, heroDefinition.name, rect.x + rect.width - 10, rect.y + 22, {
        size: 17, align: 'right', color: owned ? COLORS.ink : '#4E5552', weight: 950,
      });
      this.drawRosterHeroPortrait(ctx, type, rect.x + rect.width / 2,
        rect.y + rect.height - 5, 94, { locked: !owned, phase: index * 0.17 });
      if (!owned) {
        panel(ctx, { x: rect.x + 34, y: rect.y + rect.height - 31, width: 91, height: 24 }, {
          fill: '#8D9390', stroke: '#626865', lineWidth: 1.5, radius: 10,
        });
        label(ctx, '未解锁', rect.x + rect.width / 2, rect.y + rect.height - 19, {
          size: 13, color: '#F2F3F2', weight: 950,
          });
      }
      this.addHit(`hero-inspect-${type}`, rect, 'inspect-hero', { heroType: type });
    });

    if (pageCount > 1) {
      button(ctx, ROSTER_PREVIOUS_RECT, '‹', {
        enabled: this.rosterPage > 0, fill: '#F4F8ED', color: COLORS.ink,
        accent: '#81938A', size: 28,
      });
      button(ctx, ROSTER_NEXT_RECT, '›', {
        enabled: this.rosterPage < pageCount - 1, fill: '#F4F8ED', color: COLORS.ink,
        accent: '#81938A', size: 28,
      });
      label(ctx, `${this.rosterPage + 1}/${pageCount}`, TD_VIEW.width / 2, 490, {
        size: 16, color: COLORS.inkSoft, weight: 900,
      });
      this.addHit('roster-previous', ROSTER_PREVIOUS_RECT, 'roster-previous', {}, this.rosterPage > 0);
      this.addHit('roster-next', ROSTER_NEXT_RECT, 'roster-next', {}, this.rosterPage < pageCount - 1);
    }

    const inspectType = heroTypes.includes(this.rosterInspectType)
      ? this.rosterInspectType : selectedType;
    const inspected = HERO_TYPES[inspectType] || TOWER_TYPES[inspectType] || HERO_TYPES.shell;
    const inspectedRank = Math.max(0, Math.floor(Number(contractRanks[inspectType]) || 0));
    const inspectedOwned = inspectedRank > 0;
    const inspectedSelected = inspectType === selectedType;
    const inspectedRarity = rarityStyle(inspected.rarity);
    const detailInk = inspectedOwned ? COLORS.ink : '#505653';
    const detailSoft = inspectedOwned ? COLORS.inkSoft : '#6D7471';
    panel(ctx, ROSTER_DETAIL_RECT, {
      fill: inspectedOwned ? 'rgba(255,249,225,0.96)' : '#CED1CF',
      stroke: inspectedOwned ? inspectedRarity.color : '#777E7B',
      lineWidth: 4, radius: 30, shadow: inspectedOwned,
    });
    if (!inspectedOwned) {
      label(ctx, inspected.name, TD_VIEW.width / 2, 580, {
        size: 31, color: '#505653', weight: 950,
      });
      this.drawRosterHeroPortrait(ctx, inspectType, 236, 984, 300, {
        locked: true, phase: 0.09,
      });
      panel(ctx, { x: 386, y: 744, width: 226, height: 76 }, {
        fill: '#AEB3B1', stroke: '#737A77', lineWidth: 2, radius: 20,
      });
      label(ctx, '未解锁', 499, 783, {
        size: 25, color: '#F2F3F2', weight: 950,
      });
      button(ctx, ROSTER_DEPLOY_RECT, '未解锁', {
        enabled: false, fill: '#9DA5A1', accent: '#707773', size: 21,
      });
      this.addHit(`hero-select-${inspectType}`, ROSTER_DEPLOY_RECT, 'select-hero', {
        heroType: inspectType,
      }, false);
      label(ctx, `已拥有 ${ownedCount}/${heroTypes.length}`, 86, 1150, {
        size: 16, align: 'left', color: '#6D7471', weight: 900,
      });
      return;
    }

    const rosterStats = this.state.heroes?.find(({ type }) => type === inspectType);
    const inspectedStats = rosterStats || heroStatsForRank(inspectType, inspectedRank);
    panel(ctx, { x: 58, y: 552, width: 76, height: 38 }, {
      fill: inspectedOwned ? inspectedRarity.fill : '#AEB3B1',
      stroke: inspectedOwned ? inspectedRarity.color : '#6E7472', lineWidth: 2, radius: 14,
    });
    label(ctx, inspectedRarity.label, 96, 572, {
      size: inspectedRarity.label.length > 2 ? 14 : 18,
      color: inspectedOwned ? inspectedRarity.deep : '#4E5552', weight: 950,
    });
    label(ctx, inspected.name, 154, 570, {
      size: 31, align: 'left', color: detailInk, weight: 950,
    });
    const roleLabel = typeof inspected.role === 'string'
      ? inspected.role : inspected.role?.name;
    label(ctx, `${roleLabel || '英雄'} · 契约 ${inspectedRank}阶`, 650, 572, {
      size: 16, align: 'right', color: detailSoft, weight: 900,
    });

    this.drawRosterHeroPortrait(ctx, inspectType, 184, 902, 238, {
      locked: !inspectedOwned, phase: 0.09,
    });
    const statEntries = [
      ['攻击', Math.round(Number(inspectedStats.damage) || 0)],
      ['生命', Math.round(Number(inspectedStats.maxHp) || 0)],
      ['射程', Math.round(Number(inspected.range) || 0)],
      ['攻速', `${Math.max(0, Number(inspectedStats.attackSpeed) || 0).toFixed(2)}/秒`],
    ];
    statEntries.forEach(([name, value], index) => {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const rect = { x: 324 + column * 164, y: 642 + row * 92, width: 148, height: 76 };
      panel(ctx, rect, {
        fill: inspectedOwned ? '#F5FFF5' : '#B8BCBA',
        stroke: inspectedOwned ? '#8BC9A7' : '#7A817E', lineWidth: 2, radius: 18,
      });
      label(ctx, name, rect.x + 14, rect.y + 23, {
        size: 14, align: 'left', color: detailSoft, weight: 850,
      });
      label(ctx, value, rect.x + rect.width - 14, rect.y + 51, {
        size: 22, align: 'right', color: detailInk, weight: 950,
      });
    });

    const skillRect = { x: 64, y: 944, width: 592, height: 148 };
    panel(ctx, skillRect, {
      fill: inspectedOwned ? '#EEF8F0' : '#B8BCBA',
      stroke: inspectedOwned ? inspectedRarity.color : '#777E7B', lineWidth: 2, radius: 22,
    });
    const skillName = inspected.skill?.name || inspected.skillName || '主动技能';
    label(ctx, skillName, 88, 970, {
      size: 19, align: 'left', color: detailInk, weight: 950,
    });
    const skillCooldown = Number(inspected.skill?.cooldown ?? inspected.skillCooldown) || 0;
    const skillRadius = Number(inspected.skill?.radius ?? inspected.skillRadius) || 0;
    label(ctx, `${skillCooldown}秒 · 范围${Math.round(skillRadius)}`, 632, 970, {
      size: 14, align: 'right', color: detailSoft, weight: 850,
    });
    drawWrappedLabel(ctx, inspectedStats.skillEffect
      || heroSkillDescription(inspectType, inspected), 360, 1015, 520, {
      maxLines: 2, lineHeight: 28, size: 17, color: detailInk, weight: 820,
    });
    label(ctx, inspectedStats.growthSummary || '升阶强化基础能力', 360, 1080, {
      size: 14, color: inspectedOwned ? inspectedRarity.deep : detailSoft, weight: 850,
    });

    button(ctx, ROSTER_DEPLOY_RECT, !inspectedOwned ? '未解锁'
      : inspectedSelected ? '当前出战' : '设为出战', {
      enabled: inspectedOwned && !inspectedSelected,
      fill: '#64D3A0', accent: '#27866B', size: 21,
    });
    this.addHit(`hero-select-${inspectType}`, ROSTER_DEPLOY_RECT, 'select-hero', {
      heroType: inspectType,
    }, inspectedOwned && !inspectedSelected);
    label(ctx, `已拥有 ${ownedCount}/${heroTypes.length}`, 86, 1150, {
      size: 16, align: 'left', color: detailSoft, weight: 900,
    });
  }

  drawSummonPage(ctx) {
    ctx.fillStyle = '#B9E4D2';
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    drawAssetOrFallback(ctx, this.assetStore, 'background-menu-portrait-v1', (asset) => {
      drawCoverImage(ctx, asset);
    }, () => {
      drawAssetOrFallback(ctx, this.assetStore, 'background-garden-base', (asset) => {
        drawCoverImage(ctx, asset);
      }, () => this.drawBackdrop(ctx, 'stage-1'));
    });

    const wash = ctx.createLinearGradient(0, 0, 0, TD_VIEW.height);
    wash.addColorStop(0, 'rgba(238, 255, 247, 0.82)');
    wash.addColorStop(0.46, 'rgba(151, 230, 211, 0.42)');
    wash.addColorStop(1, 'rgba(52, 73, 88, 0.56)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);

    panel(ctx, SUMMON_BACK_RECT, {
      fill: '#FFF8E8', stroke: '#85978E', lineWidth: 3, radius: 22, shadow: true,
    });
    label(ctx, '返回', SUMMON_BACK_RECT.x + SUMMON_BACK_RECT.width / 2,
      SUMMON_BACK_RECT.y + SUMMON_BACK_RECT.height / 2, {
        size: 21, color: COLORS.ink, weight: 900,
      });
    this.addHit('summon-back', SUMMON_BACK_RECT, 'summon-back');

    label(ctx, '战团招募', TD_VIEW.width / 2, 70, {
      size: 40, color: COLORS.ink, weight: 950,
    });
    label(ctx, '英雄 · 小队 · 炮塔  ·  R → UR', TD_VIEW.width / 2, 114, {
      size: 17, color: COLORS.inkSoft, weight: 850,
    });

    panel(ctx, SUMMON_CURRENCY_RECT, {
      fill: '#FFF4D0', stroke: '#B57A2C', lineWidth: 3, radius: 24, shadow: true,
    });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-soft-crystal', (asset) => {
      ctx.drawImage(asset, SUMMON_CURRENCY_RECT.x + 14, SUMMON_CURRENCY_RECT.y + 10, 42, 42);
    }, () => {
      label(ctx, '◆', SUMMON_CURRENCY_RECT.x + 35,
        SUMMON_CURRENCY_RECT.y + SUMMON_CURRENCY_RECT.height / 2, {
          size: 24, color: COLORS.crystal, weight: 950,
        });
    });
    label(ctx, this.summonCurrency(), SUMMON_CURRENCY_RECT.x + SUMMON_CURRENCY_RECT.width - 18,
      SUMMON_CURRENCY_RECT.y + SUMMON_CURRENCY_RECT.height / 2 + 1, {
        size: 24, align: 'right', color: COLORS.ink, weight: 950,
      });

    const chamber = { x: 52, y: 176, width: 616, height: 750 };
    ctx.save();
    ctx.fillStyle = 'rgba(22, 55, 67, 0.22)';
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(chamber.x + 90, chamber.y);
    ctx.lineTo(chamber.x + chamber.width - 90, chamber.y);
    ctx.lineTo(chamber.x + chamber.width, chamber.y + chamber.height / 2);
    ctx.lineTo(chamber.x + chamber.width - 90, chamber.y + chamber.height);
    ctx.lineTo(chamber.x + 90, chamber.y + chamber.height);
    ctx.lineTo(chamber.x, chamber.y + chamber.height / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    label(ctx, '稀有度概率', TD_VIEW.width / 2, 218, {
      size: 21, color: COLORS.white, weight: 950,
    });
    const rarityRates = [
      ['R', '60%'], ['SR', '27%'], ['SSR', '10%'], ['UR', '3%'],
    ];
    rarityRates.forEach(([rarityId, rate], index) => {
      const rarity = rarityStyle(rarityId);
      const rect = { x: 72 + index * 148, y: 250, width: 132, height: 78 };
      panel(ctx, rect, {
        fill: rarity.fill, stroke: rarity.color, lineWidth: 3, radius: 16,
      });
      label(ctx, rarity.label, rect.x + rect.width / 2, rect.y + 25, {
        size: rarityId.length > 2 ? 17 : 20, color: rarity.deep, weight: 950,
      });
      label(ctx, rate, rect.x + rect.width / 2, rect.y + 55, {
        size: 18, color: COLORS.ink, weight: 900,
      });
    });

    ctx.save();
    ctx.globalAlpha = 0.78;
    drawPortal(ctx, TD_VIEW.width / 2, 720, 360, {
      time: this.state.time,
      open: 0.78,
      assetStore: this.assetStore,
    });
    ctx.restore();
    label(ctx, '契约裂隙', TD_VIEW.width / 2, 456, {
      size: 30, color: '#F5FCFF', weight: 950,
    });

    const pity = clamp(Math.floor(Number(this.state.progress?.summonPity) || 0), 0, 9);
    const pityRect = { x: 108, y: 790, width: 504, height: 100 };
    panel(ctx, pityRect, {
      fill: 'rgba(245,250,255,0.9)', stroke: '#9A82E7', lineWidth: 3, radius: 22,
    });
    label(ctx, `高稀有保底  ${pity}/10`, pityRect.x + 22, pityRect.y + 28, {
      size: 18, align: 'left', color: '#5947A4', weight: 950,
    });
    const pityTrack = { x: pityRect.x + 22, y: pityRect.y + 51,
      width: pityRect.width - 44, height: 10 };
    roundedPath(ctx, pityTrack.x, pityTrack.y, pityTrack.width, pityTrack.height, 5);
    ctx.fillStyle = '#D9D4EE';
    ctx.fill();
    if (pity > 0) {
      roundedPath(ctx, pityTrack.x, pityTrack.y,
        pityTrack.width * pity / 10, pityTrack.height, 5);
      ctx.fillStyle = '#9A82E7';
      ctx.fill();
    }
    label(ctx, `最多再 ${10 - pity} 次获得 SSR / UR`,
      pityRect.x + pityRect.width - 22, pityRect.y + 80, {
        size: 14, align: 'right', color: COLORS.inkSoft, weight: 850,
      });

    const currency = this.summonCurrency();
    button(ctx, SUMMON_ONE_RECT, '', {
      enabled: currency >= 100, fill: '#62CFA0', accent: '#277C62', size: 25,
    });
    label(ctx, '招募 1次', SUMMON_ONE_RECT.x + SUMMON_ONE_RECT.width / 2,
      SUMMON_ONE_RECT.y + 31, {
        size: 22, color: currency >= 100 ? COLORS.white : COLORS.disabled, weight: 950,
      });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-soft-crystal', (asset) => {
      ctx.globalAlpha *= currency >= 100 ? 0.95 : 0.35;
      ctx.drawImage(asset,
        SUMMON_ONE_RECT.x + SUMMON_ONE_RECT.width / 2 - 38,
        SUMMON_ONE_RECT.y + 53, 25, 25);
    }, () => {});
    label(ctx, '100', SUMMON_ONE_RECT.x + SUMMON_ONE_RECT.width / 2 - 5,
      SUMMON_ONE_RECT.y + 66, {
      size: 15, align: 'left', color: currency >= 100 ? COLORS.ink : COLORS.disabled, weight: 900,
    });
    this.addHit('summon-one', SUMMON_ONE_RECT, 'summon-one', {}, currency >= 100);

    button(ctx, SUMMON_TEN_RECT, '', {
      enabled: currency >= 900, fill: '#8E7FE2', accent: '#51438F', size: 25,
    });
    label(ctx, '招募 10次', SUMMON_TEN_RECT.x + SUMMON_TEN_RECT.width / 2,
      SUMMON_TEN_RECT.y + 31, {
        size: 22, color: currency >= 900 ? COLORS.white : COLORS.disabled, weight: 950,
      });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-soft-crystal', (asset) => {
      ctx.globalAlpha *= currency >= 900 ? 0.95 : 0.35;
      ctx.drawImage(asset,
        SUMMON_TEN_RECT.x + SUMMON_TEN_RECT.width / 2 - 38,
        SUMMON_TEN_RECT.y + 53, 25, 25);
    }, () => {});
    label(ctx, '900', SUMMON_TEN_RECT.x + SUMMON_TEN_RECT.width / 2 - 5,
      SUMMON_TEN_RECT.y + 66, {
      size: 15, align: 'left', color: currency >= 900 ? COLORS.ink : COLORS.disabled, weight: 900,
    });
    this.addHit('summon-ten', SUMMON_TEN_RECT, 'summon-ten', {}, currency >= 900);

    if (this.summonAnimation) this.drawSummonAnimation(ctx);
    else if (this.summonResults.length) this.drawSummonResults(ctx);
  }

  drawSummonAnimation(ctx) {
    const animation = this.summonAnimation;
    if (!animation) return;
    const elapsed = Math.max(0, Number(animation.elapsed) || 0);
    const revealStart = SUMMON_ENERGY_DURATION + SUMMON_RIFT_DURATION;
    if (elapsed >= revealStart) {
      this.drawSummonResults(ctx, {
        results: animation.results,
        revealElapsed: elapsed - revealStart,
        allowClose: false,
      });
      return;
    }

    this.hits = [];
    ctx.save();
    const veil = ctx.createRadialGradient(360, 610, 60, 360, 610, 720);
    veil.addColorStop(0, 'rgba(49, 76, 104, 0.7)');
    veil.addColorStop(1, 'rgba(10, 23, 38, 0.96)');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    ctx.restore();

    const energyPhase = clamp(elapsed / SUMMON_ENERGY_DURATION, 0, 1);
    const riftPhase = clamp(
      (elapsed - SUMMON_ENERGY_DURATION) / SUMMON_RIFT_DURATION,
      0,
      1,
    );
    const center = { x: 360, y: 615 };
    for (let index = 0; index < 18; index += 1) {
      const angle = index / 18 * TAU + this.animationTime * (index % 2 ? 0.8 : -0.55);
      const startRadius = 510 + (index % 3) * 56;
      const radius = startRadius * (1 - easeOutCubic(energyPhase) * 0.88);
      const x = center.x + Math.cos(angle) * radius;
      const y = center.y + Math.sin(angle) * radius * 0.72;
      const size = 13 + (index % 4) * 4;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle + Math.PI / 4);
      ctx.globalAlpha = 0.36 + energyPhase * 0.58;
      ctx.fillStyle = index % 3 === 0 ? '#FFD66F' : index % 2 ? '#79E9FF' : '#B69AFF';
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    }

    const portalScale = 0.5 + energyPhase * 0.44 + riftPhase * 0.34;
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.scale(portalScale, portalScale);
    ctx.translate(-center.x, -center.y);
    drawPortal(ctx, center.x, center.y + 122, 330, {
      time: this.animationTime * 1.8,
      open: 0.35 + energyPhase * 0.45 + riftPhase * 0.55,
      assetStore: this.assetStore,
    });
    ctx.restore();

    if (riftPhase > 0) {
      const flip = Math.max(0.07, Math.abs(Math.cos(riftPhase * Math.PI * 1.5)));
      ctx.save();
      ctx.translate(center.x, center.y - 36);
      ctx.scale(flip, 0.82 + riftPhase * 0.18);
      const cardRect = { x: -132, y: -198, width: 264, height: 396 };
      panel(ctx, cardRect, {
        fill: '#F7F3FF', stroke: '#C4A3FF', lineWidth: 5, radius: 26, shadow: true,
      });
      drawAssetOrFallback(ctx, this.assetStore, 'ui-card-frame-common', (asset) => {
        ctx.globalAlpha *= 0.55;
        ctx.drawImage(asset, cardRect.x, cardRect.y, cardRect.width, cardRect.height);
      }, () => {});
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#FFE17B';
      ctx.fillRect(-35, -35, 70, 70);
      ctx.restore();
    }

    label(ctx, energyPhase < 1 ? '能量汇聚' : '契约裂隙开启', center.x, 158, {
      size: 34, color: '#F6FCFF', weight: 950,
    });
    label(ctx, energyPhase < 1 ? '请等待' : '卡牌翻转中', center.x, 204, {
      size: 17, color: '#BCEBFF', weight: 850,
    });
    button(ctx, SUMMON_SKIP_RECT, '跳过', {
      fill: 'rgba(255,255,255,0.16)', accent: 'rgba(255,255,255,0.55)', size: 18,
    });
    this.addHit('summon-animation-skip', SUMMON_SKIP_RECT, 'summon-animation-skip');
  }

  recruitmentDefinition(result) {
    if (result?.kind === 'squad') return SQUAD_TYPES[result.type] || null;
    if (result?.kind === 'turret') return TURRET_TYPES[result.type] || null;
    return HERO_TYPES[result?.type] || null;
  }

  drawRecruitmentResultVisual(ctx, result, { single = false, index = 0 } = {}) {
    const kind = result?.kind || 'hero';
    const definition = this.recruitmentDefinition(result);
    if (!definition) return false;

    if (kind === 'squad') {
      const visual = SOLDIER_VISUALS[result.type];
      if (!visual) return false;
      const memberSize = single ? 86 : 30;
      const centerY = single ? 172 : 32;
      const spreadX = single ? 48 : 17;
      const spreadY = single ? 32 : 12;
      const positions = [
        [-spreadX, -spreadY], [spreadX, -spreadY],
        [-spreadX, spreadY], [spreadX, spreadY],
      ];
      let rendered = false;
      positions.forEach(([offsetX, offsetY], memberIndex) => {
        rendered = drawSoldier(ctx, offsetX, centerY + offsetY, memberSize, {
          assetKey: visual.assetKey,
          squadType: result.type,
          time: this.state.time + memberIndex * 0.12,
          facing: memberIndex % 2 ? -1 : 1,
          assetStore: this.assetStore,
        }) || rendered;
      });
      return rendered;
    }

    if (kind === 'turret') {
      const visual = turretVisualFor(result.type);
      if (!visual) return false;
      const baselineY = single ? 262 : 62;
      const size = single ? 236 : 74;
      if (visual.layered) {
        return drawLayeredTurret(ctx, 0, baselineY, size, {
          assetKey: visual.assetKey,
          assetStore: this.assetStore,
          aimAngle: -Math.PI / 2,
          attackPulse: 0,
        });
      }
      drawBuilding(ctx, 0, baselineY, size, 'tower', {
        assetKey: visual.assetKey,
        assetStore: this.assetStore,
        ...visual.layout,
      });
      return true;
    }

    const ownerId = definition.ownerId;
    const characterAnimation = this.characterAnimationSample(
      `preview:menu:${definition.id}`,
      ownerId,
    );
    return this.drawFriendlyCharacter(
      ctx,
      0,
      single ? 166 : 29,
      single ? 176 : 56,
      definition.id,
      {
        time: this.state.time + index * 0.11,
        facing: index % 2 ? -1 : 1,
        ...characterAnimation,
        ...this.characterRigOptions(ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      },
    );
  }

  drawSummonResults(ctx, {
    results = this.summonResults,
    revealElapsed = null,
    allowClose = true,
  } = {}) {
    const visibleResults = results.slice(0, 10);
    this.hits = [];
    ctx.save();
    const veil = ctx.createLinearGradient(0, 0, 0, TD_VIEW.height);
    veil.addColorStop(0, 'rgba(19, 37, 58, 0.96)');
    veil.addColorStop(0.5, 'rgba(53, 64, 105, 0.94)');
    veil.addColorStop(1, 'rgba(20, 40, 48, 0.98)');
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    ctx.restore();

    label(ctx, allowClose ? '招募结果' : '契约显现', TD_VIEW.width / 2, 104, {
      size: 38, color: '#F8FCFF', weight: 950,
    });
    label(ctx, 'R  ·  SR  ·  SSR  ·  UR', TD_VIEW.width / 2, 146, {
      size: 17, color: '#CFEAFF', weight: 900,
    });

    const single = visibleResults.length === 1;
    const cards = single
      ? [{ x: 136, y: 220, width: 448, height: 724 }]
      : visibleResults.map((_, index) => ({
        x: 64 + (index % 2) * 304,
        y: 176 + Math.floor(index / 2) * 184,
        width: 288,
        height: 168,
      }));

    visibleResults.forEach((result, index) => {
      const rect = cards[index];
      const definition = this.recruitmentDefinition(result);
      if (!definition) return;
      const rarity = rarityStyle(result.rarity);
      const reveal = revealElapsed == null
        ? 1
        : clamp((revealElapsed - index * SUMMON_REVEAL_STAGGER)
          / SUMMON_REVEAL_CARD_DURATION, 0, 1);
      const flipScale = Math.max(0.055, Math.abs(Math.cos(reveal * Math.PI)));
      const showFront = reveal > 0.5;
      const localRect = { x: -rect.width / 2, y: -rect.height / 2,
        width: rect.width, height: rect.height };
      ctx.save();
      ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
      ctx.scale(flipScale, 1);
      if (!showFront) {
        panel(ctx, localRect, {
          fill: '#313D68', stroke: '#9FDFFF', lineWidth: 4,
          radius: single ? 30 : 18, shadow: true,
        });
        drawAssetOrFallback(ctx, this.assetStore, 'ui-card-frame-common', (asset) => {
          ctx.globalAlpha *= 0.34;
          ctx.drawImage(asset, localRect.x, localRect.y, localRect.width, localRect.height);
        }, () => {});
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#FFE080';
        const markSize = single ? 70 : 32;
        ctx.fillRect(-markSize / 2, -markSize / 2, markSize, markSize);
        ctx.restore();
        return;
      }
      panel(ctx, localRect, {
        fill: rarity.fill, stroke: rarity.color, lineWidth: single ? 6 : 4,
        radius: single ? 30 : 18, shadow: true,
      });
      drawAssetOrFallback(ctx, this.assetStore, 'ui-card-frame-common', (asset) => {
        ctx.globalAlpha *= 0.22;
        ctx.drawImage(asset, localRect.x, localRect.y, localRect.width, localRect.height);
      }, () => {});
      label(ctx, rarity.label, localRect.x + 16, localRect.y + (single ? 30 : 20), {
        size: single ? 28 : 15, align: 'left', color: rarity.deep, weight: 950,
      });
      label(ctx, definition.name, localRect.x + localRect.width - 16,
        localRect.y + (single ? 30 : 20), {
          size: single ? 28 : 16, align: 'right', color: COLORS.ink, weight: 950,
        });
      this.drawRecruitmentResultVisual(ctx, result, { single, index });
      const converted = Math.max(0, Math.floor(Number(result.convertedCurrency) || 0));
      const rankUps = Math.max(0, Math.floor(Number(result.rankUps) || 0));
      const shards = Math.max(0, Math.floor(Number(result.shards) || 0));
      const unlockedLabel = result.kind === 'squad'
        ? '新小队'
        : result.kind === 'turret' ? '新炮塔' : '新英雄';
      const rewardText = result.unlocked
        ? unlockedLabel
        : converted ? `◆ +${converted}` : rankUps ? `升阶 +${rankUps}` : `碎片 +${shards}`;
      label(ctx, rewardText,
        0, localRect.y + localRect.height - (single ? 68 : 18), {
          size: single ? 23 : 13,
          color: result.unlocked ? COLORS.mintDeep : converted ? COLORS.crystal : COLORS.ink,
          weight: 950,
        });
      if (rankUps && !result.unlocked) {
        panel(ctx, {
          x: localRect.x + localRect.width - (single ? 106 : 66),
          y: localRect.y + (single ? 54 : 42),
          width: single ? 88 : 54,
          height: single ? 34 : 26,
        }, {
          fill: '#FFE27A', stroke: '#A66C22', lineWidth: 2, radius: 14,
        });
        label(ctx, `升${rankUps}`, localRect.x + localRect.width - (single ? 62 : 39),
          localRect.y + (single ? 72 : 56), {
            size: single ? 16 : 12, color: COLORS.ink, weight: 950,
          });
      }
      ctx.restore();
    });

    if (allowClose) {
      button(ctx, SUMMON_RESULT_CLOSE_RECT, '收下', {
        fill: COLORS.mint, accent: COLORS.mintDeep, size: 24,
      });
      this.addHit('summon-result-close', SUMMON_RESULT_CLOSE_RECT, 'summon-result-close');
    } else {
      button(ctx, SUMMON_SKIP_RECT, '跳过', {
        fill: 'rgba(255,255,255,0.16)', accent: 'rgba(255,255,255,0.55)', size: 18,
      });
      this.addHit('summon-animation-skip', SUMMON_SKIP_RECT, 'summon-animation-skip');
    }
  }

  drawStageSelect(ctx) {
    ctx.fillStyle = '#B9E4D2';
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    drawAssetOrFallback(ctx, this.assetStore, 'background-menu-portrait-v1', (asset) => {
      drawCoverImage(ctx, asset);
    }, () => {
      drawAssetOrFallback(ctx, this.assetStore, 'background-garden-base', (asset) => {
        drawCoverImage(ctx, asset);
      }, () => this.drawBackdrop(ctx, 'stage-1'));
    });

    const wash = ctx.createLinearGradient(0, 0, 0, TD_VIEW.height);
    wash.addColorStop(0, 'rgba(255, 251, 232, 0.62)');
    wash.addColorStop(1, 'rgba(105, 148, 126, 0.3)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);

    panel(ctx, STAGE_SELECT_BACK, {
      fill: '#FFF8E8', stroke: '#85978E', lineWidth: 3, radius: 22, shadow: true,
    });
    label(ctx, '返回', STAGE_SELECT_BACK.x + STAGE_SELECT_BACK.width / 2,
      STAGE_SELECT_BACK.y + STAGE_SELECT_BACK.height / 2, {
        size: 21, color: COLORS.ink, weight: 900,
      });
    this.addHit('stage-select-back', STAGE_SELECT_BACK, 'stage-select-back');

    label(ctx, '选择关卡', TD_VIEW.width / 2, 92, {
      size: 40, color: COLORS.ink, weight: 950,
    });

    const pageCount = Math.max(1, Math.ceil(TD_STAGES.length / STAGE_SELECT_PAGE_SIZE));
    this.stageSelectPage = clamp(
      Math.floor(Number(this.stageSelectPage) || 0),
      0,
      pageCount - 1,
    );
    const pageStart = this.stageSelectPage * STAGE_SELECT_PAGE_SIZE;
    const visibleStages = TD_STAGES.slice(pageStart, pageStart + STAGE_SELECT_PAGE_SIZE);
    visibleStages.forEach((stage, localIndex) => {
      const index = pageStart + localIndex;
      const rect = STAGE_SELECT_CARDS[localIndex];
      const unlocked = stage.index <= this.state.progress.unlockedStage;
      const cleared = this.state.progress.clearedStages.includes(stage.id);
      const hot = unlocked && Boolean(this.hoverPoint && insideRect(this.hoverPoint, rect));
      panel(ctx, rect, {
        fill: unlocked ? hot ? '#FFFDF0' : '#FFF8E6' : '#D2D8D4',
        stroke: unlocked ? stage.accent : '#929D97',
        lineWidth: hot ? 6 : 4,
        radius: 30,
        shadow: unlocked,
      });

      const artRect = {
        x: rect.x + 14,
        y: rect.y + 14,
        width: rect.width - 28,
        height: 132,
      };
      ctx.save();
      roundedPath(ctx, artRect.x, artRect.y, artRect.width, artRect.height, 20);
      ctx.clip();
      drawAssetOrFallback(ctx, this.assetStore, stageRegionAssetKey(stage), (asset) => {
        ctx.globalAlpha *= unlocked ? 0.94 : 0.28;
        drawCoverImage(ctx, asset, artRect);
      }, () => {
        ctx.fillStyle = unlocked ? stage.accent : '#AAB4AF';
        ctx.globalAlpha *= unlocked ? 0.45 : 0.2;
        ctx.fillRect(artRect.x, artRect.y, artRect.width, artRect.height);
      });
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(rect.x + 38, rect.y + 18);
      ctx.lineTo(rect.x + 58, rect.y + 38);
      ctx.lineTo(rect.x + 38, rect.y + 58);
      ctx.lineTo(rect.x + 18, rect.y + 38);
      ctx.closePath();
      ctx.fillStyle = unlocked ? '#FFF4C8' : '#B9C1BD';
      ctx.fill();
      ctx.strokeStyle = unlocked ? stage.accent : '#7E8A85';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      label(ctx, unlocked ? stage.index : '锁', rect.x + 38, rect.y + 38, {
        size: unlocked ? 18 : 14,
        color: unlocked ? stage.accent : '#66736D',
        weight: 950,
      });

      const infoCenterX = rect.x + rect.width / 2;
      label(ctx, stage.name, infoCenterX, rect.y + 174, {
        size: 24, color: unlocked ? COLORS.ink : '#68746E', weight: 920,
      });
      label(ctx, `${stage.waves.length}波`, infoCenterX, rect.y + 207, {
        size: 15, color: unlocked ? COLORS.inkSoft : '#7A8580', weight: 780,
      });
      const statusRect = {
        x: rect.x + 42,
        y: rect.y + 236,
        width: rect.width - 84,
        height: 48,
      };
      panel(ctx, statusRect, {
        fill: !unlocked ? '#BCC5C0' : cleared ? '#DDF6CD' : stage.accent,
        stroke: !unlocked ? '#8B9791' : cleared ? '#6BAE62' : stage.accent,
        lineWidth: 2,
        radius: 17,
      });
      label(ctx, !unlocked ? '未解锁' : cleared ? '✓ 已通关' : '可挑战',
        infoCenterX, statusRect.y + statusRect.height / 2, {
          size: 16,
          color: !unlocked ? '#68746E' : cleared ? '#397B45' : COLORS.white,
          weight: 900,
        });
      this.addHit(`select-stage-${stage.index}`, rect, 'stage', {
        stageId: stage.id,
        stageIndex: index,
      }, unlocked);
    });

    if (pageCount > 1) {
      const hasPrevious = this.stageSelectPage > 0;
      const hasNext = this.stageSelectPage < pageCount - 1;
      button(ctx, STAGE_SELECT_PREVIOUS, '‹', {
        enabled: hasPrevious, fill: '#F4F8ED', color: COLORS.ink,
        accent: '#81938A', size: 30,
      });
      button(ctx, STAGE_SELECT_NEXT, '›', {
        enabled: hasNext, fill: '#F4F8ED', color: COLORS.ink,
        accent: '#81938A', size: 30,
      });
      label(ctx, `${this.stageSelectPage + 1}/${pageCount}`, TD_VIEW.width / 2, 1169, {
        size: 17, color: COLORS.inkSoft, weight: 900,
      });
      this.addHit('stage-select-previous', STAGE_SELECT_PREVIOUS,
        'stage-select-previous', {}, hasPrevious);
      this.addHit('stage-select-next', STAGE_SELECT_NEXT,
        'stage-select-next', {}, hasNext);
    }
  }

  drawBattle(ctx) {
    const stage = stageForState(this.state);
    ctx.save();
    if (this.shake > 0) {
      ctx.translate(
        Math.sin(this.state.time * 62) * this.shake,
        Math.cos(this.state.time * 47) * this.shake * 0.55,
      );
    }
    this.drawBattlefield(ctx, stage);
    ctx.restore();
    this.drawBattleHud(ctx, stage);
    this.drawHeroControls(ctx);
    this.drawDragPreview(ctx);
    this.drawLongPressIndicator(ctx);
  }

  drawHeroControls(ctx) {
    const active = this.isHeroControlActive();
    const hero = this.state.hero || {};
    const heroType = hero.type || hero.heroId || this.state.selectedHeroId || 'shell';
    const definition = HERO_TYPES[heroType] || TOWER_TYPES[heroType] || HERO_TYPES.shell;

    if (!this.state.waveActive) {
      this.addHit('hero-joystick', HERO_JOYSTICK.hit, 'hero-joystick', {}, false);
      this.addHit('hero-skill', HERO_SKILL_RECT, 'hero-skill', {}, false);
      return;
    }

    ctx.save();
    ctx.globalAlpha = active ? 0.78 : 0.34;
    drawAssetOrFallback(ctx, this.assetStore, 'ui-hero-joystick-base', (asset) => {
      ctx.drawImage(asset,
        HERO_JOYSTICK.x - HERO_JOYSTICK.radius,
        HERO_JOYSTICK.y - HERO_JOYSTICK.radius,
        HERO_JOYSTICK.radius * 2,
        HERO_JOYSTICK.radius * 2);
    }, () => {});
    const knobX = HERO_JOYSTICK.x + this.joystick.x * 34;
    const knobY = HERO_JOYSTICK.y + this.joystick.y * 34;
    drawAssetOrFallback(ctx, this.assetStore, 'ui-hero-joystick-knob', (asset) => {
      ctx.drawImage(asset, knobX - 27, knobY - 27, 54, 54);
    }, () => {});
    ctx.restore();
    this.addHit('hero-joystick', HERO_JOYSTICK.hit, 'hero-joystick', {}, active);

    const cooldown = Math.max(0, Number(
      hero.skillCooldownRemaining ?? hero.skillCooldown ?? this.state.heroSkillCooldown,
    ) || 0);
    const canSkill = active && cooldown <= 0 && Number(hero.hp ?? 1) > 0;
    panel(ctx, HERO_SKILL_RECT, {
      fill: canSkill ? 'rgba(246,255,236,0.92)' : 'rgba(78,94,94,0.72)',
      stroke: canSkill ? definition.color : '#8B9994',
      lineWidth: canSkill ? 5 : 3,
      radius: HERO_SKILL_RECT.width / 2,
      shadow: canSkill,
    });
    const iconKey = HERO_SKILL_ASSET_BY_TYPE[heroType] || HERO_SKILL_ASSET_BY_TYPE.shell;
    drawAssetOrFallback(ctx, this.assetStore, iconKey, (asset) => {
      ctx.globalAlpha *= canSkill ? 1 : 0.42;
      ctx.drawImage(asset, HERO_SKILL_RECT.x + 13, HERO_SKILL_RECT.y + 13,
        HERO_SKILL_RECT.width - 26, HERO_SKILL_RECT.height - 26);
    }, () => {});
    if (cooldown > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(25, 39, 45, 0.56)';
      ctx.beginPath();
      ctx.arc(HERO_SKILL_RECT.x + HERO_SKILL_RECT.width / 2,
        HERO_SKILL_RECT.y + HERO_SKILL_RECT.height / 2,
        HERO_SKILL_RECT.width / 2 - 6, 0, TAU);
      ctx.fill();
      ctx.restore();
      label(ctx, cooldown.toFixed(1),
        HERO_SKILL_RECT.x + HERO_SKILL_RECT.width / 2,
        HERO_SKILL_RECT.y + HERO_SKILL_RECT.height / 2 + 1, {
          size: 24, color: COLORS.white, weight: 950,
        });
    }
    this.addHit('hero-skill', HERO_SKILL_RECT, 'hero-skill', {}, canSkill);
  }

  isPreparation() {
    return this.state.screen === 'battle'
      && this.state.phase === 'prep'
      && !this.state.waveActive
      && !this.state.result;
  }

  shouldShowDeploymentGrid() {
    if (!this.isPreparation()) return false;
    if (squadTypeForPurchase(this.selectedPurchase)) return true;
    if (this.selectedCardUid
      && this.state.hand.some(({ uid }) => uid === this.selectedCardUid)) return true;
    if (this.drag?.kind === 'card'
      && this.state.hand.some(({ uid }) => uid === this.drag.uid)) return true;
    if (this.drag?.kind === 'purchase') {
      const purchase = purchaseItemFor(this.drag.purchaseType);
      if (purchase?.kind === 'squad' && isSquadType(purchase.type)) return true;
    }
    return this.drag?.kind === 'tower'
      && this.drag.longPressReady === true
      && this.drag.longPressCancelled !== true;
  }

  isHeroControlActive() {
    return this.state.screen === 'battle'
      && this.state.phase === 'combat'
      && this.state.waveActive
      && !this.state.result
      && Number(this.state.hero?.hp ?? 0) > 0;
  }

  drawBattleHero(ctx) {
    const hero = this.state.hero;
    if (!hero || !Number.isFinite(hero.x) || !Number.isFinite(hero.y)) return;
    const type = hero.type || hero.heroId || this.state.selectedHeroId || 'shell';
    const definition = HERO_TYPES[type] || TOWER_TYPES[type] || HERO_TYPES.shell;
    const heroDefinition = definition;
    const key = `hero:${hero.uid || type}`;
    const heroBase = Math.hypot(Number(hero.moveX) || 0, Number(hero.moveY) || 0) > 0.01
      ? 'move' : 'idle';
    const animation = this.characterAnimationSample(key, definition.ownerId, heroBase);
    const pulse = 1 + Math.sin(this.state.time * 3.4) * 0.05;
    ctx.save();
    ctx.globalAlpha = 0.82;
    drawAssetOrFallback(ctx, this.assetStore, 'ui-hero-control-ring', (asset) => {
      const width = 106 * pulse;
      const height = 47 * pulse;
      ctx.drawImage(asset, hero.x - width / 2, hero.y - height / 2 + 6, width, height);
    }, () => {});
    ctx.restore();
    this.drawFriendlyCharacter(ctx, hero.x, hero.y + 7, 68, type, {
      time: this.state.time,
      facing: hero.facing === -1 ? -1 : 1,
      hit: clamp(Number(hero.hitPulse) || 0, 0, 1),
      expression: Number(hero.hitPulse) > 0.35 ? 'hurt' : 'normal',
      ...animation,
      ...this.characterRigOptions(definition.ownerId),
      allowGeneratedStandalone: this.generatedCharacterArtEnabled,
    });
    panel(ctx, { x: hero.x - 27, y: hero.y - 70, width: 54, height: 22 }, {
      fill: definition.color, stroke: '#FFFFFF', lineWidth: 2, radius: 12,
    });
    label(ctx, heroDefinition.name, hero.x, hero.y - 59, {
      size: 11, color: COLORS.white, weight: 950,
    });
    if (Number.isFinite(hero.hp) && Number.isFinite(hero.maxHp) && hero.maxHp > 0) {
      const ratio = clamp(hero.hp / hero.maxHp, 0, 1);
      const bar = { x: hero.x - 34, y: hero.y - 43, width: 68, height: 7 };
      ctx.fillStyle = 'rgba(28,44,50,0.68)';
      roundedPath(ctx, bar.x, bar.y, bar.width, bar.height, 4);
      ctx.fill();
      if (ratio > 0) {
        ctx.fillStyle = ratio < 0.3 ? COLORS.coral : COLORS.mint;
        roundedPath(ctx, bar.x + 1, bar.y + 1,
          Math.max(2, (bar.width - 2) * ratio), bar.height - 2, 3);
        ctx.fill();
      }
    }
  }

  turretSlots(stage) {
    if (Array.isArray(this.state.turretSlots) && this.state.turretSlots.length) {
      return this.state.turretSlots;
    }
    if (Array.isArray(stage?.turretSlots) && stage.turretSlots.length) return stage.turretSlots;
    return [
      { x: 102, y: 914, type: 'gel-mortar' },
      { x: 274, y: 914, type: 'gel-mortar' },
      { x: 446, y: 914, type: 'gel-mortar' },
      { x: 618, y: 914, type: 'gel-mortar' },
    ];
  }

  drawTurretSlots(ctx, stage) {
    const slots = this.turretSlots(stage);
    const turrets = Array.isArray(this.state.turrets) ? this.state.turrets : [];
    slots.forEach((slot, slotIndex) => {
      const turret = slot.turret || turrets.find((entry) => (
        entry.slotIndex === slotIndex || entry.slotId === slot.id
      ));
      const x = Number.isFinite(Number(slot.x)) ? Number(slot.x) : 102 + slotIndex * 172;
      const y = Number.isFinite(Number(slot.y)) ? Number(slot.y) : 914;
      const buildingGroundY = y + 28;
      const selectedTurretType = turretTypeForPurchase(this.selectedPurchase);
      const type = turret?.type || selectedTurretType || slot.type || 'gel-mortar';
      const turretDefinition = TURRET_TYPES[type] || TURRET_TYPES['gel-mortar'];
      const turretVisual = turretVisualFor(type);
      const buildingType = 'tower';
      if (!turret || !turretVisual?.layered) {
        drawAssetOrFallback(ctx, this.assetStore, 'turret-gel-mount', (asset) => {
          ctx.globalAlpha *= turret ? 1 : this.isPreparation() ? 0.94 : 0.38;
          ctx.drawImage(
            asset,
            x - GEL_MOUNT_ASSET_LAYOUT.width / 2,
            buildingGroundY - GEL_MOUNT_ASSET_LAYOUT.height,
            GEL_MOUNT_ASSET_LAYOUT.width,
            GEL_MOUNT_ASSET_LAYOUT.height,
          );
        }, () => {});
      }
      if (turret) {
        const pulseKey = String(turret.uid ?? slot.id ?? slotIndex);
        const pulse = clamp(Number(this.turretPulses.get(pulseKey)) || 0, 0, 1);
        if (pulse > 0) {
          ctx.save();
          ctx.globalAlpha = pulse * 0.42;
          ctx.fillStyle = COLORS.blue;
          ctx.beginPath();
          ctx.ellipse(x, buildingGroundY - 8,
            58 + pulse * 18, 26 + pulse * 8, 0, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
        const damage = Number.isFinite(turret.hp) && turret.maxHp > 0
          ? 1 - clamp(turret.hp / turret.maxHp, 0, 1)
          : 0;
        if (turretVisual?.layered) {
          drawLayeredTurret(ctx, x, buildingGroundY, 92, {
            assetKey: turretVisual.assetKey,
            assetStore: this.assetStore,
            aimAngle: Number.isFinite(Number(turret.aimAngle))
              ? Number(turret.aimAngle) : -Math.PI / 2,
            attackPulse: Math.max(pulse, Number(turret.attackPulse) || 0),
            damage,
          });
        } else if (turretVisual) {
          drawBuilding(ctx, x, buildingGroundY, 92 * (1 + pulse * 0.045), buildingType, {
            assetKey: turretVisual.assetKey,
            assetStore: this.assetStore,
            ...turretVisual.layout,
            selected: false,
            damage,
          });
        }
        return;
      }

      const cost = Math.max(0, Math.floor(Number(slot.cost) || turretDefinition.cost));
      const buildingSelected = Boolean(selectedTurretType);
      label(ctx, this.isPreparation() && buildingSelected
        ? `${turretDefinition.name} ${cost}` : '炮台位', x, y - 36, {
        size: 13, color: this.isPreparation() ? COLORS.cream : COLORS.inkSoft, weight: 900,
      });
      const slotHitId = typeof slot.id === 'string' && slot.id
        ? slot.id : `turret-slot-${slotIndex}`;
      this.addHit(slotHitId, {
        x: x - 54, y: y - 42, width: 108, height: 100,
      }, 'build-turret', {
        slotIndex, slotId: slot.id, turretType: type,
      }, this.isPreparation() && buildingSelected && this.state.currency >= cost);
    });
  }

  drawBattlefield(ctx, stage) {
    this.resetSkillRenderBudget();
    ctx.fillStyle = '#B8DEC8';
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    drawAssetOrFallback(ctx, this.assetStore, 'background-battle-portrait-v1', (asset) => {
      drawCoverImage(ctx, asset);
    }, () => this.drawBackdrop(ctx, stage.id));
    ctx.save();
    const fieldWash = ctx.createLinearGradient(0, BATTLE_FIELD.top, 0, BATTLE_FIELD.bottom);
    fieldWash.addColorStop(0, 'rgba(244,255,239,0.22)');
    fieldWash.addColorStop(0.5, 'rgba(232,255,241,0.08)');
    fieldWash.addColorStop(1, 'rgba(48,93,84,0.16)');
    ctx.fillStyle = fieldWash;
    ctx.fillRect(0, BATTLE_FIELD.top, TD_VIEW.width,
      BATTLE_FIELD.bottom - BATTLE_FIELD.top);
    ctx.restore();

    const lanes = laneDescriptors(stage);
    const coreX = Number.isFinite(Number(stage?.base?.x)) ? Number(stage.base.x) : 360;
    const coreY = Number.isFinite(Number(stage?.base?.y)) ? Number(stage.base.y) : 1038;
    this.drawLaneField(ctx, lanes, stage);
    this.drawLaneGateways(ctx, lanes, stage, coreX, coreY);
    this.drawHeroSkillActors(ctx, 'back');
    this.drawEffects(ctx, 'back');

    drawCore(ctx, coreX, coreY, 160, {
      assetKey: 'fortress-slime-core',
      ...FORTRESS_CORE_ASSET_LAYOUT,
      health: this.state.coreHp / Math.max(1, this.state.coreMaxHp),
      time: this.state.time,
      hit: this.shake > 0 ? 1 : 0,
      assetStore: this.assetStore,
    });
    drawPortal(ctx, TD_VIEW.width / 2, 222, 112, {
      time: this.state.time,
      open: this.state.waveActive || this.state.enemies.length ? 1 : 0.62,
      assetStore: this.assetStore,
    });
    this.drawTurretSlots(ctx, stage);

    if (this.state.selectedTowerUid) {
      const selected = this.state.towers.find((tower) => tower.uid === this.state.selectedTowerUid);
      const pad = selected && stage.pads[selected.padIndex];
      if (selected && pad) {
        const selectedX = this.state.waveActive && Number.isFinite(selected.x) ? selected.x : pad.x;
        const selectedY = this.state.waveActive && Number.isFinite(selected.y) ? selected.y : pad.y;
        ctx.save();
        ctx.globalAlpha = 0.11;
        const selectedDefinition = isSquadTower(selected)
          ? soldierVisualFor(selected.type, selected.squadType)
          : TOWER_TYPES[slimeVisualType(selected.type, selected.squadType)];
        ctx.fillStyle = selectedDefinition.color;
        ctx.beginPath();
        ctx.arc(selectedX, selectedY, towerRange(this.state, selected), 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.34;
        ctx.strokeStyle = selectedDefinition.color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }

    stage.pads
      .map((pad, padIndex) => ({ pad, padIndex }))
      .sort((left, right) => left.pad.y - right.pad.y || left.pad.x - right.pad.x)
      .forEach(({ pad, padIndex }) => this.drawPad(ctx, pad, padIndex));
    [...this.state.enemies]
      .sort((left, right) => left.y - right.y || left.travelled - right.travelled)
      .forEach((enemy) => this.drawEnemy(ctx, enemy));
    this.drawBattleHero(ctx);
    this.drawDefeatedTowers(ctx);
    this.drawDefeatedActors(ctx);
    this.state.projectiles.forEach((projectile) => this.drawShot(ctx, projectile));
    this.drawHeroSkillActors(ctx, 'front');
    this.drawEffects(ctx, 'front');
  }

  drawDeploymentGrid(ctx, lanes, stage) {
    if (!this.shouldShowDeploymentGrid()) return false;
    const columns = lanes.map((lane) => Number(lane.x)).filter(Number.isFinite);
    const authoredRows = Array.isArray(stage?.pads)
      ? [...new Set(stage.pads.map((pad) => Number(pad.y)).filter(Number.isFinite))]
        .sort((left, right) => left - right)
      : [];
    const rows = authoredRows.length === 7 ? authoredRows : DEPLOY_GRID_ROWS;
    if (columns.length !== 5 || rows.length !== 7) return false;

    const boundariesFor = (values) => [
      values[0] - (values[1] - values[0]) / 2,
      ...values.slice(0, -1).map((value, index) => (
        (value + values[index + 1]) / 2
      )),
      values.at(-1) + (values.at(-1) - values.at(-2)) / 2,
    ];
    const xBounds = boundariesFor(columns);
    const yBounds = boundariesFor(rows);
    ctx.save();
    ctx.globalAlpha = this.isPreparation() ? 0.42 : 0.24;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    xBounds.forEach((x) => {
      ctx.moveTo(x, yBounds[0]);
      ctx.lineTo(x, yBounds.at(-1));
    });
    yBounds.forEach((y) => {
      ctx.moveTo(xBounds[0], y);
      ctx.lineTo(xBounds.at(-1), y);
    });
    ctx.stroke();
    ctx.restore();
    return true;
  }

  drawLaneField(ctx, lanes, stage) {
    this.drawDeploymentGrid(ctx, lanes, stage);
  }

  drawLaneGateways(ctx, lanes, stage, coreX, coreY) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.25;
    for (const lane of lanes) {
      ctx.globalAlpha = this.isPreparation() ? 0.36 : 0.2;
      ctx.beginPath();
      ctx.moveTo(lane.x, 855);
      ctx.lineTo(lane.x, 948);
      ctx.bezierCurveTo(lane.x, 992, coreX, coreY - 54, coreX, coreY - 20);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPath(ctx, points, laneIndex = 0) {
    for (let index = 1; index < points.length; index += 1) {
      const left = points[index - 1];
      const right = points[index];
      const dx = right.x - left.x;
      const dy = right.y - left.y;
      const length = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx);
      drawAssetOrFallback(ctx, this.assetStore, 'tile-route-open', (asset) => {
        ctx.translate((left.x + right.x) / 2, (left.y + right.y) / 2);
        ctx.rotate(angle);
        ctx.globalAlpha *= 0.2;
        ctx.drawImage(asset, -length / 2 - 8, -25, length + 16, 50);
      }, () => {
        ctx.save();
        ctx.strokeStyle = laneIndex % 2
          ? 'rgba(86, 151, 143, 0.18)'
          : 'rgba(76, 143, 105, 0.18)';
        ctx.lineWidth = 34;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 255, 236, 0.5)';
        ctx.lineWidth = 3;
        ctx.setLineDash?.([9, 16]);
        ctx.stroke();
        ctx.restore();
      });
    }
  }

  drawSquadMembers(ctx, squad, x, y, { anchorIndependentMembers = false } = {}) {
    const squadType = squadTypeFor(squad.type, squad.squadType || squad.unitType);
    const visual = soldierVisualFor(squad.type, squadType);
    const formations = {
      1: [{ x: 0, y: 6, scale: 1 }],
      2: [{ x: -24, y: 5, scale: 1 }, { x: 24, y: 5, scale: 1 }],
      3: [
        { x: 0, y: -19, scale: 0.92 },
        { x: -26, y: 9, scale: 1 },
        { x: 26, y: 9, scale: 1 },
      ],
      4: [
        { x: -25, y: -20, scale: 0.92 },
        { x: 25, y: -20, scale: 0.92 },
        { x: -28, y: 12, scale: 1 },
        { x: 28, y: 12, scale: 1 },
      ],
    };
    const hasIndependentMembers = Array.isArray(squad.members);
    const members = hasIndependentMembers
      ? squad.members.filter((member) => (
        member && member.alive !== false
        && (!Number.isFinite(Number(member.hp)) || Number(member.hp) > 0)
      ))
      : (formations[clamp(Math.floor(Number(squad.aliveMembers) || 0), 0, 4)] || [])
        .map((position) => ({ offsetX: position.x, offsetY: position.y, scale: position.scale }));
    const deployX = Number.isFinite(Number(squad.deployX))
      ? Number(squad.deployX) : Number(squad.x);
    const deployY = Number.isFinite(Number(squad.deployY))
      ? Number(squad.deployY) : Number(squad.y);
    const anchorOffsetX = anchorIndependentMembers && Number.isFinite(deployX)
      ? x - deployX : 0;
    const anchorOffsetY = anchorIndependentMembers && Number.isFinite(deployY)
      ? y - deployY : 0;
    members.forEach((member, memberIndex) => {
      const absoluteX = member.x == null ? Number.NaN : Number(member.x);
      const absoluteY = member.y == null ? Number.NaN : Number(member.y);
      const offsetX = Number(member.offsetX);
      const offsetY = Number(member.offsetY);
      const memberX = Number.isFinite(absoluteX)
        ? absoluteX + anchorOffsetX : x + (Number.isFinite(offsetX) ? offsetX : 0);
      const memberY = Number.isFinite(absoluteY)
        ? absoluteY + anchorOffsetY + SQUAD_GRID_RENDER_Y_OFFSET
        : y + (Number.isFinite(offsetY) ? offsetY : 0) + 13
          + SQUAD_GRID_RENDER_Y_OFFSET;
      const memberScale = clamp(Number(member.scale) || 1, 0.45, 1.6);
      const animationPhaseIndex = Number.isInteger(member.memberIndex)
        ? member.memberIndex : memberIndex;
      const moving = member.moving == null ? Boolean(squad.moving) : Boolean(member.moving);
      const animation = this.characterAnimationSample(
        squadMemberAnimationKey(squad, member, memberIndex),
        visual.ownerId,
        moving ? 'move' : 'idle',
      );
      drawSoldier(ctx, memberX, memberY, SQUAD_MEMBER_RENDER_SIZE * memberScale, {
        assetKey: visual.assetKey,
        squadType,
        time: this.state.time + animationPhaseIndex * 0.12,
        facing: (member.facing ?? squad.facing) === -1 ? -1 : 1,
        hit: clamp(Number(member.hitPulse ?? squad.hitPulse) || 0, 0, 1),
        attackPulse: clamp(Number(member.attackPulse ?? squad.attackPulse) || 0, 0, 1),
        moving,
        assetStore: this.assetStore,
        ...animation,
      });
    });
  }

  drawPad(ctx, pad, padIndex) {
    const tower = towerByPad(this.state, padIndex);
    const preparation = this.isPreparation();
    const target = tutorialTargetForState(this.state);
    const tutorialPad = target?.type === 'pad' && target.padIndex === padIndex;
    const activeCardUid = preparation
      ? (this.drag?.kind === 'card' ? this.drag.uid : this.selectedCardUid)
      : null;
    const activeCard = this.state.hand.find((card) => card.uid === activeCardUid);
    const activeTowerUid = preparation && this.drag?.kind === 'tower'
      && this.drag.longPressReady
      ? this.drag.uid
      : null;
    const activeTower = this.state.towers.find((candidate) => candidate.uid === activeTowerUid);
    let dropIntent = null;
    if (activeCard) {
      if (!tower) dropIntent = 'place';
      else if (canMergeCardIntoTower(activeCard, tower)) dropIntent = 'merge';
    } else if (activeTower && activeTower.uid !== tower?.uid) {
      if (!tower) dropIntent = 'move';
      else if (canMergeTowers(activeTower, tower)) dropIntent = 'merge';
    }
    if (!tower && squadTypeForPurchase(this.selectedPurchase)) dropIntent = 'place';
    const hoverRect = {
      x: pad.x - DEPLOY_CELL_SIZE.width / 2,
      y: pad.y - DEPLOY_CELL_SIZE.height / 2,
      width: DEPLOY_CELL_SIZE.width,
      height: DEPLOY_CELL_SIZE.height,
    };
    const hot = Boolean(this.drag?.moved && this.hoverPoint && insideRect(this.hoverPoint, hoverRect));
    if (dropIntent || tower || tutorialPad) {
      const highlightRect = {
        x: pad.x - DEPLOY_HIGHLIGHT_SIZE.width / 2,
        y: pad.y - DEPLOY_HIGHLIGHT_SIZE.height / 2,
        width: DEPLOY_HIGHLIGHT_SIZE.width,
        height: DEPLOY_HIGHLIGHT_SIZE.height,
      };
      ctx.save();
      ctx.globalAlpha = dropIntent
        ? (hot ? 0.88 : 0.64)
        : tower ? 0.18 : 0.62;
      ctx.fillStyle = dropIntent === 'merge'
        ? '#FFE59A'
        : dropIntent === 'move'
          ? '#D8EFFF'
          : dropIntent === 'place'
            ? '#D8F6D9'
            : tower ? '#D8F2DC' : '#FFF8DA';
      ctx.strokeStyle = tutorialPad
        ? COLORS.gold
        : dropIntent === 'merge'
          ? '#D79B26'
          : dropIntent === 'move'
            ? '#4E9CC9'
            : dropIntent === 'place'
              ? COLORS.mintDeep
              : '#FFFFFF';
      ctx.lineWidth = tutorialPad || dropIntent ? (hot ? 5 : 3.5) : 1.5;
      roundedPath(ctx, highlightRect.x, highlightRect.y,
        highlightRect.width, highlightRect.height, 4);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    this.addHit(`pad-${padIndex}`, {
      x: pad.x - DEPLOY_CELL_SIZE.width / 2,
      y: pad.y - DEPLOY_CELL_SIZE.height / 2,
      width: DEPLOY_CELL_SIZE.width,
      height: DEPLOY_CELL_SIZE.height,
    }, 'pad', { padIndex }, preparation && !tower
      && (Boolean(squadTypeForPurchase(this.selectedPurchase))
        || Boolean(activeCard) || Boolean(activeTower)));

    if (!tower) return;
    const squadVisualType = slimeVisualType(tower.type, tower.squadType);
    const isSquad = isSquadTower(tower);
    const definition = isSquad
      ? soldierVisualFor(tower.type, tower.squadType)
      : TOWER_TYPES[tower.type] || TOWER_TYPES[squadVisualType];
    const drawX = this.state.waveActive && Number.isFinite(tower.x) ? tower.x : pad.x;
    const drawY = this.state.waveActive && Number.isFinite(tower.y) ? tower.y : pad.y;
    const selected = tower.uid === this.state.selectedTowerUid;
    const animation = this.characterAnimationSample(
      `tower:${tower.uid}`,
      definition.ownerId,
    );
    if (isSquad) {
      this.drawSquadMembers(ctx, tower, drawX, drawY);
    } else {
      this.drawFriendlyCharacter(ctx, drawX, drawY + 6, 76, tower.type, {
        time: this.state.time,
        phase: padIndex * 0.41,
        star: tower.star,
        facing: tower.facing === -1 ? -1 : 1,
        selected,
        hit: clamp(Number(tower.hitPulse) || 0, 0, 1),
        expression: Number(tower.hitPulse) > 0.35 ? 'hurt' : 'normal',
        ...animation,
        ...this.characterRigOptions(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
      const starY = Math.max(BATTLE_FIELD.top + 22, drawY - 70);
      this.drawStars(ctx, drawX, starY, tower.star, definition.color);
    }
    if (!isSquad
      && Number.isFinite(tower.hp) && Number.isFinite(tower.maxHp) && tower.maxHp > 0) {
      const hpRatio = clamp(tower.hp / tower.maxHp, 0, 1);
      const bar = {
        x: drawX - 29,
        y: Math.max(BATTLE_FIELD.top + 4, drawY - 91),
        width: 58,
        height: 7,
      };
      ctx.save();
      ctx.fillStyle = 'rgba(30, 48, 58, 0.64)';
      roundedPath(ctx, bar.x, bar.y, bar.width, bar.height, 4);
      ctx.fill();
      if (hpRatio > 0) {
        ctx.fillStyle = hpRatio < 0.3 ? COLORS.coral : COLORS.mint;
        roundedPath(ctx, bar.x + 1, bar.y + 1,
          Math.max(2, (bar.width - 2) * hpRatio), bar.height - 2, 3);
        ctx.fill();
      }
      ctx.restore();
    }
    if (dropIntent === 'merge') {
      const mergeTagY = Math.max(BATTLE_FIELD.top + 4, pad.y - 116);
      panel(ctx, { x: pad.x - 24, y: mergeTagY, width: 48, height: 28 }, {
        fill: '#F4C94C', stroke: '#9B6E20', lineWidth: 2, radius: 14,
      });
      label(ctx, `★${tower.star + 1}`, pad.x, mergeTagY + 15, {
        size: 13, color: COLORS.ink, weight: 950,
      });
    }
    const towerHitRect = isSquad
      ? {
        x: drawX - DEPLOY_CELL_SIZE.width / 2 + 2,
        y: drawY - DEPLOY_CELL_SIZE.height / 2 + 2,
        width: DEPLOY_CELL_SIZE.width - 4,
        height: DEPLOY_CELL_SIZE.height - 4,
      }
      : {
        x: drawX - PAD_RADIUS, y: drawY - 76,
        width: PAD_RADIUS * 2, height: 88,
      };
    this.addHit(`tower-${tower.uid}`, towerHitRect,
      'tower', { towerUid: tower.uid, padIndex }, preparation);
  }

  drawStars(ctx, x, y, count, color) {
    const gap = 13;
    const startX = x - (count - 1) * gap / 2;
    for (let index = 0; index < count; index += 1) {
      ctx.save();
      ctx.translate(startX + index * gap, y);
      ctx.fillStyle = color;
      ctx.strokeStyle = COLORS.white;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let point = 0; point < 10; point += 1) {
        const angle = -Math.PI / 2 + point * Math.PI / 5;
        const radius = point % 2 === 0 ? 7 : 3.2;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (point === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  drawEnemy(ctx, enemy) {
    const definition = TD_ENEMIES[enemy.type] || TD_ENEMIES.bug;
    const type = MONSTER_DRAW_TYPE[enemy.type] || 'bug';
    const atlasAssetKey = ENEMY_ATLAS_ASSET_BY_TYPE[enemy.type];
    const animation = this.characterAnimationSample(
      `enemy:${enemy.uid}`,
      definition.ownerId,
      'move',
    );
    const drawOptions = {
      time: this.state.time,
      phase: Number(enemy.uid.split('-').at(-1)) * 0.31 || 0,
      facing: enemy.facing === -1 ? -1 : 1,
      hit: enemy.hitPulse,
      expression: enemy.hitPulse > 0.35 ? 'hurt' : 'normal',
      assetStore: this.assetStore,
      ...animation,
    };
    if (atlasAssetKey) {
      drawAtlasCharacter(ctx,
        enemy.x,
        enemy.y + definition.size * 0.33,
        definition.size,
        { ...drawOptions, assetKey: atlasAssetKey });
    } else {
      drawMonster(ctx, enemy.x, enemy.y + definition.size * 0.33, definition.size, type, {
        ...drawOptions,
        ...this.characterRigOptions(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
    }
    const width = definition.boss ? 82 : 52;
    const ratio = clamp(enemy.hp / Math.max(1, enemy.maxHp), 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(38,51,60,0.56)';
    roundedPath(ctx, enemy.x - width / 2, enemy.y - definition.size * 0.72, width, 7, 4);
    ctx.fill();
    if (ratio > 0) {
      ctx.fillStyle = ratio < 0.3 ? COLORS.coral : '#74CF7A';
      roundedPath(ctx, enemy.x - width / 2 + 1, enemy.y - definition.size * 0.72 + 1,
        Math.max(2, (width - 2) * ratio), 5, 3);
      ctx.fill();
    }
    ctx.restore();
  }

  drawDefeatedTowers(ctx) {
    for (const actor of this.defeatedTowers) {
      const soldierVisual = actor.squadType
        ? soldierVisualFor(actor.type, actor.squadType)
        : null;
      const definition = soldierVisual || TOWER_TYPES[actor.type];
      if (!definition) continue;
      const progress = clamp(actor.age / Math.max(0.001, actor.duration), 0, 1);
      const animation = this.characterAnimationSample(actor.key, actor.ownerId);
      ctx.save();
      ctx.globalAlpha *= clamp(1 - Math.max(0, progress - 0.48) / 0.52, 0, 1);
      ctx.translate(Math.sin(progress * 28) * (1 - progress) * 3, progress * 7);
      if (actor.squadType) {
        const visual = soldierVisual;
        drawSoldier(ctx, actor.x, actor.y + 19, SQUAD_MEMBER_DEFEAT_SIZE, {
          assetKey: visual.assetKey,
          squadType: actor.squadType,
          time: this.state.time,
          facing: actor.facing,
          hit: Math.max(0.05, 1 - progress),
          assetStore: this.assetStore,
          ...animation,
        });
      } else {
        this.drawFriendlyCharacter(ctx, actor.x, actor.y + 6, 76, actor.type, {
          time: this.state.time,
          star: actor.star,
          facing: actor.facing,
          expression: 'hurt',
          ...animation,
          ...this.characterRigOptions(actor.ownerId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
        });
      }
      ctx.restore();
      if (progress > 0.34) {
        for (let index = 0; index < 3; index += 1) {
          drawParticle(ctx,
            actor.x + (index - 1) * 16,
            actor.y - 12 - progress * (8 + index * 5),
            12 + index * 2,
            'dust', {
              progress,
              alpha: (1 - progress) * 0.62,
              assetStore: this.assetStore,
            });
        }
      }
    }
  }

  drawDefeatedActors(ctx) {
    for (const actor of this.defeatedActors) {
      const definition = TD_ENEMIES[actor.type] || TD_ENEMIES.bug;
      const type = MONSTER_DRAW_TYPE[actor.type] || 'bug';
      const atlasAssetKey = ENEMY_ATLAS_ASSET_BY_TYPE[actor.type];
      const animation = this.characterAnimationSample(
        actor.key,
        actor.ownerId,
        'move',
      );
      const fadeStart = actor.duration * 0.72;
      const alpha = actor.age <= fadeStart
        ? 1
        : clamp(1 - (actor.age - fadeStart) / Math.max(0.001, actor.duration - fadeStart), 0, 1);
      const drawOptions = {
        time: this.state.time,
        facing: actor.facing,
        alpha,
        assetStore: this.assetStore,
        ...animation,
      };
      if (atlasAssetKey) {
        drawAtlasCharacter(ctx,
          actor.x,
          actor.y + definition.size * 0.33,
          definition.size,
          { ...drawOptions, assetKey: atlasAssetKey });
      } else {
        drawMonster(ctx, actor.x, actor.y + definition.size * 0.33, definition.size, type, {
          ...drawOptions,
          ...this.characterRigOptions(actor.ownerId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
        });
      }
    }
  }

  resetSkillRenderBudget() {
    this.skillRenderBudget = { ...SKILL_RENDER_LIMITS };
  }

  spendSkillRenderBudget(kind, amount = 1) {
    if (!this.skillRenderBudget) this.resetSkillRenderBudget();
    const cost = Math.max(1, Math.floor(Number(amount) || 1));
    if ((this.skillRenderBudget[kind] || 0) < cost) return false;
    this.skillRenderBudget[kind] -= cost;
    return true;
  }

  drawSkillComponents(ctx, key, instances) {
    if (!key || !this.assetStore || typeof this.assetStore.useOrFallback !== 'function') {
      return false;
    }
    const drawable = [];
    for (const instance of Array.isArray(instances) ? instances : []) {
      if (!instance || !this.spendSkillRenderBudget('components')) break;
      drawable.push(instance);
    }
    if (!drawable.length) return false;
    return this.assetStore.useOrFallback(key, (asset) => {
      for (const instance of drawable) {
        const width = Math.max(1, finiteNumber(instance.width, instance.size, 32));
        const height = Math.max(1, finiteNumber(instance.height, instance.size, width));
        const anchorX = clamp(finiteNumber(instance.anchorX, 0.5), 0, 1);
        const anchorY = clamp(finiteNumber(instance.anchorY, 0.5), 0, 1);
        ctx.save();
        ctx.globalAlpha = (Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1)
          * clamp(finiteNumber(instance.alpha, 1), 0, 1);
        ctx.translate(finiteNumber(instance.x), finiteNumber(instance.y));
        ctx.rotate(finiteNumber(instance.rotation));
        ctx.drawImage(asset, -width * anchorX, -height * anchorY, width, height);
        ctx.restore();
      }
    }, () => {});
  }

  drawSkillMote(ctx, x, y, size, color, alpha = 1, rotation = 0) {
    if (!this.spendSkillRenderBudget('motes')) return false;
    const moteSize = Math.max(1.5, Number(size) || 4);
    ctx.save();
    ctx.globalAlpha = (Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1)
      * clamp(Number(alpha) || 0, 0, 1);
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, 0, moteSize, moteSize * 0.64, 0, 0, TAU);
    ctx.fill();
    if (moteSize >= 4) {
      ctx.globalAlpha *= 0.72;
      ctx.fillStyle = COLORS.white;
      ctx.beginPath();
      ctx.ellipse(-moteSize * 0.26, -moteSize * 0.17,
        moteSize * 0.2, moteSize * 0.13, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    return true;
  }

  drawSkillShock(ctx, effect, progress = skillProgress(effect)) {
    const style = skillStyle(effect);
    const x = finiteNumber(effect.x, effect.originX, this.state.hero?.x);
    const y = finiteNumber(effect.y, effect.originY, this.state.hero?.y);
    const radius = Math.max(24, finiteNumber(effect.radius, effect.width, 120));
    const stage = clamp(Math.floor(finiteNumber(effect.stage, effect.stepIndex + 1, 1)), 1, 3);
    const fade = clamp(1 - progress, 0, 1);
    ctx.save();
    ctx.lineCap = 'round';
    for (let index = 0; index < 3; index += 1) {
      const delay = index * 0.105;
      const local = clamp((progress - delay) / Math.max(0.001, 1 - delay), 0, 1);
      if (local <= 0) continue;
      const ringRadius = radius * (0.1 + easeOutCubic(local) * 0.9);
      ctx.globalAlpha = (0.66 - index * 0.13) * (1 - local) * (0.72 + stage * 0.09);
      ctx.strokeStyle = index === 1 ? style.light : style.color;
      ctx.lineWidth = Math.max(2, (9 - index * 2.2) * (1 - local * 0.52));
      ctx.beginPath();
      ctx.arc(x, y, ringRadius, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = fade * 0.13;
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.arc(x, y, radius * easeOutCubic(progress), 0, TAU);
    ctx.fill();
    ctx.restore();

    const heroType = skillHeroType(effect);
    const expand = easeOutCubic(progress);
    if (heroType === 'shell') {
      this.drawSkillComponents(ctx, SKILL_COMPONENT_ASSETS.shellImpact, [{
        x,
        y,
        width: radius * (0.44 + expand * 0.34),
        height: radius * (0.44 + expand * 0.34),
        rotation: progress * 0.42,
        alpha: fade * 0.96,
      }]);
    } else if (heroType === 'bubble') {
      this.drawSkillComponents(ctx, SKILL_COMPONENT_ASSETS.bubbleBurst, [{
        x,
        y,
        width: radius * (0.52 + expand * 0.66),
        height: radius * (0.52 + expand * 0.66),
        rotation: -progress * 0.28,
        alpha: fade * 0.9,
      }]);
    } else if (heroType === 'sprout') {
      const thornCount = stage >= 3 ? 7 : 5;
      const thornTravel = radius * (0.14 + expand * 0.78);
      this.drawSkillComponents(ctx, SKILL_COMPONENT_ASSETS.sproutThorn,
        Array.from({ length: thornCount }, (_, index) => {
          const angle = index * TAU / thornCount + skillNoise(effect.seed, index) * 0.28;
          return {
            x: x + Math.cos(angle) * thornTravel,
            y: y + Math.sin(angle) * thornTravel,
            width: 22 + stage * 3,
            height: 42 + stage * 5,
            rotation: angle + Math.PI / 2,
            anchorY: 0.78,
            alpha: fade * 0.96,
          };
        }));
    }

    const seed = finiteNumber(effect.seed, effect.stage, effect.stepIndex, 1);
    const moteCount = stage >= 3 ? 7 : 5;
    for (let index = 0; index < moteCount; index += 1) {
      const angle = index * TAU / moteCount + skillNoise(seed, index) * 0.42;
      const travel = radius * (0.18 + easeOutCubic(progress) * 0.78);
      this.drawSkillMote(ctx,
        x + Math.cos(angle) * travel,
        y + Math.sin(angle) * travel,
        3.5 + stage * 0.7,
        index % 3 === 0 ? style.light : style.color,
        fade * 0.78,
        angle + Math.PI / 2);
    }
  }

  drawSkillField(ctx, actor) {
    const style = skillStyle(actor);
    const age = Math.max(0, finiteNumber(actor.age, actor.elapsed));
    const duration = Math.max(0.001, finiteNumber(actor.duration, 1));
    const x = finiteNumber(actor.x, actor.originX, this.state.hero?.x);
    const y = finiteNumber(actor.y, actor.originY, this.state.hero?.y);
    const radius = Math.max(32, finiteNumber(actor.radius, actor.width, 160));
    const reveal = easeOutCubic(clamp(age / 0.2, 0, 1));
    const fade = clamp((duration - age) / 0.22, 0, 1);
    const pulse = 1 + Math.sin(age * 7.5) * 0.025;
    ctx.save();
    ctx.globalAlpha = fade * 0.1;
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.arc(x, y, radius * reveal, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = fade * 0.72;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 6;
    ctx.setLineDash?.([18, 12]);
    ctx.lineDashOffset = -age * 76;
    ctx.beginPath();
    ctx.arc(x, y, radius * reveal * pulse, 0, TAU);
    ctx.stroke();
    ctx.setLineDash?.([]);
    ctx.globalAlpha = fade * 0.42;
    ctx.strokeStyle = style.light;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, radius * reveal * 0.72, 0, TAU);
    ctx.stroke();
    ctx.restore();

    const heroType = skillHeroType(actor);
    if (heroType === 'bubble') {
      this.drawSkillComponents(ctx, SKILL_COMPONENT_ASSETS.bubbleOrb,
        Array.from({ length: 4 }, (_, index) => {
          const angle = age * (index % 2 ? -1.25 : 1.08) + index * TAU / 4;
          const orbit = radius * (0.48 + (index % 2) * 0.3) * reveal;
          const size = 22 + (index % 2) * 7;
          return {
            x: x + Math.cos(angle) * orbit,
            y: y + Math.sin(angle) * orbit,
            size,
            rotation: angle * 0.22,
            alpha: fade * (0.72 + (index % 2) * 0.16),
          };
        }));
    } else if (heroType === 'ember') {
      this.drawSkillComponents(ctx, SKILL_COMPONENT_ASSETS.emberScorch,
        Array.from({ length: 4 }, (_, index) => {
          const angle = age * (1.68 + index * 0.12) + index * TAU / 4;
          const orbit = radius * (0.16 + index * 0.095) * reveal;
          const pulseScale = 1 + Math.sin(age * 8.6 + index * 1.4) * 0.09;
          return {
            x: x + Math.cos(angle) * orbit,
            y: y + Math.sin(angle) * orbit,
            size: radius * (0.34 - index * 0.025) * pulseScale,
            rotation: angle + age * 1.9,
            alpha: fade * (0.82 - index * 0.1),
          };
        }));
    } else if (heroType === 'cloud') {
      const vortexPulse = 1 + Math.sin(age * 6.4) * 0.08;
      this.drawSkillComponents(ctx, SKILL_COMPONENT_ASSETS.cloudVortex, [
        {
          x,
          y,
          size: radius * 0.88 * reveal * vortexPulse,
          rotation: -age * 2.25,
          alpha: fade * 0.9,
        },
        ...Array.from({ length: 3 }, (_, index) => {
          const angle = age * (2.05 + index * 0.18) + index * TAU / 3;
          const orbit = radius * (0.48 + index * 0.1) * reveal;
          return {
            x: x + Math.cos(angle) * orbit,
            y: y + Math.sin(angle) * orbit,
            size: radius * (0.28 - index * 0.025),
            rotation: angle - age * 2.7,
            alpha: fade * (0.7 - index * 0.09),
          };
        }),
      ]);
    }

    for (let index = 0; index < 6; index += 1) {
      const angle = age * (index % 2 ? -1.45 : 1.2) + index * TAU / 6;
      const orbit = radius * (0.52 + (index % 3) * 0.16) * reveal;
      this.drawSkillMote(ctx,
        x + Math.cos(angle) * orbit,
        y + Math.sin(angle) * orbit,
        4 + (index % 2) * 1.5,
        index % 2 ? style.light : style.color,
        fade * 0.72,
        angle);
    }
  }

  drawSkillBeam(ctx, actor) {
    const style = skillStyle(actor);
    const hero = this.state.hero?.uid === actor.heroUid ? this.state.hero : null;
    const startX = actor.followHero && hero
      ? finiteNumber(hero.x, actor.originX) : finiteNumber(actor.originX, actor.x);
    const startY = actor.followHero && hero
      ? finiteNumber(hero.y, actor.originY) - 24 : finiteNumber(actor.originY, actor.y);
    const directionX = finiteNumber(actor.directionX, 0);
    const directionY = finiteNumber(actor.directionY, -1);
    const length = Math.max(1, finiteNumber(actor.length, 320));
    const targetX = finiteNumber(actor.endX, actor.targetX, startX + directionX * length);
    const targetY = finiteNumber(actor.endY, actor.targetY, startY + directionY * length);
    const age = Math.max(0, finiteNumber(actor.age, actor.elapsed));
    const duration = Math.max(0.001, finiteNumber(actor.duration, 1));
    const reveal = easeOutCubic(clamp(age / 0.1, 0, 1));
    const fade = clamp((duration - age) / 0.16, 0, 1);
    const endX = lerp(startX, targetX, reveal);
    const endY = lerp(startY, targetY, reveal);
    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const px = -dy / distance;
    const py = dx / distance;
    const shimmer = Math.sin(age * 34 + finiteNumber(actor.stage, 1)) * 1.6;
    const width = Math.max(8, finiteNumber(actor.width, 16));
    const lineStartX = startX + px * shimmer;
    const lineStartY = startY + py * shimmer;
    const lineEndX = endX + px * shimmer;
    const lineEndY = endY + py * shimmer;
    const beamLine = (strokeStyle, lineWidth, alpha) => {
      ctx.globalAlpha = fade * alpha;
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(lineStartX, lineStartY);
      ctx.lineTo(lineEndX, lineEndY);
      ctx.stroke();
    };
    ctx.save();
    ctx.lineCap = 'round';
    beamLine(style.deep, width * 1.25, 0.28);
    beamLine(style.color, width * 0.72, 0.88);
    beamLine(style.light, Math.max(2, width * 0.22), 1);
    ctx.globalAlpha = fade * 0.82;
    ctx.strokeStyle = style.light;
    ctx.lineWidth = Math.max(2, width * 0.18);
    ctx.beginPath();
    ctx.arc(endX, endY, width * (0.58 + Math.sin(age * 19) * 0.08), 0, TAU);
    ctx.stroke();
    ctx.restore();

    const heroType = skillHeroType(actor);
    if (heroType === 'needle') {
      const rotation = Math.atan2(dy, dx);
      this.drawSkillComponents(ctx, SKILL_COMPONENT_ASSETS.crystalLaserEmitter, [{
        x: startX,
        y: startY,
        size: width * 3.8,
        rotation,
        alpha: fade,
      }]);
      this.drawSkillComponents(ctx, SKILL_COMPONENT_ASSETS.crystalLaserHit, [{
        x: endX,
        y: endY,
        size: width * (3.8 + reveal * 0.7),
        rotation: -age * 2.2,
        alpha: fade * reveal,
      }]);
    } else if (heroType === 'spark') {
      const rotation = Math.atan2(dy, dx);
      this.drawSkillComponents(ctx, SKILL_COMPONENT_ASSETS.sparkChain,
        Array.from({ length: 5 }, (_, index) => {
          const along = ((age * 2.15 + index / 5) % 1) * reveal;
          const side = Math.sin(age * 18 + index * 1.8) * width * 0.32;
          const pulseScale = 1 + Math.sin(age * 12 + index) * 0.12;
          return {
            x: lerp(startX, endX, along) + px * side,
            y: lerp(startY, endY, along) + py * side,
            size: Math.min(96, width * 2.2) * pulseScale,
            rotation: rotation + Math.sin(age * 15 + index) * 0.13,
            alpha: fade * (0.58 + along * 0.36),
          };
        }));
    }

    for (let index = 0; index < 3; index += 1) {
      const along = (age * 2.4 + index / 3) % 1;
      this.drawSkillMote(ctx,
        lerp(startX, endX, along) + px * Math.sin(age * 13 + index) * width * 0.3,
        lerp(startY, endY, along) + py * Math.sin(age * 13 + index) * width * 0.3,
        2.6 + index * 0.45,
        style.light,
        fade * (0.45 + along * 0.4),
        Math.atan2(dy, dx));
    }
  }

  drawSkillWave(ctx, actor) {
    const style = skillStyle(actor);
    const x = finiteNumber(actor.x, actor.originX);
    const y = finiteNumber(actor.y, actor.originY);
    let dx = finiteNumber(actor.directionX, x - finiteNumber(actor.previousX, x));
    let dy = finiteNumber(actor.directionY, y - finiteNumber(actor.previousY, y - 1));
    const directionLength = Math.max(0.001, Math.hypot(dx, dy));
    dx /= directionLength;
    dy /= directionLength;
    const px = -dy;
    const py = dx;
    const age = Math.max(0, finiteNumber(actor.age, actor.elapsed));
    const duration = Math.max(0.001, finiteNumber(actor.duration, 1));
    const fade = Math.min(clamp(age / 0.1, 0, 1), clamp((duration - age) / 0.18, 0, 1));
    const width = Math.max(28, finiteNumber(actor.width, actor.radius, 110));
    const tail = Math.min(width * 0.85, 46 + finiteNumber(actor.speed, 280) * 0.08);
    const tailX = finiteNumber(actor.previousX, x - dx * tail);
    const tailY = finiteNumber(actor.previousY, y - dy * tail);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = fade * 0.24;
    ctx.strokeStyle = style.deep;
    ctx.lineWidth = width * 0.48;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalAlpha = fade * 0.78;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = width * 0.25;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.globalAlpha = fade;
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.moveTo(x - px * width * 0.5, y - py * width * 0.5);
    ctx.quadraticCurveTo(
      x + dx * width * (0.24 + Math.sin(age * 10) * 0.05),
      y + dy * width * (0.24 + Math.sin(age * 10) * 0.05),
      x + px * width * 0.5,
      y + py * width * 0.5,
    );
    ctx.quadraticCurveTo(x - dx * width * 0.12, y - dy * width * 0.12,
      x - px * width * 0.5, y - py * width * 0.5);
    ctx.fill();
    ctx.globalAlpha = fade * 0.82;
    ctx.strokeStyle = style.light;
    ctx.lineWidth = Math.max(2, width * 0.055);
    ctx.beginPath();
    ctx.moveTo(x - px * width * 0.42, y - py * width * 0.42);
    ctx.quadraticCurveTo(x + dx * width * 0.2, y + dy * width * 0.2,
      x + px * width * 0.42, y + py * width * 0.42);
    ctx.stroke();
    ctx.restore();

    const heroType = skillHeroType(actor);
    if (heroType === 'dew') {
      this.drawSkillComponents(ctx, SKILL_COMPONENT_ASSETS.dewWaveCrest, [{
        x: x + dx * width * 0.06,
        y: y + dy * width * 0.06,
        width: width * 1.18,
        height: width * 0.82,
        rotation: Math.atan2(dy, dx),
        alpha: fade,
      }]);
    } else if (heroType === 'drill' || heroType === 'frost') {
      const assetKey = EXPANDED_SKILL_COMPONENT_BY_TYPE[heroType];
      const travelAngle = Math.atan2(dy, dx);
      this.drawSkillComponents(ctx, assetKey,
        Array.from({ length: 3 }, (_, index) => {
          const lag = tail * index * 0.28;
          const sway = Math.sin(age * 16 + index * 1.6) * width * 0.045 * index;
          const pulseScale = 1 + Math.sin(age * 10.5 + index) * 0.065;
          return {
            x: x - dx * lag + px * sway,
            y: y - dy * lag + py * sway,
            width: width * (heroType === 'drill' ? 1.08 : 1.18)
              * (1 - index * 0.16) * pulseScale,
            height: width * (heroType === 'drill' ? 0.86 : 1.02)
              * (1 - index * 0.16) * pulseScale,
            rotation: travelAngle + Math.sin(age * 12 + index) * 0.045,
            alpha: fade * (0.94 - index * 0.25),
          };
        }));
    }

    for (let index = 0; index < 4; index += 1) {
      const behind = tail * (0.22 + index * 0.2);
      const side = (index % 2 ? 1 : -1) * width * (0.12 + index * 0.035);
      this.drawSkillMote(ctx,
        x - dx * behind + px * side,
        y - dy * behind + py * side,
        3.5 + index * 0.6,
        index % 2 ? style.light : style.color,
        fade * (0.68 - index * 0.1),
        Math.atan2(dy, dx));
    }
  }

  drawSkillImpact(ctx, effect, progress = skillProgress(effect)) {
    if (!this.spendSkillRenderBudget('impacts')) return;
    const style = skillStyle(effect);
    const x = finiteNumber(effect.x, effect.targetX, effect.originX);
    const y = finiteNumber(effect.y, effect.targetY, effect.originY);
    const radius = Math.max(22, finiteNumber(effect.radius, effect.splashRadius, 64));
    const expand = easeOutCubic(progress);
    const fade = clamp(1 - progress, 0, 1);
    ctx.save();
    ctx.globalAlpha = fade * 0.72;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = Math.max(2, 8 * (1 - progress * 0.65));
    ctx.beginPath();
    ctx.arc(x, y, radius * (0.12 + expand * 0.88), 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = fade * 0.58;
    ctx.fillStyle = style.light;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2, radius * (0.34 - progress * 0.22)), 0, TAU);
    ctx.fill();
    ctx.lineCap = 'round';
    for (let index = 0; index < 6; index += 1) {
      const angle = index * TAU / 6 + skillNoise(effect.seed, index) * 0.36;
      const inner = radius * (0.18 + expand * 0.16);
      const outer = radius * (0.3 + expand * (0.52 + skillNoise(effect.seed, index + 10) * 0.18));
      ctx.globalAlpha = fade * (index % 2 ? 0.52 : 0.82);
      ctx.strokeStyle = index % 2 ? style.color : style.light;
      ctx.lineWidth = index % 2 ? 3 : 5;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
      ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();
    const impactAsset = {
      shell: SKILL_COMPONENT_ASSETS.shellImpact,
      bubble: SKILL_COMPONENT_ASSETS.bubbleBurst,
      berry: SKILL_COMPONENT_ASSETS.berryBurst,
    }[skillHeroType(effect)];
    if (impactAsset) {
      const size = radius * (0.58 + expand * 1.02);
      this.drawSkillComponents(ctx, impactAsset, [{
        x,
        y,
        size,
        rotation: progress * (skillHeroType(effect) === 'berry' ? 0.62 : -0.32),
        alpha: fade * 0.96,
      }]);
    }
    const heroType = skillHeroType(effect);
    const expandedImpactAsset = EXPANDED_SKILL_COMPONENT_BY_TYPE[heroType];
    if (expandedImpactAsset) {
      let instances = [];
      if (heroType === 'bell') {
        instances = Array.from({ length: 3 }, (_, index) => {
          const delay = index * 0.1;
          const local = clamp((progress - delay) / Math.max(0.001, 1 - delay), 0, 1);
          return {
            x,
            y,
            size: radius * (0.35 + easeOutCubic(local) * (0.58 + index * 0.18)),
            rotation: (index % 2 ? -1 : 1) * local * 0.5,
            alpha: local > 0 ? (1 - local) * (0.9 - index * 0.12) : 0,
          };
        });
      } else if (heroType === 'ember') {
        instances = Array.from({ length: 4 }, (_, index) => {
          const angle = index * TAU / 4 + progress * 1.35;
          const travel = radius * (0.08 + expand * (0.3 + index * 0.055));
          return {
            x: x + Math.cos(angle) * travel,
            y: y + Math.sin(angle) * travel,
            size: radius * (0.56 - index * 0.045) * (1 + Math.sin(progress * 18 + index) * 0.08),
            rotation: angle + progress * 2.4,
            alpha: fade * (0.88 - index * 0.11),
          };
        });
      } else if (heroType === 'ink') {
        instances = Array.from({ length: 5 }, (_, index) => {
          const angle = -Math.PI * 0.86 + index * Math.PI * 0.18 + progress * 0.42;
          const travel = radius * (0.12 + expand * (0.42 + index * 0.055));
          return {
            x: x + Math.cos(angle) * travel,
            y: y + Math.sin(angle) * travel,
            size: radius * (0.52 - index * 0.035),
            rotation: angle + Math.PI / 2 + progress * 1.1,
            alpha: fade * (0.9 - index * 0.08),
          };
        });
      } else if (heroType === 'cloud') {
        instances = [{
          x,
          y,
          size: radius * (0.62 + expand * 0.62),
          rotation: -progress * 2.8,
          alpha: fade * 0.9,
        }, ...Array.from({ length: 3 }, (_, index) => {
          const angle = progress * 5.4 + index * TAU / 3;
          const travel = radius * (0.18 + expand * 0.62);
          return {
            x: x + Math.cos(angle) * travel,
            y: y + Math.sin(angle) * travel,
            size: radius * (0.34 - index * 0.025),
            rotation: angle - progress * 3.2,
            alpha: fade * (0.72 - index * 0.08),
          };
        })];
      } else if (heroType === 'honey') {
        instances = Array.from({ length: 4 }, (_, index) => {
          const angle = index * TAU / 4 - progress * 1.6;
          const travel = radius * (index === 0 ? 0 : 0.12 + expand * 0.48);
          return {
            x: x + Math.cos(angle) * travel,
            y: y + Math.sin(angle) * travel,
            size: radius * (index === 0 ? 0.82 : 0.48)
              * (1 + Math.sin(progress * 14 + index) * 0.08),
            rotation: angle + progress * (index % 2 ? -2.2 : 2.2),
            alpha: fade * (index === 0 ? 0.94 : 0.72),
          };
        });
      } else if (heroType === 'star') {
        instances = [{
          x,
          y,
          size: radius * (0.56 + expand * 0.72),
          rotation: progress * 3.2,
          alpha: fade * 0.96,
        }, ...Array.from({ length: 5 }, (_, index) => {
          const angle = progress * (index % 2 ? -4.2 : 4.2) + index * TAU / 5;
          const travel = radius * (0.22 + expand * 0.68);
          return {
            x: x + Math.cos(angle) * travel,
            y: y + Math.sin(angle) * travel,
            size: radius * 0.3 * (1 + Math.sin(progress * 16 + index) * 0.1),
            rotation: angle + progress * 3.8,
            alpha: fade * 0.72,
          };
        })];
      } else {
        const direction = finiteNumber(effect.directionAngle, effect.stage, 1) * 0.34;
        instances = Array.from({ length: 3 }, (_, index) => {
          const travel = radius * expand * index * 0.26;
          return {
            x: x + Math.cos(direction) * travel,
            y: y + Math.sin(direction) * travel,
            size: radius * (0.72 - index * 0.14) * (1 + Math.sin(progress * 15 + index) * 0.07),
            rotation: direction + progress * (index % 2 ? -2.1 : 2.1),
            alpha: fade * (0.9 - index * 0.18),
          };
        });
      }
      this.drawSkillComponents(ctx, expandedImpactAsset, instances);
    }
    for (let index = 0; index < 4; index += 1) {
      const angle = index * TAU / 4 + finiteNumber(effect.stage, 1) * 0.3;
      const travel = radius * (0.25 + expand * 0.72);
      this.drawSkillMote(ctx,
        x + Math.cos(angle) * travel,
        y + Math.sin(angle) * travel,
        3.5 + index * 0.55,
        index % 2 ? style.light : style.color,
        fade * 0.8,
        angle);
    }
  }

  drawHeroSkillActors(ctx, layer = 'front') {
    const actors = Array.isArray(this.state.heroSkillActors) ? this.state.heroSkillActors : [];
    for (const actor of actors) {
      if (!actor || finiteNumber(actor.age, 0) >= Math.max(0.001, finiteNumber(actor.duration, 1))) {
        continue;
      }
      const actorLayer = actor.layer || (actor.type === 'field' ? 'back' : 'front');
      if (actorLayer !== layer || !this.spendSkillRenderBudget('actors')) continue;
      if (actor.type === 'beam') this.drawSkillBeam(ctx, actor);
      else if (actor.type === 'field') this.drawSkillField(ctx, actor);
      else if (actor.type === 'wave') this.drawSkillWave(ctx, actor);
    }
  }

  drawSkillProjectile(ctx, projectile, angle) {
    const style = skillStyle(projectile);
    const age = Math.max(0, finiteNumber(projectile.age));
    const maxAge = Math.max(0.001, finiteNumber(projectile.maxAge, 1.2));
    const progress = clamp(age / maxAge, 0, 1);
    const size = projectile.type === 'berry' ? 27 : 23;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const remaining = Math.hypot(
      finiteNumber(projectile.targetX) - finiteNumber(projectile.x),
      finiteNumber(projectile.targetY) - finiteNumber(projectile.y),
    );
    const travelled = age * Math.max(1, finiteNumber(projectile.speed, 460));
    const flightProgress = clamp(travelled / Math.max(1, travelled + remaining), 0, 1);
    const arc = Math.sin(flightProgress * Math.PI);
    const volleyIndex = Math.max(0, Math.floor(finiteNumber(projectile.volleyIndex)));
    const volleyCount = Math.max(1, Math.floor(finiteNumber(projectile.volleyCount, 1)));
    const lateral = (volleyIndex - (volleyCount - 1) / 2) * 15 * arc;
    const renderX = projectile.x - sin * lateral;
    const renderY = projectile.y + cos * lateral - arc * (24 + volleyIndex * 2);
    for (let index = 1; index <= 3; index += 1) {
      if (!this.spendSkillRenderBudget('projectileTrails')) break;
      const distance = 8 + index * 8;
      const side = Math.sin(age * 16 + index * 1.7) * (2 + index);
      ctx.save();
      ctx.globalAlpha = 0.62 - index * 0.14;
      ctx.fillStyle = index % 2 ? style.color : style.light;
      ctx.beginPath();
      ctx.ellipse(
        renderX - cos * distance - sin * side,
        renderY - sin * distance + cos * side,
        Math.max(2, size * (0.2 - index * 0.025)),
        Math.max(1.5, size * (0.13 - index * 0.018)),
        angle,
        0,
        TAU,
      );
      ctx.fill();
      ctx.restore();
    }

    const heroType = skillHeroType(projectile);
    const expandedProjectileAsset = EXPANDED_SKILL_COMPONENT_BY_TYPE[heroType];
    if (expandedProjectileAsset) {
      const spinRate = heroType === 'star' ? 4.8
        : heroType === 'honey' ? -2.7
          : heroType === 'ink' ? 1.9 : 2.4;
      const baseScale = heroType === 'honey' ? 2.05
        : heroType === 'ink' ? 1.86 : 1.72;
      this.drawSkillComponents(ctx, expandedProjectileAsset,
        Array.from({ length: 3 }, (_, index) => {
          const lag = index * size * 0.42;
          const side = Math.sin(age * 17 + index * 1.7) * index * size * 0.08;
          const pulseScale = 1 + Math.sin(age * 12 + index) * 0.08;
          return {
            x: renderX - cos * lag - sin * side,
            y: renderY - sin * lag + cos * side,
            size: size * baseScale * (1 - index * 0.19) * pulseScale,
            rotation: angle + age * spinRate + index * 0.22,
            alpha: 1 - index * 0.28,
          };
        }));
      return;
    }

    if (projectile.type !== 'berry') {
      drawProjectile(ctx, renderX, renderY, size, projectile.type, {
        angle,
        alpha: 1,
        progress,
        assetStore: this.assetStore,
      });
      return;
    }

    this.drawSkillComponents(ctx, SKILL_COMPONENT_ASSETS.berryBomb, [{
      x: renderX,
      y: renderY,
      size: size * 1.66,
      rotation: angle - Math.PI / 2,
      alpha: 1,
    }]);
  }

  drawShot(ctx, projectile) {
    const angle = Math.atan2(projectile.targetY - projectile.y, projectile.targetX - projectile.x);
    if (isHeroSkillProjectile(projectile)) {
      this.drawSkillProjectile(ctx, projectile, angle);
      return;
    }
    const reinforcementStyle = reinforcementProjectileStyleFor(projectile);
    if (reinforcementStyle) {
      this.drawReinforcementProjectile(ctx, projectile, angle, reinforcementStyle);
      return;
    }
    const star = clamp(Math.floor(projectile.star || 1), 1, TD_MAX_STAR);
    const baseSize = projectile.type === 'needle' ? 19 : 16;
    const evolvedSize = (baseSize + (star - 1) * 1.8) * (projectile.secondary ? 0.82 : 1);
    drawProjectile(ctx, projectile.x, projectile.y, evolvedSize,
      projectile.type, {
        angle,
        star,
        alpha: projectile.secondary ? 0.82 : 1,
        progress: clamp(projectile.age / 1.2, 0, 1),
        assetStore: this.assetStore,
      });
  }

  drawReinforcementProjectile(ctx, projectile, angle, style) {
    if (!this.assetStore || typeof this.assetStore.useOrFallback !== 'function') return false;
    const sourceWidth = REINFORCEMENT_PROJECTILE_SOURCE_SIZE.width;
    const sourceHeight = REINFORCEMENT_PROJECTILE_SOURCE_SIZE.height;
    const sourceX = style.column * sourceWidth;
    const sourceY = style.row * sourceHeight;
    const age = Math.max(0, finiteNumber(projectile.age));
    const alpha = clamp(finiteNumber(
      projectile.alpha,
      projectile.secondary ? 0.82 : 1,
    ), 0, 1);
    const bob = Math.sin(age * 13 + style.row * 0.9 + style.column * 0.55) * 1.8;
    const normalX = -Math.sin(angle);
    const normalY = Math.cos(angle);
    const x = finiteNumber(projectile.x) + normalX * bob;
    const y = finiteNumber(projectile.y) + normalY * bob;

    return this.assetStore.useOrFallback(REINFORCEMENT_PROJECTILE_ATLAS_KEY, (asset) => {
      for (let trailIndex = 3; trailIndex >= 0; trailIndex -= 1) {
        const isHead = trailIndex === 0;
        const lag = isHead ? 0 : trailIndex * 9 + (age * 78 % 7);
        const scale = isHead ? 1 : 0.88 - trailIndex * 0.1;
        const width = style.width * scale;
        const height = style.height * scale;
        const frameAge = Math.max(0, age - trailIndex * 0.028);
        const rotation = angle + frameAge * style.spinRate
          + Math.sin(frameAge * 10 + style.column) * 0.045;
        ctx.save();
        ctx.globalAlpha = (Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1)
          * alpha * (isHead ? 1 : 0.3 - trailIndex * 0.055);
        ctx.translate(x - Math.cos(angle) * lag, y - Math.sin(angle) * lag);
        ctx.rotate(rotation);
        ctx.drawImage(
          asset,
          sourceX,
          sourceY,
          sourceWidth,
          sourceHeight,
          -width / 2,
          -height / 2,
          width,
          height,
        );
        ctx.restore();
      }
    }, () => {});
  }

  drawEnemyReinforcementEffect(ctx, effect, progress) {
    if (effect.type === 'enemy-ranged-shot') {
      const visualId = REINFORCEMENT_PROJECTILE_BY_ENEMY[effect.enemyType];
      const style = REINFORCEMENT_PROJECTILE_STYLE[visualId];
      if (!style) return false;
      const sourceX = finiteNumber(effect.x);
      const sourceY = finiteNumber(effect.y);
      const targetX = finiteNumber(effect.targetX, sourceX);
      const targetY = finiteNumber(effect.targetY, sourceY);
      const travel = clamp(progress, 0, 1);
      const x = lerp(sourceX, targetX, travel);
      const y = lerp(sourceY, targetY, travel) - Math.sin(travel * Math.PI) * 8;
      this.drawReinforcementProjectile(ctx, {
        x,
        y,
        targetX,
        targetY,
        age: finiteNumber(effect.age),
        alpha: 1 - travel * 0.12,
      }, Math.atan2(targetY - sourceY, targetX - sourceX), style);
      return true;
    }
    if (effect.type !== 'enemy-charge-start' && effect.type !== 'enemy-charge-impact') {
      return false;
    }
    const style = REINFORCEMENT_PROJECTILE_STYLE.gale;
    const impact = effect.type === 'enemy-charge-impact';
    const travel = clamp(progress, 0, 1);
    const angle = impact ? Math.PI / 2 : -Math.PI / 2;
    const distance = impact ? 22 + travel * 34 : 34 - travel * 52;
    const x = finiteNumber(effect.x) + Math.cos(angle) * distance;
    const y = finiteNumber(effect.y) + Math.sin(angle) * distance;
    this.drawReinforcementProjectile(ctx, {
      x,
      y,
      targetX: x + Math.cos(angle) * 20,
      targetY: y + Math.sin(angle) * 20,
      age: finiteNumber(effect.age) + travel * 0.18,
      alpha: (1 - travel) * (impact ? 0.92 : 0.78),
    }, angle, style);
    return true;
  }

  drawHeroSkillStep(ctx, effect, progress) {
    const actorCount = Array.isArray(effect.actorUids) ? effect.actorUids.length : 0;
    const projectileCount = Array.isArray(effect.projectileUids) ? effect.projectileUids.length : 0;
    if (actorCount || projectileCount) return;
    const kind = String(effect.stepKind || '');
    if (kind.includes('field')) {
      if (!this.spendSkillRenderBudget('impacts')) return;
      this.drawSkillField(ctx, effect);
      return;
    }
    if (kind.includes('wave')) {
      if (!this.spendSkillRenderBudget('impacts')) return;
      this.drawSkillWave(ctx, {
        ...effect,
        type: 'wave',
        directionX: finiteNumber(effect.directionX, 0),
        directionY: finiteNumber(effect.directionY, -1),
        previousX: finiteNumber(effect.x, effect.originX),
        previousY: finiteNumber(effect.y, effect.originY) + 26,
        width: Math.min(150, Math.max(54, finiteNumber(effect.radius, 90))),
      });
      return;
    }
    if (kind.includes('quake') || kind.includes('burst') || kind.includes('root')) {
      if (!this.spendSkillRenderBudget('impacts')) return;
      this.drawSkillShock(ctx, effect, progress);
      return;
    }
    this.drawSkillImpact(ctx, {
      ...effect,
      radius: Math.min(96, Math.max(38, finiteNumber(effect.radius, 68) * 0.42)),
    }, progress);
  }

  drawEffects(ctx, layer = 'front') {
    for (const effect of this.state.effects) {
      if (heroSkillEffectLayer(effect) !== layer) continue;
      const progress = clamp(effect.phase ?? effect.age / effect.duration, 0, 1);
      if (effect.type === 'hero-skill-step') {
        this.drawHeroSkillStep(ctx, effect, progress);
        continue;
      }
      if (effect.type === 'hero-skill-impact' || effect.type === 'skill-impact') {
        this.drawSkillImpact(ctx, effect, progress);
        continue;
      }
      if (this.drawEnemyReinforcementEffect(ctx, effect, progress)) continue;
      if (effect.type === 'merge') {
        for (let index = 0; index < 4; index += 1) {
          const orbit = fusionOrbitPoint(effect, index * TAU / 4);
          drawParticle(ctx, orbit.x, orbit.y, 18, index % 2 ? 'spark' : 'goo', {
            progress,
            alpha: 1 - progress * 0.72,
            assetStore: this.assetStore,
          });
        }
        drawParticle(ctx, effect.x, effect.y - 22, 48, 'ring', {
          progress,
          alpha: 1 - progress,
          assetStore: this.assetStore,
        });
        continue;
      }
      const type = {
        summon: 'goo', place: 'ring', spawn: 'ring', defeat: 'dust',
        reclaim: 'bubble', 'move-out': 'ring',
        hit: 'spark', 'bubble-hit': 'bubble', 'leaf-hit': 'leaf', 'core-hit': 'spark',
      }[effect.type] || 'spark';
      const effectStar = clamp(Math.floor(effect.star || 1), 1, TD_MAX_STAR);
      const baseSize = effect.type === 'defeat' ? 44 : effect.type === 'spawn' ? 36 : 27;
      const size = baseSize * (1 + (effectStar - 1) * 0.11);
      drawParticle(ctx, effect.x, effect.y, size, type, {
        progress,
        alpha: (effect.secondary ? 0.72 : 1) * (1 - progress * 0.78),
        rotation: progress * 1.6,
        assetStore: this.assetStore,
      });
      if (effectStar >= 3 && ['hit', 'bubble-hit', 'leaf-hit'].includes(effect.type)) {
        const satellites = effectStar - 2;
        for (let index = 0; index < satellites; index += 1) {
          const angle = progress * 3.2 + index * TAU / satellites;
          drawParticle(ctx,
            effect.x + Math.cos(angle) * (12 + progress * 18),
            effect.y + Math.sin(angle) * (8 + progress * 12),
            11 + effectStar * 2,
            type, {
              progress,
              alpha: (1 - progress) * 0.58,
              assetStore: this.assetStore,
            });
        }
      }
    }
  }

  drawBattleHud(ctx, stage) {
    drawDockShell(ctx, stage, this.state.time);
    drawAssetOrFallback(ctx, this.assetStore, 'ui-soft-crystal', (asset) => {
      ctx.globalAlpha *= 0.34;
      ctx.drawImage(asset, COMMAND_DOCK.mode.x + 3, COMMAND_DOCK.mode.y + 1, 18, 18);
    }, () => {});

    button(ctx, COMMAND_DOCK.back, '‹', {
      fill: '#F5F3DF', color: COLORS.ink, accent: '#8EB2A1', size: 31,
    });
    this.addHit('battle-menu', COMMAND_DOCK.back, 'battle-menu');

    panel(ctx, COMMAND_DOCK.currency, {
      fill: '#EAF7DB', stroke: '#80B668', radius: 17,
    });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-gel-energy', (asset) => {
      ctx.drawImage(asset, COMMAND_DOCK.currency.x + 6, COMMAND_DOCK.currency.y + 5, 38, 38);
    }, () => {
      ctx.fillStyle = COLORS.mint;
      ctx.beginPath();
      ctx.arc(COMMAND_DOCK.currency.x + 25, COMMAND_DOCK.currency.y + 24, 13, 0, TAU);
      ctx.fill();
    });
    label(ctx, this.state.currency,
      COMMAND_DOCK.currency.x + COMMAND_DOCK.currency.width - 14,
      COMMAND_DOCK.currency.y + COMMAND_DOCK.currency.height / 2 + 1, {
        size: 19, align: 'right', color: COLORS.ink, weight: 920,
      });

    const hpRatio = clamp(this.state.coreHp / Math.max(1, this.state.coreMaxHp), 0, 1);
    panel(ctx, COMMAND_DOCK.core, {
      fill: '#182F37', stroke: 'rgba(255,255,255,0.24)', radius: 15,
    });
    if (hpRatio > 0) {
      roundedPath(ctx, COMMAND_DOCK.core.x + 4, COMMAND_DOCK.core.y + 4,
        Math.max(2, (COMMAND_DOCK.core.width - 8) * hpRatio),
        COMMAND_DOCK.core.height - 8, 11);
      ctx.fillStyle = hpRatio < 0.3 ? COLORS.coral : COLORS.mint;
      ctx.fill();
    }
    label(ctx, `♥ ${this.state.coreHp}`, COMMAND_DOCK.core.x + COMMAND_DOCK.core.width / 2,
      COMMAND_DOCK.core.y + COMMAND_DOCK.core.height / 2 + 1, {
        size: 17, color: COLORS.white, weight: 900,
      });

    const enemyCount = this.state.enemies.length + this.state.spawnQueue.length;
    const stageWaveCount = Math.max(1, stage.waves.length);
    const currentWave = Math.max(0, Number(this.state.wave) || 0);
    const activeWave = stage.waves[Math.max(0, currentWave - 1)];
    const trackedTotal = Number(this.state.waveEnemyTotal);
    const activeTotal = Number.isFinite(trackedTotal) && trackedTotal > 0
      ? trackedTotal
      : waveUnitCount(activeWave);
    const trackedResolved = Number(this.state.waveEnemyResolved);
    const activeProgress = this.state.waveActive && activeTotal > 0
      ? clamp(Number.isFinite(trackedResolved)
        ? trackedResolved / activeTotal
        : (activeTotal - enemyCount) / activeTotal, 0, 1)
      : currentWave > 0 ? 1 : 0;
    const waveProgress = this.state.mode === 'endless'
      ? activeProgress
      : clamp(((this.state.waveActive ? Math.max(0, currentWave - 1) : currentWave)
        + (this.state.waveActive ? activeProgress : 0)) / stageWaveCount, 0, 1);

    panel(ctx, COMMAND_DOCK.wave, {
      fill: '#17353C', stroke: 'rgba(225,255,236,0.24)', radius: 17,
    });
    const progressTrack = {
      x: COMMAND_DOCK.wave.x + 68,
      y: COMMAND_DOCK.wave.y + 9,
      width: COMMAND_DOCK.wave.width - 82,
      height: COMMAND_DOCK.wave.height - 18,
    };
    roundedPath(ctx, progressTrack.x, progressTrack.y,
      progressTrack.width, progressTrack.height, 9);
    ctx.fillStyle = 'rgba(230,248,226,0.15)';
    ctx.fill();
    if (waveProgress > 0) {
      roundedPath(ctx, progressTrack.x, progressTrack.y,
        Math.max(4, progressTrack.width * waveProgress), progressTrack.height, 9);
      ctx.fillStyle = stage.accent;
      ctx.fill();
    }
    const waveText = this.state.mode === 'endless'
      ? `∞${Math.max(1, currentWave)}`
      : `${currentWave}/${stage.waves.length}`;
    label(ctx, waveText, COMMAND_DOCK.wave.x + 34,
      COMMAND_DOCK.wave.y + COMMAND_DOCK.wave.height / 2 + 1, {
        size: 16, color: COLORS.white, weight: 900,
      });
    if (this.state.mode !== 'endless') {
      for (let index = 1; index < stageWaveCount; index += 1) {
        const x = progressTrack.x + progressTrack.width * index / stageWaveCount;
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = '#F6FFE8';
        ctx.beginPath();
        ctx.arc(x, progressTrack.y + progressTrack.height / 2, 2.5, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }

    panel(ctx, COMMAND_DOCK.enemies, {
      fill: '#E8E7D8', stroke: 'rgba(255,255,255,0.32)', radius: 17,
    });
    label(ctx, `◆ ${enemyCount}`,
      COMMAND_DOCK.enemies.x + COMMAND_DOCK.enemies.width / 2,
      COMMAND_DOCK.enemies.y + COMMAND_DOCK.enemies.height / 2 + 1, {
        size: 17, color: enemyCount ? COLORS.coral : COLORS.inkSoft, weight: 900,
      });

    panel(ctx, COMMAND_DOCK.mode, {
      fill: 'rgba(235,244,225,0.9)', stroke: stage.accent, radius: 17,
    });
    label(ctx, this.state.mode === 'endless' ? '无尽' : stage.name,
      COMMAND_DOCK.mode.x + COMMAND_DOCK.mode.width - 12,
      COMMAND_DOCK.mode.y + COMMAND_DOCK.mode.height / 2 + 1, {
        size: 12, align: 'right', color: COLORS.ink, weight: 900,
      });

    this.drawPreparationDock(ctx, stage);
  }

  drawPreparationDock(ctx, stage) {
    this.drawDirectPurchaseDock(ctx, stage);
    return;
  }

  drawSquadPurchasePreview(ctx, rect, type) {
    const squadType = squadTypeFor(type);
    const visual = soldierVisualFor(type, squadType);
    const compact = rect.width < 100 || rect.height < 140;
    const positions = compact ? [
      { x: -21, y: -15, scale: 0.76 },
      { x: 21, y: -15, scale: 0.76 },
      { x: -22, y: 9, scale: 0.86 },
      { x: 22, y: 9, scale: 0.86 },
    ] : [
      { x: -30, y: -20, scale: 0.84 },
      { x: 30, y: -20, scale: 0.84 },
      { x: -31, y: 11, scale: 0.96 },
      { x: 31, y: 11, scale: 0.96 },
    ];
    positions.forEach((position, memberIndex) => {
      const key = `purchase:${squadType}:${memberIndex}`;
      const animation = this.characterAnimationSample(key, visual.ownerId);
      drawSoldier(ctx, rect.x + rect.width / 2 + position.x,
        rect.y + (compact ? rect.height - 24 : 108) + position.y,
        (compact ? 30 : SQUAD_PURCHASE_PREVIEW_SIZE) * position.scale, {
          assetKey: visual.assetKey,
          squadType,
          time: this.state.time + memberIndex * 0.13,
          facing: memberIndex % 2 ? -1 : 1,
          assetStore: this.assetStore,
          ...animation,
        });
    });
  }

  drawDirectPurchaseDock(ctx, stage) {
    const preparation = this.isPreparation();
    if (!preparation) {
      Object.values(PURCHASE_CATEGORIES).forEach(({ id: purchaseCategory }) => {
        this.addHit(`purchase-category-${purchaseCategory}`,
          COMMAND_DOCK.purchaseTabs[purchaseCategory],
          'select-purchase-category', { purchaseCategory }, false);
      });
      PURCHASE_ITEMS.forEach(({ id: purchaseType }) => {
        this.addHit(`purchase-${purchaseType}`, COMMAND_DOCK.purchaseTrack,
          'select-purchase', { purchaseType }, false);
      });
      this.addHit('start-wave', COMMAND_DOCK.start, 'start-wave', {}, false);
      return;
    }

    const tutorialTarget = tutorialTargetForState(this.state);
    if (tutorialTarget?.type === 'squad') {
      this.purchaseCategory = 'squad';
      this.setPurchaseTrackOffset('squad', 0);
    }
    if (!PURCHASE_CATEGORIES[this.purchaseCategory]) this.purchaseCategory = 'squad';
    const category = this.purchaseCategory;
    const entries = this.purchaseItemsForCategory(category);
    const maxOffset = this.purchaseTrackMaxOffset(category);
    const offset = this.setPurchaseTrackOffset(category, this.purchaseTrackOffset(category));

    Object.values(PURCHASE_CATEGORIES).forEach(({ id, label: categoryLabel }) => {
      const rect = COMMAND_DOCK.purchaseTabs[id];
      const active = category === id;
      const count = this.purchaseItemsForCategory(id).length;
      panel(ctx, rect, {
        fill: active ? '#FFF3BD' : 'rgba(239,246,229,0.88)',
        stroke: active ? '#E0A129' : 'rgba(255,255,255,0.34)',
        lineWidth: active ? 4 : 2,
        radius: 15,
        shadow: active,
      });
      label(ctx, `${categoryLabel} ${count}`, rect.x + rect.width / 2,
        rect.y + rect.height / 2 + 1, {
          size: 16, color: active ? '#714C20' : COLORS.inkSoft, weight: 950,
        });
      this.addHit(`purchase-category-${id}`, rect, 'select-purchase-category', {
        purchaseCategory: id,
      });
    });

    panel(ctx, COMMAND_DOCK.purchaseTrack, {
      fill: 'rgba(229,239,220,0.88)',
      stroke: 'rgba(255,255,255,0.3)',
      radius: 18,
    });
    this.addHit('purchase-track', COMMAND_DOCK.purchaseTrack, 'purchase-track', {
      purchaseCategory: category,
    });

    ctx.save();
    roundedPath(ctx,
      COMMAND_DOCK.purchaseTrack.x,
      COMMAND_DOCK.purchaseTrack.y,
      COMMAND_DOCK.purchaseTrack.width,
      COMMAND_DOCK.purchaseTrack.height,
      18);
    ctx.clip();
    entries.forEach((entry) => {
      const rect = this.purchaseCardRect(entry, category);
      const hitRect = intersectRects(rect, COMMAND_DOCK.purchaseTrack);
      if (!hitRect) return;
      const definition = entry.kind === 'squad'
        ? SQUAD_TYPES[entry.type] : TURRET_TYPES[entry.type];
      const soldierVisual = entry.kind === 'squad'
        ? soldierVisualFor(entry.type, entry.type) : null;
      const turretVisual = entry.kind === 'turret' ? turretVisualFor(entry.type) : null;
      const cost = Math.max(0, Math.floor(Number(definition?.cost) || 0));
      const shortName = soldierVisual?.shortName || entry.shortName || definition?.name || entry.id;
      const selected = this.selectedPurchase === entry.id;
      const enabled = preparation && this.state.currency >= cost;
      const hot = enabled && Boolean(this.hoverPoint && insideRect(this.hoverPoint, hitRect));
      const accent = soldierVisual?.color || definition?.color || '#6BC9A0';
      drawAssetOrFallback(ctx, this.assetStore, 'ui-card-frame-deploy', (asset) => {
        ctx.globalAlpha *= enabled ? 1 : 0.48;
        ctx.drawImage(asset, rect.x, rect.y, rect.width, rect.height);
      }, () => {
        panel(ctx, rect, {
          fill: enabled ? selected ? '#FFF2B8' : hot ? '#FFFEF1' : '#FFF8E8' : '#AEBBB5',
          stroke: selected ? '#E0A129' : enabled ? accent : '#74837D',
          lineWidth: selected || hot ? 5 : 2,
          radius: 13,
          shadow: enabled,
        });
      });
      label(ctx, shortName, rect.x + rect.width / 2, rect.y + 16, {
        size: 12, color: COLORS.ink, weight: 950,
      });
      drawAssetOrFallback(ctx, this.assetStore, 'ui-gel-energy', (asset) => {
        ctx.globalAlpha *= enabled ? 0.95 : 0.4;
        ctx.drawImage(asset, rect.x + 10, rect.y + 26, 16, 16);
      }, () => {});
      label(ctx, cost, rect.x + rect.width - 10, rect.y + 35, {
        size: 12, align: 'right', color: enabled ? COLORS.ink : COLORS.disabled, weight: 950,
      });
      if (entry.kind === 'squad') {
        ctx.save();
        ctx.globalAlpha *= enabled ? 1 : 0.42;
        this.drawSquadPurchasePreview(ctx, rect, entry.type);
        ctx.restore();
      } else if (turretVisual?.layered) {
        drawLayeredTurret(ctx,
          rect.x + rect.width / 2,
          rect.y + rect.height - 8,
          68,
          {
            assetKey: turretVisual.assetKey,
            assetStore: this.assetStore,
            aimAngle: -Math.PI / 2,
            disabled: !enabled,
          });
      } else if (turretVisual) {
        drawBuilding(ctx, rect.x + rect.width / 2, rect.y + rect.height - 14, 56, 'tower', {
          assetKey: turretVisual.assetKey,
          assetStore: this.assetStore,
          ...turretVisual.layout,
          disabled: !enabled,
        });
      }
      if (selected || hot) {
        ctx.save();
        ctx.strokeStyle = selected ? '#E0A129' : accent;
        ctx.lineWidth = selected ? 5 : 4;
        roundedPath(ctx, rect.x + 2, rect.y + 2, rect.width - 4, rect.height - 4, 12);
        ctx.stroke();
        ctx.restore();
      }
      this.addHit(`purchase-${entry.id}`, hitRect, 'select-purchase', {
        purchaseType: entry.id, purchaseCategory: category,
      }, enabled);
    });
    ctx.restore();

    if (maxOffset > 0) {
      if (offset > 0) label(ctx, '‹', COMMAND_DOCK.purchaseTrack.x + 10,
        COMMAND_DOCK.purchaseTrack.y + COMMAND_DOCK.purchaseTrack.height / 2, {
          size: 28, align: 'left', color: '#714C20', weight: 950,
        });
      if (offset < maxOffset) label(ctx, '›',
        COMMAND_DOCK.purchaseTrack.x + COMMAND_DOCK.purchaseTrack.width - 10,
        COMMAND_DOCK.purchaseTrack.y + COMMAND_DOCK.purchaseTrack.height / 2, {
          size: 28, align: 'right', color: '#714C20', weight: 950,
        });
    }

    const legacyCanStart = preparation
      && !(this.state.mode === 'stage' && this.state.wave >= stage.waves.length);
    button(ctx, COMMAND_DOCK.start, preparation ? '开战' : `第${this.state.wave}波`, {
      enabled: legacyCanStart, fill: '#F0B84E', accent: '#B87728', size: 27,
    });
    if (preparation) {
      label(ctx, `${this.state.wave + 1}`, COMMAND_DOCK.start.x + COMMAND_DOCK.start.width / 2,
        COMMAND_DOCK.start.y + COMMAND_DOCK.start.height - 20, {
          size: 13, color: '#714C20', weight: 900,
        });
    }
    this.addHit('start-wave', COMMAND_DOCK.start, 'start-wave', {}, legacyCanStart);

  }

  drawSelectionPanel(ctx) {
    const selectedTower = this.state.towers.find((tower) => tower.uid === this.state.selectedTowerUid);
    const selectedCard = this.state.hand.find((card) => card.uid === this.selectedCardUid);
    panel(ctx, COMMAND_DOCK.selection, {
      fill: 'rgba(248, 246, 222, 0.94)',
      stroke: selectedTower || selectedCard ? '#8ED7A7' : 'rgba(255,255,255,0.24)',
      lineWidth: selectedTower || selectedCard ? 3 : 2,
      radius: 24,
    });

    if (selectedTower) {
      if (isSquadTower(selectedTower)) {
        const squadType = squadTypeFor(selectedTower.type, selectedTower.squadType);
        const visual = soldierVisualFor(selectedTower.type, squadType);
        const squadDefinition = SQUAD_TYPES[squadType];
        const animation = this.characterAnimationSample(
          `tower:${selectedTower.uid}`,
          visual.ownerId,
          selectedTower.moving ? 'move' : 'idle',
        );
        drawSoldier(ctx, COMMAND_DOCK.selection.x + 38,
          COMMAND_DOCK.selection.y + 113, 58, {
            assetKey: visual.assetKey,
            squadType,
            time: this.state.time,
            facing: selectedTower.facing === -1 ? -1 : 1,
            moving: Boolean(selectedTower.moving),
            hit: clamp(Number(selectedTower.hitPulse) || 0, 0, 1),
            attackPulse: clamp(Number(selectedTower.attackPulse) || 0, 0, 1),
            assetStore: this.assetStore,
            ...animation,
          });
        label(ctx, visual.name, COMMAND_DOCK.selection.x + 69,
          COMMAND_DOCK.selection.y + 24, {
            size: 18, align: 'left', color: COLORS.ink, weight: 900,
          });
        const alive = clamp(Math.floor(Number(selectedTower.aliveMembers) || 0), 0, 4);
        label(ctx, `${alive}/4  ·  长按移动`, COMMAND_DOCK.selection.x + 69,
          COMMAND_DOCK.selection.y + 49, {
            size: 13, align: 'left', color: visual.color, weight: 900,
          });
        label(ctx, `${squadDefinition.glyph}  ·  范围 ${squadDefinition.range}`,
          COMMAND_DOCK.selection.x + COMMAND_DOCK.selection.width - 18,
          COMMAND_DOCK.selection.y + 91, {
            size: 14, align: 'right', color: COLORS.inkSoft, weight: 800,
          });
        return;
      }
      const visualType = slimeVisualType(selectedTower.type, selectedTower.squadType);
      const definition = TOWER_TYPES[visualType];
      const animation = this.characterAnimationSample(
        `tower:${selectedTower.uid}`,
        definition.ownerId,
      );
      this.drawFriendlyCharacter(
        ctx, COMMAND_DOCK.selection.x + 38, COMMAND_DOCK.selection.y + 113,
        45, visualType, {
          time: this.state.time,
          star: selectedTower.star,
          facing: 1,
          ...animation,
          ...this.characterRigOptions(definition.ownerId),
          allowGeneratedStandalone: this.generatedCharacterArtEnabled,
        });
      label(ctx, definition.name, COMMAND_DOCK.selection.x + 69,
        COMMAND_DOCK.selection.y + 24, {
          size: 18, align: 'left', color: COLORS.ink, weight: 900,
        });
      label(ctx, '★'.repeat(selectedTower.star), COMMAND_DOCK.selection.x + 69,
        COMMAND_DOCK.selection.y + 49, {
          size: 13, align: 'left', color: definition.color, weight: 900,
        });
      const evolution = towerAttackEvolution(visualType, selectedTower.star);
      const attackName = ATTACK_MODE_LABEL[evolution.attackMode] || definition.glyph;
      label(ctx, `${attackName}  ·  ↔`, COMMAND_DOCK.selection.x + COMMAND_DOCK.selection.width - 18,
        COMMAND_DOCK.selection.y + 91, {
          size: 14, align: 'right', color: COLORS.inkSoft, weight: 800,
        });
      return;
    }

    if (selectedCard) {
      const definition = TOWER_TYPES[selectedCard.type];
      const matches = this.state.towers.filter((tower) => canMergeCardIntoTower(selectedCard, tower));
      label(ctx, definition.glyph, COMMAND_DOCK.selection.x + 34,
        COMMAND_DOCK.selection.y + COMMAND_DOCK.selection.height / 2, {
          size: 28, color: definition.color, weight: 950,
        });
      label(ctx, definition.name, COMMAND_DOCK.selection.x + 64,
        COMMAND_DOCK.selection.y + 31, {
          size: 18, align: 'left', color: COLORS.ink, weight: 900,
        });
      label(ctx, matches.length ? `融  ${matches.length}` : '放', COMMAND_DOCK.selection.x + 64,
        COMMAND_DOCK.selection.y + 66, {
          size: 16, align: 'left', color: matches.length ? COLORS.gold : COLORS.inkSoft, weight: 900,
        });
      label(ctx, '★'.repeat(selectedCard.star), COMMAND_DOCK.selection.x + COMMAND_DOCK.selection.width - 20,
        COMMAND_DOCK.selection.y + 45, {
          size: 17, align: 'right', color: definition.color, weight: 900,
        });
      return;
    }

    Object.values(TOWER_TYPES).forEach((tower, index) => {
      const x = COMMAND_DOCK.selection.x + 26 + index * 42;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = tower.color;
      ctx.beginPath();
      ctx.arc(x, COMMAND_DOCK.selection.y + 42, 14, 0, TAU);
      ctx.fill();
      ctx.restore();
      label(ctx, tower.glyph, x, COMMAND_DOCK.selection.y + 42, {
        size: 13, color: COLORS.white, weight: 950,
      });
      const rate = { shell: 28, needle: 28, bubble: 24, sprout: 20 }[tower.id];
      label(ctx, `${rate}%`, x, COMMAND_DOCK.selection.y + 82, {
        size: 11, color: COLORS.inkSoft, weight: 800,
      });
    });
  }

  drawHandCard(ctx, card, rect, { selected = false, mergeReady = false, dragging = false } = {}) {
    const definition = TOWER_TYPES[card.type];
    const compact = rect.width < 110;
    ctx.save();
    if (dragging) ctx.globalAlpha *= 0.42;
    panel(ctx, rect, {
      fill: selected ? '#E9FFF1' : mergeReady ? '#FFF4C9' : '#FFF9E9',
      stroke: selected ? COLORS.mintDeep : mergeReady ? COLORS.gold : '#A8B7A8',
      lineWidth: selected || mergeReady ? 4 : 2,
      radius: 24,
      shadow: selected,
    });
    drawAssetOrFallback(ctx, this.assetStore, 'ui-card-frame-common', (asset) => {
      ctx.globalAlpha *= 0.38;
      ctx.drawImage(asset, rect.x, rect.y, rect.width, rect.height);
    }, () => {});
    const animation = this.characterAnimationSample(
      `card:${card.uid}`,
      definition.ownerId,
    );
    this.drawFriendlyCharacter(
      ctx, rect.x + rect.width / 2, rect.y + rect.height - (compact ? 2 : 6),
      compact ? 59 : 82, card.type, {
        time: this.state.time,
        star: card.star,
        facing: 1,
        ...animation,
        ...this.characterRigOptions(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
    label(ctx, definition.name, rect.x + (compact ? 7 : 13), rect.y + 20, {
      size: compact ? 12 : 17, align: 'left', color: COLORS.ink, weight: 900,
    });
    label(ctx, compact ? `★${card.star}` : '★'.repeat(card.star),
      rect.x + rect.width - (compact ? 6 : 12), rect.y + 20, {
        size: compact ? 11 : 14, align: 'right', color: definition.color, weight: 900,
    });
    if (mergeReady) {
      panel(ctx, { x: rect.x + rect.width - 42, y: rect.y + rect.height - 41, width: 32, height: 32 }, {
        fill: '#F4C94C', stroke: '#A87922', lineWidth: 2, radius: 16,
      });
      label(ctx, '融', rect.x + rect.width - 26, rect.y + rect.height - 24, {
        size: 15, color: COLORS.ink, weight: 950,
      });
    }
    ctx.restore();
  }

  drawDragPreview(ctx) {
    if (!this.drag?.moved || !this.drag.point) return;
    if (this.drag.kind === 'purchase') {
      const purchase = purchaseItemFor(this.drag.purchaseType);
      ctx.save();
      ctx.globalAlpha = 0.82;
      if (purchase?.kind === 'turret') {
        const visual = turretVisualFor(purchase.type);
        if (visual?.layered) {
          drawLayeredTurret(ctx, this.drag.point.x, this.drag.point.y + 38, 94, {
            assetKey: visual.assetKey,
            assetStore: this.assetStore,
            aimAngle: -Math.PI / 2,
            alpha: 0.82,
          });
        } else if (visual) {
          drawBuilding(ctx, this.drag.point.x, this.drag.point.y + 38, 86, 'tower', {
            assetKey: visual.assetKey,
            assetStore: this.assetStore,
            ...visual.layout,
          });
        }
      } else if (purchase?.kind === 'squad') {
        this.drawSquadPurchasePreview(ctx, {
          x: this.drag.point.x - 78,
          y: this.drag.point.y - 94,
          width: 156,
          height: 164,
        }, purchase.type);
      }
      ctx.restore();
      return;
    }
    if (this.drag.kind === 'card') {
      const card = this.state.hand.find((candidate) => candidate.uid === this.drag.uid);
      const definition = card && TOWER_TYPES[card.type];
      if (!card || !definition) return;
      const animation = this.characterAnimationSample(
        `card:${card.uid}`,
        definition.ownerId,
      );
      ctx.save();
      ctx.globalAlpha = 0.8;
      this.drawFriendlyCharacter(ctx, this.drag.point.x, this.drag.point.y + 28, 76, card.type, {
        time: this.state.time,
        star: card.star,
        ...animation,
        ...this.characterRigOptions(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
      ctx.restore();
    }
    if (this.drag.kind === 'tower' && this.drag.longPressReady) {
      const tower = this.state.towers.find((candidate) => candidate.uid === this.drag.uid);
      if (!tower) return;
      const visualType = slimeVisualType(tower.type, tower.squadType);
      const isSquad = isSquadTower(tower);
      const definition = isSquad
        ? soldierVisualFor(tower.type, tower.squadType)
        : TOWER_TYPES[visualType];
      const animation = this.characterAnimationSample(
        `tower:${tower.uid}`,
        definition.ownerId,
      );
      ctx.save();
      ctx.strokeStyle = definition.color;
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.58;
      ctx.setLineDash?.([10, 8]);
      const pad = stageForState(this.state).pads[tower.padIndex];
      ctx.beginPath();
      ctx.moveTo(pad.x, pad.y - 24);
      ctx.lineTo(this.drag.point.x, this.drag.point.y);
      ctx.stroke();
      ctx.setLineDash?.([]);
      if (isSquad) {
        this.drawSquadMembers(ctx, tower, this.drag.point.x, this.drag.point.y + 10, {
          anchorIndependentMembers: true,
        });
      } else {
        this.drawFriendlyCharacter(
          ctx, this.drag.point.x, this.drag.point.y + 30, 76, visualType, {
            time: this.state.time,
            star: tower.star,
            ...animation,
            ...this.characterRigOptions(definition.ownerId),
            allowGeneratedStandalone: this.generatedCharacterArtEnabled,
          });
        this.drawStars(ctx, this.drag.point.x, this.drag.point.y - 42,
          tower.star, definition.color);
      }
      ctx.restore();
    }
  }

  drawLongPressIndicator(ctx) {
    const drag = this.drag;
    if (drag?.kind !== 'tower' || drag.moved || drag.longPressCancelled) return;
    const tower = this.state.towers.find((candidate) => candidate.uid === drag.uid);
    const pad = tower && stageForState(this.state).pads[tower.padIndex];
    if (!tower || !pad) return;
    const progress = drag.longPressReady ? 1 : clamp(drag.longPressProgress || 0, 0, 1);
    const rect = { x: pad.x - 58, y: pad.y - 116, width: 116, height: 34 };
    ctx.save();
    panel(ctx, rect, {
      fill: 'rgba(31, 50, 60, 0.88)',
      stroke: drag.longPressReady ? '#7EF0B8' : 'rgba(255,255,255,0.72)',
      lineWidth: 2,
      radius: 11,
      shadow: true,
    });
    label(ctx, drag.longPressReady ? '可移动' : '长按移动', pad.x, rect.y + 12, {
      size: 12, color: COLORS.white, weight: 900,
    });
    roundedPath(ctx, rect.x + 9, rect.y + 23, rect.width - 18, 4, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.24)';
    ctx.fill();
    if (progress > 0) {
      roundedPath(ctx, rect.x + 9, rect.y + 23,
        Math.max(3, (rect.width - 18) * progress), 4, 2);
      ctx.fillStyle = drag.longPressReady ? '#7EF0B8' : '#FFE28A';
      ctx.fill();
    }
    ctx.restore();
  }

  drawResult(ctx) {
    const stage = stageForState(this.state);
    this.drawBackdrop(ctx, stage.id);
    ctx.save();
    ctx.fillStyle = 'rgba(38, 52, 62, 0.34)';
    ctx.fillRect(0, 0, TD_VIEW.width, TD_VIEW.height);
    ctx.restore();

    const rect = { x: 56, y: 196, width: 608, height: 884 };
    panel(ctx, rect, {
      fill: '#FFF9EA',
      stroke: this.state.result === 'victory' ? COLORS.mintDeep : COLORS.coral,
      lineWidth: 5,
      radius: 34,
      shadow: true,
    });
    const victory = this.state.result === 'victory';
    label(ctx, victory ? '守住了' : '再来一次', TD_VIEW.width / 2, 294, {
      size: 45,
      color: victory ? COLORS.mintDeep : COLORS.coral,
      weight: 950,
    });

    if (victory) {
      const definition = TOWER_TYPES.shell;
      const animation = this.characterAnimationSample(
        'preview:result:shell',
        definition.ownerId,
      );
      this.drawFriendlyCharacter(ctx, TD_VIEW.width / 2, 600, 164, 'shell', {
        time: this.state.time,
        star: TD_MAX_STAR,
        ...animation,
        ...this.characterRigOptions(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
    } else {
      const definition = TD_ENEMIES.boss;
      const animation = this.characterAnimationSample(
        'preview:result:boss',
        definition.ownerId,
      );
      drawMonster(ctx, TD_VIEW.width / 2, 620, 164, 'boss', {
        time: this.state.time,
        facing: -1,
        assetStore: this.assetStore,
        ...animation,
        ...this.characterRigOptions(definition.ownerId),
        allowGeneratedStandalone: this.generatedCharacterArtEnabled,
      });
    }
    label(ctx, `波次 ${this.state.wave}   击破 ${this.state.kills}`, TD_VIEW.width / 2, 730, {
      size: 22, color: COLORS.inkSoft, weight: 750,
    });
    if (this.state.mode === 'endless') {
      label(ctx, `最高 ${this.state.progress.bestEndlessWave}`, TD_VIEW.width / 2, 778, {
        size: 20, color: COLORS.crystal, weight: 800,
      });
    }

    const primaryRect = { x: 106, y: 874, width: 330, height: 92 };
    const menuRect = { x: 456, y: 874, width: 158, height: 92 };
    const nextStage = victory && this.state.mode === 'stage' && TD_STAGES[stage.index];
    button(ctx, primaryRect, nextStage ? '下一关' : '再来', {
      fill: victory ? COLORS.mint : '#E99B72',
      accent: victory ? COLORS.mintDeep : '#A95B45',
      size: 26,
    });
    this.addHit('result-primary', primaryRect, nextStage ? 'next-stage' : 'replay');
    button(ctx, menuRect, '关卡', {
      fill: '#EEF1E8', color: COLORS.ink, accent: '#9EADA5', size: 22,
    });
    this.addHit('result-menu', menuRect, 'result-menu');
  }

  tutorialHoles(target) {
    if (!target) return [];
    if (target.type === 'stage') {
      if (this.menuPage === 'stage-select') {
        const targetPage = Math.floor(target.stageIndex / STAGE_SELECT_PAGE_SIZE);
        const card = targetPage === this.stageSelectPage
          ? STAGE_SELECT_CARDS[target.stageIndex % STAGE_SELECT_PAGE_SIZE]
          : null;
        return card ? [{
          x: card.x + card.width / 2,
          y: card.y + card.height / 2,
          radius: 118,
        }] : [];
      }
      return [{
        x: MENU_ACTIONS.story.x + MENU_ACTIONS.story.width / 2,
        y: MENU_ACTIONS.story.y + MENU_ACTIONS.story.height / 2,
        radius: 88,
      }];
    }
    if (target.type === 'draw') return [{
      x: COMMAND_DOCK.draw.x + COMMAND_DOCK.draw.width / 2,
      y: COMMAND_DOCK.draw.y + COMMAND_DOCK.draw.height / 2,
      radius: 92,
    }];
    if (target.type === 'shop') {
      const rect = COMMAND_DOCK.shop[target.offerIndex || 0];
      return rect ? [{
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        radius: 82,
      }] : [];
    }
    if (target.type === 'squad') {
      if (this.selectedPurchase === target.squadType) {
        const pad = stageForState(this.state).pads[target.padIndex];
        return pad ? [{ x: pad.x, y: pad.y - 8, radius: 72 }] : [];
      }
      const rect = this.hits.find(({ id, enabled }) => (
        id === `purchase-${target.squadType}` && enabled !== false
      ));
      return rect ? [{
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        radius: 72,
      }] : [];
    }
    if (target.type === 'pad') {
      const pad = stageForState(this.state).pads[target.padIndex];
      return pad ? [{ x: pad.x, y: pad.y - 8, radius: 72 }] : [];
    }
    if (target.type === 'fusion') {
      const card = this.state.hand[0];
      const cardIndex = card ? this.state.hand.indexOf(card) : -1;
      const cardRect = cardIndex >= 0 ? COMMAND_DOCK.cards[cardIndex] : null;
      const tower = this.state.towers[0];
      const pad = tower ? stageForState(this.state).pads[tower.padIndex] : null;
      const holes = [];
      if (cardRect) holes.push({
        x: cardRect.x + cardRect.width / 2,
        y: cardRect.y + cardRect.height / 2,
        radius: 74,
      });
      if (pad) holes.push({ x: pad.x, y: pad.y - 18, radius: 62 });
      return holes;
    }
    if (target.type === 'start') return [{
      x: COMMAND_DOCK.start.x + COMMAND_DOCK.start.width / 2,
      y: COMMAND_DOCK.start.y + COMMAND_DOCK.start.height / 2,
      radius: 92,
    }];
    return [];
  }

  drawTutorial(ctx) {
    const target = tutorialTargetForState(this.state);
    if (!target) return;
    const holes = this.tutorialHoles(target);
    ctx.save();
    ctx.fillStyle = 'rgba(22, 34, 42, 0.68)';
    ctx.beginPath();
    ctx.rect(0, 0, TD_VIEW.width, TD_VIEW.height);
    for (const hole of holes) {
      ctx.moveTo(hole.x + hole.radius, hole.y);
      ctx.arc(hole.x, hole.y, hole.radius, 0, TAU, true);
    }
    try {
      ctx.fill('evenodd');
    } catch {
      ctx.fill();
    }
    ctx.restore();

    const pulse = 1 + Math.sin(this.state.time * 5) * 0.045;
    for (const hole of holes) {
      ctx.save();
      ctx.strokeStyle = '#FFE577';
      ctx.lineWidth = 6;
      ctx.globalAlpha = 0.92;
      ctx.beginPath();
      ctx.arc(hole.x, hole.y, hole.radius * pulse, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (target.type === 'fusion' && holes.length >= 2) {
      const left = holes[0];
      const right = holes[1];
      ctx.save();
      ctx.strokeStyle = '#FFE577';
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(left.x, left.y - 70);
      ctx.lineTo(right.x, right.y - 70);
      ctx.stroke();
      const angle = Math.atan2(right.y - left.y, right.x - left.x);
      ctx.translate(right.x, right.y - 70);
      ctx.rotate(angle);
      ctx.fillStyle = '#FFE577';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-20, -12);
      ctx.lineTo(-20, 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (holes.length) {
      let handX = holes[0].x;
      let handY = holes[0].y;
      let handAngle = -0.08;
      if (target.type === 'fusion' && holes.length >= 2) {
        const travel = (Math.sin(this.state.time * 2.8 - Math.PI / 2) + 1) / 2;
        handX = holes[0].x + (holes[1].x - holes[0].x) * travel;
        handY = holes[0].y + (holes[1].y - holes[0].y) * travel - 4;
        handAngle = Math.atan2(holes[1].y - holes[0].y, holes[1].x - holes[0].x) - 0.08;
      } else {
        handY += Math.sin(this.state.time * 5) * 5;
      }
      drawAssetOrFallback(ctx, this.assetStore, 'ui-tutorial-hand', (asset) => {
        ctx.translate(handX, handY);
        ctx.rotate(handAngle);
        ctx.scale(pulse, pulse);
        ctx.drawImage(asset, -25, -22, 96, 96);
      }, () => {
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#FFF1CB';
        ctx.strokeStyle = COLORS.ink;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(handX + 20, handY + 22, 16, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    }

    const focus = holes[0] || { x: TD_VIEW.width / 2, y: TD_VIEW.height / 2, radius: 70 };
    const text = {
      stage: '1', squad: '近', shop: '买', draw: '抽', pad: '放', fusion: '融', start: '战',
    }[target.type] || target.label;
    const bubbleY = focus.y > 520 ? focus.y - focus.radius - 48 : focus.y + focus.radius + 48;
    panel(ctx, { x: focus.x - 34, y: bubbleY - 27, width: 68, height: 54 }, {
      fill: '#FFE577', stroke: '#9B7425', lineWidth: 3, radius: 20, shadow: true,
    });
    label(ctx, text, focus.x, bubbleY + 1, {
      size: 25, color: COLORS.ink, weight: 950,
    });
  }
}

export const SlimeTowerDefenseGame = TowerDefenseGame;
export default TowerDefenseGame;
