import { describe, expect, it } from 'vitest'
import { objectRepairQuote, objectResalePayout, objectSalaryRange, objectWithdrawTax, profileSwitchEndsAt } from '../../modules/production/ownership.formulas'

describe('object ownership formulas', () => {
  it('charges five percent on profit withdrawal', () => {
    expect(objectWithdrawTax(1000)).toBe(50)
    expect(objectWithdrawTax(99)).toBe(4)
  })

  it('keeps salary between half and double base salary', () => {
    expect(objectSalaryRange(160)).toEqual({ min: 80, max: 320 })
  })

  it('resells an object to the state for half price', () => {
    expect(objectResalePayout(55000)).toBe(27500)
  })
  it('quotes repair in money and whole repair kits', () => {
    expect(objectRepairQuote(49, 100)).toEqual({ durability: 51, kits: 3, cost: 1020 })
    expect(objectRepairQuote(100, 100)).toEqual({ durability: 0, kits: 0, cost: 0 })
  })

  it('switches profile after three hours', () => {
    const now = new Date('2026-08-20T00:00:00.000Z')
    expect(profileSwitchEndsAt(now).toISOString()).toBe('2026-08-20T03:00:00.000Z')
  })
})
