-- Журнал административных действий с обратной операцией.
--
-- Главная сущность Этапа 5. Сегодня админ действует безвозвратно: выдал
-- миллион — миллион в экономике навсегда, и отменить это можно только
-- запросом в базу. Каждая строка журнала знает не только что сделано, но и
-- как это отменить.
--
-- Миграция аддитивная: новый enum, новая таблица, ничего существующего не
-- трогает.

CREATE TYPE "AdminActionKind" AS ENUM (
  'GRANT_MONEY', 'TAKE_MONEY',
  'GRANT_ITEM', 'DELETE_ITEM',
  'LOCK_LISTING', 'UNLOCK_LISTING',
  'DEACTIVATE_SHOP_ITEM', 'ACTIVATE_SHOP_ITEM',
  'GRANT_PREMIUM', 'REVOKE_PREMIUM', 'RESTORE_PREMIUM',
  'ADJUST_AUTHORITY',
  'RESET_TERRITORY', 'RESTORE_TERRITORY',
  'EXPIRE_CLAIM', 'RESTORE_CLAIM',
  'CLEAR_ATTACK_COOLDOWN', 'RESTORE_ATTACK_COOLDOWN',
  'SLEEP_HELPER', 'WAKE_HELPER',
  'ROLLBACK'
);

CREATE TABLE "admin_action_logs" (
  "id"             TEXT NOT NULL,
  "admin_id"       TEXT NOT NULL,
  -- Роль на момент действия: роль аккаунта может измениться позже, история
  -- обязана остаться правдивой.
  "admin_role"     "AdminRole" NOT NULL,
  "kind"           "AdminActionKind" NOT NULL,
  "reason"         TEXT NOT NULL,
  "target_type"    TEXT NOT NULL,
  "target_id"      TEXT NOT NULL,
  "payload"        JSONB NOT NULL,
  -- Обратная операция обязательна: действие без неё не заводится.
  "undo_kind"      "AdminActionKind" NOT NULL,
  "undo_payload"   JSONB NOT NULL,
  "rolled_back_id" TEXT,
  "rolled_back_at" TIMESTAMP(3),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_action_logs_pkey" PRIMARY KEY ("id")
);

-- Одно действие нельзя откатить дважды: двойной откат выдачи денег
-- превратился бы в списание.
CREATE UNIQUE INDEX "admin_action_logs_rolled_back_id_key"
  ON "admin_action_logs"("rolled_back_id");

CREATE INDEX "admin_action_logs_admin_id_created_at_idx"
  ON "admin_action_logs"("admin_id", "created_at");

-- По этому индексу строится цепочка транзакций: все админские действия над
-- предметом, персонажем или бригадой.
CREATE INDEX "admin_action_logs_target_type_target_id_idx"
  ON "admin_action_logs"("target_type", "target_id");
