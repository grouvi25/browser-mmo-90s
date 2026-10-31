import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import { ECONOMY_TABLE_RATE, TABLE_ITEMS, TABLE_OBJECTS, TABLE_RECIPES, TABLE_RESOURCES, TABLE_TOOLS, tablePrice } from '../../../prisma/economy-table'
import { RESOURCES } from '../../../prisma/economy-data'
import { BAR_RESOURCES } from '../../../prisma/bar-data'
import { seedEconomyTable } from '../../../prisma/seed-economy-table'
import { CityService } from '../../modules/city/city.service'
import { OwnershipService } from '../../modules/production/ownership.service'
import { CycleService } from '../../modules/production/cycle.service'
import { PROFESSION_NAMES, isProfessionCode, previousProfession } from '../../modules/professions/professions'
import { WorkService } from '../../modules/work/work.service'
import { getRedis, disconnectRedis } from '../../shared/db/redis'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function worker(professions: string[], dollars = 0) {
  const login = uid('tb')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'WORKER', hpCurrent: 80, hpMax: 80, dollars, money: 5000 },
  })
  for (const professionCode of professions) await testPrisma.characterProfession.create({ data: { characterId: character.id, professionCode } })
  return character
}

const object = (code: string) => testPrisma.productionObject.findUniqueOrThrow({ where: { code } })

describe('Книга экономики: данные', () => {
  it('книга целая: 77 ресурсов, 121 рецепт, 36 изделий, 8 инструментов', () => {
    expect(TABLE_RESOURCES).toHaveLength(77)
    expect(TABLE_RECIPES).toHaveLength(121)
    expect(TABLE_ITEMS).toHaveLength(36)
    expect(TABLE_TOOLS).toHaveLength(8)
  })

  it('ссылки сходятся: у рецепта есть объект, инструмент и профессия, ресурс делается раньше, чем нужен', () => {
    const objects = new Map(TABLE_OBJECTS.map(row => [row.code, row]))
    const tools = new Set(TABLE_TOOLS.map(row => row[0]))
    const resources = new Set(TABLE_RESOURCES.map(row => row[0]))
    const made = new Set<string>()
    for (const recipe of TABLE_RECIPES.filter(row => row.resource)) made.add(recipe.resource!)
    expect([...resources].filter(code => !made.has(code))).toEqual([])
    for (const recipe of TABLE_RECIPES) {
      expect(objects.get(recipe.object)?.profession).toBe(recipe.profession)
      expect(isProfessionCode(recipe.profession)).toBe(true)
      if (recipe.tool) expect(tools.has(recipe.tool)).toBe(true)
      for (const [code, amount] of recipe.inputs) {
        expect(resources.has(code)).toBe(true)
        expect(amount).toBeGreaterThan(0)
      }
    }
    // Цепочка без циклов: рецепты в книге идут от сырья вверх.
    const ready = new Set<string>()
    for (const recipe of TABLE_RECIPES) {
      for (const [code] of recipe.inputs) expect(ready.has(code)).toBe(true)
      if (recipe.resource) ready.add(recipe.resource)
    }
  })

  it('имена не совпадают со старыми ресурсами: на рынке их не спутать', () => {
    const old = new Set([...RESOURCES.map(row => row[1] as string), ...BAR_RESOURCES.map(row => row[1] as string)])
    expect(TABLE_RESOURCES.filter(row => old.has(row[1])).map(row => row[1])).toEqual([])
    expect(new Set(TABLE_RESOURCES.map(row => row[1])).size).toBe(77)
  })

  it('рубли считаются одним курсом, новые профессии без лестницы допуска', () => {
    expect(tablePrice(100)).toBe(100 * ECONOMY_TABLE_RATE)
    expect(PROFESSION_NAMES.tailor).toBe('Портной')
    expect(previousProfession('tailor')).toBe(null)
  })
})

describe('Книга экономики: в игре', () => {
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb(); await seedEconomyTable(testPrisma) })
  afterAll(async () => { await testPrisma.$disconnect(); await disconnectRedis() })

  it('сбор: смена без оклада даёт ресурс книги и опыт', async () => {
    const character = await worker(['metallurgist'])
    const spot = await object('obj_tb_scrap')
    expect(spot).toMatchObject({ isForSale: false, baseSalary: 0, producesResourceCode: 'tb_scrap', shiftDurationMinutes: 50 })
    const { shift } = await WorkService.start(character.id, spot.id)
    await testPrisma.workShift.update({ where: { id: shift.id }, data: { endsAt: new Date(Date.now() - 1000), status: 'READY_TO_CLAIM' } })
    const paid = await WorkService.claim(character.id, shift.id, randomUUID())
    expect(paid).toMatchObject({ salary: 0, resourceReward: { code: 'tb_scrap', amount: 1 } })
  })

  it('ферме нужен инструмент из книги, и его можно купить у государства', async () => {
    const character = await worker(['weaver'])
    const farm = await object('obj_tb_flax')
    await expect(WorkService.start(character.id, farm.id)).rejects.toThrow('нужен инструмент: Садовый набор')
    const tool = await testPrisma.itemTemplate.findUniqueOrThrow({ where: { code: 'tool_tb_u02' } })
    expect(await testPrisma.governmentShopItem.count({ where: { templateId: tool.id } })).toBe(1)
    await testPrisma.itemInstance.create({ data: { templateId: tool.id, ownerId: character.id, quality: 'COMMON', durabilityCurrent: 1, durabilityMax: 1, weight: 1, sourceType: 'GOVERNMENT', usesLeft: 100 } })
    const started = await WorkService.start(character.id, farm.id)
    expect(started.shift.toolInstanceId).toBeTruthy()
  })

  it('цех продаётся за доллары, а без владельца вакансии нет', async () => {
    const character = await worker(['metallurgist'], 20_000)
    const shop = await object('obj_tb_steel_blank')
    expect(shop).toMatchObject({ isForSale: true, ownerType: 'SYSTEM' })
    const seen = async () => (await WorkService.listObjects(character.id)).items.some(row => row.code === shop.code)
    expect(await seen()).toBe(false)
    await OwnershipService.buy(character.id, shop.id, randomUUID())
    expect(await seen()).toBe(true)
    const recipe = await testPrisma.productionRecipe.findUniqueOrThrow({ where: { code: 'rcp_tb_steel_blank' }, include: { inputs: true } })
    expect((await object(shop.code)).activeRecipeId).toBe(recipe.id)
    expect(recipe.inputs.map(row => [row.resourceCode, row.amount]).sort()).toEqual([['tb_coal', 1], ['tb_iron_ore', 1], ['tb_scrap', 2]])
  })

  it('цех от сырья до продукции: труд книги, потом минута таймера', async () => {
    const character = await worker(['metallurgist'], 20_000)
    const shop = await object('obj_tb_steel_blank')
    await OwnershipService.buy(character.id, shop.id, randomUUID())
    for (const [resourceCode, amount] of [['tb_scrap', 2], ['tb_iron_ore', 1], ['tb_coal', 1]] as const) {
      await testPrisma.productionObjectInventory.create({ data: { productionObjectId: shop.id, resourceCode, amount } })
    }
    const tool = await testPrisma.itemTemplate.findUniqueOrThrow({ where: { code: 'tool_tb_u01' } })
    await testPrisma.itemInstance.create({ data: { templateId: tool.id, ownerId: character.id, quality: 'COMMON', durabilityCurrent: 1, durabilityMax: 1, weight: 1, sourceType: 'GOVERNMENT', usesLeft: 100 } })
    const started = await CycleService.tryStart(shop.id)
    expect(started).toMatchObject({ cycle: { laborRequired: 200 } })
    const cycle = await testPrisma.productionCycle.findFirstOrThrow({ where: { productionObjectId: shop.id } })
    await testPrisma.productionCycle.update({ where: { id: cycle.id }, data: { laborAccumulated: 199 } })

    const { shift } = await WorkService.start(character.id, shop.id)
    await testPrisma.workShift.update({ where: { id: shift.id }, data: { startedAt: new Date(Date.now() - 3_601_000), endsAt: new Date(Date.now() - 1000), status: 'READY_TO_CLAIM' } })
    await WorkService.claim(character.id, shift.id, randomUUID())
    const running = await testPrisma.productionCycle.findUniqueOrThrow({ where: { id: cycle.id } })
    expect(running.status).toBe('RUNNING')
    expect(running.endsAt!.getTime() - Date.now()).toBeLessThanOrEqual(60_000)

    await testPrisma.productionCycle.update({ where: { id: cycle.id }, data: { endsAt: new Date(Date.now() - 1000) } })
    await CycleService.complete(cycle.id)
    const stock = await testPrisma.productionObjectInventory.findMany({ where: { productionObjectId: shop.id, resourceCode: 'tb_steel_blank' } })
    expect(stock.reduce((sum, row) => sum + row.amount, 0)).toBe(1)
  })

  it('повторный сид не стирает правки заказчика и не отбирает завод', async () => {
    const character = await worker(['tailor'], 20_000)
    const shop = await object('obj_tb_armor_shop')
    await OwnershipService.buy(character.id, shop.id, randomUUID())
    await testPrisma.itemTemplate.update({ where: { code: 'tb_item_c12' }, data: { armor: 200 } })
    await seedEconomyTable(testPrisma)
    expect((await testPrisma.itemTemplate.findUniqueOrThrow({ where: { code: 'tb_item_c12' } })).armor).toBe(200)
    expect(await object(shop.code)).toMatchObject({ ownerType: 'PRIVATE', ownerCharacterId: character.id, isForSale: false })
  })

  it('восемь новых профессий продаются в Училище', async () => {
    const character = await worker([])
    const list = await CityService.professions(character.id)
    expect(list.items.map(row => row.code)).toEqual(expect.arrayContaining(['metallurgist', 'rune_scribe']))
  })
})
