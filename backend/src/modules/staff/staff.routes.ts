import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requirePermission } from '../../shared/security/auth-middleware'
import { STAFF_ROLES } from '../../shared/security/permissions'
import { StaffService } from './staff.service'

const STAFF_ADMIN = { preHandler: requirePermission('staff') }
const Role = z.enum(Object.keys(STAFF_ROLES) as [keyof typeof STAFF_ROLES, ...(keyof typeof STAFF_ROLES)[]])

/** Сотрудники и роли — /api/admin/staff (только владельцы). */
export async function staffRoutes(fastify: FastifyInstance) {
  fastify.get('/', STAFF_ADMIN, async () => StaffService.list())

  fastify.get('/events', STAFF_ADMIN, async () => StaffService.events())

  fastify.post('/', STAFF_ADMIN, async (req, reply) => {
    const parsed = z.object({ nickname: z.string().trim().min(1).max(64), role: Role }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Укажите ник игрока и роль' })
    return reply.send(await StaffService.add(parsed.data, { label: req.adminUser.label, ip: req.ip }))
  })

  fastify.patch<{ Params: { id: string } }>('/:id', STAFF_ADMIN, async (req, reply) => {
    const parsed = z.object({ role: Role.optional(), isActive: z.boolean().optional() }).safeParse(req.body)
    if (!parsed.success || !z.string().uuid().safeParse(req.params.id).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const by = { staffId: req.adminUser.staffRole ? req.adminUser.adminId : null, label: req.adminUser.label, ip: req.ip }
    return reply.send(await StaffService.update(req.params.id, parsed.data, by))
  })
}
