export interface TimeoutParticipant {
  characterId?: string
  isAlive: boolean
  isSurrendered: boolean
  hasActedThisRound: boolean
}

export interface TimeoutBattleState {
  status: string
  roundDeadline?: number
  participants: TimeoutParticipant[]
}

export function timedOutCharacterIds(state: TimeoutBattleState, now: number): string[] {
  if (state.status !== 'active' || !state.roundDeadline || now < state.roundDeadline) return []
  return state.participants
    .filter(participant => participant.characterId && participant.isAlive && !participant.isSurrendered && !participant.hasActedThisRound)
    .map(participant => participant.characterId!)
}
