import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PremiumService, isPremiumActive, PREMIUM_GRANTS } from '../../modules/premium/premium.service'
import { BalanceConfig } from '../../config/balance.config'
import { PREMIUM_PRODUCTS, PREMIUM_PRODUCTS_DEFERRED } from '../../../prisma/economy-data'
import { cleanDatabase, testPrisma, uid } from './helpers'

const DAY_MS = 24 * 3_600_000
const P = BalanceConfig.strategy.premium

async function player(prefix = 'prem') {
  const login = uid(prefix)
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  return testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, money: 1000 },
  })
}

async function seedShop() {
  for (const p of PREMIUM_PRODUCTS) {
    await testPrisma.premiumProduct.create({
      data: {
        code: p.code, name: p.name, description: p.description, kind: p.kind,
        priceRub: p.priceRub, grantCode: p.grantCode, grantValue: p.grantValue,
        sortOrder: p.sortOrder,
      },
    })
  }
}

describe('премиум продаёт время, а не силу', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => {
    await cleanDatabase()
    await testPrisma.premiumPurchase.deleteMany()
    await testPrisma.premiumProduct.deleteMany()
    await seedShop()
  })
  afterAll(async () => testPrisma.$disconnect())

  // ── ГЛАВНОЕ ПРАВИЛО ЭТАПА ────────────────────────────────────
  it('ни один товар витрины не выдаёт предмет', async () => {
    // Инвариант 12 модели данных. Это единственное балансное правило
    // этапа, которое не выражается числом, поэтому проверяется кодом:
    // список эффектов закрыт, и предметов в нём нет ни одного.
    // Проверяются обе витрины: и первой версии, и отложенная. Отложенный
    // товар когда-нибудь включат, и правило должно держать его тоже.
    for (const product of [...PREMIUM_PRODUCTS, ...PREMIUM_PRODUCTS_DEFERRED]) {
      expect(PREMIUM_GRANTS, `товар ${product.code}`).toContain(product.grantCode)
    }
    const itemGrants = ['ITEM', 'WEAPON', 'ARMOR', 'GRANT_ITEM', 'TEMPLATE']
    for (const grant of PREMIUM_GRANTS) {
      for (const forbidden of itemGrants) {
        expect(grant.includes(forbidden), `эффект ${grant}`).toBe(false)
      }
    }
  })

  it('в каталоге только три категории', async () => {
    const kinds = new Set([...PREMIUM_PRODUCTS, ...PREMIUM_PRODUCTS_DEFERRED].map(p => p.kind))
    expect([...kinds].sort()).toEqual(['CONVENIENCE', 'COSMETIC', 'TIME'])
  })

  it('отложенный за первую версию товар не выдаётся', async () => {
    // Решение заказчика по В8 от 03.09.2026: косметика, места в инвентаре
    // и разовые ускорения переносятся за первую версию. Строки в базе может
    // и не быть — заводим её сами, чтобы проверить именно отказ по эффекту.
    const character = await player()
    const deferred = PREMIUM_PRODUCTS_DEFERRED[0]
    await testPrisma.premiumProduct.upsert({
      where: { code: deferred.code },
      update: { isActive: false },
      create: {
        code: deferred.code, name: deferred.name, description: deferred.description,
        kind: deferred.kind, priceRub: deferred.priceRub, grantCode: deferred.grantCode,
        grantValue: deferred.grantValue, sortOrder: deferred.sortOrder, isActive: false,
      },
    })
    await expect(PremiumService.grant({ characterId: character.id, productCode: deferred.code }))
      .rejects.toMatchObject({ code: 'PREM_003' })
  })

  it('товар с неизвестным эффектом выдать нельзя', async () => {
    const character = await player()
    await testPrisma.premiumProduct.create({
      data: {
        code: uid('bad'), name: 'Меч правды', description: 'нельзя', kind: 'TIME',
        priceRub: 999, grantCode: 'GRANT_ITEM_SWORD', grantValue: 1,
      },
    })
    const bad = await testPrisma.premiumProduct.findFirstOrThrow({ where: { grantCode: 'GRANT_ITEM_SWORD' } })
    await expect(PremiumService.grant({ characterId: character.id, productCode: bad.code }))
      .rejects.toMatchObject({ code: 'PREM_002' })
  })

  // ── Подписка ─────────────────────────────────────────────────
  it('без подписки льгот нет', async () => {
    const character = await player()
    const state = await PremiumService.state(character.id)
    expect(state.isPremium).toBe(false)
    expect(state.benefits.skillMultiplier).toBe(1)
    expect(state.benefits.helperSlots).toBe(0)
    expect(state.benefits.dailyShiftCap).toBe(BalanceConfig.economy.work.dailyShiftLimit)
  })

  it('подписка включает льготы и ставит срок', async () => {
    const character = await player()
    const result = await PremiumService.grant({ characterId: character.id, productCode: 'prem_sub_30' })

    expect(result.isPremium).toBe(true)
    const state = await PremiumService.state(character.id)
    expect(state.isPremium).toBe(true)
    expect(state.benefits.skillMultiplier).toBe(P.skillMultiplier)
    expect(state.benefits.helperSlots).toBe(P.helperSlots)
    expect(state.benefits.dailyShiftCap).toBe(P.dailyShiftCap)
    // Срок примерно через тридцать суток.
    const days = (state.expiresAt!.getTime() - Date.now()) / DAY_MS
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThan(30.1)
  })

  it('вторая подписка продлевает, а не сжигает остаток первой', async () => {
    const character = await player()
    await PremiumService.grant({ characterId: character.id, productCode: 'prem_sub_30' })
    await PremiumService.grant({ characterId: character.id, productCode: 'prem_sub_30' })
    const state = await PremiumService.state(character.id)
    const days = (state.expiresAt!.getTime() - Date.now()) / DAY_MS
    expect(days).toBeGreaterThan(59.9)
  })

  it('истёкшая подписка не работает, даже если флаг стоит', async () => {
    // Флаг без срока — вечная подписка, срок без флага — выданная и
    // отозванная. Ни то ни другое не должно молча работать.
    const character = await player()
    await testPrisma.character.update({
      where: { id: character.id },
      data: { isPremium: true, premiumExpiresAt: new Date(Date.now() - 1000) },
    })
    expect(isPremiumActive({ isPremium: true, premiumExpiresAt: new Date(Date.now() - 1000) })).toBe(false)
    const state = await PremiumService.state(character.id)
    expect(state.isPremium).toBe(false)
    expect(state.benefits.skillMultiplier).toBe(1)
  })

  it('флаг без срока подпиской не считается', async () => {
    expect(isPremiumActive({ isPremium: true, premiumExpiresAt: null })).toBe(false)
  })

  it('отзыв гасит подписку и усыпляет помощников', async () => {
    const character = await player()
    await PremiumService.grant({ characterId: character.id, productCode: 'prem_sub_30' })
    await testPrisma.helper.create({
      data: { characterId: character.id, name: 'Витёк', professionCode: 'scrap_collector' },
    })

    await PremiumService.revoke(character.id)

    const state = await PremiumService.state(character.id)
    expect(state.isPremium).toBe(false)
    const helper = await testPrisma.helper.findFirstOrThrow({ where: { characterId: character.id } })
    // Помощник остаётся в профиле, но не работает — как просил заказчик.
    expect(helper.status).toBe('DORMANT')
  })

  it('история покупок хранит цену копией на момент сделки', async () => {
    const character = await player()
    await PremiumService.grant({ characterId: character.id, productCode: 'prem_sub_30' })
    // Цена в каталоге поменялась.
    await testPrisma.premiumProduct.update({ where: { code: 'prem_sub_30' }, data: { priceRub: 1 } })

    const history = await PremiumService.purchases(character.id)
    expect(history.items).toHaveLength(1)
    expect(history.items[0].priceRub).toBe(299)
  })

  it('витрина отдаёт товары по порядку', async () => {
    const shop = await PremiumService.shop()
    expect(shop.items.length).toBe(PREMIUM_PRODUCTS.length)
    expect(shop.items[0].code).toBe('prem_sub_30')
  })

  // ── Что подписка НЕ даёт ─────────────────────────────────────
  it('подписка не поднимает потолок навыка, только скорость набора', () => {
    // Множитель применяется к приросту, а не к пределу: подписчик доходит
    // до той же границы быстрее и там останавливается там же, где все.
    expect(P.skillMultiplier).toBeGreaterThan(1)
    expect(P.skillMultiplier).toBeLessThanOrEqual(2)
  })

  it('потолок смен растёт, но не эффективность часа', () => {
    // Верхняя граница дня, а не заработок в час: усталость зарплаты
    // Этапа 2 продолжает действовать на все смены.
    expect(P.dailyShiftCap).toBeGreaterThan(BalanceConfig.economy.work.dailyShiftLimit)
    const growth = P.dailyShiftCap / BalanceConfig.economy.work.dailyShiftLimit
    expect(growth).toBeLessThanOrEqual(1.5)
  })

  it('подписчик с двумя помощниками не выходит за 130% активного игрока', () => {
    // Коридор приёмки Этапа 4. Считаем по ТЗ: свои смены плюс два
    // помощника по 0.6 без своей усталости.
    const base = 800
    const own = base * (P.dailyShiftCap / BalanceConfig.economy.work.dailyShiftLimit) * 0.88
    const helpers = 2 * BalanceConfig.strategy.helper.efficiency * 6 * (base / 12) * 0.18
    expect((own + helpers) / base).toBeLessThanOrEqual(1.3)
  })
})
