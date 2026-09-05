// =============================================================
// Маршруты объявлений.
//
// Читать может любой вошедший — это городская доска. Писать и снимать
// только администрация, теми же ролями, что и остальные админские
// действия.
// =============================================================
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, requireAdminRole } from '../../shared/security/auth-middleware'
import { AnnouncementsService } from './announcements.service'
import { MAX_BODY, MAX_TITLE } from './announcements.formulas'

const Kind = z.enum(['PATCH', 'NEWS', 'WORLD'])
const Query = z.object({
  kind: Kind.optional(),
  limit: z.coerce.number().int().min(1).max(30).optional(),
})
const Publish = z.object({
  kind: Kind,
  title: z.string().min(1).max(MAX_TITLE * 2),
  body: z.string().min(1).max(MAX_BODY * 2),
  pinned: z.boolean().optional(),
})

export async function announcementsRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { kind?: string; limit?: number } }>(
    '/',
    { preHandler: authenticate },
    async (req, reply) => {
      const parsed = Query.safeParse(req.query)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      return reply.send({ items: await AnnouncementsService.feed(parsed.data.kind, parsed.data.limit) })
    },
  )

  fastify.post<{ Body: unknown }>(
    '/',
    { preHandler: requireAdminRole('SUPER_ADMIN', 'MODERATOR') },
    async (req, reply) => {
      const parsed = Publish.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      // Имя админа в запросе не лежит — в токене только идентификатор
      // и роль. Подпись под объявлением читают игроки, поэтому берём
      // настоящее имя из базы, а не показываем UUID.
      return reply.code(201).send(await AnnouncementsService.publish({
        ...parsed.data,
        adminId: req.adminUser.adminId,
      }))
    },
  )

  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireAdminRole('SUPER_ADMIN', 'MODERATOR') },
    async (req, reply) => {
      if (!z.string().uuid().safeParse(req.params.id).success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      }
      await AnnouncementsService.remove(req.params.id)
      return reply.code(204).send()
    },
  )
}
