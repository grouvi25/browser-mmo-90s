import { describe, expect, it } from 'vitest'
import { adjacentSlots, applyBuildingBonuses, harvestAmount, initialFarmTimers, plotPrice, wateredReadyAt } from '../../modules/farm/farm.formulas'

describe('farm formulas', () => {
  it('prices all twelve plots to 96000 total', () => {
    expect(Array.from({ length: 12 }, (_, index) => plotPrice(index + 1)).reduce((a, b) => a + b, 0)).toBe(96000)
  })

  it('uses crop growth time and profession wither grace', () => {
    const now = new Date('2026-08-20T00:00:00Z')
    const timers = initialFarmTimers('hops', 2, now)
    expect(timers.readyAt.toISOString()).toBe('2026-08-20T01:30:00.000Z')
    expect(timers.withersAt.toISOString()).toBe('2026-08-20T09:30:00.000Z')
  })

  it('watering cuts ten percent from remaining time', () => {
    const now = new Date('2026-08-20T00:00:00Z')
    expect(wateredReadyAt(new Date('2026-08-20T01:40:00Z'), now).toISOString()).toBe('2026-08-20T01:30:00.000Z')
  })

  it('keeps harvest inside configured range', () => {
    expect(harvestAmount('potato', 0)).toBe(3)
    expect(harvestAmount('potato', 0.999)).toBe(5)
  })
  it('applies barrel and canopy only to horizontal neighbours', () => {
    expect(adjacentSlots(4)).toEqual([3])
    expect(adjacentSlots(5)).toEqual([6])
    const now = new Date('2026-08-20T00:00:00Z')
    const result = applyBuildingBonuses(new Date('2026-08-20T01:40:00Z'), now, true, true)
    expect(result.readyAt.toISOString()).toBe('2026-08-20T01:21:00.000Z')
    expect(result.waterCount).toBe(1)
  })
})
