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

import { MENU, MENU_GAME_H, MENU_STAGE } from '../../shared/lib/layout-map'
import { useChatOpen } from '../../shared/lib/use-chat-open'
import { useIsMobile } from '../../shared/lib/use-media-query'
import { MobileShell } from './mobile-shell'
import { Stage } from '../../shared/lib/stage'
import { PLATES } from '../../shared/ui/sprite'
import { CharacterCard } from '../../widgets/character-card/character-card'
import { BottomTabs, DistrictTabs, TopNav } from '../../widgets/city-nav/city-nav'
import { CityChatDock } from '../../widgets/city-feed/city-feed'

export function GameShell() {
  // Узкий экран получает свою композицию: сцена по макету на нём
  // ужимается до нечитаемого. Данные и графика — те же.
  const isMobile = useIsMobile()
  const [chatOpen, toggleChat] = useChatOpen()
  if (isMobile) return <MobileShell />

  const plate = `-webkit-image-set(url("${PLATES['menu-plate@2x']}") 2x, url("${PLATES['menu-plate']}") 1x)`
  // За сценой — тот самый слой фона из макета («Слой 22» в «Фон
  // основного мнею 3.psd»), вырезанный отдельно: голая акварельная
  // стена без единого элемента интерфейса. Раньше туда шла размытая
  // копия всей подложки, и края читались серой каймой.
  const wall = `-webkit-image-set(url("${PLATES['menu-bg@2x']}") 2x, url("${PLATES['menu-bg']}") 1x)`

  // Высота сцены зависит от чата, и это не украшение, а правило:
  // развёрнутый чат — полная композиция макета, свёрнутый — только
  // игровая часть, которая в том же окне вписывается крупнее. Чат либо
  // занимает своё место, либо освобождает его — но не накрывает собой
  // интерфейс.
  return (
    <Stage
      width={MENU_STAGE.w}
      height={chatOpen ? MENU_STAGE.h : MENU_GAME_H}
      fit="contain"
      backdrop={wall}
      className="stage--menu"
    >
      {/* Подложка держит полный холст 1550x900 и обрезается сценой снизу:
          растягивать её по укороченной сцене нельзя — рисунок сплющится. */}
      <div
        className="stage__plate"
        style={{ backgroundImage: plate, width: MENU_STAGE.w, height: MENU_STAGE.h }}
      />

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

      <CityChatDock open={chatOpen} onToggle={toggleChat} />
    </Stage>
  )
}
