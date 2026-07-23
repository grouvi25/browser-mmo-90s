import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import {
  Sword, Shield, Heart, Zap, ArrowRight,
  RotateCcw, Flag, ChevronDown, ChevronUp, Skull,
  CircleDot, User, Trophy, AlertTriangle, Pill,
} from 'lucide-react'
import { battlesApi } from '../../shared/api/battles.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { type BattleAction, type ItemInstance } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOADOUT_KEY = 'mmo_battle_loadout'

function getLoadout(): string[] {
  try { return JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? '[]') } catch { return [] }
}

interface TurnEvent {
  actor: 'player' | 'enemy' | string
  action: string; hit: boolean; dodge: boolean; block: boolean
  crit: boolean; lucky?: boolean; counterDamage?: number
  rawDamage: number; finalDamage: number; logParts: string[]
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

// ── Иконки событий ─────────────────────────────────────────
function EventIcon({ type }: { type: string }) {
  const sz = 13
  if (type === 'dodge')   return <ArrowRight size={sz} />
  if (type === 'block')   return <Shield size={sz} />
  if (type === 'counter') return <RotateCcw size={sz} />
  if (type === 'crit')    return <Zap size={sz} />
  if (type === 'lucky')   return <Zap size={sz} />
  return <Sword size={sz} />
}

function getEvent(t: TurnEvent) {
  if (!t.hit && t.dodge) return { type: 'dodge',   label: 'Уворот',   color: '#88b048' }
  if (!t.hit)            return { type: 'dodge',   label: 'Уворот',   color: '#88b048' } // нет промаха
  if (t.block)           return { type: 'block',   label: (t.counterDamage ?? 0) > 0 ? 'Блок + ответка' : 'Блок', color: '#6a9a3a' }
  if (t.lucky)           return { type: 'lucky',   label: 'Пробитие', color: '#9a60c0' }
  if (t.crit)            return { type: 'crit',    label: 'КРИТ',     color: '#d4a017' }
  return                        { type: 'hit',     label: 'Удар',     color: '#c43030' }
}

// ── HP-полоска ─────────────────────────────────────────────
function HpBar({ hp, hpMax, name, right = false }: { hp: number; hpMax: number; name: string; right?: boolean }) {
  const pct = hpMax > 0 ? Math.max(0, Math.min(100, hp / hpMax * 100)) : 0
  const color = pct > 60 ? '#4a8a35' : pct > 25 ? '#c4802a' : '#c43030'
  return (
    <div className="grid-hp-block" style={right ? { alignItems: 'flex-end' } : {}}>
      <div className="grid-hp-name">{name}</div>
      <div className="grid-hp-bar-bg" style={{ width: '100%' }}>
        <div className="grid-hp-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="grid-hp-num" style={{ color }}>{hp} / {hpMax}</div>
    </div>
  )
}

// ── Сетка поля боя ─────────────────────────────────────────
const GRID_COLS = 9, GRID_ROWS = 5
const PLAYER_COL = 1, ENEMY_COL = 7

function BattleGrid({
  playerName, playerHp, playerHpMax,
  enemyName, enemyHp, enemyHpMax,
  playerDefeated, enemyDefeated,
  playerHit, enemyHit, lastEvent,
}: {
  playerName: string; playerHp: number; playerHpMax: number
  enemyName: string;  enemyHp: number;  enemyHpMax: number
  playerDefeated: boolean; enemyDefeated: boolean
  playerHit: boolean; enemyHit: boolean; lastEvent: TurnEvent | null
}) {
  const midRow = Math.floor(GRID_ROWS / 2)

  return (
    <div className="grid-arena">
      {/* HP полосы СВЕРХУ */}
      <div className="grid-hp-row">
        <HpBar hp={playerHp} hpMax={playerHpMax} name={playerName} />
        <div className="grid-round-info">
          <Sword size={13} style={{ color: 'var(--gold-dim)' }} />
        </div>
        <HpBar hp={enemyHp} hpMax={enemyHpMax} name={enemyName} right />
      </div>

      {/* Сетка */}
      <div className="grid-field">
        {Array.from({ length: GRID_ROWS }).map((_, row) =>
          Array.from({ length: GRID_COLS }).map((_, col) => {
            const isPlayer = col === PLAYER_COL && row === midRow
            const isEnemy  = col === ENEMY_COL  && row === midRow
            const isCenter = col === Math.floor(GRID_COLS / 2) && row === midRow
            return (
              <div key={`${row}-${col}`}
                className={`grid-cell ${isPlayer ? 'cell-player' : ''} ${isEnemy ? 'cell-enemy' : ''} ${isCenter ? 'cell-center' : ''}`}>
                {isPlayer && (
                  <div className={`fighter-token token-player ${playerHit ? 'token-hit' : ''} ${playerDefeated ? 'token-dead' : ''}`}>
                    {playerDefeated ? <Skull size={18} /> : <User size={18} />}
                    <span className="token-label">{playerName.slice(0, 5)}</span>
                  </div>
                )}
                {isEnemy && (
                  <div className={`fighter-token token-enemy ${enemyHit ? 'token-hit' : ''} ${enemyDefeated ? 'token-dead' : ''}`}>
                    {enemyDefeated ? <Skull size={18} /> : <CircleDot size={18} />}
                    <span className="token-label">{enemyName.slice(0, 5)}</span>
                  </div>
                )}
                {isCenter && lastEvent && (
                  <div className={`grid-event-flash event-${getEvent(lastEvent).type}`}>
                    <EventIcon type={getEvent(lastEvent).type} />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Последнее событие */}
      {lastEvent && (() => {
        const e = getEvent(lastEvent)
        return (
          <div className="grid-last-event" style={{ borderColor: e.color }}>
            <span style={{ color: e.color }}><EventIcon type={e.type} /></span>
            <span style={{ color: lastEvent.actor === 'player' ? 'var(--accent-light)' : 'var(--danger)', fontWeight: 'bold', fontSize: 11 }}>
              {lastEvent.actor === 'player' ? playerName : enemyName}
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

// ── Карманы в бою (правая панель) ──────────────────────────
function PocketsPanel({
  slots, canAct, onUse,
}: {
  slots: (ItemInstance | null)[]
  canAct: boolean
  onUse: (id: string) => void
}) {
  return (
    <div className="battle-pockets-panel">
      <div className="bp-title">
        <Pill size={9} style={{ marginRight: 4, verticalAlign: 'middle' }} />
        Карманы
      </div>
      {slots.map((item, i) => (
        <div key={i} className={`bp-slot ${item ? 'bp-filled' : 'bp-empty'}`}>
          <div className="bp-slot-num">#{i + 1}</div>
          {item ? (
            <>
              <div className="bp-slot-name">{item.template.name}</div>
              {(item.template.hpBonus ?? 0) > 0 && (
                <div className="bp-slot-hp">+{item.template.hpBonus} HP</div>
              )}
              <button
                className="btn btn-sm btn-success bp-use-btn"
                disabled={!canAct}
                onClick={() => onUse(item.id)}
              >
                Применить
              </button>
            </>
          ) : (
            <div className="bp-slot-empty-text">— пусто —</div>
          )}
        </div>
      ))}
      <div style={{ fontSize: 9, color: 'var(--text-dim)', padding: '4px 0', lineHeight: 1.5 }}>
        Снаряди расходники до боя на странице Профиля
      </div>
    </div>
  )
}

// ══ ГЛАВНЫЙ КОМПОНЕНТ ═════════════════════════════════════════
export function BattlePage() {
  const { id: battleId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [rounds, setRounds]             = useState<RoundRecord[]>([])
  const [playerHp, setPlayerHp]         = useState<number | null>(null)
  const [enemyHp, setEnemyHp]           = useState<number | null>(null)
  const [playerDmg, setPlayerDmg]       = useState(0)
  const [currentRound, setCurrentRound] = useState(1)
  const [battleOver, setBattleOver]     = useState(false)
  const [finishResult, setFinishResult] = useState<RoundResult | null>(null)
  const [actionError, setActionError]   = useState('')
  const [showLog, setShowLog]           = useState(false)
  const [playerHit, setPlayerHit]       = useState(false)
  const [enemyHit, setEnemyHit]         = useState(false)
  const [lastEvent, setLastEvent]       = useState<TurnEvent | null>(null)
  // loadout IDs читается при mount и не меняется в течение боя
  const [loadoutIds] = useState<string[]>(() => getLoadout())

  const isValid = !!battleId && UUID_RE.test(battleId)
  useEffect(() => { if (!isValid) navigate('/profile', { replace: true }) }, [isValid, navigate])

  const { data: char } = useQuery({
    queryKey: ['character', 'me'], queryFn: () => charactersApi.getMe(), enabled: isValid,
  })
  const { data: items = [] } = useQuery({
    queryKey: ['inventory'], queryFn: () => inventoryApi.getItems(), enabled: isValid && !!char,
  })
  const { data: battleData } = useQuery({
    queryKey: ['battle', battleId],
    queryFn: () => battlesApi.getBattle(battleId!),
    enabled: isValid && !battleOver,
    refetchInterval: q => q.state.data?.battle?.status === 'FINISHED' || battleOver ? false : 3000,
  })

  // ── Данные из liveState (Redis) и БД ──────────────────────
  const live      = battleData?.liveState
  const dbParts   = (battleData?.battle?.participants ?? []) as Array<{ characterId?: string | null; botId?: string | null; hpMax?: number; hpCurrent?: number }>
  const pPart     = live?.participants.find((p: { characterId?: string }) => p.characterId === char?.id)
  const ePart     = live?.participants.find((p: { botId?: string; characterId?: string }) => !!p.botId || p.characterId !== char?.id)
  // Fallback на DB participants для hpMax (важно: Redis может ещё не загрузиться)
  const dbEPart   = dbParts.find(p => !!p.botId || (p.characterId && p.characterId !== char?.id))
  const pHp       = playerHp ?? pPart?.hpCurrent ?? char?.hpCurrent ?? 0
  const pHpMax    = pPart?.hpMax ?? char?.hpMax ?? 1
  const eHp       = enemyHp ?? ePart?.hpCurrent ?? dbEPart?.hpCurrent ?? 0
  const eHpMax    = ePart?.hpMax ?? dbEPart?.hpMax ?? 0  // 0 показывает полный бар до загрузки
  const weapon    = items.find(i => i.isEquipped && i.template.type === 'WEAPON')
  const enemyName = 'Противник'

  // Только расходники из loadout (взятые до боя)
  const pocketSlots: (ItemInstance | null)[] = [0, 1, 2, 3].map(idx => {
    const id = loadoutIds[idx]
    if (!id) return null
    return items.find(i => i.id === id && i.status !== 'DELETED' && i.status !== 'CONSUMED') ?? null
  })

  const actionMut = useMutation({
    mutationFn: ({ action, itemId }: { action: BattleAction; itemId?: string }) =>
      battlesApi.submitAction(battleId!, action, itemId) as unknown as Promise<RoundResult>,
    onSuccess: (data, variables) => {
      const rn = data.roundNumber ?? currentRound
      setCurrentRound(rn)
      if (data.playerHp != null) setPlayerHp(data.playerHp)
      if (data.botHp    != null) setEnemyHp(data.botHp)

      // Fix 1.1: аптечка пропадает сразу после использования
      if (variables.action === 'use_item') {
        qc.invalidateQueries({ queryKey: ['inventory'] })
      }

      const events: TurnEvent[] = data.turns?.map(t => ({
        actor: t.actor === 'player' ? 'player' : 'enemy',
        action: t.action, hit: t.hit, dodge: t.dodge, block: t.block,
        crit: t.crit, lucky: t.lucky, counterDamage: t.counterDamage,
        rawDamage: t.rawDamage, finalDamage: t.finalDamage, logParts: t.logParts,
      })) ?? []

      let pd = 0
      events.forEach(t => {
        if (t.hit && !t.dodge) {
          if (t.actor === 'player') { setEnemyHit(true); setTimeout(() => setEnemyHit(false), 500); pd += t.finalDamage }
          else                      { setPlayerHit(true); setTimeout(() => setPlayerHit(false), 500) }
        }
      })
      setPlayerDmg(p => p + pd)
      if (events.length > 0) setLastEvent(events[events.length - 1])

      setRounds(prev => [...prev, {
        round: rn, events,
        type: data.battleOver ? (data.result === 'PVE_WIN' ? 'win' : 'lose') : 'normal',
        ...data,
      }])

      if (data.battleOver) {
        setBattleOver(true); setFinishResult(data)
        localStorage.removeItem('mmo_current_battle')
        qc.invalidateQueries({ queryKey: ['character', 'me'] })
        qc.invalidateQueries({ queryKey: ['inventory'] })
      }
    },
    onError: (err) => {
      setActionError(err instanceof ApiError ? err.message : 'Ошибка')
      setTimeout(() => setActionError(''), 4000)
    },
  })

  const canAct = !battleOver && !actionMut.isPending
  const act = (action: BattleAction, itemId?: string) => {
    setTimeLeft(7) // сброс таймера при действии
    actionMut.mutate({ action, itemId })
  }
  const playerName = char?.nickname ?? 'Игрок'

  // ── Таймер хода: 7 секунд, потом авто-блок ─────────────────
  const [timeLeft, setTimeLeft] = useState(7)

  useEffect(() => {
    if (battleOver || actionMut.isPending) return
    setTimeLeft(7)
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval)
          if (!battleOver && !actionMut.isPending) {
            actionMut.mutate({ action: 'block' })
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRound, battleOver])

  if (!isValid) return null

  // ── Финальный экран ───────────────────────────────────────
  if (battleOver && finishResult) {
    const won = finishResult.result === 'PVE_WIN'
    return (
      <div className="battle-page-v2">
        <div className="battle-main-col">
          <div className={`battle-result-v2 ${won ? 'win' : 'lose'}`}>
            <div className="brv2-icon">{won ? <Trophy size={48} /> : <Skull size={48} />}</div>
            <div className="brv2-title">{won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ'}</div>
            {won && (
              <div className="brv2-rewards">
                {(finishResult.expGain ?? 0) > 0 && (
                  <div className="brv2-reward"><Heart size={16} /><span>+{finishResult.expGain}</span><small>опыт</small></div>
                )}
                {(finishResult.weaponExpGain ?? 0) > 0 && (
                  <div className="brv2-reward"><Sword size={16} /><span>+{Number(finishResult.weaponExpGain).toFixed(1)}</span><small>навык</small></div>
                )}
                {(finishResult.moneyReward ?? 0) > 0 && (
                  <div className="brv2-reward"><CircleDot size={16} /><span>+{finishResult.moneyReward}₽</span><small>деньги</small></div>
                )}
              </div>
            )}
            {(finishResult.newLevel ?? 0) > 1 && (
              <div className="brv2-levelup">НОВЫЙ УРОВЕНЬ {finishResult.newLevel}</div>
            )}
            <div className="brv2-actions">
              <button className="btn btn-primary" onClick={() => navigate('/profile')}>Профиль</button>
              <button className="btn btn-gold"    onClick={() => navigate('/repair')}>Ремонт</button>
              <button className="btn btn-danger"  onClick={() => navigate('/profile')}>Ещё раз</button>
            </div>
          </div>

          {/* Fix 1.2: Лог боя на экране результата */}
          {rounds.length > 0 && (
            <div className="battle-log-v2" style={{ marginTop: 8 }}>
              <div className="log-toggle-v2" style={{ cursor: 'default' }}>
                <ChevronDown size={12} />
                <span>Лог боя — {rounds.length} раундов</span>
              </div>
              <div className="log-body-v2">
                {rounds.map(r => (
                  <div key={r.round} className="log-round-v2">
                    <div className="log-round-header">Раунд {r.round}</div>
                    {r.events.map((t, i) => {
                      const e = getEvent(t)
                      const isPlayer = t.actor === 'player'
                      return (
                        <div key={i} className={`log-event-line ${isPlayer ? 'log-ev-player' : 'log-ev-enemy'}`}>
                          <span className="log-ev-actor">{isPlayer ? playerName : enemyName}</span>
                          <span className="log-ev-arrow">→</span>
                          <span className="log-ev-icon" style={{ color: e.color }}><EventIcon type={e.type} /></span>
                          <span className="log-ev-label" style={{ color: e.color }}>{e.label}</span>
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
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="battle-page-v2">

      {/* ══ ОСНОВНАЯ КОЛОНКА ══ */}
      <div className="battle-main-col">

        {/* Шапка */}
        <div className="battle-header-v2">
          <div className="bh-left">
            <Sword size={13} style={{ color: 'var(--gold-dim)' }} />
            <span>АРЕНА</span>
          </div>
          <div className="bh-center">Раунд {currentRound} / 30</div>
          <div className="bh-right">
            {actionMut.isPending
              ? <><RotateCcw size={11} className="spin" /> Ход...</>
              : <><CircleDot size={9} style={{ color: 'var(--success)' }} /> Идёт бой</>}
          </div>
        </div>

        {/* Поле боя */}
        <BattleGrid
          playerName={playerName} playerHp={pHp} playerHpMax={pHpMax}
          enemyName={enemyName}   enemyHp={eHp}  enemyHpMax={eHpMax}
          playerDefeated={false} enemyDefeated={false}
          playerHit={playerHit} enemyHit={enemyHit}
          lastEvent={lastEvent}
        />

        {/* HUD */}
        <div className="battle-hud-v2">
          {actionError && (
            <div className="battle-error-v2">
              <AlertTriangle size={13} /> {actionError}
            </div>
          )}

          {/* Таймер хода */}
          {!battleOver && !actionMut.isPending && (
            <div className="hud-timer" style={{
              color: timeLeft <= 2 ? 'var(--danger)' : timeLeft <= 4 ? 'var(--warning)' : 'var(--text-dim)',
            }}>
              <div
                className="hud-timer-bar"
                style={{
                  width: `${(timeLeft / 7) * 100}%`,
                  background: timeLeft <= 2 ? 'var(--red)' : timeLeft <= 4 ? 'var(--warning)' : 'var(--accent)',
                }}
              />
              <span className="hud-timer-num">{timeLeft}с</span>
            </div>
          )}

          <div className="hud-v2-actions">
            <button className="hud-v2-btn attack" disabled={!canAct} onClick={() => act('attack')}>
              <Sword size={20} /><span>Атака</span>
            </button>
            <button className="hud-v2-btn block" disabled={!canAct} onClick={() => act('block')}>
              <Shield size={20} /><span>Блок</span>
            </button>
            <button className="hud-v2-btn surrender" disabled={!canAct} onClick={() => act('surrender')} title="Сдаться">
              <Flag size={16} />
            </button>
          </div>

          <div className="hud-v2-weapon">
            <Sword size={10} style={{ color: 'var(--text-dim)' }} />
            <span>{weapon?.template.name ?? 'Кулаки'}</span>
            <span style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>
              Нанесено: {playerDmg}
            </span>
          </div>
        </div>

        {/* Лог */}
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
                    const isPlayer = t.actor === 'player'
                    return (
                      <div key={i} className={`log-event-line ${isPlayer ? 'log-ev-player' : 'log-ev-enemy'}`}>
                        <span className="log-ev-actor">{isPlayer ? playerName : enemyName}</span>
                        <span className="log-ev-arrow">→</span>
                        <span className="log-ev-icon" style={{ color: e.color }}><EventIcon type={e.type} /></span>
                        <span className="log-ev-label" style={{ color: e.color }}>{e.label}</span>
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

      {/* ══ ПРАВАЯ ПАНЕЛЬ — КАРМАНЫ ══ */}
      <PocketsPanel
        slots={pocketSlots}
        canAct={canAct}
        onUse={(id) => act('use_item', id)}
      />

    </div>
  )
}
