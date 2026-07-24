export const BATTLE_GRID = { width: 9, height: 5 } as const

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

export function isInsideGrid(position: GridPosition): boolean {
  return Number.isInteger(position.x) && Number.isInteger(position.y)
    && position.x >= 0 && position.x < BATTLE_GRID.width
    && position.y >= 0 && position.y < BATTLE_GRID.height
}

export function samePosition(a: GridPosition, b: GridPosition): boolean {
  return a.x === b.x && a.y === b.y
}

export function gridDistance(a: GridPosition, b: GridPosition): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

export function isAdjacentStep(from: GridPosition, to: GridPosition): boolean {
  return isInsideGrid(to) && gridDistance(from, to) === 1
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

export function isInWeaponRange(
  attacker: GridPosition,
  target: GridPosition,
  maxRange: number,
): boolean {
  return gridDistance(attacker, target) <= Math.max(1, maxRange)
}

// Integer grid line. Every occupied intermediate cell protects participants behind it.
export function hasLineOfSight(
  from: GridPosition,
  to: GridPosition,
  participants: PositionedParticipant[],
  attackerId: string,
  targetId: string,
): boolean {
  const dx = Math.abs(to.x - from.x)
  const dy = Math.abs(to.y - from.y)
  const sx = from.x < to.x ? 1 : -1
  const sy = from.y < to.y ? 1 : -1
  let err = dx - dy
  let x = from.x
  let y = from.y

  while (!(x === to.x && y === to.y)) {
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 < dx) { err += dx; y += sy }
    if (x === to.x && y === to.y) break
    const blocker = participantAt(participants, { x, y }, attackerId)
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

export function stepToward(from: GridPosition, to: GridPosition): GridPosition[] {
  const candidates: GridPosition[] = []
  const dx = Math.sign(to.x - from.x)
  const dy = Math.sign(to.y - from.y)
  if (dx !== 0) candidates.push({ x: from.x + dx, y: from.y })
  if (dy !== 0) candidates.push({ x: from.x, y: from.y + dy })
  return candidates.filter(isInsideGrid)
}

export function stepAway(from: GridPosition, threat: GridPosition): GridPosition[] {
  const candidates = [
    { x: from.x + 1, y: from.y }, { x: from.x - 1, y: from.y },
    { x: from.x, y: from.y + 1 }, { x: from.x, y: from.y - 1 },
  ].filter(isInsideGrid)
  return candidates.sort((a, b) => gridDistance(b, threat) - gridDistance(a, threat))
}
