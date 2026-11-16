-- №125 (Дима 15.11): армейские бронежилет и берцы убраны из игры и из админки.
-- Шаблоны остаются в базе (на них ссылаются журналы вещей), но выключены; в лавке Коммерсанта их больше нет.
UPDATE "item_templates" SET "is_active" = false WHERE "code" IN ('armor_army_vest_private', 'armor_boots_army_private');
UPDATE "private_shop_items" SET "is_active" = false WHERE "item_template_id" IN (SELECT "id" FROM "item_templates" WHERE "code" IN ('armor_army_vest_private', 'armor_boots_army_private'));
