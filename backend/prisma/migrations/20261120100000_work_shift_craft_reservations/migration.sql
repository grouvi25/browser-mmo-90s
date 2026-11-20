BEGIN;

ALTER TABLE "work_shifts" ADD COLUMN "craft_reserved_inputs" JSONB;

-- Зафиксировать состав открытых смен, пока релизный сид не обновил рецепты.
UPDATE "work_shifts" AS shift
SET "craft_reserved_inputs" = (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'resourceTemplateId', resource."id",
    'amount', input."amount" * shift."craft_quantity"
  ) ORDER BY input."resource_code"), '[]'::jsonb)
  FROM "production_recipe_inputs" AS input
  JOIN "resource_templates" AS resource ON resource."code" = input."resource_code"
  WHERE input."recipe_id" = shift."craft_recipe_id"
)
WHERE shift."status" IN ('ACTIVE', 'READY_TO_CLAIM')
  AND EXISTS (
    SELECT 1 FROM "production_recipes" AS recipe
    WHERE recipe."id" = shift."craft_recipe_id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "production_recipe_inputs" AS input
    LEFT JOIN "resource_templates" AS resource ON resource."code" = input."resource_code"
    WHERE input."recipe_id" = shift."craft_recipe_id"
      AND (resource."id" IS NULL OR input."amount" <= 0)
  );

COMMIT;
