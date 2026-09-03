// Обзор: четыре числа и состояние сверок. Ничего больше — раздел нужен,
// чтобы понять «жива ли база вообще», а не чтобы изучать по нему экономику.
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '../admin-api'
import { Skeleton, Fault } from '../../stage3/stage3-ui'
import { rub } from '../admin-ui'

export function OverviewSection() {
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: adminApi.stats })
  const signals = useQuery({ queryKey: ['admin', 'signals', 'OPEN'], queryFn: () => adminApi.signals('OPEN') })

  if (stats.isLoading) return <Skeleton rows={3} />
  if (stats.isError) return <Fault retry={() => stats.refetch()} />

  const open = signals.data?.items ?? []
  const worst = open.filter(item => item.severity === 3).length

  return (
    <>
      <div className="adm-cards">
        <Card label="Пользователи" value={stats.data!.users} />
        <Card label="Персонажи" value={stats.data!.characters} />
        <Card label="Бои" value={stats.data!.battles} />
        <Card label="Предметы" value={stats.data!.items} />
      </div>

      <p className={worst > 0 ? 'adm-alert adm-bad' : 'adm-alert'}>
        {open.length === 0
          ? 'Открытых сигналов антиабуза нет.'
          : `Открытых сигналов: ${open.length}${worst > 0 ? `, из них тяжёлых: ${worst}` : ''}.`}
        {worst > 0 && ' Тяжёлый сигнал — это «остановить и разобраться», а не «забанить».'}
      </p>
    </>
  )
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="adm-card">
      <span>{label}</span>
      <b>{rub(value)}</b>
    </div>
  )
}
