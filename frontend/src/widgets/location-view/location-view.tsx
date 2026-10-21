// =============================================================
// Вид локации: иллюстрация района во всю область вьюпорта и
// быстрые переходы поверх неё. Районы отличаются только картинкой
// и набором действий, поэтому разметка у них общая.
// =============================================================
import { useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'

import { SCENES } from '../../shared/ui/sprite'

export type LocationAction = { key: string; label: string; to: string; hint: string }

type Props = {
  /** ключ иллюстрации из SCENES */
  scene: string
  alt: string
  /** подпись места в левом верхнем углу */
  place: string
  actions: LocationAction[]
  /** необязательная врезка над кнопками (например, «вернуться в бой») */
  children?: ReactNode
}

export function LocationView({ scene, alt, place, actions, children }: Props) {
  const navigate = useNavigate()

  return (
    <div className="hub">
      <img className="hub__scene" src={SCENES[scene]} alt={alt} draggable={false} />

      <div className="hub__overlay">
        <div className="hub__place">{place}</div>

        {children}

        <div className="hub__actions">
          {actions.map(a => (
            <button
              key={a.key}
              type="button"
              className="hub__action"
              onClick={() => navigate(a.to)}
              title={a.hint}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
