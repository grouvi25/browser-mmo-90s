import { describe, expect, it } from 'vitest'
import { objectResalePayout, objectSalaryRange, objectWithdrawTax } from '../../modules/production/ownership.formulas'

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
})
