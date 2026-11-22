UPDATE "content_pages"
SET "body" = replace(
  "body",
  'Вступить в бригаду можно с 7-го: глава с 5-го уровня создаёт её заранее и приглашает бойцов, когда те дорастут.',
  'Вступить в бригаду по приглашению можно с 5-го боевого уровня.'
), "updated_at" = CURRENT_TIMESTAMP
WHERE "section" = 'LIBRARY' AND "title" = 'Бригады'
  AND position('Вступить в бригаду можно с 7-го: глава с 5-го уровня создаёт её заранее и приглашает бойцов, когда те дорастут.' in "body") > 0;

UPDATE "characters"
SET "avatar" = '/avatars/nobody.webp'
WHERE "nickname" = 'Nobody' AND "avatar" IS NULL;
