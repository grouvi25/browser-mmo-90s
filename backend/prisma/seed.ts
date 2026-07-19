// Seed database with initial data for Stage 1
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // --- Government shop item templates ---
  const weaponTemplates = [
    {
      code: 'weapon_fists', name: 'Кулаки', type: 'WEAPON' as const,
      weaponType: 'MELEE' as const,
      minDamage: 2, maxDamage: 5, weaponAccuracy: 0.85,
      weight: 0, durabilityMax: 999, qualityBase: 'COMMON' as const,
      priceBase: 0, levelReq: 0, isSellable: false, isActive: true,
      sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'weapon_knife_basic', name: 'Перочинный нож', type: 'WEAPON' as const,
      weaponType: 'KNIFE' as const,
      minDamage: 4, maxDamage: 9, weaponAccuracy: 0.80, critBonus: 0.03,
      weight: 0.5, durabilityMax: 80, qualityBase: 'COMMON' as const,
      priceBase: 200, levelReq: 0, sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'weapon_pipe_basic', name: 'Водопроводная труба', type: 'WEAPON' as const,
      weaponType: 'CLUB' as const,
      minDamage: 6, maxDamage: 13, weaponAccuracy: 0.70,
      weight: 2.0, durabilityMax: 120, qualityBase: 'COMMON' as const,
      priceBase: 350, levelReq: 0, strReq: 2, sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'weapon_pistol_pm', name: 'Пистолет ПМ', type: 'WEAPON' as const,
      weaponType: 'PISTOL' as const,
      minDamage: 8, maxDamage: 16, weaponAccuracy: 0.75,
      weight: 1.0, durabilityMax: 100, qualityBase: 'COMMON' as const,
      priceBase: 800, levelReq: 2, sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'weapon_shotgun_basic', name: 'Охотничье ружьё', type: 'WEAPON' as const,
      weaponType: 'SHOTGUN' as const,
      minDamage: 14, maxDamage: 28, weaponAccuracy: 0.60,
      weight: 3.5, durabilityMax: 90, qualityBase: 'COMMON' as const,
      priceBase: 1500, levelReq: 4, strReq: 3, sourceType: 'GOVERNMENT' as const,
    },
  ]

  const armorTemplates = [
    {
      code: 'armor_jacket_basic', name: 'Стёганая куртка', type: 'ARMOR' as const,
      armorSlot: 'CHEST' as const,
      armor: 3,
      weight: 1.5, durabilityMax: 100, qualityBase: 'COMMON' as const,
      priceBase: 300, levelReq: 0, sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'armor_cap_basic', name: 'Кепка', type: 'ARMOR' as const,
      armorSlot: 'HEAD' as const,
      armor: 1,
      weight: 0.2, durabilityMax: 70, qualityBase: 'COMMON' as const,
      priceBase: 100, levelReq: 0, sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'armor_jeans_basic', name: 'Джинсы', type: 'ARMOR' as const,
      armorSlot: 'LEGS' as const,
      armor: 2,
      weight: 0.8, durabilityMax: 90, qualityBase: 'COMMON' as const,
      priceBase: 200, levelReq: 0, sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'armor_boots_basic', name: 'Берцы', type: 'ARMOR' as const,
      armorSlot: 'FEET' as const,
      armor: 2, dodgeBonus: 0.01,
      weight: 1.0, durabilityMax: 90, qualityBase: 'COMMON' as const,
      priceBase: 250, levelReq: 0, sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'armor_vest_basic', name: 'Советский бронежилет', type: 'ARMOR' as const,
      armorSlot: 'CHEST' as const,
      armor: 8, antiCrit: 0.02,
      weight: 5.0, durabilityMax: 120, qualityBase: 'COMMON' as const,
      priceBase: 2000, levelReq: 3, strReq: 3, sourceType: 'GOVERNMENT' as const,
    },
  ]

  // Upsert templates
  for (const tpl of [...weaponTemplates, ...armorTemplates]) {
    const { code, ...data } = tpl
    await prisma.itemTemplate.upsert({
      where: { code },
      update: data,
      create: { code, ...data },
    })
    console.log(`  ✓ Template: ${tpl.name}`)
  }

  // Create government shop entries
  const allTemplates = await prisma.itemTemplate.findMany()
  for (const tpl of allTemplates) {
    if (tpl.priceBase > 0) {
      await prisma.governmentShopItem.upsert({
        where: { templateId: tpl.id },
        update: { isAvailable: true },
        create: { templateId: tpl.id, isAvailable: true },
      })
    }
  }
  console.log('  ✓ Government shop entries created')

  // --- Bots ---
  const bots = [
    {
      code: 'training_bandit',
      name: 'Тренировочный хулиган',
      battleLevel: 1,
      power: 5,
      hpMax: 60,
      stats: { str: 2, agi: 2, rea: 1, acc: 2, end: 2, luck: 1, agr: 1, armor: 1 },
      equipment: { weapon: { minDamage: 2, maxDamage: 5, accuracy: 0.65 } },
      expReward: 8,
      moneyRewardMin: 20,
      moneyRewardMax: 50,
    },
    {
      code: 'basic_gangster',
      name: 'Гопник',
      battleLevel: 2,
      power: 12,
      hpMax: 75,
      stats: { str: 3, agi: 3, rea: 2, acc: 3, end: 3, luck: 1, agr: 2, armor: 2 },
      equipment: { weapon: { minDamage: 4, maxDamage: 9, accuracy: 0.70 } },
      expReward: 20,
      moneyRewardMin: 50,
      moneyRewardMax: 120,
    },
    {
      code: 'armed_thug',
      name: 'Вооружённый бандит',
      battleLevel: 4,
      power: 25,
      hpMax: 90,
      stats: { str: 4, agi: 3, rea: 2, acc: 4, end: 4, luck: 1, agr: 2, armor: 3 },
      equipment: { weapon: { minDamage: 8, maxDamage: 16, accuracy: 0.72 } },
      expReward: 50,
      moneyRewardMin: 100,
      moneyRewardMax: 300,
    },
  ]

  for (const bot of bots) {
    await prisma.bot.upsert({
      where: { code: bot.code },
      update: bot,
      create: bot,
    })
    console.log(`  ✓ Bot: ${bot.name}`)
  }

  // --- Admin user ---
  const adminPw = await bcrypt.hash('admin_change_me_now', 10)
  await prisma.adminUser.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', passwordHash: adminPw, role: 'SUPER_ADMIN' },
  })
  console.log('  ✓ Admin user created (username: admin, change password!)')

  console.log('\n✅ Seed complete!')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
