-- Жалобы игроков на реплики в чате.
CREATE TABLE "chat_reports" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "ticket_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "chat_reports_message_id_reporter_id_key" ON "chat_reports"("message_id", "reporter_id");
