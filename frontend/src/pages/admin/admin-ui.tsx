// =============================================================
// Мелочи админки, общие для всех разделов.
//
// Админка не витрина: та же вёрстка, что и у экранов игры, никакого своего
// дизайна. Вкладывать в неё оформление раньше, чем в саму игру, незачем.
//
// Здесь только то, чего нет в примитивах Этапа 3: таблица, поле причины и
// подпись «кто и когда».
// =============================================================
import { useState, type ReactNode } from 'react'
import { REASON_MIN } from './admin-api'

export const when = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'

export const rub = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : value.toLocaleString('ru-RU')

/** Таблица со скроллом по горизонтали: узкие экраны не должны рвать страницу. */
export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="adm-scroll">
      <table className="adm-table">
        <thead><tr>{head.map(title => <th key={title}>{title}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/**
 * Поле причины.
 *
 * Кнопка заперта, пока причина короче десяти символов, — то же правило, что
 * и на сервере. Дублирование намеренное: узнавать о запрете из ошибки после
 * нажатия хуже, чем видеть его до.
 */
export function ReasonForm({
  label, busy, onSubmit, children, danger,
}: {
  label: string
  busy: boolean
  onSubmit: (reason: string) => void
  children?: ReactNode
  danger?: boolean
}) {
  const [reason, setReason] = useState('')
  const short = reason.trim().length < REASON_MIN

  return (
    <form
      className="adm-reason"
      onSubmit={event => { event.preventDefault(); if (!short) { onSubmit(reason.trim()); setReason('') } }}
    >
      {children}
      <input
        value={reason}
        onChange={event => setReason(event.target.value)}
        placeholder={`Причина, от ${REASON_MIN} символов`}
        maxLength={500}
        aria-label="Причина"
      />
      <button type="submit" className={danger ? 'adm-danger' : ''} disabled={busy || short}>
        {label}
      </button>
      {short && reason.length > 0 && (
        <span className="adm-hint">ещё {REASON_MIN - reason.trim().length} символов</span>
      )}
    </form>
  )
}

/**
 * График ряда чисел. Своими руками на SVG: в проекте нет UI-библиотек, и
 * тащить чартовую ради семи линий — менять правило ради одного экрана.
 *
 * Рисует линию, границу нормы (если задана) и подпись крайних значений.
 * Пустой или одноточечный ряд не рисуется вовсе: линия из одной точки
 * выглядит как «всё ровно», хотя данных просто нет.
 */
export function Chart({
  points, labels, format, limit, limitLabel, invert, height = 64,
}: {
  points: number[]
  labels?: string[]
  format?: (value: number) => string
  /** Порог нормы: линия, за которую заходить не стоит. */
  limit?: number
  limitLabel?: string
  /** true — плохо, когда НИЖЕ порога (доля стоков); false — когда выше. */
  invert?: boolean
  height?: number
}) {
  const show = format ?? ((value: number) => rub(Math.round(value)))
  if (points.length < 2) {
    return <p className="adm-hint">Данных пока мало: график появится, когда наберётся хотя бы двое суток.</p>
  }

  const width = 100
  const all = limit === undefined ? points : [...points, limit]
  const min = Math.min(...all)
  const max = Math.max(...all)
  const span = max - min || 1
  // Небольшой запас сверху и снизу, иначе линия липнет к краю рамки.
  const pad = span * 0.12
  const lo = min - pad
  const hi = max + pad
  const y = (value: number) => height - ((value - lo) / (hi - lo)) * height
  const x = (index: number) => (index / (points.length - 1)) * width

  const line = points.map((value, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`).join(' ')
  const area = `${line} L ${width} ${height} L 0 ${height} Z`
  const last = points[points.length - 1]
  const breached = limit !== undefined && (invert ? last < limit : last > limit)

  return (
    <div className="adm-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img"
        aria-label={`График: от ${show(points[0])} до ${show(last)}`}>
        <path className="adm-chart__area" d={area} />
        <path className={breached ? 'adm-chart__line is-bad' : 'adm-chart__line'} d={line} />
        {limit !== undefined && (
          <line className="adm-chart__limit" x1="0" x2={width} y1={y(limit)} y2={y(limit)} />
        )}
      </svg>
      <div className="adm-chart__legend">
        <span>{labels?.[0] ?? ''} {show(points[0])}</span>
        {limit !== undefined && <span className="adm-chart__limit-label">{limitLabel ?? `порог ${show(limit)}`}</span>}
        <span className={breached ? 'adm-bad' : ''}>{labels?.[labels.length - 1] ?? ''} {show(last)}</span>
      </div>
    </div>
  )
}

/** Плашка «сходится / не сходится» для сверок поля с журналом. */
export function Audit({ ok, stored, fromLog }: { ok: boolean; stored: number; fromLog: number }) {
  return (
    <span className={ok ? 'adm-ok' : 'adm-bad'}>
      {ok
        ? `сходится (${stored})`
        : `РАСХОЖДЕНИЕ: поле ${stored}, журнал ${fromLog}`}
    </span>
  )
}
