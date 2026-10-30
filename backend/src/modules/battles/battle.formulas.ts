import type { BodyZone, WeaponType as PrismaWeaponType } from '@prisma/client'
import { calcWeaponSkillExp } from '../stats/stats.formulas'
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
  antiCounterBonus: number
  outgoingDamageMultiplier?: number       // Снижает шанс ответки у цели
}

export interface DefenderSnapshot {
  agi: number; rea: number; end: number; luck: number
  agr?: number                   // агрессия защитника гасит крит (книга: интуиция защитника)
  level?: number                 // боевой уровень защитника: от него зависит вес брони
  armor: number
  dodgeBonus: number; antiCrit: number; blockBonus: number
  armorWeight: number
  antiSkillLevel: number
  antiCounterDefense: number
  antiLuck: number
  incomingDamageMultiplier?: number
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
// Initiative (ТЗ раздел 17.3)
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
// Удар по книге заказчика («Ревизия 2», раздел «Урон одного удара»).
// В книге четыре характеристики, в игре семь. Соответствие:
//   ловкость атакующего (Aа) — меткость: она и отвечает за попадание;
//   интуиция (I) — агрессия: она и раньше отвечала за крит;
//   сила, ловкость защитника и выносливость — как в книге.
// Обереги, точность оружия, хмель и бар остаются поправками к шансам,
// блоки, удачный удар и ответка — механики игры поверх книги.
// ---------------------------------------------------------------

// Перекос характеристик двух сторон: (a − b) / (a + b + 20).
function statEdge(a: number, b: number): number {
  return (a - b) / (Math.max(0, a) + Math.max(0, b) + B.strike.statSoftener)
}

// ---------------------------------------------------------------
// Уворот: CLAMP(0,05 + 0,25 × (Aз − Aа)/(Aз + Aа + 20); 0,01; 0,35).
// Обереги уворота у защитника прибавляют, у атакующего — отнимают;
// точность оружия сверх обычной (0,7) тоже отнимает, хмель — прибавляет.
// ---------------------------------------------------------------
export function calcDodgeChance(
  defender: Pick<DefenderSnapshot, 'agi' | 'dodgeBonus'>,
  attacker: Pick<AttackerSnapshot, 'acc' | 'antiDodgeBonus' | 'weaponAccuracy'>
): number {
  const C = B.strike
  const raw = C.dodgeBase + C.dodgeSpread * statEdge(defender.agi, attacker.acc)
    + (defender.dodgeBonus ?? 0)
    - (attacker.antiDodgeBonus ?? 0)
    - ((attacker.weaponAccuracy ?? C.baseWeaponAccuracy) - C.baseWeaponAccuracy)
  return clamp(raw, C.dodgeMin, C.dodgeMax)
}

// Шанс, что удар дойдёт до защитника, — всё, кроме уворота.
export function calcHitChance(
  attacker: Pick<AttackerSnapshot, 'acc' | 'antiDodgeBonus' | 'weaponAccuracy'>,
  defender: Pick<DefenderSnapshot, 'agi' | 'dodgeBonus'>
): number {
  return 1 - calcDodgeChance(defender, attacker)
}

// ---------------------------------------------------------------
// Counter-attack chance (ответный удар, Apeha mechanic)
// Triggered AFTER defender takes damage вЂ” chance to hit back
// counterChance = base + reactionRatioГ—0.3 - attacker.antiCounterBonus
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
// Крит: CLAMP(0,1 + 0,2 × (Iа − Iз)/(Iа + Iз + 20); 0,02; 0,4),
// интуиция — агрессия. Оберег крита на оружии прибавляет, у защитника —
// отнимает.
// ---------------------------------------------------------------
export function calcCritChance(
  attacker: Pick<AttackerSnapshot, 'agr' | 'critBonus'>,
  defender: Pick<DefenderSnapshot, 'antiCrit' | 'agr'>
): number {
  const C = B.strike
  const raw = C.critBase + C.critSpread * statEdge(attacker.agr, defender.agr ?? 0)
    + (attacker.critBonus ?? 0)
    - (defender.antiCrit ?? 0)
  return clamp(raw, C.critMin, C.critMax)
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
// Raw damage (ТЗ раздел 9.1)
//
// Раньше здесь ещё стоял отдельный «weaponResistanceMult» — та же
// antiSkillLevel, применённая ВТОРОЙ раз как самостоятельный флэт-резист
// сверху уже честного снижения эффективного навыка. Симулятор
// scripts/simulate-antimastery.ts (04.09.2026) поймал задвоение: в сценарии
// из STAGE5_ACCEPTANCE.md (навык 20 без антимастерства против навыка 10 с
// антимастерством 20) эффективный навык обеих сторон после
// calcEffectiveWeaponSkill честно выравнивался в 10/10 — но вторая, лишняя
// скидка на 40% давала специалисту без антимастерства урон в 1.67 раза
// меньше оппонента. Доля побед контр-специалиста доходила до 91% при
// требуемых ≤60% — специализация оказывалась проигрышной стратегией.
// calcEffectiveWeaponSkill уже полностью реализует антимастерство; второй
// слой был чистым дублированием одного и того же входа.
// ---------------------------------------------------------------
export function calcRawDamage(
  attacker: Pick<AttackerSnapshot, 'str' | 'minDamage' | 'maxDamage' | 'weaponSkillLevel' | 'flatDamageBonus' | 'outgoingDamageMultiplier'>,
  defenderAntiSkillLevel = 0,
  rng: () => number = Math.random,
): number {
  const weaponRoll = Math.floor(rng() * (attacker.maxDamage - attacker.minDamage + 1)) + attacker.minDamage

  // Владение оружием (с поправкой на антимастерство) усиливает вклад оружия.
  const effectiveSkill = calcEffectiveWeaponSkill(attacker.weaponSkillLevel, defenderAntiSkillLevel)
  const wskMult = calcWeaponSkillMultiplier(effectiveSkill)

  // Книга: База = 1,5 × сила + сила оружия.
  return (weaponRoll * wskMult + attacker.str * B.strike.strCoeff + attacker.flatDamageBonus) * (attacker.outgoingDamageMultiplier ?? 1)
}

// ---------------------------------------------------------------
// Броня по книге: Броня = броня вещей + 0,5 × выносливость защитника;
// Kброни = 40 × 1,3^(уровень защитника − 1); проходит Kброни / (Kброни + Броня).
// Чем выше уровень защитника, тем больше брони нужно на ту же защиту:
// вещи растут с уровнем, и броня не должна обнулять удары.
// ---------------------------------------------------------------
export function calcArmorShare(armor: number, defenderEnd: number, defenderLevel = 1): number {
  const C = B.strike
  const total = Math.max(0, armor) + C.endArmor * Math.max(0, defenderEnd)
  const k = C.armorK * Math.pow(C.armorKGrowth, Math.max(1, defenderLevel) - 1)
  return k / (k + total)
}

// Разброс удара: 1 ± 10%.
export function calcSpread(rng: () => number = Math.random): number {
  return 1 + B.strike.spread * (2 * rng() - 1)
}

// ---------------------------------------------------------------
// Full attack resolution (ТЗ раздел 17.11 + мат. модель раздел 14)
// Один удар в корпус через resolveZonalAttack.
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
//          крит → сырой урон → броня ЗОНЫ (с выносливостью) → разброс → итог
// Отличия от resolveAttack:
//  - удар направлен в конкретную зону (zone)
//  - защитник блокирует набор зон (blockedZones); блок гасит урон в 0
//  - пробить блок можно ТОЛЬКО «удачным ударом» (LUCK атакующего)
//  - броня считается по зоне удара (zoneArmor)
// ---------------------------------------------------------------
export interface ZonalAttackResult extends AttackResult {
  zone: BodyZone
  blockPierced: boolean   // удачный удар пробил выставленный блок
}

const ZONE_LABEL: Record<BodyZone, string> = {
  HEAD: 'голова',
  CHEST: 'корпус',
  RIGHT_ARM: 'правая рука',
  LEFT_ARM: 'левая рука',
  RIGHT_LEG: 'правая нога',
  LEFT_LEG: 'левая нога',
  // Осталось от прежней модели с одной зоной на обе ноги: журналы
  // сыгранных боёв читаются через эту же таблицу.
  LEGS: 'ноги',
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

  // 2. «Удачный удар» — определяем заранее: он пробивает одиночный блок.
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

  // 6. Броня зоны с половиной выносливости, вес брони — от уровня защитника,
  //    затем разброс ±10%. Книга: INT(База × ДоляПослеБрони × Разброс × крит),
  //    и масштаб под наши вещи и здоровье.
  const dmg = rawDamage * calcArmorShare(zoneArmor, defender.end, defender.level) * calcSpread(rng) * B.strike.damageScale

  finalDamage = Math.max(B.damage.minFinalDamage, Math.floor(dmg * (defender.incomingDamageMultiplier ?? 1)))
  log.push(`Удар в ${zoneName}: ${finalDamage}`)
  return base()
}


/**
 * Опыт оружия по типам, которыми боец бил в этом бою.
 *
 * Жила в battles.service и была доступна только дуэли и бою с ботом.
 * Командный бой — а значит и бой за район — не начислял опыт оружия вовсе:
 * главное содержание Этапа 4 не качало навык. Здесь функция пуста от
 * зависимостей и годится обоим.
 */
export function weaponExpByType(
  part: { weaponDamage?: Partial<Record<PrismaWeaponType, number>>; damageDealt: number },
  fallbackWeaponType: PrismaWeaponType | null | undefined,
  targetHpMax: number,
  won: boolean,
  levelDiff: number,
  premiumMultiplier = 1,
): Array<{ weaponType: PrismaWeaponType; exp: number }> {
  const tracked = Object.entries(part.weaponDamage ?? {}) as Array<[PrismaWeaponType, number]>
  const entries: Array<[PrismaWeaponType, number]> = tracked.length > 0
    ? tracked
    : [[fallbackWeaponType ?? 'MELEE', part.damageDealt]]
  return entries
    .map(([weaponType, damage]) => ({
      weaponType,
      exp: calcWeaponSkillExp(damage, targetHpMax, won ? 1 : 0, levelDiff, 1.0, premiumMultiplier),
    }))
    .filter(entry => entry.exp > 0)
}
