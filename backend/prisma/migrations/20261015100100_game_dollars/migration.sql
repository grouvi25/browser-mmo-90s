-- Игровые доллары и дилеры. Только добавление: старый код новые столбцы
-- и таблицу не читает.
ALTER TABLE "characters" ADD COLUMN "dollars" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "characters" ADD COLUMN "is_dealer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "premium_products" ADD COLUMN "price_dollars" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "premium_purchases" ADD COLUMN "price_dollars" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "DollarReason" AS ENUM ('ISSUE', 'WITHDRAW', 'TRANSFER_OUT', 'TRANSFER_IN', 'PURCHASE');

CREATE TABLE "dollar_logs" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason" "DollarReason" NOT NULL,
    "counterparty_id" TEXT,
    "ref_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dollar_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dollar_logs_character_id_created_at_idx" ON "dollar_logs"("character_id", "created_at");
CREATE INDEX "dollar_logs_counterparty_id_created_at_idx" ON "dollar_logs"("counterparty_id", "created_at");

-- Баланс не уходит в минус ни при каком сбое кода.
ALTER TABLE "characters" ADD CONSTRAINT "characters_dollars_non_negative" CHECK ("dollars" >= 0);
