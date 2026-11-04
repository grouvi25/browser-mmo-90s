-- Аптечки лечат долей максимального здоровья (заказчик 4.11: «10-25-50-100%»).
ALTER TABLE "item_templates" ADD COLUMN IF NOT EXISTS "heal_percent" INTEGER NOT NULL DEFAULT 0;
