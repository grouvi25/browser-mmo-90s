// =============================================================
// Центр — стартовый вид вьюпорта.
// =============================================================
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { LocationView, type LocationAction } from '../../widgets/location-view/location-view'

const ACTIONS: LocationAction[] = [
  { key: 'pve', label: 'В бой', to: '/pvp', hint: 'Арена: бой с ботом или дуэль' },
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
    <LocationView
      scene="center"
      alt="Центральная площадь"
      place="Центр · Центральная площадь"
      actions={ACTIONS}
    >
      {inBattle && battleId && (
        <button type="button" className="hub__resume" onClick={() => navigate(`/battle/${battleId}`)}>
          Вернуться в бой →
        </button>
      )}
    </LocationView>
  )
}
