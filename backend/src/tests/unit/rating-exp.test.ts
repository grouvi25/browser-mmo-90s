import { describe, it, expect } from 'vitest'
import { calcBattleExp, ratingExpCoeff } from '../../modules/stats/stats.formulas'

// №114 (Amadeus 14.11): сильнее цели — меньше опыта, слабее — больше, 0.5..1.5.
describe('опыт от рейтинга', () => {
  it('коэффициент в пределах', () => {
    expect(ratingExpCoeff(100, 100)).toBe(1)
    expect(ratingExpCoeff(200, 100)).toBe(0.5)
    expect(ratingExpCoeff(400, 100)).toBe(0.5)
    expect(ratingExpCoeff(100, 120)).toBeCloseTo(1.2)
    expect(ratingExpCoeff(100, 400)).toBe(1.5)
    expect(ratingExpCoeff(0, 100)).toBe(1)
  })
  it('опыт умножается на коэффициент', () => {
    const base = { damageDealt: 100, targetPower: 200, targetMaxHp: 100, playerLevel: 5, targetLevel: 5, result: 'PVP_WIN' as const }
    const plain = calcBattleExp(base)
    expect(calcBattleExp({ ...base, ratingCoeff: 0.5 })).toBe(Math.floor(plain * 0.5))
    expect(calcBattleExp({ ...base, ratingCoeff: 1.5 })).toBeGreaterThan(plain)
  })
})
