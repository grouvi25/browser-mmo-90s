-- Витрины ЦУМа и Берёзки в базе (правка 30.10): вещи выставляются из админки.

-- CreateEnum
CREATE TYPE "DollarShop" AS ENUM ('TSUM', 'BEREZKA');

-- CreateTable
CREATE TABLE "shop_items_dollar" (
    "id" TEXT NOT NULL,
    "shop" "DollarShop" NOT NULL,
    "template_id" TEXT NOT NULL,
    "price_dollars" INTEGER NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_items_dollar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_items_dollar_shop_template_id_key" ON "shop_items_dollar"("shop", "template_id");

-- AddForeignKey
ALTER TABLE "shop_items_dollar" ADD CONSTRAINT "shop_items_dollar_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "item_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Прежние товары — те же, что были зашиты в код, по тем же ценам.
INSERT INTO "shop_items_dollar" ("id", "shop", "template_id", "price_dollars", "sort_order")
SELECT gen_random_uuid()::text, v.shop::"DollarShop", t."id", v.price, v.sort
FROM (VALUES ('TSUM', 'tsum_named_knife', 20, 1), ('TSUM', 'tsum_named_jacket', 25, 2), ('BEREZKA', 'berezka_experience_amulet', 30, 1)) AS v(shop, code, price, sort)
JOIN "item_templates" t ON t."code" = v.code
ON CONFLICT ("shop", "template_id") DO NOTHING;
