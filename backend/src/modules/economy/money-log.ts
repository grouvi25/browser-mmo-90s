// Кошелёк (№133, Metallica 16.11): приход и расход рублей по журналу денег,
// как выписка по долларам. Подписи здесь, чтобы новая причина не осталась
// в кошельке кодом: незнакомая показывается общей строкой.
import type { CurrencyLogReason } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'

const REASON: Partial<Record<CurrencyLogReason, string>> = {
  SHOP_PURCHASE: 'Покупка у государства',
  SHOP_SELL: 'Продажа вещи государству',
  BATTLE_REWARD: 'Награда за бой',
  REPAIR_COST: 'Ремонт',
  ADMIN_GRANT: 'Начислено администрацией',
  ADMIN_DEDUCT: 'Списано администрацией',
  MARKET_SELL: 'Продажа на рынке',
  MARKET_FEE: 'Сбор рынка',
  MARKET_BUY: 'Покупка на рынке',
  MARKET_LISTING_TAX: 'Сбор за объявление на рынке',
  MARKET_SELL_TAX: 'Налог с продажи на рынке',
  PRIVATE_SHOP_BUY: 'Покупка в частной лавке',
  RESOURCE_SELL: 'Продажа сырья государству',
  UPGRADE_COST: 'Улучшение вещи',
  ADMIN_ECONOMY_ADJUSTMENT: 'Поправка администрации',
  OBJECT_PURCHASE: 'Покупка объекта',
  OBJECT_SALE: 'Продажа объекта',
  OBJECT_BALANCE_TOP_UP: 'Пополнение кассы объекта',
  OBJECT_WITHDRAW: 'Снятие с кассы объекта',
  OBJECT_WITHDRAW_TAX: 'Налог при снятии с кассы',
  OBJECT_PROFILE_SWITCH: 'Смена профиля объекта',
  OBJECT_REPAIR: 'Ремонт объекта',
  FARM_PLOT_PURCHASE: 'Покупка грядки',
  FARM_SEED_PURCHASE: 'Семена',
  FARM_BUILDING_PURCHASE: 'Постройка на ферме',
  BAR_PURCHASE: 'Бар',
  CLAN_CREATE: 'Создание бригады',
  CLAN_TREASURY_DEPOSIT: 'Взнос в казну бригады',
  CLAN_TREASURY_SPEND: 'Из казны бригады',
  CLAN_MAINTENANCE: 'Содержание бригады',
  SALARY_FROM_OBJECT: 'Зарплата с объекта',
  WORK_SALARY: 'Зарплата за смену',
  STAT_RESPEC_PURCHASE: 'Свиток перераспределения',
  CURRENCY_EXCHANGE: 'Обменник',
  HELPER_RENT: 'Аренда помощника',
  LEVEL_BONUS: 'Премия за уровень',
}

/** Уточнение по типу записи: одна причина покрывает разные покупки. */
const REF: Record<string, string> = {
  profession: 'профессия', 'dog-gear': 'вещь для собаки', 'pet-food': 'корм для собаки', pet: 'собака',
  trader: 'торгаш', socket: 'камень в вещь', retire_army_gear: 'возврат за армейские вещи',
}

export const MONEY_LOG_PAGE = 30

/** after — id последней показанной строки: следующая страница идёт строго за ней. */
export async function moneyLog(characterId: string, after?: string, limit = MONEY_LOG_PAGE) {
  const take = Math.min(Math.max(limit, 1), 100)
  const rows = await prisma.currencyLog.findMany({
    where: { characterId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    take: take + 1,
    select: { id: true, amount: true, balanceAfter: true, reasonCode: true, refType: true, note: true, createdAt: true },
  })
  const items = rows.slice(0, take).map(row => {
    const ref = row.refType ? REF[row.refType] : undefined
    const label = [REASON[row.reasonCode] ?? 'Операция', ref, row.note].filter(Boolean).join(' · ')
    return { id: row.id, amount: row.amount, balanceAfter: row.balanceAfter, label, at: row.createdAt }
  })
  return { items, hasMore: rows.length > take }
}
