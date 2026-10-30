import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { BalanceConfig } from '../../config/balance.config'
import {
  calcHitChance, calcDodgeChance, calcBlockChance, calcCritChance,
  calcWeaponSkillMultiplier, calcArmorShare, calcSpread,
  calcInitiative, resolveAttack, calcEffectiveWeaponSkill,
  type AttackerSnapshot, type DefenderSnapshot,
} from '../../modules/battles/battle.formulas'

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function makeAttacker(overrides: Partial<AttackerSnapshot> = {}): AttackerSnapshot {
  return {
    str: 3, acc: 3, agi: 3, rea: 2, luck: 1, agr: 1, end: 3,
    weaponSkillLevel: 1,
    minDamage: 4, maxDamage: 8,
    weaponAccuracy: 0.75,
    critBonus: 0, critDamageBonus: 0, blockPierce: 0,
    flatDamageBonus: 0, equipmentWeight: 0,
    ...overrides,
  }
}

function makeDefender(overrides: Partial<DefenderSnapshot> = {}): DefenderSnapshot {
  return {
    agi: 3, rea: 2, end: 3, luck: 1,
    armor: 5,
    dodgeBonus: 0, antiCrit: 0, blockBonus: 0,
    armorWeight: 0, antiSkillLevel: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------
// Initiative
// ---------------------------------------------------------------
describe('calcInitiative', () => {
  it('returns at least 1', () => {
    // Even with huge penalties, should never go below 1
    expect(calcInitiative(0, 0, 0, 999)).toBeGreaterThanOrEqual(1)
  })

  it('higher REA gives higher base initiative', () => {
    // high REA should give higher average — test statistically over many runs
    let highWins = 0
    for (let i = 0; i < 100; i++) {
      if (calcInitiative(8, 3, 1, 0) > calcInitiative(2, 3, 1, 0)) highWins++
    }
    expect(highWins).toBeGreaterThan(70) // at least 70% of the time
  })

  it('heavy equipment reduces initiative', () => {
    // On average, heavy should be lower
    let heavierLower = 0
    for (let i = 0; i < 100; i++) {
      if (calcInitiative(5, 5, 5, 50) < calcInitiative(5, 5, 5, 0)) heavierLower++
    }
    expect(heavierLower).toBeGreaterThan(60)
  })
})

// ---------------------------------------------------------------
// Уворот по книге: 0,05 + 0,25 × (ЛВКз − МТКа)/(ЛВКз + МТКа + 20), 1…35%
// ---------------------------------------------------------------
describe('calcDodgeChance', () => {
  it('is always between 0.01 and 0.35', () => {
    for (let acc = 0; acc <= 20; acc++) {
      for (let agi = 0; agi <= 20; agi++) {
        const chance = calcDodgeChance({ agi, dodgeBonus: 0 }, { acc, weaponAccuracy: 0.7 })
        expect(chance).toBeGreaterThanOrEqual(0.01)
        expect(chance).toBeLessThanOrEqual(0.35)
      }
    }
  })

  it('equal stats give the book base 5%', () => {
    expect(calcDodgeChance({ agi: 10, dodgeBonus: 0 }, { acc: 10, weaponAccuracy: 0.7 })).toBeCloseTo(0.05, 6)
  })

  it('matches the book example: agility 20 against accuracy 0', () => {
    // 0,05 + 0,25 × 20/40 = 0,175
    expect(calcDodgeChance({ agi: 20, dodgeBonus: 0 }, { acc: 0, weaponAccuracy: 0.7 })).toBeCloseTo(0.175, 6)
  })

  it('higher defender AGI and lower attacker ACC mean more dodges', () => {
    const base = calcDodgeChance({ agi: 5, dodgeBonus: 0 }, { acc: 5, weaponAccuracy: 0.7 })
    expect(calcDodgeChance({ agi: 12, dodgeBonus: 0 }, { acc: 5, weaponAccuracy: 0.7 })).toBeGreaterThan(base)
    expect(calcDodgeChance({ agi: 5, dodgeBonus: 0 }, { acc: 12, weaponAccuracy: 0.7 })).toBeLessThan(base)
  })

  it('dodge charms and weapon accuracy shift the chance', () => {
    const base = calcDodgeChance({ agi: 15, dodgeBonus: 0 }, { acc: 2, weaponAccuracy: 0.7 })
    expect(calcDodgeChance({ agi: 15, dodgeBonus: 0.05 }, { acc: 2, weaponAccuracy: 0.7 })).toBeCloseTo(base + 0.05, 6)
    expect(calcDodgeChance({ agi: 15, dodgeBonus: 0 }, { acc: 2, weaponAccuracy: 0.7, antiDodgeBonus: 0.03 })).toBeCloseTo(base - 0.03, 6)
    expect(calcDodgeChance({ agi: 15, dodgeBonus: 0 }, { acc: 2, weaponAccuracy: 0.8 })).toBeCloseTo(base - 0.1, 6)
  })

  it('hit chance is everything except a dodge', () => {
    const atk = { acc: 4, weaponAccuracy: 0.7 }
    const def = { agi: 9, dodgeBonus: 0 }
    expect(calcHitChance(atk, def)).toBeCloseTo(1 - calcDodgeChance(def, atk), 9)
  })
})

// ---------------------------------------------------------------
// Block chance
// ---------------------------------------------------------------
describe('calcBlockChance', () => {
  it('is always between 0 and 0.8', () => {
    for (let rea = 0; rea <= 20; rea++) {
      const chance = calcBlockChance(
        { rea, blockBonus: 0 },
        { rea: 3, luck: 2, blockPierce: 0 }
      )
      expect(chance).toBeGreaterThanOrEqual(0)
      expect(chance).toBeLessThanOrEqual(0.8)
    }
  })

  it('higher REA of defender increases block chance', () => {
    const low  = calcBlockChance({ rea: 2, blockBonus: 0 }, { rea: 3, luck: 1, blockPierce: 0 })
    const high = calcBlockChance({ rea: 10, blockBonus: 0 }, { rea: 3, luck: 1, blockPierce: 0 })
    expect(high).toBeGreaterThan(low)
  })

  it('attacker LUCK reduces block chance (pierces block)', () => {
    const lowLuck  = calcBlockChance({ rea: 5, blockBonus: 0 }, { rea: 2, luck: 0, blockPierce: 0 })
    const highLuck = calcBlockChance({ rea: 5, blockBonus: 0 }, { rea: 2, luck: 10, blockPierce: 0 })
    expect(lowLuck).toBeGreaterThan(highLuck)
  })
})

// ---------------------------------------------------------------
// Crit chance
// ---------------------------------------------------------------
describe('calcCritChance', () => {
  it('is always between 0.02 and 0.4', () => {
    for (let agr = 0; agr <= 20; agr++) {
      for (let defAgr = 0; defAgr <= 20; defAgr += 5) {
        const chance = calcCritChance({ agr, critBonus: 0 }, { antiCrit: 0, agr: defAgr })
        expect(chance).toBeGreaterThanOrEqual(0.02)
        expect(chance).toBeLessThanOrEqual(0.4)
      }
    }
  })

  it('equal aggression gives the book base 10%', () => {
    expect(calcCritChance({ agr: 7, critBonus: 0 }, { antiCrit: 0, agr: 7 })).toBeCloseTo(0.1, 6)
  })

  it('higher AGR increases crit chance, defender AGR resists it', () => {
    const low  = calcCritChance({ agr: 1, critBonus: 0 }, { antiCrit: 0, agr: 3 })
    const high = calcCritChance({ agr: 15, critBonus: 0 }, { antiCrit: 0, agr: 3 })
    expect(high).toBeGreaterThan(low)
    expect(calcCritChance({ agr: 8, critBonus: 0 }, { antiCrit: 0, agr: 15 }))
      .toBeLessThan(calcCritChance({ agr: 8, critBonus: 0 }, { antiCrit: 0, agr: 1 }))
  })

  it('anti-crit reduces crit chance', () => {
    const noDefense = calcCritChance({ agr: 5, critBonus: 0 }, { antiCrit: 0, agr: 1 })
    const defended  = calcCritChance({ agr: 5, critBonus: 0 }, { antiCrit: 0.05, agr: 1 })
    expect(noDefense).toBeGreaterThan(defended)
  })
})

// ---------------------------------------------------------------
// Weapon skill multiplier
// ---------------------------------------------------------------
describe('calcWeaponSkillMultiplier', () => {
  it('skill 0 gives base multiplier (1.0)', () => {
    expect(calcWeaponSkillMultiplier(0)).toBeCloseTo(1.0)
  })

  it('skill 20 gives ~1.5', () => {
    // 1.0 + 20 * 0.025 = 1.0 + 0.5 = 1.5
    expect(calcWeaponSkillMultiplier(20)).toBeCloseTo(1.5, 2)
  })

  it('capped at 1.5 for very high skills', () => {
    expect(calcWeaponSkillMultiplier(100)).toBeLessThanOrEqual(1.5)
  })

  it('increases monotonically', () => {
    let prev = calcWeaponSkillMultiplier(0)
    for (let s = 1; s <= 30; s++) {
      const curr = calcWeaponSkillMultiplier(s)
      expect(curr).toBeGreaterThanOrEqual(prev)
      prev = curr
    }
  })
})

// ---------------------------------------------------------------
// Броня по книге: K = 40 × 1,3^(L − 1), проходит K / (K + броня + 0,5 × ВЫН)
// ---------------------------------------------------------------
describe('calcArmorShare', () => {
  it('matches the book example: armor 5, endurance 10, level 1 → 0.8', () => {
    expect(calcArmorShare(5, 10, 1)).toBeCloseTo(0.8, 9)
  })

  it('more armor and more endurance mean less damage', () => {
    expect(calcArmorShare(5, 3, 1)).toBeGreaterThan(calcArmorShare(30, 3, 1))
    expect(calcArmorShare(5, 2, 1)).toBeGreaterThan(calcArmorShare(5, 15, 1))
  })

  it('the same armor protects less on a higher defender level', () => {
    expect(calcArmorShare(20, 5, 10)).toBeGreaterThan(calcArmorShare(20, 5, 1))
  })

  it('no armor and no endurance let everything through', () => {
    expect(calcArmorShare(0, 0, 1)).toBe(1)
  })
})

describe('calcSpread', () => {
  it('stays within ±10%', () => {
    expect(calcSpread(() => 0)).toBeCloseTo(0.9, 9)
    expect(calcSpread(() => 0.5)).toBeCloseTo(1, 9)
    expect(calcSpread(() => 0.999999)).toBeLessThanOrEqual(1.1)
  })
})

describe('book strike example', () => {
  // Книга считает без масштаба под наши вещи — сверяем её же числа.
  const strike = BalanceConfig.strike as { damageScale: number }
  const scale = strike.damageScale
  beforeEach(() => { strike.damageScale = 1 })
  afterEach(() => { strike.damageScale = scale })

  it('strength 10, weapon 10, armor 5, endurance 10, level 1: ordinary 20, crit 30', () => {
    const attacker = makeAttacker({ str: 10, minDamage: 10, maxDamage: 10, weaponSkillLevel: 0, acc: 10, agr: 0 })
    const defender = makeDefender({ agi: 10, end: 10, armor: 5, level: 1, agr: 0 })
    // уворот нет (0), удачи нет (0.99), оружие (0.5), крит нет (0.99), средний разброс (0.5)
    const plain = (() => { const q = [0, 0.99, 0.5, 0.99, 0.5]; return resolveAttack(attacker, defender, false, () => q.shift() ?? 0.5) })()
    expect(plain.finalDamage).toBe(20)
    const crit = (() => { const q = [0, 0.99, 0.5, 0, 0.5]; return resolveAttack(attacker, defender, false, () => q.shift() ?? 0.5) })()
    expect(crit.crit).toBe(true)
    expect(crit.finalDamage).toBe(30)
  })
})

// ---------------------------------------------------------------
// Full attack resolution
// ---------------------------------------------------------------
describe('resolveAttack', () => {
  it('returns consistent result shape', () => {
    const attacker = makeAttacker()
    const defender = makeDefender()
    const result = resolveAttack(attacker, defender, false)
    expect(result).toHaveProperty('hit')
    expect(result).toHaveProperty('dodge')
    expect(result).toHaveProperty('block')
    expect(result).toHaveProperty('crit')
    expect(result).toHaveProperty('rawDamage')
    expect(result).toHaveProperty('finalDamage')
    expect(result).toHaveProperty('logParts')
    expect(Array.isArray(result.logParts)).toBe(true)
  })

  it('if miss → damage is 0', () => {
    // Use extreme dodge to force misses
    const attacker = makeAttacker({ acc: 0, weaponAccuracy: 0.05 })
    const defender = makeDefender({ agi: 20, dodgeBonus: 1 })
    let missCount = 0
    for (let i = 0; i < 100; i++) {
      const r = resolveAttack(attacker, defender, false)
      if (!r.hit || r.dodge) {
        expect(r.finalDamage).toBe(0)
        missCount++
      }
    }
    // уворот упирается в потолок книги — 35%
    expect(missCount).toBeGreaterThan(20)
  })

  it('if hit → finalDamage >= 1', () => {
    // Force hits
    const attacker = makeAttacker({ acc: 20, weaponAccuracy: 0.99, weaponSkillLevel: 20 })
    const defender = makeDefender({ agi: 0, dodgeBonus: 0 })
    let hitCount = 0
    for (let i = 0; i < 100; i++) {
      const r = resolveAttack(attacker, defender, false)
      if (r.hit && !r.dodge) {
        expect(r.finalDamage).toBeGreaterThanOrEqual(1)
        hitCount++
      }
    }
    expect(hitCount).toBeGreaterThan(80)
  })

  it('blocking reduces damage', () => {
    const attacker = makeAttacker({ acc: 15, weaponAccuracy: 0.95, weaponSkillLevel: 10 })
    const defenderBlocking = makeDefender({ rea: 15, blockBonus: 0.3 })

    let blockingTotal = 0, normalTotal = 0, blockingCount = 0, normalCount = 0

    for (let i = 0; i < 500; i++) {
      const blocking = resolveAttack(attacker, defenderBlocking, true)
      const normal   = resolveAttack(attacker, defenderBlocking, false)
      if (blocking.hit && !blocking.dodge) { blockingTotal += blocking.finalDamage; blockingCount++ }
      if (normal.hit && !normal.dodge)     { normalTotal  += normal.finalDamage;   normalCount++ }
    }

    if (blockingCount > 0 && normalCount > 0) {
      expect(blockingTotal / blockingCount).toBeLessThan(normalTotal / normalCount)
    }
  })

  it('produces valid statistical results over 1000 attacks', () => {
    // Property-based test: verify statistical properties of the attack formula
    const attacker = makeAttacker({ acc: 3, weaponSkillLevel: 1, minDamage: 4, maxDamage: 9, weaponAccuracy: 0.75 })
    const defender = makeDefender({ agi: 2, armor: 1, end: 2 })

    let hits = 0, misses = 0, dodges = 0, totalDmg = 0, maxDmg = 0
    const N = 1000

    for (let i = 0; i < N; i++) {
      const r = resolveAttack(attacker, defender, false)
      if (!r.hit) misses++
      else if (r.dodge) dodges++
      else {
        hits++
        totalDmg += r.finalDamage
        if (r.finalDamage > maxDmg) maxDmg = r.finalDamage
      }
    }

    const hitRate = hits / N
    const avgDmg = hits > 0 ? totalDmg / hits : 0

    // Каждая попытка укладывается ровно в один исход — сумма обязана сойтись
    expect(hits + misses + dodges).toBe(N)
    // Уворот по книге не меньше 1% и не больше 35%
    expect(hitRate).toBeGreaterThan(0.6)
    expect(hitRate).toBeLessThan(1)
    // When a hit lands, damage must be >= 1
    expect(avgDmg).toBeGreaterThanOrEqual(1)
    // Max damage must be reasonable (not astronomical)
    expect(maxDmg).toBeLessThan(200)
    // At least some hits must land in 1000 tries (with 5% minimum hit chance)
    expect(hits).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------
// Anti-mastery (WRES) — TZ раздел 10, 18.7
// ---------------------------------------------------------------
describe('calcEffectiveWeaponSkill (anti-mastery)', () => {
  it('no anti-mastery = full skill level', () => {
    expect(calcEffectiveWeaponSkill(10, 0)).toBe(10)
  })

  it('anti-mastery reduces effective skill by 0.5 per level', () => {
    // effectiveWSK = max(0, 10 - 4 ? 0.5) = 10 - 2 = 8
    expect(calcEffectiveWeaponSkill(10, 4)).toBe(8)
  })

  it('never goes below 0', () => {
    expect(calcEffectiveWeaponSkill(5, 20)).toBe(0)
    expect(calcEffectiveWeaponSkill(0, 10)).toBe(0)
  })
})

describe('Anti-mastery integration: high defender anti-skill reduces damage', () => {
  it('high anti-skill level reduces final damage', () => {
    const attacker: AttackerSnapshot = {
      str: 5, acc: 8, agi: 3, rea: 2, luck: 1, agr: 2, end: 3,
      weaponSkillLevel: 15, minDamage: 10, maxDamage: 15,
      weaponAccuracy: 0.9, critBonus: 0, critDamageBonus: 0,
      blockPierce: 0, flatDamageBonus: 0, equipmentWeight: 0,
    }
    const defenderNoWres: DefenderSnapshot = {
      agi: 1, rea: 1, end: 1, luck: 0,
      armor: 0, dodgeBonus: 0, antiCrit: 0, blockBonus: 0, armorWeight: 0,
      antiSkillLevel: 0, antiCounterDefense: 0, antiLuck: 0, minDamage: 2, maxDamage: 5,
    }
    const defenderHighWres: DefenderSnapshot = {
      ...defenderNoWres,
      antiSkillLevel: 15, // High anti-mastery vs this weapon type
    }

    // Run 100 attacks and compare averages
    let totalNoWres = 0, totalHighWres = 0, hits = 0
    for (let i = 0; i < 200; i++) {
      const r1 = resolveAttack(attacker, defenderNoWres, false)
      const r2 = resolveAttack(attacker, defenderHighWres, false)
      if (r1.hit && !r1.dodge && !r1.block) {
        totalNoWres += r1.finalDamage
        hits++
      }
      if (r2.hit && !r2.dodge && !r2.block) {
        totalHighWres += r2.finalDamage
      }
    }
    if (hits > 10) {
      const avgNoWres  = totalNoWres / hits
      const avgHiWres  = totalHighWres / hits
      // High WRES should give meaningfully less damage
      expect(avgHiWres).toBeLessThan(avgNoWres)
    }
  })
})

describe('Initiative: equipment weight penalty', () => {
  it('heavy equipment reduces initiative', () => {
    let lightWins = 0
    for (let i = 0; i < 200; i++) {
      const heavy = calcInitiative(5, 5, 5, 30) // heavy armor
      const light = calcInitiative(5, 5, 5, 0)  // no armor
      if (light > heavy) lightWins++
    }
    // Light build should win initiative more often
    expect(lightWins).toBeGreaterThan(100) // > 50% of the time
  })
})
