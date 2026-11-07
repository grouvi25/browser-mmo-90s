/**
 * Покупка долларов через эквайринг Т-Банка (заказчик 06.11). Банк подменён:
 * проверяем, что уходит в Init, и что доллары приходят только по подписанному
 * уведомлению CONFIRMED и ровно один раз.
 */
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../app'
import { env } from '../../config/env'
import { BalanceConfig } from '../../config/balance.config'
import { tbankToken } from '../../modules/payments/tbank'
import { PushService } from '../../modules/push/push.service'
import { disconnectRedis, getRedis } from '../../shared/db/redis'
import { storeSession } from '../../shared/security/jwt'
import { cleanDatabase, testPrisma, uid } from './helpers'

const TERMINAL = 'KooperativTestDEMO'
const PASSWORD = 'test_password_123'
let app: FastifyInstance
let initCalls: Array<Record<string, unknown>> = []
const realFetch = globalThis.fetch

beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping(); app = await buildApp(); await app.ready() })
beforeEach(async () => {
  await cleanDatabase(); await getRedis().flushdb(); initCalls = []
  env.TBANK_TERMINAL_KEY = TERMINAL; env.TBANK_PASSWORD = PASSWORD; env.TBANK_RECEIPT = 'on'
  PushService.setSenderForTests(async () => 'sent')
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (!String(url).endsWith('/Init')) return realFetch(url, init)
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    initCalls.push(body)
    return new Response(JSON.stringify({ Success: true, ErrorCode: '0', Status: 'NEW', PaymentId: '3093639567', OrderId: body.OrderId, Amount: body.Amount, PaymentURL: 'https://pay.tbank.ru/new/test' }), { status: 200 })
  }))
})
afterEach(() => { vi.unstubAllGlobals(); PushService.setSenderForTests(null); env.TBANK_TERMINAL_KEY = undefined; env.TBANK_PASSWORD = undefined })
afterAll(async () => { await app.close(); await testPrisma.$disconnect(); await disconnectRedis() })

async function player(referrerId?: string) {
  const login = uid('pay')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x', referrerCharacterId: referrerId ?? null } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'WORKER', hpCurrent: 80, hpMax: 80 } })
  const jti = randomUUID()
  await storeSession(jti, user.id)
  return { user, character, headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id, jti })}` } }
}

function bankNotice(orderId: string, amount: number, status: string, extra: Record<string, unknown> = {}) {
  const body: Record<string, unknown> = { TerminalKey: TERMINAL, OrderId: orderId, Success: true, Status: status, PaymentId: 3093639567, ErrorCode: '0', Amount: amount, Pan: '430000******0777', ...extra }
  body.Token = tbankToken(body, PASSWORD)
  return body
}
const notify = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/payments/tbank/notify', payload })

describe('покупка долларов', () => {
  it('без терминала оплата выключена, а с ним видны цена и пакеты', async () => {
    const a = await player()
    env.TBANK_TERMINAL_KEY = undefined
    expect((await app.inject({ method: 'GET', url: '/api/payments/offer', headers: a.headers })).json()).toMatchObject({ enabled: false })
    expect((await app.inject({ method: 'POST', url: '/api/payments', headers: a.headers, payload: { dollars: 100 } })).statusCode).toBe(409)
    env.TBANK_TERMINAL_KEY = TERMINAL
    const offer = (await app.inject({ method: 'GET', url: '/api/payments/offer', headers: a.headers })).json()
    expect(offer).toMatchObject({ enabled: true, priceKopecks: 1200 })
    expect(offer.packs[0]).toEqual({ dollars: 100, amountKopecks: 120_000 })
  })

  it('покупка ведёт на страницу банка: подписанный Init с чеком и почтой игрока', async () => {
    const a = await player()
    const res = await app.inject({ method: 'POST', url: '/api/payments', headers: a.headers, payload: { dollars: 500 } })
    expect(res.json()).toMatchObject({ paymentUrl: 'https://pay.tbank.ru/new/test' })
    const sent = initCalls[0]
    expect(sent).toMatchObject({ TerminalKey: TERMINAL, Amount: 500 * BalanceConfig.payments.dollarPriceKopecks, PayType: 'O' })
    expect(sent.Token).toBe(tbankToken(sent, PASSWORD))
    expect(sent.NotificationURL).toMatch(/\/api\/payments\/tbank\/notify$/)
    expect(sent.Receipt).toMatchObject({ Email: a.user.email, Items: [{ Quantity: 1, Amount: 600_000, PaymentObject: 'service' }] })
    expect(await testPrisma.payment.findUniqueOrThrow({ where: { id: String(sent.OrderId) } })).toMatchObject({ status: 'PENDING', providerPaymentId: '3093639567' })
    expect((await app.inject({ method: 'POST', url: '/api/payments', headers: a.headers, payload: { dollars: 7 } })).statusCode).toBe(422)
  })

  it('CONFIRMED начисляет доллары один раз и даёт пригласившему процент', async () => {
    const host = await player(); const a = await player(host.character.id)
    await app.inject({ method: 'POST', url: '/api/payments', headers: a.headers, payload: { dollars: 1_000 } })
    const orderId = String(initCalls[0].OrderId); const amount = 1_000 * 1200
    expect((await notify(bankNotice(orderId, amount, 'AUTHORIZED'))).body).toBe('OK')
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: a.character.id } })).dollars).toBe(0)
    const ok = await notify(bankNotice(orderId, amount, 'CONFIRMED'))
    expect([ok.statusCode, ok.body]).toEqual([200, 'OK'])
    await notify(bankNotice(orderId, amount, 'CONFIRMED')) // банк повторил — второй раз не начисляем
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: a.character.id } })).dollars).toBe(1_000)
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: host.character.id } })).referralBalance).toBe(100)
    expect(await testPrisma.dollarLog.count({ where: { characterId: a.character.id, reason: 'TOPUP' } })).toBe(1)
    expect(await testPrisma.payment.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: 'CONFIRMED' })
  })

  it('поддельная подпись и чужая сумма доллары не дают', async () => {
    const a = await player()
    await app.inject({ method: 'POST', url: '/api/payments', headers: a.headers, payload: { dollars: 100 } })
    const orderId = String(initCalls[0].OrderId)
    const fake = { ...bankNotice(orderId, 120_000, 'CONFIRMED'), Token: 'deadbeef' }
    const res = await notify(fake)
    expect([res.statusCode, res.body]).toEqual([400, 'ERROR'])
    await notify(bankNotice(orderId, 1, 'CONFIRMED'))
    expect((await testPrisma.character.findUniqueOrThrow({ where: { id: a.character.id } })).dollars).toBe(0)
  })

  it('отказ банка помечает платёж, админка видит итоги', async () => {
    const a = await player()
    await app.inject({ method: 'POST', url: '/api/payments', headers: a.headers, payload: { dollars: 100 } })
    const orderId = String(initCalls[0].OrderId)
    await notify(bankNotice(orderId, 120_000, 'REJECTED', { Success: false, ErrorCode: '1051' }))
    expect((await testPrisma.payment.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('REJECTED')
    const mine = (await app.inject({ method: 'GET', url: '/api/payments/mine', headers: a.headers })).json()
    expect(mine.items).toHaveLength(1)
    expect((await app.inject({ method: 'GET', url: '/api/payments/admin/report', headers: a.headers })).statusCode).toBeGreaterThanOrEqual(401)
  })
})
