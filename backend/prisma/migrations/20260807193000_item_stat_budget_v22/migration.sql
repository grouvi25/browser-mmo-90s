DO $$ BEGIN
  CREATE TYPE "ItemAllocationMode" AS ENUM ('FIXED', 'MASTER', 'PLAYER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TYPE "ItemLogAction" ADD VALUE IF NOT EXISTS 'POINTS_ALLOCATED';
ALTER TABLE "item_templates" ADD COLUMN IF NOT EXISTS "stat_budget" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "item_templates" ADD COLUMN IF NOT EXISTS "stat_allocation" JSONB;
ALTER TABLE "item_templates" ADD COLUMN IF NOT EXISTS "allocation_mode" "ItemAllocationMode" NOT NULL DEFAULT 'FIXED';
ALTER TABLE "item_instances" ADD COLUMN IF NOT EXISTS "stat_allocation" JSONB;
ALTER TABLE "item_instances" ADD COLUMN IF NOT EXISTS "free_points" INTEGER NOT NULL DEFAULT 0;
UPDATE "item_templates" SET "allocation_mode"='PLAYER', "stat_budget"=CASE WHEN "item_tier">=2 THEN 5 ELSE 3 END
WHERE "source_type" IN ('PRIVATE','CRAFTED') AND "type" IN ('WEAPON','ARMOR','SHIELD');
UPDATE "item_instances" i SET "free_points"=t."stat_budget" FROM "item_templates" t
WHERE i."template_id"=t."id" AND t."allocation_mode"='PLAYER' AND i."stat_allocation" IS NULL AND i."free_points"=0;
