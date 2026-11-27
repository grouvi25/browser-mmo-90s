import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { UpgradesService } from '../../modules/upgrades/upgrades.service'
import { itemBudget } from '../../modules/items/item-stats.formulas'

// Крафт (Дима 17.11): вещь из крафта улучшается очками на раскладку (+20 за уровень).
// №195 (Миша 26.11): цена — одна формула от уровня вещи L и номера улучшения n,
// одинаково для всех вещей уровня: фурнитура L+n−1, стальная заготовка n, деньги
// 150 × L × n^1,4. Рецепт вещи на цену больше не влияет.
const HARDWARE = 'tb_hardware'
const STEEL = 'tb_steel_blank'

async function resource(code: string, name: string) {
  return testPrisma.resourceTemplate.upsert({
    where: { code }, update: {},
    create: { code, name, category: 'COMPONENT', tier: 2, basePrice: 100, weight: 1 },
  })
}

async function craftedItem(characterId: string, opts: { levelReq?: number; priceBase?: number; recipeAmount?: number } = {}) {
  const template = await testPrisma.itemTemplate.create({ data: {
    code: uid('craft_gloves'), name: 'Перчатки', type: 'ARMOR', armorSlot: 'GLOVES', weight: 1, durabilityMax: 100,
    priceBase: opts.priceBase ?? 1000, levelReq: opts.levelReq ?? 1, itemTier: 1, sourceType: 'WORKSHOP', upgradeAllowed: true, allocationMode: 'PLAYER', statBudget: 40,
  } })
  // Рецепт есть, но цену улучшения он больше не задаёт.
  await testPrisma.productionRecipe.create({ data: {
    code: uid('rcp_gloves'), name: 'Перчатки', productionObjectCode: 'obj_test', outputItemTemplateCode: template.code,
    cycleMinutes: 1, laborRequired: 1, requiredProfessionCode: 'cooperative_builder',
    inputs: { create: [{ resourceCode: HARDWARE, amount: opts.recipeAmount ?? 7 }] },
  } })
  const item = await testPrisma.itemInstance.create({ data: {
    templateId: template.id, ownerId: characterId, quality: 'COMMON', durabilityCurrent: 100, durabilityMax: 100, weight: 1,
    sourceType: 'CRAFTED', freePoints: 40,
  } })
  return { template, item }
}

async function fixture(hardware = 10, steel = 10, money = 10_000) {
  const login = uid('craftupg')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money, productionLevel: 0 } })
  const h = await resource(HARDWARE, 'Фурнитура')
  const s = await resource(STEEL, 'Стальная заготовка')
  await testPrisma.resourceStack.create({ data: { characterId: character.id, resourceTemplateId: h.id, amount: hardware } })
  await testPrisma.resourceStack.create({ data: { characterId: character.id, resourceTemplateId: s.id, amount: steel } })
  const { template, item } = await craftedItem(character.id)
  const stock = async () => {
    const stacks = await testPrisma.resourceStack.findMany({ where: { characterId: character.id } })
    return { hardware: stacks.find(x => x.resourceTemplateId === h.id)?.amount, steel: stacks.find(x => x.resourceTemplateId === s.id)?.amount }
  }
  return { character, item, template, stock }
}

describe('Улучшение крафтовой вещи очками', () => {
  beforeAll(() => testPrisma.$connect())
  beforeEach(() => cleanDatabase())
  afterAll(() => testPrisma.$disconnect())

  it('предпросмотр: +20 очков, цена по уровню вещи и номеру улучшения, ничего не списывает', async () => {
    const { character, item, stock } = await fixture()
    const p = await UpgradesService.preview(character.id, item.id, 'DAMAGE')
    expect(p).toMatchObject({ mode: 'POINTS', pointsGain: 20, budgetNow: 40, budgetAfter: 60, nextTotalLevel: 1, canCommit: true, cost: 150 })
    expect(p.requiredResources).toEqual([
      expect.objectContaining({ resourceCode: HARDWARE, amount: 1, available: 10, enough: true }),
      expect.objectContaining({ resourceCode: STEEL, amount: 1, available: 10, enough: true }),
    ])
    expect(await stock()).toEqual({ hardware: 10, steel: 10 })
  })

  it('две разные вещи одного уровня улучшаются за одно и то же, вещь выше уровнем — дороже', async () => {
    const { character, item } = await fixture()
    const other = await craftedItem(character.id, { priceBase: 50_000, recipeAmount: 1 })
    const higher = await craftedItem(character.id, { levelReq: 5 })
    const a = await UpgradesService.preview(character.id, item.id, 'DAMAGE')
    const b = await UpgradesService.preview(character.id, other.item.id, 'DAMAGE')
    const c = await UpgradesService.preview(character.id, higher.item.id, 'DAMAGE')
    expect(b.cost).toBe(a.cost)
    expect(b.requiredResources.map(r => [r.resourceCode, r.amount])).toEqual(a.requiredResources.map(r => [r.resourceCode, r.amount]))
    expect(c.cost).toBe(750)
    expect(c.requiredResources.map(r => [r.resourceCode, r.amount])).toEqual([[HARDWARE, 5], [STEEL, 1]])
  })

  it('удача: +20 к бюджету вещи, второе улучшение дороже первого', async () => {
    const { character, item, template, stock } = await fixture()
    const first = await UpgradesService.commit(character.id, item.id, 'DAMAGE', uid('k'), () => 0)
    expect(first).toMatchObject({ success: true, levelAfter: 1, pointsGain: 20, cost: 150 })
    let fresh = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id } })
    expect(fresh).toMatchObject({ upgradeLevel: 1, extraPoints: 20, freePoints: 60 })
    expect(itemBudget(template, fresh.namedLevel, fresh.extraPoints)).toBe(60)
    expect(await stock()).toEqual({ hardware: 9, steel: 9 })
    const second = await UpgradesService.commit(character.id, item.id, 'DAMAGE', uid('k'), () => 0)
    expect(second.cost).toBe(396)
    fresh = await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id } })
    expect(fresh).toMatchObject({ upgradeLevel: 2, extraPoints: 40 })
    expect(await stock()).toEqual({ hardware: 7, steel: 7 })
    const log = await testPrisma.upgradeLog.findFirstOrThrow({ where: { itemInstanceId: item.id }, orderBy: { createdAt: 'desc' } })
    expect(log.upgradeType).toBe('POINTS')
  })

  it('неудача: ресурсы и деньги ушли, очков нет; без ресурсов отказ без списания', async () => {
    const { character, item, stock } = await fixture(1, 5)
    const r = await UpgradesService.commit(character.id, item.id, 'DAMAGE', uid('k'), () => 0.99)
    expect(r.success).toBe(false)
    expect(await testPrisma.itemInstance.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ upgradeLevel: 0, extraPoints: 0 })
    const moneyAfterFail = (await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money
    expect(moneyAfterFail).toBe(10_000 - 150)
    // Фурнитуры не осталось при цене 1: отказ, ничего не списано.
    await expect(UpgradesService.commit(character.id, item.id, 'DAMAGE', uid('k'), () => 0)).rejects.toMatchObject({ statusCode: 409 })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money).toBe(moneyAfterFail)
    expect(await stock()).toEqual({ hardware: 0, steel: 4 })
  })
})
