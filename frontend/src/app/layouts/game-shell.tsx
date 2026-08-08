// =============================================================
// Оболочка игры — главный экран макета.
//
// Постоянные элементы (карточка персонажа, навигация, чат,
// онлайн) живут здесь и не перерисовываются при переходах.
// Меняется только центральный вьюпорт: туда рендерятся
// магазин, мастерская, арена, инвентарь и остальные экраны.
// ============================================================
import { Outlet } from 'react-router-dom'

import { ErrorBoundary } from '../error-boundary'

import { MENU, MENU_STAGE } from '../../shared/lib/layout-map'
import { useIsMobile } from '../../shared/lib/use-media-query'
import { MobileShell } from './mobile-shell'
import { Stage } from '../../shared/lib/stage'
import { PLATES } from '../../shared/ui/sprite'
import { CharacterCard } from '../../widgets/character-card/character-card'
import { BottomTabs, DistrictTabs, TopNav } from '../../widgets/city-nav/city-nav'
import { CityChat, OnlineList } from '../../widgets/city-feed/city-feed'

export function GameShell() {
  // Узкий экран получает свою композицию: сцена по макету на нём
  // ужимается до нечитаемого. Данные и графика — те же.
  const isMobile = useIsMobile()
  if (isMobile) return <MobileShell />

  const plate = `-webkit-image-set(url("${PLATES['menu-plate@2x']}") 2x, url("${PLATES['menu-plate']}") 1x)`

  return (
    <Stage width={MENU_STAGE.w} height={MENU_STAGE.h} fit="contain" className="stage--menu">
      <div className="stage__plate" style={{ backgroundImage: plate }} />

      <TopNav />
      <DistrictTabs />
      <BottomTabs />
      <CharacterCard />

      <div
        className="viewport"
        style={{
          left: MENU.viewport.x, top: MENU.viewport.y,
          width: MENU.viewport.w, height: MENU.viewport.h,
        }}
      >
        <ErrorBoundary><Outlet /></ErrorBoundary>
      </div>

      <CityChat />
      <OnlineList />
    </Stage>
  )
}
