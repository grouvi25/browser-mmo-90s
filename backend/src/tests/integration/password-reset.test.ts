/**
 * Восстановление пароля (просьба игроков 26–27.10). Ссылка одноразовая,
 * живёт час, ответ на заявку одинаков для существующих и чужих логинов.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { cleanDatabase, testPrisma, uid } from './helpers'
import { getRedis, disconnectRedis } from '../../shared/db/redis'
import { AuthService } from '../../modules/auth/auth.service'
import { PasswordResetService } from '../../modules/auth/password-reset.service'

// Бот администрации — заглушкой: тест не должен слать в настоящий Telegram.
const sent: string[] = []
vi.mock('../../modules/admin-balance/telegram.service', () => ({
  telegramConfigured: () => true,
  sendTelegram: async (text: string) => { sent.push(text); return { ok: true } },
}))

async function account() {
  const login = uid('pw')
  await AuthService.register({ login, email: `${login}@Example.test`, password: 'old_password_1', acceptPolicy: true })
  return login
}

/** Токен в базе только хешем — для теста подменяем хеш известным токеном. */
async function knownToken(login: string, token: string, expiresAt = new Date(Date.now() + 60_000)) {
  const user = await testPrisma.user.findUniqueOrThrow({ where: { login } })
  await testPrisma.passwordReset.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt } })
}

describe('восстановление пароля', () => {
  beforeAll(async () => { await testPrisma.$connect(); await getRedis().ping() })
  beforeEach(async () => { await cleanDatabase(); await getRedis().flushdb(); sent.length = 0 })
  afterAll(async () => { await testPrisma.$disconnect(); await disconnectRedis() })

  it('заявка по логину и по почте в любом регистре; чужой логин — тот же ответ без записи', async () => {
    const login = await account()
    await expect(PasswordResetService.request(login)).resolves.toEqual({ ok: true })
    expect(await testPrisma.passwordReset.count()).toBe(1)
    // Администрации — логин, почта и ссылка на страницу нового пароля.
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain(login)
    expect(sent[0]).toMatch(/\/reset-password\?token=[A-Za-z0-9_-]{43}/)
    await expect(PasswordResetService.request('nobody_here')).resolves.toEqual({ ok: true })
    expect(await testPrisma.passwordReset.count()).toBe(1)
    expect(sent).toHaveLength(1)
    // Повтор в течение пяти минут новую ссылку не плодит.
    await PasswordResetService.request(`${login}@example.TEST`)
    expect(await testPrisma.passwordReset.count()).toBe(1)
  })

  it('по ссылке ставится новый пароль, старый перестаёт подходить, ссылка второй раз не работает', async () => {
    const login = await account()
    await knownToken(login, 'a'.repeat(43))
    await expect(PasswordResetService.reset('a'.repeat(43), 'new_password_2')).resolves.toEqual({ login })
    await expect(AuthService.login({ login, password: 'new_password_2' })).resolves.toMatchObject({ login })
    await expect(AuthService.login({ login, password: 'old_password_1' })).rejects.toMatchObject({ statusCode: 401 })
    await expect(PasswordResetService.reset('a'.repeat(43), 'third_password_3')).rejects.toMatchObject({ statusCode: 400 })
  })

  it('просроченная и выдуманная ссылки не срабатывают', async () => {
    const login = await account()
    await knownToken(login, 'b'.repeat(43), new Date(Date.now() - 1000))
    await expect(PasswordResetService.reset('b'.repeat(43), 'new_password_2')).rejects.toMatchObject({ statusCode: 400 })
    await expect(PasswordResetService.reset('c'.repeat(43), 'new_password_2')).rejects.toMatchObject({ statusCode: 400 })
    await expect(AuthService.login({ login, password: 'old_password_1' })).resolves.toMatchObject({ login })
  })
})
