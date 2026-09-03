import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { requireAdminRole } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { CharactersRepository } from '../characters/characters.repository'
import { PremiumService } from './premium.service'

export async function premiumRoutes(fastify: FastifyInstance) {
  const me = async (userId: string) => {
    const item = await CharactersRepository.findByUserId(userId)
    if (!item) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    return item
  }

  fastify.get('/me', { preHandler: authenticate }, async (req, reply) => {
    const character = await me(req.authUser.userId)
    return reply.send(await PremiumService.state(character.id))
  })

  fastify.get('/shop', { preHandler: authenticate }, async (_req, reply) => {
    return reply.send(await PremiumService.shop())
  })

  fastify.get('/purchases', { preHandler: authenticate }, async (req, reply) => {
    const character = await me(req.authUser.userId)
    return reply.send(await PremiumService.purchases(character.id))
  })
}

/**
 * Выдача и отзыв — только высшей роли: премиум это деньги, и по матрице
 * прав Этапа 5 такие действия закреплены за SUPER_ADMIN.
 * Оплата в первой версии проходит вне игры, в игре появляется только флаг.
 */
const GRANT_ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN') }

export async function adminPremiumRoutes(fastify: FastifyInstance) {
  const Body = z.object({
    characterId: z.string().uuid(),
    productCode: z.string().min(3).max(64),
    days: z.number().int().positive().max(3650).optional(),
  })

  fastify.post('/premium/grant', GRANT_ADMIN, async (req, reply) => {
    const parsed = Body.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    return reply.send(await PremiumService.grant({
      characterId: parsed.data.characterId,
      productCode: parsed.data.productCode,
      days: parsed.data.days,
      adminId: req.adminUser?.adminId,
    }))
  })

  fastify.post('/premium/revoke', GRANT_ADMIN, async (req, reply) => {
    const parsed = z.object({ characterId: z.string().uuid() }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    return reply.send(await PremiumService.revoke(parsed.data.characterId))
  })
}
