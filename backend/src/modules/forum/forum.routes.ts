import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { authenticate } from '../../shared/security/auth-middleware'

const pageSize = 20
const pagination = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) })
const idSchema = z.object({ id: z.string().uuid() })
const bodySchema = z.object({ body: z.string().trim().min(1).max(4000) })
const topicSchema = bodySchema.extend({ title: z.string().trim().min(1).max(100) })
const pinSchema = z.object({ pinned: z.boolean() })
const posting = { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }
const visible = { removedAt: null } as const
const author = { select: { nickname: true } } as const

async function viewer(userId: string) {
  const character = await prisma.character.findUnique({
    where: { userId },
    select: { id: true, isModerator: true, user: { select: { mutedUntil: true } } },
  })
  if (!character) throw AppError.notFound('Character', userId)
  return character
}

async function writer(userId: string) {
  const character = await viewer(userId)
  if (character.user.mutedUntil && character.user.mutedUntil > new Date()) {
    throw new AppError(ErrorCode.FORBIDDEN, 'Вам временно запрещено писать на форуме', 403)
  }
  return character.id
}

export async function forumRoutes(server: FastifyInstance) {
  server.get('/', { preHandler: authenticate }, async req => {
    const { page } = pagination.parse(req.query)
    const [topics, character] = await Promise.all([
      prisma.forumTopic.findMany({
        where: visible, skip: (page - 1) * pageSize, take: pageSize + 1,
        orderBy: [{ pinnedAt: { sort: 'asc', nulls: 'last' } }, { activityAt: 'desc' }, { id: 'desc' }],
        select: { id: true, title: true, pinnedAt: true, activityAt: true, author, _count: { select: { replies: { where: visible } } } },
      }),
      viewer(req.authUser.userId),
    ])
    return { items: topics.slice(0, pageSize), more: topics.length > pageSize, canModerate: character.isModerator }
  })

  server.post('/', posting, async (req, reply) => {
    const data = topicSchema.parse(req.body)
    const authorId = await writer(req.authUser.userId)
    const topic = await prisma.forumTopic.create({ data: { ...data, authorId }, select: { id: true } })
    return reply.code(201).send(topic)
  })

  server.get('/:id', { preHandler: authenticate }, async req => {
    const { id } = idSchema.parse(req.params)
    const { page } = pagination.parse(req.query)
    const [character, topic] = await Promise.all([
      viewer(req.authUser.userId),
      prisma.forumTopic.findFirst({
        where: { id, ...visible },
        select: { id: true, title: true, body: true, pinnedAt: true, createdAt: true, author,
          replies: {
            where: visible, skip: (page - 1) * pageSize, take: pageSize + 1,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true, body: true, createdAt: true, author },
          },
        },
      }),
    ])
    if (!topic) throw AppError.notFound('Тема', id)
    const { replies, ...head } = topic
    return { topic: head, replies: replies.slice(0, pageSize), more: replies.length > pageSize, canModerate: character.isModerator }
  })

  server.post('/:id/replies', posting, async (req, reply) => {
    const { id } = idSchema.parse(req.params)
    const { body } = bodySchema.parse(req.body)
    const authorId = await writer(req.authUser.userId)
    const entry = await prisma.$transaction(async tx => {
      const topic = await tx.forumTopic.updateMany({ where: { id, ...visible }, data: { activityAt: new Date() } })
      if (!topic.count) throw AppError.notFound('Тема', id)
      return tx.forumReply.create({ data: { topicId: id, authorId, body }, select: { id: true } })
    })
    return reply.code(201).send(entry)
  })

  server.patch('/moderation/topics/:id/pin', { preHandler: authenticate }, async req => {
    const { id } = idSchema.parse(req.params)
    const { pinned } = pinSchema.parse(req.body)
    const character = await viewer(req.authUser.userId)
    if (!character.isModerator) throw new AppError(ErrorCode.FORBIDDEN, 'Закреплять темы может только модератор', 403)

    const where = { id, ...visible }
    const result = await prisma.forumTopic.updateMany({
      where: { ...where, pinnedAt: pinned ? null : { not: null } },
      data: { pinnedAt: pinned ? new Date() : null },
    })
    if (!result.count && !await prisma.forumTopic.count({ where })) throw AppError.notFound('Тема', id)
    return { ok: true }
  })

  for (const scope of ['topics', 'replies'] as const) {
    server.delete('/moderation/' + scope + '/:id', { preHandler: authenticate }, async req => {
      const { id } = idSchema.parse(req.params)
      const character = await viewer(req.authUser.userId)
      if (!character.isModerator) throw new AppError(ErrorCode.FORBIDDEN, 'Удалять сообщения может только модератор', 403)
      const operation = { where: { id, ...visible }, data: { removedAt: new Date(), removedBy: character.id } }
      const result = scope === 'topics' ? await prisma.forumTopic.updateMany(operation) : await prisma.forumReply.updateMany(operation)
      if (!result.count) throw AppError.notFound('Сообщение форума', id)
      return { ok: true }
    })
  }
}
