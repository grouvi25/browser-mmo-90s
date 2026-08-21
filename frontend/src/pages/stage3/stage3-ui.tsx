// =============================================================
// Общие мелочи всех разделов Этапа 3: форматирование, состояния
// загрузки и ошибки. Держим в одном месте, чтобы одиннадцать
// разделов выглядели одинаково, а не каждый по-своему.
// =============================================================
import type { ReactNode } from 'react'
import { ShieldAlert, Inbox } from 'lucide-react'

export const fmt = (value: number) => value.toLocaleString('ru-RU')

export const timer = (date: string | null | undefined) =>
  date ? new Date(date).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'нет'

/** Сколько осталось до срока — сервер считает время, клиент только отсчитывает. */
export function remaining(date: string | null | undefined, now = Date.now()): string {
  if (!date) return '—'
  const left = new Date(date).getTime() - now
  if (left <= 0) return 'готово'
  const minutes = Math.floor(left / 60_000)
  if (minutes < 60) return `${minutes} мин`
  const hours = Math.floor(minutes / 60)
  return `${hours} ч ${minutes % 60} мин`
}

export function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="s3-skeleton" role="status" aria-label="Загрузка">
      {Array.from({ length: rows }, (_, i) => <i key={i} />)}
    </div>
  )
}

export function Fault({ retry }: { retry: () => unknown }) {
  return (
    <div className="s3-fault" role="alert">
      <ShieldAlert />
      <h2>Раздел не загрузился</h2>
      <button onClick={retry}>Повторить</button>
    </div>
  )
}

/** Пустое состояние — третье из обязательных по приёмке. */
export function Empty({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="s3-empty">
      <Inbox />
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
    </div>
  )
}

/** Сообщение о результате действия: и успех, и ошибка ложатся сюда. */
export function Note({ text, kind = 'ok' }: { text: string; kind?: 'ok' | 'bad' }) {
  if (!text) return null
  return <output className={`s3-note s3-note--${kind}`}>{text}</output>
}
