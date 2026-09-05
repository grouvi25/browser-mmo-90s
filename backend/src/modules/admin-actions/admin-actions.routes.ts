// =============================================================
// АДМИНКА: обратимые действия, откат и цепочка транзакций — шаг G2.
//
// Здесь появляются мутации разделов Этапа 4. Каждая обязана иметь обратную
// операцию и причину от десяти символов; ручки, у которых обратной операции
// нет, в этом файле отсутствуют — и это не пропуск, а правило П1.
//
// ТЗ: docs/specs/stage-5/STAGE5_ADMIN_API.md разделы 2–5.
// =============================================================
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { requireAdminRole } from '../../shared/security/auth-middleware'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { AdminActionsService, REASON_MIN, type AdminContext } from './admin-actions.service'
import { AdminTraceService } from './admin-trace.service'
import { PremiumService } from '../premium/premium.service'
import { AntiAbuseService } from '../antiabuse/antiabuse.service'

const READ_ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN', 'MODERATOR', 'SUPPORT') }
const MODERATE_ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN', 'MODERATOR') }
const SUPER_ADMIN = { preHandler: requireAdminRole('SUPER_ADMIN') }

const Id = z.string().uuid()
const Reason = z.string().trim().min(REASON_MIN).max(500)
const ReasonBody = z.object({ reason: Reason })

const ctx = (req: FastifyRequest): AdminContext => ({
  adminId: req.adminUser.adminId,
  adminRole: req.adminUser.role,
})

function invalid(reply: { code: (n: number) => { send: (body: unknown) => unknown } }) {
  return reply.code(422).send({ code: 'GEN_001', message: 'Validation error' })
}

/**
 * Разбор тела с причиной.
 *
 * Короткая причина — отдельный код ошибки, а не общий 422: «сообщение
 * невалидно» ничего не говорит админу, который написал «фикс».
 */
function reasonOf(body: unknown): string {
  const parsed = ReasonBody.safeParse(body)
  if (!parsed.success) {
    throw new AppError(
      ErrorCode.ADMIN_REASON_TOO_SHORT,
      `Нужна причина от ${REASON_MIN} символов`,
      422,
    )
  }
  return parsed.data.reason
}

export async function adminActionsRoutes(fastify: FastifyInstance): Promise<void> {
  // ── Журнал действий ─────────────────────────────────────
  fastify.get('/actions', READ_ADMIN, async (req, reply) => {
    const parsed = z.object({
      adminId: Id.optional(),
      targetType: z.string().min(1).max(32).optional(),
      targetId: z.string().min(1).max(64).optional(),
      cursor: Id.optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }).safeParse(req.query)
    if (!parsed.success) return invalid(reply)
    return reply.send(await AdminActionsService.list(parsed.data))
  })

  // Откат доступен только высшей роли: отменять чужие действия — это
  // вмешательство в экономику, а не модерация.
  fastify.post<{ Params: { id: string } }>('/actions/:id/rollback', SUPER_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return invalid(reply)
    const reason = reasonOf(req.body)
    return reply.send(await AdminActionsService.rollback(ctx(req), req.params.id, reason))
  })

  // ── Цепочка транзакций ──────────────────────────────────
  fastify.get('/trace', READ_ADMIN, async (req, reply) => {
    const parsed = z.object({
      type: z.enum(['item', 'character', 'clan']),
      // Не только uuid: раздел требовал идентификатор, которого человеку
      // взять неоткуда, и оттого выглядел бесполезным. Ник и название
      // бригады он знает всегда.
      id: z.string().min(1).max(60),
      limit: z.coerce.number().int().positive().max(500).optional(),
    }).safeParse(req.query)
    if (!parsed.success) return invalid(reply)

    let id = parsed.data.id
    if (!Id.safeParse(id).success) {
      const found = parsed.data.type === 'character'
        ? await prisma.character.findFirst({
          where: { nickname: { equals: id, mode: 'insensitive' } }, select: { id: true },
        })
        : parsed.data.type === 'clan'
          ? await prisma.clan.findFirst({
            where: { OR: [
              { name: { equals: id, mode: 'insensitive' } },
              { tag: { equals: id, mode: 'insensitive' } },
            ] }, select: { id: true },
          })
          : null
      if (!found) {
        return reply.code(404).send({
          code: 'GEN_002',
          message: parsed.data.type === 'item'
            ? 'У предмета нет имени — сюда нужен его идентификатор, он есть в карточке игрока'
            : 'Никого с таким именем не нашлось',
        })
      }
      id = found.id
    }
    return reply.send(await AdminTraceService.trace({ ...parsed.data, id }))
  })

  // ── Антиабуз ────────────────────────────────────────────
  fastify.get('/abuse/signals', READ_ADMIN, async (req, reply) => {
    const parsed = z.object({
      status: z.enum(['OPEN', 'REVIEWED', 'DISMISSED']).optional(),
      kind: z.enum([
        'MULTI_ACCOUNT', 'MATCH_FIXING', 'DUPLICATION', 'BOT_FARMING', 'WEAK_FARMING',
        'MONEY_FUNNEL', 'CLAN_STORAGE_DRAIN', 'MARKET_MANIPULATION', 'AUTOCLICKER',
        'HELPER_DRAIN', 'OBJECT_TRANSFER_TRAP', 'WAR_COLLUSION', 'CLAIM_REFUNDED',
        'ROBBERY_STREAK',
      ]).optional(),
      severity: z.coerce.number().int().min(1).max(3).optional(),
      cursor: Id.optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
    }).safeParse(req.query)
    if (!parsed.success) return invalid(reply)
    return reply.send(await AntiAbuseService.list(parsed.data))
  })

  fastify.get('/abuse/links', READ_ADMIN, async (req, reply) => {
    const parsed = z.object({ userId: Id }).safeParse(req.query)
    if (!parsed.success) return invalid(reply)
    return reply.send(await AntiAbuseService.linksOf(parsed.data.userId))
  })

  /**
   * Разобрать сигнал.
   *
   * Отклонение тоже требует причины и попадает в журнал админских действий:
   * массово отклонённые сигналы одного вида — повод пересмотреть правило, а
   * не игрока, и увидеть это можно только по причинам отклонений.
   *
   * Само действие обратимо тривиально: статус возвращается в OPEN. Поэтому
   * оно и заведено — правило П1 соблюдено.
   */
  fastify.post<{ Params: { id: string } }>('/abuse/signals/:id/review', MODERATE_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return invalid(reply)
    const reason = reasonOf(req.body)
    const parsed = z.object({ status: z.enum(['REVIEWED', 'DISMISSED']) }).safeParse(req.body)
    if (!parsed.success) return invalid(reply)

    const signal = await prisma.abuseSignal.findUnique({ where: { id: req.params.id } })
    if (!signal) return reply.code(404).send({ code: 'GEN_002', message: 'Signal not found' })

    await prisma.abuseSignal.update({
      where: { id: signal.id },
      data: {
        status: parsed.data.status,
        reviewedByAdminId: req.adminUser.adminId,
        reviewedAt: new Date(),
      },
    })
    const recorded = await AdminActionsService.record(ctx(req), reason, {
      kind: 'REVIEW_SIGNAL',
      payload: { signalId: signal.id, status: parsed.data.status },
      targetType: 'signal',
      targetId: signal.id,
      undo: { kind: 'REOPEN_SIGNAL', payload: { signalId: signal.id } },
    })
    return reply.send({ ...recorded, status: parsed.data.status })
  })

  // ── Деньги и предметы ───────────────────────────────────
  fastify.post('/characters/money', SUPER_ADMIN, async (req, reply) => {
    // Причина разбирается отдельно и своим кодом: «сообщение невалидно»
    // ничего не говорит админу, написавшему «фикс».
    const reason = reasonOf(req.body)
    const parsed = z.object({
      characterId: Id,
      // Знак задаёт направление: выдать или забрать. Две ручки вместо одной
      // разошлись бы правилами, а правило тут одно — обе обратимы.
      amount: z.number().int().refine(value => value !== 0).refine(value => Math.abs(value) <= 1_000_000),
    }).safeParse(req.body)
    if (!parsed.success) return invalid(reply)
    const { characterId, amount } = parsed.data

    const character = await prisma.character.findUnique({ where: { id: characterId } })
    if (!character) return reply.code(404).send({ code: 'GEN_002', message: 'Character not found' })

    const giving = amount > 0
    const result = await AdminActionsService.perform(ctx(req), reason, {
      kind: giving ? 'GRANT_MONEY' : 'TAKE_MONEY',
      payload: { characterId, amount: Math.abs(amount) },
      targetType: 'character',
      targetId: characterId,
      undo: {
        kind: giving ? 'TAKE_MONEY' : 'GRANT_MONEY',
        payload: { characterId, amount: Math.abs(amount) },
      },
    })
    return reply.send(result)
  })

  fastify.post('/items/grant', SUPER_ADMIN, async (req, reply) => {
    const reason = reasonOf(req.body)
    const parsed = z.object({ characterId: Id, templateId: Id }).safeParse(req.body)
    if (!parsed.success) return invalid(reply)
    const { characterId, templateId } = parsed.data

    const result = await AdminActionsService.perform(ctx(req), reason, {
      kind: 'GRANT_ITEM',
      payload: { characterId, templateId },
      targetType: 'character',
      targetId: characterId,
      // itemId обратной операции дописывается при исполнении: до создания
      // предмета его id не существует.
      undo: { kind: 'DELETE_ITEM', payload: { expectedOwnerId: characterId } },
    })
    return reply.code(201).send(result)
  })

  fastify.post<{ Params: { id: string } }>('/items/:id/delete', SUPER_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return invalid(reply)
    const reason = reasonOf(req.body)
    const item = await prisma.itemInstance.findUnique({ where: { id: req.params.id } })
    if (!item) return reply.code(404).send({ code: 'GEN_002', message: 'Item not found' })

    // Удаление отменяется не воскрешением строки, а выдачей такого же
    // предмета: восстановить износ, вставленные камни и распределённые очки
    // из снимка честно нельзя, а делать вид, что можно, — хуже.
    const result = await AdminActionsService.perform(ctx(req), reason, {
      kind: 'DELETE_ITEM',
      payload: { itemId: item.id, expectedOwnerId: item.ownerId },
      targetType: 'item',
      targetId: item.id,
      undo: {
        kind: 'GRANT_ITEM',
        payload: { characterId: item.ownerId, templateId: item.templateId },
      },
    })
    return reply.send(result)
  })

  // ── Рынок и лавки ───────────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/listings/:id/lock', MODERATE_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return invalid(reply)
    const reason = reasonOf(req.body)
    return reply.send(await AdminActionsService.perform(ctx(req), reason, {
      kind: 'LOCK_LISTING',
      payload: { listingId: req.params.id },
      targetType: 'listing',
      targetId: req.params.id,
      undo: { kind: 'UNLOCK_LISTING', payload: { listingId: req.params.id } },
    }))
  })

  fastify.post<{ Params: { id: string } }>('/listings/:id/unlock', MODERATE_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return invalid(reply)
    const reason = reasonOf(req.body)
    return reply.send(await AdminActionsService.perform(ctx(req), reason, {
      kind: 'UNLOCK_LISTING',
      payload: { listingId: req.params.id },
      targetType: 'listing',
      targetId: req.params.id,
      undo: { kind: 'LOCK_LISTING', payload: { listingId: req.params.id } },
    }))
  })

  fastify.post<{ Params: { id: string } }>('/shop-items/:id/deactivate', MODERATE_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return invalid(reply)
    const reason = reasonOf(req.body)
    return reply.send(await AdminActionsService.perform(ctx(req), reason, {
      kind: 'DEACTIVATE_SHOP_ITEM',
      payload: { itemId: req.params.id },
      targetType: 'shop-item',
      targetId: req.params.id,
      undo: { kind: 'ACTIVATE_SHOP_ITEM', payload: { itemId: req.params.id } },
    }))
  })

  // ── Территории и заявки ─────────────────────────────────
  fastify.post<{ Params: { code: string } }>('/territories/:code/reset', SUPER_ADMIN, async (req, reply) => {
    const reason = reasonOf(req.body)
    const territory = await prisma.territory.findUnique({ where: { code: req.params.code } })
    if (!territory) return reply.code(404).send({ code: 'GEN_002', message: 'Territory not found' })

    return reply.send(await AdminActionsService.perform(ctx(req), reason, {
      kind: 'RESET_TERRITORY',
      payload: { code: territory.code },
      targetType: 'territory',
      targetId: territory.code,
      // Снимок прежнего состояния — вся обратная операция целиком.
      undo: {
        kind: 'RESTORE_TERRITORY',
        payload: {
          code: territory.code,
          ownerClanId: territory.ownerClanId,
          status: territory.status,
          controlledAt: territory.controlledAt?.toISOString() ?? null,
          protectedUntil: territory.protectedUntil?.toISOString() ?? null,
          upkeepTier: territory.upkeepTier,
          upkeepDebt: territory.upkeepDebt,
        },
      },
    }))
  })

  /**
   * Погасить заявку БЕЗ возврата взноса.
   *
   * Гашения С возвратом у админа нет и не будет: пока заявка висела, район
   * был занят, а после возврата его мог занять другой клан — обратной
   * операции у такого действия не существует. Автоматический возврат при
   * сбое назначения остаётся у воркера, это не админское действие.
   */
  fastify.post<{ Params: { id: string } }>('/claims/:id/expire', SUPER_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return invalid(reply)
    const reason = reasonOf(req.body)
    const claim = await prisma.territoryClaim.findUnique({ where: { id: req.params.id } })
    if (!claim) return reply.code(404).send({ code: 'GEN_002', message: 'Claim not found' })

    return reply.send(await AdminActionsService.perform(ctx(req), reason, {
      kind: 'EXPIRE_CLAIM',
      payload: { claimId: claim.id },
      targetType: 'claim',
      targetId: claim.id,
      undo: { kind: 'RESTORE_CLAIM', payload: { claimId: claim.id } },
    }))
  })

  fastify.post<{ Params: { id: string } }>('/clans/:id/authority', SUPER_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return invalid(reply)
    const reason = reasonOf(req.body)
    const parsed = z.object({
      amount: z.number().refine(value => value !== 0).refine(value => Math.abs(value) <= 10_000),
    }).safeParse(req.body)
    if (!parsed.success) return invalid(reply)

    const clan = await prisma.clan.findUnique({ where: { id: req.params.id } })
    if (!clan) return reply.code(404).send({ code: 'GEN_002', message: 'Clan not found' })

    return reply.send(await AdminActionsService.perform(ctx(req), reason, {
      kind: 'ADJUST_AUTHORITY',
      payload: { clanId: clan.id, amount: parsed.data.amount },
      targetType: 'clan',
      targetId: clan.id,
      undo: { kind: 'ADJUST_AUTHORITY', payload: { clanId: clan.id, amount: -parsed.data.amount } },
    }))
  })

  // ── Налёты и помощники ──────────────────────────────────
  fastify.post<{ Params: { id: string } }>('/attacks/:id/clear-cooldown', MODERATE_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return invalid(reply)
    const reason = reasonOf(req.body)
    const attack = await prisma.objectAttack.findUnique({ where: { id: req.params.id } })
    if (!attack) return reply.code(404).send({ code: 'GEN_002', message: 'Attack not found' })

    return reply.send(await AdminActionsService.perform(ctx(req), reason, {
      kind: 'CLEAR_ATTACK_COOLDOWN',
      payload: { attackId: attack.id },
      targetType: 'object',
      targetId: attack.objectId,
      undo: {
        kind: 'RESTORE_ATTACK_COOLDOWN',
        payload: { attackId: attack.id, createdAt: attack.createdAt.toISOString() },
      },
    }))
  })

  fastify.post<{ Params: { id: string } }>('/helpers/:id/sleep', MODERATE_ADMIN, async (req, reply) => {
    if (!Id.safeParse(req.params.id).success) return invalid(reply)
    const reason = reasonOf(req.body)
    const helper = await prisma.helper.findUnique({ where: { id: req.params.id } })
    if (!helper) return reply.code(404).send({ code: 'GEN_002', message: 'Helper not found' })

    return reply.send(await AdminActionsService.perform(ctx(req), reason, {
      kind: 'SLEEP_HELPER',
      payload: { helperId: helper.id },
      targetType: 'helper',
      targetId: helper.id,
      undo: { kind: 'WAKE_HELPER', payload: { helperId: helper.id } },
    }))
  })

  // ── Премиум ─────────────────────────────────────────────
  //
  // Исполняется своим сервисом: продление считается от остатка срока и
  // пишет покупку. Журнал записывает результат и снимок прежнего срока —
  // повторять эту логику здесь значило бы завести вторую правду.
  fastify.post('/premium/grant', SUPER_ADMIN, async (req, reply) => {
    const reason = reasonOf(req.body)
    const parsed = z.object({
      characterId: Id,
      productCode: z.string().min(3).max(64),
      days: z.number().int().positive().max(3650).optional(),
    }).safeParse(req.body)
    if (!parsed.success) return invalid(reply)

    const before = await prisma.character.findUnique({
      where: { id: parsed.data.characterId },
      select: { isPremium: true, premiumExpiresAt: true },
    })
    if (!before) return reply.code(404).send({ code: 'GEN_002', message: 'Character not found' })

    const granted = await PremiumService.grant({
      characterId: parsed.data.characterId,
      productCode: parsed.data.productCode,
      days: parsed.data.days,
      adminId: req.adminUser.adminId,
    })
    const purchase = await prisma.premiumPurchase.findFirst({
      where: { characterId: parsed.data.characterId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })

    const recorded = await AdminActionsService.record(ctx(req), reason, {
      kind: 'GRANT_PREMIUM',
      payload: { characterId: parsed.data.characterId, productCode: parsed.data.productCode },
      targetType: 'character',
      targetId: parsed.data.characterId,
      undo: {
        kind: 'RESTORE_PREMIUM',
        payload: {
          characterId: parsed.data.characterId,
          isPremium: before.isPremium,
          premiumExpiresAt: before.premiumExpiresAt?.toISOString() ?? null,
          purchaseId: purchase?.id ?? null,
        },
      },
    })
    return reply.send({ ...recorded, ...granted })
  })

  fastify.post('/premium/revoke', SUPER_ADMIN, async (req, reply) => {
    const reason = reasonOf(req.body)
    const parsed = z.object({ characterId: Id }).safeParse(req.body)
    if (!parsed.success) return invalid(reply)

    const before = await prisma.character.findUnique({
      where: { id: parsed.data.characterId },
      select: { isPremium: true, premiumExpiresAt: true },
    })
    if (!before) return reply.code(404).send({ code: 'GEN_002', message: 'Character not found' })

    const result = await PremiumService.revoke(parsed.data.characterId)
    const recorded = await AdminActionsService.record(ctx(req), reason, {
      kind: 'REVOKE_PREMIUM',
      payload: { characterId: parsed.data.characterId },
      targetType: 'character',
      targetId: parsed.data.characterId,
      undo: {
        kind: 'RESTORE_PREMIUM',
        payload: {
          characterId: parsed.data.characterId,
          isPremium: before.isPremium,
          premiumExpiresAt: before.premiumExpiresAt?.toISOString() ?? null,
          purchaseId: null,
        },
      },
    })
    return reply.send({ ...recorded, ...result })
  })
}
