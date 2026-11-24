// =============================================================
// Городская больница (травмпункт) и ЧМЦ — травмы после боёв на
// Стрелках, документ Димы v8 (24.11). Травмпункт: рубли и короткое
// ожидание, вывеска с ценами видна сразу. ЧМЦ: доллары, готов сразу.
// =============================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hospitalApi, type HospitalStatus, type InjuryView } from '../../shared/api/hospital.api'
import './hospital.css'

const rub = (value: number) => value.toLocaleString('ru-RU') + ' ₽'
const clock = (value: string) => new Date(value).toLocaleTimeString('ru-RU', {
  timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit',
}) + ' мск'

function useHospital() {
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['hospital'], queryFn: hospitalApi.status, refetchInterval: 30_000 })
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['hospital'] }),
    qc.invalidateQueries({ queryKey: ['character'] }),
    qc.invalidateQueries({ queryKey: ['dollars'] }),
  ])
  return { status, refresh }
}

function InjuryState({ injury }: { injury: InjuryView }) {
  return (
    <div className="hospital__state">
      <h3 className="hospital__title">{injury.title}</h3>
      <p>{injury.treated ? 'Лечение оплачено, будете готовы' : 'Пройдёт само'} к {clock(injury.until)}.</p>
      {injury.blocksCombat
        ? <p>Бои закрыты. Работать, торговать, чинить и ходить по городу можно. Напасть на вас тоже нельзя.</p>
        : <p>Урон и уворот −{injury.penaltyPercent}%, опыт за бой ×{String(injury.expMultiplier).replace('.', ',')}.</p>}
    </div>
  )
}

function Loading({ status }: { status: ReturnType<typeof useHospital>['status'] }) {
  if (status.isPending) return <p role="status">Смотрим карту…</p>
  if (status.isError) {
    return (
      <div className="alert alert-error" role="alert">
        {status.error.message}{' '}
        <button type="button" className="btn btn-sm" onClick={() => status.refetch()}>Повторить</button>
      </div>
    )
  }
  return null
}

export function HospitalPage() {
  const { status, refresh } = useHospital()
  const treat = useMutation({ mutationFn: hospitalApi.treat, onSuccess: refresh })
  if (!status.data) return <Loading status={status} />
  const { injury, prices }: HospitalStatus = status.data

  return (
    <div className="hospital">
      <section className="panel">
        <div className="panel-header"><h2 className="panel-title">Лечение травм — травмпункт</h2></div>
        <div className="panel-body">
          <ul className="hospital__sign">
            {prices.hospital.map(row => (
              <li key={row.tier}>
                <span>{row.title}</span>
                <b>{rub(row.rubles)}</b>
                <span className="hospital__muted">ожидание {row.waitMinutes} мин</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h2 className="panel-title">Регистратура</h2></div>
        <div className="panel-body">
          {!injury && <p>Вы здоровы. Лечить нечего.</p>}
          {injury && <InjuryState injury={injury} />}
          {injury?.hospital && (
            <button type="button" className="btn btn-primary" disabled={treat.isPending} onClick={() => treat.mutate()}>
              {treat.isPending ? 'Оплачиваю…' : `Лечить за ${rub(injury.hospital.rubles)}`}
            </button>
          )}
          {treat.error && <p className="alert alert-error" role="alert">{treat.error.message}</p>}
        </div>
      </section>
    </div>
  )
}

export function ClinicPage() {
  const { status, refresh } = useHospital()
  const heal = useMutation({ mutationFn: hospitalApi.clinic, onSuccess: refresh })
  if (!status.data) return <Loading status={status} />
  const { injury, prices }: HospitalStatus = status.data

  return (
    <div className="hospital">
      <section className="panel">
        <div className="panel-header"><h2 className="panel-title">Частный медицинский центр</h2></div>
        <div className="panel-body">
          <ul className="hospital__sign">
            {prices.clinic.map(row => (
              <li key={row.tier}>
                <span>{row.title}</span>
                <b>{row.dollars} $</b>
                <span className="hospital__muted">сразу</span>
              </li>
            ))}
          </ul>
          {!injury && <p>Вы здоровы. Лечить нечего.</p>}
          {injury && <InjuryState injury={injury} />}
          {injury && !injury.clinic && <p>Лёгкие травмы здесь не лечат: это в травмпункт больницы.</p>}
          {injury?.clinic && (
            <button type="button" className="btn btn-primary" disabled={heal.isPending} onClick={() => heal.mutate()}>
              {heal.isPending ? 'Оплачиваю…' : `Вылечиться за ${injury.clinic.dollars} $`}
            </button>
          )}
          {heal.error && <p className="alert alert-error" role="alert">{heal.error.message}</p>}
        </div>
      </section>
    </div>
  )
}
