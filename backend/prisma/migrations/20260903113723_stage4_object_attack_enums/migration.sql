-- Значения enum отдельной миграцией: Postgres не даёт использовать
-- добавленное значение в той же транзакции, где оно создано. Таблица
-- боёв за объекты едет следующей миграцией.
ALTER TYPE "ProductionLogEvent" ADD VALUE IF NOT EXISTS 'SABOTAGED';
ALTER TYPE "ProductionLogEvent" ADD VALUE IF NOT EXISTS 'ROBBED';
ALTER TYPE "ProductionLogEvent" ADD VALUE IF NOT EXISTS 'TRANSFERRED_TO_CLAN';
