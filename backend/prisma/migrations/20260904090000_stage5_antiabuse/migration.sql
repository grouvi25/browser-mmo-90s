-- Антиабуз: сигналы и граф связей аккаунтов.
--
-- Сигнал ничего не делает сам — он показывается администратору, и решает
-- человек. Автоматический бан по эвристике на закрытом тесте с десятками
-- игроков поймает случайных, а не нарушителей.
--
-- Миграция аддитивная: три новых enum, две новых таблицы.

CREATE TYPE "AbuseSignalKind" AS ENUM (
  'MULTI_ACCOUNT', 'MATCH_FIXING', 'DUPLICATION', 'BOT_FARMING',
  'WEAK_FARMING', 'MONEY_FUNNEL', 'CLAN_STORAGE_DRAIN',
  'MARKET_MANIPULATION', 'AUTOCLICKER',
  'HELPER_DRAIN', 'OBJECT_TRANSFER_TRAP', 'WAR_COLLUSION',
  'CLAIM_REFUNDED', 'ROBBERY_STREAK'
);

CREATE TYPE "AbuseSignalStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED');

CREATE TYPE "AccountLinkKind" AS ENUM ('SHARED_IP', 'MARKET_TRADE', 'SAME_CLAN');

CREATE TABLE "abuse_signals" (
  "id"        TEXT NOT NULL,
  "kind"      "AbuseSignalKind" NOT NULL,
  "status"    "AbuseSignalStatus" NOT NULL DEFAULT 'OPEN',
  "severity"  INTEGER NOT NULL,
  "user_ids"  TEXT[] NOT NULL,
  -- Объяснение словами: сигнал, который нельзя проверить, бесполезен.
  "summary"   TEXT NOT NULL,
  -- Числа, на которых сработало правило: без них отклонённый сигнал
  -- невозможно перепроверить, когда правило изменится.
  "evidence"  JSONB NOT NULL,
  -- Один и тот же повод не должен плодить сигналы каждые сутки.
  "dedupe_key" TEXT NOT NULL,
  "reviewed_by_admin_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "abuse_signals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "abuse_signals_kind_dedupe_key_key"
  ON "abuse_signals"("kind", "dedupe_key");

CREATE INDEX "abuse_signals_status_severity_created_at_idx"
  ON "abuse_signals"("status", "severity", "created_at");

CREATE TABLE "account_links" (
  "id"           TEXT NOT NULL,
  -- Ребро неориентированное: в user_a_id всегда лексикографически меньший
  -- id, иначе одна пара завелась бы дважды.
  "user_a_id"    TEXT NOT NULL,
  "user_b_id"    TEXT NOT NULL,
  "kind"         "AccountLinkKind" NOT NULL,
  "weight"       DOUBLE PRECISION NOT NULL,
  "evidence"     JSONB NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "account_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_links_user_a_id_user_b_id_kind_key"
  ON "account_links"("user_a_id", "user_b_id", "kind");

CREATE INDEX "account_links_user_a_id_idx" ON "account_links"("user_a_id");
CREATE INDEX "account_links_user_b_id_idx" ON "account_links"("user_b_id");
