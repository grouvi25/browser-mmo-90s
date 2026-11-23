BEGIN;

ALTER TABLE "forum_topics" ADD COLUMN "pinned_at" TIMESTAMP(3);

-- Keep the existing welcome thread and its replies.
UPDATE "forum_topics"
SET "pinned_at" = CURRENT_TIMESTAMP
WHERE "id" = '6a9211e8-f6be-497a-bdf0-db01603b1fd7' AND "removed_at" IS NULL;

DROP INDEX "forum_topics_removed_at_activity_at_id_idx";
CREATE INDEX "forum_topics_pinned_listing_idx"
  ON "forum_topics" ("removed_at", "pinned_at", "activity_at" DESC, "id" DESC);

COMMIT;
