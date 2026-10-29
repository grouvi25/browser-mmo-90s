-- Поддержка тикетами (правка 29.10): тема, категория, приоритет и переписка
-- в обе стороны. Старые обращения переносятся без потерь: текст игрока со
-- скриншотом — первым сообщением, ответ поддержки — вторым.

-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('BUG', 'PAYMENT', 'ITEMS', 'ACCOUNT', 'COMPLAINT', 'QUESTION', 'IDEA', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "SupportAuthor" AS ENUM ('PLAYER', 'STAFF', 'SYSTEM');

-- DropIndex
DROP INDEX "support_tickets_character_id_created_at_idx";

-- DropIndex
DROP INDEX "support_tickets_status_created_at_idx";

-- Новые поля; тема пока может быть пустой — заполнится из текста ниже.
ALTER TABLE "support_tickets"
ADD COLUMN     "assigned_to" TEXT,
ADD COLUMN     "category" "SupportCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "closed_at" TIMESTAMP(3),
ADD COLUMN     "closed_by" TEXT,
ADD COLUMN     "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "number" SERIAL NOT NULL,
ADD COLUMN     "player_unread" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priority" "SupportPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "staff_unread" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "subject" VARCHAR(120);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "author" "SupportAuthor" NOT NULL,
    "author_label" TEXT,
    "text" TEXT NOT NULL,
    "image_data" TEXT,
    "image_mime" TEXT,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- Перенос: вопрос игрока со скриншотом.
INSERT INTO "support_messages" ("id", "ticket_id", "author", "text", "image_data", "image_mime", "created_at")
SELECT gen_random_uuid()::text, "id", 'PLAYER', "text", "image_data", "image_mime", "created_at"
FROM "support_tickets";

-- Перенос: ответ поддержки, если был.
INSERT INTO "support_messages" ("id", "ticket_id", "author", "author_label", "text", "created_at")
SELECT gen_random_uuid()::text, "id", 'STAFF', "replied_by", "reply", COALESCE("replied_at", "updated_at")
FROM "support_tickets" WHERE "reply" IS NOT NULL;

-- Номера по порядку подачи, тема — начало текста, отметки прочтения по статусу.
UPDATE "support_tickets" t SET
  "number" = n.rn,
  "subject" = LEFT(REGEXP_REPLACE(t."text", '\s+', ' ', 'g'), 80),
  "last_message_at" = COALESCE(t."replied_at", t."created_at"),
  "staff_unread" = (t."status" = 'OPEN'),
  "closed_at" = CASE WHEN t."status" = 'CLOSED' THEN t."updated_at" END
FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS rn FROM "support_tickets") n
WHERE n."id" = t."id";
SELECT setval(pg_get_serial_sequence('support_tickets', 'number'), COALESCE((SELECT MAX("number") FROM "support_tickets"), 0) + 1, false);

ALTER TABLE "support_tickets" ALTER COLUMN "subject" SET NOT NULL;

-- Старые поля не удаляем (миграции только добавляют): данные уже в сообщениях,
-- а текст больше не обязателен — новые обращения его не заполняют.
ALTER TABLE "support_tickets" ALTER COLUMN "text" DROP NOT NULL;

-- CreateTable
CREATE TABLE "site_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "support_messages_ticket_id_created_at_idx" ON "support_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");

-- CreateIndex
CREATE INDEX "support_tickets_character_id_last_message_at_idx" ON "support_tickets"("character_id", "last_message_at");

-- CreateIndex
CREATE INDEX "support_tickets_status_last_message_at_idx" ON "support_tickets"("status", "last_message_at");

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Окно при входе в игру (просьба Дмитрия 29.10) — текст меняется в админке.
INSERT INTO "site_settings" ("key", "value", "updated_at", "updated_by") VALUES (
  'welcome',
  '{"enabled": true, "title": "Игра на стадии тестирования", "text": "Сейчас мы тестируем формулы и механики и наполняем игру вещами. Возможны правки баланса и мелкие ошибки.\n\nЛюбые вопросы — в Поддержку или Администрации в личные сообщения.", "version": 1}'::jsonb,
  CURRENT_TIMESTAMP, 'migration'
);
