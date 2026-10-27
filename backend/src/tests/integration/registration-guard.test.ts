/**
 * Защита от массовых регистраций и подбора паролей (28.10).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { getRedis, disconnectRedis } from '../../shared/db/redis'
import { AuthService } from '../../modules/auth/auth.service'
import { GuardConfig } from '../../modules/auth/registration-guard'

vi.mock('../../modules/admin-balance/telegram.service', () => ({
  telegramConfigured: () => false,
  sendTelegram: async () => ({ ok: true }),
}))

const reg = (login: string, email: string, extra: Record<string, unknown> = {}, ip = '203.0.113.7') =>
  AuthService.register({ login, email, password: 'secret_pw_1', acceptPolicy: true, ...extra }, ip)

describe('защита регистрации', () => {
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb(); GuardConfig.ipDailyLimit = 0 })
  afterAll(async () => { await testPrisma.$disconnect(); await disconnectRedis() })

  it('второй аккаунт на ту же почту через точки или «+метку» не пройдёт', async () => {
    await reg(uid('a'), 'vasya.pupkin@gmail.com')
    await expect(reg(uid('b'), 'vasyapupkin+2@gmail.com')).rejects.toMatchObject({ statusCode: 409 })
    await expect(reg(uid('c'), 'V.asya.Pupkin@googlemail.com')).rejects.toMatchObject({ statusCode: 409 })
    const user = await testPrisma.user.findFirstOrThrow({ where: { email: 'vasya.pupkin@gmail.com' } })
    expect(user.emailNormalized).toBe('vasyapupkin@gmail.com')
  })

  it('одноразовая почта и заполненная ловушка — отказ', async () => {
    await expect(reg(uid('d'), 'bot@mailinator.com')).rejects.toMatchObject({ statusCode: 422, code: 'AUTH_007' })
    await expect(reg(uid('e'), 'real@gmail.com', { website: 'http://spam.example' })).rejects.toMatchObject({ statusCode: 429 })
    expect(await testPrisma.user.count()).toBe(0)
  })

  it('предел аккаунтов с одного адреса за сутки; другой адрес не затронут', async () => {
    GuardConfig.ipDailyLimit = 2
    await reg(uid('f'), 'one@mail.ru')
    await reg(uid('g'), 'two@mail.ru')
    await expect(reg(uid('h'), 'three@mail.ru')).rejects.toMatchObject({ statusCode: 429, code: 'AUTH_008' })
    await expect(reg(uid('i'), 'four@mail.ru', {}, '198.51.100.9')).resolves.toBeTruthy()
  })

  it('десять неверных паролей закрывают вход в логин даже с верным паролем', async () => {
    const login = uid('j')
    await reg(login, 'victim@mail.ru')
    for (let i = 0; i < GuardConfig.loginFailLimit; i++) {
      await expect(AuthService.login({ login, password: `wrong_${i}` })).rejects.toMatchObject({ statusCode: 401 })
    }
    await expect(AuthService.login({ login, password: 'secret_pw_1' })).rejects.toMatchObject({ statusCode: 429, code: 'AUTH_008' })
  })

  it('удачный вход обнуляет счётчик ошибок', async () => {
    const login = uid('k')
    await reg(login, 'owner@mail.ru')
    for (let i = 0; i < GuardConfig.loginFailLimit - 1; i++) {
      await expect(AuthService.login({ login, password: 'nope' })).rejects.toMatchObject({ statusCode: 401 })
    }
    await expect(AuthService.login({ login, password: 'secret_pw_1' })).resolves.toMatchObject({ login })
    await expect(AuthService.login({ login, password: 'nope' })).rejects.toMatchObject({ statusCode: 401 })
    await expect(AuthService.login({ login, password: 'secret_pw_1' })).resolves.toMatchObject({ login })
  })
})
