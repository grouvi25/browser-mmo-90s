ALTER TYPE "CurrencyLogReason" ADD VALUE IF NOT EXISTS 'FARM_BUILDING_PURCHASE';
CREATE TYPE "FarmBuildingType" AS ENUM ('BARREL', 'CANOPY', 'CELLAR', 'DOG');
CREATE TABLE "farm_buildings" ("id" TEXT NOT NULL, "plot_id" TEXT NOT NULL, "type" "FarmBuildingType" NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "farm_buildings_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "farm_buildings_plot_id_key" ON "farm_buildings"("plot_id");
CREATE INDEX "farm_buildings_type_idx" ON "farm_buildings"("type");
ALTER TABLE "farm_buildings" ADD CONSTRAINT "farm_buildings_plot_id_fkey" FOREIGN KEY ("plot_id") REFERENCES "farm_plots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
