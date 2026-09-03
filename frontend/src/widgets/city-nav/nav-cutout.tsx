// =============================================================
// Шапка города отдельной полосой — для экранов вне общей сцены.
//
// Тот же приём, что у карточки персонажа: внутри лежит сцена
// главного экрана целиком, сдвинутая так, чтобы полоса верхнего
// меню оказалась в начале координат, и отмасштабированная под
// ширину блока. Ни второй вёрстки меню, ни второй картинки
// плашки не появляется — рисунок и ссылки те же самые.
//
// Нужна боевому экрану: без шапки из боя некуда выйти, и он
// выглядел куском другой игры.
// =============================================================
import { MENU, MENU_STAGE } from '../../shared/lib/layout-map'
import { PLATES } from '../../shared/ui/sprite'
import { TopNav } from './city-nav'

export function NavCutout({ width }: { width: number }) {
  const cut = MENU.navStrip
  const k = width / cut.w
  const plate = `-webkit-image-set(url("${PLATES['menu-plate@2x']}") 2x, url("${PLATES['menu-plate']}") 1x)`

  return (
    <div className="nav-cutout" style={{ width, height: cut.h * k }}>
      <div
        className="nav-cutout__inner"
        style={{
          width: MENU_STAGE.w,
          height: MENU_STAGE.h,
          transform: `scale(${k}) translate(${-cut.x}px, ${-cut.y}px)`,
        }}
      >
        <div className="stage__plate" style={{ backgroundImage: plate }} />
        <TopNav />
      </div>
    </div>
  )
}
