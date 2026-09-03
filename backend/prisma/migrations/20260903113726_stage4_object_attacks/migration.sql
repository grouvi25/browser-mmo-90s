-- CreateEnum
CREATE TYPE "ObjectAttackType" AS ENUM ('SABOTAGE', 'ROBBERY');

-- CreateTable
CREATE TABLE "object_attacks" (
    "id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "attacker_clan_id" TEXT NOT NULL,
    "defender_clan_id" TEXT,
    "filed_by_character_id" TEXT NOT NULL,
    "type" "ObjectAttackType" NOT NULL,
    "durability_lost" INTEGER NOT NULL DEFAULT 0,
    "money_taken" INTEGER NOT NULL DEFAULT 0,
    "cancelled_cycle_id" TEXT,
    "authority_spent" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "object_attacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "object_attacks_object_id_created_at_idx" ON "object_attacks"("object_id", "created_at");

-- CreateIndex
CREATE INDEX "object_attacks_attacker_clan_id_created_at_idx" ON "object_attacks"("attacker_clan_id", "created_at");

-- AddForeignKey
ALTER TABLE "object_attacks" ADD CONSTRAINT "object_attacks_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "production_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_attacks" ADD CONSTRAINT "object_attacks_attacker_clan_id_fkey" FOREIGN KEY ("attacker_clan_id") REFERENCES "clans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_attacks" ADD CONSTRAINT "object_attacks_defender_clan_id_fkey" FOREIGN KEY ("defender_clan_id") REFERENCES "clans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

