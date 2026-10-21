-- Иконка бригады. Только добавление.
ALTER TABLE "clans" ADD COLUMN "icon_data" TEXT;
ALTER TABLE "clans" ADD COLUMN "icon_mime" TEXT;
ALTER TABLE "clans" ADD COLUMN "icon_version" INTEGER NOT NULL DEFAULT 0;
