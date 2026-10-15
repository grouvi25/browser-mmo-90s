import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticate } from '../../shared/security/auth-middleware'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { CharactersRepository } from '../characters/characters.repository'
import { DollarsService, DEALER_TRANSFER_MAX } from './dollars.service'

/** Игровые доллары — /api/dollars. */
export async function dollarsRoutes(fastify: FastifyInstance) {
  const me = async (userId: string) => {
    const item = await CharactersRepository.findByUserId(userId)
    if (!item) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    return item
  }

  // GET /api/dollars/me — баланс и последние движения
  fastify.get('/me', { preHandler: authenticate }, async req => DollarsService.account((await me(req.authUser.userId)).id))

  // GET /api/dollars/dealers — у кого купить доллары
  fastify.get('/dealers', { preHandler: authenticate }, async () => DollarsService.dealers())

  // POST /api/dollars/transfer — дилер пополняет счёт игрока
  fastify.post('/transfer', { preHandler: authenticate }, async (req, reply) => {
    const parsed = z.object({
      nickname: z.string().trim().min(1).max(64),
      amount: z.number().int().min(1).max(DEALER_TRANSFER_MAX),
    }).safeParse(req.body)
    const key = req.headers['idempotency-key']
    if (!parsed.success || typeof key !== 'string') {
      return reply.code(422).send({ code: 'GEN_001', message: 'Укажите ник игрока и сумму' })
    }
    const character = await me(req.authUser.userId)
    return reply.send(await DollarsService.transfer(character.id, parsed.data.nickname, parsed.data.amount, key))
  })
}
