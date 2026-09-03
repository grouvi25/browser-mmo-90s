-- Разбор сигнала антиабуза как административное действие.
--
-- Значения enum добавляются отдельной миграцией: PostgreSQL не разрешает
-- использовать новое значение в той же транзакции, где оно объявлено.
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'REVIEW_SIGNAL';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'REOPEN_SIGNAL';
