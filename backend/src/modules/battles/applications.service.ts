// =============================================================
// Заявки на бой — как в «Королях» и на Апехе.
//
// Правка заказчика (октябрь 2026): бой не открывается в момент создания.
// Заявка висит в общем списке с таймером («начнётся через 5 минут»), к
// ней присоединяются, а когда время выходит, воркер открывает бой сам.
// Если к старту на одной из сторон никого нет — заявка снимается.
//
// Пока заявка ждёт, персонаж свободен: может ходить по городу и
// покупать. Занят боем он становится только при старте — тогда же
// отсеиваются те, кто к этому моменту ушёл на смену или в другой бой.
// =============================================================
import { prisma } from '../../shared/db/prisma'
import { withTransaction } from '../../shared/db/transaction'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { audit } from '../../shared/logger/audit-logger'
import { logger } from '../../shared/logger/logger'
import { CharactersRepository } from '../characters/characters.repository'
import { BattleService, assertIntoxicationAllowsBattle } from './battles.service'
import { TEAM_MAX_PER_SIDE } from './team-battle'

export type ApplicationKind = 'DUEL' | 'GROUP' | 'CHAOTIC'

/** Через сколько минут после создания заявка стартует. */
export const APPLICATION_DELAYS = [1, 3, 5, 10] as const
export const DEFAULT_APPLICATION_DELAY = 5
/** Больше пяти на сторону экран боя не вмещает без давки. */
export const APPLICATION_MAX_TEAM = Math.min(5, TEAM_MAX_PER_SIDE)

export interface CreateApplicationInput {
  kind: ApplicationKind
  delayMinutes?: number
  teamSize?: number
  levelMin?: number
  levelMax?: number
}

function kindOf(battle: { type: string; isChaotic: boolean }): ApplicationKind {
  if (battle.type === 'PVP_DUEL') return 'DUEL'
  return battle.isChaotic ? 'CHAOTIC' : 'GROUP'
}

/** Мест в заявке всего: у хаотичной стороны появляются только на старте. */
function capacity(kind: ApplicationKind, teamSize: number): number {
  return kind === 'DUEL' ? 2 : teamSize * 2
}

async function freeCharacter(userId: string) {
  const char = await CharactersRepository.findByUserId(userId)
  if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
  assertIntoxicationAllowsBattle(char)
  if (char.status === 'IN_BATTLE') throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Вы уже в бою', 409)
  if (char.status !== 'ACTIVE') throw new AppError(ErrorCode.CHARACTER_IN_BATTLE, 'Сейчас вы заняты: закончите смену или другое дело', 409)
  const waiting = await prisma.battleParticipant.findFirst({
    where: { characterId: char.id, battle: { status: 'WAITING_PLAYERS', startsAt: { not: null } } },
    select: { battleId: true },
  })
  if (waiting) throw new AppError(ErrorCode.CONFLICT, 'Вы уже стоите в другой заявке — сначала выйдите из неё', 409)
  return char
}

export const ApplicationsService = {
  async create(userId: string, input: CreateApplicationInput) {
    const char = await freeCharacter(userId)
    const delay = input.delayMinutes ?? DEFAULT_APPLICATION_DELAY
    if (!(APPLICATION_DELAYS as readonly number[]).includes(delay)) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Время до старта: ${APPLICATION_DELAYS.join(', ')} мин.`, 422)
    }
    const teamSize = input.kind === 'DUEL' ? 1 : input.teamSize ?? 2
    const minTeam = input.kind === 'CHAOTIC' ? 2 : 1
    if (!Number.isInteger(teamSize) || teamSize < minTeam || teamSize > APPLICATION_MAX_TEAM) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, `Бойцов на сторону: от ${minTeam} до ${APPLICATION_MAX_TEAM}`, 422)
    }
    const spread = input.kind === 'DUEL' ? 2 : 5
    const levelMin = input.levelMin ?? Math.max(1, char.battleLevel - spread)
    const levelMax = input.levelMax ?? Math.min(99, char.battleLevel + spread)
    if (levelMin > levelMax || char.battleLevel < levelMin || char.battleLevel > levelMax) {
      throw new AppError(ErrorCode.VALIDATION_ERROR, 'Ваш уровень должен входить в диапазон заявки', 422)
    }

    const battle = await withTransaction(async tx => {
      const created = await tx.battle.create({
        data: {
          type: input.kind === 'DUEL' ? 'PVP_DUEL' : 'CLAN',
          status: 'WAITING_PLAYERS',
          levelMin, levelMax,
          teamSize,
          isChaotic: input.kind === 'CHAOTIC',
          creatorId: char.id,
          startsAt: new Date(Date.now() + delay * 60_000),
        },
      })
      await tx.battleParticipant.create({
        data: { battleId: created.id, characterId: char.id, side: 1, hpMax: char.hpMax, hpCurrent: char.hpCurrent },
      })
      return created
    })
    audit('battle.application.created', { battleId: battle.id, kind: input.kind, characterId: char.id, delay })
    return { battleId: battle.id, status: 'WAITING_PLAYERS', startsAt: battle.startsAt }
  },

  async join(userId: string, battleId: string, side?: number) {
    const char = await freeCharacter(userId)
    const battle = await prisma.battle.findUnique({ where: { id: battleId }, include: { participants: true } })
    if (!battle || !battle.startsAt) throw AppError.notFound('Заявка', battleId)
    if (battle.status !== 'WAITING_PLAYERS' || battle.startsAt.getTime() <= Date.now()) {
      throw new AppError(ErrorCode.BATTLE_NOT_ACTIVE, 'Заявка уже закрыта', 409)
    }
    if (char.battleLevel < battle.levelMin || char.battleLevel > battle.levelMax) {
      throw new AppError(ErrorCode.CONFLICT, `Нужен уровень ${battle.levelMin}–${battle.levelMax}`, 409)
    }
    const kind = kindOf(battle)
    const teamSize = battle.teamSize ?? 1
    let joinSide: number
    if (kind === 'CHAOTIC') {
      if (battle.participants.length >= capacity(kind, teamSize)) throw new AppError(ErrorCode.CONFLICT, 'Заявка набрана', 409)
      // Сторону хаотичного боя решит жребий на старте; до того все на первой.
      joinSide = 1
    } else {
      joinSide = kind === 'DUEL' ? 2 : side ?? 2
      if (joinSide !== 1 && joinSide !== 2) throw new AppError(ErrorCode.VALIDATION_ERROR, 'Сторона: 1 или 2', 422)
      if (battle.participants.filter(p => p.side === joinSide).length >= teamSize) {
        throw new AppError(ErrorCode.CONFLICT, 'Эта сторона уже набрана', 409)
      }
    }
    // Мест могло не остаться между проверкой и записью: считаем ещё раз
    // внутри транзакции.
    await withTransaction(async tx => {
      const taken = await tx.battleParticipant.count({
        where: kind === 'CHAOTIC' ? { battleId } : { battleId, side: joinSide },
      })
      const limit = kind === 'CHAOTIC' ? capacity(kind, teamSize) : teamSize
      if (taken >= limit) throw new AppError(ErrorCode.CONFLICT, 'Мест больше нет', 409)
      await tx.battleParticipant.create({
        data: { battleId, characterId: char.id, side: joinSide, hpMax: char.hpMax, hpCurrent: char.hpCurrent },
      })
    })
    // Заявка набрана — ждать таймер незачем (жалоба заказчика «дуэль не
    // принимается»: вызов приняли, а бой открывался только через 1–10 мин).
    // startsAt сдвигаем на «сейчас», чтобы уборка зависших захватов видела
    // реальное время старта.
    const filled = await prisma.battleParticipant.count({ where: { battleId } })
    if (filled >= capacity(kind, teamSize)) {
      await prisma.battle.updateMany({ where: { id: battleId, status: 'WAITING_PLAYERS' }, data: { startsAt: new Date() } })
      const result = await this.start(battleId)
      return { battleId, side: joinSide, started: result === 'STARTED' }
    }
    return { battleId, side: joinSide, started: false }
  },

  /** Выйти из заявки. Создатель уходит — заявка снимается целиком. */
  async leave(userId: string, battleId: string) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    const battle = await prisma.battle.findUnique({ where: { id: battleId }, include: { participants: true } })
    if (!battle || !battle.startsAt) throw AppError.notFound('Заявка', battleId)
    if (battle.status !== 'WAITING_PLAYERS') throw new AppError(ErrorCode.BATTLE_NOT_ACTIVE, 'Заявка уже закрыта', 409)
    const mine = battle.participants.find(p => p.characterId === char.id)
    if (!mine) throw new AppError(ErrorCode.BATTLE_NOT_PARTICIPANT, 'Вас нет в этой заявке', 403)
    if (battle.creatorId === char.id) {
      const cancelled = await prisma.battle.updateMany({
        where: { id: battleId, status: 'WAITING_PLAYERS' },
        data: { status: 'CANCELLED', finishedAt: new Date() },
      })
      if (cancelled.count !== 1) throw new AppError(ErrorCode.BATTLE_NOT_ACTIVE, 'Заявка уже закрыта', 409)
      return { battleId, cancelled: true }
    }
    await prisma.battleParticipant.delete({ where: { id: mine.id } })
    return { battleId, cancelled: false }
  },

  /** Общий список: заявки с таймером и идущие бои. */
  async list(userId: string) {
    const char = await CharactersRepository.findByUserId(userId)
    const [waiting, active] = await Promise.all([
      prisma.battle.findMany({
        where: { status: 'WAITING_PLAYERS', startsAt: { not: null } },
        include: { participants: true },
        orderBy: { startsAt: 'asc' },
        take: 60,
      }),
      prisma.battle.findMany({
        where: { status: 'ACTIVE', type: { in: ['PVP_DUEL', 'CLAN'] } },
        include: { participants: true },
        orderBy: { startedAt: 'desc' },
        take: 20,
      }),
    ])
    const ids = [...waiting, ...active].flatMap(b => b.participants.map(p => p.characterId).filter(Boolean) as string[])
    const fighters = new Map((await prisma.character.findMany({
      where: { id: { in: ids } }, select: { id: true, nickname: true, battleLevel: true },
    })).map(c => [c.id, c]))
    const view = (id: string | null) => {
      const found = id ? fighters.get(id) : undefined
      return { id, nickname: found?.nickname ?? '—', level: found?.battleLevel ?? 0 }
    }
    const busy = waiting.some(b => b.participants.some(p => p.characterId === char?.id))
    // Бои осад домов бригад и налётов на дома игроков идут тем же движком,
    // но в списке подписаны осадой.
    const sieges = new Set([
      ...(await prisma.houseSiege.findMany({ where: { battleId: { in: active.map(b => b.id) } }, select: { battleId: true } })),
      ...(await prisma.homeRaid.findMany({ where: { battleId: { in: active.map(b => b.id) } }, select: { battleId: true } })),
    ].map(s => s.battleId))
    const level = char?.battleLevel ?? 0

    return {
      serverTime: new Date(),
      applications: waiting.map(b => {
        const kind = kindOf(b)
        const teamSize = b.teamSize ?? 1
        const inLevel = level >= b.levelMin && level <= b.levelMax
        const sides = kind === 'CHAOTIC'
          ? [{ side: 0, members: b.participants.map(p => view(p.characterId)) }]
          : [1, 2].map(side => ({ side, members: b.participants.filter(p => p.side === side).map(p => view(p.characterId)) }))
        const free = (side: number) => kind === 'CHAOTIC'
          ? b.participants.length < capacity(kind, teamSize)
          : b.participants.filter(p => p.side === side).length < teamSize
        return {
          battleId: b.id,
          kind,
          teamSize,
          levelMin: b.levelMin,
          levelMax: b.levelMax,
          startsAt: b.startsAt,
          creator: view(b.creatorId),
          isMine: b.participants.some(p => p.characterId === char?.id),
          isCreator: b.creatorId === char?.id,
          sides,
          // Можно ли встать: уровень, свобода персонажа и место на стороне.
          canJoin: sides.map(s => ({
            side: s.side,
            ok: !busy && inLevel && char?.status === 'ACTIVE' && free(s.side) && (kind !== 'DUEL' || s.side === 2),
          })),
        }
      }),
      active: active.map(b => ({
        battleId: b.id,
        kind: sieges.has(b.id) ? 'SIEGE' as const : kindOf(b),
        startedAt: b.startedAt,
        sides: [1, 2].map(side => ({ side, members: b.participants.filter(p => p.side === side).map(p => view(p.characterId)) })),
      })),
    }
  },

  /** Где сейчас персонаж: в заявке или уже в бою. Клиент по этому уводит в бой. */
  async current(userId: string) {
    const char = await CharactersRepository.findByUserId(userId)
    if (!char) throw new AppError(ErrorCode.CHARACTER_NOT_FOUND, 'Персонаж не найден', 404)
    const [battle, application] = await Promise.all([
      prisma.battleParticipant.findFirst({
        where: { characterId: char.id, battle: { status: 'ACTIVE' } },
        orderBy: { battle: { startedAt: 'desc' } },
        select: { battleId: true },
      }),
      prisma.battleParticipant.findFirst({
        where: { characterId: char.id, battle: { status: 'WAITING_PLAYERS', startsAt: { not: null } } },
        select: { battle: { select: { id: true, startsAt: true } } },
      }),
    ])
    // Статус «в бою» без боя не даёт ни драться, ни вернуться: отпускаем
    // сразу, не дожидаясь минутной уборки воркера.
    if (!battle && char.status === 'IN_BATTLE') {
      await prisma.character.updateMany({
        where: {
          id: char.id, status: 'IN_BATTLE',
          battlesAsParticipant: { none: { battle: { status: { in: ['CREATED', 'WAITING_PLAYERS', 'ACTIVE'] } } } },
        },
        data: { status: 'ACTIVE' },
      })
    }
    return {
      battleId: battle?.battleId ?? null,
      application: application ? { battleId: application.battle.id, startsAt: application.battle.startsAt } : null,
    }
  },

  /** Открыть бой по одной заявке, чьё время пришло. */
  async start(battleId: string): Promise<'STARTED' | 'CANCELLED' | 'SKIPPED'> {
    const prepared = await withTransaction(async tx => {
      // Захват заявки: если воркеров станет два, второй увидит 0 и уйдёт.
      const claimed = await tx.battle.updateMany({
        where: { id: battleId, status: 'WAITING_PLAYERS' },
        data: { status: 'CREATED' },
      })
      if (claimed.count !== 1) return null
      const battle = await tx.battle.findUniqueOrThrow({ where: { id: battleId }, include: { participants: true } })
      const kind = kindOf(battle)
      const ready: typeof battle.participants = []
      for (const part of battle.participants) {
        const taken = await tx.character.updateMany({
          where: { id: part.characterId!, status: 'ACTIVE' },
          data: { status: 'IN_BATTLE' },
        })
        // Кто к старту ушёл на смену или в другой бой — выпадает из заявки,
        // а не срывает её остальным.
        if (taken.count !== 1) { await tx.battleParticipant.delete({ where: { id: part.id } }); continue }
        const fresh = await tx.character.findUniqueOrThrow({ where: { id: part.characterId! }, select: { hpMax: true, hpCurrent: true } })
        ready.push(await tx.battleParticipant.update({ where: { id: part.id }, data: { hpMax: fresh.hpMax, hpCurrent: fresh.hpCurrent } }))
      }
      if (kind === 'CHAOTIC') {
        // Жребий: перемешать и раздать по очереди — стороны выходят равными
        // с точностью до одного бойца.
        const shuffled = [...ready].sort(() => Math.random() - 0.5)
        for (const [index, part] of shuffled.entries()) {
          part.side = index % 2 === 0 ? 1 : 2
          await tx.battleParticipant.update({ where: { id: part.id }, data: { side: part.side } })
        }
      }
      const sideOne = ready.filter(p => p.side === 1).length
      const sideTwo = ready.filter(p => p.side === 2).length
      const enough = kind === 'DUEL' ? sideOne === 1 && sideTwo === 1 : sideOne > 0 && sideTwo > 0
      if (!enough) {
        await tx.battle.update({ where: { id: battleId }, data: { status: 'CANCELLED', finishedAt: new Date() } })
        if (ready.length) {
          await tx.character.updateMany({ where: { id: { in: ready.map(p => p.characterId!) } }, data: { status: 'ACTIVE' } })
        }
        return { kind, ok: false as const, fighters: [] as string[] }
      }
      return { kind, ok: true as const, fighters: ready.map(p => p.characterId!) }
    })
    if (!prepared) return 'SKIPPED'
    if (!prepared.ok) {
      audit('battle.application.cancelled', { battleId, reason: 'NOT_ENOUGH_FIGHTERS' })
      return 'CANCELLED'
    }
    try {
      if (prepared.kind === 'DUEL') await BattleService.beginDuelState(battleId)
      else await BattleService.beginTeamState(battleId)
    } catch (err) {
      // Бой не собрался — бойцов отпускаем, иначе они навсегда «в бою».
      logger.error({ err, battleId }, '[Applications] Battle start failed')
      await prisma.battle.update({ where: { id: battleId }, data: { status: 'CANCELLED', finishedAt: new Date() } })
      await prisma.character.updateMany({ where: { id: { in: prepared.fighters } }, data: { status: 'ACTIVE' } })
      return 'CANCELLED'
    }
    audit('battle.application.started', { battleId, kind: prepared.kind, fighters: prepared.fighters.length })
    return 'STARTED'
  },
}

/** Тик воркера: открыть все заявки, чьё время пришло. */
export async function runBattleApplications(now = new Date()): Promise<number> {
  // Заявка, застрявшая в захвате дольше двух минут, — след упавшего
  // процесса между захватом и открытием боя. Снимаем и отпускаем бойцов.
  const stuck = await prisma.battle.findMany({
    where: { status: 'CREATED', startsAt: { lte: new Date(now.getTime() - 120_000) } },
    include: { participants: { select: { characterId: true } } },
  })
  for (const battle of stuck) {
    await prisma.battle.update({ where: { id: battle.id }, data: { status: 'CANCELLED', finishedAt: now } })
    const ids = battle.participants.map(p => p.characterId).filter(Boolean) as string[]
    if (ids.length) await prisma.character.updateMany({ where: { id: { in: ids }, status: 'IN_BATTLE' }, data: { status: 'ACTIVE' } })
  }
  const due = await prisma.battle.findMany({
    where: { status: 'WAITING_PLAYERS', startsAt: { lte: now } },
    select: { id: true },
    orderBy: { startsAt: 'asc' },
    take: 50,
  })
  let handled = 0
  for (const { id } of due) {
    try {
      if (await ApplicationsService.start(id) !== 'SKIPPED') handled += 1
    } catch (err) {
      logger.error({ err, battleId: id }, '[Applications] Start error')
    }
  }
  return handled
}

export const BATTLE_APPLICATIONS_MS = 5_000
