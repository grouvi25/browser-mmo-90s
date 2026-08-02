import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { getRedis } from '../../shared/db/redis'
import { hashPassword } from '../../shared/security/password'
import { cleanDatabase, testPrisma, uid } from './helpers'

describe('admin authentication', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    await testPrisma.$connect()
    app = await buildApp()
    await app.ready()
  })

  beforeEach(async () => {
    await cleanDatabase()
    await testPrisma.adminUser.deleteMany()
    const username = uid('admin')
    await testPrisma.adminUser.create({
      data: { username, passwordHash: await hashPassword('correct-password'), role: 'SUPER_ADMIN' },
    })
    ;(globalThis as { adminUsername?: string }).adminUsername = username
  })

  afterAll(async () => {
    await testPrisma.adminUser.deleteMany()
    await app.close()
    await testPrisma.$disconnect()
  })

  it('issues an admin-scoped token and permits protected admin routes', async () => {
    const username = (globalThis as { adminUsername: string }).adminUsername
    const login = await app.inject({
      method: 'POST', url: '/api/admin/auth/login', payload: { username, password: 'correct-password' },
    })
    expect(login.statusCode).toBe(200)
    const body = login.json<{ token: string; adminId: string; role: string }>()
    expect(body.token).toBeTruthy()
    expect(body.role).toBe('SUPER_ADMIN')

    const payload = app.jwt.decode<{ role: string; adminId: string; jti: string }>(body.token)!
    expect(payload.role).toBe('admin')
    expect(payload.adminId).toBe(body.adminId)

    const stats = await app.inject({
      method: 'GET', url: '/api/admin/stats', headers: { authorization: `Bearer ${body.token}` },
    })
    expect(stats.statusCode).toBe(200)
  })

  it('returns one generic error for bad password and inactive accounts', async () => {
    const username = (globalThis as { adminUsername: string }).adminUsername
    const badPassword = await app.inject({
      method: 'POST', url: '/api/admin/auth/login', payload: { username, password: 'wrong' },
    })
    expect(badPassword.statusCode).toBe(401)
    expect(badPassword.json()).toMatchObject({ code: 'AUTH_001', message: 'Invalid credentials' })

    await testPrisma.adminUser.update({ where: { username }, data: { isActive: false } })
    const inactive = await app.inject({
      method: 'POST', url: '/api/admin/auth/login', payload: { username, password: 'correct-password' },
    })
    expect(inactive.statusCode).toBe(401)
    expect(inactive.json()).toEqual(badPassword.json())
  })

  it('revokes the admin session on logout', async () => {
    const username = (globalThis as { adminUsername: string }).adminUsername
    const login = await app.inject({
      method: 'POST', url: '/api/admin/auth/login', payload: { username, password: 'correct-password' },
    })
    const token = login.json<{ token: string }>().token
    const payload = app.jwt.decode<{ jti: string }>(token)!

    const logout = await app.inject({
      method: 'POST', url: '/api/admin/auth/logout', headers: { authorization: `Bearer ${token}` },
    })
    expect(logout.statusCode).toBe(200)
    expect(await getRedis().get(`admin_session:${payload.jti}`)).toBeNull()

    const denied = await app.inject({
      method: 'GET', url: '/api/admin/stats', headers: { authorization: `Bearer ${token}` },
    })
    expect(denied.statusCode).toBe(401)
  })
})
