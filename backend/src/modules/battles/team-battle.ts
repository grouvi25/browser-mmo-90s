/**
 * Командный бой: N против N на той же сетке и по тем же зонам, что и дуэль.
 *
 * Дуэльный резолвер написан на ровно двух бойцов — переменные part1/part2
 * идут через весь расчёт. Разворачивать его на команды означало бы
 * переписать заново уже работающий и оттестированный код, поэтому здесь
 * лежит отдельный проход по списку участников, а формулы удара, брони и
 * опыта переиспользуются как есть.
 */
import type { BattleAction } from '@prisma/client'
import type { BodyZone } from '@prisma/client'
import { prisma } from '../../shared/db/prisma'
import { AppError } from '../../shared/errors/app-error'
import { ErrorCode } from '../../shared/errors/error-codes'
import { withTransaction } from '../../shared/db/transaction'
import { audit } from '../../shared/logger/audit-logger'
import { CharactersRepository, type CharacterWithStats } from '../characters/characters.repository'
import { ItemsRepository, type ItemWithTemplate } from '../items/item-instance.repository'
import { WeaponSkillsRepository } from '../weapon-skills/weapon-skills.repository'
import { applyBattleProgression } from '../experience/progression'
import { calcBattleExp } from '../stats/stats.formulas'
import { calcInitiative } from './battle.formulas'
import { normalizeTurn, type ZonalTurnInput } from './zones'
import {
  canAttackTarget,
  resolveSimultaneousMoves,
  type GridPosition,
  type PositionedParticipant,
} from './grid'

/** Больше десяти на сторону сетка не разводит: спавнов ровно по высоте поля. */
export const TEAM_MAX_PER_SIDE = 10
export const TEAM_ROUND_LIMIT = 30

export interface TeamFighterContext {
  part: LiveTeamParticipant
  char: CharacterWithStats
  weaponLeft: ItemWithTemplate | null
  weaponRight: ItemWithTemplate | null
  armor: ItemWithTemplate[]
  initiative: number
  turn: ZonalTurnInput
}

/** Минимум состояния, который нужен командному проходу. */
export interface LiveTeamParticipant {
  participantId: string
  characterId?: string
  hpCurrent: number
  hpMax: number
  side: number
  isAlive: boolean
  isSurrendered: boolean
  hasActedThisRound: boolean
  pendingAction?: string
  pendingTurn?: ZonalTurnInput
  weaponInstanceId?: string
  leftWeaponInstanceId?: string
  rightWeaponInstanceId?: string
  pocketItemIds?: string[]
  damageDealt: number
  damageReceived: number
  hitsTaken: number
  hitsLanded: number
  skippedTurns: number
  position: GridPosition
}

export interface LiveTeamState {
  battleId: string
  type: string
  roundNumber: number
  status: 'active' | 'finishing'
  participants: LiveTeamParticipant[]
  roundDeadline?: number
  distance?: number
  grid?: { width: number; height: number }
}

export function aliveOfSide(state: LiveTeamState, side: number): LiveTeamParticipant[] {
  return state.participants.filter(p => p.side === side && p.isAlive && !p.isSurrendered)
}

/** Бой закончен, когда одна из сторон осталась без живых. */
export function teamOutcome(state: LiveTeamState): { over: boolean; winnerSide: number | null } {
  const sides = [...new Set(state.participants.map(p => p.side))]
  const standing = sides.filter(side => aliveOfSide(state, side).length > 0)
  if (standing.length <= 1) return { over: true, winnerSide: standing[0] ?? null }
  if (state.roundNumber >= TEAM_ROUND_LIMIT) return { over: true, winnerSide: null }
  return { over: false, winnerSide: null }
}

export function teamPositioned(state: LiveTeamState): PositionedParticipant[] {
  return state.participants.map(p => ({
    participantId: p.participantId,
    side: p.side,
    isAlive: p.isAlive,
    position: p.position,
  }))
}

/**
 * Перемещения всей команды разом. Дуэльный вариант принимал ровно двух
 * бойцов, здесь запросы собираются со всех, кто заказал шаг.
 */
export function applyTeamMoves(
  state: LiveTeamState,
  requests: Array<{ participantId: string; destination: GridPosition }>,
): Set<string> {
  if (requests.length === 0) return new Set()
  try {
    const resolved = resolveSimultaneousMoves(teamPositioned(state), requests)
    for (const participant of state.participants) {
      const next = resolved.find(candidate => candidate.participantId === participant.participantId)
      if (next) participant.position = next.position
    }
  } catch (error) {
    throw new AppError(
      ErrorCode.BATTLE_INVALID_ACTION,
      error instanceof Error ? error.message : 'Invalid movement request',
      400,
    )
  }
  return new Set(requests.map(r => r.participantId))
}

/**
 * Цель бойца: явно выбранная, иначе ближайший живой враг.
 *
 * В дуэли цель одна и выбирать нечего, в команде — нет: без запасного
 * правила боец с невалидной целью просто пропускал бы раунд.
 */
export function pickTeamTarget(
  actor: LiveTeamParticipant,
  state: LiveTeamState,
  requestedId?: string,
): LiveTeamParticipant | null {
  const enemies = state.participants.filter(p => p.side !== actor.side && p.isAlive && !p.isSurrendered)
  if (enemies.length === 0) return null
  if (requestedId) {
    const requested = enemies.find(p => p.participantId === requestedId)
    if (requested) return requested
  }
  return enemies.reduce((closest, candidate) => {
    const dCandidate = Math.abs(candidate.position.x - actor.position.x) + Math.abs(candidate.position.y - actor.position.y)
    const dClosest = Math.abs(closest.position.x - actor.position.x) + Math.abs(closest.position.y - actor.position.y)
    return dCandidate < dClosest ? candidate : closest
  })
}

/** Порядок ударов в раунде — по инициативе, как в дуэли. */
export function orderByInitiative(contexts: TeamFighterContext[]): TeamFighterContext[] {
  return [...contexts].sort((a, b) => b.initiative - a.initiative)
}

export function turnOfParticipant(part: LiveTeamParticipant, utilityUsed: boolean): ZonalTurnInput {
  if (utilityUsed) return normalizeTurn({ stance: 'defense4', attackZones: [], blockZones: [] })
  return part.pendingTurn ?? normalizeTurn({ stance: 'defense4', attackZones: [], blockZones: [] })
}

export function initiativeOf(char: CharacterWithStats, skillLevel: number, weight: number): number {
  return calcInitiative(char.stats!.rea, char.stats!.agi, skillLevel, weight)
}

export function canReach(
  actor: PositionedParticipant,
  target: PositionedParticipant,
  board: PositionedParticipant[],
  range: number,
): boolean {
  return canAttackTarget(actor, target, board, range)
}

/**
 * Начисление за командный бой. Опыт считается той же формулой, что и в
 * дуэли, но точкой отсчёта берётся средний уровень вражеской стороны:
 * иначе награда прыгала бы от того, кого именно поставили первым.
 */
export async function finishTeamBattle(
  battleId: string,
  state: LiveTeamState,
  winnerSide: number | null,
  contexts: Map<string, TeamFighterContext>,
) {
  const sides = [...new Set(state.participants.map(p => p.side))]
  const averageLevel = (side: number) => {
    const members = state.participants.filter(p => p.side === side)
    if (members.length === 0) return 1
    const total = members.reduce((sum, p) => {
      const ctx = contexts.get(p.participantId)
      return sum + (ctx?.char.battleLevel ?? 1)
    }, 0)
    return Math.max(1, Math.round(total / members.length))
  }
  const enemySideOf = (side: number) => sides.find(s => s !== side) ?? side
  const averageHp = (side: number) => {
    const members = state.participants.filter(p => p.side === side)
    if (members.length === 0) return 1
    return Math.max(1, Math.round(members.reduce((sum, p) => sum + p.hpMax, 0) / members.length))
  }

  const payouts = state.participants.map(part => {
    const ctx = contexts.get(part.participantId)
    const enemySide = enemySideOf(part.side)
    const enemyLevel = averageLevel(enemySide)
    const levelDiff = Math.abs((ctx?.char.battleLevel ?? 1) - enemyLevel)
    const result = winnerSide === null ? 'DRAW' : winnerSide === part.side ? 'PVP_WIN' : 'PVP_LOSS'
    const exp = calcBattleExp(
      part.damageDealt,
      enemyLevel * 5,
      averageHp(enemySide),
      levelDiff,
      result as 'PVP_WIN' | 'PVP_LOSS' | 'DRAW',
    )
    return { part, ctx, exp, won: winnerSide !== null && winnerSide === part.side }
  })

  return withTransaction(async tx => {
    const progress: Record<string, { expGain: number; newLevel: number; hp: number }> = {}
    for (const payout of payouts) {
      if (!payout.ctx) continue
      const applied = await applyBattleProgression(tx, payout.ctx.char, {
        expGain: payout.exp,
        hpCurrentAfterBattle: payout.part.hpCurrent,
        won: payout.won,
      })
      progress[payout.ctx.char.id] = {
        expGain: payout.exp,
        newLevel: applied.newLevel,
        hp: Math.max(1, payout.part.hpCurrent),
      }
      await tx.battleParticipant.updateMany({
        where: { battleId, characterId: payout.ctx.char.id },
        data: {
          hpCurrent: payout.part.hpCurrent,
          isAlive: payout.part.isAlive,
          damageDealt: payout.part.damageDealt,
          damageReceived: payout.part.damageReceived,
          hitsLanded: payout.part.hitsLanded,
          hitsTaken: payout.part.hitsTaken,
          expGained: payout.exp,
          moneyGained: 0,
        },
      })
    }

    // Победителем в БД пишем одного бойца выигравшей стороны: колонка
    // рассчитана на дуэль, а сторона целиком в неё не помещается.
    const winnerPart = winnerSide === null
      ? null
      : state.participants.find(p => p.side === winnerSide && p.characterId)
    await tx.battle.update({
      where: { id: battleId },
      data: {
        status: 'FINISHED',
        winnerId: winnerPart?.characterId ?? null,
        winnerParticipantId: winnerPart?.participantId ?? null,
        finishedAt: new Date(),
        roundCount: state.roundNumber,
      },
    })

    audit('battle.finished', {
      battleId,
      type: 'CLAN',
      winnerSide,
      participants: payouts.map(p => ({ id: p.ctx?.char.id, exp: p.exp, won: p.won })),
    })

    return {
      battleOver: true,
      winnerSide,
      rounds: state.roundNumber,
      rewards: progress,
    }
  })
}

/** Записи ходов раунда для журнала боя. */
export function teamMoveRecords(
  battleId: string,
  roundNumber: number,
  moved: Set<string>,
  before: Map<string, GridPosition>,
  state: LiveTeamState,
) {
  return state.participants
    .filter(p => moved.has(p.participantId) && p.characterId)
    .map(p => ({
      battleId,
      roundNumber,
      actorCharId: p.characterId!,
      action: 'MOVE' as BattleAction,
      fromX: before.get(p.participantId)?.x ?? p.position.x,
      fromY: before.get(p.participantId)?.y ?? p.position.y,
      toX: p.position.x,
      toY: p.position.y,
    }))
}

export type { BodyZone }
export { CharactersRepository, ItemsRepository, WeaponSkillsRepository, prisma }
