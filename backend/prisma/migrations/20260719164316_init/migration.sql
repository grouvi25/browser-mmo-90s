-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BANNED', 'MUTED', 'PENDING_EMAIL');

-- CreateEnum
CREATE TYPE "CharacterStatus" AS ENUM ('ACTIVE', 'IN_BATTLE', 'WORKING', 'TRAVELLING', 'RECOVERING', 'BANNED', 'OFFLINE');

-- CreateEnum
CREATE TYPE "CharacterArchetype" AS ENUM ('ATHLETE', 'WORKER', 'SHUTTLE', 'VETERAN', 'STREET', 'MERCHANT', 'STUDENT', 'RESOLVER');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('WEAPON', 'ARMOR', 'ACCESSORY', 'CONSUMABLE', 'RESOURCE', 'COMPONENT', 'UPGRADE_MODULE', 'TOOL', 'SEED', 'CROP');

-- CreateEnum
CREATE TYPE "WeaponType" AS ENUM ('MELEE', 'KNIFE', 'CLUB', 'PISTOL', 'SHOTGUN', 'SMG', 'RIFLE', 'SNIPER', 'HEAVY', 'THROWN');

-- CreateEnum
CREATE TYPE "ArmorSlot" AS ENUM ('HEAD', 'CHEST', 'LEGS', 'FEET', 'HANDS', 'BELT', 'BACK', 'POCKET', 'ACCESSORY');

-- CreateEnum
CREATE TYPE "ItemQuality" AS ENUM ('JUNK', 'COMMON', 'GOOD', 'RARE', 'NAMED', 'UNIQUE');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('NORMAL', 'EQUIPPED', 'BROKEN', 'LOCKED', 'ON_MARKET', 'IN_STORAGE', 'IN_REPAIR', 'CONSUMED', 'DELETED');

-- CreateEnum
CREATE TYPE "ItemSourceType" AS ENUM ('GOVERNMENT', 'PRIVATE', 'PREMIUM', 'DROP', 'CRAFTED', 'ADMIN');

-- CreateEnum
CREATE TYPE "BattleType" AS ENUM ('PVE_BOT', 'PVP_DUEL', 'PVP_OPEN', 'CLAN', 'TERRITORY');

-- CreateEnum
CREATE TYPE "BattleStatus" AS ENUM ('CREATED', 'WAITING_PLAYERS', 'ACTIVE', 'FINISHED', 'CANCELLED', 'TECHNICAL_WIN');

-- CreateEnum
CREATE TYPE "BattleAction" AS ENUM ('ATTACK', 'BLOCK', 'USE_ITEM', 'CHANGE_WEAPON', 'SURRENDER');

-- CreateEnum
CREATE TYPE "CurrencyLogReason" AS ENUM ('SHOP_PURCHASE', 'SHOP_SELL', 'BATTLE_REWARD', 'REPAIR_COST', 'ADMIN_GRANT', 'ADMIN_DEDUCT', 'MARKET_SELL', 'MARKET_FEE', 'WORK_SALARY');

-- CreateEnum
CREATE TYPE "ItemLogAction" AS ENUM ('CREATED_FROM_SHOP', 'CREATED_FROM_DROP', 'CREATED_BY_ADMIN', 'EQUIPPED', 'UNEQUIPPED', 'SOLD_TO_SHOP', 'DURABILITY_CHANGED', 'REPAIRED', 'UPGRADED', 'GRANTED_BY_ADMIN', 'DELETED_BY_ADMIN', 'STATUS_CHANGED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'MODERATOR', 'SUPPORT');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "ban_reason" TEXT,
    "muted_until" TIMESTAMP(3),
    "last_ip" TEXT,
    "last_user_agent" TEXT,
    "last_login_at" TIMESTAMP(3),
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "archetype" "CharacterArchetype" NOT NULL,
    "avatar" TEXT,
    "battle_level" INTEGER NOT NULL DEFAULT 1,
    "battle_exp" INTEGER NOT NULL DEFAULT 0,
    "economic_level" INTEGER NOT NULL DEFAULT 0,
    "economic_exp" INTEGER NOT NULL DEFAULT 0,
    "production_level" INTEGER NOT NULL DEFAULT 0,
    "production_exp" INTEGER NOT NULL DEFAULT 0,
    "money" INTEGER NOT NULL DEFAULT 1250,
    "hp_current" INTEGER NOT NULL,
    "hp_max" INTEGER NOT NULL,
    "status" "CharacterStatus" NOT NULL DEFAULT 'ACTIVE',
    "clan_id" TEXT,
    "location_id" TEXT,
    "is_premium" BOOLEAN NOT NULL DEFAULT false,
    "premium_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "character_stats" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "str" INTEGER NOT NULL DEFAULT 3,
    "agi" INTEGER NOT NULL DEFAULT 3,
    "rea" INTEGER NOT NULL DEFAULT 2,
    "acc" INTEGER NOT NULL DEFAULT 3,
    "end" INTEGER NOT NULL DEFAULT 3,
    "luck" INTEGER NOT NULL DEFAULT 1,
    "agr" INTEGER NOT NULL DEFAULT 1,
    "auth" INTEGER NOT NULL DEFAULT 1,
    "points_available" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "character_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_templates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "ItemType" NOT NULL,
    "weapon_type" "WeaponType",
    "armor_slot" "ArmorSlot",
    "min_damage" INTEGER,
    "max_damage" INTEGER,
    "weapon_accuracy" DOUBLE PRECISION DEFAULT 0.7,
    "crit_bonus" DOUBLE PRECISION DEFAULT 0.0,
    "crit_damage_bonus" DOUBLE PRECISION DEFAULT 0.0,
    "block_pierce" DOUBLE PRECISION DEFAULT 0.0,
    "armor" INTEGER DEFAULT 0,
    "dodge_bonus" DOUBLE PRECISION DEFAULT 0.0,
    "anti_crit" DOUBLE PRECISION DEFAULT 0.0,
    "block_bonus" DOUBLE PRECISION DEFAULT 0.0,
    "hp_bonus" INTEGER DEFAULT 0,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "durability_max" INTEGER NOT NULL DEFAULT 100,
    "quality_base" "ItemQuality" NOT NULL DEFAULT 'COMMON',
    "price_base" INTEGER NOT NULL DEFAULT 100,
    "level_req" INTEGER NOT NULL DEFAULT 0,
    "skill_req" INTEGER NOT NULL DEFAULT 0,
    "str_req" INTEGER NOT NULL DEFAULT 0,
    "source_type" "ItemSourceType" NOT NULL DEFAULT 'GOVERNMENT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_sellable" BOOLEAN NOT NULL DEFAULT true,
    "is_equippable" BOOLEAN NOT NULL DEFAULT true,
    "is_tradeable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_instances" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "quality" "ItemQuality" NOT NULL DEFAULT 'COMMON',
    "durability_current" INTEGER NOT NULL,
    "durability_max" INTEGER NOT NULL,
    "upgrade_level" INTEGER NOT NULL DEFAULT 0,
    "status" "ItemStatus" NOT NULL DEFAULT 'NORMAL',
    "is_equipped" BOOLEAN NOT NULL DEFAULT false,
    "armor_slot" "ArmorSlot",
    "weight" DOUBLE PRECISION NOT NULL,
    "source_type" "ItemSourceType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_items_government" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "override_price" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "shop_items_government_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bots" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "battle_level" INTEGER NOT NULL DEFAULT 1,
    "power" INTEGER NOT NULL DEFAULT 10,
    "hp_max" INTEGER NOT NULL,
    "stats" JSONB NOT NULL,
    "equipment" JSONB NOT NULL,
    "exp_reward" INTEGER NOT NULL DEFAULT 10,
    "money_reward_min" INTEGER NOT NULL DEFAULT 0,
    "money_reward_max" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battles" (
    "id" TEXT NOT NULL,
    "type" "BattleType" NOT NULL,
    "status" "BattleStatus" NOT NULL DEFAULT 'CREATED',
    "winner_id" TEXT,
    "round_count" INTEGER NOT NULL DEFAULT 0,
    "max_rounds" INTEGER NOT NULL DEFAULT 30,
    "is_suspicious" BOOLEAN NOT NULL DEFAULT false,
    "suspicion_reason" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_participants" (
    "id" TEXT NOT NULL,
    "battle_id" TEXT NOT NULL,
    "character_id" TEXT,
    "bot_id" TEXT,
    "side" INTEGER NOT NULL DEFAULT 1,
    "hp_max" INTEGER NOT NULL,
    "hp_current" INTEGER NOT NULL,
    "is_alive" BOOLEAN NOT NULL DEFAULT true,
    "is_surrendered" BOOLEAN NOT NULL DEFAULT false,
    "damage_dealt" INTEGER NOT NULL DEFAULT 0,
    "damage_received" INTEGER NOT NULL DEFAULT 0,
    "hits_landed" INTEGER NOT NULL DEFAULT 0,
    "hits_taken" INTEGER NOT NULL DEFAULT 0,
    "crit_landed" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battle_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "battle_turns" (
    "id" TEXT NOT NULL,
    "battle_id" TEXT NOT NULL,
    "round_number" INTEGER NOT NULL,
    "actor_char_id" TEXT,
    "actor_bot_id" TEXT,
    "target_char_id" TEXT,
    "target_bot_id" TEXT,
    "action" "BattleAction" NOT NULL,
    "weapon_id" TEXT,
    "hit" BOOLEAN NOT NULL DEFAULT false,
    "dodge" BOOLEAN NOT NULL DEFAULT false,
    "block" BOOLEAN NOT NULL DEFAULT false,
    "crit" BOOLEAN NOT NULL DEFAULT false,
    "raw_damage" INTEGER NOT NULL DEFAULT 0,
    "final_damage" INTEGER NOT NULL DEFAULT 0,
    "target_hp_before" INTEGER NOT NULL DEFAULT 0,
    "target_hp_after" INTEGER NOT NULL DEFAULT 0,
    "weapon_dur_loss" INTEGER NOT NULL DEFAULT 0,
    "armor_dur_loss" INTEGER NOT NULL DEFAULT 0,
    "weapon_skill_exp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "log_line" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battle_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weapon_skills" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "weapon_type" "WeaponType" NOT NULL,
    "skill_level" INTEGER NOT NULL DEFAULT 1,
    "skill_exp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "anti_skill_level" INTEGER NOT NULL DEFAULT 0,
    "anti_skill_exp" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "premium_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weapon_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency_logs" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reason_code" "CurrencyLogReason" NOT NULL,
    "ref_id" TEXT,
    "ref_type" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_logs" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "action_code" "ItemLogAction" NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_logs" (
    "id" TEXT NOT NULL,
    "character_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "cost" INTEGER NOT NULL,
    "durability_before" INTEGER NOT NULL,
    "durability_after" INTEGER NOT NULL,
    "repaired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repair_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'SUPPORT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_login_key" ON "users"("login");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "characters_user_id_key" ON "characters"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "characters_nickname_key" ON "characters"("nickname");

-- CreateIndex
CREATE UNIQUE INDEX "character_stats_character_id_key" ON "character_stats"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_templates_code_key" ON "item_templates"("code");

-- CreateIndex
CREATE INDEX "item_instances_owner_id_idx" ON "item_instances"("owner_id");

-- CreateIndex
CREATE INDEX "item_instances_template_id_idx" ON "item_instances"("template_id");

-- CreateIndex
CREATE INDEX "item_instances_owner_id_status_idx" ON "item_instances"("owner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "shop_items_government_template_id_key" ON "shop_items_government"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "bots_code_key" ON "bots"("code");

-- CreateIndex
CREATE INDEX "battles_status_idx" ON "battles"("status");

-- CreateIndex
CREATE INDEX "battles_created_at_idx" ON "battles"("created_at");

-- CreateIndex
CREATE INDEX "battle_participants_battle_id_idx" ON "battle_participants"("battle_id");

-- CreateIndex
CREATE INDEX "battle_participants_character_id_idx" ON "battle_participants"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "battle_participants_battle_id_character_id_key" ON "battle_participants"("battle_id", "character_id");

-- CreateIndex
CREATE INDEX "battle_turns_battle_id_round_number_idx" ON "battle_turns"("battle_id", "round_number");

-- CreateIndex
CREATE INDEX "weapon_skills_character_id_idx" ON "weapon_skills"("character_id");

-- CreateIndex
CREATE UNIQUE INDEX "weapon_skills_character_id_weapon_type_key" ON "weapon_skills"("character_id", "weapon_type");

-- CreateIndex
CREATE INDEX "currency_logs_character_id_created_at_idx" ON "currency_logs"("character_id", "created_at");

-- CreateIndex
CREATE INDEX "item_logs_item_id_created_at_idx" ON "item_logs"("item_id", "created_at");

-- CreateIndex
CREATE INDEX "item_logs_character_id_created_at_idx" ON "item_logs"("character_id", "created_at");

-- CreateIndex
CREATE INDEX "repair_logs_character_id_idx" ON "repair_logs"("character_id");

-- CreateIndex
CREATE INDEX "repair_logs_item_id_idx" ON "repair_logs"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "character_stats" ADD CONSTRAINT "character_stats_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_instances" ADD CONSTRAINT "item_instances_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "item_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_instances" ADD CONSTRAINT "item_instances_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_items_government" ADD CONSTRAINT "shop_items_government_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "item_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_participants" ADD CONSTRAINT "battle_participants_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_turns" ADD CONSTRAINT "battle_turns_battle_id_fkey" FOREIGN KEY ("battle_id") REFERENCES "battles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "battle_turns" ADD CONSTRAINT "battle_turns_weapon_id_fkey" FOREIGN KEY ("weapon_id") REFERENCES "item_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weapon_skills" ADD CONSTRAINT "weapon_skills_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "currency_logs" ADD CONSTRAINT "currency_logs_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_logs" ADD CONSTRAINT "item_logs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_logs" ADD CONSTRAINT "item_logs_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_logs" ADD CONSTRAINT "repair_logs_character_id_fkey" FOREIGN KEY ("character_id") REFERENCES "characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repair_logs" ADD CONSTRAINT "repair_logs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

