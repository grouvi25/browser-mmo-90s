// Справочные списки формы вещи: делят форма и список вещей в админке.

export type Kind = 'WEAPON' | 'ARMOR' | 'SHIELD' | 'ACCESSORY' | 'CONSUMABLE' | 'TOOL'
export type Shop = '' | 'GOVERNMENT' | 'TSUM' | 'BEREZKA' | 'kommersant' | 'armory_garage'

export const KINDS: [Kind, string][] = [
  ['WEAPON', 'Оружие'], ['ARMOR', 'Одежда и броня'], ['SHIELD', 'Щит'], ['ACCESSORY', 'Амулет'],
  ['CONSUMABLE', 'Расходник (аптечка и т. п.)'], ['TOOL', 'Инструмент'],
]
/** Где продаётся: валюта у каждого своя — её и подписываем у цены. */
export const SHOPS: { value: Shop; title: string; hint: string; currency: '₽' | '$' | null }[] = [
  { value: 'GOVERNMENT', title: 'Госмагазин', hint: 'общий магазин за рубли', currency: '₽' },
  { value: 'TSUM', title: 'ЦУМ', hint: 'именные и донатные вещи за доллары', currency: '$' },
  { value: 'BEREZKA', title: 'Берёзка', hint: 'артефакты за доллары', currency: '$' },
  { value: 'kommersant', title: 'Коммерсант', hint: 'частная лавка на рынке, за рубли', currency: '₽' },
  { value: 'armory_garage', title: 'Оружейный гараж', hint: 'частная лавка в Гаражах, за рубли', currency: '₽' },
  { value: '', title: 'Не продаётся', hint: 'только выдача из админки или награда', currency: null },
]
/** Прибавки надевшему: характеристики персонажа. */
export const GEAR_STATS: [string, string][] = [
  ['str', 'Сила'], ['end', 'Выносливость'], ['luck', 'Фарт'], ['agi', 'Ловкость'], ['acc', 'Меткость'], ['agr', 'Агрессия'],
]
/** Обереги: что каждый делает в бою — подписано прямо у поля. */
export const CHARMS: [string, string, string][] = [
  ['antiDodge', 'Оберег уворота', 'противник реже уворачивается от ваших ударов'],
  ['antiCrit', 'Оберег крита', 'по вам реже проходит крит'],
  ['antiLuck', 'Оберег удачи', 'ваш блок реже пробивают удачным ударом'],
  ['antiCounter', 'Оберег ответа', 'вам реже прилетает ответный удар'],
]
export function shopTitle(shop: string): string {
  return SHOPS.find(item => item.value === shop)?.title ?? shop
}
