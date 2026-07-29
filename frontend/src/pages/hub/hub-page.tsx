// =============================================================
// Город — стартовый вид вьюпорта. Иллюстрация района плюс
// быстрые действия поверх неё.
// =============================================================
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { SPRITES } from '../../shared/ui/sprite'

const ACTIONS = [
  { key: 'pve', label: 'Бой с ботом', to: '/pvp', hint: 'Тренировка на улице' },
  { key: 'shop', label: 'Магазин', to: '/shop', hint: 'Госцены, базовое снаряжение' },
  { key: 'repair', label: 'Мастерская', to: '/repair', hint: 'Починить снаряжение' },
  { key: 'inventory', label: 'Снаряжение', to: '/inventory', hint: 'Надеть и снять' },
]

export function HubPage() {
  const navigate = useNavigate()
  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
  })

  const inBattle = char?.status === 'IN_BATTLE'
  const battleId = localStorage.getItem('mmo_current_battle')

  return (
    <div className="hub">
      <img className="hub__scene" src={SPRITES['viewport-street']} alt="Центральный район" draggable={false} />

      <div className="hub__overlay">
        <div className="hub__place">Центр · Центральная площадь</div>

        {inBattle && battleId && (
          <button type="button" className="hub__resume" onClick={() => navigate(`/battle/${battleId}`)}>
            Вернуться в бой →
          </button>
        )}

        <div className="hub__actions">
          {ACTIONS.map(a => (
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
