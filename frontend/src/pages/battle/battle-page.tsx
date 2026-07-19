import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useEffect } from 'react'
import { battlesApi } from '../../shared/api/battles.api'
import { type BattleAction } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'

interface RoundResult {
  roundNumber?: number
  playerHp?: number
  botHp?: number
  battleOver?: boolean
  result?: string
  expGain?: number
  weaponExpGain?: number
  moneyReward?: number
  newLevel?: number
  waiting?: boolean
  turns?: Array<{
    actor: string
    action: string
    hit: boolean
    dodge: boolean
    block: boolean
    crit: boolean
    rawDamage: number
    finalDamage: number
    logParts: string[]
  }>
}

interface LogEntry {
  text: string
  type: 'hit' | 'miss' | 'crit' | 'block' | 'dodge' | 'system' | 'result'
}

// UUID validation regex
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function buildLogLines(result: RoundResult): LogEntry[] {
  const lines: LogEntry[] = []

  if (result.turns) {
    result.turns.forEach(turn => {
      const actor  = turn.actor === 'player' ? 'ВЫ' : 'ВРАГ'
      const target = turn.actor === 'player' ? 'ВРАГУ' : 'ВАМ'

      if (!turn.hit) {
        lines.push({ text: `Раунд: ${actor} — Промах`, type: 'miss' })
      } else if (turn.dodge) {
        lines.push({ text: `Раунд: ${actor} → ${target} — Уворот!`, type: 'dodge' })
      } else if (turn.block) {
        lines.push({ text: `Раунд: ${actor} → ${target} — Заблокировано (−${turn.finalDamage} HP)`, type: 'block' })
      } else if (turn.crit) {
        lines.push({ text: `Раунд: ${actor} → ${target} — КРИТ! −${turn.finalDamage} HP`, type: 'crit' })
      } else {
        lines.push({ text: `Раунд: ${actor} → ${target} — Удар −${turn.finalDamage} HP`, type: 'hit' })
      }
    })
  }

  if (result.battleOver) {
    const won = result.result === 'PVE_WIN'
    if (won) {
      lines.push({
        text: `=== ПОБЕДА! Опыт: +${result.expGain ?? 0} | Навык: +${Number(result.weaponExpGain ?? 0).toFixed(1)} | Деньги: +${result.moneyReward ?? 0} ===`,
        type: 'result',
      })
      if ((result.newLevel ?? 1) > 1) {
        lines.push({ text: `🎉 Новый уровень: ${result.newLevel}!`, type: 'result' })
      }
    } else {
      lines.push({ text: '=== ПОРАЖЕНИЕ ===', type: 'result' })
    }
  }

  return lines
}

export function BattlePage() {
  const { id: battleId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const logRef = useRef<HTMLDivElement>(null)

  const [log, setLog] = useState<LogEntry[]>([{ text: 'Бой начался!', type: 'system' }])
  const [actionError, setActionError] = useState('')
  const [battleFinished, setBattleFinished] = useState(false)
  const [finishResult, setFinishResult] = useState<RoundResult | null>(null)

  // Guard: redirect to profile if battleId is not a valid UUID
  const isValidId = !!battleId && UUID_RE.test(battleId)

  useEffect(() => {
    if (!isValidId) {
      navigate('/profile', { replace: true })
    }
  }, [isValidId, navigate])

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    enabled: isValidId,
  })

  const { data: battleData } = useQuery({
    queryKey: ['battle', battleId],
    queryFn: () => battlesApi.getBattle(battleId!),
    enabled: isValidId && !battleFinished,
    refetchInterval: (query) => {
      const status = query.state.data?.battle?.status
      if (status === 'FINISHED' || status === 'CANCELLED' || battleFinished) return false
      return 3000
    },
  })

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [log])

  const actionMut = useMutation({
    mutationFn: (action: BattleAction) =>
      battlesApi.submitAction(battleId!, action),
    onSuccess: (data: RoundResult) => {
      const newLines = buildLogLines(data)
      setLog(prev => [...prev, ...newLines])

      if (data.battleOver) {
        setBattleFinished(true)
        setFinishResult(data)
        localStorage.removeItem('mmo_current_battle')
        qc.invalidateQueries({ queryKey: ['character', 'me'] })
        qc.invalidateQueries({ queryKey: ['inventory'] })
      }
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Ошибка сервера'
      setActionError(msg)
      setTimeout(() => setActionError(''), 4000)
    },
  })

  if (!isValidId) {
    return <div className="loading"><span className="spinner" />Перенаправление...</div>
  }

  const liveState  = battleData?.liveState
  const battle     = battleData?.battle
  const playerPart = liveState?.participants.find(p => p.characterId === char?.id)
  const enemyPart  = liveState?.participants.find(p => !!p.botId || p.characterId !== char?.id)

  const playerHp    = playerPart?.hpCurrent ?? char?.hpCurrent ?? 0
  const playerHpMax = playerPart?.hpMax     ?? char?.hpMax     ?? 1
  const enemyHp     = enemyPart?.hpCurrent  ?? 0
  const enemyHpMax  = enemyPart?.hpMax      ?? 1

  const playerHpPct = Math.max(0, Math.min(100, (playerHp / playerHpMax) * 100))
  const enemyHpPct  = Math.max(0, Math.min(100, (enemyHp  / enemyHpMax)  * 100))

  const canAct = !battleFinished && !actionMut.isPending
  const round  = liveState?.roundNumber ?? 1

  const actions: Array<{ action: BattleAction; label: string; cls: string }> = [
    { action: 'attack',    label: '⚔️ Атака',   cls: 'btn-danger'  },
    { action: 'block',     label: '🛡️ Блок',    cls: 'btn-primary' },
    { action: 'surrender', label: '🏳️ Сдаться', cls: ''            },
  ]

  return (
    <div style={{ maxWidth: 700 }}>
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">⚔️ БОЙ</span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Раунд {round}
            {battleFinished ? ' — ЗАВЕРШЁН' : battle?.status === 'ACTIVE' ? ' — Идёт...' : ''}
          </span>
        </div>
        <div className="panel-body">
          {/* HP bars */}
          <div className="battle-hp-bars">
            <div className="combatant-hp">
              <div className="combatant-name" style={{ color: 'var(--success)' }}>
                👤 {char?.nickname ?? 'Вы'}
              </div>
              <div className="stat-bar-wrap">
                <div className="stat-bar" style={{ flex: 1 }}>
                  <div className="stat-bar-fill hp" style={{ width: `${playerHpPct}%` }} />
                </div>
                <div className="stat-bar-val">{playerHp}/{playerHpMax}</div>
              </div>
            </div>
            <div className="combatant-hp">
              <div className="combatant-name" style={{ color: 'var(--danger)' }}>
                💀 Противник
              </div>
              <div className="stat-bar-wrap">
                <div className="stat-bar" style={{ flex: 1 }}>
                  <div className="stat-bar-fill hp" style={{ width: `${enemyHpPct}%` }} />
                </div>
                <div className="stat-bar-val">{enemyHp}/{enemyHpMax}</div>
              </div>
            </div>
          </div>

          {/* Battle log */}
          <div className="battle-log" ref={logRef}>
            {log.map((line, i) => (
              <div key={i} className={`battle-log-line ${line.type}`}>
                {line.text}
              </div>
            ))}
            {actionMut.isPending && (
              <div className="battle-log-line system">
                <span className="spinner" /> Обработка хода...
              </div>
            )}
          </div>

          {/* Actions */}
          {!battleFinished && (
            <div>
              {actionError && <div className="alert alert-error mt8">{actionError}</div>}
              <div className="battle-actions mt8">
                {actions.map(({ action, label, cls }) => (
                  <button
                    key={action}
                    className={`btn ${cls}`}
                    disabled={!canAct}
                    onClick={() => actionMut.mutate(action)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Finish result */}
          {battleFinished && finishResult && (
            <div className="panel mt12"
              style={{ borderColor: finishResult.result === 'PVE_WIN' ? 'var(--success)' : 'var(--danger)' }}>
              <div className="panel-header">
                <span className="panel-title">
                  {finishResult.result === 'PVE_WIN' ? '🏆 ПОБЕДА!' : '💀 ПОРАЖЕНИЕ'}
                </span>
              </div>
              <div className="panel-body">
                <table className="data-table mb8">
                  <tbody>
                    {(finishResult.expGain ?? 0) > 0 && (
                      <tr><td>Боевой опыт</td>
                        <td style={{ color: 'var(--xp)' }}>+{finishResult.expGain}</td></tr>
                    )}
                    {(finishResult.weaponExpGain ?? 0) > 0 && (
                      <tr><td>Навык оружия</td>
                        <td style={{ color: 'var(--accent)' }}>+{Number(finishResult.weaponExpGain).toFixed(2)}</td></tr>
                    )}
                    {(finishResult.moneyReward ?? 0) > 0 && (
                      <tr><td>Деньги</td>
                        <td className="money">+{finishResult.moneyReward}</td></tr>
                    )}
                    {(finishResult.newLevel ?? 0) > 1 && (
                      <tr><td>Уровень</td>
                        <td style={{ color: 'var(--gold)' }}>🎉 {finishResult.newLevel}</td></tr>
                    )}
                  </tbody>
                </table>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" onClick={() => navigate('/profile')}>
                    ← Профиль
                  </button>
                  <button className="btn" onClick={() => navigate('/repair')}>
                    🔧 Ремонт
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
