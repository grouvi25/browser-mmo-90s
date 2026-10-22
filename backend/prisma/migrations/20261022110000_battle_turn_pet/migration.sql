-- Собака в бою: её удары пишутся в журнал своей строкой (правка 22.10).
ALTER TABLE "battle_turns" ADD COLUMN "actor_pet_id" TEXT;
