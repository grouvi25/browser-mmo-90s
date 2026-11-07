-- Покупка «2-го уровня» профессии за доллары даёт только продажу за доллары (Дима 08.11).
ALTER TABLE "character_professions" ADD COLUMN "usd_sales" BOOLEAN NOT NULL DEFAULT false;

-- Кто уже покупал, сохраняет право: покупка записана в журнал долларов с id профессии.
UPDATE "character_professions" p SET "usd_sales" = true
WHERE EXISTS (SELECT 1 FROM "dollar_logs" d WHERE d."ref_id" = p."id" AND d."note" LIKE '2-й уровень:%');
