import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { activeTabKey, locationMenu, type LocationTab } from '../../shared/lib/location-menus'
import { housingApi } from '../../shared/api/housing.api'

const within = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/')

/** Нижняя полоса: в Центре — локации города, в локации — ЦЕНТР и её разделы. */
export function LocationTabs() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const menu = locationMenu(pathname, search)
  // Вышел из дома туннелем — пока он на том месте, внизу «В дом» (правка
  // заказчика 22.10). Пришёл туда не из дома — вкладки нет.
  const exit = useQuery({ queryKey: ['housing', 'exit', pathname], queryFn: housingApi.exit, enabled: menu.key !== 'center', staleTime: 15_000, retry: false })
  const back = useMutation({
    mutationFn: housingApi.returnHome,
    onSuccess: r => { void qc.invalidateQueries({ queryKey: ['housing'] }); navigate(r.to) },
  })
  const homeTab: LocationTab | null = exit.data?.via && exit.data.area.some(prefix => within(pathname, prefix))
    ? { key: 'home', label: 'В дом', to: '/housing' }
    : null
  const tabs = homeTab ? [...menu.tabs, homeTab] : menu.tabs
  const active = activeTabKey(menu.tabs, pathname, search)
  return <nav className={'city-locations' + (menu.key === 'center' ? '' : ' city-locations--place')}
    aria-label={menu.key === 'center' ? 'Локации Центра' : 'Разделы локации'}>
    {tabs.map(item => <button type="button" key={item.key}
      data-stage-nav={item.key} aria-current={active === item.key ? 'page' : undefined}
      className={(active === item.key ? 'is-active' : '') + (item.key === 'center' && menu.key !== 'center' ? ' is-center' : '')}
      disabled={item === homeTab && back.isPending}
      onClick={() => item === homeTab ? back.mutate() : navigate(item.to)}>{item.label}</button>)}
  </nav>
}
