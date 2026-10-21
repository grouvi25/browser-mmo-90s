-- AlterTable
ALTER TABLE "player_homes" ADD COLUMN     "lot" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "player_homes_lot_key" ON "player_homes"("lot");

