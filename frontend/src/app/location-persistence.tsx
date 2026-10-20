import { useEffect, useRef } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { cityApi } from '../shared/api/city.api'
import { useAuth } from './providers/auth-provider'
// Метка «в этой вкладке уже вернулись на последнюю локацию». Нужна, чтобы
// открытие сайта на главной (закладка, новая вкладка) возвращало игрока туда,
// где он был, а не записывало главную поверх последней локации. Дальше по
// вкладке главная — обычная локация.
const RESUMED_KEY = 'mmo_resumed'
function markResumed() {
  try { sessionStorage.setItem(RESUMED_KEY, '1') } catch { /* приватный режим */ }
}
function alreadyResumed(): boolean {
  try { return sessionStorage.getItem(RESUMED_KEY) === '1' } catch { return true }
}
export function ResumeLocation() {
  markResumed()
  const query = useQuery({ queryKey: ['city', 'resume'], queryFn: cityApi.location, retry: 1, staleTime: 0 })
  if (query.isLoading) return <p role="status">Возвращаемся в город…</p>
  if (query.isError) return <div role="alert">Не удалось восстановить локацию. <button onClick={() => void query.refetch()}>Повторить</button></div>
  return <Navigate to={query.data?.path ?? '/'} replace />
}
export function LocationPersistence() {
  const { pathname } = useLocation(); const navigate = useNavigate(); const { userId } = useAuth()
  const queue = useRef(Promise.resolve())
  const resumeFromHub = useRef(!alreadyResumed() && pathname === '/')
  useEffect(() => {
    if (resumeFromHub.current) navigate('/resume', { replace: true })
    else markResumed()
  }, [navigate])
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
    if (resumeFromHub.current && pathname === '/') return
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
