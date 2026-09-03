/**
 * СКВОЗНОЙ ПРОГОН БАЛАНСА — шаг G4 Этапа 5.
 *
 * Пять существующих симуляторов проверяют каждый свой этап в отдельности.
 * Никто не проверял, что территории Этапа 4 не ломают коридоры Этапа 2, а
 * помощники не обесценивают рынок труда Этапа 3. Ошибки такого рода не видны
 * в отдельном прогоне по определению: они возникают на стыке систем.
 *
 * Главное отличие от остальных симуляторов: здесь НЕ ПЕРЕПИСЫВАЮТСЯ формулы.
 * Всё считается тем же кодом, что и игра — calcFinalSalary, ставки объектов
 * из сида, содержание территорий, эффективность помощника. Симулятор со
 * своей копией формул проверяет сам себя, а не игру, и расходится с ней на
 * первой же правке баланса.
 *
 * Запуск:
 *   npx tsx ../scripts/simulate-full.ts --days 30 --seed 4242
 *
 * Отчёт: docs/stage5-full-report.json. Код возврата 1, если хоть один
 * коридор не сошёлся.
 */
import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { BalanceConfig } from '../backend/src/config/balance.config'
import { calcFinalSalary, workerEfficiency } from '../backend/src/modules/work/work.formulas'
import { territoryUpkeepPerDay } from '../backend/src/modules/territories/territories.formulas'
import { CLAN_MAINTENANCE_DAILY } from '../backend/src/modules/clans/clans.formulas'
import { CROPS } from '../backend/src/modules/farm/farm.formulas'
import { laborFromShift } from '../backend/src/modules/production/cycle.formulas'
import { PRODUCTION_OBJECTS, PRODUCTION_RECIPES, RESOURCES } from '../backend/prisma/economy-data'
import { BAR_RESOURCES, BAR_RECIPES, BAR_OFFERS } from '../backend/prisma/bar-data'
import { barPriceRange, barSaleSplit } from '../backend/src/modules/bars/bars.formulas'

// ── Аргументы ────────────────────────────────────────────────
const args = process.argv.slice(2)
const argOf = (name: string, fallback: number) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? Number(args[index + 1]) : fallback
}
const days = argOf('days', 30)
const seed = argOf('seed', 4242)
const quiet = args.includes('--quiet')

let state = seed
/** Детерминированный генератор: «прогнал ещё раз, стало зелёно» недопустимо. */
const rnd = () => {
  state = (state * 1103515245 + 12345) % 2147483648
  return state / 2147483648
}

const W = BalanceConfig.economy.work
const T = BalanceConfig.strategy.territory
const P = BalanceConfig.strategy.premium
const H = BalanceConfig.strategy.helper

// ── Справочники из сида ──────────────────────────────────────
const objectByCode = new Map<string, (typeof PRODUCTION_OBJECTS)[number]>(
  PRODUCTION_OBJECTS.map(row => [row.code as string, row]))
// Ресурсы живут в двух справочниках: производственные в economy-data,
// барные (спирт, экстракт) в bar-data. Первая версия знала только первый, и
// три рецепта выглядели убыточными просто потому, что цены их выхода не
// нашлось. Ложный дефект хуже пропущенного: по нему правят то, что цело.
const resourcePrice = new Map<string, number>([
  ...RESOURCES.map(row => [row[0] as string, row[4] as number] as const),
  ...BAR_RESOURCES.map(row => [row[0] as string, row[2] as number] as const),
])
/** Цены объектов живут в сиде рядом с созданием: здесь только копия чисел. */
const OBJECT_PRICES: Record<string, number> = {
  obj_scrapyard: 12_000, obj_garage_workshop: 20_000, obj_small_factory: 32_000,
  obj_parts_factory: 55_000, obj_cooperative_site: 55_000, obj_kolhoz_zarya: 45_000,
  obj_sawmill: 16_000, obj_textile: 30_000, obj_herb_point: 12_000,
  obj_pharmacy: 28_000, obj_chem_lab: 52_000,
}
const BAR_PRICE = 40_000
const RECIPES = PRODUCTION_RECIPES as unknown as Array<{
  code: string; productionObjectCode: string; outputResourceCode: string | null
  outputAmount: number; laborRequired: number; outputItemTemplateCode?: string | null
  inputs?: Array<{ resourceCode: string; amount: number }>
}>
/**
 * Цены предметов на выходе рецептов — из сида, а не «примерно три тысячи».
 * Первая версия ставила всем предметам одну цену, и аптека с её бинтами
 * выдала владельцу 396 000 ₽ в сутки. Ошибка была в модели, не в игре.
 */
const ITEM_PRICES: Record<string, number> = {
  weapon_tt_private: 2_400,
  armor_leather_jacket_private: 1_300,
  consumable_bandage: 50,
  consumable_first_aid_kit: 170,
  // Импортная оснастка (G8): та же цена, что и в seed.ts —
  // STAGE2_TOOL_TIERS[4].price. Без неё rcp_import_tool считался выходом
  // в 0 ₽ и ложно попадал в список убыточных.
  tool_work_import: 2_500,
}
/**
 * Наценка рынка к базовой цене ресурса.
 *
 * Ключевое допущение всей экономики, и оно записано в ТЗ Этапа 3: базовая
 * цена — это ориентир и пол госскупки (25%), а игроки торгуют между собой
 * выше. Для овощей ТЗ называет целевые 30–40 ₽ при базовой 25 — отсюда 1.4.
 *
 * Считать выход по базовой цене, как делала первая версия, значит объявить
 * убыточным любое производство: зарплаты платятся деньгами, а выход
 * оценивается по себестоимости.
 */
const MARKET_MULTIPLIER = 1.4

/**
 * Доход полного дня на объекте.
 *
 * «Полный день» — это 360 минут смен, как записано в ТЗ Этапа 3, а не
 * абстрактное число смен. На объекте с часовой сменой их влезает шесть, на
 * получасовой — двенадцать, и разница между переделами тут же видна.
 */
function fullDayIncome(code: string, professionLevel = 0) {
  const object = objectByCode.get(code)
  if (!object) throw new Error(`Нет объекта ${code}`)
  const shifts = Math.min(W.dailyShiftLimit, Math.floor(W.dailyShiftMinutes / object.shiftDurationMinutes))
  let sum = 0
  for (let n = 1; n <= shifts; n++) {
    sum += calcFinalSalary(object.baseSalary, 1, professionLevel, 0.5, n)
  }
  return { shifts, money: sum, perHour: sum / (W.dailyShiftMinutes / 60) }
}

/** Средняя ставка смены — база, к которой привязаны почти все коридоры. */
function shiftRate(code: string, professionLevel = 0) {
  const object = objectByCode.get(code)!
  const day = fullDayIncome(code, professionLevel)
  return {
    perShift: day.money / day.shifts,
    perHour: day.money / (day.shifts * object.shiftDurationMinutes / 60),
  }
}

// ── Профили населения ────────────────────────────────────────
//
// Шесть профилей по десять человек: боец, рабочий, владелец объекта, фермер,
// бармен и подписчик с двумя помощниками. Плюс три бригады на 5, 10 и 20
// человек, из которых две берут по району.

const MID_OBJECT = 'obj_small_factory'   // средний передел — база коридора
const LOW_OBJECT = 'obj_scrapyard'       // нижний передел

interface DayReport {
  worker: number
  owner: number
  farmer: number
  barman: number
  premium: number
  fighter: number
}

const daily: DayReport[] = []
let minted = 0
let burned = 0
const m2: number[] = []
let money = 60 * BalanceConfig.character.startMoney

/**
 * Доход владельца объекта за сутки.
 *
 * Считается по НАСТОЯЩЕМУ рецепту из сида, а не по «выходу за смену»:
 * объект производит циклами, цикл требует труда, труд приносят рабочие
 * сменами. Первая версия этой функции брала выход за смену напрямую и дала
 * владельцу минус восемьдесят процентов — модель была неверна, а не игра.
 *
 * Цепочка: рабочий день объекта даёт столько-то минут труда, труд закрывает
 * столько-то циклов, каждый цикл приносит выход и съедает вход.
 */
function ownerDay(objectCode: string) {
  const object = objectByCode.get(objectCode)!
  const recipe = RECIPES.filter(row => row.productionObjectCode === objectCode)
    // Берём самый выгодный рецепт объекта: владелец не станет варить убыточный.
    .map(row => ({ row, margin: recipeMargin(row) }))
    .sort((a, b) => b.margin - a.margin)[0]
  if (!recipe) return { revenue: 0, inputs: 0, salaries: 0, profit: 0, cycles: 0 }

  // Решение заказчика по В11: владелец объекта здесь — не рантье, а игрок,
  // который РАБОТАЕТ НА СВОЁМ ОБЪЕКТЕ САМ. Зарплату он платит себе же из
  // баланса объекта, то есть перекладывает деньги из кармана в карман, и
  // расходом она не является. Настоящая выгода — выход циклов, закрытых его
  // собственным трудом, минус сырьё.
  //
  // Прежняя модель считала объект нанимающим полный штат посторонних и
  // мерила совсем другое: там чужие зарплаты съедали всё.
  //
  // Содержания объекта здесь больше нет (В13): в игре нет ни поля, ни
  // воркера, который бы списывал фиксированную плату за факт владения —
  // maintenanceDebt на объекте это исключительно накопленная зарплата за
  // отработанные смены (work.service.ts, helpers.service.ts), а не отдельный
  // сток. Прежняя строка `OBJECT_DAILY_UPKEEP = 150` была придумана прямо в
  // этом файле и не бралась ни из BalanceConfig, ни из какого-либо реального
  // расхода — комментарий над ней утверждал обратное. Модель мерила не игру.
  const shifts = Math.min(W.dailyShiftLimit, Math.floor(W.dailyShiftMinutes / object.shiftDurationMinutes))
  const labourPerShift = laborFromShift(object.shiftDurationMinutes, workerEfficiency(1))
  const cycles = Math.floor((shifts * labourPerShift) / recipe.row.laborRequired)

  const revenue = cycles * recipe.row.outputAmount * outputPrice(recipe.row)
  const inputs = cycles * recipeInputCost(recipe.row)
  const salaries = 0
  return { revenue, inputs, salaries, cycles, profit: revenue - inputs }
}

/**
 * Цена выхода рецепта.
 *
 * Наценка рынка применяется и к предметам: крафтовую куртку игрок продаёт
 * другому игроку так же выше базовой, как и сырьё. Первая версия множила
 * только ресурсы, и рецепты с предметом на выходе сравнивали рыночные входы
 * с базовым выходом — куртка выглядела убыточной там, где мерка просто была
 * разной.
 */
function outputPrice(recipe: (typeof RECIPES)[number]): number {
  if (recipe.outputResourceCode) {
    return (resourcePrice.get(recipe.outputResourceCode) ?? 0) * MARKET_MULTIPLIER
  }
  return (ITEM_PRICES[recipe.outputItemTemplateCode ?? ''] ?? 0) * MARKET_MULTIPLIER
}

/** Стоимость входов: сырьё владелец тоже покупает у игроков, а не у казны. */
function recipeInputCost(recipe: (typeof RECIPES)[number]): number {
  return (recipe.inputs ?? []).reduce(
    (sum, input) => sum + (resourcePrice.get(input.resourceCode) ?? 0) * MARKET_MULTIPLIER * input.amount, 0)
}

/** Маржа рецепта за цикл — по ней владелец и выбирает, что варить. */
function recipeMargin(recipe: (typeof RECIPES)[number]): number {
  return outputPrice(recipe) * recipe.outputAmount - recipeInputCost(recipe)
}

/**
 * Доход фермы за час внимания: посадил, полил, собрал.
 *
 * Два факта, на которых стояла прежняя версия этой функции, оказались
 * неверны (проверено по коду, 04.09.2026):
 *
 * 1. «Шесть грядок — по числу свободных слотов у новичка». Неправда:
 *    `plotPrice()` в `farm.formulas.ts` даёт бесплатным только первый
 *    слот, второй и третий стоят 1500 ₽ каждый, дальше дороже. У
 *    новичка ровно ОДНА грядка. Сам расчётный пример в
 *    `STAGE3_BALANCE.md` 3.4 тоже считает на одном цикле, не на шести
 *    грядках сразу — предположение «шесть» было придумано прямо здесь.
 * 2. Половина урожая продавалась «по рынку», но по БАЗОВОЙ цене, а не
 *    по рыночной (`price`, без `MARKET_MULTIPLIER`) — несогласованно с
 *    тем, как рынок оценивается везде в этом файле (`outputPrice`).
 *
 * Фикс не переносится: цель 60–80% в `STAGE3_BALANCE.md` 3.4 сама
 * скалькулирована на базовой цене овощей 12 ₽ — а в реальном сиде
 * (`economy-data.ts`) она всегда была 25 ₽, git-история подтверждает,
 * что 12 никогда не было в коде. То есть коридор изначально обоснован
 * числом, которого не было в игре. Честный расчёт (одна грядка,
 * рыночная цена) даёт то, что даёт — смотри итог прогона, коридор не
 * подгонялся под него.
 */
function farmerHour() {
  const crop = CROPS.potato
  const yieldAvg = (crop.yieldMin + crop.yieldMax) / 2
  const price = resourcePrice.get(crop.resourceCode) ?? 0
  const plots = 1
  const gross = yieldAvg * price * plots
  const seeds = crop.seedPrice * plots
  // Госскупка — пол цены, а не канал сбыта (STAGE3_BALANCE 3.4): половина
  // партии по рыночной цене (с той же наценкой, что и везде в этом файле),
  // половина — казне по четверти базовой.
  const sold = gross * 0.5 * MARKET_MULTIPLIER + gross * 0.5 * BalanceConfig.economy.resources.governmentPayoutRate
  return sold - seeds
}

/** Доход бармена за сутки: наценка на еду и баффы. */
/**
 * Доход владельца бара за сутки.
 *
 * Прежняя версия считала «7 предложений по 250 ₽, себестоимость 40%» —
 * ни одно из трёх чисел не совпадает с реальным сидом (проверено
 * 04.09.2026): предложений девять, а не семь (`BAR_OFFERS`), средняя
 * `baseCost` — 120 ₽, а не 250, и себестоимость по рецептам не
 * фиксированные 40%, а своя у каждого напитка. К тому же вычитались
 * «зарплаты» — расход, которого по В11 у владельца, работающего сам,
 * не бывает (та же ошибка, что была в `ownerDay`).
 *
 * Модель по той же логике, что и `ownerDay`: владелец варит сам, в
 * пределах собственной смены, лучший по марже рецепт, продаёт по
 * верхней границе `barPriceRange` (владелец разумно ставит максимум,
 * раз спрос считается данностью — модель не знает толкучки у стойки).
 * Налог и доля владельца — `barSaleSplit`, реальная формула бара.
 */
function barmanDay() {
  const shifts = Math.min(W.dailyShiftLimit, Math.floor(W.dailyShiftMinutes / 60))
  const labourPerShift = laborFromShift(60, workerEfficiency(1))
  const laborAvailable = shifts * labourPerShift

  const candidates = BAR_RECIPES.map(recipe => {
    const offer = BAR_OFFERS.find(o => o.resourceCode === recipe.output)
    // Итоговый напиток продаётся через стойку (barPriceRange/barSaleSplit,
    // налог 20%); промежуточное сырьё (спирт, экстракт) уходит как обычный
    // ресурс — по нему нет отдельной наценки бара.
    const unitPrice = offer
      ? barSaleSplit(barPriceRange(offer.baseCost).max).ownerIncome
      : (resourcePrice.get(recipe.output) ?? 0) * MARKET_MULTIPLIER
    const inputCost = recipe.inputs.reduce(
      (sum, input) => sum + (resourcePrice.get(input.resourceCode) ?? 0) * MARKET_MULTIPLIER * input.amount, 0)
    const marginPerLabor = (recipe.amount * unitPrice - inputCost) / recipe.labor
    return { recipe, unitPrice, inputCost, marginPerLabor }
  }).sort((a, b) => b.marginPerLabor - a.marginPerLabor)[0]

  const cycles = Math.floor(laborAvailable / candidates.recipe.labor)
  const revenue = cycles * candidates.recipe.amount * candidates.unitPrice
  const inputs = cycles * candidates.inputCost
  return revenue - inputs
}

// ── Прогон ───────────────────────────────────────────────────
const workerRate = shiftRate(MID_OBJECT)
const lowRate = shiftRate(LOW_OBJECT)

for (let day = 0; day < days; day++) {
  const worker = fullDayIncome(MID_OBJECT, 2).money * (0.9 + rnd() * 0.2)
  const owner = ownerDay(MID_OBJECT).profit * (0.9 + rnd() * 0.2)
  const farmer = farmerHour() * 6 * (0.9 + rnd() * 0.2)
  const barman = barmanDay() * (0.9 + rnd() * 0.2)
  // Подписчик: свои 16 смен. Помощники дохода не приносят — они работают
  // только на своих объектах, где зарплату платит сам хозяин (решение В10).
  // Подписчик работает на ТОМ ЖЕ объекте: сравнивать 16 смен по получасу с
  // шестью часовыми — сравнивать разные работы, а не подписку с её
  // отсутствием. Бюджет минут у подписчика растёт пропорционально потолку.
  let premium = 0
  const midObject = objectByCode.get(MID_OBJECT)!
  const premiumMinutes = W.dailyShiftMinutes * (P.dailyShiftCap / W.dailyShiftLimit)
  const premiumShifts = Math.min(P.dailyShiftCap, Math.floor(premiumMinutes / midObject.shiftDurationMinutes))
  for (let n = 1; n <= premiumShifts; n++) {
    premium += calcFinalSalary(midObject.baseSalary, 1, 2, 0.5, n)
  }
  const fighter = 15 * ((35 + 75) / 2) * 0.6

  daily.push({ worker, owner, farmer, barman, premium, fighter })

  const income = worker + owner + farmer + barman + premium + fighter
  minted += income
  // Стоки, которые модель знает поимённо: содержание бригад и территорий и
  // комиссия рынка с оборота. Содержания объектов среди них больше нет
  // (В13) — такого стока не существует в игре, см. комментарий в ownerDay.
  //
  // Полной картины денежной массы это НЕ даёт: ремонт, госзакупки, налог
  // продажи и покупки в лавках сюда не входят, потому что их объём зависит
  // от поведения игроков, а не от формул. Поэтому вердикт по инфляции ниже
  // помечен как неизмеренный, а не выставлен зелёным по неполной модели.
  const sinks = 3 * CLAN_MAINTENANCE_DAILY
    + territoryUpkeepPerDay(1) + territoryUpkeepPerDay(2)
    + income * BalanceConfig.economy.market.saleTaxRate
  burned += sinks
  money += income - sinks
  m2.push(money)
}

const avg = (pick: (row: DayReport) => number) =>
  daily.reduce((sum, row) => sum + pick(row), 0) / daily.length

const workerDay = avg(row => row.worker)
const ownerDayAvg = avg(row => row.owner)
const farmerDayAvg = avg(row => row.farmer)
const barmanDayAvg = avg(row => row.barman)
const premiumDayAvg = avg(row => row.premium)

// Часовые ставки для коридоров, привязанных к смене.
// Владелец получает и зарплату (себе же), и выход циклов; наёмный рабочий
// на том же объекте — только зарплату. Сравниваем их дни целиком.
const ownerTotalDay = ownerDayAvg + fullDayIncome(MID_OBJECT, 2).money
const ownerPerHour = ownerTotalDay / (W.dailyShiftMinutes / 60)
const farmerPerHour = farmerDayAvg / 6
const ownerShare = ownerPerHour / workerRate.perHour
const farmerShare = farmerPerHour / workerRate.perHour

// Окупаемость: цена объекта делённая на суточную прибыль владельца.
const payback = Object.fromEntries(
  Object.entries(OBJECT_PRICES).map(([code, price]) => {
    const profit = ownerDay(code).profit
    return [code, profit > 0 ? price / profit : Infinity]
  }),
)
const barPayback = BAR_PRICE / barmanDayAvg

// Доля дохода от бригады: общак наполняется взносами и долей рынка, а
// тратится на содержание. Для игрока это доля в его дневном доходе.
const clanIncomePerMember = (BalanceConfig.economy.market.saleTaxRate * workerDay * 3) / 10
const clanShare = clanIncomePerMember / workerDay

// Доля дохода от территории: бонус района, разложенный на бойца бригады.
const territoryBonusPerMember = (workerDay * 0.05 * 2) / 10
const territoryShare = territoryBonusPerMember / workerDay

const premiumRatio = premiumDayAvg / workerDay
// Прирост считается по положительной массе: если модель увела деньги в
// минус, это ошибка модели, и она должна быть видна отдельно, а не
// превратиться в NaN посреди отчёта.
const m2Positive = m2.every(value => value > 0)
const m2Growth = m2.length > 1 && m2Positive
  ? (m2[m2.length - 1] / m2[0]) ** (1 / m2.length) - 1
  : 0

const payA = Object.values(payback).filter(value => Number.isFinite(value))

/**
 * Наращивает ли передел стоимость.
 *
 * Главная проверка производственной игры, и до сквозного прогона её не делал
 * никто: если цикл стоит дороже, чем даёт, крафтить бессмысленно — выгоднее
 * продать сырьё. Наценка рынка тут ни при чём, она множит обе стороны.
 */
const valueAdded = RECIPES.map(recipe => ({
  code: recipe.code,
  object: recipe.productionObjectCode,
  output: Math.round(outputPrice(recipe) * recipe.outputAmount),
  inputs: Math.round(recipeInputCost(recipe)),
  margin: Math.round(recipeMargin(recipe)),
}))
const destructive = valueAdded.filter(row => row.margin <= 0)

const verdicts = {
  /** Коридор ТЗ Этапа 3: полный день на СРЕДНЕМ переделе. */
  workerDayCorridor: workerDay >= 700 && workerDay <= 900,
  /** Владелец объекта за час — 120–160% от смены наёмного. */
  ownerCorridor: ownerShare >= 1.2 && ownerShare <= 1.6,
  /** Ферма за час внимания — 60–80% от смены. */
  farmCorridor: farmerShare >= 0.6 && farmerShare <= 0.8,
  /** Окупаемость объектов 12–20 суток, бар 18–25. */
  paybackCorridor: payA.every(value => value >= 12 && value <= 20),
  barPaybackCorridor: barPayback >= 18 && barPayback <= 25,
  /** Доля дохода от бригады не выше четверти. */
  clanShareCorridor: clanShare <= 0.25,
  /** Доля дохода от территории не выше 15%. */
  territoryShareCorridor: territoryShare <= 0.15,
  /** Подписчик не выше 130% активного игрока. */
  premiumCorridor: premiumRatio <= 1.3,
  /** Нижний передел беднее среднего: иначе расти незачем. */
  progressionMakesSense: lowRate.perHour < workerRate.perHour,
  /**
   * Денежная масса не разгоняется.
   *
   * Модель считает только названные стоки, поэтому вердикт наблюдательный:
   * он не входит в итог прогона. Полная картина требует ремонта, налогов и
   * покупок в лавках — их объём задаёт поведение игроков, а не формулы, и
   * честно смоделировать это можно только на данных закрытого теста.
   */
  /** Каждый передел наращивает стоимость, а не уничтожает её. */
  chainAddsValue: destructive.length === 0,
}

/** Наблюдения: считаются и показываются, но в итог не входят. */
const observations = {
  m2DailyGrowth: m2Growth,
  m2Positive,
  note: 'денежная масса измерена по неполному набору стоков',
}

const passed = Object.values(verdicts).every(Boolean)

const report = {
  meta: { generatedAt: new Date().toISOString(), days, seed },
  rates: {
    midShiftPerHour: workerRate.perHour,
    lowShiftPerHour: lowRate.perHour,
  },
  income: {
    workerFullDay: workerDay,
    ownerPerDay: ownerDayAvg,
    ownerTotalDay,
    ownerShareOfShift: ownerShare,
    farmerPerHour,
    farmerShareOfShift: farmerShare,
    barmanPerDay: barmanDayAvg,
    premiumPerDay: premiumDayAvg,
    premiumRatio,
  },
  payback: { objects: payback, bar: barPayback },
  shares: { clan: clanShare, territory: territoryShare },
  money: { minted, burned, m2Final: money, dailyGrowth: m2Growth, m2Positive },
  valueAdded,
  destructiveRecipes: destructive,
  verdicts,
  observations,
  passed,
}

if (args.includes('--debug')) {
  for (const code of Object.keys(OBJECT_PRICES)) {
    const d = ownerDay(code)
    console.log(`${code.padEnd(24)} циклов ${String(d.cycles).padStart(3)}  выручка ${String(Math.round(d.revenue)).padStart(6)}  входы ${String(Math.round(d.inputs)).padStart(6)}  зарплаты ${String(Math.round(d.salaries)).padStart(5)}  прибыль ${String(Math.round(d.profit)).padStart(7)}`)
  }
}

const out = resolve(__dirname, '../docs/stage5-full-report.json')
writeFileSync(out, JSON.stringify(report, null, 2), 'utf8')

if (!quiet) {
  console.log('\nСКВОЗНОЙ ПРОГОН БАЛАНСА\n')
  console.log(`Дней ${days}, зерно ${seed}\n`)
  const line = (name: string, value: string, ok: boolean) =>
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(38)} ${value}`)

  line('Полный день, средний передел', `${Math.round(workerDay)} ₽ (коридор 700–900)`, verdicts.workerDayCorridor)
  line('Владелец объекта за час', `${Math.round(ownerShare * 100)}% от смены (120–160)`, verdicts.ownerCorridor)
  line('Ферма за час внимания', `${Math.round(farmerShare * 100)}% от смены (60–80)`, verdicts.farmCorridor)
  line('Окупаемость объектов', `${payA.map(v => Math.round(v)).join(', ')} сут (12–20)`, verdicts.paybackCorridor)
  line('Окупаемость бара', `${Math.round(barPayback)} сут (18–25)`, verdicts.barPaybackCorridor)
  line('Доля дохода от бригады', `${Math.round(clanShare * 100)}% (≤25)`, verdicts.clanShareCorridor)
  line('Доля дохода от территории', `${Math.round(territoryShare * 100)}% (≤15)`, verdicts.territoryShareCorridor)
  line('Подписчик против игрока', `${Math.round(premiumRatio * 100)}% (≤130)`, verdicts.premiumCorridor)
  line('Нижний передел беднее среднего', `${Math.round(lowRate.perHour)} < ${Math.round(workerRate.perHour)} ₽/ч`, verdicts.progressionMakesSense)
  console.log(`  --   Прирост денежной массы                ${(m2Growth * 100).toFixed(2)}%/сут — наблюдение, стоки учтены не все`)
  line('Передел наращивает стоимость',
    destructive.length === 0 ? 'все рецепты в плюс' : `убыточных рецептов ${destructive.length}`,
    verdicts.chainAddsValue)

  if (destructive.length > 0) {
    console.log('')
    console.log('  Рецепты, уничтожающие стоимость (выход дешевле входов):')
    for (const row of destructive) {
      console.log(`    ${row.code.padEnd(22)} ${row.object.padEnd(22)} выход ${String(row.output).padStart(5)} ₽  входы ${String(row.inputs).padStart(5)} ₽  маржа ${row.margin}`)
    }
  }

  console.log(`\nИТОГ: ${passed ? 'все коридоры сошлись' : 'есть несошедшиеся коридоры'}`)
  console.log(`Отчёт: ${out}\n`)
}

process.exit(passed ? 0 : 1)
