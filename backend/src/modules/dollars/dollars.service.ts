// =============================================================
// Игровые доллары — донатная валюта.
//
// Схема заказчика (октябрь 2026): игрок не покупает каждую вещь за живые
// деньги. Он покупает доллары у дилера, дилер зачисляет их на счёт, а
// игрок тратит их на что хочет. Администрация выдаёт доллары дилерам;
// свой процент дилер берёт вне игры, в игре его не видно.
//
// Каждое движение пишется в журнал с балансом после него — по журналу
// сходится любой счёт и видно, какой дилер кого пополнил.
// =============================================================
import type { DollarReason, Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { withIdempotency } from '../../shared/db/idempotency'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { EconomyService } from '../economy/economy.service'
import { BalanceConfig } from '../../config/balance.config'

/** Предел одного перевода дилера: опечатка в сумме не должна стоить миллионы. */
export const DEALER_TRANSFER_MAX = 100_000

interface Movement {
  characterId: string
  amount: number
  reason: DollarReason
  counterpartyId?: string | null
  refId?: string | null
  note?: string | null
}

async function boughtToday(characterId: string, db: Prisma.TransactionClient = prisma): Promise<number> {
  const since = new Date(Date.now() - 24 * 3_600_000)
  const sum = await db.dollarLog.aggregate({
    where: { characterId, reason: 'EXCHANGE', amount: { gt: 0 }, createdAt: { gte: since } },
    _sum: { amount: true },
  })
  return sum._sum.amount ?? 0
}

async function credit(tx: Prisma.TransactionClient, move: Movement): Promise<number> {
  if (!Number.isInteger(move.amount) || move.amount <= 0) throw AppError.validation('Сумма должна быть больше нуля')
  const updated = await tx.character.update({
    where: { id: move.characterId },
    data: { dollars: { increment: move.amount } },
    select: { dollars: true },
  })
  await tx.dollarLog.create({ data: { ...move, balanceAfter: updated.dollars } })
  return updated.dollars
}

async function debit(tx: Prisma.TransactionClient, move: Movement): Promise<number> {
  if (!Number.isInteger(move.amount) || move.amount <= 0) throw AppError.validation('Сумма должна быть больше нуля')
  // Условие в самом UPDATE: две одновременные траты не уведут счёт в минус.
  const taken = await tx.character.updateMany({
    where: { id: move.characterId, dollars: { gte: move.amount } },
    data: { dollars: { decrement: move.amount } },
  })
  if (taken.count !== 1) throw new AppError(ErrorCode.ECON_INSUFFICIENT_FUNDS, 'Не хватает долларов', 409)
  const after = await tx.character.findUniqueOrThrow({ where: { id: move.characterId }, select: { dollars: true } })
  await tx.dollarLog.create({ data: { ...move, amount: -move.amount, balanceAfter: after.dollars } })
  return after.dollars
}

/**
 * Реферальная доля (обещание игрокам 23.10): пригласившему — процент с
 * покупки долларов. Считается только покупка у дилера: выдачи администрации
 * бывают подарками и оптом для самих дилеров, это не оплата. Дилер не
 * получает долю со своих же продаж — иначе он гонял бы доллары по кругу.
 * Доля сразу ложится на счёт и в referralBalance — её можно вывести на карту.
 */
async function rewardReferrer(tx: Prisma.TransactionClient, buyerId: string, amount: number, sellerId: string): Promise<void> {
  const share = Math.floor(amount * BalanceConfig.referral.topUpShare)
  if (share <= 0) return
  const buyer = await tx.character.findUnique({ where: { id: buyerId }, select: { isDealer: true, user: { select: { referrerCharacterId: true } } } })
  const referrerId = buyer?.user.referrerCharacterId
  if (!referrerId || buyer.isDealer || referrerId === buyerId || referrerId === sellerId) return
  const referrer = await tx.character.findUnique({ where: { id: referrerId }, select: { id: true } })
  if (!referrer) return
  await credit(tx, { characterId: referrerId, amount: share, reason: 'REFERRAL', counterpartyId: buyerId })
  await tx.character.update({ where: { id: referrerId }, data: { referralBalance: { increment: share } } })
}

/** Обменник Чёрного рынка (обещание игрокам 22.10: «в одну и в другую
 *  сторону»). Курсы стартовые, заказчик их не задавал. Разница курсов —
 *  комиссия обменника; потолок покупки в сутки бережёт дилеров. */
export const EXCHANGE = {
  buyRate: 1500,   // столько рублей стоит 1 $
  sellRate: 1000,  // столько рублей дают за 1 $
  dailyBuyLimit: 20,
}

export const DollarsService = {
  credit,
  debit,
  rewardReferrer,

  exchangeInfo: async (characterId: string) => {
    const bought = await boughtToday(characterId)
    return { ...EXCHANGE, boughtToday: bought, buyLeft: Math.max(0, EXCHANGE.dailyBuyLimit - bought) }
  },

  async exchange(characterId: string, direction: 'buy' | 'sell', dollars: number) {
    if (!Number.isInteger(dollars) || dollars <= 0) throw AppError.validation('Сумма должна быть больше нуля')
    return prisma.$transaction(async tx => {
      if (direction === 'buy') {
        // Блокировка строки персонажа: два одновременных обмена не обойдут суточный потолок.
        await tx.$queryRaw`SELECT id FROM characters WHERE id = ${characterId} FOR UPDATE`
        const bought = await boughtToday(characterId, tx)
        if (bought + dollars > EXCHANGE.dailyBuyLimit) {
          throw new AppError(ErrorCode.CONFLICT, `За сутки можно купить не больше ${EXCHANGE.dailyBuyLimit} $ (осталось ${Math.max(0, EXCHANGE.dailyBuyLimit - bought)} $)`, 409)
        }
        await EconomyService.debit(tx, { characterId, amount: dollars * EXCHANGE.buyRate, reasonCode: 'CURRENCY_EXCHANGE', note: `+${dollars} $` })
        await credit(tx, { characterId, amount: dollars, reason: 'EXCHANGE' })
      } else {
        await debit(tx, { characterId, amount: dollars, reason: 'EXCHANGE' })
        await EconomyService.credit(tx, { characterId, amount: dollars * EXCHANGE.sellRate, reasonCode: 'CURRENCY_EXCHANGE', note: `-${dollars} $` })
      }
      return tx.character.findUniqueOrThrow({ where: { id: characterId }, select: { money: true, dollars: true } })
    })
  },

  /** Счёт игрока: баланс, дилер ли он и последние движения. */
  async account(characterId: string) {
    const [character, history] = await Promise.all([
      prisma.character.findUniqueOrThrow({ where: { id: characterId }, select: { dollars: true, isDealer: true } }),
      prisma.dollarLog.findMany({ where: { characterId }, orderBy: { createdAt: 'desc' }, take: 30 }),
    ])
    const others = [...new Set(history.map(row => row.counterpartyId).filter(Boolean) as string[])]
    const names = new Map((await prisma.character.findMany({
      where: { id: { in: others } }, select: { id: true, nickname: true },
    })).map(c => [c.id, c.nickname]))
    return {
      dollars: character.dollars,
      isDealer: character.isDealer,
      history: history.map(row => ({
        id: row.id, amount: row.amount, balanceAfter: row.balanceAfter, reason: row.reason,
        counterparty: row.counterpartyId ? names.get(row.counterpartyId) ?? null : null,
        note: row.note, createdAt: row.createdAt,
      })),
    }
  },

  /** У кого купить доллары: список дилеров. */
  async dealers() {
    const rows = await prisma.character.findMany({
      where: { isDealer: true },
      select: { nickname: true, battleLevel: true, lastActiveAt: true },
      orderBy: { nickname: 'asc' },
    })
    return { items: rows }
  },

  /** Дилер зачисляет доллары игроку из своего запаса. */
  async transfer(dealerId: string, nickname: string, amount: number, key: string) {
    if (!Number.isInteger(amount) || amount <= 0 || amount > DEALER_TRANSFER_MAX) {
      throw AppError.validation(`Сумма перевода: от 1 до ${DEALER_TRANSFER_MAX.toLocaleString('ru')} $`)
    }
    return withIdempotency({ characterId: dealerId, scope: 'dollars.transfer', key, execute: async tx => {
      const dealer = await tx.character.findUniqueOrThrow({ where: { id: dealerId }, select: { isDealer: true, nickname: true } })
      if (!dealer.isDealer) throw new AppError(ErrorCode.FORBIDDEN, 'Переводить доллары могут только дилеры', 403)
      const target = await tx.character.findUnique({ where: { nickname: nickname.trim() }, select: { id: true, nickname: true } })
      if (!target) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, `Игрок «${nickname.trim()}» не найден`, 404)
      if (target.id === dealerId) throw AppError.validation('Себе переводить нельзя')
      const dealerBalance = await debit(tx, { characterId: dealerId, amount, reason: 'TRANSFER_OUT', counterpartyId: target.id })
      const targetBalance = await credit(tx, { characterId: target.id, amount, reason: 'TRANSFER_IN', counterpartyId: dealerId })
      await rewardReferrer(tx, target.id, amount, dealerId)
      return { to: target.nickname, amount, dealerBalance, targetBalance }
    } })
  },
}
