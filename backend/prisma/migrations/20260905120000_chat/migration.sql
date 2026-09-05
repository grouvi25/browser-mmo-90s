-- Чат — «эфир» радио.
--
-- Одна таблица на три вида эфира: район, клан, общий. Комната внутри
-- канала лежит в scope — ключ района, идентификатор клана или пустая
-- строка для общего. Разводить это по трём таблицам незачем: правила
-- чтения и записи у них одинаковые, различается только проверка права
-- на вход, а она в сервисе.
--
-- Удаление мягкое: модератор прячет сообщение, но строка остаётся —
-- по пустому месту жалобу не разобрать.
--
-- Миграция аддитивная: один enum, одна таблица.

CREATE TYPE "ChatChannel" AS ENUM ('DISTRICT', 'CLAN', 'GLOBAL');

CREATE TABLE "chat_messages" (
  "id"         TEXT NOT NULL,
  "channel"    "ChatChannel" NOT NULL,
  "scope"      TEXT NOT NULL DEFAULT '',
  "author_id"  TEXT NOT NULL,
  "body"       VARCHAR(400) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  "deleted_by" TEXT,

  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- Лента канала всегда читается «последние N по времени» — индекс лежит
-- ровно под этот запрос.
CREATE INDEX "chat_messages_channel_scope_created_at_idx"
  ON "chat_messages" ("channel", "scope", "created_at");

-- Второй индекс под разбор жалоб: все сообщения одного игрока подряд.
CREATE INDEX "chat_messages_author_id_created_at_idx"
  ON "chat_messages" ("author_id", "created_at");

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "characters"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
