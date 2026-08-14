import { DESIGNER_CELL_CENTERS, DESIGNER_CELL_NEIGHBOURS } from './designer-grid-adjacency'

// =============================================================
// Поле боя — шестиугольные соты, как в Апехе.
//
// Хранение осталось прежним: координаты (x, y) — это столбец и ряд
// смещённой сетки «odd-r»: нечётные ряды сдвинуты вправо на половину
// клетки. Благодаря этому размеры поля, спавны, сериализация ходов и
// формат позиций остаются совместимыми; поле расширено до 9×9, соседство
// и метрика расстояния.
//
// Считать расстояние на смещённых координатах нельзя: переводим их в
// кубические (q, r, s), где расстояние — половина суммы модулей.
// =============================================================
export const BATTLE_GRID = { width: 9, height: 9 } as const

export function hexNeighbours(position: GridPosition): GridPosition[] {
  return (DESIGNER_CELL_NEIGHBOURS[`${position.x}:${position.y}`] ?? []).map(value => {
    const [x, y] = value.split(':').map(Number)
    return { x, y }
  })
}

export interface GridPosition {
  x: number
  y: number
}

export interface PositionedParticipant {
  participantId: string
  side: number
  isAlive: boolean
  position: GridPosition
}

const TEAM_SPAWNS: Readonly<Record<1 | 2, readonly GridPosition[]>> = {
  // The battlefield is painted in perspective, not as a rectangular honeycomb.
  // The lead fighters start on authored cells with all six physical neighbours.
  1: [
    { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 },
    { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 0 },
    { x: 4, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 1 },
  ],
  2: [
    { x: 6, y: 4 }, { x: 4, y: 1 }, { x: 6, y: 0 },
    { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 },
    { x: 7, y: 1 }, { x: 7, y: 0 }, { x: 6, y: 1 },
  ],
}

export function teamSpawnPositions(side: number, count: number): GridPosition[] {
  if (!Number.isInteger(count) || count < 1 || count > BATTLE_GRID.height) {
    throw new Error(`Team size must be between 1 and ${BATTLE_GRID.height}`)
  }
  return TEAM_SPAWNS[side === 1 ? 1 : 2].slice(0, count).map(position => ({ ...position }))
}

export function selectEnemyTarget<T extends PositionedParticipant>(
  actor: T,
  participants: T[],
  requestedTargetId?: string,
): T {
  const enemies = participants.filter(participant => participant.isAlive && participant.side !== actor.side)
  const target = requestedTargetId
    ? enemies.find(participant => participant.participantId === requestedTargetId)
    : enemies.length === 1 ? enemies[0] : undefined
  if (!target) throw new Error('Invalid battle target')
  return target
}

export function isInsideGrid(position: GridPosition): boolean {
  return Number.isInteger(position.x) && Number.isInteger(position.y)
    && position.x >= 0 && position.x < BATTLE_GRID.width
    && position.y >= 0 && position.y < BATTLE_GRID.height
}

export function samePosition(a: GridPosition, b: GridPosition): boolean {
  return a.x === b.x && a.y === b.y
}

export function gridDistance(a: GridPosition, b: GridPosition): number {
  if (samePosition(a, b)) return 0
  const target = `${b.x}:${b.y}`
  const visited = new Set([`${a.x}:${a.y}`])
  let frontier = [a]
  for (let distance = 1; frontier.length > 0; distance++) {
    const next: GridPosition[] = []
    for (const cell of frontier) {
      for (const neighbour of hexNeighbours(cell)) {
        const key = `${neighbour.x}:${neighbour.y}`
        if (visited.has(key)) continue
        if (key === target) return distance
        visited.add(key)
        next.push(neighbour)
      }
    }
    frontier = next
  }
  return Number.POSITIVE_INFINITY
}

export function isAdjacentStep(from: GridPosition, to: GridPosition): boolean {
  return isInsideGrid(to) && hexNeighbours(from).some(cell => samePosition(cell, to))
}

export function participantAt(
  participants: PositionedParticipant[],
  position: GridPosition,
  exceptParticipantId?: string,
): PositionedParticipant | undefined {
  return participants.find(participant => participant.isAlive
    && participant.participantId !== exceptParticipantId
    && samePosition(participant.position, position))
}

export function canMoveTo(
  participant: PositionedParticipant,
  destination: GridPosition,
  participants: PositionedParticipant[],
): boolean {
  return isAdjacentStep(participant.position, destination)
    && !participantAt(participants, destination, participant.participantId)
}

export interface GridMoveRequest {
  participantId: string
  destination: GridPosition
}

export function resolveSimultaneousMoves(
  participants: PositionedParticipant[],
  requests: GridMoveRequest[],
): PositionedParticipant[] {
  const activeRequests = requests.filter((request, index) =>
    requests.findIndex(candidate => candidate.participantId === request.participantId) === index)
  if (activeRequests.length !== requests.length) throw new Error('Duplicate movement request')

  for (const request of activeRequests) {
    const actor = participants.find(participant => participant.participantId === request.participantId)
    if (!actor?.isAlive || !isAdjacentStep(actor.position, request.destination)) {
      throw new Error('Invalid destination cell')
    }
  }

  for (let index = 0; index < activeRequests.length; index++) {
    if (activeRequests.slice(index + 1).some(request =>
      samePosition(request.destination, activeRequests[index].destination))) {
      throw new Error('Multiple fighters cannot occupy the same cell')
    }
  }

  for (const request of activeRequests) {
    const blocker = participantAt(participants, request.destination, request.participantId)
    const blockerMovesAway = blocker && activeRequests.some(candidate =>
      candidate.participantId === blocker.participantId
      && !samePosition(candidate.destination, blocker.position))
    if (blocker && !blockerMovesAway) throw new Error('Destination cell is occupied')
  }

  return participants.map(participant => {
    const request = activeRequests.find(candidate => candidate.participantId === participant.participantId)
    return request
      ? { ...participant, position: { ...request.destination } }
      : { ...participant, position: { ...participant.position } }
  })
}

export function isInWeaponRange(
  attacker: GridPosition,
  target: GridPosition,
  maxRange: number,
): boolean {
  return gridDistance(attacker, target) <= Math.max(1, maxRange)
}

// Луч по сотам: линейная интерполяция в кубических координатах с
// округлением к ближайшей клетке. Любая занятая клетка на пути
// прикрывает тех, кто стоит за ней.
export function hasLineOfSight(
  from: GridPosition,
  to: GridPosition,
  participants: PositionedParticipant[],
  attackerId: string,
  targetId: string,
): boolean {
  if (gridDistance(from, to) <= 1) return true
  const start = DESIGNER_CELL_CENTERS[`${from.x}:${from.y}`]
  const end = DESIGNER_CELL_CENTERS[`${to.x}:${to.y}`]
  if (!start || !end) return false
  const dx = end[0] - start[0], dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  return !participants.some(participant => {
    if (!participant.isAlive || participant.participantId === attackerId || participant.participantId === targetId) return false
    const point = DESIGNER_CELL_CENTERS[`${participant.position.x}:${participant.position.y}`]
    if (!point) return false
    const projection = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared
    if (projection <= 0.05 || projection >= 0.95) return false
    const nearestX = start[0] + projection * dx
    const nearestY = start[1] + projection * dy
    return Math.hypot(point[0] - nearestX, point[1] - nearestY) < 4
  })
}

export function canAttackTarget(
  attacker: PositionedParticipant,
  target: PositionedParticipant,
  participants: PositionedParticipant[],
  maxRange: number,
): boolean {
  if (!attacker.isAlive || !target.isAlive || attacker.side === target.side) return false
  if (!isInWeaponRange(attacker.position, target.position, maxRange)) return false
  return maxRange <= 1 || hasLineOfSight(
    attacker.position,
    target.position,
    participants,
    attacker.participantId,
    target.participantId,
  )
}

/** Соседние клетки, которые сокращают дистанцию, ближайшая первой. */
export function stepToward(from: GridPosition, to: GridPosition): GridPosition[] {
  const current = gridDistance(from, to)
  return hexNeighbours(from)
    .filter(cell => gridDistance(cell, to) < current)
    .sort((a, b) => gridDistance(a, to) - gridDistance(b, to))
}

/** Соседние клетки, отсортированные по удалению от угрозы. */
export function stepAway(from: GridPosition, threat: GridPosition): GridPosition[] {
  return hexNeighbours(from)
    .sort((a, b) => gridDistance(b, threat) - gridDistance(a, threat))
}
