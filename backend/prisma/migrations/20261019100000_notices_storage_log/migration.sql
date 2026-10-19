-- Личные уведомления в чате и журнал склада бригады. Только добавление.
CREATE TABLE "game_notices" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "text" VARCHAR(300) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "game_notices_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "game_notices_character_id_created_at_idx" ON "game_notices"("character_id", "created_at");

CREATE TABLE "clan_storage_logs" (
    "id" TEXT NOT NULL,
    "clan_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "resource_code" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "clan_storage_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "clan_storage_logs_clan_id_created_at_idx" ON "clan_storage_logs"("clan_id", "created_at");
