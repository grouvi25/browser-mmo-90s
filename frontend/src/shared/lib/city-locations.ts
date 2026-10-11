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
