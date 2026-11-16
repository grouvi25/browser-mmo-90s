import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testPrisma, uid } from './helpers'
import { grantProductionExp, productionLevelFromExp, productionShiftBonus } from '../../modules/professions/production-level'
import { PremiumService } from '../../modules/premium/premium.service'
import { BalanceConfig } from '../../config/balance.config'

const P = BalanceConfig.productionLevel

async function character(productionExp = 0) {
  const login = uid('prodlvl')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const c = await testPrisma.character.create({ data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 1000, productionExp } })
  await testPrisma.characterStats.create({ data: { characterId: c.id, end: 5 } })
  return c
}

// №128 (Metallica 16.11, Дима 15.11 «делаем»): третья линия прокачки.
describe('производственный уровень', () => {
  beforeAll(() => testPrisma.$connect())
  afterAll(() => testPrisma.$disconnect())

  it('пороги и смены сверху', () => {
    expect(productionLevelFromExp(0)).toBe(0)
    expect(productionLevelFromExp(P.levelThresholds[1])).toBe(1)
    expect(productionLevelFromExp(P.levelThresholds[5] - 1)).toBe(4)
    expect(productionShiftBonus(4)).toBe(0)
    expect(productionShiftBonus(5)).toBe(1)
    expect(productionShiftBonus(10)).toBe(2)
  })

  it('новый уровень: выносливость, премия в кошельке и строка игроку', async () => {
    const c = await character()
    const r = await testPrisma.$transaction(tx => grantProductionExp(tx, c.id, P.levelThresholds[1]))
    expect(r).toMatchObject({ productionLevel: 1, levelsGained: 1 })
    const after = await testPrisma.character.findUniqueOrThrow({ where: { id: c.id }, include: { stats: true } })
    expect(after.money).toBe(1000 + P.levelMoney)
    expect(after.stats?.end).toBe(5 + P.endPerLevel)
    expect(await testPrisma.currencyLog.count({ where: { characterId: c.id, reasonCode: 'LEVEL_BONUS', refType: 'production_level' } })).toBe(1)
    const notice = await testPrisma.gameNotice.findFirstOrThrow({ where: { characterId: c.id } })
    expect(notice.text).toBe(`Новый производственный уровень 1: +1 к выносливости, +${P.levelMoney.toLocaleString('ru-RU')} ₽.`)
    // Повтор без опыта ничего не выдаёт.
    expect((await testPrisma.$transaction(tx => grantProductionExp(tx, c.id, 0))).levelsGained).toBe(0)
  })

  it('догоняющая выдача по накопленному опыту: все уровни разом и смена в день', async () => {
    const c = await character(P.levelThresholds[5])
    const r = await testPrisma.$transaction(tx => grantProductionExp(tx, c.id, 0))
    expect(r).toMatchObject({ productionLevel: 5, levelsGained: 5 })
    const after = await testPrisma.character.findUniqueOrThrow({ where: { id: c.id }, include: { stats: true } })
    expect(after.money).toBe(1000 + 5 * P.levelMoney)
    expect(after.stats?.end).toBe(10)
    expect(await PremiumService.dailyShiftCap(c.id)).toBe(BalanceConfig.economy.work.dailyShiftLimit + 1)
    const notice = await testPrisma.gameNotice.findFirstOrThrow({ where: { characterId: c.id } })
    expect(notice.text).toContain('+1 смена в день')
  })
})
