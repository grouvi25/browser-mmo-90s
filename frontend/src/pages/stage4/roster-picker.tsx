// =============================================================
// Выбор состава на бой за район.
//
// Один компонент на два случая — заявка и оборона, — потому что правила
// у них одни: бойцы своей бригады, уровень не ниже третьего, без повторов.
// Две копии разошлись бы, и одна из сторон однажды собрала бы состав,
// который сервер не принимает.
//
// Порог уровня и минимальный размер приходят параметрами, а не зашиты:
// у обороны нижней границы нет — выставить одного честнее, чем не
// выставить никого.
// =============================================================
import { useMemo, useState } from 'react'
import { Users, Check } from 'lucide-react'
import type { ClanMember } from '../../shared/api/clans.api'

export const MIN_BATTLE_LEVEL = 3

export function RosterPicker({
  members, minSize, busy, submitLabel, onSubmit, onCancel, note,
}: {
  members: ClanMember[]
  /** Сколько бойцов нужно минимум. Для заявки пять, для обороны один. */
  minSize: number
  busy: boolean
  submitLabel: string
  onSubmit: (roster: string[]) => void
  onCancel: () => void
  note?: string
}) {
  // Годные наверх: иначе в бригаде на два десятка человек подходящих
  // приходится выискивать глазами среди новичков.
  const sorted = useMemo(() => {
    const rows = members
      .filter(member => member.character)
      .map(member => ({
        id: member.characterId,
        nickname: member.character!.nickname,
        level: member.character!.battleLevel,
        eligible: member.character!.battleLevel >= MIN_BATTLE_LEVEL,
      }))
    return rows.sort((a, b) =>
      Number(b.eligible) - Number(a.eligible) || b.level - a.level || a.nickname.localeCompare(b.nickname))
  }, [members])

  const [picked, setPicked] = useState<string[]>([])
  const eligibleCount = sorted.filter(row => row.eligible).length
  const enough = picked.length >= minSize

  const toggle = (id: string) =>
    setPicked(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id])

  return (
    <div className="s4-roster" role="group" aria-label="Состав на бой">
      <div className="s4-roster__head">
        <span><Users size={13} /> Выбрано {picked.length} из {minSize}</span>
        {/* Говорим о нехватке ДО отправки: сервер откажет тем же условием,
            но узнавать об этом из ошибки — плохой способ. */}
        {eligibleCount < minSize && (
          <span className="s4-roster__short">
            В бригаде годных бойцов {eligibleCount} — нужно {minSize}
          </span>
        )}
      </div>

      {note && <p className="s4-roster__note">{note}</p>}

      <ul className="s4-roster__list">
        {sorted.map(row => {
          const on = picked.includes(row.id)
          return (
            <li key={row.id}>
              <label className={!row.eligible ? 'is-weak' : on ? 'is-on' : ''}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!row.eligible || busy}
                  onChange={() => toggle(row.id)}
                />
                <span className="s4-roster__mark" aria-hidden="true">{on && <Check size={12} />}</span>
                <span className="s4-roster__nick">{row.nickname}</span>
                <span className="s4-roster__lvl">
                  ур. {row.level}
                  {!row.eligible && ` · ниже ${MIN_BATTLE_LEVEL}`}
                </span>
              </label>
            </li>
          )
        })}
      </ul>

      <div className="s4-roster__actions">
        <button type="button" disabled={!enough || busy} onClick={() => onSubmit(picked)}>
          {submitLabel}
        </button>
        <button type="button" className="s4-ghost" disabled={busy} onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  )
}
