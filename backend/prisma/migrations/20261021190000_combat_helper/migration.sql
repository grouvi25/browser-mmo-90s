-- Боевой помощник (правка заказчика 21.10): тактика, уровень и опыт помощника,
-- ходы помощника в журнале боя. Только добавление.
-- CreateEnum
CREATE TYPE "HelperTactic" AS ENUM ('STANDARD', 'DEFENSIVE', 'ATTACK');

-- AlterTable
ALTER TABLE "battle_turns" ADD COLUMN     "actor_helper_id" TEXT,
ADD COLUMN     "target_helper_id" TEXT;

-- AlterTable
ALTER TABLE "helpers" ADD COLUMN     "combat_exp" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "combat_level" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "tactic" "HelperTactic" NOT NULL DEFAULT 'STANDARD';

