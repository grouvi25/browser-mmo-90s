import { BalanceConfig } from '../../config/balance.config'
import { applyUpgradeModifiers } from '../upgrades/upgrades.formulas'

const B = BalanceConfig

// ---------------------------------------------------------------
// HP
// ---------------------------------------------------------------
export function calcHpMax(end: number, battleLevel: number, itemHpBonus = 0): number {
  return B.character.baseHp + end * B.character.hpPerEnd + battleLevel * B.character.hpPerBattleLevel + itemHpBonus
}

// ---------------------------------------------------------------
// Carry weight
// ---------------------------------------------------------------
export function calcCarryWeight(str: number, bagBonus = 0): number {
  return B.character.baseCarryWeight + str * B.character.carryWeightPerStr + bagBonus
}

// ---------------------------------------------------------------
// Battle experience — формула «Ревизия 2» (книга заказчика 23.10)
//
//   зачёт = MIN(урон; HP цели + её лечение; HP цели × q)
//   K = MIN(L; Lцели) / MAX(L; Lцели)
//   XP = зачёт × (мощность цели / её HP) × K × m × доля исхода
//   — всё под общим потолком за бой (50 000).
// ---------------------------------------------------------------
export interface BattleExpInput {
  /** Суммарный урон по цели за бой (D). */
  damageDealt: number
  /** Мощность цели (P). */
  targetPower: number
  /** Максимальное HP цели (H). */
  targetMaxHp: number
  /** HP, которые цель восстановила лечением за бой (R). */
  targetHealed?: number
  /** Уровень получателя опыта. */
  playerLevel: number
  /** Уровень цели. */
  targetLevel: number
  result: 'PVP_WIN' | 'PVP_LOSS' | 'PVE_WIN' | 'PVE_LOSS' | 'DRAW'
  /** Анти-фарм множитель (PvE повторы), по умолчанию нейтрален. */
  antiFarmCoeff?: number
}

export function calcBattleExp(input: BattleExpInput): number {
  const { damageDealt, targetPower, targetMaxHp, playerLevel, targetLevel, result } = input
  const healed = input.targetHealed ?? 0
  const antiFarmCoeff = input.antiFarmCoeff ?? 1.0
  const cfg = B.battleExp
  const hp = Math.max(targetMaxHp, 1)
  // Зачёт: урон, но не больше, чем цель пережила (HP + лечение),
  // и не больше трёх её полных шкал — лечение не кормит опыт бесконечно.
  const credit = Math.min(damageDealt, hp + healed, hp * cfg.creditOverhealQ)
  const k = Math.min(playerLevel, targetLevel) / Math.max(playerLevel, targetLevel, 1)
  const raw = credit * (Math.max(targetPower, 0) / hp) * k * cfg.multiplierM
  const capped = Math.min(raw, cfg.capPerBattle)
  const resultCoeff = cfg.resultCoeff[result] ?? 0
  return Math.max(0, Math.floor(capped * resultCoeff * antiFarmCoeff))
}

// ---------------------------------------------------------------
// Мощность персонажа «Ревизия 2»: 0,5×(боевой + экономический +
// производственный) + владение оружием + рейтинг. Рейтинг здесь —
// базовый (статы); вклад вещей подключается вместе с выдачей
// мощности наружу (PR-2), на формулу опыта он ляжет тем же слагаемым.
// ---------------------------------------------------------------
export function calcRatingPower(input: {
  battleLevel: number
  economicLevel: number
  productionLevel: number
  weaponSkillLevel: number
  baseRating: number
}): number {
  return 0.5 * (input.battleLevel + input.economicLevel + input.productionLevel)
    + input.weaponSkillLevel + input.baseRating
}

/** Мощность типовой цели уровня L (книга, лист «Уровни»):
 *  Pтип(L) = 2,5 × L + 97,5 × 1,9^(L−1). Боты засеиваются ею. */
export function typicalTargetPower(level: number): number {
  const l = Math.max(1, level)
  return 2.5 * l + 97.5 * Math.pow(1.9, l - 1)
}

// ---------------------------------------------------------------
// Level from exp
// ---------------------------------------------------------------
export function getLevelFromExp(exp: number): number {
  const thresholds = B.battleExp.levelThresholds
  let level = 1
  for (let i = 1; i < thresholds.length; i++) {
    if (exp >= thresholds[i]) level = i + 1
    else break
  }
  return level
}

export function getExpForLevel(level: number): number {
  return B.battleExp.levelThresholds[level - 1] ?? 0
}

export function getExpForNextLevel(level: number): number {
  return B.battleExp.levelThresholds[level] ?? Infinity
}

// ---------------------------------------------------------------
// Weapon skill experience — from TZ section 18.4
// ---------------------------------------------------------------
export function calcWeaponSkillExp(
  damageWithWeapon: number,
  totalEnemyHp: number,
  kills: number,
  levelDiff: number,
  activityCoeff = 1.0,
  premiumMultiplier = 1.0
): number {
  if (damageWithWeapon <= 0) return 0
  const killFactor = Math.max(1, kills)
  // Навык оружия растёт от урона, а не от формулы опыта «Ревизии 2»:
  // для него оставлена прежняя ступенчатая поправка на разницу уровней.
  const levelCoeff = levelDiffCoeffSteps(levelDiff)
  const base = (damageWithWeapon / Math.max(totalEnemyHp, 1)) *
    killFactor * levelCoeff * activityCoeff
  return base * premiumMultiplier
}

/** Ступенчатая поправка на разницу уровней (только для навыка оружия). */
function levelDiffCoeffSteps(diff: number): number {
  for (const [maxDiff, coeff] of B.battleExp.levelDiffCoeff) {
    if (diff <= maxDiff) return coeff
  }
  return 0
}

export function getWeaponSkillLevelFromExp(exp: number): number {
  const thresholds = BalanceConfig.weaponSkill.expThresholds
  let level = 1
  for (let i = 1; i < thresholds.length; i++) {
    if (exp >= thresholds[i]) level = i + 1
    else break
  }
  return Math.min(level, thresholds.length)
}

// ---------------------------------------------------------------
// Repair cost — from TZ section 19.3
// ---------------------------------------------------------------
/**
 * Стоимость ремонта.
 *
 * `districtDiscount` — бонус REPAIR_COST района Гаражи, доля от 0 до 1.
 * Он параметр, а не поправка на стороне вызова, намеренно: цену ремонта
 * считают в трёх местах, и скидка, которую можно забыть применить в
 * одном из них, показала бы игроку одну сумму, а списала другую.
 */
export function calcRepairCost(
  itemBasePrice: number,
  lostDurabilityUnits: number,
  quality: string,
  upgradeLevel = 0,
  districtDiscount = 0
): number {
  const qualityCoeff = BalanceConfig.repair.qualityCoeff[quality] ?? 1.0
  const upgradeCoeff = 1 + upgradeLevel * 0.1
  const discountCoeff = 1 - Math.max(0, Math.min(1, districtDiscount))
  return Math.max(
    1,
    Math.ceil(
      (itemBasePrice / BalanceConfig.repair.baseCostDivider) *
      lostDurabilityUnits *
      qualityCoeff *
      upgradeCoeff *
      discountCoeff
    )
  )
}

// ---------------------------------------------------------------
// Weapon durability loss — from TZ section 19.1
// ---------------------------------------------------------------
export function calcWeaponDurabilityLoss(_attackActions: number): number {
  // MVP simplified: 1 per attack action
  return BalanceConfig.durability.weaponLossPerBattle
}

// ---------------------------------------------------------------
// Armor durability loss — from TZ section 19.2
// ---------------------------------------------------------------
export function calcArmorDurabilityLoss(receivedHits: number): number {
  return Math.max(0, Math.floor(receivedHits * BalanceConfig.durability.armorLossPerHit))
}

// ---------------------------------------------------------------
// Economic level from exp (GanjaWars reference table)
// ---------------------------------------------------------------
export function getEconomicLevelFromExp(exp: number): number {
  const thresholds = BalanceConfig.economicExp.levelThresholds
  let level = 0
  for (let i = 1; i < thresholds.length; i++) {
    if (exp >= thresholds[i]) level = i
    else break
  }
  return level
}

// ---------------------------------------------------------------
// Power calculation (GanjaWars formula, simplified for Stage 1)
// power = (BL + EL + PL) × 0.5 + weaponBonus + armorBonus
// ---------------------------------------------------------------
export function calcCharacterPower(
  battleLevel: number,
  economicLevel: number,
  productionLevel: number,
  equippedWeaponPrice = 0,
  totalArmorValue = 0
): number {
  const naturalPower = (battleLevel + economicLevel + productionLevel) * 0.5
  const weaponPower = equippedWeaponPrice / 200   // 200₽ weapon ≈ 1 power unit
  const armorPower  = totalArmorValue / 10         // 10 ARM ≈ 1 power unit
  return Math.max(1, Math.round(naturalPower + weaponPower + armorPower))
}

// ---------------------------------------------------------------
// Рейтинг персонажа (книга заказчика 23.10, лист «Рейтинг»):
// базовые характеристики с весами + надетые вещи. Бонусов к самим
// характеристикам у вещей нет, поэтому вклад вещи — её оружие и
// броня, посчитанные с улучшениями, вложенными очками и камнями.
// Авторитет — социальная величина, в рейтинг не входит.
// ---------------------------------------------------------------
export const RATING_WEIGHTS: Readonly<Record<'str' | 'agi' | 'rea' | 'acc' | 'end' | 'luck' | 'agr', number>> = {
  str: 2, end: 2, agi: 1.5, rea: 1.5, acc: 1.5, luck: 1, agr: 1,
}

type RatingStats = { str: number; agi: number; rea: number; acc: number; end: number; luck: number; agr: number }

export interface EquippedForRating {
  template: {
    type: string
    minDamage: number | null
    maxDamage: number | null
    armor: number | null
    durabilityMax: number
    statAllocation?: unknown
    weaponAccuracy?: number | null
    critBonus?: number | null
    antiCrit?: number | null
  }
  upgradeModifiersJson?: unknown
  statAllocation?: unknown
  socketsJson?: unknown
}

export function calcBaseRating(stats: RatingStats): number {
  let sum = 0
  for (const key of Object.keys(RATING_WEIGHTS) as (keyof RatingStats)[]) {
    sum += (stats[key] ?? 0) * RATING_WEIGHTS[key]
  }
  return sum
}

export function calcEquippedItemRating(item: EquippedForRating): number {
  if (item.template.type !== 'WEAPON' && item.template.type !== 'ARMOR' && item.template.type !== 'SHIELD') return 0
  const mods = (item.upgradeModifiersJson ?? {}) as Parameters<typeof applyUpgradeModifiers>[1]
  const eff = applyUpgradeModifiers(item.template, mods, item.statAllocation, item.socketsJson)
  if (item.template.type === 'WEAPON') return 2 * ((eff.minDamage + eff.maxDamage) / 2)
  return 1.5 * eff.armor
}

export function calcCharacterRating(stats: RatingStats, equipped: EquippedForRating[]): number {
  const total = calcBaseRating(stats) + equipped.reduce((sum, item) => sum + calcEquippedItemRating(item), 0)
  return Math.round(total * 10) / 10
}
