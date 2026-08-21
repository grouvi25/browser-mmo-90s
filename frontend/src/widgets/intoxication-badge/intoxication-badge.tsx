// =============================================================
// Значок градуса в карточке персонажа. Появляется только когда
// персонаж пьян или в похмелье — в трезвом состоянии карточка
// выглядит ровно так же, как до Этапа 3.
// =============================================================
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { barsApi } from '../../shared/api/bars.api'
import { MENU } from '../../shared/lib/layout-map'
import { Layer } from '../../shared/lib/stage'
import './intoxication-badge.css'

const STATE_LABEL: Record<string, string> = {
  SOBER: 'Трезв',
  TIPSY: 'Навеселе',
  DRUNK: 'Пьяный',
  WASTED: 'В хлам',
}

/** Время до трезвости считает сервер, клиент только показывает остаток. */
function untilText(soberAt: string | null, hangoverUntil: string | null): string {
  const target = hangoverUntil ?? soberAt
  if (!target) return ''
  const left = new Date(target).getTime() - Date.now()
  if (left <= 0) return ''
  const minutes = Math.ceil(left / 60_000)
  return minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}

export function IntoxicationBadge() {
  const navigate = useNavigate()
  const status = useQuery({
    queryKey: ['bars', 'status'],
    queryFn: barsApi.status,
    refetchInterval: 60_000,
    retry: false,
  })

  const data = status.data
  if (!data) return null

  const hungover = Boolean(data.hangoverUntil && new Date(data.hangoverUntil) > new Date())
  // Трезвому и без похмелья значок не нужен — не занимаем место на бумаге.
  if (data.level <= 0 && !hungover) return null

  const label = hungover ? 'Похмелье' : STATE_LABEL[data.state] ?? data.state
  const left = untilText(data.soberAt, hungover ? data.hangoverUntil : null)

  return (
    <Layer
      box={MENU.card.intoxication}
      as="button"
      className={'intox-badge' + (data.canBattle ? '' : ' intox-badge--blocked')}
      onClick={() => navigate('/bars')}
      title={
        `${label}: градус ${Math.round(data.level)}`
        + (left ? `, ещё ${left}` : '')
        + (data.canBattle ? '' : '. В бой в таком виде не пускают')
      }
    >
      <span className="intox-badge__degree">{Math.round(data.level)}°</span>
      <span className="intox-badge__state">{label}</span>
      {left && <span className="intox-badge__left">{left}</span>}
    </Layer>
  )
}
