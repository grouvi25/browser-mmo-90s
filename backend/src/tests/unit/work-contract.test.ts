import { describe, expect, it } from 'vitest'
import { effectText, extraShiftsNow, nextShiftDay, parseUseEffect, withAppliedEffect } from '../../modules/items/item-effects'

// Юрист 18.11: договор подряда даёт смену сверх суточного потолка до 3:00 по Москве.
describe('договор подряда', () => {
  const contract = { code: 'tb_item_d01', name: 'Договор подряда' }

  it('эффект читается и описывается', () => {
    const effect = parseUseEffect({ extraShifts: 1 })
    expect(effect).toEqual({ extraShifts: 1 })
    expect(effectText(effect!)).toBe('+1 смена сегодня, до 3:00 по Москве')
  })

  it('действует до 3:00 по Москве (полночь UTC) и прибавляет смену', () => {
    const now = new Date('2026-11-18T15:00:00Z') // 18:00 МСК
    const effects = withAppliedEffect([], contract, { extraShifts: 1 }, now)
    expect(effects).toHaveLength(1)
    expect(effects[0].expiresAt).toBe('2026-11-19T00:00:00.000Z')
    expect(extraShiftsNow(effects, now)).toBe(1)
    expect(extraShiftsNow(effects, new Date('2026-11-19T00:00:01Z'))).toBe(0)
  })

  it('ночью после полуночи по Москве договор живёт до ближайших 3:00', () => {
    const now = new Date('2026-11-18T22:30:00Z') // 1:30 МСК 19.11
    expect(nextShiftDay(now).toISOString()).toBe('2026-11-19T00:00:00.000Z')
  })

  it('пустой эффект договором не считается', () => {
    expect(parseUseEffect({ extraShifts: 0 })).toBeNull()
  })
})
