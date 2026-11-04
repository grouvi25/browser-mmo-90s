-- Заказчик 04.11: донатная собака теперь Малинуа, а Питбуль стал обычной.
-- Купленные собаки сохраняют свой вид: донатная остаётся донатной с теми же очками.
UPDATE "character_pets"
SET "name" = CASE
      WHEN "code" = 'pitbull' AND "name" = 'Питбуль' THEN 'Малинуа'
      WHEN "code" = 'malinois' AND "name" = 'Малинуа' THEN 'Питбуль'
      ELSE "name"
    END,
    "code" = CASE "code" WHEN 'pitbull' THEN 'malinois' ELSE 'pitbull' END
WHERE "code" IN ('pitbull', 'malinois');
