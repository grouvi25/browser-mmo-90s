-- Черновики объявлений (пользователь 18.11): готовим текст по ходу работы, Дима публикует из админки.
-- Текст длиннее: сводное обновление за день не влезало в 2000 знаков и молча обрезалось.
ALTER TABLE "announcements"
  ADD COLUMN "is_draft" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "body" TYPE VARCHAR(4000);
