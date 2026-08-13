ALTER TYPE "ItemLogAction" ADD VALUE IF NOT EXISTS 'TOOL_USE';
ALTER TABLE "item_templates" ADD COLUMN "tool_tier" INTEGER, ADD COLUMN "uses_max" INTEGER;
ALTER TABLE "item_instances" ADD COLUMN "uses_left" INTEGER;
ALTER TABLE "item_templates" ADD CONSTRAINT "item_templates_tool_values_check" CHECK (
  ("tool_tier" IS NULL OR "tool_tier" > 0) AND
  ("uses_max" IS NULL OR "uses_max" > 0)
);
ALTER TABLE "item_instances" ADD CONSTRAINT "item_instances_uses_left_check" CHECK ("uses_left" IS NULL OR "uses_left" >= 0);
ALTER TABLE "work_shifts" ADD COLUMN "tool_instance_id" TEXT;

CREATE TABLE "production_equipment" (
  "id" TEXT NOT NULL,
  "production_object_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tier" INTEGER NOT NULL DEFAULT 1,
  "required_tool_tier" INTEGER NOT NULL DEFAULT 1,
  "produces_resource_code" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "owner_type" "OwnerType" NOT NULL DEFAULT 'SYSTEM',
  "owner_character_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "production_equipment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "production_equipment_tiers_check" CHECK ("tier" > 0 AND "required_tool_tier" > 0)
);
CREATE UNIQUE INDEX "production_equipment_production_object_id_key" ON "production_equipment"("production_object_id");
CREATE UNIQUE INDEX "production_equipment_code_key" ON "production_equipment"("code");
CREATE INDEX "work_shifts_tool_instance_id_idx" ON "work_shifts"("tool_instance_id");
ALTER TABLE "production_equipment" ADD CONSTRAINT "production_equipment_production_object_id_fkey" FOREIGN KEY ("production_object_id") REFERENCES "production_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_shifts" ADD CONSTRAINT "work_shifts_tool_instance_id_fkey" FOREIGN KEY ("tool_instance_id") REFERENCES "item_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
