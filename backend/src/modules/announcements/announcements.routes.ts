// =============================================================
// Маршруты объявлений.
//
// Читать может любой вошедший — это городская доска. Писать и снимать
// только администрация, теми же ролями, что и остальные админские
// действия.
// =============================================================
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, requirePermission } from '../../shared/security/auth-middleware'
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

  // Сводка для главной страницы (28.10): её видит и гость. Только новости и
  // обновления администрации — события мира остаются внутри игры.
  fastify.get<{ Querystring: { kind?: string; limit?: number } }>(
    '/public',
    async (req, reply) => {
      const parsed = Query.safeParse(req.query)
      if (!parsed.success || parsed.data.kind === 'WORLD') return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const items = await AnnouncementsService.feed(parsed.data.kind, parsed.data.limit ?? 6)
      return reply.send({ items: items.filter(item => item.kind !== 'WORLD').map(({ authorLogin: _author, ...item }) => item) })
    },
  )

  fastify.post<{ Body: unknown }>(
    '/',
    { preHandler: requirePermission('content') },
    async (req, reply) => {
      const parsed = Publish.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      // Подпись под объявлением читают игроки: имя сотрудника, а не UUID.
      return reply.code(201).send(await AnnouncementsService.publish({
        ...parsed.data,
        adminId: req.adminUser.adminId,
        authorLabel: req.adminUser.label,
      }))
    },
  )

  // Лента для админки: игровая ручка требует игровой токен, а у
  // администратора свой вход. Те же объявления всех видов.
  fastify.get(
    '/admin',
    { preHandler: requirePermission('content') },
    async (_req, reply) => reply.send({ items: await AnnouncementsService.feed() }),
  )

  fastify.patch<{ Params: { id: string }; Body: unknown }>(
    '/:id/pin',
    { preHandler: requirePermission('content') },
    async (req, reply) => {
      const parsed = z.object({ pinned: z.boolean() }).safeParse(req.body)
      if (!z.string().uuid().safeParse(req.params.id).success || !parsed.success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      }
      return reply.send(await AnnouncementsService.pin(req.params.id, parsed.data.pinned))
    },
  )

  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requirePermission('content') },
    async (req, reply) => {
      if (!z.string().uuid().safeParse(req.params.id).success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      }
      await AnnouncementsService.remove(req.params.id)
      return reply.code(204).send()
    },
  )
}
