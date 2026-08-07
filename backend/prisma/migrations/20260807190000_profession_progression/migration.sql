CREATE TABLE "character_professions" (
  "id" TEXT NOT NULL,
  "character_id" TEXT NOT NULL,
  "profession_code" TEXT NOT NULL,
  "level" INTEGER NOT NULL DEFAULT 0,
  "exp" INTEGER NOT NULL DEFAULT 0,
  "unlocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "character_professions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "character_professions_character_id_profession_code_key"
  ON "character_professions"("character_id", "profession_code");
CREATE INDEX "character_professions_character_id_idx" ON "character_professions"("character_id");
ALTER TABLE "character_professions" ADD CONSTRAINT "character_professions_character_id_fkey"
  FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "item_templates" ADD COLUMN "craft_profession_code" TEXT;

ALTER TABLE "production_objects"
  ADD COLUMN "required_profession_code" TEXT NOT NULL DEFAULT 'scrap_collector',
  ADD COLUMN "required_profession_level" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "work_shifts"
  ADD COLUMN "profession_code" TEXT NOT NULL DEFAULT 'scrap_collector',
  ADD COLUMN "profession_exp_reward" INTEGER;
ALTER TABLE "private_shop_items"
  ADD COLUMN "min_profession_code" TEXT,
  ADD COLUMN "min_profession_level" INTEGER NOT NULL DEFAULT 0;

UPDATE "production_objects" SET "required_profession_code" = CASE "code"
  WHEN 'obj_warehouse_station' THEN 'supplier'
  WHEN 'obj_scrapyard' THEN 'scrap_collector'
  WHEN 'obj_market_loader' THEN 'procurer'
  WHEN 'obj_garage_workshop' THEN 'foundry_worker'
  WHEN 'obj_small_factory' THEN 'carpenter'
  WHEN 'obj_parts_factory' THEN 'gunsmith'
  ELSE 'scrap_collector' END,
  "required_profession_level" = "required_production_level";
UPDATE "work_shifts" ws SET "profession_code" = po."required_profession_code"
  FROM "production_objects" po WHERE po."id" = ws."production_object_id";

-- Preserve existing players: copy their aggregate legacy progress into all nine professions.
INSERT INTO "character_professions" ("id", "character_id", "profession_code", "level", "exp", "unlocked_at", "updated_at")
SELECT gen_random_uuid(), c."id", p.code, LEAST(c."production_level", 6),
  CASE LEAST(c."production_level", 6)
    WHEN 0 THEN 0 WHEN 1 THEN 500 WHEN 2 THEN 1500 WHEN 3 THEN 3500
    WHEN 4 THEN 8000 WHEN 5 THEN 16000 ELSE 30000 END,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "characters" c
CROSS JOIN (VALUES
  ('scrap_collector'), ('foundry_worker'), ('gunsmith'),
  ('supplier'), ('carpenter'), ('cooperative_builder'),
  ('procurer'), ('pharmacist'), ('chemist')
) AS p(code)
ON CONFLICT ("character_id", "profession_code") DO NOTHING;


UPDATE "item_templates" SET "craft_profession_code" = CASE
  WHEN "type" = 'WEAPON' THEN 'gunsmith'
  WHEN "type" IN ('ARMOR', 'SHIELD') THEN 'cooperative_builder'
  WHEN "type" = 'CONSUMABLE' THEN 'pharmacist'
  ELSE NULL END
WHERE "craft_profession_code" IS NULL;
