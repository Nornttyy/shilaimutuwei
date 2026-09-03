/** Pure difficulty and meta-reward rules shared by browser and WeChat builds. */

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rounded = (value) => Math.round(value * 1000) / 1000;

export const TD_DIFFICULTIES = Object.freeze({
  simple: Object.freeze({
    id: 'simple', name: '简单', hp: 1, speed: 1, attack: 1,
    battleReward: 1, metaReward: 1, equipmentChance: 0.26,
  }),
  hard: Object.freeze({
    id: 'hard', name: '困难', hp: 1.48, speed: 1.1, attack: 1.24,
    battleReward: 1.38, metaReward: 1.75, equipmentChance: 0.62,
  }),
});

export function normalizeTowerDefenseDifficulty(value) {
  return value === 'hard' ? 'hard' : 'simple';
}

export function towerDefenseDifficultyRules(value) {
  return TD_DIFFICULTIES[normalizeTowerDefenseDifficulty(value)];
}

export function applyTowerDefenseDifficulty(scale, difficulty = 'simple') {
  const rules = towerDefenseDifficultyRules(difficulty);
  return Object.freeze({
    hp: rounded((Number(scale?.hp) || 1) * rules.hp),
    speed: rounded((Number(scale?.speed) || 1) * rules.speed),
    attack: rounded((Number(scale?.attack) || 1) * rules.attack),
    reward: rounded((Number(scale?.reward) || 1) * rules.battleReward),
  });
}

export function storyMetaReward(stageIndex, difficulty = 'simple', firstClear = false) {
  const stage = clamp(Math.floor(Number(stageIndex) || 1), 1, 20);
  const rules = towerDefenseDifficultyRules(difficulty);
  const baseCoins = 200 + stage * 60;
  const firstClearCoins = firstClear ? 400 + stage * 100 : 0;
  const baseCrystals = 90 + stage * 12;
  return Object.freeze({
    metaCoins: Math.round((baseCoins + firstClearCoins) * rules.metaReward),
    summonCurrency: Math.round(baseCrystals * (difficulty === 'hard' ? 1.55 : 1)),
    equipmentRolls: firstClear ? 2 : 1,
    guaranteedEquipment: firstClear ? 1 : 0,
    equipmentChance: rules.equipmentChance,
  });
}

export function endlessMetaReward(waveNumber) {
  const wave = Math.max(0, Math.floor(Number(waveNumber) || 0));
  return Object.freeze({
    metaCoins: Math.min(5000, 160 + wave * 90),
    summonCurrency: Math.min(600, 30 + wave * 10),
    equipmentRolls: Math.min(3, Math.floor(wave / 5)),
    guaranteedEquipment: Math.min(3, Math.floor(wave / 5)),
    equipmentChance: wave >= 5 ? 1 : 0,
  });
}

const DAILY_MODIFIERS = Object.freeze([
  Object.freeze({ id: 'hardened', name: '厚胶敌群', hp: 1.22, speed: 1, attack: 1.08 }),
  Object.freeze({ id: 'swift', name: '疾行敌群', hp: 1.08, speed: 1.18, attack: 1.08 }),
  Object.freeze({ id: 'fierce', name: '强袭敌群', hp: 1.12, speed: 1.06, attack: 1.2 }),
]);

function normalizedDayKey(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '1970-01-01';
}

function dayHash(dayKey) {
  let hash = 2166136261;
  for (const character of dayKey) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function dailyChallengeForDay(dayKey, stageCount = 20) {
  const key = normalizedDayKey(dayKey);
  const hash = dayHash(key);
  const count = Math.max(1, Math.floor(Number(stageCount) || 1));
  const modifier = DAILY_MODIFIERS[(hash >>> 8) % DAILY_MODIFIERS.length];
  return Object.freeze({
    dayKey: key,
    stageIndex: hash % count + 1,
    difficulty: 'hard',
    modifier,
  });
}

export function dailyMetaReward(challenge, alreadyClaimed = false) {
  if (alreadyClaimed) {
    return Object.freeze({
      metaCoins: 0, summonCurrency: 0, equipmentRolls: 0,
      guaranteedEquipment: 0, equipmentChance: 0,
    });
  }
  const stage = clamp(Math.floor(Number(challenge?.stageIndex) || 1), 1, 20);
  return Object.freeze({
    metaCoins: 850 + stage * 55,
    summonCurrency: 180 + stage * 4,
    equipmentRolls: 1,
    guaranteedEquipment: 1,
    equipmentChance: 1,
  });
}
