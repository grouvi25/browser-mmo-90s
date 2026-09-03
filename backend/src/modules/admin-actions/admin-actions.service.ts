// =============================================================
// ЖУРНАЛ АДМИНСКИХ ДЕЙСТВИЙ И ОТКАТ — шаг G2 Этапа 5
//
// Принцип П1: всё обратимо. Каждое действие записывает не только что
// сделано, но и КАК ЭТО ОТМЕНИТЬ — тип обратной операции и её параметры.
// Действие, для которого обратной операции нет, админу не выдаётся вовсе:
// не «мы потом придумаем», а «такой кнопки не будет».
//
// Откат — тоже действие: он пишется в журнал со ссылкой на отменённое и сам
// подчиняется тем же правилам.
//
// ТЗ: docs/specs/stage-5/STAGE5_ADMIN_API.md разделы 2 и 3.
// =============================================================
import { randomUUID } from 'crypto'
import type { AdminActionKind, AdminRole, Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { audit } from '../../shared/logger/audit-logger'
import { EconomyService } from '../economy/economy.service'

/** Минимальная длина причины. Правило П2 в числе. */
export const REASON_MIN = 10

export interface AdminContext {
  adminId: string
  adminRole: AdminRole
}

/** Одно звено: что сделать и с какими параметрами. */
export interface AdminOperation {
  kind: AdminActionKind
  payload: Prisma.InputJsonValue
}

export interface RecordedAction extends AdminOperation {
  targetType: string
  targetId: string
  undo: AdminOperation
}

/**
 * Исполнители операций.
 *
 * Один и тот же код применяет и прямое действие, и обратное: откат выдачи
 * денег — это списание, а списание админ и так умеет. Отдельная «ветка для
 * отката» разошлась бы с прямой веткой на первой же правке.
 *
 * Каждый исполнитель обязан проверять состояние и падать с ADMIN_004, если
 * мир изменился: откат выдачи предмета, который уже продан, — это не откат,
 * а кража у покупателя.
 */
type Executor = (tx: Prisma.TransactionClient, payload: Record<string, unknown>) => Promise<void>

function must<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new AppError(ErrorCode.ADMIN_STATE_CHANGED, message, 409)
  }
  return value
}

const str = (payload: Record<string, unknown>, key: string) => String(payload[key])
const num = (payload: Record<string, unknown>, key: string) => Number(payload[key])
const date = (payload: Record<string, unknown>, key: string) =>
  payload[key] === null || payload[key] === undefined ? null : new Date(String(payload[key]))

const EXECUTORS: Record<AdminActionKind, Executor> = {
  GRANT_MONEY: async (tx, payload) => {
    await EconomyService.credit(tx, {
      characterId: str(payload, 'characterId'),
      amount: num(payload, 'amount'),
      reasonCode: 'ADMIN_GRANT',
      note: String(payload.note ?? 'admin'),
      refType: 'admin_action',
      refId: payload.actionId ? str(payload, 'actionId') : undefined,
    })
  },

  TAKE_MONEY: async (tx, payload) => {
    const characterId = str(payload, 'characterId')
    const amount = num(payload, 'amount')
    const character = must(
      await tx.character.findUnique({ where: { id: characterId }, select: { money: true } }),
      'Персонаж не найден',
    )
    // Денег могло уже не остаться: игрок потратил выданное. Забирать в
    // минус нельзя — это создаёт долг, которого в игре нет.
    if (character.money < amount) {
      throw new AppError(
        ErrorCode.ADMIN_STATE_CHANGED,
        `Откат невозможен: у персонажа ${character.money} ₽, нужно ${amount} ₽`,
        409,
      )
    }
    await EconomyService.debit(tx, {
      characterId, amount,
      reasonCode: 'ADMIN_DEDUCT',
      note: String(payload.note ?? 'admin'),
      refType: 'admin_action',
      refId: payload.actionId ? str(payload, 'actionId') : undefined,
    })
  },

  GRANT_ITEM: async (tx, payload) => {
    const templateId = str(payload, 'templateId')
    const characterId = str(payload, 'characterId')
    const template = must(
      await tx.itemTemplate.findUnique({ where: { id: templateId } }),
      'Шаблон предмета не найден',
    )
    const item = await tx.itemInstance.create({
      data: {
        templateId, ownerId: characterId,
        quality: template.qualityBase,
        durabilityCurrent: template.durabilityMax,
        durabilityMax: template.durabilityMax,
        weight: template.weight,
        sourceType: 'ADMIN',
        usesLeft: template.type === 'TOOL' ? template.usesMax : null,
      },
    })
    await tx.itemLog.create({
      data: {
        itemId: item.id, characterId, actionCode: 'CREATED_BY_ADMIN',
        details: {
          templateName: template.name,
          reason: String(payload.note ?? ''),
          adminActionId: payload.actionId ?? null,
        },
      },
    })
    // Возвращаем id созданного предмета вызывающему: он нужен обратной
    // операции, а её параметры записываются той же транзакцией.
    payload.createdItemId = item.id
  },

  DELETE_ITEM: async (tx, payload) => {
    const itemId = str(payload, 'itemId')
    const item = must(
      await tx.itemInstance.findUnique({ where: { id: itemId } }),
      'Предмет не найден',
    )
    // Предмет мог уйти дальше: продан, надет другим, выставлен на рынок.
    // Удалять его в этом случае — вредить третьему лицу.
    if (item.ownerId !== payload.expectedOwnerId && payload.expectedOwnerId) {
      throw new AppError(
        ErrorCode.ADMIN_STATE_CHANGED,
        'Откат невозможен: предмет сменил владельца',
        409,
      )
    }
    if (item.status !== 'NORMAL') {
      throw new AppError(
        ErrorCode.ADMIN_STATE_CHANGED,
        `Откат невозможен: предмет в состоянии ${item.status}`,
        409,
      )
    }
    await tx.itemInstance.update({ where: { id: itemId }, data: { status: 'DELETED', isEquipped: false } })
    await tx.itemLog.create({
      data: {
        itemId, characterId: item.ownerId!, actionCode: 'DELETED_BY_ADMIN',
        details: { reason: String(payload.note ?? ''), adminActionId: payload.actionId ?? null },
      },
    })
  },

  LOCK_LISTING: async (tx, payload) => {
    const changed = await tx.marketListing.updateMany({
      where: { id: str(payload, 'listingId'), status: 'ACTIVE' },
      data: { status: 'LOCKED' },
    })
    if (changed.count !== 1) {
      throw new AppError(ErrorCode.ADMIN_STATE_CHANGED, 'Лот нельзя заблокировать', 409)
    }
  },

  UNLOCK_LISTING: async (tx, payload) => {
    const changed = await tx.marketListing.updateMany({
      where: { id: str(payload, 'listingId'), status: 'LOCKED' },
      data: { status: 'ACTIVE' },
    })
    if (changed.count !== 1) {
      throw new AppError(ErrorCode.ADMIN_STATE_CHANGED, 'Лот нельзя разблокировать', 409)
    }
  },

  DEACTIVATE_SHOP_ITEM: async (tx, payload) => {
    const changed = await tx.privateShopItem.updateMany({
      where: { id: str(payload, 'itemId'), isActive: true },
      data: { isActive: false },
    })
    if (changed.count !== 1) {
      throw new AppError(ErrorCode.ADMIN_STATE_CHANGED, 'Товар лавки уже снят', 409)
    }
  },

  ACTIVATE_SHOP_ITEM: async (tx, payload) => {
    const changed = await tx.privateShopItem.updateMany({
      where: { id: str(payload, 'itemId'), isActive: false },
      data: { isActive: true },
    })
    if (changed.count !== 1) {
      throw new AppError(ErrorCode.ADMIN_STATE_CHANGED, 'Товар лавки уже в продаже', 409)
    }
  },

  GRANT_PREMIUM: async () => {
    // Выдача подписки идёт своим сервисом: там продление считается от
    // остатка срока и пишется покупка. Журнал вызывает его сам, а не
    // повторяет логику здесь.
    throw new AppError(ErrorCode.ADMIN_STATE_CHANGED, 'GRANT_PREMIUM исполняется PremiumService', 500)
  },

  REVOKE_PREMIUM: async () => {
    throw new AppError(ErrorCode.ADMIN_STATE_CHANGED, 'REVOKE_PREMIUM исполняется PremiumService', 500)
  },

  /** Вернуть подписке прежний срок из снимка — обратная и к выдаче, и к отзыву. */
  RESTORE_PREMIUM: async (tx, payload) => {
    await tx.character.update({
      where: { id: str(payload, 'characterId') },
      data: {
        isPremium: Boolean(payload.isPremium),
        premiumExpiresAt: date(payload, 'premiumExpiresAt'),
      },
    })
    // Покупка, записанная выдачей, снимается: иначе история показывает
    // купленное, чего в итоге не случилось.
    if (payload.purchaseId) {
      await tx.premiumPurchase.deleteMany({ where: { id: str(payload, 'purchaseId') } })
    }
  },

  ADJUST_AUTHORITY: async (tx, payload) => {
    const clanId = str(payload, 'clanId')
    const amount = num(payload, 'amount')
    const clan = must(
      await tx.clan.findUnique({ where: { id: clanId }, select: { authority: true } }),
      'Бригада не найдена',
    )
    const after = clan.authority + amount
    if (after < 0) {
      throw new AppError(
        ErrorCode.ADMIN_STATE_CHANGED,
        `Авторитет ушёл бы в минус: ${clan.authority} + ${amount}`,
        409,
      )
    }
    await tx.clan.update({ where: { id: clanId }, data: { authority: after } })
    await tx.clanAuthorityLog.create({
      data: {
        clanId, amount, reason: 'ADMIN_ADJUST',
        balanceAfter: after,
        refId: payload.actionId ? str(payload, 'actionId') : null,
      },
    })
  },

  RESET_TERRITORY: async (tx, payload) => {
    const code = str(payload, 'code')
    const territory = must(
      await tx.territory.findUnique({ where: { code } }),
      'Район не найден',
    )
    const battling = await tx.territoryClaim.count({
      where: { territoryId: territory.id, status: 'BATTLE' },
    })
    // Сброс во время боя запрещён: бой закончился бы в никуда, и участники
    // потеряли бы ход впустую.
    if (battling > 0) {
      throw new AppError(ErrorCode.ADMIN_TERRITORY_IN_BATTLE, 'Идёт бой за территорию', 409)
    }
    await tx.territory.update({
      where: { code },
      data: {
        ownerClanId: null, status: 'NEUTRAL', controlledAt: null,
        protectedUntil: null, upkeepTier: 1, upkeepDebt: 0,
      },
    })
  },

  RESTORE_TERRITORY: async (tx, payload) => {
    await tx.territory.update({
      where: { code: str(payload, 'code') },
      data: {
        ownerClanId: payload.ownerClanId ? str(payload, 'ownerClanId') : null,
        status: str(payload, 'status') as 'NEUTRAL',
        controlledAt: date(payload, 'controlledAt'),
        protectedUntil: date(payload, 'protectedUntil'),
        upkeepTier: num(payload, 'upkeepTier'),
        upkeepDebt: num(payload, 'upkeepDebt'),
      },
    })
  },

  /**
   * Погасить заявку БЕЗ возврата взноса.
   *
   * С возвратом — нельзя, и это записанное решение: пока заявка висела,
   * район был занят, а после возврата и разблокировки его мог занять другой
   * клан. Вернуть всё как было невозможно, значит такого действия у админа
   * нет. Гашение без возврата обратимо: деньги никуда не двигались.
   */
  EXPIRE_CLAIM: async (tx, payload) => {
    const changed = await tx.territoryClaim.updateMany({
      where: { id: str(payload, 'claimId'), status: 'PENDING' },
      data: { status: 'EXPIRED', resolvedAt: new Date() },
    })
    if (changed.count !== 1) {
      throw new AppError(ErrorCode.ADMIN_BATTLE_STATE, 'Заявку нельзя погасить: бой уже начался', 409)
    }
    const claim = must(
      await tx.territoryClaim.findUnique({ where: { id: str(payload, 'claimId') } }),
      'Заявка не найдена',
    )
    const stillOpen = await tx.territoryClaim.count({
      where: { territoryId: claim.territoryId, status: { in: ['PENDING', 'BATTLE'] } },
    })
    if (stillOpen === 0) {
      const territory = await tx.territory.findUniqueOrThrow({ where: { id: claim.territoryId } })
      await tx.territory.update({
        where: { id: claim.territoryId },
        data: { status: territory.ownerClanId ? 'CONTROLLED' : 'NEUTRAL' },
      })
    }
  },

  RESTORE_CLAIM: async (tx, payload) => {
    const claimId = str(payload, 'claimId')
    const claim = must(
      await tx.territoryClaim.findUnique({ where: { id: claimId } }),
      'Заявка не найдена',
    )
    // Пока заявка была погашена, район мог уйти другому клану вместе с
    // новой заявкой. Восстанавливать поверх чужой войны нельзя.
    const openOther = await tx.territoryClaim.count({
      where: {
        territoryId: claim.territoryId,
        status: { in: ['PENDING', 'BATTLE'] },
        NOT: { id: claimId },
      },
    })
    if (openOther > 0) {
      throw new AppError(
        ErrorCode.ADMIN_STATE_CHANGED,
        'Откат невозможен: на район подана другая заявка',
        409,
      )
    }
    await tx.territoryClaim.update({
      where: { id: claimId },
      data: { status: 'PENDING', resolvedAt: null },
    })
    await tx.territory.update({
      where: { id: claim.territoryId },
      data: { status: 'CONTESTED' },
    })
  },

  CLEAR_ATTACK_COOLDOWN: async (tx, payload) => {
    const attackId = str(payload, 'attackId')
    const attack = must(
      await tx.objectAttack.findUnique({ where: { id: attackId } }),
      'Атака не найдена',
    )
    // Откат снимается сдвигом времени атаки за его границу: удалять запись
    // нельзя, она — история, по которой разбирают жалобы.
    const shifted = new Date(attack.createdAt.getTime() - 73 * 3_600_000)
    await tx.objectAttack.update({ where: { id: attackId }, data: { createdAt: shifted } })
  },

  RESTORE_ATTACK_COOLDOWN: async (tx, payload) => {
    await tx.objectAttack.update({
      where: { id: str(payload, 'attackId') },
      data: { createdAt: new Date(str(payload, 'createdAt')) },
    })
  },

  SLEEP_HELPER: async (tx, payload) => {
    const helperId = str(payload, 'helperId')
    const helper = must(await tx.helper.findUnique({ where: { id: helperId } }), 'Помощник не найден')
    if (helper.activeShiftId) {
      throw new AppError(ErrorCode.ADMIN_STATE_CHANGED, 'Помощник на смене', 409)
    }
    await tx.helper.update({ where: { id: helperId }, data: { status: 'DORMANT' } })
  },

  WAKE_HELPER: async (tx, payload) => {
    await tx.helper.update({
      where: { id: str(payload, 'helperId') },
      data: { status: 'ACTIVE' },
    })
  },

  REVIEW_SIGNAL: async (tx, payload) => {
    await tx.abuseSignal.update({
      where: { id: str(payload, 'signalId') },
      data: { status: str(payload, 'status') as 'REVIEWED' },
    })
  },

  /** Вернуть сигнал в работу: разбор откатывается тривиально. */
  REOPEN_SIGNAL: async (tx, payload) => {
    await tx.abuseSignal.update({
      where: { id: str(payload, 'signalId') },
      data: { status: 'OPEN', reviewedByAdminId: null, reviewedAt: null },
    })
  },

  ROLLBACK: async () => {
    // Откат отката не заводится: цепочка отмен превращает журнал в игру
    // «кто последний нажал». Испортил откатом — сделай прямое действие с
    // причиной, и оно тоже будет записано.
    throw new AppError(ErrorCode.ADMIN_STATE_CHANGED, 'Откат нельзя откатить', 409)
  },
}

export const AdminActionsService = {
  /**
   * Выполнить действие и записать его вместе с обратной операцией.
   *
   * Одной транзакцией: действие без записи в журнал — это ровно то, от чего
   * этап уходит, и «сначала сделаем, потом запишем» тут не годится.
   */
  async perform(admin: AdminContext, reason: string, action: RecordedAction) {
    if (reason.trim().length < REASON_MIN) {
      throw new AppError(
        ErrorCode.ADMIN_REASON_TOO_SHORT,
        `Причина короче ${REASON_MIN} символов`,
        422,
      )
    }

    // Идентификатор действия выдаём ДО исполнения: денежный и предметный
    // журналы ссылаются на него прямо в момент записи, а сослаться на строку,
    // которой ещё нет, нельзя. Без этого цепочка транзакций не связывает
    // выданные деньги с админом, который их выдал.
    const actionId = randomUUID()

    return withTransaction(async tx => {
      const payload: Record<string, unknown> = {
        ...(action.payload as Record<string, unknown>), note: reason, actionId,
      }
      await EXECUTORS[action.kind](tx, payload)

      // Исполнитель мог дописать в payload то, что стало известно только
      // при исполнении, — например id созданного предмета. Обратная
      // операция получает это тем же путём.
      const undoPayload = { ...(action.undo.payload as Record<string, unknown>) }
      if (payload.createdItemId && undoPayload.itemId === undefined) {
        undoPayload.itemId = payload.createdItemId
      }

      const record = await tx.adminActionLog.create({
        data: {
          id: actionId,
          adminId: admin.adminId,
          adminRole: admin.adminRole,
          kind: action.kind,
          reason: reason.trim(),
          targetType: action.targetType,
          targetId: action.targetId,
          payload: payload as Prisma.InputJsonValue,
          undoKind: action.undo.kind,
          undoPayload: undoPayload as Prisma.InputJsonValue,
        },
      })

      audit('admin.action', {
        action: action.kind, actionId: record.id, adminId: admin.adminId,
        targetType: action.targetType, targetId: action.targetId, reason,
      })
      return { actionId: record.id, kind: record.kind, payload }
    })
  },

  /**
   * Записать действие, выполненное чужим сервисом.
   *
   * Нужно там, где исполнение нельзя перенести в исполнителя: выдача
   * подписки считает продление от остатка срока и пишет покупку, и
   * повторять эту логику в журнале значило бы завести вторую правду.
   */
  async record(admin: AdminContext, reason: string, action: RecordedAction) {
    if (reason.trim().length < REASON_MIN) {
      throw new AppError(
        ErrorCode.ADMIN_REASON_TOO_SHORT,
        `Причина короче ${REASON_MIN} символов`,
        422,
      )
    }
    const record = await prisma.adminActionLog.create({
      data: {
        adminId: admin.adminId,
        adminRole: admin.adminRole,
        kind: action.kind,
        reason: reason.trim(),
        targetType: action.targetType,
        targetId: action.targetId,
        payload: action.payload,
        undoKind: action.undo.kind,
        undoPayload: action.undo.payload,
      },
    })
    audit('admin.action', {
      action: action.kind, actionId: record.id, adminId: admin.adminId,
      targetType: action.targetType, targetId: action.targetId, reason,
    })
    return { actionId: record.id, kind: record.kind }
  },

  /**
   * Откатить действие.
   *
   * Откат — тоже действие: он требует причины, пишется в журнал и ссылается
   * на отменённое. Уникальность `rolledBackId` не даёт откатить дважды —
   * двойной откат выдачи денег стал бы списанием.
   */
  async rollback(admin: AdminContext, actionId: string, reason: string) {
    if (reason.trim().length < REASON_MIN) {
      throw new AppError(
        ErrorCode.ADMIN_REASON_TOO_SHORT,
        `Причина короче ${REASON_MIN} символов`,
        422,
      )
    }

    const original = await prisma.adminActionLog.findUnique({ where: { id: actionId } })
    if (!original) throw new AppError(ErrorCode.ADMIN_ACTION_NOT_FOUND, 'Действие не найдено', 404)
    if (original.kind === 'ROLLBACK') {
      throw new AppError(ErrorCode.ADMIN_STATE_CHANGED, 'Откат нельзя откатить', 409)
    }
    const already = await prisma.adminActionLog.findUnique({ where: { rolledBackId: actionId } })
    if (already) {
      throw new AppError(ErrorCode.ADMIN_ALREADY_ROLLED_BACK, 'Действие уже откачено', 409)
    }

    return withTransaction(async tx => {
      const payload = {
        ...(original.undoPayload as Record<string, unknown>),
        note: `откат ${original.kind}: ${reason.trim()}`,
      }
      await EXECUTORS[original.undoKind](tx, payload)

      const record = await tx.adminActionLog.create({
        data: {
          adminId: admin.adminId,
          adminRole: admin.adminRole,
          kind: 'ROLLBACK',
          reason: reason.trim(),
          targetType: original.targetType,
          targetId: original.targetId,
          payload: payload as Prisma.InputJsonValue,
          // У самого отката обратной операции нет — это и записано:
          // откат отката не заводится.
          undoKind: 'ROLLBACK',
          undoPayload: {},
          rolledBackId: original.id,
        },
      })
      await tx.adminActionLog.update({
        where: { id: original.id },
        data: { rolledBackAt: new Date() },
      })

      audit('admin.action', {
        action: 'rollback', actionId: record.id, rolledBackId: original.id,
        adminId: admin.adminId, reason,
      })
      return { actionId: record.id, rolledBackId: original.id, undoKind: original.undoKind }
    })
  },

  /** Лента действий. Доступна на чтение всем ролям: админы прозрачны друг другу. */
  async list(params: {
    adminId?: string; targetType?: string; targetId?: string
    cursor?: string; limit?: number
  }) {
    const take = Math.min(Math.max(1, params.limit ?? 50), 200)
    const rows = await prisma.adminActionLog.findMany({
      where: {
        ...(params.adminId ? { adminId: params.adminId } : {}),
        ...(params.targetType ? { targetType: params.targetType } : {}),
        ...(params.targetId ? { targetId: params.targetId } : {}),
      },
      take: take + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    })
    return {
      items: rows.slice(0, take),
      nextCursor: rows.length > take ? rows[take - 1].id : null,
    }
  },
}
