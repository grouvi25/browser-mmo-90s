// Боевой помощник в разделе «Помощники»: уровень, опыт, здоровье, тактика.
// Механика — как у бойцового питомца «Апехи»: выходит в бой с ботом и в
// групповые бои рядом с хозяином (в дуэль — нет) и дерётся по тактике.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { helpersApi, type Helper } from '../../shared/api/strategy.api'
import type { HelperTactic } from '../../shared/types/api.types'

const TACTICS: { value: HelperTactic; label: string; hint: string }[] = [
  { value: 'ATTACK', label: 'Атакующая', hint: 'бьёт сильнее, удары по вам не принимает' },
  { value: 'STANDARD', label: 'Стандартная', hint: 'бьёт обычно, иногда принимает удар по вам на себя' },
  { value: 'DEFENSIVE', label: 'Защитная', hint: 'бьёт слабее, часто закрывает вас от ударов' },
]

export function CombatHelperFacts({ helper, disabled, onError }: { helper: Helper; disabled: boolean; onError: (e: Error) => void }) {
  const qc = useQueryClient()
  const tactic = useMutation({
    mutationFn: (value: HelperTactic) => helpersApi.setTactic(helper.id, value),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['helpers'] }) },
    onError,
  })
  const current = TACTICS.find(t => t.value === (helper.tactic ?? 'STANDARD')) ?? TACTICS[1]
  const level = helper.combatLevel ?? 1
  return <>
    <dl className="s4-helper__facts">
      <div><dt>Уровень</dt><dd>{level}</dd></div>
      <div><dt>Опыт</dt><dd>{Math.floor(helper.combatExp ?? 0)} · до следующего {helper.combatExpToNext ?? 0}</dd></div>
      <div><dt>Здоровье в бою</dt><dd>{helper.combatHpMax ?? 0} HP</dd></div>
    </dl>
    <div className="s4-helper__shift">
      <select value={current.value} disabled={disabled || tactic.isPending} aria-label={`Тактика ${helper.name}`}
        onChange={event => tactic.mutate(event.target.value as HelperTactic)}>
        {TACTICS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <span className="s4-muted">{current.hint}. Выходит с вами в бой с ботом и в групповые бои; в дуэль — нет.</span>
    </div>
  </>
}
