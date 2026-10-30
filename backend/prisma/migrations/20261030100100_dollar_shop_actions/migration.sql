-- Действия админки для витрин ЦУМа и Берёзки (правка 30.10): пара «сделать / откатить».
ALTER TYPE "AdminActionKind" ADD VALUE 'SET_DOLLAR_SHOP_ITEM';
ALTER TYPE "AdminActionKind" ADD VALUE 'RESTORE_DOLLAR_SHOP_ITEM';
