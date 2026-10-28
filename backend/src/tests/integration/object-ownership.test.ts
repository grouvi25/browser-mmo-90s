import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { OwnershipService } from '../../modules/production/ownership.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function fixture() {
  const login = uid('owner')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'MERCHANT', hpCurrent: 80, hpMax: 80, money: 50000, dollars: 10000 },
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
    // Заказчик 28.10: у государства объекты только за доллары, рубли не трогаются.
    const bought = await OwnershipService.buy(character.id, object.id, 'buy-object-0001')
    expect(bought).toMatchObject({ priceUsd: 6000, newDollars: 4000 })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money).toBe(50000)
    expect((await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })).ownerCharacterId).toBe(character.id)

    const funded = await OwnershipService.topUp(character.id, object.id, 1000, 'fund-object-0001')
    expect(funded.balance).toBe(1000)
    const withdrawn = await OwnershipService.withdraw(character.id, object.id, 1000, 'withdraw-object-0001')
    expect(withdrawn).toMatchObject({ payout: 950, tax: 50 })

    const sold = await OwnershipService.sell(character.id, object.id, 'sell-object-0001')
    expect(sold).toMatchObject({ payout: 3000, currency: 'USD', newBalance: 7000 })
    const back = await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })
    expect(back).toMatchObject({ ownerType: 'SYSTEM', paidUsd: null })
  })

  it('refuses to buy without enough dollars, whatever the rubles', async () => {
    const { character, object } = await fixture()
    await testPrisma.character.update({ where: { id: character.id }, data: { dollars: 5999, money: 10_000_000 } })
    await expect(OwnershipService.buy(character.id, object.id, 'buy-object-poor')).rejects.toMatchObject({ code: 'ECON_002' })
    expect((await testPrisma.productionObject.findUniqueOrThrow({ where: { id: object.id } })).ownerType).toBe('SYSTEM')
  })

  it('keeps the ruble buyback for objects bought for rubles before 28.10', async () => {
    const { character, object } = await fixture()
    await testPrisma.productionObject.update({
      where: { id: object.id }, data: { ownerType: 'PRIVATE', ownerCharacterId: character.id, isForSale: false, paidUsd: null },
    })
    const sold = await OwnershipService.sell(character.id, object.id, 'sell-object-rub')
    expect(sold).toMatchObject({ payout: 6000, currency: 'RUB', newBalance: 56000 })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).dollars).toBe(10000)
  })

  it('rejects a salary outside the configured corridor', async () => {
    const { character, object } = await fixture()
    await OwnershipService.buy(character.id, object.id, 'buy-object-0002')
    await expect(OwnershipService.setSalary(character.id, object.id, 49)).rejects.toMatchObject({ code: 'PROD_006' })
    await expect(OwnershipService.setSalary(character.id, object.id, 201)).rejects.toMatchObject({ code: 'PROD_006' })
    await expect(OwnershipService.setSalary(character.id, object.id, 150)).resolves.toEqual({ salary: 150 })
  })
})
