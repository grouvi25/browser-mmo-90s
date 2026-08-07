import { describe, it, expect } from 'vitest'
import {
  calcHpMax,
  calcCarryWeight,
  calcBattleExp,
  getLevelFromExp,
  calcWeaponSkillExp,
  getWeaponSkillLevelFromExp,
  calcRepairCost,
  calcWeaponDurabilityLoss,
  calcArmorDurabilityLoss,
} from '../../modules/stats/stats.formulas'
import { BalanceConfig } from '../../config/balance.config'

// ---------------------------------------------------------------
// HP
// ---------------------------------------------------------------
describe('calcHpMax', () => {
  it('base HP at level 1, END=3 matches ТЗ formula', () => {
    // hpMax = 60 + END*6 + BL*2
    const expected = 60 + 3 * 6 + 1 * 2
    expect(calcHpMax(3, 1)).toBe(expected)
  })

  it('higher END gives more HP', () => {
    expect(calcHpMax(10, 1)).toBeGreaterThan(calcHpMax(3, 1))
  })

  it('higher battle level gives more HP', () => {
    expect(calcHpMax(3, 10)).toBeGreaterThan(calcHpMax(3, 1))
  })

  it('item HP bonus is added', () => {
    const base = calcHpMax(3, 1, 0)
    const withBonus = calcHpMax(3, 1, 20)
    expect(withBonus - base).toBe(20)
  })

  it('starting HP for all archetypes is at least 60', () => {
    for (let end = 1; end <= 5; end++) {
      expect(calcHpMax(end, 1)).toBeGreaterThanOrEqual(60)
    }
  })
})

// ---------------------------------------------------------------
// Carry weight
// ---------------------------------------------------------------
describe('calcCarryWeight', () => {
  it('matches ТЗ formula: 20 + STR*6', () => {
    expect(calcCarryWeight(3)).toBe(20 + 3 * 6)
    expect(calcCarryWeight(0)).toBe(20)
  })

  it('bag bonus is added', () => {
    expect(calcCarryWeight(3, 10)).toBe(20 + 3 * 6 + 10)
  })
})

// ---------------------------------------------------------------
// Battle experience
// ---------------------------------------------------------------
describe('calcBattleExp', () => {
  it('PvP win gives more exp than PvE win', () => {
    const pvp = calcBattleExp(50, 20, 100, 0, 'PVP_WIN')
    const pve = calcBattleExp(50, 20, 100, 0, 'PVE_WIN')
    expect(pvp).toBeGreaterThan(pve)
  })

  it('PvP loss gives more exp than PvE loss', () => {
    const pvp = calcBattleExp(50, 20, 100, 0, 'PVP_LOSS')
    const pve = calcBattleExp(50, 20, 100, 0, 'PVE_LOSS')
    expect(pvp).toBeGreaterThan(pve)
  })

  it('PvE loss gives 0 exp', () => {
    expect(calcBattleExp(50, 20, 100, 0, 'PVE_LOSS')).toBe(0)
  })

  it('large level diff reduces exp', () => {
    const same    = calcBattleExp(50, 20, 100, 0, 'PVP_WIN')
    const bigDiff = calcBattleExp(50, 20, 100, 15, 'PVP_WIN')
    expect(same).toBeGreaterThan(0) // равные уровни — опыт начисляется
    expect(bigDiff).toBe(0)         // diff >= 15 → 0
  })

  it('more damage dealt = more exp', () => {
    const low  = calcBattleExp(20, 20, 100, 0, 'PVP_WIN')
    const high = calcBattleExp(80, 20, 100, 0, 'PVP_WIN')
    expect(high).toBeGreaterThan(low)
  })

  it('anti-farm coefficient reduces exp', () => {
    const full = calcBattleExp(50, 20, 100, 0, 'PVE_WIN', 1.0)
    const half = calcBattleExp(50, 20, 100, 0, 'PVE_WIN', 0.5)
    expect(half).toBeLessThan(full)
  })

  it('result is never negative', () => {
    expect(calcBattleExp(0, 0, 0, 0, 'PVE_LOSS')).toBeGreaterThanOrEqual(0)
    expect(calcBattleExp(-100, 20, 100, 0, 'PVP_WIN')).toBeGreaterThanOrEqual(0)
  })
})

// ---------------------------------------------------------------
// Level from exp
// ---------------------------------------------------------------
describe('getLevelFromExp', () => {
  it('0 exp = level 1', () => {
    expect(getLevelFromExp(0)).toBe(1)
  })

  it('exact threshold exp = that level', () => {
    const thresholds = BalanceConfig.battleExp.levelThresholds
    // Level 2 starts at threshold[1]
    expect(getLevelFromExp(thresholds[1])).toBe(2)
    expect(getLevelFromExp(thresholds[5])).toBe(6)
  })

  it('just below threshold = previous level', () => {
    const thresholds = BalanceConfig.battleExp.levelThresholds
    expect(getLevelFromExp(thresholds[2] - 1)).toBe(2)
  })

  it('never goes below 1', () => {
    expect(getLevelFromExp(-999)).toBe(1)
  })
})

// ---------------------------------------------------------------
// Weapon skill exp
// ---------------------------------------------------------------
describe('calcWeaponSkillExp', () => {
  it('0 damage gives 0 exp', () => {
    expect(calcWeaponSkillExp(0, 100, 1, 0)).toBe(0)
  })

  it('more damage = more exp', () => {
    const low  = calcWeaponSkillExp(20, 100, 1, 0)
    const high = calcWeaponSkillExp(80, 100, 1, 0)
    expect(high).toBeGreaterThan(low)
  })

  it('premium multiplier increases exp', () => {
    const base    = calcWeaponSkillExp(50, 100, 1, 0, 1.0, 1.0)
    const premium = calcWeaponSkillExp(50, 100, 1, 0, 1.0, 1.5)
    expect(premium).toBeGreaterThan(base)
  })

  it('level diff reduces exp monotonically', () => {
    const d0  = calcWeaponSkillExp(50, 100, 1, 0)
    const d5  = calcWeaponSkillExp(50, 100, 1, 5)
    const d10 = calcWeaponSkillExp(50, 100, 1, 10)
    expect(d0).toBeGreaterThanOrEqual(d5)
    expect(d5).toBeGreaterThanOrEqual(d10)
  })
})

// ---------------------------------------------------------------
// Weapon skill level from exp
// ---------------------------------------------------------------
describe('getWeaponSkillLevelFromExp', () => {
  it('0 exp = level 1', () => {
    expect(getWeaponSkillLevelFromExp(0)).toBe(1)
  })

  it('exp at threshold 5 = level 5', () => {
    const thr = BalanceConfig.weaponSkill.expThresholds[5]
    expect(getWeaponSkillLevelFromExp(thr)).toBe(6)
  })

  it('never exceeds max level', () => {
    // Max level = expThresholds.length (31 levels in our table: 1 to 31)
    const maxLevel = BalanceConfig.weaponSkill.expThresholds.length
    expect(getWeaponSkillLevelFromExp(999_999_999)).toBeLessThanOrEqual(maxLevel)
  })
})

// ---------------------------------------------------------------
// Repair cost
// ---------------------------------------------------------------
describe('calcRepairCost', () => {
  it('matches ТЗ formula: basePrice/120 × lostDur × qualityCoeff', () => {
    // COMMON quality = 1.0, upgradeLevel=0 → upgradeCoeff=1.0
    const expected = Math.ceil(1200 / 120 * 20 * 1.0 * 1.0)
    expect(calcRepairCost(1200, 20, 'COMMON', 0)).toBe(expected)
  })

  it('RARE quality costs more than COMMON', () => {
    const common = calcRepairCost(1000, 50, 'COMMON', 0)
    const rare   = calcRepairCost(1000, 50, 'RARE', 0)
    expect(rare).toBeGreaterThan(common)
  })

  it('JUNK quality costs less than COMMON', () => {
    const junk   = calcRepairCost(1000, 50, 'JUNK', 0)
    const common = calcRepairCost(1000, 50, 'COMMON', 0)
    expect(junk).toBeLessThan(common)
  })

  it('higher upgrade level increases cost', () => {
    const base    = calcRepairCost(1000, 50, 'COMMON', 0)
    const upgraded = calcRepairCost(1000, 50, 'COMMON', 3)
    expect(upgraded).toBeGreaterThan(base)
  })

  it('minimum repair cost is 1', () => {
    expect(calcRepairCost(1, 1, 'JUNK', 0)).toBeGreaterThanOrEqual(1)
  })

  it('full durability loss is more expensive than partial', () => {
    const partial = calcRepairCost(2000, 20, 'COMMON', 0)
    const full    = calcRepairCost(2000, 100, 'COMMON', 0)
    expect(full).toBeGreaterThan(partial)
  })
})

// ---------------------------------------------------------------
// Durability loss
// ---------------------------------------------------------------
describe('calcWeaponDurabilityLoss', () => {
  it('returns 1 per attack in MVP simplified mode', () => {
    expect(calcWeaponDurabilityLoss(1)).toBe(1)
  })
})

describe('calcArmorDurabilityLoss', () => {
  it('0 hits = 0 loss', () => {
    expect(calcArmorDurabilityLoss(0)).toBe(0)
  })

  it('1 hit = 0 loss (floor(1 * 0.5))', () => {
    expect(calcArmorDurabilityLoss(1)).toBe(0)
  })

  it('2 hits = 1 loss (floor(2 * 0.5))', () => {
    expect(calcArmorDurabilityLoss(2)).toBe(1)
  })

  it('increases with hits', () => {
    expect(calcArmorDurabilityLoss(10)).toBeGreaterThan(calcArmorDurabilityLoss(2))
  })

  it('never negative', () => {
    expect(calcArmorDurabilityLoss(-5)).toBeGreaterThanOrEqual(0)
  })
})
