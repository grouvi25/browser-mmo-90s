BEGIN;
ALTER TABLE "characters" ADD COLUMN "last_location" TEXT NOT NULL DEFAULT '/', ADD COLUMN "jailed_until" TIMESTAMP(3), ADD COLUMN "jail_reason" TEXT;
ALTER TABLE "item_templates" ADD COLUMN "battle_exp_bonus" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TYPE "AdminActionKind" ADD VALUE 'JAIL_CHARACTER';
ALTER TYPE "AdminActionKind" ADD VALUE 'RELEASE_CHARACTER';
CREATE TABLE "character_pets" ("id" TEXT NOT NULL, "character_id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "food" INTEGER NOT NULL DEFAULT 0, "fed_until" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "character_pets_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "character_pets_character_id_code_key" ON "character_pets"("character_id", "code");
ALTER TABLE "character_pets" ADD CONSTRAINT "character_pets_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "clans" ALTER COLUMN "territory_limit" SET DEFAULT 1;
UPDATE "clans" SET "territory_limit" = 1;
-- Preserve existing ownership: stop rather than silently confiscating a second district.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM "territories" WHERE "owner_clan_id" IS NOT NULL GROUP BY "owner_clan_id" HAVING COUNT(*) > 1) THEN RAISE EXCEPTION 'A clan already owns multiple territories: resolve ownership before deploying the one-territory limit'; END IF; END $$;
CREATE UNIQUE INDEX "territories_one_per_clan" ON "territories"("owner_clan_id") WHERE "owner_clan_id" IS NOT NULL;

COMMIT;
