import { writeFileSync } from 'fs'

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const days = Number(arg('days', '30'))
const playersCount = Number(arg('players', '300'))
let seed = Number(arg('seed', '90210'))
const profileFilter = arg('profile', 'all')
const jsonPath = arg('json', '')
const quiet = process.argv.includes('--quiet')
const rnd = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min
const profiles = [
  { key: 'fighter', battles: 15, shifts: 0 },
  { key: 'worker', battles: 1, shifts: 8 },
  { key: 'mixed', battles: 6, shifts: 4 },
].filter(p => profileFilter === 'all' || p.key === profileFilter)
if (!profiles.length || days < 8 || playersCount < 1) throw new Error('Invalid simulation arguments')

type Player = { profile: typeof profiles[number]; money: number; durability: number; daily: number }
const players: Player[] = Array.from({ length: playersCount }, (_, i) => ({
  profile: profiles[i % profiles.length], money: 1250, durability: 60, daily: 0,
}))
const minted = { battles: 0, salaries: 0, govSell: 0 }
const burned = { repair: 0, shops: 0, listingFee: 0, saleTax: 0, upgrades: 0 }
const income = new Map<string, number[]>()
const m2ByDay: number[] = []
for (let day = 1; day <= days; day++) {
  for (const p of players) {
    p.daily = 0
    for (let i = 0; i < p.profile.battles; i++) {
      if (rnd() < 0.60) { const reward = int(25, 60); p.money += reward; p.daily += reward; minted.battles += reward }
      p.durability -= 3
    }
    for (let i = 0; i < p.profile.shifts; i++) {
      const salary = Math.round(100 * (0.9 + rnd() * 0.2))
      p.money += salary; p.daily += salary; minted.salaries += salary
      const gov = int(2, 4) * 2; p.money += gov; p.daily += gov; minted.govSell += gov
    }
    if (p.durability <= 30) {
      const repair = 200
      if (p.money >= repair) { p.money -= repair; p.durability = 60; burned.repair += repair }
    }
    if (day % 5 === 0 && p.money > 700) { p.money -= 220; burned.shops += 220 }
    if (day % 7 === 0 && p.money > 1000) { p.money -= 75; burned.upgrades += 75 }
    if (day > 7) { const arr = income.get(p.profile.key) ?? []; arr.push(p.daily); income.set(p.profile.key, arr) }
  }
  m2ByDay.push(players.reduce((sum, p) => sum + p.money, 0))
}
const median = (xs: number[]) => [...xs].sort((a,b) => a-b)[Math.floor(xs.length / 2)] ?? 0
const totalMinted = Object.values(minted).reduce((a,b) => a+b, 0)
const totalBurned = Object.values(burned).reduce((a,b) => a+b, 0)
const sinkShare = totalBurned / Math.max(1, totalMinted)
const startIndex = Math.min(7, m2ByDay.length - 2)
const m2Growth = Math.pow(m2ByDay.at(-1)! / Math.max(1, m2ByDay[startIndex]), 1 / Math.max(1, days - startIndex - 1)) - 1
const profileReport = Object.fromEntries(profiles.map(p => [p.key, { medianIncomePerDay: median(income.get(p.key) ?? []) }]))
const incomeOk = Object.values(profileReport).every(v => v.medianIncomePerDay >= 300 && v.medianIncomePerDay <= 1200)
const sinkOk = sinkShare >= 0.15
const m2Ok = m2Growth <= 0.05
const report = { meta: { days, players: playersCount, seed, profileFilter }, profiles: profileReport, emission: { minted, burned, sinkShare }, m2: { start: m2ByDay[0], end: m2ByDay.at(-1), growthPctPerDay: m2Growth }, verdicts: { incomeOk, sinkOk, m2Ok } }
if (!quiet) console.log(JSON.stringify(report, null, 2))
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(report, null, 2))
process.exit(incomeOk && sinkOk && m2Ok ? 0 : 1)
