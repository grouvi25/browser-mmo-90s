-- AlterTable
ALTER TABLE "item_templates" ADD COLUMN     "private_shop_allowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "repair_resource_code" TEXT,
ADD COLUMN     "upgrade_allowed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "private_shop_items_shop_code_item_template_id_key" ON "private_shop_items"("shop_code", "item_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "private_shop_items_shop_code_resource_template_id_key" ON "private_shop_items"("shop_code", "resource_template_id");
