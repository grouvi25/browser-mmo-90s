-- Крафт партией: сколько штук делается за одну смену госкрафта.
ALTER TABLE "work_shifts" ADD COLUMN "craft_quantity" INTEGER NOT NULL DEFAULT 1;
