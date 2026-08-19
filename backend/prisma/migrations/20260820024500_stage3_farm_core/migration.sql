ALTER TYPE "CurrencyLogReason" ADD VALUE IF NOT EXISTS 'FARM_PLOT_PURCHASE';
ALTER TYPE "CurrencyLogReason" ADD VALUE IF NOT EXISTS 'FARM_SEED_PURCHASE';
ALTER TYPE "ResourceLogReason" ADD VALUE IF NOT EXISTS 'FARM_HARVEST';
CREATE TABLE "farm_plots" ("id" TEXT NOT NULL, "character_id" TEXT NOT NULL, "slot" INTEGER NOT NULL, "crop_code" TEXT, "planted_at" TIMESTAMP(3), "ready_at" TIMESTAMP(3), "withers_at" TIMESTAMP(3), "water_count" INTEGER NOT NULL DEFAULT 0, "last_watered_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "farm_plots_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "farm_plots_character_id_slot_key" ON "farm_plots"("character_id", "slot");
CREATE INDEX "farm_plots_character_id_idx" ON "farm_plots"("character_id");
CREATE INDEX "farm_plots_ready_at_idx" ON "farm_plots"("ready_at");
ALTER TABLE "farm_plots" ADD CONSTRAINT "farm_plots_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
