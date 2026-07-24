-- CreateEnum
CREATE TYPE "BodyZone" AS ENUM ('HEAD', 'CHEST', 'LEGS', 'RIGHT_ARM', 'LEFT_ARM');

-- AlterTable
ALTER TABLE "battle_turns" ADD COLUMN     "block_pierced" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "zone" "BodyZone";

-- AlterTable
ALTER TABLE "item_templates" ADD COLUMN     "max_range" INTEGER DEFAULT 1,
ADD COLUMN     "optimal_range" INTEGER DEFAULT 1;
