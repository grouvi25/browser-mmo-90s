-- Рынок: валюта лота, профессия «Торгаш» и номер магазина. Только добавление.
CREATE TYPE "MarketCurrency" AS ENUM ('RUB', 'USD');
ALTER TABLE "market_listings" ADD COLUMN "currency" "MarketCurrency" NOT NULL DEFAULT 'RUB';
ALTER TYPE "DollarReason" ADD VALUE IF NOT EXISTS 'MARKET_SALE';
ALTER TYPE "DollarReason" ADD VALUE IF NOT EXISTS 'MARKET_TAX';
ALTER TABLE "characters" ADD COLUMN "trader_level" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "characters" ADD COLUMN "shop_number" INTEGER;
CREATE UNIQUE INDEX "characters_shop_number_key" ON "characters"("shop_number");
