// Item APIs retain their catalog values for compatibility and for the rating.
const format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })

export function itemHp(points: number): number {
  return points * 35 / 100
}

export function formatItemHp(points: number): string {
  return format.format(itemHp(points))
}

export function itemDamageRange(min: number, max: number): string {
  return formatItemHp(min) + '–' + formatItemHp(max) + ' HP'
}
