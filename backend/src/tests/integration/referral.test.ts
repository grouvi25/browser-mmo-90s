/**
 * Реферальная система (обещание игрокам 23.10, ручной вывод — заказчик
 * 28.10). Проверяется то, на чём она ломается: доля с подарков и с
 * собственных продаж дилера, вывод купленных долларов, двойная заявка и
 * возврат при отказе.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'

vi.mock('../../modules/admin-balance/telegram.service', () => ({
  telegramConfigured: () => false,
  sendTelegram: async () => ({ ok: true }),
}))

import { DollarsService } from '../../modules/dollars/dollars.service'
import { ReferralService } from '../../modules/referral/referral.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

async function player(prefix: string, opts: { dollars?: number; isDealer?: boolean; referrerId?: string } = {}) {
  const login = uid(prefix)
  const user = await testPrisma.user.create({
    data: { login, email: `${login}@test.local`, passwordHash: 'x', referrerCharacterId: opts.referrerId ?? null },
  })
  return testPrisma.character.create({
    data: { userId: user.id, nickname: login, archetype: 'WORKER', hpCurrent: 80, hpMax: 80, dollars: opts.dollars ?? 0, isDealer: opts.isDealer ?? false },
  })
}
const row = (id: string) => testPrisma.character.findUniqueOrThrow({ where: { id } })

describe('реферальная система', () => {
  beforeAll(async () => testPrisma.$connect())
  beforeEach(async () => cleanDatabase())
  afterAll(async () => testPrisma.$disconnect())

  it('ссылка с ником запоминает пригласившего, мусор и сам себя — нет', async () => {
    const host = await player('host')
    const login = uid('guest')
    const guest = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    await ReferralService.attach(guest.id, host.nickname.toUpperCase())
    expect((await testPrisma.user.findUniqueOrThrow({ where: { id: guest.id } })).referrerCharacterId).toBe(host.id)

    const self = await testPrisma.user.findUniqueOrThrow({ where: { id: host.userId } })
    await ReferralService.attach(self.id, host.nickname)
    await ReferralService.attach(self.id, 'нет_такого')
    expect((await testPrisma.user.findUniqueOrThrow({ where: { id: self.id } })).referrerCharacterId).toBeNull()
  })

  it('пригласившему — 10% на реферальный счёт с покупки у дилера, но не дилеру со своих продаж', async () => {
    const host = await player('host')
    const dealer = await player('dealer', { dollars: 1000, isDealer: true })
    const guest = await player('guest', { referrerId: host.id })
    await DollarsService.transfer(dealer.id, guest.nickname, 250, randomUUID())
    expect(await row(host.id)).toMatchObject({ dollars: 0, referralBalance: 25, referralEarned: 25 })
    expect(await row(guest.id)).toMatchObject({ dollars: 250 })

    const dealersOwn = await player('own', { referrerId: dealer.id })
    await DollarsService.transfer(dealer.id, dealersOwn.nickname, 100, randomUUID())
    expect(await row(dealer.id)).toMatchObject({ dollars: 650, referralBalance: 0 })

    // С реферального счёта — на персонажа, не больше, чем там лежит.
    await expect(ReferralService.claim(host.id, 26, randomUUID())).rejects.toMatchObject({ code: 'ECON_002' })
    await ReferralService.claim(host.id, 20, randomUUID())
    expect(await row(host.id)).toMatchObject({ dollars: 20, referralBalance: 5, referralEarned: 25 })
  })

  it('вывод с реферального счёта: заявка списывает, отказ возвращает, выплата закрывает', async () => {
    const host = await player('host', { dollars: 500 })
    await testPrisma.character.update({ where: { id: host.id }, data: { referralBalance: 60 } })
    await expect(ReferralService.requestPayout(host.id, 100, 'карта 2200 ****', randomUUID())).rejects.toMatchObject({ code: 'ECON_002' })
    await expect(ReferralService.requestPayout(host.id, 10, 'карта 2200 ****', randomUUID())).rejects.toMatchObject({ statusCode: 422 })

    const first = await ReferralService.requestPayout(host.id, 60, 'карта 2200 ****', randomUUID())
    expect(await row(host.id)).toMatchObject({ dollars: 500, referralBalance: 0 })
    await testPrisma.character.update({ where: { id: host.id }, data: { referralBalance: 60 } })
    await expect(ReferralService.requestPayout(host.id, 50, 'карта 2200 ****', randomUUID())).rejects.toMatchObject({ statusCode: 409 })
    await testPrisma.character.update({ where: { id: host.id }, data: { referralBalance: 0 } })

    const adm = await testPrisma.adminUser.create({ data: { username: uid('adm'), passwordHash: 'x', role: 'SUPER_ADMIN' } })
    await ReferralService.reject(first.id, adm.id, 'нет реквизитов')
    expect(await row(host.id)).toMatchObject({ dollars: 500, referralBalance: 60 })
    await expect(ReferralService.markPaid(first.id, adm.id)).rejects.toMatchObject({ statusCode: 409 })

    const second = await ReferralService.requestPayout(host.id, 50, 'карта 2200 ****', randomUUID())
    const paid = await ReferralService.markPaid(second.id, adm.id)
    expect(paid).toMatchObject({ status: 'PAID', processedBy: adm.id })
    expect(await row(host.id)).toMatchObject({ dollars: 500, referralBalance: 10 })

    const summary = await ReferralService.summary(host.id)
    expect(summary).toMatchObject({ sharePercent: 10, minPayout: 50, balance: 10 })
    expect(summary.payouts.map(item => item.status)).toEqual(['PAID', 'REJECTED'])
  })
})
