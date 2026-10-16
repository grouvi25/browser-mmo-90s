/** Начальный баланс новых локаций. Документ не задаёт цены/бонусы;
 * эти значения централизованы и явно перечислены в CITY_CHANGES.md. */
export const CityConfig = {
  professionPrice: 500,
  /** Старые порции корма (по суткам) докармливаются кнопкой «Покормить». */
  feedingHours: 24,
  /** Правка заказчика (16.10.2026): кота нет, три собаки. Бонус к
      характеристикам действует в бою, пока собака сыта. Одна собака на
      персонажа: она одна и показывается в профиле. */
  pets: [
    { code: 'mastiff', name: 'Мастифф', role: 'Танк, защитник', price: 3000, bonus: { end: 2 } },
    { code: 'malinois', name: 'Малинуа', role: 'Ловкость', price: 3000, bonus: { agi: 2 } },
    { code: 'doberman', name: 'Доберман', role: 'Удача', price: 3000, bonus: { luck: 2 } },
  ],
  /** Корм покупается сроком сытости; самый долгий — за доллары (донат). */
  feedPacks: [
    { code: 'food_72h', name: 'Корм на 72 часа', hours: 72, price: 150, currency: 'RUB' as const },
    { code: 'food_144h', name: 'Корм на 144 часа', hours: 144, price: 280, currency: 'RUB' as const },
    { code: 'food_2w', name: 'Корм на 2 недели', hours: 336, price: 5, currency: 'USD' as const },
  ],
  /** Дальше этого срока вперёд собаку не накормить: страховка от опечаток. */
  maxFedDays: 60,
  namedItems: [
    { code: 'tsum_named_knife', name: 'Именной нож', type: 'WEAPON' as const, weaponType: 'KNIFE' as const, armorSlot: null, price: 25000, budget: 20 },
    { code: 'tsum_named_jacket', name: 'Именная куртка', type: 'ARMOR' as const, weaponType: null, armorSlot: 'CHEST' as const, price: 30000, budget: 24 },
  ],
  artifact: { code: 'berezka_experience_amulet', name: 'Талисман опыта', price: 40000, bonus: 0.1 },
  /** Правка заказчика: ЦУМ и Берёзка — обычные магазины «только за другую
      валюту». Цена в долларах; рублёвая priceBase шаблона остаётся для
      ремонта и оценки вещи. */
  dollarPrices: { tsum_named_knife: 20, tsum_named_jacket: 25, berezka_experience_amulet: 30 } as Record<string, number>,
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

export type PetStatBonus = Partial<Record<'str' | 'agi' | 'rea' | 'acc' | 'end' | 'luck', number>>

/** Бонус сытой собаки к характеристикам. Старые питомцы (кот, пёс) бонуса не дают. */
export function petStatBonus(pets: readonly { code: string; fedUntil: Date | null }[] | undefined, now = new Date()): PetStatBonus {
  const dog = pets?.find(pet => CityConfig.pets.some(entry => entry.code === pet.code))
  if (!dog?.fedUntil || dog.fedUntil <= now) return {}
  return { ...CityConfig.pets.find(entry => entry.code === dog.code)!.bonus }
}

/** Характеристики с бонусом собаки — для расчёта боя. */
export function withPetBonus<T extends Record<string, unknown>>(stats: T, pets: readonly { code: string; fedUntil: Date | null }[] | undefined, now = new Date()): T {
  const bonus = petStatBonus(pets, now)
  const out: Record<string, unknown> = { ...stats }
  for (const [key, value] of Object.entries(bonus)) out[key] = Number(out[key] ?? 0) + (value ?? 0)
  return out as T
}

/** Собака для профиля: кто, сыта ли и что даёт. */
export function dogSummary(pets: readonly { id: string; code: string; fedUntil: Date | null }[] | undefined, now = new Date()) {
  const dog = pets?.find(pet => CityConfig.pets.some(entry => entry.code === pet.code))
  if (!dog) return null
  const entry = CityConfig.pets.find(item => item.code === dog.code)!
  const fed = !!dog.fedUntil && dog.fedUntil > now
  return { id: dog.id, code: dog.code, name: entry.name, role: entry.role, fedUntil: dog.fedUntil, fed, bonus: fed ? entry.bonus : {} }
}
