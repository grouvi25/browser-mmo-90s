-- Разделы Библиотеки и Кодекса, которые администрация пишет в админке (Дима 19.11).
CREATE TYPE "ContentSection" AS ENUM ('LIBRARY', 'CODEX');

CREATE TABLE "content_pages" (
    "id" TEXT NOT NULL,
    "section" "ContentSection" NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "body" VARCHAR(20000) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "content_pages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_pages_section_sort_order_idx" ON "content_pages"("section", "sort_order");
