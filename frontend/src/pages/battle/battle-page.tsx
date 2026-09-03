import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useEffect, useRef, type CSSProperties } from 'react'
import {
  Sword, Heart, RotateCcw, ChevronDown, Skull,
  CircleDot, Trophy, AlertTriangle, Backpack, Flag,
} from 'lucide-react'
import { battlesApi, type AttackHand, type BodyZone, type Stance, type SubmitActionOpts } from '../../shared/api/battles.api'
import { inventoryApi } from '../../shared/api/inventory.api'
import { type BattleAction, type ItemInstance, type LiveParticipant } from '../../shared/types/api.types'
import { ApiError } from '../../shared/api/client'
import { charactersApi } from '../../shared/api/characters.api'
import { isNeighbour, GRID_COLS, GRID_ROWS } from '../../shared/lib/hex'
import { DESIGNER_BATTLE_CELLS } from '../../shared/lib/designer-battle-grid'
import battleField from '../../shared/assets/battle/battle-field.webp'
import battleField2x from '../../shared/assets/battle/battle-field@2x.webp'
import fighterBlue from '../../shared/assets/battle/fighter-blue.webp'
import fighterBlue2x from '../../shared/assets/battle/fighter-blue@2x.webp'
import fighterRed from '../../shared/assets/battle/fighter-red.webp'
import fighterRed2x from '../../shared/assets/battle/fighter-red@2x.webp'
import { BattleFighterPanel } from './components/battle-fighter-panel'
import { BattleChat, CHAT_SCENE_TOP } from './components/battle-chat'
import { CardCutout } from '../../widgets/character-card/card-cutout'
import { NavCutout } from '../../widgets/city-nav/nav-cutout'
import { MENU, MENU_STAGE } from '../../shared/lib/layout-map'
import { PLATES } from '../../shared/ui/sprite'
import { useViewportSize } from '../../shared/lib/stage'
import { BattleCommandDock } from './components/battle-command-dock'
import { EventIcon, getEvent, type RoundRecord, type TurnEvent } from './components/battle-events'
import { BattlePockets } from './components/battle-pockets'
import { removeAutomaticAttack, selectAutomaticAttack, toggleAutomaticBlockSlot } from './battle-view-model'
import './battle-phase-a.css'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOADOUT_KEY = 'mmo_battle_loadout'

function getLoadout(): string[] {
  try { return JSON.parse(localStorage.getItem(LOADOUT_KEY) ?? '[]') } catch { return [] }
}

interface RoundResult {
  roundNumber?: number; playerHp?: number; botHp?: number; battleOver?: boolean
  result?: string; expGain?: number; weaponExpGain?: number; moneyReward?: number
  newLevel?: number; waiting?: boolean; turns?: TurnEvent[]
  botStance?: Stance; botAttackZones?: BodyZone[]; botBlockZones?: BodyZone[]
  distance?: number; playerRange?: number
  /** PvP: шаг применён сервером сразу, не дожидаясь хода противника. */
  moved?: boolean; position?: { x: number; y: number }
}

// Tactical field
const PLAYER_COL = 1

function BattleGrid({
  playerName, enemyName,
  playerHit, enemyHit, lastEvent,
  playerPosition, selectedMove, onSelectMove,
  participants, playerParticipantId, playerSide, selectedTargetId, onSelectTarget,
}: {
  playerName: string
  enemyName: string
  playerDefeated: boolean; enemyDefeated: boolean
  playerHit: boolean; enemyHit: boolean; lastEvent: TurnEvent | null
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
            // подсветка хода — по тем же правилам соседства, что у сервера
            const canMove = isNeighbour(playerCell, cell) && !occupant
            const isSelected = selectedMove?.x === col && selectedMove?.y === row
            const isTarget = isEnemy && occupant?.participantId === selectedTargetId
            const clickable = canMove || (isEnemy && !!occupant)
            return (
              <div
                key={`${row}-${col}`}
                className={'hex-cell'
                  + ((isPlayer || isAlly) ? ' is-player' : '')
                  + (isEnemy ? ' is-enemy' : '')
                  + (isCenter ? ' is-center' : '')
                  + (canMove ? ' is-movable' : '')
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
                {(isPlayer || isAlly) && occupant && (
                  <div style={fighterStyle} className={`fighter-token token-player ${isPlayer && playerHit ? 'token-hit' : ''} ${!occupant.isAlive ? 'token-dead' : ''}`}>
                    {!occupant.isAlive ? <Skull size={16} /> : <img src={fighterBlue} srcSet={`${fighterBlue2x} 2x`} alt="" />}
                    <span className="token-label">{isPlayer ? playerName.slice(0, 5) : 'Союзн.'}</span>
                  </div>
                )}
                {isEnemy && occupant && (
                  <div style={fighterStyle} className={`fighter-token token-enemy ${isTarget && enemyHit ? 'token-hit' : ''} ${!occupant.isAlive ? 'token-dead' : ''}`}>
                    {!occupant.isAlive ? <Skull size={16} /> : <img src={fighterRed} srcSet={`${fighterRed2x} 2x`} alt="" />}
                    <span className="token-label">{isTarget ? enemyName.slice(0, 5) : 'Враг'}</span>
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

// ══ ГЛАВНЫЙ КОМПОНЕНТ ═════════════════════════════════════════
export function BattlePage() {
  const { id: battleId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [rounds, setRounds]             = useState<RoundRecord[]>([])
  const [playerHp, setPlayerHp]         = useState<number | null>(null)
  const [enemyHp, setEnemyHp]           = useState<number | null>(null)
  const [currentRound, setCurrentRound] = useState(1)
  const [battleOver, setBattleOver]     = useState(false)
  const [finishResult, setFinishResult] = useState<RoundResult | null>(null)
  const [actionError, setActionError]   = useState('')
  const [showLog, setShowLog]           = useState(false)
  const [pocketsOpen, setPocketsOpen]   = useState(false)
  // Чат закрыт по умолчанию: так сцена короче и всё на экране крупнее.
  const [chatOpen, setChatOpen]         = useState(false)
  // ── Раскладка экрана ───────────────────────────────────
  // Экран боя собран из трёх частей: шапка города сверху, карточки
  // бойцов по краям и сцена макета посередине. Каждой нужен свой
  // расчёт от габаритов окна, поэтому берём сами габариты, а не
  // готовый коэффициент.
  const view = useViewportSize()
  const sceneH = chatOpen ? 1600 : CHAT_SCENE_TOP
  // Шапка — вырез полосы меню во всю ширину окна. Она масштабируется
  // вместе со сценой города, поэтому на узком экране сжимается до
  // нечитаемой полоски в несколько пикселей: ниже 1000 не показываем
  // её вовсе, как и раньше на телефоне её тут не было.
  const showNav = view.w >= 1000
  const navH = showNav ? view.w * MENU.navStrip.h / MENU.navStrip.w : 0
  // Порядок расчёта важен, иначе он зациклится: ширина карточек зависит
  // от ширины сцены, а ширина сцены — от того, сколько осталось после
  // карточек. Разрываем так: сцена берёт своё по ВЫСОТЕ (для вертикального
  // макета на горизонтальном экране это и есть настоящее ограничение),
  // а карточки делят остаток ширины.
  const sceneGap = 10
  const freeH = view.h - navH
  // Сцена макета — 900x1600. Свёрнутый чат обрезает её по своему верху,
  // и та же сцена помещается в окно крупнее. Верхняя граница 1:
  // увеличивать сверх исходного размера нечего, ассеты нарезаны под него.
  const sceneScaleByHeight = Math.min(freeH / sceneH, 1)
  const freeHalf = (view.w - 900 * sceneScaleByHeight) / 2 - 2 * sceneGap
  // Ниже 1080 и уже 240 px на карточку поля нет: она бы смялась.
  const showCards = view.w > 1080 && freeHalf >= 240
  // Карточка растёт, пока есть место, но не выше свободной высоты и не
  // крупнее полутора своих размеров — дальше портрет начинает мылиться.
  const cardW = showCards
    ? Math.min(freeHalf, freeH * MENU.card.cutout.w / MENU.card.cutout.h, MENU.card.cutout.w * 1.5)
    : 0
  const sceneScale = showCards
    ? sceneScaleByHeight
    : Math.min(sceneScaleByHeight, (view.w - 2 * sceneGap) / 900)
  const platePicture = `-webkit-image-set(url("${PLATES['menu-plate@2x']}") 2x, url("${PLATES['menu-plate']}") 1x)`
  const actionPendingRef = useRef(false)
  const [playerHit, setPlayerHit]       = useState(false)
  const [enemyHit, setEnemyHit]         = useState(false)
  const [lastEvent, setLastEvent]       = useState<TurnEvent | null>(null)
  // loadout IDs читается при mount и не меняется в течение боя
  const [loadoutIds] = useState<string[]>(() => getLoadout())

  // ── Зональный ход ──────────────────────────────────────
  const [stance, setStance]             = useState<Stance>('defense4')
  const [attackZones, setAttackZones]   = useState<BodyZone[]>([])
  const [attackHands, setAttackHands]   = useState<AttackHand[]>([])
  const [blockZones, setBlockZones]     = useState<BodyZone[]>([])
  const [distance, setDistance]         = useState<number | null>(null)
  const [playerRange, setPlayerRange]   = useState<number | null>(null)
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
  const enemyParts = pPart ? (live?.participants ?? []).filter((p: LiveParticipant) => p.isAlive && p.side !== pPart.side) : []
  const ePart     = enemyParts.find((p: LiveParticipant) => p.participantId === selectedTargetId) ?? enemyParts[0]
  // Fallback на DB participants для hpMax (важно: Redis может ещё не загрузиться)
  const dbEPart   = dbParts.find(p => !!p.botId || (p.characterId && p.characterId !== char?.id))
  const pHp       = playerHp ?? pPart?.hpCurrent ?? char?.hpCurrent ?? 0
  const pHpMax    = pPart?.hpMax ?? char?.hpMax ?? 1
  const eHp       = enemyHp ?? ePart?.hpCurrent ?? dbEPart?.hpCurrent ?? 0
  const eHpMax    = ePart?.hpMax ?? dbEPart?.hpMax ?? 0  // 0 показывает полный бар до загрузки
  const weapon    = items.find(i => i.isEquipped && i.template.type === 'WEAPON')
  const profiles = battleData?.participantProfiles ?? []
  const playerProfile = profiles.find(profile => profile.participantId === pPart?.participantId)
  const enemyProfile = profiles.find(profile => profile.participantId === ePart?.participantId)
  const enemyName = enemyProfile?.name ?? 'Противник'

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
      if (variables.action === 'attack' || variables.action === 'block' || variables.action === 'move') {
        setStance('defense4'); setAttackZones([]); setAttackHands([]); setBlockZones([]); setSelectedMove(null)
      }
      const rn = data.roundNumber ?? currentRound
      setCurrentRound(rn)
      if (data.playerHp != null) setPlayerHp(data.playerHp)
      if (data.botHp    != null) setEnemyHp(data.botHp)
      if (data.distance != null) setDistance(data.distance)
      if (data.playerRange != null) setPlayerRange(data.playerRange)

      // Fix 1.1: аптечка пропадает сразу после использования
      if (variables.action === 'use_item') {
        qc.invalidateQueries({ queryKey: ['inventory'] })
      }

      // Шаг сервер применяет немедленно, но позиции на поле приходят из
      // опроса раз в три секунды. Дёргаем его сразу, иначе своя же фигура
      // доезжает до новой клетки с задержкой, и шаг перестаёт читаться
      // как ход.
      if (data.moved) {
        qc.invalidateQueries({ queryKey: ['battle', battleId] })
      }

      const events: TurnEvent[] = data.turns?.map(t => ({
        actor: t.actor === 'player' ? 'player' : 'enemy',
        action: t.action, hit: t.hit, dodge: t.dodge, block: t.block,
        crit: t.crit, lucky: t.lucky, counterDamage: t.counterDamage, sourceHand: t.sourceHand, zone: t.zone,
        rawDamage: t.rawDamage, finalDamage: t.finalDamage, logParts: t.logParts,
      })) ?? []
      events.forEach(t => {
        if (t.hit && !t.dodge) {
          if (t.actor === 'player') { setEnemyHit(true); setTimeout(() => setEnemyHit(false), 500) }
          else                      { setPlayerHit(true); setTimeout(() => setPlayerHit(false), 500) }
        }
      })
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
    onSettled: () => { actionPendingRef.current = false },
  })

  const canAct = !battleOver && !actionMut.isPending
  const currentDistance = distance ?? live?.distance ?? 0
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

  // ── Зональный ход: стойки и выбор зон ──────────────────
  const applyAutomaticPlan = (plan: { stance: Stance; attackZones: BodyZone[]; attackHands: AttackHand[]; blockZones: BodyZone[] }) => {
    setStance(plan.stance); setAttackZones(plan.attackZones); setAttackHands(plan.attackHands); setBlockZones(plan.blockZones); setSelectedMove(null)
  }
  const currentPlan = () => ({ stance, attackZones, attackHands, blockZones })
  const toggleAttackHand = (hand: AttackHand, zone: BodyZone) => applyAutomaticPlan(selectAutomaticAttack(currentPlan(), hand, zone))
  const removeAttack = (index: number) => applyAutomaticPlan(removeAutomaticAttack(currentPlan(), index))
  const toggleBlock = (zone: BodyZone, slot = 0) => applyAutomaticPlan(toggleAutomaticBlockSlot(currentPlan(), zone, slot))
  const selectMove = (position: { x: number; y: number }) => {
    setSelectedMove(position); setAttackZones([]); setAttackHands([]); setBlockZones([])
  }
  const resetPlan = () => { setStance('defense4'); setAttackZones([]); setAttackHands([]); setBlockZones([]); setSelectedMove(null) }
  const submitTurn = () => {
    const action: BattleAction = stance === 'defense4' ? 'block' : 'attack'
    act(action, { stance, attackZones, attackHands, blockZones, targetParticipantId: ePart?.participantId })
  }
  const submitMove = () => {
    if (!selectedMove) return
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
    <div className="battle-page-v3">
    {/* Сцена боя — фиксированная композиция макета «Профиль игрока
        Боевка.psd»: холст 1800x3200, сцена вдвое меньше. Вписывается
        в окно целиком, по краям остаётся поле; прокрутки нет ни на
        десктопе, ни на телефоне.

        Свёрнутый чат укорачивает сцену до 1312 — до его собственного
        верха. Высота меньше, значит масштаб больше: на 1440x900 сцена
        растёт с 506 до 617 px по ширине. Это и есть «больше места»,
        которое даёт сворачивание. */}
    {/* Поле по краям сцены — та же размытая плашка, что подстилает
        главный экран. Плоская тёмная заливка, стоявшая тут раньше,
        и делала бой не похожим на остальную игру: в городе пустое
        место — это продолжение рисунка, а не провал. */}
    <div className="stage-backdrop" aria-hidden="true" style={{ backgroundImage: platePicture }} />

    {/* Шапка города — вырез той же полосы меню из той же подложки.
        Без неё из боя некуда выйти, и экран читался как кусок другой
        игры: в городе шапка есть везде. */}
    {showNav && <NavCutout width={view.w} />}

    <div className="battle-page-v3__body">

    {/* Свой профиль слева, чужой справа — та самая карточка «личное
        дело» с главного экрана, вырезанная окном из общей псд-бумаги.
        Занимают поле, которое иначе простаивает: сцена вертикальная,
        экран горизонтальный.

        Данные отдаём готовыми, а не даём карточке сходить в свои
        запросы: в бою здоровье меняется каждый ход, и /characters/me
        с его обновлением раз в полминуты показывал бы вчерашнее. */}
    {showCards && <CardCutout width={cardW} profile={{
      nickname: playerName, level: char?.battleLevel ?? 0,
      hp: pHp, hpMax: pHpMax,
      avatar: playerProfile?.avatar ?? char?.avatar,
      weaponName: playerProfile?.primaryHand ?? weapon?.template.name,
      weaponCode: playerProfile?.primaryWeaponCode ?? weapon?.template.code,
      weaponType: playerProfile?.primaryWeaponType ?? weapon?.template.weaponType,
      offhandName: playerProfile?.secondaryHand,
      offhandCode: playerProfile?.secondaryWeaponCode,
    }} />}

    <div className="battle-mockup-scene-holder"
      style={{ width: 900 * sceneScale, height: (chatOpen ? 1600 : CHAT_SCENE_TOP) * sceneScale }}>
    <div className="battle-mockup-scene"
      style={{ height: chatOpen ? 1600 : CHAT_SCENE_TOP, transform: `scale(${sceneScale})` }}>
      <header className="battle-header-v3">
        <div><Sword size={13} /><b>Бой</b><b className="battle-header-timer">{timerText}</b></div>
        <strong>Раунд {currentRound} / 30</strong>
        <span className={actionMut.isPending ? 'is-pending' : 'is-ready'}>
          {actionMut.isPending ? <><RotateCcw size={11} className="spin" /> Ход отправляется</> : <><CircleDot size={9} /> Ваш ход</>}
          {/* Карман, сдача и таймер в макете не нарисованы, а деть их
              некуда: под зонами по макету стоят только «Закрыть» и
              «Применить». Поэтому они живут в шапке — она и так лежит
              поверх карты, вне композиции макета. Раньше здесь стояло
              условие isMobile, и на десктопе карман со сдачей пропадали
              совсем: компактная колодка их не рисует. */}
          <span className="battle-header-tools">
            <button type="button" aria-label="Боевой карман" title="Боевой карман"
              onClick={() => setPocketsOpen(value => !value)}>
              <Backpack size={13} />{pocketSlots.filter(Boolean).length > 0 && <i>{pocketSlots.filter(Boolean).length}</i>}
            </button>
            <button type="button" className="is-surrender" aria-label="Сдаться" title="Сдаться"
              disabled={!canAct} onClick={() => act('surrender')}>
              <Flag size={13} />
            </button>
          </span>
        </span>
      </header>

      <main className="battle-duel-stage">
        <BattleFighterPanel side="self" name={playerName} level={char?.battleLevel}
          avatar={playerProfile?.avatar ?? char?.avatar}
          hp={pHp} hpMax={pHpMax} mode="block" selected={blockZones} limit={attackHands.length > 0 ? 2 : 4}
          disabled={!canAct || attackHands.length === 2}
          primaryHand={playerProfile?.primaryHand ?? weapon?.template.name} secondaryHand={playerProfile?.secondaryHand}
          primaryWeaponCode={playerProfile?.primaryWeaponCode ?? weapon?.template.code}
          secondaryWeaponCode={playerProfile?.secondaryWeaponCode}
          primaryWeaponType={playerProfile?.primaryWeaponType ?? weapon?.template.weaponType}
          secondaryWeaponType={playerProfile?.secondaryWeaponType}
          onZone={toggleBlock} />

        <div className="battle-field-v3">
          <BattleGrid playerName={playerName} enemyName={enemyName}
            playerDefeated={false} enemyDefeated={false}
            playerHit={playerHit} enemyHit={enemyHit} lastEvent={lastEvent}
            distance={distance ?? live?.distance ?? undefined} playerPosition={pPart?.position}
            enemyPosition={ePart?.position} selectedMove={selectedMove} onSelectMove={selectMove}
            participants={live?.participants} playerParticipantId={pPart?.participantId}
            playerSide={pPart?.side} selectedTargetId={ePart?.participantId}
            onSelectTarget={setSelectedTargetId} />
          {/* Хроника живёт только в нижней панели, как рисует макет.
              Раньше на десктопе она создавалась ещё и здесь, под полем,
              и после перехода на общую сцену показалась бы дважды. */}
          <div className="battle-field-v3__meta">
            <span>Дистанция: <b>{currentDistance}</b></span><span>Дальность: <b>{playerRange ?? '—'}</b></span>
          </div>
        </div>

        <BattleFighterPanel side="enemy" name={enemyName} level={enemyProfile?.level}
          avatar={enemyProfile?.avatar}
          hp={eHp} hpMax={eHpMax} mode="attack" selected={attackZones} selectedHands={attackHands} limit={blockZones.length > 0 ? 1 : 2}
          disabled={!canAct || !ePart?.participantId}
          disabledHands={disabledAttackHands}
          disabledReason={disabledAttackHands.length === 2 ? 'Цель вне дальности' : undefined}
          primaryHand={enemyProfile?.primaryHand} secondaryHand={enemyProfile?.secondaryHand}
          primaryWeaponCode={enemyProfile?.primaryWeaponCode} secondaryWeaponCode={enemyProfile?.secondaryWeaponCode}
          primaryWeaponType={enemyProfile?.primaryWeaponType} secondaryWeaponType={enemyProfile?.secondaryWeaponType}
          onZone={() => undefined} onHandZone={toggleAttackHand} />
      </main>

      {/* Колодка всегда компактная: сцена одна и та же на любом экране,
          и кнопки в ней — те, что нарисованы в макете. */}
      <BattleCommandDock stance={stance} attackZones={attackZones} attackHands={attackHands} blockZones={blockZones}
        selectedMove={selectedMove} targetId={ePart?.participantId} targetInRange={targetInRange}
        canAct={canAct} pending={actionMut.isPending} timeLeft={timeLeft}
        roundsCount={rounds.length} pocketCount={pocketSlots.filter(Boolean).length}
        compact rounds={rounds} playerName={playerName} enemyName={enemyName}
        onRemoveAttack={removeAttack}
        onSubmitTurn={submitTurn} onSubmitMove={submitMove} onReset={resetPlan}
        onToggleLog={() => setShowLog(value => !value)} onTogglePockets={() => setPocketsOpen(value => !value)}
        onSurrender={() => act('surrender')} />

      <BattleChat open={chatOpen} onToggle={() => setChatOpen(value => !value)} />
    </div>
    </div>

    {showCards && <CardCutout width={cardW} className="is-enemy" profile={{
      nickname: enemyName, level: enemyProfile?.level ?? 0,
      hp: eHp, hpMax: eHpMax,
      avatar: enemyProfile?.avatar,
      weaponName: enemyProfile?.primaryHand,
      weaponCode: enemyProfile?.primaryWeaponCode,
      weaponType: enemyProfile?.primaryWeaponType,
      offhandName: enemyProfile?.secondaryHand,
      offhandCode: enemyProfile?.secondaryWeaponCode,
    }} />}

    </div>

      {/* Сообщение об ошибке и выдвижные панели живут ВНЕ сцены.
          Внутри они масштабировались бы вместе с ней: на телефоне
          сцена ужимается до 0.42, и текст лога стал бы нечитаемым.
          К макету они не относятся — это служебные наложения. */}
      {actionError && <div className="battle-error-v3" role="alert"><AlertTriangle size={13} /> {actionError}</div>}

      {(showLog || pocketsOpen) && <aside className="battle-drawer" aria-label={showLog ? 'Лог боя' : 'Боевой карман'}>
        <button type="button" className="battle-drawer__scrim" aria-label="Закрыть" onClick={() => { setShowLog(false); setPocketsOpen(false) }} />
        <section>
          <header><b>{showLog ? 'Лог боя' : 'Боевой карман'}</b><button type="button" onClick={() => { setShowLog(false); setPocketsOpen(false) }}>Закрыть</button></header>
          {showLog ? <div className="log-body-v2">
            {rounds.length === 0 && <p className="battle-drawer__empty">Событий пока нет.</p>}
            {rounds.slice().reverse().map(r => <div key={r.round} className="log-round-v2">
              <div className="log-round-header">Раунд {r.round}</div>
              {r.events.map((t, i) => { const event = getEvent(t); const isPlayer = t.actor === 'player'; return <div key={i} className={`log-event-line ${isPlayer ? 'log-ev-player' : 'log-ev-enemy'}`}>
                <span className="log-ev-actor">{isPlayer ? playerName : enemyName}</span>
                <span className="log-ev-icon" style={{ color: event.color }}><EventIcon type={event.type} /></span>
                <span className="log-ev-label" style={{ color: event.color }}>{event.label}</span>
                {t.finalDamage > 0 && <span className="log-ev-dmg">-{t.finalDamage} HP</span>}
              </div> })}
            </div>)}
          </div> : <BattlePockets slots={pocketSlots} canAct={canAct} open
            onOpenChange={setPocketsOpen} onUse={(id) => act('use_item', { itemInstanceId: id })} />}
        </section>
      </aside>}
    </div>
  )}
