// =============================================================
// Навигация главного экрана: верхнее меню, полоса районов и
// нижняя полоса экономики. Подписи ужимаются в ширину из PSD.
// =============================================================
import { useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'

import { MENU } from '../../shared/lib/layout-map'
import { FitText } from '../../shared/lib/stage'
import { useAuth } from '../../app/providers/auth-provider'
import { authApi } from '../../shared/api/auth.api'

export function TopNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const { signOut } = useAuth()

  const handleLogout = async () => {
    try { await authApi.logout() } catch { /* сессия могла истечь — выходим всё равно */ }
    signOut()
    navigate('/login')
  }

  const go = (to: string) => {
    if (to === '/') { void qc.invalidateQueries(); navigate('/') }
    else navigate(to)
  }

  return (
    <>
      {MENU.nav.map(n => (
        <FitText
          key={n.key}
          x={n.x} y={n.y} w={n.w} size={MENU.navFontSize} dy={MENU.navDy}
          as="button"
          className={'t-sign stage-link'
            + (!n.action && location.pathname === n.to ? ' is-active' : '')}
          onClick={() => go(n.to)}
          title={n.label}
        >
          {n.label}
        </FitText>
      ))}
      <FitText
        x={MENU.navExit.x} y={MENU.navExit.y} w={MENU.navExit.w}
        size={MENU.navFontSize} dy={MENU.navDy}
        as="button"
        className="t-sign stage-link stage-link--exit"
        onClick={handleLogout}
        title="Выйти из игры"
      >
        {MENU.navExit.label}
      </FitText>
    </>
  )
}

export function districtKey(path:string){if(['/industrial','/work','/resources','/upgrades','/repair'].some(x=>path.startsWith(x))||path.includes('equipment-production'))return'industrial';if(path.startsWith('/agriculture')||['farms','kolhoz','plants','products'].some(x=>path.includes(x)))return'agriculture';if(['/market','/shop','/shops/private'].some(x=>path.startsWith(x)))return'market';return''}

export function DistrictTabs() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <>
      {MENU.districts.map(d => {
        const active = location.pathname === d.to || districtKey(location.pathname) === d.key
        return (
          <FitText
            key={d.key}
            x={d.x} y={d.y} w={d.w} size={MENU.navFontSize} dy={MENU.navDy}
            as="button"
            className={'t-sign stage-link' + (active ? ' is-active' : '')}
            onClick={() => navigate(d.to)}
            title={d.label}
          >
            {d.label}
          </FitText>
        )
      })}
    </>
  )
}

export function BottomTabs() {
  const navigate = useNavigate()
  const location = useLocation()
  const key = districtKey(location.pathname)
  const tabs = MENU.rooms[key] ?? MENU.bottomTabs
  const startX = 382.5
  const step = Math.min(155, 870 / Math.max(1, tabs.length))
  return <>{tabs.map((t, index) => (
    <FitText key={t.key} x={startX + index * step} y={630} w={Math.max(85, step - 18)} size={MENU.bottomFontSize} dy={MENU.bottomDy}
      as="button" className={'t-sign stage-link' + (t.to.startsWith('/soon/') ? ' is-locked' : '') + (location.pathname === t.to ? ' is-active' : '')}
      onClick={() => navigate(t.to)} title={t.label}>{t.label}</FitText>
  ))}</>
}
