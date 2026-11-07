-- Правка своей реплики в чате (обращение №57): исходный текст и время правки.
ALTER TABLE "chat_messages" ADD COLUMN "original_body" VARCHAR(400);
ALTER TABLE "chat_messages" ADD COLUMN "edited_at" TIMESTAMP(3);
