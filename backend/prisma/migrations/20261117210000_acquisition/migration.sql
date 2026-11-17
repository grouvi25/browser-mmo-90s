-- Откуда пришёл игрок (Дима 17.11, перед стартом рекламы): метки первой ссылки и сайт-источник.
ALTER TABLE "users"
  ADD COLUMN "utm_source" TEXT,
  ADD COLUMN "utm_medium" TEXT,
  ADD COLUMN "utm_campaign" TEXT,
  ADD COLUMN "utm_content" TEXT,
  ADD COLUMN "utm_term" TEXT,
  ADD COLUMN "first_referrer" TEXT,
  ADD COLUMN "landing_path" TEXT;

-- Дни, когда игрок заходил в игру (по Москве): из них считается, кто вернулся.
CREATE TABLE "user_active_days" (
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    CONSTRAINT "user_active_days_pkey" PRIMARY KEY ("user_id", "day")
);
CREATE INDEX "user_active_days_day_idx" ON "user_active_days"("day");
ALTER TABLE "user_active_days" ADD CONSTRAINT "user_active_days_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Прошлые дни восстанавливаем по следам в игре: день регистрации, деньги, чат, бои.
INSERT INTO "user_active_days" ("user_id", "day")
SELECT "id", (("registered_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::date FROM "users"
ON CONFLICT DO NOTHING;
INSERT INTO "user_active_days" ("user_id", "day")
SELECT DISTINCT c."user_id", ((l."created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::date
FROM "currency_logs" l JOIN "characters" c ON c."id" = l."character_id"
ON CONFLICT DO NOTHING;
INSERT INTO "user_active_days" ("user_id", "day")
SELECT DISTINCT c."user_id", ((m."created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::date
FROM "chat_messages" m JOIN "characters" c ON c."id" = m."author_id"
ON CONFLICT DO NOTHING;
INSERT INTO "user_active_days" ("user_id", "day")
SELECT DISTINCT c."user_id", ((p."created_at" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::date
FROM "battle_participants" p JOIN "characters" c ON c."id" = p."character_id"
ON CONFLICT DO NOTHING;
