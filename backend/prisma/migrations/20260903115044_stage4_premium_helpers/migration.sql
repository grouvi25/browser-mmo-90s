-- CreateEnum
CREATE TYPE "PremiumProductKind" AS ENUM ('TIME', 'COSMETIC', 'CONVENIENCE');

-- CreateEnum
CREATE TYPE "HelperStatus" AS ENUM ('ACTIVE', 'DORMANT');

-- AlterTable
ALTER TABLE "work_shifts" ADD COLUMN     "helper_id" TEXT;

-- CreateTable
CREATE TABLE "premium_products" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "PremiumProductKind" NOT NULL,
    "price_rub" INTEGER NOT NULL,
    "grant_code" TEXT NOT NULL,
    "grant_value" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "premium_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "premium_purchases" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "price_rub" INTEGER NOT NULL,
    "granted_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "premium_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "helpers" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "HelperStatus" NOT NULL DEFAULT 'ACTIVE',
    "profession_code" TEXT NOT NULL,
    "profession_level" INTEGER NOT NULL DEFAULT 0,
    "profession_exp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active_shift_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "helpers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "premium_products_code_key" ON "premium_products"("code");

-- CreateIndex
CREATE INDEX "premium_purchases_character_id_created_at_idx" ON "premium_purchases"("character_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "helpers_active_shift_id_key" ON "helpers"("active_shift_id");

-- CreateIndex
CREATE INDEX "helpers_character_id_idx" ON "helpers"("character_id");

-- AddForeignKey
ALTER TABLE "premium_purchases" ADD CONSTRAINT "premium_purchases_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "premium_purchases" ADD CONSTRAINT "premium_purchases_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "premium_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpers" ADD CONSTRAINT "helpers_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "helpers" ADD CONSTRAINT "helpers_active_shift_id_fkey" FOREIGN KEY ("active_shift_id") REFERENCES "work_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

