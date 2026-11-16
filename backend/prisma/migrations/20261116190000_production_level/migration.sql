-- №128: производственный уровень — своя шкала. Опыт = весь накопленный опыт профессий
-- (раньше здесь лежал максимум одной профессии). Уровень пересчитывает и награду выдаёт
-- grantProductionExp при следующем начислении или догоняющем скрипте.
UPDATE "characters" c SET "production_exp" = COALESCE((SELECT SUM(p."exp") FROM "character_professions" p WHERE p."character_id" = c."id"), 0), "production_level" = 0;
