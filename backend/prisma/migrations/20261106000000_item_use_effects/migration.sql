-- Настойки и свитки: что делает вещь и что действует на персонаже.
ALTER TABLE "item_templates" ADD COLUMN "use_effect" JSONB;
ALTER TABLE "characters" ADD COLUMN "active_effects" JSONB NOT NULL DEFAULT '[]';
