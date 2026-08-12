import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../shared/db/prisma'
import { audit } from '../../shared/logger/audit-logger'
import { authenticateAdmin } from '../../shared/security/auth-middleware'
import { generateJti, revokeAdminSession, storeAdminSession } from '../../shared/security/jwt'
import { verifyPassword } from '../../shared/security/password'

const AdminLoginSchema = z.object({
  username: z.string().trim().min(1).max(64).optional(),
  login: z.string().trim().min(1).max(64).optional(),
  password: z.string().min(1).max(256),
}).refine(data => Boolean(data.username || data.login), { message: 'login is required', path: ['login'] })

const ADMIN_AUTH_RATE_LIMIT = {
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
}

export async function adminAuthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/login', ADMIN_AUTH_RATE_LIMIT, async (req: FastifyRequest, reply: FastifyReply) => {
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

  fastify.post('/logout', { preHandler: authenticateAdmin }, async (req, reply) => {
    await revokeAdminSession(req.adminUser.jti)
    audit('admin.action', { action: 'logout', adminId: req.adminUser.adminId, ip: req.ip })
    return reply.send({ message: 'Logged out' })
  })
}
