-- Крафт (Дима 17.11): вещь из крафта даёт 40 очков на раскладку, каждое улучшение +20.
-- Очки от улучшений лежат на самой вещи, вид улучшения в журнале — POINTS.
ALTER TYPE "UpgradeType" ADD VALUE 'POINTS';
ALTER TABLE "item_instances" ADD COLUMN "extra_points" INTEGER NOT NULL DEFAULT 0;
