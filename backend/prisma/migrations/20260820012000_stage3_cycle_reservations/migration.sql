CREATE TABLE "cycle_input_reservations" (
  "id" TEXT NOT NULL,
  "cycle_id" TEXT NOT NULL,
  "inventory_id" TEXT NOT NULL,
  "resource_code" TEXT NOT NULL,
  "quality" "ResourceQuality" NOT NULL,
  "amount" INTEGER NOT NULL,
  CONSTRAINT "cycle_input_reservations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cycle_input_reservations_cycle_id_inventory_id_key" ON "cycle_input_reservations"("cycle_id", "inventory_id");
CREATE INDEX "cycle_input_reservations_cycle_id_idx" ON "cycle_input_reservations"("cycle_id");
ALTER TABLE "cycle_input_reservations" ADD CONSTRAINT "cycle_input_reservations_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "production_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cycle_input_reservations" ADD CONSTRAINT "cycle_input_reservations_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "production_object_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
