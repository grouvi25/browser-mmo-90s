// Item APIs retain their catalog values for compatibility and for the rating.
const format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })

/** Урон вещи в HP. С 27.11 один к одному: Дима убрал «резку 0,35». */
export function itemHp(points: number): number {
  return points
}

export function formatItemHp(points: number): string {
  return format.format(itemHp(points))
}

/** Броня показывается очками вещи, как в каталоге: кратно 5 за очко, без десятых (Дима 24.11).
    В бою она переводится в HP на сервере, игроку эта дробь не нужна. */
export function formatArmor(points: number): string {
  return String(Math.round(points))
}

/** Урон оружия без «HP» (Дима 26.11: «дал в урон, а пишет ХП»). Числа те же, что снимаются со здоровья. */
export function itemDamageRange(min: number, max: number): string {
  return formatItemHp(min) + '–' + formatItemHp(max)
}
