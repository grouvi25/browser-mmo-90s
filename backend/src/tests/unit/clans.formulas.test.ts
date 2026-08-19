import { describe, expect, it } from 'vitest'
import { clanMemberCapacity, clanStorageCapacity, relationPriceMultiplier, storageWithdrawDailyLimit, treasurySpendDailyLimit } from '../../modules/clans/clans.formulas'
import { marketPriceForRelation } from '../../modules/clans/clans-market'

describe('clan formulas', () => {
  it('scales member and storage capacity by clan level', () => {
    expect(clanMemberCapacity(0)).toBe(10)
    expect(clanMemberCapacity(3)).toBe(25)
    expect(clanStorageCapacity(0)).toBe(30)
    expect(clanStorageCapacity(3)).toBe(75)
  })

  it('applies role daily limits', () => {
    expect(storageWithdrawDailyLimit('brigadier')).toBe(10)
    expect(storageWithdrawDailyLimit('fighter')).toBe(3)
    expect(storageWithdrawDailyLimit('infantry')).toBe(0)
    expect(treasurySpendDailyLimit('brigadier')).toBe(20000)
    expect(treasurySpendDailyLimit('fighter')).toBe(0)
  })

  it('prices market listings by relationship', () => {
    expect(relationPriceMultiplier('SELF')).toBe(0.9)
    expect(marketPriceForRelation(1000, 'SELF')).toBe(900)
    expect(marketPriceForRelation(1000, 'ALLY')).toBe(950)
    expect(marketPriceForRelation(1000, 'NEUTRAL')).toBe(1000)
    expect(marketPriceForRelation(1000, 'ENEMY')).toBe(1250)
  })
})
