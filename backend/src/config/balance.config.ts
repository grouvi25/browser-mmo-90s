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
      limit: 1,                    // территорий на клан
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
      // Подаёт главарь или зам, остальные встают кнопкой «Присоединиться» (правка 22.10).
      claimMinRoster: 1,
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
    // Осада дома бригады. Правка заказчика 22.10: «нападения на дома раз в
    // неделю; заявка, а бой ровно через 72 часа; до 10 человек в нападение
    // и до 10 в защиту». Взятие роняет прочность и громит дом на 7 суток,
    // отбитая осада даёт нападавшим травму.
    houseSiege: {
      leadHours: 72,          // бой ровно через столько после заявки
      maxPerSide: 10,
      durabilityLoss: 5,
      razedDays: 7,
      bonusesOffAtOrBelow: 50,
      traumaHours: 24,
      cooldownDays: 7,        // раз в неделю: и для нападающей бригады, и для дома
      repairCostPer10: 2000,  // ₽ из общака за 10% прочности
      wallNoteMaxLength: 200,
      wallNotesPerPlayer: 5,
    },
    clanObjects: { base: 2, perTerritory: 2 },
    premium: { skillMultiplier: 1.5, dailyShiftCap: 16, helperSlots: 2, loadoutSlots: 4 },
    helper: { efficiency: 0.6, maxCount: 2, skillCap: 3, skillRate: 0.5, dailyShiftCap: 6, priceCombatUsd: 200, priceWorkUsd: 100 },
    battleSwap: { weaponCostPoints: 1, armorCostTurn: true },
  },

  // ── Этап 5: антиабуз ────────────────────────────────────────
  //
  // Жёсткие лимиты работают молча, всегда и для всех. Это не наказание, а
  // правила игры, и они описываются игроку в разделе ограничений первой
  // версии. Обоснование чисел — docs/specs/stage-5/STAGE5_ANTIABUSE.md.
  //
  // Чего здесь НЕТ намеренно: коэффициента разницы уровней и лимита опыта с
  // ботов. И то и другое уже действует с Этапов 1–2
  // (`battleExp.levelDiffCoeff` и `pveDailyPenaltyPerKill` ниже), и заводить
  // второе правило поверх принятого баланса значило бы менять боёвку под
  // видом антиабуза.
  antiAbuse: {
    /// Второй и последующие бои той же пары за сутки дают эту долю опыта.
    repeatBattleShare: 0.25,
    /// Сколько денег один аккаунт может получить от другого за сутки.
    /// Прямых передач в игре нет — единственный канал это рынок.
    pairMoneyDailyCap: 50_000,
    /// И сколько предметов.
    pairItemsDailyCap: 5,
  },

  economy: {
    work: { efficiencyPerProfessionLevel: 0.03, objectLevelStep: 0.25, salaryRandomMin: 0.9, salaryRandomMax: 1.1, salaryCapMultiplier: 3, dailyShiftLimit: 12, dailyShiftMinutes: 360, salaryFatigueStep: 0.20, salaryFatigueFloor: 0.20, restMinutesAfterShift: 30 },
    resources: { governmentPayoutRate: 0.25 },
    market: { listingFeeRate: 0.02, listingFeeMin: 5, saleTaxRate: 0.05, listingDurationHours: 72, maxActiveListings: 10 },
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
      /** Заказчик 28.10: «Заводы продаются ТОЛЬКО за доллары»; 30.10: «Стоимость заводов 15000$». */
      objectPriceUsd: 15000,
      profileSwitchCost: 1500,
      profileSwitchMinutes: 180,
      repairCostPerDurability: 20,
      repairDurabilityPerKit: 20,
      repairResourceCode: 'comp_repair_kit',
    },
    /** Именные вещи ЦУМа (заказчик 30.10): «улучшения на 1лвл каждую вещь, +50 статов за каждый лвл». */
    // Заказчик 31.10: очко на именной вещи — 5% мастерства или оберега, в плюс и в минус.
    // Предел поля 20 очков — это 100%, больше проценты не значат.
    namedItems: { pointsPerLevel: 50, levelPriceUsd: 1000, maxLevel: 10, percentPerPoint: 5, percentFieldLimit: 20 },
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
    startMoney:         5000,  // стартовые деньги 5 000 ₽ (чат Дмитрия 29.10; решение владельца 30.10)
    baseHp:             60,
    hpPerEnd:           6,     // HP за 1 END
    hpPerGearEnd:       5,     // HP за 1 END с вещи (заказчик 31.10)
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

    // Свиток перераспределения: два выдаются бесплатно (поле в базе),
    // следующие — за рубли. Цена стартовая, заказчик её не задавал.
    respecScrollPrice: 5000,
    maxStat: 20,
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

  // --- Block chance ---
  blockChance: {
    base:             0.10,
    reactionRatioMult: 0.40,
    blockReduction:   0.35,  // успешный блок пропускает 35% урона
    max:              0.80,
    luckPierceMult:   0.003,
  },

  counter: { baseChance: 0.05, reactionRatioMult: 0.30, maxChance: 0.40, minReaction: 5, incomingBase: 0.25, reactionDamageBonus: 0.01, incomingDamageCap: 0.60 },

  // --- Удар по книге заказчика («Ревизия 2», «Урон одного удара», перенесено 30.10) ---
  //   База = 1,5 × сила + оружие × владение;
  //   Броня = броня зоны + 0,5 × выносливость; Kброни = 40 × 1,3^(уровень − 1);
  //   урон = INT(База × K/(K + Броня) × (1 ± 0,1) × крит);
  //   крит = CLAMP(0,1 + 0,2 × (Aгра − Aгрз)/(Aгра + Aгрз + 20); 0,02; 0,4);
  //   уворот = CLAMP(0,05 + 0,25 × (Лвкз − Мткa)/(Лвкз + Мткa + 20); 0,01; 0,35).
  strike: {
    strCoeff:       1.5,
    endArmor:       0.5,
    armorK:         40,
    armorKGrowth:   1.3,
    statSoftener:   20,
    critBase:       0.10,
    critSpread:     0.20,
    critMin:        0.02,
    critMax:        0.40,
    dodgeBase:      0.05,
    dodgeSpread:    0.25,
    dodgeMin:       0.01,
    dodgeMax:       0.35,
    spread:         0.10,
    // Точность оружия сверх этой — антиуворот, ниже (хмель) — помощь защитнику.
    baseWeaponAccuracy: 0.7,
    // Масштаб итога. Книга считает в своих единицах: оружие 10 на 1-м уровне.
    // У нас оружие 1-го уровня 20–45 при здоровье 80, и без масштаба бой
    // кончался за один ход. С ним ходов столько же, сколько до переноса.
    damageScale: 0.35,
  },

  // --- Crit: сила крита (шанс — в strike) ---
  crit: {
    multiplierBase:   1.5,
    multiplierMin:    1.2,
    multiplierMax:    3.0,
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
  },

  // --- Battle exp ---
  battleExp: {
    // Формула «Ревизия 2» (книга заказчика 23.10, принятая как основа):
    //   зачёт по цели = MIN(урон; HP цели + её лечение; HP × q)
    //   XP = зачёт × (мощность цели / её HP) × K × m × доля исхода,
    //   где K = MIN(L; Lцели) / MAX(L; Lцели), потолок за бой — capPerBattle.
    resultCoeff: {
      PVP_WIN:    1.0,
      PVP_LOSS:   0.1,   // «проигравшему 10%» (Дмитрий 23.10)
      PVE_WIN:    0.5,
      PVE_LOSS:   0.1,
      DRAW:       0.2,   // «ничья 20%» (Дмитрий 23.10)
    } as Record<string, number>,

    // Зачёт урона: цель не «кормит» опыт лечением сверх трёх своих HP.
    creditOverhealQ: 3,
    // Калибровочный множитель формулы (лист «Опыт», m = 2,759375).
    multiplierM: 2.759375,
    // Общий потолок XP за бой. Дмитрий: «не снимаем, сложно набить на любом lvl».
    capPerBattle: 50_000,

    levelDiffCoeff: [
      // [maxDiff, coeff]
      [3, 1.0], [4, 0.9], [5, 0.8], [6, 0.7], [7, 0.6],
      [8, 0.5], [9, 0.4], [10, 0.3], [14, 0.15], [Infinity, 0],
    ] as [number, number][],

    // PvE anti-farm: снижается при повторных боях с ботом
    pveDailyPenaltyPerKill: 0.05,
    pveDailyMin: 0.1,

    // Таблица боевых уровней «Ревизия 2» (книга, 23.10): 15 уровней,
    // T(L) = ROUND(883 × EXP(0,6848 × (L − 2)) × (L − 1)^0,5841).
    // Порог — накопленный опыт на УРОВНЕ; 15-й — максимальный.
    // Прежняя GanjaWars-кривая (31 уровень до 30 000) заменена миграцией.
    levelThresholds: [
      0, 883, 2_625, 6_599, 15_482, 34_982, 77_180, 167_499, 359_161, 763_085,
      1_609_550, 3_375_101, 7_043_101, 14_637_717, 30_316_376,
    ],

    // Денежная премия за достижение уровня L (индекс = уровень − 1),
    // выдаётся по одному разу за уровень. Решение заказчика 28.10: старт
    // 1 250 ₽, за каждый следующий уровень — ровно 650 ₽. Прежняя таблица
    // книги «Ревизия 2» (650 × L^1,9: 2 426 за 2-й, 13 834 за 5-й…) отменена.
    levelMoneyBonus: [
      650, 650, 650, 650, 650, 650, 650, 650, 650, 650,
      650, 650, 650, 650, 650,
    ],

    // Очки характеристик за новый боевой уровень. Документ заказчика:
    // «при регистрации 18 статов, за каждый лвл дается +3 стата». 18 при
    // регистрации уже так: 16 базовых боевых + 2 от архетипа (у студента —
    // 2 свободных очка); авторитет — не боевой стат и в счёт не входит.
    statPointsPerLevel: 3,

    // Максимальное значение одной характеристики
    maxStatValue: 20,
  },

  // --- Экономический опыт (книга «Ревизия 2», перевод по решению заказчика 28.10) ---
  // Опыт = оборот продаж и торговли × 2%: продажа вещи и сырья государству,
  // продажа на рынке. Раньше ставки были разные по видам (4,7 / 6,7 / 3 / 1%).
  economicExp: {
    turnoverRate: 0.02,
    // За новый экономический уровень: сила +1 и премия 10 000 ₽ ровно
    // (документ Дмитрия 30.10; раньше — десятая доля порога уровня).
    strPerLevel: 1,
    levelMoney: 10_000,
    // Порог уровня L: E(0) = 0, E(L) = ROUND(1450 × e^(0,30 × (L − 1)) × L^0,9), L = 1..30.
    levelThresholds: [0, ...Array.from({ length: 30 }, (_, i) => Math.round(1450 * Math.exp(0.30 * i) * Math.pow(i + 1, 0.9)))],
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

  // --- Реферальная система (обещание игрокам 23.10, процент на наше усмотрение 28.10) ---
  referral: {
    topUpShare: 0.10,     // пригласившему — 10% долларов с каждой покупки у дилера
    minPayoutUsd: 50,     // меньше этого заявку на вывод не принимаем
    maxPendingPayouts: 1, // одна заявка в работе за раз
  },
} as const
