// =============================================================
// АВТОРИТЕТ КЛАНА — валюта войны Этапа 4
//
// Не покупается, не передаётся между кланами, не конвертируется в рубли и
// не лежит на складе. Это счётчик заслуг клана перед самим собой, и он
// заменяет синдикатную валюту из разведки: вводить третью игровую валюту
// ради одной механики — лишняя сущность.
//
// Главное свойство: заявка стоит 20, победа даёт 15. Клан, который только
// побеждает, уходит в минус по пять за цикл «заявка → победа» и
// останавливается через четыре войны. Дефицит закрывается производством —
// воевать может только тот, кто работает.
//
// ТЗ: docs/specs/stage-4/MASTER_TZ_STAGE_4_STRATEGY_PREMIUM_WAR.md, часть IV.
// =============================================================
import type { ClanAuthorityReason, Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { BalanceConfig } from '../../config/balance.config'

const A = BalanceConfig.strategy.authority

export const AUTHORITY_COSTS = {
  claim: A.claimCost,
  sabotage: A.sabotageCost,
  robbery: A.robberyCost,
} as const

export const AUTHORITY_GAINS = {
  territoryWon: A.territoryWon,
  territoryDefended: A.territoryDefended,
  cycleCompleted: A.cycleCompleted,
  shiftCompleted: A.shiftCompleted,
  territoryHeldDay: A.territoryHeldDay,
} as const

/**
 * Начисление и списание авторитета.
 *
 * Всегда парой: поле на клане и строка журнала с остатком после операции.
 * Расхождение между ними ловится сверкой — тем же приёмом, каким Этап 5
 * будет ловить дюп предметов.
 */
export const AuthorityService = {
  /** Начислить. `amount` положительный. */
  async grant(
    tx: Prisma.TransactionClient,
    params: { clanId: string; amount: number; reason: ClanAuthorityReason; refId?: string },
  ): Promise<number> {
    if (params.amount <= 0) return 0
    const clan = await tx.clan.update({
      where: { id: params.clanId },
      data: { authority: { increment: params.amount } },
      select: { authority: true },
    })
    await tx.clanAuthorityLog.create({
      data: {
        clanId: params.clanId,
        amount: params.amount,
        reason: params.reason,
        refId: params.refId ?? null,
        balanceAfter: clan.authority,
      },
    })
    return clan.authority
  },

  /**
   * Списать. `amount` положительный; в журнал уходит со знаком минус.
   *
   * Проверка и списание идут одним условным запросом: две операции —
   * «прочитать остаток» и «уменьшить» — расходятся под нагрузкой, и клан
   * с 20 авторитета подал бы две заявки по 20 одновременно.
   */
  async spend(
    tx: Prisma.TransactionClient,
    params: { clanId: string; amount: number; reason: ClanAuthorityReason; refId?: string },
  ): Promise<number> {
    if (params.amount <= 0) return 0
    const spent = await tx.clan.updateMany({
      where: { id: params.clanId, authority: { gte: params.amount } },
      data: { authority: { decrement: params.amount } },
    })
    if (spent.count !== 1) {
      const current = await tx.clan.findUnique({ where: { id: params.clanId }, select: { authority: true } })
      throw new AppError(
        ErrorCode.WAR_NOT_ENOUGH_AUTHORITY,
        `Не хватает авторитета: нужно ${params.amount}, есть ${Math.floor(current?.authority ?? 0)}`,
        400,
      )
    }
    const clan = await tx.clan.findUniqueOrThrow({
      where: { id: params.clanId },
      select: { authority: true },
    })
    await tx.clanAuthorityLog.create({
      data: {
        clanId: params.clanId,
        amount: -params.amount,
        reason: params.reason,
        refId: params.refId ?? null,
        balanceAfter: clan.authority,
      },
    })
    return clan.authority
  },

  /** Текущий остаток и журнал. Только для участников клана. */
  async view(clanId: string, limit = 50) {
    const [clan, log] = await Promise.all([
      prisma.clan.findUnique({ where: { id: clanId }, select: { authority: true } }),
      prisma.clanAuthorityLog.findMany({
        where: { clanId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { createdAt: true, amount: true, reason: true, refId: true, balanceAfter: true },
      }),
    ])
    if (!clan) throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Clan not found', 404)
    return { current: clan.authority, log }
  },

  /**
   * Сверка журнала с полем. Расхождение — сигнал того же класса, что дюп:
   * либо кто-то менял поле мимо сервиса, либо потерялась строка журнала.
   */
  async audit(clanId: string): Promise<{ stored: number; fromLog: number; matches: boolean }> {
    const [clan, sum] = await Promise.all([
      prisma.clan.findUniqueOrThrow({ where: { id: clanId }, select: { authority: true } }),
      prisma.clanAuthorityLog.aggregate({ where: { clanId }, _sum: { amount: true } }),
    ])
    const fromLog = sum._sum.amount ?? 0
    // Дробные: сравниваем с допуском, а не на равенство.
    return { stored: clan.authority, fromLog, matches: Math.abs(clan.authority - fromLog) < 1e-6 }
  },
}
