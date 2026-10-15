-- Осады домов бригад. Только добавление: старый код новые столбцы и
-- таблицы не читает.
ALTER TABLE "characters" ADD COLUMN "trauma_until" TIMESTAMP(3);
ALTER TABLE "clans" ADD COLUMN "house_durability" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "clans" ADD COLUMN "house_razed_until" TIMESTAMP(3);

CREATE TYPE "HouseSiegeStatus" AS ENUM ('SCHEDULED', 'IN_BATTLE', 'ATTACKERS_WON', 'DEFENDERS_WON', 'CANCELLED');

CREATE TABLE "house_sieges" (
    "id" TEXT NOT NULL,
    "attacker_clan_id" TEXT NOT NULL,
    "defender_clan_id" TEXT NOT NULL,
    "filed_by_character_id" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "status" "HouseSiegeStatus" NOT NULL DEFAULT 'SCHEDULED',
    "battle_id" TEXT,
    "attackers_count" INTEGER NOT NULL DEFAULT 0,
    "defenders_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "house_sieges_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "house_sieges_battle_id_key" ON "house_sieges"("battle_id");
CREATE INDEX "house_sieges_status_starts_at_idx" ON "house_sieges"("status", "starts_at");
CREATE INDEX "house_sieges_defender_clan_id_status_idx" ON "house_sieges"("defender_clan_id", "status");
CREATE INDEX "house_sieges_attacker_clan_id_finished_at_idx" ON "house_sieges"("attacker_clan_id", "finished_at");

CREATE TABLE "house_siege_signups" (
    "id" TEXT NOT NULL,
    "siege_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "side" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "house_siege_signups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "house_siege_signups_siege_id_character_id_key" ON "house_siege_signups"("siege_id", "character_id");
ALTER TABLE "house_siege_signups" ADD CONSTRAINT "house_siege_signups_siege_id_fkey" FOREIGN KEY ("siege_id") REFERENCES "house_sieges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "house_wall_notes" (
    "id" TEXT NOT NULL,
    "clan_id" TEXT NOT NULL,
    "siege_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "house_wall_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "house_wall_notes_clan_id_created_at_idx" ON "house_wall_notes"("clan_id", "created_at");
CREATE INDEX "house_wall_notes_siege_id_character_id_idx" ON "house_wall_notes"("siege_id", "character_id");
