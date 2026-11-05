-- Отрезвители вместо противоядий (заказчик 4.11, «как вы предложили»): снимают опьянение.
ALTER TABLE "item_templates" ADD COLUMN IF NOT EXISTS "sober_amount" INTEGER NOT NULL DEFAULT 0;
