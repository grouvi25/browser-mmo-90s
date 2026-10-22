-- Обещания игрокам из чата 22.10: свитки перераспределения, обменник
-- Чёрного рынка, модераторы в Поддержке, комплекты одежды.
ALTER TYPE "AdminActionKind" ADD VALUE 'SET_MODERATOR';
ALTER TYPE "AdminActionKind" ADD VALUE 'UNSET_MODERATOR';
ALTER TYPE "CurrencyLogReason" ADD VALUE 'STAT_RESPEC_PURCHASE';
ALTER TYPE "CurrencyLogReason" ADD VALUE 'CURRENCY_EXCHANGE';
ALTER TYPE "DollarReason" ADD VALUE 'EXCHANGE';

ALTER TABLE "character_stats" ADD COLUMN "respec_scrolls" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "characters" ADD COLUMN "is_moderator" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "outfit_presets" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "items" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "outfit_presets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "outfit_presets_character_id_slot_key" ON "outfit_presets"("character_id", "slot");
