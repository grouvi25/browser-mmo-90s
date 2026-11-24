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
      {injury.reanimation
        ? <p>Вы в реанимации: бои, работа, торговля и переходы закрыты. Вещи сохранены. Чат и поддержка работают.</p>
        : injury.blocksCombat
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

const hours = (minutes: number) => (minutes % 60 ? `${minutes} мин` : `${minutes / 60} ч`)

/** Реанимация: пациент сам сокращает отлёжку — рублями или через ЧМЦ. */
function Reanimation({ injury, refresh }: { injury: InjuryView; refresh: () => Promise<unknown> }) {
  const shorten = useMutation({ mutationFn: hospitalApi.shorten, onSuccess: refresh })
  const r = injury.reanimation!
  return (
    <section className="panel">
      <div className="panel-header"><h2 className="panel-title">Реанимация</h2></div>
      <div className="panel-body">
        <InjuryState injury={injury} />
        {r.floor && <p className="hospital__muted">Раньше {clock(r.floor)} не выписывают, сколько ни плати.</p>}
        <div className="hospital__actions">
          {r.self && (
            <button type="button" className="btn btn-primary" disabled={shorten.isPending} onClick={() => shorten.mutate('SELF')}>
              {shorten.isPending && shorten.variables === 'SELF' ? 'Оплачиваю…' : `−${hours(r.self.minutes)} за ${rub(r.self.rubles)}`}
            </button>
          )}
          {r.clinic && (
            <button type="button" className="btn" disabled={shorten.isPending} onClick={() => shorten.mutate('CLINIC')}>
              {shorten.isPending && shorten.variables === 'CLINIC' ? 'Оплачиваю…' : `ЧМЦ: −${hours(r.clinic.minutes)} за ${r.clinic.dollars} $`}
            </button>
          )}
        </div>
        {!r.self && !r.clinic && <p>Сокращать дальше некуда: ждите выписки.</p>}
        <p className="hospital__muted">Бригада может оплатить сокращение из общака: попросите товарищей в чате.</p>
        {shorten.error && <p className="alert alert-error" role="alert">{shorten.error.message}</p>}
      </div>
    </section>
  )
}

/** Бойцы своей бригады в реанимации: заявка «перевод из общака → больница». */
function BrigadeAid({ brigade, refresh }: { brigade: NonNullable<HospitalStatus['brigade']>; refresh: () => Promise<unknown> }) {
  const aid = useMutation({ mutationFn: hospitalApi.aid, onSuccess: refresh })
  return (
    <section className="panel">
      <div className="panel-header"><h2 className="panel-title">Свои в реанимации</h2></div>
      <div className="panel-body">
        <p className="hospital__muted">
          В общаке {rub(brigade.treasury)}. Ваш авторитет: {brigade.level} ({brigade.authority}).
          {brigade.debt > 0 && ` Ваш долг перед общаком: ${rub(brigade.debt)}.`}
        </p>
        {brigade.patients.length === 0 && <p>Сейчас все свои на ногах.</p>}
        <ul className="hospital__patients">
          {brigade.patients.map(p => (
            <li key={p.id}>
              <div>
                <b>{p.nickname}</b> · {p.title} до {clock(p.until)}
                <div className="hospital__muted">{p.level}{p.limit !== undefined && ` · заявок ${p.used} из ${p.limit}`}{p.reason && ` · ${p.reason}`}</div>
              </div>
              {p.offer && (
                <button type="button" className="btn btn-sm" disabled={aid.isPending || !!p.reason || brigade.treasury < p.offer.rubles}
                  onClick={() => aid.mutate(p.id)}>
                  {aid.isPending && aid.variables === p.id ? 'Перевожу…' : `−${hours(p.offer.minutes)} за ${rub(p.offer.rubles)}`}
                </button>
              )}
            </li>
          ))}
        </ul>
        {aid.error && <p className="alert alert-error" role="alert">{aid.error.message}</p>}
      </div>
    </section>
  )
}

export function HospitalPage() {
  const { status, refresh } = useHospital()
  const treat = useMutation({ mutationFn: hospitalApi.treat, onSuccess: refresh })
  if (!status.data) return <Loading status={status} />
  const { injury, prices, brigade }: HospitalStatus = status.data

  if (injury?.reanimation) return <div className="hospital"><Reanimation injury={injury} refresh={refresh} /></div>

  return (
    <div className="hospital">
      {brigade && brigade.patients.length > 0 && <BrigadeAid brigade={brigade} refresh={refresh} />}
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
