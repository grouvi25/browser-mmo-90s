// =============================================================
// Жилой сектор: квартиры и дома игроков.
//
// Правка заказчика (21.10.2026):
//   • дома покупаются только за доллары;
//   • из дома доступ к складу;
//   • прибавка к опыту за бой (проценты — любые пока);
//   • в доме на игрока напасть нельзя;
//   • на дома нападают, как на Дом бригады: прочность изначально 100%,
//     каждая победа нападавшего −10%;
//   • туннели на Стрелки, Промзону и Фермы — за отдельную плату.
//
// Прямого нападения на игрока в игре нет (бои идут по заявкам), поэтому
// налёт — это бой нападающего со сторожем дома, ботом под уровень хозяина:
// хозяину не нужно быть в сети, сам он в доме в безопасности.
//
// Жильё стоит заранее: 16 квартир и 8 домов (housing.config, LOTS).
// Игрок покупает свободный участок; переезд из квартиры в дом — доплатой.
// =============================================================
import { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { DollarsService } from '../dollars/dollars.service'
import { EconomyService } from '../economy/economy.service'
import { NoticesService } from '../chat/notices.service'
import { BattleService } from '../battles/battles.service'
import { HOUSING, LOT_COUNT, TUNNELS, type TunnelCode, homeBonusActive, homeExpBonus, isLot, lotKind, lotLabel } from './housing.config'

const HOUR = 3_600_000

/** Сторож дома: самый сильный бот не выше уровня хозяина + 1. */
async function guardFor(ownerLevel: number) {
  const bots = await prisma.bot.findMany({ where: { isActive: true }, orderBy: { battleLevel: 'asc' }, select: { code: true, name: true, battleLevel: true } })
  if (!bots.length) throw new AppError(ErrorCode.NOT_FOUND, 'Сторожа для дома нет', 404)
  return [...bots].reverse().find(b => b.battleLevel <= ownerLevel + 1) ?? bots[0]
}

async function myHome(characterId: string) {
  return prisma.playerHome.findUnique({ where: { characterId } })
}

/** Итог налётов, чьи бои уже закончились: победа нападавшего −10% прочности. */
async function settle(where: { homeId?: string; battleId?: string } = {}) {
  const pending = await prisma.homeRaid.findMany({ where: { status: 'PENDING', ...where }, take: 50 })
  for (const raid of pending) {
    if (!raid.battleId) continue
    const battle = await prisma.battle.findUnique({
      where: { id: raid.battleId },
      select: { status: true, winnerParticipant: { select: { characterId: true } } },
    })
    if (!battle || !['FINISHED', 'CANCELLED'].includes(battle.status)) continue
    const won = battle.status === 'FINISHED' && battle.winnerParticipant?.characterId === raid.attackerId
    const status = battle.status === 'CANCELLED' ? 'VOID' : won ? 'ATTACKER_WON' : 'DEFENDER_WON'
    await withTransaction(async tx => {
      const closed = await tx.homeRaid.updateMany({ where: { id: raid.id, status: 'PENDING' }, data: { status, resolvedAt: new Date() } })
      if (closed.count !== 1 || status !== 'ATTACKER_WON') return
      const home = await tx.playerHome.findUniqueOrThrow({ where: { id: raid.homeId } })
      await tx.playerHome.update({ where: { id: home.id }, data: { durability: Math.max(0, home.durability - HOUSING.raidDurabilityLoss) } })
    })
    if (status === 'ATTACKER_WON') {
      const [home, attacker] = await Promise.all([
        prisma.playerHome.findUnique({ where: { id: raid.homeId }, select: { characterId: true, durability: true } }),
        prisma.character.findUnique({ where: { id: raid.attackerId }, select: { nickname: true } }),
      ])
      if (home) await NoticesService.push(home.characterId, `На ваш дом напал ${attacker?.nickname ?? 'кто-то'} и победил сторожа: прочность ${home.durability}%.`)
    }
  }
}

export const HousingService = {
  settle,

  /** Прибавка к боевому опыту от дома хозяина (0, если дома нет или он разбит). */
  async expBonus(characterId: string): Promise<number> {
    const home = await myHome(characterId)
    return home ? homeExpBonus(home.kind, home.durability) : 0
  },

  /** Сектор: свой дом, цены и план участков — свободные, свой и чужие для налёта. */
  async view(characterId: string) {
    await settle()
    const [home, char, homes] = await Promise.all([
      myHome(characterId),
      prisma.character.findUniqueOrThrow({ where: { id: characterId }, select: { dollars: true, money: true } }),
      prisma.playerHome.findMany({
        where: { lot: { not: null } },
        select: { id: true, lot: true, durability: true, characterId: true, character: { select: { nickname: true, battleLevel: true } } },
      }),
    ])
    const since = new Date(Date.now() - HOUSING.raidCooldownHours * HOUR)
    const myRaids = await prisma.homeRaid.findMany({ where: { attackerId: characterId, createdAt: { gt: since }, status: { not: 'VOID' } }, select: { homeId: true, createdAt: true } })
    const raidedAt = new Map(myRaids.map(r => [r.homeId, r.createdAt]))
    const raidsOnMe = home ? await prisma.homeRaid.findMany({ where: { homeId: home.id, status: { in: ['ATTACKER_WON', 'DEFENDER_WON'] } }, orderBy: { createdAt: 'desc' }, take: 10 }) : []
    const raiders = await prisma.character.findMany({ where: { id: { in: raidsOnMe.map(r => r.attackerId) } }, select: { id: true, nickname: true } })
    const nick = new Map(raiders.map(r => [r.id, r.nickname]))
    const byLot = new Map(homes.map(h => [h.lot, h]))
    return {
      prices: HOUSING.kinds, tunnelPrice: HOUSING.tunnelPriceDollars, repairPer10: HOUSING.repairCostPer10, tunnels: TUNNELS,
      wallet: { dollars: char.dollars, money: char.money },
      home: home ? {
        id: home.id, kind: home.kind, lot: home.lot, label: home.lot ? lotLabel(home.lot) : null, durability: home.durability, tunnels: home.tunnels,
        bonus: homeExpBonus(home.kind, home.durability), bonusActive: homeBonusActive(home.durability),
        raids: raidsOnMe.map(r => ({ at: r.createdAt, attacker: nick.get(r.attackerId) ?? '—', won: r.status === 'ATTACKER_WON' })),
      } : null,
      lots: Array.from({ length: LOT_COUNT }, (_, i) => {
        const lot = i + 1
        const h = byLot.get(lot)
        const last = h ? raidedAt.get(h.id) : undefined
        return {
          lot, kind: lotKind(lot), label: lotLabel(lot),
          home: h ? {
            id: h.id, durability: h.durability, owner: h.character.nickname, ownerLevel: h.character.battleLevel,
            mine: h.characterId === characterId,
            canRaidAt: last ? new Date(last.getTime() + HOUSING.raidCooldownHours * HOUR) : null,
          } : null,
        }
      }),
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

  /** Налёт на чужой дом: бой со сторожем; итог — в settle по окончании боя. */
  async raid(userId: string, characterId: string, homeId: string) {
    await settle()
    const home = await prisma.playerHome.findUnique({ where: { id: homeId }, include: { character: { select: { battleLevel: true, nickname: true } } } })
    if (!home) throw new AppError(ErrorCode.NOT_FOUND, 'Дом не найден', 404)
    if (home.characterId === characterId) throw new AppError(ErrorCode.CONFLICT, 'На свой дом нападать нельзя', 409)
    const since = new Date(Date.now() - HOUSING.raidCooldownHours * HOUR)
    const recent = await prisma.homeRaid.findFirst({ where: { homeId, attackerId: characterId, createdAt: { gt: since }, status: { not: 'VOID' } } })
    if (recent) throw new AppError(ErrorCode.CONFLICT, `На этот дом вы уже нападали, снова — через ${HOUSING.raidCooldownHours} ч после прошлого налёта`, 409)
    const pending = await prisma.homeRaid.findFirst({ where: { homeId, status: 'PENDING' } })
    if (pending) throw new AppError(ErrorCode.CONFLICT, 'На этот дом уже идёт налёт', 409)
    const guard = await guardFor(home.character.battleLevel)
    const { battleId } = await BattleService.startPve(userId, guard.code)
    await prisma.homeRaid.create({ data: { homeId, attackerId: characterId, battleId } })
    return { battleId, guard: guard.name, owner: home.character.nickname }
  },
}
