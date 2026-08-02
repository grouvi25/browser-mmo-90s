import { describe, expect, it } from 'vitest'
import { assertResourceStackInvariant, availableResourceAmount, calcGovernmentResourceEcoExp, calcGovernmentResourcePayout, calcResourceWeight, canReserveResource } from '../../modules/resources/resources.formulas'

describe('stage 2 resource formulas', () => {
  it('government payout is 25% of base value rounded down', () => {
    expect(calcGovernmentResourcePayout(3, 8)).toBe(6)
    expect(calcGovernmentResourcePayout(1, 7)).toBe(1)
  })
  it('rejects invalid payout inputs', () => {
    expect(calcGovernmentResourcePayout(0, 8)).toBe(0)
    expect(calcGovernmentResourcePayout(1.5, 8)).toBe(0)
  })
  it('calculates stack weight', () => {
    expect(calcResourceWeight(4, 0.5)).toBe(2)
  })
  it('never exposes reserved resources as available', () => {
    expect(availableResourceAmount(10, 3)).toBe(7)
    expect(availableResourceAmount(2, 4)).toBe(0)
  })
  it('calculates government sell economic exp with round', () => {
    expect(calcGovernmentResourceEcoExp(10, 8)).toBe(1)
  })
  it('allows only positive integer reservations within available amount', () => {
    expect(canReserveResource(10, 3, 7)).toBe(true)
    expect(canReserveResource(10, 3, 8)).toBe(false)
    expect(canReserveResource(10, 3, 0)).toBe(false)
    expect(canReserveResource(10, 3, 1.5)).toBe(false)
  })
  it('asserts amount and reservedAmount invariants', () => {
    expect(() => assertResourceStackInvariant(10, 3)).not.toThrow()
    expect(() => assertResourceStackInvariant(2, 3)).toThrow()
    expect(() => assertResourceStackInvariant(-1, 0)).toThrow()
  })
})
