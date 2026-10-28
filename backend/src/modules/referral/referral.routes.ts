import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate, requireAdminRole } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { CharactersRepository } from '../characters/characters.repository'
import { ReferralService } from './referral.service'

/** Реферальная система — /api/referral. Выплаты деньгами решает только главный админ. */
export async function referralRoutes(fastify: FastifyInstance) {
  const me = async (userId: string) => {
    const item = await CharactersRepository.findByUserId(userId)
    if (!item) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    return item
  }

  fastify.get('/me', { preHandler: authenticate }, async req => ReferralService.summary((await me(req.authUser.userId)).id))

  fastify.post('/claim', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ amount: z.number().int().min(1).max(1_000_000) }).safeParse(req.body)
    const key = req.headers['idempotency-key']
    if (!parsed.success || typeof key !== 'string') return reply.code(422).send({ code: 'GEN_001', message: 'Укажите сумму' })
    const character = await me(req.authUser.userId)
    return reply.send(await ReferralService.claim(character.id, parsed.data.amount, key))
  })

  fastify.post('/payouts', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({
      amount: z.number().int().min(1).max(1_000_000),
      details: z.string().trim().min(5).max(300),
    }).safeParse(req.body)
    const key = req.headers['idempotency-key']
    if (!parsed.success || typeof key !== 'string') {
      return reply.code(422).send({ code: 'GEN_001', message: 'Укажите сумму и куда перевести' })
    }
    const character = await me(req.authUser.userId)
    return reply.code(201).send(await ReferralService.requestPayout(character.id, parsed.data.amount, parsed.data.details, key))
  })

  const ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN') }
  const Status = z.enum(['PENDING', 'PAID', 'REJECTED']).optional()
  const Close = z.object({ note: z.string().max(300).optional() })

  fastify.get<{ Querystring: { status?: string } }>('/admin/payouts', ADMIN, async (req, reply) => {
    const parsed = Status.safeParse(req.query.status)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    return reply.send(await ReferralService.adminList(parsed.data))
  })

  for (const [path, action] of [['paid', ReferralService.markPaid], ['reject', ReferralService.reject]] as const) {
    fastify.post<{ Params: { id: string }; Body: unknown }>(`/admin/payouts/:id/${path}`, ADMIN, async (req, reply) => {
      const parsed = Close.safeParse(req.body ?? {})
      if (!z.string().uuid().safeParse(req.params.id).success || !parsed.success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      }
      return reply.send(await action(req.params.id, req.adminUser.adminId, parsed.data.note))
    })
  }
}
