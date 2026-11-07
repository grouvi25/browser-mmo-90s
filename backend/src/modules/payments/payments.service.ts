/**
 * Покупка долларов за рубли (эквайринг, заказчик 06.11: «эквайринг нужен к 13 числу»).
 *
 * Игрок выбирает пакет → платёж у нас (NEW) → банк выдаёт ссылку (PENDING) →
 * игрок платит на странице банка → банк присылает уведомление. Доллары
 * начисляются только по подписанному уведомлению CONFIRMED и ровно один раз:
 * банк шлёт уведомления повторно, пока не получит «OK».
 */
import { BalanceConfig } from '../../config/balance.config'
import { env } from '../../config/env'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { logger } from '../../shared/logger/logger'
import { NoticesService } from '../chat/notices.service'
import { DollarsService } from '../dollars/dollars.service'
import { pushLater } from '../push/push.service'
import { tbankConfigured, tbankInit, tbankNotificationValid } from './tbank'

const P = BalanceConfig.payments
const priceOf = (dollars: number) => dollars * P.dollarPriceKopecks

// Статусы Т-Банка → наш итог. Остальные (NEW, FORM_SHOWED, AUTHORIZING, AUTHORIZED…) — платёж ещё идёт.
const FINAL: Record<string, 'CONFIRMED' | 'REJECTED' | 'CANCELED' | 'REFUNDED'> = {
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED', AUTH_FAIL: 'REJECTED', DEADLINE_EXPIRED: 'REJECTED',
  CANCELED: 'CANCELED', REVERSED: 'CANCELED',
  REFUNDED: 'REFUNDED', PARTIAL_REFUNDED: 'REFUNDED',
}

export const PaymentsService = {
  /** Что показать игроку: включена ли покупка, цена и пакеты. */
  offer() {
    return {
      enabled: tbankConfigured(),
      priceKopecks: P.dollarPriceKopecks,
      packs: P.packs.map(dollars => ({ dollars, amountKopecks: priceOf(dollars) })),
    }
  },

  /** Начать покупку: ссылка на страницу оплаты банка. */
  async start(characterId: string, dollars: number) {
    if (!tbankConfigured()) throw new AppError(ErrorCode.CONFLICT, 'Оплата на сайте пока не подключена', 409)
    if (!(P.packs as readonly number[]).includes(dollars)) throw AppError.validation('Такого пакета нет')
    const character = await prisma.character.findUniqueOrThrow({ where: { id: characterId }, select: { nickname: true, user: { select: { email: true } } } })
    const payment = await prisma.payment.create({ data: { characterId, dollars, amountKopecks: priceOf(dollars) } })
    const site = env.APP_URL.replace(/\/$/, '')
    const result = await tbankInit({
      orderId: payment.id, amountKopecks: payment.amountKopecks,
      description: `Игровые доллары Кооператива: ${dollars.toLocaleString('ru')} $ для ${character.nickname}`,
      email: character.user.email,
      notificationUrl: `${site}/api/payments/tbank/notify`,
      successUrl: `${site}/premium?payment=${payment.id}`,
      failUrl: `${site}/premium?payment=${payment.id}&failed=1`,
    })
    if (!result.ok) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'REJECTED', errorText: result.error.slice(0, 500) } })
      logger.warn({ paymentId: payment.id, error: result.error }, '[Payments] банк не создал платёж')
      throw new AppError(ErrorCode.CONFLICT, 'Банк не принял платёж, попробуйте ещё раз чуть позже', 409)
    }
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'PENDING', providerPaymentId: result.paymentId, paymentUrl: result.paymentUrl } })
    return { paymentId: payment.id, paymentUrl: result.paymentUrl }
  },

  /**
   * Уведомление банка. Ответ «OK» — только когда уведомление разобрано: иначе банк
   * повторит его. Чужое или поддельное — false, банк получит отказ.
   */
  async notify(body: Record<string, unknown>): Promise<boolean> {
    if (!tbankNotificationValid(body)) {
      logger.warn({ orderId: body.OrderId, status: body.Status }, '[Payments] уведомление с неверной подписью')
      return false
    }
    const orderId = String(body.OrderId ?? '')
    const status = String(body.Status ?? '')
    const payment = await prisma.payment.findUnique({ where: { id: orderId } }).catch(() => null)
    if (!payment) {
      logger.warn({ orderId, status }, '[Payments] уведомление о неизвестном платеже')
      return true // не наш заказ: повторять бессмысленно
    }
    if (Number(body.Amount) !== payment.amountKopecks) {
      logger.error({ orderId, amount: body.Amount, expected: payment.amountKopecks }, '[Payments] сумма в уведомлении не совпала')
      await prisma.payment.update({ where: { id: payment.id }, data: { providerStatus: status, errorText: `сумма ${String(body.Amount)} вместо ${payment.amountKopecks}` } })
      return true
    }
    const final = FINAL[status]
    if (final === 'CONFIRMED' && body.Success !== false) {
      await this.confirm(payment.id, status)
    } else if (final === 'REFUNDED') {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED', providerStatus: status } })
      logger.error({ orderId, characterId: payment.characterId, dollars: payment.dollars }, '[Payments] возврат: доллары не списаны, разобрать вручную')
    } else if (final) {
      await prisma.payment.updateMany({ where: { id: payment.id, status: { in: ['NEW', 'PENDING'] } }, data: { status: final, providerStatus: status } })
    } else {
      await prisma.payment.update({ where: { id: payment.id }, data: { providerStatus: status } })
    }
    return true
  },

  /** Зачислить доллары один раз: повторное уведомление ничего не добавит. */
  async confirm(paymentId: string, providerStatus: string) {
    const credited = await prisma.$transaction(async tx => {
      const claimed = await tx.payment.updateMany({
        where: { id: paymentId, status: { not: 'CONFIRMED' } },
        data: { status: 'CONFIRMED', providerStatus, confirmedAt: new Date() },
      })
      if (claimed.count !== 1) return null
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } })
      await DollarsService.credit(tx, { characterId: payment.characterId, amount: payment.dollars, reason: 'TOPUP', refId: payment.id, note: `оплата ${(payment.amountKopecks / 100).toLocaleString('ru')} ₽` })
      // Пригласившему — его процент, как с покупки у дилера.
      await DollarsService.rewardReferrer(tx, payment.characterId, payment.dollars, '')
      return payment
    })
    if (!credited) return
    const text = `Оплата прошла: зачислено ${credited.dollars.toLocaleString('ru')} $.`
    await NoticesService.push(credited.characterId, text).catch(() => undefined)
    pushLater(credited.characterId, { title: 'Доллары зачислены', body: text, url: '/premium', kind: 'support' })
  },

  /** Покупки игрока: последние 20. */
  async mine(characterId: string) {
    const items = await prisma.payment.findMany({
      where: { characterId }, orderBy: { createdAt: 'desc' }, take: 20,
      select: { id: true, dollars: true, amountKopecks: true, status: true, createdAt: true, confirmedAt: true },
    })
    return { items }
  },

  /** Отчёт для админки: все платежи и итоги, одни цифры для всех (условие заказчика). */
  async report(params: { from?: Date; to?: Date; take?: number }) {
    const where = { createdAt: { gte: params.from ?? new Date(0), lte: params.to ?? new Date() } }
    const [items, totals] = await Promise.all([
      prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, take: Math.min(params.take ?? 200, 1000) }),
      prisma.payment.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { amountKopecks: true, dollars: true } }),
    ])
    const names = new Map((await prisma.character.findMany({
      where: { id: { in: [...new Set(items.map(item => item.characterId))] } }, select: { id: true, nickname: true },
    })).map(row => [row.id, row.nickname]))
    return {
      items: items.map(item => ({ ...item, nickname: names.get(item.characterId) ?? null })),
      totals: totals.map(row => ({ status: row.status, count: row._count._all, amountKopecks: row._sum.amountKopecks ?? 0, dollars: row._sum.dollars ?? 0 })),
    }
  },
}
