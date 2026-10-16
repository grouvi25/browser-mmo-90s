import { useLocation, useNavigate } from 'react-router-dom'
import { activeTabKey, locationMenu } from '../../shared/lib/location-menus'

/** Нижняя полоса: в Центре — локации города, в локации — ЦЕНТР и её разделы. */
export function LocationTabs() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const menu = locationMenu(pathname)
  const active = activeTabKey(menu.tabs, pathname, search)
  return <nav className={'city-locations' + (menu.key === 'center' ? '' : ' city-locations--place')}
    aria-label={menu.key === 'center' ? 'Локации Центра' : 'Разделы локации'}>
    {menu.tabs.map(item => <button type="button" key={item.key}
      data-stage-nav={item.key} aria-current={active === item.key ? 'page' : undefined}
      className={(active === item.key ? 'is-active' : '') + (item.key === 'center' && menu.key !== 'center' ? ' is-center' : '')}
      onClick={() => navigate(item.to)}>{item.label}</button>)}
  </nav>
}
