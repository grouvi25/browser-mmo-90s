// =============================================================
// Помощник и собака на поле боя (правка заказчика 28.10).
//
// «Помощник (боевой) — его в бою нужно вызывать. Когда вызываешь, он
// появляется на клетке справа от персонажа. Если она занята, то на
// следующей справа, и так далее, сверху вниз по клеткам. С собакой
// аналогично. Помощник и собака играют сами, как боты».
//
// Раньше обе фигуры на поле не стояли: били цель хозяина вслед за ним.
// Теперь до вызова их в бою нет, а вызванные занимают клетку, ходят и бьют
// сами каждый раунд после бойцов, и по ним можно бить. Выбитая фигура уходит
// с поля. Исход боя решают только люди: фигуры в подсчёт живых не входят.
//
// Числа стартовые, как и у остального баланса помощника и собаки.
// =============================================================
import type { HelperTactic } from '@prisma/client'
import {
  BATTLE_GRID,
  canMoveTo,
  gridDistance,
  hexNeighbours,
  samePosition,
  stepTowardOrAround,
  type GridPosition,
  type PositionedParticipant,
} from './grid'
import { COMBAT_HELPER } from './combat-helper'
import { COMBAT_DOG } from './combat-dog'

export type CompanionKind = 'helper' | 'dog'

/** Метка в строке журнала: удар по хозяину принял на себя его помощник. */
export const INTERCEPT_MARK = 'помощник принял удар на себя'

/** Что фигура несёт в бою — общее у помощника и собаки. */
export interface CompanionBody {
  id: string
  name: string
  level: number
  hp: number
  hpMax: number
  alive: boolean
  damageDealt: number
  /** Есть, только когда фигура вызвана на поле. */
  position?: GridPosition
  summoned?: boolean
}

/** Хозяин фигуры — участник боя (минимум полей, общий у дуэльного и командного состояний). */
export interface CompanionOwner {
  participantId: string
  side: number
  isAlive: boolean
  position: GridPosition
  helper?: CompanionBody & { tactic: HelperTactic }
  dog?: CompanionBody & { stats?: DogCombatStats }
}

/** Боевые числа собаки из её характеристик (dogs.ts). */
export interface DogCombatStats {
  str: number; agi: number; rea: number; acc: number; end: number; luck: number
}

/** Адрес фигуры на поле: «helper:<участник хозяина>» или «dog:<…>». */
export function companionId(kind: CompanionKind, ownerParticipantId: string): string {
  return `${kind}:${ownerParticipantId}`
}

export function parseCompanionId(id: string | undefined): { kind: CompanionKind; ownerParticipantId: string } | null {
  if (!id) return null
  const match = /^(helper|dog):(.+)$/.exec(id)
  return match ? { kind: match[1] as CompanionKind, ownerParticipantId: match[2] } : null
}

function bodyOf(owner: CompanionOwner, kind: CompanionKind): CompanionBody | undefined {
  return kind === 'helper' ? owner.helper : owner.dog
}

/** Вызванные и живые фигуры — для доски: они занимают клетки. */
export function companionCells(owners: readonly CompanionOwner[]): PositionedParticipant[] {
  const out: PositionedParticipant[] = []
  for (const owner of owners) {
    for (const kind of ['helper', 'dog'] as const) {
      const body = bodyOf(owner, kind)
      if (body?.summoned && body.alive && body.position) {
        out.push({ participantId: companionId(kind, owner.participantId), side: owner.side, isAlive: true, position: { ...body.position } })
      }
    }
  }
  return out
}

function exists(cell: GridPosition): boolean {
  return cell.x >= 0 && cell.x < BATTLE_GRID.width && cell.y >= 0 && cell.y < BATTLE_GRID.height && hexNeighbours(cell).length > 0
}

/**
 * Клетка для вызова: справа от хозяина; занята — следующая справа и так до
 * края ряда; весь ряд занят — ряды сверху вниз, в каждом слева направо от
 * столбца справа от хозяина, а потом любая свободная клетка поля.
 */
export function summonCell(owner: GridPosition, board: readonly PositionedParticipant[]): GridPosition | null {
  const free = (cell: GridPosition) => exists(cell) && !board.some(p => p.isAlive && samePosition(p.position, cell))
  for (let x = owner.x + 1; x < BATTLE_GRID.width; x++) {
    if (free({ x, y: owner.y })) return { x, y: owner.y }
  }
  for (let y = 0; y < BATTLE_GRID.height; y++) {
    for (let x = owner.x + 1; x < BATTLE_GRID.width; x++) if (free({ x, y })) return { x, y }
  }
  for (let y = 0; y < BATTLE_GRID.height; y++) {
    for (let x = 0; x < BATTLE_GRID.width; x++) if (free({ x, y })) return { x, y }
  }
  return null
}

/** Здоровье собаки на поле: уровень и выносливость. */
export function dogHpMax(level: number, end: number): number {
  return COMBAT_DOG.hpBase + COMBAT_DOG.hpPerLevel * Math.max(1, level) + COMBAT_DOG.hpPerEnd * Math.max(0, end)
}

export interface CompanionStrike { hit: boolean; crit: boolean; damage: number }

/** Удар фигуры: числа помощника по тактике, у собаки — по её характеристикам. */
export function companionStrike(owner: CompanionOwner, kind: CompanionKind, rnd: () => number = Math.random): CompanionStrike {
  if (kind === 'helper') {
    const helper = owner.helper!
    const t = COMBAT_HELPER.tactics[helper.tactic]
    if (rnd() >= COMBAT_HELPER.hitChance) return { hit: false, crit: false, damage: 0 }
    const min = COMBAT_HELPER.damageMin + COMBAT_HELPER.damageMinPerLevel * helper.level
    const max = COMBAT_HELPER.damageMax + COMBAT_HELPER.damageMaxPerLevel * helper.level
    const crit = rnd() < COMBAT_HELPER.critChance
    return { hit: true, crit, damage: Math.max(1, Math.round((min + (max - min) * rnd()) * t.damage * (crit ? COMBAT_HELPER.critMultiplier : 1))) }
  }
  const dog = owner.dog!
  const s = dog.stats
  const hitChance = Math.min(0.95, COMBAT_DOG.hitChance + COMBAT_DOG.hitPerAcc * (s?.acc ?? 0))
  if (rnd() >= hitChance) return { hit: false, crit: false, damage: 0 }
  const min = COMBAT_DOG.damageMin + COMBAT_DOG.damageMinPerLevel * dog.level + COMBAT_DOG.damagePerStr * (s?.str ?? 0)
  const max = COMBAT_DOG.damageMax + COMBAT_DOG.damageMaxPerLevel * dog.level + COMBAT_DOG.damagePerStr * (s?.str ?? 0)
  const crit = rnd() < Math.min(0.5, COMBAT_DOG.critChance + COMBAT_DOG.critPerLuck * (s?.luck ?? 0))
  return { hit: true, crit, damage: Math.max(1, Math.round((min + (max - min) * rnd()) * (crit ? COMBAT_DOG.critMultiplier : 1))) }
}

/** Характеристики фигуры как защитника — для удара игрока по ней. */
export function companionDefenceStats(owner: CompanionOwner, kind: CompanionKind): Record<string, number> {
  if (kind === 'dog') {
    const s = owner.dog?.stats
    return { agi: 3 + (s?.agi ?? 0), rea: 2 + (s?.rea ?? 0), end: 3 + (s?.end ?? 0), luck: 1 + (s?.luck ?? 0) }
  }
  const level = owner.helper?.level ?? 1
  return { agi: 2 + Math.floor(level / 2), rea: 2 + Math.floor(level / 3), end: 3 + Math.floor(level / 2), luck: 1 }
}

/** Урон по фигуре: при нуле она выбывает и освобождает клетку. */
export function damageCompanion(body: CompanionBody, damage: number): void {
  body.hp = Math.max(0, body.hp - damage)
  if (body.hp === 0) body.alive = false
}

/** Цель на поле для фигуры: боец или чужая фигура. */
export interface FieldTarget {
  id: string
  side: number
  position: GridPosition
}

export type CompanionEvent =
  | { kind: CompanionKind; owner: CompanionOwner; type: 'move'; from: GridPosition; to: GridPosition }
  | { kind: CompanionKind; owner: CompanionOwner; type: 'attack'; targetId: string; strike: CompanionStrike }

/**
 * Ход фигуры, как у бота: враг рядом — бьёт, нет — шаг к нему. Помощник
 * по тактике: «атакующая» и «стандартная» идут на ближайшего (стандартная —
 * сперва на цель хозяина), «защитная» держится у хозяина и бьёт тех, кто к
 * нему подошёл. Собака идёт на ближайшего.
 *
 * board — актуальная доска (бойцы, фигуры, бочки); move и strike применяют
 * результат к состоянию боя: фигура не знает, как устроен дуэльный или
 * командный бой.
 */
export function companionTurn(params: {
  owner: CompanionOwner
  kind: CompanionKind
  enemies: readonly FieldTarget[]
  /** Цель хозяина в этом раунде, если есть. */
  ownerTargetId?: string | null
  board: () => PositionedParticipant[]
  strike: (targetId: string, hit: CompanionStrike) => void
  rnd?: () => number
}): CompanionEvent | null {
  const { owner, kind } = params
  const body = kind === 'helper' ? owner.helper : owner.dog
  if (!body?.summoned || !body.alive || !body.position) return null
  const here = body.position
  const alive = params.enemies
  if (alive.length === 0) return null
  const byDistance = [...alive].sort((a, b) => gridDistance(here, a.position) - gridDistance(here, b.position))
  let target: FieldTarget | undefined = byDistance[0]
  const tactic = kind === 'helper' ? owner.helper!.tactic : 'ATTACK'
  if (tactic === 'STANDARD' && params.ownerTargetId) {
    target = alive.find(t => t.id === params.ownerTargetId) ?? target
  }
  if (tactic === 'DEFENSIVE') {
    // Бьёт только того, кто подошёл к хозяину; иначе держится рядом с ним.
    const threat = [...alive]
      .filter(t => gridDistance(owner.position, t.position) <= 2)
      .sort((a, b) => gridDistance(here, a.position) - gridDistance(here, b.position))[0]
    if (!threat) {
      if (gridDistance(here, owner.position) <= 1) return null
      return step(params, body, owner.position)
    }
    target = threat
  }
  if (!target) return null
  if (gridDistance(here, target.position) <= 1) {
    const hit = companionStrike(owner, kind, params.rnd)
    params.strike(target.id, hit)
    return { kind, owner, type: 'attack', targetId: target.id, strike: hit }
  }
  return step(params, body, target.position)
}

function step(
  params: { owner: CompanionOwner; kind: CompanionKind; board: () => PositionedParticipant[] },
  body: CompanionBody,
  toward: GridPosition,
): CompanionEvent | null {
  const self = companionId(params.kind, params.owner.participantId)
  const board = params.board()
  const me = board.find(p => p.participantId === self)
  if (!me || !body.position) return null
  const destination = stepTowardOrAround(body.position, toward).find(cell => canMoveTo(me, cell, board))
  if (!destination) return null
  const from = { ...body.position }
  body.position = { ...destination }
  return { kind: params.kind, owner: params.owner, type: 'move', from, to: { ...destination } }
}
