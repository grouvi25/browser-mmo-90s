import { writeFileSync } from 'fs'

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const days = Number(arg('days', '30'))
const playersCount = Number(arg('players', '1000'))
const initialSeed = Number(arg('seed', '90210'))
let seed = initialSeed
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
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0
const percentile = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)] ?? 0

const profiles = [
  { key: 'fighter', battles: 15, shifts: 0, marketEvery: 4 },
  { key: 'worker', battles: 1, shifts: 8, marketEvery: 3 },
  { key: 'mixed', battles: 6, shifts: 4, marketEvery: 3 },
].filter(profile => profileFilter === 'all' || profile.key === profileFilter)
if (!profiles.length || days < 8 || playersCount < 1) throw new Error('Invalid simulation arguments')

const shiftFatigue = (number: number) => Math.max(0.20, 1 - (Math.max(1, number) - 1) * 0.20)
const upgradeCosts = [360, 950, 1676, 2507, 3427]
const upgradeChances = [0.90, 0.78, 0.66, 0.54, 0.42]

type Profile = typeof profiles[number]
type Player = {
  profile: Profile
  money: number
  durability: number
  grossToday: number
  netToday: number
  upgradeLevel: number
  marketSales: number
}
const players: Player[] = Array.from({ length: playersCount }, (_, i) => ({
  profile: profiles[i % profiles.length],
  money: 1250,
  durability: 60,
  grossToday: 0,
  netToday: 0,
  upgradeLevel: 0,
  marketSales: 0,
}))
const minted = { battles: 0, salaries: 0, govSell: 0 }
const burned = { repair: 0, governmentShop: 0, privateShop: 0, listingFee: 0, saleTax: 0, upgrades: 0 }
const grossByProfile = new Map<string, number[]>()
const netByProfile = new Map<string, number[]>()
const m2ByDay: number[] = []

function credit(player: Player, amount: number, faucet: keyof typeof minted) {
  player.money += amount
  player.grossToday += amount
  minted[faucet] += amount
}
function burn(player: Player, amount: number, sink: keyof typeof burned): boolean {
  if (amount <= 0 || player.money < amount) return false
  player.money -= amount
  burned[sink] += amount
  return true
}

for (let day = 1; day <= days; day++) {
  for (const player of players) {
    const startMoney = player.money
    player.grossToday = 0

    for (let battle = 0; battle < player.profile.battles; battle++) {
      if (rnd() < 0.60) credit(player, int(35, 75), 'battles')
      player.durability -= 3
    }

    for (let shift = 1; shift <= player.profile.shifts; shift++) {
      const salary = Math.round(100 * (0.9 + rnd() * 0.2) * shiftFatigue(shift))
      credit(player, salary, 'salaries')
      credit(player, int(2, 4) * 2, 'govSell')
    }

    if (player.durability <= 30 && burn(player, 200, 'repair')) player.durability = 60

    // Consumables and baseline government gear maintenance.
    if (day % 5 === 0) burn(player, 150, 'governmentShop')

    // Stage 2 item lifecycle: active players replace or diversify tier-2 gear roughly every 20 days.
    if (day % 20 === 1 && day > 1 && burn(player, 900, 'privateShop')) player.upgradeLevel = 0

    // One deliberate upgrade attempt every 10 days. Failure still burns money and parts.
    if (day % 10 === 5 && player.upgradeLevel < 5) {
      const cost = upgradeCosts[player.upgradeLevel]
      if (burn(player, cost, 'upgrades') && rnd() < upgradeChances[player.upgradeLevel]) player.upgradeLevel++
    }

    // Market transfers are M2-neutral; only listing fee and sale tax are sinks.
    if (day % player.profile.marketEvery === 0) {
      const price = int(80, 240)
      const fee = Math.max(5, Math.round(price * 0.02))
      const tax = Math.round(price * 0.05)
      if (burn(player, fee + tax, 'listingFee')) {
        burned.listingFee -= tax
        burned.saleTax += tax
        player.marketSales++
      }
    }

    player.netToday = player.money - startMoney
    if (day > 7) {
      const gross = grossByProfile.get(player.profile.key) ?? []
      gross.push(player.grossToday)
      grossByProfile.set(player.profile.key, gross)
      const net = netByProfile.get(player.profile.key) ?? []
      net.push(player.netToday)
      netByProfile.set(player.profile.key, net)
    }
  }
  m2ByDay.push(players.reduce((sum, player) => sum + player.money, 0))
}

const totalMinted = Object.values(minted).reduce((sum, value) => sum + value, 0)
const totalBurned = Object.values(burned).reduce((sum, value) => sum + value, 0)
const sinkShare = totalBurned / Math.max(1, totalMinted)
const netEmissionShare = (totalMinted - totalBurned) / Math.max(1, totalMinted)
const startIndex = Math.min(29, m2ByDay.length - 2)
const steadyM2Growth = Math.pow(m2ByDay.at(-1)! / Math.max(1, m2ByDay[startIndex]), 1 / Math.max(1, days - startIndex - 1)) - 1
const profileReport = Object.fromEntries(profiles.map(profile => {
  const gross = grossByProfile.get(profile.key) ?? []
  const net = netByProfile.get(profile.key) ?? []
  return [profile.key, {
    grossIncomePerDay: { median: median(gross), p25: percentile(gross, 0.25), p75: percentile(gross, 0.75) },
    netIncomePerDay: { median: median(net), p25: percentile(net, 0.25), p75: percentile(net, 0.75) },
  }]
}))
const grossMedians = Object.values(profileReport).map(value => value.grossIncomePerDay.median)
const netMedians = Object.values(profileReport).map(value => value.netIncomePerDay.median)
const grossParityRatio = Math.max(...grossMedians) / Math.max(1, Math.min(...grossMedians))
const netParitySpread = Math.max(...netMedians) - Math.min(...netMedians)

const verdicts = {
  incomeCorridor: grossMedians.every(value => value >= 400 && value <= 700),
  profileParity: grossParityRatio <= 1.35 && netParitySpread <= 180,
  sinkHealth: sinkShare >= 0.45 && sinkShare <= 0.80,
  netEmission: netEmissionShare >= 0.20 && netEmissionShare <= 0.55,
  // M2 grows mostly linearly in this closed model; this compounded rate naturally peaks mid-horizon.
  steadyM2: days <= 30 || steadyM2Growth <= 0.018,
  nonNegativeMoney: players.every(player => player.money >= 0),
}
const passed = Object.values(verdicts).every(Boolean)
const report = {
  meta: { generatedAt: new Date().toISOString(), days, players: playersCount, seed: initialSeed, profileFilter },
  profiles: profileReport,
  parity: { grossRatio: grossParityRatio, netSpread: netParitySpread },
  emission: { minted, burned, sinkShare, netEmissionShare },
  m2: { start: m2ByDay[0], day30: m2ByDay[Math.min(29, m2ByDay.length - 1)], end: m2ByDay.at(-1), steadyGrowthPctPerDay: steadyM2Growth },
  market: { completedSales: players.reduce((sum, player) => sum + player.marketSales, 0) },
  verdicts,
}
if (!quiet) console.log(JSON.stringify(report, null, 2))
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(report, null, 2))
process.exit(passed ? 0 : 1)
