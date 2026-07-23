-- AddColumn Battle: levelMin, levelMax
ALTER TABLE "battles" ADD COLUMN "level_min" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "battles" ADD COLUMN "level_max" INTEGER NOT NULL DEFAULT 99;

-- AddColumn Character: battlesTotal, battlesWon, location, isInvisible, lastBattleFinishedAt
ALTER TABLE "characters" ADD COLUMN "battles_total" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "characters" ADD COLUMN "battles_won"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "characters" ADD COLUMN "location"      TEXT;
ALTER TABLE "characters" ADD COLUMN "is_invisible"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "characters" ADD COLUMN "last_battle_finished_at" TIMESTAMP(3);

-- Extend ItemSourceType enum
ALTER TYPE "ItemSourceType" ADD VALUE IF NOT EXISTS 'WORKSHOP';
ALTER TYPE "ItemSourceType" ADD VALUE IF NOT EXISTS 'DONATE';
