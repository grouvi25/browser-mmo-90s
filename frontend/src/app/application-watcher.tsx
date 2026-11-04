// =============================================================
// Уводит в бой, когда стартовала заявка.
//
// Заявка открывается воркером по таймеру, а не кликом игрока, поэтому
// узнать о старте клиент может только сам: раз в несколько секунд
// спрашиваем, не идёт ли уже бой с нашим участием.
// =============================================================
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { battlesApi } from '../shared/api/battles.api'

export function ApplicationWatcher() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const current = useQuery({ queryKey: ['battle', 'current'], queryFn: battlesApi.current, refetchInterval: 4000 })
  const battleId = current.data?.battleId
  useEffect(() => {
    // Ответ из кэша мог остаться от уже законченного боя: он вернул бы игрока на окно итога.
    if (!battleId || !current.isFetchedAfterMount || pathname.startsWith('/battle/')) return
    try { localStorage.setItem('mmo_current_battle', battleId) } catch { /* приватный режим */ }
    navigate(`/battle/${battleId}`)
  }, [battleId, current.isFetchedAfterMount, pathname, navigate])
  return null
}
