/**
 * Рейтинг персонажа — книга заказчика 23.10, лист «Рейтинг»:
 * базовые характеристики с весами + надетые вещи (оружие и броня,
 * с учётом улучшений и вложенных очков). Авторитет не входит.
 */
import { describe, it, expect } from 'vitest'
import { calcBaseRating, calcCharacterRating, calcEquippedItemRating, RATING_WEIGHTS } from '../../modules/stats/stats.formulas'

const stats = { str: 10, agi: 10, rea: 10, acc: 10, end: 10, luck: 10, agr: 10 }

const tpl = (over: Partial<Parameters<typeof calcEquippedItemRating>[0]['template']> = {}) => ({
  type: 'WEAPON', minDamage: 10, maxDamage: 10, armor: null, durabilityMax: 100, ...over,
})

describe('calcBaseRating', () => {
  it('веса: сила 2, выносливость 2, ловкость/реакция/точность 1,5, удача и агрессия 1', () => {
    expect(calcBaseRating(stats)).toBe(10 * (2 + 2 + 1.5 + 1.5 + 1.5 + 1 + 1))
    expect(RATING_WEIGHTS.str).toBe(2)
    expect(RATING_WEIGHTS.end).toBe(2)
    expect(RATING_WEIGHTS.luck).toBe(1)
  })

  it('нулевые статы дают ноль, а не NaN', () => {
    expect(calcBaseRating({ str: 0, agi: 0, rea: 0, acc: 0, end: 0, luck: 0, agr: 0 })).toBe(0)
  })
})

describe('calcEquippedItemRating', () => {
  it('оружие: 2 × средний урон', () => {
    expect(calcEquippedItemRating({ template: tpl({ minDamage: 8, maxDamage: 12 }) })).toBe(20)
  })

  it('броня: 1,5 × защита', () => {
    expect(calcEquippedItemRating({ template: tpl({ type: 'ARMOR', minDamage: null, maxDamage: null, armor: 10 }) })).toBe(15)
  })

  it('щит считается бронёй, прочее (расходники, ресурсы) — ноль', () => {
    expect(calcEquippedItemRating({ template: tpl({ type: 'SHIELD', minDamage: null, maxDamage: null, armor: 4 }) })).toBe(6)
    expect(calcEquippedItemRating({ template: tpl({ type: 'CONSUMABLE' }) })).toBe(0)
  })

  it('улучшения и вложенные очки усиливают вклад вещи', () => {
    const plain = calcEquippedItemRating({ template: tpl({ minDamage: 10, maxDamage: 20 }) })
    const upgraded = calcEquippedItemRating({
      template: tpl({ minDamage: 10, maxDamage: 20 }),
      upgradeModifiersJson: { DAMAGE: 5 },
    })
    expect(upgraded).toBeGreaterThan(plain)
  })
})

describe('calcCharacterRating', () => {
  it('база + надетое, округление до десятых', () => {
    const base = calcBaseRating(stats) // 100
    const withGear = calcCharacterRating(stats, [
      { template: tpl({ minDamage: 8, maxDamage: 12 }) },       // 20
      { template: tpl({ type: 'ARMOR', minDamage: null, maxDamage: null, armor: 10 }) }, // 15
    ])
    expect(withGear).toBe(base + 35)
  })

  it('без вещей рейтинг равен базовому', () => {
    expect(calcCharacterRating(stats, [])).toBe(calcBaseRating(stats))
  })
})
