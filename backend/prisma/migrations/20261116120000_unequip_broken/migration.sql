-- №131: сломанная вещь больше не остаётся надетой. Снимаем то, что сломалось раньше.
UPDATE "item_instances" SET "is_equipped" = false, "armor_slot" = NULL WHERE "status" = 'BROKEN' AND "is_equipped" = true;
