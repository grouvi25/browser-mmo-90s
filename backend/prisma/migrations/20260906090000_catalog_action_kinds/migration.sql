-- Правка цен и окладов из справочника.
--
-- Значения enum добавляются отдельной миграцией: PostgreSQL применяет
-- ALTER TYPE ... ADD VALUE вне транзакции, и в общей миграции с другими
-- изменениями откат перестал бы быть атомарным.
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'SET_RESOURCE_TEMPLATE';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'RESTORE_RESOURCE_TEMPLATE';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'SET_SHOP_ITEM';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'RESTORE_SHOP_ITEM';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'SET_BAR_OFFER';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'RESTORE_BAR_OFFER';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'SET_PRODUCTION_OBJECT';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'RESTORE_PRODUCTION_OBJECT';
