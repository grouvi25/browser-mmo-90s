import { describe, expect, it } from 'vitest'
import { allocatedPoints, allowedItemStats, mergeAllocations, normalizeAllocation } from '../../modules/items/item-stats.formulas'
import { applyUpgradeModifiers } from '../../modules/upgrades/upgrades.formulas'
describe('item stat budget', () => {
  it('accepts only positive integer known allocations', () => expect(normalizeAllocation({ DAMAGE: 2, ARMOR: -1, nope: 5, CRIT: 1.5 })).toEqual({ DAMAGE: 2 }))
  it('keeps weapon and armor allocations isolated', () => { expect(allowedItemStats('WEAPON')).toContain('DAMAGE'); expect(allowedItemStats('WEAPON')).not.toContain('ARMOR'); expect(allowedItemStats('ARMOR')).toContain('ARMOR') })
  it('merges base, player and upgrade points into one effect budget', () => {
    expect(mergeAllocations({ DAMAGE: 1 }, { DAMAGE: 2 }, { ACCURACY: 1 })).toEqual({ DAMAGE: 3, ACCURACY: 1 })
    expect(allocatedPoints({ DAMAGE: 3, ACCURACY: 1 })).toBe(4)
    const stats=applyUpgradeModifiers({minDamage:100,maxDamage:200,weaponAccuracy:.7,durabilityMax:100,statAllocation:{DAMAGE:1}},{DAMAGE:1},{DAMAGE:1,ACCURACY:1})
    expect(stats.minDamage).toBe(112); expect(stats.maxDamage).toBe(224); expect(stats.weaponAccuracy).toBeCloseTo(.71)
  })
})
