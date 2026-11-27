import { describe, expect, it } from 'vitest'
import { gearKind, gearRecipeFor, gearRecipePlan, type GearTemplate } from '../../../prisma/economy-table'

const t = (over: Partial<GearTemplate>): GearTemplate => ({
  code: 'x', name: 'Вещь', type: 'ARMOR', weaponType: null, armorSlot: 'CHEST', levelReq: 1, sourceType: 'GOVERNMENT', isActive: true, ...over,
})

describe('рецепты шмота по схеме (№190)', () => {
  it('вид — по типу оружия и слоту', () => {
    expect(gearKind(t({ type: 'WEAPON', weaponType: 'CLUB', armorSlot: null }))).toBe('blade')
    expect(gearKind(t({ type: 'WEAPON', weaponType: 'SHOTGUN', armorSlot: null }))).toBe('long_gun')
    expect(gearKind(t({ type: 'ACCESSORY', armorSlot: 'RING' }))).toBe('ring')
    expect(gearKind(t({ type: 'ACCESSORY', armorSlot: 'ACCESSORY' }))).toBe('amulet')
    expect(gearKind(t({ type: 'SHIELD', armorSlot: 'RIGHT_HAND' }))).toBeNull()
  })
  it('уровень задаёт детали и труд; выше 5 уровня, донат и премиум — без рецепта', () => {
    const l1 = gearRecipeFor(t({ code: 'jacket', levelReq: 1 }))!
    const l5 = gearRecipeFor(t({ code: 'vest', levelReq: 5 }))!
    expect(l1).toMatchObject({ code: 'rcp_gear_jacket', object: 'obj_tb_armor_shop', level: 1, minutes: 300 })
    expect(l1.inputs).toEqual([['tb_cloth', 1], ['tb_leather', 1], ['tb_hardware', 1]])
    expect(l5.inputs).toEqual([['tb_cloth', 3], ['tb_leather', 3], ['tb_hardware', 3]])
    expect(l5.minutes).toBe(900)
    expect(gearRecipeFor(t({ levelReq: 0 }))!.level).toBe(1)
    expect(gearRecipeFor(t({ levelReq: 6 }))).toBeNull()
    expect(gearRecipeFor(t({ sourceType: 'PREMIUM' }))).toBeNull()
    expect(gearRecipeFor(t({ sourceType: 'DONATE' }))).toBeNull()
    expect(gearRecipeFor(t({ isActive: false }))).toBeNull()
  })
  it('вещь с рецептом в план не попадает', () => {
    const plan = gearRecipePlan([t({ code: 'a' }), t({ code: 'b' })], new Set(['a']))
    expect(plan.map(p => p.item)).toEqual(['b'])
  })
})
