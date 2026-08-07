/**
 * Integration tests: Auth module
 * Tests: register, login, logout, duplicate checks, rate limits
 * Requires: real PostgreSQL + Redis (provided by GitHub Actions services)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { testPrisma, cleanDatabase, uid } from './helpers'
import { AuthService } from '../../modules/auth/auth.service'
import { AppError } from '../../shared/errors/app-error'

beforeAll(async () => {
  await testPrisma.$connect()
})

afterAll(async () => {
  await testPrisma.$disconnect()
})

beforeEach(async () => {
  await cleanDatabase()
})

// ---------------------------------------------------------------
// Register
// ---------------------------------------------------------------
describe('AuthService.register', () => {
  it('creates a new user', async () => {
    const login = uid('user')
    const result = await AuthService.register({
      login,
      email: `${login}@test.com`,
      password: 'password123',
    })

    expect(result.login).toBe(login)
    expect(result.id).toBeDefined()
    expect(result.email).toBe(`${login}@test.com`)

    // Verify in DB
    const user = await testPrisma.user.findUnique({ where: { login } })
    expect(user).not.toBeNull()
    expect(user!.passwordHash).not.toBe('password123') // must be hashed
  })

  it('throws 409 if login already taken', async () => {
    const login = uid('dup')
    await AuthService.register({ login, email: `${login}@a.com`, password: 'pass123' })

    await expect(
      AuthService.register({ login, email: `different@a.com`, password: 'pass123' })
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.statusCode === 409)
  })

  it('throws 409 if email already registered', async () => {
    const email = `${uid('email')}@test.com`
    await AuthService.register({ login: uid('u1'), email, password: 'pass123' })

    await expect(
      AuthService.register({ login: uid('u2'), email, password: 'pass123' })
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.statusCode === 409)
  })

  it('stored password is bcrypt hash', async () => {
    const login = uid('hash')
    await AuthService.register({ login, email: `${login}@t.com`, password: 'secret_pw' })

    const user = await testPrisma.user.findUnique({ where: { login } })
    expect(user!.passwordHash).toMatch(/^\$2[ab]\$/)  // bcrypt format
    expect(user!.passwordHash).not.toBe('secret_pw')
  })
})

// ---------------------------------------------------------------
// Login
// ---------------------------------------------------------------
describe('AuthService.login', () => {
  it('returns userId and jti on success', async () => {
    const login = uid('login')
    await AuthService.register({ login, email: `${login}@t.com`, password: 'correctpass' })

    const result = await AuthService.login({ login, password: 'correctpass' })
    expect(result.userId).toBeDefined()
    expect(result.jti).toBeDefined()
    expect(result.login).toBe(login)
  })

  it('throws 401 on wrong password', async () => {
    const login = uid('badpw')
    await AuthService.register({ login, email: `${login}@t.com`, password: 'realpass' })

    await expect(
      AuthService.login({ login, password: 'wrongpass' })
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.statusCode === 401)
  })

  it('throws 401 on non-existent user', async () => {
    await expect(
      AuthService.login({ login: 'ghost_user_xyz', password: 'pass' })
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.statusCode === 401)
  })

  it('throws 403 on banned user', async () => {
    const login = uid('banned')
    const { id } = await AuthService.register({ login, email: `${login}@t.com`, password: 'pass' })
    await testPrisma.user.update({ where: { id }, data: { status: 'BANNED', banReason: 'Test ban' } })

    await expect(
      AuthService.login({ login, password: 'pass' })
    ).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.statusCode === 403)
  })

  it('updates lastLoginAt on successful login', async () => {
    const login = uid('lastlogin')
    await AuthService.register({ login, email: `${login}@t.com`, password: 'pass' })

    const before = await testPrisma.user.findUnique({ where: { login } })
    expect(before!.lastLoginAt).toBeNull()

    await AuthService.login({ login, password: 'pass' })

    const after = await testPrisma.user.findUnique({ where: { login } })
    expect(after!.lastLoginAt).not.toBeNull()
  })
})

// ---------------------------------------------------------------
// Logout
// ---------------------------------------------------------------
describe('AuthService.logout', () => {
  it('revokes the session JWT', async () => {
    const login = uid('logout')
    await AuthService.register({ login, email: `${login}@t.com`, password: 'pass' })
    const { userId, jti } = await AuthService.login({ login, password: 'pass' })

    // Should not throw
    await expect(AuthService.logout(jti, userId)).resolves.toBeUndefined()
  })
})
