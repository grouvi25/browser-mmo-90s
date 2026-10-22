import { describe, expect, it } from 'vitest'
import { heldWeapon, isDisarmed, isStripped, registerWound, woundedArmor, woundedBotEquip, woundsOf, type Wounds } from '../../modules/battles/wounds'

describe('Раны по зонам', () => {
  it('зелёный → жёлтый → оранжевый → красный: третье попадание снимает вещь', () => {
    const part: { wounds?: Wounds } = {}
    expect(registerWound(part, 'HEAD', 5)).toBeNull()
    expect(woundsOf(part, 'HEAD')).toBe(1)
    expect(registerWound(part, 'HEAD', 5)).toBeNull()
    expect(isStripped(part, 'HEAD')).toBe(false)
    expect(registerWound(part, 'HEAD', 5)).toBe('броня на голове сбита')
    expect(isStripped(part, 'HEAD')).toBe(true)
    // Дальше зона красная и строку о снятии второй раз не пишет.
    expect(registerWound(part, 'HEAD', 5)).toBeNull()
    expect(woundsOf(part, 'HEAD')).toBe(3)
  })

  it('удар без урона раной не считается', () => {
    const part: { wounds?: Wounds } = {}
    expect(registerWound(part, 'CHEST', 0)).toBeNull()
    expect(woundsOf(part, 'CHEST')).toBe(0)
  })

  it('третье попадание в руку выбивает оружие из этой руки', () => {
    const part: { wounds?: Wounds } = {}
    registerWound(part, 'RIGHT_ARM', 3)
    registerWound(part, 'RIGHT_ARM', 3)
    expect(registerWound(part, 'RIGHT_ARM', 3)).toBe('оружие выбито из правой руки')
    expect(isDisarmed(part, 'RIGHT_HAND')).toBe(true)
    expect(isDisarmed(part, 'LEFT_HAND')).toBe(false)
    expect(heldWeapon(part, 'RIGHT_HAND', { id: 'knife' })).toBeNull()
    expect(heldWeapon(part, 'LEFT_HAND', { id: 'bat' })).toEqual({ id: 'bat' })
  })

  it('сбитая броня зону больше не прикрывает', () => {
    const part: Wounds = { LEFT_LEG: 3 }
    const armor = woundedArmor({ wounds: part }, () => 7)
    expect(armor('LEFT_LEG')).toBe(0)
    expect(armor('RIGHT_LEG')).toBe(7)
    // Старая общая зона ног считается левой.
    expect(armor('LEGS')).toBe(0)
  })

  it('у бота выбитое оружие пропадает из снаряжения, броня остаётся', () => {
    const equip = { weapon: { minDamage: 9 }, armor: { HEAD: 3 } }
    expect(woundedBotEquip({}, equip)).toBe(equip)
    expect(woundedBotEquip({ wounds: { LEFT_ARM: 3 } }, equip)).toEqual({ armor: { HEAD: 3 } })
  })
})
