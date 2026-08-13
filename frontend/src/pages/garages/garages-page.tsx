// =============================================================
// Гаражи — двор с кооперативными гаражами. Отсюда ведут переходы
// в мастерскую, к улучшениям и в частные лавки.
// =============================================================
import { LocationView, type LocationAction } from '../../widgets/location-view/location-view'

const ACTIONS: LocationAction[] = [
  { key: 'repair', label: 'Мастерская', to: '/repair', hint: 'Починить снаряжение' },
  { key: 'upgrades', label: 'Улучшения', to: '/upgrades', hint: 'Усилить вещь навсегда, с риском' },
  { key: 'shops', label: 'Частные лавки', to: '/shops/private', hint: 'Снаряжение 2-го уровня и детали' },
]

export function GaragesPage() {
  return (
    <LocationView
      scene="garages"
      alt="Двор с гаражами"
      place="Гаражи · Кооператив «Ракета»"
      actions={ACTIONS}
    />
  )
}
