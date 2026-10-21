// =============================================================
// Жилой сектор: квартиры и дома игроков.
//
// Правка заказчика (21.10.2026):
//   • дома покупаются только за доллары;
//   • из дома доступ к складу;
//   • прибавка к опыту за бой (проценты — любые пока);
//   • в доме на игрока напасть нельзя;
//   • на дома нападают, как на Дом бригады: прочность изначально 100%,
//     каждая победа нападавших −10%;
//   • туннели на Стрелки, Промзону и Фермы — за отдельную плату.
//
// Уточнение 22.10:
//   • налёт — как осада дома бригады: заявка, бой ровно через 72 часа, до
//     10 человек в нападение и до 10 в оборону; на дом — раз в неделю.
//     Хозяин в обороне сам, остальные записываются. В бой попадают те, кто
//     к началу в игре и свободен; оборона не вышла — дом взят без боя;
//   • вышел из дома туннелем — тем же туннелем можно вернуться; пришёл на
//     место другой дорогой — сразу в дом оттуда нельзя.
//
// Жильё стоит заранее: 16 квартир и 8 домов (housing.config, LOTS).
// Игрок покупает свободный участок; переезд из квартиры в дом — доплатой.
// =============================================================
import { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { audit } from '../../shared/logger/audit-logger'
import { logger } from '../../shared/logger/logger'
import { DollarsService } from '../dollars/dollars.service'
import { EconomyService } from '../economy/economy.service'
import { NoticesService } from '../chat/notices.service'
import { ChatService } from '../chat/chat.service'
import { BattleService } from '../battles/battles.service'
import { when } from '../clans/house-siege.formulas'
import { HOUSING, LOT_COUNT, TUNNELS, type TunnelCode, homeBonusActive, homeExpBonus, isLot, lotKind, lotLabel } from './housing.config'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const OPEN: Array<'PENDING' | 'IN_BATTLE'> = ['PENDING', 'IN_BATTLE']

async function myHome(characterId: string) {
  return prisma.playerHome.findUnique({ where: { characterId } })
}

/** Почему на этот дом сейчас нельзя объявить налёт, или null. */
async function raidBlockedReason(homeId: string, ownerId: string, characterId: string, now = new Date()): Promise<string | null> {
  if (ownerId === characterId) return 'Это ваш дом'
  const [open, last, mine] = await Promise.all([
    prisma.homeRaid.count({ where: { homeId, status: { in: OPEN } } }),
    prisma.homeRaid.findFirst({
      where: { homeId, status: { in: ['ATTACKER_WON', 'DEFENDER_WON'] } },
      orderBy: { resolvedAt: 'desc' }, select: { resolvedAt: true },
    }),
    prisma.homeRaid.count({ where: { attackerId: characterId, status: { in: OPEN } } }),
  ])
  if (open) return 'На этот дом уже объявлен налёт'
  if (last?.resolvedAt) {
    const next = last.resolvedAt.getTime() + HOUSING.raidCooldownDays * DAY
    if (next > now.getTime()) return `На этот дом уже нападали — снова можно с ${when(new Date(next))}`
  }
  if (mine) return 'Вы уже объявили налёт на другой дом'
  return null
}

/** Налёт для экрана: кто записан и что может смотрящий. */
async function describeRaids(raids: Array<Prisma.HomeRaidGetPayload<{ include: { signups: true; home: { select: { characterId: true } } } }>>, viewerId: string) {
  const ids = [...new Set(raids.flatMap(r => [r.home.characterId, ...r.signups.map(s => s.characterId)]))]
  const names = new Map((await prisma.character.findMany({ where: { id: { in: ids } }, select: { id: true, nickname: true, battleLevel: true } })).map(c => [c.id, c]))
  return new Map(raids.map(r => {
    const owner = names.get(r.home.characterId)
    const side = (n: number) => r.signups.filter(s => s.side === n).map(s => names.get(s.characterId)).filter(Boolean)
    // Хозяин в обороне всегда, отдельно его записывать не нужно.
    const defenders = [owner, ...side(2)].filter(Boolean)
    const mine = r.signups.find(s => s.characterId === viewerId)
    return [r.homeId, {
      id: r.id, status: r.status, startsAt: r.startsAt, battleId: r.battleId,
      attackers: side(1), defenders,
      mySide: r.home.characterId === viewerId ? 2 : mine?.side ?? null,
      canUnsign: !!mine && r.attackerId !== viewerId && r.status === 'PENDING',
    }]
  }))
}

/** Начать налёт, чьё время пришло: собрать стороны, открыть бой или решить без боя. */
async function startRaid(raidId: string): Promise<'STARTED' | 'ATTACKER_WON' | 'DEFENDER_WON' | 'SKIPPED'> {
  const online = new Set((await ChatService.online(5000)).map(p => p.characterId))
  const now = new Date()
  const prepared = await withTransaction(async tx => {
    const claimed = await tx.homeRaid.updateMany({ where: { id: raidId, status: 'PENDING' }, data: { status: 'IN_BATTLE' } })
    if (claimed.count !== 1) return null
    const raid = await tx.homeRaid.findUniqueOrThrow({ where: { id: raidId }, include: { signups: true, home: { select: { characterId: true } } } })
    const attackers = raid.signups.filter(s => s.side === 1).map(s => s.characterId)
    // Оборона: хозяин первым, затем записавшиеся.
    const defenders = [...new Set([raid.home.characterId, ...raid.signups.filter(s => s.side === 2).map(s => s.characterId)])]
    const take = async (ids: string[]) => {
      const out: string[] = []
      for (const id of ids) {
        if (out.length >= HOUSING.raidMaxPerSide) break
        if (!online.has(id)) continue
        const char = await tx.character.findUnique({ where: { id }, select: { traumaUntil: true } })
        if (!char || (char.traumaUntil && char.traumaUntil > now)) continue
        const busy = await tx.character.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'IN_BATTLE' } })
        if (busy.count === 1) out.push(id)
      }
      return out
    }
    const side1 = await take(attackers)
    const side2 = await take(defenders)
    if (!side1.length || !side2.length) {
      if (side1.length + side2.length) {
        await tx.character.updateMany({ where: { id: { in: [...side1, ...side2] } }, data: { status: 'ACTIVE' } })
      }
      return { battleId: null, side1, side2 }
    }
    const battle = await tx.battle.create({
      data: { type: 'CLAN', status: 'WAITING_PLAYERS', levelMin: 1, levelMax: 99, teamSize: HOUSING.raidMaxPerSide, creatorId: raid.attackerId },
    })
    for (const [side, ids] of [[1, side1], [2, side2]] as const) {
      for (const id of ids) {
        const c = await tx.character.findUniqueOrThrow({ where: { id }, select: { hpMax: true, hpCurrent: true } })
        await tx.battleParticipant.create({ data: { battleId: battle.id, characterId: id, side, hpMax: c.hpMax, hpCurrent: c.hpCurrent } })
      }
    }
    await tx.homeRaid.update({ where: { id: raidId }, data: { battleId: battle.id } })
    return { battleId: battle.id, side1, side2 }
  })
  if (!prepared) return 'SKIPPED'
  if (!prepared.battleId) {
    // Оборона не вышла — дом взят без боя; нападение не пришло — налёт сорван.
    const result = prepared.side1.length ? 'ATTACKER_WON' : 'DEFENDER_WON'
    await concludeRaid(raidId, result)
    return result
  }
  try {
    await BattleService.beginTeamState(prepared.battleId)
  } catch (err) {
    logger.error({ err, raidId }, '[HomeRaid] Battle start failed')
    await prisma.character.updateMany({ where: { id: { in: [...prepared.side1, ...prepared.side2] } }, data: { status: 'ACTIVE' } })
    await prisma.homeRaid.update({ where: { id: raidId }, data: { status: 'VOID', resolvedAt: new Date() } })
    return 'SKIPPED'
  }
  audit('home_raid.started', { raidId, battleId: prepared.battleId, attackers: prepared.side1.length, defenders: prepared.side2.length })
  return 'STARTED'
}

/** Итог налёта: победа нападавших снимает 10% прочности. */
async function concludeRaid(raidId: string, result: 'ATTACKER_WON' | 'DEFENDER_WON') {
  const raid = await withTransaction(async tx => {
    const done = await tx.homeRaid.updateMany({ where: { id: raidId, status: 'IN_BATTLE' }, data: { status: result, resolvedAt: new Date() } })
    if (done.count !== 1) return null
    const row = await tx.homeRaid.findUniqueOrThrow({ where: { id: raidId } })
    if (result === 'ATTACKER_WON') {
      const home = await tx.playerHome.findUniqueOrThrow({ where: { id: row.homeId } })
      await tx.playerHome.update({ where: { id: home.id }, data: { durability: Math.max(0, home.durability - HOUSING.raidDurabilityLoss) } })
    }
    return row
  })
  if (!raid) return
  const [home, attacker] = await Promise.all([
    prisma.playerHome.findUnique({ where: { id: raid.homeId }, select: { characterId: true, durability: true } }),
    prisma.character.findUnique({ where: { id: raid.attackerId }, select: { nickname: true } }),
  ])
  if (home) {
    await NoticesService.push(home.characterId, result === 'ATTACKER_WON'
      ? `Налёт ${attacker?.nickname ?? ''} на ваш дом удался: прочность ${home.durability}%.`
      : `Налёт ${attacker?.nickname ?? ''} на ваш дом отбит.`)
  }
  audit('home_raid.finished', { raidId, result })
}

/** Тик воркера: начать налёты, чьё время пришло, и подвести итог законченным боям. */
export async function runHomeRaids(now = new Date()): Promise<number> {
  let handled = 0
  const due = await prisma.homeRaid.findMany({ where: { status: 'PENDING', startsAt: { lte: now } }, select: { id: true }, take: 20 })
  for (const { id } of due) {
    try { if (await startRaid(id) !== 'SKIPPED') handled += 1 }
    catch (err) { logger.error({ err, raidId: id }, '[HomeRaid] Start error') }
  }
  const fighting = await prisma.homeRaid.findMany({ where: { status: 'IN_BATTLE', battleId: { not: null } }, take: 50 })
  for (const raid of fighting) {
    const battle = await prisma.battle.findUnique({
      where: { id: raid.battleId! },
      include: { participants: { select: { id: true, side: true, characterId: true } } },
    })
    if (!battle || !['FINISHED', 'CANCELLED', 'TECHNICAL_WIN'].includes(battle.status)) continue
    const winner = battle.participants.find(p => p.id === battle.winnerParticipantId)
      ?? battle.participants.find(p => p.characterId && p.characterId === battle.winnerId)
    // Ничья и сбой — дом устоял.
    try { await concludeRaid(raid.id, winner?.side === 1 ? 'ATTACKER_WON' : 'DEFENDER_WON'); handled += 1 }
    catch (err) { logger.error({ err, raidId: raid.id }, '[HomeRaid] Conclude error') }
  }
  return handled
}

export const HOME_RAIDS_MS = 15_000

export const HousingService = {
  /** Прибавка к боевому опыту от дома хозяина (0, если дома нет или он разбит). */
  async expBonus(characterId: string): Promise<number> {
    const home = await myHome(characterId)
    return home ? homeExpBonus(home.kind, home.durability) : 0
  },

  /** Сектор: свой дом, цены и план участков — свободные, свой и чужие для налёта. */
  async view(characterId: string) {
    const [home, char, homes, openRaids] = await Promise.all([
      myHome(characterId),
      prisma.character.findUniqueOrThrow({ where: { id: characterId }, select: { dollars: true, money: true } }),
      prisma.playerHome.findMany({
        where: { lot: { not: null } },
        select: { id: true, lot: true, durability: true, characterId: true, character: { select: { nickname: true, battleLevel: true } } },
      }),
      prisma.homeRaid.findMany({ where: { status: { in: OPEN } }, include: { signups: true, home: { select: { characterId: true } } } }),
    ])
    const raids = await describeRaids(openRaids, characterId)
    const pastOnMe = home ? await prisma.homeRaid.findMany({ where: { homeId: home.id, status: { in: ['ATTACKER_WON', 'DEFENDER_WON'] } }, orderBy: { resolvedAt: 'desc' }, take: 10 }) : []
    const raiders = new Map((await prisma.character.findMany({ where: { id: { in: pastOnMe.map(r => r.attackerId) } }, select: { id: true, nickname: true } })).map(r => [r.id, r.nickname]))
    const byLot = new Map(homes.map(h => [h.lot, h]))
    const lots = await Promise.all(Array.from({ length: LOT_COUNT }, async (_, i) => {
      const lot = i + 1
      const h = byLot.get(lot)
      return {
        lot, kind: lotKind(lot), label: lotLabel(lot),
        home: h ? {
          id: h.id, durability: h.durability, owner: h.character.nickname, ownerLevel: h.character.battleLevel,
          mine: h.characterId === characterId,
          raid: raids.get(h.id) ?? null,
          raidBlocked: raids.has(h.id) ? null : await raidBlockedReason(h.id, h.characterId, characterId),
        } : null,
      }
    }))
    return {
      prices: HOUSING.kinds, tunnelPrice: HOUSING.tunnelPriceDollars, repairPer10: HOUSING.repairCostPer10, tunnels: TUNNELS,
      raidRules: { leadHours: HOUSING.raidLeadHours, maxPerSide: HOUSING.raidMaxPerSide, cooldownDays: HOUSING.raidCooldownDays, durabilityLoss: HOUSING.raidDurabilityLoss },
      wallet: { dollars: char.dollars, money: char.money },
      home: home ? {
        id: home.id, kind: home.kind, lot: home.lot, label: home.lot ? lotLabel(home.lot) : null, durability: home.durability, tunnels: home.tunnels,
        bonus: homeExpBonus(home.kind, home.durability), bonusActive: homeBonusActive(home.durability),
        raid: raids.get(home.id) ?? null,
        raids: pastOnMe.map(r => ({ at: r.resolvedAt ?? r.createdAt, attacker: raiders.get(r.attackerId) ?? '—', won: r.status === 'ATTACKER_WON' })),
      } : null,
      lots,
    }
  },

  /** Покупка свободного участка — только за доллары; из квартиры в дом можно переехать доплатой. */
  async buy(characterId: string, lot: number) {
    if (!isLot(lot)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Такого участка нет', 422)
    const kind = lotKind(lot)
    const price = HOUSING.kinds[kind].priceDollars
    try {
      return await withTransaction(async tx => {
        const existing = await tx.playerHome.findUnique({ where: { characterId } })
        if (existing && (existing.kind === kind || existing.kind === 'HOUSE')) {
          throw new AppError(ErrorCode.CONFLICT, existing.kind === 'HOUSE' ? 'У вас уже есть дом' : 'У вас уже есть квартира', 409)
        }
        // Занятость проверяем заранее ради понятного ответа; гонку двух
        // покупателей закрывает уникальный индекс по номеру участка.
        if (await tx.playerHome.findUnique({ where: { lot } })) throw new AppError(ErrorCode.CONFLICT, 'Этот участок уже занят', 409)
        const cost = existing ? price - HOUSING.kinds[existing.kind].priceDollars : price
        const dollars = await DollarsService.debit(tx, { characterId, amount: cost, reason: 'PURCHASE', note: existing ? 'Жилой сектор: доплата за дом' : `Жилой сектор: ${HOUSING.kinds[kind].name}` })
        const home = existing
          ? await tx.playerHome.update({ where: { id: existing.id }, data: { kind, lot } })
          : await tx.playerHome.create({ data: { characterId, kind, lot } })
        return { home, dollars, cost }
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(ErrorCode.CONFLICT, 'Этот участок уже занят', 409)
      throw error
    }
  },

  /** Туннель из дома на Стрелки, Промзону или Фермы — за доллары. */
  async buyTunnel(characterId: string, code: TunnelCode) {
    if (!TUNNELS.some(t => t.code === code)) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Такого туннеля нет', 422)
    return withTransaction(async tx => {
      const home = await tx.playerHome.findUnique({ where: { characterId } })
      if (!home) throw new AppError(ErrorCode.NOT_FOUND, 'Сначала купите жильё', 404)
      if (home.tunnels.includes(code)) throw new AppError(ErrorCode.CONFLICT, 'Туннель уже прорыт', 409)
      const dollars = await DollarsService.debit(tx, { characterId, amount: HOUSING.tunnelPriceDollars, reason: 'PURCHASE', note: `Жилой сектор: туннель (${code})` })
      const updated = await tx.playerHome.update({ where: { id: home.id }, data: { tunnels: { push: code } } })
      return { tunnels: updated.tunnels, dollars }
    })
  },

  /** Пройти туннелем из дома: запоминаем, куда вышли, — оттуда можно вернуться. */
  async goThroughTunnel(characterId: string, code: TunnelCode) {
    const tunnel = TUNNELS.find(t => t.code === code)
    if (!tunnel) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Такого туннеля нет', 422)
    const home = await myHome(characterId)
    if (!home) throw new AppError(ErrorCode.NOT_FOUND, 'Сначала купите жильё', 404)
    if (!home.tunnels.includes(code)) throw new AppError(ErrorCode.CONFLICT, 'Этот туннель ещё не прорыт', 409)
    await prisma.playerHome.update({ where: { id: home.id }, data: { outVia: code } })
    return { to: tunnel.to }
  },

  /** Куда хозяин вышел туннелем (для кнопки «В дом»), или null. */
  async exit(characterId: string) {
    const home = await prisma.playerHome.findUnique({ where: { characterId }, select: { outVia: true } })
    const tunnel = TUNNELS.find(t => t.code === home?.outVia)
    return { via: tunnel?.code ?? null, area: tunnel?.area ?? [] }
  },

  /** Вернуться в дом тем же туннелем. */
  async returnHome(characterId: string) {
    const home = await myHome(characterId)
    if (!home?.outVia) throw new AppError(ErrorCode.CONFLICT, 'Вернуться в дом можно только тем туннелем, которым вышли', 409)
    await prisma.playerHome.update({ where: { id: home.id }, data: { outVia: null } })
    return { to: '/housing' }
  },

  /** Ремонт: до 100%, за рубли — по цене за каждые 10%. */
  async repair(characterId: string) {
    return withTransaction(async tx => {
      const home = await tx.playerHome.findUnique({ where: { characterId } })
      if (!home) throw new AppError(ErrorCode.NOT_FOUND, 'Сначала купите жильё', 404)
      if (home.durability >= 100) throw new AppError(ErrorCode.CONFLICT, 'Ремонт не нужен', 409)
      const cost = Math.ceil((100 - home.durability) / 10) * HOUSING.repairCostPer10
      const balance = await EconomyService.debit(tx, { characterId, amount: cost, reasonCode: 'REPAIR_COST', refType: 'home', refId: home.id })
      await tx.playerHome.update({ where: { id: home.id }, data: { durability: 100 } })
      return { durability: 100, cost, balance }
    })
  },

  /** Объявить налёт на чужой дом: бой ровно через 72 часа. */
  async fileRaid(characterId: string, homeId: string, now = new Date()) {
    const home = await prisma.playerHome.findUnique({ where: { id: homeId }, include: { character: { select: { nickname: true } } } })
    if (!home) throw new AppError(ErrorCode.NOT_FOUND, 'Дом не найден', 404)
    const blocked = await raidBlockedReason(homeId, home.characterId, characterId, now)
    if (blocked) throw new AppError(ErrorCode.CONFLICT, blocked, 409)
    const startsAt = new Date(now.getTime() + HOUSING.raidLeadHours * HOUR)
    const raid = await withTransaction(async tx => {
      // Повторная проверка под транзакцией: две заявки в одну секунду.
      if (await tx.homeRaid.count({ where: { homeId, status: { in: OPEN } } })) throw new AppError(ErrorCode.CONFLICT, 'На этот дом уже объявлен налёт', 409)
      const created = await tx.homeRaid.create({ data: { homeId, attackerId: characterId, startsAt } })
      await tx.homeRaidSignup.create({ data: { raidId: created.id, characterId, side: 1 } })
      return created
    })
    const attacker = await prisma.character.findUnique({ where: { id: characterId }, select: { nickname: true } })
    await NoticesService.push(home.characterId, `${attacker?.nickname ?? 'Кто-то'} объявил налёт на ваш дом: бой ${when(startsAt)} по Москве. Зовите своих в оборону.`)
    audit('home_raid.filed', { raidId: raid.id, homeId, attackerId: characterId, startsAt })
    return { raidId: raid.id, startsAt, owner: home.character.nickname }
  },

  /** Записаться на налёт: 1 — в нападение, 2 — в оборону. */
  async signupRaid(characterId: string, raidId: string, side: 1 | 2) {
    const raid = await prisma.homeRaid.findUnique({ where: { id: raidId }, include: { home: { select: { characterId: true } } } })
    if (!raid || raid.status !== 'PENDING') throw new AppError(ErrorCode.CONFLICT, 'Запись на этот налёт закрыта', 409)
    if (raid.home.characterId === characterId) throw new AppError(ErrorCode.CONFLICT, 'Хозяин и так в обороне', 409)
    if (await prisma.homeRaidSignup.findUnique({ where: { raidId_characterId: { raidId, characterId } } })) {
      throw new AppError(ErrorCode.CONFLICT, 'Вы уже записаны', 409)
    }
    // Хозяин занимает в обороне одно место из десяти.
    const taken = await prisma.homeRaidSignup.count({ where: { raidId, side } }) + (side === 2 ? 1 : 0)
    if (taken >= HOUSING.raidMaxPerSide) throw new AppError(ErrorCode.CONFLICT, `На стороне уже ${HOUSING.raidMaxPerSide} человек`, 409)
    try {
      await prisma.homeRaidSignup.create({ data: { raidId, characterId, side } })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(ErrorCode.CONFLICT, 'Вы уже записаны', 409)
      throw error
    }
    return { raidId, side }
  },

  async unsignRaid(characterId: string, raidId: string) {
    const raid = await prisma.homeRaid.findUnique({ where: { id: raidId } })
    if (!raid || raid.status !== 'PENDING') throw new AppError(ErrorCode.CONFLICT, 'Налёт уже начался', 409)
    if (raid.attackerId === characterId) throw new AppError(ErrorCode.CONFLICT, 'Объявивший налёт не выписывается', 409)
    await prisma.homeRaidSignup.deleteMany({ where: { raidId, characterId } })
    return { raidId }
  },
}
