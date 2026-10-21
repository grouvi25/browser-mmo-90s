// =============================================================
// «Нераспределённое» (правка заказчика 21.10): комнаты, которым ещё
// не нашли место в городе, собраны в одну локацию — их видно и в
// нижней полосе, и списком здесь, чтобы решить, куда что переносить.
// =============================================================
import { Link } from 'react-router-dom'
import { ViewportPanel } from '../../shared/ui/viewport-panel'
import { UNSORTED_ROOMS } from '../../shared/lib/location-menus'

export function UnsortedPage() {
  return (
    <ViewportPanel title="Нераспределённое" subtitle="Комнаты без своей локации">
      <p>Эти разделы пока не привязаны ни к одной локации города. Скажите, куда какой перенести.</p>
      <div className="city-cards">
        {UNSORTED_ROOMS.map(room => (
          <Link key={room.key} className="city-card" to={room.to}><h2>{room.label}</h2></Link>
        ))}
      </div>
    </ViewportPanel>
  )
}
