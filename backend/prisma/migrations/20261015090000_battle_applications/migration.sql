-- Заявки на бой с таймером старта. Только добавление: старый код новые
-- столбцы не читает, откат приложения на прежний образ безопасен.
ALTER TABLE "battles" ADD COLUMN "starts_at" TIMESTAMP(3);
ALTER TABLE "battles" ADD COLUMN "team_size" INTEGER;
ALTER TABLE "battles" ADD COLUMN "is_chaotic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "battles" ADD COLUMN "creator_id" TEXT;

CREATE INDEX "battles_status_starts_at_idx" ON "battles"("status", "starts_at");
