import { describe, expect, it } from 'vitest'
import { priceRatio, suspiciousPriceReason } from '../../modules/market/market-abuse.formulas'

describe('market abuse price detector', () => {
  it('flags prices below 20% and above 500% of reference', () => {
    expect(suspiciousPriceReason(19, 100)).toBe('PRICE_TOO_LOW')
    expect(suspiciousPriceReason(501, 100)).toBe('PRICE_TOO_HIGH')
  })

  it('accepts prices inside the configured corridor', () => {
    expect(suspiciousPriceReason(20, 100)).toBeNull()
    expect(suspiciousPriceReason(500, 100)).toBeNull()
    expect(priceRatio(250, 100)).toBe(2.5)
  })
})
