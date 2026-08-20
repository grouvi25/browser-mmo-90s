/**
 * Проверяет реальные сид-рецепты Этапа 3 (не синтетические фикстуры), а не
 * только формулы цикла: вертикальный срез из акта приёмки —
 * res_scrap_metal → comp_metal_plate → comp_weapon_part → weapon_tt_private.
 * Данные берутся из economy-data.ts напрямую, поэтому тест ловит и опечатку
 * в коде ресурса, и рассинхрон между рецептом и объектом.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PRODUCTION_RECIPES, RESOURCES } from '../../../prisma/economy-data'
import { CycleService } from '../../modules/production/cycle.service'
import { ObjectInventoryService } from '../../modules/production/inventory.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

function recipe(code: string) {
  const found = PRODUCTION_RECIPES.find(item => item.code === code)
  if (!found) throw new Error(`fixture bug: recipe ${code} missing from economy-data`)
  return found
}

function resource(code: string) {
  const found = RESOURCES.find(row => row[0] === code)
  if (!found) throw new Error(`fixture bug: resource ${code} missing from economy-data`)
  return found
}

async function seedResource(code: string) {
  const [, name, category, tier, basePrice, weight] = resource(code)
  await testPrisma.resourceTemplate.upsert({
    where: { code },
    update: {},
    create: { code, name, category, tier, basePrice, weight },
  })
}

/** Создаёт объект и активный рецепт из реального сида, со складом под входы. */
async function objectWithRecipe(recipeCode: string, ownerCharacterId?: string) {
  const def = recipe(recipeCode)
  for (const input of def.inputs) await seedResource(input.resourceCode)
  if (def.outputResourceCode) await seedResource(def.outputResourceCode)

  const object = await testPrisma.productionObject.create({
    data: {
      code: uid(def.productionObjectCode),
      name: def.productionObjectCode,
      type: 'WORKSHOP',
      requiredProfessionCode: def.requiredProfessionCode,
      shiftDurationMinutes: 60,
      baseSalary: 100,
      baseProductionExp: 10,
      storageCapacity: 1000,
      ownerCharacterId,
      ownerType: ownerCharacterId ? 'PRIVATE' : 'SYSTEM',
    },
  })
  const savedRecipe = await testPrisma.productionRecipe.create({
    data: {
      code: uid(def.code),
      name: def.name,
      productionObjectCode: object.code,
      outputResourceCode: def.outputResourceCode,
      outputItemTemplateCode: def.outputItemTemplateCode,
      outputAmount: def.outputAmount,
      cycleMinutes: def.cycleMinutes,
      laborRequired: def.laborRequired,
      requiredProfessionCode: def.requiredProfessionCode,
      requiredProfessionLevel: def.requiredProfessionLevel,
      requiredToolTier: def.requiredToolTier,
      inputs: def.inputs.length > 0
        ? { createMany: { data: def.inputs.map(input => ({ resourceCode: input.resourceCode, amount: input.amount, minQuality: input.minQuality })) } }
        : undefined,
    },
  })
  await testPrisma.productionObject.update({ where: { id: object.id }, data: { activeRecipeId: savedRecipe.id } })
  await testPrisma.$transaction(async tx => {
    for (const input of def.inputs) {
      await ObjectInventoryService.put(tx, {
        objectId: object.id, resourceCode: input.resourceCode, quality: 'NORMAL', amount: input.amount, capacity: 1000,
      })
    }
  })
  return { object, def }
}

async function runToCompletion(objectId: string, characterId: string, laborRequired: number) {
  const started = await CycleService.tryStart(objectId)
  if (!('cycle' in started)) throw new Error(`cycle did not start: ${JSON.stringify(started)}`)
  await testPrisma.$transaction(tx => CycleService.contributeLabor(tx, {
    objectId,
    characterId,
    workShiftId: crypto.randomUUID(),
    shiftDurationMinutes: laborRequired,
    professionLevel: 6,
    workerEfficiency: 1,
    toolTier: 3,
  }))
  await testPrisma.productionCycle.update({ where: { id: started.cycle.id }, data: { endsAt: new Date(Date.now() - 1000) } })
  const result = await CycleService.complete(started.cycle.id)
  if (!('completed' in result)) throw new Error(`cycle did not complete: ${JSON.stringify(result)}`)
  return started.cycle.id
}

describe('production chain (real Stage 3 recipes)', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('rcp_fastener consumes scrap metal and yields fasteners in the object inventory', async () => {
    const login = uid('smith')
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    const character = await testPrisma.character.create({
      data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80 },
    })
    const { object, def } = await objectWithRecipe('rcp_fastener')

    await runToCompletion(object.id, character.id, def.laborRequired)

    const inventory = await testPrisma.productionObjectInventory.findFirstOrThrow({
      where: { productionObjectId: object.id, resourceCode: def.outputResourceCode as string },
    })
    expect(inventory.amount).toBe(def.outputAmount)

    const inputRow = await testPrisma.productionObjectInventory.findFirstOrThrow({
      where: { productionObjectId: object.id, resourceCode: def.inputs[0].resourceCode },
    })
    expect(inputRow.amount).toBe(0)
    expect(inputRow.reservedAmount).toBe(0)
  })

  it('rcp_tt_pistol crafts a private weapon_tt_private item once the object has an owner', async () => {
    const login = uid('gunsmith')
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    const character = await testPrisma.character.create({
      data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80 },
    })
    const { object, def } = await objectWithRecipe('rcp_tt_pistol', character.id)
    expect(def.outputItemTemplateCode).toBe('weapon_tt_private')

    await runToCompletion(object.id, character.id, def.laborRequired)

    const items = await testPrisma.itemInstance.findMany({
      where: { ownerId: character.id, sourceType: 'CRAFTED' },
      include: { template: true },
    })
    expect(items).toHaveLength(def.outputAmount)
    expect(items[0].template.code).toBe('weapon_tt_private')
  })

  it('a recipe requiring an item output is blocked without a private owner', async () => {
    const { object, def } = await objectWithRecipe('rcp_tt_pistol')
    expect(object.ownerCharacterId).toBeNull()
    const login = uid('nobody')
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    const character = await testPrisma.character.create({
      data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80 },
    })
    const started = await CycleService.tryStart(object.id)
    if (!('cycle' in started)) throw new Error(`cycle did not start: ${JSON.stringify(started)}`)
    await testPrisma.$transaction(tx => CycleService.contributeLabor(tx, {
      objectId: object.id,
      characterId: character.id,
      workShiftId: crypto.randomUUID(),
      shiftDurationMinutes: def.laborRequired,
      professionLevel: 6,
      workerEfficiency: 1,
      toolTier: 3,
    }))
    // время выставляем в прошлое ПОСЛЕ вклада труда: сам вклад пересчитывает
    // endsAt при переходе PENDING → RUNNING и затёр бы более ранний override.
    await testPrisma.productionCycle.update({ where: { id: started.cycle.id }, data: { endsAt: new Date(Date.now() - 1000) } })
    await expect(CycleService.complete(started.cycle.id)).rejects.toThrow()
  })
})
