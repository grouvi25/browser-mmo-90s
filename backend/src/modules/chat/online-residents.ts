interface Resident {
  slug: string
  nickname: string
  level: number
  occupation: string
  productionLevel: number
  stats: { str: number; agi: number; end: number; acc: number }
}

const RESIDENTS: readonly Resident[] = [
  { slug: 'gromov', nickname: 'Сапог', level: 3, occupation: 'Грузчик на рынке', productionLevel: 2, stats: { str: 8, agi: 3, end: 7, acc: 3 } },
  { slug: 'cassette', nickname: 'VHS90', level: 5, occupation: 'Ткач', productionLevel: 6, stats: { str: 4, agi: 10, end: 6, acc: 8 } },
  { slug: 'quiet', nickname: 'Тихоход', level: 7, occupation: 'Слесарь', productionLevel: 5, stats: { str: 8, agi: 9, end: 10, acc: 9 } },
  { slug: 'depot', nickname: 'Верка', level: 2, occupation: 'Снабженец', productionLevel: 5, stats: { str: 5, agi: 4, end: 7, acc: 5 } },
  { slug: 'motor', nickname: 'mot0r', level: 8, occupation: 'Токарь', productionLevel: 8, stats: { str: 10, agi: 7, end: 12, acc: 9 } },
  { slug: 'lamp', nickname: 'Ладушка', level: 8, occupation: 'Поставщик', productionLevel: 7, stats: { str: 6, agi: 13, end: 9, acc: 10 } },
  { slug: 'rivet', nickname: 'Клёпка', level: 6, occupation: 'Сварщик', productionLevel: 8, stats: { str: 10, agi: 5, end: 9, acc: 7 } },
  { slug: 'shift', nickname: 'tomka', level: 4, occupation: 'Рабочая бригада', productionLevel: 9, stats: { str: 6, agi: 5, end: 9, acc: 4 } },
  { slug: 'bitumen', nickname: 'Сырой Асфальт', level: 10, occupation: 'Сборщик металлолома', productionLevel: 9, stats: { str: 14, agi: 7, end: 14, acc: 10 } },
  { slug: 'cord', nickname: 'Ninel', level: 9, occupation: 'Столяр', productionLevel: 8, stats: { str: 7, agi: 13, end: 12, acc: 9 } },
  { slug: 'crane', nickname: 'Пятый этаж', level: 1, occupation: 'Заготовщик', productionLevel: 2, stats: { str: 5, agi: 3, end: 5, acc: 3 } },
  { slug: 'pager', nickname: 'Mila_92', level: 6, occupation: 'Торгаш', productionLevel: 7, stats: { str: 6, agi: 10, end: 8, acc: 8 } },
]

export function onlineResidents(activeNicknames: readonly string[]) {
  const active = new Set(activeNicknames.map(nickname => nickname.toLowerCase()))
  return RESIDENTS.filter(({ nickname }) => !active.has(nickname.toLowerCase())).map((resident) => ({
    characterId: 'resident:' + resident.slug,
    nickname: resident.nickname,
    level: resident.level,
    clan: null,
    resident: { occupation: resident.occupation, productionLevel: resident.productionLevel, stats: resident.stats },
  }))
}
