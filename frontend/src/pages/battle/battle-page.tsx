import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useEffect } from 'react'
import { battlesApi } from '../../shared/api/battles.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { type BattleAction } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Типы событий раунда ────────────────────────────────────────
interface TurnEvent {
  actor: 'player' | 'enemy'
  action: string
  hit: boolean
  dodge: boolean
  block: boolean
  crit: boolean
  rawDamage: number
  finalDamage: number
  logParts: string[]
}

interface RoundRecord {
  round: number
  events: TurnEvent[]
  type: 'normal' | 'win' | 'lose'
  expGain?: number
  weaponExpGain?: number
  moneyReward?: number
  newLevel?: number
}

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
  turns?: TurnEvent[]
}

// ── Иконки и цвета событий ────────────────────────────────────
function getEventStyle(turn: TurnEvent) {
  if (!turn.hit)  return { icon: '💨', label: 'Промах',     color: 'var(--text-dim)',     bg: 'transparent' }
  if (turn.dodge) return { icon: '👻', label: 'Уворот',     color: 'var(--accent-light)', bg: 'rgba(106,138,58,0.1)' }
  if (turn.block) return { icon: '🛡️', label: 'Блок',       color: 'var(--accent)',       bg: 'rgba(106,138,58,0.15)' }
  if (turn.crit)  return { icon: '⚡', label: 'КРИТ!',      color: '#f0c030',             bg: 'rgba(240,192,48,0.12)' }
  return              { icon: '💥', label: 'Удар',       color: 'var(--danger)',       bg: 'rgba(196,48,48,0.1)' }
}

// ── HP Bar с анимацией ────────────────────────────────────────
function HpBar({ current, max, flashing }: { current: number; max: number; flashing: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0
  const color = pct > 60 ? 'var(--green)' : pct > 25 ? 'var(--warning)' : 'var(--red)'
  return (
    <div className={`arena-hp-bar ${flashing ? 'flash-dmg' : ''}`}>
      <div className="arena-hp-fill" style={{ width: `${pct}%`, background: color, transition: 'width 0.4s ease' }} />
      <span className="arena-hp-text" style={{ color }}>{current}/{max}</span>
    </div>
  )
}

// ── Карточка бойца ────────────────────────────────────────────
function FighterCard({
  name, icon, hp, hpMax, weapon, damageDealt, isPlayer, defeated, flashing,
}: {
  name: string; icon: string; hp: number; hpMax: number
  weapon: string; damageDealt: number
  isPlayer: boolean; defeated: boolean; flashing: boolean
}) {
  const pct = hpMax > 0 ? Math.max(0, Math.min(100, (hp / hpMax) * 100)) : 0
  return (
    <div className={`fighter-card ${isPlayer ? 'fighter-player' : 'fighter-enemy'} ${defeated ? 'fighter-defeated' : ''} ${flashing ? 'fighter-flash' : ''}`}>
      <div className="fighter-card-header">
        <span className="fighter-card-icon">{icon}</span>
        <div>
          <div className="fighter-card-name">{name}</div>
          <div className="fighter-card-weapon">{weapon}</div>
        </div>
      </div>
      <HpBar current={hp} max={hpMax} flashing={false} />
      <div className="fighter-card-stats">
        <span>⚔️ Нанесено: <strong>{damageDealt}</strong></span>
        <span style={{
          color: pct > 60 ? 'var(--success)' : pct > 25 ? 'var(--warning)' : 'var(--danger)',
          fontWeight: 'bold',
        }}>
          {pct.toFixed(0)}% HP
        </span>
      </div>
    </div>
  )
}

// ── Блок последнего хода ──────────────────────────────────────
function LastRoundPanel({ record, playerName }: { record: RoundRecord; playerName: string }) {
  if (record.events.length === 0) return null
  return (
    <div className="last-round-panel">
      <div className="last-round-title">
        <span className="round-badge">Раунд {record.round}</span>
      </div>
      <div className="last-round-events">
        {record.events.map((turn, i) => {
          const s = getEventStyle(turn)
          const actorName = turn.actor === 'player' ? playerName : 'Враг'
          const targetName = turn.actor === 'player' ? 'врагу' : 'вам'
          return (
            <div key={i} className="round-event-card" style={{ background: s.bg, borderLeft: `3px solid ${s.color}` }}>
              <span className="event-icon">{s.icon}</span>
              <div className="event-text">
                <strong style={{ color: turn.actor === 'player' ? 'var(--accent-light)' : 'var(--danger)' }}>
                  {actorName}
                </strong>
                {' → '}
                <span style={{ color: s.color, fontWeight: 'bold' }}>{s.label}</span>
                {turn.finalDamage > 0 && (
                  <span style={{ color: turn.actor === 'player' ? 'var(--danger)' : 'var(--warning)', marginLeft: 6 }}>
                    −{turn.finalDamage} HP {targetName}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── История боя ───────────────────────────────────────────────
function BattleHistory({ records, playerName }: { records: RoundRecord[]; playerName: string }) {
  const [collapsed, setCollapsed] = useState(false)
  const prevRounds = records.slice(0, -1).reverse() // все кроме последнего, в обратном порядке
  if (prevRounds.length === 0) return null
  return (
    <div className="battle-history">
      <button className="history-toggle" onClick={() => setCollapsed(!collapsed)}>
        📜 История ({prevRounds.length} раундов) {collapsed ? '▶' : '▼'}
      </button>
      {!collapsed && (
        <div className="history-list">
          {prevRounds.map(record => (
            <div key={record.round} className="history-round">
              <div className="history-round-header">Раунд {record.round}</div>
              {record.events.map((turn, i) => {
                const s = getEventStyle(turn)
                const actorName = turn.actor === 'player' ? playerName : 'Враг'
                return (
                  <div key={i} className="history-event" style={{ color: s.color }}>
                    {s.icon} <strong>{actorName}</strong>: {s.label}
                    {turn.finalDamage > 0 && ` −${turn.finalDamage} HP`}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
export function BattlePage() {
  const { id: battleId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [rounds, setRounds] = useState<RoundRecord[]>([])
  const [actionError, setActionError] = useState('')
  const [battleFinished, setBattleFinished] = useState(false)
  const [finishResult, setFinishResult] = useState<RoundResult | null>(null)
  const [selectedWeapon, setSelectedWeapon] = useState('')
  const [currentRound, setCurrentRound] = useState(1)
  const [playerFlash, setPlayerFlash] = useState(false)
  const [enemyFlash, setEnemyFlash] = useState(false)
  const [livePlayerHp, setLivePlayerHp] = useState<number | null>(null)
  const [liveEnemyHp, setLiveEnemyHp] = useState<number | null>(null)
  const [livePlayerDmg, setLivePlayerDmg] = useState(0)
  const [liveEnemyDmg, setLiveEnemyDmg] = useState(0)

  const isValidId = !!battleId && UUID_RE.test(battleId)

  useEffect(() => {
    if (!isValidId) navigate('/profile', { replace: true })
  }, [isValidId, navigate])

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    enabled: isValidId,
  })

  const { data: items = [] } = useQuery({
    queryKey: ['inventory'],
    queryFn: () => inventoryApi.getItems(),
    enabled: isValidId && !!char,
  })

  const { data: battleData } = useQuery({
    queryKey: ['battle', battleId],
    queryFn: () => battlesApi.getBattle(battleId!),
    enabled: isValidId && !battleFinished,
    refetchInterval: q => {
      const s = q.state.data?.battle?.status
      return s === 'FINISHED' || battleFinished ? false : 3000
    },
  })

  const weapons     = items.filter(i => i.template.type === 'WEAPON' && i.status !== 'BROKEN' && i.status !== 'DELETED')
  const consumables = items.filter(i => i.template.type === 'CONSUMABLE' && i.status !== 'DELETED' && i.status !== 'CONSUMED')

  const flash = (side: 'player' | 'enemy') => {
    if (side === 'player') { setPlayerFlash(true); setTimeout(() => setPlayerFlash(false), 500) }
    else                   { setEnemyFlash(true);  setTimeout(() => setEnemyFlash(false), 500) }
  }

  const actionMut = useMutation({
    mutationFn: ({ action, itemId }: { action: BattleAction; itemId?: string }) =>
      battlesApi.submitAction(battleId!, action, itemId) as unknown as Promise<RoundResult>,

    onSuccess: (data: RoundResult) => {
      const rn = data.roundNumber ?? currentRound
      setCurrentRound(rn)

      // Flash animations
      if (data.turns) {
        data.turns.forEach(t => {
          if (t.hit && !t.dodge) flash(t.actor === 'player' ? 'enemy' : 'player')
        })
      }

      // Update live HP
      if (data.playerHp != null) { setLivePlayerHp(data.playerHp) }
      if (data.botHp != null)    { setLiveEnemyHp(data.botHp) }

      // Build round record
      const record: RoundRecord = {
        round: rn,
        events: data.turns?.map(t => ({
          actor: t.actor === 'player' ? 'player' : 'enemy',
          action: t.action, hit: t.hit, dodge: t.dodge, block: t.block,
          crit: t.crit, rawDamage: t.rawDamage, finalDamage: t.finalDamage, logParts: t.logParts,
        })) ?? [],
        type: data.battleOver
          ? (data.result === 'PVE_WIN' ? 'win' : 'lose')
          : 'normal',
      }
      setRounds(prev => [...prev, record])

      // Update damage totals
      if (data.turns) {
        const pDmg = data.turns.filter(t => t.actor === 'player' && t.hit && !t.dodge).reduce((s, t) => s + t.finalDamage, 0)
        const eDmg = data.turns.filter(t => t.actor !== 'player' && t.hit && !t.dodge).reduce((s, t) => s + t.finalDamage, 0)
        setLivePlayerDmg(prev => prev + pDmg)
        setLiveEnemyDmg(prev => prev + eDmg)
      }

      if (data.battleOver) {
        setBattleFinished(true)
        setFinishResult(data)
        localStorage.removeItem('mmo_current_battle')
        qc.invalidateQueries({ queryKey: ['character', 'me'] })
        qc.invalidateQueries({ queryKey: ['inventory'] })
      }
    },

    onError: (err) => {
      setActionError(err instanceof ApiError ? err.message : 'Ошибка сервера')
      setTimeout(() => setActionError(''), 4000)
    },
  })

  if (!isValidId) return <div className="loading"><span className="spinner" />...</div>

  const liveState  = battleData?.liveState
  const playerPart = liveState?.participants.find(p => p.characterId === char?.id)
  const enemyPart  = liveState?.participants.find(p => !!p.botId || p.characterId !== char?.id)

  const playerHp    = livePlayerHp ?? playerPart?.hpCurrent ?? char?.hpCurrent ?? 0
  const playerHpMax = playerPart?.hpMax ?? char?.hpMax ?? 1
  const enemyHp     = liveEnemyHp ?? enemyPart?.hpCurrent ?? 0
  const enemyHpMax  = enemyPart?.hpMax ?? 1

  const equippedWeapon = items.find(i => i.isEquipped && i.template.type === 'WEAPON')
  const canAct = !battleFinished && !actionMut.isPending
  const act = (action: BattleAction, itemId?: string) => actionMut.mutate({ action, itemId })

  const playerName = char?.nickname ?? 'Вы'
  const lastRound  = rounds[rounds.length - 1] ?? null

  return (
    <div className="battle-page">
      {/* ══ ЗАГОЛОВОК ═══════════════════════════════════════════ */}
      <div className="battle-header">
        <div className="battle-header-title">⚔️ АРЕНА</div>
        <div className="battle-round-badge">
          Раунд <strong>{currentRound}</strong> / 30
        </div>
        <div className={`battle-status-badge ${battleFinished ? (finishResult?.result === 'PVE_WIN' ? 'won' : 'lost') : 'active'}`}>
          {battleFinished
            ? (finishResult?.result === 'PVE_WIN' ? '🏆 ПОБЕДА' : '💀 ПОРАЖЕНИЕ')
            : actionMut.isPending ? '⏳ Ход...' : '● Идёт бой'}
        </div>
      </div>

      {/* ══ БОЙЦЫ ════════════════════════════════════════════════ */}
      <div className="battle-fighters-row">
        <FighterCard
          name={playerName}
          icon="🧍"
          hp={playerHp}
          hpMax={playerHpMax}
          weapon={equippedWeapon ? equippedWeapon.template.name : '✊ Кулаки'}
          damageDealt={livePlayerDmg + (playerPart?.damageDealt ?? 0)}
          isPlayer={true}
          defeated={battleFinished && finishResult?.result !== 'PVE_WIN'}
          flashing={playerFlash}
        />

        <div className="battle-vs-divider">
          {battleFinished
            ? (finishResult?.result === 'PVE_WIN' ? '🏆' : '💀')
            : <span className="vs-text">VS</span>}
        </div>

        <FighterCard
          name="Противник"
          icon="💀"
          hp={enemyHp}
          hpMax={enemyHpMax}
          weapon="Неизвестно"
          damageDealt={liveEnemyDmg + (enemyPart?.damageDealt ?? 0)}
          isPlayer={false}
          defeated={battleFinished && finishResult?.result === 'PVE_WIN'}
          flashing={enemyFlash}
        />
      </div>

      {/* ══ ПОСЛЕДНИЙ ХОД ════════════════════════════════════════ */}
      {lastRound && <LastRoundPanel record={lastRound} playerName={playerName} />}
      {rounds.length === 0 && (
        <div className="battle-start-msg">⚔️ Бой начался! Выбирай действие.</div>
      )}

      {/* ══ ИСТОРИЯ ══════════════════════════════════════════════ */}
      <BattleHistory records={rounds} playerName={playerName} />

      {/* ══ ДЕЙСТВИЯ ════════════════════════════════════════════ */}
      {!battleFinished && (
        <div className="battle-actions-panel">
          {actionError && (
            <div className="alert alert-error" style={{ marginBottom: 8, fontSize: 11 }}>{actionError}</div>
          )}

          {/* Основные кнопки */}
          <div className="battle-main-actions">
            <button
              className="battle-action-btn attack"
              disabled={!canAct}
              onClick={() => act('attack')}
            >
              <span className="action-btn-icon">⚔️</span>
              <span className="action-btn-label">Атака</span>
              <span className="action-btn-hint">Нанести удар</span>
            </button>

            <button
              className="battle-action-btn block"
              disabled={!canAct}
              onClick={() => act('block')}
            >
              <span className="action-btn-icon">🛡️</span>
              <span className="action-btn-label">Блок</span>
              <span className="action-btn-hint">−65% урона</span>
            </button>
          </div>

          {/* Расходники */}
          {consumables.length > 0 && (
            <div className="battle-consumables">
              {consumables.map(c => (
                <button
                  key={c.id}
                  className="battle-action-btn consumable"
                  disabled={!canAct}
                  onClick={() => act('use_item', c.id)}
                  title={`+${c.template.hpBonus ?? 0} HP`}
                >
                  <span className="action-btn-icon">💊</span>
                  <span className="action-btn-label">{c.template.name}</span>
                  <span className="action-btn-hint">+{c.template.hpBonus ?? 0} HP</span>
                </button>
              ))}
            </div>
          )}

          {/* Смена оружия + сдаться */}
          <div className="battle-secondary-actions">
            {weapons.length > 1 && (
              <div className="weapon-switch-row">
                <select
                  className="form-select"
                  style={{ flex: 1, fontSize: 11 }}
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
                  <button className="btn btn-sm" disabled={!canAct}
                    onClick={() => { act('change_weapon', selectedWeapon); setSelectedWeapon('') }}>
                    Сменить
                  </button>
                )}
              </div>
            )}
            <button className="btn btn-sm surrender-btn" disabled={!canAct} onClick={() => act('surrender')}>
              🏳️ Сдаться
            </button>
          </div>
        </div>
      )}

      {/* ══ РЕЗУЛЬТАТ ════════════════════════════════════════════ */}
      {battleFinished && finishResult && (
        <div className={`battle-result ${finishResult.result === 'PVE_WIN' ? 'win' : 'lose'}`}>
          <div className="battle-result-title">
            {finishResult.result === 'PVE_WIN' ? '🏆 ПОБЕДА!' : '💀 ПОРАЖЕНИЕ'}
          </div>

          <div className="battle-rewards">
            {(finishResult.expGain ?? 0) > 0 && (
              <div className="reward-card">
                <div className="reward-label">⭐ Боевой опыт</div>
                <div className="reward-value xp">+{finishResult.expGain}</div>
              </div>
            )}
            {(finishResult.weaponExpGain ?? 0) > 0 && (
              <div className="reward-card">
                <div className="reward-label">🗡️ Навык</div>
                <div className="reward-value skill">+{Number(finishResult.weaponExpGain).toFixed(2)}</div>
              </div>
            )}
            {(finishResult.moneyReward ?? 0) > 0 && (
              <div className="reward-card">
                <div className="reward-label">💰 Деньги</div>
                <div className="reward-value money">+{finishResult.moneyReward}₽</div>
              </div>
            )}
          </div>

          {(finishResult.newLevel ?? 0) > 1 && (
            <div className="levelup-banner">🎉 НОВЫЙ УРОВЕНЬ {finishResult.newLevel}!</div>
          )}

          <div className="battle-result-actions">
            <button className="btn btn-primary" onClick={() => navigate('/profile')}>← Профиль</button>
            <button className="btn btn-gold" onClick={() => navigate('/repair')}>🔧 Ремонт</button>
            <button className="btn btn-danger" onClick={() => navigate('/profile')}>⚔️ Ещё раз</button>
          </div>
        </div>
      )}
    </div>
  )
}
