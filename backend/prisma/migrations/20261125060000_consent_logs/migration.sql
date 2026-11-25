-- Журнал согласий при регистрации (Дима 25.11): ID, время, IP, редакция документа, текст галочки.
CREATE TABLE "consent_logs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "document" TEXT NOT NULL,
  "edition" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "ip" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consent_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consent_logs_user_id_idx" ON "consent_logs"("user_id");

ALTER TABLE "consent_logs" ADD CONSTRAINT "consent_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
