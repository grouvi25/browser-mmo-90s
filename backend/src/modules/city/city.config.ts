/** Начальный баланс новых локаций. Документ не задаёт цены/бонусы;
 * эти значения централизованы и явно перечислены в CITY_CHANGES.md. */
export const CityConfig = {
  professionPrice: 500,
  foodPrice: 50,
  feedingHours: 24,
  maxFood: 100,
  pets: [
    { code: 'cat', name: 'Кот', price: 1000 },
    { code: 'dog', name: 'Пёс', price: 1500 },
  ],
  namedItems: [
    { code: 'tsum_named_knife', name: 'Именной нож', type: 'WEAPON' as const, weaponType: 'KNIFE' as const, armorSlot: null, price: 25000, budget: 20 },
    { code: 'tsum_named_jacket', name: 'Именная куртка', type: 'ARMOR' as const, weaponType: null, armorSlot: 'CHEST' as const, price: 30000, budget: 24 },
  ],
  artifact: { code: 'berezka_experience_amulet', name: 'Талисман опыта', price: 40000, bonus: 0.1 },
} as const
export const CITY_PATHS = ['/', '/pvp', '/market', '/shop', '/district/industrial', '/district/garages',
  '/city-hall', '/inventory', '/farm', '/school', '/prison', '/clan-houses', '/tsum', '/berezka',
  '/pet-shop', '/territories', '/work', '/objects', '/resources', '/recipes', '/repair', '/upgrades',
  '/plants', '/bars', '/bars/mine', '/clans', '/clans/storage', '/clans/treasury', '/clans/relations',
  '/skills', '/stats', '/battles/history', '/premium', '/premium/helpers', '/territories/raids',
  '/territories/wars', '/shops/private', '/district/market', '/district/suburb', '/district/station',
  '/radio', '/news', '/updates', '/forum', '/soon/storage', '/soon/equipment-production', '/soon/logistics'] as const
export function validCityPath(path: string): boolean {
  return (CITY_PATHS as readonly string[]).includes(path)
    || /^\/territories\/[a-z0-9_-]+\/claims\/[0-9a-f-]{36}$/i.test(path)
}
export function inPrison(until: Date | null, now = new Date()): boolean {
  return !!until && until.getTime() > now.getTime()
}
export function artifactBonus(values: number[]): number {
  return Math.min(0.5, values.reduce((sum, value) => sum + Math.max(0, Math.min(0.5, value)), 0))
}
