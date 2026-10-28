-- Правки заказчика 28.10: объекты продаются только за доллары (цена в
-- economy.production.objectPriceUsd), купленные раньше за рубли остаются у владельцев с рублёвым
-- выкупом; реферальная система с ручным выводом на карту.

-- CreateEnum
CREATE TYPE "ReferralPayoutStatus" AS ENUM ('PENDING', 'PAID', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DollarReason" ADD VALUE 'OBJECT_SALE';
ALTER TYPE "DollarReason" ADD VALUE 'REFERRAL';
ALTER TYPE "DollarReason" ADD VALUE 'REFERRAL_PAYOUT';

-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "referral_balance" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "production_objects" ADD COLUMN     "paid_usd" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "referrer_character_id" TEXT;

-- CreateTable
CREATE TABLE "referral_payouts" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "details" TEXT NOT NULL,
    "status" "ReferralPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "admin_note" TEXT,
    "processed_by" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "referral_payouts_status_created_at_idx" ON "referral_payouts"("status", "created_at");

-- CreateIndex
CREATE INDEX "referral_payouts_character_id_created_at_idx" ON "referral_payouts"("character_id", "created_at");

-- CreateIndex
CREATE INDEX "users_referrer_character_id_idx" ON "users"("referrer_character_id");

