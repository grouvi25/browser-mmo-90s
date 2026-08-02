import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { ResourcesService } from '../../modules/resources/resources.service'

async function fixture(amount = 10, reservedAmount = 2) {
  const login = uid('res')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 100 } })
  const template = await testPrisma.resourceTemplate.create({ data: { code: uid('scrap'), name: 'Scrap', category: 'PRIMARY', tier: 1, basePrice: 8, weight: 0.5 } })
  await testPrisma.resourceStack.create({ data: { characterId: character.id, resourceTemplateId: template.id, amount, reservedAmount } })
  return { character, template }
}

describe('ResourcesService', () => {
  beforeAll(() => testPrisma.$connect())
  beforeEach(() => cleanDatabase())
  afterAll(() => testPrisma.$disconnect())

  it('sells available resources, credits money, logs resource and economic exp', async () => {
    const { character, template } = await fixture()
    const result = await ResourcesService.sell(character.id, template.code, 4, 'resource-sale-0001')
    expect(result.payout).toBe(8)
    const stack = await testPrisma.resourceStack.findUniqueOrThrow({ where: { characterId_resourceTemplateId: { characterId: character.id, resourceTemplateId: template.id } } })
    const saved = await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })
    expect(stack.amount).toBe(6)
    expect(stack.reservedAmount).toBe(2)
    expect(saved.money).toBe(108)
    expect(saved.economicExp).toBe(0)
    expect(await testPrisma.resourceLog.count({ where: { characterId: character.id } })).toBe(1)
    expect(await testPrisma.currencyLog.count({ where: { characterId: character.id, reasonCode: 'RESOURCE_SELL' } })).toBe(1)
  })

  it('does not sell reserved resources', async () => {
    const { character, template } = await fixture(10, 8)
    await expect(ResourcesService.sell(character.id, template.code, 3, 'resource-sale-0002')).rejects.toMatchObject({ statusCode: 409 })
    expect((await testPrisma.resourceStack.findFirstOrThrow({ where: { characterId: character.id } })).amount).toBe(10)
  })

  it('replays an idempotent sale without a second payout', async () => {
    const { character, template } = await fixture()
    const first = await ResourcesService.sell(character.id, template.code, 2, 'resource-sale-replay')
    const replay = await ResourcesService.sell(character.id, template.code, 2, 'resource-sale-replay')
    expect(first.payout).toBe(4)
    expect(replay.replayed).toBe(true)
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: character.id } })).money).toBe(104)
    expect((await testPrisma.resourceStack.findFirstOrThrow({ where: { characterId: character.id } })).amount).toBe(8)
  })
})
