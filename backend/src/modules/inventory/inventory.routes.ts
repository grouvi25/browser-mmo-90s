import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { CharactersRepository } from '../characters/characters.repository'
import { ItemsRepository } from '../items/item-instance.repository'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { withTransaction } from '../../shared/db/transaction'
import { audit } from '../../shared/logger/audit-logger'
import { z } from 'zod'

const EquipSchema = z.object({ itemInstanceId: z.string().uuid() })
const UnequipSchema = z.object({ armorSlot: z.string().optional(), itemInstanceId: z.string().uuid().optional() })

export async function inventoryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const char = await CharactersRepository.findByUserId(req.authUser.userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
    return reply.send(await ItemsRepository.findByOwner(char.id))
  })

  fastify.post('/equip', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = EquipSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })

    const result = await withTransaction(async tx => {
      const char = await tx.character.findUnique({
        where: { userId: req.authUser.userId },
        include: { stats: true },
      })
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
      if (char.status === 'IN_BATTLE') {
        throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Cannot change equipment during battle', 409)
      }

      const item = await tx.itemInstance.findUnique({
        where: { id: parsed.data.itemInstanceId },
        include: { template: true },
      })
      if (!item) throw AppError.notFound('Item', parsed.data.itemInstanceId)
      if (item.ownerId !== char.id) throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your item', 403)
      if (item.status === 'BROKEN') throw new AppError(ErrorCode.ITEM_BROKEN, 'Item is broken, repair first', 400)
      if (item.status === 'DELETED' || item.status === 'CONSUMED') {
        throw new AppError(ErrorCode.ITEM_NOT_AVAILABLE, 'Item is not available', 409)
      }
      if (item.isEquipped) throw new AppError(ErrorCode.ITEM_ALREADY_EQUIPPED, 'Already equipped', 400)
      if (!item.template.isEquippable) throw new AppError(ErrorCode.ITEM_NOT_AVAILABLE, 'Item cannot be equipped', 400)
      if (char.battleLevel < item.template.levelReq) {
        throw new AppError(ErrorCode.ITEM_LEVEL_REQ, `Нужен боевой уровень ${item.template.levelReq}`, 400)
      }
      if (char.stats && item.template.strReq > 0 && char.stats.str < item.template.strReq) {
        throw new AppError(ErrorCode.ITEM_LEVEL_REQ, `Нужна сила (STR) ${item.template.strReq}`, 400)
      }
      if (item.template.skillReq > 0 && item.template.weaponType) {
        const skill = await tx.weaponSkill.findUnique({
          where: { characterId_weaponType: { characterId: char.id, weaponType: item.template.weaponType } },
        })
        if (!skill || skill.skillLevel < item.template.skillReq) {
          throw new AppError(ErrorCode.ITEM_LEVEL_REQ, `Нужен навык оружия ${item.template.skillReq}`, 400)
        }
      }

      const slot = item.template.type === 'ARMOR' || item.template.type === 'SHIELD'
        ? item.template.armorSlot
        : null
      const existing = await tx.itemInstance.findMany({
        where: {
          ownerId: char.id,
          isEquipped: true,
          status: { not: 'DELETED' },
          ...(item.template.type === 'WEAPON'
            ? { template: { type: 'WEAPON' } }
            : { armorSlot: slot }),
        },
        select: { id: true },
      })

      if (existing.length > 0) {
        await tx.itemInstance.updateMany({
          where: { id: { in: existing.map(entry => entry.id) }, ownerId: char.id, isEquipped: true },
          data: { isEquipped: false, status: 'NORMAL', armorSlot: null },
        })
        await tx.itemLog.createMany({
          data: existing.map(entry => ({
            itemId: entry.id,
            characterId: char.id,
            actionCode: 'UNEQUIPPED' as const,
          })),
        })
      }

      const equipped = await tx.itemInstance.updateMany({
        where: {
          id: item.id,
          ownerId: char.id,
          isEquipped: false,
          status: { notIn: ['BROKEN', 'DELETED', 'CONSUMED'] },
        },
        data: { isEquipped: true, status: 'EQUIPPED', armorSlot: slot },
      })
      if (equipped.count !== 1) throw new AppError(ErrorCode.CONFLICT, 'Equipment changed concurrently', 409)

      await tx.itemLog.create({
        data: { itemId: item.id, characterId: char.id, actionCode: 'EQUIPPED' },
      })
      return { characterId: char.id, itemId: item.id }
    })

    audit('item.equipped', result)
    return reply.send({ message: 'Equipped', itemId: result.itemId })
  })

  fastify.post('/unequip', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = UnequipSchema.safeParse(req.body)
    if (!parsed.success || (!parsed.data.itemInstanceId && !parsed.data.armorSlot)) {
      return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    }

    const result = await withTransaction(async tx => {
      const char = await tx.character.findUnique({ where: { userId: req.authUser.userId } })
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
      if (char.status === 'IN_BATTLE') {
        throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Cannot change equipment during battle', 409)
      }

      const item = await tx.itemInstance.findFirst({
        where: parsed.data.itemInstanceId
          ? { id: parsed.data.itemInstanceId, ownerId: char.id }
          : { ownerId: char.id, isEquipped: true, armorSlot: parsed.data.armorSlot as never },
      })
      if (!item) throw AppError.notFound('Equipped item')
      if (!item.isEquipped) throw new AppError(ErrorCode.ITEM_NOT_EQUIPPED, 'Item is not equipped', 400)

      const updated = await tx.itemInstance.updateMany({
        where: { id: item.id, ownerId: char.id, isEquipped: true },
        data: { isEquipped: false, status: 'NORMAL', armorSlot: null },
      })
      if (updated.count !== 1) throw new AppError(ErrorCode.CONFLICT, 'Equipment changed concurrently', 409)
      await tx.itemLog.create({
        data: { itemId: item.id, characterId: char.id, actionCode: 'UNEQUIPPED' },
      })
      return { characterId: char.id, itemId: item.id }
    })

    audit('item.unequipped', result)
    return reply.send({ message: 'Unequipped', itemId: result.itemId })
  })

  fastify.post('/use-item', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = EquipSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })

    const result = await withTransaction(async tx => {
      const char = await tx.character.findUnique({ where: { userId: req.authUser.userId } })
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
      if (char.status === 'IN_BATTLE') {
        throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Используй расходник через меню действий в бою', 400)
      }
      if (char.hpCurrent >= char.hpMax) throw new AppError(ErrorCode.CONFLICT, 'HP уже полное — расходник не нужен', 400)

      const item = await tx.itemInstance.findUnique({
        where: { id: parsed.data.itemInstanceId },
        include: { template: true },
      })
      if (!item) throw AppError.notFound('Item', parsed.data.itemInstanceId)
      if (item.ownerId !== char.id) throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your item', 403)
      if (item.template.type !== 'CONSUMABLE') {
        throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Это не расходник', 400)
      }

      const consumed = await tx.itemInstance.updateMany({
        where: { id: item.id, ownerId: char.id, status: { notIn: ['CONSUMED', 'DELETED'] } },
        data: { status: 'DELETED', isEquipped: false },
      })
      if (consumed.count !== 1) throw new AppError(ErrorCode.CONFLICT, 'Предмет уже использован', 409)

      const hpRestore = item.template.hpBonus ?? 0
      const newHp = Math.min(char.hpMax, char.hpCurrent + hpRestore)
      await tx.character.update({ where: { id: char.id }, data: { hpCurrent: newHp } })
      await tx.itemLog.create({
        data: {
          itemId: item.id,
          characterId: char.id,
          actionCode: 'STATUS_CHANGED',
          details: { from: item.status, to: 'DELETED', reason: 'CONSUMED' },
        },
      })

      return { hpRestored: newHp - char.hpCurrent, newHp, hpMax: char.hpMax, itemName: item.template.name }
    })

    return reply.send(result)
  })
}
