/**
 * Экономический уровень по книге «Ревизия 2» (перевод 28.10): порог
 * E(L) = ROUND(1450 × e^(0,3(L−1)) × L^0,9), за новый уровень — сила +1 и
 * премия десятой долей порога, по разу за каждый уровень.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { prisma } from '../../shared/db/prisma'
import { EconomyService } from '../../modules/economy/economy.service'
import { BalanceConfig } from '../../config/balance.config'

async function character() {
  const login = uid('eco')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'MERCHANT', hpCurrent: 80, hpMax: 80, money: 1000, stats: { create: { str: 4 } } },
  })
}

describe('экономический уровень', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('пороги — по книге: 1450, 3652 …', () => {
    expect(BalanceConfig.economicExp.levelThresholds.slice(0, 3)).toEqual([0, 1450, 3652])
    expect(BalanceConfig.economicExp.levelThresholds).toHaveLength(31)
  })

  it('за два уровня разом — сила +2 и обе премии, повтор не начисляет', async () => {
    const char = await character()
    const result = await prisma.$transaction(tx => EconomyService.grantEconomicExp(tx, char.id, 4000))
    expect(result).toMatchObject({ economicLevel: 2, levelsGained: 2, levelMoney: 2 * 10_000 })
    const after = await testPrisma.character.findUniqueOrThrow({ where: { id: char.id }, include: { stats: true } })
    expect(after.money).toBe(1000 + 2 * 10_000)
    expect(after.stats?.str).toBe(6)
    // Ещё опыта, но без нового уровня — ни силы, ни денег.
    await prisma.$transaction(tx => EconomyService.grantEconomicExp(tx, char.id, 100))
    const again = await testPrisma.character.findUniqueOrThrow({ where: { id: char.id }, include: { stats: true } })
    expect(again.money).toBe(after.money)
    expect(again.stats?.str).toBe(6)
  })
})
