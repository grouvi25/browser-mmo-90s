// =============================================================
// Осада дома бригады.
//
// Правка заказчика (октябрь 2026): на дома бригад можно нападать, «как в
// Королях». Там это захват замка клана (5kings.ru, библиотека «Замки
// кланов» и «Частные дома»), и правила перенесены оттуда:
//   • заявку подаёт главарь, бой — через 3–7 суток, в будни с 11 до 20;
//   • нападающие записываются заранее, но запись их не держит;
//   • в оборону входят все бойцы бригады, кто к началу в игре и свободен;
//   • взятие: прочность −5%, дом разгромлен на 7 суток — бонусы района
//     выключены, гости пишут на стене; при прочности 50% и ниже бонусы
//     выключены до ремонта;
//   • отбитая осада — нападавшим «кровавая травма» на сутки;
//   • повторная заявка — через 15 суток после окончания прошлой.
// Стен, ворот и осадных орудий нет: бой идёт на обычном поле.
// =============================================================
import type { Prisma } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { audit } from '../../shared/logger/audit-logger'
import { logger } from '../../shared/logger/logger'
import { BalanceConfig } from '../../config/balance.config'
import { ChatService } from '../chat/chat.service'
import { AnnouncementsService } from '../announcements/announcements.service'
import { BattleService } from '../battles/battles.service'
import { houseBonusesOff, siegeRules, siegeStartAllowed, when } from './house-siege.formulas'

export { houseBonusesOff, siegeStartAllowed }

const S = BalanceConfig.strategy.houseSiege
const HOUR = 3_600_000
const DAY = 24 * HOUR

async function membership(characterId: string) {
  return prisma.clanMember.findUnique({
    where: { characterId },
    include: { role: true, clan: true },
  })
}

async function bossOf(characterId: string) {
  const member = await membership(characterId)
  if (!member || member.status !== 'ACTIVE') throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Вы не состоите в бригаде', 404)
  if (member.role.code !== 'boss') throw new AppError(ErrorCode.CLAN_PERMISSION, 'Это может только главарь бригады', 403)
  return member
}

const OPEN: Array<'SCHEDULED' | 'IN_BATTLE'> = ['SCHEDULED', 'IN_BATTLE']

export const HouseSiegeService = {
  /** Карточка дома: всё публичное плюс то, что может сделать смотрящий. */
  async view(viewerCharacterId: string, clanId: string) {
    const clan = await prisma.clan.findUnique({
      where: { id: clanId },
      select: {
        id: true, name: true, tag: true, level: true, houseDurability: true, houseRazedUntil: true,
        members: { where: { status: 'ACTIVE' }, select: { characterId: true, role: { select: { name: true, rank: true } } } },
      },
    })
    if (!clan) throw AppError.notFound('Бригада', clanId)
    const now = new Date()
    const [viewer, chars, incoming, outgoing, notes] = await Promise.all([
      membership(viewerCharacterId),
      prisma.character.findMany({
        where: { id: { in: clan.members.map(m => m.characterId) } },
        select: { id: true, nickname: true, battleLevel: true },
      }),
      // Осада на этот дом и осада, которую ведёт сама бригада, — разные
      // вещи: раньше вторая подменяла первую, и дом нападающей бригады
      // нельзя было осадить — вместо формы показывалась её вылазка.
      prisma.houseSiege.findFirst({ where: { defenderClanId: clanId, status: { in: OPEN } }, include: { signups: true } }),
      prisma.houseSiege.findFirst({ where: { attackerClanId: clanId, status: { in: OPEN } }, include: { signups: true } }),
      prisma.houseWallNote.findMany({ where: { clanId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ])
    const byId = new Map(chars.map(c => [c.id, c]))
    const viewerClanId = viewer?.status === 'ACTIVE' ? viewer.clanId : null
    const isBoss = viewer?.status === 'ACTIVE' && viewer.role.code === 'boss'
    const razed = !!clan.houseRazedUntil && clan.houseRazedUntil > now

    // Почему нельзя объявить осаду — тем же правилом, что и сама заявка.
    let fileBlocked: string | null = null
    if (!viewerClanId) fileBlocked = 'Нужно состоять в бригаде'
    else if (viewerClanId === clanId) fileBlocked = 'Это ваш дом'
    else if (!isBoss) fileBlocked = 'Осаду объявляет главарь'
    else fileBlocked = await this.fileBlockedReason(viewerClanId, clanId)

    const noteAuthors = new Map((await prisma.character.findMany({
      where: { id: { in: [...new Set(notes.map(n => n.characterId))] } }, select: { id: true, nickname: true },
    })).map(c => [c.id, c.nickname]))
    const sieges = [incoming, outgoing].filter((x): x is NonNullable<typeof x> => !!x)
    const siegeClans = new Map((await prisma.clan.findMany({
      where: { id: { in: sieges.flatMap(x => [x.attackerClanId, x.defenderClanId]) } }, select: { id: true, name: true, tag: true },
    })).map(c => [c.id, c]))
    const signupNames = new Map((await prisma.character.findMany({
      where: { id: { in: sieges.flatMap(x => x.signups.map(s => s.characterId)) } }, select: { id: true, nickname: true, battleLevel: true },
    })).map(c => [c.id, c]))
    const describe = (siege: NonNullable<typeof incoming>) => ({
      id: siege.id,
      status: siege.status,
      startsAt: siege.startsAt,
      attacker: siegeClans.get(siege.attackerClanId) ?? null,
      defender: siegeClans.get(siege.defenderClanId) ?? null,
      attackers: siege.signups.filter(s => s.side === 1).map(s => signupNames.get(s.characterId)).filter(Boolean),
      defenders: siege.signups.filter(s => s.side === 2).map(s => signupNames.get(s.characterId)).filter(Boolean),
      mySide: viewerClanId === siege.attackerClanId ? 1 as const : viewerClanId === siege.defenderClanId ? 2 as const : null,
      signedUp: siege.signups.some(s => s.characterId === viewerCharacterId),
      canCancel: isBoss && viewerClanId === siege.attackerClanId && siege.status === 'SCHEDULED',
      battleId: siege.battleId,
    })

    return {
      id: clan.id, name: clan.name, tag: clan.tag, level: clan.level,
      durability: clan.houseDurability,
      razedUntil: razed ? clan.houseRazedUntil : null,
      bonusesOff: houseBonusesOff(clan, now),
      repairCost: Math.ceil((100 - clan.houseDurability) / 10) * S.repairCostPer10,
      members: clan.members
        .map(m => ({ ...byId.get(m.characterId), role: m.role.name, rank: m.role.rank }))
        .sort((a, b) => b.rank - a.rank),
      isMine: viewerClanId === clanId,
      canRepair: viewerClanId === clanId && isBoss && clan.houseDurability < 100,
      canFile: fileBlocked === null,
      fileBlocked,
      canWrite: razed && viewerClanId !== clanId,
      rules: siegeRules(),
      wall: notes.map(n => ({ id: n.id, author: noteAuthors.get(n.characterId) ?? '—', text: n.text, createdAt: n.createdAt })),
      siege: incoming ? describe(incoming) : null,
      outgoing: outgoing ? describe(outgoing) : null,
    }
  },

  /** Причина, по которой бригада не может осадить этот дом, или null. */
  async fileBlockedReason(attackerClanId: string, defenderClanId: string, now = new Date()): Promise<string | null> {
    const [targetBusy, ownBusy, lastFinished] = await Promise.all([
      prisma.houseSiege.count({ where: { defenderClanId, status: { in: OPEN } } }),
      prisma.houseSiege.count({ where: { attackerClanId, status: { in: OPEN } } }),
      prisma.houseSiege.findFirst({
        where: { attackerClanId, finishedAt: { not: null } },
        orderBy: { finishedAt: 'desc' }, select: { finishedAt: true },
      }),
    ])
    if (targetBusy) return 'Этот дом уже осаждают'
    if (ownBusy) return 'Ваша бригада уже ведёт осаду'
    if (lastFinished?.finishedAt) {
      const next = lastFinished.finishedAt.getTime() + S.cooldownDays * DAY
      if (next > now.getTime()) return `Следующую осаду можно объявить с ${when(new Date(next))}`
    }
    return null
  },

  async file(characterId: string, targetClanId: string, startsAt: Date) {
    const boss = await bossOf(characterId)
    if (boss.clanId === targetClanId) throw AppError.validation('Свой дом осаждать нельзя')
    const target = await prisma.clan.findUnique({ where: { id: targetClanId }, select: { id: true, name: true, tag: true } })
    if (!target) throw AppError.notFound('Бригада', targetClanId)
    const timeProblem = siegeStartAllowed(startsAt)
    if (timeProblem) throw AppError.validation(timeProblem)
    const blocked = await this.fileBlockedReason(boss.clanId, targetClanId)
    if (blocked) throw new AppError(ErrorCode.CONFLICT, blocked, 409)

    const siege = await withTransaction(async tx => {
      // Повторная проверка под транзакцией: две заявки в одну секунду.
      const busy = await tx.houseSiege.count({
        where: { OR: [{ defenderClanId: targetClanId }, { attackerClanId: boss.clanId }], status: { in: OPEN } },
      })
      if (busy) throw new AppError(ErrorCode.CONFLICT, 'Осада уже объявлена', 409)
      const created = await tx.houseSiege.create({
        data: { attackerClanId: boss.clanId, defenderClanId: targetClanId, filedByCharacterId: characterId, startsAt },
      })
      await tx.houseSiegeSignup.create({ data: { siegeId: created.id, characterId, side: 1 } })
      return created
    })
    audit('house_siege.filed', { siegeId: siege.id, attackerClanId: boss.clanId, defenderClanId: targetClanId, startsAt })
    await AnnouncementsService.world(
      'Объявлена осада',
      `Бригада «${boss.clan.name}» [${boss.clan.tag}] осадит дом бригады «${target.name}» [${target.tag}] ${when(startsAt)} по Москве.`,
    )
    return { siegeId: siege.id, startsAt: siege.startsAt }
  },

  async cancel(characterId: string, siegeId: string) {
    const boss = await bossOf(characterId)
    const done = await prisma.houseSiege.updateMany({
      where: { id: siegeId, attackerClanId: boss.clanId, status: 'SCHEDULED' },
      // Снятая осада считается законченной: иначе снимали бы и объявляли
      // заново, обходя 15 суток.
      data: { status: 'CANCELLED', finishedAt: new Date() },
    })
    if (done.count !== 1) throw new AppError(ErrorCode.CONFLICT, 'Снять можно только свою ещё не начатую осаду', 409)
    return { siegeId, cancelled: true }
  },

  /** Записаться на осаду за свою сторону. */
  async signup(characterId: string, siegeId: string) {
    const member = await membership(characterId)
    if (!member || member.status !== 'ACTIVE') throw new AppError(ErrorCode.CLAN_NOT_FOUND, 'Вы не состоите в бригаде', 404)
    const siege = await prisma.houseSiege.findUnique({ where: { id: siegeId } })
    if (!siege || siege.status !== 'SCHEDULED') throw new AppError(ErrorCode.CONFLICT, 'Запись на эту осаду закрыта', 409)
    const side = member.clanId === siege.attackerClanId ? 1 : member.clanId === siege.defenderClanId ? 2 : null
    if (!side) throw new AppError(ErrorCode.FORBIDDEN, 'Записаться могут только бойцы двух бригад', 403)
    const taken = await prisma.houseSiegeSignup.count({ where: { siegeId, side } })
    if (taken >= S.maxPerSide) throw new AppError(ErrorCode.CONFLICT, `На стороне уже ${S.maxPerSide} бойцов`, 409)
    await prisma.houseSiegeSignup.upsert({
      where: { siegeId_characterId: { siegeId, characterId } },
      update: {}, create: { siegeId, characterId, side },
    })
    return { siegeId, side }
  },

  async unsign(characterId: string, siegeId: string) {
    const siege = await prisma.houseSiege.findUnique({ where: { id: siegeId } })
    if (!siege || siege.status !== 'SCHEDULED') throw new AppError(ErrorCode.CONFLICT, 'Осада уже началась', 409)
    if (siege.filedByCharacterId === characterId) throw AppError.validation('Объявивший осаду не выписывается — её можно только снять')
    await prisma.houseSiegeSignup.deleteMany({ where: { siegeId, characterId } })
    return { siegeId }
  },

  /** Ремонт дома из общака: шагами по 10%. */
  async repair(characterId: string) {
    const boss = await bossOf(characterId)
    const clan = boss.clan
    if (clan.houseDurability >= 100) throw AppError.validation('Дом цел')
    const steps = Math.ceil((100 - clan.houseDurability) / 10)
    const cost = steps * S.repairCostPer10
    return withTransaction(async tx => {
      const paid = await tx.clan.updateMany({
        where: { id: clan.id, treasury: { gte: cost } },
        data: { treasury: { decrement: cost }, houseDurability: 100 },
      })
      if (paid.count !== 1) throw new AppError(ErrorCode.CONFLICT, `На ремонт нужно ${cost.toLocaleString('ru')} ₽ в общаке`, 409)
      const after = await tx.clan.findUniqueOrThrow({ where: { id: clan.id }, select: { treasury: true } })
      await tx.clanTreasuryLog.create({
        data: { clanId: clan.id, characterId, amount: -cost, balanceAfter: after.treasury, reason: 'HOUSE_REPAIR' },
      })
      return { durability: 100, cost, treasury: after.treasury }
    })
  },

  /** Надпись на стене разгромленного дома. */
  async writeOnWall(characterId: string, clanId: string, text: string) {
    const clean = text.trim().slice(0, S.wallNoteMaxLength)
    if (!clean) throw AppError.validation('Напишите что-нибудь')
    const clan = await prisma.clan.findUnique({ where: { id: clanId }, select: { houseRazedUntil: true } })
    if (!clan?.houseRazedUntil || clan.houseRazedUntil <= new Date()) {
      throw new AppError(ErrorCode.CONFLICT, 'Писать на стене можно только в разгромленном доме', 409)
    }
    const member = await membership(characterId)
    if (member?.status === 'ACTIVE' && member.clanId === clanId) throw AppError.validation('На стене своего дома не пишут')
    const character = await prisma.character.findUniqueOrThrow({ where: { id: characterId }, select: { user: { select: { mutedUntil: true } } } })
    if (character.user.mutedUntil && character.user.mutedUntil > new Date()) {
      throw new AppError(ErrorCode.FORBIDDEN, 'У вас немота — писать нельзя', 403)
    }
    const siege = await prisma.houseSiege.findFirst({
      where: { defenderClanId: clanId, status: 'ATTACKERS_WON' }, orderBy: { finishedAt: 'desc' }, select: { id: true },
    })
    if (!siege) throw new AppError(ErrorCode.CONFLICT, 'Дом не был взят', 409)
    const mine = await prisma.houseWallNote.count({ where: { siegeId: siege.id, characterId } })
    if (mine >= S.wallNotesPerPlayer) throw new AppError(ErrorCode.CONFLICT, `Не больше ${S.wallNotesPerPlayer} надписей от одного игрока`, 409)
    const note = await prisma.houseWallNote.create({ data: { clanId, siegeId: siege.id, characterId, text: clean } })
    return { id: note.id }
  },

  /** Открыть бой по осаде, чьё время пришло. */
  async start(siegeId: string): Promise<'STARTED' | 'ATTACKERS_WON' | 'DEFENDERS_WON' | 'SKIPPED'> {
    const online = new Set((await ChatService.online(5000)).map(p => p.characterId))
    const now = new Date()
    const prepared = await withTransaction(async tx => {
      const claimed = await tx.houseSiege.updateMany({ where: { id: siegeId, status: 'SCHEDULED' }, data: { status: 'IN_BATTLE' } })
      if (claimed.count !== 1) return null
      const siege = await tx.houseSiege.findUniqueOrThrow({ where: { id: siegeId }, include: { signups: true } })
      const [attackMembers, defenceMembers] = await Promise.all([
        tx.clanMember.findMany({ where: { clanId: siege.attackerClanId, status: 'ACTIVE' }, select: { characterId: true } }),
        tx.clanMember.findMany({ where: { clanId: siege.defenderClanId, status: 'ACTIVE' }, select: { characterId: true } }),
      ])
      const attackSet = new Set(attackMembers.map(m => m.characterId))
      // Нападение — только записавшиеся; оборона — записавшиеся первыми,
      // затем все остальные бойцы бригады, кто в игре.
      const attackers = siege.signups.filter(s => s.side === 1 && attackSet.has(s.characterId)).map(s => s.characterId)
      const signedDefence = siege.signups.filter(s => s.side === 2).map(s => s.characterId)
      const defenders = [...new Set([...signedDefence, ...defenceMembers.map(m => m.characterId)])]

      const take = async (ids: string[]) => {
        const out: string[] = []
        for (const id of ids) {
          if (out.length >= S.maxPerSide) break
          if (!online.has(id)) continue
          const char = await tx.character.findUnique({ where: { id }, select: { traumaUntil: true, hpMax: true, hpCurrent: true } })
          if (!char || (char.traumaUntil && char.traumaUntil > now)) continue
          const busy = await tx.character.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'IN_BATTLE' } })
          if (busy.count === 1) out.push(id)
        }
        return out
      }
      const side1 = await take(attackers)
      const side2 = await take(defenders)
      await tx.houseSiege.update({ where: { id: siegeId }, data: { attackersCount: side1.length, defendersCount: side2.length } })
      if (!side1.length || !side2.length) {
        // Без боя: кто-то не пришёл. Занятых отпускаем сразу.
        if (side1.length + side2.length) {
          await tx.character.updateMany({ where: { id: { in: [...side1, ...side2] } }, data: { status: 'ACTIVE' } })
        }
        return { siege, battleId: null, side1, side2 }
      }
      const battle = await tx.battle.create({
        data: { type: 'CLAN', status: 'WAITING_PLAYERS', levelMin: 1, levelMax: 99, teamSize: S.maxPerSide, creatorId: siege.filedByCharacterId },
      })
      for (const [side, ids] of [[1, side1], [2, side2]] as const) {
        for (const id of ids) {
          const c = await tx.character.findUniqueOrThrow({ where: { id }, select: { hpMax: true, hpCurrent: true } })
          await tx.battleParticipant.create({ data: { battleId: battle.id, characterId: id, side, hpMax: c.hpMax, hpCurrent: c.hpCurrent } })
        }
      }
      await tx.houseSiege.update({ where: { id: siegeId }, data: { battleId: battle.id } })
      return { siege, battleId: battle.id, side1, side2 }
    })
    if (!prepared) return 'SKIPPED'
    if (!prepared.battleId) {
      // Оборона не вышла — дом взят без боя; нападение не пришло — осада провалена.
      const winner = prepared.side1.length ? 'ATTACKERS_WON' : 'DEFENDERS_WON'
      await this.conclude(siegeId, winner, [])
      return winner
    }
    try {
      await BattleService.beginTeamState(prepared.battleId)
    } catch (err) {
      logger.error({ err, siegeId }, '[HouseSiege] Battle start failed')
      await prisma.character.updateMany({ where: { id: { in: [...prepared.side1, ...prepared.side2] } }, data: { status: 'ACTIVE' } })
      await prisma.houseSiege.update({ where: { id: siegeId }, data: { status: 'CANCELLED', finishedAt: new Date() } })
      return 'SKIPPED'
    }
    audit('house_siege.started', { siegeId, battleId: prepared.battleId, attackers: prepared.side1.length, defenders: prepared.side2.length })
    return 'STARTED'
  },

  /** Итог осады: последствия для дома или для нападавших. */
  async conclude(siegeId: string, result: 'ATTACKERS_WON' | 'DEFENDERS_WON', attackers: string[], now = new Date()) {
    const siege = await withTransaction(async (tx: Prisma.TransactionClient) => {
      const done = await tx.houseSiege.updateMany({
        where: { id: siegeId, status: 'IN_BATTLE' },
        data: { status: result, finishedAt: now },
      })
      if (done.count !== 1) return null
      const row = await tx.houseSiege.findUniqueOrThrow({ where: { id: siegeId } })
      if (result === 'ATTACKERS_WON') {
        const clan = await tx.clan.findUniqueOrThrow({ where: { id: row.defenderClanId }, select: { houseDurability: true } })
        await tx.clan.update({
          where: { id: row.defenderClanId },
          data: {
            houseDurability: Math.max(0, clan.houseDurability - S.durabilityLoss),
            houseRazedUntil: new Date(now.getTime() + S.razedDays * DAY),
          },
        })
      } else if (attackers.length) {
        await tx.character.updateMany({
          where: { id: { in: attackers } },
          data: { traumaUntil: new Date(now.getTime() + S.traumaHours * HOUR) },
        })
      }
      return row
    })
    if (!siege) return
    const clans = new Map((await prisma.clan.findMany({
      where: { id: { in: [siege.attackerClanId, siege.defenderClanId] } }, select: { id: true, name: true, tag: true },
    })).map(c => [c.id, `«${c.name}» [${c.tag}]`]))
    const a = clans.get(siege.attackerClanId) ?? 'нападавшие'
    const d = clans.get(siege.defenderClanId) ?? 'оборона'
    await AnnouncementsService.world(
      result === 'ATTACKERS_WON' ? 'Дом взят' : 'Осада отбита',
      result === 'ATTACKERS_WON'
        ? `Бригада ${a} взяла дом бригады ${d}. Дом разгромлен на ${S.razedDays} суток.`
        : `Бригада ${d} отбила осаду бригады ${a}.`,
    )
    audit('house_siege.finished', { siegeId, result })
  },
}

/** Тик воркера: начать назначенные осады и подвести итог законченным боям. */
export async function runHouseSieges(now = new Date()): Promise<number> {
  let handled = 0
  const due = await prisma.houseSiege.findMany({
    where: { status: 'SCHEDULED', startsAt: { lte: now } }, select: { id: true }, take: 20,
  })
  for (const { id } of due) {
    try { if (await HouseSiegeService.start(id) !== 'SKIPPED') handled += 1 }
    catch (err) { logger.error({ err, siegeId: id }, '[HouseSiege] Start error') }
  }
  const fighting = await prisma.houseSiege.findMany({ where: { status: 'IN_BATTLE', battleId: { not: null } } })
  for (const siege of fighting) {
    const battle = await prisma.battle.findUnique({
      where: { id: siege.battleId! },
      include: { participants: { select: { id: true, side: true, characterId: true } } },
    })
    if (!battle || !['FINISHED', 'CANCELLED', 'TECHNICAL_WIN'].includes(battle.status)) continue
    const winner = battle.participants.find(p => p.id === battle.winnerParticipantId)
      ?? battle.participants.find(p => p.characterId && p.characterId === battle.winnerId)
    // Взятие — только если победила сторона нападения; ничья и сбой — оборона устояла.
    const result = winner?.side === 1 ? 'ATTACKERS_WON' : 'DEFENDERS_WON'
    const attackers = battle.participants.filter(p => p.side === 1 && p.characterId).map(p => p.characterId!)
    try { await HouseSiegeService.conclude(siege.id, result, attackers); handled += 1 }
    catch (err) { logger.error({ err, siegeId: siege.id }, '[HouseSiege] Conclude error') }
  }
  return handled
}

export const HOUSE_SIEGES_MS = 15_000
