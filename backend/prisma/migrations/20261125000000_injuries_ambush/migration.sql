-- Травмы v8, этап 2: засада, критическое, кома, реанимация, общак и авторитет.
ALTER TABLE "characters"
  ADD COLUMN "injury_critical_at" TIMESTAMP(3),
  ADD COLUMN "injury_aid_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "injury_aid_at" TIMESTAMP(3),
  ADD COLUMN "injury_clinic_used" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pocket_binoculars" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "clan_members"
  ADD COLUMN "authority" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "treasury_debt" INTEGER NOT NULL DEFAULT 0;

ALTER TYPE "CurrencyLogReason" ADD VALUE 'REANIMATION';
ALTER TYPE "CurrencyLogReason" ADD VALUE 'UNDERGROUND_SHOP';
