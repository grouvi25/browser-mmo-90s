-- Личные сообщения в чате и пол персонажа. Только добавление.
ALTER TYPE "ChatChannel" ADD VALUE IF NOT EXISTS 'PRIVATE';

ALTER TABLE "chat_messages" ADD COLUMN "recipient_id" TEXT;
CREATE INDEX "chat_messages_recipient_id_created_at_idx" ON "chat_messages"("recipient_id", "created_at");

CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');
ALTER TABLE "characters" ADD COLUMN "gender" "Gender" NOT NULL DEFAULT 'MALE';
