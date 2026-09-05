// =============================================================
// Маршруты эфира.
//
// Отказ антифлуда отдаётся кодом 429 и текстом на русском: игрок видит
// подсказку в ленте, а не красную ошибку. Всё остальное — обычные
// правила модуля: канал разбирается схемой, комната клана берётся из
// членства, а не из запроса.
// =============================================================
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { ChatService } from './chat.service'
import { publish } from '../../shared/realtime/io'
import { FLOOD, MAX_BODY, chatRoom, type Rejection } from './chat.formulas'

const Channel = z.enum(['DISTRICT', 'CLAN', 'GLOBAL'])
const Query = z.object({ scope: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(50).optional() })
const Body = z.object({ scope: z.string().max(64).optional(), body: z.string().max(MAX_BODY * 2) })

/** Текст отказа. Держим здесь, а не в сервисе: это разговор с игроком. */
function explain(reason: Rejection): string {
  switch (reason.kind) {
    case 'empty':     return 'Пустое сообщение не отправить.'
    case 'too-long':  return `Слишком длинно — не больше ${reason.max} знаков.`
    case 'too-fast':  return 'Не так часто, переведите дух.'
    case 'too-many':  return `Не больше ${reason.limit} сообщений в минуту.`
    case 'repeat':    return 'Это вы уже писали.'
  }
}

export async function chatRoutes(fastify: FastifyInstance) {
  /** Лента канала. Заодно отмечает, что игрок в эфире. */
  fastify.get<{ Params: { channel: string }; Querystring: { scope?: string; limit?: number } }>(
    '/:channel',
    { preHandler: authenticate },
    async (req, reply) => {
      const channel = Channel.safeParse(req.params.channel.toUpperCase())
      const query = Query.safeParse(req.query)
      if (!channel.success || !query.success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      }
      const who = await ChatService.speaker(req.authUser.userId)
      const scope = ChatService.roomFor(channel.data, query.data.scope, who)
      await ChatService.touch(who.characterId)
      return reply.send({
        channel: channel.data,
        scope,
        limits: { maxBody: MAX_BODY, minGapMs: FLOOD.minGapMs },
        messages: await ChatService.history(channel.data, scope, query.data.limit),
      })
    },
  )

  /** Кто в эфире. Список общий на игру, не по каналам. */
  fastify.get('/online/list', { preHandler: authenticate }, async (req, reply) => {
    const who = await ChatService.speaker(req.authUser.userId)
    await ChatService.touch(who.characterId)
    return reply.send({ players: await ChatService.online() })
  })

  fastify.post<{ Params: { channel: string }; Body: { scope?: string; body: string } }>(
    '/:channel',
    { preHandler: authenticate },
    async (req, reply) => {
      const channel = Channel.safeParse(req.params.channel.toUpperCase())
      const parsed = Body.safeParse(req.body)
      if (!channel.success || !parsed.success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      }
      const who = await ChatService.speaker(req.authUser.userId)
      const result = await ChatService.send(who, channel.data, parsed.data.scope, parsed.data.body)
      if (!result.ok) {
        // 429, а не 400: это темп, а не испорченный запрос, и клиент
        // должен просто подождать и повторить.
        return reply.code(429).send({ code: 'CHAT_001', message: explain(result.reason), reason: result.reason })
      }
      await ChatService.touch(who.characterId)
      // В комнату — всем, кто её слушает, включая самого автора: так
      // у него и у остальных лента складывается в одном порядке.
      publish(chatRoom(channel.data, result.line.scope), 'chat:message', result.line)
      return reply.code(201).send(result.line)
    },
  )
}
