// =============================================================
// Журнал боя: строки из ходов, сохранённых в battle_turns.
//
// Правка заказчика (20.10.2026): «Лог журнала должен сохраняться.
// Пусть будет 10 строк, и их можно листать 1-2-3-4-5 страница».
// Раньше журнал жил только в открытой странице: после перезагрузки или
// конца боя он пропадал, хотя каждый ход уже лежал в базе. Готовая
// строка хода (logLine) есть не у всех ходов и без имён («Удар в левая
// рука: 10»), поэтому текст собирается здесь из полей хода.
// =============================================================
import type { AttackHand, BattleAction, BodyZone } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'

export const JOURNAL_PAGE_SIZE = 10

/** Куда пришёлся удар — винительный падеж: «в левую руку». */
const ZONE_TO: Record<BodyZone, string> = {
  HEAD: 'в голову', CHEST: 'в корпус', LEFT_ARM: 'в левую руку', RIGHT_ARM: 'в правую руку',
  LEFT_LEG: 'в левую ногу', RIGHT_LEG: 'в правую ногу', LEGS: 'по ногам',
}
const HAND: Record<AttackHand, string> = { LEFT_HAND: 'левой', RIGHT_HAND: 'правой' }

export type JournalKind = 'hit' | 'crit' | 'pierce' | 'dodge' | 'block' | 'move' | 'item' | 'weapon' | 'surrender'

export interface JournalTurn {
  action: BattleAction
  zone: BodyZone | null
  sourceHand: AttackHand | null
  hit: boolean; dodge: boolean; block: boolean; crit: boolean; blockPierced: boolean
  finalDamage: number
  logLine?: string | null
  /** Ход дальнобойным оружием: в журнале «выстрел», а не «удар»
   *  (просьба игрока 22.10: бандит с пистолетом «бьёт» с 4 клеток). */
  ranged?: boolean
}

/** Снятая третьим попаданием вещь (wounds.ts) дописывается к строке удара. */
const STRIP_NOTE = /(оружие выбито из (?:левой|правой) руки|броня на [а-яё ]+ сбита)/

/** Текст хода без имён: «удар левой в корпус, −5 HP» / «выстрел в голову — уворот». */
export function describeTurn(turn: JournalTurn): { kind: JournalKind; text: string } {
  const zone = turn.zone ? ` ${ZONE_TO[turn.zone]}` : ''
  // У выстрела руки нет: «выстрел левой» звучит странно, а пистолет бьёт с любой.
  const hand = turn.sourceHand && !turn.ranged ? ` ${HAND[turn.sourceHand]}` : ''
  const attack = turn.ranged ? 'выстрел' : 'удар'
  const damage = turn.finalDamage > 0 ? `, −${turn.finalDamage} HP` : ''
  switch (turn.action) {
    // «Походил, ударил» (правка заказчика 22.10): шаг — отдельной строкой.
    case 'MOVE': return { kind: 'move', text: 'делает шаг' }
    case 'BLOCK': return { kind: 'block', text: 'уходит в защиту' }
    case 'USE_ITEM': return { kind: 'item', text: 'использует предмет из кармана' }
    case 'CHANGE_WEAPON': return { kind: 'weapon', text: 'меняет оружие' }
    case 'SURRENDER': return { kind: 'surrender', text: 'сдаётся' }
    default: break
  }
  if (!turn.hit && turn.block) return { kind: 'block', text: `${attack}${hand}${zone} — блок` }
  if (!turn.hit) return { kind: 'dodge', text: `${attack}${hand}${zone} — уворот` }
  const strip = turn.logLine?.match(STRIP_NOTE)?.[1]
  const tail = strip ? ` — ${strip}` : ''
  if (turn.blockPierced) return { kind: 'pierce', text: `пробил блок${zone}${damage}${tail}` }
  if (turn.crit) return { kind: 'crit', text: `крит${zone}${damage}${tail}` }
  return { kind: 'hit', text: `${attack}${hand}${zone}${damage}${tail}` }
}

export const BattleJournal = {
  /** Страница журнала: новые строки сверху, по 10 на страницу. Журнал
   *  открыт любому игроку, как в «Апехе»: бой — событие города. */
  async page(battleId: string, page = 1, perPage = JOURNAL_PAGE_SIZE) {
    const battle = await prisma.battle.findUnique({
      where: { id: battleId },
      select: {
        id: true, type: true, status: true, roundCount: true, startedAt: true, finishedAt: true, winnerParticipantId: true,
        participants: { select: { id: true, characterId: true, botId: true, side: true, character: { select: { nickname: true } }, bot: { select: { name: true, equipment: true } } } },
      },
    })
    if (!battle) throw new AppError(ErrorCode.BATTLE_NOT_FOUND, 'Бой не найден', 404)

    const total = await prisma.battleTurn.count({ where: { battleId } })
    const pages = Math.max(1, Math.ceil(total / perPage))
    const current = Math.min(Math.max(1, Math.floor(page)), pages)
    const turns = await prisma.battleTurn.findMany({
      where: { battleId },
      orderBy: [{ roundNumber: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: (current - 1) * perPage,
      take: perPage,
    })

    const nameOf = new Map<string, string>()
    const sideOf = new Map<string, number>()
    for (const p of battle.participants) {
      const key = p.characterId ?? p.botId
      if (!key) continue
      nameOf.set(key, p.character?.nickname ?? p.bot?.name ?? 'Боец')
      sideOf.set(key, p.side)
    }
    // Боевой помощник: подписывается своим именем и сражается за сторону хозяина.
    const helperIds = [...new Set(turns.flatMap(t => [t.actorHelperId, t.targetHelperId]).filter((id): id is string => !!id))]
    if (helperIds.length) {
      const helpers = await prisma.helper.findMany({ where: { id: { in: helperIds } }, select: { id: true, name: true, characterId: true } })
      for (const h of helpers) { nameOf.set(h.id, `${h.name} (помощник)`); sideOf.set(h.id, sideOf.get(h.characterId) ?? 1) }
    }
    // Собака хозяина — тоже своим именем и за его сторону.
    const petIds = [...new Set(turns.map(t => t.actorPetId).filter((id): id is string => !!id))]
    if (petIds.length) {
      const pets = await prisma.characterPet.findMany({ where: { id: { in: petIds } }, select: { id: true, name: true, characterId: true } })
      for (const pet of pets) { nameOf.set(pet.id, `${pet.name} (собака)`); sideOf.set(pet.id, sideOf.get(pet.characterId) ?? 1) }
    }
    const name = (id: string | null) => (id ? nameOf.get(id) ?? 'Боец' : null)
    const winner = battle.participants.find(p => p.id === battle.winnerParticipantId)

    // Дальнобойность оружия каждого хода: выстрелы подписываются выстрелами.
    // Игроки — по weaponId хода; боты weaponId не пишут, их оружие берём
    // из equipment бота по коду шаблона.
    const weaponIds = [...new Set(turns.map(t => t.weaponId).filter((id): id is string => !!id))]
    const rangedOf = new Map<string, boolean>()
    if (weaponIds.length) {
      const weapons = await prisma.itemInstance.findMany({
        where: { id: { in: weaponIds } },
        select: { id: true, template: { select: { maxRange: true } } },
      })
      for (const w of weapons) rangedOf.set(w.id, (w.template.maxRange ?? 1) > 1)
    }
    const botRangedOf = new Map<string, boolean>()
    const botCodes = new Set<string>()
    for (const p of battle.participants) {
      if (!p.bot?.equipment || typeof p.bot.equipment !== 'object') continue
      const code = (p.bot.equipment as Record<string, unknown>).mainWeapon
      if (typeof code === 'string' && code) botCodes.add(code)
    }
    if (botCodes.size) {
      const templates = await prisma.itemTemplate.findMany({
        where: { code: { in: [...botCodes] } },
        select: { code: true, maxRange: true },
      })
      for (const t of templates) botRangedOf.set(t.code, (t.maxRange ?? 1) > 1)
    }
    const isRanged = (turn: { weaponId: string | null; actorBotId: string | null }) => {
      if (turn.weaponId) return rangedOf.get(turn.weaponId) ?? false
      if (turn.actorBotId) {
        const bot = battle.participants.find(p => p.botId === turn.actorBotId)
        const code = bot?.bot?.equipment && typeof bot.bot.equipment === 'object'
          ? (bot.bot.equipment as Record<string, unknown>).mainWeapon : null
        return typeof code === 'string' ? botRangedOf.get(code) ?? false : false
      }
      return false
    }

    return {
      battle: {
        id: battle.id, type: battle.type, status: battle.status, rounds: battle.roundCount,
        startedAt: battle.startedAt, finishedAt: battle.finishedAt,
        winner: winner ? winner.character?.nickname ?? winner.bot?.name ?? null : null,
      },
      items: turns.map(turn => {
        const actorId = turn.actorCharId ?? turn.actorBotId ?? turn.actorHelperId ?? turn.actorPetId
        const described = describeTurn({ ...turn, ranged: isRanged(turn) })
        // Удар по хозяину, принятый помощником на себя.
        const { kind, text } = turn.targetHelperId && turn.hit ? { kind: described.kind, text: described.text + ' — принял на себя' } : described
        return {
          id: turn.id,
          round: turn.roundNumber,
          at: turn.createdAt,
          actor: name(actorId) ?? 'Боец',
          target: name(turn.targetCharId ?? turn.targetBotId ?? turn.targetHelperId),
          side: actorId ? sideOf.get(actorId) ?? 1 : 1,
          kind,
          text,
        }
      }),
      page: current, pages, total,
    }
  },
}
