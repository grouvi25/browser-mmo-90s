// Кошелёк (№133, Metallica 16.11): приход и расход рублей по журналу денег,
// как выписка по долларам. Подписи здесь, чтобы новая причина не осталась
// в кошельке кодом: незнакомая показывается общей строкой.
import type { CurrencyLogReason } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { PROFESSION_NAMES } from '../professions/professions'
import { DOG_BREEDS } from '../city/dogs'

const REASON: Partial<Record<CurrencyLogReason, string>> = {
  SHOP_PURCHASE: 'Покупка в госмагазине',
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

/** Одна причина покрывает разные покупки: по типу записи подпись своя (Metallica 16.11). */
const REF_LABEL: Record<string, string> = {
  profession: 'Покупка профессии', 'dog-gear': 'Зоомагазин', 'pet-food': 'Корм для собаки', pet: 'Покупка собаки',
  trader: 'Патент торгаша', socket: 'Камень в вещь', retire_army_gear: 'Возврат за армейскую вещь', home: 'Ремонт жилья',
}

type Row = { reasonCode: CurrencyLogReason; refType: string | null; refId: string | null }

/** Что именно купили, продали или чинили: имена одним запросом на каждый тип записи. */
async function refNames(rows: Row[]): Promise<Map<string, string>> {
  const ids = (type: string | string[]) => [...new Set(rows.filter(r => r.refId && (Array.isArray(type) ? type : [type]).includes(r.refType ?? '')).map(r => r.refId!))]
  const names = new Map<string, string>()
  const put = (type: string, id: string, name: string | null | undefined) => { if (name) names.set(`${type}:${id}`, name) }
  const itemIds = ids(['item', 'repair', 'upgrade', 'socket'])
  const [shop, items, resources, privates, listings, shifts, bars, dogGear] = await Promise.all([
    ids('shop').length ? prisma.governmentShopItem.findMany({ where: { id: { in: ids('shop') } }, select: { id: true, template: { select: { name: true } } } }) : [],
    itemIds.length ? prisma.itemInstance.findMany({ where: { id: { in: itemIds } }, select: { id: true, template: { select: { name: true } } } }) : [],
    ids('resource').length ? prisma.resourceTemplate.findMany({ where: { id: { in: ids('resource') } }, select: { id: true, name: true } }) : [],
    ids('private_shop').length ? prisma.privateShopItem.findMany({ where: { id: { in: ids('private_shop') } }, select: { id: true, itemTemplateId: true, resourceTemplateId: true } }) : [],
    ids('market_listing').length ? prisma.marketListing.findMany({ where: { id: { in: ids('market_listing') } }, select: { id: true, itemInstanceId: true, resourceTemplateId: true, resourceAmount: true } }) : [],
    ids('work_shift').length ? prisma.workShift.findMany({ where: { id: { in: ids('work_shift') } }, select: { id: true, productionObject: { select: { name: true } } } }) : [],
    ids('bar_offer').length ? prisma.barOffer.findMany({ where: { id: { in: ids('bar_offer') } }, select: { id: true, name: true } }) : [],
    ids('dog-gear').length ? prisma.dogGearTemplate.findMany({ where: { code: { in: ids('dog-gear') } }, select: { code: true, name: true } }) : [],
  ])
  for (const row of shop) put('shop', row.id, row.template.name)
  for (const row of items) for (const type of ['item', 'repair', 'upgrade', 'socket']) put(type, row.id, row.template.name)
  for (const row of resources) put('resource', row.id, row.name)
  for (const row of shifts) put('work_shift', row.id, row.productionObject.name)
  for (const row of bars) put('bar_offer', row.id, row.name)
  for (const row of dogGear) put('dog-gear', row.code, row.name)
  // Лавки и рынок ссылаются на шаблон вещи или ресурса, а лот вещи — на саму вещь.
  const templateIds = [...new Set(privates.flatMap(r => r.itemTemplateId ? [r.itemTemplateId] : []))]
  const resourceIds = [...new Set([...privates, ...listings].flatMap(r => r.resourceTemplateId ? [r.resourceTemplateId] : []))]
  const lotItemIds = [...new Set(listings.flatMap(r => r.itemInstanceId ? [r.itemInstanceId] : []))]
  const [templates, resourceNames, lotItems] = await Promise.all([
    templateIds.length ? prisma.itemTemplate.findMany({ where: { id: { in: templateIds } }, select: { id: true, name: true } }) : [],
    resourceIds.length ? prisma.resourceTemplate.findMany({ where: { id: { in: resourceIds } }, select: { id: true, name: true } }) : [],
    lotItemIds.length ? prisma.itemInstance.findMany({ where: { id: { in: lotItemIds } }, select: { id: true, template: { select: { name: true } } } }) : [],
  ])
  const tName = new Map(templates.map(t => [t.id, t.name]))
  const rName = new Map(resourceNames.map(r => [r.id, r.name]))
  const iName = new Map(lotItems.map(i => [i.id, i.template.name]))
  for (const row of privates) put('private_shop', row.id, row.itemTemplateId ? tName.get(row.itemTemplateId) : row.resourceTemplateId ? rName.get(row.resourceTemplateId) : null)
  for (const row of listings) {
    const name = row.itemInstanceId ? iName.get(row.itemInstanceId) : row.resourceTemplateId ? rName.get(row.resourceTemplateId) : null
    put('market_listing', row.id, name && row.resourceAmount && row.resourceAmount > 1 ? `${name} ×${row.resourceAmount}` : name)
  }
  for (const row of rows) {
    if (row.refType === 'profession' && row.refId) put('profession', row.refId, PROFESSION_NAMES[row.refId as keyof typeof PROFESSION_NAMES])
    if (row.refType === 'pet' && row.refId) put('pet', row.refId, DOG_BREEDS.find(b => b.code === row.refId)?.name)
  }
  return names
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
    select: { id: true, amount: true, balanceAfter: true, reasonCode: true, refType: true, refId: true, note: true, createdAt: true },
  })
  const page = rows.slice(0, take)
  const names = await refNames(page)
  const items = page.map(row => {
    const base = (row.refType && REF_LABEL[row.refType]) || REASON[row.reasonCode] || 'Операция'
    const what = row.refType && row.refId ? names.get(`${row.refType}:${row.refId}`) : undefined
    const label = [what ? `${base}: ${what}` : base, row.note].filter(Boolean).join(' · ')
    return { id: row.id, amount: row.amount, balanceAfter: row.balanceAfter, label, at: row.createdAt }
  })
  return { items, hasMore: rows.length > take }
}
