-- Заметки игроков в «Личном деле». Только добавление.
CREATE TABLE "player_notes" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "text" VARCHAR(4000) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "player_notes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "player_notes_author_id_target_id_key" ON "player_notes"("author_id", "target_id");
