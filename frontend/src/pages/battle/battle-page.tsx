import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import {
  Sword, Shield, Heart, Zap, ArrowRight, ArrowLeft,
  RotateCcw, Flag, ChevronDown, ChevronUp, Skull,
  CircleDot, User, Trophy, AlertTriangle, Pill,
} from 'lucide-react'
import { battlesApi, type BodyZone, type Stance, type SubmitActionOpts } from '../../shared/api/battles.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { type BattleAction, type ItemInstance } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOADOUT_KEY = 'mmo_battle_loadout'

// ── Зоны и стойки (модель Апехи) ───────────────────────────
const ZONES: { key: BodyZone; label: string; short: string }[] = [
  { key: 'HEAD',      label: 'Голова',    short: 'Гол' },
  { key: 'CHEST',     label: 'Корпус',    short: 'Корп' },
  { key: 'RIGHT_ARM', label: 'Пр. рука',  short: 'Пр.р' },
  { key: 'LEFT_ARM',  label: 'Лев. рука', short: 'Лв.р' },
  { key: 'LEGS',      label: 'Ноги',      short: 'Ноги' },
]
const ZONE_LABEL: Record<BodyZone, string> = {
  HEAD: 'голова', CHEST: 'корпус', LEGS: 'ноги', RIGHT_ARM: 'правая рука', LEFT_ARM: 'левая рука',
}
const STANCES: { key: Stance; label: string; attacks: number; blocks: number; hint: string }[] = [
  { key: 'attack2',  label: '2 удара',      attacks: 2, blocks: 0, hint: 'Максимум урона, ты открыт' },
  { key: 'mixed',    label: '1 удар + блок', attacks: 1, blocks: 1, hint: 'Размен' },
  { key: 'defense4', label: '4 блока',      attacks: 0, blocks: 4, hint: 'Глухая защита: закрыто 4 из 5 зон' },
]

function getLoadout(): string[] {
  try { return JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? '[]') } catch { return [] }
}

interface TurnEvent {
  actor: 'player' | 'enemy' | string
  action: string; hit: boolean; dodge: boolean; block: boolean
  crit: boolean; lucky?: boolean; blockPierced?: boolean; zone?: BodyZone
  counterDamage?: number
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
  botStance?: Stance; botAttackZones?: BodyZone[]; botBlockZones?: BodyZone[]
  distance?: number; playerRange?: number
}

// ── Иконки событий ─────────────────────────────────────────
function EventIcon({ type }: { type: string }) {
  const sz = 13
  if (type === 'dodge')   return <ArrowRight size={sz} />
  if (type === 'block')   return <Shield size={sz} />
  if (type === 'counter') return <RotateCcw size={sz} />
  if (type === 'crit')    return <Zap size={sz} />
  if (type === 'lucky')   return <Zap size={sz} />
  if (type === 'move')    return <ArrowRight size={sz} />
  return <Sword size={sz} />
}

function getEvent(t: TurnEvent) {
  const z = t.zone ? ` (${ZONE_LABEL[t.zone]})` : ''
  if (t.action === 'move') return { type: 'move', label: 'Сближение', color: '#7a9bd0' }
  if (!t.hit && t.dodge) return { type: 'dodge',   label: 'Уворот' + z,   color: '#88b048' }
  if (!t.hit)            return { type: 'dodge',   label: 'Уворот' + z,   color: '#88b048' } // нет промаха
  if (t.block)           return { type: 'block',   label: ((t.counterDamage ?? 0) > 0 ? 'Блок + ответка' : 'Блок') + z, color: '#6a9a3a' }
  if (t.blockPierced)    return { type: 'lucky',   label: 'Пробил блок' + z, color: '#9a60c0' }
  if (t.lucky)           return { type: 'lucky',   label: 'Пробитие' + z, color: '#9a60c0' }
  if (t.crit)            return { type: 'crit',    label: 'КРИТ' + z,     color: '#d4a017' }
  return                        { type: 'hit',     label: 'Удар' + z,     color: '#c43030' }
}
function zoneText(z?: BodyZone): string { return z ? ZONE_LABEL[z] : '' }

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
  playerHit, enemyHit, lastEvent, distance,
}: {
  playerName: string; playerHp: number; playerHpMax: number
  enemyName: string;  enemyHp: number;  enemyHpMax: number
  playerDefeated: boolean; enemyDefeated: boolean
  playerHit: boolean; enemyHit: boolean; lastEvent: TurnEvent | null
  distance?: number
}) {
  const midRow = Math.floor(GRID_ROWS / 2)
  // позиция врага зависит от дистанции (ближний бой = соседняя клетка)
  const enemyCol = distance != null
    ? Math.min(GRID_COLS - 1, Math.max(PLAYER_COL + 1, PLAYER_COL + distance))
    : ENEMY_COL

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
            const isEnemy  = col === enemyCol  && row === midRow
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

  // ── Зональный ход ──────────────────────────────────────
  const [stance, setStance]             = useState<Stance>('attack2')
  const [attackZones, setAttackZones]   = useState<BodyZone[]>([])
  const [blockZones, setBlockZones]     = useState<BodyZone[]>([])
  const [enemyStance, setEnemyStance]   = useState<{ stance: Stance; attackZones: BodyZone[]; blockZones: BodyZone[] } | null>(null)
  const [distance, setDistance]         = useState<number | null>(null)
  const [playerRange, setPlayerRange]   = useState<number | null>(null)

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
    mutationFn: ({ action, opts }: { action: BattleAction; opts?: SubmitActionOpts }) =>
      battlesApi.submitAction(battleId!, action, opts) as unknown as Promise<RoundResult>,
    onSuccess: (data, variables) => {
      const rn = data.roundNumber ?? currentRound
      setCurrentRound(rn)
      if (data.playerHp != null) setPlayerHp(data.playerHp)
      if (data.botHp    != null) setEnemyHp(data.botHp)
      if (data.botStance) {
        setEnemyStance({
          stance: data.botStance,
          attackZones: data.botAttackZones ?? [],
          blockZones: data.botBlockZones ?? [],
        })
      }
      if (data.distance != null) setDistance(data.distance)
      if (data.playerRange != null) setPlayerRange(data.playerRange)

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
  const act = (action: BattleAction, opts?: SubmitActionOpts) => {
    setTimeLeft(7) // сброс таймера при действии
    actionMut.mutate({ action, opts })
  }
  const playerName = char?.nickname ?? 'Игрок'

  // ── Зональный ход: стойки и выбор зон ──────────────────
  const budget = STANCES.find(s => s.key === stance)!
  const changeStance = (s: Stance) => { setStance(s); setAttackZones([]); setBlockZones([]) }
  const toggleAttack = (z: BodyZone) => setAttackZones(prev =>
    prev.includes(z) ? prev.filter(x => x !== z) : prev.length < budget.attacks ? [...prev, z] : prev)
  const toggleBlock = (z: BodyZone) => setBlockZones(prev =>
    prev.includes(z) ? prev.filter(x => x !== z) : prev.length < budget.blocks ? [...prev, z] : prev)
  const submitTurn = () => {
    const action: BattleAction = stance === 'defense4' ? 'block' : 'attack'
    act(action, { stance, attackZones, blockZones })
    setAttackZones([]); setBlockZones([])
  }

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
            actionMut.mutate({ action: 'block', opts: { stance: 'defense4' } })
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
          distance={distance ?? live?.distance ?? undefined}
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

          {/* ── Зональный ход: стойка + зоны ── */}
          <div className="hud-zonal">
            {(distance ?? live?.distance) != null && (() => {
              const d = (distance ?? live?.distance) as number
              const far = playerRange != null && d > playerRange
              return (
                <div style={{ fontSize: 11, textAlign: 'center', marginBottom: 5, color: far ? 'var(--warning, #c4802a)' : 'var(--text-dim)' }}>
                  Дистанция: {d}{playerRange != null && ` · оружие бьёт с ${playerRange}`}
                  {far && ' — далеко, нужно подойти ближе'}
                </div>
              )
            })()}

            {/* Движение по полю: Подойти / Отойти — это ход вместо удара */}
            {(() => {
              const d = (distance ?? live?.distance) as number | null
              const far = d != null && playerRange != null && d > playerRange
              const atMelee = d != null && d <= 1
              return (
                <div className="hz-move" style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  <button
                    onClick={() => act('move', { moveDir: 'retreat' })}
                    disabled={!canAct}
                    title="Отойти на клетку — увеличить дистанцию (ход вместо удара)"
                    style={{
                      flex: 1, padding: '6px 4px', fontSize: 11, fontWeight: 'bold',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      cursor: canAct ? 'pointer' : 'default', borderRadius: 4,
                      border: '1px solid var(--border,#444)', background: 'transparent', color: 'var(--text-dim,#999)',
                    }}>
                    <ArrowLeft size={13} /> Отойти
                  </button>
                  <button
                    onClick={() => act('move', { moveDir: 'approach' })}
                    disabled={!canAct || atMelee}
                    title="Подойти на клетку — сократить дистанцию (ход вместо удара)"
                    style={{
                      flex: 1, padding: '6px 4px', fontSize: 11, fontWeight: 'bold',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                      cursor: (!canAct || atMelee) ? 'default' : 'pointer', borderRadius: 4,
                      border: `1px solid ${far ? 'var(--gold,#d4a017)' : 'var(--border,#444)'}`,
                      background: far ? 'rgba(212,160,23,0.15)' : 'transparent',
                      color: far ? 'var(--gold,#d4a017)' : 'var(--text-dim,#999)',
                      opacity: atMelee ? 0.4 : 1,
                    }}>
                    Подойти <ArrowRight size={13} />
                  </button>
                </div>
              )
            })()}

            <div className="hz-stances" style={{ display: 'flex', gap: 4 }}>
              {STANCES.map(s => (
                <button key={s.key} onClick={() => changeStance(s.key)} disabled={!canAct} title={s.hint}
                  style={{
                    flex: 1, padding: '6px 4px', fontSize: 11, fontWeight: 'bold', cursor: canAct ? 'pointer' : 'default',
                    border: `1px solid ${stance === s.key ? 'var(--gold, #d4a017)' : 'var(--border, #444)'}`,
                    background: stance === s.key ? 'rgba(212,160,23,0.15)' : 'transparent',
                    color: stance === s.key ? 'var(--gold, #d4a017)' : 'var(--text-dim, #999)',
                    borderRadius: 4,
                  }}>
                  {s.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'center', margin: '3px 0' }}>{budget.hint}</div>

            <div className="hz-zones" style={{ display: 'flex', flexDirection: 'column', gap: 3, margin: '4px 0' }}>
              {ZONES.map(z => {
                const atk = attackZones.includes(z.key)
                const blk = blockZones.includes(z.key)
                const atkFull = !atk && attackZones.length >= budget.attacks
                const blkFull = !blk && blockZones.length >= budget.blocks
                return (
                  <div key={z.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ flex: 1, color: 'var(--text)' }}>{z.label}</span>
                    {budget.attacks > 0 && (
                      <button disabled={!canAct || atkFull} onClick={() => toggleAttack(z.key)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 4,
                          cursor: (!canAct || atkFull) ? 'default' : 'pointer',
                          border: `1px solid ${atk ? '#c43030' : 'var(--border,#444)'}`,
                          background: atk ? 'rgba(196,48,48,0.2)' : 'transparent',
                          color: atk ? '#e06060' : 'var(--text-dim,#888)',
                          opacity: atkFull ? 0.35 : 1,
                        }}>
                        <Sword size={12} /> Удар
                      </button>
                    )}
                    {budget.blocks > 0 && (
                      <button disabled={!canAct || blkFull} onClick={() => toggleBlock(z.key)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 3, padding: '3px 8px', borderRadius: 4,
                          cursor: (!canAct || blkFull) ? 'default' : 'pointer',
                          border: `1px solid ${blk ? '#4a8a35' : 'var(--border,#444)'}`,
                          background: blk ? 'rgba(74,138,53,0.2)' : 'transparent',
                          color: blk ? '#88c060' : 'var(--text-dim,#888)',
                          opacity: blkFull ? 0.35 : 1,
                        }}>
                        <Shield size={12} /> Блок
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-danger" disabled={!canAct} onClick={submitTurn} style={{ flex: 1, fontWeight: 'bold' }}>
                <Sword size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Ходить
                <span style={{ fontSize: 10, opacity: 0.8, marginLeft: 6 }}>
                  ({attackZones.length}/{budget.attacks} уд · {blockZones.length}/{budget.blocks} бл)
                </span>
              </button>
              <button className="btn" disabled={!canAct} onClick={() => act('surrender')} title="Сдаться" style={{ padding: '0 12px' }}>
                <Flag size={14} />
              </button>
            </div>

            {enemyStance && (
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 5, textAlign: 'center' }}>
                Противник: {STANCES.find(s => s.key === enemyStance.stance)?.label}
                {enemyStance.blockZones.length > 0 && ` · блок: ${enemyStance.blockZones.map(zoneText).join(', ')}`}
              </div>
            )}
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
        onUse={(id) => act('use_item', { itemInstanceId: id })}
      />

    </div>
  )
}
