/**
 * Цех второго уровня (заказчик 04.11, #4226–4228): «завод 1 лвл делает 1 рецепт,
 * 2 лвл делает 3 рецепта». Улучшение за доллары, несколько разных рецептов сразу.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { BalanceConfig } from '../../config/balance.config'
import { CycleService } from '../../modules/production/cycle.service'
import { OwnershipService } from '../../modules/production/ownership.service'
import { ProductionService } from '../../modules/production/production.service'

const P = BalanceConfig.economy.production

async function owner(dollars = 20_000) {
  const login = uid('lv')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, dollars } })
}

async function factory(ownerId: string) {
  const object = await testPrisma.productionObject.create({ data: {
    code: uid('obj'), name: 'Мастерская', type: 'WORKSHOP', locationId: 'industrial', requiredProfessionCode: 'toolmaker',
    shiftDurationMinutes: 60, baseSalary: 0, baseProductionExp: 20, storageCapacity: 1000,
    ownerType: 'PRIVATE', ownerCharacterId: ownerId, paidUsd: P.objectPriceUsd,
  } })
  const recipes = []
  for (const name of ['Первый', 'Второй', 'Третий', 'Четвёртый']) {
    recipes.push(await testPrisma.productionRecipe.create({ data: {
      code: uid('rcp'), name, productionObjectCode: object.code, outputAmount: 1, cycleMinutes: 1, laborRequired: 60,
      requiredProfessionCode: 'toolmaker', requiredProfessionLevel: 0, requiredToolTier: 1,
    } }))
  }
  await testPrisma.productionObject.update({ where: { id: object.id }, data: { activeRecipeId: recipes[0].id } })
  return { object, recipes }
}

describe('цех второго уровня', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('на первом уровне один цикл, выбор рецепта не обходит смену профиля', async () => {
    const me = await owner()
    const { object, recipes } = await factory(me.id)
    expect(await CycleService.tryStart(object.id)).toHaveProperty('cycle')
    expect(await CycleService.tryStart(object.id, recipes[1].id)).toEqual({ alreadyRunning: true })
    expect(await testPrisma.productionCycle.count({ where: { productionObjectId: object.id } })).toBe(1)
  })

  it('улучшение за доллары ведёт три разных рецепта сразу, четвёртый и повтор ждут', async () => {
    const me = await owner()
    const { object, recipes } = await factory(me.id)
    const res = await OwnershipService.upgrade(me.id, object.id, uid('key'))
    expect(res).toMatchObject({ level: 2, priceUsd: P.objectLevel2PriceUsd })
    const after = await testPrisma.character.findUniqueOrThrow({ where: { id: me.id } })
    expect(after.dollars).toBe(20_000 - P.objectLevel2PriceUsd)
    expect(await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } }))
      .toMatchObject({ level: 2, paidUsd: P.objectPriceUsd + P.objectLevel2PriceUsd })

    for (const recipe of recipes.slice(0, 3)) expect(await CycleService.tryStart(object.id, recipe.id)).toHaveProperty('cycle')
    expect(await CycleService.tryStart(object.id, recipes[3].id)).toEqual({ alreadyRunning: true })
    expect(await testPrisma.productionCycle.count({ where: { productionObjectId: object.id } })).toBe(P.cyclesAtLevel2)

    const [mine] = await ProductionService.mine(me.id)
    expect(mine).toMatchObject({ cycleSlots: 3, upgradeUsd: null })
    expect(mine.recipeChoices.map(r => r.name).sort()).toEqual(['Второй', 'Первый', 'Третий', 'Четвёртый'].sort())
  })

  it('один и тот же рецепт дважды не запускается, чужой рецепт отказывает', async () => {
    const me = await owner()
    const { object, recipes } = await factory(me.id)
    await OwnershipService.upgrade(me.id, object.id, uid('key'))
    expect(await CycleService.tryStart(object.id, recipes[1].id)).toHaveProperty('cycle')
    expect(await CycleService.tryStart(object.id, recipes[1].id)).toEqual({ alreadyRunning: true })
    const other = await factory(me.id)
    await expect(CycleService.tryStart(object.id, other.recipes[0].id)).rejects.toMatchObject({ code: 'PROD_017' })
  })

  it('чужой цех не улучшить, второй раз не улучшить, без денег не улучшить', async () => {
    const me = await owner()
    const stranger = await owner()
    const { object } = await factory(me.id)
    await expect(OwnershipService.upgrade(stranger.id, object.id, uid('key'))).rejects.toMatchObject({ code: 'PROD_008' })
    await OwnershipService.upgrade(me.id, object.id, uid('key'))
    await expect(OwnershipService.upgrade(me.id, object.id, uid('key'))).rejects.toMatchObject({ code: 'PROD_013' })
    const poor = await owner(100)
    const second = await factory(poor.id)
    await expect(OwnershipService.upgrade(poor.id, second.object.id, uid('key'))).rejects.toBeTruthy()
    expect((await testPrisma.productionObject.findUniqueOrThrow({ where: { id: second.object.id } })).level).toBe(1)
  })

  it('при продаже государству цех возвращается первого уровня', async () => {
    const me = await owner()
    const { object } = await factory(me.id)
    await OwnershipService.upgrade(me.id, object.id, uid('key'))
    await OwnershipService.sell(me.id, object.id, uid('key'))
    expect(await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })).toMatchObject({ level: 1, ownerType: 'SYSTEM' })
  })
})
