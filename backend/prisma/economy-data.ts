/**
 * Таблицы экономики Этапа 2 — единственный источник для сида и для проверки
 * проходимости. Пока они лежали внутри seed.ts, снаружи их прочитать было
 * нечем, и ни один тест не мог заметить, что объект заперт сам собой.
 */

/** [код, имя, категория, тир, базовая цена, вес, ремонтный, улучшающий] */
export const RESOURCES = [
  ['res_scrap_metal', 'Металлолом', 'PRIMARY', 1, 8, 0.5, false, false],
  ['res_fabric', 'Ткань', 'PRIMARY', 1, 6, 0.3, false, false],
  ['res_leather', 'Кожа', 'PRIMARY', 1, 12, 0.4, false, false],
  ['res_wood', 'Древесина', 'PRIMARY', 1, 5, 0.8, false, false],
  ['res_plastic', 'Пластик', 'PRIMARY', 1, 7, 0.3, false, false],
  ['res_chemicals', 'Химия', 'PRIMARY', 1, 15, 0.4, false, false],
  ['res_spare_parts', 'Запчасти', 'PRIMARY', 1, 18, 0.6, false, false],
  ['comp_metal_plate', 'Металлическая пластина', 'REPAIR_PART', 2, 30, 0.7, true, false],
  ['comp_fastener', 'Крепёж', 'COMPONENT', 2, 12, 0.2, false, false],
  ['comp_spring', 'Пружина', 'UPGRADE_PART', 2, 25, 0.2, false, true],
  ['comp_weapon_part', 'Оружейная деталь', 'UPGRADE_PART', 2, 60, 0.5, true, true],
  ['comp_armor_plate', 'Бронепластина', 'UPGRADE_PART', 2, 70, 0.9, true, true],
  ['comp_repair_kit', 'Ремкомплект', 'REPAIR_PART', 2, 45, 0.5, true, false],
] as const

export const RESOURCE_CODES = RESOURCES.map(row => row[0])

/** [код, имя, тип, требуемый уровень, минуты смены, оклад, опыт, ресурс, мин, макс, эко-опыт] */
export const PRODUCTION_OBJECTS = [
  { code: 'obj_warehouse_station', name: 'Склад у вокзала', type: 'WAREHOUSE', requiredProductionLevel: 0, shiftDurationMinutes: 30, baseSalary: 100, baseProductionExp: 8, producesResourceCode: null, outputAmountMin: 0, outputAmountMax: 0, economicExpReward: 0 },
  { code: 'obj_scrapyard', name: 'Пункт металлолома', type: 'SCRAPYARD', requiredProductionLevel: 0, shiftDurationMinutes: 30, baseSalary: 80, baseProductionExp: 10, producesResourceCode: 'res_scrap_metal', outputAmountMin: 2, outputAmountMax: 4, economicExpReward: 0 },
  { code: 'obj_market_loader', name: 'Грузчик на рынке', type: 'MARKET', requiredProductionLevel: 0, shiftDurationMinutes: 45, baseSalary: 120, baseProductionExp: 8, producesResourceCode: null, outputAmountMin: 0, outputAmountMax: 0, economicExpReward: 15 },
  { code: 'obj_garage_workshop', name: 'Гаражный цех', type: 'WORKSHOP', requiredProductionLevel: 1, shiftDurationMinutes: 60, baseSalary: 160, baseProductionExp: 15, producesResourceCode: 'comp_fastener', outputAmountMin: 1, outputAmountMax: 2, economicExpReward: 0 },
  { code: 'obj_small_factory', name: 'Малый завод', type: 'FACTORY', requiredProductionLevel: 2, shiftDurationMinutes: 60, baseSalary: 220, baseProductionExp: 20, producesResourceCode: 'comp_metal_plate', outputAmountMin: 1, outputAmountMax: 2, economicExpReward: 0 },
  { code: 'obj_parts_factory', name: 'Фабрика деталей', type: 'FACTORY', requiredProductionLevel: 3, shiftDurationMinutes: 90, baseSalary: 300, baseProductionExp: 28, producesResourceCode: 'comp_weapon_part', outputAmountMin: 1, outputAmountMax: 1, economicExpReward: 0 },
  // Третий передел строительной ветки. Без него «Строитель кооператива» не
  // существует в игре, а он — ремесленная профессия брони: улучшения брони
  // навсегда оставались бы на нулевом уровне мастерства, тогда как оружие
  // получало прибавку от оружейника. Цифры зеркалят фабрику деталей —
  // тот же третий передел в металлической ветке.
  { code: 'obj_cooperative_site', name: 'Стройка кооператива', type: 'WORKSHOP', requiredProductionLevel: 3, shiftDurationMinutes: 90, baseSalary: 300, baseProductionExp: 28, producesResourceCode: 'comp_armor_plate', outputAmountMin: 1, outputAmountMax: 1, economicExpReward: 0 },
] as const

export const PRODUCTION_RECIPES = [
  {
    code: 'rcp_scrap',
    name: 'Сбор металлолома',
    productionObjectCode: 'obj_scrapyard',
    outputResourceCode: 'res_scrap_metal',
    outputItemTemplateCode: null,
    outputAmount: 3,
    cycleMinutes: 30,
    laborRequired: 30,
    requiredProfessionCode: 'scrap_collector',
    requiredProfessionLevel: 0,
    requiredToolTier: 1,
    inputs: [] as ReadonlyArray<{ resourceCode: string; amount: number; minQuality: 'POOR' | 'NORMAL' | 'FINE' }>,
  },
] as const

export const OBJECT_PROFESSIONS: Record<string, string> = {
  obj_warehouse_station: 'supplier',
  obj_scrapyard: 'scrap_collector',
  obj_market_loader: 'procurer',
  obj_garage_workshop: 'foundry_worker',
  obj_small_factory: 'carpenter',
  obj_parts_factory: 'gunsmith',
  obj_cooperative_site: 'cooperative_builder',
}

/** Ресурсы, которые лавки продают игроку. Государство ресурсы только скупает. */
export const PRIVATE_SHOP_RESOURCES = [
  { shopCode: 'kommersant', resourceCode: 'comp_armor_plate', price: 105 },
  { shopCode: 'kommersant', resourceCode: 'comp_repair_kit', price: 68 },
  { shopCode: 'armory_garage', resourceCode: 'comp_weapon_part', price: 90 },
  { shopCode: 'armory_garage', resourceCode: 'comp_repair_kit', price: 68 },
] as const

/** Чем чинят: код из шаблона предмета, иначе ремкомплект по умолчанию. */
export const REPAIR_RESOURCES = ['comp_weapon_part', 'comp_armor_plate', 'comp_repair_kit'] as const

/** Чем улучшают: оружие — деталью, броню — пластиной (upgrades.formulas). */
export const UPGRADE_RESOURCES = ['comp_weapon_part', 'comp_armor_plate'] as const
