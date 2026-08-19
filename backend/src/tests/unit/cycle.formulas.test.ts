import { describe, expect, it } from 'vitest'
import { cycleDurationMinutes, cycleReady, isQualityAtLeast, laborFromShift, outputQuality, resourceToItemQuality } from '../../modules/production/cycle.formulas'

describe('production cycle formulas', () => {
  it('converts a completed shift into labor', () => {
    expect(laborFromShift(60, 1.09)).toBe(65)
  })

  it('speeds up a cycle only for excess tool tiers', () => {
    expect(cycleDurationMinutes(60, 1, 1)).toBe(60)
    expect(cycleDurationMinutes(60, 2, 1)).toBe(52)
    expect(cycleDurationMinutes(60, 3, 1)).toBe(46)
  })

  it('requires both labor and elapsed time', () => {
    const now = new Date('2026-08-20T00:00:00Z')
    const past = new Date('2026-08-19T23:00:00Z')
    const future = new Date('2026-08-20T01:00:00Z')
    expect(cycleReady({ laborAccumulated: 59, laborRequired: 60, endsAt: past, now })).toBe(false)
    expect(cycleReady({ laborAccumulated: 60, laborRequired: 60, endsAt: future, now })).toBe(false)
    expect(cycleReady({ laborAccumulated: 60, laborRequired: 60, endsAt: past, now })).toBe(true)
  })

  it('keeps output quality ordered and bounded', () => {
    expect(outputQuality({ professionLevel: 0, toolTier: 1, requiredToolTier: 1, minInputQuality: 'POOR' })).toBe('POOR')
    expect(outputQuality({ professionLevel: 6, toolTier: 1, requiredToolTier: 1, minInputQuality: 'POOR' })).toBe('NORMAL')
    expect(isQualityAtLeast('FINE', 'NORMAL')).toBe(true)
    expect(isQualityAtLeast('POOR', 'NORMAL')).toBe(false)
    expect(resourceToItemQuality('POOR')).toBe('JUNK')
    expect(resourceToItemQuality('NORMAL')).toBe('COMMON')
    expect(resourceToItemQuality('FINE')).toBe('GOOD')
  })
})
