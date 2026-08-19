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
  // Oberegs (РѕР±РµСЂРµРі СѓРІРѕСЂРѕС‚Р°) вЂ” СЃРЅРёР¶Р°РµС‚ С€Р°РЅСЃ СѓРІРѕСЂРѕС‚Р° Сѓ С†РµР»Рё
  antiDodgeBonus: number         // From item modifiers (Apeha: РѕР±РµСЂРµРі СѓРІРѕСЂРѕС‚Р°)
  antiCounterBonus: number
  outgoingDamageMultiplier?: number       // РЎРЅРёР¶Р°РµС‚ С€Р°РЅСЃ РѕС‚РІРµС‚РєРё Сѓ С†РµР»Рё
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
  incomingDamageMultiplier?: number
  // Р‘Р°Р·РѕРІС‹Р№ СѓСЂРѕРЅ Р·Р°С‰РёС‚РЅРёРєР° (РґР»СЏ РѕС‚РІРµС‚РєРё)
  minDamage: number; maxDamage: number
}

// ---------------------------------------------------------------
// Counter-attack result (РѕС‚РІРµС‚РЅС‹Р№ СѓРґР°СЂ, Apeha mechanic)
// ---------------------------------------------------------------
export interface CounterAttackResult {
  triggered: boolean
  damage: number
  logParts: string[]
}

export interface AttackResult {
  hit: boolean        // false = СѓРІРѕСЂРѕС‚ (РЅРµ РїСЂРѕРјР°С…!)
  dodge: boolean
  block: boolean
  crit: boolean
  lucky: boolean      // СѓРґР°С‡РЅС‹Р№ СѓРґР°СЂ (РїСЂРѕР±РёРІР°РµС‚ Р±СЂРѕРЅСЋ)
  rawDamage: number
  finalDamage: number
  counterDamage: number  // РѕС‚РІРµС‚РєР° РїСЂРё Р±Р»РѕРєРµ СЃ REA (50% Р°С‚Р°РєРё Р·Р°С‰РёС‚РЅРёРєР°)
  logParts: string[]
}

const B = BalanceConfig

// ---------------------------------------------------------------
// Effective weapon skill (applies anti-mastery вЂ” РўР— СЂР°Р·РґРµР» 10, 18.7)
// effectiveWeaponSkill = max(0, attackerWSK - defenderAntiSkill Г— 0.5)
// ---------------------------------------------------------------
export function calcEffectiveWeaponSkill(
  attackerSkillLevel: number,
  defenderAntiSkillLevel: number
): number {
  const raw = attackerSkillLevel - defenderAntiSkillLevel * B.weaponSkill.antiSkillReductionPerLevel
  return Math.max(0, raw)
}

// ---------------------------------------------------------------
// Initiative (РўР— СЂР°Р·РґРµР» 17.3)
// initiative = REA Г— 1.2 + AGI Г— 0.6 + WSK Г— 0.3 - equipmentWeight Г— 0.25 + rand(-5,5)
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
// Hit chance (РўР— СЂР°Р·РґРµР» 17.4)
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
// Dodge chance (РўР— СЂР°Р·РґРµР» 17.5 + Apeha: РѕР±РµСЂРµРі СѓРІРѕСЂРѕС‚Р°)
// rawDodgeChance = base + agilityRatioГ—0.35 + dodgeBonus - antiDodgeBonus - armorPenalty
// ---------------------------------------------------------------
export function calcDodgeChance(
  defender: Pick<DefenderSnapshot, 'agi' | 'armorWeight' | 'dodgeBonus'>,
  attacker: Pick<AttackerSnapshot, 'acc' | 'agi' | 'antiDodgeBonus'>
): number {
  const C = B.dodgeChance
  const agilityRatio = defender.agi / Math.max(attacker.acc + attacker.agi, 1)
  const armorPenalty = defender.armorWeight * C.armorWeightPenalty
  const raw = C.base + agilityRatio * C.agilityRatioMult + defender.dodgeBonus
    - (attacker.antiDodgeBonus ?? 0)  // Apeha: РѕР±РµСЂРµРі СѓРІРѕСЂРѕС‚Р° Р°С‚Р°РєСѓСЋС‰РµРіРѕ
    - armorPenalty
  return clamp(raw, 0, C.max)
}

// ---------------------------------------------------------------
// Counter-attack chance (РѕС‚РІРµС‚РЅС‹Р№ СѓРґР°СЂ, Apeha mechanic)
// Triggered AFTER defender takes damage вЂ” chance to hit back
// counterChance = base + reactionRatioГ—0.3 - attacker.antiCounterBonus
// ---------------------------------------------------------------
// РћС‚РІРµС‚РєР° РїСЂРё Р±Р»РѕРєРµ: 50% РѕС‚ Р±Р°Р·РѕРІРѕР№ Р°С‚Р°РєРё Р·Р°С‰РёС‚РЅРёРєР° (РѕС‚РІРµС‚ Р·Р°РєР°Р·С‡РёРєР° РІРѕРїСЂРѕСЃ 1)
// РЎСЂР°Р±Р°С‚С‹РІР°РµС‚ РµСЃР»Рё REA Р·Р°С‰РёС‚РЅРёРєР° >= РїРѕСЂРѕРіР°
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
  return { triggered: true, damage, logParts: [`РћС‚РІРµС‚РЅС‹Р№ СѓРґР°СЂ: в€’${damage} HP`] }
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
// Resolve counter-attack (РѕС‚РІРµС‚РєР° Р±РµР· РєСЂРёС‚Р° Рё Р±РµР· СЂРµРєСѓСЂСЃРёРё)
// ---------------------------------------------------------------

// ---------------------------------------------------------------
// Block chance (РўР— СЂР°Р·РґРµР» 17.6)
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
// Crit chance (РўР— СЂР°Р·РґРµР» 17.7)
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
// Weapon skill multiplier (РўР— СЂР°Р·РґРµР» 9.2, РёСЃРїРѕР»СЊР·СѓРµС‚ effectiveSkill)
// ---------------------------------------------------------------
export function calcWeaponSkillMultiplier(effectiveSkillLevel: number): number {
  const C = B.damage
  const base = C.wskBase + Math.min(effectiveSkillLevel, 20) * C.wskPerLevel
  const extra = Math.max(0, effectiveSkillLevel - 20) * C.wskPerLevelOver20
  return clamp(base + extra, C.wskMin, C.wskCap)
}

// ---------------------------------------------------------------
// Weapon type resistance multiplier (РўР— СЂР°Р·РґРµР» 10.2)
// Reduces damage when defender has anti-skill for this weapon type
// weaponResistanceMultiplier = 1 - min(WRES Г— 0.02, 0.4)
// ---------------------------------------------------------------
export function calcWeaponResistanceMult(defenderAntiSkillLevel: number): number {
  const reduction = Math.min(
    defenderAntiSkillLevel * B.weaponSkill.weaponResistPerLevel,
    B.weaponSkill.weaponResistMaxReduction
  )
  return 1 - reduction
}

// ---------------------------------------------------------------
// Raw damage (РўР— СЂР°Р·РґРµР» 9.1)
// ---------------------------------------------------------------
export function calcRawDamage(
  attacker: Pick<AttackerSnapshot, 'str' | 'minDamage' | 'maxDamage' | 'weaponSkillLevel' | 'flatDamageBonus' | 'outgoingDamageMultiplier'>,
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

  return (weaponRoll * wskMult * resistMult + attacker.str * C.strCoeff + attacker.flatDamageBonus) * (attacker.outgoingDamageMultiplier ?? 1)
}

// ---------------------------------------------------------------
// Apply armor (РўР— СЂР°Р·РґРµР» 11.3 вЂ” РіРёР±СЂРёРґРЅР°СЏ РјРѕРґРµР»СЊ)
// ---------------------------------------------------------------
export function applyArmor(rawDamage: number, armor: number, isCrit: boolean): number {
  const C = B.damage
  const effectiveArmor = isCrit ? armor * (1 - B.crit.armorIgnore) : armor
  const flatReduced = Math.max(1, rawDamage - effectiveArmor * C.armorFlatCoeff)
  const percentReduced = flatReduced * (1 - effectiveArmor / (effectiveArmor + C.armorK))
  return Math.max(C.minFinalDamage, percentReduced)
}

// ---------------------------------------------------------------
// Apply endurance (РўР— СЂР°Р·РґРµР» 12.1)
// ---------------------------------------------------------------
export function applyEndurance(damage: number, end: number): number {
  const C = B.damage
  const mult = 1 / (1 + Math.log(end + 1) * C.enduranceK)
  return Math.max(C.minFinalDamage, damage * mult)
}

// ---------------------------------------------------------------
// Full attack resolution (РўР— СЂР°Р·РґРµР» 17.11 + РјР°С‚. РјРѕРґРµР»СЊ СЂР°Р·РґРµР» 14)
// РџРѕСЂСЏРґРѕРє: РїСЂРѕРІРµСЂРєР° в†’ РїРѕРїР°РґР°РЅРёРµ в†’ СѓРІРѕСЂРѕС‚ в†’ Р±Р»РѕРє в†’ РєСЂРёС‚ в†’ СѓСЂРѕРЅ в†’
//          Р±СЂРѕРЅСЏ в†’ Р±Р»РѕРє-СЂРµРґСѓРєС†РёСЏ в†’ РІС‹РЅРѕСЃР»РёРІРѕСЃС‚СЊ в†’ РёС‚РѕРі
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
// Zonal attack resolution (РјРѕРґРµР»СЊ РђРїРµС…Рё: Р·РѕРЅС‹ + Р±Р»РѕРє-РїРѕ-Р·РѕРЅР°Рј)
// РџРѕСЂСЏРґРѕРє: СѓРІРѕСЂРѕС‚ в†’ (Р±Р»РѕРє Р·РѕРЅС‹: 0 СѓСЂРѕРЅР°, РєСЂРѕРјРµ LUCK-РїСЂРѕР±РёС‚РёСЏ) в†’
//          РєСЂРёС‚ в†’ СЃС‹СЂРѕР№ СѓСЂРѕРЅ в†’ Р±СЂРѕРЅСЏ Р—РћРќР« в†’ РІС‹РЅРѕСЃР»РёРІРѕСЃС‚СЊ в†’ РёС‚РѕРі
// РћС‚Р»РёС‡РёСЏ РѕС‚ resolveAttack:
//  - СѓРґР°СЂ РЅР°РїСЂР°РІР»РµРЅ РІ РєРѕРЅРєСЂРµС‚РЅСѓСЋ Р·РѕРЅСѓ (zone)
//  - Р·Р°С‰РёС‚РЅРёРє Р±Р»РѕРєРёСЂСѓРµС‚ РЅР°Р±РѕСЂ Р·РѕРЅ (blockedZones); Р±Р»РѕРє РіР°СЃРёС‚ СѓСЂРѕРЅ РІ 0
//  - РїСЂРѕР±РёС‚СЊ Р±Р»РѕРє РјРѕР¶РЅРѕ РўРћР›Р¬РљРћ В«СѓРґР°С‡РЅС‹Рј СѓРґР°СЂРѕРјВ» (LUCK Р°С‚Р°РєСѓСЋС‰РµРіРѕ)
//  - Р±СЂРѕРЅСЏ СЃС‡РёС‚Р°РµС‚СЃСЏ РїРѕ Р·РѕРЅРµ СѓРґР°СЂР° (zoneArmor), lucky РїСЂРѕР±РёРІР°РµС‚ Р±СЂРѕРЅСЋ
// ---------------------------------------------------------------
export interface ZonalAttackResult extends AttackResult {
  zone: BodyZone
  blockPierced: boolean   // СѓРґР°С‡РЅС‹Р№ СѓРґР°СЂ РїСЂРѕР±РёР» РІС‹СЃС‚Р°РІР»РµРЅРЅС‹Р№ Р±Р»РѕРє
}

const ZONE_LABEL: Record<BodyZone, string> = {
  HEAD: 'РіРѕР»РѕРІР°',
  CHEST: 'РєРѕСЂРїСѓСЃ',
  LEGS: 'РЅРѕРіРё',
  RIGHT_ARM: 'РїСЂР°РІР°СЏ СЂСѓРєР°',
  LEFT_ARM: 'Р»РµРІР°СЏ СЂСѓРєР°',
}

// РЁР°РЅСЃ В«СѓРґР°С‡РЅРѕРіРѕ СѓРґР°СЂР°В» (РїСЂРѕР±РёС‚РёРµ Р±Р»РѕРєР°/Р±СЂРѕРЅРё) вЂ” Р·Р°РІРёСЃРёС‚ РѕС‚ РЈР”РђР§Р Р°С‚Р°РєСѓСЋС‰РµРіРѕ.
export function calcLuckyPierceChance(attackerLuck: number, antiLuck = 0): number {
  return clamp((attackerLuck ?? 0) * 0.02 - antiLuck, 0, 0.25) // РґРѕ 25%
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

  // 1. РЈРІРѕСЂРѕС‚ (Р·Р°РјРµРЅСЏРµС‚ В«РїСЂРѕРјР°С…В»)
  const hitChance = calcHitChance(attacker, defender)
  dodge = rng() >= hitChance
  if (dodge) {
    hit = false
    log.push(`РЈРІРѕСЂРѕС‚ (${zoneName})`)
    return base()
  }

  // 2. В«РЈРґР°С‡РЅС‹Р№ СѓРґР°СЂВ» вЂ” РѕРїСЂРµРґРµР»СЏРµРј Р·Р°СЂР°РЅРµРµ: РѕРЅ РїСЂРѕР±РёРІР°РµС‚ Рё Р±Р»РѕРє, Рё Р±СЂРѕРЅСЋ.
  lucky = rng() < calcLuckyPierceChance(attacker.luck, defender.antiLuck)

  // Incoming force is rolled once and also defines bounded counterattack damage.
  const incomingForce = calcRawDamage(attacker, defender.antiSkillLevel, rng)

  // 3. Р‘Р»РѕРє Р·РѕРЅС‹: РѕРґРёРЅРѕС‡РЅС‹Р№ Р±Р»РѕРє РіР°СЃРёС‚ РѕР±С‹С‡РЅС‹Р№ СѓРґР°СЂ, РЅРѕ СѓРґР°С‡РЅС‹Р№ РµРіРѕ РїСЂРѕР±РёРІР°РµС‚.
  //    Р”РІРѕР№РЅРѕР№ Р±Р»РѕРє РЅР° РѕРґРЅРѕР№ Р·РѕРЅРµ РґРµСЂР¶РёС‚ Рё СѓРґР°С‡РЅС‹Р№ вЂ” Р·Р° СЌС‚Рѕ РїР»Р°С‚СЏС‚ РІС‚РѕСЂС‹Рј
  //    Р±Р»РѕРєРѕРј РёР· Р±СЋРґР¶РµС‚Р° СЃС‚РѕР№РєРё, С‚Рѕ РµСЃС‚СЊ РѕС‚РєСЂС‹С‚РѕР№ РѕСЃС‚Р°С‘С‚СЃСЏ РµС‰С‘ РѕРґРЅР° Р·РѕРЅР°.
  const blockLayers = blockedZones.filter(blocked => blocked === zone).length
  const zoneBlocked = blockLayers > 0
  if (zoneBlocked && (!lucky || blockLayers > 1)) {
    block = true
    const counter = calcCounterAttack(defender, attacker, incomingForce, rng)
    if (counter.triggered) {
      counterDamage = counter.damage
      log.push(`${blockLayers > 1 ? 'Р”РІРѕР№РЅРѕР№ Р±Р»РѕРє' : 'Р‘Р»РѕРє'} (${zoneName}) + РѕС‚РІРµС‚РєР° ${counterDamage}`)
    } else {
      log.push(`${blockLayers > 1 ? 'Р”РІРѕР№РЅРѕР№ Р±Р»РѕРє' : 'Р‘Р»РѕРє'} (${zoneName})`)
    }
    return base()
  }
  if (zoneBlocked && lucky) {
    blockPierced = true
    log.push(`РЈРґР°С‡РЅС‹Р№! РџСЂРѕР±РёР» Р±Р»РѕРє (${zoneName})`)
  }

  // 4. РљСЂРёС‚
  const critChance = calcCritChance(attacker, defender)
  crit = rng() < critChance
  const critMult = crit
    ? clamp(BalanceConfig.crit.multiplierBase + attacker.critDamageBonus, BalanceConfig.crit.multiplierMin, BalanceConfig.crit.multiplierMax)
    : 1

  // 5. РЎС‹СЂРѕР№ СѓСЂРѕРЅ
  rawDamage = incomingForce * critMult
  if (crit) log.push('РљР РРў!')

  // 6. Р‘СЂРѕРЅСЏ Р·РѕРЅС‹ (lucky РїСЂРѕР±РёРІР°РµС‚ Р±СЂРѕРЅСЋ)
  let dmg = applyArmor(rawDamage, zoneArmor, crit)

  // 7. Р’С‹РЅРѕСЃР»РёРІРѕСЃС‚СЊ
  dmg = applyEndurance(dmg, defender.end)

  finalDamage = Math.max(1, Math.round(dmg * (defender.incomingDamageMultiplier ?? 1)))
  log.push(`РЈРґР°СЂ РІ ${zoneName}: ${finalDamage}`)
  return base()
}
