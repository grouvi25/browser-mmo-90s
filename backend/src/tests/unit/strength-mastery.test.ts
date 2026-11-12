/**
 * Сила и мастерство (Дима 11.11, обращение №87): сила работает целиком с 250%
 * мастерства, ниже — с шансом мастерство/250%, иначе считается как 5…10.
 * Двуручное оружие держат обеими руками.
 */
import { describe, expect, it } from 'vitest'
import { calcRawDamage, effectiveStrength } from '../../modules/battles/battle.formulas'
import { isTwoHanded } from '../../modules/items/hands'

const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length] }

describe('сила и мастерство', () => {
  it('250% и выше — сила целиком всегда', () => {
    expect(effectiveStrength(1000, 2.5, () => 0.99)).toBe(1000)
    expect(effectiveStrength(1000, 3, () => 0.99)).toBe(1000)
  })

  it('без мастерства сила 5…10, сколько бы её ни было', () => {
    expect(effectiveStrength(1000, 0, () => 0)).toBe(5)
    expect(effectiveStrength(1000, 0, () => 0.999)).toBe(10)
  })

  it('70% мастерства — сила целиком в 28% ударов, иначе 5…10', () => {
    expect(effectiveStrength(1000, 0.7, seq(0.27))).toBe(1000)
    expect(effectiveStrength(1000, 0.7, seq(0.29, 0.5))).toBe(8)
  })

  it('малая сила не растёт до 5…10, у ботов мастерства нет — сила целиком', () => {
    expect(effectiveStrength(3, 0, () => 0.9)).toBe(3)
    expect(effectiveStrength(1000, undefined, () => 0.9)).toBe(1000)
  })

  it('удар без мастерства бьёт силой 5…10, с 250% — всей силой', () => {
    const base = { str: 100, minDamage: 10, maxDamage: 10, weaponSkillLevel: 0, flatDamageBonus: 0, outgoingDamageMultiplier: 1 }
    const weak = calcRawDamage({ ...base, strMastery: 0 }, 0, () => 0)
    const full = calcRawDamage({ ...base, strMastery: 2.5 }, 0, () => 0)
    expect(full - weak).toBeCloseTo((100 - 5) * 1.5)
  })
})

describe('двуручное оружие', () => {
  it('автомат двуручный, пистолет и обрез — нет', () => {
    expect(isTwoHanded({ type: 'WEAPON', weaponType: 'RIFLE' })).toBe(true)
    expect(isTwoHanded({ type: 'WEAPON', weaponType: 'PISTOL' })).toBe(false)
    expect(isTwoHanded({ type: 'WEAPON', weaponType: 'SHOTGUN' })).toBe(false)
    expect(isTwoHanded({ type: 'SHIELD', weaponType: null })).toBe(false)
  })
})

describe('меткость стрелкового №95', () => {
  const atk = (o: Record<string, number> = {}) => ({ acc: 3, agi: 300, antiDodgeBonus: 0, weaponAccuracy: 0.7, ...o })
  const def = { agi: 1, dodgeBonus: 0 }
  it('ловкости много, антиметкости нет — попадает всегда', async () => {
    const { calcHitChance } = await import('../../modules/battles/battle.formulas')
    expect(calcHitChance(atk({ rangedAccEdge: 1.5 }), def)).toBe(1)
    expect(calcHitChance(atk({ rangedAccEdge: 0 }), def)).toBe(1)
  })
  it('антиметкость на 250% больше меткости — из стрелкового не попасть', async () => {
    const { calcHitChance } = await import('../../modules/battles/battle.formulas')
    expect(calcHitChance(atk({ rangedAccEdge: -10 }), def)).toBe(0)
    expect(calcHitChance(atk({ rangedAccEdge: -1.25 }), def)).toBeCloseTo(0.5)
  })
  it('рукопашка антиметкость не замечает', async () => {
    const { calcHitChance } = await import('../../modules/battles/battle.formulas')
    expect(calcHitChance(atk(), def)).toBe(1)
  })
})
