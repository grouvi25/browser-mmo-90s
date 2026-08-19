import { describe, expect, it } from 'vitest'
import { barPriceRange, barSaleSplit, canTakeBuff, decayedAlcohol, intoxicationModifiers } from '../../modules/bars/bars.formulas'

describe('bars and intoxication formulas', () => {
  it('sobers completely in three hours from 100 degrees', () => {
    const then = new Date('2026-08-20T00:00:00Z')
    expect(decayedAlcohol(100, then, new Date('2026-08-20T01:30:00Z'))).toBe(50)
    expect(decayedAlcohol(100, then, new Date('2026-08-20T03:00:00Z'))).toBe(0)
  })

  it('uses the exact four intoxication bands', () => {
    expect(intoxicationModifiers(0).state).toBe('SOBER')
    expect(intoxicationModifiers(1)).toMatchObject({ state: 'TIPSY', accuracy: -0.01, incomingDamage: -0.02, outgoingDamage: 0.02, canBattle: true })
    expect(intoxicationModifiers(30)).toMatchObject({ state: 'DRUNK', accuracy: -0.02, incomingDamage: -0.04 })
    expect(intoxicationModifiers(70)).toMatchObject({ state: 'WASTED', accuracy: -0.04, incomingDamage: -0.06, canBattle: false })
  })

  it('keeps owner prices between cost and triple cost', () => {
    expect(barPriceRange(110)).toEqual({ min: 110, max: 330 })
  })

  it('takes twenty percent tax from every sale', () => {
    expect(barSaleSplit(101)).toEqual({ tax: 20, ownerIncome: 81 })
  })

  it('allows a new buff every twelve hours', () => {
    const then = new Date('2026-08-20T00:00:00Z')
    expect(canTakeBuff(then, new Date('2026-08-20T11:59:59Z'))).toBe(false)
    expect(canTakeBuff(then, new Date('2026-08-20T12:00:00Z'))).toBe(true)
  })
})
