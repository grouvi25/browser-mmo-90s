import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { authenticate } from '../../shared/security/auth-middleware'
import { CharactersRepository } from '../characters/characters.repository'
import { ItemsRepository } from '../items/item-instance.repository'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { withTransaction } from '../../shared/db/transaction'
import { prisma } from '../../shared/db/prisma'
import { audit } from '../../shared/logger/audit-logger'
import { z } from 'zod'
import { BalanceConfig } from '../../config/balance.config'
import type { Prisma } from '@prisma/client'
import { ITEM_STAT_KEYS, itemBudget } from '../items/item-stats.formulas'
import { ItemStatsService } from '../items/item-stats.service'
import { applyUpgradeModifiers, type UpgradeKind } from '../upgrades/upgrades.formulas'
import { CHARM_KEYS, GEAR_STAT_KEYS, MASTERY_KEYS, syncHpWithGear } from '../items/gear-bonuses'

const EquipSchema = z.object({ itemInstanceId: z.string().uuid(), hand: z.enum(['LEFT_HAND', 'RIGHT_HAND']).optional() })
const UnequipSchema = z.object({ armorSlot: z.string().optional(), itemInstanceId: z.string().uuid().optional() })
const AllocateSchema = z.object({ itemInstanceId: z.string().uuid(), stat: z.enum(ITEM_STAT_KEYS), points: z.number().int().min(1).max(100) })
/** Одно поле настройки вещи. Предела нет: хоть весь бюджет в один стат (заказчик 31.10). */
const POINTS = z.number().int().min(0)
const ConfigureSchema = z.object({
  itemInstanceId: z.string().uuid(),
  own: z.partialRecord(z.enum(ITEM_STAT_KEYS), z.number().int().min(0).max(1000)),
  bonuses: z.object({
    stats: z.partialRecord(z.enum(GEAR_STAT_KEYS), z.number().int()),
    mastery: z.partialRecord(z.enum(MASTERY_KEYS), POINTS),
    minusMastery: z.partialRecord(z.enum(MASTERY_KEYS), POINTS),
    charms: z.partialRecord(z.enum(CHARM_KEYS), POINTS),
    minusCharms: z.partialRecord(z.enum(CHARM_KEYS), POINTS),
  }),
})

type Tx = Prisma.TransactionClient
type CharWithStats = Prisma.CharacterGetPayload<{ include: { stats: true } }>
type ItemWithTemplate = Prisma.ItemInstanceGetPayload<{ include: { template: true } }>

/** Можно ли надеть вещь: своя, цела, не надета, проходят требования. */
export async function assertEquippable(tx: Tx, char: CharWithStats, item: ItemWithTemplate): Promise<void> {
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
}

export async function inventoryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const char = await CharactersRepository.findByUserId(req.authUser.userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    // Итоговые характеристики — той же формулой, что считает бой: очки,
    // улучшения и камни прибавляются к базовым (правка заказчика 21.10:
    // «добавлялось к уже готовым статам, а если нет — новый стат внизу»).
    const items = await ItemsRepository.findByOwner(char.id)
    const tsum = new Set((await prisma.dollarShopItem.findMany({ where: { shop: 'TSUM' }, select: { templateId: true } })).map(row => row.templateId))
    const named = BalanceConfig.economy.namedItems
    return reply.send(items.map(item => ({
      ...item,
      budget: itemBudget(item.template, item.namedLevel),
      canSetIcon: tsum.has(item.templateId),
      percentPerPoint: named.percentPerPoint,
      levelUp: tsum.has(item.templateId) && item.template.allocationMode === 'PLAYER'
        ? { priceUsd: named.levelPriceUsd, points: named.pointsPerLevel, maxLevel: named.maxLevel } : null,
      effective: applyUpgradeModifiers(
        item.template,
        (item.upgradeModifiersJson as Partial<Record<UpgradeKind, number>> | null) ?? {},
        item.statAllocation, item.socketsJson,
      ),
    })))
  })

  fastify.post('/allocate-points', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = AllocateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
    const char = await CharactersRepository.findByUserId(req.authUser.userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    return reply.send(await ItemStatsService.allocate(char.id, parsed.data.itemInstanceId, parsed.data.stat, parsed.data.points))
  })

  // Столбики именной вещи (правка 31.10): весь расклад одним сохранением.
  fastify.post('/configure', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = ConfigureSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'В полях должны быть целые числа' })
    const char = await CharactersRepository.findByUserId(req.authUser.userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    return reply.send(await ItemStatsService.configure(char.id, parsed.data.itemInstanceId, parsed.data.own, parsed.data.bonuses))
  })

  fastify.post<{ Params: { id: string } }>('/items/:id/level-up', { preHandler: authenticate }, async (req, reply) => {
    const key = req.headers['idempotency-key']
    if (typeof key !== 'string' || key.length < 8 || key.length > 128) throw AppError.validation('Требуется Idempotency-Key')
    const char = await CharactersRepository.findByUserId(req.authUser.userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    return reply.send(await ItemStatsService.levelUp(char.id, req.params.id, key))
  })

  // Без авторизации, как иконка бригады: картинку грузит тег <img>.
  fastify.get<{ Params: { id: string } }>('/items/:id/icon', async (req, reply) => {
    const icon = await ItemStatsService.icon(req.params.id)
    if (!icon) return reply.code(404).send()
    return reply.header('Content-Type', icon.mime).header('Cache-Control', 'public, max-age=31536000, immutable').send(icon.bytes)
  })

  fastify.put<{ Params: { id: string }; Body: { dataUrl: string } }>('/items/:id/icon', { preHandler: authenticate, bodyLimit: 200_000 }, async (req, reply) => {
    const parsed = z.object({ dataUrl: z.string().min(20).max(190_000) }).safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Картинка: PNG, JPEG или WebP' })
    const char = await CharactersRepository.findByUserId(req.authUser.userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    return reply.send(await ItemStatsService.setIcon(char.id, req.params.id, parsed.data.dataUrl))
  })

  fastify.post('/equip', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = EquipSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })

    const result = await withTransaction(async tx => {
      const char = await tx.character.findUnique({
        where: { userId: req.authUser.userId },
        include: { stats: true },
      })
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
      if (char.status === 'IN_BATTLE') {
        throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'Cannot change equipment during battle', 409)
      }

      const item = await tx.itemInstance.findUnique({
        where: { id: parsed.data.itemInstanceId },
        include: { template: true },
      })
      if (!item) throw AppError.notFound('Item', parsed.data.itemInstanceId)
      await assertEquippable(tx, char, item)

      // Без явной руки оружие идёт в свободную: раньше всегда в левую, и второй
      // нож снимал первый — «в 2 руки 2 ножа нельзя взять» (правка заказчика 20.10).
      let freeHand: 'LEFT_HAND' | 'RIGHT_HAND' = 'LEFT_HAND'
      if (item.template.type === 'WEAPON' && !parsed.data.hand) {
        const busy = await tx.itemInstance.findMany({
          where: { ownerId: char.id, isEquipped: true, status: { not: 'DELETED' }, armorSlot: { in: ['LEFT_HAND', 'RIGHT_HAND'] } },
          select: { armorSlot: true },
        })
        const taken = new Set(busy.map(entry => entry.armorSlot))
        if (taken.has('LEFT_HAND') && !taken.has('RIGHT_HAND')) freeHand = 'RIGHT_HAND'
      }
      // Кольца две, как руки: второе идёт на свободное место, третье меняет первое.
      let ringSlot: 'RING' | 'RING_2' = 'RING'
      if (item.template.armorSlot === 'RING') {
        const busy = await tx.itemInstance.findMany({
          where: { ownerId: char.id, isEquipped: true, status: { not: 'DELETED' }, armorSlot: { in: ['RING', 'RING_2'] } },
          select: { armorSlot: true },
        })
        const taken = new Set(busy.map(entry => entry.armorSlot))
        if (taken.has('RING') && !taken.has('RING_2')) ringSlot = 'RING_2'
      }
      const slot = item.template.type === 'WEAPON'
        ? (parsed.data.hand ?? freeHand)
        : item.template.armorSlot === 'RING'
          ? ringSlot
          : item.template.type === 'ARMOR' || item.template.type === 'SHIELD' || item.template.type === 'ACCESSORY'
            ? item.template.armorSlot
            : null
      const existing = await tx.itemInstance.findMany({
        where: {
          ownerId: char.id,
          isEquipped: true,
          status: { not: 'DELETED' },
          armorSlot: slot,
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
      if (equipped.count !== 1) throw new AppError(ErrorCode.CONFLICT, 'Снаряжение только что изменилось, обновите страницу', 409)

      await tx.itemLog.create({
        data: { itemId: item.id, characterId: char.id, actionCode: 'EQUIPPED' },
      })
      await syncHpWithGear(tx, char.id)
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
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
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
      if (updated.count !== 1) throw new AppError(ErrorCode.CONFLICT, 'Снаряжение только что изменилось, обновите страницу', 409)
      await tx.itemLog.create({
        data: { itemId: item.id, characterId: char.id, actionCode: 'UNEQUIPPED' },
      })
      await syncHpWithGear(tx, char.id)
      return { characterId: char.id, itemId: item.id }
    })

    audit('item.unequipped', result)
    return reply.send({ message: 'Unequipped', itemId: result.itemId })
  })

  // ── Комплекты одежды ──────────────────────────────────────────
  const OUTFIT_SLOTS = 3
  const SlotParam = z.coerce.number().int().min(1).max(OUTFIT_SLOTS)
  const WEARABLE = ['WEAPON', 'ARMOR', 'SHIELD', 'ACCESSORY'] as const

  fastify.get('/outfits', { preHandler: authenticate }, async (req, reply) => {
    const char = await CharactersRepository.findByUserId(req.authUser.userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    const rows = await prisma.outfitPreset.findMany({ where: { characterId: char.id }, orderBy: { slot: 'asc' } })
    return reply.send({ slots: OUTFIT_SLOTS, items: rows.map(r => ({ slot: r.slot, name: r.name, count: (r.items as unknown[]).length })) })
  })

  // Сохранить надетое сейчас в комплект.
  fastify.post<{ Params: { slot: string }; Body: { name?: string } }>('/outfits/:slot/save', { preHandler: authenticate }, async (req, reply) => {
    const slot = SlotParam.safeParse(req.params.slot)
    if (!slot.success) return reply.code(422).send({ code: 'GEN_001', message: 'Нет такого комплекта' })
    const char = await CharactersRepository.findByUserId(req.authUser.userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    const worn = await prisma.itemInstance.findMany({
      where: { ownerId: char.id, isEquipped: true, status: { not: 'DELETED' }, template: { type: { in: [...WEARABLE] } } },
      select: { id: true, armorSlot: true },
    })
    if (worn.length === 0) throw new AppError(ErrorCode.CONFLICT, 'На вас ничего не надето — сохранять нечего', 409)
    const name = (req.body?.name ?? '').trim().slice(0, 32) || `Комплект ${slot.data}`
    const items = worn.map(w => ({ itemId: w.id, slot: w.armorSlot }))
    await prisma.outfitPreset.upsert({
      where: { characterId_slot: { characterId: char.id, slot: slot.data } },
      create: { characterId: char.id, slot: slot.data, name, items },
      update: { name, items },
    })
    return reply.send({ slot: slot.data, name, count: items.length })
  })

  // Надеть комплект: снять надетое и надеть сохранённое. Чего уже нет или
  // что сломалось — пропускаем и называем.
  fastify.post<{ Params: { slot: string } }>('/outfits/:slot/wear', { preHandler: authenticate }, async (req, reply) => {
    const slot = SlotParam.safeParse(req.params.slot)
    if (!slot.success) return reply.code(422).send({ code: 'GEN_001', message: 'Нет такого комплекта' })
    const result = await withTransaction(async tx => {
      const char = await tx.character.findUnique({ where: { userId: req.authUser.userId }, include: { stats: true } })
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
      if (char.status === 'IN_BATTLE') throw new AppError(ErrorCode.BATTLE_INVALID_ACTION, 'В бою переодеваться нельзя', 409)
      const preset = await tx.outfitPreset.findUnique({ where: { characterId_slot: { characterId: char.id, slot: slot.data } } })
      if (!preset) throw new AppError(ErrorCode.CONFLICT, 'Комплект пуст — сначала сохраните его', 409)
      const worn = await tx.itemInstance.findMany({
        where: { ownerId: char.id, isEquipped: true, status: { not: 'DELETED' }, template: { type: { in: [...WEARABLE] } } },
        select: { id: true },
      })
      if (worn.length) {
        await tx.itemInstance.updateMany({ where: { id: { in: worn.map(w => w.id) } }, data: { isEquipped: false, status: 'NORMAL', armorSlot: null } })
        await tx.itemLog.createMany({ data: worn.map(w => ({ itemId: w.id, characterId: char.id, actionCode: 'UNEQUIPPED' as const })) })
      }
      const skipped: string[] = []
      let equipped = 0
      for (const entry of preset.items as Array<{ itemId: string; slot: string | null }>) {
        const item = await tx.itemInstance.findUnique({ where: { id: entry.itemId }, include: { template: true } })
        if (!item) { skipped.push('вещь, которой у вас больше нет'); continue }
        try { await assertEquippable(tx, char, item) } catch (e) {
          skipped.push(`${item.template.name} (${e instanceof AppError ? e.message : 'нельзя надеть'})`)
          continue
        }
        await tx.itemInstance.update({ where: { id: item.id }, data: { isEquipped: true, status: 'EQUIPPED', armorSlot: entry.slot as never } })
        await tx.itemLog.create({ data: { itemId: item.id, characterId: char.id, actionCode: 'EQUIPPED' } })
        equipped++
      }
      await syncHpWithGear(tx, char.id)
      return { characterId: char.id, equipped, skipped }
    })
    audit('item.outfit_worn', { characterId: result.characterId, slot: slot.data, equipped: result.equipped })
    return reply.send({ equipped: result.equipped, skipped: result.skipped })
  })

  fastify.post('/use-item', { preHandler: authenticate }, async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = EquipSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })

    const result = await withTransaction(async tx => {
      const char = await tx.character.findUnique({ where: { userId: req.authUser.userId } })
      if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
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
