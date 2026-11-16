-- Аренда первого помощника: 2000 ₽ каждые 30 дней (Дима 15.11).
ALTER TYPE "CurrencyLogReason" ADD VALUE 'HELPER_RENT';
ALTER TABLE "helpers" ADD COLUMN "rent_paid_until" TIMESTAMP(3);
-- Уже нанятые помощники куплены за доллары: первый месяц аренды им даётся
-- без оплаты, первое списание через 30 дней после выката.
UPDATE "helpers" SET "rent_paid_until" = NOW() + INTERVAL '30 days';
