ALTER TABLE "item_templates"
  ADD COLUMN "anti_dodge" DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN "anti_luck" DOUBLE PRECISION DEFAULT 0,
  ADD COLUMN "anti_counter" DOUBLE PRECISION DEFAULT 0;

ALTER TABLE "item_templates" ADD CONSTRAINT "item_templates_combat_wards_check" CHECK (
  COALESCE("anti_dodge", 0) >= 0 AND
  COALESCE("anti_luck", 0) >= 0 AND
  COALESCE("anti_counter", 0) >= 0
);
