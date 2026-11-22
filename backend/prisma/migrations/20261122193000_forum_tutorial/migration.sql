-- AlterEnum
ALTER TYPE "CurrencyLogReason" ADD VALUE 'TUTORIAL';

-- AlterEnum
ALTER TYPE "DollarReason" ADD VALUE 'TUTORIAL';

-- AlterTable
ALTER TABLE "characters" ADD COLUMN     "tutorial_step" INTEGER;

-- CreateTable
CREATE TABLE "forum_topics" (
    "id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "removed_by" TEXT,

    CONSTRAINT "forum_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_replies" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "removed_by" TEXT,

    CONSTRAINT "forum_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forum_topics_removed_at_activity_at_id_idx" ON "forum_topics"("removed_at", "activity_at", "id");

-- CreateIndex
CREATE INDEX "forum_replies_topic_id_removed_at_created_at_id_idx" ON "forum_replies"("topic_id", "removed_at", "created_at", "id");

-- AddForeignKey
ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_replies" ADD CONSTRAINT "forum_replies_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "forum_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_replies" ADD CONSTRAINT "forum_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
