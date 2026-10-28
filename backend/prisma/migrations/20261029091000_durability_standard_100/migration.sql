-- Правка заказчика 28.10: «прочность из доп характеристик убрать вообще,
-- на всех вещах стандартно 100». Очки, вложенные в прочность, возвращаются
-- владельцу свободными; у снаряжения (кроме кулаков) прочность 100, текущая
-- пересчитывается в той же доле от максимума. Расходники и инструменты
-- (прочность 1) не трогаем.

UPDATE "item_instances"
SET "free_points" = "free_points" + ("stat_allocation"->>'DURABILITY')::int,
    "stat_allocation" = "stat_allocation" - 'DURABILITY'
WHERE jsonb_typeof("stat_allocation"::jsonb) = 'object'
  AND COALESCE(("stat_allocation"->>'DURABILITY')::int, 0) > 0;

UPDATE "item_instances" i
SET "durability_current" = LEAST(100, GREATEST(0, ROUND(i."durability_current" * 100.0 / NULLIF(i."durability_max", 0))::int)),
    "durability_max" = 100
FROM "item_templates" t
WHERE t."id" = i."template_id"
  AND t."type" IN ('WEAPON', 'ARMOR', 'SHIELD', 'ACCESSORY')
  AND t."code" <> 'weapon_fists'
  AND i."durability_max" <> 100;

UPDATE "item_templates"
SET "durability_max" = 100
WHERE "type" IN ('WEAPON', 'ARMOR', 'SHIELD', 'ACCESSORY')
  AND "code" <> 'weapon_fists'
  AND "durability_max" <> 100;

-- Именная куртка: база брони как у стёганой, иначе очки «Броня» ничего не дают.
UPDATE "item_templates" SET "armor" = 10 WHERE "code" = 'tsum_named_jacket' AND COALESCE("armor", 0) = 0;
