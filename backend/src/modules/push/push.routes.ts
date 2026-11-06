/**
 * Токен телефона для пушей. Его присылает сама страница игры внутри
 * приложения-оболочки: она уже вошла, поэтому оболочке не нужен свой вход.
 *   POST   /api/push/token  { token, platform? }  — привязать телефон к игроку
 *   DELETE /api/push/token  { token }             — отвязать (выход из игры)
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { PushService } from './push.service'

const Body = z.object({
  token: z.string().trim().min(20).max(4096),
  platform: z.enum(['android', 'ios', 'web']).optional(),
})

export async function pushRoutes(fastify: FastifyInstance) {
  fastify.post('/token', { preHandler: authenticate }, async (req, reply) => {
    const parsed = Body.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Нет токена телефона' })
    await PushService.register(req.authUser.userId, parsed.data.token, parsed.data.platform)
    return reply.send({ ok: true, enabled: PushService.enabled() })
  })

  fastify.delete('/token', { preHandler: authenticate }, async (req, reply) => {
    const parsed = Body.pick({ token: true }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Нет токена телефона' })
    await PushService.unregister(req.authUser.userId, parsed.data.token)
    return reply.send({ ok: true })
  })
}
