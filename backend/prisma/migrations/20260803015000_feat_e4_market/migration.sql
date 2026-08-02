-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ItemLogAction" ADD VALUE 'LISTED_ON_MARKET';
ALTER TYPE "ItemLogAction" ADD VALUE 'MARKET_LISTING_CANCELLED';
ALTER TYPE "ItemLogAction" ADD VALUE 'MARKET_SOLD';
ALTER TYPE "ItemLogAction" ADD VALUE 'MARKET_BOUGHT';
