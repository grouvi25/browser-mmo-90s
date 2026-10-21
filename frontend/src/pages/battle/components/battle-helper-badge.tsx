// Боевой помощник в бою: имя, уровень, здоровье и тактика.
// Тактику можно менять по ходу боя, как бойцовому питомцу в «Апехе»:
// действует со следующего раунда.
import type { HelperTactic, LiveHelper } from '../../../shared/types/api.types'

export const TACTIC_OPTIONS: { value: HelperTactic; label: string }[] = [
  { value: 'ATTACK', label: 'Атакующая' },
  { value: 'STANDARD', label: 'Стандартная' },
  { value: 'DEFENSIVE', label: 'Защитная' },
]

export function BattleHelperBadge({ helper, pending, onTactic }: {
  helper: LiveHelper
  pending: boolean
  onTactic: (tactic: HelperTactic) => void
}) {
  const pct = Math.max(0, Math.min(100, Math.round(helper.hp / Math.max(1, helper.hpMax) * 100)))
  return (
    <div className={'battle-helper' + (helper.alive ? '' : ' is-down')} aria-label="Боевой помощник">
      <span className="battle-helper__name"><b>{helper.name}</b> ур. {helper.level}</span>
      <span className="battle-helper__hp" title={`${helper.hp} / ${helper.hpMax} HP`}>
        <i style={{ width: `${pct}%` }} />
        <small>{helper.alive ? `${helper.hp}/${helper.hpMax}` : 'выбит'}</small>
      </span>
      <select value={helper.tactic} disabled={!helper.alive || pending} aria-label="Тактика помощника"
        onChange={event => onTactic(event.target.value as HelperTactic)}>
        {TACTIC_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  )
}
