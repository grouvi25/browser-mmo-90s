-- Смена ника администратором вместо удаления персонажа (Дима 26.11).
ALTER TYPE "AdminActionKind" ADD VALUE 'RENAME_CHARACTER';
