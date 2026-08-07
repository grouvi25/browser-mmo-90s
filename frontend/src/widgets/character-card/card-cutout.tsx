// =============================================================
// Карточка персонажа отдельным блоком — для мобильной оболочки.
//
// Карточка нарисована на общей подложке сцены, поэтому вырезаем
// её «окном»: внутри лежит та же сцена целиком, сдвинутая так,
// чтобы бумага карточки оказалась в начале координат, и
// отмасштабированная под ширину блока. Никаких отдельных
// картинок и никакой второй вёрстки карточки не нужно.
// =============================================================
import { MENU, MENU_STAGE } from '../../shared/lib/layout-map'
import { PLATES } from '../../shared/ui/sprite'
import { CharacterCard } from './character-card'

export function CardCutout({ width }: { width: number }) {
  const cut = MENU.card.cutout
  const k = width / cut.w
  const plate = `-webkit-image-set(url("${PLATES['menu-plate@2x']}") 2x, url("${PLATES['menu-plate']}") 1x)`

  return (
    <div
      className="card-cutout"
      style={{ width, height: cut.h * k }}
    >
      <div
        className="card-cutout__inner"
        style={{
          width: MENU_STAGE.w,
          height: MENU_STAGE.h,
          transform: `scale(${k}) translate(${-cut.x}px, ${-cut.y}px)`,
        }}
      >
        <div className="stage__plate" style={{ backgroundImage: plate }} />
        <CharacterCard />
      </div>
    </div>
  )
}
