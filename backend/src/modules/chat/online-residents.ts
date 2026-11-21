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
  { slug: 'depot', nickname: 'Верка', level: 11, occupation: 'Снабженец', productionLevel: 10, stats: { str: 11, agi: 8, end: 14, acc: 13 } },
  { slug: 'motor', nickname: 'mot0r', level: 13, occupation: 'Токарь', productionLevel: 12, stats: { str: 16, agi: 10, end: 18, acc: 12 } },
  { slug: 'lamp', nickname: 'Ладушка', level: 8, occupation: 'Поставщик', productionLevel: 7, stats: { str: 6, agi: 13, end: 9, acc: 10 } },
  { slug: 'rivet', nickname: 'Клёпка', level: 6, occupation: 'Сварщик', productionLevel: 8, stats: { str: 10, agi: 5, end: 9, acc: 7 } },
  { slug: 'shift', nickname: 'tomka', level: 4, occupation: 'Рабочая бригада', productionLevel: 9, stats: { str: 6, agi: 5, end: 9, acc: 4 } },
  { slug: 'bitumen', nickname: 'Сырой Асфальт', level: 15, occupation: 'Сборщик металлолома', productionLevel: 11, stats: { str: 19, agi: 10, end: 19, acc: 13 } },
  { slug: 'cord', nickname: 'Ninel', level: 9, occupation: 'Столяр', productionLevel: 8, stats: { str: 7, agi: 13, end: 12, acc: 9 } },
  { slug: 'crane', nickname: 'Пятый этаж', level: 18, occupation: 'Заготовщик', productionLevel: 15, stats: { str: 21, agi: 13, end: 22, acc: 14 } },
  { slug: 'pager', nickname: 'Mila_92', level: 12, occupation: 'Торгаш', productionLevel: 6, stats: { str: 9, agi: 16, end: 12, acc: 15 } },
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
