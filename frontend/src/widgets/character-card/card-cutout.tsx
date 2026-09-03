// =============================================================
// Карточка персонажа отдельным блоком — для мобильной оболочки
// и для боковых полей боевого экрана.
//
// Карточка нарисована на общей подложке сцены, поэтому вырезаем
// её «окном»: внутри лежит та же сцена целиком, сдвинутая так,
// чтобы бумага карточки оказалась в начале координат, и
// отмасштабированная под ширину блока. Никаких отдельных
// картинок и никакой второй вёрстки карточки не нужно.
//
// `profile` включает режим чужого профиля: тот же рисунок на той
// же бумаге, но данные приходят снаружи. Так противник на экране
// боя выглядит ровно как персонаж в городе, а не отдельной
// самодельной плашкой.
// =============================================================
import { MENU, MENU_STAGE } from '../../shared/lib/layout-map'
import { PLATES } from '../../shared/ui/sprite'
import { CharacterCard, type CardProfile } from './character-card'

export function CardCutout({ width, profile, className = '' }: {
  width: number
  profile?: CardProfile
  className?: string
}) {
  const cut = MENU.card.cutout
  const k = width / cut.w
  const plate = `-webkit-image-set(url("${PLATES['menu-plate@2x']}") 2x, url("${PLATES['menu-plate']}") 1x)`

  return (
    <div
      className={`card-cutout ${className}`.trim()}
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
        <CharacterCard profile={profile} />
      </div>
    </div>
  )
}
