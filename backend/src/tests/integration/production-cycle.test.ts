import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CycleService } from '../../modules/production/cycle.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function fixture() {
  const login = uid('cycle')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80 },
  })
  const output = await testPrisma.resourceTemplate.create({
    data: { code: uid('output'), name: 'Output', category: 'PRIMARY', basePrice: 8, weight: 0.5 },
  })
  const object = await testPrisma.productionObject.create({
    data: {
      code: uid('object'),
      name: 'Test production',
      type: 'SCRAPYARD',
      requiredProfessionCode: 'scrap_collector',
      shiftDurationMinutes: 30,
      baseSalary: 80,
      baseProductionExp: 10,
      storageCapacity: 100,
    },
  })
  const recipe = await testPrisma.productionRecipe.create({
    data: {
      code: uid('recipe'),
      name: 'Test recipe',
      productionObjectCode: object.code,
      outputResourceCode: output.code,
      outputAmount: 3,
      cycleMinutes: 30,
      laborRequired: 30,
      requiredProfessionCode: 'scrap_collector',
    },
  })
  await testPrisma.productionObject.update({ where: { id: object.id }, data: { activeRecipeId: recipe.id } })
  return { character, object, recipe, output }
}

describe('production cycle', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('starts, accepts labor and produces output exactly once', async () => {
    const { character, object, output } = await fixture()
    const started = await CycleService.tryStart(object.id)
    expect('cycle' in started).toBe(true)
    if (!('cycle' in started)) throw new Error('cycle not started')

    const contribution = await testPrisma.$transaction(tx => CycleService.contributeLabor(tx, {
      objectId: object.id,
      characterId: character.id,
      workShiftId: crypto.randomUUID(),
      shiftDurationMinutes: 30,
      professionLevel: 0,
      workerEfficiency: 1,
      toolTier: 1,
    }))
    expect(contribution?.laborAccumulated).toBe(30)
    await testPrisma.productionCycle.update({
      where: { id: started.cycle.id },
      data: { endsAt: new Date(Date.now() - 1000) },
    })

    const results = await Promise.all([
      CycleService.complete(started.cycle.id),
      CycleService.complete(started.cycle.id),
      CycleService.complete(started.cycle.id),
    ])
    expect(results.filter(result => 'completed' in result)).toHaveLength(1)
    const inventory = await testPrisma.productionObjectInventory.findUniqueOrThrow({
      where: {
        productionObjectId_resourceCode_quality: {
          productionObjectId: object.id,
          resourceCode: output.code,
          quality: 'NORMAL',
        },
      },
    })
    expect(inventory.amount).toBe(3)
    expect((await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })).durabilityCurrent).toBe(98)
  })
})
