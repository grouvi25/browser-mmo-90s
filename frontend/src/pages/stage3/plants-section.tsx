import { useQuery } from '@tanstack/react-query'
import { farmApi } from '../../shared/api/farm.api'
import { fmt, Skeleton, Fault } from './stage3-ui'

/** Справочник культур: что растёт, сколько ждать и кому уже доступно. */
export function PlantsSection() {
  const farm = useQuery({ queryKey: ['farm'], queryFn: farmApi.get })

  if (farm.isLoading) return <Skeleton rows={3} />
  if (farm.isError || !farm.data) return <Fault retry={() => farm.refetch()} />

  const hours = (minutes: number) =>
    minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ч ${minutes % 60 ? `${minutes % 60} мин` : ''}`.trim()

  return (
    <>
      <p className="s3-hint">
        Ваш уровень заготовителя: <b>{farm.data.professionLevel}</b>. Урожай идёт на склад персонажа —
        сдавать государству невыгодно, зарабатывают на продаже барам и на рынке.
      </p>
      <div className="s3-scroll">
        <table className="s3-table">
          <thead>
            <tr>
              <th>Культура</th><th>Рост</th><th>Урожай</th><th>Семена</th><th>Требование</th><th>Доступ</th>
            </tr>
          </thead>
          <tbody>
            {farm.data.crops.map(crop => (
              <tr key={crop.code} className={crop.available ? '' : 'is-locked'}>
                <td><b>{crop.name}</b></td>
                <td>{hours(crop.minutes)}</td>
                <td>{crop.yieldMin}–{crop.yieldMax}</td>
                <td>{fmt(crop.seedPrice)} ₽</td>
                <td>{crop.requiredLevel === 0 ? '—' : `заготовитель ${crop.requiredLevel}`}</td>
                <td>{crop.available ? <span className="ok">открыта</span> : <span className="muted">закрыта</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
