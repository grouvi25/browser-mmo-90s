import { describe, it, expect } from 'vitest'
import { artifactBonus, inPrison, validCityPath } from '../../modules/city/city.config'
import { TERRITORY_LIMIT } from '../../modules/territories/territories.formulas'
describe('city rules', () => {
  it('allows only game locations, never external redirects or auth/admin paths', () => {
    for (const path of ['/school', '/pet-shop', '/prison', '/tsum', '/berezka', '/inventory', '/']) expect(validCityPath(path)).toBe(true)
    for (const path of ['https://evil.test', '//evil.test', '/admin', '/login', '/profile', '/battle/123', '/school?x=1']) expect(validCityPath(path)).toBe(false)
  })
  it('releases automatically exactly at the end of the prison term', () => {
    const now = new Date('2026-10-11T00:00:00Z')
    expect(inPrison(null, now)).toBe(false)
    expect(inPrison(now, now)).toBe(false)
    expect(inPrison(new Date(now.getTime() + 1), now)).toBe(true)
  })
  it('clamps artifact experience bonus and ignores negative bonuses', () => {
    expect(artifactBonus([])).toBe(0)
    expect(artifactBonus([.1, .1])).toBe(.2)
    expect(artifactBonus([-1, 9, .1])).toBe(.5)
  })
  it('limits a brigade to exactly one territory', () => expect(TERRITORY_LIMIT).toBe(1))
})

describe('бонус собаки', () => {
  it('действует только у сытой собаки нового вида', async () => {
    const { withPetBonus, petStatBonus } = await import('../../modules/city/city.config')
    const now = new Date('2026-10-16T12:00:00Z')
    const fed = new Date('2026-10-17T12:00:00Z')
    const stats = { str: 3, agi: 3, end: 3, luck: 1 }
    expect(withPetBonus(stats, [{ code: 'mastiff', fedUntil: fed }], now)).toEqual({ str: 3, agi: 3, end: 5, luck: 1 })
    expect(withPetBonus(stats, [{ code: 'malinois', fedUntil: fed }], now).agi).toBe(5)
    expect(withPetBonus(stats, [{ code: 'doberman', fedUntil: fed }], now).luck).toBe(3)
    expect(petStatBonus([{ code: 'doberman', fedUntil: new Date('2026-10-16T11:00:00Z') }], now)).toEqual({})
    expect(petStatBonus([{ code: 'cat', fedUntil: fed }], now)).toEqual({})
    expect(withPetBonus(stats, undefined, now)).toEqual(stats)
  })
})
