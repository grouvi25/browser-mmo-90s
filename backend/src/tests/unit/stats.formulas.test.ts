import { describe, it, expect } from 'vitest'
import {
  calcHpMax,
  calcCarryWeight,
  calcBattleExp,
  calcRatingPower,
  typicalTargetPower,
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
// Battle experience — формула «Ревизия 2» (книга заказчика 23.10)
// ---------------------------------------------------------------
describe('calcBattleExp', () => {
  it('пример книги «ранний уровень за один бой»: 1103 XP', () => {
    // H = 100, P = 200, D = 200, R = 100, уровни равны:
    // зачёт = MIN(200; 200; 300) = 200; 200 × 2 × 1 × 2,759375 = 1103,75 → 1103
    expect(calcBattleExp({
      damageDealt: 200, targetPower: 200, targetMaxHp: 100, targetHealed: 100,
      playerLevel: 1, targetLevel: 1, result: 'PVP_WIN',
    })).toBe(1103)
  })

  it('общий потолок 50 000 XP за бой', () => {
    // Книга: P = H = 100 000, D = 300 000, R = 200 000 → за бой 50 000
    expect(calcBattleExp({
      damageDealt: 300000, targetPower: 100000, targetMaxHp: 100000, targetHealed: 200000,
      playerLevel: 10, targetLevel: 10, result: 'PVP_WIN',
    })).toBe(50000)
  })

  it('проигравшему 10%, ничья 20%', () => {
    const base = {
      damageDealt: 200, targetPower: 200, targetMaxHp: 100,
      playerLevel: 1, targetLevel: 1,
    } as const
    const win = calcBattleExp({ ...base, result: 'PVP_WIN' })
    expect(calcBattleExp({ ...base, result: 'PVP_LOSS' })).toBe(Math.floor(win * 0.1))
    expect(calcBattleExp({ ...base, result: 'DRAW' })).toBe(Math.floor(win * 0.2))
    // PvE-поражение тоже 10%: «проигравшему 10%» без разбора типа боя.
    expect(calcBattleExp({ ...base, result: 'PVE_LOSS' })).toBe(Math.floor(win * 0.1))
  })

  it('PvP победа даёт больше PvE победы (ставки 1 против 0,5)', () => {
    const base = {
      damageDealt: 100, targetPower: 150, targetMaxHp: 100,
      playerLevel: 1, targetLevel: 1,
    } as const
    expect(calcBattleExp({ ...base, result: 'PVP_WIN' })).toBeGreaterThan(
      calcBattleExp({ ...base, result: 'PVE_WIN' }))
  })

  it('зачёт ограничен тремя шкалами HP: лечение не кормит опыт бесконечно', () => {
    // Пример книги: H = 200, R = 1000, D = 1200 → зачёт 600 (H × 3),
    // а не 1200 пережитых HP. Равен бою, где цель пережила ровно 600.
    const capped = calcBattleExp({
      damageDealt: 1200, targetPower: 300, targetMaxHp: 200, targetHealed: 1000,
      playerLevel: 9, targetLevel: 9, result: 'PVP_WIN',
    })
    const reference = calcBattleExp({
      damageDealt: 600, targetPower: 300, targetMaxHp: 200, targetHealed: 400,
      playerLevel: 9, targetLevel: 9, result: 'PVP_WIN',
    })
    expect(capped).toBe(reference)
  })

  it('урон сверх убитой цели не засчитывается', () => {
    // D = 400 по цели с H = 200 без лечения: зачёт 200, лишние HP нельзя приписать.
    const overkill = calcBattleExp({
      damageDealt: 400, targetPower: 300, targetMaxHp: 200,
      playerLevel: 9, targetLevel: 9, result: 'PVP_WIN',
    })
    const exact = calcBattleExp({
      damageDealt: 200, targetPower: 300, targetMaxHp: 200,
      playerLevel: 9, targetLevel: 9, result: 'PVP_WIN',
    })
    expect(overkill).toBe(exact)
  })

  it('K по уровням: младший против старшего получает меньше', () => {
    const even = calcBattleExp({
      damageDealt: 100, targetPower: 150, targetMaxHp: 100,
      playerLevel: 8, targetLevel: 8, result: 'PVP_WIN',
    })
    const junior = calcBattleExp({
      damageDealt: 100, targetPower: 150, targetMaxHp: 100,
      playerLevel: 8, targetLevel: 10, result: 'PVP_WIN',
    })
    // K = 8/10 = 0,8; из-за floor по месту может срезаться копейка.
    expect(junior).toBeGreaterThan(even * 0.79)
    expect(junior).toBeLessThan(even * 0.81)
  })

  it('анти-фарм уменьшает опыт', () => {
    const base = {
      damageDealt: 100, targetPower: 150, targetMaxHp: 100,
      playerLevel: 1, targetLevel: 1, result: 'PVE_WIN' as const,
    }
    expect(calcBattleExp({ ...base, antiFarmCoeff: 0.5 }))
      .toBeLessThan(calcBattleExp({ ...base, antiFarmCoeff: 1 }))
  })

  it('результат никогда не отрицательный', () => {
    expect(calcBattleExp({ damageDealt: 0, targetPower: 0, targetMaxHp: 0, playerLevel: 1, targetLevel: 1, result: 'PVE_LOSS' })).toBeGreaterThanOrEqual(0)
    expect(calcBattleExp({ damageDealt: -100, targetPower: 20, targetMaxHp: 100, playerLevel: 1, targetLevel: 1, result: 'PVP_WIN' })).toBeGreaterThanOrEqual(0)
  })
})

describe('мощность «Ревизии 2»', () => {
  it('типовая цель уровня 1 равна 100, уровня 2 — 190,25', () => {
    expect(typicalTargetPower(1)).toBeCloseTo(100, 5)
    expect(typicalTargetPower(2)).toBeCloseTo(190.25, 5)
  })

  it('рейтинговая мощность: полсуммы уровней + навык + базовый рейтинг', () => {
    expect(calcRatingPower({
      battleLevel: 3, economicLevel: 3, productionLevel: 3,
      weaponSkillLevel: 3, baseRating: 70,
    })).toBeCloseTo(0.5 * 9 + 3 + 70, 5)
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

  it('15-й уровень — максимальный («Ревизия 2»)', () => {
    expect(getLevelFromExp(30_316_376)).toBe(15)
    expect(getLevelFromExp(62_601_345)).toBe(15)   // техническая граница 15-го из книги
    expect(getLevelFromExp(999_999_999)).toBe(15)
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
