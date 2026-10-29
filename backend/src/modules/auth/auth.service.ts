import { AuthRepository } from './auth.repository'
import { hashPassword, verifyPassword } from '../../shared/security/password'
import { generateJti, storeSession, revokeSession } from '../../shared/security/jwt'
import { SessionRedis } from '../../shared/db/redis'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { audit } from '../../shared/logger/audit-logger'
import type { RegisterInput, LoginInput } from './auth.schemas'
import { RegistrationGuard } from './registration-guard'
import { prisma } from '../../shared/db/prisma'
import { ReferralService } from '../referral/referral.service'
import { logger } from '../../shared/logger/logger'
import { Nickname } from '../characters/characters.schemas'

export const AuthService = {
  async register(input: RegisterInput, ip?: string, userAgent?: string) {
    // Защита от массовых регистраций (registration-guard.ts): ловушка,
    // предел по адресу, капча, годная почта — до любой работы с базой.
    RegistrationGuard.checkHoneypot(input.website)
    await RegistrationGuard.checkIpQuota(ip)
    await RegistrationGuard.checkCaptcha(input.captchaToken, ip)
    const emailNormalized = await RegistrationGuard.checkEmail(input.email)

    // Регистрация по нику (правка 29.10): ник становится именем для входа и
    // занимается сразу, до создания персонажа. Старые клиенты шлют логин.
    let nickname: string | undefined
    if (input.nickname !== undefined) {
      const parsed = Nickname.safeParse(input.nickname)
      if (!parsed.success) throw new AppError(ErrorCode.VALIDATION_ERROR, parsed.error.issues[0]?.message ?? 'Неверный ник', 422)
      nickname = parsed.data
    }
    const login = nickname ?? input.login!
    const [loginTaken, existingEmail] = await Promise.all([
      nickname ? AuthRepository.nicknameTaken(nickname) : AuthRepository.findByLogin(login).then(Boolean),
      prisma.user.findFirst({ where: { OR: [{ email: input.email }, { emailNormalized }] }, select: { id: true } }),
    ])

    if (loginTaken) {
      throw new AppError(ErrorCode.USER_ALREADY_EXISTS, nickname ? 'Такой ник уже занят' : 'Login is already taken', 409)
    }
    if (existingEmail) {
      throw new AppError(ErrorCode.USER_ALREADY_EXISTS, 'Эта почта уже зарегистрирована', 409)
    }

    const passwordHash = await hashPassword(input.password)
    const user = await AuthRepository.create({
      login,
      email: input.email,
      emailNormalized,
      passwordHash,
      lastIp: ip,
      lastUserAgent: userAgent,
      policyAcceptedAt: new Date(),
    })

    // Пригласивший — не повод сорвать регистрацию.
    await ReferralService.attach(user.id, input.ref).catch(error => logger.warn({ error }, 'referral attach failed'))
    await RegistrationGuard.recordRegistration(ip)
    audit('user.registered', { userId: user.id, login: user.login, ip })
    return { id: user.id, login: user.login, email: user.email }
  },

  async login(input: LoginInput, ip?: string, userAgent?: string) {
    // Вход по нику (правка 29.10); у старых аккаунтов — и по логину или почте.
    // Подбор пароля к одному имени режется с любого адреса.
    const lockKey = input.login.trim().toLowerCase()
    await RegistrationGuard.assertLoginNotLocked(lockKey)
    const candidates = await AuthRepository.findForSignIn(input.login)
    let user: (typeof candidates)[number] | undefined
    for (const candidate of candidates) {
      if (await verifyPassword(input.password, candidate.passwordHash)) { user = candidate; break }
    }
    if (!user) {
      await RegistrationGuard.recordLoginFailure(lockKey)
      audit('user.login_failed', { login: input.login, reason: candidates.length ? 'bad_password' : 'not_found', ip })
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid login or password', 401)
    }

    if (user.status === 'BANNED') {
      throw new AppError(ErrorCode.USER_BANNED, `Account banned: ${user.banReason ?? 'no reason'}`, 403)
    }

    await RegistrationGuard.clearLoginFailures(lockKey)
    await AuthRepository.updateLastLogin(user.id, ip, userAgent)

    // SINGLE DEVICE: revoke all previous sessions before creating new one
    await SessionRedis.revokeAllForUser(user.id)

    const jti = generateJti()
    await storeSession(jti, user.id)

    audit('user.login', { userId: user.id, login: user.login, ip })
    return { userId: user.id, jti, login: user.login }
  },

  async logout(jti: string, userId: string): Promise<void> {
    await revokeSession(jti)
    audit('user.logout', { userId })
  },
}
