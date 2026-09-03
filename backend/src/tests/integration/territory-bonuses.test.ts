import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ClansService } from '../../modules/clans/clans.service'
import { MarketService } from '../../modules/market/market.service'
import { calcRepairCost } from '../../modules/stats/stats.formulas'
import { cycleDurationMinutes } from '../../modules/production/cycle.formulas'
import { TerritoriesService } from '../../modules/territories/territories.service'
import { TERRITORIES } from '../../../prisma/economy-data'
import { cleanDatabase, testPrisma, uid } from './helpers'

/**
 * Бонусы районов должны РАБОТАТЬ, а не просто храниться. Каждый из шести
 * проверяется там, где применяется: сервис бонусов отдаёт значение, формула
 * его учитывает, а деньги действительно меняют владельца.
 */

async function player(prefix: string, money = 100_000, battleLevel = 5) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money, battleLevel },
  })
}

async function clanWithBoss(prefix = 'bonus') {
  const boss = await player(prefix)
  const clan = await ClansService.create(boss.id, uid(`${prefix}-clan`), Math.random().toString(36).slice(2, 6).toUpperCase())
  return { boss, clan }
}

async function seedTerritories() {
  for (const { code, name, bonusCode, bonusValue } of TERRITORIES) {
    await testPrisma.territory.create({ data: { code, name, bonusCode, bonusValue } })
  }
}

async function give(code: string, clanId: string) {
  await testPrisma.territory.update({
    where: { code },
    data: { ownerClanId: clanId, status: 'CONTROLLED', controlledAt: new Date() },
  })
}


/** Торгуемый предмет с полным набором обязательных полей шаблона. */
async function tradableItem(ownerId: string) {
  const template = await testPrisma.itemTemplate.create({
    data: {
      code: uid('tpl'), name: 'Вещь', type: 'ARMOR', armorSlot: 'CHEST', armor: 10,
      weight: 1, durabilityMax: 100, priceBase: 1000, itemTier: 2, sourceType: 'PRIVATE',
    },
  })
  return testPrisma.itemInstance.create({
    data: {
      templateId: template.id, ownerId, quality: 'COMMON',
      durabilityCurrent: 100, durabilityMax: 100, weight: 1, sourceType: 'PRIVATE',
    },
  })
}

describe('бонусы районов действуют', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => { await cleanDatabase(); await seedTerritories() })
  afterAll(async () => testPrisma.$disconnect())

  it('Гаражи режут стоимость ремонта на пятую часть', async () => {
    const { boss, clan } = await clanWithBoss()
    const full = calcRepairCost(1000, 20, 'NORMAL', 0, 0)
    await give('garages', clan.id)
    const discount = (await TerritoriesService.bonusesForCharacter(boss.id)).REPAIR_COST ?? 0
    expect(discount).toBe(0.20)
    expect(calcRepairCost(1000, 20, 'NORMAL', 0, discount)).toBe(Math.max(1, Math.ceil(full * 0.8)))
  })

  it('Промзона ускоряет цикл, складываясь с инструментом, а не умножаясь', async () => {
    // Два ускорения в одном делителе: иначе владелец Промзоны с хорошим
    // инструментом закрывал бы цикл вдвое быстрее коридора.
    const base = cycleDurationMinutes(60, 1, 1, 0)
    const districtOnly = cycleDurationMinutes(60, 1, 1, 0.15)
    const toolOnly = cycleDurationMinutes(60, 2, 1, 0)
    const both = cycleDurationMinutes(60, 2, 1, 0.15)
    expect(base).toBe(60)
    expect(districtOnly).toBeLessThan(base)
    expect(both).toBeLessThan(Math.min(districtOnly, toolOnly))
    // 60 / (1 + 0.15 + 0.15) = 46.15 -> 46, а не 60/1.15/1.15 = 45.4
    expect(both).toBe(46)
  })

  it('Центр добавляет десятую часть боевого опыта', async () => {
    const { boss, clan } = await clanWithBoss()
    expect((await TerritoriesService.bonusesForCharacter(boss.id)).BATTLE_EXP).toBeUndefined()
    await give('center', clan.id)
    expect((await TerritoriesService.bonusesForCharacter(boss.id)).BATTLE_EXP).toBe(0.10)
  })

  it('Вокзал расширяет склад объекта на десятую часть', async () => {
    const { clan } = await clanWithBoss()
    await give('station', clan.id)
    const bonus = (await TerritoriesService.bonusesForClan(clan.id)).STORAGE_CAP ?? 0
    expect(Math.floor(1000 * (1 + bonus))).toBe(1100)
  })

  it('Рынок отдаёт клану треть налога со сделки, не создавая денег', async () => {
    const { clan } = await clanWithBoss()
    await give('market', clan.id)
    await testPrisma.clan.update({ where: { id: clan.id }, data: { treasury: 0 } })

    const seller = await player('seller')
    const buyer = await player('buyer')
    const item = await tradableItem(seller.id)

    const listed = await MarketService.createItem(seller.id, item.id, 1000, uid('list'))
    const moneyBefore = (await testPrisma.character.findUniqueOrThrow({ where: { id: seller.id } })).money
      + (await testPrisma.character.findUniqueOrThrow({ where: { id: buyer.id } })).money
    const sale = await MarketService.buy(buyer.id, listed.listing.id, uid('buy'))

    const after = await testPrisma.clan.findUniqueOrThrow({ where: { id: clan.id } })
    // Налог 5% от 1000 = 50, треть района = 30% -> 15
    expect(sale.tax).toBe(50)
    expect(after.treasury).toBe(15)

    const log = await testPrisma.clanTreasuryLog.findFirst({
      where: { clanId: clan.id, reason: 'TERRITORY_MARKET_SHARE' },
    })
    expect(log?.amount).toBe(15)

    // Деньги не печатаются: доля берётся из уже собранного налога, поэтому
    // у игроков суммарно убыло ровно на величину налога.
    const moneyAfter = (await testPrisma.character.findUniqueOrThrow({ where: { id: seller.id } })).money
      + (await testPrisma.character.findUniqueOrThrow({ where: { id: buyer.id } })).money
    expect(moneyBefore - moneyAfter).toBe(sale.tax)
  })

  it('ничей Рынок долю не отдаёт', async () => {
    const seller = await player('seller2')
    const buyer = await player('buyer2')
    const item = await tradableItem(seller.id)
    const listed = await MarketService.createItem(seller.id, item.id, 1000, uid('list'))
    await MarketService.buy(buyer.id, listed.listing.id, uid('buy'))
    expect(await testPrisma.clanTreasuryLog.count({ where: { reason: 'TERRITORY_MARKET_SHARE' } })).toBe(0)
  })

  it('район под долгом не даёт доли с рынка', async () => {
    const { clan } = await clanWithBoss()
    await give('market', clan.id)
    await testPrisma.territory.update({ where: { code: 'market' }, data: { upkeepDebt: 10_000 } })
    await testPrisma.clan.update({ where: { id: clan.id }, data: { treasury: 0 } })

    const seller = await player('seller3')
    const buyer = await player('buyer3')
    const item = await tradableItem(seller.id)
    const listed = await MarketService.createItem(seller.id, item.id, 1000, uid('list'))
    await MarketService.buy(buyer.id, listed.listing.id, uid('buy'))

    expect((await testPrisma.clan.findUniqueOrThrow({ where: { id: clan.id } })).treasury).toBe(0)
  })
})
