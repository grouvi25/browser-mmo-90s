/**
 * Согласие с политикой обработки персональных данных при регистрации
 * (правка заказчика 21.10.2026, 152-ФЗ): без согласия сервер регистрацию
 * не принимает, с согласием запоминает его время.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../app'
import { getRedis, disconnectRedis } from '../../shared/db/redis'
import { cleanDatabase, testPrisma, uid } from './helpers'

describe('согласие с политикой при регистрации', () => {
  let app: FastifyInstance
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping(); app = await buildApp(); await app.ready() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb() })
  afterAll(async () => { await app.close(); await testPrisma.$disconnect(); await disconnectRedis() })

  const register = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/auth/register', payload })

  it('без согласия — 422 с понятным текстом, аккаунт не создаётся', async () => {
    const login = uid('noconsent')
    for (const consent of [undefined, false, 'yes']) {
      const res = await register({ login, email: `${login}@test.local`, password: 'local_pw_123', ...(consent === undefined ? {} : { acceptPolicy: consent }) })
      expect(res.statusCode).toBe(422)
      expect(res.json<{ message: string }>().message).toBe('Нужно согласие с политикой обработки персональных данных')
    }
    expect(await testPrisma.user.count({ where: { login } })).toBe(0)
  })

  it('с согласием — аккаунт создаётся и хранит время согласия', async () => {
    const login = uid('consent')
    const before = Date.now()
    const res = await register({ login, email: `${login}@test.local`, password: 'local_pw_123', acceptPolicy: true })
    expect(res.statusCode).toBe(201)
    const user = await testPrisma.user.findUniqueOrThrow({ where: { login } })
    expect(user.policyAcceptedAt).not.toBeNull()
    expect(user.policyAcceptedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('телефон по желанию: пустой — без телефона, 8XXXXXXXXXX приводится к +7, мусор — 422 с подсказкой', async () => {
    const a = uid('nophone')
    expect((await register({ login: a, email: `${a}@test.local`, password: 'local_pw_123', acceptPolicy: true })).statusCode).toBe(201)
    expect((await testPrisma.user.findUniqueOrThrow({ where: { login: a } })).phone).toBeNull()
    const b = uid('phone')
    expect((await register({ login: b, email: `${b}@test.local`, password: 'local_pw_123', acceptPolicy: true, phone: '8 (900) 123-45-67' })).statusCode).toBe(201)
    expect((await testPrisma.user.findUniqueOrThrow({ where: { login: b } })).phone).toBe('+79001234567')
    const c = uid('badphone')
    const bad = await register({ login: c, email: `${c}@test.local`, password: 'local_pw_123', acceptPolicy: true, phone: 'позвони мне' })
    expect(bad.statusCode).toBe(422)
    expect(bad.json<{ message: string }>().message).toContain('Телефон')
  })
})
