-- Вид помощника: рабочий или боевой. Только добавление.
CREATE TYPE "HelperKind" AS ENUM ('WORK', 'COMBAT');
ALTER TABLE "helpers" ADD COLUMN "kind" "HelperKind" NOT NULL DEFAULT 'WORK';
