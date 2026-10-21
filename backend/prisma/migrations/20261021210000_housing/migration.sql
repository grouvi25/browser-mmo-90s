-- Жилой сектор: квартиры и дома игроков, налёты на дома (правка заказчика 21.10).
-- Только добавление.
-- CreateEnum
CREATE TYPE "HomeKind" AS ENUM ('APARTMENT', 'HOUSE');

-- CreateEnum
CREATE TYPE "HomeRaidStatus" AS ENUM ('PENDING', 'ATTACKER_WON', 'DEFENDER_WON', 'VOID');

-- CreateTable
CREATE TABLE "player_homes" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "kind" "HomeKind" NOT NULL,
    "durability" INTEGER NOT NULL DEFAULT 100,
    "tunnels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "purchased_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_homes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_raids" (
    "id" TEXT NOT NULL,
    "home_id" TEXT NOT NULL,
    "attacker_id" TEXT NOT NULL,
    "battle_id" TEXT,
    "status" "HomeRaidStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "home_raids_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "player_homes_character_id_key" ON "player_homes"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "home_raids_battle_id_key" ON "home_raids"("battle_id");

-- CreateIndex
CREATE INDEX "home_raids_home_id_created_at_idx" ON "home_raids"("home_id", "created_at");

-- CreateIndex
CREATE INDEX "home_raids_attacker_id_created_at_idx" ON "home_raids"("attacker_id", "created_at");

-- AddForeignKey
ALTER TABLE "player_homes" ADD CONSTRAINT "player_homes_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_raids" ADD CONSTRAINT "home_raids_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "player_homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

