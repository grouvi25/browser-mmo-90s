import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testPrisma, uid } from './helpers'
import { EconomyService } from '../../modules/economy/economy.service'
import { moneyLog } from '../../modules/economy/money-log'
import { BalanceConfig } from '../../config/balance.config'

async function character() {
  const login = uid('wallet')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 1000 } })
  await testPrisma.characterStats.create({ data: { characterId: character.id } })
  return character
}

// №133 (Metallica 16.11): кошелёк рублей, и премия за уровень в нём видна.
describe('кошелёк рублей', () => {
  beforeAll(() => testPrisma.$connect())
  afterAll(() => testPrisma.$disconnect())

  it('премия за экономический уровень пишется в журнал денег', async () => {
    const c = await character()
    const need = BalanceConfig.economicExp.levelThresholds[1]
    await testPrisma.$transaction(tx => EconomyService.grantEconomicExp(tx, c.id, need))
    const log = await moneyLog(c.id)
    expect(log.items[0]).toMatchObject({ amount: BalanceConfig.economicExp.levelMoney, balanceAfter: 1000 + BalanceConfig.economicExp.levelMoney, label: 'Премия за уровень · Экономический уровень 1' })
  })

  it('новые сверху, страницы без пропусков и только свои строки', async () => {
    const c = await character()
    const other = await character()
    for (let i = 1; i <= 35; i++) await testPrisma.$transaction(tx => EconomyService.credit(tx, { characterId: c.id, amount: i, reasonCode: 'WORK_SALARY' }))
    await testPrisma.$transaction(tx => EconomyService.credit(tx, { characterId: other.id, amount: 5, reasonCode: 'WORK_SALARY' }))
    const first = await moneyLog(c.id)
    expect(first.items).toHaveLength(30)
    expect(first.hasMore).toBe(true)
    expect(first.items[0]).toMatchObject({ amount: 35, label: 'Зарплата за смену' })
    const second = await moneyLog(c.id, first.items[29].id)
    expect(second.items.map(row => row.amount)).toEqual([5, 4, 3, 2, 1])
    expect(second.hasMore).toBe(false)
  })

  // Metallica 16.11: в строке видно, что именно продали или купили.
  it('подпись называет вещь или сырьё', async () => {
    const c = await character()
    const res = await testPrisma.resourceTemplate.create({ data: { code: uid('walletres'), name: 'Лён', category: 'PRIMARY', tier: 1, basePrice: 10, weight: 0.1 } })
    await testPrisma.$transaction(tx => EconomyService.credit(tx, { characterId: c.id, amount: 30, reasonCode: 'RESOURCE_SELL', refType: 'resource', refId: res.id }))
    expect((await moneyLog(c.id)).items[0].label).toBe('Продажа сырья государству: Лён')
  })
})
