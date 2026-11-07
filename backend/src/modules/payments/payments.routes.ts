/**
 * Покупка долларов — /api/payments.
 *   GET  /offer               цена и пакеты, включена ли оплата
 *   POST /                    { dollars } → ссылка на страницу оплаты банка
 *   GET  /mine                мои покупки
 *   POST /tbank/notify        уведомление Т-Банка (без входа, проверяется подпись), ответ «OK»
 *   GET  /admin/report        все платежи и итоги (право finance)
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, requirePermission } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { CharactersRepository } from '../characters/characters.repository'
import { PaymentsService } from './payments.service'

export async function paymentsRoutes(fastify: FastifyInstance) {
  const me = async (userId: string) => {
    const item = await CharactersRepository.findByUserId(userId)
    if (!item) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    return item
  }

  fastify.get('/offer', { preHandler: authenticate }, async () => PaymentsService.offer())

  fastify.post('/', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ dollars: z.number().int().positive() }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Выберите пакет долларов' })
    return reply.send(await PaymentsService.start((await me(req.authUser.userId)).id, parsed.data.dollars))
  })

  fastify.get('/mine', { preHandler: authenticate }, async req => PaymentsService.mine((await me(req.authUser.userId)).id))

  // Банк ждёт ровно «OK» без тегов; иначе повторяет уведомление.
  fastify.post('/tbank/notify', async (req, reply) => {
    const ok = await PaymentsService.notify((req.body ?? {}) as Record<string, unknown>)
    return reply.code(ok ? 200 : 400).type('text/plain').send(ok ? 'OK' : 'ERROR')
  })

  fastify.get<{ Querystring: { from?: string; to?: string } }>('/admin/report', { preHandler: requirePermission('finance') }, async req => {
    const day = (value?: string) => (value && !Number.isNaN(Date.parse(value)) ? new Date(value) : undefined)
    return PaymentsService.report({ from: day(req.query.from), to: day(req.query.to) })
  })
}
