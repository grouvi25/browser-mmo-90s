-- Эквайринг: покупка долларов за рубли (Т-Банк).
ALTER TYPE "DollarReason" ADD VALUE 'TOPUP';
CREATE TYPE "PaymentStatus" AS ENUM ('NEW', 'PENDING', 'CONFIRMED', 'REJECTED', 'CANCELED', 'REFUNDED');
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'tbank',
    "dollars" INTEGER NOT NULL,
    "amount_kopecks" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'NEW',
    "provider_payment_id" TEXT,
    "provider_status" TEXT,
    "payment_url" TEXT,
    "error_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payments_character_id_created_at_idx" ON "payments"("character_id", "created_at");
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");
