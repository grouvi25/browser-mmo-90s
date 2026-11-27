import { describe, expect, it } from 'vitest'
import { craftUpgradeCost } from '../../modules/upgrades/upgrades.formulas'

describe('цена улучшения крафтовой вещи (№195)', () => {
  it('зависит только от уровня вещи и номера улучшения', () => {
    expect(craftUpgradeCost(1, 1)).toEqual({ money: 150, resources: [{ code: 'tb_hardware', amount: 1 }, { code: 'tb_steel_blank', amount: 1 }] })
    expect(craftUpgradeCost(1, 2).money).toBe(396)
    expect(craftUpgradeCost(5, 1)).toEqual({ money: 750, resources: [{ code: 'tb_hardware', amount: 5 }, { code: 'tb_steel_blank', amount: 1 }] })
    expect(craftUpgradeCost(5, 5).resources).toEqual([{ code: 'tb_hardware', amount: 9 }, { code: 'tb_steel_blank', amount: 5 }])
  })
  it('уровень 0 считается первым, номер растёт — цена растёт', () => {
    expect(craftUpgradeCost(0, 1)).toEqual(craftUpgradeCost(1, 1))
    for (let n = 1; n < 5; n++) expect(craftUpgradeCost(3, n + 1).money).toBeGreaterThan(craftUpgradeCost(3, n).money)
  })
})
