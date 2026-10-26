-- Очки характеристик за уровень: было 1, стало 3 (документ заказчика:
-- «за каждый лвл дается +3 стата»). Уже прокачанным персонажам досыпаем
-- разницу за пройденные уровни — по 2 очка за каждый уровень выше первого,
-- в свободные очки: распределит сам игрок.
UPDATE character_stats cs
SET points_available = cs.points_available + (c.battle_level - 1) * 2
FROM characters c
WHERE c.id = cs.character_id AND c.battle_level > 1;
