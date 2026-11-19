// =============================================================
// Разделы Библиотеки и Кодекса, которые администрация пишет сама (Дима 19.11:
// «сам создавал разделы в библиотеке», «Кодекс — это законы, тоже сам наполнял»).
//
// Читать может любой вошедший. Писать — те, у кого право content
// (администрация и модераторы, как с новостями).
// =============================================================
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../shared/db/prisma'
import { authenticate, requirePermission } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'

export const CONTENT_MAX_TITLE = 80
export const CONTENT_MAX_BODY = 20_000

const Section = z.enum(['LIBRARY', 'CODEX'])
const Page = z.object({
  section: Section,
  title: z.string().trim().min(1).max(CONTENT_MAX_TITLE),
  body: z.string().trim().min(1).max(CONTENT_MAX_BODY),
  sortOrder: z.coerce.number().int().min(-1000).max(1000).default(0),
  isPublished: z.boolean().default(true),
})
const Patch = Page.omit({ section: true }).partial()

const PUBLIC = { id: true, section: true, title: true, body: true, sortOrder: true, updatedAt: true } as const
const order = [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }]

/** Для игроков: опубликованные разделы. */
export async function contentRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { section: string } }>('/:section', { preHandler: authenticate }, async (req, reply) => {
    const section = Section.safeParse(req.params.section.toUpperCase())
    if (!section.success) throw AppError.notFound('Section', req.params.section)
    const items = await prisma.contentPage.findMany({ where: { section: section.data, isPublished: true }, orderBy: order, select: PUBLIC })
    return reply.send({ items })
  })
}

/** Для админки: все разделы, правка и удаление. */
export async function contentAdminRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: requirePermission('content') }

  fastify.get<{ Querystring: { section?: string } }>('/content', guard, async (req, reply) => {
    const section = Section.safeParse(String(req.query.section ?? '').toUpperCase())
    const items = await prisma.contentPage.findMany({
      where: section.success ? { section: section.data } : {},
      orderBy: [{ section: 'asc' }, ...order],
    })
    return reply.send({ items })
  })

  fastify.post<{ Body: unknown }>('/content', guard, async (req, reply) => {
    const parsed = Page.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Заполните название и текст' })
    const item = await prisma.contentPage.create({ data: { ...parsed.data, updatedBy: req.adminUser.label } })
    return reply.code(201).send(item)
  })

  fastify.patch<{ Params: { id: string }; Body: unknown }>('/content/:id', guard, async (req, reply) => {
    const parsed = Patch.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Заполните название и текст' })
    const { count } = await prisma.contentPage.updateMany({ where: { id: req.params.id }, data: { ...parsed.data, updatedBy: req.adminUser.label } })
    if (!count) throw AppError.notFound('ContentPage', req.params.id)
    return reply.send(await prisma.contentPage.findUniqueOrThrow({ where: { id: req.params.id } }))
  })

  fastify.delete<{ Params: { id: string } }>('/content/:id', guard, async (req, reply) => {
    const { count } = await prisma.contentPage.deleteMany({ where: { id: req.params.id } })
    if (!count) throw AppError.notFound('ContentPage', req.params.id)
    return reply.send({ ok: true })
  })
}
