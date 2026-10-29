import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { authenticate, requirePermission } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { prisma } from '../../shared/db/prisma'
import { CharactersRepository } from '../characters/characters.repository'
import { CATEGORIES, SUPPORT, SupportService } from './support.service'
import { ChatRedis } from '../../shared/db/redis'
import { PRESENCE_TTL_SEC } from '../chat/chat.service'

const bad = { code: 'GEN_001', message: 'Validation error' }
const Id = z.string().uuid()
// base64 раздувает картинку на треть, плюс текст и префикс data:.
const BODY_LIMIT = Math.ceil(SUPPORT.imageMaxBytes * 4 / 3) + 16_000
const Category = z.enum(CATEGORIES as [typeof CATEGORIES[number], ...typeof CATEGORIES])
const Status = z.enum(['OPEN', 'ANSWERED', 'CLOSED'])
const Message = z.object({ text: z.string().max(SUPPORT.textMax), image: z.string().max(BODY_LIMIT).nullish() })

function sendImage(reply: FastifyReply, image: { mime: string; bytes: Buffer } | null) {
  if (!image) return reply.code(404).send()
  return reply.header('Content-Type', image.mime).header('Cache-Control', 'private, max-age=3600').send(image.bytes)
}

/** Поддержка для игрока — /api/support. */
export async function supportRoutes(fastify: FastifyInstance) {
  const me = async (userId: string) => {
    const item = await CharactersRepository.findByUserId(userId)
    if (!item) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    return item.id
  }

  fastify.get('/', { preHandler: authenticate }, async req => SupportService.mine(await me(req.authUser.userId)))

  // Счётчик ответов для отметки на кнопке «Поддержка».
  fastify.get('/unread', { preHandler: authenticate }, async req => SupportService.unread(await me(req.authUser.userId)))

  // GET /api/support/moderators — кто из модераторов в сети, остальные ниже
  // (обещание игрокам 22.10: «вкладка с модераторами, кто в сети»).
  fastify.get('/moderators', { preHandler: authenticate }, async () => {
    const [rows, online] = await Promise.all([
      prisma.character.findMany({ where: { isModerator: true }, select: { id: true, nickname: true, battleLevel: true, lastActiveAt: true }, orderBy: { nickname: 'asc' } }),
      ChatRedis.presenceList(PRESENCE_TTL_SEC, 1000),
    ])
    const live = new Set(online)
    const items = rows.map(r => ({ nickname: r.nickname, level: r.battleLevel, online: live.has(r.id), lastActiveAt: r.lastActiveAt }))
    return { items: items.sort((a, b) => Number(b.online) - Number(a.online)) }
  })

  fastify.post('/', { preHandler: authenticate, bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const parsed = Message.extend({ subject: z.string().max(SUPPORT.subjectMax), category: Category.optional() }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: `Тема — до ${SUPPORT.subjectMax} знаков, текст — до ${SUPPORT.textMax}` })
    return reply.send(await SupportService.create(await me(req.authUser.userId), parsed.data))
  })

  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(404).send({ code: 'GEN_002', message: 'Обращение не найдено' })
    return reply.send(await SupportService.thread(await me(req.authUser.userId), req.params.id))
  })

  fastify.post<{ Params: { id: string } }>('/:id/messages', { preHandler: authenticate, bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const parsed = Message.safeParse(req.body)
    if (!Id.safeParse(req.params.id).success || !parsed.success) return reply.code(422).send({ code: 'GEN_001', message: `Текст — не длиннее ${SUPPORT.textMax} знаков` })
    return reply.send(await SupportService.playerMessage(await me(req.authUser.userId), req.params.id, parsed.data))
  })

  fastify.post<{ Params: { id: string } }>('/:id/close', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(422).send(bad)
    return reply.send(await SupportService.playerClose(await me(req.authUser.userId), req.params.id))
  })

  fastify.post<{ Params: { id: string } }>('/:id/rate', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ rating: z.number().int().min(1).max(5) }).safeParse(req.body)
    if (!Id.safeParse(req.params.id).success || !parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Оценка от 1 до 5' })
    return reply.send(await SupportService.rate(await me(req.authUser.userId), req.params.id, parsed.data.rating))
  })

  // Скриншот по токену игрока: в игре он грузится fetch'ем.
  fastify.get<{ Params: { id: string; messageId: string } }>('/:id/messages/:messageId/image', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success || !Id.safeParse(req.params.messageId).success) return reply.code(404).send()
    return sendImage(reply, await SupportService.playerImage(await me(req.authUser.userId), req.params.id, req.params.messageId))
  })
}

const SUPPORT_ADMIN = { preHandler: requirePermission('support') }

/** Обращения в админке — /api/admin/support. */
export async function adminSupportRoutes(fastify: FastifyInstance) {
  fastify.get('/', SUPPORT_ADMIN, async (req, reply) => {
    const parsed = z.object({
      status: Status.optional(),
      category: Category.optional(),
      assigned: z.enum(['me', 'none']).optional(),
      q: z.string().max(80).optional(),
      page: z.coerce.number().int().min(0).max(1000).optional(),
    }).safeParse(Object.fromEntries(Object.entries(req.query as Record<string, string>).filter(([, v]) => v !== '')))
    if (!parsed.success) return reply.code(422).send(bad)
    return reply.send(await SupportService.adminList(parsed.data, req.adminUser.label))
  })

  fastify.get<{ Params: { id: string } }>('/:id', SUPPORT_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(404).send({ code: 'GEN_002', message: 'Обращение не найдено' })
    return reply.send(await SupportService.adminThread(req.params.id))
  })

  fastify.post<{ Params: { id: string } }>('/:id/messages', SUPPORT_ADMIN, async (req, reply) => {
    const parsed = z.object({ text: z.string().max(SUPPORT.textMax), internal: z.boolean().optional(), close: z.boolean().optional() }).safeParse(req.body)
    if (!Id.safeParse(req.params.id).success || !parsed.success) return reply.code(422).send(bad)
    return reply.send(await SupportService.adminMessage(req.params.id, req.adminUser.label, parsed.data))
  })

  fastify.patch<{ Params: { id: string } }>('/:id', SUPPORT_ADMIN, async (req, reply) => {
    const parsed = z.object({
      status: Status.optional(),
      priority: z.enum(['LOW', 'NORMAL', 'HIGH']).optional(),
      category: Category.optional(),
      assign: z.enum(['me', 'none']).optional(),
    }).safeParse(req.body)
    if (!Id.safeParse(req.params.id).success || !parsed.success) return reply.code(422).send(bad)
    return reply.send(await SupportService.adminUpdate(req.params.id, req.adminUser.label, parsed.data))
  })

  // Скриншот отдаётся по админскому токену: в админке он грузится fetch'ем.
  fastify.get<{ Params: { id: string; messageId: string } }>('/:id/messages/:messageId/image', SUPPORT_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success || !Id.safeParse(req.params.messageId).success) return reply.code(404).send()
    return sendImage(reply, await SupportService.adminImage(req.params.id, req.params.messageId))
  })
}
