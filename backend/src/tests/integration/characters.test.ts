/**
 * Integration tests: Characters module
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest'
import { testPrisma, cleanDatabase, uid } from './helpers'
import { AuthService } from '../../modules/auth/auth.service'
import { CharactersService } from '../../modules/characters/characters.service'
import { AppError } from '../../shared/errors/app-error'
import { calcHpMax } from '../../modules/stats/stats.formulas'
import { BalanceConfig } from '../../config/balance.config'
import { env } from '../../config/env'

beforeAll(async () => { await testPrisma.$connect() })
afterAll(async () => { await testPrisma.$disconnect() })
beforeEach(async () => { await cleanDatabase() })

async function createTestUser() {
  const login = uid('char_user')
  const { id: userId } = await AuthService.register({
    login, email: `${login}@t.com`, password: 'pass123',
  })
  return { userId, login }
}

describe('Telegram о новом персонаже', () => {
  const saved = {
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID,
    TELEGRAM_SIGNUP_CHAT_ID: env.TELEGRAM_SIGNUP_CHAT_ID,
    APP_URL: env.APP_URL,
  }

  beforeEach(() => {
    env.TELEGRAM_BOT_TOKEN = 'fixture-token'
    env.TELEGRAM_CHAT_ID = '111'
    env.TELEGRAM_SIGNUP_CHAT_ID = '222'
    env.APP_URL = 'https://kooperativ.example'
  })

  afterEach(() => {
    Object.assign(env, saved)
    vi.unstubAllGlobals()
  })

  it('отправляет ник и ссылку только получателю алерта после создания персонажа', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }))
    vi.stubGlobal('fetch', send)
    const { userId } = await createTestUser()
    const nickname = 'Новый Герой'
    expect(send).not.toHaveBeenCalled()
    const char = await CharactersService.create(userId, { nickname, archetype: 'WORKER' })
    expect(char?.stats).not.toBeNull()
    expect(send).toHaveBeenCalledTimes(1)
    const [url, init] = send.mock.calls[0]
    expect(url).toBe('https://api.telegram.org/botfixture-token/sendMessage')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      chat_id: '222',
      text: `Новый персонаж: ${nickname}\n<a href="https://kooperativ.example/u/${encodeURIComponent(nickname)}">Открыть профиль</a>`,
    })
    await expect(CharactersService.create(userId, { nickname, archetype: 'WORKER' })).rejects.toMatchObject({ statusCode: 409 })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('создаёт персонажа независимо от того, ответил ли Telegram', async () => {
    let reply!: (response: Response) => void
    const send = vi.fn<typeof fetch>().mockReturnValue(new Promise(resolve => { reply = resolve }))
    vi.stubGlobal('fetch', send)
    try {
      const { userId } = await createTestUser()
      const char = await CharactersService.create(userId, { nickname: 'Герой без связи', archetype: 'WORKER' })
      expect(char?.id).toBeDefined()
      expect(send).toHaveBeenCalledTimes(1)
    } finally {
      reply(new Response('Forbidden', { status: 403 }))
    }
  })
})

// ---------------------------------------------------------------
// Create character
// ---------------------------------------------------------------
describe('CharactersService.create', () => {
  it('creates character with correct starting HP', async () => {
    const { userId } = await createTestUser()
    const char = await CharactersService.create(userId, {
      nickname: uid('Nick'),
      archetype: 'ATHLETE',
    })

    // ATHLETE: +STR +END → END = 3+1 = 4
    const expectedHp = calcHpMax(4, 1)
    expect(char!.hpMax).toBe(expectedHp)
    expect(char!.hpCurrent).toBe(expectedHp)
  })

  it('creates character with starting money', async () => {
    const { userId } = await createTestUser()
    const char = await CharactersService.create(userId, {
      nickname: uid('Rich'),
      archetype: 'MERCHANT',
    })

    expect(char!.money).toBe(BalanceConfig.character.startMoney)
  })

  it('новичку — подписка в подарок на 2 недели и строка об этом (Дима 11.11)', async () => {
    const { userId } = await createTestUser()
    const char = await CharactersService.create(userId, { nickname: uid('Prem'), archetype: 'WORKER' })
    const row = await testPrisma.character.findUniqueOrThrow({ where: { id: char!.id } })
    expect(row.isPremium).toBe(true)
    const days = (row.premiumExpiresAt!.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(13.9)
    expect(days).toBeLessThanOrEqual(14)
    expect(await testPrisma.gameNotice.count({ where: { characterId: char!.id, text: { contains: 'подписка на 14 дней' } } })).toBe(1)
  })

  it('creates stats matching archetype bonuses', async () => {
    const { userId } = await createTestUser()
    const char = await CharactersService.create(userId, {
      nickname: uid('Vet'),
      archetype: 'VETERAN',  // +REA +ACC
    })

    const stats = char!.stats!
    const base = BalanceConfig.character.baseStats
    expect(stats.rea).toBe(base.rea + 1)
    expect(stats.acc).toBe(base.acc + 1)
    // Other stats unchanged
    expect(stats.str).toBe(base.str)
    expect(stats.end).toBe(base.end)
  })

  it('throws 409 if user already has a character', async () => {
    const { userId } = await createTestUser()
    const char = await CharactersService.create(userId, { nickname: uid('First'), archetype: 'WORKER' })

    await expect(
      CharactersService.create(userId, { nickname: uid('Second'), archetype: 'WORKER' })
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.statusCode === 409)
    expect(await testPrisma.gameNotice.count({
      where: { characterId: char!.id, text: { startsWith: 'Добро пожаловать в «Кооператив»!' } },
    })).toBe(1)
  })

  it('throws 409 if nickname already taken', async () => {
    const { userId: u1 } = await createTestUser()
    const { userId: u2 } = await createTestUser()
    const sharedNick = uid('Shared')

    await CharactersService.create(u1, { nickname: sharedNick, archetype: 'STREET' })

    await expect(
      CharactersService.create(u2, { nickname: sharedNick, archetype: 'STREET' })
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.statusCode === 409)
  })

  it('STUDENT gets extra stat points', async () => {
    const { userId } = await createTestUser()
    const char = await CharactersService.create(userId, {
      nickname: uid('Student'),
      archetype: 'STUDENT',
    })
    const studentPoints = BalanceConfig.character.startingPoints['STUDENT'] ?? 0
    expect(char!.stats!.pointsAvailable).toBe(studentPoints)
  })
})

// ---------------------------------------------------------------
// Get profile
// ---------------------------------------------------------------
describe('CharactersService.getProfile', () => {
  it('returns character with stats', async () => {
    const { userId } = await createTestUser()
    await CharactersService.create(userId, { nickname: uid('Profiler'), archetype: 'SHUTTLE' })

    const profile = await CharactersService.getProfile(userId)
    expect(profile.nickname).toContain('Profiler')
    expect(profile.stats).not.toBeNull()
    expect(profile.stats!.acc).toBe(BalanceConfig.character.baseStats.acc + 1) // SHUTTLE +ACC
  })

  it('throws 404 if character not found', async () => {
    const { userId } = await createTestUser()

    await expect(
      CharactersService.getProfile(userId)
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.statusCode === 404)
  })
})
