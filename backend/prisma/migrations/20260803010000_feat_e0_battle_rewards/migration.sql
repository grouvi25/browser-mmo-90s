ALTER TABLE "characters"
ADD COLUMN "battle_loadout_json" JSONB;

ALTER TABLE "battle_participants"
ADD COLUMN "exp_gained" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "money_gained" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "battles"
ADD COLUMN "winner_participant_id" TEXT;

CREATE UNIQUE INDEX "battles_winner_participant_id_key"
ON "battles"("winner_participant_id");

ALTER TABLE "battles"
ADD CONSTRAINT "battles_winner_participant_id_fkey"
FOREIGN KEY ("winner_participant_id")
REFERENCES "battle_participants"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
