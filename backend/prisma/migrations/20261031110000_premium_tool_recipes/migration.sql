-- Рецепты только для премиального инструмента (заказчик 30.10).
ALTER TABLE "production_recipes" ADD COLUMN "required_tool_code" TEXT;
