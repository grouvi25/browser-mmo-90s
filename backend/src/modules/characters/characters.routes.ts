import type { FastifyInstance } from 'fastify'
import { CharactersService } from './characters.service'
import { CreateCharacterSchema } from './characters.schemas'
import { authenticate } from '../../shared/security/auth-middleware'

export async function charactersRoutes(fastify: FastifyInstance): Promise<void> {

  // POST /api/characters
  fastify.post('/', { preHandler: authenticate },
    async (req, reply) => {
      const parsed = CreateCharacterSchema.safeParse(req.body)
      if (!parsed.success) {
        return reply.code(422).send({ code: 'GEN_001', message: 'Validation error', details: parsed.error.flatten().fieldErrors })
      }
      const char = await CharactersService.create(req.authUser.userId, parsed.data)
      return reply.code(201).send(char)
    })

  // GET /api/characters/me
  fastify.get('/me', { preHandler: authenticate },
    async (req, reply) => {
      const char = await CharactersService.getProfile(req.authUser.userId)
      return reply.send(char)
    })

  // GET /api/characters/:id
  fastify.get<{ Params: { id: string } }>('/:id', { preHandler: authenticate },
    async (req, reply) => {
      const char = await CharactersService.getById(req.params.id)
      return reply.send(char)
    })
}
