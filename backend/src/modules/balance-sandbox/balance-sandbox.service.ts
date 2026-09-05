import { z } from 'zod'
import { BalanceConfig } from '../../config/balance.config'
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
}

type ProfileKey = 'fighter' | 'worker' | 'mixed'
type TimelinePoint = { day: number; money: number }

const profileEntries = Object.entries(BalanceConfig.economy.simulation.profiles) as Array<
  [ProfileKey, { battles: number; shifts: number; marketEveryDays: number }]
>

export function simulateBalanceSandbox(input: BalanceSandboxInput) {
  const economy = BalanceConfig.economy
  const work = economy.work
  const winRate = input.winRate / 100
  const shiftsByMinutes = Math.floor(work.dailyShiftMinutes / input.shiftMinutes)

  const rows = profileEntries.map(([profile, plan]) => {
    const shiftsPerDay = Math.min(plan.shifts, work.dailyShiftLimit, shiftsByMinutes)
    const minutesPerDay = shiftsPerDay * input.shiftMinutes
    const workPerDay = Array.from(
      { length: shiftsPerDay },
      (_, index) => input.salary * dailyShiftSalaryCoeff(index + 1),
    ).reduce((sum, salary) => sum + salary, 0)

    let money: number = BalanceConfig.character.startMoney
    let minted = 0
    let burned = 0
    const timeline: TimelinePoint[] = [{ day: 0, money }]

    for (let day = 1; day <= input.days; day++) {
      const battleIncome = plan.battles * input.battleReward * winRate
      const resourceIncome = shiftsPerDay * 24 * economy.resources.governmentPayoutRate
      const marketIncome = day % plan.marketEveryDays === 0 ? input.marketPrice : 0
      const income = battleIncome + workPerDay + resourceIncome + marketIncome

      const marketSink = day % plan.marketEveryDays === 0
        ? calcListingFee(input.marketPrice) + calcSaleTax(input.marketPrice)
        : 0
      const durabilityWindow = Math.max(
        1,
        economy.simulation.repairedDurability - economy.simulation.repairTriggerDurability,
      )
      const repairSink = plan.battles
        * economy.simulation.weaponDurabilityLossPerFight
        / durabilityWindow
        * input.repairCost
      const consumables = day % 5 === 0 ? economy.simulation.governmentMaintenanceCost : 0
      const battleWear = plan.battles * 1.8
      const sink = marketSink + repairSink + consumables + battleWear

      minted += income
      burned += sink
      money = Math.max(0, money + income - sink)
      timeline.push({ day, money: Math.round(money) })
    }

    return {
      profile,
      money: Math.round(money),
      netPerDay: Math.round((minted - burned) / input.days),
      minted: Math.round(minted * input.players / 3),
      burned: Math.round(burned * input.players / 3),
      sinkShare: burned / Math.max(1, minted),
      shiftsPerDay,
      minutesPerDay,
      timeline,
    }
  })

  const minted = rows.reduce((sum, row) => sum + row.minted, 0)
  const burned = rows.reduce((sum, row) => sum + row.burned, 0)
  const sinkShare = burned / Math.max(1, minted)
  const netPerDay = rows.map(row => row.netPerDay)
  const initialM2 = BalanceConfig.character.startMoney * input.players
  const finalM2 = initialM2 + minted - burned
  const dailyM2Growth = Math.pow(Math.max(1, finalM2) / Math.max(1, initialM2), 1 / input.days) - 1

  const verdicts = {
    profileParity: Math.max(...netPerDay) - Math.min(...netPerDay) <= 180,
    sinkHealth: sinkShare >= economy.alerts.minSinkShare && sinkShare <= 0.8,
    m2Growth: dailyM2Growth <= economy.alerts.maxDailyM2Growth,
    nonNegative: rows.every(row => row.money >= 0),
  }

  const recommendations: string[] = []
  if (!verdicts.sinkHealth) {
    recommendations.push(
      sinkShare < economy.alerts.minSinkShare
        ? `Денежных стоков мало: ${Math.round(sinkShare * 100)}% при минимуме ${Math.round(economy.alerts.minSinkShare * 100)}%.`
        : 'Денежные стоки забирают больше 80% оборота.',
    )
  }
  if (!verdicts.profileParity) recommendations.push('Доход игровых профилей расходится больше чем на 180 ₽ в день.')
  if (!verdicts.m2Growth) recommendations.push(`Денежная масса растёт на ${(dailyM2Growth * 100).toFixed(1)}% в день.`)
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
    },
    input,
    rows,
    verdicts,
    recommendations,
    totals: {
      sinkShare,
      minted,
      burned,
      dailyM2Growth,
      finalM2: Math.round(finalM2),
    },
  }
}
