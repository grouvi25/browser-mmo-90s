-- Доска разработчиков.
CREATE TABLE "dev_board_items" (
    "id" SERIAL NOT NULL,
    "ticket_number" INTEGER,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "taken_by" TEXT,
    "done_by" TEXT,
    "created_by" TEXT,
    "message_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dev_board_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dev_board_items_ticket_number_key" ON "dev_board_items"("ticket_number");
