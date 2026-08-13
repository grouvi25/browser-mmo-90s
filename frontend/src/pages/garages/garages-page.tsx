// =============================================================
// Гаражи: сцена показывает место, комнаты выбираются в нижней полосе.
// =============================================================
import { LocationView } from '../../widgets/location-view/location-view'

export function GaragesPage() {
  return (
    <LocationView
      scene="garages"
      alt="Двор с гаражами"
      place="Гаражи · Кооператив «Ракета»"
      actions={[]}
    />
  )
}
