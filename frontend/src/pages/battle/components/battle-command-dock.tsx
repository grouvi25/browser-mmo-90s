import { Flag, RotateCcw, Shield, Sword, X } from 'lucide-react'
import type { AttackHand, BodyZone, GridPosition, Stance } from '../../../shared/api/battles.api'
import { ZONE_LABEL, getActionBudget, validateTurnPlan } from '../battle-view-model'

interface BattleCommandDockProps {
  stance: Stance
  attackZones: BodyZone[]
  attackHands: AttackHand[]
  blockZones: BodyZone[]
  selectedMove: GridPosition | null
  targetId?: string | null
  targetInRange: boolean
  canAct: boolean
  pending: boolean
  timeLeft: number
  roundsCount: number
  pocketCount: number
  onRemoveAttack: (index: number) => void
  onSubmitTurn: () => void
  onSubmitMove: () => void
  onReset: () => void
  onToggleLog: () => void
  onTogglePockets: () => void
  onSurrender: () => void
}

export function BattleCommandDock(props: BattleCommandDockProps) {
  const budget = getActionBudget(props.stance)
  const validation = validateTurnPlan({ ...props, targetParticipantId: props.targetId })
  const ready = props.selectedMove || validation.valid
  const missing = props.selectedMove ? 'Перемещение выбрано' : validation.valid ? 'План готов' : validation.reason
  return (
    <section className="battle-command-dock" aria-label="План хода">
      <div className="battle-command-dock__plan">
        <div className="battle-command-dock__meta"><b>План хода</b><span>00:0{props.timeLeft}</span></div>
        {props.selectedMove ? <div className="battle-plan-move">Клетка {props.selectedMove.x}:{props.selectedMove.y}</div> : (
          <div className="battle-plan-slots">
            <div><span><Sword size={11} /> Удары</span><div className="battle-plan-chips">
              {budget.attacks === 0 ? <i>нет</i> : Array.from({ length: budget.attacks }).map((_, index) => {
                const zone = props.attackZones[index]
                const hand = props.attackHands[index]
                return zone ? <button key={index} type="button" onClick={() => props.onRemoveAttack(index)} title="Убрать удар">
                  {hand === 'RIGHT_HAND' ? 'П' : 'Л'}: {ZONE_LABEL[zone]} <X size={10} />
                </button> : <i key={index}>{index + 1}. выбрать</i>
              })}
            </div></div>
            <div><span><Shield size={11} /> Блоки</span><div className="battle-plan-chips">
              {budget.blocks === 0 ? <i>нет</i> : props.blockZones.length ? props.blockZones.map(zone => <b key={zone}>{ZONE_LABEL[zone]}</b>) : <i>выберите {budget.blocks}</i>}
            </div></div>
          </div>
        )}
        <small className={ready ? 'is-ready' : ''}>{missing}</small>
      </div>
      <div className="battle-command-dock__actions">
        <button type="button" className="battle-submit-turn" disabled={!props.canAct || !ready || props.pending}
          onClick={props.selectedMove ? props.onSubmitMove : props.onSubmitTurn}>
          {props.pending ? 'Отправляем…' : props.selectedMove ? 'Перейти' : 'Подтвердить ход'}
        </button>
        <div className="battle-command-tools">
          <button type="button" onClick={props.onTogglePockets}>Карман <small>{props.pocketCount}</small></button>
          <button type="button" onClick={props.onToggleLog}>Лог <small>{props.roundsCount}</small></button>
          {(props.attackZones.length > 0 || props.blockZones.length > 0 || props.selectedMove) && <button type="button" onClick={props.onReset} title="Сбросить план"><RotateCcw size={13} /></button>}
          <button type="button" className="is-surrender" disabled={!props.canAct} onClick={props.onSurrender} title="Сдаться"><Flag size={13} /></button>
        </div>
      </div>
    </section>
  )
}
