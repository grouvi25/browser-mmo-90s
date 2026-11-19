-- Дима 19.11: Пистолет ТТ и Обрез убраны из игры. Купить и собрать их больше нельзя.
-- Шаблоны остаются в базе (на них ссылаются журналы вещей), но выключены.
UPDATE "item_templates" SET "is_active" = false WHERE "code" IN ('weapon_tt_private', 'weapon_sawnoff_private');
UPDATE "private_shop_items" SET "is_active" = false WHERE "item_template_id" IN (SELECT "id" FROM "item_templates" WHERE "code" IN ('weapon_tt_private', 'weapon_sawnoff_private'));
UPDATE "production_recipes" SET "is_active" = false WHERE "code" = 'rcp_tt_pistol';
