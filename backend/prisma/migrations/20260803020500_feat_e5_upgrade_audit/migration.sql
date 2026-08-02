-- AlterTable
ALTER TABLE "upgrade_logs" ADD COLUMN     "resources_spent_json" JSONB,
ADD COLUMN     "result_code" TEXT NOT NULL;
