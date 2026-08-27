// =============================================================
// Мобильная оболочка города.
//
// Макет заказчика — фиксированная сцена 1550×900: на телефоне она
// ужимается целиком и подписи становятся мельче шести пикселей.
// Поэтому на узких экранах композиция другая — потоковая, — но
// собрана из тех же данных и той же графики: районы и разделы
// берутся из layout-map, карточка персонажа вырезается из общей
// подложки (CardCutout), содержимое разделов рендерится тем же
// ViewportPanel, что и на большом экране.
// =============================================================
import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { authApi } from '../../shared/api/auth.api'
import { useAuth } from '../providers/auth-provider'
import { MENU } from '../../shared/lib/layout-map'
import { MobileChat } from '../../widgets/city-feed/mobile-chat'
import { districtKey } from '../../widgets/city-nav/city-nav'
import { useTableLabels } from '../../shared/lib/use-table-labels'
import { ErrorBoundary } from '../error-boundary'

type Sheet = 'chat' | 'menu' | null

export function MobileShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const { signOut } = useAuth()
  const [sheet, setSheet] = useState<Sheet>(null)
  const viewRef = useRef<HTMLElement>(null)
  const sheetCloseRef = useRef<HTMLButtonElement>(null)

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
  })

  // переход между разделами закрывает открытую шторку
  useEffect(() => setSheet(null), [location.pathname])

  useEffect(() => {
    if (!sheet) return
    sheetCloseRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheet(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [sheet])

  // подписи колонок для таблиц, свёрнутых в карточки
  useTableLabels(viewRef, true)

  const logout = async () => {
    try { await authApi.logout() } catch { /* сессия могла истечь */ }
    signOut()
    navigate('/login')
  }

  const go = (to: string) => {
    if (to === '/') void qc.invalidateQueries()
    navigate(to)
  }

  const strip = (items: readonly { key: string; label: string; to: string }[], mod: string) => (
    <nav className={`m-strip m-strip--${mod}`}>
      {items.map(i => (
        <button
          key={i.key}
          type="button"
          className={'m-strip__item' + (location.pathname === i.to ? ' is-active' : '')
            + (i.to.startsWith('/soon/') ? ' is-locked' : '')}
          onClick={() => go(i.to)}
        >
          {i.label}
        </button>
      ))}
    </nav>
  )

  return (
    <div className="m-shell">
      <header className="m-top">
        <button type="button" className="m-top__who" onClick={() => navigate('/profile')}>
          <span className="m-top__nick">{char?.nickname ?? '—'}</span>
          <span className="m-top__stats">
            <b className="stat-num--energy">{char?.battleLevel ?? 0}</b>
            <b className="stat-num--hp">{char?.hpCurrent ?? 0}</b>
          </span>
        </button>
        <span className="m-top__money">{(char?.money ?? 0).toLocaleString('ru')} ₽</span>
        <button type="button" className="m-top__exit" onClick={logout} title="Выйти из игры">выход</button>
      </header>

      {strip(MENU.districts, 'districts')}

      <main className="m-view" ref={viewRef}>
        <ErrorBoundary><Outlet /></ErrorBoundary>
      </main>

      {MENU.rooms[districtKey(location.pathname + location.search)]
        ? strip(MENU.rooms[districtKey(location.pathname + location.search)], 'economy')
        : null}

      <nav className="m-tabbar">
        <button type="button" className={'m-tabbar__btn' + (location.pathname === '/' ? ' is-active' : '')}
          onClick={() => go('/')}>Город</button>
        <button type="button" className={'m-tabbar__btn' + (sheet === 'chat' ? ' is-active' : '')}
          onClick={() => setSheet(sheet === 'chat' ? null : 'chat')}>Чат</button>
        <button type="button" className={'m-tabbar__btn' + (sheet === 'menu' ? ' is-active' : '')}
          onClick={() => setSheet(sheet === 'menu' ? null : 'menu')}>Ещё</button>
      </nav>

      {sheet && (
        <div
          className="m-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={sheet === 'chat' ? 'Чат и игроки онлайн' : 'Главное меню'}
        >
          <button type="button" className="m-sheet__scrim" aria-label="Закрыть" onClick={() => setSheet(null)} />
          <div className="m-sheet__body">
            <button ref={sheetCloseRef} type="button" className="m-sheet__close" onClick={() => setSheet(null)}>закрыть ✕</button>

            {sheet === 'chat' && <MobileChat />}
            {sheet === 'menu' && (
              <div className="m-menu">
                {MENU.nav.filter(n => !n.action).map(n => (
                  <button key={n.key} type="button" className="m-menu__item" onClick={() => go(n.to)}>
                    {n.label}
                  </button>
                ))}
                <button type="button" className="m-menu__item" onClick={() => go('/inventory')}>снаряжение</button>
                <button type="button" className="m-menu__item" onClick={() => go('/skills')}>владение оружием</button>
                <button type="button" className="m-menu__item" onClick={() => go('/stats')}>характеристики</button>
                <button type="button" className="m-menu__item" onClick={() => go('/battles/history')}>история боёв</button>
                <button type="button" className="m-menu__item m-menu__item--exit" onClick={logout}>выход</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
