import { BalanceConfig } from '../../config/balance.config'

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
// Battle experience — from TZ section 18.1
// ---------------------------------------------------------------
export function calcBattleExp(
  damageDealt: number,
  enemyPower: number,
  enemyMaxHp: number,
  levelDiff: number,
  result: 'PVP_WIN' | 'PVP_LOSS' | 'PVE_WIN' | 'PVE_LOSS' | 'DRAW',
  antiFarmCoeff = 1.0
): number {
  const resultCoeff = B.battleExp.resultCoeff[result] ?? 0
  const levelCoeff = getLevelDiffCoeff(levelDiff)
  return Math.max(
    0,
    Math.floor(
      (damageDealt * enemyPower / Math.max(enemyMaxHp, 1)) *
      levelCoeff * resultCoeff * antiFarmCoeff
    )
  )
}

function getLevelDiffCoeff(diff: number): number {
  for (const [maxDiff, coeff] of B.battleExp.levelDiffCoeff) {
    if (diff <= maxDiff) return coeff
  }
  return 0
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
  const levelCoeff = getLevelDiffCoeff(levelDiff)
  const base = (damageWithWeapon / Math.max(totalEnemyHp, 1)) *
    killFactor * levelCoeff * activityCoeff
  return base * premiumMultiplier
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
export function calcRepairCost(
  itemBasePrice: number,
  lostDurabilityUnits: number,
  quality: string,
  upgradeLevel = 0
): number {
  const qualityCoeff = BalanceConfig.repair.qualityCoeff[quality] ?? 1.0
  const upgradeCoeff = 1 + upgradeLevel * 0.1
  return Math.max(
    1,
    Math.ceil(
      (itemBasePrice / BalanceConfig.repair.baseCostDivider) *
      lostDurabilityUnits *
      qualityCoeff *
      upgradeCoeff
    )
  )
}

// ---------------------------------------------------------------
// Weapon durability loss — from TZ section 19.1
// ---------------------------------------------------------------
export function calcWeaponDurabilityLoss(attackActions: number): number {
  // MVP simplified: 1 per attack action
  return BalanceConfig.durability.weaponLossPerBattle
}

// ---------------------------------------------------------------
// Armor durability loss — from TZ section 19.2
// ---------------------------------------------------------------
export function calcArmorDurabilityLoss(receivedHits: number): number {
  return Math.max(0, Math.floor(receivedHits * BalanceConfig.durability.armorLossPerHit))
}
