import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { CharactersRepository } from '../characters/characters.repository'
import { prisma } from '../../shared/db/prisma'
import { TerritoriesService } from './territories.service'
import { ClaimsService } from './claims.service'
import { AuthorityService } from './authority.service'
import { ObjectAttacksService } from './object-attacks.service'
import { ClanOwnershipService } from '../production/ownership.service'

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

  // ── Заявки ────────────────────────────────────────────────
  const Roster = z.object({ roster: z.array(Id).min(1).max(10) })

  fastify.post<{ Params: { code: string }; Body: { roster: string[] } }>(
    '/:code/claims', { preHandler: authenticate }, async (req, reply) => {
      if (!Code.safeParse(req.params.code).success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      }
      const parsed = Roster.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const me = await character(req.authUser.userId)
      // Сервис отдаёт claimId плоско, контракт STAGE4_API — { claim: { id } }.
      // Разворачиваем здесь: HTTP-форма живёт в маршруте, а не в сервисе.
      const { claimId, ...rest } = await ClaimsService.file(me.id, req.params.code, parsed.data.roster)
      return reply.code(201).send({ claim: { id: claimId, ...rest } })
    })

  fastify.get<{ Params: { code: string; id: string } }>(
    '/:code/claims/:id', { preHandler: authenticate }, async (req, reply) => {
      if (!Id.safeParse(req.params.id).success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      }
      return reply.send(await ClaimsService.get(req.params.id))
    })

  fastify.post<{ Params: { code: string; id: string }; Body: { roster: string[] } }>(
    '/:code/claims/:id/defence', { preHandler: authenticate }, async (req, reply) => {
      if (!Id.safeParse(req.params.id).success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      }
      const parsed = Roster.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      const me = await character(req.authUser.userId)
      return reply.send(await ClaimsService.setDefence(me.id, req.params.id, parsed.data.roster))
    })

  fastify.delete<{ Params: { code: string; id: string } }>(
    '/:code/claims/:id', { preHandler: authenticate }, async (req, reply) => {
      if (!Id.safeParse(req.params.id).success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      }
      const me = await character(req.authUser.userId)
      return reply.send(await ClaimsService.cancel(me.id, req.params.id))
    })
}

/**
 * Бои за объекты и клановая собственность — под /api/objects, рядом с
 * остальными операциями над объектами (STAGE4_API разделы 3 и 4.2).
 */
export async function objectWarRoutes(fastify: FastifyInstance) {
  const me = async (userId: string) => {
    const item = await CharactersRepository.findByUserId(userId)
    if (!item) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    return item
  }
  const valid = (id: string) => Id.safeParse(id).success

  fastify.get('/attackable', { preHandler: authenticate }, async (req, reply) => {
    const character = await me(req.authUser.userId)
    return reply.send(await ObjectAttacksService.attackable(character.id))
  })

  fastify.post<{ Params: { id: string } }>('/:id/sabotage', { preHandler: authenticate }, async (req, reply) => {
    if (!valid(req.params.id)) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const character = await me(req.authUser.userId)
    return reply.send(await ObjectAttacksService.sabotage(character.id, req.params.id))
  })

  fastify.post<{ Params: { id: string } }>('/:id/rob', { preHandler: authenticate }, async (req, reply) => {
    if (!valid(req.params.id)) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const character = await me(req.authUser.userId)
    return reply.send(await ObjectAttacksService.rob(character.id, req.params.id))
  })

  fastify.get<{ Params: { id: string } }>('/:id/attacks', { preHandler: authenticate }, async (req, reply) => {
    if (!valid(req.params.id)) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    return reply.send(await ObjectAttacksService.history(req.params.id))
  })

  fastify.get<{ Params: { id: string } }>('/:id/transfer-preview', { preHandler: authenticate }, async (req, reply) => {
    if (!valid(req.params.id)) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const character = await me(req.authUser.userId)
    return reply.send(await ClanOwnershipService.preview(character.id, req.params.id))
  })

  fastify.post<{ Params: { id: string } }>('/:id/transfer-to-clan', { preHandler: authenticate }, async (req, reply) => {
    if (!valid(req.params.id)) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const character = await me(req.authUser.userId)
    return reply.send(await ClanOwnershipService.transfer(character.id, req.params.id))
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

  /** Авторитет и журнал войн — только участникам клана. */
  const assertMember = async (userId: string, clanId: string) => {
    const me = await CharactersRepository.findByUserId(userId)
    if (!me) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    const member = await prisma.clanMember.findUnique({
      where: { characterId: me.id }, select: { clanId: true, status: true },
    })
    if (!member || member.status !== 'ACTIVE' || member.clanId !== clanId) {
      throw new AppError(ErrorCode.CLAN_PERMISSION, 'Not a clan member', 403)
    }
    return me
  }

  fastify.get<{ Params: { id: string } }>('/:id/authority', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    }
    await assertMember(req.authUser.userId, req.params.id)
    return reply.send(await AuthorityService.view(req.params.id))
  })

  fastify.get<{ Params: { id: string } }>('/:id/wars', { preHandler: authenticate }, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    }
    await assertMember(req.authUser.userId, req.params.id)
    return reply.send(await ClaimsService.listForClan(req.params.id))
  })
}
