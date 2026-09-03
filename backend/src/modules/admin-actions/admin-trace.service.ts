// =============================================================
// ЦЕПОЧКА ТРАНЗАКЦИЙ — шаг G2 Этапа 5
//
// Вся история предмета, персонажа или бригады одной лентой. Главная новая
// возможность этапа и то, ради чего вообще существуют журналы.
//
// Дюп предмета выглядит в базе как два экземпляра с одинаковой историей до
// момента раздвоения. Перелив денег — как односторонний поток между двумя
// аккаунтами. Ни то ни другое не видно в отдельном журнале: видно только в
// сшитой цепочке.
//
// ТЗ: docs/specs/stage-5/STAGE5_ADMIN_API.md раздел 3.
// =============================================================
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'

export type TraceType = 'item' | 'character' | 'clan'

export interface TraceEvent {
  at: Date
  source: 'CURRENCY' | 'ITEM' | 'RESOURCE' | 'REPAIR' | 'TREASURY' | 'AUTHORITY' | 'ATTACK' | 'ADMIN'
  action: string
  amount: number | null
  balanceAfter: number | null
  /** Ссылка на связанную сущность, как её записал сам журнал. */
  ref: { type: string | null; id: string } | null
  /** Действие администратора, породившее событие, если оно известно. */
  adminActionId: string | null
  details: unknown
}

/**
 * Достать id админского действия из журнала.
 *
 * Общего `correlationId` у журналов Этапов 2–4 нет — он появится, когда
 * каждый журнал получит своё поле. Пока связь идёт двумя способами, которые
 * уже есть в данных: денежный журнал пишет `refType='admin_action'`, а
 * предметный кладёт `adminActionId` в свободный `details`.
 */
function adminRef(refType: string | null, refId: string | null): string | null {
  return refType === 'admin_action' && refId ? refId : null
}

function adminFromDetails(details: unknown): string | null {
  if (details && typeof details === 'object' && 'adminActionId' in details) {
    const value = (details as { adminActionId: unknown }).adminActionId
    return typeof value === 'string' ? value : null
  }
  return null
}

export const AdminTraceService = {
  async trace(params: { type: TraceType; id: string; limit?: number }) {
    const take = Math.min(Math.max(1, params.limit ?? 200), 500)
    const subject = await describe(params.type, params.id)

    const events = params.type === 'item'
      ? await itemEvents(params.id, take)
      : params.type === 'character'
        ? await characterEvents(params.id, take)
        : await clanEvents(params.id, take)

    const admin = await prisma.adminActionLog.findMany({
      where: { targetType: params.type, targetId: params.id },
      take,
      orderBy: { createdAt: 'desc' },
    })

    const all: TraceEvent[] = [
      ...events,
      ...admin.map(row => ({
        at: row.createdAt,
        source: 'ADMIN' as const,
        action: row.kind,
        amount: null,
        balanceAfter: null,
        ref: { type: 'admin', id: row.adminId },
        adminActionId: row.id,
        details: { reason: row.reason, rolledBackAt: row.rolledBackAt, undoKind: row.undoKind },
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take)

    return { subject, events: all, truncated: all.length === take }
  },
}

async function describe(type: TraceType, id: string) {
  if (type === 'item') {
    const item = await prisma.itemInstance.findUnique({
      where: { id },
      include: { template: { select: { name: true, type: true } } },
    })
    if (!item) throw new AppError(ErrorCode.ADMIN_TRACE_NOT_FOUND, 'Предмет не найден', 404)
    return {
      type, id,
      label: item.template.name,
      ownerId: item.ownerId,
      status: item.status,
      createdAt: item.createdAt,
      sourceType: item.sourceType,
    }
  }
  if (type === 'character') {
    const character = await prisma.character.findUnique({
      where: { id },
      select: { id: true, nickname: true, money: true, status: true, createdAt: true },
    })
    if (!character) throw new AppError(ErrorCode.ADMIN_TRACE_NOT_FOUND, 'Персонаж не найден', 404)
    return { type, id, label: character.nickname, money: character.money, status: character.status }
  }
  const clan = await prisma.clan.findUnique({
    where: { id },
    select: { id: true, name: true, tag: true, treasury: true, authority: true },
  })
  if (!clan) throw new AppError(ErrorCode.ADMIN_TRACE_NOT_FOUND, 'Бригада не найдена', 404)
  return { type, id, label: `[${clan.tag}] ${clan.name}`, treasury: clan.treasury, authority: clan.authority }
}

/**
 * Жизнь экземпляра предмета.
 *
 * Именно она отвечает на вопрос про дюп: у двух копий история совпадает до
 * момента раздвоения, и увидеть это можно только положив их цепочки рядом.
 */
async function itemEvents(itemId: string, take: number): Promise<TraceEvent[]> {
  const [logs, repairs] = await Promise.all([
    prisma.itemLog.findMany({ where: { itemId }, take, orderBy: { createdAt: 'desc' } }),
    prisma.repairLog.findMany({ where: { itemId }, take, orderBy: { repairedAt: 'desc' } }),
  ])
  return [
    ...logs.map(row => ({
      at: row.createdAt,
      source: 'ITEM' as const,
      action: row.actionCode,
      amount: null,
      balanceAfter: null,
      ref: { type: 'character', id: row.characterId },
      adminActionId: adminFromDetails(row.details),
      details: row.details,
    })),
    ...repairs.map(row => ({
      at: row.repairedAt,
      source: 'REPAIR' as const,
      action: 'REPAIRED',
      amount: -row.cost,
      balanceAfter: null,
      ref: { type: 'character', id: row.characterId },
      adminActionId: null,
      details: { durabilityBefore: row.durabilityBefore, durabilityAfter: row.durabilityAfter },
    })),
  ]
}

/** Деньги, предметы и ресурсы персонажа в одной ленте. */
async function characterEvents(characterId: string, take: number): Promise<TraceEvent[]> {
  const [money, items, resources] = await Promise.all([
    prisma.currencyLog.findMany({ where: { characterId }, take, orderBy: { createdAt: 'desc' } }),
    prisma.itemLog.findMany({ where: { characterId }, take, orderBy: { createdAt: 'desc' } }),
    prisma.resourceLog.findMany({ where: { characterId }, take, orderBy: { createdAt: 'desc' } }),
  ])
  return [
    ...money.map(row => ({
      at: row.createdAt,
      source: 'CURRENCY' as const,
      action: row.reasonCode,
      amount: row.amount,
      balanceAfter: row.balanceAfter,
      ref: row.refId ? { type: row.refType, id: row.refId } : null,
      adminActionId: adminRef(row.refType, row.refId),
      details: row.note,
    })),
    ...items.map(row => ({
      at: row.createdAt,
      source: 'ITEM' as const,
      action: row.actionCode,
      amount: null,
      balanceAfter: null,
      ref: { type: 'item', id: row.itemId },
      adminActionId: adminFromDetails(row.details),
      details: row.details,
    })),
    ...resources.map(row => ({
      at: row.createdAt,
      source: 'RESOURCE' as const,
      action: row.reasonCode,
      amount: row.amountDelta,
      balanceAfter: row.balanceAfter,
      ref: { type: 'resource', id: row.resourceTemplateId },
      adminActionId: null,
      details: null,
    })),
  ]
}

/** Общак, авторитет и налёты бригады. */
async function clanEvents(clanId: string, take: number): Promise<TraceEvent[]> {
  const [treasury, authority, attacks] = await Promise.all([
    prisma.clanTreasuryLog.findMany({ where: { clanId }, take, orderBy: { createdAt: 'desc' } }),
    prisma.clanAuthorityLog.findMany({ where: { clanId }, take, orderBy: { createdAt: 'desc' } }),
    prisma.objectAttack.findMany({
      where: { OR: [{ attackerClanId: clanId }, { defenderClanId: clanId }] },
      take, orderBy: { createdAt: 'desc' },
    }),
  ])
  return [
    ...treasury.map(row => ({
      at: row.createdAt,
      source: 'TREASURY' as const,
      action: row.reason,
      amount: row.amount,
      balanceAfter: row.balanceAfter,
      ref: row.characterId ? { type: 'character', id: row.characterId } : null,
      adminActionId: null,
      details: null,
    })),
    ...authority.map(row => ({
      at: row.createdAt,
      source: 'AUTHORITY' as const,
      action: row.reason,
      amount: row.amount,
      balanceAfter: row.balanceAfter,
      ref: row.refId ? { type: 'ref', id: row.refId } : null,
      // Правку авторитета админом видно по refId: журнал пишет туда id
      // действия, и цепочка связывает строку с причиной и с админом.
      adminActionId: row.reason === 'ADMIN_ADJUST' ? row.refId : null,
      details: null,
    })),
    ...attacks.map(row => ({
      at: row.createdAt,
      source: 'ATTACK' as const,
      action: row.type,
      amount: row.moneyTaken,
      balanceAfter: null,
      ref: { type: 'object', id: row.objectId },
      adminActionId: null,
      details: {
        attackerClanId: row.attackerClanId,
        defenderClanId: row.defenderClanId,
        durabilityLost: row.durabilityLost,
      },
    })),
  ]
}
