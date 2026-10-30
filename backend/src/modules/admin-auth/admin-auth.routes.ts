import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../shared/db/prisma'
import { env } from '../../config/env'
import { audit } from '../../shared/logger/audit-logger'
import { authenticateAdmin } from '../../shared/security/auth-middleware'
import { generateJti, revokeAdminSession, storeAdminSession } from '../../shared/security/jwt'
import { verifyPassword } from '../../shared/security/password'
import { PERMISSIONS, STAFF_ROLES, journalRole } from '../../shared/security/permissions'
import { STAFF, StaffService } from '../staff/staff.service'
import { AppError } from '../../shared/errors/app-error'

const AdminLoginSchema = z.object({
  username: z.string().trim().min(1).max(64).optional(),
  login: z.string().trim().min(1).max(64).optional(),
  password: z.string().min(1).max(256),
}).refine(data => Boolean(data.username || data.login), { message: 'login is required', path: ['login'] })

const ADMIN_AUTH_RATE_LIMIT = {
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
}

/** Старый вход учёткой admin_users: на проде выключен, если не включён явно. */
export function legacyLoginEnabled(): boolean {
  return env.ADMIN_LEGACY_LOGIN ? env.ADMIN_LEGACY_LOGIN === 'on' : env.NODE_ENV !== 'production'
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof AppError) return reply.code(err.statusCode).send({ code: err.code, message: err.message })
  throw err
}

export async function adminAuthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/login', ADMIN_AUTH_RATE_LIMIT, async (req: FastifyRequest, reply: FastifyReply) => {
    if (!legacyLoginEnabled()) {
      return reply.code(410).send({ code: 'AUTH_001', message: 'Вход общей учёткой отключён — войдите своим ником' })
    }
    const parsed = AdminLoginSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    }

    const username = parsed.data.login ?? parsed.data.username!
    const admin = await prisma.adminUser.findUnique({ where: { username } })
    const passwordValid = admin
      ? await verifyPassword(parsed.data.password, admin.passwordHash)
      : false

    if (!admin || !admin.isActive || !passwordValid) {
      audit('admin.action', { action: 'login_failed', login: username, ip: req.ip })
      return reply.code(401).send({ code: 'AUTH_001', message: 'Invalid credentials' })
    }

    const jti = generateJti()
    await storeAdminSession(jti, admin.id)
    await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } })

    const token = fastify.jwt.sign(
      { role: 'admin', adminRole: admin.role, adminId: admin.id, jti },
      { expiresIn: process.env.ADMIN_JWT_EXPIRES_IN ?? '12h' },
    )

    audit('admin.action', { action: 'login', adminId: admin.id, ip: req.ip })
    return reply.send({ token, adminId: admin.id, role: admin.role })
  })

  // ── Вход сотрудника (правка 30.10): ник и пароль, затем код из письма ──

  const issue = async (grant: { staffId: string; role: Parameters<typeof journalRole>[0]; label: string; deviceToken?: string }) => {
    const jti = generateJti()
    const ttl = STAFF.sessionHours * 3600
    await storeAdminSession(jti, grant.staffId, ttl)
    const token = fastify.jwt.sign({ role: 'admin', adminRole: journalRole(grant.role), staffId: grant.staffId, jti }, { expiresIn: ttl })
    return { token, staffRole: grant.role, label: grant.label, ...(grant.deviceToken ? { deviceToken: grant.deviceToken } : {}) }
  }

  fastify.post('/staff/login', ADMIN_AUTH_RATE_LIMIT, async (req, reply) => {
    const parsed = z.object({
      nickname: z.string().trim().min(1).max(120),
      password: z.string().min(1).max(256),
      deviceToken: z.string().max(200).optional(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Введите ник и пароль' })
    try {
      const result = await StaffService.startLogin({ ...parsed.data, ip: req.ip, userAgent: req.headers['user-agent'] })
      if (result.kind === 'code') return reply.send({ step: 'code', challengeId: result.challengeId, email: result.email })
      return reply.send({ step: 'done', ...(await issue(result)) })
    } catch (err) { return sendError(reply, err) }
  })

  fastify.post('/staff/verify', ADMIN_AUTH_RATE_LIMIT, async (req, reply) => {
    const parsed = z.object({
      challengeId: z.string().uuid(),
      code: z.string().trim().regex(/^\d{6}$/),
      remember: z.boolean().optional(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Код — 6 цифр из письма' })
    try {
      const result = await StaffService.verifyCode({ ...parsed.data, ip: req.ip, userAgent: req.headers['user-agent'] })
      return reply.send({ step: 'done', ...(await issue(result)) })
    } catch (err) { return sendError(reply, err) }
  })

  /** Кто вошёл и что ему можно: админка строит меню по правам. */
  fastify.get('/me', { preHandler: authenticateAdmin }, async req => ({
    label: req.adminUser.label,
    staffRole: req.adminUser.staffRole,
    roleTitle: req.adminUser.staffRole ? STAFF_ROLES[req.adminUser.staffRole].title : `Старая учётка (${req.adminUser.role})`,
    permissions: [...req.adminUser.permissions],
    permissionTitles: PERMISSIONS,
  }))

  fastify.post('/logout', { preHandler: authenticateAdmin }, async (req, reply) => {
    await revokeAdminSession(req.adminUser.jti)
    audit('admin.action', { action: 'logout', adminId: req.adminUser.adminId, ip: req.ip })
    return reply.send({ message: 'Logged out' })
  })

  /** Выйти везде: все сессии и запомненные устройства этого сотрудника. */
  fastify.post('/logout-all', { preHandler: authenticateAdmin }, async (req, reply) => {
    if (!req.adminUser.staffRole) {
      await revokeAdminSession(req.adminUser.jti)
      return reply.send({ sessions: 1, devices: 0 })
    }
    return reply.send(await StaffService.logoutEverywhere(req.adminUser.adminId, req.adminUser.label, req.ip))
  })
}
