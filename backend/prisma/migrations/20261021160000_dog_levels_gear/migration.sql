-- Собаки: уровни, опыт, очки донатной собаки и снаряжение. Только добавление.
ALTER TABLE "character_pets" ADD COLUMN "level" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "character_pets" ADD COLUMN "exp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "character_pets" ADD COLUMN "allocation" JSONB;
ALTER TABLE "character_pets" ADD COLUMN "gear" JSONB;
