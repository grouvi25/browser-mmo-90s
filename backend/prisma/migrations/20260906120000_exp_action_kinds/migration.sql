-- Выдача и списание опыта из панели.
--
-- Отдельной миграцией: ALTER TYPE ... ADD VALUE применяется вне
-- транзакции, и в общей миграции откат перестал бы быть атомарным.
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'GRANT_EXP';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'TAKE_EXP';
