/**
 * РўР°Р±Р»РёС†С‹ СЌРєРѕРЅРѕРјРёРєРё Р­С‚Р°РїР° 2 вЂ” РµРґРёРЅСЃС‚РІРµРЅРЅС‹Р№ РёСЃС‚РѕС‡РЅРёРє РґР»СЏ СЃРёРґР° Рё РґР»СЏ РїСЂРѕРІРµСЂРєРё
 * РїСЂРѕС…РѕРґРёРјРѕСЃС‚Рё. РџРѕРєР° РѕРЅРё Р»РµР¶Р°Р»Рё РІРЅСѓС‚СЂРё seed.ts, СЃРЅР°СЂСѓР¶Рё РёС… РїСЂРѕС‡РёС‚Р°С‚СЊ Р±С‹Р»Рѕ
 * РЅРµС‡РµРј, Рё РЅРё РѕРґРёРЅ С‚РµСЃС‚ РЅРµ РјРѕРі Р·Р°РјРµС‚РёС‚СЊ, С‡С‚Рѕ РѕР±СЉРµРєС‚ Р·Р°РїРµСЂС‚ СЃР°Рј СЃРѕР±РѕР№.
 */

/** [РєРѕРґ, РёРјСЏ, РєР°С‚РµРіРѕСЂРёСЏ, С‚РёСЂ, Р±Р°Р·РѕРІР°СЏ С†РµРЅР°, РІРµСЃ, СЂРµРјРѕРЅС‚РЅС‹Р№, СѓР»СѓС‡С€Р°СЋС‰РёР№] */
export const RESOURCES = [
  ['res_scrap_metal', 'РњРµС‚Р°Р»Р»РѕР»РѕРј', 'PRIMARY', 1, 8, 0.5, false, false],
  ['res_fabric', 'РўРєР°РЅСЊ', 'PRIMARY', 1, 6, 0.3, false, false],
  ['res_leather', 'РљРѕР¶Р°', 'PRIMARY', 1, 12, 0.4, false, false],
  ['res_wood', 'Р”СЂРµРІРµСЃРёРЅР°', 'PRIMARY', 1, 5, 0.8, false, false],
  ['res_plastic', 'РџР»Р°СЃС‚РёРє', 'PRIMARY', 1, 7, 0.3, false, false],
  ['res_chemicals', 'РҐРёРјРёСЏ', 'PRIMARY', 1, 15, 0.4, false, false],
  ['res_spare_parts', 'Р—Р°РїС‡Р°СЃС‚Рё', 'PRIMARY', 1, 18, 0.6, false, false],
  ['comp_metal_plate', 'РњРµС‚Р°Р»Р»РёС‡РµСЃРєР°СЏ РїР»Р°СЃС‚РёРЅР°', 'REPAIR_PART', 2, 30, 0.7, true, false],
  ['comp_fastener', 'РљСЂРµРїС‘Р¶', 'COMPONENT', 2, 12, 0.2, false, false],
  ['comp_spring', 'РџСЂСѓР¶РёРЅР°', 'UPGRADE_PART', 2, 25, 0.2, false, true],
  ['comp_weapon_part', 'РћСЂСѓР¶РµР№РЅР°СЏ РґРµС‚Р°Р»СЊ', 'UPGRADE_PART', 2, 60, 0.5, true, true],
  ['comp_armor_plate', 'Р‘СЂРѕРЅРµРїР»Р°СЃС‚РёРЅР°', 'UPGRADE_PART', 2, 70, 0.9, true, true],
  ['comp_repair_kit', 'Р РµРјРєРѕРјРїР»РµРєС‚', 'REPAIR_PART', 2, 45, 0.5, true, false],
  ['res_greens', '??????', 'PRIMARY', 1, 20, 0.1, false, false],
  ['res_vegetables', '?????', 'PRIMARY', 1, 25, 0.4, false, false],
  ['res_hops', '?????', 'PRIMARY', 1, 55, 0.1, false, false],
  ['res_seeds', '???????', 'PRIMARY', 1, 100, 0.1, false, false],
  ['res_tobacco', '?????', 'PRIMARY', 1, 190, 0.1, false, false],
] as const

export const RESOURCE_CODES = RESOURCES.map(row => row[0])

/** [РєРѕРґ, РёРјСЏ, С‚РёРї, С‚СЂРµР±СѓРµРјС‹Р№ СѓСЂРѕРІРµРЅСЊ, РјРёРЅСѓС‚С‹ СЃРјРµРЅС‹, РѕРєР»Р°Рґ, РѕРїС‹С‚, СЂРµСЃСѓСЂСЃ, РјРёРЅ, РјР°РєСЃ, СЌРєРѕ-РѕРїС‹С‚] */
export const PRODUCTION_OBJECTS = [
  { code: 'obj_warehouse_station', name: 'РЎРєР»Р°Рґ Сѓ РІРѕРєР·Р°Р»Р°', type: 'WAREHOUSE', requiredProductionLevel: 0, shiftDurationMinutes: 30, baseSalary: 100, baseProductionExp: 8, producesResourceCode: null, outputAmountMin: 0, outputAmountMax: 0, economicExpReward: 0 },
  { code: 'obj_scrapyard', name: 'РџСѓРЅРєС‚ РјРµС‚Р°Р»Р»РѕР»РѕРјР°', type: 'SCRAPYARD', requiredProductionLevel: 0, shiftDurationMinutes: 30, baseSalary: 80, baseProductionExp: 10, producesResourceCode: 'res_scrap_metal', outputAmountMin: 2, outputAmountMax: 4, economicExpReward: 0 },
  { code: 'obj_market_loader', name: 'Р“СЂСѓР·С‡РёРє РЅР° СЂС‹РЅРєРµ', type: 'MARKET', requiredProductionLevel: 0, shiftDurationMinutes: 45, baseSalary: 120, baseProductionExp: 8, producesResourceCode: null, outputAmountMin: 0, outputAmountMax: 0, economicExpReward: 15 },
  { code: 'obj_garage_workshop', name: 'Р“Р°СЂР°Р¶РЅС‹Р№ С†РµС…', type: 'WORKSHOP', requiredProductionLevel: 1, shiftDurationMinutes: 60, baseSalary: 160, baseProductionExp: 15, producesResourceCode: 'comp_fastener', outputAmountMin: 1, outputAmountMax: 2, economicExpReward: 0 },
  { code: 'obj_small_factory', name: 'РњР°Р»С‹Р№ Р·Р°РІРѕРґ', type: 'FACTORY', requiredProductionLevel: 2, shiftDurationMinutes: 60, baseSalary: 220, baseProductionExp: 20, producesResourceCode: 'comp_metal_plate', outputAmountMin: 1, outputAmountMax: 2, economicExpReward: 0 },
  { code: 'obj_parts_factory', name: 'Р¤Р°Р±СЂРёРєР° РґРµС‚Р°Р»РµР№', type: 'FACTORY', requiredProductionLevel: 3, shiftDurationMinutes: 90, baseSalary: 300, baseProductionExp: 28, producesResourceCode: 'comp_weapon_part', outputAmountMin: 1, outputAmountMax: 1, economicExpReward: 0 },
  // РўСЂРµС‚РёР№ РїРµСЂРµРґРµР» СЃС‚СЂРѕРёС‚РµР»СЊРЅРѕР№ РІРµС‚РєРё. Р‘РµР· РЅРµРіРѕ В«РЎС‚СЂРѕРёС‚РµР»СЊ РєРѕРѕРїРµСЂР°С‚РёРІР°В» РЅРµ
  // СЃСѓС‰РµСЃС‚РІСѓРµС‚ РІ РёРіСЂРµ, Р° РѕРЅ вЂ” СЂРµРјРµСЃР»РµРЅРЅР°СЏ РїСЂРѕС„РµСЃСЃРёСЏ Р±СЂРѕРЅРё: СѓР»СѓС‡С€РµРЅРёСЏ Р±СЂРѕРЅРё
  // РЅР°РІСЃРµРіРґР° РѕСЃС‚Р°РІР°Р»РёСЃСЊ Р±С‹ РЅР° РЅСѓР»РµРІРѕРј СѓСЂРѕРІРЅРµ РјР°СЃС‚РµСЂСЃС‚РІР°, С‚РѕРіРґР° РєР°Рє РѕСЂСѓР¶РёРµ
  // РїРѕР»СѓС‡Р°Р»Рѕ РїСЂРёР±Р°РІРєСѓ РѕС‚ РѕСЂСѓР¶РµР№РЅРёРєР°. Р¦РёС„СЂС‹ Р·РµСЂРєР°Р»СЏС‚ С„Р°Р±СЂРёРєСѓ РґРµС‚Р°Р»РµР№ вЂ”
  // С‚РѕС‚ Р¶Рµ С‚СЂРµС‚РёР№ РїРµСЂРµРґРµР» РІ РјРµС‚Р°Р»Р»РёС‡РµСЃРєРѕР№ РІРµС‚РєРµ.
  { code: 'obj_cooperative_site', name: 'РЎС‚СЂРѕР№РєР° РєРѕРѕРїРµСЂР°С‚РёРІР°', type: 'WORKSHOP', requiredProductionLevel: 3, shiftDurationMinutes: 90, baseSalary: 300, baseProductionExp: 28, producesResourceCode: 'comp_armor_plate', outputAmountMin: 1, outputAmountMax: 1, economicExpReward: 0 },
  { code: 'obj_kolhoz_zarya', name: '?????? ??????', type: 'KOLHOZ', requiredProductionLevel: 0, shiftDurationMinutes: 60, baseSalary: 180, baseProductionExp: 18, producesResourceCode: 'res_vegetables', outputAmountMin: 3, outputAmountMax: 5, economicExpReward: 0 },
] as const

export const PRODUCTION_RECIPES = [
  {
    code: 'rcp_scrap',
    name: 'РЎР±РѕСЂ РјРµС‚Р°Р»Р»РѕР»РѕРјР°',
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
  { code: 'rcp_kolhoz_greens', name: '????????? ??????', productionObjectCode: 'obj_kolhoz_zarya', outputResourceCode: 'res_greens', outputItemTemplateCode: null, outputAmount: 12, cycleMinutes: 60, laborRequired: 60, requiredProfessionCode: 'procurer', requiredProfessionLevel: 0, requiredToolTier: 1, inputs: [] },
  { code: 'rcp_kolhoz_vegetables', name: '??????? ?????', productionObjectCode: 'obj_kolhoz_zarya', outputResourceCode: 'res_vegetables', outputItemTemplateCode: null, outputAmount: 12, cycleMinutes: 90, laborRequired: 60, requiredProfessionCode: 'procurer', requiredProfessionLevel: 0, requiredToolTier: 1, inputs: [] },
  { code: 'rcp_kolhoz_hops', name: '???????? ?????', productionObjectCode: 'obj_kolhoz_zarya', outputResourceCode: 'res_hops', outputItemTemplateCode: null, outputAmount: 8, cycleMinutes: 120, laborRequired: 90, requiredProfessionCode: 'procurer', requiredProfessionLevel: 1, requiredToolTier: 1, inputs: [] },
  { code: 'rcp_kolhoz_seeds', name: '???????????? ?????', productionObjectCode: 'obj_kolhoz_zarya', outputResourceCode: 'res_seeds', outputItemTemplateCode: null, outputAmount: 7, cycleMinutes: 150, laborRequired: 90, requiredProfessionCode: 'procurer', requiredProfessionLevel: 2, requiredToolTier: 2, inputs: [] },
  { code: 'rcp_kolhoz_tobacco', name: '???????? ?????', productionObjectCode: 'obj_kolhoz_zarya', outputResourceCode: 'res_tobacco', outputItemTemplateCode: null, outputAmount: 5, cycleMinutes: 180, laborRequired: 120, requiredProfessionCode: 'procurer', requiredProfessionLevel: 3, requiredToolTier: 2, inputs: [] },
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
}

/** Р РµСЃСѓСЂСЃС‹, РєРѕС‚РѕСЂС‹Рµ Р»Р°РІРєРё РїСЂРѕРґР°СЋС‚ РёРіСЂРѕРєСѓ. Р“РѕСЃСѓРґР°СЂСЃС‚РІРѕ СЂРµСЃСѓСЂСЃС‹ С‚РѕР»СЊРєРѕ СЃРєСѓРїР°РµС‚. */
export const PRIVATE_SHOP_RESOURCES = [
  { shopCode: 'kommersant', resourceCode: 'comp_armor_plate', price: 105 },
  { shopCode: 'kommersant', resourceCode: 'comp_repair_kit', price: 68 },
  { shopCode: 'armory_garage', resourceCode: 'comp_weapon_part', price: 90 },
  { shopCode: 'armory_garage', resourceCode: 'comp_repair_kit', price: 68 },
] as const

/** Р§РµРј С‡РёРЅСЏС‚: РєРѕРґ РёР· С€Р°Р±Р»РѕРЅР° РїСЂРµРґРјРµС‚Р°, РёРЅР°С‡Рµ СЂРµРјРєРѕРјРїР»РµРєС‚ РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ. */
export const REPAIR_RESOURCES = ['comp_weapon_part', 'comp_armor_plate', 'comp_repair_kit'] as const

/** Р§РµРј СѓР»СѓС‡С€Р°СЋС‚: РѕСЂСѓР¶РёРµ вЂ” РґРµС‚Р°Р»СЊСЋ, Р±СЂРѕРЅСЋ вЂ” РїР»Р°СЃС‚РёРЅРѕР№ (upgrades.formulas). */
export const UPGRADE_RESOURCES = ['comp_weapon_part', 'comp_armor_plate'] as const
