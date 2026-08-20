import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BarsService } from '../../modules/bars/bars.service'
import { ObjectInventoryService } from '../../modules/production/inventory.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function player(prefix: string, money = 10_000) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 60, hpMax: 100, money },
  })
}

async function barWithOffer(input: { resourceCode: string; price: number; baseCost: number; hpRestore?: number; alcoholDegrees?: number; accuracyBuff?: number; damageBuff?: number; buffMinutes?: number }) {
  const owner = await player('barOwner')
  const bar = await testPrisma.productionObject.create({
    data: {
      code: uid('bar'), name: 'Test bar', type: 'BAR', requiredProfessionCode: 'procurer',
      shiftDurationMinutes: 60, baseSalary: 180, baseProductionExp: 18,
      storageCapacity: 1000, ownerCharacterId: owner.id, ownerType: 'PRIVATE',
    },
  })
  await testPrisma.resourceTemplate.upsert({
    where: { code: input.resourceCode }, update: {},
    create: { code: input.resourceCode, name: input.resourceCode, category: 'PRIMARY', tier: 1, basePrice: 10, weight: 0.3 },
  })
  const offer = await testPrisma.barOffer.create({
    data: {
      productionObjectId: bar.id, code: uid('offer'), name: 'Test offer',
      resourceCode: input.resourceCode, price: input.price, baseCost: input.baseCost,
      hpRestore: input.hpRestore ?? 0, alcoholDegrees: input.alcoholDegrees ?? 0,
      accuracyBuff: input.accuracyBuff ?? 0, damageBuff: input.damageBuff ?? 0, buffMinutes: input.buffMinutes ?? 0,
    },
  })
  return { owner, bar, offer }
}

describe('bars', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('sells a stocked drink, splits price into tax and owner income, and restores HP', async () => {
    const { bar, offer } = await barWithOffer({ resourceCode: 'bar_kvass', price: 55, baseCost: 55, hpRestore: 15, alcoholDegrees: 8 })
    await testPrisma.$transaction(tx => ObjectInventoryService.put(tx, { objectId: bar.id, resourceCode: 'bar_kvass', quality: 'NORMAL', amount: 2, capacity: 1000 }))
    const buyer = await player('drinker', 500)

    const result = await BarsService.buy(buyer.id, offer.id, uid('key'))
    expect(result.price).toBe(55)
    expect(result.tax).toBe(Math.floor(55 * 0.20)) // 20% налог, раздел «Бары, еда и опьянение»
    expect(result.tax + result.ownerIncome).toBe(55)
    expect(result.newBalance).toBe(500 - 55)
    expect(result.hpCurrent).toBe(75) // 60 + 15
    expect(result.alcoholLevel).toBe(8)

    const barAfter = await testPrisma.productionObject.findUniqueOrThrow({ where: { id: bar.id } })
    expect(barAfter.balance).toBe(result.ownerIncome)

    const stock = await testPrisma.productionObjectInventory.findFirstOrThrow({ where: { productionObjectId: bar.id, resourceCode: 'bar_kvass' } })
    expect(stock.amount).toBe(1)
  })

  it('refuses a sale when the bar has no stock, without charging the buyer', async () => {
    const { offer } = await barWithOffer({ resourceCode: 'bar_shchi', price: 75, baseCost: 75, hpRestore: 25 })
    const buyer = await player('hungry', 500)
    await expect(BarsService.buy(buyer.id, offer.id, uid('key'))).rejects.toThrow()
    const after = await testPrisma.character.findUniqueOrThrow({ where: { id: buyer.id } })
    expect(after.money).toBe(500)
  })

  it('replays the same idempotency key without a second charge', async () => {
    const { bar, offer } = await barWithOffer({ resourceCode: 'bar_shchi', price: 75, baseCost: 75, hpRestore: 25 })
    await testPrisma.$transaction(tx => ObjectInventoryService.put(tx, { objectId: bar.id, resourceCode: 'bar_shchi', quality: 'NORMAL', amount: 5, capacity: 1000 }))
    const buyer = await player('regular', 500)
    const key = uid('key')
    const first = await BarsService.buy(buyer.id, offer.id, key)
    const second = await BarsService.buy(buyer.id, offer.id, key)
    expect(second).toMatchObject(first) // повтор помечен replayed:true поверх того же результата
    const after = await testPrisma.character.findUniqueOrThrow({ where: { id: buyer.id } })
    expect(after.money).toBe(500 - 75)
  })

  it('lets the owner reprice inside the cost..3x cost corridor and rejects outside prices', async () => {
    const { owner, offer } = await barWithOffer({ resourceCode: 'bar_beer', price: 40, baseCost: 40 })
    const updated = await BarsService.setPrice(owner.id, offer.id, 100)
    expect(updated.price).toBe(100)
    await expect(BarsService.setPrice(owner.id, offer.id, 200)).rejects.toThrow() // выше тройной себестоимости
    const stranger = await player('stranger')
    await expect(BarsService.setPrice(stranger.id, offer.id, 80)).rejects.toThrow()
  })

  it('blocks a fresh drink while in hangover', async () => {
    const { bar, offer } = await barWithOffer({ resourceCode: 'bar_moonshine', price: 150, baseCost: 150, alcoholDegrees: 40 })
    await testPrisma.$transaction(tx => ObjectInventoryService.put(tx, { objectId: bar.id, resourceCode: 'bar_moonshine', quality: 'NORMAL', amount: 5, capacity: 1000 }))
    const buyer = await player('wasted', 5000)
    await testPrisma.character.update({ where: { id: buyer.id }, data: { hangoverUntil: new Date(Date.now() + 30 * 60_000) } })
    await expect(BarsService.buy(buyer.id, offer.id, uid('key'))).rejects.toThrow()
  })
})
