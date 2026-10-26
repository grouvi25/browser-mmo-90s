-- Обереги на вещи бывают в минус (правка заказчика 26.10, правило «Апехи»:
-- минус на вещи срезает тот же оберег у противника). Старая проверка из
-- 20260813132000_combat_wards запрещала отрицательные значения, и создание
-- вещи с минус-оберегом падало с ошибкой 500. Предел — ±200%, как в
-- проверке админки.
ALTER TABLE "item_templates" DROP CONSTRAINT IF EXISTS "item_templates_combat_wards_check";
ALTER TABLE "item_templates" ADD CONSTRAINT "item_templates_combat_wards_check" CHECK (
  COALESCE("anti_dodge", 0) BETWEEN -2 AND 2 AND
  COALESCE("anti_luck", 0) BETWEEN -2 AND 2 AND
  COALESCE("anti_crit", 0) BETWEEN -2 AND 2 AND
  COALESCE("anti_counter", 0) BETWEEN -2 AND 2
);
