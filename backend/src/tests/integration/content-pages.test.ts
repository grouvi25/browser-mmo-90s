/**
 * Разделы Библиотеки и Кодекса из админки (Дима 19.11): игроки видят только
 * опубликованные и по порядку, писать может только администрация.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { storeAdminSession, storeSession } from '../../shared/security/jwt'
import { cleanDatabase, testPrisma, uid } from './helpers'

let app: FastifyInstance
beforeAll(async () => { app = await buildApp(); await app.ready() })
afterAll(async () => { await app.close(); await testPrisma.$disconnect() })

async function adminHeaders(role: 'SUPER_ADMIN' | 'SUPPORT') {
  const jti = randomUUID()
  const admin = await testPrisma.adminUser.create({ data: { username: uid('admin'), passwordHash: 'test-only', role } })
  await storeAdminSession(jti, admin.id)
  return { authorization: `Bearer ${app.jwt.sign({ role: 'admin', adminId: admin.id, jti })}` }
}

async function playerHeaders() {
  const login = uid('reader')
  const user = await testPrisma.user.create({ data: { login, email: `${login}@test.local`, passwordHash: 'x' } })
  const jti = randomUUID()
  await storeSession(jti, user.id)
  return { authorization: `Bearer ${app.jwt.sign({ sub: user.id, jti })}` }
}

describe('Библиотека и Кодекс из админки', () => {
  beforeEach(async () => cleanDatabase())

  it('админ пишет раздел, игрок видит только опубликованное и по порядку', async () => {
    const admin = await adminHeaders('SUPER_ADMIN')
    const post = (body: object) => app.inject({ method: 'POST', url: '/api/admin/content', headers: admin, payload: body })
    expect((await post({ section: 'CODEX', title: 'Статья 2. Рынок', body: 'Без обмана', sortOrder: 2 })).statusCode).toBe(201)
    expect((await post({ section: 'CODEX', title: 'Статья 1. Бои', body: '## Дуэли\n- честно', sortOrder: 1 })).statusCode).toBe(201)
    const hidden = (await post({ section: 'CODEX', title: 'Черновик', body: 'еще пишется', isPublished: false })).json() as { id: string }
    expect((await post({ section: 'LIBRARY', title: 'Крафт', body: 'Как делать вещи' })).statusCode).toBe(201)

    const player = await playerHeaders()
    const codex = await app.inject({ url: '/api/content/codex', headers: player })
    expect(codex.statusCode).toBe(200)
    expect((codex.json() as { items: Array<{ title: string }> }).items.map(i => i.title)).toEqual(['Статья 1. Бои', 'Статья 2. Рынок'])

    // Опубликовали черновик — игрок его видит.
    const patch = await app.inject({ method: 'PATCH', url: `/api/admin/content/${hidden.id}`, headers: admin, payload: { isPublished: true, sortOrder: 3 } })
    expect(patch.statusCode).toBe(200)
    const after = await app.inject({ url: '/api/content/codex', headers: player })
    expect((after.json() as { items: unknown[] }).items).toHaveLength(3)

    const library = await app.inject({ url: '/api/content/library', headers: player })
    expect((library.json() as { items: Array<{ title: string }> }).items.map(i => i.title)).toEqual(['Крафт'])

    expect((await app.inject({ method: 'DELETE', url: `/api/admin/content/${hidden.id}`, headers: admin })).statusCode).toBe(200)
    expect((await app.inject({ url: '/api/admin/content?section=CODEX', headers: admin })).json()).toMatchObject({ items: expect.any(Array) })
    // Предпросмотр редактора видит те же таблицы и числа, что игроки.
    const tables = await app.inject({ url: '/api/admin/content/tables', headers: admin })
    expect(tables.statusCode).toBe(200)
    expect(tables.json()).toMatchObject({ battle: expect.any(Array), rules: expect.any(Object) })
  })

  it('без прав писать нельзя, без входа читать нельзя', async () => {
    const support = await adminHeaders('SUPPORT')
    const denied = await app.inject({ method: 'POST', url: '/api/admin/content', headers: support, payload: { section: 'CODEX', title: 'x', body: 'y' } })
    expect(denied.statusCode).toBe(403)
    expect((await app.inject({ url: '/api/content/codex' })).statusCode).toBe(401)
    const player = await playerHeaders()
    expect((await app.inject({ url: '/api/content/unknown', headers: player })).statusCode).toBe(404)
  })
})
