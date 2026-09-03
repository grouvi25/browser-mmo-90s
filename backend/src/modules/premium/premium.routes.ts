import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { CharactersRepository } from '../characters/characters.repository'
import { PremiumService } from './premium.service'
import { HelpersService } from './helpers.service'

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

/** Помощники — /api/helpers. */
export async function helpersRoutes(fastify: FastifyInstance) {
  const me = async (userId: string) => {
    const item = await CharactersRepository.findByUserId(userId)
    if (!item) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    return item
  }
  const Id = z.string().uuid()

  fastify.get('/', { preHandler: authenticate }, async (req, reply) => {
    const character = await me(req.authUser.userId)
    return reply.send(await HelpersService.list(character.id))
  })

  fastify.get('/objects', { preHandler: authenticate }, async (req, reply) => {
    const character = await me(req.authUser.userId)
    return reply.send(await HelpersService.eligibleObjects(character.id))
  })

  fastify.post<{ Body: { name: string; professionCode: string } }>('/', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({
      name: z.string().trim().min(2).max(24),
      professionCode: z.string().trim().min(2).max(40),
    }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const character = await me(req.authUser.userId)
    return reply.code(201).send(await HelpersService.hire(character.id, parsed.data.name, parsed.data.professionCode))
  })

  fastify.delete<{ Params: { id: string } }>('/:id', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const character = await me(req.authUser.userId)
    return reply.send(await HelpersService.dismiss(character.id, req.params.id))
  })

  fastify.post<{ Params: { id: string }; Body: { objectId: string } }>('/:id/work', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({ objectId: Id }).safeParse(req.body)
    if (!Id.safeParse(req.params.id).success || !parsed.success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    }
    const character = await me(req.authUser.userId)
    return reply.code(201).send(await HelpersService.startShift(character.id, req.params.id, parsed.data.objectId))
  })

  fastify.post<{ Params: { id: string } }>('/:id/claim', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const character = await me(req.authUser.userId)
    return reply.send(await HelpersService.claimShift(character.id, req.params.id))
  })
}

/**
 * Выдача и отзыв подписки переехали в admin-actions (шаг G2 Этапа 5).
 *
 * Там они требуют причину и пишут в журнал снимок прежнего срока, по
 * которому выдачу можно отменить. Здесь их больше нет: ручка без причины
 * делала правило П2 необязательным для всех остальных.
 */
