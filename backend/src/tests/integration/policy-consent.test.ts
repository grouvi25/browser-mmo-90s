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
      const res = await register({ login, email: `${login}@test.local`, password: 'local_pw_123', acceptPd: true, ...(consent === undefined ? {} : { acceptPolicy: consent }) })
      expect(res.statusCode).toBe(422)
      expect(res.json<{ message: string }>().message).toBe('Нужно принять пользовательское соглашение и ознакомиться с политикой обработки персональных данных')
    }
    // Галочка 2 (Дима 25.11) отдельная и тоже обязательная.
    for (const pd of [undefined, false]) {
      const res = await register({ login, email: `${login}@test.local`, password: 'local_pw_123', acceptPolicy: true, ...(pd === undefined ? {} : { acceptPd: pd }) })
      expect(res.statusCode).toBe(422)
      expect(res.json<{ message: string }>().message).toBe('Нужно дать согласие на обработку персональных данных')
    }
    expect(await testPrisma.user.count({ where: { login } })).toBe(0)
  })

  it('журнал согласий: ID, время, IP, браузер, редакция и текст каждой галочки', async () => {
    const quiet = uid('noads'), loud = uid('ads')
    const headers = { 'user-agent': 'ConsentTest/1.0' }
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', headers, remoteAddress: '203.0.113.7',
      payload: { login: quiet, email: `${quiet}@test.local`, password: 'local_pw_123', acceptPolicy: true, acceptPd: true } })).statusCode).toBe(201)
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', headers,
      payload: { login: loud, email: `${loud}@test.local`, password: 'local_pw_123', acceptPolicy: true, acceptPd: true, marketingConsent: true } })).statusCode).toBe(201)
    const quietUser = await testPrisma.user.findUniqueOrThrow({ where: { login: quiet } })
    const rows = await testPrisma.consentLog.findMany({ where: { userId: quietUser.id }, orderBy: { kind: 'asc' } })
    expect(rows.map(r => [r.kind, r.document, r.edition])).toEqual([
      ['PD_CONSENT', 'soglasie', '25.11.2026'], ['POLICY', 'politika', '08.11.2026'], ['TERMS', 'soglashenie', '08.11.2026'],
    ])
    expect(rows[0]).toMatchObject({ ip: '203.0.113.7', userAgent: 'ConsentTest/1.0', statement: 'Я даю Согласие на обработку персональных данных' })
    const loudUser = await testPrisma.user.findUniqueOrThrow({ where: { login: loud } })
    expect(await testPrisma.consentLog.findFirst({ where: { userId: loudUser.id, kind: 'MARKETING' } }))
      .toMatchObject({ document: 'rassylka', edition: '25.11.2026' })
  })

  it('с согласием — аккаунт создаётся и хранит время согласия', async () => {
    const login = uid('consent')
    const before = Date.now()
    const res = await register({ login, email: `${login}@test.local`, password: 'local_pw_123', acceptPolicy: true, acceptPd: true })
    expect(res.statusCode).toBe(201)
    const user = await testPrisma.user.findUniqueOrThrow({ where: { login } })
    expect(user.policyAcceptedAt).not.toBeNull()
    expect(user.policyAcceptedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('телефон по желанию: пустой — без телефона, 8XXXXXXXXXX приводится к +7, мусор — 422 с подсказкой', async () => {
    const a = uid('nophone')
    expect((await register({ login: a, email: `${a}@test.local`, password: 'local_pw_123', acceptPolicy: true, acceptPd: true })).statusCode).toBe(201)
    expect((await testPrisma.user.findUniqueOrThrow({ where: { login: a } })).phone).toBeNull()
    const b = uid('phone')
    expect((await register({ login: b, email: `${b}@test.local`, password: 'local_pw_123', acceptPolicy: true, acceptPd: true, phone: '8 (900) 123-45-67' })).statusCode).toBe(201)
    expect((await testPrisma.user.findUniqueOrThrow({ where: { login: b } })).phone).toBe('+79001234567')
    const c = uid('badphone')
    const bad = await register({ login: c, email: `${c}@test.local`, password: 'local_pw_123', acceptPolicy: true, acceptPd: true, phone: 'позвони мне' })
    expect(bad.statusCode).toBe(422)
    expect(bad.json<{ message: string }>().message).toContain('Телефон')
  })
})
