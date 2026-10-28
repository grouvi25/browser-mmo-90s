/**
 * Удаление реплик из эфира (заказчик 28.10: «возможность удалять админу
 * сообщения из чата»): модератор игры — из ленты, администрация — из
 * админки. Обычный игрок чужое не удаляет; в базе реплика остаётся
 * спрятанной для разбора жалоб.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { storeAdminSession, storeSession } from '../../shared/security/jwt'
import { getRedis } from '../../shared/db/redis'
import { cleanDatabase, testPrisma, uid } from './helpers'

let app: FastifyInstance
beforeAll(async () => { app = await buildApp(); await app.ready() })
afterAll(async () => { await app.close(); await testPrisma.$disconnect() })
beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })

async function player(isModerator = false) {
  const login = uid('ch')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const character = await testPrisma.character.create({
    data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'WORKER', hpCurrent: 100, hpMax: 100, isModerator },
  })
  const jti = randomUUID(); await storeSession(jti, user.id)
  return { character, headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id, jti })}` } }
}

const visible = async (headers: Record<string, string>) =>
  ((await app.inject({ url: '/api/chat/global', headers })).json() as { messages: { id: string }[] }).messages.map(m => m.id)

describe('удаление реплик из эфира', () => {
  it('модератор игры удаляет, обычный игрок — нет, реплика остаётся в базе спрятанной', async () => {
    const author = await player()
    const moderator = await player(true)
    const line = await testPrisma.chatMessage.create({ data: { channel: 'GLOBAL', authorId: author.character.id, body: 'реклама казино' } })

    const denied = await app.inject({ method: 'DELETE', url: `/api/chat/messages/${line.id}`, headers: author.headers })
    expect(denied.statusCode).toBe(403)
    expect(await visible(author.headers)).toContain(line.id)

    const removed = await app.inject({ method: 'DELETE', url: `/api/chat/messages/${line.id}`, headers: moderator.headers })
    expect(removed.json()).toEqual({ removed: true })
    expect(await visible(author.headers)).not.toContain(line.id)
    const row = await testPrisma.chatMessage.findUniqueOrThrow({ where: { id: line.id } })
    expect(row.deletedBy).toBe(`moderator:${moderator.character.id}`)
  })

  it('администрация удаляет из админки, поддержке нельзя', async () => {
    const author = await player()
    const line = await testPrisma.chatMessage.create({ data: { channel: 'GLOBAL', authorId: author.character.id, body: 'оскорбление' } })
    const headersFor = async (role: 'MODERATOR' | 'SUPPORT') => {
      const jti = randomUUID()
      const admin = await testPrisma.adminUser.create({ data: { username: uid('adm'), passwordHash: 'x', role } })
      await storeAdminSession(jti, admin.id)
      return { authorization: `Bearer ${app.jwt.sign({ role: 'admin', adminId: admin.id, jti })}` }
    }
    const support = await app.inject({ method: 'POST', url: `/api/admin/chat/${line.id}/hide`, headers: await headersFor('SUPPORT') })
    expect(support.statusCode).toBe(403)
    const ok = await app.inject({ method: 'POST', url: `/api/admin/chat/${line.id}/hide`, headers: await headersFor('MODERATOR') })
    expect(ok.json()).toEqual({ removed: true })
    expect(await visible(author.headers)).not.toContain(line.id)
  })
})
