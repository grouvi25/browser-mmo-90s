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

export const AuthService = {
  async register(input: RegisterInput, ip?: string, userAgent?: string) {
    // Защита от массовых регистраций (registration-guard.ts): ловушка,
    // предел по адресу, капча, годная почта — до любой работы с базой.
    RegistrationGuard.checkHoneypot(input.website)
    await RegistrationGuard.checkIpQuota(ip)
    await RegistrationGuard.checkCaptcha(input.captchaToken, ip)
    const emailNormalized = await RegistrationGuard.checkEmail(input.email)

    // Check uniqueness
    const [existingLogin, existingEmail] = await Promise.all([
      AuthRepository.findByLogin(input.login),
      prisma.user.findFirst({ where: { OR: [{ email: input.email }, { emailNormalized }] }, select: { id: true } }),
    ])

    if (existingLogin) {
      throw new AppError(ErrorCode.USER_ALREADY_EXISTS, 'Login is already taken', 409)
    }
    if (existingEmail) {
      throw new AppError(ErrorCode.USER_ALREADY_EXISTS, 'Email is already registered', 409)
    }

    const passwordHash = await hashPassword(input.password)
    const user = await AuthRepository.create({
      login: input.login,
      email: input.email,
      emailNormalized,
      passwordHash,
      lastIp: ip,
      lastUserAgent: userAgent,
      policyAcceptedAt: new Date(),
    })

    await RegistrationGuard.recordRegistration(ip)
    audit('user.registered', { userId: user.id, login: user.login, ip })
    return { id: user.id, login: user.login, email: user.email }
  },

  async login(input: LoginInput, ip?: string, userAgent?: string) {
    // Подбор пароля к одному логину режется с любого адреса.
    await RegistrationGuard.assertLoginNotLocked(input.login)
    const user = await AuthRepository.findByLogin(input.login)
    if (!user) {
      audit('user.login_failed', { login: input.login, reason: 'not_found', ip })
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid login or password', 401)
    }

    if (user.status === 'BANNED') {
      throw new AppError(ErrorCode.USER_BANNED, `Account banned: ${user.banReason ?? 'no reason'}`, 403)
    }

    const valid = await verifyPassword(input.password, user.passwordHash)
    if (!valid) {
      await RegistrationGuard.recordLoginFailure(input.login)
      audit('user.login_failed', { userId: user.id, login: user.login, reason: 'bad_password', ip })
      throw new AppError(ErrorCode.INVALID_CREDENTIALS, 'Invalid login or password', 401)
    }

    await RegistrationGuard.clearLoginFailures(input.login)
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
