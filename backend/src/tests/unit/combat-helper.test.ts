/** Боевой помощник: формулы удара, перехвата, уровня (правка 21.10). */
import { describe, expect, it } from 'vitest'
import {
  COMBAT_HELPER, damageHelper, expToNextLevel, helperHpMax, helperIntercepts, helperLevelFromExp, helperStrike,
  type LiveHelper,
} from '../../modules/battles/combat-helper'
import { hexNeighbours } from '../../modules/battles/grid'

const helper = (over: Partial<LiveHelper> = {}): LiveHelper => ({
  id: 'h', name: 'Рекс', level: 3, tactic: 'STANDARD', hp: 66, hpMax: 66, alive: true, damageDealt: 0, ...over,
})
const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length] }

describe('боевой помощник', () => {
  it('здоровье и опыт растут с уровнем', () => {
    expect(helperHpMax(1)).toBe(COMBAT_HELPER.hpBase + COMBAT_HELPER.hpPerLevel)
    expect(helperHpMax(5)).toBeGreaterThan(helperHpMax(4))
    expect(expToNextLevel(2)).toBe(200)
    expect(helperLevelFromExp(0)).toBe(1)
    expect(helperLevelFromExp(49)).toBe(1)
    expect(helperLevelFromExp(50)).toBe(2)
    expect(helperLevelFromExp(50 + 200)).toBe(3)
    expect(helperLevelFromExp(1e9)).toBe(COMBAT_HELPER.maxLevel)
  })

  it('промах, удар и крит; атакующая тактика бьёт сильнее защитной', () => {
    expect(helperStrike(helper(), seq(0.9))).toEqual({ hit: false, crit: false, damage: 0 })
    const attack = helperStrike(helper({ tactic: 'ATTACK' }), seq(0.1, 0.5, 0.9))
    const defensive = helperStrike(helper({ tactic: 'DEFENSIVE' }), seq(0.1, 0.5, 0.9))
    expect(attack.hit && defensive.hit).toBe(true)
    expect(attack.damage).toBeGreaterThan(defensive.damage)
    const crit = helperStrike(helper(), seq(0.1, 0.5, 0.01))
    const plain = helperStrike(helper(), seq(0.1, 0.5, 0.9))
    expect(crit.crit).toBe(true)
    expect(crit.damage).toBeGreaterThan(plain.damage)
  })

  it('перехват зависит от тактики; выбитый помощник не перехватывает', () => {
    // С 28.10 помощник — фигура на поле: принимает удар, только если вызван и стоит вплотную.
    const owner = { x: 2, y: 5 }
    const near = hexNeighbours(owner)[0]
    const onField = (over: Partial<LiveHelper> = {}) => helper({ summoned: true, position: near, ...over })
    expect(helperIntercepts(onField({ tactic: 'ATTACK' }), owner, () => 0)).toBe(false)
    expect(helperIntercepts(onField({ tactic: 'DEFENSIVE' }), owner, () => 0.3)).toBe(true)
    expect(helperIntercepts(onField({ tactic: 'STANDARD' }), owner, () => 0.3)).toBe(false)
    expect(helperIntercepts(onField({ alive: false, tactic: 'DEFENSIVE' }), owner, () => 0)).toBe(false)
    expect(helperIntercepts(undefined, owner, () => 0)).toBe(false)
    // Не вызван или стоит далеко — не перехватывает.
    expect(helperIntercepts(helper({ tactic: 'DEFENSIVE' }), owner, () => 0)).toBe(false)
    expect(helperIntercepts(onField({ tactic: 'DEFENSIVE', position: { x: 8, y: 5 } }), owner, () => 0)).toBe(false)
  })

  it('урон по помощнику: при нуле он выбывает', () => {
    const h = helper({ hp: 10 })
    damageHelper(h, 4)
    expect(h).toMatchObject({ hp: 6, alive: true })
    damageHelper(h, 30)
    expect(h).toMatchObject({ hp: 0, alive: false })
  })
})
