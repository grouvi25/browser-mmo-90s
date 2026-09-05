-- Переопределения коэффициентов баланса.
--
-- BalanceConfig лежит в коде и правится деплоем. Это верно для формул, но
-- не для чисел: чтобы подвинуть зарплату на 5%, приходилось собирать
-- релиз. Здесь хранится только РАЗНИЦА с кодом — путь и новое значение;
-- сам конфиг остаётся источником значений по умолчанию.
--
-- Поэтому таблица маленькая и пустая в норме: если переопределений нет,
-- игра работает ровно так, как написано в коде. Снять правку — удалить
-- строку, а не вспоминать, что там было: исходное значение всегда под
-- рукой в BalanceConfig.
--
-- value_json, а не число: под путём может лежать и доля, и таблица порогов.
--
-- Миграция аддитивная: одна таблица, ничего существующего не трогает.

CREATE TABLE "balance_overrides" (
  "path"          TEXT NOT NULL,
  "value_json"    JSONB NOT NULL,
  -- Что стояло в коде на момент правки. Нужно журналу и откату: код мог
  -- уехать деплоем, и «вернуть как было» должно означать конкретное число.
  "previous_json" JSONB NOT NULL,
  "reason"        TEXT NOT NULL,
  "admin_id"      TEXT NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "balance_overrides_pkey" PRIMARY KEY ("path")
);

CREATE INDEX "balance_overrides_updated_at_idx" ON "balance_overrides" ("updated_at" DESC);
