import type { FastifyInstance } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { CharactersService } from './characters.service'
import { CreateCharacterSchema } from './characters.schemas'
import { WeaponSkillsRepository } from '../weapon-skills/weapon-skills.repository'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'

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
      return reply.send(char)
    })

  // GET /api/characters/me/skills — weapon skills
  fastify.get('/me/skills', { preHandler: authenticate },
    async (req, reply) => {
      const char = await CharactersService.getProfile(req.authUser.userId)
      const skills = await WeaponSkillsRepository.getAll(char.id)
      return reply.send(skills)
    })

  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: authenticate },
    async (req, reply) => {
      const char = await CharactersService.getById(req.params.id)
      return reply.send(char)
    })
}
