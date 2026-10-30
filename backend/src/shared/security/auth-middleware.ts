import { inPrison } from '../../modules/city/city.config'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AdminRole, StaffRole } from '@prisma/client'
import { LEGACY_PERMISSIONS, STAFF_ROLES, journalRole, type Permission } from './permissions'
import { AppError } from '../errors/app-error'
import { ErrorCode } from '../errors/error-codes'
import { prisma } from '../db/prisma'
import { isAdminSessionValid, isSessionValid } from './jwt'

export interface AuthUser {
  userId: string
  jti: string
}

export interface AdminAuthUser {
  /** id учётки: сотрудника (staff_members) или старой админки (admin_users). */
  adminId: string
  jti: string
  /** Роль для журнала действий — прежние три. */
  role: AdminRole
  /** Роль сотрудника; у старой учётки — null. */
  staffRole: StaffRole | null
  /** Кто: ник сотрудника или логин старой учётки — для журналов и ответов. */
  label: string
  permissions: ReadonlySet<Permission>
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser
    adminUser: AdminAuthUser
  }
}

/**
 * Fastify preHandler hook — validates JWT and checks Redis session.
 * Usage: fastify.addHook('preHandler', authenticate) or per-route.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // @fastify/jwt attaches jwtVerify to request
    const payload = await request.jwtVerify<{ sub: string; jti: string }>()

    // Check session is still alive in Redis (not revoked)
    const valid = await isSessionValid(payload.jti)
    if (!valid) {
      throw new AppError(ErrorCode.SESSION_REVOKED, 'Session has been revoked', 401)
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const character = await prisma.character.findUnique({ where: { userId: payload.sub }, select: { jailedUntil: true } })
      const path = request.url.split('?')[0]
      if (character && inPrison(character.jailedUntil) && path !== '/api/city/location' && path !== '/api/auth/logout') {
        throw AppError.forbidden('Персонаж находится в тюрьме: игровые действия недоступны до освобождения')
      }
    }
    request.authUser = {
      userId: payload.sub,
      jti:    payload.jti,
    }
  } catch (err: unknown) {
    if (err instanceof AppError) {
      reply.code(err.statusCode).send({ code: err.code, message: err.message })
      return
    }
    reply.code(401).send({ code: ErrorCode.TOKEN_INVALID, message: 'Invalid or expired token' })
  }
}

/**
 * Optional admin authentication middleware.
 */
export async function authenticateAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const payload = await request.jwtVerify<{ role?: string; adminId?: string; staffId?: string; jti: string }>()
    const accountId = payload.staffId ?? payload.adminId
    if (payload.role !== 'admin' || !accountId) {
      throw AppError.forbidden('Admin access required')
    }
    if (!(await isAdminSessionValid(payload.jti, accountId))) {
      throw new AppError(ErrorCode.SESSION_REVOKED, 'Session has been revoked', 401)
    }
    if (payload.staffId) {
      // Сотрудник — игровой аккаунт с ролью (правка 30.10). Снятая роль,
      // выключенный сотрудник или забаненный аккаунт закрывают доступ сразу.
      const staff = await prisma.staffMember.findUnique({
        where: { id: payload.staffId },
        select: { role: true, isActive: true, user: { select: { login: true, status: true, character: { select: { nickname: true } } } } },
      })
      if (!staff?.isActive || staff.user.status === 'BANNED') {
        throw new AppError(ErrorCode.SESSION_REVOKED, 'Admin account is inactive', 401)
      }
      request.adminUser = {
        adminId: payload.staffId, jti: payload.jti, role: journalRole(staff.role), staffRole: staff.role,
        label: staff.user.character?.nickname ?? staff.user.login, permissions: new Set(STAFF_ROLES[staff.role].permissions),
      }
      return
    }
    const admin = await prisma.adminUser.findUnique({
      where: { id: accountId },
      select: { role: true, isActive: true, username: true },
    })
    if (!admin?.isActive) {
      throw new AppError(ErrorCode.SESSION_REVOKED, 'Admin account is inactive', 401)
    }
    request.adminUser = {
      adminId: accountId, jti: payload.jti, role: admin.role, staffRole: null,
      label: admin.username, permissions: new Set(LEGACY_PERMISSIONS[admin.role]),
    }
  } catch (err: unknown) {
    if (err instanceof AppError) {
      reply.code(err.statusCode).send({ code: err.code, message: err.message })
      return
    }
    reply.code(401).send({ code: ErrorCode.UNAUTHORIZED, message: 'Unauthorized' })
  }
}

/** Ручка админки требует одно право (shared/security/permissions.ts). */
export function requirePermission(permission: Permission) {
  return async function authorizePermission(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await authenticateAdmin(request, reply)
    if (reply.sent) return
    if (!request.adminUser.permissions.has(permission)) {
      reply.code(403).send({ code: ErrorCode.FORBIDDEN, message: 'Недостаточно прав для этого действия' })
    }
  }
}
