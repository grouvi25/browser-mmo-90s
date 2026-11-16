import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testPrisma, uid } from './helpers'
import { MarketService } from '../../modules/market/market.service'
import { craftPriceBounds } from '../../modules/market/price-bounds'

// Дима 15.11: крафтовое сырьё не дешевле затрат +20% и не дороже затрат +100%.
async function crafted() {
  const input = await testPrisma.resourceTemplate.create({ data: { code: uid('in'), name: 'Сырьё', category: 'PRIMARY', tier: 1, basePrice: 10, weight: 0.1 } })
  const output = await testPrisma.resourceTemplate.create({ data: { code: uid('out'), name: 'Изделие', category: 'PRIMARY', tier: 2, basePrice: 40, weight: 0.1 } })
  // 3 сырья по 10 ₽ → 2 изделия: затраты 15 ₽ за штуку, пределы 18…30 ₽
  await testPrisma.productionRecipe.create({ data: {
    code: uid('rcp'), name: 'Изделие', productionObjectCode: uid('obj'), outputResourceCode: output.code, outputAmount: 2,
    cycleMinutes: 30, laborRequired: 30, requiredProfessionCode: 'carpenter', inputs: { create: [{ resourceCode: input.code, amount: 3, minQuality: 'POOR' }] },
  } })
  return { input, output }
}

async function seller(resourceTemplateId: string, amount: number) {
  const login = uid('bounds')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { traderLevel: 1, userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 100000 } })
  await testPrisma.resourceStack.create({ data: { characterId: character.id, resourceTemplateId, amount } })
  return character
}

describe('пределы цены крафтового сырья', () => {
  beforeAll(() => testPrisma.$connect())
  afterAll(() => testPrisma.$disconnect())

  it('затраты +20% … +100%: вне пределов не выставить и не переоценить', async () => {
    const { output } = await crafted()
    expect(await craftPriceBounds(testPrisma, output.id)).toEqual({ cost: 15, min: 18, max: 30 })
    const character = await seller(output.id, 10)
    await expect(MarketService.createResource(character.id, output.id, 2, 17 * 2, uid('k'))).rejects.toMatchObject({ statusCode: 422 })
    await expect(MarketService.createResource(character.id, output.id, 2, 31 * 2, uid('k'))).rejects.toMatchObject({ statusCode: 422 })
    const ok = await MarketService.createResource(character.id, output.id, 2, 18 * 2, uid('k'))
    expect(ok.listing.price).toBe(36)
    await expect(MarketService.updatePrice(character.id, ok.listing.id, 2)).rejects.toMatchObject({ statusCode: 422 })
    expect((await MarketService.updatePrice(character.id, ok.listing.id, 60)).listing.price).toBe(60)
  })

  // Дима 16.11: пределы на всё сырьё. У добываемого затраты = госцена (10 ₽): 12…20 ₽.
  it('добываемое сырьё без входов: пределы от госцены', async () => {
    const { input } = await crafted()
    expect(await craftPriceBounds(testPrisma, input.id)).toEqual({ cost: 10, min: 12, max: 20 })
  })
})
