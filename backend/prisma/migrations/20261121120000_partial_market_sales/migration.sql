ALTER TABLE "market_listings" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "market_sales" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "seller_character_id" TEXT NOT NULL,
    "buyer_character_id" TEXT NOT NULL,
    "type" "MarketListingType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" "MarketCurrency" NOT NULL,
    "base_price" INTEGER NOT NULL,
    "final_price" INTEGER NOT NULL,
    "relation" TEXT NOT NULL,
    "seller_gross" INTEGER NOT NULL,
    "seller_tax_rate" DOUBLE PRECISION NOT NULL,
    "tax" INTEGER NOT NULL,
    "payout" INTEGER NOT NULL,
    "eco_exp_rate" DOUBLE PRECISION NOT NULL,
    "market_clan_id" TEXT,
    "market_share_rate" DOUBLE PRECISION,
    "sold_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "market_sales_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "market_sales_listing_id_fkey" FOREIGN KEY ("listing_id")
      REFERENCES "market_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "market_sales_listing_id_idx" ON "market_sales"("listing_id");
CREATE INDEX "market_sales_seller_character_id_buyer_character_id_sold_at_idx"
    ON "market_sales"("seller_character_id", "buyer_character_id", "sold_at");
CREATE INDEX "market_sales_sold_at_idx" ON "market_sales"("sold_at");
