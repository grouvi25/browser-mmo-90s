-- CreateEnum
CREATE TYPE "TerritoryStatus" AS ENUM ('NEUTRAL', 'CONTROLLED', 'CONTESTED', 'UNDER_ATTACK', 'PROTECTED');

-- CreateTable
CREATE TABLE "territories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TerritoryStatus" NOT NULL DEFAULT 'NEUTRAL',
    "owner_clan_id" TEXT,
    "controlled_at" TIMESTAMP(3),
    "protected_until" TIMESTAMP(3),
    "bonus_code" TEXT NOT NULL,
    "bonus_value" DOUBLE PRECISION NOT NULL,
    "upkeep_tier" INTEGER NOT NULL DEFAULT 1,
    "upkeep_debt" INTEGER NOT NULL DEFAULT 0,
    "last_charged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "territories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "territories_code_key" ON "territories"("code");

-- CreateIndex
CREATE INDEX "territories_owner_clan_id_idx" ON "territories"("owner_clan_id");

-- CreateIndex
CREATE INDEX "territories_status_idx" ON "territories"("status");

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_owner_clan_id_fkey" FOREIGN KEY ("owner_clan_id") REFERENCES "clans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
-- Нормализация усечённого имени индекса, накопившаяся с Этапа 3.
-- Не разрушающая: индекс тот же, меняется только его имя. Prisma
-- предлагала бы её при каждой следующей миграции, пока не случится.
ALTER INDEX "production_object_inventory_production_object_id_resource_code_" RENAME TO "production_object_inventory_production_object_id_resource_c_key";
