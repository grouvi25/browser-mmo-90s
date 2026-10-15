-- Значения перечисления отдельной миграцией: новое значение нельзя
-- использовать в той же транзакции, где оно добавлено.
ALTER TYPE "AdminActionKind" ADD VALUE 'GRANT_DOLLARS';
ALTER TYPE "AdminActionKind" ADD VALUE 'TAKE_DOLLARS';
ALTER TYPE "AdminActionKind" ADD VALUE 'SET_DEALER';
ALTER TYPE "AdminActionKind" ADD VALUE 'UNSET_DEALER';
