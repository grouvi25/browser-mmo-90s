// Локации открываются по боевому уровню (обещание игрокам 22.10): новичок
// сначала дерётся, остальное видит полупрозрачным с пометкой, с какого
// уровня откроется. Пороги стартовые — заказчик может поменять здесь.

/** С какого боевого уровня открывается локация. Нет в списке — открыта сразу. */
export const LOCATION_LEVELS: Record<string, { level: number; paths: string[] }> = {
  farm:        { level: 2, paths: ['/farm', '/plants'] },
  industrial:  { level: 2, paths: ['/district/industrial', '/work', '/objects', '/recipes'] },
  school:      { level: 2, paths: ['/school'] },
  garages:     { level: 3, paths: ['/district/garages', '/repair', '/upgrades'] },
  bars:        { level: 3, paths: ['/bars'] },
  pets:        { level: 3, paths: ['/pet-shop'] },
  territories: { level: 5, paths: ['/territories'] },
  clans:       { level: 5, paths: ['/clan-houses', '/clans'] },
  hall:        { level: 5, paths: ['/city-hall'] },
  housing:     { level: 5, paths: ['/housing'] },
}

/** Короткая подсказка при наведении на кнопку локации в Центре. */
export const LOCATION_HINTS: Record<string, string> = {
  arena: 'Бои: с ботом, дуэли и групповые. Отсюда начинают — опыт и деньги.',
  market: 'Объявления игроков, Торгаш и частные лавки: купить и продать.',
  shop: 'Гос магазин: оружие, броня и инструмент за рубли.',
  industrial: 'Промзона: смены по профессии, свои объекты и рецепты.',
  garages: 'Гаражи: ремонт вещей и улучшения.',
  hall: 'Мэрия: регистрация бригады.',
  inventory: 'Склад: надеть вещи, сырьё и детали.',
  farm: 'Фермы: посадить, полить, собрать урожай.',
  school: 'Училище: купить профессию.',
  prison: 'Тюрьма: сюда сажают за нарушения.',
  clans: 'Дома бригад: состав, общак и склад бригады.',
  tsum: 'ЦУМ: именные вещи за доллары.',
  berezka: 'Берёзка: артефакты за доллары.',
  pets: 'Зоомагазин: боевая собака, корм и снаряжение для неё.',
  territories: 'Территории: захват районов, налёты и войны бригад.',
  housing: 'Жилой сектор: квартира или дом — опыт за бой и склад.',
  bars: 'Бары: свой бар и чужие.',
  skills: 'Характеристики и оружейные навыки.',
  'black-market': 'Чёрный рынок: премиум, помощники и обменник валют.',
  support: 'Поддержка: модераторы в сети и заявка.',
  library: 'Библиотека: что где делать — коротко по разделам.',
}

/** Персонажи, созданные до выката правила, уже обжились: у них дома, фермы
 *  и бригады — закрывать им купленное нельзя. Правило — для новичков. */
export const LEVEL_GATE_SINCE = Date.parse('2026-10-23T00:00:00Z')

export function levelGateApplies(char: { createdAt?: string } | undefined): boolean {
  return !!char?.createdAt && Date.parse(char.createdAt) >= LEVEL_GATE_SINCE
}

const within = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)

/** Нужный уровень для адреса или null, если адрес открыт всем. */
export function requiredLevel(pathname: string): { key: string; level: number } | null {
  for (const [key, rule] of Object.entries(LOCATION_LEVELS)) {
    if (rule.paths.some(prefix => within(pathname, prefix))) return { key, level: rule.level }
  }
  return null
}
