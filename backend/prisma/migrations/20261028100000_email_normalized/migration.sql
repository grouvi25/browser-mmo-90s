-- Почта без псевдонимов (просьба 28.10): одна настоящая почта — один аккаунт.
-- Правило то же, что в backend/src/modules/auth/email-policy.ts:
-- «+метка» срезается у всех, у Gmail убираются точки, домены Яндекса
-- сводятся к yandex.ru, а «-» в имени Яндекса равен «.». На 28.10 на
-- проде 4262 аккаунта и ни одного совпадения после нормализации.
ALTER TABLE "users" ADD COLUMN "email_normalized" TEXT;

UPDATE "users" u SET "email_normalized" = n.ne
FROM (
  SELECT id,
    CASE
      WHEN d IN ('gmail.com', 'googlemail.com') THEN replace(l, '.', '') || '@gmail.com'
      WHEN d IN ('yandex.ru', 'yandex.com', 'ya.ru', 'yandex.by', 'yandex.kz', 'yandex.ua', 'narod.ru') THEN replace(l, '-', '.') || '@yandex.ru'
      ELSE l || '@' || d
    END AS ne
  FROM (
    SELECT id,
      split_part(split_part(lower(trim(email)), '@', 1), '+', 1) AS l,
      split_part(lower(trim(email)), '@', 2) AS d
    FROM "users"
  ) p
) n
WHERE u.id = n.id;

CREATE UNIQUE INDEX "users_email_normalized_key" ON "users"("email_normalized");
