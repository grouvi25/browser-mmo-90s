// =============================================================
// Параметры вещи (правка 31.10, образец заказчика — «Примерочная» клана
// «Инквизиция»): 7 статов и по 4 мастерства, минус-мастерства, обереги и
// минус-обереги. Отсюда их берут карточки Склада и магазинов, настройка
// именной вещи и итог комплекта — подписи везде одинаковые.
// =============================================================
import { itemImage } from '../assets/shop/shop-images'
import { inventoryApi } from '../api/inventory.api'
import type { ItemBonuses, ItemInstance, ItemTemplate } from '../types/api.types'

export type StatKey = keyof ItemBonuses['stats']
export type MasteryKey = keyof ItemBonuses['mastery']
export type CharmKey = keyof ItemBonuses['charms']

export const STAT_LABELS: [StatKey, string][] = [
  ['str', 'Сила'], ['agi', 'Ловкость'], ['rea', 'Реакция'], ['agr', 'Агрессия'],
  ['luck', 'Фарт'], ['end', 'Выносливость'], ['acc', 'Меткость'],
]
export const MASTERY_LABELS: [MasteryKey, string][] = [
  ['fist', 'Маст. кулачного боя'], ['defense', 'Маст. защиты'], ['weapon', 'Маст. исп. оружия'], ['accuracy', 'Маст. меткости'],
]
export const CHARM_LABELS: [CharmKey, string][] = [
  ['antiLuck', 'Оберег удачи'], ['antiCounter', 'Оберег ответа'], ['antiCrit', 'Оберег крита'], ['antiDodge', 'Оберег уворота'],
]

const round = (value: number) => Math.round(value * 10) / 10
const sign = (value: number) => (value > 0 ? '+' : '−') + Math.abs(round(value))

export interface BonusLine { key: string; label: string; value: string }

/**
 * Всё, что вещь даёт сверх урона и брони, одним списком. Без экземпляра —
 * то, с чем вещь продаётся; с экземпляром — ещё и что вписал игрок.
 */
export function itemBonusLines(t: ItemTemplate, item?: ItemInstance): BonusLine[] {
  const extra = t.extraBonuses
  const own = item?.bonuses
  // Игрок вписывает очки, а показываем проценты.
  const points = (value = 0) => value * (item?.percentPerPoint ?? 5)
  const lines: BonusLine[] = []
  for (const [key, label] of STAT_LABELS) {
    const value = (t.statBonuses?.[key] ?? 0) + (own?.stats?.[key] ?? 0)
    if (value) lines.push({ key, label, value: sign(value) })
  }
  for (const [key, label] of MASTERY_LABELS) {
    const value = (extra?.mastery?.[key] ?? 0) + points(own?.mastery?.[key])
    if (value) lines.push({ key: `mastery-${key}`, label, value: `${sign(value)}%` })
  }
  for (const [key, label] of MASTERY_LABELS) {
    const value = (extra?.minusMastery?.[key] ?? 0) + points(own?.minusMastery?.[key])
    if (value) lines.push({ key: `minus-mastery-${key}`, label: `${label} [противнику]`, value: `−${round(value)}%` })
  }
  for (const [key, label] of CHARM_LABELS) {
    // Отрицательный оберег в базе — это минус-оберег старых вещей. Оберег крита
    // считается с очками «Защиты от крита»: их итог приходит с сервера.
    const base = key === 'antiCrit' && item?.effective ? Math.max(0, item.effective.antiCrit) : Math.max(0, t[key] ?? 0)
    const value = base * 100 + points(own?.charms?.[key])
    if (value) lines.push({ key: `charm-${key}`, label, value: `${sign(value)}%` })
  }
  for (const [key, label] of CHARM_LABELS) {
    const value = Math.max(0, -(t[key] ?? 0)) * 100 + (extra?.minusCharms?.[key] ?? 0) + points(own?.minusCharms?.[key])
    if (value) lines.push({ key: `minus-charm-${key}`, label: `${label} [противнику]`, value: `−${round(value)}%` })
  }
  return lines
}

/** Картинка вещи игрока: своя, если он её загрузил, иначе общая. */
export function instanceImage(item: ItemInstance): string | undefined {
  return item.iconVersion ? inventoryApi.iconUrl(item.id, item.iconVersion) : itemImage(item.template.code, item.template.weaponType, item.template.type)
}
