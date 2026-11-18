// Метрика (пользователь 18.11): кто, откуда и как пришёл в игру, что сделал и вернулся ли.
// Источник ставится при регистрации (метки ссылки и сайт), дни в игре — по заходам,
// бои, смены и платежи — из базы. Учёт источников идёт с 18.11.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi, type MetricsReport } from '../admin-api'
import { Skeleton, Fault, Empty } from '../../stage3/stage3-ui'
import { when } from '../admin-ui'
import './metrics.css'

const PERIODS = [7, 30, 90] as const
const pct = (value: number | null | undefined) => (value == null ? '—' : `${String(value).replace('.', ',')}%`)
const num = (value: number) => value.toLocaleString('ru-RU')
const shortDay = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`

/** Столбики по дням: одна величина, одна ось, подсказка по наведению на столбик. */
function DayBars({ title, data, value, note }: {
  title: string
  data: MetricsReport['series']
  value: (row: MetricsReport['series'][number]) => number
  note: (row: MetricsReport['series'][number]) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const values = data.map(value)
  const max = Math.max(1, ...values)
  const width = 100 / Math.max(1, data.length)
  const shown = hover ?? data.length - 1
  return (
    <figure className="adm-graph mtr-bars">
      <figcaption>{title}</figcaption>
      <div className="mtr-bars__tip" aria-live="polite">
        <b>{data[shown] ? shortDay(data[shown].day) : ''}</b> {data[shown] ? note(data[shown]) : ''}
      </div>
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label={`${title}: максимум ${max} за день`}
        onMouseLeave={() => setHover(null)}>
        <line className="mtr-bars__base" x1="0" x2="100" y1="60" y2="60" />
        {data.map((row, i) => {
          const h = (values[i] / max) * 56
          return (
            <g key={row.day} onMouseEnter={() => setHover(i)}>
              {/* Зона наведения шире столбика: по тонкому столбику не попасть. */}
              <rect className="mtr-bars__hit" x={i * width} y="0" width={width} height="60" />
              {values[i] > 0 && (
                <rect className={'mtr-bars__bar' + (hover === i ? ' is-hover' : '')}
                  x={i * width + width * 0.15} y={60 - h} width={width * 0.7} height={h} rx="0.8" />
              )}
            </g>
          )
        })}
      </svg>
      <div className="adm-chart__legend">
        <span>{data[0] ? shortDay(data[0].day) : ''}</span>
        <span>максимум {num(max)}</span>
        <span>{data.length ? shortDay(data[data.length - 1].day) : ''}</span>
      </div>
    </figure>
  )
}

function CountTable({ title, rows, empty }: { title: string; rows: { label: string; count: number }[]; empty: string }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0)
  return (
    <section className="adm-card-block">
      <h4>{title}</h4>
      {rows.length === 0 ? <p className="adm-hint">{empty}</p> : (
        <table className="s3-table mtr-table">
          <tbody>{rows.slice(0, 15).map(row => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td className="num">{num(row.count)}</td>
              <td className="num mtr-dim">{pct(Math.round((row.count / total) * 1000) / 10)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  )
}

export function MetricsSection({ onGo }: { onGo: (tab: string, focus?: string) => void }) {
  const [days, setDays] = useState<number>(30)
  const [needle, setNeedle] = useState('')
  const report = useQuery({ queryKey: ['admin', 'metrics', days], queryFn: () => adminApi.metrics(days), refetchInterval: 60_000 })
  const d = report.data

  const players = (d?.players ?? []).filter(p => {
    const q = needle.trim().toLowerCase()
    return !q || [p.nickname, p.source, p.campaign ?? '', p.platform, p.invitedBy ?? ''].some(v => v.toLowerCase().includes(q))
  })

  return (
    <>
      <div className="adm-switch">
        {PERIODS.map(p => (
          <button key={p} type="button" className={days === p ? 'active' : ''} onClick={() => setDays(p)}>{p} дн.</button>
        ))}
      </div>

      {report.isLoading && <Skeleton rows={8} />}
      {report.isError && <Fault retry={() => report.refetch()} />}
      {d && (
        <>
          <div className="adm-cards adm-cards--wide">
            <div className="adm-card"><span>Регистраций за {d.days} дн.</span><b>{num(d.totals.registered)}</b></div>
            <div className="adm-card"><span>В игре сегодня</span><b>{num(d.totals.dau)}</b><em className="adm-card__note">за неделю {num(d.totals.wau)}, за месяц {num(d.totals.mau)}</em></div>
            <div className="adm-card"><span>Вернулись на другой день</span><b>{pct(d.retention.d1?.pct)}</b><em className="adm-card__note">через неделю {pct(d.retention.d7?.pct)}, через месяц {pct(d.retention.d30?.pct)}</em></div>
            <div className="adm-card"><span>Оплаты новичков</span><b>{num(d.totals.revenueRub)} ₽</b><em className="adm-card__note">всего игроков {num(d.totals.characters)}</em></div>
          </div>

          <section className="adm-graphs">
            <div className="mtr-graphs">
              <DayBars title="Регистрации по дням" data={d.series} value={r => r.regs} note={r => `${r.regs} рег.`} />
              <DayBars title="Заходили в игру по дням" data={d.series} value={r => r.active} note={r => `${r.active} чел., из них новых ${r.fresh}`} />
            </div>
          </section>

          <section className="adm-card-block">
            <h4>Откуда приходят</h4>
            {d.sources.length === 0 ? <Empty title="Регистраций за срок нет" hint={`Источники считаются с ${d.trackingSince.split('-').reverse().join('.')}.`} /> : (
              <div className="s3-scroll">
                <table className="s3-table mtr-table">
                  <thead><tr>
                    <th>Источник</th><th className="num">Рег.</th><th className="num">Персонаж</th><th className="num">Бой</th>
                    <th className="num">Смена</th><th className="num">Вернулись</th><th className="num">Через неделю</th><th className="num">Платили</th><th className="num">Оплаты</th>
                  </tr></thead>
                  <tbody>{d.sources.map(s => (
                    <tr key={s.source}>
                      <td>{s.source}</td>
                      <td className="num">{num(s.registered)}</td>
                      <td className="num">{num(s.withCharacter)}</td>
                      <td className="num">{num(s.fought)}</td>
                      <td className="num">{num(s.worked)}</td>
                      <td className="num">{pct(s.d1.pct)}<span className="mtr-dim"> из {s.d1.base}</span></td>
                      <td className="num">{s.d7.base ? <>{pct(s.d7.pct)}<span className="mtr-dim"> из {s.d7.base}</span></> : '—'}</td>
                      <td className="num">{num(s.paying)}</td>
                      <td className="num">{num(s.revenueRub)} ₽</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          <section className="adm-card-block">
            <h4>Путь новичка</h4>
            <ol className="mtr-funnel">
              {d.funnel.map(step => (
                <li key={step.step}>
                  <span>{step.step}</span>
                  <span className="mtr-funnel__track"><span className="mtr-funnel__fill" style={{ width: `${step.pct ?? 0}%` }} /></span>
                  <b>{num(step.count)}</b>
                  <span className="mtr-dim">{pct(step.pct)}</span>
                </li>
              ))}
            </ol>
          </section>

          <div className="mtr-grid">
            <CountTable title="Рекламные метки" rows={d.campaigns} empty="Ссылок с метками utm за срок не было." />
            <CountTable title="Сайты, с которых пришли" rows={d.referrers} empty="Переходов с других сайтов за срок не было." />
            <CountTable title="Где играют" rows={d.platforms} empty="Нет данных." />
            <CountTable title="Кого пригласили игроки" rows={d.invitedBy} empty="По приглашениям за срок никто не пришёл." />
            <CountTable title="Страница первого захода" rows={d.landings} empty="Нет данных." />
          </div>

          <section className="adm-card-block">
            <h4>Новички за {d.days} дн.</h4>
            <div className="s3-toolbar">
              <label>Поиск по нику, источнику, метке<input value={needle} onChange={e => setNeedle(e.target.value)} placeholder="например: yandex" /></label>
            </div>
            {players.length === 0 ? <p className="adm-hint">Никого.</p> : (
              <div className="s3-scroll">
                <table className="s3-table mtr-table">
                  <thead><tr>
                    <th>Игрок</th><th>Когда</th><th>Источник</th><th>Метка</th><th>Где играет</th><th>Пригласил</th>
                    <th className="num">Ур.</th><th className="num">Бои</th><th className="num">Смены</th><th className="num">Дней в игре</th><th>Был</th><th className="num">Оплаты</th><th />
                  </tr></thead>
                  <tbody>{players.map(p => (
                    <tr key={p.characterId ?? `${p.nickname}-${p.registeredAt}`}>
                      <td>{p.nickname}</td>
                      <td>{when(p.registeredAt)}</td>
                      <td>{p.source}</td>
                      <td>{p.campaign ?? '—'}</td>
                      <td>{p.platform}</td>
                      <td>{p.invitedBy ?? '—'}</td>
                      <td className="num">{p.level ?? '—'}</td>
                      <td className="num">{num(p.battles)}</td>
                      <td className="num">{num(p.shifts)}</td>
                      <td className="num">{num(p.daysActive)}</td>
                      <td>{p.lastSeen ? when(p.lastSeen) : '—'}</td>
                      <td className="num">{p.paidRub ? `${num(p.paidRub)} ₽` : '—'}</td>
                      <td>{p.characterId && <button type="button" className="adm-link" onClick={() => onGo('players', p.characterId!)}>открыть</button>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}
