import type { BodyZone } from '@prisma/client'
import { BalanceConfig } from '../../config/balance.config'
import { clamp } from '../../shared/utils/clamp'
import { randomFloat } from '../../shared/utils/random'

// Types for battle formula inputs
export interface AttackerSnapshot {
  str: number; acc: number; agi: number; rea: number; luck: number; agr: number; end: number
  weaponSkillLevel: number       // Raw skill level
  effectiveSkillLevel?: number   // After anti-mastery reduction (calculated if not provided)
  minDamage: number; maxDamage: number
  weaponAccuracy: number
  critBonus: number; critDamageBonus: number
  blockPierce: number
  flatDamageBonus: number
  equipmentWeight: number        // Sum of all equipped items weight (for initiative penalty)
  // Oberegs (оберег уворота) — снижает шанс уворота у цели
  antiDodgeBonus: number         // From item modifiers (Apeha: оберег уворота)
  antiCounterBonus: number       // Снижает шанс ответки у цели
}

export interface DefenderSnapshot {
  agi: number; rea: number; end: number; luck: number
  armor: number
  dodgeBonus: number; antiCrit: number; blockBonus: number
  armorWeight: number
  weaponTypeResistance?: number
  antiSkillLevel: number
  antiCounterDefense: number
  antiLuck: number
  // Базовый урон защитника (для ответки)
  minDamage: number; maxDamage: number
}

// ---------------------------------------------------------------
// Counter-attack result (ответный удар, Apeha mechanic)
// ---------------------------------------------------------------
export interface CounterAttackResult {
  triggered: boolean
  damage: number
  logParts: string[]
}

export interface AttackResult {
  hit: boolean        // false = уворот (не промах!)
  dodge: boolean
  block: boolean
  crit: boolean
  lucky: boolean      // удачный удар (пробивает броню)
  rawDamage: number
  finalDamage: number
  counterDamage: number  // ответка при блоке с REA (50% атаки защитника)
  logParts: string[]
}

const B = BalanceConfig

// ---------------------------------------------------------------
// Effective weapon skill (applies anti-mastery — ТЗ раздел 10, 18.7)
// effectiveWeaponSkill = max(0, attackerWSK - defenderAntiSkill × 0.5)
// ---------------------------------------------------------------
export function calcEffectiveWeaponSkill(
  attackerSkillLevel: number,
  defenderAntiSkillLevel: number
): number {
  const raw = attackerSkillLevel - defenderAntiSkillLevel * B.weaponSkill.antiSkillReductionPerLevel
  return Math.max(0, raw)
}

// ---------------------------------------------------------------
// Initiative (ТЗ раздел 17.3)
// initiative = REA × 1.2 + AGI × 0.6 + WSK × 0.3 - equipmentWeight × 0.25 + rand(-5,5)
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
// Hit chance (ТЗ раздел 17.4)
// ---------------------------------------------------------------
export function calcHitChance(
  attacker: Pick<AttackerSnapshot, 'acc' | 'weaponAccuracy' | 'weaponSkillLevel' | 'luck' | 'antiDodgeBonus'>,
  defender: Pick<DefenderSnapshot, 'agi' | 'dodgeBonus'>
): number {
  const C = B.hitChance
  const accuracyFactor = Math.log(attacker.acc + 1) / Math.log(16)
  const dodgePressure = defender.agi * C.agiDodgePressure + defender.dodgeBonus
  const raw = attacker.weaponAccuracy * accuracyFactor +
    attacker.weaponSkillLevel * C.wskBonus + (attacker.luck ?? 0) * C.luckEvasionPressure + (attacker.antiDodgeBonus ?? 0) - dodgePressure
  return clamp(raw, C.min, C.max)
}

// ---------------------------------------------------------------
// Dodge chance (ТЗ раздел 17.5 + Apeha: оберег уворота)
// rawDodgeChance = base + agilityRatio×0.35 + dodgeBonus - antiDodgeBonus - armorPenalty
// ---------------------------------------------------------------
export function calcDodgeChance(
  defender: Pick<DefenderSnapshot, 'agi' | 'armorWeight' | 'dodgeBonus'>,
  attacker: Pick<AttackerSnapshot, 'acc' | 'agi' | 'antiDodgeBonus'>
): number {
  const C = B.dodgeChance
  const agilityRatio = defender.agi / Math.max(attacker.acc + attacker.agi, 1)
  const armorPenalty = defender.armorWeight * C.armorWeightPenalty
  const raw = C.base + agilityRatio * C.agilityRatioMult + defender.dodgeBonus
    - (attacker.antiDodgeBonus ?? 0)  // Apeha: оберег уворота атакующего
    - armorPenalty
  return clamp(raw, 0, C.max)
}

// ---------------------------------------------------------------
// Counter-attack chance (ответный удар, Apeha mechanic)
// Triggered AFTER defender takes damage — chance to hit back
// counterChance = base + reactionRatio×0.3 - attacker.antiCounterBonus
// ---------------------------------------------------------------
// Ответка при блоке: 50% от базовой атаки защитника (ответ заказчика вопрос 1)
// Срабатывает если REA защитника >= порога
export function calcCounterAttack(
  defender: Pick<DefenderSnapshot, 'rea'>,
  attacker: Pick<AttackerSnapshot, 'rea' | 'luck' | 'antiCounterBonus'>,
  incomingForce: number,
  rng: () => number = Math.random,
): CounterAttackResult {
  const C = B.counter
  if (defender.rea < C.minReaction || rng() >= calcCounterAttackChance(defender, attacker)) return { triggered: false, damage: 0, logParts: [] }
  const ratio = clamp(C.incomingBase + defender.rea * C.reactionDamageBonus, C.incomingBase, C.incomingDamageCap)
  const damage = Math.max(1, Math.round(incomingForce * ratio))
  return { triggered: true, damage, logParts: [`Ответный удар: −${damage} HP`] }
}

export function calcCounterAttackChance(
  defender: Pick<DefenderSnapshot, 'rea'>,
  attacker: Pick<AttackerSnapshot, 'rea' | 'luck' | 'antiCounterBonus'>
): number {
  const reactionRatio = defender.rea / Math.max(attacker.rea + attacker.luck, 1)
  const raw = B.counter.baseChance + reactionRatio * B.counter.reactionRatioMult - (attacker.antiCounterBonus ?? 0)
  return clamp(raw, 0, B.counter.maxChance) // max 40% counter chance
}

// ---------------------------------------------------------------
// Resolve counter-attack (ответка без крита и без рекурсии)
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// Block chance (ТЗ раздел 17.6)
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
// Crit chance (ТЗ раздел 17.7)
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
// Weapon skill multiplier (ТЗ раздел 9.2, использует effectiveSkill)
// ---------------------------------------------------------------
export function calcWeaponSkillMultiplier(effectiveSkillLevel: number): number {
  const C = B.damage
  const base = C.wskBase + Math.min(effectiveSkillLevel, 20) * C.wskPerLevel
  const extra = Math.max(0, effectiveSkillLevel - 20) * C.wskPerLevelOver20
  return clamp(base + extra, C.wskMin, C.wskCap)
}

// ---------------------------------------------------------------
// Weapon type resistance multiplier (ТЗ раздел 10.2)
// Reduces damage when defender has anti-skill for this weapon type
// weaponResistanceMultiplier = 1 - min(WRES × 0.02, 0.4)
// ---------------------------------------------------------------
export function calcWeaponResistanceMult(defenderAntiSkillLevel: number): number {
  const reduction = Math.min(
    defenderAntiSkillLevel * B.weaponSkill.weaponResistPerLevel,
    B.weaponSkill.weaponResistMaxReduction
  )
  return 1 - reduction
}

// ---------------------------------------------------------------
// Raw damage (ТЗ раздел 9.1)
// ---------------------------------------------------------------
export function calcRawDamage(
  attacker: Pick<AttackerSnapshot, 'str' | 'minDamage' | 'maxDamage' | 'weaponSkillLevel' | 'flatDamageBonus'>,
  defenderAntiSkillLevel = 0,
  rng: () => number = Math.random,
): number {
  const C = B.damage
  const weaponRoll = Math.floor(rng() * (attacker.maxDamage - attacker.minDamage + 1)) + attacker.minDamage

  // Apply anti-mastery to effective weapon skill for damage multiplier
  const effectiveSkill = calcEffectiveWeaponSkill(attacker.weaponSkillLevel, defenderAntiSkillLevel)
  const wskMult = calcWeaponSkillMultiplier(effectiveSkill)

  // Apply weapon type resistance
  const resistMult = calcWeaponResistanceMult(defenderAntiSkillLevel)

  return weaponRoll * wskMult * resistMult + attacker.str * C.strCoeff + attacker.flatDamageBonus
}

// ---------------------------------------------------------------
// Apply armor (ТЗ раздел 11.3 — гибридная модель)
// ---------------------------------------------------------------
export function applyArmor(rawDamage: number, armor: number, isCrit: boolean): number {
  const C = B.damage
  const effectiveArmor = isCrit ? armor * (1 - B.crit.armorIgnore) : armor
  const flatReduced = Math.max(1, rawDamage - effectiveArmor * C.armorFlatCoeff)
  const percentReduced = flatReduced * (1 - effectiveArmor / (effectiveArmor + C.armorK))
  return Math.max(C.minFinalDamage, percentReduced)
}

// ---------------------------------------------------------------
// Apply endurance (ТЗ раздел 12.1)
// ---------------------------------------------------------------
export function applyEndurance(damage: number, end: number): number {
  const C = B.damage
  const mult = 1 / (1 + Math.log(end + 1) * C.enduranceK)
  return Math.max(C.minFinalDamage, damage * mult)
}

// ---------------------------------------------------------------
// Full attack resolution (ТЗ раздел 17.11 + мат. модель раздел 14)
// Порядок: проверка → попадание → уворот → блок → крит → урон →
//          броня → блок-редукция → выносливость → итог
// ---------------------------------------------------------------
export function resolveAttack(
  attacker: AttackerSnapshot,
  defender: DefenderSnapshot,
  defenderIsBlocking: boolean,
  rng: () => number = Math.random,
): AttackResult {
  const result = resolveZonalAttack(attacker, defender, {
    zone: 'CHEST', blockedZones: defenderIsBlocking ? ['CHEST'] : [], zoneArmor: defender.armor, rng,
  })
  return {
    hit: result.hit, dodge: result.dodge, block: result.block, crit: result.crit, lucky: result.lucky,
    rawDamage: result.rawDamage, finalDamage: result.finalDamage, counterDamage: result.counterDamage, logParts: result.logParts,
  }
}

// ---------------------------------------------------------------
// Zonal attack resolution (модель Апехи: зоны + блок-по-зонам)
// Порядок: уворот → (блок зоны: 0 урона, кроме LUCK-пробития) →
//          крит → сырой урон → броня ЗОНЫ → выносливость → итог
// Отличия от resolveAttack:
//  - удар направлен в конкретную зону (zone)
//  - защитник блокирует набор зон (blockedZones); блок гасит урон в 0
//  - пробить блок можно ТОЛЬКО «удачным ударом» (LUCK атакующего)
//  - броня считается по зоне удара (zoneArmor), lucky пробивает броню
// ---------------------------------------------------------------
export interface ZonalAttackResult extends AttackResult {
  zone: BodyZone
  blockPierced: boolean   // удачный удар пробил выставленный блок
}

const ZONE_LABEL: Record<BodyZone, string> = {
  HEAD: 'голова',
  CHEST: 'корпус',
  LEGS: 'ноги',
  RIGHT_ARM: 'правая рука',
  LEFT_ARM: 'левая рука',
}

// Шанс «удачного удара» (пробитие блока/брони) — зависит от УДАЧИ атакующего.
export function calcLuckyPierceChance(attackerLuck: number, antiLuck = 0): number {
  return clamp((attackerLuck ?? 0) * 0.02 - antiLuck, 0, 0.25) // до 25%
}

export function resolveZonalAttack(
  attacker: AttackerSnapshot,
  defender: DefenderSnapshot,
  opts: { zone: BodyZone; blockedZones: BodyZone[]; zoneArmor: number; rng?: () => number }
): ZonalAttackResult {
  const { zone, blockedZones, zoneArmor } = opts
  const rng = opts.rng ?? Math.random
  const zoneName = ZONE_LABEL[zone]
  const log: string[] = []
  let hit = true, dodge = false, block = false, crit = false, lucky = false, blockPierced = false
  let rawDamage = 0, finalDamage = 0, counterDamage = 0

  const base = (): ZonalAttackResult => ({
    hit, dodge, block, crit, lucky, blockPierced, zone,
    rawDamage: Math.round(rawDamage), finalDamage, counterDamage, logParts: log,
  })

  // 1. Уворот (заменяет «промах»)
  const hitChance = calcHitChance(attacker, defender)
  dodge = rng() >= hitChance
  if (dodge) {
    hit = false
    log.push(`Уворот (${zoneName})`)
    return base()
  }

  // 2. «Удачный удар» — определяем заранее: он пробивает и блок, и броню.
  lucky = rng() < calcLuckyPierceChance(attacker.luck, defender.antiLuck)

  // Incoming force is rolled once and also defines bounded counterattack damage.
  const incomingForce = calcRawDamage(attacker, defender.antiSkillLevel, rng)

  // 3. Блок зоны: одиночный блок гасит обычный удар, но удачный его пробивает.
  //    Двойной блок на одной зоне держит и удачный — за это платят вторым
  //    блоком из бюджета стойки, то есть открытой остаётся ещё одна зона.
  const blockLayers = blockedZones.filter(blocked => blocked === zone).length
  const zoneBlocked = blockLayers > 0
  if (zoneBlocked && (!lucky || blockLayers > 1)) {
    block = true
    const counter = calcCounterAttack(defender, attacker, incomingForce, rng)
    if (counter.triggered) {
      counterDamage = counter.damage
      log.push(`${blockLayers > 1 ? 'Двойной блок' : 'Блок'} (${zoneName}) + ответка ${counterDamage}`)
    } else {
      log.push(`${blockLayers > 1 ? 'Двойной блок' : 'Блок'} (${zoneName})`)
    }
    return base()
  }
  if (zoneBlocked && lucky) {
    blockPierced = true
    log.push(`Удачный! Пробил блок (${zoneName})`)
  }

  // 4. Крит
  const critChance = calcCritChance(attacker, defender)
  crit = rng() < critChance
  const critMult = crit
    ? clamp(BalanceConfig.crit.multiplierBase + attacker.critDamageBonus, BalanceConfig.crit.multiplierMin, BalanceConfig.crit.multiplierMax)
    : 1

  // 5. Сырой урон
  rawDamage = incomingForce * critMult
  if (crit) log.push('КРИТ!')

  // 6. Броня зоны (lucky пробивает броню)
  let dmg = applyArmor(rawDamage, zoneArmor, crit)

  // 7. Выносливость
  dmg = applyEndurance(dmg, defender.end)

  finalDamage = Math.max(1, Math.round(dmg))
  log.push(`Удар в ${zoneName}: ${finalDamage}`)
  return base()
}
