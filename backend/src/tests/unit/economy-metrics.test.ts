import { describe, expect, it } from 'vitest'
import { gini, isShiftReadyLagging, median, msUntilNextUtcHour } from '../../workers/economy-metrics.formulas'

describe('economy metrics helpers', () => {
  it('calculates gini for equal and unequal balances', () => {
    expect(gini([100, 100, 100])).toBeCloseTo(0)
    expect(gini([0, 0, 100])).toBeCloseTo(2 / 3)
    expect(gini([])).toBe(0)
  })

  it('calculates median for odd and even samples', () => {
    expect(median([9, 1, 5])).toBe(5)
    expect(median([10, 2, 6, 4])).toBe(5)
    expect(median([])).toBe(0)
  })

  it('alerts only when SHIFT_READY median lag exceeds 120 seconds', () => {
    expect(isShiftReadyLagging(null)).toBe(false)
    expect(isShiftReadyLagging(120)).toBe(false)
    expect(isShiftReadyLagging(120.01)).toBe(true)
  })

  it('schedules the next 03:00 UTC run', () => {
    expect(msUntilNextUtcHour(new Date('2026-08-12T02:30:00Z'), 3)).toBe(30 * 60 * 1000)
    expect(msUntilNextUtcHour(new Date('2026-08-12T03:30:00Z'), 3)).toBe(23.5 * 60 * 60 * 1000)
  })
})
