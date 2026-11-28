import { describe, expect, it } from 'vitest'
import { attackDamageHp, catalogPointsToHp, companionDamageHp } from '../../modules/battles/combat-hp'

describe('урон в HP', () => {
  // 27.11: «резка 0,35» убрана, атака и броня идут в HP один к одному.
  it('переводит атаку и броню в HP один к одному', () => {
    expect(catalogPointsToHp(5)).toBe(5)
    expect(catalogPointsToHp(0.5)).toBe(0.5)
    expect(attackDamageHp(100, 20, 1, 1, 1)).toBe(80)
    expect(attackDamageHp(22, 2, 1, 1, 1)).toBe(20)
    expect(attackDamageHp(181, 1, 1, 1, 1)).toBe(180)
    expect(attackDamageHp(22, 2, 0.9, 0.5, 1)).toBe(9)
  })

  it('сохраняет нулевую защиту от удара, минимальный урон и отдельную шкалу питомца', () => {
    expect(attackDamageHp(20, 20, 1, 1, 1)).toBe(0)
    expect(attackDamageHp(20, 19, 1, 0, 1)).toBe(0)
    expect(attackDamageHp(20, 19.5, 1, 0.1, 1)).toBe(1)
    // 28.11: урон питомца приходит уже × 100/35 (10 → 29), броня 1:1 — итог тот же ×2,86 (3 → 9).
    expect(companionDamageHp(29, 20)).toBe(9)
    expect(companionDamageHp(29, 30)).toBe(0)
  })
})
