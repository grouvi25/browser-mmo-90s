-- AlterEnum
ALTER TYPE "HomeRaidStatus" ADD VALUE 'IN_BATTLE';

-- AlterTable
ALTER TABLE "home_raids" ADD COLUMN     "starts_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "player_homes" ADD COLUMN     "out_via" TEXT;

-- CreateTable
CREATE TABLE "home_raid_signups" (
    "id" TEXT NOT NULL,
    "raid_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "side" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "home_raid_signups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "home_raid_signups_raid_id_character_id_key" ON "home_raid_signups"("raid_id", "character_id");

-- CreateIndex
CREATE INDEX "home_raids_status_starts_at_idx" ON "home_raids"("status", "starts_at");

-- AddForeignKey
ALTER TABLE "home_raid_signups" ADD CONSTRAINT "home_raid_signups_raid_id_fkey" FOREIGN KEY ("raid_id") REFERENCES "home_raids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

