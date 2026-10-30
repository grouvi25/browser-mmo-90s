-- Именные вещи (правка 31.10): обереги и мастерства, уровни, своя картинка.
ALTER TABLE "item_templates" ADD COLUMN "extra_bonuses" JSONB;

ALTER TABLE "item_instances" ADD COLUMN "bonuses" JSONB;
ALTER TABLE "item_instances" ADD COLUMN "named_level" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "item_instances" ADD COLUMN "icon_version" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "item_icons" (
    "item_id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_icons_pkey" PRIMARY KEY ("item_id")
);

ALTER TABLE "item_icons" ADD CONSTRAINT "item_icons_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
