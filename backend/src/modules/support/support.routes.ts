import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, requireAdminRole } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { prisma } from '../../shared/db/prisma'
import { CharactersRepository } from '../characters/characters.repository'
import { SUPPORT, SupportService } from './support.service'
import { ChatRedis } from '../../shared/db/redis'
import { PRESENCE_TTL_SEC } from '../chat/chat.service'

const bad = { code: 'GEN_001', message: 'Validation error' }
const Id = z.string().uuid()
// base64 раздувает картинку на треть, плюс текст и префикс data:.
const BODY_LIMIT = Math.ceil(SUPPORT.imageMaxBytes * 4 / 3) + 16_000

/** Поддержка для игрока — /api/support. */
export async function supportRoutes(fastify: FastifyInstance) {
  const me = async (userId: string) => {
    const item = await CharactersRepository.findByUserId(userId)
    if (!item) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    return item
  }

  fastify.get('/', { preHandler: authenticate }, async req => SupportService.mine((await me(req.authUser.userId)).id))

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

  fastify.post<{ Body: { text: string; image?: string | null } }>('/', { preHandler: authenticate, bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const parsed = z.object({
      text: z.string().max(SUPPORT.textMax),
      image: z.string().max(BODY_LIMIT).nullish(),
    }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: `Текст — не длиннее ${SUPPORT.textMax} знаков` })
    const char = await me(req.authUser.userId)
    return reply.send(await SupportService.create(char.id, parsed.data.text, parsed.data.image))
  })
}

const SUPPORT_ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN', 'MODERATOR', 'SUPPORT') }

/** Обращения в админке — /api/admin/support. */
export async function adminSupportRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { status?: string } }>('/', SUPPORT_ADMIN, async (req, reply) => {
    const parsed = z.enum(['OPEN', 'ANSWERED', 'CLOSED']).optional().safeParse(req.query.status || undefined)
    if (!parsed.success) return reply.code(422).send(bad)
    return reply.send(await SupportService.adminList(parsed.data))
  })

  // Скриншот отдаётся по админскому токену: в админке он грузится fetch'ем.
  fastify.get<{ Params: { id: string } }>('/:id/image', SUPPORT_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(404).send()
    const image = await SupportService.image(req.params.id)
    if (!image) return reply.code(404).send()
    return reply.header('Content-Type', image.mime).header('Cache-Control', 'private, max-age=3600').send(image.bytes)
  })

  fastify.post<{ Params: { id: string }; Body: { text: string } }>('/:id/reply', SUPPORT_ADMIN, async (req, reply) => {
    const parsed = z.object({ text: z.string().max(SUPPORT.textMax) }).safeParse(req.body)
    if (!Id.safeParse(req.params.id).success || !parsed.success) return reply.code(422).send(bad)
    const admin = await prisma.adminUser.findUnique({ where: { id: req.adminUser.adminId }, select: { username: true } })
    return reply.send(await SupportService.reply(req.params.id, admin?.username ?? 'admin', parsed.data.text))
  })

  fastify.post<{ Params: { id: string } }>('/:id/close', SUPPORT_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(422).send(bad)
    return reply.send(await SupportService.close(req.params.id))
  })
}
