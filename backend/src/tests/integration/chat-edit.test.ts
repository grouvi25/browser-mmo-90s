/**
 * Правка своей реплики (обращение №57): опечатка или личное, ушедшее в общий
 * канал. Править можно только своё и только первые минуты; игроки видят
 * пометку «изменено», админ — исходный текст.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { storeAdminSession, storeSession } from '../../shared/security/jwt'
import { getRedis } from '../../shared/db/redis'
import { CHAT_EDIT_MINUTES } from '../../modules/chat/chat.service'
import { cleanDatabase, testPrisma, uid } from './helpers'

let app: FastifyInstance
beforeAll(async () => { app = await buildApp(); await app.ready() })
afterAll(async () => { await app.close(); await testPrisma.$disconnect() })
beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })

async function player() {
  const login = uid('ce')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'WORKER', hpCurrent: 100, hpMax: 100 },
  })
  const jti = randomUUID(); await storeSession(jti, user.id)
  return { character, headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id, jti })}` } }
}

async function adminHeaders() {
  const jti = randomUUID()
  const admin = await testPrisma.adminUser.create({ data: { username: uid('adm'), passwordHash: 'x', role: 'MODERATOR' } })
  await storeAdminSession(jti, admin.id)
  return { authorization: `Bearer ${app.jwt.sign({ role: 'admin', adminId: admin.id, jti })}` }
}

describe('правка своей реплики в чате', () => {
  it('автор правит, лента показывает новый текст с пометкой, админ видит исходный', async () => {
    const author = await player()
    const sent = await app.inject({ method: 'POST', url: '/api/chat/global', headers: author.headers, payload: { body: 'встречаемся в 8 у мэрии' } })
    expect(sent.statusCode).toBe(201)
    const id = sent.json().id as string

    const edited = await app.inject({ method: 'PATCH', url: `/api/chat/messages/${id}`, headers: author.headers, payload: { body: 'встречаемся в 9 у мэрии' } })
    expect(edited.statusCode).toBe(200)
    expect(edited.json()).toMatchObject({ id, body: 'встречаемся в 9 у мэрии' })
    expect(edited.json().editedAt).toBeTruthy()

    // Вторая правка не затирает самый первый текст.
    await app.inject({ method: 'PATCH', url: `/api/chat/messages/${id}`, headers: author.headers, payload: { body: 'встречаемся в 10 у мэрии' } })

    const feed = (await app.inject({ url: '/api/chat/global', headers: author.headers })).json().messages as { id: string; body: string; editedAt?: string; originalBody?: string }[]
    const line = feed.find(m => m.id === id)!
    expect(line.body).toBe('встречаемся в 10 у мэрии')
    expect(line.editedAt).toBeTruthy()
    expect(line.originalBody).toBeUndefined()

    const log = (await app.inject({ url: '/api/admin/chat?days=1', headers: await adminHeaders() })).json().items as { id: string; text: string; original: string | null }[]
    expect(log.find(r => r.id === id)).toMatchObject({ text: 'встречаемся в 10 у мэрии', original: 'встречаемся в 8 у мэрии' })
  })

  it('чужое, удалённое, старое и пустое не правится', async () => {
    const author = await player()
    const other = await player()
    const line = await testPrisma.chatMessage.create({ data: { channel: 'GLOBAL', authorId: author.character.id, body: 'привет' } })

    const foreign = await app.inject({ method: 'PATCH', url: `/api/chat/messages/${line.id}`, headers: other.headers, payload: { body: 'взлом' } })
    expect(foreign.statusCode).toBe(404)

    const empty = await app.inject({ method: 'PATCH', url: `/api/chat/messages/${line.id}`, headers: author.headers, payload: { body: '   ' } })
    expect(empty.statusCode).toBe(422)

    const old = await testPrisma.chatMessage.create({
      data: { channel: 'GLOBAL', authorId: author.character.id, body: 'давно', createdAt: new Date(Date.now() - (CHAT_EDIT_MINUTES + 1) * 60_000) },
    })
    const late = await app.inject({ method: 'PATCH', url: `/api/chat/messages/${old.id}`, headers: author.headers, payload: { body: 'поздно' } })
    expect(late.statusCode).toBe(409)

    await testPrisma.chatMessage.update({ where: { id: line.id }, data: { deletedAt: new Date(), deletedBy: 'moderator:x' } })
    const hidden = await app.inject({ method: 'PATCH', url: `/api/chat/messages/${line.id}`, headers: author.headers, payload: { body: 'вернул' } })
    expect(hidden.statusCode).toBe(404)

    expect((await testPrisma.chatMessage.findUniqueOrThrow({ where: { id: line.id } })).body).toBe('привет')
  })
})

describe('жалоба на реплику в чате', () => {
  it('уходит в поддержку обращением «Жалоба» с текстом реплики; на своё и дважды — нельзя', async () => {
    const author = await player()
    const reporter = await player()
    const line = await testPrisma.chatMessage.create({ data: { channel: 'GLOBAL', authorId: author.character.id, body: 'ты лох' } })

    const own = await app.inject({ method: 'POST', url: `/api/chat/messages/${line.id}/report`, headers: author.headers, payload: {} })
    expect(own.statusCode).toBe(422)

    const ok = await app.inject({ method: 'POST', url: `/api/chat/messages/${line.id}/report`, headers: reporter.headers, payload: { reason: 'оскорбление' } })
    expect(ok.statusCode).toBe(201)
    const ticket = await testPrisma.supportTicket.findFirstOrThrow({ where: { characterId: reporter.character.id } })
    expect(ticket.category).toBe('COMPLAINT')
    const first = await testPrisma.supportMessage.findFirstOrThrow({ where: { ticketId: ticket.id } })
    expect(first.text).toContain('«ты лох»')
    expect(first.text).toContain('Причина: оскорбление')

    const again = await app.inject({ method: 'POST', url: `/api/chat/messages/${line.id}/report`, headers: reporter.headers, payload: {} })
    expect(again.statusCode).toBe(409)
    expect(await testPrisma.supportTicket.count({ where: { characterId: reporter.character.id } })).toBe(1)
  })

  it('на чужую личку пожаловаться нельзя — только получатель', async () => {
    const a = await player(); const b = await player(); const stranger = await player()
    const dm = await testPrisma.chatMessage.create({ data: { channel: 'PRIVATE', authorId: a.character.id, recipientId: b.character.id, body: 'привет' } })
    expect((await app.inject({ method: 'POST', url: `/api/chat/messages/${dm.id}/report`, headers: stranger.headers, payload: {} })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `/api/chat/messages/${dm.id}/report`, headers: b.headers, payload: {} })).statusCode).toBe(201)
  })
})
