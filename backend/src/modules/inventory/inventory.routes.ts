import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { CharactersRepository } from '../characters/characters.repository'
import { ItemsRepository } from '../items/item-instance.repository'
import { WeaponSkillsRepository } from '../weapon-skills/weapon-skills.repository'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { LogsRepository } from '../logs/logs.repository'
import { audit } from '../../shared/logger/audit-logger'
import { z } from 'zod'

const EquipSchema = z.object({ itemInstanceId: z.string().uuid() })
const UnequipSchema = z.object({ armorSlot: z.string().optional(), itemInstanceId: z.string().uuid().optional() })

export async function inventoryRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /api/inventory
  fastify.get('/', { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const char = await CharactersRepository.findByUserId(req.authUser.userId)
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)
      const items = await ItemsRepository.findByOwner(char.id)
      return reply.send(items)
    })

  // POST /api/inventory/equip
  fastify.post('/equip', { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = EquipSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })

      const char = await CharactersRepository.findByUserId(req.authUser.userId)
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)

      const item = await ItemsRepository.findInstanceById(parsed.data.itemInstanceId)
      if (!item) throw AppError.notFound('Item', parsed.data.itemInstanceId)
      if (item.ownerId !== char.id) throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your item', 403)
      if (item.status === 'BROKEN') throw new AppError(ErrorCode.ITEM_BROKEN, 'Item is broken, repair first', 400)
      if (item.isEquipped) throw new AppError(ErrorCode.ITEM_ALREADY_EQUIPPED, 'Already equipped', 400)

      // Level requirement check
      if (char.battleLevel < item.template.levelReq) {
        throw new AppError(ErrorCode.ITEM_LEVEL_REQ, `Нужен боевой уровень ${item.template.levelReq}`, 400)
      }

      // STR requirement check (TZ section 4.2)
      const charStats = char.stats
      if (charStats && item.template.strReq > 0 && charStats.str < item.template.strReq) {
        throw new AppError(ErrorCode.ITEM_LEVEL_REQ, `Нужна сила (STR) ${item.template.strReq}`, 400)
      }

      // Weapon skill requirement check
      if (item.template.skillReq > 0 && item.template.weaponType) {
        const skill = await WeaponSkillsRepository.getByType(char.id, item.template.weaponType)
        if (!skill || skill.skillLevel < item.template.skillReq) {
          throw new AppError(ErrorCode.ITEM_LEVEL_REQ, `Нужен навык оружия ${item.template.skillReq}`, 400)
        }
      }

      // Unequip existing in the same slot if armor
      if (item.template.type === 'ARMOR' && item.template.armorSlot) {
        const existing = await ItemsRepository.findEquippedBySlot(char.id, item.template.armorSlot)
        if (existing) {
          await ItemsRepository.unequip(existing.id)
          await LogsRepository.logItem({ itemId: existing.id, characterId: char.id, actionCode: 'UNEQUIPPED' })
        }
      }
      // Unequip existing main weapon if this is a weapon
      if (item.template.type === 'WEAPON') {
        const existingWeapon = await ItemsRepository.findEquippedWeapon(char.id)
        if (existingWeapon) {
          await ItemsRepository.unequip(existingWeapon.id)
          await LogsRepository.logItem({ itemId: existingWeapon.id, characterId: char.id, actionCode: 'UNEQUIPPED' })
        }
      }

      const slot = item.template.type === 'ARMOR' ? item.template.armorSlot : null
      await ItemsRepository.equip(item.id, slot)
      await LogsRepository.logItem({ itemId: item.id, characterId: char.id, actionCode: 'EQUIPPED' })
      audit('item.equipped', { characterId: char.id, itemId: item.id })

      return reply.send({ message: 'Equipped', itemId: item.id })
    })

  // POST /api/inventory/unequip
  fastify.post('/unequip', { preHandler: authenticate },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = UnequipSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })

      const char = await CharactersRepository.findByUserId(req.authUser.userId)
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Character not found', 404)

      let item = null
      if (parsed.data.itemInstanceId) {
        item = await ItemsRepository.findInstanceById(parsed.data.itemInstanceId)
      } else if (parsed.data.armorSlot) {
        item = await ItemsRepository.findEquippedBySlot(char.id, parsed.data.armorSlot)
      }

      if (!item) throw AppError.notFound('Equipped item')
      if (item.ownerId !== char.id) throw new AppError(ErrorCode.ITEM_NOT_OWNED, 'Not your item', 403)
      if (!item.isEquipped) throw new AppError(ErrorCode.ITEM_NOT_EQUIPPED, 'Item is not equipped', 400)

      await ItemsRepository.unequip(item.id)
      await LogsRepository.logItem({ itemId: item.id, characterId: char.id, actionCode: 'UNEQUIPPED' })
      audit('item.unequipped', { characterId: char.id, itemId: item.id })

      return reply.send({ message: 'Unequipped', itemId: item.id })
    })
}
