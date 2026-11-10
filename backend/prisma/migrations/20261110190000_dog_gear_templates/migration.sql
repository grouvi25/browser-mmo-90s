-- Шмот для собак из админки: очки распределяет игрок, именной продаётся в ЦУМе.
CREATE TABLE "dog_gear_templates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "price_dollars" INTEGER NOT NULL DEFAULT 0,
    "stat_budget" INTEGER NOT NULL DEFAULT 20,
    "named" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dog_gear_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dog_gear_templates_code_key" ON "dog_gear_templates"("code");
ALTER TYPE "AdminActionKind" ADD VALUE 'SET_DOG_GEAR';
ALTER TYPE "AdminActionKind" ADD VALUE 'RESTORE_DOG_GEAR';
