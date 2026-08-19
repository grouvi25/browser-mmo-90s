// Seed database with initial data for Stage 1
// NOTE: DATABASE_URL must be set via environment variable (no dotenv needed in CI/Docker)
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { RESOURCES, PRODUCTION_OBJECTS, PRODUCTION_RECIPES, OBJECT_PROFESSIONS, PRIVATE_SHOP_RESOURCES } from './economy-data'

const prisma = new PrismaClient()

// Must match BalanceConfig.economy.tools; kept inside prisma because the production image runs seed.ts without src/.
const STAGE2_TOOL_TIERS = { 1: { price: 500, uses: 50 }, 2: { price: 1250, uses: 50 }, 3: { price: 1800, uses: 50 } } as const

async function main() {
  console.log('🌱 Seeding database...')

  // --- Government shop item templates ---
  const weaponTemplates = [
    // Урон масштабирован под формулы системы (WSK-мультипликатор, броня, выносливость)
    // Цель: бой 4–8 раундов при WSK=1, win rate 55–70% vs basic_gangster
    {
      code: 'weapon_fists', name: 'Кулаки', type: 'WEAPON' as const,
      weaponType: 'MELEE' as const,
      minDamage: 10, maxDamage: 25, weaponAccuracy: 0.85,
      weight: 0, durabilityMax: 999, qualityBase: 'COMMON' as const,
      priceBase: 0, levelReq: 0, isSellable: false, isActive: true,
      sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'weapon_knife_basic', name: 'Перочинный нож', type: 'WEAPON' as const,
      weaponType: 'KNIFE' as const,
      minDamage: 20, maxDamage: 45, weaponAccuracy: 0.80, critBonus: 0.03,
      weight: 0.5, durabilityMax: 80, qualityBase: 'COMMON' as const,
      priceBase: 200, levelReq: 0, sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'weapon_pipe_basic', name: 'Водопроводная труба', type: 'WEAPON' as const,
      weaponType: 'CLUB' as const,
      minDamage: 30, maxDamage: 65, weaponAccuracy: 0.70,
      weight: 2.0, durabilityMax: 120, qualityBase: 'COMMON' as const,
      priceBase: 350, levelReq: 0, strReq: 2, sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'weapon_pistol_pm', name: 'Пистолет ПМ', type: 'WEAPON' as const,
      weaponType: 'PISTOL' as const,
      minDamage: 40, maxDamage: 80, weaponAccuracy: 0.75,
      optimalRange: 4, maxRange: 5,
      weight: 1.0, durabilityMax: 100, qualityBase: 'COMMON' as const,
      priceBase: 800, levelReq: 2, sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'weapon_shotgun_basic', name: 'Охотничье ружьё', type: 'WEAPON' as const,
      weaponType: 'SHOTGUN' as const,
      minDamage: 70, maxDamage: 140, weaponAccuracy: 0.60,
      optimalRange: 2, maxRange: 3,
      weight: 3.5, durabilityMax: 90, qualityBase: 'COMMON' as const,
      priceBase: 1500, levelReq: 4, strReq: 3, sourceType: 'GOVERNMENT' as const,
    },
  ]

  const armorTemplates = [
    // Броня масштабирована под новую формулу ARM/(ARM+50)
    {
      code: 'armor_jacket_basic', name: 'Стёганая куртка', type: 'ARMOR' as const,
      armorSlot: 'CHEST' as const,
      armor: 10,
      weight: 1.5, durabilityMax: 100, qualityBase: 'COMMON' as const,
      priceBase: 300, levelReq: 0, sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'armor_cap_basic', name: 'Кепка', type: 'ARMOR' as const,
      armorSlot: 'HEAD' as const,
      armor: 4,
      weight: 0.2, durabilityMax: 70, qualityBase: 'COMMON' as const,
      priceBase: 100, levelReq: 0, sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'armor_jeans_basic', name: 'Джинсы', type: 'ARMOR' as const,
      armorSlot: 'LEGS' as const,
      armor: 6,
      weight: 0.8, durabilityMax: 90, qualityBase: 'COMMON' as const,
      priceBase: 200, levelReq: 0, sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'armor_boots_basic', name: 'Берцы', type: 'ARMOR' as const,
      armorSlot: 'FEET' as const,
      armor: 6, dodgeBonus: 0.02,
      weight: 1.0, durabilityMax: 90, qualityBase: 'COMMON' as const,
      priceBase: 250, levelReq: 0, sourceType: 'GOVERNMENT' as const,
    },
    {
      code: 'armor_vest_basic', name: 'Советский бронежилет', type: 'ARMOR' as const,
      armorSlot: 'CHEST' as const,
      armor: 25, antiCrit: 0.05,
      weight: 5.0, durabilityMax: 120, qualityBase: 'COMMON' as const,
      priceBase: 2000, levelReq: 3, strReq: 3, sourceType: 'GOVERNMENT' as const,
    },
  ]

  // --- Consumable templates ---
  const consumableTemplates = [
    {
      code: 'consumable_bandage', name: 'Бинт', type: 'CONSUMABLE' as const,
      hpBonus: 20,  // Restores 20 HP when used in battle
      weight: 0.1, durabilityMax: 1, qualityBase: 'COMMON' as const,
      priceBase: 50, levelReq: 0, isSellable: true, isActive: true,
      sourceType: 'GOVERNMENT' as const, isEquippable: false,
    },
    {
      code: 'consumable_first_aid_kit', name: 'Аптечка', type: 'CONSUMABLE' as const,
      hpBonus: 50,  // Restores 50 HP when used in battle
      weight: 0.3, durabilityMax: 1, qualityBase: 'COMMON' as const,
      priceBase: 150, levelReq: 0, isSellable: true, isActive: true,
      sourceType: 'GOVERNMENT' as const, isEquippable: false,
    },
    {
      code: 'consumable_energy_drink', name: 'Энергетик', type: 'CONSUMABLE' as const,
      hpBonus: 30,  // Restores 30 HP
      weight: 0.2, durabilityMax: 1, qualityBase: 'COMMON' as const,
      priceBase: 80, levelReq: 0, isSellable: true, isActive: true,
      sourceType: 'GOVERNMENT' as const, isEquippable: false,
    },
  ]

  const toolTemplates = [
    { code: 'tool_work_basic', name: 'Рабочий набор', description: 'Расходная оснастка для базовых производственных площадок.', type: 'TOOL' as const, toolTier: 1, usesMax: STAGE2_TOOL_TIERS[1].uses, weight: 1.0, durabilityMax: 1, priceBase: STAGE2_TOOL_TIERS[1].price, levelReq: 0, isSellable: true, isActive: true, sourceType: 'GOVERNMENT' as const, isEquippable: false },
    { code: 'tool_work_advanced', name: 'Профессиональная оснастка', description: 'Оснастка для оборудования второго тира.', type: 'TOOL' as const, toolTier: 2, usesMax: STAGE2_TOOL_TIERS[2].uses, weight: 1.5, durabilityMax: 1, priceBase: STAGE2_TOOL_TIERS[2].price, levelReq: 0, isSellable: true, isActive: true, sourceType: 'GOVERNMENT' as const, isEquippable: false },
    { code: 'tool_work_precision', name: 'Точная оснастка', description: 'Расходный инструмент для сложного производства.', type: 'TOOL' as const, toolTier: 3, usesMax: STAGE2_TOOL_TIERS[3].uses, weight: 2.0, durabilityMax: 1, priceBase: STAGE2_TOOL_TIERS[3].price, levelReq: 0, isSellable: true, isActive: true, sourceType: 'GOVERNMENT' as const, isEquippable: false },
  ]

  // Upsert templates
  for (const tpl of [...weaponTemplates, ...armorTemplates, ...consumableTemplates, ...toolTemplates]) {
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
      hpMax: 40,
      stats: { str: 2, agi: 2, rea: 1, acc: 2, end: 2, luck: 1, agr: 1, armor: 5 },
      equipment: {
        weapon: { minDamage: 10, maxDamage: 22, accuracy: 0.65, maxRange: 1 },
        armor: { HEAD: 2, CHEST: 5, LEGS: 3, RIGHT_ARM: 2, LEFT_ARM: 2 },
      },
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
      stats: { str: 3, agi: 3, rea: 2, acc: 3, end: 3, luck: 1, agr: 2, armor: 10 },
      equipment: {
        weapon: { minDamage: 20, maxDamage: 42, accuracy: 0.70, maxRange: 1 },
        armor: { HEAD: 6, CHEST: 12, LEGS: 8, RIGHT_ARM: 5, LEFT_ARM: 5 },
      },
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
      stats: { str: 4, agi: 3, rea: 2, acc: 4, end: 4, luck: 1, agr: 2, armor: 18 },
      equipment: {
        weapon: { minDamage: 40, maxDamage: 80, accuracy: 0.72, maxRange: 5 },
        armor: { HEAD: 10, CHEST: 22, LEGS: 15, RIGHT_ARM: 9, LEFT_ARM: 9 },
      },
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

  // --- Stage 2 resource templates ---
  const resources = RESOURCES
  for (const [code, name, category, tier, basePrice, weight, isRepairMaterial, isUpgradeMaterial] of resources) {
    await prisma.resourceTemplate.upsert({
      where: { code },
      update: { name, category, tier, basePrice, weight, isRepairMaterial, isUpgradeMaterial, isActive: true },
      create: { code, name, category, tier, basePrice, weight, isRepairMaterial, isUpgradeMaterial },
    })
  }
  console.log(`  Resource templates: ${resources.length}`)

  const privateTemplates = [
    {code:'weapon_tt_private',name:'Пистолет ТТ',type:'WEAPON' as const,weaponType:'PISTOL' as const,minDamage:45,maxDamage:90,weaponAccuracy:.78,optimalRange:4,maxRange:5,weight:1.1,durabilityMax:100,priceBase:2400,levelReq:3,itemTier:2,sourceType:'PRIVATE' as const,privateShopAllowed:true,upgradeAllowed:true,allocationMode:'PLAYER' as const,statBudget:5,repairResourceCode:'comp_weapon_part'},
    {code:'weapon_sawnoff_private',name:'Обрез',type:'WEAPON' as const,weaponType:'SHOTGUN' as const,minDamage:80,maxDamage:150,weaponAccuracy:.63,optimalRange:2,maxRange:3,weight:3,durabilityMax:90,priceBase:3900,levelReq:4,itemTier:2,sourceType:'PRIVATE' as const,privateShopAllowed:true,upgradeAllowed:true,allocationMode:'PLAYER' as const,statBudget:5,repairResourceCode:'comp_weapon_part'},
    {code:'armor_leather_jacket_private',name:'Кожаная куртка с пластинами',type:'ARMOR' as const,armorSlot:'CHEST' as const,armor:16,weight:2,durabilityMax:110,priceBase:900,levelReq:0,itemTier:2,sourceType:'PRIVATE' as const,privateShopAllowed:true,upgradeAllowed:true,allocationMode:'PLAYER' as const,statBudget:5,repairResourceCode:'comp_armor_plate'},
    {code:'armor_army_vest_private',name:'Армейский бронежилет',type:'ARMOR' as const,armorSlot:'CHEST' as const,armor:34,antiCrit:.07,weight:6,durabilityMax:130,priceBase:5200,levelReq:4,itemTier:2,sourceType:'PRIVATE' as const,privateShopAllowed:true,upgradeAllowed:true,allocationMode:'PLAYER' as const,statBudget:5,repairResourceCode:'comp_armor_plate'},
    {code:'armor_boots_army_private',name:'Армейские берцы',type:'ARMOR' as const,armorSlot:'FEET' as const,armor:9,dodgeBonus:.03,weight:1.2,durabilityMax:100,priceBase:700,levelReq:0,itemTier:2,sourceType:'PRIVATE' as const,privateShopAllowed:true,upgradeAllowed:true,allocationMode:'PLAYER' as const,statBudget:5,repairResourceCode:'comp_armor_plate'},
  ]
  for(const tpl of privateTemplates){await prisma.itemTemplate.upsert({where:{code:tpl.code},update:tpl,create:tpl})}
  await prisma.itemTemplate.updateMany({where:{type:'WEAPON'},data:{craftProfessionCode:'gunsmith'}})
  await prisma.itemTemplate.updateMany({where:{type:'ARMOR'},data:{craftProfessionCode:'cooperative_builder'}})
  await prisma.itemTemplate.updateMany({where:{type:'CONSUMABLE'},data:{craftProfessionCode:'pharmacist'}})
  const privateItemRows=[['kommersant','armor_leather_jacket_private',900,'INFINITE',null],['kommersant','armor_army_vest_private',5200,'LIMITED',10],['kommersant','armor_boots_army_private',700,'INFINITE',null],['armory_garage','weapon_tt_private',2400,'INFINITE',null],['armory_garage','weapon_sawnoff_private',3900,'LIMITED',15]] as const
  for(const [shopCode,code,price,stockMode,stockAmount] of privateItemRows){const t=await prisma.itemTemplate.findUniqueOrThrow({where:{code}});await prisma.privateShopItem.upsert({where:{shopCode_itemTemplateId:{shopCode,itemTemplateId:t.id}},update:{price,stockMode,stockAmount,minBattleLevel:t.levelReq,isActive:true},create:{shopCode,itemTemplateId:t.id,price,stockMode,stockAmount,minBattleLevel:t.levelReq}})}
  const privateResourceRows=PRIVATE_SHOP_RESOURCES
  for(const {shopCode,resourceCode:code,price} of privateResourceRows){const r=await prisma.resourceTemplate.findUniqueOrThrow({where:{code}});await prisma.privateShopItem.upsert({where:{shopCode_resourceTemplateId:{shopCode,resourceTemplateId:r.id}},update:{price,isActive:true},create:{shopCode,resourceTemplateId:r.id,price}})}
  console.log(`  Private shop entries: ${privateItemRows.length+privateResourceRows.length}`)

  const productionObjects = PRODUCTION_OBJECTS
  const objectProfessions = OBJECT_PROFESSIONS
  for(const {code,name,type,requiredProductionLevel,shiftDurationMinutes,baseSalary,baseProductionExp,producesResourceCode,outputAmountMin,outputAmountMax,economicExpReward} of productionObjects){
    const requiredProfessionCode = objectProfessions[code]
    const requiredProfessionLevel = Math.min(requiredProductionLevel, 3)
    await prisma.productionObject.upsert({where:{code},update:{name,type,requiredProductionLevel,requiredProfessionCode,requiredProfessionLevel,shiftDurationMinutes,baseSalary,baseProductionExp,producesResourceCode,outputAmountMin,outputAmountMax,economicExpReward,isActive:true,status:'ACTIVE'},create:{code,name,type,requiredProductionLevel,requiredProfessionCode,requiredProfessionLevel,shiftDurationMinutes,baseSalary,baseProductionExp,producesResourceCode,outputAmountMin,outputAmountMax,economicExpReward}})
  }
  for (const recipeData of PRODUCTION_RECIPES) {
    const { inputs, ...recipe } = recipeData
    const saved = await prisma.productionRecipe.upsert({
      where: { code: recipe.code },
      update: recipe,
      create: recipe,
    })
    await prisma.productionRecipeInput.deleteMany({ where: { recipeId: saved.id } })
    if (inputs.length > 0) {
      await prisma.productionRecipeInput.createMany({
        data: inputs.map(input => ({ recipeId: saved.id, ...input })),
      })
    }
    await prisma.productionObject.update({
      where: { code: recipe.productionObjectCode },
      data: { activeRecipeId: saved.id, storageCapacity: 1000 },
    })
  }
  const equipmentByObject: Record<string, { code: string; name: string; tier: number; requiredToolTier: number }> = {
    obj_warehouse_station: { code: 'equipment_warehouse_terminal', name: 'Складской терминал', tier: 1, requiredToolTier: 1 },
    obj_scrapyard: { code: 'equipment_scrap_sorter', name: 'Сортировочная линия', tier: 1, requiredToolTier: 1 },
    obj_market_loader: { code: 'equipment_market_loader', name: 'Погрузочный комплект', tier: 1, requiredToolTier: 1 },
    obj_garage_workshop: { code: 'equipment_garage_press', name: 'Гаражный пресс', tier: 2, requiredToolTier: 2 },
    obj_small_factory: { code: 'equipment_small_factory_line', name: 'Производственная линия', tier: 2, requiredToolTier: 2 },
    obj_parts_factory: { code: 'equipment_parts_precision', name: 'Точный станок', tier: 3, requiredToolTier: 3 },
    obj_cooperative_site: { code: 'equipment_site_press', name: 'Листогиб', tier: 3, requiredToolTier: 3 },
  }
  for (const [objectCode, equipment] of Object.entries(equipmentByObject)) {
    const object = await prisma.productionObject.findUniqueOrThrow({ where: { code: objectCode } })
    await prisma.productionEquipment.upsert({
      where: { productionObjectId: object.id },
      update: { ...equipment, producesResourceCode: object.producesResourceCode, ownerType: 'SYSTEM', ownerCharacterId: null, isActive: true },
      create: { productionObjectId: object.id, ...equipment, producesResourceCode: object.producesResourceCode, ownerType: 'SYSTEM' },
    })
  }
  console.log(`  Production objects: ${productionObjects.length}; equipment: ${Object.keys(equipmentByObject).length}`)

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
