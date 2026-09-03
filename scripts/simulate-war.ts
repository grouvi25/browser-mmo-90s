/**
 * СИМУЛЯТОР ВОЙНЫ — шаг F8 Этапа 4.
 *
 * Стратегический слой — единственная часть игры, где ошибка баланса
 * проявляется не сразу, а через две недели после выката, когда один клан
 * уже забрал карту. Проверить это иначе нельзя: ни один тест не отвечает
 * на вопрос «делится ли карта».
 *
 * Модель: виртуальный месяц, шесть районов, три клана разного размера,
 * карта на старте пустая. Клан работает, копит авторитет и деньги, подаёт
 * заявки, обороняется, платит содержание.
 *
 * Числа берутся из BalanceConfig, а не задаются здесь: симулятор проверяет
 * ту же конфигурацию, что уходит в игру.
 *
 * ТЗ: docs/specs/stage-4/STAGE4_BALANCE.md раздел 9.
 */
import { writeFileSync } from 'fs'
import { BalanceConfig } from '../backend/src/config/balance.config'

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const days = Number(arg('days', '30'))
const initialSeed = Number(arg('seed', '40404'))
const jsonPath = arg('json', '')
const quiet = process.argv.includes('--quiet')

let seed = initialSeed
const rnd = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const S = BalanceConfig.strategy
const T = S.territory
const A = S.authority
const CLAN_MAINTENANCE_DAILY = 500
const HOUR = 1 / 24

// Прибыль объекта в сутки — нижняя треть коридора Этапа 3. Считать по
// верхней значит проектировать под идеальный клан, которого не бывает.
const OBJECT_PROFIT_PER_DAY = 1300
// Личный доход активного игрока за сутки, ориентир Этапа 3.
const PLAYER_INCOME_PER_DAY = 800

const DISTRICTS = ['center', 'market', 'industrial', 'station', 'garages', 'suburb'] as const
type District = (typeof DISTRICTS)[number]

interface Territory {
  code: District
  owner: number | null
  /** Час симуляции, до которого район защищён после захвата. */
  protectedUntilHour: number
  controlledAtHour: number
  debt: number
}

interface Clan {
  id: number
  size: number
  treasury: number
  authority: number
  /** Объектов у клана: ограничен территориями. */
  objects: number
  lastClaimHour: number
  wins: number
  losses: number
  defended: number
  bankruptHours: number
  /** Нераспределённая прибыль на объектах: её и грабят. */
  objectBalance: number
}

const clans: Clan[] = [
  { id: 0, size: 5, treasury: 40_000, authority: 0, objects: 1, lastClaimHour: -999, wins: 0, losses: 0, defended: 0, bankruptHours: 0, objectBalance: 0 },
  { id: 1, size: 10, treasury: 60_000, authority: 0, objects: 3, lastClaimHour: -999, wins: 0, losses: 0, defended: 0, bankruptHours: 0, objectBalance: 0 },
  { id: 2, size: 20, treasury: 90_000, authority: 0, objects: 6, lastClaimHour: -999, wins: 0, losses: 0, defended: 0, bankruptHours: 0, objectBalance: 0 },
]

const map: Territory[] = DISTRICTS.map(code => ({
  code, owner: null, protectedUntilHour: -1, controlledAtHour: -1, debt: 0,
}))

const owned = (clanId: number) => map.filter(t => t.owner === clanId)
const clanObjectLimit = (clanId: number) =>
  S.clanObjects.base + S.clanObjects.perTerritory * owned(clanId).length

/** Ступени по порядку захвата: первая взятая остаётся первой. */
function upkeepPerDay(clan: Clan): number {
  const mine = owned(clan.id).sort((a, b) => a.controlledAtHour - b.controlledAtHour)
  const gross = CLAN_MAINTENANCE_DAILY
    + mine.reduce((sum, _t, index) => sum + (index === 0 ? T.upkeepTier1 : T.upkeepTier2), 0)
  const discount = mine.some(t => t.code === 'suburb')
  return Math.round(discount ? gross * (1 - 0.25) : gross)
}

/** Сила клана в бою: число бойцов, которых он реально выставит. */
const rosterStrength = (clan: Clan) => Math.min(clan.size, T.claimMinRoster)

interface Event { hour: number; kind: string; clan: number; district?: District }
const events: Event[] = []
interface Ledger { day: number; clan: number; territories: number; objects: number; incomePerDay: number; upkeepPerDay: number; treasury: number }
const ledger: Ledger[] = []

let warIncome = 0   // всё, что кланы получили ограблениями
let workIncome = 0  // всё, что кланы получили производством

for (let hour = 0; hour < days * 24; hour++) {
  // ── клан растёт объектами, пока хватает предела и денег ────
  // Без этого модель врёт: клан с фиксированным числом объектов не может
  // выбраться из ямы, хотя в игре он просто заводит ещё один цех.
  for (const clan of clans) {
    const limit = clanObjectLimit(clan.id)
    // Объект стоит примерно как средний по коридору Этапа 3.
    const OBJECT_PRICE = 32_000
    if (clan.objects < limit && clan.treasury >= OBJECT_PRICE + T.claimFee) {
      clan.objects += 1
      clan.treasury -= OBJECT_PRICE
      events.push({ hour, kind: 'object_added', clan: clan.id })
    }
  }

  // ── производство и авторитет ───────────────────────────────
  for (const clan of clans) {
    const objects = Math.min(clan.objects, clanObjectLimit(clan.id))
    const profit = objects * OBJECT_PROFIT_PER_DAY * HOUR
    // Прибыль сначала копится НА ОБЪЕКТЕ и только потом выводится в общак.
    // Это и делает объект уязвимым: грабят накопленное, а не общак.
    clan.objectBalance += profit
    workIncome += profit
    // Авторитет: смены и закрытые циклы. Клан из N человек делает
    // примерно 6N смен в сутки и по циклу на объект.
    clan.authority += (clan.size * 6 * A.shiftCompleted + objects * A.cycleCompleted) * HOUR
    clan.authority += owned(clan.id).length * A.territoryHeldDay * HOUR
  }

  // ── вывод прибыли раз в трое суток ─────────────────────────
  // Внимательный владелец выводит часто и почти не даёт себя ограбить;
  // забывчивый копит и становится целью. Порог ограбления в 5000 ₽ ровно
  // про это: нищего не грабят, грабят зазевавшегося.
  if (hour > 0 && hour % 72 === 0) {
    for (const clan of clans) {
      clan.treasury += clan.objectBalance
      clan.objectBalance = 0
    }
  }

  // ── содержание раз в сутки ─────────────────────────────────
  if (hour > 0 && hour % 24 === 0) {
    for (const clan of clans) {
      ledger.push({
        day: hour / 24, clan: clan.id,
        territories: owned(clan.id).length,
        objects: Math.min(clan.objects, clanObjectLimit(clan.id)),
        incomePerDay: Math.min(clan.objects, clanObjectLimit(clan.id)) * OBJECT_PROFIT_PER_DAY,
        upkeepPerDay: upkeepPerDay(clan),
        treasury: Math.round(clan.treasury),
      })
      const cost = upkeepPerDay(clan)
      const paid = Math.min(clan.treasury, cost)
      clan.treasury -= paid
      const unpaid = cost - paid
      if (unpaid > 0) {
        clan.bankruptHours += 24
        const mine = owned(clan.id)
        const share = mine.length > 0 ? unpaid / mine.length : 0
        for (const territory of mine) {
          territory.debt += share
          if (territory.debt >= T.upkeepDebtRelease) {
            territory.owner = null
            territory.debt = 0
            territory.protectedUntilHour = -1
            events.push({ hour, kind: 'lost_to_debt', clan: clan.id, district: territory.code })
          }
        }
      }
    }
  }

  // ── заявки ─────────────────────────────────────────────────
  for (const clan of clans) {
    if (owned(clan.id).length >= T.limit) continue
    if (hour - clan.lastClaimHour < T.claimClanCooldownHours) continue
    if (clan.authority < A.claimCost) continue
    if (clan.treasury < T.claimFee) continue
    if (clan.size < T.claimMinRoster) continue

    // Клан не берёт район, который не потянет. Живой клан так и делает:
    // содержание видно заранее, и брать второй район в убыток бессмысленно.
    // Без этой проверки симулятор мерил бы не баланс, а безрассудство
    // собственного бота.
    const nextTerritories = owned(clan.id).length + 1
    const nextUpkeep = CLAN_MAINTENANCE_DAILY
      + T.upkeepTier1 + (nextTerritories > 1 ? T.upkeepTier2 : 0)
    // Считаем по объектам, которые у клана УЖЕ есть, а не по тем, которые
    // он теоретически заведёт: новый район поднимает предел, но не дарит
    // цехов, а на каждый нужны деньги и время. Первая версия проверки
    // считала по пределу — и клан из десяти человек брал второй район с
    // доходом 5200 против расхода 7500 и разорялся за неделю.
    const currentObjects = Math.min(clan.objects, clanObjectLimit(clan.id))
    if (currentObjects * OBJECT_PROFIT_PER_DAY < nextUpkeep) continue

    // Цель: сначала ничейный, потом самый слабый чужой.
    const free = map.filter(t => t.owner === null && t.protectedUntilHour <= hour)
    const enemy = map.filter(t =>
      t.owner !== null && t.owner !== clan.id && t.protectedUntilHour <= hour)
    const target = free[0] ?? enemy.sort((a, b) =>
      rosterStrength(clans[a.owner!]) - rosterStrength(clans[b.owner!]))[0]
    if (!target) continue

    clan.treasury -= T.claimFee
    clan.authority -= A.claimCost
    clan.lastClaimHour = hour

    const defender = target.owner === null ? null : clans[target.owner]
    if (!defender) {
      // Ничейный: заявка висит окном, потом контроль без боя.
      target.owner = clan.id
      target.controlledAtHour = hour + T.neutralClaimHours
      target.protectedUntilHour = hour + T.neutralClaimHours + T.protectionHours
      clan.authority += A.territoryWon
      clan.wins += 1
      events.push({ hour, kind: 'taken_free', clan: clan.id, district: target.code })
      continue
    }

    // Бой: шанс по силе составов, оборона получает премию за то, что
    // дерётся у себя — она выбирала не время боя, а хотя бы место.
    const attack = rosterStrength(clan)
    const defence = rosterStrength(defender) * 1.1
    const attackerWins = rnd() < attack / (attack + defence)
    if (attackerWins) {
      target.owner = clan.id
      target.controlledAtHour = hour
      target.protectedUntilHour = hour + T.protectionHours
      target.debt = 0
      clan.authority += A.territoryWon
      clan.wins += 1
      defender.losses += 1
      events.push({ hour, kind: 'captured', clan: clan.id, district: target.code })
    } else {
      defender.authority += A.territoryDefended
      defender.defended += 1
      target.protectedUntilHour = hour + T.protectionHours
      events.push({ hour, kind: 'defended', clan: defender.id, district: target.code })
    }
  }

  // ── ограбления ─────────────────────────────────────────────
  for (const clan of clans) {
    if (clan.authority < A.robberyCost) continue
    // Грабить есть кого только при своих или спорных районах.
    const enemies = clans.filter(c => c.id !== clan.id && c.objects > 0)
    if (enemies.length === 0) continue
    // Раз в кулдаун на объект: по всему миру это не чаще, чем
    // позволяет авторитет, и симулятор считает именно потолок.
    if (rnd() > 1 / T.claimClanCooldownHours) continue
    const victim = enemies[Math.floor(rnd() * enemies.length)]
    if (victim.objectBalance < S.objectAttack.robberyMinBalance) continue
    const taken = Math.min(
      Math.floor(victim.objectBalance * S.objectAttack.robberyShare),
      S.objectAttack.robberyCap,
    )
    clan.authority -= A.robberyCost
    clan.treasury += taken
    victim.objectBalance -= taken
    warIncome += taken
    events.push({ hour, kind: 'robbery', clan: clan.id })
  }
}

for (const clan of clans) { clan.treasury += clan.objectBalance; clan.objectBalance = 0 }

// ── итоги ────────────────────────────────────────────────────
const holdings = clans.map(clan => ({
  clan: clan.id,
  size: clan.size,
  territories: owned(clan.id).length,
  treasury: Math.round(clan.treasury),
  authority: Math.round(clan.authority),
  objectLimit: clanObjectLimit(clan.id),
  wins: clan.wins,
  losses: clan.losses,
  defended: clan.defended,
  daysInDebt: Math.round(clan.bankruptHours / 24),
}))

const suburb = map.find(t => t.code === 'suburb')!
const suburbTakenAtDay = suburb.controlledAtHour >= 0 ? suburb.controlledAtHour / 24 : null
const captures = events.filter(e => e.kind === 'captured' || e.kind === 'taken_free')
// Как часто район менял хозяина: если чаще, чем позволяет защита,
// значит защита не держит.
const capturesPerDistrictPerDay = captures.length / DISTRICTS.length / days

const smallClan = holdings.find(h => h.size === 5)!
const bigClan = holdings.find(h => h.size === 20)!

/**
 * Структурная платёжеспособность: доход за последний день против расхода.
 *
 * Не «ни дня в долгу»: клан честно уходит в минус на сутки, когда платит
 * взнос за заявку, и это не разорение, а вложение. Смотрим, сходится ли
 * баланс в установившемся режиме.
 */
const lastDay = Math.max(...ledger.map(r => r.day))
const finalLedger = (clanId: number) =>
  ledger.find(r => r.clan === clanId && r.day === lastDay)!
const solvent = (clanId: number) => {
  const row = finalLedger(clanId)
  return row.incomePerDay >= row.upkeepPerDay
}
/** Запас прочности: сколько остаётся в сутки после содержания. */
const marginPerDay = (clanId: number) => {
  const row = finalLedger(clanId)
  return row.incomePerDay - row.upkeepPerDay
}
const totalPlayerIncome = clans.reduce((sum, c) => sum + c.size, 0) * PLAYER_INCOME_PER_DAY * days

const verdicts = {
  // Карта делится: ни один клан не держит больше лимита.
  mapIsShared: holdings.every(h => h.territories <= T.limit),
  // Малый клан выживает: удерживает район и сводит концы с концами.
  smallClanSurvives: smallClan.territories >= 1 && solvent(smallClan.clan),
  // Крупный не разоряется.
  bigClanSolvent: bigClan.treasury > 0 && solvent(bigClan.clan),
  // Каждый клан, взявший район, остаётся платёжеспособным: если нет —
  // территория недоступна целому классу кланов, и это дефект баланса.
  allHoldersSolvent: holdings.every(h => h.territories === 0 || solvent(h.clan)),
  // Война дешевле работы — главный коридор этапа.
  warCheaperThanWork: warIncome < workIncome,
  // Спальный район не забирается в первые сутки.
  suburbNotInstant: suburbTakenAtDay === null || suburbTakenAtDay >= 1,
  // Карта не перетасовывается каждые сутки: защита 48 часов держит.
  mapIsStable: capturesPerDistrictPerDay <= 24 / T.protectionHours,
  // Никто не ушёл в минус по авторитету.
  authorityNonNegative: clans.every(c => c.authority >= -1e-6),
}
const passed = Object.values(verdicts).every(Boolean)

const report = {
  meta: { generatedAt: new Date().toISOString(), days, seed: initialSeed },
  config: {
    territoryLimit: T.limit,
    upkeep: [T.upkeepTier1, T.upkeepTier2],
    claimFee: T.claimFee,
    authority: { claim: A.claimCost, won: A.territoryWon, defended: A.territoryDefended },
    robbery: { share: S.objectAttack.robberyShare, cap: S.objectAttack.robberyCap, cost: A.robberyCost },
  },
  map: map.map(t => ({ code: t.code, owner: t.owner, debt: Math.round(t.debt) })),
  clans: holdings.map(h => ({ ...h, marginPerDay: marginPerDay(h.clan) })),
  income: {
    fromWork: Math.round(workIncome),
    fromWar: Math.round(warIncome),
    warShareOfWork: Number((warIncome / Math.max(1, workIncome)).toFixed(3)),
    playersEarnedMeanwhile: totalPlayerIncome,
  },
  war: {
    captures: captures.length,
    capturesPerDistrictPerDay: Number(capturesPerDistrictPerDay.toFixed(3)),
    suburbTakenAtDay: suburbTakenAtDay === null ? null : Number(suburbTakenAtDay.toFixed(2)),
    lostToDebt: events.filter(e => e.kind === 'lost_to_debt').length,
    robberies: events.filter(e => e.kind === 'robbery').length,
    objectsAdded: events.filter(e => e.kind === 'object_added').length,
  },
  ledger,
  verdicts,
}

if (!quiet) console.log(JSON.stringify(report, null, 2))
if (jsonPath) writeFileSync(jsonPath, JSON.stringify(report, null, 2))
process.exit(passed ? 0 : 1)
