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

interface CubePosition { q: number; r: number; s: number }

/** Смещённые координаты «odd-r» -> кубические. */
function toCube(position: GridPosition): CubePosition {
  const q = position.x - (position.y - (position.y & 1)) / 2
  const r = position.y
  return { q, r, s: -q - r }
}

function cubeToGrid(cube: CubePosition): GridPosition {
  return { x: cube.q + (cube.r - (cube.r & 1)) / 2, y: cube.r }
}

function cubeRound(q: number, r: number, s: number): CubePosition {
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s)
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  else rs = -rq - rr
  return { q: rq, r: rr, s: rs }
}

/** Шесть соседей клетки. Набор смещений зависит от чётности ряда. */
const NEIGHBOUR_OFFSETS = {
  even: [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]],
  odd:  [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]],
} as const

export function hexNeighbours(position: GridPosition): GridPosition[] {
  const offsets = position.y & 1 ? NEIGHBOUR_OFFSETS.odd : NEIGHBOUR_OFFSETS.even
  return offsets
    .map(([dx, dy]) => ({ x: position.x + dx, y: position.y + dy }))
    .filter(isInsideGrid)
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

const SPAWN_ROWS = [4, 3, 5, 2, 6, 1, 7, 0, 8] as const

export function teamSpawnPositions(side: number, count: number): GridPosition[] {
  if (!Number.isInteger(count) || count < 1 || count > BATTLE_GRID.height) {
    throw new Error(`Team size must be between 1 and ${BATTLE_GRID.height}`)
  }
  const x = side === 1 ? 1 : BATTLE_GRID.width - 2
  return SPAWN_ROWS.slice(0, count).map(y => ({ x, y }))
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
  const ca = toCube(a), cb = toCube(b)
  return (Math.abs(ca.q - cb.q) + Math.abs(ca.r - cb.r) + Math.abs(ca.s - cb.s)) / 2
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
  const steps = gridDistance(from, to)
  if (steps <= 1) return true

  const a = toCube(from)
  const b = toCube(to)
  // Микросдвиг уводит луч с границы между двумя клетками: без него
  // округление на ровных диагоналях зависит от порядка сравнения.
  const nudge = 1e-6

  for (let step = 1; step < steps; step++) {
    const t = step / steps
    const cell = cubeToGrid(cubeRound(
      a.q + (b.q - a.q) * t + nudge,
      a.r + (b.r - a.r) * t + nudge,
      a.s + (b.s - a.s) * t - 2 * nudge,
    ))
    if (samePosition(cell, to) || samePosition(cell, from)) continue
    const blocker = participantAt(participants, cell, attackerId)
    if (blocker && blocker.participantId !== targetId) return false
  }
  return true
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
