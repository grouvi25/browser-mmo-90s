// =============================================================
// Центр: сама сцена остаётся визуальной, переходы живут в единой
// нижней полосе. Так одни и те же кнопки не повторяются дважды.
// =============================================================
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { battlesApi } from '../../shared/api/battles.api'
import { LocationView } from '../../widgets/location-view/location-view'

export function HubPage() {
  const navigate = useNavigate()
  const current = useQuery({ queryKey: ['battle', 'current'], queryFn: battlesApi.current, refetchInterval: 4000 })
  const battleId = current.data?.battleId

  return (
    <LocationView
      scene="center"
      alt="Центральная площадь"
      place="Центр · Центральная площадь"
      actions={[]}
    >
      {battleId && (
        <button type="button" className="hub__resume" onClick={() => navigate(`/battle/${battleId}`)}>
          Вернуться в бой →
        </button>
      )}
    </LocationView>
  )
}
