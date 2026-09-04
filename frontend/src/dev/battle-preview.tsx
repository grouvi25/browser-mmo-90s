// Стенд боевого экрана: собирает ту же разметку на выдуманных данных,
// чтобы смотреть вёрстку без бэкенда и живого боя. В сборку не входит —
// точка входа battle-preview.html исключена из билда.
import { useState, type CSSProperties } from 'react'
import ReactDOM from 'react-dom/client'
import { Backpack, CircleDot, Flag, Sword } from 'lucide-react'
import { BattleFighterPanel } from '../pages/battle/components/battle-fighter-panel'
import { BattleCommandDock } from '../pages/battle/components/battle-command-dock'
import { BattleChat, BATTLE_SCENE_H } from '../pages/battle/components/battle-chat'
import { useViewportScale } from '../shared/lib/stage'
import type { RoundRecord, TurnEvent } from '../pages/battle/components/battle-events'
import { toggleAutomaticBlockSlot, selectAutomaticAttack, removeAutomaticAttack, type AutomaticTurnPlan } from '../pages/battle/battle-view-model'
import { DESIGNER_BATTLE_CELLS } from '../shared/lib/designer-battle-grid'
import { isNeighbour } from '../shared/lib/hex'
import battleField from '../shared/assets/battle/battle-field.webp'
import battleField2x from '../shared/assets/battle/battle-field@2x.webp'
import fighterBlue from '../shared/assets/battle/fighter-blue.webp'
import fighterRed from '../shared/assets/battle/fighter-red.webp'
import '../pages/battle/battle-phase-a.css'
import '../styles/global.css'
import '../styles/theme.css'
import '../styles/mobile.css'

const PLAYER = { x: 2, y: 5 }
const ENEMY = { x: 7, y: 5 }

const event = (over: Partial<TurnEvent>): TurnEvent => ({
  actor: 'player', action: 'attack', hit: true, dodge: false, block: false, crit: false,
  rawDamage: 0, finalDamage: 0, logParts: [], ...over,
})
const ROUNDS: RoundRecord[] = [
  { round: 1, type: 'normal', events: [
    event({ zone: 'HEAD', sourceHand: 'RIGHT_HAND', finalDamage: 12, rawDamage: 12 }),
    event({ actor: 'enemy', zone: 'CHEST', hit: false, dodge: true }),
  ] },
  { round: 2, type: 'normal', events: [
    event({ zone: 'CHEST', block: true, hit: true, counterDamage: 4 }),
    event({ actor: 'enemy', zone: 'LEFT_LEG', crit: true, finalDamage: 21, rawDamage: 21 }),
    event({ zone: 'HEAD', lucky: true, finalDamage: 17, rawDamage: 17 }),
  ] },
]

function Field() {
  const [move, setMove] = useState<{ x: number; y: number } | null>(null)
  return <div className="grid-arena">
    <div className="hex-board">
      <div className="hex-field designer-battle-field" style={{ backgroundImage: `image-set(url("${battleField2x}") 2x, url("${battleField}") 1x)` }}>
        {DESIGNER_BATTLE_CELLS.map(cell => {
          const isPlayer = cell.x === PLAYER.x && cell.y === PLAYER.y
          const isEnemy = cell.x === ENEMY.x && cell.y === ENEMY.y
          const canMove = isNeighbour(PLAYER, cell) && !isPlayer && !isEnemy
          const selected = move?.x === cell.x && move?.y === cell.y
          const depth = { '--fighter-depth': 0.58 + cell.centerY / 100 * 0.72 } as CSSProperties
          return <div key={`${cell.y}-${cell.x}`}
            className={'hex-cell' + (isPlayer ? ' is-player' : '') + (isEnemy ? ' is-enemy is-target' : '')
              + (canMove ? ' is-movable is-clickable' : '') + (selected ? ' is-selected' : '')}
            style={{ left: `${cell.left}%`, top: `${cell.top}%`, width: `${cell.width}%`, height: `${cell.height}%` }}
            onClick={() => canMove && setMove({ x: cell.x, y: cell.y })}>
            <span className="designer-cell-hit" style={{ clipPath: cell.polygon }} />
            {isPlayer && <div style={depth} className="fighter-token token-player">
              <img src={fighterBlue} alt="" /><span className="token-label">Миша</span>
            </div>}
            {isEnemy && <div style={depth} className="fighter-token token-enemy">
              <img src={fighterRed} alt="" /><span className="token-label">Гопн.</span>
              <span className="token-target-label">ЦЕЛЬ</span>
            </div>}
          </div>
        })}
      </div>
    </div>
  </div>
}

function Preview() {
  const [plan, setPlan] = useState<AutomaticTurnPlan>({
    stance: 'mixed', attackZones: ['HEAD'], attackHands: ['RIGHT_HAND'], blockZones: ['CHEST', 'CHEST'],
  })
  const { attackZones: attacks, attackHands: hands, blockZones: blocks } = plan
  const blockLimit = hands.length > 0 ? 2 : 4
  // Стенд повторяет разметку страницы, включая сцену: иначе на нём
  const [chatOpen, setChatOpen] = useState(false)
  const sceneScale = useViewportScale(900, BATTLE_SCENE_H, 'contain', 1)

  return <div className="battle-page-v3">
    <div className="battle-mockup-scene-holder"
      style={{ width: 900 * sceneScale, height: BATTLE_SCENE_H * sceneScale }}>
    <div className="battle-mockup-scene"
      style={{ height: BATTLE_SCENE_H, transform: `scale(${sceneScale})` }}>
    <header className="battle-header-v3">
      <div><Sword size={13} /><b>Бой</b><b className="battle-header-timer">00:47</b></div>
      <strong>Раунд 3 / 30</strong>
      <span className="is-ready"><CircleDot size={9} /> Ваш ход
        <span className="battle-header-tools">
          <button type="button" aria-label="Боевой карман"><Backpack size={13} /><i>1</i></button>
          <button type="button" className="is-surrender" aria-label="Сдаться"><Flag size={13} /></button>
        </span>
      </span>
    </header>

    <main className="battle-duel-stage">
      <BattleFighterPanel side="self" name="Миша" level={7} hp={78} hpMax={120}
        mode="block" selected={blocks} limit={blockLimit}
        primaryHand="Кастет" secondaryHand="Кулак"
        primaryWeaponCode="weapon_knuckles" primaryWeaponType="MELEE"
        onZone={(zone, slot) => setPlan(toggleAutomaticBlockSlot(plan, zone, slot ?? 0))} />

      <div className="battle-field-v3">
        <Field />
        <div className="battle-field-v3__meta">
          <span>Дистанция: <b>5</b></span><span>Дальность: <b>1</b></span>
        </div>
      </div>

      <BattleFighterPanel side="enemy" name="Гопник" level={6} hp={54} hpMax={90}
        mode="attack" selected={attacks} selectedHands={hands} limit={blocks.length > 0 ? 1 : 2}
        primaryHand="Обрезок трубы" primaryWeaponCode="weapon_pipe" primaryWeaponType="MELEE"
        onZone={() => undefined}
        onHandZone={(hand, zone) => setPlan(selectAutomaticAttack(plan, hand, zone))} />
    </main>

    <BattleCommandDock stance="mixed" attackZones={attacks} attackHands={hands} blockZones={blocks}
      selectedMove={null} targetId="enemy" targetInRange canAct pending={false}
      timeLeft={47} roundsCount={2} pocketCount={1}
      compact rounds={ROUNDS} playerName="Миша" enemyName="Гопник"
      onRemoveAttack={index => setPlan(removeAutomaticAttack(plan, index))}
      onSubmitTurn={() => undefined} onSubmitMove={() => undefined}
      onReset={() => setPlan({ stance: 'defense4', attackZones: [], attackHands: [], blockZones: [] })}
      onToggleLog={() => undefined} onTogglePockets={() => undefined} onSurrender={() => undefined} />
    </div>

    {/* Как и на боевой странице: чат в держателе, а не в сцене. */}
    <BattleChat open={chatOpen} onToggle={() => setChatOpen(value => !value)} />
    </div>
  </div>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Preview />)
