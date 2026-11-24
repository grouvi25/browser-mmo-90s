-- Травмы после честных боёв на Стрелках (документ Димы v8, этап 1).
CREATE TYPE "InjuryTier" AS ENUM ('LIGHT', 'MEDIUM', 'HEAVY', 'CRITICAL', 'COMA');

ALTER TABLE "characters"
  ADD COLUMN "injury_tier" "InjuryTier",
  ADD COLUMN "injury_until" TIMESTAMP(3),
  ADD COLUMN "injury_treated_at" TIMESTAMP(3);

ALTER TYPE "CurrencyLogReason" ADD VALUE 'HOSPITAL';
ALTER TYPE "DollarReason" ADD VALUE 'CLINIC';
