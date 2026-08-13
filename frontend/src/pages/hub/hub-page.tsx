// =============================================================
// Центр: сама сцена остаётся визуальной, переходы живут в единой
// нижней полосе. Так одни и те же кнопки не повторяются дважды.
// =============================================================
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { LocationView } from '../../widgets/location-view/location-view'

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
      actions={[]}
    >
      {inBattle && battleId && (
        <button type="button" className="hub__resume" onClick={() => navigate(`/battle/${battleId}`)}>
          Вернуться в бой →
        </button>
      )}
    </LocationView>
  )
}
