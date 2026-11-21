CREATE TABLE "support_message_images" (
    "message_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    CONSTRAINT "support_message_images_pkey" PRIMARY KEY ("message_id", "position"),
    CONSTRAINT "support_message_images_message_id_fkey" FOREIGN KEY ("message_id")
      REFERENCES "support_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
