// =============================================================
// БАЛАНС-ЛАБОРАТОРИЯ
//
// Считает, что будет с деньгами игроков при заданных коэффициентах.
//
// Чего здесь не было и почему это важно:
//
//  * РАЗБИВКИ. Модель выдавала «напечатано столько, сожжено столько» —
//    и всё. Увидев, что стоков мало, администратор не мог узнать, каких
//    именно: чинить приходилось наугад. Теперь каждый профиль отдаёт
//    список статей дохода и расхода по именам;
//  * ОГОРОДА. Третий источник дохода в игре — грядки, и первая из них
//    бесплатна, то есть доступна каждому. Модель его не знала вовсе,
//    занижая доход всех профилей;
//  * ЧУВСТВИТЕЛЬНОСТИ. «Стоков мало» не говорит, за какую ручку тянуть.
//    Прогон повторяется с каждым параметром, сдвинутым на ±20%, и
//    показывает, что двигает итог сильнее всего. Ради этого и нужна
//    лаборатория: калькулятор считает, лаборатория подсказывает.
//
// Расчёт остаётся чистым: ни базы, ни времени, ни случайностей — при
// одном входе всегда один выход, иначе сравнивать прогоны нельзя.
// =============================================================
import { z } from 'zod'
import { BalanceConfig } from '../../config/balance.config'
import { CROPS, type CropCode } from '../farm/farm.formulas'
import { calcListingFee, calcSaleTax } from '../market/market.formulas'
import { dailyShiftSalaryCoeff } from '../work/work.formulas'

/** Границы входа. Живут рядом с расчётом, потому что дверей две — игровая
    ручка и админская, — а правило проверки должно быть одно. */
export const BalanceSandboxSchema = z.object({
  days: z.number().int().min(8).max(365),
  players: z.number().int().min(3).max(10_000),
  salary: z.number().int().min(1).max(5_000),
  battleReward: z.number().int().min(0).max(5_000),
  repairCost: z.number().int().min(0).max(10_000),
  marketPrice: z.number().int().min(1).max(1_000_000),
  shiftMinutes: z.number().int().min(30).max(90),
  winRate: z.number().int().min(10).max(95),
  // Огород. Поля необязательные: у песочницы две двери, и старый клиент
  // не должен ломаться о новый параметр.
  farmPlots: z.number().int().min(0).max(12).optional(),
  farmCrop: z.enum(['dill', 'potato', 'hops', 'sunflower', 'tobacco']).optional(),
  farmChecksPerDay: z.number().int().min(0).max(12).optional(),
  /** Базовая цена ресурса с грядки. Отдельным параметром, потому что
   *  урожай продают государству по ней же, и вся выгода огорода висит
   *  ровно на этом числе. */
  cropPrice: z.number().int().min(1).max(10_000).optional(),
})

export interface BalanceSandboxInput {
  days: number
  players: number
  salary: number
  battleReward: number
  repairCost: number
  marketPrice: number
  shiftMinutes: number
  winRate: number
  farmPlots?: number
  farmCrop?: CropCode
  farmChecksPerDay?: number
  cropPrice?: number
}

type ProfileKey = 'fighter' | 'worker' | 'mixed'
type TimelinePoint = { day: number; money: number }

/** Статья дохода или расхода: сумма без названия ничего не чинит. */
export interface LedgerLine {
  label: string
  perDay: number
  /** Формула в разделе «Баланс», которой эта статья управляется. */
  formula: string
}

const profileEntries = Object.entries(BalanceConfig.economy.simulation.profiles) as Array<
  [ProfileKey, { battles: number; shifts: number; marketEveryDays: number }]
>

const DEFAULT_FARM = { plots: 1, crop: 'potato' as CropCode, checks: 3 }

/** Совет с кодом профиля вместо имени читается как отладочный вывод. */
const PROFILE_TITLE: Record<ProfileKey, string> = {
  fighter: 'Боец', worker: 'Рабочий', mixed: 'Смешанный',
}

/** Сколько урожаев в сутки реально снимут: не больше, чем растёт, и не
 *  больше, чем игрок заходит в игру. */
function harvestsPerDay(crop: CropCode, checks: number): number {
  return Math.min(Math.floor((24 * 60) / CROPS[crop].minutes), checks)
}

function runSimulation(input: BalanceSandboxInput) {
  const economy = BalanceConfig.economy
  const work = economy.work
  const winRate = input.winRate / 100
  const shiftsByMinutes = Math.floor(work.dailyShiftMinutes / input.shiftMinutes)

  const plots = input.farmPlots ?? DEFAULT_FARM.plots
  const crop = input.farmCrop ?? DEFAULT_FARM.crop
  const checks = input.farmChecksPerDay ?? DEFAULT_FARM.checks
  const cropPrice = input.cropPrice ?? 25
  const cycles = harvestsPerDay(crop, checks)
  const averageYield = (CROPS[crop].yieldMin + CROPS[crop].yieldMax) / 2
  const farmIncome = plots * cycles * averageYield * cropPrice
  const seedCost = plots * cycles * CROPS[crop].seedPrice

  const rows = profileEntries.map(([profile, plan]) => {
    const shiftsPerDay = Math.min(plan.shifts, work.dailyShiftLimit, shiftsByMinutes)
    const minutesPerDay = shiftsPerDay * input.shiftMinutes
    const workPerDay = Array.from(
      { length: shiftsPerDay },
      (_, index) => input.salary * dailyShiftSalaryCoeff(index + 1),
    ).reduce((sum, salary) => sum + salary, 0)

    const battleIncome = plan.battles * input.battleReward * winRate
    const resourceIncome = shiftsPerDay * 24 * economy.resources.governmentPayoutRate
    const marketIncomePerDay = input.marketPrice / plan.marketEveryDays

    const marketSinkPerDay =
      (calcListingFee(input.marketPrice) + calcSaleTax(input.marketPrice)) / plan.marketEveryDays
    const durabilityWindow = Math.max(
      1,
      economy.simulation.repairedDurability - economy.simulation.repairTriggerDurability,
    )
    const repairSink = plan.battles
      * economy.simulation.weaponDurabilityLossPerFight
      / durabilityWindow
      * input.repairCost
    const consumablesPerDay = economy.simulation.governmentMaintenanceCost / 5
    const battleWear = plan.battles * 1.8

    // Именованные статьи. Ровно из них складываются income и sink ниже:
    // расхождение между «итогом» и «разбивкой» было бы хуже отсутствия
    // разбивки, поэтому суммируем именно эти списки.
    const faucets: LedgerLine[] = [
      { label: 'Зарплата за смены', perDay: workPerDay, formula: 'work.salary' },
      { label: 'Награда за бои', perDay: battleIncome, formula: 'exp.battle' },
      { label: 'Сдача ресурсов государству', perDay: resourceIncome, formula: 'money.government' },
      { label: 'Продажи на рынке', perDay: marketIncomePerDay, formula: 'money.market' },
      { label: 'Урожай с огорода', perDay: farmIncome, formula: 'money.government' },
    ].filter(line => line.perDay > 0)

    const sinks: LedgerLine[] = [
      { label: 'Ремонт вещей', perDay: repairSink, formula: 'money.repair' },
      { label: 'Налоги и сборы рынка', perDay: marketSinkPerDay, formula: 'money.market' },
      { label: 'Расходники и содержание', perDay: consumablesPerDay, formula: 'money.government' },
      { label: 'Износ снаряжения', perDay: battleWear, formula: 'money.repair' },
      { label: 'Семена', perDay: seedCost, formula: 'money.government' },
    ].filter(line => line.perDay > 0)

    const income = faucets.reduce((sum, line) => sum + line.perDay, 0)
    const sink = sinks.reduce((sum, line) => sum + line.perDay, 0)

    let money: number = BalanceConfig.character.startMoney
    const timeline: TimelinePoint[] = [{ day: 0, money }]
    for (let day = 1; day <= input.days; day++) {
      money = Math.max(0, money + income - sink)
      timeline.push({ day, money: Math.round(money) })
    }

    const minted = income * input.days
    const burned = sink * input.days

    return {
      profile,
      money: Math.round(money),
      netPerDay: Math.round(income - sink),
      minted: Math.round(minted * input.players / 3),
      burned: Math.round(burned * input.players / 3),
      sinkShare: burned / Math.max(1, minted),
      shiftsPerDay,
      minutesPerDay,
      faucets: faucets.map(line => ({ ...line, perDay: Math.round(line.perDay) })),
      sinks: sinks.map(line => ({ ...line, perDay: Math.round(line.perDay) })),
      timeline,
    }
  })

  const minted = rows.reduce((sum, row) => sum + row.minted, 0)
  const burned = rows.reduce((sum, row) => sum + row.burned, 0)
  const sinkShare = burned / Math.max(1, minted)
  const initialM2 = BalanceConfig.character.startMoney * input.players
  const finalM2 = initialM2 + minted - burned
  const dailyM2Growth = Math.pow(Math.max(1, finalM2) / Math.max(1, initialM2), 1 / input.days) - 1

  return { rows, minted, burned, sinkShare, finalM2, dailyM2Growth, farm: { plots, crop, cycles } }
}

/** Ручки, которые лаборатория крутит сама, проверяя чувствительность. */
const KNOBS: { key: keyof BalanceSandboxInput; label: string }[] = [
  { key: 'salary', label: 'Зарплата за смену' },
  { key: 'battleReward', label: 'Награда за бой' },
  { key: 'repairCost', label: 'Стоимость ремонта' },
  { key: 'marketPrice', label: 'Цена сделки на рынке' },
  { key: 'winRate', label: 'Доля побед' },
  { key: 'cropPrice', label: 'Цена урожая' },
]

export function simulateBalanceSandbox(input: BalanceSandboxInput) {
  const economy = BalanceConfig.economy
  const work = economy.work
  const shiftsByMinutes = Math.floor(work.dailyShiftMinutes / input.shiftMinutes)
  const base = runSimulation(input)

  // Чувствительность: сдвигаем каждую ручку на ±20% и смотрим, насколько
  // уезжает доля стоков. Без этого совет «поднимите стоки» не отвечает на
  // единственный важный вопрос — какую именно ручку крутить.
  const sensitivity = KNOBS.map(knob => {
    const current = (input[knob.key] as number | undefined) ?? (knob.key === 'cropPrice' ? 25 : 0)
    if (!current) return null
    const up = runSimulation({ ...input, [knob.key]: Math.round(current * 1.2) })
    const down = runSimulation({ ...input, [knob.key]: Math.max(1, Math.round(current * 0.8)) })
    return {
      key: knob.key,
      label: knob.label,
      current,
      sinkShareUp: up.sinkShare,
      sinkShareDown: down.sinkShare,
      // Насколько доля стоков вообще реагирует на эту ручку. По этому
      // числу список и сортируется: сверху то, что решает.
      impact: Math.abs(up.sinkShare - down.sinkShare),
    }
  })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((first, second) => second.impact - first.impact)

  const netPerDay = base.rows.map(row => row.netPerDay)
  const verdicts = {
    profileParity: Math.max(...netPerDay) - Math.min(...netPerDay) <= 180,
    sinkHealth: base.sinkShare >= economy.alerts.minSinkShare && base.sinkShare <= 0.8,
    m2Growth: base.dailyM2Growth <= economy.alerts.maxDailyM2Growth,
    nonNegative: base.rows.every(row => row.money >= 0),
  }

  const recommendations: string[] = []
  if (!verdicts.sinkHealth) {
    const lever = sensitivity[0]
    const which = lever ? ` Сильнее всего на это влияет «${lever.label}».` : ''
    recommendations.push(
      base.sinkShare < economy.alerts.minSinkShare
        ? `Денежных стоков мало: ${Math.round(base.sinkShare * 100)}% при минимуме ${Math.round(economy.alerts.minSinkShare * 100)}%.${which}`
        : `Денежные стоки забирают больше 80% оборота.${which}`,
    )
  }
  if (!verdicts.profileParity) {
    const best = base.rows.reduce((a, b) => (a.netPerDay > b.netPerDay ? a : b))
    const worst = base.rows.reduce((a, b) => (a.netPerDay < b.netPerDay ? a : b))
    recommendations.push(
      `Доход профилей расходится на ${best.netPerDay - worst.netPerDay} ₽ в день: «${PROFILE_TITLE[best.profile]}» против «${PROFILE_TITLE[worst.profile]}». Играть будут за первого.`,
    )
  }
  if (!verdicts.m2Growth) {
    recommendations.push(`Денежная масса растёт на ${(base.dailyM2Growth * 100).toFixed(1)}% в день — это инфляция.`)
  }
  if (shiftsByMinutes < work.dailyShiftLimit) {
    recommendations.push(`При смене ${input.shiftMinutes} мин лимит времени разрешает не больше ${shiftsByMinutes} смен в день.`)
  }

  return {
    meta: {
      source: 'BalanceConfig.economy + production formulas',
      generatedAt: new Date(0).toISOString(),
      limits: { shifts: work.dailyShiftLimit, minutes: work.dailyShiftMinutes },
      targets: {
        minSinkShare: economy.alerts.minSinkShare,
        maxDailyM2Growth: economy.alerts.maxDailyM2Growth,
      },
      farm: base.farm,
      crops: Object.entries(CROPS).map(([code, crop]) => ({
        code, name: crop.name, minutes: crop.minutes, seedPrice: crop.seedPrice,
      })),
    },
    input,
    rows: base.rows,
    sensitivity,
    verdicts,
    recommendations,
    totals: {
      sinkShare: base.sinkShare,
      minted: base.minted,
      burned: base.burned,
      dailyM2Growth: base.dailyM2Growth,
      finalM2: Math.round(base.finalM2),
    },
  }
}
