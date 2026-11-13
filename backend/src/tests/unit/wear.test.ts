import { describe, expect, it } from 'vitest'
import { rollWear, calcRepairCost } from '../../modules/stats/stats.formulas'
import { BalanceConfig } from '../../config/balance.config'
import { govCraftable } from '../../modules/work/work.formulas'

describe('износ и ремонт (№102)', () => {
  it('дробный износ списывается с вероятностью дробной части', () => {
    expect(rollWear(4, 1)).toBe(4)
    expect(rollWear(4, 0.5, () => 0.3)).toBe(4)
    expect(rollWear(4, 0.5, () => 0.7)).toBe(0)
    expect(rollWear(3, 1.5, () => 0.9)).toBe(3)
    let total = 0
    for (let i = 0; i < 2000; i++) total += rollWear(1, 0.5)
    expect(total).toBeGreaterThan(850)
    expect(total).toBeLessThan(1150)
  })
  it('по умолчанию оружие и броня теряют по 0.5 прочности', () => {
    expect(BalanceConfig.durability.weaponLossPerBattle).toBe(0.5)
    expect(BalanceConfig.durability.armorLossPerHit).toBe(0.5)
  })
  it('ремонт стоит вдвое дешевле прежнего (делитель 240)', () => {
    expect(calcRepairCost(12000, 10, 'COMMON')).toBe(500)
  })
  it('govCraftable: цех без добычи и на продаже, в том числе с окладом', () => {
    expect(govCraftable({ ownerType: 'SYSTEM', producesResourceCode: null, isForSale: true })).toBe(true)
    expect(govCraftable({ ownerType: 'SYSTEM', producesResourceCode: 'res_greens', isForSale: true })).toBe(false)
    expect(govCraftable({ ownerType: 'PRIVATE', producesResourceCode: null, isForSale: true })).toBe(false)
    expect(govCraftable({ ownerType: 'SYSTEM', producesResourceCode: null, isForSale: false })).toBe(false)
  })
})
