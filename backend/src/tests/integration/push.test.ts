/**
 * Пуши в приложение-оболочку (заказчик 06.11): телефон привязывается к игроку,
 * события игры доходят до его телефонов, удалённое приложение забывается.
 * Firebase подменён: проверяем, что и кому отправляет игра.
 */
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../app'
import { PushService, type Push } from '../../modules/push/push.service'
import { SupportService } from '../../modules/support/support.service'
import { runWorkShiftFinalize } from '../../workers/work-shift-finalize.worker'
import { disconnectRedis, getRedis } from '../../shared/db/redis'
import { storeSession } from '../../shared/security/jwt'
import { cleanDatabase, testPrisma, uid } from './helpers'

let app: FastifyInstance
let sent: Array<{ token: string; push: Push }> = []
const settle = () => new Promise(resolve => setTimeout(resolve, 150))

beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping(); app = await buildApp(); await app.ready() })
beforeEach(async () => {
  await cleanDatabase(); await getRedis().flushdb(); sent = []
  PushService.setSenderForTests(async (token, push) => { sent.push({ token, push }); return token.startsWith('gone') ? 'gone' : 'sent' })
})
afterEach(() => PushService.setSenderForTests(null))
afterAll(async () => { await app.close(); await testPrisma.$disconnect(); await disconnectRedis() })

async function player() {
  const login = uid('ph')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'WORKER', hpCurrent: 80, hpMax: 80, battleLevel: 3 } })
  const jti = randomUUID()
  await storeSession(jti, user.id)
  return { user, character, headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id, jti })}` } }
}
const phone = (prefix = 'tok') => `${prefix}-${randomUUID()}-${randomUUID()}`

describe('пуши', () => {
  it('телефон привязывается к игроку, под другим аккаунтом переходит к нему, при выходе отвязывается', async () => {
    const a = await player(); const b = await player(); const token = phone()
    expect((await app.inject({ method: 'POST', url: '/api/push/token', headers: a.headers, payload: { token } })).statusCode).toBe(200)
    expect(await testPrisma.pushDevice.findUniqueOrThrow({ where: { token } })).toMatchObject({ userId: a.user.id, platform: 'android' })
    await app.inject({ method: 'POST', url: '/api/push/token', headers: b.headers, payload: { token, platform: 'android' } })
    expect((await testPrisma.pushDevice.findUniqueOrThrow({ where: { token } })).userId).toBe(b.user.id)
    // Чужой аккаунт отвязать чужой телефон не может.
    await app.inject({ method: 'DELETE', url: '/api/push/token', headers: a.headers, payload: { token } })
    expect(await testPrisma.pushDevice.count({ where: { token } })).toBe(1)
    await app.inject({ method: 'DELETE', url: '/api/push/token', headers: b.headers, payload: { token } })
    expect(await testPrisma.pushDevice.count({ where: { token } })).toBe(0)
    expect((await app.inject({ method: 'POST', url: '/api/push/token', headers: a.headers, payload: {} })).statusCode).toBe(422)
    expect((await app.inject({ method: 'POST', url: '/api/push/token', payload: { token } })).statusCode).toBe(401)
  })

  it('личное сообщение приходит пушем получателю, а не автору', async () => {
    const a = await player(); const b = await player()
    await testPrisma.pushDevice.create({ data: { userId: a.user.id, token: phone() } })
    const token = phone()
    await testPrisma.pushDevice.create({ data: { userId: b.user.id, token } })
    const res = await app.inject({ method: 'POST', url: '/api/chat/private', headers: a.headers, payload: { to: b.character.nickname, body: 'Привет, есть дело' } })
    expect(res.statusCode).toBe(201)
    await settle()
    expect(sent).toEqual([{ token, push: { title: `Личное от ${a.character.nickname}`, body: 'Привет, есть дело', url: '/', kind: 'private' } }])
  })

  it('смена закончилась — пуш хозяину смены с экраном работы', async () => {
    const a = await player(); const token = phone()
    await testPrisma.pushDevice.create({ data: { userId: a.user.id, token } })
    const object = await testPrisma.productionObject.create({ data: { code: uid('obj'), name: 'Свалка', type: 'SCRAPYARD', shiftDurationMinutes: 30, baseSalary: 80, baseProductionExp: 10 } })
    await testPrisma.workShift.create({ data: { characterId: a.character.id, productionObjectId: object.id, status: 'ACTIVE', startedAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() - 60_000), baseSalary: 80 } })
    await runWorkShiftFinalize(); await settle()
    expect(sent).toEqual([{ token, push: { title: 'Смена закончилась', body: '«Свалка»: заберите награду на экране работы', url: '/work', kind: 'work' } }])
  })

  it('ответ поддержки — пуш с ссылкой на обращение; удалённое приложение забывается', async () => {
    const a = await player(); const live = phone(); const gone = phone('gone')
    await testPrisma.pushDevice.createMany({ data: [{ userId: a.user.id, token: live }, { userId: a.user.id, token: gone }] })
    const ticket = await testPrisma.supportTicket.create({ data: { characterId: a.character.id, subject: 'Не надевается', category: 'BUG', status: 'OPEN', lastMessageAt: new Date() } })
    await SupportService.adminMessage(ticket.id, 'Поддержка', { text: 'Разобрались' })
    await settle()
    expect(sent.map(row => row.push)).toEqual([
      { title: 'Ответ поддержки', body: `Обращение №${ticket.number} «Не надевается»`, url: `/support/${ticket.id}`, kind: 'support' },
      { title: 'Ответ поддержки', body: `Обращение №${ticket.number} «Не надевается»`, url: `/support/${ticket.id}`, kind: 'support' },
    ])
    expect(await testPrisma.pushDevice.findMany({ where: { userId: a.user.id }, select: { token: true } })).toEqual([{ token: live }])
  })

  it('без ключа Firebase пуши выключены и игра не ждёт', async () => {
    PushService.setSenderForTests(null)
    const a = await player()
    await testPrisma.pushDevice.create({ data: { userId: a.user.id, token: phone() } })
    expect(PushService.enabled()).toBe(false)
    expect(await PushService.toCharacter(a.character.id, { title: 't', body: 'b', url: '/', kind: 'work' })).toBe(0)
  })
})
