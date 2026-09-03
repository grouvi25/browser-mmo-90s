-- CreateEnum
CREATE TYPE "TerritoryClaimStatus" AS ENUM ('PENDING', 'BATTLE', 'WON', 'LOST', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ClanAuthorityReason" AS ENUM ('TERRITORY_WON', 'TERRITORY_DEFENDED', 'TERRITORY_HELD', 'CYCLE_COMPLETED', 'SHIFT_COMPLETED', 'CLAIM_FILED', 'CLAIM_REFUNDED', 'SABOTAGE_FILED', 'ROBBERY_FILED', 'ADMIN_ADJUST');

-- AlterTable
ALTER TABLE "clans" ADD COLUMN     "authority" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "territory_limit" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "territory_claims" (
    "id" TEXT NOT NULL,
    "territory_id" TEXT NOT NULL,
    "attacker_clan_id" TEXT NOT NULL,
    "defender_clan_id" TEXT,
    "filed_by_character_id" TEXT NOT NULL,
    "status" "TerritoryClaimStatus" NOT NULL DEFAULT 'PENDING',
    "battle_starts_at" TIMESTAMP(3) NOT NULL,
    "battle_id" TEXT,
    "feePaid" INTEGER NOT NULL,
    "authority_spent" DOUBLE PRECISION NOT NULL,
    "walkover" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "territory_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "territory_claim_rosters" (
    "id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "side" INTEGER NOT NULL,
    "battle_level" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "territory_claim_rosters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clan_authority_logs" (
    "id" TEXT NOT NULL,
    "clan_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" "ClanAuthorityReason" NOT NULL,
    "ref_id" TEXT,
    "balance_after" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clan_authority_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "territory_claims_battle_id_key" ON "territory_claims"("battle_id");

-- CreateIndex
CREATE INDEX "territory_claims_territory_id_status_idx" ON "territory_claims"("territory_id", "status");

-- CreateIndex
CREATE INDEX "territory_claims_attacker_clan_id_idx" ON "territory_claims"("attacker_clan_id");

-- CreateIndex
CREATE INDEX "territory_claims_status_battle_starts_at_idx" ON "territory_claims"("status", "battle_starts_at");

-- CreateIndex
CREATE INDEX "territory_claim_rosters_claim_id_side_idx" ON "territory_claim_rosters"("claim_id", "side");

-- CreateIndex
CREATE UNIQUE INDEX "territory_claim_rosters_claim_id_character_id_key" ON "territory_claim_rosters"("claim_id", "character_id");

-- CreateIndex
CREATE INDEX "clan_authority_logs_clan_id_created_at_idx" ON "clan_authority_logs"("clan_id", "created_at");

-- AddForeignKey
ALTER TABLE "territory_claims" ADD CONSTRAINT "territory_claims_territory_id_fkey" FOREIGN KEY ("territory_id") REFERENCES "territories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_claims" ADD CONSTRAINT "territory_claims_attacker_clan_id_fkey" FOREIGN KEY ("attacker_clan_id") REFERENCES "clans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_claims" ADD CONSTRAINT "territory_claims_defender_clan_id_fkey" FOREIGN KEY ("defender_clan_id") REFERENCES "clans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_claims" ADD CONSTRAINT "territory_claims_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "battles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_claim_rosters" ADD CONSTRAINT "territory_claim_rosters_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "territory_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_claim_rosters" ADD CONSTRAINT "territory_claim_rosters_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clan_authority_logs" ADD CONSTRAINT "clan_authority_logs_clan_id_fkey" FOREIGN KEY ("clan_id") REFERENCES "clans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

