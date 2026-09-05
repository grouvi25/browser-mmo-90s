// =============================================================
// Дашборд.
//
// Раньше здесь висели четыре счётчика и строчка про сигналы — по ним нельзя
// было ни понять состояние игры, ни что-либо сделать. Теперь экран отвечает
// на три вопроса подряд: всё ли в порядке, куда смотреть, и что нажать.
//
// Правило раздела: ни одного числа, из которого некуда пойти. Каждая
// карточка либо ведёт в свой раздел, либо объясняет, почему она такая.
// =============================================================
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
import { adminApi, type EconomySnapshot } from '../admin-api'
import { Skeleton, Fault } from '../../stage3/stage3-ui'
import { Chart, rub } from '../admin-ui'

/** Пороги здоровья — те же, что у воркера (BalanceConfig.economy.alerts). */
const MIN_SINK_SHARE = 0.40
const MAX_M2_GROWTH = 0.05
const MAX_GINI = 0.75

const pct = (value: number) => `${Math.round(value * 100)}%`
const day = (iso: string) => iso.slice(8, 10) + '.' + iso.slice(5, 7)

export function OverviewSection({ onGo }: { onGo: (tab: string) => void }) {
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: adminApi.stats })
  const economy = useQuery({ queryKey: ['admin', 'economy'], queryFn: adminApi.economyOverview })
  const history = useQuery({ queryKey: ['admin', 'economy', 'history'], queryFn: () => adminApi.economyHistory(30) })
  const signals = useQuery({ queryKey: ['admin', 'signals', 'OPEN'], queryFn: () => adminApi.signals('OPEN') })

  if (stats.isLoading || economy.isLoading) return <Skeleton rows={4} />
  if (stats.isError) return <Fault retry={() => stats.refetch()} />
  if (economy.isError) return <Fault retry={() => economy.refetch()} />

  const open = signals.data?.items ?? []
  const heavy = open.filter(item => item.severity === 3)
  const rows = history.data?.items ?? []
  const latest: EconomySnapshot | null = economy.data?.latestMetrics ?? rows[rows.length - 1] ?? null
  const days = rows.map(row => day(row.date))

  return (
    <>
      <Verdict latest={latest} heavy={heavy.length} open={open.length} onGo={onGo} />

      <div className="adm-cards adm-cards--wide">
        <Tile
          label="Денег у игроков"
          value={rub(economy.data!.m2Total) + ' ₽'}
          note={latest?.m2Growth != null
            ? `за сутки ${latest.m2Growth >= 0 ? '+' : ''}${pct(latest.m2Growth)}`
            : 'динамика появится после первого снимка'}
          bad={latest?.m2Growth != null && latest.m2Growth > MAX_M2_GROWTH}
        />
        <Tile
          label="Персонажей"
          value={rub(economy.data!.characters)}
          note={`учётных записей ${rub(stats.data!.users)}`}
          onClick={() => onGo('clans')}
          action="к бригадам"
        />
        <Tile
          label="Смен идёт"
          value={rub(economy.data!.activeShifts)}
          note={latest ? `закрыто за сутки ${rub(latest.completedShifts)}` : 'сейчас на объектах'}
        />
        <Tile
          label="Лотов на рынке"
          value={rub(economy.data!.activeListings)}
          note={latest ? `медиана цены ${rub(latest.medianListingPrice)} ₽` : 'активные и заблокированные'}
        />
      </div>

      {rows.length >= 2 ? (
        <section className="adm-graphs">
          <h4>Экономика за {rows.length} суток</h4>
          <div className="adm-graphs__grid">
            <Graph
              title="Денежная масса"
              hint="Сколько всего денег на руках у игроков. Ровный рост — норма, скачок вверх — ищите кран."
              points={rows.map(row => row.m2)} labels={days}
            />
            <Graph
              title="Доля стоков"
              hint="Какая часть напечатанного сгорает обратно. Ниже порога — деньги копятся быстрее, чем тратятся, это инфляция."
              points={rows.map(row => row.sinkShare)} labels={days}
              format={pct} limit={MIN_SINK_SHARE} limitLabel={`норма от ${pct(MIN_SINK_SHARE)}`} invert
            />
            <Graph
              title="Расслоение (Джини)"
              hint="0 — у всех поровну, 1 — всё у одного. Выше порога богатые отрываются так, что новичку не догнать."
              points={rows.map(row => row.gini)} labels={days}
              format={value => value.toFixed(2)} limit={MAX_GINI} limitLabel={`предел ${MAX_GINI}`}
            />
            <Graph
              title="Эмиссия и стоки"
              hint="Сколько денег вошло в игру минус сколько вышло. Устойчивый плюс — та же инфляция, только в рублях."
              points={rows.map(row => row.netEmission)} labels={days}
              format={value => `${value >= 0 ? '+' : ''}${rub(Math.round(value))} ₽`}
            />
            <Graph
              title="Закрытых смен"
              hint="Сколько смен доведено до конца. Главный показатель того, что в игру играют, а не заходят посмотреть."
              points={rows.map(row => row.completedShifts)} labels={days}
            />
            <Graph
              title="Успех улучшений"
              hint="Доля удачных улучшений вещей. Слишком высоко — риска нет, слишком низко — игрок жжёт деньги впустую."
              points={rows.map(row => row.upgrades.successRate)} labels={days} format={pct}
            />
          </div>
        </section>
      ) : (
        <p className="adm-hint">
          Графики появятся, когда наберётся хотя бы двое суток снимков: их собирает
          ежедневный воркер в 03:00 UTC.
        </p>
      )}
    </>
  )
}

/**
 * Вердикт — первое, что читает администратор.
 *
 * Не «вот вам метрики, разбирайтесь», а прямой ответ: всё в порядке или нет,
 * и если нет — что именно и куда идти.
 */
function Verdict({
  latest, heavy, open, onGo,
}: { latest: EconomySnapshot | null; heavy: number; open: number; onGo: (tab: string) => void }) {
  const problems: { text: string; tab?: string; action?: string }[] = []

  if (heavy > 0) {
    problems.push({
      text: `Тяжёлых сигналов антиабуза: ${heavy}. Это «остановить и разобраться», а не «забанить».`,
      tab: 'signals', action: 'к сигналам',
    })
  }
  for (const alert of latest?.alerts ?? []) {
    problems.push({ text: alert, tab: 'balance', action: 'к порогам' })
  }
  if (latest === null) {
    problems.push({
      text: 'Снимка экономики за сегодня ещё нет — воркер собирает его в 03:00 UTC.',
    })
  }

  if (problems.length === 0) {
    return (
      <p className="adm-verdict adm-verdict--ok">
        <CheckCircle2 size={15} />
        Экономика в норме, тяжёлых сигналов нет
        {open > 0 && <>, открытых сигналов {open} — их можно разобрать спокойно</>}.
      </p>
    )
  }

  return (
    <div className="adm-verdict adm-verdict--bad">
      <p><AlertTriangle size={15} /> Требует внимания:</p>
      <ul>
        {problems.map((problem, index) => (
          <li key={index}>
            {problem.text}{' '}
            {problem.tab && (
              <button type="button" className="adm-link" onClick={() => onGo(problem.tab!)}>
                {problem.action} <ArrowRight size={11} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Tile({
  label, value, note, onClick, action, bad,
}: {
  label: string; value: string; note?: string
  onClick?: () => void; action?: string; bad?: boolean
}) {
  return (
    <div className={bad ? 'adm-card adm-card--bad' : 'adm-card'}>
      <span>{label}</span>
      <b>{value}</b>
      {note && <i className="adm-card__note">{note}</i>}
      {onClick && (
        <button type="button" className="adm-link" onClick={onClick}>
          {action} <ArrowRight size={11} />
        </button>
      )}
    </div>
  )
}

function Graph({
  title, hint, points, labels, format, limit, limitLabel, invert,
}: {
  title: string; hint: string; points: number[]; labels: string[]
  format?: (value: number) => string; limit?: number; limitLabel?: string; invert?: boolean
}) {
  return (
    <figure className="adm-graph">
      <figcaption>{title}</figcaption>
      <Chart points={points} labels={labels} format={format} limit={limit} limitLabel={limitLabel} invert={invert} />
      {/* Подпись объясняет, что значит линия и когда пора беспокоиться:
          график без этого — украшение, а не инструмент. */}
      <p className="adm-graph__hint">{hint}</p>
    </figure>
  )
}
