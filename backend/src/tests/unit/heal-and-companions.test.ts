/**
 * Решения заказчика 4.11: аптечки лечат процентом, опыт идёт и за урон питомцев,
 * питомец не закрывает выстрел. Зачёт опыта ограничен здоровьем цели, поэтому
 * питомцы не дают больше опыта, чем то же убийство руками самого игрока.
 */
import { describe, expect, it } from 'vitest'
import { calcBattleExp } from '../../modules/stats/stats.formulas'
import { companionDamage } from '../../modules/battles/companions'
import { canAttackTarget, hasLineOfSight } from '../../modules/battles/grid'
import { healAmount } from '../../modules/items/gear-bonuses'

describe('Лечение', () => {
  it('процент важнее единиц и считается от максимума', () => {
    expect(healAmount({ healPercent: 25, hpBonus: 50 }, 200)).toBe(50)
    expect(healAmount({ healPercent: 100, hpBonus: 0 }, 92)).toBe(92)
    expect(healAmount({ healPercent: 10 }, 83)).toBe(9)
  })
  it('без процента работает старое число, без обоих лечить нечем', () => {
    expect(healAmount({ healPercent: 0, hpBonus: 30 }, 200)).toBe(30)
    expect(healAmount({ hpBonus: null }, 200)).toBe(0)
  })
})

describe('Опыт за питомцев', () => {
  const exp = (damageDealt: number) => calcBattleExp({
    damageDealt, targetPower: 100, targetMaxHp: 100, targetHealed: 0, playerLevel: 5, targetLevel: 5, result: 'PVE_WIN', antiFarmCoeff: 1,
  })
  it('складывает урон помощника и собаки', () => {
    expect(companionDamage({ helper: { damageDealt: 40 }, dog: { damageDealt: 15 } })).toBe(55)
    expect(companionDamage({})).toBe(0)
  })
  it('бой без своего урона, выигранный питомцами, даёт опыт', () => {
    expect(exp(0 + companionDamage({ helper: { damageDealt: 100 } }))).toBeGreaterThan(0)
    expect(exp(0)).toBe(0)
  })
  it('питомцы не дают больше опыта, чем убийство той же цели самим игроком', () => {
    expect(exp(100 + companionDamage({ helper: { damageDealt: 100 }, dog: { damageDealt: 100 } }))).toBe(exp(100))
  })
})

describe('Выстрел мимо питомцев', () => {
  const shooter = { participantId: 'a', side: 1, isAlive: true, position: { x: 1, y: 3 } }
  const target = { participantId: 'b', side: 2, isAlive: true, position: { x: 5, y: 3 } }
  const between = (participantId: string, side: number) => ({ participantId, side, isAlive: true, position: { x: 3, y: 3 } })

  it('свой и чужой питомец на линии не закрывают цель', () => {
    for (const pet of [between('helper:a', 1), between('dog:a', 1), between('helper:b', 2), between('dog:b', 2)]) {
      expect(hasLineOfSight(shooter.position, target.position, [shooter, target, pet], 'a', 'b')).toBe(true)
      expect(canAttackTarget(shooter, target, [shooter, target, pet], 5)).toBe(true)
    }
  })
  it('боец и бочка на линии закрывают, как раньше', () => {
    expect(hasLineOfSight(shooter.position, target.position, [shooter, target, between('c', 1)], 'a', 'b')).toBe(false)
    expect(hasLineOfSight(shooter.position, target.position, [shooter, target, between('obstacle:0', 0)], 'a', 'b')).toBe(false)
  })
})
