import type { BodyZone } from '../../../shared/api/battles.api'
import { BATTLE_ZONES } from '../battle-view-model'

const ZONE_CLASS: Record<BodyZone, string> = {
  HEAD: 'head', CHEST: 'chest', LEFT_ARM: 'left-arm', RIGHT_ARM: 'right-arm', LEGS: 'legs',
}

interface BattleFighterPanelProps {
  side: 'self' | 'enemy'
  name: string
  level?: number
  hp: number
  hpMax: number
  mode: 'attack' | 'block'
  selected: BodyZone[]
  limit: number
  disabled?: boolean
  disabledReason?: string
  primaryHand?: string | null
  secondaryHand?: string | null
  onZone: (zone: BodyZone) => void
}

export function BattleFighterPanel(props: BattleFighterPanelProps) {
  const pct = props.hpMax > 0 ? Math.max(0, Math.min(100, props.hp / props.hpMax * 100)) : 0
  const instruction = props.mode === 'attack' ? 'Зоны ударов' : 'Зоны блока'
  return (
    <section className={`battle-fighter-panel is-${props.side}`} aria-label={`${props.name}: ${instruction.toLowerCase()}`}>
      <header className="battle-fighter-panel__head">
        <div><b>{props.name}</b>{props.level != null && <small>ур. {props.level}</small>}</div>
        <div className="battle-fighter-panel__hp" aria-label={`Здоровье ${props.hp} из ${props.hpMax}`}>
          <i style={{ transform: `scaleX(${pct / 100})` }} /><span>{props.hp} / {props.hpMax}</span>
        </div>
      </header>
      <div className="battle-fighter-panel__mode"><span>{instruction}</span><b>{props.selected.length} / {props.limit}</b></div>
      <div className="battle-fighter-panel__figure">
        <div className="battle-fighter-panel__body" aria-hidden="true">
          <i className="battle-body-part is-head" /><i className="battle-body-part is-chest" />
          <i className="battle-body-part is-left-arm" /><i className="battle-body-part is-right-arm" />
          <i className="battle-body-part is-left-leg" /><i className="battle-body-part is-right-leg" />
        </div>
        {BATTLE_ZONES.map(zone => {
          const count = props.selected.filter(item => item === zone.key).length
          const active = count > 0
          const full = props.mode === 'block' && !active && props.selected.length >= props.limit
          return (
            <button key={zone.key} type="button"
              className={`battle-fighter-zone is-${ZONE_CLASS[zone.key]}${active ? ' is-selected' : ''}`}
              aria-label={`${props.mode === 'attack' ? 'Удар' : 'Блок'}: ${zone.label.toLocaleLowerCase('ru')}${count > 1 ? `, выбрано ${count} раза` : active ? ', выбрано' : ''}`}
              aria-pressed={active} disabled={props.disabled || props.limit === 0 || full}
              onClick={() => props.onZone(zone.key)}>
              <span>{zone.label}</span>{count > 1 && <em>×{count}</em>}
            </button>
          )
        })}
      </div>
      {props.disabledReason && <p className="battle-fighter-panel__reason">{props.disabledReason}</p>}
      <footer className="battle-fighter-panel__hands" aria-label="Предметы в руках">
        <div><span>Основная рука</span><b>{props.primaryHand || 'Без оружия'}</b></div>
        <div><span>Вторая рука</span><b>{props.secondaryHand || 'Свободна'}</b></div>
      </footer>
    </section>
  )
}
