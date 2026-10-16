// =============================================================
// Нижние вкладки: Центр показывает локации города, локация — свои.
//
// Правка заказчика (16 октября 2026): «Когда проваливаемся в локацию,
// основное меню пропадает. Переходы всегда через центр… вкладки меняются
// на вкладки локации + первая кнопка ЦЕНТР». Образец — «5 королей»:
// «На площадь», затем разделы локации.
//
// Вкладки, которые переключают вид внутри одной страницы (виды заявок
// в Стрелках, действия на Ферме), ведут на тот же адрес с ?tab=…:
// страница читает параметр, а полоса подсвечивает выбранное.
// =============================================================
import { CITY_LOCATIONS } from './city-locations'

export interface LocationTab { key: string; label: string; to: string }
export interface LocationMenu { key: string; tabs: LocationTab[] }

export const CENTER_TAB: LocationTab = { key: 'center', label: 'ЦЕНТР', to: '/' }

/** Личные разделы, которые живут в Центре рядом с локациями. */
const PERSONAL: LocationTab[] = [
  { key: 'skills', label: 'Навыки', to: '/stats' },
  { key: 'black-market', label: 'Чёрный рынок', to: '/premium' },
]

interface Place { key: string; match: string[]; tabs: LocationTab[] }

const PLACES: Place[] = [
  {
    key: 'arena', match: ['/pvp', '/battles/history'], tabs: [
      { key: 'all', label: 'Все заявки', to: '/pvp' },
      { key: 'duel', label: 'Дуэли', to: '/pvp?tab=DUEL' },
      { key: 'group', label: 'Групповые', to: '/pvp?tab=GROUP' },
      { key: 'chaotic', label: 'Хаотичные', to: '/pvp?tab=CHAOTIC' },
      { key: 'running', label: 'Идут сейчас', to: '/pvp?tab=RUNNING' },
      { key: 'history', label: 'История боёв', to: '/battles/history' },
    ],
  },
  {
    key: 'market', match: ['/market', '/shops/private', '/bars', '/district/market'], tabs: [
      { key: 'board', label: 'Объявления', to: '/market' },
      { key: 'private', label: 'Частные лавки', to: '/shops/private' },
      { key: 'bars', label: 'Бары', to: '/bars' },
      { key: 'mybar', label: 'Мой бар', to: '/bars/mine' },
    ],
  },
  { key: 'shop', match: ['/shop'], tabs: [] },
  {
    key: 'industrial', match: ['/district/industrial', '/work', '/objects', '/recipes'], tabs: [
      { key: 'landing', label: 'Промзона', to: '/district/industrial' },
      { key: 'work', label: 'Работа', to: '/work' },
      { key: 'objects', label: 'Мои объекты', to: '/objects' },
      { key: 'recipes', label: 'Рецепты', to: '/recipes' },
    ],
  },
  {
    key: 'garages', match: ['/district/garages', '/repair', '/upgrades'], tabs: [
      { key: 'landing', label: 'Гаражи', to: '/district/garages' },
      { key: 'repair', label: 'Мастерская', to: '/repair' },
      { key: 'upgrades', label: 'Улучшения', to: '/upgrades' },
    ],
  },
  {
    key: 'inventory', match: ['/inventory', '/resources'], tabs: [
      { key: 'gear', label: 'Снаряжение', to: '/inventory' },
      { key: 'resources', label: 'Сырьё и детали', to: '/resources' },
    ],
  },
  {
    key: 'farm', match: ['/farm', '/plants'], tabs: [
      { key: 'plant', label: 'Посадить', to: '/farm' },
      { key: 'water', label: 'Полить', to: '/farm?tab=water' },
      { key: 'build', label: 'Построить', to: '/farm?tab=build' },
      { key: 'plants', label: 'Растения', to: '/plants' },
    ],
  },
  {
    key: 'clans', match: ['/clan-houses', '/clans'], tabs: [
      { key: 'houses', label: 'Дома бригад', to: '/clan-houses' },
      { key: 'clan', label: 'Моя бригада', to: '/clans' },
      { key: 'storage', label: 'Склад бригады', to: '/clans/storage' },
      { key: 'treasury', label: 'Общак', to: '/clans/treasury' },
      { key: 'relations', label: 'Отношения', to: '/clans/relations' },
    ],
  },
  {
    key: 'territories', match: ['/territories'], tabs: [
      { key: 'map', label: 'Территории', to: '/territories' },
      { key: 'raids', label: 'Налёты', to: '/territories/raids' },
      { key: 'wars', label: 'Войны', to: '/territories/wars' },
    ],
  },
  {
    key: 'skills', match: ['/stats', '/skills'], tabs: [
      { key: 'stats', label: 'Характеристики', to: '/stats' },
      { key: 'weapons', label: 'Оружейные навыки', to: '/skills' },
    ],
  },
  {
    key: 'black-market', match: ['/premium'], tabs: [
      { key: 'showcase', label: 'Витрина', to: '/premium' },
      { key: 'helpers', label: 'Помощники', to: '/premium/helpers' },
    ],
  },
]

const startsWithPath = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`)

/** Полоса для адреса: в Центре — локации, в локации — ЦЕНТР и её разделы. */
export function locationMenu(pathname: string): LocationMenu {
  if (pathname === '/') {
    return { key: 'center', tabs: [...CITY_LOCATIONS.filter(item => item.key !== 'center'), ...PERSONAL] }
  }
  const place = PLACES.find(item => item.match.some(prefix => startsWithPath(pathname, prefix)))
  return { key: place?.key ?? 'other', tabs: [CENTER_TAB, ...(place?.tabs ?? [])] }
}

/** Какая вкладка подсвечена: точное совпадение с ?tab, затем по пути. */
export function activeTabKey(tabs: LocationTab[], pathname: string, search: string): string | undefined {
  const full = pathname + search
  const exact = tabs.find(tab => tab.to === full)
  if (exact) return exact.key
  const byPath = tabs
    .filter(tab => tab.to !== '/' && startsWithPath(pathname, tab.to.split('?')[0]))
    .sort((a, b) => b.to.length - a.to.length)
  // Вкладки с ?tab= без параметра в адресе не подсвечиваем: иначе на
  // голом /farm горела бы первая попавшаяся.
  return byPath.find(tab => !tab.to.includes('?'))?.key
}
