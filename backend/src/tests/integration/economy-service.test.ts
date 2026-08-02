import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { withTransaction } from '../../shared/db/transaction'
import { EconomyService } from '../../modules/economy/economy.service'

async function createCharacter(money = 100) {
  const login = uid('eco')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money } })
}

describe('EconomyService', () => {
  beforeAll(() => testPrisma.$connect())
  beforeEach(() => cleanDatabase())
  afterAll(() => testPrisma.$disconnect())

  it('credits and debits atomically with exact balanceAfter logs', async () => {
    const char = await createCharacter()
    await withTransaction(tx => EconomyService.credit(tx, { characterId: char.id, amount: 25, reasonCode: 'ADMIN_GRANT', refType: 'test', refId: 'credit' }))
    await withTransaction(tx => EconomyService.debit(tx, { characterId: char.id, amount: 40, reasonCode: 'SHOP_PURCHASE', refType: 'test', refId: 'debit' }))
    const saved = await testPrisma.character.findUniqueOrThrow({ where: { id: char.id } })
    const logs = await testPrisma.currencyLog.findMany({ where: { characterId: char.id }, orderBy: { createdAt: 'asc' } })
    expect(saved.money).toBe(85)
    expect(logs.map(x => [x.amount, x.balanceAfter])).toEqual([[25, 125], [-40, 85]])
  })

  it('rejects insufficient funds without changing money or creating a log', async () => {
    const char = await createCharacter(10)
    await expect(withTransaction(tx => EconomyService.debit(tx, { characterId: char.id, amount: 11, reasonCode: 'SHOP_PURCHASE' }))).rejects.toMatchObject({ statusCode: 400 })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: char.id } })).money).toBe(10)
    expect(await testPrisma.currencyLog.count({ where: { characterId: char.id } })).toBe(0)
  })
})
