import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { UpgradesService } from '../../modules/upgrades/upgrades.service'
import { itemBudget } from '../../modules/items/item-stats.formulas'

// Крафт (Дима 17.11): вещь из крафта улучшается очками на раскладку (+20 за уровень)
// за ресурсы своего рецепта, на уровне N ресурсов нужно ×N.
async function fixture(leather = 10, money = 10_000) {
  const login = uid('craftupg')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money, productionLevel: 0 } })
  const resource = await testPrisma.resourceTemplate.create({ data: { code: uid('res_leather'), name: 'Кожа', category: 'PRIMARY', tier: 1, basePrice: 50, weight: 1 } })
  await testPrisma.resourceStack.create({ data: { characterId: character.id, resourceTemplateId: resource.id, amount: leather } })
  const template = await testPrisma.itemTemplate.create({ data: {
    code: uid('craft_gloves'), name: 'Перчатки', type: 'ARMOR', armorSlot: 'GLOVES', weight: 1, durabilityMax: 100,
    priceBase: 1000, itemTier: 1, sourceType: 'WORKSHOP', upgradeAllowed: true, allocationMode: 'PLAYER', statBudget: 40,
  } })
  await testPrisma.productionRecipe.create({ data: {
    code: uid('rcp_gloves'), name: 'Перчатки', productionObjectCode: 'obj_test', outputItemTemplateCode: template.code,
    cycleMinutes: 1, laborRequired: 1, requiredProfessionCode: 'cooperative_builder',
    inputs: { create: [{ resourceCode: resource.code, amount: 2 }] },
  } })
  const item = await testPrisma.itemInstance.create({ data: {
    templateId: template.id, ownerId: character.id, quality: 'COMMON', durabilityCurrent: 100, durabilityMax: 100, weight: 1,
    sourceType: 'CRAFTED', freePoints: 40,
  } })
  return { character, item, resource, template }
}

describe('Улучшение крафтовой вещи очками', () => {
  beforeAll(() => testPrisma.$connect())
  beforeEach(() => cleanDatabase())
  afterAll(() => testPrisma.$disconnect())

  it('предпросмотр: +20 очков, ресурсы своего рецепта, ничего не списывает', async () => {
    const { character, item, resource } = await fixture()
    const p = await UpgradesService.preview(character.id, item.id, 'DAMAGE')
    expect(p).toMatchObject({ mode: 'POINTS', pointsGain: 20, budgetNow: 40, budgetAfter: 60, nextTotalLevel: 1, canCommit: true })
    expect(p.requiredResources).toEqual([expect.objectContaining({ resourceCode: resource.code, amount: 2, available: 10, enough: true })])
    const stack = await testPrisma.resourceStack.findFirstOrThrow({ where: { characterId: character.id } })
    expect(stack.amount).toBe(10)
  })

  it('удача: +20 к бюджету вещи, ресурсы ×уровень, второй уровень дороже', async () => {
    const { character, item, template } = await fixture()
    const first = await UpgradesService.commit(character.id, item.id, 'DAMAGE', uid('k'), () => 0)
    expect(first).toMatchObject({ success: true, levelAfter: 1, pointsGain: 20 })
    let fresh = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id } })
    expect(fresh).toMatchObject({ upgradeLevel: 1, extraPoints: 20, freePoints: 60 })
    expect(itemBudget(template, fresh.namedLevel, fresh.extraPoints)).toBe(60)
    expect((await testPrisma.resourceStack.findFirstOrThrow({ where: { characterId: character.id } })).amount).toBe(8)
    await UpgradesService.commit(character.id, item.id, 'DAMAGE', uid('k'), () => 0)
    fresh = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id } })
    expect(fresh).toMatchObject({ upgradeLevel: 2, extraPoints: 40 })
    expect((await testPrisma.resourceStack.findFirstOrThrow({ where: { characterId: character.id } })).amount).toBe(4)
    const log = await testPrisma.upgradeLog.findFirstOrThrow({ where: { itemInstanceId: item.id }, orderBy: { createdAt: 'desc' } })
    expect(log.upgradeType).toBe('POINTS')
  })

  it('неудача: ресурсы и деньги ушли, очков нет; без ресурсов отказ без списания', async () => {
    const { character, item } = await fixture(3)
    const r = await UpgradesService.commit(character.id, item.id, 'DAMAGE', uid('k'), () => 0.99)
    expect(r.success).toBe(false)
    expect(await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ upgradeLevel: 0, extraPoints: 0 })
    const moneyAfterFail = (await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money
    expect(moneyAfterFail).toBeLessThan(10_000)
    // Осталась 1 кожа при цене 2: отказ, ничего не списано.
    await expect(UpgradesService.commit(character.id, item.id, 'DAMAGE', uid('k'), () => 0)).rejects.toMatchObject({ statusCode: 409 })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money).toBe(moneyAfterFail)
    expect((await testPrisma.resourceStack.findFirstOrThrow({ where: { characterId: character.id } })).amount).toBe(1)
  })
})
