-- Новые виды админских действий.
--
-- Отдельной миграцией от таблицы переопределений намеренно: значения enum
-- в PostgreSQL добавляются вне транзакции, и смешивать их с созданием
-- таблиц значит получить миграцию, которая не откатывается целиком.
--
-- Действия парные, как и все остальные в журнале: у каждого есть чем его
-- отменить. Без обратной операции действие админу не выдаётся — правило
-- Этапа 5, и правка баланса из него не исключение.

ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'SET_BALANCE_PARAM';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'RESTORE_BALANCE_PARAM';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'SET_ITEM_TEMPLATE';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'RESTORE_ITEM_TEMPLATE';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'CREATE_ITEM_TEMPLATE';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'DELETE_ITEM_TEMPLATE';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'BAN_USER';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'UNBAN_USER';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'MUTE_USER';
ALTER TYPE "AdminActionKind" ADD VALUE IF NOT EXISTS 'UNMUTE_USER';
