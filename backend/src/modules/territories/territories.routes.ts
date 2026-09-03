import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { CharactersRepository } from '../characters/characters.repository'
import { TerritoriesService } from './territories.service'

// Код района — та же строка, что в MENU.districts фронта и в OBJECT_DISTRICTS
// сида. Формат узкий намеренно: он приходит в путь и уходит в запрос по коду.
const Code = z.string().regex(/^[a-z]{3,16}$/)
const Id = z.string().uuid()

export async function territoriesRoutes(fastify: FastifyInstance) {
  const character = async (userId: string) => {
    const item = await CharactersRepository.findByUserId(userId)
    if (!item) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    return item
  }

  fastify.get('/', { preHandler: authenticate }, async (req, reply) => {
    const me = await character(req.authUser.userId)
    return reply.send(await TerritoriesService.list(me.id))
  })

  fastify.get<{ Params: { code: string } }>('/:code', { preHandler: authenticate }, async (req, reply) => {
    if (!Code.safeParse(req.params.code).success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    }
    const me = await character(req.authUser.userId)
    return reply.send(await TerritoriesService.get(req.params.code, me.id))
  })
}

/** Территории клана висят на /api/clans/:id/territories — см. STAGE4_API 1.3. */
export async function clanTerritoriesRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { id: string } }>('/:id/territories', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    }
    const me = await CharactersRepository.findByUserId(req.authUser.userId)
    if (!me) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    return reply.send(await TerritoriesService.listForClan(req.params.id, me.id))
  })
}
