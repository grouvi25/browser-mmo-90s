import { BalanceConfig } from '../../config/balance.config'
import { clamp } from '../../shared/utils/clamp'
import { randomFloat, randomInt, rollChance } from '../../shared/utils/random'

// Types for battle formula inputs
export interface AttackerSnapshot {
  str: number; acc: number; agi: number; rea: number; luck: number; agr: number; end: number
  weaponSkillLevel: number
  minDamage: number; maxDamage: number
  weaponAccuracy: number
  critBonus: number; critDamageBonus: number
  blockPierce: number
  flatDamageBonus: number
  equipmentWeight: number
}

export interface DefenderSnapshot {
  agi: number; rea: number; end: number; luck: number
  armor: number
  dodgeBonus: number; antiCrit: number; blockBonus: number
  armorWeight: number
  weaponSkillType?: string   // for anti-mastery calc
  antiSkillLevel: number
}

export interface AttackResult {
  hit: boolean
  dodge: boolean
  block: boolean
  crit: boolean
  rawDamage: number
  finalDamage: number
  logParts: string[]
}

const B = BalanceConfig

// ---------------------------------------------------------------
// Initiative
// ---------------------------------------------------------------
export function calcInitiative(
  rea: number,
  agi: number,
  weaponSkill: number,
  equipmentWeight: number
): number {
  const C = B.initiative
  const base =
    rea * C.reaMultiplier +
    agi * C.agiMultiplier +
    weaponSkill * C.wskMultiplier -
    equipmentWeight * C.weightPenalty +
    randomFloat(-C.randomRange, C.randomRange)
  return Math.max(C.min, base)
}

// ---------------------------------------------------------------
// Hit chance
// ---------------------------------------------------------------
export function calcHitChance(
  attacker: Pick<AttackerSnapshot, 'acc' | 'weaponAccuracy' | 'weaponSkillLevel'>,
  defender: Pick<DefenderSnapshot, 'agi' | 'dodgeBonus'>
): number {
  const C = B.hitChance
  const accuracyFactor = Math.log(attacker.acc + 1) / Math.log(16)
  const dodgePressure = defender.agi * C.agiDodgePressure + defender.dodgeBonus
  const raw = attacker.weaponAccuracy * accuracyFactor +
    attacker.weaponSkillLevel * C.wskBonus - dodgePressure
  return clamp(raw, C.min, C.max)
}

// ---------------------------------------------------------------
// Dodge chance
// ---------------------------------------------------------------
export function calcDodgeChance(
  defender: Pick<DefenderSnapshot, 'agi' | 'armorWeight' | 'dodgeBonus'>,
  attacker: Pick<AttackerSnapshot, 'acc' | 'agi'>
): number {
  const C = B.dodgeChance
  const agilityRatio = defender.agi / Math.max(attacker.acc + attacker.agi, 1)
  const armorPenalty = defender.armorWeight * C.armorWeightPenalty
  const raw = C.base + agilityRatio * C.agilityRatioMult + defender.dodgeBonus - armorPenalty
  return clamp(raw, 0, C.max)
}

// ---------------------------------------------------------------
// Block chance
// ---------------------------------------------------------------
export function calcBlockChance(
  defender: Pick<DefenderSnapshot, 'rea' | 'blockBonus'>,
  attacker: Pick<AttackerSnapshot, 'rea' | 'luck' | 'blockPierce'>
): number {
  const C = B.blockChance
  const reactionRatio = defender.rea / Math.max(attacker.rea + attacker.luck, 1)
  const raw = C.base + reactionRatio * C.reactionRatioMult +
    defender.blockBonus - attacker.blockPierce - attacker.luck * C.luckPierceMult
  return clamp(raw, 0, C.max)
}

// ---------------------------------------------------------------
// Crit chance
// ---------------------------------------------------------------
export function calcCritChance(
  attacker: Pick<AttackerSnapshot, 'agr' | 'weaponSkillLevel' | 'critBonus'>,
  defender: Pick<DefenderSnapshot, 'antiCrit' | 'end'>
): number {
  const C = B.crit
  const raw = C.base +
    attacker.agr * C.agressMult +
    attacker.weaponSkillLevel * C.wskMult +
    attacker.critBonus -
    defender.antiCrit -
    defender.end * C.endResist
  return clamp(raw, C.min, C.max)
}

// ---------------------------------------------------------------
// Weapon skill multiplier
// ---------------------------------------------------------------
export function calcWeaponSkillMultiplier(skillLevel: number): number {
  const C = B.damage
  const base = C.wskBase + Math.min(skillLevel, 20) * C.wskPerLevel
  const extra = Math.max(0, skillLevel - 20) * C.wskPerLevelOver20
  return clamp(base + extra, C.wskMin, C.wskCap)
}

// ---------------------------------------------------------------
// Raw damage
// ---------------------------------------------------------------
export function calcRawDamage(
  attacker: Pick<AttackerSnapshot, 'str' | 'minDamage' | 'maxDamage' | 'weaponSkillLevel' | 'flatDamageBonus'>
): number {
  const C = B.damage
  const weaponRoll = randomInt(attacker.minDamage, attacker.maxDamage)
  const wskMult = calcWeaponSkillMultiplier(attacker.weaponSkillLevel)
  return weaponRoll * wskMult + attacker.str * C.strCoeff + attacker.flatDamageBonus
}

// ---------------------------------------------------------------
// Apply armor
// ---------------------------------------------------------------
export function applyArmor(rawDamage: number, armor: number, isCrit: boolean): number {
  const C = B.damage
  const effectiveArmor = isCrit ? armor * (1 - B.crit.armorIgnore) : armor
  const flatReduced = Math.max(1, rawDamage - effectiveArmor * C.armorFlatCoeff)
  const percentReduced = flatReduced * (1 - effectiveArmor / (effectiveArmor + C.armorK))
  return Math.max(C.minFinalDamage, percentReduced)
}

// ---------------------------------------------------------------
// Apply endurance
// ---------------------------------------------------------------
export function applyEndurance(damage: number, end: number): number {
  const C = B.damage
  const mult = 1 / (1 + Math.log(end + 1) * C.enduranceK)
  return Math.max(C.minFinalDamage, damage * mult)
}

// ---------------------------------------------------------------
// Full attack resolution (порядок из ТЗ раздел 17.11)
// ---------------------------------------------------------------
export function resolveAttack(
  attacker: AttackerSnapshot,
  defender: DefenderSnapshot,
  defenderIsBlocking: boolean
): AttackResult {
  const log: string[] = []
  let hit = false, dodge = false, block = false, crit = false
  let rawDamage = 0, finalDamage = 0

  // 1. Hit check
  const hitChance = calcHitChance(attacker, defender)
  hit = rollChance(hitChance)
  if (!hit) {
    log.push('Промах')
    return { hit, dodge, block, crit, rawDamage, finalDamage, logParts: log }
  }

  // 2. Dodge check
  const dodgeChance = calcDodgeChance(defender, attacker)
  dodge = rollChance(dodgeChance)
  if (dodge) {
    log.push('Уворот')
    return { hit, dodge, block, crit, rawDamage, finalDamage, logParts: log }
  }

  // 3. Block check (only if defender is blocking)
  if (defenderIsBlocking) {
    const blockChance = calcBlockChance(defender, attacker)
    block = rollChance(blockChance)
  }

  // 4. Crit check
  const critChance = calcCritChance(attacker, defender)
  crit = rollChance(critChance)
  const critMult = crit
    ? clamp(B.crit.multiplierBase + attacker.critDamageBonus, B.crit.multiplierMin, B.crit.multiplierMax)
    : 1

  // 5. Raw damage
  rawDamage = calcRawDamage(attacker) * critMult
  if (crit) log.push('КРИТ!')

  // 6. Armor
  let dmg = applyArmor(rawDamage, defender.armor, crit)

  // 7. Block reduction
  if (block) {
    dmg = dmg * B.blockChance.blockReduction
    log.push('Заблокировано')
  }

  // 8. Endurance
  dmg = applyEndurance(dmg, defender.end)

  finalDamage = Math.max(1, Math.round(dmg))
  log.push(`Урон: ${finalDamage}`)

  return { hit, dodge, block, crit, rawDamage: Math.round(rawDamage), finalDamage, logParts: log }
}
