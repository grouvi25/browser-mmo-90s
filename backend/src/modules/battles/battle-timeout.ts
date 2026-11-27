export interface TimeoutParticipant {
  characterId?: string
  isAlive: boolean
  isSurrendered: boolean
  hasActedThisRound: boolean
  /** Замёрз (второй пропущенный ход): за него ходит таймер сразу, не дожидаясь срока. */
  frozen?: boolean
}

export interface TimeoutBattleState {
  status: string
  roundDeadline?: number
  participants: TimeoutParticipant[]
}

export function timedOutCharacterIds(state: TimeoutBattleState, now: number): string[] {
  if (state.status !== 'active') return []
  const expired = !!state.roundDeadline && now >= state.roundDeadline
  return state.participants
    .filter(participant => participant.characterId && participant.isAlive && !participant.isSurrendered && !participant.hasActedThisRound)
    .filter(participant => expired || participant.frozen)
    .map(participant => participant.characterId!)
}

/** Дима 15.11: первый пропуск — боец просто стоит, второй (даже не подряд) — замерзает до конца боя. */
export const FREEZE_AFTER_MISSED = 2

/** Метки пропущенного хода в строке журнала (battle_turns.log_line). */
export const IDLE_SKIP = 'Пропустил ход'
export const IDLE_FROZEN = 'Замёрз'
/** Цель удачной засады в первом раунде (обращение №196). */
export const IDLE_SURPRISED = 'Застигнут врасплох'
