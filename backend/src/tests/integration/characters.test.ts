/**
 * Integration tests: Characters module
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { testPrisma, cleanDatabase, uid } from './helpers'
import { AuthService } from '../../modules/auth/auth.service'
import { CharactersService } from '../../modules/characters/characters.service'
import { AppError } from '../../shared/errors/app-error'
import { calcHpMax } from '../../modules/stats/stats.formulas'
import { BalanceConfig } from '../../config/balance.config'

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
    await CharactersService.create(userId, { nickname: uid('First'), archetype: 'WORKER' })

    await expect(
      CharactersService.create(userId, { nickname: uid('Second'), archetype: 'WORKER' })
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.statusCode === 409)
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
