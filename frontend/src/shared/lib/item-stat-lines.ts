/**
 * Характеристики вещи строками для витрин: госмагазин, частные лавки.
 * Одно правило на все магазины, чтобы игрок везде видел одно и то же.
 */
import { healLabel, type ItemTemplate } from '../types/api.types'
import { rangeLabel } from './weapon-range'
import { itemBonusLines } from './item-bonuses'

export function itemStatLines(t: ItemTemplate, fits?: { name: string }[]): string[] {
  const out: string[] = []
  if (t.minDamage != null && t.maxDamage != null) out.push(`Урон: ${t.minDamage}–${t.maxDamage}`)
  if (t.type === 'WEAPON' && t.weaponAccuracy) out.push(`Точность: ${Math.round(t.weaponAccuracy * 100)}%`)
  if (t.type === 'WEAPON' && t.maxRange) out.push(`Дальность: ${rangeLabel(t.maxRange)}`)
  if (t.critBonus) out.push(`Крит: +${Math.round(t.critBonus * 100)}%`)
  if (t.armor) out.push(`Броня тела: +${t.armor}`)
  if (t.dodgeBonus) out.push(`Уворот: +${Math.round(t.dodgeBonus * 100)}%`)
  if (t.blockBonus) out.push(`Блок: +${Math.round(t.blockBonus * 100)}%`)
  if (t.hpBonus || t.healPercent) out.push(`Восстановит: +${healLabel(t)}`)
  for (const line of itemBonusLines(t)) out.push(`${line.label}: ${line.value}`)
  // №100: у вещи со свободными очками в карточке магазина не было видно, что она даёт.
  if (t.allocationMode === 'PLAYER' && t.statBudget > 0) out.push(`Очков статов: ${t.statBudget}, распределяете сами после покупки`)
  if (fits?.length) out.push(`Для профессий: ${fits.map(row => row.name).join(', ')}`)
  if (t.strReq > 0) out.push(`Требует силы: ${t.strReq}`)
  if (t.skillReq > 0) out.push(`Требует навык: ${t.skillReq}`)
  return out
}
