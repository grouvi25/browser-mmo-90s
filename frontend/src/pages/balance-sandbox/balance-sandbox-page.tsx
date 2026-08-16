import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  balanceSandboxApi,
  type SandboxInput,
  type SandboxRow,
} from '../../shared/api/balance-sandbox.api'
import './balance-sandbox.css'

const profileLabels = { fighter: 'Боец', worker: 'Рабочий', mixed: 'Смешанный' }
const verdictLabels = {
  profileParity: 'Профили сопоставимы',
  sinkHealth: 'Стоки в норме',
  m2Growth: 'Рост денежной массы',
  nonNegative: 'Нет банкротств',
}

const presets: Record<string, SandboxInput> = {
  Базовый: { days: 30, players: 300, salary: 100, battleReward: 55, repairCost: 200, marketPrice: 160, shiftMinutes: 45, winRate: 60 },
  'Долгий цикл': { days: 180, players: 1_500, salary: 90, battleReward: 45, repairCost: 260, marketPrice: 220, shiftMinutes: 60, winRate: 55 },
  'Щедрый мир': { days: 30, players: 600, salary: 180, battleReward: 90, repairCost: 120, marketPrice: 150, shiftMinutes: 30, winRate: 70 },
}

const money = (value: number) => `${Math.round(value).toLocaleString('ru')} ₽`
const percent = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`

export function BalanceSandboxPage() {
  const [input, setInput] = useState<SandboxInput>(presets.Базовый)
  const result = useQuery({
    queryKey: ['balance-sandbox', input],
    queryFn: () => balanceSandboxApi.simulate(input),
    placeholderData: previous => previous,
  })
  const data = result.data
  const rows = data?.rows ?? []
  const stable = data ? Object.values(data.verdicts).every(Boolean) : false
  const set = (key: keyof SandboxInput) => (value: number) => setInput(current => ({ ...current, [key]: value }))

  const exportJson = () => {
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'balance-sandbox.json'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return <main className="balance-sandbox">
    <header className="sandbox-head">
      <div>
        <span className="sandbox-kicker">ТЕХНИЧЕСКАЯ ПЕСОЧНИЦА · ЭТАП 2</span>
        <h1>Баланс-лаборатория</h1>
        <p>Прогоняет бой, работу, рынок, ремонт и денежные стоки теми же формулами, что использует игра.</p>
      </div>
      <div className="sandbox-head-actions">
        <span className={`sandbox-stamp ${stable ? 'is-ok' : 'is-fail'}`}>{stable ? 'КОНТУР СТАБИЛЕН' : 'НУЖНА НАСТРОЙКА'}</span>
        <button className="sandbox-export" disabled={!data} onClick={exportJson}>Скачать JSON</button>
      </div>
    </header>

    <nav className="sandbox-presets" aria-label="Готовые сценарии">
      <span>Сценарий:</span>
      {Object.entries(presets).map(([name, values]) => <button key={name} className={JSON.stringify(values) === JSON.stringify(input) ? 'is-active' : ''} onClick={() => setInput(values)}>{name}</button>)}
    </nav>

    <section className="sandbox-controls" aria-label="Параметры симуляции">
      <Control label="Дней" value={input.days} min={8} max={365} set={set('days')} />
      <Control label="Игроков" value={input.players} min={30} max={3_000} step={30} set={set('players')} />
      <Control label="Базовая зарплата" value={input.salary} min={40} max={300} suffix=" ₽" set={set('salary')} />
      <Control label="Длительность смены" value={input.shiftMinutes} min={30} max={90} step={15} suffix=" мин" set={set('shiftMinutes')} />
      <Control label="Награда за бой" value={input.battleReward} min={10} max={150} suffix=" ₽" set={set('battleReward')} />
      <Control label="Победы" value={input.winRate} min={10} max={95} step={5} suffix="%" set={set('winRate')} />
      <Control label="Ремонт" value={input.repairCost} min={50} max={800} step={10} suffix=" ₽" set={set('repairCost')} />
      <Control label="Цена сделки" value={input.marketPrice} min={50} max={1_000} step={10} suffix=" ₽" set={set('marketPrice')} />
    </section>

    {result.isError ? <div className="sandbox-error">Симуляция не запустилась. Проверь соединение и повтори.</div> : <>
      <section className="sandbox-ledger" aria-busy={result.isFetching}>
        <Metric label="Деньги из мира" value={data ? money(data.totals.minted) : '…'} />
        <Metric label="Деньги из игры" value={data ? money(data.totals.burned) : '…'} />
        <Metric label="Доля стоков" value={data ? percent(data.totals.sinkShare) : '…'} tone={data?.verdicts.sinkHealth ? 'ok' : 'fail'} note={data ? `цель от ${percent(data.meta.targets.minSinkShare)}` : undefined} />
        <Metric label="Рост M2 в день" value={data ? percent(data.totals.dailyM2Growth, 1) : '…'} tone={data?.verdicts.m2Growth ? 'ok' : 'fail'} note={data ? `предел ${percent(data.meta.targets.maxDailyM2Growth)}` : undefined} />
      </section>

      <section className="sandbox-sheet">
        <div className="sandbox-section-title">
          <div><span>СРАВНЕНИЕ СТРАТЕГИЙ</span><h2>Кто богатеет быстрее</h2></div>
          <small>Лимит труда: {data?.meta.limits.minutes ?? 360} минут и до {data?.meta.limits.shifts ?? 12} смен</small>
        </div>
        <div className="sandbox-ruler" aria-hidden="true"><span>Профиль</span><span>Динамика</span><span>Итог</span><span>В день</span><span>Нагрузка</span></div>
        <div className="sandbox-results" aria-busy={result.isFetching}>
          {rows.map(row => <article key={row.profile}>
            <div className="sandbox-profile"><strong>{profileLabels[row.profile]}</strong><small>стоки {percent(row.sinkShare)}</small></div>
            <Sparkline row={row} />
            <b>{money(row.money)}</b>
            <span className={row.netPerDay >= 0 ? 'positive' : 'negative'}>{row.netPerDay >= 0 ? '+' : ''}{money(row.netPerDay)} / день</span>
            <span>{row.shiftsPerDay} смен · {row.minutesPerDay} мин</span>
          </article>)}
        </div>
      </section>

      <section className="sandbox-diagnostics">
        <div>
          <span className="sandbox-kicker">АВТОПРОВЕРКА</span>
          <h2>Вердикт модели</h2>
          <div className="sandbox-verdicts">{data && Object.entries(data.verdicts).map(([key, ok]) => <span key={key} className={ok ? 'is-ok' : 'is-fail'}><i aria-hidden="true">{ok ? '✓' : '!'}</i>{verdictLabels[key as keyof typeof verdictLabels]}</span>)}</div>
        </div>
        <div className="sandbox-notes">
          <span>ЧТО ПРАВИТЬ</span>
          {data?.recommendations.length ? <ol>{data.recommendations.map(note => <li key={note}>{note}</li>)}</ol> : <p>Критичных перекосов в выбранном сценарии нет.</p>}
        </div>
      </section>
    </>}
  </main>
}

function Metric({ label, value, tone, note }: { label: string; value: string; tone?: 'ok' | 'fail'; note?: string }) {
  return <div className={`sandbox-metric ${tone ? `is-${tone}` : ''}`}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>
}

function Control({ label, value, min, max, step = 1, suffix = '', set }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; set: (value: number) => void }) {
  return <label><span>{label}</span><output>{value.toLocaleString('ru')}{suffix}</output><input aria-label={label} type="range" value={value} min={min} max={max} step={step} onChange={event => set(Number(event.target.value))} /></label>
}

function Sparkline({ row }: { row: SandboxRow }) {
  const width = 220
  const height = 48
  const values = row.timeline.map(point => point.money)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  const points = row.timeline.map((point, index) => `${index / Math.max(1, row.timeline.length - 1) * width},${height - (point.money - min) / range * (height - 6) - 3}`).join(' ')
  return <svg className="sandbox-spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Динамика капитала: от ${money(values[0])} до ${money(values[values.length - 1] ?? 0)}`}><path d={`M0 ${height - 3}H${width}`} /><polyline points={points} /></svg>
}
