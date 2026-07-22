import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import {
  Sword, Shield, Heart, Zap, Wind, ArrowRight,
  RotateCcw, Flag, ChevronDown, ChevronUp, Skull,
  CircleDot, User, Trophy, AlertTriangle, Wrench,
} from 'lucide-react'
import { battlesApi } from '../../shared/api/battles.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { type BattleAction } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface TurnEvent {
  actor: 'player' | 'enemy' | string
  action: string; hit: boolean; dodge: boolean; block: boolean
  crit: boolean; rawDamage: number; finalDamage: number; logParts: string[]
}
interface RoundRecord {
  round: number; events: TurnEvent[]; type: 'normal' | 'win' | 'lose'
  expGain?: number; weaponExpGain?: number; moneyReward?: number; newLevel?: number
}
interface RoundResult {
  roundNumber?: number; playerHp?: number; botHp?: number; battleOver?: boolean
  result?: string; expGain?: number; weaponExpGain?: number; moneyReward?: number
  newLevel?: number; waiting?: boolean; turns?: TurnEvent[]
}

// ── Иконки событий (без эмодзи) ───────────────────────────
function EventIcon({ type }: { type: string }) {
  const sz = 14
  if (type === 'miss')  return <Wind size={sz} />
  if (type === 'dodge') return <ArrowRight size={sz} />
  if (type === 'block') return <Shield size={sz} />
  if (type === 'crit')  return <Zap size={sz} />
  return <Sword size={sz} />
}

function getEvent(t: TurnEvent) {
  if (!t.hit)  return { type: 'miss',  label: 'Промах',  color: '#555' }
  if (t.dodge) return { type: 'dodge', label: 'Уворот',  color: '#88b048' }
  if (t.block) return { type: 'block', label: 'Блок',    color: '#6a9a3a' }
  if (t.crit)  return { type: 'crit',  label: 'КРИТ',    color: '#d4a017' }
  return              { type: 'hit',   label: 'Удар',    color: '#c43030' }
}

// ── Сетка поля боя ─────────────────────────────────────────
const GRID_COLS = 9
const GRID_ROWS = 5
const PLAYER_COL = 1
const ENEMY_COL  = 7

function BattleGrid({
  playerName, playerHp, playerHpMax,
  enemyHp, enemyHpMax,
  playerDefeated, enemyDefeated,
  playerHit, enemyHit,
  lastEvent,
}: {
  playerName: string
  playerHp: number; playerHpMax: number
  enemyHp: number;  enemyHpMax: number
  playerDefeated: boolean; enemyDefeated: boolean
  playerHit: boolean; enemyHit: boolean
  lastEvent: TurnEvent | null
}) {
  const pHpPct = Math.max(0, Math.min(100, playerHp / playerHpMax * 100))
  const eHpPct = Math.max(0, Math.min(100, enemyHp  / enemyHpMax  * 100))
  const midRow = Math.floor(GRID_ROWS / 2)

  return (
    <div className="grid-arena">
      {/* ── Сетка ── */}
      <div className="grid-field">
        {Array.from({ length: GRID_ROWS }).map((_, row) =>
          Array.from({ length: GRID_COLS }).map((_, col) => {
            const isPlayerCell = col === PLAYER_COL && row === midRow
            const isEnemyCell  = col === ENEMY_COL  && row === midRow
            const isCenter = col === Math.floor(GRID_COLS / 2) && row === midRow
            return (
              <div
                key={`${row}-${col}`}
                className={`grid-cell ${isPlayerCell ? 'cell-player' : ''} ${isEnemyCell ? 'cell-enemy' : ''} ${isCenter ? 'cell-center' : ''}`}
              >
                {isPlayerCell && (
                  <div className={`fighter-token token-player ${playerHit ? 'token-hit' : ''} ${playerDefeated ? 'token-dead' : ''}`}>
                    {playerDefeated ? <Skull size={18} /> : <User size={18} />}
                    <span className="token-label">{playerName.slice(0,4)}</span>
                  </div>
                )}
                {isEnemyCell && (
                  <div className={`fighter-token token-enemy ${enemyHit ? 'token-hit' : ''} ${enemyDefeated ? 'token-dead' : ''}`}>
                    {enemyDefeated ? <Skull size={18} /> : <CircleDot size={18} />}
                    <span className="token-label">Враг</span>
                  </div>
                )}
                {isCenter && lastEvent && !isPlayerCell && !isEnemyCell && (
                  <div className={`grid-event-flash event-${getEvent(lastEvent).type}`}>
                    <EventIcon type={getEvent(lastEvent).type} />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* ── HP-полосы ── */}
      <div className="grid-hp-row">
        <div className="grid-hp-block">
          <div className="grid-hp-name">{playerName}</div>
          <div className="grid-hp-bar-bg">
            <div className="grid-hp-fill" style={{
              width: `${pHpPct}%`,
              background: pHpPct > 60 ? '#4a8a35' : pHpPct > 25 ? '#c4802a' : '#c43030',
            }} />
          </div>
          <div className="grid-hp-num">{playerHp}/{playerHpMax}</div>
        </div>

        <div className="grid-round-info">
          <Sword size={14} style={{ color: 'var(--gold-dim)' }} />
        </div>

        <div className="grid-hp-block grid-hp-right">
          <div className="grid-hp-name">Противник</div>
          <div className="grid-hp-bar-bg">
            <div className="grid-hp-fill" style={{
              width: `${eHpPct}%`,
              background: eHpPct > 60 ? '#4a8a35' : eHpPct > 25 ? '#c4802a' : '#c43030',
            }} />
          </div>
          <div className="grid-hp-num">{enemyHp}/{enemyHpMax}</div>
        </div>
      </div>

      {/* ── Последнее событие ── */}
      {lastEvent && (() => {
        const e = getEvent(lastEvent)
        return (
          <div className="grid-last-event" style={{ borderColor: e.color }}>
            <span style={{ color: e.color }}><EventIcon type={e.type} /></span>
            <span style={{ color: lastEvent.actor === 'player' ? 'var(--accent-light)' : 'var(--danger)', fontWeight: 'bold', fontSize: 11 }}>
              {lastEvent.actor === 'player' ? playerName : 'Враг'}
            </span>
            <span style={{ color: e.color, fontWeight: 'bold', fontSize: 11 }}>{e.label}</span>
            {lastEvent.finalDamage > 0 && (
              <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                -{lastEvent.finalDamage} HP
              </span>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ══ ГЛАВНЫЙ КОМПОНЕНТ ═════════════════════════════════════════
export function BattlePage() {
  const { id: battleId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [rounds, setRounds]               = useState<RoundRecord[]>([])
  const [playerHp, setPlayerHp]           = useState<number|null>(null)
  const [enemyHp, setEnemyHp]             = useState<number|null>(null)
  const [playerDmg, setPlayerDmg]         = useState(0)
  const [enemyDmg, setEnemyDmg]           = useState(0)
  const [currentRound, setCurrentRound]   = useState(1)
  const [battleOver, setBattleOver]       = useState(false)
  const [finishResult, setFinishResult]   = useState<RoundResult|null>(null)
  const [actionError, setActionError]     = useState('')
  const [selectedWeapon, setSelectedWeapon] = useState('')
  const [showLog, setShowLog]             = useState(false)
  const [playerHit, setPlayerHit]         = useState(false)
  const [enemyHit, setEnemyHit]           = useState(false)
  const [lastEvent, setLastEvent]         = useState<TurnEvent|null>(null)

  const isValid = !!battleId && UUID_RE.test(battleId)
  useEffect(() => { if (!isValid) navigate('/profile', { replace: true }) }, [isValid, navigate])

  const { data: char } = useQuery({ queryKey: ['character','me'], queryFn: () => charactersApi.getMe(), enabled: isValid })
  const { data: items = [] } = useQuery({ queryKey: ['inventory'], queryFn: () => inventoryApi.getItems(), enabled: isValid && !!char })
  const { data: battleData } = useQuery({
    queryKey: ['battle', battleId],
    queryFn: () => battlesApi.getBattle(battleId!),
    enabled: isValid && !battleOver,
    refetchInterval: q => q.state.data?.battle?.status === 'FINISHED' || battleOver ? false : 3000,
  })

  const live     = battleData?.liveState
  const pPart    = live?.participants.find(p => p.characterId === char?.id)
  const ePart    = live?.participants.find(p => !!p.botId || p.characterId !== char?.id)
  const pHp      = playerHp ?? pPart?.hpCurrent ?? char?.hpCurrent ?? 0
  const pHpMax   = pPart?.hpMax ?? char?.hpMax ?? 1
  const eHp      = enemyHp ?? ePart?.hpCurrent ?? 0
  const eHpMax   = ePart?.hpMax ?? 1
  const weapon   = items.find(i => i.isEquipped && i.template.type === 'WEAPON')
  const consumables = items.filter(i => i.template.type === 'CONSUMABLE' && i.status !== 'DELETED' && i.status !== 'CONSUMED')
  const altWeapons  = items.filter(i => i.template.type === 'WEAPON' && i.status !== 'BROKEN' && !i.isEquipped)

  const actionMut = useMutation({
    mutationFn: ({ action, itemId }: { action: BattleAction; itemId?: string }) =>
      battlesApi.submitAction(battleId!, action, itemId) as unknown as Promise<RoundResult>,
    onSuccess: (data) => {
      const rn = data.roundNumber ?? currentRound
      setCurrentRound(rn)
      if (data.playerHp != null) setPlayerHp(data.playerHp)
      if (data.botHp    != null) setEnemyHp(data.botHp)

      const events: TurnEvent[] = data.turns?.map(t => ({
        actor: t.actor === 'player' ? 'player' : 'enemy',
        action: t.action, hit: t.hit, dodge: t.dodge, block: t.block,
        crit: t.crit, rawDamage: t.rawDamage, finalDamage: t.finalDamage, logParts: t.logParts,
      })) ?? []

      let pd = 0, ed = 0
      events.forEach(t => {
        if (t.hit && !t.dodge) {
          if (t.actor === 'player') {
            setEnemyHit(true); setTimeout(() => setEnemyHit(false), 500)
            pd += t.finalDamage
          } else {
            setPlayerHit(true); setTimeout(() => setPlayerHit(false), 500)
            ed += t.finalDamage
          }
        }
      })
      setPlayerDmg(p => p + pd)
      setEnemyDmg(p => p + ed)
      if (events.length > 0) setLastEvent(events[events.length - 1])

      setRounds(prev => [...prev, {
        round: rn, events,
        type: data.battleOver ? (data.result === 'PVE_WIN' ? 'win' : 'lose') : 'normal',
        ...data,
      }])

      if (data.battleOver) {
        setBattleOver(true); setFinishResult(data)
        localStorage.removeItem('mmo_current_battle')
        qc.invalidateQueries({ queryKey: ['character','me'] })
        qc.invalidateQueries({ queryKey: ['inventory'] })
      }
    },
    onError: (err) => {
      setActionError(err instanceof ApiError ? err.message : 'Ошибка')
      setTimeout(() => setActionError(''), 4000)
    },
  })

  const canAct = !battleOver && !actionMut.isPending
  const act    = (action: BattleAction, itemId?: string) => actionMut.mutate({ action, itemId })
  const playerName = char?.nickname ?? 'Игрок'

  if (!isValid) return null

  // ── Финальный экран ───────────────────────────────────────
  if (battleOver && finishResult) {
    const won = finishResult.result === 'PVE_WIN'
    return (
      <div className="battle-page-v2">
        <div className={`battle-result-v2 ${won ? 'win' : 'lose'}`}>
          <div className="brv2-icon">{won ? <Trophy size={48} /> : <Skull size={48} />}</div>
          <div className="brv2-title">{won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ'}</div>
          {won && (
            <div className="brv2-rewards">
              {(finishResult.expGain ?? 0) > 0 && (
                <div className="brv2-reward">
                  <Heart size={16} /><span>+{finishResult.expGain}</span><small>опыт</small>
                </div>
              )}
              {(finishResult.weaponExpGain ?? 0) > 0 && (
                <div className="brv2-reward">
                  <Sword size={16} /><span>+{Number(finishResult.weaponExpGain).toFixed(1)}</span><small>навык</small>
                </div>
              )}
              {(finishResult.moneyReward ?? 0) > 0 && (
                <div className="brv2-reward">
                  <CircleDot size={16} /><span>+{finishResult.moneyReward}₽</span><small>деньги</small>
                </div>
              )}
            </div>
          )}
          {(finishResult.newLevel ?? 0) > 1 && (
            <div className="brv2-levelup">НОВЫЙ УРОВЕНЬ {finishResult.newLevel}</div>
          )}
          <div className="brv2-actions">
            <button className="btn btn-primary" onClick={() => navigate('/profile')}>Профиль</button>
            <button className="btn btn-gold" onClick={() => navigate('/repair')}>Ремонт</button>
            <button className="btn btn-danger" onClick={() => navigate('/profile')}>Ещё раз</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="battle-page-v2">

      {/* ── Шапка ── */}
      <div className="battle-header-v2">
        <div className="bh-left">
          <Sword size={14} style={{ color: 'var(--gold-dim)' }} />
          <span>АРЕНА</span>
        </div>
        <div className="bh-center">
          РАУ НД {currentRound} / 30
        </div>
        <div className="bh-right">
          {actionMut.isPending
            ? <><RotateCcw size={12} className="spin" /> Ход...</>
            : <><CircleDot size={10} style={{ color: 'var(--success)' }} /> Идёт бой</>}
        </div>
      </div>

      {/* ── Поле боя (сетка) ── */}
      <BattleGrid
        playerName={playerName}
        playerHp={pHp} playerHpMax={pHpMax}
        enemyHp={eHp}  enemyHpMax={eHpMax}
        playerDefeated={battleOver && finishResult?.result !== 'PVE_WIN'}
        enemyDefeated={battleOver && finishResult?.result === 'PVE_WIN'}
        playerHit={playerHit} enemyHit={enemyHit}
        lastEvent={lastEvent}
      />

      {/* ── Кнопки действий ── */}
      {!battleOver && (
        <div className="battle-hud-v2">
          {actionError && (
            <div className="battle-error-v2">
              <AlertTriangle size={13} /> {actionError}
            </div>
          )}

          <div className="hud-v2-actions">
            {/* Атака */}
            <button className="hud-v2-btn attack" disabled={!canAct} onClick={() => act('attack')}>
              <Sword size={20} />
              <span>Атака</span>
            </button>

            {/* Блок */}
            <button className="hud-v2-btn block" disabled={!canAct} onClick={() => act('block')}>
              <Shield size={20} />
              <span>Блок</span>
            </button>

            {/* Расходники */}
            {consumables.map(c => (
              <button key={c.id} className="hud-v2-btn heal" disabled={!canAct} onClick={() => act('use_item', c.id)}
                title={c.template.name}>
                <Heart size={18} />
                <span>+{c.template.hpBonus}</span>
              </button>
            ))}

            {/* Смена оружия */}
            {altWeapons.length > 0 && (
              <div className="hud-v2-switch">
                <select
                  className="hud-v2-select" disabled={!canAct}
                  value={selectedWeapon}
                  onChange={e => setSelectedWeapon(e.target.value)}
                >
                  <option value="">Сменить...</option>
                  {altWeapons.map(w => <option key={w.id} value={w.id}>{w.template.name}</option>)}
                </select>
                {selectedWeapon && (
                  <button className="hud-v2-btn switch-confirm" disabled={!canAct}
                    onClick={() => { act('change_weapon', selectedWeapon); setSelectedWeapon('') }}>
                    <RotateCcw size={14} />
                  </button>
                )}
              </div>
            )}

            {/* Сдаться */}
            <button className="hud-v2-btn surrender" disabled={!canAct} onClick={() => act('surrender')}
              title="Сдаться">
              <Flag size={16} />
            </button>
          </div>

          {/* Оружие */}
          <div className="hud-v2-weapon">
            <Sword size={11} style={{ color: 'var(--text-dim)' }} />
            <span>{weapon?.template.name ?? 'Кулаки'}</span>
            <span style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>
              Нанесено: {playerDmg + (pPart?.damageDealt ?? 0)}
            </span>
          </div>
        </div>
      )}

      {/* ── Лог ── */}
      <div className="battle-log-v2">
        <button className="log-toggle-v2" onClick={() => setShowLog(v => !v)}>
          {showLog ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          <span>Лог боя</span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: 10 }}>
            {rounds.length} раундов
          </span>
        </button>
        {showLog && (
          <div className="log-body-v2">
            {rounds.slice().reverse().map(r => (
              <div key={r.round} className="log-round-v2">
                <div className="log-round-header">Раунд {r.round}</div>
                {r.events.map((t, i) => {
                  const e = getEvent(t)
                  const isPlayer = t.actor === 'player' || t.actor === playerName
                  const actorName = isPlayer ? playerName : 'Противник'
                  return (
                    <div key={i} className={`log-event-line ${isPlayer ? 'log-ev-player' : 'log-ev-enemy'}`}>
                      {/* Кто атакует */}
                      <span className="log-ev-actor">{actorName}</span>
                      <span className="log-ev-arrow">→</span>
                      {/* Что случилось */}
                      <span className="log-ev-icon" style={{ color: e.color }}>
                        <EventIcon type={e.type} />
                      </span>
                      <span className="log-ev-label" style={{ color: e.color }}>{e.label}</span>
                      {/* Урон */}
                      {t.finalDamage > 0 && (
                        <>
                          <span className="log-ev-arrow">→</span>
                          <span className="log-ev-dmg" style={{ color: e.type === 'crit' ? 'var(--gold)' : 'var(--danger)' }}>
                            -{t.finalDamage} HP
                          </span>
                          {t.crit && <span className="log-ev-crit">КРИТ!</span>}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
