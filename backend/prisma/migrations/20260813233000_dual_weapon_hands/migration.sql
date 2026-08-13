-- Persist which hand produced each strike for replay, logs and balancing.
CREATE TYPE "AttackHand" AS ENUM ('LEFT_HAND', 'RIGHT_HAND');
ALTER TABLE "battle_turns" ADD COLUMN "source_hand" "AttackHand";

-- Canonicalize legacy equipped weapons into the left-hand slot.
UPDATE "item_instances" AS i
SET "armor_slot" = 'LEFT_HAND'
FROM "item_templates" AS t
WHERE i."template_id" = t."id"
  AND t."type" = 'WEAPON'
  AND i."is_equipped" = true
  AND i."armor_slot" IS NULL;
