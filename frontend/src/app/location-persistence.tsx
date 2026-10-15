import { useEffect, useRef } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { cityApi } from '../shared/api/city.api'
import { useAuth } from './providers/auth-provider'
export function ResumeLocation() {
  const query = useQuery({ queryKey: ['city', 'resume'], queryFn: cityApi.location, retry: 1, staleTime: 0 })
  if (query.isLoading) return <p role="status">Возвращаемся в город…</p>
  if (query.isError) return <div role="alert">Не удалось восстановить локацию. <button onClick={() => void query.refetch()}>Повторить</button></div>
  return <Navigate to={query.data?.path ?? '/'} replace />
}
export function LocationPersistence() {
  const { pathname } = useLocation(); const navigate = useNavigate(); const { userId } = useAuth()
  const queue = useRef(Promise.resolve())
  const prison = useQuery({ queryKey: ['city', 'prison-check'], queryFn: cityApi.location, refetchInterval: 30_000, retry: false })
  const jailed = !!prison.data?.jailedUntil && new Date(prison.data.jailedUntil) > new Date()
  useEffect(() => {
    if (jailed && pathname !== '/prison') navigate('/prison', { replace: true })
  }, [jailed, pathname, navigate])
  useEffect(() => {
    if (prison.isLoading || prison.isError || (jailed && pathname !== '/prison')) return
    // Чужой профиль — не место в городе: сервер его не примет (422), а после
    // входа возвращать игрока на чужую карточку незачем.
    if (pathname.startsWith('/u/')) return
    let active = true
    queue.current = queue.current.catch(() => undefined).then(async () => {
      if (!active) return
      const stored = localStorage.getItem('mmo_user')
      if (!stored || JSON.parse(stored).userId !== userId) return
      await cityApi.move(pathname)
    }).catch(() => undefined)
    return () => { active = false }
  }, [pathname, userId, jailed, prison.isLoading, prison.isError])
  return null
}
