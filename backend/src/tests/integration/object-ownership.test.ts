import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OwnershipService } from '../../modules/production/ownership.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function fixture() {
  const login = uid('owner')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'MERCHANT', hpCurrent: 80, hpMax: 80, money: 50000 },
  })
  const object = await testPrisma.productionObject.create({
    data: {
      code: uid('sale'),
      name: 'Object for sale',
      type: 'WORKSHOP',
      requiredProfessionCode: 'scrap_collector',
      requiredProfessionLevel: 0,
      shiftDurationMinutes: 30,
      baseSalary: 100,
      baseProductionExp: 10,
      purchasePrice: 12000,
      isForSale: true,
    },
  })
  return { character, object }
}

describe('object ownership', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('buys, funds, withdraws and sells an empty idle object', async () => {
    const { character, object } = await fixture()
    const bought = await OwnershipService.buy(character.id, object.id, 'buy-object-0001')
    expect(bought.newBalance).toBe(38000)
    expect((await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })).ownerCharacterId).toBe(character.id)

    const funded = await OwnershipService.topUp(character.id, object.id, 1000, 'fund-object-0001')
    expect(funded.balance).toBe(1000)
    const withdrawn = await OwnershipService.withdraw(character.id, object.id, 1000, 'withdraw-object-0001')
    expect(withdrawn).toMatchObject({ payout: 950, tax: 50 })

    const sold = await OwnershipService.sell(character.id, object.id, 'sell-object-0001')
    expect(sold.payout).toBe(6000)
    expect((await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })).ownerType).toBe('SYSTEM')
  })

  it('rejects a salary outside the configured corridor', async () => {
    const { character, object } = await fixture()
    await OwnershipService.buy(character.id, object.id, 'buy-object-0002')
    await expect(OwnershipService.setSalary(character.id, object.id, 49)).rejects.toMatchObject({ code: 'PROD_006' })
    await expect(OwnershipService.setSalary(character.id, object.id, 201)).rejects.toMatchObject({ code: 'PROD_006' })
    await expect(OwnershipService.setSalary(character.id, object.id, 150)).resolves.toEqual({ salary: 150 })
  })
})
