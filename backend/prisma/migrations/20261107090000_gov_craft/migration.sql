-- Госкрафт: смена в некупленном цехе делает рецепт из сырья игрока.
ALTER TABLE "work_shifts" ADD COLUMN "craft_recipe_id" TEXT;
ALTER TYPE "ItemLogAction" ADD VALUE 'CREATED_BY_CRAFT';
