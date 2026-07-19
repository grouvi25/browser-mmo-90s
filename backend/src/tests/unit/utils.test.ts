import { describe, it, expect } from 'vitest'
import { clamp, clamp01 } from '../../shared/utils/clamp'
import { randomInt, randomFloat, rollChance } from '../../shared/utils/random'

// ---------------------------------------------------------------
// clamp
// ---------------------------------------------------------------
describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })

  it('clamps to min', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
  })

  it('clamps to max', () => {
    expect(clamp(15, 0, 10)).toBe(10)
  })

  it('works with floats', () => {
    expect(clamp(0.6, 0, 0.75)).toBe(0.6)
    expect(clamp(0.9, 0, 0.75)).toBe(0.75)
  })
})

describe('clamp01', () => {
  it('clamps between 0 and 1', () => {
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
  })
})

// ---------------------------------------------------------------
// randomInt
// ---------------------------------------------------------------
describe('randomInt', () => {
  it('always returns integer in range', () => {
    for (let i = 0; i < 1000; i++) {
      const val = randomInt(3, 8)
      expect(val).toBeGreaterThanOrEqual(3)
      expect(val).toBeLessThanOrEqual(8)
      expect(Number.isInteger(val)).toBe(true)
    }
  })

  it('can return exactly min and max', () => {
    const values = new Set<number>()
    for (let i = 0; i < 10000; i++) {
      values.add(randomInt(0, 1))
    }
    expect(values.has(0)).toBe(true)
    expect(values.has(1)).toBe(true)
  })

  it('same min and max always returns that value', () => {
    for (let i = 0; i < 100; i++) {
      expect(randomInt(5, 5)).toBe(5)
    }
  })
})

// ---------------------------------------------------------------
// randomFloat
// ---------------------------------------------------------------
describe('randomFloat', () => {
  it('always returns float in range', () => {
    for (let i = 0; i < 1000; i++) {
      const val = randomFloat(0, 1)
      expect(val).toBeGreaterThanOrEqual(0)
      expect(val).toBeLessThan(1)
    }
  })
})

// ---------------------------------------------------------------
// rollChance
// ---------------------------------------------------------------
describe('rollChance', () => {
  it('chance=0 always returns false', () => {
    for (let i = 0; i < 100; i++) {
      expect(rollChance(0)).toBe(false)
    }
  })

  it('chance=1 always returns true', () => {
    for (let i = 0; i < 100; i++) {
      expect(rollChance(1)).toBe(true)
    }
  })

  it('0.5 chance is approximately 50% over many trials', () => {
    let trueCount = 0
    const trials = 10000
    for (let i = 0; i < trials; i++) {
      if (rollChance(0.5)) trueCount++
    }
    // Allow 5% error margin
    expect(trueCount / trials).toBeGreaterThan(0.45)
    expect(trueCount / trials).toBeLessThan(0.55)
  })
})
