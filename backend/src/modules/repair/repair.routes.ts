import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { CharactersRepository } from '../characters/characters.repository'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { ItemsRepository } from '../items/item-instance.repository'
import { calcRepairCost } from '../stats/stats.formulas'
import { withTransaction } from '../../shared/db/transaction'
import { audit } from '../../shared/logger/audit-logger'
import { z } from 'zod'
import { EconomyService } from '../economy/economy.service'

const PreviewSchema = z.object({ itemInstanceId: z.string().uuid() })
const CommitSchema = z.object({ itemInstanceId: z.string().uuid() })

export async function repairRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/repair/items — list repairable items
  fastify.get('/items', { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const char = await CharactersRepository.findByUserId(req.authUser.userId)
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)

      const items = await ItemsRepository.findByOwner(char.id)
      const repairable = items.filter(i =>
        i.durabilityCurrent < i.durabilityMax &&
        i.status !== 'DELETED' &&
        i.template.isSellable  // repairable check
      )
      return reply.send(repairable.map(i => ({
        ...i,
        repairCost: calcRepairCost(
          i.template.priceBase,
          i.durabilityMax - i.durabilityCurrent,
          i.quality,
          i.upgradeLevel
        ),
      })))
    })

  // POST /api/repair/preview
  fastify.post('/preview', { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = PreviewSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })

      const char = await CharactersRepository.findByUserId(req.authUser.userId)
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)

      const item = await ItemsRepository.findInstanceById(parsed.data.itemInstanceId)
      if (!item) throw AppError.notFound('Item', parsed.data.itemInstanceId)
      if (item.ownerId !== char.id) throw new AppError(ErrorCode.REPAIR_ITEM_NOT_OWNED, 'Not your item', 403)
      if (item.durabilityCurrent >= item.durabilityMax) {
        throw new AppError(ErrorCode.REPAIR_NOT_NEEDED, 'Item does not need repair', 400)
      }

      const lostDur = item.durabilityMax - item.durabilityCurrent
      const cost = calcRepairCost(item.template.priceBase, lostDur, item.quality, item.upgradeLevel)
      return reply.send({
        item,
        durabilityCurrent: item.durabilityCurrent,
        durabilityMax: item.durabilityMax,
        lostDurability: lostDur,
        repairCost: cost,
        canAfford: char.money >= cost,
        characterMoney: char.money,
      })
    })

  // POST /api/repair/commit
  fastify.post('/commit', { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = CommitSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })

      const result = await withTransaction(async (tx) => {
        const char = await tx.character.findUnique({
          where: { userId: req.authUser.userId },
        })
        if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)

        const item = await tx.itemInstance.findUnique({
          where: { id: parsed.data.itemInstanceId },
          include: { template: true },
        })
        if (!item) throw AppError.notFound('Item', parsed.data.itemInstanceId)
        if (item.ownerId !== char.id) throw new AppError(ErrorCode.REPAIR_ITEM_NOT_OWNED, 'Not your item', 403)
        if (item.durabilityCurrent >= item.durabilityMax) {
          throw new AppError(ErrorCode.REPAIR_NOT_NEEDED, 'Item does not need repair', 400)
        }

        const lostDur = item.durabilityMax - item.durabilityCurrent
        const cost = calcRepairCost(item.template.priceBase, lostDur, item.quality, item.upgradeLevel)

        if (char.money < cost) throw AppError.insufficientFunds(char.money, cost)

        const newBalance = await EconomyService.debit(tx, {
          characterId: char.id, amount: cost, reasonCode: 'REPAIR_COST', refType: 'repair', refId: item.id,
        })
        await tx.itemInstance.update({
          where: { id: item.id },
          data: { durabilityCurrent: item.durabilityMax, status: 'NORMAL' },
        })

        await tx.repairLog.create({
          data: {
            characterId: char.id,
            itemId: item.id,
            cost,
            durabilityBefore: item.durabilityCurrent,
            durabilityAfter: item.durabilityMax,
          },
        })
        await tx.itemLog.create({
          data: {
            itemId: item.id,
            characterId: char.id,
            actionCode: 'REPAIRED',
            details: { cost, durBefore: item.durabilityCurrent, durAfter: item.durabilityMax },
          },
        })

        audit('item.repaired', { characterId: char.id, itemId: item.id, cost })
        return { itemId: item.id, durabilityAfter: item.durabilityMax, cost, newBalance }
      })

      return reply.send(result)
    })
}
