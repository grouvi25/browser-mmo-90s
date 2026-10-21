// =============================================================
// Оболочка игры — главный экран макета.
//
// Постоянные элементы (карточка персонажа, навигация, чат,
// онлайн) живут здесь и не перерисовываются при переходах.
// Меняется только центральный вьюпорт: туда рендерятся
// магазин, мастерская, арена, инвентарь и остальные экраны.
// ============================================================
import { LocationPersistence } from '../location-persistence'
import { ApplicationWatcher } from '../application-watcher'
import { Outlet } from 'react-router-dom'

import { ErrorBoundary } from '../error-boundary'

import { MENU, MENU_STAGE } from '../../shared/lib/layout-map'
import { useIsMobile } from '../../shared/lib/use-media-query'
import { MobileShell } from './mobile-shell'
import { Stage } from '../../shared/lib/stage'
import { PLATES } from '../../shared/ui/sprite'
import { CharacterCard } from '../../widgets/character-card/character-card'
import { LocationTabs } from '../../widgets/city-nav/location-tabs'
import { TopNav } from '../../widgets/city-nav/city-nav'
import { CityChatDock } from '../../widgets/city-feed/city-feed'

export function GameShell() {
  // Узкий экран получает свою композицию: сцена по макету на нём
  // ужимается до нечитаемого. Данные и графика — те же.
  const isMobile = useIsMobile()
  if (isMobile) return <><LocationPersistence /><ApplicationWatcher /><MobileShell /></>

  const plate = `-webkit-image-set(url("${PLATES['menu-plate@2x']}") 2x, url("${PLATES['menu-plate']}") 1x)`
  // За сценой — тот самый слой фона из макета («Слой 22» в «Фон
  // основного мнею 3.psd»), вырезанный отдельно: голая акварельная
  // стена без единого элемента интерфейса. Раньше туда шла размытая
  // копия всей подложки, и края читались серой каймой.
  const wall = `-webkit-image-set(url("${PLATES['menu-bg@2x']}") 2x, url("${PLATES['menu-bg']}") 1x)`

  // Чат статичный (правка заказчика): сцена всегда полная, 1550x900,
  // полоса чата занимает своё место макета и не сворачивается.
  return (
    <Stage
      width={MENU_STAGE.w}
      height={MENU_STAGE.h}
      fit="contain"
      backdrop={wall}
      className="stage--menu"
    >
      <LocationPersistence />
      <ApplicationWatcher />
      {/* Подложка держит полный холст 1550x900 и обрезается сценой снизу:
          растягивать её по укороченной сцене нельзя — рисунок сплющится. */}
      <div
        className="stage__plate"
        style={{ backgroundImage: plate, width: MENU_STAGE.w, height: MENU_STAGE.h }}
      />

      {/* Верхняя строка макета вернулась (правка заказчика 21.10): «вернуть
          строчку Переподключиться к игре, форум, обновления, новости, Выход
          из аккаунта в самый верх». Её закрывала заглушка фоном, а под
          карточкой стояли «Профиль / Радио / Выход». */}
      <TopNav />
      <LocationTabs />
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

      <CityChatDock />
    </Stage>
  )
}
