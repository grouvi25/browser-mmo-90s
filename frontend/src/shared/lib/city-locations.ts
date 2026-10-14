import { MENU } from './layout-map'

/** Единственный список локаций Центра; адреса сохраняются сервером. */
export const CITY_LOCATIONS = [
  { key: 'center', label: 'Центр', to: '/' },
  { key: 'arena', label: 'Стрелки', to: '/pvp' },
  { key: 'market', label: 'Рынок', to: '/market' },
  { key: 'shop', label: 'Гос магазин', to: '/shop' },
  { key: 'industrial', label: 'Промзона', to: '/district/industrial' },
  { key: 'garages', label: 'Гаражи', to: '/district/garages' },
  { key: 'hall', label: 'Мэрия', to: '/city-hall' },
  { key: 'inventory', label: 'Склад', to: '/inventory' },
  { key: 'farm', label: 'Фермы', to: '/farm' },
  { key: 'school', label: 'Училище', to: '/school' },
  { key: 'prison', label: 'Тюрьма', to: '/prison' },
  { key: 'clans', label: 'Дома бригад', to: '/clan-houses' },
  { key: 'tsum', label: 'ЦУМ', to: '/tsum' },
  { key: 'berezka', label: 'Берёзка', to: '/berezka' },
  { key: 'pets', label: 'Зоомагазин', to: '/pet-shop' },
  { key: 'territories', label: 'Территории', to: '/territories' },
] as const

const KNOWN_PLACES: readonly { label: string; to: string }[] = [
  ...CITY_LOCATIONS, ...MENU.districts, ...Object.values(MENU.rooms).flat(),
]

/** Название места для досье и профиля. Сервер хранит адрес страницы
    (/school, /clans/storage), а игроку нужно «Училище»; вложенные адреса
    называются по ближайшей известной локации. */
export function locationLabel(value: string | null | undefined): string {
  if (!value) return 'Центральная площадь'
  if (!value.startsWith('/')) return value
  const match = KNOWN_PLACES
    .filter(place => place.to !== '/' && (value === place.to || value.startsWith(`${place.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0]
  return match?.label ?? 'Центр'
}
