-- Заказчик 05.11 (обращение №32): настойки действуют 20 минут вместо 10.
-- Меняем только нетронутые значения из таблицы экономики.
UPDATE "item_templates"
SET "use_effect" = jsonb_set("use_effect", '{minutes}', '20'::jsonb)
WHERE "code" IN ('tb_item_a02', 'tb_item_a04', 'tb_item_a06', 'tb_item_a07', 'tb_item_a10')
  AND "use_effect" IS NOT NULL
  AND "use_effect"->>'minutes' = '10';
