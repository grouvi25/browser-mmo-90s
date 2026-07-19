import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useEffect } from 'react'
import { battlesApi } from '../../shared/api/battles.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { type BattleAction } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface LogEntry {
  text: string
  type: 'attack' | 'crit' | 'miss' | 'dodge' | 'block' | 'system' | 'result' | 'change' | 'heal'
  round?: number
}

interface RoundResult {
  roundNumber?: number; playerHp?: number; botHp?: number; battleOver?: boolean
  result?: string; expGain?: number; weaponExpGain?: number; moneyReward?: number
  newLevel?: number; waiting?: boolean
  turns?: Array<{
    actor: string; action: string; hit: boolean; dodge: boolean; block: boolean
    crit: boolean; rawDamage: number; finalDamage: number; logParts: string[]
  }>
}

function buildLogLines(result: RoundResult, round: number): LogEntry[] {
  const lines: LogEntry[] = []
  if (result.turns) {
    result.turns.forEach(turn => {
      const actor  = turn.actor === 'player' ? 'ВЫ'   : 'ВРАГ'
      const target = turn.actor === 'player' ? 'ВРАГУ' : 'ВАМ'
      if (turn.action === 'change_weapon') {
        lines.push({ text: `${actor}: Сменил оружие`, type: 'change', round })
        return
      }
      if (turn.action === 'use_item') {
        lines.push({ text: `${actor}: Использовал предмет`, type: 'heal', round })
        return
      }
      if (!turn.hit) {
        lines.push({ text: `${actor} → ${target}: Промах!`, type: 'miss', round })
      } else if (turn.dodge) {
        lines.push({ text: `${actor} → ${target}: Уворот!`, type: 'dodge', round })
      } else if (turn.block) {
        lines.push({ text: `${actor} → ${target}: Блок! (−${turn.finalDamage} HP)`, type: 'block', round })
      } else if (turn.crit) {
        lines.push({ text: `${actor} → ${target}: ⚡ КРИТ! −${turn.finalDamage} HP`, type: 'crit', round })
      } else {
        lines.push({ text: `${actor} → ${target}: Удар −${turn.finalDamage} HP`, type: 'attack', round })
      }
    })
  }
  if (result.battleOver) {
    const won = result.result === 'PVE_WIN'
    lines.push({
      text: won
        ? `══ ПОБЕДА! Опыт: +${result.expGain ?? 0} | Навык: +${Number(result.weaponExpGain ?? 0).toFixed(1)} | ₽+${result.moneyReward ?? 0} ══`
        : '══ ПОРАЖЕНИЕ ══',
      type: 'result', round,
    })
    if ((result.newLevel ?? 0) > 1) {
      lines.push({ text: `🎉 НОВЫЙ УРОВЕНЬ: ${result.newLevel}!`, type: 'result', round })
    }
  }
  return lines
}

function HpBar({ current, max, side }: { current: number; max: number; side: 'player' | 'enemy' }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0
  const color = pct > 60 ? 'green' : pct > 25 ? 'yellow' : 'red'
  const bgMap = { green: 'var(--green)', yellow: 'var(--warning)', red: 'var(--red)' }
  return (
    <div className="fighter-hp-wrap">
      {side === 'enemy' && <div className="fighter-hp-text">{current}/{max}</div>}
      <div className="fighter-hp-bar" style={{ transform: side === 'enemy' ? 'scaleX(-1)' : 'none' }}>
        <div className={`fighter-hp-fill ${color}`}
          style={{ width: `${pct}%`, background: bgMap[color] }} />
      </div>
      {side === 'player' && <div className="fighter-hp-text">{current}/{max}</div>}
    </div>
  )
}

export function BattlePage() {
  const { id: battleId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const logRef = useRef<HTMLDivElement>(null)

  const [log, setLog] = useState<LogEntry[]>([{ text: '── Бой начался! ──', type: 'system', round: 0 }])
  const [actionError, setActionError] = useState('')
  const [battleFinished, setBattleFinished] = useState(false)
  const [finishResult, setFinishResult] = useState<RoundResult | null>(null)
  const [selectedWeapon, setSelectedWeapon] = useState<string>('')
  const [currentRound, setCurrentRound] = useState(1)

  const isValidId = !!battleId && UUID_RE.test(battleId)

  useEffect(() => {
    if (!isValidId) navigate('/profile', { replace: true })
  }, [isValidId, navigate])

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    enabled: isValidId,
  })

  // Оружие в инвентаре (для смены)
  const { data: items = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryApi.getItems(),
    enabled: isValidId && !!char,
  })

  const weapons = items.filter(i =>
    i.template.type === 'WEAPON' && i.status !== 'BROKEN' && i.status !== 'DELETED'
  )

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

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  const actionMut = useMutation({
    mutationFn: ({ action, itemId }: { action: BattleAction; itemId?: string }) =>
      battlesApi.submitAction(battleId!, action, itemId),
    onSuccess: (data: RoundResult) => {
      if (data.roundNumber) setCurrentRound(data.roundNumber)
      const newLines = buildLogLines(data, data.roundNumber ?? currentRound)
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

  if (!isValidId) return <div className="loading"><span className="spinner" />Перенаправление...</div>

  const liveState  = battleData?.liveState
  const battle     = battleData?.battle
  const playerPart = liveState?.participants.find(p => p.characterId === char?.id)
  const enemyPart  = liveState?.participants.find(p => !!p.botId || p.characterId !== char?.id)

  const playerHp    = playerPart?.hpCurrent ?? char?.hpCurrent ?? 0
  const playerHpMax = playerPart?.hpMax     ?? char?.hpMax     ?? 1
  const enemyHp     = enemyPart?.hpCurrent  ?? 0
  const enemyHpMax  = enemyPart?.hpMax      ?? 1

  const equippedWeapon = items.find(i => i.isEquipped && i.template.type === 'WEAPON')
  const canAct = !battleFinished && !actionMut.isPending

  const act = (action: BattleAction, itemId?: string) =>
    actionMut.mutate({ action, itemId })

  // Расходники в инвентаре
  const consumables = items.filter(i =>
    i.template.type === 'CONSUMABLE' && i.status !== 'DELETED'
  )

  return (
    <div style={{ maxWidth: 760 }}>
      {/* ─── Арена боя ──────────────────────── */}
      <div className="panel panel-red">
        <div className="panel-header">
          <span className="panel-title">⚔️ АРЕНА</span>
          <span className="round-indicator" style={{ margin: 0 }}>
            Раунд {currentRound}
            {battleFinished ? ' — ЗАВЕРШЁН' : battle?.status === 'ACTIVE' ? ' — Идёт...' : ''}
          </span>
        </div>
        <div className="panel-body" style={{ padding: 0 }}>
          <div className="battle-arena">
            <div className="battle-arena-bg" />

            <div className="round-indicator" style={{ marginBottom: 8, fontSize: 11 }}>
              ━━━━━━━━━━ РАУНД {currentRound} ━━━━━━━━━━
            </div>

            <div className="battle-fighters">
              {/* Игрок */}
              <div className={`fighter player${!playerPart?.isAlive && battleFinished ? ' defeated' : ''}`}>
                <div className="fighter-name">
                  <span className="fighter-icon">🧍</span>
                  <span>{char?.nickname ?? 'Вы'}</span>
                </div>
                <HpBar current={playerHp} max={playerHpMax} side="player" />
                <div className="fighter-status">
                  {equippedWeapon
                    ? `⚔️ ${equippedWeapon.template.name}`
                    : '✊ Кулаки'}
                  {playerPart && ` | Урон: ${playerPart.damageDealt}`}
                </div>
              </div>

              {/* VS */}
              <div className="battle-vs">
                {battleFinished
                  ? (finishResult?.result === 'PVE_WIN' ? '🏆' : '💀')
                  : '⚔️'}
              </div>

              {/* Противник */}
              <div className={`fighter enemy${!enemyPart?.isAlive && battleFinished ? ' defeated' : ''}`}>
                <div className="fighter-name" style={{ justifyContent: 'flex-end' }}>
                  <span>Противник</span>
                  <span className="fighter-icon">💀</span>
                </div>
                <HpBar current={enemyHp} max={enemyHpMax} side="enemy" />
                <div className="fighter-status" style={{ textAlign: 'right' }}>
                  {enemyPart && `Урон: ${enemyPart.damageDealt}`}
                </div>
              </div>
            </div>
          </div>

          {/* Лог боя */}
          <div className="battle-log" ref={logRef}>
            {log.map((line, i) => (
              <div key={i} className={`log-line ${line.type}`}>
                {line.round !== undefined && line.round > 0 && (
                  <span className="round-num">[{line.round}]</span>
                )}
                {line.text}
              </div>
            ))}
            {actionMut.isPending && (
              <div className="log-line system">
                <span className="spinner" /> Обработка хода...
              </div>
            )}
          </div>

          {/* Действия */}
          {!battleFinished && (
            <div style={{ padding: '8px 10px', background: 'var(--bg-panel2)', borderTop: '1px solid var(--border)' }}>
              {actionError && (
                <div className="alert alert-error mb8" style={{ marginBottom: 6 }}>{actionError}</div>
              )}

              <div className="battle-actions">
                <div className="action-btn-group">
                  <button className="btn btn-danger" disabled={!canAct} onClick={() => act('attack')}>
                    ⚔️ Атака
                  </button>
                  <button className="btn btn-primary" disabled={!canAct} onClick={() => act('block')}>
                    🛡️ Блок
                  </button>
                </div>

                {/* Использовать предмет */}
                {consumables.length > 0 && (
                  <div className="action-btn-group">
                    <select
                      className="form-select"
                      style={{ width: 140, padding: '4px 6px', fontSize: 10 }}
                      disabled={!canAct}
                      onChange={e => act('use_item', e.target.value)}
                      value=""
                    >
                      <option value="">💊 Предмет...</option>
                      {consumables.map(c => (
                        <option key={c.id} value={c.id}>{c.template.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Сменить оружие */}
                {weapons.length > 1 && (
                  <div className="weapon-select-row" style={{ border: 0, padding: 0 }}>
                    <select
                      className="form-select"
                      style={{ width: 160, padding: '4px 6px', fontSize: 10 }}
                      disabled={!canAct}
                      value={selectedWeapon}
                      onChange={e => setSelectedWeapon(e.target.value)}
                    >
                      <option value="">🔄 Сменить оружие...</option>
                      {weapons.filter(w => !w.isEquipped).map(w => (
                        <option key={w.id} value={w.id}>{w.template.name}</option>
                      ))}
                    </select>
                    {selectedWeapon && (
                      <button
                        className="btn btn-sm"
                        disabled={!canAct}
                        onClick={() => { act('change_weapon', selectedWeapon); setSelectedWeapon('') }}
                      >
                        Сменить
                      </button>
                    )}
                  </div>
                )}

                <button
                  className="btn btn-sm"
                  disabled={!canAct}
                  style={{ marginLeft: 'auto', opacity: 0.6 }}
                  onClick={() => act('surrender')}
                >
                  🏳️ Сдаться
                </button>
              </div>
            </div>
          )}

          {/* Результат боя */}
          {battleFinished && finishResult && (
            <div style={{
              padding: '12px',
              background: finishResult.result === 'PVE_WIN' ? '#081808' : '#180808',
              borderTop: `2px solid ${finishResult.result === 'PVE_WIN' ? 'var(--green)' : 'var(--red)'}`,
            }}>
              <div style={{
                fontSize: 16, fontWeight: 'bold',
                color: finishResult.result === 'PVE_WIN' ? 'var(--success)' : 'var(--danger)',
                marginBottom: 10, textAlign: 'center',
              }}>
                {finishResult.result === 'PVE_WIN' ? '🏆 ПОБЕДА!' : '💀 ПОРАЖЕНИЕ'}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                {(finishResult.expGain ?? 0) > 0 && (
                  <div style={{ textAlign: 'center', padding: '6px 4px', background: 'var(--bg-panel2)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Боевой опыт</div>
                    <div style={{ fontSize: 16, color: 'var(--xp)', fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>
                      +{finishResult.expGain}
                    </div>
                  </div>
                )}
                {(finishResult.weaponExpGain ?? 0) > 0 && (
                  <div style={{ textAlign: 'center', padding: '6px 4px', background: 'var(--bg-panel2)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Навык</div>
                    <div style={{ fontSize: 16, color: 'var(--accent-light)', fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>
                      +{Number(finishResult.weaponExpGain).toFixed(2)}
                    </div>
                  </div>
                )}
                {(finishResult.moneyReward ?? 0) > 0 && (
                  <div style={{ textAlign: 'center', padding: '6px 4px', background: 'var(--bg-panel2)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 9, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Деньги</div>
                    <div style={{ fontSize: 16, color: 'var(--gold)', fontFamily: 'var(--font-mono)', fontWeight: 'bold' }}>
                      +{finishResult.moneyReward}
                    </div>
                  </div>
                )}
              </div>

              {(finishResult.newLevel ?? 0) > 1 && (
                <div style={{ textAlign: 'center', color: 'var(--gold)', fontWeight: 'bold', marginBottom: 10, fontSize: 14 }}>
                  🎉 НОВЫЙ УРОВЕНЬ: {finishResult.newLevel}!
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={() => navigate('/profile')}>← Профиль</button>
                <button className="btn btn-gold" onClick={() => navigate('/repair')}>🔧 Ремонт</button>
                <button className="btn btn-danger" onClick={() => { navigate('/profile') }}>⚔️ Ещё раз</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
