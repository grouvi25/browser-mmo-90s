/**
 * Чат игроков в админке (просьба заказчика 22.10): общий эфир и районы за
 * срок; бригадные и личные сообщения — нет.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { storeAdminSession } from '../../shared/security/jwt'
import { cleanDatabase, testPrisma, uid } from './helpers'

let app: FastifyInstance
beforeAll(async () => { app = await buildApp(); await app.ready() })
afterAll(async () => { await app.close(); await testPrisma.$disconnect() })

describe('Админка: чат игроков', () => {
  beforeEach(async () => cleanDatabase())

  it('отдаёт общий чат и районы за срок, без бригадных и личных', async () => {
    const login = uid('talker')
    const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
    const author = await testPrisma.character.create({ data: { userId: user.id, nickname: login.slice(0, 20), archetype: 'STREET', hpCurrent: 100, hpMax: 100 } })
    const old = new Date(Date.now() - 10 * 24 * 3_600_000)
    await testPrisma.chatMessage.createMany({ data: [
      { channel: 'GLOBAL', authorId: author.id, body: 'Сделайте рынок дешевле' },
      { channel: 'DISTRICT', scope: 'market', authorId: author.id, body: 'кто на стрелку' },
      { channel: 'CLAN', scope: 'x', authorId: author.id, body: 'бригадное' },
      { channel: 'PRIVATE', authorId: author.id, recipientId: author.id, body: 'личное' },
      { channel: 'GLOBAL', authorId: author.id, body: 'давнее', createdAt: old },
      { channel: 'GLOBAL', authorId: author.id, body: 'спрятанное', deletedAt: new Date() },
    ] })

    const id = randomUUID()
    const admin = await testPrisma.adminUser.create({ data: { username: uid('admin'), passwordHash: 'test-only', role: 'SUPPORT' } })
    await storeAdminSession(id, admin.id)
    const headers = { authorization: `Bearer ${app.jwt.sign({ role: 'admin', adminId: admin.id, jti: id })}` }

    const week = await app.inject({ url: '/api/admin/chat?days=7', headers })
    expect(week.statusCode).toBe(200)
    const texts = (week.json() as { items: Array<{ text: string; hidden: boolean; district: string | null }> }).items
    // Сообщения созданы в одну миллисекунду — порядок между ними не задан.
    expect(texts.map(t => t.text).sort()).toEqual(['Сделайте рынок дешевле', 'кто на стрелку', 'спрятанное'].sort())
    expect(texts.find(t => t.text === 'кто на стрелку')?.district).toBe('market')
    expect(texts.find(t => t.text === 'спрятанное')?.hidden).toBe(true)

    const month = await app.inject({ url: '/api/admin/chat?days=30', headers })
    expect((month.json() as { items: unknown[] }).items).toHaveLength(4)

    expect((await app.inject({ url: '/api/admin/chat' })).statusCode).toBe(401)
  })
})
