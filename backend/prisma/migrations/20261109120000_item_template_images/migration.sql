-- Картинки шаблонов вещей, загружаемые из админки.
CREATE TABLE "item_template_images" (
    "code" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "item_template_images_pkey" PRIMARY KEY ("code")
);
