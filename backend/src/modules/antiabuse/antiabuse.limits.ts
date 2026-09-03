// =============================================================
// ЖЁСТКИЕ ЛИМИТЫ АНТИАБУЗА — шаг G3 Этапа 5
//
// Работают молча, всегда и для всех. Это не наказание, а правила игры, и они
// описываются игроку в разделе ограничений первой версии.
//
// В этом файле только то, чего в игре ещё не было. Коэффициент разницы
// уровней и затухание опыта с ботов действуют с Этапов 1–2, и заводить
// поверх них второе правило значило бы менять принятую боёвку под видом
// антиабуза — см. комментарий в BalanceConfig.antiAbuse.
//
// ТЗ: docs/specs/stage-5/STAGE5_ANTIABUSE.md раздел 2.
// =============================================================
import type { Prisma } from '@prisma/client'
import { BalanceConfig } from '../../config/balance.config'

const A = BalanceConfig.antiAbuse

/** Границы календарных суток по UTC — тем же способом, что и лимиты смен. */
export function dayBounds(now = new Date()) {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  return { start, end: new Date(start.getTime() + 24 * 3_600_000) }
}

/**
 * Множитель опыта за повторный бой с той же парой.
 *
 * Основная мера против договорных боёв и самая мягкая из возможных: друзья,
 * честно подравшиеся дважды, теряют немного, а пара, гоняющая двадцать боёв
 * подряд, не получает почти ничего. Бан за это не выдаётся — договорной бой
 * от дружеского отличается только намерением, а намерение не измеряется.
 */
export function repeatBattleCoeff(battlesTodayWithSamePair: number): number {
  return battlesTodayWithSamePair <= 0 ? 1 : A.repeatBattleShare
}

/**
 * Сколько боёв у этой пары уже было сегодня.
 *
 * Считается по участникам боёв, а не по отдельной таблице: пара — это
 * свойство прошедших боёв, и вести её отдельно значило бы держать вторую
 * правду о том же.
 */
export async function pairBattlesToday(
  tx: Prisma.TransactionClient,
  characterA: string,
  characterB: string,
  now = new Date(),
): Promise<number> {
  const { start } = dayBounds(now)
  const mine = await tx.battleParticipant.findMany({
    where: { characterId: characterA, battle: { finishedAt: { gte: start } } },
    select: { battleId: true },
  })
  if (mine.length === 0) return 0
  return tx.battleParticipant.count({
    where: { characterId: characterB, battleId: { in: mine.map(row => row.battleId) } },
  })
}

export interface PairFlowToday {
  money: number
  items: number
}

/**
 * Сколько ценностей один персонаж уже получил от другого за сутки.
 *
 * Прямых передач денег в игре нет — единственный канал это рынок, и именно
 * там строится самая очевидная схема перелива: продать себе лот по
 * завышенной цене. Поэтому лимит считается по рынку, а не по несуществующей
 * ручке «передать деньги».
 */
export async function pairFlowToday(
  tx: Prisma.TransactionClient,
  fromCharacterId: string,
  toCharacterId: string,
  now = new Date(),
): Promise<PairFlowToday> {
  const { start } = dayBounds(now)
  const sales = await tx.marketListing.findMany({
    where: {
      status: 'SOLD',
      sellerCharacterId: toCharacterId,
      buyerCharacterId: fromCharacterId,
      soldAt: { gte: start },
    },
    select: { price: true, type: true },
  })
  return {
    money: sales.reduce((sum, row) => sum + row.price, 0),
    items: sales.filter(row => row.type === 'ITEM').length,
  }
}

export interface PairFlowVerdict {
  allowed: boolean
  reason?: 'MONEY_CAP' | 'ITEMS_CAP'
  money: number
  items: number
  moneyCap: number
  itemsCap: number
}

/**
 * Пройдёт ли сделка по суточному лимиту пары.
 *
 * Превышение — отказ, а не сигнал: перелив денег ломает экономику быстрее,
 * чем админ успеет отреагировать. Это единственное место антиабуза, где
 * решение принимает код, а не человек.
 */
export function checkPairFlow(current: PairFlowToday, price: number, isItem: boolean): PairFlowVerdict {
  const money = current.money + price
  const items = current.items + (isItem ? 1 : 0)
  const base = {
    money, items,
    moneyCap: A.pairMoneyDailyCap,
    itemsCap: A.pairItemsDailyCap,
  }
  if (money > A.pairMoneyDailyCap) return { allowed: false, reason: 'MONEY_CAP', ...base }
  if (items > A.pairItemsDailyCap) return { allowed: false, reason: 'ITEMS_CAP', ...base }
  return { allowed: true, ...base }
}
