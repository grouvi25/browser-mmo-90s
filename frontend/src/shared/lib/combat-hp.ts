// Item APIs retain their catalog values for compatibility and for the rating.
const format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })

export function itemHp(points: number): number {
  return points * 35 / 100
}

export function formatItemHp(points: number): string {
  return format.format(itemHp(points))
}

/** Броня показывается очками вещи, как в каталоге: кратно 5 за очко, без десятых (Дима 24.11).
    В бою она переводится в HP на сервере, игроку эта дробь не нужна. */
export function formatArmor(points: number): string {
  return String(Math.round(points))
}

export function itemDamageRange(min: number, max: number): string {
  return formatItemHp(min) + '–' + formatItemHp(max) + ' HP'
}
