/**
 * Что надетое добавляет персонажу (правка заказчика 26.10): характеристики
 * и обереги со всего надетого, в плюс и в минус.
 */
import { describe, expect, it } from 'vitest'
import { charmBalance, gearOf, normalizeStatBonuses, withGearStats } from '../../modules/items/gear-bonuses'

const item = (id: string, template: Record<string, unknown>, durabilityCurrent = 100) => ({ id, durabilityCurrent, template })

describe('прибавки от надетого', () => {
  it('складывает характеристики и обереги со всех вещей; минус-оберег копится отдельно', () => {
    const gear = gearOf([
      item('ring', { type: 'ACCESSORY', statBonuses: { str: 2, luck: 1 }, antiDodge: 0.1, antiCrit: 0.05 }),
      item('knife', { type: 'WEAPON', statBonuses: { acc: 3 }, antiDodge: -0.04, antiCounter: 0.2 }),
      item('vest', { type: 'ARMOR', statBonuses: { end: 4, agi: -1 }, antiLuck: 0.15, hpBonus: 20 }),
    ])
    expect(gear.stats).toEqual({ str: 2, end: 4, luck: 1, agi: -1, acc: 3, agr: 0 })
    // Минус на ноже не уменьшает свой оберег уворота — он против противника.
    expect(gear.antiDodge).toBeCloseTo(0.1)
    expect(gear.minus.antiDodge).toBeCloseTo(0.04)
    expect(gear.antiLuck).toBeCloseTo(0.15)
    expect(gear.antiCrit).toBeCloseTo(0.05)
    expect(gear.antiCounter).toBeCloseTo(0.2)
    expect(gear.hp).toBe(20)
  })

  it('одна вещь дважды (оружие в двух руках списком) считается один раз; сломанная и расходник — ничего', () => {
    const knife = item('knife', { type: 'WEAPON', statBonuses: { str: 2 } })
    const gear = gearOf([knife, knife, item('broken', { type: 'ARMOR', statBonuses: { end: 5 } }, 0), item('aid', { type: 'CONSUMABLE', hpBonus: 50 }), null])
    expect(gear.stats.str).toBe(2)
    expect(gear.stats.end).toBe(0)
    expect(gear.hp).toBe(0)
  })

  // Правило «5 королей»/«Апехи»: «баланс оберегов складывается из
  // положительного оберега одного персонажа и отрицательного оберега второго».
  it('в бою оберег = свой плюс − минус противника, не ниже нуля', () => {
    const mine = gearOf([item('amulet', { type: 'ACCESSORY', antiDodge: 0.3 })])
    const theirs = gearOf([item('knife', { type: 'WEAPON', antiDodge: -0.2 })])
    expect(charmBalance(mine.antiDodge, theirs.minus.antiDodge)).toBeCloseTo(0.1)
    expect(charmBalance(mine.antiDodge, 2)).toBe(0)
    expect(charmBalance(0, theirs.minus.antiDodge)).toBe(0)
  })

  it('чужие ключи и дроби в прибавках отбрасываются, предел ±50', () => {
    expect(normalizeStatBonuses({ str: 3, rea: 2, acc: 1.5, end: 999, agr: -999 })).toEqual({ str: 3, end: 50, agr: -50 })
    expect(normalizeStatBonuses('мусор')).toEqual({})
  })

  it('характеристики персонажа с прибавками не уходят ниже нуля', () => {
    const gear = gearOf([item('cursed', { type: 'ARMOR', statBonuses: { agi: -10, str: 3 } })])
    expect(withGearStats({ str: 5, agi: 4, rea: 2 }, gear)).toEqual({ str: 8, agi: 0, rea: 2 })
  })
})
