-- Шкала опыта собаки = боевая таблица игрока +20% (Дима, обращение №56, 07.11).
-- Опыт собак сохраняется, по новой шкале пересчитывается только уровень.
-- Пороги — battleExp.levelThresholds × 1,2 (dogs.ts, DOG_EXP_FACTOR).
CREATE TEMP TABLE dog_recalc_1107 AS
SELECT p.id, p.character_id, p.code, p.level AS old_level,
       (SELECT COUNT(*)::int FROM unnest(ARRAY[0,1060,3150,7919,18578,41978,92616,200999,430993,915702,1931460,4050121,8451721,17565260,36379651]) AS t(v) WHERE p.exp >= t.v) AS new_level
FROM character_pets p
WHERE p.code IN ('mastiff', 'pitbull', 'doberman', 'malinois');

UPDATE character_pets p SET level = r.new_level FROM dog_recalc_1107 r WHERE p.id = r.id AND p.level <> r.new_level;

-- У малинуа очки распределяет игрок. Если после пересчёта распределено больше,
-- чем даёт новый уровень, распределение сбрасывается: игрок раскладывает заново.
CREATE TEMP TABLE dog_reset_1107 AS
SELECT p.id, p.character_id
FROM character_pets p JOIN dog_recalc_1107 r ON r.id = p.id
WHERE p.code = 'malinois' AND p.allocation IS NOT NULL
  AND (SELECT COALESCE(SUM((e.value)::int), 0) FROM jsonb_each_text(p.allocation) AS e) > CEIL((2 + (p.level - 1) / 2) * 1.5);

UPDATE character_pets p SET allocation = NULL FROM dog_reset_1107 d WHERE p.id = d.id;

INSERT INTO game_notices (id, character_id, text, created_at)
SELECT gen_random_uuid()::text, r.character_id,
       'Шкала опыта собак теперь как у бойца +20%. Опыт собаки сохранён, уровень пересчитан: был ' || r.old_level || ', стал ' || r.new_level || '.'
       || CASE WHEN EXISTS (SELECT 1 FROM dog_reset_1107 d WHERE d.id = r.id) THEN ' Очки собаки сброшены, распределите их заново в Зоомагазине.' ELSE '' END,
       NOW()
FROM dog_recalc_1107 r WHERE r.old_level <> r.new_level;

-- Временные таблицы исчезают сами по окончании сессии миграции.
