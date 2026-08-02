-- CreateEnum
CREATE TYPE "ProductionObjectType" AS ENUM ('FACTORY', 'WORKSHOP', 'MARKET', 'WAREHOUSE', 'SCRAPYARD', 'SERVICE');

-- CreateEnum
CREATE TYPE "ProductionObjectStatus" AS ENUM ('ACTIVE', 'DISABLED', 'HIDDEN', 'DAMAGED');

-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('SYSTEM', 'PRIVATE', 'CLAN');

-- CreateEnum
CREATE TYPE "WorkShiftStatus" AS ENUM ('ACTIVE', 'READY_TO_CLAIM', 'CLAIMED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ResourceCategory" AS ENUM ('PRIMARY', 'SECONDARY', 'COMPONENT', 'REPAIR_PART', 'UPGRADE_PART', 'SERVICE_ITEM');

-- CreateEnum
CREATE TYPE "MarketListingType" AS ENUM ('ITEM', 'RESOURCE');

-- CreateEnum
CREATE TYPE "MarketListingStatus" AS ENUM ('ACTIVE', 'LOCKED', 'SOLD', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "UpgradeType" AS ENUM ('DAMAGE', 'ACCURACY', 'CRIT', 'ARMOR', 'DURABILITY', 'ANTI_CRIT');

-- CreateEnum
CREATE TYPE "StockMode" AS ENUM ('INFINITE', 'LIMITED');

-- CreateEnum
CREATE TYPE "ResourceLogReason" AS ENUM ('WORK_REWARD', 'GOVERNMENT_SELL', 'MARKET_LIST', 'MARKET_BUY', 'MARKET_SELL', 'REPAIR_USE', 'UPGRADE_USE', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ProductionLogEvent" AS ENUM ('SHIFT_STARTED', 'SHIFT_READY', 'SHIFT_CLAIMED', 'SHIFT_CANCELLED', 'SHIFT_FAILED');

-- CreateEnum
CREATE TYPE "UpgradeLogResult" AS ENUM ('SUCCESS', 'FAILURE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CurrencyLogReason" ADD VALUE 'MARKET_BUY';
ALTER TYPE "CurrencyLogReason" ADD VALUE 'MARKET_LISTING_TAX';
ALTER TYPE "CurrencyLogReason" ADD VALUE 'MARKET_SELL_TAX';
ALTER TYPE "CurrencyLogReason" ADD VALUE 'PRIVATE_SHOP_BUY';
ALTER TYPE "CurrencyLogReason" ADD VALUE 'RESOURCE_SELL';
ALTER TYPE "CurrencyLogReason" ADD VALUE 'UPGRADE_COST';
ALTER TYPE "CurrencyLogReason" ADD VALUE 'ADMIN_ECONOMY_ADJUSTMENT';

-- CreateTable
CREATE TABLE "production_objects" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ProductionObjectType" NOT NULL,
    "status" "ProductionObjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "owner_type" "OwnerType" NOT NULL DEFAULT 'SYSTEM',
    "owner_character_id" TEXT,
    "owner_clan_id" TEXT,
    "location_id" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "worker_slots" INTEGER NOT NULL DEFAULT 10,
    "shift_duration_minutes" INTEGER NOT NULL,
    "base_salary" INTEGER NOT NULL,
    "base_production_exp" INTEGER NOT NULL,
    "required_production_level" INTEGER NOT NULL DEFAULT 0,
    "produces_resource_code" TEXT,
    "output_amount_min" INTEGER NOT NULL DEFAULT 0,
    "output_amount_max" INTEGER NOT NULL DEFAULT 0,
    "economic_exp_reward" INTEGER NOT NULL DEFAULT 0,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "durability_current" INTEGER NOT NULL DEFAULT 100,
    "durability_max" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_shifts" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "production_object_id" TEXT NOT NULL,
    "status" "WorkShiftStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "claimed_at" TIMESTAMP(3),
    "base_salary" INTEGER NOT NULL,
    "final_salary" INTEGER,
    "production_exp_reward" INTEGER,
    "resource_reward_code" TEXT,
    "resource_reward_amount" INTEGER,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_templates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "ResourceCategory" NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "base_price" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_tradable" BOOLEAN NOT NULL DEFAULT true,
    "is_repair_material" BOOLEAN NOT NULL DEFAULT false,
    "is_upgrade_material" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_stacks" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "resource_template_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "reserved_amount" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_stacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "private_shop_items" (
    "id" TEXT NOT NULL,
    "shop_code" TEXT NOT NULL,
    "item_template_id" TEXT,
    "resource_template_id" TEXT,
    "price" INTEGER NOT NULL,
    "stock_mode" "StockMode" NOT NULL DEFAULT 'INFINITE',
    "stock_amount" INTEGER,
    "min_battle_level" INTEGER NOT NULL DEFAULT 0,
    "min_economic_level" INTEGER NOT NULL DEFAULT 0,
    "min_production_level" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "private_shop_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_listings" (
    "id" TEXT NOT NULL,
    "seller_character_id" TEXT NOT NULL,
    "buyer_character_id" TEXT,
    "type" "MarketListingType" NOT NULL,
    "status" "MarketListingStatus" NOT NULL DEFAULT 'ACTIVE',
    "item_instance_id" TEXT,
    "resource_template_id" TEXT,
    "resource_amount" INTEGER,
    "price" INTEGER NOT NULL,
    "listing_fee" INTEGER NOT NULL,
    "sale_tax" INTEGER,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "sold_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upgrade_logs" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "item_instance_id" TEXT NOT NULL,
    "upgrade_type" "UpgradeType" NOT NULL,
    "level_before" INTEGER NOT NULL,
    "level_after" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL,
    "success_chance" DOUBLE PRECISION NOT NULL,
    "result" "UpgradeLogResult" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upgrade_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_logs" (
    "id" TEXT NOT NULL,
    "character_id" TEXT,
    "production_object_id" TEXT NOT NULL,
    "event_type" "ProductionLogEvent" NOT NULL,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_logs" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "resource_template_id" TEXT NOT NULL,
    "amount_delta" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason_code" "ResourceLogReason" NOT NULL,
    "refType" TEXT,
    "ref_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resource_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "response_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_objects_code_key" ON "production_objects"("code");

-- CreateIndex
CREATE INDEX "work_shifts_character_id_status_idx" ON "work_shifts"("character_id", "status");

-- CreateIndex
CREATE INDEX "work_shifts_status_ends_at_idx" ON "work_shifts"("status", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "resource_templates_code_key" ON "resource_templates"("code");

-- CreateIndex
CREATE INDEX "resource_stacks_character_id_idx" ON "resource_stacks"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "resource_stacks_character_id_resource_template_id_key" ON "resource_stacks"("character_id", "resource_template_id");

-- CreateIndex
CREATE INDEX "private_shop_items_shop_code_is_active_idx" ON "private_shop_items"("shop_code", "is_active");

-- CreateIndex
CREATE INDEX "market_listings_status_expires_at_idx" ON "market_listings"("status", "expires_at");

-- CreateIndex
CREATE INDEX "market_listings_seller_character_id_status_idx" ON "market_listings"("seller_character_id", "status");

-- CreateIndex
CREATE INDEX "upgrade_logs_character_id_created_at_idx" ON "upgrade_logs"("character_id", "created_at");

-- CreateIndex
CREATE INDEX "production_logs_production_object_id_created_at_idx" ON "production_logs"("production_object_id", "created_at");

-- CreateIndex
CREATE INDEX "resource_logs_character_id_created_at_idx" ON "resource_logs"("character_id", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_character_id_scope_key_key" ON "idempotency_keys"("character_id", "scope", "key");

-- AddForeignKey
ALTER TABLE "work_shifts" ADD CONSTRAINT "work_shifts_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_shifts" ADD CONSTRAINT "work_shifts_production_object_id_fkey" FOREIGN KEY ("production_object_id") REFERENCES "production_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_stacks" ADD CONSTRAINT "resource_stacks_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_stacks" ADD CONSTRAINT "resource_stacks_resource_template_id_fkey" FOREIGN KEY ("resource_template_id") REFERENCES "resource_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_logs" ADD CONSTRAINT "production_logs_production_object_id_fkey" FOREIGN KEY ("production_object_id") REFERENCES "production_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
