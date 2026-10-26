// =============================================================
// Экран боя на компьютере (правка заказчика 22.10).
//
// «Картинка самого персонажа слева должна быть так же статичной, как на
// локациях, чтобы не прыгала… противник так же, справа, где свободное
// место. А само поле боя больше, чтобы читабельно было. Чат ровно как в
// простой локации — он везде одинаковый должен быть».
//
// Поэтому бой собран на той же сцене 1550x900, что и город: та же
// подложка, верхняя строка, своя карточка на своём месте и тот же чат
// внизу. Середину вместо вьюпорта занимает поле, под ним — маленькие
// списки зон и крупный лог; справа, на свободном поле подложки, —
// карточка противника и кнопки хода.
//
// Сам экран только раскладывает готовые части: состояние боя, выбор
// зон и отправка хода живут в battle-page.tsx.
// =============================================================
import type { ReactNode } from 'react'

import { Stage } from '../../shared/lib/stage'
import { MENU_STAGE } from '../../shared/lib/layout-map'
import { PLATES } from '../../shared/ui/sprite'
import { CharacterCard, type CardProfile, type CardWounds } from '../../widgets/character-card/character-card'
import { CardCutout } from '../../widgets/character-card/card-cutout'
import { TopNav } from '../../widgets/city-nav/city-nav'
import { CityChatDock } from '../../widgets/city-feed/city-feed'
import './battle-desk.css'

/** Раскладка в координатах сцены. Левый край середины — правый край
    бумаги карточки (340.5) с зазором; правая колонка — свободное поле
    подложки от рамки вьюпорта (1245) до края сцены. Низ — кромка чата. */
export const DESK = {
  center: { x: 350, y: 38, w: 892, h: 662 },
  side: { x: 1250, y: 38, w: 294, h: 662 },
} as const

export function BattleDesk({
  playerWounds, playerHp, enemy, enemyWounds, enemyTag,
  header, field, blockZones, attackZones, log, actions, overlay,
}: {
  playerWounds?: CardWounds
  /** Своё здоровье в бою — из живого состояния, а не из профиля. */
  playerHp?: { hp: number; hpMax: number }
  enemy: CardProfile
  enemyWounds?: CardWounds
  /** Подпись над карточкой противника: «Цель», «Бот» и т. п. */
  enemyTag?: string
  header: ReactNode
  field: ReactNode
  blockZones: ReactNode
  attackZones: ReactNode
  log: ReactNode
  actions: ReactNode
  overlay?: ReactNode
}) {
  const plate = `-webkit-image-set(url("${PLATES['menu-plate@2x']}") 2x, url("${PLATES['menu-plate']}") 1x)`
  const wall = `-webkit-image-set(url("${PLATES['menu-bg@2x']}") 2x, url("${PLATES['menu-bg']}") 1x)`
  const box = (b: { x: number; y: number; w: number; h: number }) => ({ left: b.x, top: b.y, width: b.w, height: b.h })

  return (
    <Stage width={MENU_STAGE.w} height={MENU_STAGE.h} fit="contain" backdrop={wall} className="stage--menu battle-desk-stage">
      <div className="stage__plate" style={{ backgroundImage: plate, width: MENU_STAGE.w, height: MENU_STAGE.h }} />
      <TopNav />
      {/* Своя карточка — та же, что в городе, и на том же месте. */}
      <CharacterCard wounds={playerWounds} liveHp={playerHp} />

      <div className="battle-desk" style={box(DESK.center)}>
        {header}
        <div className="battle-desk__field">{field}</div>
        <div className="battle-desk__bottom">
          {blockZones}
          {attackZones}
          <div className="battle-desk__log">{log}</div>
        </div>
      </div>

      <aside className="battle-desk__side" style={box(DESK.side)} aria-label="Противник и ход">
        {enemyTag && <span className="battle-desk__tag">{enemyTag}</span>}
        <CardCutout width={DESK.side.w} profile={enemy} wounds={enemyWounds} className="is-enemy" />
        <div className="battle-desk__actions">{actions}</div>
      </aside>

      <CityChatDock />
      {overlay}
    </Stage>
  )
}
