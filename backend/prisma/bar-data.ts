export const BAR_RESOURCES = [
  ['res_alcohol', 'Спирт', 80, 0.2],
  ['res_extract', 'Экстракт', 90, 0.1],
  ['bar_shchi', 'Щи', 75, 0.5],
  ['bar_pelmeni', 'Пельмени', 120, 0.5],
  ['bar_kvass', 'Квас', 55, 0.3],
  ['bar_beer', 'Пиво Жигулёвское', 110, 0.3],
  ['bar_moonshine', 'Самогон', 150, 0.2],
  ['bar_chifir', 'Чифирь', 130, 0.1],
  ['bar_tincture', 'Настойка', 180, 0.1],
  ['bar_seeds', 'Семечки калёные', 90, 0.2],
  ['bar_papirosa', 'Папиросы', 170, 0.1],
] as const

export const BAR_RECIPES = [
  { code: 'rcp_bar_alcohol', name: 'Перегон спирта', output: 'res_alcohol', amount: 2, minutes: 90, labor: 60, inputs: [{ resourceCode: 'res_hops', amount: 3 }] },
  // Вход был res_chemicals, но это ниже по цепочке самого res_extract
  // (rcp_chemicals в economy-data.ts: res_extract → res_chemicals) — со
  // старым входом получался цикл, размножающий ресурсы. Травяной экстракт
  // тематически и не должен требовать промышленной химии.
  { code: 'rcp_bar_extract', name: 'Травяной экстракт', output: 'res_extract', amount: 2, minutes: 90, labor: 60, inputs: [{ resourceCode: 'res_greens', amount: 3 }, { resourceCode: 'res_hops', amount: 2 }] },
  { code: 'rcp_bar_shchi', name: 'Щи', output: 'bar_shchi', amount: 2, minutes: 30, labor: 30, inputs: [{ resourceCode: 'res_vegetables', amount: 3 }, { resourceCode: 'res_greens', amount: 1 }] },
  { code: 'rcp_bar_pelmeni', name: 'Пельмени', output: 'bar_pelmeni', amount: 2, minutes: 45, labor: 45, inputs: [{ resourceCode: 'res_vegetables', amount: 4 }, { resourceCode: 'res_fabric', amount: 1 }] },
  { code: 'rcp_bar_kvass', name: 'Квас', output: 'bar_kvass', amount: 2, minutes: 30, labor: 30, inputs: [{ resourceCode: 'res_hops', amount: 2 }] },
  { code: 'rcp_bar_beer', name: 'Пиво Жигулёвское', output: 'bar_beer', amount: 2, minutes: 60, labor: 45, inputs: [{ resourceCode: 'res_hops', amount: 3 }, { resourceCode: 'res_alcohol', amount: 1 }] },
  { code: 'rcp_bar_moonshine', name: 'Самогон', output: 'bar_moonshine', amount: 2, minutes: 75, labor: 60, inputs: [{ resourceCode: 'res_alcohol', amount: 2 }, { resourceCode: 'res_greens', amount: 1 }] },
  { code: 'rcp_bar_chifir', name: 'Чифирь', output: 'bar_chifir', amount: 1, minutes: 45, labor: 30, inputs: [{ resourceCode: 'res_greens', amount: 2 }, { resourceCode: 'res_extract', amount: 1 }] },
  { code: 'rcp_bar_tincture', name: 'Настойка', output: 'bar_tincture', amount: 1, minutes: 60, labor: 45, inputs: [{ resourceCode: 'res_extract', amount: 2 }] },
  // Семечки и табак — две верхние культуры фермы. До этих двух рецептов их
  // не потреблял никто: вырастить можно, деть некуда, кроме сдачи государству
  // за четверть цены, которую ТЗ намеренно делает невыгодной.
  { code: 'rcp_bar_seeds', name: 'Семечки калёные', output: 'bar_seeds', amount: 3, minutes: 30, labor: 30, inputs: [{ resourceCode: 'res_seeds', amount: 2 }] },
  { code: 'rcp_bar_papirosa', name: 'Папиросы', output: 'bar_papirosa', amount: 3, minutes: 45, labor: 45, inputs: [{ resourceCode: 'res_tobacco', amount: 2 }, { resourceCode: 'res_fabric', amount: 1 }] },
] as const

export const BAR_OFFERS = [
  { code: 'offer_shchi', name: 'Щи', resourceCode: 'bar_shchi', baseCost: 75, hpRestore: 25, alcoholDegrees: 0, accuracyBuff: 0, damageBuff: 0, buffMinutes: 0 },
  { code: 'offer_pelmeni', name: 'Пельмени', resourceCode: 'bar_pelmeni', baseCost: 120, hpRestore: 45, alcoholDegrees: 0, accuracyBuff: 0, damageBuff: 0, buffMinutes: 0 },
  { code: 'offer_kvass', name: 'Квас', resourceCode: 'bar_kvass', baseCost: 55, hpRestore: 15, alcoholDegrees: 8, accuracyBuff: 0, damageBuff: 0, buffMinutes: 0 },
  { code: 'offer_beer', name: 'Пиво Жигулёвское', resourceCode: 'bar_beer', baseCost: 110, hpRestore: 20, alcoholDegrees: 18, accuracyBuff: 0, damageBuff: 0, buffMinutes: 0 },
  { code: 'offer_moonshine', name: 'Самогон', resourceCode: 'bar_moonshine', baseCost: 150, hpRestore: 35, alcoholDegrees: 40, accuracyBuff: 0, damageBuff: 0, buffMinutes: 0 },
  { code: 'offer_chifir', name: 'Чифирь', resourceCode: 'bar_chifir', baseCost: 130, hpRestore: 0, alcoholDegrees: 0, accuracyBuff: 0.02, damageBuff: 0, buffMinutes: 30 },
  { code: 'offer_tincture', name: 'Настойка', resourceCode: 'bar_tincture', baseCost: 180, hpRestore: 0, alcoholDegrees: 0, accuracyBuff: 0, damageBuff: 0.03, buffMinutes: 30 },
  { code: 'offer_seeds', name: 'Семечки калёные', resourceCode: 'bar_seeds', baseCost: 90, hpRestore: 10, alcoholDegrees: 0, accuracyBuff: 0, damageBuff: 0, buffMinutes: 0 },
  // Одна ступень улучшения — это +0.01 точности, так что папиросы держатся
  // внутри шага прогрессии и не спорят с чифирём.
  { code: 'offer_papirosa', name: 'Папиросы', resourceCode: 'bar_papirosa', baseCost: 170, hpRestore: 0, alcoholDegrees: 0, accuracyBuff: 0.01, damageBuff: 0, buffMinutes: 20 },
] as const
