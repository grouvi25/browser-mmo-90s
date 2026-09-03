/**
 * Таблицы экономики Этапа 2 и Этапа 3 — единственный источник для сида и для
 * проверки проходимости. Пока они лежали внутри seed.ts, снаружи их прочитать
 * было нечем, и ни один тест не мог заметить, что объект заперт сам собой.
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
  ['res_greens', 'Зелень', 'PRIMARY', 1, 20, 0.1, false, false],
  ['res_vegetables', 'Овощи', 'PRIMARY', 1, 25, 0.4, false, false],
  ['res_hops', 'Хмель', 'PRIMARY', 1, 55, 0.1, false, false],
  ['res_seeds', 'Семечки', 'PRIMARY', 1, 100, 0.1, false, false],
  ['res_tobacco', 'Табак', 'PRIMARY', 1, 190, 0.1, false, false],
  ['comp_bandage_cloth', 'Перевязочная ткань', 'COMPONENT', 2, 22, 0.1, false, false],
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
  { code: 'obj_kolhoz_zarya', name: 'Колхоз «Заря»', type: 'KOLHOZ', requiredProductionLevel: 0, shiftDurationMinutes: 60, baseSalary: 180, baseProductionExp: 18, producesResourceCode: 'res_vegetables', outputAmountMin: 3, outputAmountMax: 5, economicExpReward: 0 },
  // Этап 3: пять объектов, закрывающих цепочки переделов. До них семь
  // ресурсов сида были заведены, но никем не производились (STAGE3_SEED_CONTENT.md, раздел 1).
  { code: 'obj_sawmill', name: 'Пилорама', type: 'WORKSHOP', requiredProductionLevel: 0, shiftDurationMinutes: 45, baseSalary: 130, baseProductionExp: 12, producesResourceCode: 'res_wood', outputAmountMin: 3, outputAmountMax: 5, economicExpReward: 0 },
  { code: 'obj_textile', name: 'Швейный цех', type: 'WORKSHOP', requiredProductionLevel: 1, shiftDurationMinutes: 60, baseSalary: 210, baseProductionExp: 18, producesResourceCode: null, outputAmountMin: 0, outputAmountMax: 0, economicExpReward: 0 },
  { code: 'obj_herb_point', name: 'Приёмка трав', type: 'SCRAPYARD', requiredProductionLevel: 0, shiftDurationMinutes: 30, baseSalary: 85, baseProductionExp: 9, producesResourceCode: 'res_greens', outputAmountMin: 2, outputAmountMax: 4, economicExpReward: 0 },
  { code: 'obj_pharmacy', name: 'Аптека', type: 'WORKSHOP', requiredProductionLevel: 1, shiftDurationMinutes: 60, baseSalary: 200, baseProductionExp: 17, producesResourceCode: null, outputAmountMin: 0, outputAmountMax: 0, economicExpReward: 0 },
  { code: 'obj_chem_lab', name: 'Химлаборатория', type: 'FACTORY', requiredProductionLevel: 3, shiftDurationMinutes: 90, baseSalary: 310, baseProductionExp: 26, producesResourceCode: null, outputAmountMin: 0, outputAmountMax: 0, economicExpReward: 0 },
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
  { code: 'rcp_kolhoz_greens', name: 'Выращивание зелени', productionObjectCode: 'obj_kolhoz_zarya', outputResourceCode: 'res_greens', outputItemTemplateCode: null, outputAmount: 12, cycleMinutes: 60, laborRequired: 60, requiredProfessionCode: 'procurer', requiredProfessionLevel: 0, requiredToolTier: 1, inputs: [] },
  { code: 'rcp_kolhoz_vegetables', name: 'Выращивание овощей', productionObjectCode: 'obj_kolhoz_zarya', outputResourceCode: 'res_vegetables', outputItemTemplateCode: null, outputAmount: 12, cycleMinutes: 90, laborRequired: 60, requiredProfessionCode: 'procurer', requiredProfessionLevel: 0, requiredToolTier: 1, inputs: [] },
  { code: 'rcp_kolhoz_hops', name: 'Выращивание хмеля', productionObjectCode: 'obj_kolhoz_zarya', outputResourceCode: 'res_hops', outputItemTemplateCode: null, outputAmount: 8, cycleMinutes: 120, laborRequired: 90, requiredProfessionCode: 'procurer', requiredProfessionLevel: 1, requiredToolTier: 1, inputs: [] },
  { code: 'rcp_kolhoz_seeds', name: 'Выращивание семечек', productionObjectCode: 'obj_kolhoz_zarya', outputResourceCode: 'res_seeds', outputItemTemplateCode: null, outputAmount: 7, cycleMinutes: 150, laborRequired: 90, requiredProfessionCode: 'procurer', requiredProfessionLevel: 2, requiredToolTier: 2, inputs: [] },
  { code: 'rcp_kolhoz_tobacco', name: 'Выращивание табака', productionObjectCode: 'obj_kolhoz_zarya', outputResourceCode: 'res_tobacco', outputItemTemplateCode: null, outputAmount: 5, cycleMinutes: 180, laborRequired: 120, requiredProfessionCode: 'procurer', requiredProfessionLevel: 3, requiredToolTier: 2, inputs: [] },

  // --- Этап 3: добыча (без входа), закрывает rcp_wood / rcp_herbs из STAGE3_SEED_CONTENT.md 3.1 ---
  { code: 'rcp_wood', name: 'Заготовка древесины', productionObjectCode: 'obj_sawmill', outputResourceCode: 'res_wood', outputItemTemplateCode: null, outputAmount: 4, cycleMinutes: 45, laborRequired: 45, requiredProfessionCode: 'supplier', requiredProfessionLevel: 0, requiredToolTier: 1, inputs: [] },
  { code: 'rcp_herbs', name: 'Сбор трав', productionObjectCode: 'obj_herb_point', outputResourceCode: 'res_greens', outputItemTemplateCode: null, outputAmount: 3, cycleMinutes: 30, laborRequired: 30, requiredProfessionCode: 'procurer', requiredProfessionLevel: 0, requiredToolTier: 1, inputs: [] },

  // --- Этап 3: металлическая ветка (STAGE3_SEED_CONTENT.md 3.2) ---
  // Вертикальный срез из handoff: металлолом → сталь → деталь → ТТ → износ → ремонт.
  { code: 'rcp_fastener', name: 'Штамповка крепежа', productionObjectCode: 'obj_garage_workshop', outputResourceCode: 'comp_fastener', outputItemTemplateCode: null, outputAmount: 2, cycleMinutes: 60, laborRequired: 60, requiredProfessionCode: 'foundry_worker', requiredProfessionLevel: 0, requiredToolTier: 1, inputs: [{ resourceCode: 'res_scrap_metal', amount: 4, minQuality: 'POOR' }] },
  { code: 'rcp_steel_plate', name: 'Прокат металлопластины', productionObjectCode: 'obj_small_factory', outputResourceCode: 'comp_metal_plate', outputItemTemplateCode: null, outputAmount: 2, cycleMinutes: 60, laborRequired: 90, requiredProfessionCode: 'carpenter', requiredProfessionLevel: 0, requiredToolTier: 1, inputs: [{ resourceCode: 'res_scrap_metal', amount: 6, minQuality: 'POOR' }, { resourceCode: 'comp_fastener', amount: 2, minQuality: 'POOR' }] },
  { code: 'rcp_spring', name: 'Навивка пружины', productionObjectCode: 'obj_small_factory', outputResourceCode: 'comp_spring', outputItemTemplateCode: null, outputAmount: 4, cycleMinutes: 45, laborRequired: 60, requiredProfessionCode: 'carpenter', requiredProfessionLevel: 1, requiredToolTier: 2, inputs: [{ resourceCode: 'comp_metal_plate', amount: 3, minQuality: 'NORMAL' }] },
  { code: 'rcp_weapon_part', name: 'Оружейная деталь', productionObjectCode: 'obj_parts_factory', outputResourceCode: 'comp_weapon_part', outputItemTemplateCode: null, outputAmount: 1, cycleMinutes: 90, laborRequired: 120, requiredProfessionCode: 'gunsmith', requiredProfessionLevel: 0, requiredToolTier: 2, inputs: [{ resourceCode: 'comp_metal_plate', amount: 3, minQuality: 'NORMAL' }, { resourceCode: 'comp_spring', amount: 2, minQuality: 'NORMAL' }] },
    // Крепёж в сборке — чтобы верхний предмет ветки тянул спрос и на дешёвый
  // передел: без него гаражный цех работал только на самого себя.
  { code: 'rcp_tt_pistol', name: 'Сборка пистолета ТТ', productionObjectCode: 'obj_parts_factory', outputResourceCode: null, outputItemTemplateCode: 'weapon_tt_private', outputAmount: 1, cycleMinutes: 120, laborRequired: 180, requiredProfessionCode: 'gunsmith', requiredProfessionLevel: 2, requiredToolTier: 3, inputs: [{ resourceCode: 'comp_weapon_part', amount: 4, minQuality: 'NORMAL' }, { resourceCode: 'comp_spring', amount: 2, minQuality: 'NORMAL' }, { resourceCode: 'comp_fastener', amount: 3, minQuality: 'POOR' }] },

  // --- Этап 3: строительная ветка (STAGE3_SEED_CONTENT.md 3.3) ---
  { code: 'rcp_fabric', name: 'Раскрой ткани', productionObjectCode: 'obj_textile', outputResourceCode: 'res_fabric', outputItemTemplateCode: null, outputAmount: 3, cycleMinutes: 60, laborRequired: 60, requiredProfessionCode: 'carpenter', requiredProfessionLevel: 0, requiredToolTier: 1, inputs: [{ resourceCode: 'res_wood', amount: 4, minQuality: 'POOR' }] },
  { code: 'rcp_leather', name: 'Выделка кожи', productionObjectCode: 'obj_textile', outputResourceCode: 'res_leather', outputItemTemplateCode: null, outputAmount: 2, cycleMinutes: 60, laborRequired: 75, requiredProfessionCode: 'carpenter', requiredProfessionLevel: 1, requiredToolTier: 2, inputs: [{ resourceCode: 'res_fabric', amount: 3, minQuality: 'POOR' }, { resourceCode: 'res_alcohol', amount: 1, minQuality: 'POOR' }] },
  { code: 'rcp_armor_plate', name: 'Клёпка бронепластины', productionObjectCode: 'obj_cooperative_site', outputResourceCode: 'comp_armor_plate', outputItemTemplateCode: null, outputAmount: 1, cycleMinutes: 90, laborRequired: 120, requiredProfessionCode: 'cooperative_builder', requiredProfessionLevel: 0, requiredToolTier: 2, inputs: [{ resourceCode: 'comp_metal_plate', amount: 3, minQuality: 'NORMAL' }, { resourceCode: 'res_leather', amount: 2, minQuality: 'POOR' }] },
  { code: 'rcp_jacket', name: 'Пошив куртки с пластинами', productionObjectCode: 'obj_cooperative_site', outputResourceCode: null, outputItemTemplateCode: 'armor_leather_jacket_private', outputAmount: 1, cycleMinutes: 120, laborRequired: 180, requiredProfessionCode: 'cooperative_builder', requiredProfessionLevel: 2, requiredToolTier: 3, inputs: [{ resourceCode: 'comp_armor_plate', amount: 3, minQuality: 'NORMAL' }, { resourceCode: 'res_leather', amount: 4, minQuality: 'POOR' }] },

  // --- Этап 3: химическая ветка (STAGE3_SEED_CONTENT.md 3.4) ---
  { code: 'rcp_alcohol', name: 'Перегонка спирта', productionObjectCode: 'obj_pharmacy', outputResourceCode: 'res_alcohol', outputItemTemplateCode: null, outputAmount: 2, cycleMinutes: 60, laborRequired: 60, requiredProfessionCode: 'pharmacist', requiredProfessionLevel: 0, requiredToolTier: 1, inputs: [{ resourceCode: 'res_greens', amount: 5, minQuality: 'POOR' }, { resourceCode: 'res_vegetables', amount: 3, minQuality: 'POOR' }] },
  { code: 'rcp_extract', name: 'Экстракция трав', productionObjectCode: 'obj_chem_lab', outputResourceCode: 'res_extract', outputItemTemplateCode: null, outputAmount: 2, cycleMinutes: 90, laborRequired: 90, requiredProfessionCode: 'chemist', requiredProfessionLevel: 0, requiredToolTier: 1, inputs: [{ resourceCode: 'res_hops', amount: 4, minQuality: 'POOR' }, { resourceCode: 'res_alcohol', amount: 2, minQuality: 'POOR' }] },
  { code: 'rcp_chemicals', name: 'Синтез химии', productionObjectCode: 'obj_chem_lab', outputResourceCode: 'res_chemicals', outputItemTemplateCode: null, outputAmount: 4, cycleMinutes: 60, laborRequired: 75, requiredProfessionCode: 'chemist', requiredProfessionLevel: 1, requiredToolTier: 2, inputs: [{ resourceCode: 'res_extract', amount: 3, minQuality: 'NORMAL' }] },
  { code: 'rcp_cloth', name: 'Перевязочная ткань', productionObjectCode: 'obj_textile', outputResourceCode: 'comp_bandage_cloth', outputItemTemplateCode: null, outputAmount: 4, cycleMinutes: 45, laborRequired: 45, requiredProfessionCode: 'carpenter', requiredProfessionLevel: 0, requiredToolTier: 1, inputs: [{ resourceCode: 'res_fabric', amount: 2, minQuality: 'POOR' }] },
  { code: 'rcp_bandage', name: 'Скрутка бинтов', productionObjectCode: 'obj_pharmacy', outputResourceCode: null, outputItemTemplateCode: 'consumable_bandage', outputAmount: 4, cycleMinutes: 45, laborRequired: 45, requiredProfessionCode: 'pharmacist', requiredProfessionLevel: 0, requiredToolTier: 1, inputs: [{ resourceCode: 'comp_bandage_cloth', amount: 2, minQuality: 'POOR' }] },
  { code: 'rcp_first_aid', name: 'Сборка аптечки', productionObjectCode: 'obj_pharmacy', outputResourceCode: null, outputItemTemplateCode: 'consumable_first_aid_kit', outputAmount: 2, cycleMinutes: 60, laborRequired: 75, requiredProfessionCode: 'pharmacist', requiredProfessionLevel: 1, requiredToolTier: 2, inputs: [{ resourceCode: 'comp_bandage_cloth', amount: 3, minQuality: 'POOR' }, { resourceCode: 'res_extract', amount: 1, minQuality: 'POOR' }] },
  { code: 'rcp_plastic', name: 'Литьё пластика', productionObjectCode: 'obj_chem_lab', outputResourceCode: 'res_plastic', outputItemTemplateCode: null, outputAmount: 4, cycleMinutes: 60, laborRequired: 60, requiredProfessionCode: 'chemist', requiredProfessionLevel: 1, requiredToolTier: 2, inputs: [{ resourceCode: 'res_chemicals', amount: 3, minQuality: 'POOR' }] },
  { code: 'rcp_spare_parts', name: 'Обточка запчастей', productionObjectCode: 'obj_garage_workshop', outputResourceCode: 'res_spare_parts', outputItemTemplateCode: null, outputAmount: 2, cycleMinutes: 60, laborRequired: 60, requiredProfessionCode: 'foundry_worker', requiredProfessionLevel: 1, requiredToolTier: 2, inputs: [{ resourceCode: 'comp_fastener', amount: 2, minQuality: 'POOR' }, { resourceCode: 'res_plastic', amount: 2, minQuality: 'POOR' }] },
  // Замыкает запчасти: раньше они производились и не были нужны никому.
  // Заодно у ремкомплекта появляется производитель — до этого его можно
  // было только купить в лавке, хотя чинят им постоянно.
  { code: 'rcp_repair_kit', name: 'Сборка ремкомплекта', productionObjectCode: 'obj_garage_workshop', outputResourceCode: 'comp_repair_kit', outputItemTemplateCode: null, outputAmount: 2, cycleMinutes: 75, laborRequired: 75, requiredProfessionCode: 'foundry_worker', requiredProfessionLevel: 2, requiredToolTier: 2, inputs: [{ resourceCode: 'res_spare_parts', amount: 2, minQuality: 'POOR' }, { resourceCode: 'comp_fastener', amount: 1, minQuality: 'POOR' }] },
] as const

export const OBJECT_PROFESSIONS: Record<string, string> = {
  obj_warehouse_station: 'supplier',
  obj_scrapyard: 'scrap_collector',
  obj_market_loader: 'procurer',
  obj_garage_workshop: 'foundry_worker',
  obj_small_factory: 'carpenter',
  obj_parts_factory: 'gunsmith',
  obj_cooperative_site: 'cooperative_builder',
  obj_kolhoz_zarya: 'procurer',
  obj_sawmill: 'supplier',
  obj_textile: 'carpenter',
  obj_herb_point: 'procurer',
  obj_pharmacy: 'pharmacist',
  obj_chem_lab: 'chemist',
}

/**
 * Районы города. Коды дословно совпадают с ключами `MENU.districts` во
 * фронте (`frontend/src/shared/lib/layout-map.ts`): это единственная связь
 * карты города с территориями Этапа 4, и держится она на совпадении строк,
 * поэтому проверяется тестом.
 */
export const DISTRICT_CODES = [
  'center', 'market', 'industrial', 'station', 'garages', 'suburb',
] as const

export type DistrictCode = (typeof DISTRICT_CODES)[number]

/**
 * В каком районе стоит объект. Пишется в `ProductionObject.locationId` —
 * поле заведено заделом ещё в Этапе 1 и до сих пор не заполнялось ничем.
 *
 * Раскладка не случайна. От неё зависит, где в Этапе 4 будет война: атаковать
 * можно только объект в своём районе или в районе врага, поэтому район с
 * четырьмя объектами спорнее района с одним. Промзона и Спальный намеренно
 * сделаны производственными центрами, Рынок и Вокзал — редкими: их ценность
 * в бонусе района, а не в числе целей.
 */
export const OBJECT_DISTRICTS: Record<string, DistrictCode> = {
  obj_pharmacy: 'center',
  obj_textile: 'center',
  obj_market_loader: 'market',
  obj_herb_point: 'market',
  obj_scrapyard: 'industrial',
  obj_small_factory: 'industrial',
  obj_parts_factory: 'industrial',
  obj_chem_lab: 'industrial',
  obj_warehouse_station: 'station',
  // Пивная сеется отдельным блоком (BAR_RECIPES тянут за собой объект), но
  // район ей нужен так же: без него бар нельзя ни защитить, ни ограбить.
  obj_bar_station: 'station',
  obj_garage_workshop: 'garages',
  obj_cooperative_site: 'suburb',
  obj_kolhoz_zarya: 'suburb',
  obj_sawmill: 'suburb',
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
