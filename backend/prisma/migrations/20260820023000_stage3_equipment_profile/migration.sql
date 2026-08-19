ALTER TYPE "CurrencyLogReason" ADD VALUE IF NOT EXISTS 'OBJECT_PROFILE_SWITCH';
ALTER TYPE "CurrencyLogReason" ADD VALUE IF NOT EXISTS 'OBJECT_REPAIR';
ALTER TYPE "ProductionLogEvent" ADD VALUE IF NOT EXISTS 'OBJECT_PROFILE_SWITCHED';
ALTER TYPE "ProductionLogEvent" ADD VALUE IF NOT EXISTS 'OBJECT_REPAIRED';
ALTER TABLE "production_objects" ADD COLUMN "pending_recipe_id" TEXT, ADD COLUMN "profile_switch_ends_at" TIMESTAMP(3);
CREATE INDEX "production_objects_profile_switch_ends_at_idx" ON "production_objects"("profile_switch_ends_at");
