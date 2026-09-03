import { describe, expect, it } from 'vitest'
import { budgetAfterSwaps, normalizeTurn, STANCE_BUDGET, MAX_BLOCKS_PER_ZONE } from '../../modules/battles/zones'

const weapon = { hand: 'LEFT_HAND' as const, itemInstanceId: 'w1' }
const armor = { zone: 'CHEST' as const, itemInstanceId: 'a1' }

/**
 * Переодевание в бою — шаг F7 Этапа 4.
 *
 * Главное, что здесь проверяется, — не арифметика, а свойство боёвки:
 * нападение всегда уменьшает защиту. Переодевание тратит очки из того же
 * бюджета хода, а не заводит собственное правило.
 */
describe('бюджет хода при переодевании', () => {
  it('без переодевания бюджет стойки не меняется', () => {
    for (const stance of ['attack2', 'mixed', 'defense4'] as const) {
      expect(budgetAfterSwaps(STANCE_BUDGET[stance], {})).toEqual(STANCE_BUDGET[stance])
    }
  })

  it('смена оружия стоит один удар', () => {
    expect(budgetAfterSwaps(STANCE_BUDGET.attack2, { weapon })).toEqual({ attacks: 1, blocks: 0 })
    expect(budgetAfterSwaps(STANCE_BUDGET.mixed, { weapon })).toEqual({ attacks: 0, blocks: 2 })
  })

  it('в глухой защите очко снимается блоками, а не уходит в минус', () => {
    // Ударов там нет вовсе, поэтому очко берётся из блоков: одно очко —
    // это два блока, значит 4 → 2.
    expect(budgetAfterSwaps(STANCE_BUDGET.defense4, { weapon }))
      .toEqual({ attacks: 0, blocks: 4 - MAX_BLOCKS_PER_ZONE })
  })

  it('смена брони съедает ход целиком в любой стойке', () => {
    for (const stance of ['attack2', 'mixed', 'defense4'] as const) {
      expect(budgetAfterSwaps(STANCE_BUDGET[stance], { armor })).toEqual({ attacks: 0, blocks: 0 })
    }
  })

  it('броня перебивает оружие: оба разом всё равно стоят весь ход', () => {
    expect(budgetAfterSwaps(STANCE_BUDGET.attack2, { weapon, armor })).toEqual({ attacks: 0, blocks: 0 })
  })

  it('бюджет никогда не уходит в отрицательные значения', () => {
    expect(budgetAfterSwaps({ attacks: 0, blocks: 0 }, { weapon })).toEqual({ attacks: 0, blocks: 0 })
    expect(budgetAfterSwaps({ attacks: 0, blocks: 1 }, { weapon })).toEqual({ attacks: 0, blocks: 0 })
  })
})

describe('ход с переодеванием', () => {
  it('сменивший оружие бьёт один раз вместо двух', () => {
    const turn = normalizeTurn({
      stance: 'attack2',
      attackZones: ['HEAD', 'CHEST'],
      attackHands: ['LEFT_HAND', 'RIGHT_HAND'],
      swapWeapon: weapon,
    })
    expect(turn.attackZones).toHaveLength(1)
    expect(turn.attackHands).toHaveLength(1)
    expect(turn.swapWeapon).toEqual(weapon)
  })

  it('сменивший броню не бьёт и не блокирует вовсе', () => {
    const turn = normalizeTurn({
      stance: 'attack2',
      attackZones: ['HEAD', 'CHEST'],
      blockZones: ['HEAD', 'HEAD'],
      swapArmor: armor,
    })
    expect(turn.attackZones).toHaveLength(0)
    expect(turn.blockZones).toHaveLength(0)
    expect(turn.swapArmor).toEqual(armor)
  })

  it('нападение по-прежнему уменьшает защиту', () => {
    // Свойство, ради которого бюджет вообще существует. Переодевание не
    // должно давать способа получить и удары, и полную защиту.
    const attacking = normalizeTurn({ stance: 'attack2', swapWeapon: weapon })
    const defending = normalizeTurn({ stance: 'defense4', swapWeapon: weapon })
    expect(attacking.attackZones.length + attacking.blockZones.length)
      .toBeLessThan(STANCE_BUDGET.attack2.attacks + STANCE_BUDGET.attack2.blocks + 1)
    expect(defending.blockZones.length).toBeLessThan(STANCE_BUDGET.defense4.blocks)
  })

  it('шаг по полю и переодевание вместе оставляют ход пустым', () => {
    const turn = normalizeTurn({
      stance: 'attack2', moveTo: { x: 2, y: 3 }, swapWeapon: weapon,
    })
    expect(turn.attackZones).toHaveLength(0)
    expect(turn.blockZones).toHaveLength(0)
    expect(turn.moveTo).toEqual({ x: 2, y: 3 })
  })
})
