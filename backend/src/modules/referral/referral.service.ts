// =============================================================
// Реферальная система (обещание игрокам 23.10: «будет возможность как
// доллары получать за % от пополнения, так же выводить на карту себе
// начисления»).
//
// Ссылка — /register?ref=ник. Пригласивший получает долю с каждой покупки
// долларов приглашённым у дилера (DollarsService.rewardReferrer). Доля
// копится на отдельном реферальном счёте (заказчик 28.10): оттуда игрок сам
// зачисляет её на персонажа или подаёт заявку на вывод на карту. Вывод
// ручной: заявка списывает с реферального счёта, админ переводит рубли сам
// и отмечает «выплачено»; при отказе сумма возвращается на реферальный счёт.
// =============================================================
import type { Prisma } from '@prisma/client'
import { BalanceConfig } from '../../config/balance.config'
import { prisma } from '../../shared/db/prisma'
import { withIdempotency } from '../../shared/db/idempotency'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { logger } from '../../shared/logger/logger'
import { DollarsService } from '../dollars/dollars.service'
import { sendTelegram, telegramConfigured } from '../admin-balance/telegram.service'

const config = BalanceConfig.referral

export const ReferralService = {
  /**
   * Запомнить пригласившего при регистрации. Ник с ошибкой или чужой мусор
   * в ссылке регистрацию не ломают — просто без пригласившего.
   */
  async attach(userId: string, ref: string | undefined) {
    const nickname = ref?.trim()
    if (!nickname) return
    const referrer = await prisma.character.findFirst({
      where: { nickname: { equals: nickname, mode: 'insensitive' } },
      select: { id: true, userId: true },
    })
    if (!referrer || referrer.userId === userId) return
    await prisma.user.update({ where: { id: userId }, data: { referrerCharacterId: referrer.id } })
  },

  /** Вкладка «Рефералы»: ссылка, сколько привёл, сколько заработал и заявки. */
  async summary(characterId: string) {
    const character = await prisma.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { nickname: true, referralBalance: true, referralEarned: true },
    })
    const [invited, payouts] = await Promise.all([
      prisma.user.count({ where: { referrerCharacterId: characterId } }),
      prisma.referralPayout.findMany({ where: { characterId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ])
    return {
      code: character.nickname,
      sharePercent: Math.round(config.topUpShare * 100),
      minPayout: config.minPayoutUsd,
      invited,
      earned: character.referralEarned,
      balance: character.referralBalance,
      payouts: payouts.map(row => ({
        id: row.id, amount: row.amount, status: row.status, adminNote: row.adminNote,
        createdAt: row.createdAt, processedAt: row.processedAt,
      })),
    }
  },

  /** Зачислить с реферального счёта на персонажа — в обычные доллары. */
  async claim(characterId: string, amount: number, key: string) {
    if (!Number.isInteger(amount) || amount <= 0) throw AppError.validation('Сумма должна быть больше нуля')
    return withIdempotency({ characterId, scope: 'referral.claim', key, execute: async tx => {
      const taken = await tx.character.updateMany({
        where: { id: characterId, referralBalance: { gte: amount } },
        data: { referralBalance: { decrement: amount } },
      })
      if (taken.count !== 1) throw new AppError(ErrorCode.ECON_INSUFFICIENT_FUNDS, 'Столько на реферальном счёте нет', 409)
      const dollars = await DollarsService.credit(tx, { characterId, amount, reason: 'REFERRAL', note: 'с реферального счёта' })
      return { amount, dollars }
    } })
  },

  async requestPayout(characterId: string, amount: number, details: string, key: string) {
    if (!Number.isInteger(amount) || amount < config.minPayoutUsd) {
      throw AppError.validation(`Вывод — от ${config.minPayoutUsd} $`)
    }
    const result = await withIdempotency({ characterId, scope: 'referral.payout', key, execute: async tx => {
      // Блокировка строки: две заявки разом не выведут одно и то же дважды.
      await tx.$queryRaw`SELECT id FROM characters WHERE id = ${characterId} FOR UPDATE`
      const pending = await tx.referralPayout.count({ where: { characterId, status: 'PENDING' } })
      if (pending >= config.maxPendingPayouts) {
        throw new AppError(ErrorCode.CONFLICT, 'Прошлая заявка ещё в работе — дождитесь выплаты', 409)
      }
      const taken = await tx.character.updateMany({
        where: { id: characterId, referralBalance: { gte: amount } },
        data: { referralBalance: { decrement: amount } },
      })
      if (taken.count !== 1) throw new AppError(ErrorCode.ECON_INSUFFICIENT_FUNDS, 'Столько на реферальном счёте нет', 409)
      const payout = await tx.referralPayout.create({ data: { characterId, amount, details: details.trim() } })
      const who = await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: { nickname: true } })
      return { id: payout.id, amount, status: payout.status, nickname: who.nickname }
    } })
    if (telegramConfigured()) {
      void sendTelegram(`Заявка на вывод реферальных: ${result.nickname}, ${result.amount} $. Обработать — админка, «Выплаты».`)
        .catch(error => logger.warn({ error }, 'referral payout notify failed'))
    }
    return { id: result.id, amount: result.amount, status: result.status }
  },

  /** Для админки: заявки, новые сверху. */
  async adminList(status?: 'PENDING' | 'PAID' | 'REJECTED') {
    const rows = await prisma.referralPayout.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    const names = new Map((await prisma.character.findMany({
      where: { id: { in: [...new Set(rows.map(row => row.characterId))] } },
      select: { id: true, nickname: true },
    })).map(row => [row.id, row.nickname]))
    return { items: rows.map(row => ({ ...row, nickname: names.get(row.characterId) ?? '—' })) }
  },

  /** Админ перевёл деньги сам — отмечаем. */
  async markPaid(id: string, adminId: string, note?: string) {
    return close(id, adminId, 'PAID', note)
  },

  /** Отказ: сумма возвращается на реферальный счёт. */
  async reject(id: string, adminId: string, note?: string) {
    return close(id, adminId, 'REJECTED', note, async (tx, payout) => {
      await tx.character.update({ where: { id: payout.characterId }, data: { referralBalance: { increment: payout.amount } } })
    })
  },
}

async function close(
  id: string,
  adminId: string,
  status: 'PAID' | 'REJECTED',
  note: string | undefined,
  after?: (tx: Prisma.TransactionClient, payout: { characterId: string; amount: number; id: string }) => Promise<void>,
) {
  return prisma.$transaction(async tx => {
    const payout = await tx.referralPayout.findUnique({ where: { id } })
    if (!payout) throw new AppError(ErrorCode.NOT_FOUND, 'Заявка не найдена', 404)
    const changed = await tx.referralPayout.updateMany({
      where: { id, status: 'PENDING' },
      data: { status, processedBy: adminId, processedAt: new Date(), adminNote: note?.trim() || null },
    })
    if (changed.count !== 1) throw new AppError(ErrorCode.CONFLICT, 'Заявка уже обработана', 409)
    await after?.(tx, payout)
    return tx.referralPayout.findUniqueOrThrow({ where: { id } })
  })
}
