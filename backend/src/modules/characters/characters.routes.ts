import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { CharactersService } from './characters.service'
import { CreateCharacterSchema } from './characters.schemas'
import { WeaponSkillsRepository } from '../weapon-skills/weapon-skills.repository'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { prisma } from '../../shared/db/prisma'
import { z } from 'zod'

const DistributeStatSchema = z.object({
  stat: z.enum(['str', 'agi', 'rea', 'acc', 'end', 'luck', 'agr', 'auth']),
  amount: z.number().int().min(1).max(5),
})

export async function charactersRoutes(fastify: FastifyInstance): Promise<void> {

  fastify.post('/', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = CreateCharacterSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten().fieldErrors })
      }
      const char = await CharactersService.create(req.authUser.userId, parsed.data)
      return reply.code(201).send(char)
    })

  fastify.get('/me', { preHandler: authenticate },
    async (req, reply) => {
      const char = await CharactersService.getProfile(req.authUser.userId)
      // Include weapon skills inline for frontend convenience
      const skills = await WeaponSkillsRepository.getAll(char.id)
      return reply.send({ ...char, weaponSkills: skills })
    })

  // GET /api/characters/me/skills — weapon skills
  fastify.get('/me/skills', { preHandler: authenticate },
    async (req, reply) => {
      const char = await CharactersService.getProfile(req.authUser.userId)
      const skills = await WeaponSkillsRepository.getAll(char.id)
      return reply.send(skills)
    })

  // POST /api/characters/stats/distribute — распределение очков характеристик
  // Используется: архетип STUDENT (+2 очка), повышение боевого уровня (+1 за уровень)
  fastify.post('/stats/distribute', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = DistributeStatSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
      }
      const { stat, amount } = parsed.data

      const char = await CharactersService.getProfile(req.authUser.userId)
      if (!char.stats) throw AppError.internal('Stats missing')
      if (char.stats.pointsAvailable < amount) {
        throw new AppError(ErrorCode.CONFLICT, `Недостаточно очков (есть ${char.stats.pointsAvailable}, нужно ${amount})`, 400)
      }

      const MAX_STAT = 20
      const statsAsNumbers = char.stats as unknown as Record<string, number>
      const currentVal = statsAsNumbers[stat] ?? 0
      if (currentVal + amount > MAX_STAT) {
        throw new AppError(ErrorCode.CONFLICT, `Характеристика не может превышать ${MAX_STAT}`, 400)
      }

      // Atomic update: read pointsAvailable fresh inside transaction to prevent race condition
      const result = await prisma.$transaction(async (tx) => {
        const freshStats = await tx.characterStats.findUnique({ where: { characterId: char.id } })
        if (!freshStats) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Stats not found', 404)
        if (freshStats.pointsAvailable < amount) {
          throw new AppError(ErrorCode.CONFLICT, `Недостаточно очков (${freshStats.pointsAvailable} < ${amount})`, 400)
        }
        const statsAsAny = freshStats as unknown as Record<string, number>
        if ((statsAsAny[stat] ?? 0) + amount > 20) {
          throw new AppError(ErrorCode.CONFLICT, `Характеристика не может превышать 20`, 400)
        }
        return tx.characterStats.update({
          where: { characterId: char.id },
          data: {
            [stat]: { increment: amount },
            pointsAvailable: { decrement: amount },
          },
        })
      })

      return reply.send({ message: `+${amount} ${stat}`, stats: result })
    })

  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: authenticate },
    async (req, reply) => {
      const char = await CharactersService.getById(req.params.id)
      return reply.send(char)
    })

  // GET /api/characters/by-nickname/:nickname — публичный профиль
  fastify.get<{ Params: { nickname: string } }>('/by-nickname/:nickname', { preHandler: authenticate },
    async (req, reply) => {
      const char = await prisma.character.findUnique({
        where: { nickname: req.params.nickname },
        include: { stats: true },
      })
      if (!char) throw AppError.notFound('Character', req.params.nickname)
      if (char.isInvisible) return reply.send({ hidden: true, nickname: req.params.nickname })
      return reply.send({
        id: char.id,
        nickname: char.nickname,
        archetype: char.archetype,
        battleLevel: char.battleLevel,
        battlesTotal: char.battlesTotal,
        battlesWon: char.battlesWon,
        location: char.location,
        createdAt: char.createdAt,
      })
    })
}
