-- Рейтинг разработчиков.
CREATE TABLE "dev_score_events" (
    "id" SERIAL NOT NULL,
    "who" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT,
    "item_id" INTEGER,
    "by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dev_score_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "dev_score_events_who_idx" ON "dev_score_events"("who");
CREATE INDEX "dev_score_events_item_id_idx" ON "dev_score_events"("item_id");
