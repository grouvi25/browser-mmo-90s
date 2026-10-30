import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import { CityService } from '../../modules/city/city.service'
import { HelpersService } from '../../modules/premium/helpers.service'
import { PremiumService } from '../../modules/premium/premium.service'
import { RecipeService } from '../../modules/production/recipe.service'
import { WorkService } from '../../modules/work/work.service'
import { getRedis, disconnectRedis } from '../../shared/db/redis'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function setup() {
  const login = uid('prem')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'WORKER', hpCurrent: 80, hpMax: 80, dollars: 500, money: 1000 },
  })
  await testPrisma.characterProfession.create({ data: { characterId: character.id, professionCode: 'carpenter', level: 3 } })
  const tool = await testPrisma.itemTemplate.create({
    data: { code: uid('tool_prem'), name: 'Наковальня', type: 'TOOL', toolTier: 5, usesMax: 100, sourceType: 'DONATE', isEquippable: false },
  })
  await testPrisma.dollarShopItem.create({ data: { shop: 'BEREZKA', templateId: tool.id, priceDollars: 100 } })
  const object = await testPrisma.productionObject.create({
    data: {
      code: uid('obj'), name: 'Малый завод', type: 'FACTORY', requiredProfessionCode: 'carpenter', requiredProfessionLevel: 0, ownerType: 'PRIVATE', ownerCharacterId: character.id,
      shiftDurationMinutes: 30, baseSalary: 80, baseProductionExp: 10, storageCapacity: 1000, balance: 1000,
    },
  })
  const output = await testPrisma.resourceTemplate.create({ data: { code: uid('res_prem'), name: 'Кованая сталь', category: 'COMPONENT', tier: 3, basePrice: 700, weight: 0.6 } })
  const recipe = await testPrisma.productionRecipe.create({
    data: {
      code: uid('rcp'), name: 'Ковка стали', productionObjectCode: object.code, outputResourceCode: output.code, outputAmount: 2,
      cycleMinutes: 60, laborRequired: 60, requiredProfessionCode: 'carpenter', requiredToolTier: 5, requiredToolCode: tool.code,
    },
  })
  await testPrisma.productionObject.update({ where: { id: object.id }, data: { activeRecipeId: recipe.id } })
  return { character, tool, object, recipe }
}

describe('Премиальные инструменты', () => {
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
  afterAll(async () => { await testPrisma.$disconnect(); await disconnectRedis() })

  it('без своего инструмента на смену не выйти, с ним — можно, и он расходуется', async () => {
    const { character, tool, object } = await setup()
    await expect(WorkService.start(character.id, object.id)).rejects.toThrow('нужен инструмент: Наковальня')

    // Инструмент другой ступени не подходит, даже если он лучше.
    const other = await testPrisma.itemTemplate.create({ data: { code: uid('tool_other'), name: 'Импорт', type: 'TOOL', toolTier: 9, usesMax: 50, sourceType: 'DONATE', isEquippable: false } })
    await testPrisma.itemInstance.create({ data: { templateId: other.id, ownerId: character.id, quality: 'COMMON', durabilityCurrent: 100, durabilityMax: 100, weight: 1, sourceType: 'DONATE', usesLeft: 50 } })
    await expect(WorkService.start(character.id, object.id)).rejects.toThrow('нужен инструмент')

    // Покупка в Берёзке даёт инструмент с запасом использований.
    const bought = await CityService.buyItem(character.id, 'berezka', tool.id, randomUUID())
    expect(bought.item.usesLeft).toBe(100)

    const started = await WorkService.start(character.id, object.id)
    expect(started.shift.toolInstanceId).toBe(bought.item.id)
  })

  it('помощник такой рецепт не берёт', async () => {
    const { character, object } = await setup()
    await PremiumService.grant({ characterId: character.id, productCode: 'prem_sub_30' })
    const helper = await HelpersService.hire(character.id, 'Витёк', 'carpenter')
    await expect(HelpersService.startShift(character.id, helper.id, object.id)).rejects.toThrow('только сам игрок')
  })

  it('в рецептах видно, какой инструмент нужен', async () => {
    const { character, object } = await setup()
    const [recipe] = await RecipeService.listForObject(object.code, character.id)
    expect(recipe.requiredToolName).toBe('Наковальня')
  })

  it('на обычном рецепте премиальный инструмент работает как инструмент высокой ступени', async () => {
    const { character, tool, object, recipe } = await setup()
    await testPrisma.productionRecipe.update({ where: { id: recipe.id }, data: { requiredToolCode: null, requiredToolTier: 1 } })
    await testPrisma.productionEquipment.create({
      data: { productionObjectId: object.id, code: uid('eq'), name: 'Пресс', tier: 1, requiredToolTier: 2 },
    })
    await testPrisma.itemInstance.create({ data: { templateId: tool.id, ownerId: character.id, quality: 'COMMON', durabilityCurrent: 100, durabilityMax: 100, weight: 1, sourceType: 'DONATE', usesLeft: 100 } })
    await expect(WorkService.start(character.id, object.id)).resolves.toBeTruthy()
  })
})
