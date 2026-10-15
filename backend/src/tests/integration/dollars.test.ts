/**
 * Игровые доллары — схема заказчика (октябрь 2026): администрация выдаёт
 * доллары дилеру, дилер пополняет счёт игрока, игрок сам тратит их на
 * премиум. Проверяется то, на чём такая схема ломается: деньги из воздуха,
 * уход в минус, двойное списание и покупка без выдачи.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import { DollarsService } from '../../modules/dollars/dollars.service'
import { PremiumService } from '../../modules/premium/premium.service'
import { AdminActionsService } from '../../modules/admin-actions/admin-actions.service'
import { PREMIUM_PRODUCTS } from '../../../prisma/economy-data'
import { cleanDatabase, testPrisma, uid } from './helpers'

const REASON = 'дилер оплатил пополнение по счёту'

describe('игровые доллары', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => {
    await cleanDatabase()
    for (const p of PREMIUM_PRODUCTS) {
      await testPrisma.premiumProduct.upsert({
        where: { code: p.code },
        update: { priceDollars: p.priceDollars, isActive: true },
        create: {
          code: p.code, name: p.name, description: p.description, kind: p.kind, priceRub: p.priceRub,
          priceDollars: p.priceDollars, grantCode: p.grantCode, grantValue: p.grantValue, sortOrder: p.sortOrder,
        },
      })
    }
  })
  afterAll(async () => testPrisma.$disconnect())

  async function player(prefix: string, dollars = 0, isDealer = false) {
    const login = uid(prefix)
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    return testPrisma.character.create({
      data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, dollars, isDealer },
    })
  }
  const balance = async (id: string) => (await testPrisma.character.findUniqueOrThrow({ where: { id } })).dollars
  const admin = async () => {
    const row = await testPrisma.adminUser.create({ data: { username: uid('adm'), passwordHash: 'x', role: 'SUPER_ADMIN' } })
    return { adminId: row.id, adminRole: row.role }
  }

  it('дилер пополняет счёт игрока из своего запаса, журнал сходится', async () => {
    const dealer = await player('dealer', 500, true)
    const buyer = await player('buyer')
    const result = await DollarsService.transfer(dealer.id, buyer.nickname, 120, randomUUID())
    expect(result).toMatchObject({ amount: 120, dealerBalance: 380, targetBalance: 120 })
    expect(await balance(dealer.id)).toBe(380)
    expect(await balance(buyer.id)).toBe(120)

    const account = await DollarsService.account(buyer.id)
    expect(account.history[0]).toMatchObject({ amount: 120, balanceAfter: 120, reason: 'TRANSFER_IN', counterparty: dealer.nickname })
  })

  it('не дилер переводить не может, а дилер — больше, чем у него есть', async () => {
    const plain = await player('plain', 1_000)
    const dealer = await player('poor-dealer', 50, true)
    const buyer = await player('target')
    await expect(DollarsService.transfer(plain.id, buyer.nickname, 10, randomUUID())).rejects.toMatchObject({ statusCode: 403 })
    await expect(DollarsService.transfer(dealer.id, buyer.nickname, 51, randomUUID())).rejects.toMatchObject({ statusCode: 409 })
    expect(await balance(dealer.id)).toBe(50)
    expect(await balance(buyer.id)).toBe(0)
  })

  it('повтор перевода с тем же ключом не списывает второй раз', async () => {
    const dealer = await player('idem-dealer', 300, true)
    const buyer = await player('idem-buyer')
    const key = randomUUID()
    await DollarsService.transfer(dealer.id, buyer.nickname, 100, key)
    const replay = await DollarsService.transfer(dealer.id, buyer.nickname, 100, key)
    expect(replay.replayed).toBe(true)
    expect(await balance(dealer.id)).toBe(200)
    expect(await balance(buyer.id)).toBe(100)
  })

  it('игрок сам покупает подписку за доллары: списание и выдача вместе', async () => {
    const buyer = await player('prem', 60)
    const result = await PremiumService.buy(buyer.id, 'prem_sub_30', randomUUID())
    expect(result).toMatchObject({ isPremium: true, dollars: 10 })
    const after = await testPrisma.character.findUniqueOrThrow({ where: { id: buyer.id } })
    expect(after.isPremium).toBe(true)
    const purchase = await testPrisma.premiumPurchase.findFirstOrThrow({ where: { characterId: buyer.id } })
    expect(purchase.priceDollars).toBe(50)
  })

  it('не хватает долларов — ни списания, ни подписки', async () => {
    const buyer = await player('broke', 49)
    await expect(PremiumService.buy(buyer.id, 'prem_sub_30', randomUUID())).rejects.toMatchObject({ statusCode: 409 })
    const after = await testPrisma.character.findUniqueOrThrow({ where: { id: buyer.id } })
    expect(after.dollars).toBe(49)
    expect(after.isPremium).toBe(false)
    expect(await testPrisma.premiumPurchase.count({ where: { characterId: buyer.id } })).toBe(0)
  })

  it('выдача долларов админом откатывается, а потраченное откатом не уводит в минус', async () => {
    const ctx = await admin()
    const dealer = await player('adm-dealer')
    const granted = await AdminActionsService.perform(ctx, REASON, {
      kind: 'GRANT_DOLLARS', payload: { characterId: dealer.id, amount: 1000 },
      targetType: 'character', targetId: dealer.id,
      undo: { kind: 'TAKE_DOLLARS', payload: { characterId: dealer.id, amount: 1000 } },
    })
    expect(await balance(dealer.id)).toBe(1000)
    await AdminActionsService.rollback(ctx, granted.actionId, 'ошибся суммой при выдаче')
    expect(await balance(dealer.id)).toBe(0)

    const second = await AdminActionsService.perform(ctx, REASON, {
      kind: 'GRANT_DOLLARS', payload: { characterId: dealer.id, amount: 100 },
      targetType: 'character', targetId: dealer.id,
      undo: { kind: 'TAKE_DOLLARS', payload: { characterId: dealer.id, amount: 100 } },
    })
    await testPrisma.character.update({ where: { id: dealer.id }, data: { dollars: 30 } })
    await expect(AdminActionsService.rollback(ctx, second.actionId, 'ошибся суммой при выдаче')).rejects.toMatchObject({ statusCode: 409 })
    expect(await balance(dealer.id)).toBe(30)
  })

  it('админ назначает дилера и снимает обратно', async () => {
    const ctx = await admin()
    const someone = await player('to-dealer')
    const set = await AdminActionsService.perform(ctx, REASON, {
      kind: 'SET_DEALER', payload: { characterId: someone.id },
      targetType: 'character', targetId: someone.id,
      undo: { kind: 'UNSET_DEALER', payload: { characterId: someone.id } },
    })
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: someone.id } })).isDealer).toBe(true)
    expect((await DollarsService.dealers()).items.map(d => d.nickname)).toContain(someone.nickname)
    await AdminActionsService.rollback(ctx, set.actionId, 'назначили не того игрока')
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: someone.id } })).isDealer).toBe(false)
  })
})
