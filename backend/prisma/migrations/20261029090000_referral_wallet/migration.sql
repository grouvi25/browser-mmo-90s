-- Заказчик 28.10: реферальные копятся на отдельном счёте, отсюда игрок
-- зачисляет их на персонажа или выводит на карту.

-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "referral_earned" INTEGER NOT NULL DEFAULT 0;

