-- Городские объявления — вторая половина «Радио».
--
-- То, что говорит сам город, а не игроки. Три источника в одной
-- таблице, потому что читают их одной лентой подряд: изменения в игре,
-- слово администрации и события мира. Разводить по трём таблицам
-- незачем — поля и запрос совпадают, различается только кто пишет.
--
-- Автор необязателен: у события мира его нет, такие строки пишет игра.
-- Снятие мягкое — объявление уходит из ленты, но остаётся в истории.
--
-- Миграция аддитивная: один enum, одна таблица.

CREATE TYPE "AnnouncementKind" AS ENUM ('PATCH', 'NEWS', 'WORLD');

CREATE TABLE "announcements" (
  "id"           TEXT NOT NULL,
  "kind"         "AnnouncementKind" NOT NULL,
  "title"        VARCHAR(120) NOT NULL,
  "body"         VARCHAR(2000) NOT NULL,
  "pinned"       BOOLEAN NOT NULL DEFAULT false,
  "author_login" TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at"   TIMESTAMP(3),

  CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- Лента всегда читается одинаково: живые, закреплённые сверху, дальше
-- по времени. Индекс лежит ровно под этот порядок.
CREATE INDEX "announcements_removed_at_pinned_created_at_idx"
  ON "announcements" ("removed_at", "pinned", "created_at");
