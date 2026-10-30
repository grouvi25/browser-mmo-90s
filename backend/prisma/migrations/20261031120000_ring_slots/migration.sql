-- Кольца (заказчик 31.10): своё место на теле, носить можно два.
ALTER TYPE "ArmorSlot" ADD VALUE IF NOT EXISTS 'RING';
ALTER TYPE "ArmorSlot" ADD VALUE IF NOT EXISTS 'RING_2';
