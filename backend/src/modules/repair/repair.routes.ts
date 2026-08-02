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
import { ResourcesService } from '../resources/resources.service'
import { calcRequiredRepairParts, needsRepairParts, repairPartsCode } from './repair.formulas'
import { prisma } from '../../shared/db/prisma'

const PreviewSchema = z.object({ itemInstanceId: z.string().uuid() })
const CommitSchema = z.object({ itemInstanceId: z.string().uuid() })

async function repairPartsPreview(characterId: string, item: Awaited<ReturnType<typeof ItemsRepository.findInstanceById>>) {
  if (!item) return { needsParts: false, requiredParts: [], partsEnough: true }
  const lost = item.durabilityMax - item.durabilityCurrent
  const needsParts = needsRepairParts(item.template.itemTier, item.upgradeLevel)
  if (!needsParts) return { needsParts, requiredParts: [], partsEnough: true }
  const code = repairPartsCode(item.template.repairResourceCode)
  const template = await prisma.resourceTemplate.findUnique({ where: { code } })
  if (!template || !template.isActive || !template.isRepairMaterial) throw AppError.internal(`Repair resource misconfigured: ${code}`)
  const stack = await prisma.resourceStack.findUnique({ where: { characterId_resourceTemplateId: { characterId, resourceTemplateId: template.id } } })
  const amount = calcRequiredRepairParts(lost, item.durabilityMax, item.template.itemTier, item.upgradeLevel)
  const available = Math.max(0, (stack?.amount ?? 0) - (stack?.reservedAmount ?? 0))
  const requiredParts = [{ resourceCode: code, resourceName: template.name, amount, available, enough: available >= amount }]
  return { needsParts, requiredParts, partsEnough: requiredParts.every(part => part.enough) }
}

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
      return reply.send(await Promise.all(repairable.map(async i => {
        const parts = await repairPartsPreview(char.id, i)
        return {
          ...i,
          repairCost: calcRepairCost(i.template.priceBase, i.durabilityMax - i.durabilityCurrent, i.quality, i.upgradeLevel),
          needsParts: parts.needsParts,
          partsResourceCode: parts.requiredParts[0]?.resourceCode ?? null,
          requiredPartsAmount: parts.requiredParts[0]?.amount ?? 0,
        }
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
      const parts = await repairPartsPreview(char.id, item)
      return reply.send({
        item,
        durabilityCurrent: item.durabilityCurrent,
        durabilityMax: item.durabilityMax,
        lostDurability: lostDur,
        repairCost: cost,
        canAfford: char.money >= cost,
        characterMoney: char.money,
        itemTier: item.template.itemTier,
        upgradeLevel: item.upgradeLevel,
        ...parts,
        canRepair: char.money >= cost && parts.partsEnough,
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
        let partsSpent: { resourceCode: string; amount: number } | null = null
        if (needsRepairParts(item.template.itemTier, item.upgradeLevel)) {
          const code = repairPartsCode(item.template.repairResourceCode)
          const resource = await tx.resourceTemplate.findUnique({ where: { code } })
          if (!resource || !resource.isActive || !resource.isRepairMaterial) throw AppError.internal(`Repair resource misconfigured: ${code}`)
          const amount = calcRequiredRepairParts(lostDur, item.durabilityMax, item.template.itemTier, item.upgradeLevel)
          await ResourcesService.consume(tx, { characterId: char.id, resourceTemplateId: resource.id, amount, reasonCode: 'REPAIR_USE', refType: 'repair', refId: item.id })
          partsSpent = { resourceCode: code, amount }
        }

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
            details: { cost, durBefore: item.durabilityCurrent, durAfter: item.durabilityMax, partsSpent },
          },
        })

        audit('item.repaired', { characterId: char.id, itemId: item.id, cost })
        return { itemId: item.id, durabilityAfter: item.durabilityMax, cost, partsSpent, newBalance }
      })

      return reply.send(result)
    })
}
