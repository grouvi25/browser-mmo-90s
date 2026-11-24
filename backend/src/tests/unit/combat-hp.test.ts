import { describe, expect, it } from 'vitest'
import { attackDamageHp, catalogPointsToHp, companionDamageHp } from '../../modules/battles/combat-hp'

describe('урон в HP', () => {
  it('переводит атаку и броню в одну шкалу без потери целого HP', () => {
    expect(catalogPointsToHp(5)).toBe(1.75)
    expect(catalogPointsToHp(0.5)).toBe(0.175)
    expect(attackDamageHp(100, 20, 1, 1, 1)).toBe(28)
    expect(attackDamageHp(22, 2, 1, 1, 1)).toBe(7)
    expect(attackDamageHp(181, 1, 1, 1, 1)).toBe(63)
    expect(attackDamageHp(22, 2, 0.9, 0.5, 1)).toBe(3)
  })

  it('сохраняет нулевую защиту от удара, минимальный урон и отдельную шкалу питомца', () => {
    expect(attackDamageHp(20, 20, 1, 1, 1)).toBe(0)
    expect(attackDamageHp(20, 19, 1, 0, 1)).toBe(0)
    expect(attackDamageHp(20, 19.5, 1, 0.1, 1)).toBe(1)
    expect(companionDamageHp(10, 20)).toBe(3)
    expect(companionDamageHp(10, 30)).toBe(0)
  })
})
