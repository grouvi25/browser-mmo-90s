import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { cityApi } from '../../shared/api/city.api'
import { locationLabel } from '../../shared/lib/city-locations'
import { useState, useEffect, useRef, type CSSProperties } from 'react'
import {
  Sword, Heart, ChevronDown, Skull,
  CircleDot, Trophy, AlertTriangle, Backpack, Flag, Dog, UserRound,
} from 'lucide-react'
import { battlesApi, type AttackHand, type BodyZone, type Stance, type SubmitActionOpts } from '../../shared/api/battles.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { type BattleAction, type ItemInstance, type LiveParticipant } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'
import { hexDistance, isNeighbour, GRID_COLS, GRID_ROWS } from '../../shared/lib/hex'
import { DESIGNER_BATTLE_CELLS } from '../../shared/lib/designer-battle-grid'
import battleField from '../../shared/assets/battle/battle-field.webp'
import battleField2x from '../../shared/assets/battle/battle-field@2x.webp'
import fighterBlue from '../../shared/assets/battle/fighter-blue.webp'
import fighterBlue2x from '../../shared/assets/battle/fighter-blue@2x.webp'
import fighterRed from '../../shared/assets/battle/fighter-red.webp'
import fighterRed2x from '../../shared/assets/battle/fighter-red@2x.webp'
import { EventIcon, getEvent, type TurnEvent } from './components/battle-events'
import { BattlePockets } from './components/battle-pockets'
import { BattleJournal } from '../../widgets/battle-journal/battle-journal'
import { BattleSwap, type SwapPlan } from './components/battle-swap'
import { battleDisplayState, canSelectBattleMove, type BattleActionSnapshot, selectAutomaticAttack, toggleAutomaticBlockSlot } from './battle-view-model'
import { BattleDesk } from './battle-desk'
import { BattleZoneList } from './components/battle-zone-list'
import { BattleHelperBadge } from './components/battle-helper-badge'
import { PersistedBattleChronicle } from './components/battle-chronicle'
import { getActionBudget, validateTurnPlan } from './battle-view-model'
import { useIsMobile } from '../../shared/lib/use-media-query'
import './battle-phase-a.css'
import './battle-mobile.css'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RoundResult {
  roundNumber?: number; playerHp?: number; botHp?: number; battleOver?: boolean
  result?: string; expGain?: number; weaponExpGain?: number; moneyReward?: number
  /** PvP отдаёт победителя, командный бой — победившую сторону, без result. */
  winnerId?: string | null; winnerSide?: number | null
  newLevel?: number; waiting?: boolean; turns?: TurnEvent[]
  /** Сколько уровней прибавил этот бой: плашка «НОВЫЙ УРОВЕНЬ» — только когда реально вырос. */
  levelsGained?: number
  botStance?: Stance; botAttackZones?: BodyZone[]; botBlockZones?: BodyZone[]
  distance?: number; playerRange?: number
  /** PvP: шаг применён сервером сразу, не дожидаясь хода противника. */
  moved?: boolean; position?: { x: number; y: number }
}

// Tactical field
const PLAYER_COL = 1

/**
 * Вызванные помощники и собаки — фигуры на поле (правка заказчика 28.10).
 * Для поля, расстояния и выбора цели они — участники со своим адресом
 * «helper:<хозяин>» / «dog:<хозяин>»: так их видно, по ним можно бить, и
 * дальность считается теми же правилами.
 */
function companionFigures(parts: readonly LiveParticipant[]): LiveParticipant[] {
  return parts.flatMap(owner => (['helper', 'dog'] as const).flatMap(kind => {
    const body = kind === 'helper' ? owner.helper : owner.dog
    if (!body?.summoned || !body.alive || !body.position) return []
    return [{
      participantId: `${kind}:${owner.participantId}`, companion: kind, side: owner.side,
      isAlive: true, isSurrendered: false, hasActedThisRound: true,
      hpCurrent: body.hp, hpMax: body.hpMax, damageDealt: body.damageDealt ?? 0, damageReceived: 0,
      position: body.position,
    } as LiveParticipant]
  }))
}

function BattleGrid({
  playerName, enemyName,
  playerHit, enemyHit, playerAttack, enemyAttack, lastEvent,
  playerPosition, selectedMove, onSelectMove,
  participants, playerParticipantId, playerSide, selectedTargetId, onSelectTarget, range, arena, obstacles,
  playerHp, enemyHp, names,
}: {
  playerName: string
  enemyName: string
  playerDefeated: boolean; enemyDefeated: boolean
  playerHit: boolean; enemyHit: boolean
  // Выпад атакующего: своя фигура делает рывок к цели и возвращается.
  playerAttack: boolean; enemyAttack: boolean
  lastEvent: TurnEvent | null
  distance?: number
  playerPosition?: { x: number; y: number }
  enemyPosition?: { x: number; y: number }
  selectedMove?: { x: number; y: number } | null
  onSelectMove?: (position: { x: number; y: number }) => void
  participants?: LiveParticipant[]
  playerParticipantId?: string
  playerSide?: number
  selectedTargetId?: string | null
  onSelectTarget?: (participantId: string) => void
  /** Дальность оружия в клетках: до каких клеток оно достаёт отсюда. */
  range?: number
  arena?: { x0: number; x1: number; y0: number; y1: number } | null
  obstacles?: { x: number; y: number }[]
  /** Своё ХП и ХП цели — те же, что в шапке: после хода они свежее,
   *  чем живое состояние до следующего опроса. */
  playerHp?: number
  enemyHp?: number
  /** Имена бойцов по участнику — для подсказки при наведении на фигуру. */
  names?: Record<string, string>
}) {
  const midRow = Math.floor(GRID_ROWS / 2)
  return (
    <div className="grid-arena">

      {/* Поле: соты «остриём вверх», нечётные ряды смещены вправо */}
      <div className="hex-board">
        <div className="hex-field designer-battle-field" style={{ backgroundImage: `image-set(url("${battleField2x}") 2x, url("${battleField}") 1x)` }}>
        {DESIGNER_BATTLE_CELLS.map(designerCell => {
            const col = designerCell.x
            const row = designerCell.y
            const cell = { x: col, y: row }
            const fighterDepth = 0.58 + designerCell.centerY / 100 * 0.72
            const fighterStyle = { '--fighter-depth': fighterDepth } as CSSProperties
            const playerCell = playerPosition ?? { x: PLAYER_COL, y: midRow }
            const occupant = participants?.find(p => p.isAlive && p.position.x === col && p.position.y === row)
            // Пустая клетка не должна считаться своей: пока участник боя
            // не загружен, undefined === undefined давало true и всё поле
            // подсвечивалось как занятое игроком.
            const isPlayer = !!occupant && occupant.participantId === playerParticipantId
            const isAlly = !!occupant && !isPlayer && occupant.side === playerSide
            const isEnemy = !!occupant && occupant.side !== playerSide
            const isCenter = col === Math.floor(GRID_COLS / 2) && row === midRow
            // Дуэль идёт в полосе 3×8, на поле — бочки (их не пройти).
            const outside = !!arena && (col < arena.x0 || col > arena.x1 || row < arena.y0 || row > arena.y1)
            const barrel = !!obstacles?.some(o => o.x === col && o.y === row)
            // подсветка хода — по тем же правилам соседства, что у сервера
            const canMove = isNeighbour(playerCell, cell) && !occupant && !outside && !barrel
            const inRange = !!range && range > 1 && !occupant && !outside && !barrel && hexDistance(playerCell, cell) <= range
            const isSelected = selectedMove?.x === col && selectedMove?.y === row
            const isTarget = isEnemy && occupant?.participantId === selectedTargetId
            const clickable = canMove || (isEnemy && !!occupant)
            // Полоска здоровья над фигурой: в групповом бою видно, кто
            // сколько держит, и она падает сразу после удара.
            const hpNow = !occupant ? 0
              : isPlayer ? (playerHp ?? occupant.hpCurrent)
                : isTarget ? (enemyHp ?? occupant.hpCurrent)
                  : occupant.hpCurrent
            const hpBar = occupant && occupant.hpMax > 0 && (
              <span className="token-hp">
                <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, hpNow / occupant.hpMax))})` }} />
              </span>
            )
            // Точное здоровье — при наведении ровно на фигуру (заказчик 27.10:
            // «главное, чтобы при наведении считалось ровно на самой иконке
            // персонажа»; полоска остаётся, цифры над ней в толпе — каша).
            const who = occupant ? (isPlayer ? playerName : names?.[occupant.participantId] ?? (isEnemy ? 'Противник' : 'Союзник')) : ''
            const tip = occupant && <span className="token-tip" role="tooltip">{who} · {hpNow} / {occupant.hpMax} HP</span>
            return (
              <div
                key={`${row}-${col}`}
                className={'hex-cell'
                  + ((isPlayer || isAlly) ? ' is-player' : '')
                  + (isEnemy ? ' is-enemy' : '')
                  + (isCenter ? ' is-center' : '')
                  + (outside ? ' is-outside' : '')
                  + (barrel ? ' is-barrel' : '')
                  + (canMove ? ' is-movable' : '')
                  + (inRange ? ' is-in-range' : '')
                  + (isSelected ? ' is-selected' : '')
                  + (isTarget ? ' is-target' : '')
                  + (clickable ? ' is-clickable' : '')}
                style={{ left: `${designerCell.left}%`, top: `${designerCell.top}%`, width: `${designerCell.width}%`, height: `${designerCell.height}%` }}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                aria-label={canMove ? `Перейти в клетку ${col}:${row}`
                  : isEnemy && occupant ? `Выбрать противника в клетке ${col}:${row}` : undefined}
                onClick={() => canMove
                  ? onSelectMove?.(cell)
                  : isEnemy && occupant ? onSelectTarget?.(occupant.participantId) : undefined}
                onKeyDown={event => {
                  if (!clickable || (event.key !== 'Enter' && event.key !== ' ')) return
                  event.preventDefault()
                  if (canMove) onSelectMove?.(cell)
                  else if (isEnemy && occupant) onSelectTarget?.(occupant.participantId)
                }}
              >
                <span className="designer-cell-hit" style={{ clipPath: designerCell.polygon }} />
                {barrel && <span className="hex-barrel" style={fighterStyle} title="Бочка: не пройти и не прострелить" role="img" aria-label="Бочка" />}
                {occupant?.companion && (
                  <div style={fighterStyle} className={`fighter-token token-companion ${isEnemy ? 'is-enemy' : 'is-ally'}`}>
                    {occupant.companion === 'dog' ? <Dog size={22} aria-hidden="true" /> : <UserRound size={22} aria-hidden="true" />}
                    {tip}
                    {hpBar}
                    {isTarget && <span className="token-target-label">ЦЕЛЬ</span>}
                  </div>
                )}
                {(isPlayer || isAlly) && occupant && !occupant.companion && (
                  <div style={fighterStyle} className={`fighter-token token-player ${isPlayer ? 'token-self' : 'token-ally'} ${isPlayer && playerHit ? 'token-hit' : ''} ${isPlayer && playerAttack ? 'token-attacking' : ''} ${!occupant.isAlive ? 'token-dead' : ''}`}>
                    {!occupant.isAlive ? <Skull size={16} /> : <img className="token-figure" src={fighterBlue} srcSet={`${fighterBlue2x} 2x`} alt={who} />}
                    {tip}
                    {hpBar}
                  </div>
                )}
                {isEnemy && occupant && !occupant.companion && (
                  <div style={fighterStyle} className={`fighter-token token-enemy ${isTarget && enemyHit ? 'token-hit' : ''} ${isTarget && enemyAttack ? 'token-attacking' : ''} ${!occupant.isAlive ? 'token-dead' : ''}`}>
                    {!occupant.isAlive ? <Skull size={16} /> : <img className="token-figure" src={fighterRed} srcSet={`${fighterRed2x} 2x`} alt={who} />}
                    {tip}
                    {hpBar}
                    {isTarget && <span className="token-target-label">ЦЕЛЬ</span>}
                  </div>
                )}
                {isCenter && lastEvent && (
                  <div className={`grid-event-flash event-${getEvent(lastEvent).type}`}>
                    <EventIcon type={getEvent(lastEvent).type} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Последнее событие */}
      {lastEvent && (() => {
        const e = getEvent(lastEvent)
        return (
          <div className="grid-last-event" style={{ borderColor: e.color }}>
            <span style={{ color: e.color }}><EventIcon type={e.type} /></span>
            <span style={{ color: lastEvent.actor === 'player' ? 'var(--accent-light)' : 'var(--danger)', fontWeight: 'bold', fontSize: 12.75 }}>
              {lastEvent.actor === 'player' ? playerName : enemyName}
            </span>
            <span style={{ color: e.color, fontWeight: 'bold', fontSize: 12.75 }}>{e.label}</span>
            {lastEvent.finalDamage > 0 && (
              <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 12.75 }}>
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

  const [actionSnapshot, setActionSnapshot] = useState<BattleActionSnapshot | null>(null)
  const [battleOver, setBattleOver]     = useState(false)
  const [finishResult, setFinishResult] = useState<RoundResult | null>(null)
  // Итог не выскакивает мгновенно: полторы секунды игрок ещё видит поле
  // и последний удар в логе, потом итог мягко проявляется (правка
  // заказчика 23.10: экран конца боя «пугает» резкой подменой).
  const [showResult, setShowResult]     = useState(false)
  const cameFrom = useQuery({ queryKey: ['city', 'location', 'before-battle'], queryFn: cityApi.location, staleTime: 60_000, retry: false })
  const [actionError, setActionError]   = useState('')
  const [showLog, setShowLog]           = useState(false)
  const [pocketsOpen, setPocketsOpen]   = useState(false)
  // План переодевания на текущий ход; после отправки сбрасывается.
  const [swapPlan, setSwapPlan]         = useState<SwapPlan>({})
  // Чат закрыт по умолчанию: так сцена короче и всё на экране крупнее.
  // ── Раскладка экрана ───────────────────────────────────
  // Экран боя собран из трёх частей: шапка города сверху, карточки
  // бойцов по краям и сцена макета посередине. Каждой нужен свой
  // расчёт от габаритов окна, поэтому берём сами габариты, а не
  // готовый коэффициент.
  const actionPendingRef = useRef(false)
  const [playerHit, setPlayerHit]       = useState(false)
  const [enemyHit, setEnemyHit]         = useState(false)
  // Выпад атакующего: рывок к цели и назад. Флаг на 460 мс — длину
  // ставим чуть больше кадра анимации, чтобы она успела доиграть.
  const [playerAttack, setPlayerAttack] = useState(false)
  const [enemyAttack, setEnemyAttack]   = useState(false)
  const [lastEvent, setLastEvent]       = useState<TurnEvent | null>(null)

  // ── Зональный ход ──────────────────────────────────────
  const [stance, setStance]             = useState<Stance>('defense4')
  const [attackZones, setAttackZones]   = useState<BodyZone[]>([])
  const [attackHands, setAttackHands]   = useState<AttackHand[]>([])
  const [blockZones, setBlockZones]     = useState<BodyZone[]>([])
  const [selectedMove, setSelectedMove] = useState<{ x: number; y: number } | null>(null)
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)

  const isValid = !!battleId && UUID_RE.test(battleId)
  useEffect(() => { if (!isValid) navigate('/profile', { replace: true }) }, [isValid, navigate])

  const { data: char } = useQuery({
    queryKey: ['character', 'me'], queryFn: () => charactersApi.getMe(), enabled: isValid,
  })
  const { data: items = [] } = useQuery({
    queryKey: ['inventory'], queryFn: () => inventoryApi.getItems(), enabled: isValid && !!char,
  })
  const { data: battleData, dataUpdatedAt } = useQuery({
    queryKey: ['battle', battleId],
    queryFn: () => battlesApi.getBattle(battleId!),
    enabled: isValid && !battleOver,
    refetchInterval: q => q.state.data?.battle?.status === 'FINISHED' || battleOver ? false : 3000,
  })

  // Тактика боевого помощника меняется по ходу боя.
  const helperTacticMut = useMutation({
    mutationFn: (tactic: 'ATTACK' | 'STANDARD' | 'DEFENSIVE') => battlesApi.setHelperTactic(battleId!, tactic),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['battle', battleId] }) },
    onError: (err) => { setActionError(err instanceof ApiError ? err.message : 'Ошибка'); setTimeout(() => setActionError(''), 4000) },
  })

  // Вызов помощника или собаки на поле (правка 28.10).
  const summonMut = useMutation({
    mutationFn: (kind: 'helper' | 'dog') => battlesApi.summon(battleId!, kind),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['battle', battleId] }) },
    onError: (err) => { setActionError(err instanceof ApiError ? err.message : 'Ошибка'); setTimeout(() => setActionError(''), 4000) },
  })

  // ── Данные из liveState (Redis) и БД ──────────────────────
  const live      = battleData?.liveState
  const dbParts   = (battleData?.battle?.participants ?? []) as Array<{ characterId?: string | null; botId?: string | null; hpMax?: number; hpCurrent?: number }>
  const pPart     = live?.participants?.find((p: { characterId?: string }) => p.characterId === char?.id)
  const loadoutIds: string[] = pPart?.pocketItemIds ?? []
  const figures = companionFigures(live?.participants ?? [])
  const boardParts: LiveParticipant[] = [...(live?.participants ?? []), ...figures]
  const enemyParts = pPart ? boardParts.filter((p: LiveParticipant) => p.isAlive && p.side !== pPart.side) : []
  const ePart     = enemyParts.find((p: LiveParticipant) => p.participantId === selectedTargetId) ?? enemyParts[0]
  // Fallback на DB participants для hpMax (важно: Redis может ещё не загрузиться)
  const dbEPart   = dbParts.find(p => !!p.botId || (p.characterId && p.characterId !== char?.id))
  const pHpMax    = pPart?.hpMax ?? char?.hpMax ?? 1
  const profiles = battleData?.participantProfiles ?? []
  const playerProfile = profiles.find(profile => profile.participantId === pPart?.participantId)
  const display = battleDisplayState({ live, player: pPart, enemy: ePart, profile: playerProfile, dataUpdatedAt, action: actionSnapshot })
  const currentRound = display.round
  const currentDistance = display.distance
  const playerRange = display.range
  const pHp       = display.playerHp ?? char?.hpCurrent ?? 0
  const eHp       = display.enemyHp ?? dbEPart?.hpCurrent ?? 0
  const eHpMax    = ePart?.hpMax ?? dbEPart?.hpMax ?? 0  // 0 показывает полный бар до загрузки
  const enemyProfile = profiles.find(profile => profile.participantId === ePart?.participantId)
  const enemyName = enemyProfile?.name ?? 'Противник'

  // Победой считался только PVE_WIN: PvP и командный бой возвращают победителя
  // иначе, и победитель дуэли видел «ПОРАЖЕНИЕ».
  // Сторона — из живого состояния, а после боя из записи в базе: Redis к
  // этому моменту уже может быть очищен.
  const mySide = pPart?.side ?? battleData?.battle?.participants.find(p => p.characterId === char?.id)?.side
  const isWin = (r: RoundResult) => r.result === 'PVE_WIN' || r.result === 'PVP_WIN'
    || (!!r.winnerId && r.winnerId === char?.id)
    || (r.winnerSide != null && r.winnerSide === mySide)

  // Итог с сервера приходит тому, чей ход закрыл бой. Сопернику остаётся
  // опрос: без этого его экран застывал на последнем раунде.
  useEffect(() => {
    const battle = battleData?.battle
    if (battleOver || battle?.status !== 'FINISHED' || !char) return
    const mine = battle.participants.find(p => p.characterId === char.id)
    const winner = battle.participants.find(p => p.id === battle.winnerParticipantId)
    setBattleOver(true)
    setFinishResult({
      battleOver: true,
      winnerId: battle.winnerId ?? winner?.characterId ?? null,
      winnerSide: winner?.side ?? null,
      expGain: mine?.expGained,
    })
    localStorage.removeItem('mmo_current_battle')
    void qc.invalidateQueries({ queryKey: ['character', 'me'] })
    void qc.invalidateQueries({ queryKey: ['inventory'] })
  }, [battleData, battleOver, char, qc])

  // Только расходники из loadout (взятые до боя)
  const pocketSlots: (ItemInstance | null)[] = [0, 1, 2, 3].map(idx => {
    const id = loadoutIds[idx]
    if (!id) return null
    return items.find(i => i.id === id && i.status !== 'DELETED' && i.status !== 'CONSUMED') ?? null
  })

  // A selected destination can become occupied while the other fighter moves.
  useEffect(() => {
    if (selectedMove && live && !canSelectBattleMove(pPart, selectedMove, live.participants)) setSelectedMove(null)
  }, [live, pPart, selectedMove])

  const actionMut = useMutation({
    onMutate: async () => {
      setActionError('')
      await qc.cancelQueries({ queryKey: ['battle', battleId], exact: true })
    },
    mutationFn: ({ action, opts }: { action: BattleAction; opts?: SubmitActionOpts }) =>
      battlesApi.submitAction(battleId!, action, opts) as unknown as Promise<RoundResult>,
    onSuccess: (data, variables) => {
      if (variables.action === 'attack' || variables.action === 'block' || variables.action === 'move') {
        setStance('defense4'); setAttackZones([]); setAttackHands([]); setBlockZones([]); setSelectedMove(null)
      }
      setActionSnapshot({ ...data, receivedAt: Date.now(), targetId: variables.opts?.targetParticipantId ?? ePart?.participantId })

      // Fix 1.1: аптечка пропадает сразу после использования
      if (variables.action === 'use_item') {
        qc.invalidateQueries({ queryKey: ['inventory'] })
      }

      const events: TurnEvent[] = data.turns?.map(t => ({
        actor: t.actor === 'player' ? 'player' : t.actor === 'helper' ? 'helper' : 'enemy',
        intercepted: (t as { intercepted?: boolean }).intercepted ?? false,
        action: t.action, hit: t.hit, dodge: t.dodge, block: t.block,
        crit: t.crit, lucky: t.lucky, counterDamage: t.counterDamage, sourceHand: t.sourceHand, zone: t.zone,
        rawDamage: t.rawDamage, finalDamage: t.finalDamage, logParts: t.logParts,
      })) ?? []
      events.forEach(t => {
        // Атакующий делает выпад на любом ударе — попал или промахнулся,
        // замах есть всегда. Защищающийся вздрагивает только по попаданию.
        // Помощник не стоит на поле: его удар виден только по вздрагиванию
        // противника, а принятый им удар не ранит хозяина.
        if (t.action === 'attack' && t.actor !== 'helper') {
          if (t.actor === 'player') { setPlayerAttack(true); setTimeout(() => setPlayerAttack(false), 460) }
          else                      { setEnemyAttack(true); setTimeout(() => setEnemyAttack(false), 460) }
        }
        if (t.hit && !t.dodge && !t.intercepted) {
          if (t.actor === 'player' || t.actor === 'helper') { setEnemyHit(true); setTimeout(() => setEnemyHit(false), 500) }
          else                      { setPlayerHit(true); setTimeout(() => setPlayerHit(false), 500) }
        }
      })
      if (events.length > 0) setLastEvent(events[events.length - 1])


      if (data.battleOver) {
        setBattleOver(true); setFinishResult(data)
        localStorage.removeItem('mmo_current_battle')
        qc.invalidateQueries({ queryKey: ['character', 'me'] })
        qc.invalidateQueries({ queryKey: ['inventory'] })
      }
    },
    onError: (err, variables) => {
      if (variables.action === 'move') setSelectedMove(null)
      setActionError(err instanceof ApiError ? err.message : 'Ошибка')
      setTimeout(() => setActionError(''), 4000)
    },
    onSettled: () => {
      actionPendingRef.current = false
      // Every action (including a rejected move) must refresh the board and journal.
      void qc.invalidateQueries({ queryKey: ['battle', battleId] })
    },
  })

  const canAct = !battleOver && !actionMut.isPending
  const targetInRange = playerRange == null || currentDistance <= playerRange
  const outOfRangeHands = ([['LEFT_HAND', playerProfile?.primaryRange ?? playerRange ?? 1], ['RIGHT_HAND', playerProfile?.secondaryRange ?? 1]] as const)
    .filter(([, range]) => currentDistance > range).map(([hand]) => hand)
  const incompatibleHands: AttackHand[] = blockZones.length >= 3
    ? ['LEFT_HAND', 'RIGHT_HAND']
    : blockZones.length > 0 && attackHands.length === 1
      ? (['LEFT_HAND', 'RIGHT_HAND'] as AttackHand[]).filter(hand => hand !== attackHands[0])
      : []
  const disabledAttackHands = [...new Set<AttackHand>([...outOfRangeHands, ...incompatibleHands])]
  const act = (action: BattleAction, opts?: SubmitActionOpts) => {
    if (actionPendingRef.current) return
    actionPendingRef.current = true
    setTimeLeft(60)
    actionMut.mutate({ action, opts })
  }
  const playerName = char?.nickname ?? 'Игрок'
  const isMobile = useIsMobile()

  // ── Зональный ход: стойки и выбор зон ──────────────────
  const applyAutomaticPlan = (plan: { stance: Stance; attackZones: BodyZone[]; attackHands: AttackHand[]; blockZones: BodyZone[] }) => {
    setStance(plan.stance); setAttackZones(plan.attackZones); setAttackHands(plan.attackHands); setBlockZones(plan.blockZones); setSelectedMove(null)
  }
  const currentPlan = () => ({ stance, attackZones, attackHands, blockZones })
  const toggleAttackHand = (hand: AttackHand, zone: BodyZone) => applyAutomaticPlan(selectAutomaticAttack(currentPlan(), hand, zone))
  const toggleBlock = (zone: BodyZone, slot = 0) => applyAutomaticPlan(toggleAutomaticBlockSlot(currentPlan(), zone, slot))
  const selectMove = (position: { x: number; y: number }) => {
    setSelectedMove(position); setAttackZones([]); setAttackHands([]); setBlockZones([])
  }
  const resetPlan = () => { setStance('defense4'); setAttackZones([]); setAttackHands([]); setBlockZones([]); setSelectedMove(null) }
  const submitTurn = () => {
    const action: BattleAction = stance === 'defense4' ? 'block' : 'attack'
    act(action, {
      stance, attackZones, attackHands, blockZones,
      targetParticipantId: ePart?.participantId,
      // Переодевание уходит частью обычного хода: цену с бюджета снимает
      // сервер там же, где считает зоны.
      ...swapPlan,
    })
    setSwapPlan({})
  }
  const submitMove = () => {
    if (!selectedMove || !canSelectBattleMove(pPart, selectedMove, live?.participants ?? [])) {
      setSelectedMove(null)
      void qc.invalidateQueries({ queryKey: ['battle', battleId], exact: true })
      return
    }
    act('move', { moveTo: selectedMove })
  }

  // Сервер хранит минутный deadline и сам применяет auto-defense по таймауту.
  // Клиент только показывает авторитетное время, не отправляя конкурирующий ход.
  const [timeLeft, setTimeLeft] = useState(60)
  // Таймер хода показывается в шапке: под зонами по макету стоят только
  // две кнопки, и места под подсказку колодки там нет.
  const timerText = `${String(Math.floor(Math.max(0, timeLeft) / 60)).padStart(2, '0')}:${String(Math.max(0, timeLeft) % 60).padStart(2, '0')}`

  useEffect(() => {
    if (battleOver) return
    const fallbackDeadline = Date.now() + 60_000
    const update = () => {
      const deadline = live?.roundDeadline ?? fallbackDeadline
      setTimeLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    }
    update()
    const interval = setInterval(update, 250)
    return () => clearInterval(interval)
  }, [currentRound, battleOver, live?.roundDeadline])

  // Пауза перед итогом: досмотреть последний раунд.
  useEffect(() => {
    if (!battleOver) return
    const t = setTimeout(() => setShowResult(true), 1500)
    return () => clearTimeout(t)
  }, [battleOver])

  // Телефон: карта шире экрана и листается вбок. Своя фигура встаёт по
  // центру при открытии и после каждого своего шага; между шагами
  // прокрутку игрока не трогаем.
  const mobileFieldRef = useRef<HTMLDivElement>(null)
  const myX = pPart?.position?.x
  const myY = pPart?.position?.y
  useEffect(() => {
    if (!isMobile || myX == null) return
    const board = mobileFieldRef.current?.querySelector<HTMLElement>('.hex-board')
    const self = board?.querySelector<HTMLElement>('.token-self')
    if (!board || !self) return
    const boardBox = board.getBoundingClientRect()
    const selfBox = self.getBoundingClientRect()
    board.scrollLeft += selfBox.left + selfBox.width / 2 - (boardBox.left + boardBox.width / 2)
  }, [isMobile, myX, myY])

  if (!isValid) return null

  // ── Финальный экран ───────────────────────────────────────
  if (battleOver && finishResult && showResult) {
    const won = isWin(finishResult)
    // Откуда пришли в бой: адрес боя в места не записывается, поэтому
    // последняя сохранённая локация — та, с которой игрок зашёл в бой
    // (правка заказчика: «после боя кнопка перехода на локацию, с которой
    // игрок в бой зашёл»).
    const origin = cameFrom.data?.path ?? '/'
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
            {(finishResult.levelsGained ?? 0) > 0 && (finishResult.newLevel ?? 0) > 1 && (
              <div className="brv2-levelup">НОВЫЙ УРОВЕНЬ {finishResult.newLevel}</div>
            )}
            <div className="brv2-actions">
              <button className="btn btn-primary" onClick={() => navigate(origin)}>
                Вернуться: {origin === '/' ? 'Центр' : locationLabel(origin)}
              </button>
              <button className="btn" onClick={() => navigate('/profile')}>Профиль</button>
              <button className="btn btn-gold"    onClick={() => navigate('/repair')}>Ремонт</button>
              <button className="btn btn-danger"  onClick={() => navigate('/pvp')}>Ещё раз</button>
            </div>
          </div>

          {/* Журнал боя на экране итога — с сервера: сохраняется и листается
              по 10 строк (правка заказчика 20.10). */}
          {battleId && (
            <div className="battle-log-v2" style={{ marginTop: 8 }}>
              <div className="log-toggle-v2" style={{ cursor: 'default' }}>
                <ChevronDown size={12} />
                <span>Журнал боя</span>
              </div>
              <div className="log-body-v2"><BattleJournal battleId={battleId} refreshKey={currentRound} /></div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Общие части обоих экранов: план хода и поле с клетками ──
  const budget = getActionBudget(stance)
  const validation = validateTurnPlan({ stance, attackZones, attackHands, blockZones, targetParticipantId: ePart?.participantId, targetInRange, selectedMove })
  const ready = !!selectedMove || validation.valid
  const planEmpty = attackZones.length === 0 && blockZones.length === 0 && !selectedMove
  // Помощник и собака: вызов на поле, здоровье, тактика помощника.
  // В дуэли их нет — дуэль один на один.
  const canSummon = canAct && live?.type !== 'PVP_DUEL' && !!pPart?.isAlive
  const companionsBlock = <>
    {pPart?.helper && <div className="battle-companion">
      <BattleHelperBadge helper={pPart.helper} pending={helperTacticMut.isPending}
        onTactic={tactic => helperTacticMut.mutate(tactic)} />
      {!pPart.helper.summoned && pPart.helper.alive && (
        <button type="button" className="battle-summon" disabled={!canSummon || summonMut.isPending}
          onClick={() => summonMut.mutate('helper')}>Вызвать помощника</button>
      )}
    </div>}
    {pPart?.dog && <div className={'battle-dog' + (pPart.dog.alive ? '' : ' is-down')} aria-label="Собака в бою">
      <span><b>{pPart.dog.name}</b> ур. {pPart.dog.level}</span>
      <span>{pPart.dog.alive ? `${pPart.dog.hp}/${pPart.dog.hpMax} HP` : 'выбита'}{pPart.dog.damageDealt > 0 ? ` · укусила на ${pPart.dog.damageDealt}` : ''}</span>
      {!pPart.dog.summoned && pPart.dog.alive && (
        <button type="button" className="battle-summon" disabled={!canSummon || summonMut.isPending}
          onClick={() => summonMut.mutate('dog')}>Вызвать собаку</button>
      )}
    </div>}
  </>

  const grid = <BattleGrid playerName={playerName} enemyName={enemyName}
    playerDefeated={false} enemyDefeated={false}
    playerHit={playerHit} enemyHit={enemyHit}
    playerAttack={playerAttack} enemyAttack={enemyAttack} lastEvent={lastEvent}
    distance={currentDistance} playerPosition={pPart?.position}
    enemyPosition={ePart?.position} selectedMove={selectedMove} onSelectMove={selectMove}
    participants={boardParts} playerParticipantId={pPart?.participantId} arena={live?.arena} obstacles={live?.obstacles}
    playerSide={pPart?.side} selectedTargetId={ePart?.participantId}
    onSelectTarget={setSelectedTargetId} range={playerRange ?? undefined}
    playerHp={pHp} enemyHp={ePart ? eHp : undefined}
    names={Object.fromEntries([
      ...profiles.map(profile => [profile.participantId, profile.name]),
      ...(live?.participants ?? []).flatMap((p: LiveParticipant) => [
        ...(p.helper ? [[`helper:${p.participantId}`, `${p.helper.name} (помощник)`]] : []),
        ...(p.dog ? [[`dog:${p.participantId}`, `${p.dog.name} (собака)`]] : []),
      ]),
    ])} />

  // ── Телефон: тот же новый бой потоковой композицией (правка 23.10:
  //    «на моб версии бой старый»). Блоки те же, что на сцене у
  //    компьютера, — поле, списки зон, кнопки-плашки и хроника, — но
  //    колонкой, в бумажной палитре городской оболочки. ──
  if (isMobile) {
    return (
      <div className="m-battle">
        <header className="m-battle__head">
          <span className="m-battle__title"><Sword size={13} /><b>Бой</b></span>
          <span className="battle-desk__timer">{timerText}</span>
          <b className="m-battle__round">Раунд {currentRound} / 30</b>
          <span className={'m-battle__status' + (actionMut.isPending ? ' is-pending' : '')}>
            {actionMut.isPending ? 'Ход отправляется…' : pPart?.hasActedThisRound ? 'Ждём противника' : 'Ваш ход'}
          </span>
          <span className="m-battle__tools">
            <button type="button" aria-label="Боевой карман" title="Боевой карман" aria-expanded={pocketsOpen}
              onClick={() => { setShowLog(false); setPocketsOpen(value => !value) }}>
              <Backpack size={13} />{pocketSlots.filter(Boolean).length > 0 && <i>{pocketSlots.filter(Boolean).length}</i>}
            </button>
            <button type="button" className="is-surrender" aria-label="Сдаться" title="Сдаться" disabled={!canAct} onClick={() => act('surrender')}>
              <Flag size={13} />
            </button>
          </span>
        </header>

        {/* Свои и чужие жизни — одной строкой: на телефоне места под
            карточки-вырезы нет, а здоровье в бою главное. */}
        <div className="m-battle__fighters">
          <div className="m-battle__fighter">
            <span className="m-battle__name"><span className="m-battle__who">{playerName} · {char?.battleLevel ?? 0} ур.</span><b className="m-battle__hpnum">{pHp}/{pHpMax}</b></span>
            <span className="m-battle__hp"><i style={{ transform: `scaleX(${pHpMax ? pHp / pHpMax : 0})` }} /></span>
          </div>
          <div className="m-battle__fighter is-enemy">
            <span className="m-battle__name"><span className="m-battle__who">{enemyName} · {enemyProfile?.level ?? 0} ур.</span><b className="m-battle__hpnum">{eHp}/{eHpMax}</b></span>
            <span className="m-battle__hp is-enemy"><i style={{ transform: `scaleX(${eHpMax ? eHp / eHpMax : 0})` }} /></span>
          </div>
        </div>

        <div className="m-battle__field" ref={mobileFieldRef}>
          <div className="battle-field-v3">
            {grid}
            <div className="battle-field-v3__meta battle-desk__meta">
              <span>Дистанция: <b>{currentDistance}</b></span>
              <span>Дальность: <b>{playerRange ?? '—'}</b></span>
              <span className={'battle-desk__plan' + (ready ? ' is-ready' : '')}>
                {selectedMove ? 'Выбран шаг' : validation.valid ? 'Ход готов' : validation.reason}
              </span>
              <span className="m-battle__buttons">
                <button type="button" disabled={planEmpty} onClick={resetPlan}>Сбросить</button>
                <button type="button" className="is-apply battle-submit-turn" disabled={!canAct || !ready || actionMut.isPending}
                  onClick={selectedMove ? submitMove : submitTurn}>
                  {actionMut.isPending ? 'Отправляем…' : selectedMove ? 'Перейти' : 'Применить'}
                </button>
              </span>
            </div>
          </div>
        </div>

        <div className="m-battle__zones">
          <BattleZoneList mode="block" title="Блок" selected={blockZones}
            limit={attackHands.length > 0 ? 2 : 4} disabled={!canAct || attackHands.length === 2}
            wounds={pPart?.wounds} onZone={toggleBlock} />
          <BattleZoneList mode="attack" title="Удар" selected={attackZones}
            selectedHands={attackHands} limit={blockZones.length > 0 ? 1 : 2}
            disabled={!canAct || !ePart?.participantId} disabledHands={disabledAttackHands}
            note={disabledAttackHands.length === 2 && outOfRangeHands.length > 0 ? 'Цель дальше, чем бьёт оружие' : undefined}
            wounds={ePart?.wounds} onHandZone={toggleAttackHand} />
        </div>

        <div className="m-battle__companions">
          {companionsBlock}
        </div>

        {battleId && <div className="m-battle__log">
          <PersistedBattleChronicle battleId={battleId} refreshKey={currentRound}
            playerSide={pPart?.side} onOpenLog={() => { setPocketsOpen(false); setShowLog(true) }} />
        </div>}

        {actionError && <div className="battle-error-v3" role="alert"><AlertTriangle size={13} /> {actionError}</div>}
        {(showLog || pocketsOpen) && <aside className="battle-drawer" aria-label={showLog ? 'Лог боя' : 'Боевой карман'}>
          <button type="button" className="battle-drawer__scrim" aria-label="Закрыть" onClick={() => { setShowLog(false); setPocketsOpen(false) }} />
          <section>
            <header><b>{showLog ? 'Лог боя' : 'Боевой карман'}</b><button type="button" onClick={() => { setShowLog(false); setPocketsOpen(false) }}>Закрыть</button></header>
            {showLog ? <div className="log-body-v2">
              {battleId && <BattleJournal battleId={battleId} refreshKey={currentRound} />}
            </div> : <>
              <BattlePockets slots={pocketSlots} canAct={canAct} open
                onOpenChange={setPocketsOpen} onUse={(id) => act('use_item', { itemInstanceId: id })} />
              <BattleSwap inventory={items} plan={swapPlan} canAct={canAct} open onChange={setSwapPlan} />
            </>}
          </section>
        </aside>}
      </div>
    )
  }

  // ── Компьютер: бой на сцене города (правка заказчика 22.10) ──
  return (
      <BattleDesk
        playerWounds={pPart?.wounds ?? {}}
        playerHp={pPart ? { hp: pHp, hpMax: pHpMax } : undefined}
        enemyWounds={ePart?.wounds ?? {}}
        enemyTag={enemyParts.length > 1 ? 'Цель' : undefined}
        enemy={{
          nickname: enemyName, level: enemyProfile?.level ?? 0,
          hp: eHp, hpMax: eHpMax,
          avatar: enemyProfile?.avatar,
          gender: enemyProfile?.gender,
          weaponName: enemyProfile?.primaryHand,
          weaponCode: enemyProfile?.primaryWeaponCode,
          weaponType: enemyProfile?.primaryWeaponType,
          offhandName: enemyProfile?.secondaryHand,
          offhandCode: enemyProfile?.secondaryWeaponCode,
        }}
        header={<header className="battle-desk__head">
          <Sword size={15} /><b>Бой</b>
          <span className="battle-desk__timer" title="Время на ход">{timerText}</span>
          <b>Раунд {currentRound} / 30</b>
          <span>{playerName} {pHp}/{pHpMax} · {enemyName} {eHp}/{eHpMax}</span>
          <span className={'battle-desk__status' + (actionMut.isPending ? ' is-pending' : '')}>
            {actionMut.isPending ? 'Ход отправляется…' : pPart?.hasActedThisRound ? 'Ждём противника' : 'Ваш ход'}
          </span>
          <span className="battle-desk__tools">
            <button type="button" onClick={() => { setShowLog(false); setPocketsOpen(value => !value) }}>
              <Backpack size={13} /> Карман {pocketSlots.filter(Boolean).length}
            </button>
            <button type="button" onClick={() => { setPocketsOpen(false); setShowLog(value => !value) }}>Весь лог</button>
            <button type="button" className="is-surrender" disabled={!canAct} onClick={() => act('surrender')}>
              <Flag size={13} /> Сдаться
            </button>
          </span>
        </header>}
        field={<div className="battle-field-v3">
          {grid}
          {/* Кнопки хода — в полосе под полем, прямо над зонами (правка
              заказчика 22.10: «кнопки Применить и Сбросить сюда перенести»). */}
          <div className="battle-field-v3__meta battle-desk__meta">
            <span>Дистанция: <b>{currentDistance}</b></span>
            <span title="Сколько клеток достаёт оружие; у дальнобойного они подсвечены голубым">Дальность: <b>{playerRange ?? '—'}</b></span>
            <span className={'battle-desk__plan' + (ready ? ' is-ready' : '')}>
              {selectedMove ? 'Выбран шаг' : validation.valid ? 'Ход готов' : validation.reason} · {budget.attacks} уд. / {budget.blocks} бл.
            </span>
            <span className="battle-desk__buttons">
              <button type="button" disabled={planEmpty} onClick={resetPlan}>Сбросить</button>
              <button type="button" className="is-apply battle-submit-turn" disabled={!canAct || !ready || actionMut.isPending}
                onClick={selectedMove ? submitMove : submitTurn}>
                {actionMut.isPending ? 'Отправляем…' : selectedMove ? 'Перейти' : 'Применить'}
              </button>
            </span>
          </div>
        </div>}
        blockZones={<BattleZoneList mode="block" title="Блок" selected={blockZones}
          limit={attackHands.length > 0 ? 2 : 4} disabled={!canAct || attackHands.length === 2}
          wounds={pPart?.wounds} onZone={toggleBlock} />}
        attackZones={<BattleZoneList mode="attack" title="Удар" selected={attackZones}
          selectedHands={attackHands} limit={blockZones.length > 0 ? 1 : 2}
          disabled={!canAct || !ePart?.participantId} disabledHands={disabledAttackHands}
          note={disabledAttackHands.length === 2 && outOfRangeHands.length > 0 ? 'Цель дальше, чем бьёт оружие' : undefined}
          wounds={ePart?.wounds} onHandZone={toggleAttackHand} />}
        log={battleId ? <PersistedBattleChronicle battleId={battleId} refreshKey={currentRound}
          playerSide={pPart?.side} onOpenLog={() => { setPocketsOpen(false); setShowLog(true) }} /> : null}
        actions={<>
          <div className="battle-desk__companions">
            {companionsBlock}
          </div>
        </>}
        overlay={<>
          {actionError && <div className="battle-error-v3" role="alert"><AlertTriangle size={13} /> {actionError}</div>}
          {(showLog || pocketsOpen) && <aside className="battle-drawer" aria-label={showLog ? 'Лог боя' : 'Боевой карман'}>
            <button type="button" className="battle-drawer__scrim" aria-label="Закрыть" onClick={() => { setShowLog(false); setPocketsOpen(false) }} />
            <section>
              <header><b>{showLog ? 'Лог боя' : 'Боевой карман'}</b><button type="button" onClick={() => { setShowLog(false); setPocketsOpen(false) }}>Закрыть</button></header>
              {showLog ? <div className="log-body-v2">
                {battleId && <BattleJournal battleId={battleId} refreshKey={currentRound} />}
              </div> : <>
                <BattlePockets slots={pocketSlots} canAct={canAct} open
                  onOpenChange={setPocketsOpen} onUse={(id) => act('use_item', { itemInstanceId: id })} />
                <BattleSwap inventory={items} plan={swapPlan} canAct={canAct} open onChange={setSwapPlan} />
              </>}
            </section>
          </aside>}
        </>}
      />
    )
}