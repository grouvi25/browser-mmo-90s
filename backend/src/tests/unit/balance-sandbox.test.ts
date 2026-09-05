import { describe, expect, it } from 'vitest'
import { simulateBalanceSandbox, type BalanceSandboxInput } from '../../modules/balance-sandbox/balance-sandbox.service'

const base: BalanceSandboxInput = {
  days: 30,
  players: 300,
  salary: 100,
  battleReward: 55,
  repairCost: 200,
  marketPrice: 160,
  shiftMinutes: 45,
  winRate: 60,
}

describe('balance sandbox', () => {
  it('is deterministic and uses three production profiles', () => {
    const first = simulateBalanceSandbox(base)
    const second = simulateBalanceSandbox(base)
    expect(first).toEqual(second)
    expect(first.rows.map(row => row.profile)).toEqual(['fighter', 'worker', 'mixed'])
    expect(first.meta.source).toContain('BalanceConfig')
  })

  it('reacts to salary without changing fighter income', () => {
    const first = simulateBalanceSandbox(base)
    const second = simulateBalanceSandbox({ ...base, salary: 220 })
    expect(second.rows[1].money).toBeGreaterThan(first.rows[1].money)
    expect(second.rows[0].money).toBe(first.rows[0].money)
  })

  it('caps shifts by the 360 minute daily budget', () => {
    const result = simulateBalanceSandbox({ ...base, shiftMinutes: 90 })
    const worker = result.rows.find(row => row.profile === 'worker')
    expect(worker?.shiftsPerDay).toBe(4)
    expect(worker?.minutesPerDay).toBe(360)
    expect(result.meta.limits).toEqual({ shifts: 12, minutes: 360 })
  })

  it('reports unhealthy sinks instead of silently passing the scenario', () => {
    const result = simulateBalanceSandbox(base)
    expect(result.verdicts.sinkHealth).toBe(false)
    expect(result.recommendations.some(note => note.includes('стоков'))).toBe(true)
  })

  // Разбивка, разошедшаяся с итогом, хуже отсутствия разбивки: по ней
  // будут чинить не то. Поэтому итог обязан быть суммой именно статей.
  it('keeps the named ledger equal to the totals it reports', () => {
    const result = simulateBalanceSandbox(base)
    for (const row of result.rows) {
      const income = row.faucets.reduce((sum, line) => sum + line.perDay, 0)
      const sink = row.sinks.reduce((sum, line) => sum + line.perDay, 0)
      expect(Math.abs(income - sink - row.netPerDay)).toBeLessThanOrEqual(row.faucets.length + row.sinks.length)
    }
  })

  it('counts the free garden plot for every profile', () => {
    const without = simulateBalanceSandbox({ ...base, farmPlots: 0 })
    const with1 = simulateBalanceSandbox({ ...base, farmPlots: 1 })
    // Огород доступен всем, включая бойца без единой смены.
    expect(with1.rows[0].money).toBeGreaterThan(without.rows[0].money)
    expect(with1.rows[0].faucets.some(line => line.label.includes('огород'))).toBe(true)
    expect(without.rows[0].faucets.some(line => line.label.includes('огород'))).toBe(false)
  })

  it('ranks the levers that actually move the sink share', () => {
    const result = simulateBalanceSandbox(base)
    expect(result.sensitivity.length).toBeGreaterThan(0)
    const impacts = result.sensitivity.map(row => row.impact)
    expect([...impacts].sort((first, second) => second - first)).toEqual(impacts)
  })
})
