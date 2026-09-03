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
