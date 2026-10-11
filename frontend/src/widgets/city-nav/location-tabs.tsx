import { useLocation, useNavigate } from 'react-router-dom'
import { CITY_LOCATIONS } from '../../shared/lib/city-locations'
import { MENU } from '../../shared/lib/layout-map'
import { districtKey } from './city-nav'
export function LocationTabs() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const rooms = MENU.rooms[districtKey(pathname)] ?? []
  return <nav className="city-locations" aria-label="Локации Центра">
    {CITY_LOCATIONS.map(item => <button type="button" key={item.key}
      data-stage-nav={item.key} aria-current={pathname === item.to ? 'page' : undefined}
      className={pathname === item.to ? 'is-active' : ''} onClick={() => navigate(item.to)}>{item.label}</button>)}
    {rooms.filter(item => !CITY_LOCATIONS.some(main => main.to === item.to)).map(item =>
      <button type="button" key={item.key} onClick={() => navigate(item.to)}>{item.label}</button>)}
  </nav>
}
