import type { BodyZone } from '../../../shared/api/battles.api'
import { BATTLE_ZONES } from '../battle-view-model'

interface BodyZoneSelectorProps {
  mode: 'attack' | 'block'
  selected: BodyZone[]
  limit: number
  disabled?: boolean
  disabledReason?: string
  onToggle: (zone: BodyZone) => void
  participantName: string
}

const ZONE_CLASS: Record<BodyZone, string> = {
  HEAD: 'head',
  CHEST: 'chest',
  LEFT_ARM: 'left-arm',
  RIGHT_ARM: 'right-arm',
  LEFT_LEG: 'left-leg',
  RIGHT_LEG: 'right-leg',
  // Зона из старых боёв: рисуется теми же правилами, что левая нога.
  LEGS: 'left-leg',
}

export function BodyZoneSelector({
  mode, selected, limit, disabled = false, disabledReason, onToggle, participantName,
}: BodyZoneSelectorProps) {
  const action = mode === 'attack' ? 'Удар' : 'Блок'
  const title = mode === 'attack' ? 'Удары по цели' : 'Мои блоки'
  return (
    <section className={`body-selector body-selector--${mode}`} aria-label={`${title}: ${participantName}`}>
      <div className="body-selector__head">
        <div><b>{title}</b><small>{participantName}</small></div>
        <strong>{selected.length} / {limit}</strong>
      </div>
      <div className="body-selector__figure" aria-describedby={disabledReason ? `${mode}-disabled-reason` : undefined}>
        <div className="body-selector__silhouette" aria-hidden="true">
          <i className="body-part body-part--head" />
          <i className="body-part body-part--chest" />
          <i className="body-part body-part--left-arm" />
          <i className="body-part body-part--right-arm" />
          <i className="body-part body-part--left-leg" />
          <i className="body-part body-part--right-leg" />
        </div>
        {BATTLE_ZONES.map(zone => {
          const active = selected.includes(zone.key)
          const full = !active && selected.length >= limit
          return (
            <button
              key={zone.key}
              type="button"
              className={`body-zone body-zone--${ZONE_CLASS[zone.key]}${active ? ' is-selected' : ''}`}
              aria-label={`${action}: ${zone.label.toLocaleLowerCase('ru')}, ${active ? 'выбрано' : 'не выбрано'}`}
              aria-pressed={active}
              disabled={disabled || limit === 0 || full}
              onClick={() => onToggle(zone.key)}
            >
              <span>{zone.label}</span>
            </button>
          )
        })}
      </div>
      {disabledReason && <p id={`${mode}-disabled-reason`} className="body-selector__reason">{disabledReason}</p>}
    </section>
  )
}
