// Собака из Зоомагазина в профиле и на карточке.
import type { Character } from '../types/api.types'

const STAT_LABEL: Record<string, string> = { end: 'выносливость', agi: 'ловкость', luck: 'фарт', str: 'сила', rea: 'реакция', acc: 'меткость' }

export function dogBonusText(bonus: Record<string, number>) {
  return Object.entries(bonus).map(([key, value]) => `+${value} ${STAT_LABEL[key] ?? key}`).join(', ')
}

/** Подсказка над ячейкой собаки: порода, сытость и бонус. */
export function dogTitle(dog: Character['dog']) {
  if (!dog) return 'Собаки нет — купить в Зоомагазине'
  return dog.fed
    ? `${dog.name} · ${dogBonusText(dog.bonus)} · сыта до ${new Date(dog.fedUntil!).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    : `${dog.name} голодная — бонуса нет. Покормить в Зоомагазине`
}
