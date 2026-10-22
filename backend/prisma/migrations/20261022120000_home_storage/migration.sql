-- Склад в квартире или доме (правка заказчика 22.10).
ALTER TYPE "ResourceLogReason" ADD VALUE 'HOME_STORAGE_DEPOSIT';
ALTER TYPE "ResourceLogReason" ADD VALUE 'HOME_STORAGE_WITHDRAW';

CREATE TABLE "home_storage" (
    "id" TEXT NOT NULL,
    "home_id" TEXT NOT NULL,
    "resource_code" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "home_storage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "home_storage_home_id_resource_code_key" ON "home_storage"("home_id", "resource_code");

ALTER TABLE "home_storage" ADD CONSTRAINT "home_storage_home_id_fkey" FOREIGN KEY ("home_id") REFERENCES "player_homes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
