# GanjaWars exact production recipes

Collected: 2026-08-13
Primary source: [GanjaWiki: Завод](https://www.ganjawiki.ru/Завод)

## Dataset

The source page was parsed directly from its two production tables. The repository contains the complete machine-readable result:

- `data/ganjawars_factory_recipes_ganja_island.csv`: 219 recipes
- `data/ganjawars_factory_recipes_z_lands.csv`: 145 recipes
- total: **364 exact factory profiles**
- `data/ganjawars_factory_recipes_meta.json`: source and column metadata

CSV checksums after UTF-8 normalization:

- Ganja Island: `657a1701bf5e0d12dedb0a4dd0f2dba33e9df33e3d9150515fae4285448d2fa6`
- Z-Lands: `eb00e0fb8fc5e999a151330e524790a48a297105b28b22530513161024d5a05c`

A zero means the source table had an em dash, meaning that input is not consumed by the profile.

## Column semantics

Common columns:

- `factory`: source factory/profile name;
- `output_resource`: produced resource;
- `work_hours`: source column «Раб. часы»;
- `power`: source production power;
- `output_per_hour`: units produced per hour;
- remaining columns: units of each input consumed per hour.

Ganja Island inputs:

`aluminum, batteries, ganjium, poppy_straw, plastic, steel, grass, uranium`

Z-Lands inputs:

`aluminum, batteries, seaweed, ganjium, oil, plastic, steel, grass, uranium`

The recipes are exact transcriptions of the current GanjaWiki table, not proposed Kooperativ balance values.

## Exact representative recipes

| Island | Output | Work h | Power | Output/h | Exact inputs/h |
|---|---:|---:|---:|---:|---|
| Ganja | Пистолет ТТ (р) | 1 | 1 | 1 | ганджиум 22, сталь 32, трава 12, уран 6 |
| Ganja | АК-74 (р) | 3 | 4 | 1 | ганджиум 48, сталь 55, трава 65, уран 6 |
| Ganja | Нож OKC-3S (р) | 1 | 20 | 1 | алюминий 100, ганджиум 250, сталь 270, уран 150 |
| Ganja | Граната РГД-5 (р) | 6 | 1 | 1 | ганджиум 3, сталь 5, трава 8, уран 6 |
| Ganja | Рогатка (р) | 6 | 1 | 1 | ганджиум 3, сталь 6, трава 9, уран 6 |
| Ganja | Армейские ботинки (р) | 3 | 2 | 1 | ганджиум 12, маковая соломка 24, сталь 20, уран 12 |
| Ganja | Бронежилет 1 кл. (р) | 3 | 2 | 1 | ганджиум 48, маковая соломка 65, сталь 35, уран 12 |
| Ganja | Бронежилет 2 кл. (р) | 3 | 6 | 1 | ганджиум 135, маковая соломка 200, сталь 120, уран 36 |
| Ganja | Бронежилет 3 кл. (р) | 3 | 8 | 1 | ганджиум 160, маковая соломка 215, сталь 120, уран 48 |
| Z-Lands | Бронежилет 4 кл. (р) | 3 | 30 | 1 | батареи 33, водоросли 270, сталь 100, трава 270, уран 195 |
| Ganja | Броня 5 класса (р) | 3 | 25 | 1 | ганджиум 257, маковая соломка 538, сталь 207, уран 149 |
| Ganja | Броня 6 класса (р) | 1 | 27 | 1 | ганджиум 278, маковая соломка 583, сталь 224, уран 161 |
| Ganja | Модуль дальности | 1 | 15 | 1 | алюминий 10, ганджиум 30, сталь 10, уран 2 |
| Ganja | Комплект апгрейда брони | 1 | 8 | 1 | алюминий 10, батареи 10, ганджиум 15, пластик 10 |
| Ganja | Комплект апгрейда шлемов | 1 | 8 | 1 | алюминий 10, батареи 10, ганджиум 13, пластик 11 |
| Z-Lands | Бронебойный комплект | 1 | 15 | 1 | алюминий 20, пластик 6, трава 10, уран 2 |
| Z-Lands | Модуль скорострельности | 1 | 15 | 1 | алюминий 22, пластик 8, трава 10, уран 2 |

## Exact intermediate-resource recipes

| Island | Output | Work h | Output/h | Inputs/h |
|---|---:|---:|---:|---|
| Ganja | Ганджиум | 16 | 1 | трава 40, уран 6 |
| Z-Lands | Пластик | 6 | 1 | водоросли 24, нефть 6, уран 6 |
| Z-Lands | Резина | 9 | 1 | водоросли 24, нефть 9, уран 6 |
| Ganja/Z-Lands | Табак | 1 | 1 | ганджиум 2, пластик 2, уран 38 |

These rows demonstrate a real multi-stage chain:

`primary resource → intermediate material → final equipment/module`

Examples:

- grass + uranium → ganjium → TT/AK/armor;
- seaweed + oil + uranium → plastic/rubber → modules, transport and equipment;
- final equipment resources then move to retail or an exchange terminal.

## Scale patterns found in the exact table

1. Most final recipes produce 1 unit/hour.
2. Power and input requirements vary dramatically while output stays at 1, making cost and labor the primary scaling dimensions.
3. Low-tier recipes may use grass/steel/ganjium; advanced recipes introduce aluminum, batteries, plastic, seaweed and oil.
4. Uranium is a near-universal strategic input and therefore a systemic bottleneck.
5. Armor tiers do not follow one smooth formula. They are manually balanced recipes.
6. Upgrade modules consume a mixed basket rather than the same recipe as complete equipment.
7. Different islands can produce the same output with different input baskets, creating geographic arbitrage.

## Production constraints from the source system

The recipe table must be read together with the GanjaWiki work/property rules:

- production is blocked without required inputs;
- no salary is paid if the production cycle lacks inputs;
- output-full and input-capacity states block further employment/production;
- storage is sized from approximately 10–12 hours of production demand, depending on the historical/current rule;
- object production ticks are separate from worker commitment time;
- object damage, balance, hostile control and monopoly can block work;
- owner-defined wages and resource prices influence profitability;
- profile switching has cost/downtime and preserves old inventory.

## Kooperativ seed subset recommendation

Do not import all 364 recipes into Stage 2. Use a representative Stage 3 subset that exercises every chain type:

1. scrap/steel primary extraction;
2. chemical or plastic intermediate processing;
3. TT pistol final recipe;
4. RGD-5 consumable recipe;
5. boots and class-1 armor;
6. one high-tier armor recipe;
7. range module;
8. armor-upgrade kit;
9. repair kit;
10. a geographically alternative recipe for the same output.

The exact GanjaWars values should be stored as research/reference data. Kooperativ recipes need normalized values derived through its own economy simulator.

## Proposed additive schema

```text
ProductionRecipe
  id, code, name, outputResourceCode, outputAmount,
  cycleMinutes, laborRequired, powerRequired,
  professionCode, professionLevel, locationProfile, isActive

ProductionRecipeInput
  recipeId, resourceCode, amount

ProductionCycle
  objectId, recipeId, status, startedAt, completesAt,
  laborAccumulated, failureReason

ProductionObjectInventory
  objectId, resourceCode, amount, reservedAmount, capacity
```

The full CSV catalog is the authoritative answer to “what are the exact GanjaWars recipes”; this document explains how to interpret and safely adapt it.
