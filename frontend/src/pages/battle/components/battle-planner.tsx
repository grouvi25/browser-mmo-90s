import { useEffect, useRef } from 'react'
import { Flag, RotateCcw, Shield, Sword, X } from 'lucide-react'
import type { BodyZone, GridPosition, Stance } from '../../../shared/api/battles.api'
import { BATTLE_STANCES, getActionBudget, getTurnPlanText, validateTurnPlan } from '../battle-view-model'
import { BodyZoneSelector } from './body-zone-selector'

interface BattlePlannerProps {
  stance: Stance
  attackZones: BodyZone[]
  blockZones: BodyZone[]
  selectedMove: GridPosition | null
  targetId?: string | null
  targetName: string
  playerName: string
  targetInRange: boolean
  canAct: boolean
  pending: boolean
  mobile: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onStanceChange: (stance: Stance) => void
  onAttackToggle: (zone: BodyZone) => void
  onBlockToggle: (zone: BodyZone) => void
  onSubmitTurn: () => void
  onSubmitMove: () => void
  onReset: () => void
  onSurrender: () => void
}

export function BattlePlanner(props: BattlePlannerProps) {
  const budget = getActionBudget(props.stance)
  const planText = getTurnPlanText(props)
  const validation = validateTurnPlan({
    ...props,
    targetParticipantId: props.targetId,
  })
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!props.mobile || !dialog) return
    if (props.open && !dialog.open) dialog.showModal()
    if (!props.open && dialog.open) dialog.close()
  }, [props.mobile, props.open])

  const changeStance = (stance: Stance) => {
    props.onStanceChange(stance)
  }

  const plan = (
    <div className="battle-plan-grid">
      <BodyZoneSelector
        mode="block"
        selected={props.blockZones}
        limit={budget.blocks}
        disabled={!props.canAct}
        disabledReason={budget.blocks === 0 ? 'Эта стойка не использует блоки' : undefined}
        onToggle={props.onBlockToggle}
        participantName={props.playerName}
      />

      <section className="turn-plan" aria-label="План хода">
        <div className="stance-selector" role="radiogroup" aria-label="Бюджет действий">
          {BATTLE_STANCES.map(item => (
            <button
              key={item.key}
              type="button"
              role="radio"
              aria-checked={props.stance === item.key}
              className={props.stance === item.key ? 'is-selected' : ''}
              disabled={!props.canAct}
              onClick={() => changeStance(item.key)}
            >
              <span>{item.label}</span><small>{item.hint}</small>
            </button>
          ))}
        </div>
        <div className="turn-plan__summary" aria-live="polite">
          <span>План хода</span>
          <b>{planText}</b>
          {!validation.valid && !props.selectedMove && <small>{validation.reason}</small>}
        </div>
        <div className="turn-plan__actions">
          {(props.attackZones.length > 0 || props.blockZones.length > 0 || props.selectedMove) && (
            <button type="button" className="btn" disabled={!props.canAct} onClick={props.onReset}>
              <RotateCcw size={13} /> Сбросить
            </button>
          )}
          {props.selectedMove ? (
            <button type="button" className="btn btn-gold turn-plan__submit" disabled={!props.canAct || props.pending} onClick={props.onSubmitMove}>
              Перейти
            </button>
          ) : (
            <button type="button" className="btn btn-danger turn-plan__submit" disabled={!props.canAct || !validation.valid || props.pending} onClick={props.onSubmitTurn}>
              <Sword size={14} /> {props.pending ? 'Отправка…' : 'Сделать ход'}
            </button>
          )}
        </div>
      </section>

      <BodyZoneSelector
        mode="attack"
        selected={props.attackZones}
        limit={budget.attacks}
        disabled={!props.canAct || !props.targetId || !props.targetInRange}
        disabledReason={budget.attacks === 0
          ? 'Эта стойка не использует удары'
          : !props.targetId ? 'Выберите цель на поле'
          : !props.targetInRange ? 'Цель вне досягаемости'
          : undefined}
        onToggle={props.onAttackToggle}
        participantName={props.targetName}
      />
    </div>
  )

  if (!props.mobile) {
    return (
      <>
        {plan}
        <button type="button" className="battle-surrender" disabled={!props.canAct} onClick={props.onSurrender} title="Сдаться">
          <Flag size={14} /> <span>Сдаться</span>
        </button>
      </>
    )
  }

  return (
    <>
      <div className="mobile-turn-bar">
        <div><span>План</span><b>{planText}</b></div>
        <button ref={triggerRef} type="button" className="btn" disabled={!props.canAct} onClick={() => props.onOpenChange(true)}>
          <Shield size={14} /> Настроить
        </button>
        {props.selectedMove ? (
          <button type="button" className="btn btn-gold" disabled={!props.canAct || props.pending} onClick={props.onSubmitMove}>Перейти</button>
        ) : (
          <button type="button" className="btn btn-danger" disabled={!props.canAct || !validation.valid || props.pending} onClick={props.onSubmitTurn}>Сделать ход</button>
        )}
      </div>
      <dialog
        ref={dialogRef}
        className="battle-plan-dialog"
        aria-label="Настройка хода"
        onClose={() => {
          props.onOpenChange(false)
          triggerRef.current?.focus()
        }}
        onCancel={event => {
          event.preventDefault()
          dialogRef.current?.close()
        }}
      >
        <header><b>Настройка хода</b><button type="button" aria-label="Закрыть" onClick={() => dialogRef.current?.close()}><X size={18} /></button></header>
        {plan}
        <footer><button type="button" className="btn btn-primary" onClick={() => dialogRef.current?.close()}>Готово</button></footer>
      </dialog>
    </>
  )
}
