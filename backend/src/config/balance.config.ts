// =============================================================
// BALANCE CONFIG — все игровые коэффициенты в одном месте
// Из мастер-ТЗ раздел 17 (математическая модель)
// =============================================================

export const BalanceConfig = {
  // ── Этап 4: стратегический слой ──────────────────────────────
  // Числа и их вывод — docs/specs/stage-4/STAGE4_BALANCE.md.
  // Здесь только значения: ни одна константа не живёт в коде формул.
  strategy: {
    territory: {
      limit: 2,                    // территорий на клан
      upkeepTier1: 2000,           // ₽/сутки за первую
      upkeepTier2: 5000,           // ₽/сутки за вторую — в 2.5 раза дороже
      upkeepDebtBonusOff: 10000,   // долг: бонус района отключается
      upkeepDebtRelease: 25000,    // долг: район уходит в NEUTRAL
      protectionHours: 48,
      claimWindowHours: 6,
      claimClanCooldownHours: 24,
      defenceLockMinutes: 10,
      neutralClaimHours: 6,
      claimFee: 10000,             // безвозвратно
      claimMinRoster: 5,
      claimMinBattleLevel: 3,
    },
    objectAttack: {
      sabotageDurabilityLoss: 40,
      robberyShare: 0.20,
      robberyCap: 8000,
      robberyMinBalance: 5000,
      cooldownHours: 72,
    },
    authority: {
      territoryWon: 15,
      territoryDefended: 20,       // оборона дороже атаки: время выбирал не он
      cycleCompleted: 1,
      shiftCompleted: 0.2,         // дробное намеренно: целое округлило бы в ноль
      territoryHeldDay: 2,
      claimCost: 20,               // дороже победы: одних побед не хватает
      sabotageCost: 12,
      robberyCost: 25,
    },
    clanObjects: { base: 2, perTerritory: 2 },
    premium: { skillMultiplier: 1.5, dailyShiftCap: 16, helperSlots: 2, loadoutSlots: 4 },
    helper: { efficiency: 0.6, maxCount: 2, skillCap: 3, skillRate: 0.5, dailyShiftCap: 6 },
    battleSwap: { weaponCostPoints: 1, armorCostTurn: true },
  },

  economy: {
    work: { efficiencyPerProfessionLevel: 0.03, objectLevelStep: 0.25, salaryRandomMin: 0.9, salaryRandomMax: 1.1, salaryCapMultiplier: 3, dailyShiftLimit: 12, dailyShiftMinutes: 360, salaryFatigueStep: 0.20, salaryFatigueFloor: 0.20 },
    resources: { governmentPayoutRate: 0.25, governmentEcoExpRate: 0.01 },
    market: { listingFeeRate: 0.02, listingFeeMin: 5, saleTaxRate: 0.05, sellerEcoExpRate: 0.03, listingDurationHours: 72, maxActiveListings: 10 },
    tools: { tiers: { 1: { price: 500, uses: 50 }, 2: { price: 1250, uses: 50 }, 3: { price: 1800, uses: 50 } } },
    production: {
      cycleTickSeconds: 60,
      equipmentWearPerCycle: 2,
      equipmentTierSpeedBonus: 0.15,
      laborTimeoutHours: 48,
      objectWithdrawTaxRate: 0.05,
      salaryRangeMin: 0.5,
      salaryRangeMax: 2.0,
      maxObjectsPerCharacter: 2,
      objectResaleRate: 0.5,
      profileSwitchCost: 1500,
      profileSwitchMinutes: 180,
      repairCostPerDurability: 20,
      repairDurabilityPerKit: 20,
      repairResourceCode: 'comp_repair_kit',
    },
    upgrades: { costRate: 0.15, costPower: 1.4, baseChance: 0.9, chanceLossPerLevel: 0.12, professionBonusPerLevel: 0.01, minChance: 0.15, maxChance: 0.95 },
    simulation: {
      profiles: {
        fighter: { battles: 15, shifts: 0, marketEveryDays: 4 },
        worker: { battles: 1, shifts: 8, marketEveryDays: 3 },
        mixed: { battles: 6, shifts: 4, marketEveryDays: 3 },
      },
      battleWinRate: 0.60,
      battleRewardMin: 35,
      battleRewardMax: 75,
      weaponDurabilityLossPerFight: 3,
      repairTriggerDurability: 30,
      repairedDurability: 60,
      repairCost: 200,
      governmentMaintenanceCost: 150,
      privateShopLifecycleCost: 900,
      upgradeCosts: [360, 950, 1676, 2507, 3427],
      upgradeChances: [0.90, 0.78, 0.66, 0.54, 0.42],
    },
    alerts: {
      minSinkShare: 0.40,
      maxDailyM2Growth: 0.05,
      maxGini: 0.75,
      minUpgradeSample: 20,
      minUpgradeSuccessRate: 0.45,
      maxUpgradeSuccessRate: 0.85,
    },
    suspicious: {
      priceRatioMin: 0.20,
      priceRatioMax: 5.0,
      pairTradesPerDayMax: 5,
      cancelsPerDayMax: 10,
      idempotencyReplaysPerHourMax: 10,
    },
  },

  // --- Character base values ---
  character: {
    startMoney:         1250,  // стартовые деньги
    baseHp:             60,
    hpPerEnd:           6,     // HP за 1 END
    hpPerBattleLevel:   2,
    baseCarryWeight:    20,
    carryWeightPerStr:  6,

    // Archetype bonuses: { stat: amount }
    archetypeBonuses: {
      ATHLETE:  { str: 1, end: 1 },
      WORKER:   { str: 1, end: 1 },
      SHUTTLE:  { acc: 1, luck: 1 },
      VETERAN:  { rea: 1, acc: 1 },
      STREET:   { agi: 1, agr: 1 },
      MERCHANT: { luck: 1, auth: 1 },
      STUDENT:  {},                    // нет бонуса, зато больше points
      RESOLVER: { auth: 2 },
    } as Record<string, Partial<Record<string, number>>>,

    baseStats: {
      str: 3, agi: 3, rea: 2, acc: 3,
      end: 3, luck: 1, agr: 1, auth: 1,
    },

    // Очки для распределения при создании
    startingPoints: {
      ATHLETE:  0,
      WORKER:   0,
      SHUTTLE:  0,
      VETERAN:  0,
      STREET:   0,
      MERCHANT: 0,
      STUDENT:  2,   // студент получает 2 доп. очка
      RESOLVER: 0,
    } as Record<string, number>,
  },

  // --- Initiative ---
  initiative: {
    reaMultiplier:    1.2,
    agiMultiplier:    0.6,
    wskMultiplier:    0.3,
    weightPenalty:    0.25,
    randomRange:      5,    // rand(-5, +5)
    min:              1,
  },

  // --- Hit chance ---
  hitChance: {
    min:              0.05,
    max:              0.95,
    agiDodgePressure: 0.003,
    wskBonus:         0.005,
    luckEvasionPressure: 0.005,
  },

  // --- Dodge chance ---
  dodgeChance: {
    base:             0.05,
    agilityRatioMult: 0.35,
    armorWeightPenalty: 0.003,
    max:              0.75,
  },

  // --- Block chance ---
  blockChance: {
    base:             0.10,
    reactionRatioMult: 0.40,
    blockReduction:   0.35,  // успешный блок пропускает 35% урона
    max:              0.80,
    luckPierceMult:   0.003,
  },

  counter: { baseChance: 0.05, reactionRatioMult: 0.30, maxChance: 0.40, minReaction: 5, incomingBase: 0.25, reactionDamageBonus: 0.01, incomingDamageCap: 0.60 },

  // --- Crit ---
  crit: {
    base:             0.03,
    agressMult:       0.004,
    wskMult:          0.003,
    endResist:        0.002,
    min:              0.01,
    max:              0.50,
    multiplierBase:   1.5,
    multiplierMin:    1.2,
    multiplierMax:    3.0,
    armorIgnore:      0.5,   // крит игнорирует 50% брони
  },

  // --- Damage ---
  damage: {
    // wskBase=1.0: новичок с WSK=1 наносит 100% урона оружия (не 35%).
    // Мастерство — БОНУС сверху, а не наказание новичков.
    // При WSK=20: 1.0 + 20×0.025 = 1.5× (50% бонус к топу)
    wskBase:          1.0,
    wskPerLevel:      0.025,  // за каждый уровень до 20
    wskPerLevelOver20: 0.01,  // за каждый уровень после 20
    wskCap:           1.5,
    wskMin:           0.5,    // минимум 50% даже без навыка
    strCoeff:         0.5,    // STR × 0.5 к урону
    armorFlatCoeff:   0.4,    // ARM × 0.4 плоское снижение
    armorK:           50,     // ARM/(ARM+50) — броня ощутима уже при ARM=10-20
    enduranceK:       0.12,   // чуть меньше штраф выносливости (было 0.18)
    minFinalDamage:   1,
  },

  // --- Weapon skills ---
  weaponSkill: {
    // Порог опыта для каждого уровня (таблица из ТЗ)
    expThresholds: [
      0, 4, 8, 13, 23, 36, 56, 84, 123, 176, 248,
      344, 471, 637, 852, 1128, 1480, 1926, 2489, 3193, 4070,
      5500, 7140, 9270, 12050, 15600, 20000, 26300, 34200, 45000, 58000,
    ],
    antiSkillReductionPerLevel: 0.5,   // effectiveWSK = WSK - antiSkill × 0.5
    weaponResistMaxReduction: 0.4,      // max 40% damage reduction from anti-skill
    weaponResistPerLevel: 0.02,         // per anti-skill level: 2% damage reduction
  },

  // --- Battle exp ---
  battleExp: {
    resultCoeff: {
      PVP_WIN:    1.0,
      PVP_LOSS:   0.2,
      PVE_WIN:    0.5,
      PVE_LOSS:   0.0,
      DRAW:       0.1,
    } as Record<string, number>,

    levelDiffCoeff: [
      // [maxDiff, coeff]
      [3, 1.0], [4, 0.9], [5, 0.8], [6, 0.7], [7, 0.6],
      [8, 0.5], [9, 0.4], [10, 0.3], [14, 0.15], [Infinity, 0],
    ] as [number, number][],

    // PvE anti-farm: снижается при повторных боях с ботом
    pveDailyPenaltyPerKill: 0.05,
    pveDailyMin: 0.1,

    // Таблица уровней (exp нужен для перехода на следующий уровень)
    // Источник: GanjaWars (5, 15, 37, 76, 143...)
    levelThresholds: [
      0, 5, 15, 37, 76, 143, 240, 370, 535, 740, 1000,
      1310, 1680, 2120, 2640, 3250, 3960, 4780, 5720, 6790, 8000,
      9360, 10880, 12570, 14440, 16500, 18760, 21230, 23920, 26840, 30000,
    ],

    // Очки характеристик за новый боевой уровень
    statPointsPerLevel: 1,

    // Максимальное значение одной характеристики
    maxStatValue: 20,
  },

  // --- Economic exp (GanjaWars reference: price × 0.047) ---
  economicExp: {
    // При продаже нового предмета
    sellNewRate: 0.047,
    // При продаже сломанного предмета
    sellBrokenRate: 0.067,

    // Таблица уровней экономического опыта (GanjaWars source)
    levelThresholds: [
      0, 1250, 3864, 9241, 19060, 35658, 62224, 103032, 163721, 251646, 376282,
      549727, 787291, 1108199, 1536424, 2101672, 2840541, 3797878, 5028368, 6598393, 8588189,
    ],
  },

  // --- Durability ---
  durability: {
    weaponLossPerBattle: 1,    // MVP: -1 прочность за атаку (упрощённая модель)
    armorLossPerHit: 0.5,      // MVP: -0.5 за каждое попадание → floor(hits/2)
  },

  // --- Repair ---
  repair: {
    baseCostDivider: 120,      // basePrice / 120 за единицу прочности
    qualityCoeff: {
      JUNK:   0.8,
      COMMON: 1.0,
      GOOD:   1.15,
      RARE:   1.35,
      NAMED:  1.5,
      UNIQUE: 2.0,
    } as Record<string, number>,
  },

  // --- Government shop ---
  shop: {
    sellBackMultiplier: 0.3,  // игрок получает 30% от base price при продаже
  },
} as const
