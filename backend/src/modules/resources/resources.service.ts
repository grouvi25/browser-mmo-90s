import type { Prisma, ResourceLogReason } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { withIdempotency } from '../../shared/db/idempotency'
import { availableResourceAmount, calcGovernmentResourcePayout, calcResourceWeight } from './resources.formulas'

async function logResource(tx: Prisma.TransactionClient, params: {
  characterId: string; resourceTemplateId: string; amountDelta: number; balanceAfter: number
  reasonCode: ResourceLogReason; refType?: string; refId?: string
}) {
  await tx.resourceLog.create({ data: params })
}

export const ResourcesService = {
  async list(characterId: string) {
    const stacks = await prisma.resourceStack.findMany({
      where: { characterId }, include: { template: true }, orderBy: { template: { tier: 'asc' } },
    })
    const totalWeight = stacks.reduce((sum, stack) => sum + calcResourceWeight(stack.amount, stack.template.weight), 0)
    return { items: stacks.map(stack => ({ ...stack, availableAmount: availableResourceAmount(stack.amount, stack.reservedAmount) })), totalWeight }
  },

  async add(tx: Prisma.TransactionClient, params: {
    characterId: string; resourceTemplateId: string; amount: number; reasonCode: ResourceLogReason; refType?: string; refId?: string
  }) {
    if (!Number.isInteger(params.amount) || params.amount <= 0) throw new AppError(ErrorCode.CONFLICT, 'Invalid resource amount', 422)
    const stack = await tx.resourceStack.upsert({
      where: { characterId_resourceTemplateId: { characterId: params.characterId, resourceTemplateId: params.resourceTemplateId } },
      update: { amount: { increment: params.amount } },
      create: { characterId: params.characterId, resourceTemplateId: params.resourceTemplateId, amount: params.amount },
    })
    await logResource(tx, { ...params, amountDelta: params.amount, balanceAfter: stack.amount })
    return stack
  },

  async consume(tx: Prisma.TransactionClient, params: {
    characterId: string; resourceTemplateId: string; amount: number; reasonCode: ResourceLogReason; refType?: string; refId?: string
  }) {
    if (!Number.isInteger(params.amount) || params.amount <= 0) throw new AppError(ErrorCode.CONFLICT, 'Invalid resource amount', 422)
    const changed = await tx.resourceStack.updateMany({
      where: { characterId: params.characterId, resourceTemplateId: params.resourceTemplateId, amount: { gte: params.amount } },
      data: { amount: { decrement: params.amount } },
    })
    if (changed.count !== 1) throw new AppError(ErrorCode.CONFLICT, 'Insufficient resources', 409)
    const stack = await tx.resourceStack.findUniqueOrThrow({
      where: { characterId_resourceTemplateId: { characterId: params.characterId, resourceTemplateId: params.resourceTemplateId } },
    })
    if (stack.amount < stack.reservedAmount) throw new AppError(ErrorCode.CONFLICT, 'Reserved resource invariant violated', 409)
    await logResource(tx, { ...params, amountDelta: -params.amount, balanceAfter: stack.amount })
    return stack
  },

  async sell(characterId: string, resourceCode: string, amount: number, idempotencyKey: string) {
    return withIdempotency({ characterId, scope: 'resources.sell', key: idempotencyKey, execute: async tx => {
      const template = await tx.resourceTemplate.findUnique({ where: { code: resourceCode } })
      if (!template?.isActive) throw new AppError(ErrorCode.CONFLICT, 'Resource is not available', 404)
      const stack = await tx.resourceStack.findUnique({
        where: { characterId_resourceTemplateId: { characterId, resourceTemplateId: template.id } },
      })
      if (!stack || stack.amount - stack.reservedAmount < amount) throw new AppError(ErrorCode.CONFLICT, 'Insufficient available resources', 409)
      const payout = calcGovernmentResourcePayout(amount, template.basePrice)
      await this.consume(tx, { characterId, resourceTemplateId: template.id, amount, reasonCode: 'GOVERNMENT_SELL', refType: 'resource' })
      const newBalance = await EconomyService.credit(tx, { characterId, amount: payout, reasonCode: 'RESOURCE_SELL', refType: 'resource', refId: template.id })
      const ecoExpGain = Math.round(amount * template.basePrice * 0.01)
      const economy = await EconomyService.grantEconomicExp(tx, characterId, ecoExpGain)
      return { resourceCode, amount, payout, newBalance, ecoExpGain, ...economy }
    }})
  },
}
