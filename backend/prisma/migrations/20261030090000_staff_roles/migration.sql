-- Личные входы в админку и роли сотрудников (правка 30.10): вместо общего
-- «admin» — игровые аккаунты с ролью, код из письма вторым шагом, журнал.

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'ADMIN', 'GAMEDESIGNER', 'MODERATOR', 'SUPPORT', 'FINANCE');

-- CreateTable
CREATE TABLE "staff_members" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "staff_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_login_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_login_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_trusted_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "label" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_members_user_id_key" ON "staff_members"("user_id");

-- CreateIndex
CREATE INDEX "staff_login_codes_user_id_created_at_idx" ON "staff_login_codes"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_trusted_devices_token_hash_key" ON "staff_trusted_devices"("token_hash");

-- CreateIndex
CREATE INDEX "staff_trusted_devices_user_id_idx" ON "staff_trusted_devices"("user_id");

-- CreateIndex
CREATE INDEX "staff_events_created_at_idx" ON "staff_events"("created_at");

-- AddForeignKey
ALTER TABLE "staff_members" ADD CONSTRAINT "staff_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Первые владельцы — по договорённости 29.10: grouvi и Admin (Дмитрий).
-- На базах без этих аккаунтов (тесты, стенд) ничего не добавится.
INSERT INTO "staff_members" ("id", "user_id", "role", "created_by", "updated_at")
SELECT gen_random_uuid()::text, u."id", 'OWNER', 'migration', CURRENT_TIMESTAMP
FROM "users" u WHERE u."login" IN ('grouvi', 'Admin')
ON CONFLICT ("user_id") DO NOTHING;
