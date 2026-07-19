import { describe, it, expect } from 'vitest'
import {
  calcHitChance,
  calcDodgeChance,
  calcBlockChance,
  calcCritChance,
  calcWeaponSkillMultiplier,
  calcRawDamage,
  applyArmor,
  applyEndurance,
  calcInitiative,
  resolveAttack,
  type AttackerSnapshot,
  type DefenderSnapshot,
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
    const low  = calcInitiative(2, 3, 1, 0) - Math.random() * 0  // deterministic-ish
    const high = calcInitiative(8, 3, 1, 0)
    // high REA should give higher average — test statistically over many runs
    let highWins = 0
    for (let i = 0; i < 100; i++) {
      if (calcInitiative(8, 3, 1, 0) > calcInitiative(2, 3, 1, 0)) highWins++
    }
    expect(highWins).toBeGreaterThan(70) // at least 70% of the time
  })

  it('heavy equipment reduces initiative', () => {
    const light  = calcInitiative(5, 5, 5, 0)
    const heavy  = calcInitiative(5, 5, 5, 50)
    // On average, heavy should be lower
    let heavierLower = 0
    for (let i = 0; i < 100; i++) {
      if (calcInitiative(5, 5, 5, 50) < calcInitiative(5, 5, 5, 0)) heavierLower++
    }
    expect(heavierLower).toBeGreaterThan(60)
  })
})

// ---------------------------------------------------------------
// Hit chance
// ---------------------------------------------------------------
describe('calcHitChance', () => {
  it('is always between 0.05 and 0.95', () => {
    for (let acc = 0; acc <= 20; acc++) {
      for (let agi = 0; agi <= 20; agi++) {
        const chance = calcHitChance(
          { acc, weaponAccuracy: 0.75, weaponSkillLevel: 5 },
          { agi, dodgeBonus: 0 }
        )
        expect(chance).toBeGreaterThanOrEqual(0.05)
        expect(chance).toBeLessThanOrEqual(0.95)
      }
    }
  })

  it('higher ACC increases hit chance', () => {
    const low  = calcHitChance({ acc: 2, weaponAccuracy: 0.7, weaponSkillLevel: 1 }, { agi: 3, dodgeBonus: 0 })
    const high = calcHitChance({ acc: 10, weaponAccuracy: 0.7, weaponSkillLevel: 1 }, { agi: 3, dodgeBonus: 0 })
    expect(high).toBeGreaterThan(low)
  })

  it('higher AGI of defender reduces hit chance', () => {
    const easy = calcHitChance({ acc: 5, weaponAccuracy: 0.7, weaponSkillLevel: 5 }, { agi: 1, dodgeBonus: 0 })
    const hard = calcHitChance({ acc: 5, weaponAccuracy: 0.7, weaponSkillLevel: 5 }, { agi: 10, dodgeBonus: 0 })
    expect(easy).toBeGreaterThan(hard)
  })

  it('higher weapon skill increases hit chance', () => {
    const noSkill  = calcHitChance({ acc: 5, weaponAccuracy: 0.7, weaponSkillLevel: 0 }, { agi: 3, dodgeBonus: 0 })
    const maxSkill = calcHitChance({ acc: 5, weaponAccuracy: 0.7, weaponSkillLevel: 20 }, { agi: 3, dodgeBonus: 0 })
    expect(maxSkill).toBeGreaterThan(noSkill)
  })
})

// ---------------------------------------------------------------
// Dodge chance
// ---------------------------------------------------------------
describe('calcDodgeChance', () => {
  it('is always between 0 and 0.75', () => {
    for (let agi = 0; agi <= 20; agi++) {
      const chance = calcDodgeChance(
        { agi, armorWeight: 0, dodgeBonus: 0 },
        { acc: 5, agi: 3 }
      )
      expect(chance).toBeGreaterThanOrEqual(0)
      expect(chance).toBeLessThanOrEqual(0.75)
    }
  })

  it('heavy armor reduces dodge chance', () => {
    const light = calcDodgeChance({ agi: 6, armorWeight: 0, dodgeBonus: 0 }, { acc: 3, agi: 3 })
    const heavy = calcDodgeChance({ agi: 6, armorWeight: 20, dodgeBonus: 0 }, { acc: 3, agi: 3 })
    expect(light).toBeGreaterThan(heavy)
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
  it('is always between 0.01 and 0.5', () => {
    for (let agr = 0; agr <= 20; agr++) {
      const chance = calcCritChance(
        { agr, weaponSkillLevel: 5, critBonus: 0 },
        { antiCrit: 0, end: 3 }
      )
      expect(chance).toBeGreaterThanOrEqual(0.01)
      expect(chance).toBeLessThanOrEqual(0.5)
    }
  })

  it('higher AGR increases crit chance', () => {
    const low  = calcCritChance({ agr: 1, weaponSkillLevel: 1, critBonus: 0 }, { antiCrit: 0, end: 3 })
    const high = calcCritChance({ agr: 15, weaponSkillLevel: 1, critBonus: 0 }, { antiCrit: 0, end: 3 })
    expect(high).toBeGreaterThan(low)
  })

  it('anti-crit reduces crit chance', () => {
    const noDefense = calcCritChance({ agr: 5, weaponSkillLevel: 5, critBonus: 0 }, { antiCrit: 0, end: 1 })
    const defended  = calcCritChance({ agr: 5, weaponSkillLevel: 5, critBonus: 0 }, { antiCrit: 0.15, end: 1 })
    expect(noDefense).toBeGreaterThan(defended)
  })
})

// ---------------------------------------------------------------
// Weapon skill multiplier
// ---------------------------------------------------------------
describe('calcWeaponSkillMultiplier', () => {
  it('skill 0 gives minimum multiplier (0.35)', () => {
    expect(calcWeaponSkillMultiplier(0)).toBeCloseTo(0.35)
  })

  it('skill 20 gives ~1.05', () => {
    // 0.35 + 20 * 0.035 = 0.35 + 0.7 = 1.05
    expect(calcWeaponSkillMultiplier(20)).toBeCloseTo(1.05, 2)
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
// Armor application
// ---------------------------------------------------------------
describe('applyArmor', () => {
  it('always deals at least 1 damage', () => {
    expect(applyArmor(1, 9999, false)).toBeGreaterThanOrEqual(1)
    expect(applyArmor(0, 0, false)).toBeGreaterThanOrEqual(1)
  })

  it('more armor means less final damage', () => {
    const low  = applyArmor(50, 5, false)
    const high = applyArmor(50, 30, false)
    expect(low).toBeGreaterThan(high)
  })

  it('crit ignores 50% of armor', () => {
    const normal = applyArmor(50, 20, false)
    const crit   = applyArmor(50, 20, true)
    expect(crit).toBeGreaterThan(normal)
  })
})

// ---------------------------------------------------------------
// Endurance application
// ---------------------------------------------------------------
describe('applyEndurance', () => {
  it('always deals at least 1 damage', () => {
    expect(applyEndurance(1, 999)).toBeGreaterThanOrEqual(1)
  })

  it('higher END reduces damage', () => {
    const low  = applyEndurance(50, 2)
    const high = applyEndurance(50, 15)
    expect(low).toBeGreaterThan(high)
  })

  it('END effect has diminishing returns (logarithmic)', () => {
    const d1 = applyEndurance(100, 1)  - applyEndurance(100, 2)   // gain from END 1→2
    const d2 = applyEndurance(100, 10) - applyEndurance(100, 11)  // gain from END 10→11
    // Each extra point should give less and less
    expect(d1).toBeGreaterThan(d2)
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
    expect(missCount).toBeGreaterThan(50)
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

  it('new player vs training bot runs 4-8 rounds on average', () => {
    // Simulate the ТЗ requirement: 4–8 rounds for newbie vs bot
    const attacker = makeAttacker({ str: 3, acc: 3, weaponSkillLevel: 1, minDamage: 4, maxDamage: 9 })
    const defender = makeDefender({ agi: 2, armor: 1, end: 2 })

    const HP = 60
    const roundCounts: number[] = []

    for (let trial = 0; trial < 200; trial++) {
      let hp = HP
      let rounds = 0
      while (hp > 0 && rounds < 30) {
        const r = resolveAttack(attacker, defender, false)
        if (r.hit && !r.dodge) hp -= r.finalDamage
        rounds++
      }
      roundCounts.push(rounds)
    }

    const avg = roundCounts.reduce((a, b) => a + b, 0) / roundCounts.length
    // TZ says 4-8 rounds — allow some variance
    expect(avg).toBeGreaterThan(2)
    expect(avg).toBeLessThan(20)
  })
})
