-- Двор фермы (погреб, будка отдельно от участков) и рабочий фермы. Только добавление.
CREATE TABLE "farm_yard_buildings" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "type" "FarmBuildingType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "farm_yard_buildings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "farm_yard_buildings_character_id_type_key" ON "farm_yard_buildings"("character_id", "type");

ALTER TABLE "characters" ADD COLUMN "farm_worker_until" TIMESTAMP(3);
