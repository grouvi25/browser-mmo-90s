// Поддержка тикетами (правка 29.10). Слева очередь с фильтрами и поиском,
// справа обращение: переписка с заметками для своих, карточка игрока,
// статус, приоритет, категория, «взять себе» и шаблоны ответов.
// Ответ уходит игроку уведомлением в чат и отметкой на кнопке «Поддержка».
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  adminApi, type SupportFilter, type SupportPriority, type SupportStaffMessage, type SupportStaffThread, type SupportStatus,
} from '../admin-api'
import { CATEGORY_LABEL, SUPPORT_CATEGORIES, type SupportCategory } from '../../../shared/api/support.api'
import { Skeleton, Fault, Empty, Note } from '../../stage3/stage3-ui'
import { rub, when } from '../admin-ui'

const SCOPES: { value: SupportStatus | ''; title: string }[] = [
  { value: 'OPEN', title: 'Ждут ответа' },
  { value: 'ANSWERED', title: 'Ждут игрока' },
  { value: 'CLOSED', title: 'Закрыты' },
  { value: '', title: 'Все' },
]
const STATUS_LABEL: Record<SupportStatus, string> = { OPEN: 'ждёт ответа', ANSWERED: 'ждёт игрока', CLOSED: 'закрыто' }
const PRIORITY_LABEL: Record<SupportPriority, string> = { HIGH: 'срочно', NORMAL: 'обычный', LOW: 'не горит' }

/** Шаблоны частых ответов: вставляются в поле, дальше правятся руками. */
const TEMPLATES: [string, string][] = [
  ['Приняли, разбираемся', 'Здравствуйте! Приняли обращение, разбираемся. Напишем здесь, как будет результат.'],
  ['Нужен скриншот', 'Здравствуйте! Пришлите, пожалуйста, скриншот и примерное время, когда это случилось, — так найдём быстрее.'],
  ['Исправили', 'Исправили. Проверьте, пожалуйста, и напишите здесь, если что-то осталось.'],
  ['Вернули', 'Вернули потерянное на персонажа. Проверьте Склад и баланс.'],
  ['Так задумано', 'Это не ошибка: так устроено правило игры. Подробности — в Библиотеке.'],
  ['Идея принята', 'Спасибо за предложение! Передали его команде.'],
  ['Жалоба принята', 'Спасибо, жалобу приняли. О мерах к другим игрокам не сообщаем, но каждую жалобу проверяем.'],
]

export function SupportSection() {
  const [scope, setScope] = useState<SupportStatus | ''>('OPEN')
  const [category, setCategory] = useState<SupportCategory | ''>('')
  const [assigned, setAssigned] = useState<'' | 'me' | 'none'>('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Поиск — с паузой после ввода, а не запросом на каждую букву.
  useEffect(() => {
    const timer = setTimeout(() => { setQ(search.trim()); setPage(0) }, 350)
    return () => clearTimeout(timer)
  }, [search])

  const filter: SupportFilter = { status: scope || undefined, category: category || undefined, assigned: assigned || undefined, q: q || undefined, page }
  const list = useQuery({ queryKey: ['admin', 'support', filter], queryFn: () => adminApi.support(filter), refetchInterval: 20_000 })
  const data = list.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  const open = (id: string) => {
    setSelected(id)
    // На узком экране обращение стоит под очередью — подводим к нему.
    requestAnimationFrame(() => panelRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }

  return (
    <div className="adm-desk">
      <div className="adm-desk__queue">
        <div className="adm-switch adm-switch--wrap">
          {SCOPES.map(item => (
            <button key={item.value || 'all'} type="button" className={scope === item.value ? 'active' : ''}
              onClick={() => { setScope(item.value); setPage(0) }}>
              {item.title}{item.value && data ? ` · ${data.counts[item.value]}` : ''}
            </button>
          ))}
        </div>
        <div className="adm-desk__filters">
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="№, ник или тема" aria-label="Поиск обращений" />
          <select value={category} onChange={e => { setCategory(e.target.value as SupportCategory | ''); setPage(0) }} aria-label="Раздел">
            <option value="">Все разделы</option>
            {SUPPORT_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select value={assigned} onChange={e => { setAssigned(e.target.value as '' | 'me' | 'none'); setPage(0) }} aria-label="Кто ведёт">
            <option value="">Все</option>
            <option value="me">Мои</option>
            <option value="none">Ничьи</option>
          </select>
        </div>
        {data && data.unread > 0 && <p className="adm-hint">Новых сообщений от игроков: <b>{data.unread}</b></p>}

        {list.isLoading && <Skeleton rows={5} />}
        {list.isError && <Fault retry={() => list.refetch()} />}
        {data && (data.items.length === 0
          ? <Empty title="Обращений нет" hint={scope === 'OPEN' && !q && !category && !assigned ? 'Все отвечены.' : 'Под этот фильтр ничего не подходит.'} />
          : <ul className="adm-queue">
              {data.items.map(row => (
                <li key={row.id}>
                  <button type="button" onClick={() => open(row.id)}
                    className={'adm-queue__row' + (row.id === selected ? ' is-current' : '') + (row.staffUnread && row.status !== 'CLOSED' ? ' is-unread' : '') + ` is-${row.priority.toLowerCase()}`}>
                    <span className="adm-queue__head">
                      <b>№{row.number} · {row.subject}</b>
                      <span className="adm-queue__when">{when(row.lastMessageAt)}</span>
                    </span>
                    <span className="adm-queue__meta">
                      {row.character.nickname} [{row.character.battleLevel}] · {CATEGORY_LABEL[row.category]}
                      {row.priority !== 'NORMAL' && ` · ${PRIORITY_LABEL[row.priority]}`}
                      {` · ${row.assignedTo ? `ведёт ${row.assignedTo}` : 'ничьё'}`}
                      {!scope && ` · ${STATUS_LABEL[row.status]}`}
                    </span>
                    {row.last && <span className="adm-queue__last">
                      {row.last.internal ? 'Заметка: ' : row.last.author === 'STAFF' ? 'Мы: ' : row.last.author === 'SYSTEM' ? '' : 'Игрок: '}{row.last.text}
                    </span>}
                  </button>
                </li>
              ))}
            </ul>)}
        {data && pages > 1 && (
          <div className="adm-desk__pages">
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>← Назад</button>
            <span>{page + 1} из {pages}</span>
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Дальше →</button>
          </div>
        )}
      </div>

      <div className="adm-desk__ticket" ref={panelRef}>
        {selected
          ? <TicketPanel key={selected} id={selected} onOpen={open} />
          : <Empty title="Выберите обращение" hint="Слева очередь: срочные и самые давние — сверху." />}
      </div>
    </div>
  )
}

function TicketPanel({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [internal, setInternal] = useState(false)
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const thread = useQuery({ queryKey: ['admin', 'support', 'thread', id], queryFn: () => adminApi.supportThread(id), refetchInterval: 15_000 })

  const apply = (next: SupportStaffThread, note: string) => {
    qc.setQueryData(['admin', 'support', 'thread', id], next)
    void qc.invalidateQueries({ queryKey: ['admin', 'support'], predicate: query => query.queryKey[2] !== 'thread' })
    setBad(false); setMsg(note)
  }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }
  const write = useMutation({
    mutationFn: (close: boolean) => adminApi.supportWrite(id, { text: text.trim(), internal, close: close && !internal }),
    onSuccess: (next, close) => {
      setText('')
      apply(next, internal ? 'Заметка сохранена — игрок её не видит.' : close ? 'Ответ ушёл игроку, обращение закрыто.' : 'Ответ ушёл игроку.')
      setInternal(false)
    },
    onError: fail,
  })
  const update = useMutation({
    mutationFn: (body: Parameters<typeof adminApi.supportUpdate>[1]) => adminApi.supportUpdate(id, body),
    onSuccess: next => apply(next, 'Сохранено.'),
    onError: fail,
  })

  if (thread.isLoading) return <Skeleton rows={6} />
  if (thread.isError || !thread.data) return <Fault retry={() => thread.refetch()} />
  const { ticket, player, others, messages } = thread.data
  const busy = update.isPending

  return (
    <article className="adm-tk">
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      <header className="adm-tk__head">
        <h4>№{ticket.number} · {ticket.subject}</h4>
        <span className="adm-hint">
          {STATUS_LABEL[ticket.status]} · создано {when(ticket.createdAt)}
          {ticket.closedAt && ` · закрыл ${ticket.closedBy ?? '—'} ${when(ticket.closedAt)}`}
          {ticket.rating && ` · оценка ${ticket.rating}/5`}
        </span>
      </header>

      <div className="adm-tk__controls">
        <label><span>Статус</span>
          <select value={ticket.status} disabled={busy} onChange={e => update.mutate({ status: e.target.value as SupportStatus })}>
            {(Object.keys(STATUS_LABEL) as SupportStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select></label>
        <label><span>Приоритет</span>
          <select value={ticket.priority} disabled={busy} onChange={e => update.mutate({ priority: e.target.value as SupportPriority })}>
            {(['HIGH', 'NORMAL', 'LOW'] as const).map(p => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select></label>
        <label><span>Раздел</span>
          <select value={ticket.category} disabled={busy} onChange={e => update.mutate({ category: e.target.value as SupportCategory })}>
            {SUPPORT_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        <label><span>Ведёт</span>
          <span className="adm-tk__assign">
            <b>{ticket.assignedTo ?? 'никто'}</b>
            <button type="button" disabled={busy} onClick={() => update.mutate({ assign: 'me' })}>Взять себе</button>
            {ticket.assignedTo && <button type="button" disabled={busy} onClick={() => update.mutate({ assign: 'none' })}>Снять</button>}
          </span></label>
      </div>

      <section className="adm-tk__player" aria-label="Игрок">
        <b>{player.nickname} [{player.battleLevel}]</b>{player.isPremium && ' · премиум'}
        <span className="adm-hint">
          логин {player.login} · {player.email} · {rub(player.money)} ₽ · {rub(player.dollars)} $ ·
          с {when(player.createdAt)} · был {when(player.lastActiveAt)}
        </span>
        {others.length > 0 && (
          <span className="adm-tk__others">
            Другие обращения:{' '}
            {others.map(o => (
              <button key={o.id} type="button" className="adm-link" onClick={() => onOpen(o.id)}>
                №{o.number} {o.subject} ({STATUS_LABEL[o.status]})
              </button>
            ))}
          </span>
        )}
      </section>

      <ol className="adm-tk__chat" aria-label="Переписка">
        {messages.map(m => <StaffBubble key={m.id} ticketId={ticket.id} message={m} />)}
      </ol>

      <form className="adm-tk__form" onSubmit={e => { e.preventDefault(); if (text.trim()) write.mutate(false) }}>
        <div className="adm-tk__tools">
          <select value="" onChange={e => { const t = TEMPLATES.find(([title]) => title === e.target.value); if (t) setText(prev => prev ? `${prev}\n\n${t[1]}` : t[1]) }}
            aria-label="Шаблон ответа">
            <option value="">Шаблон ответа…</option>
            {TEMPLATES.map(([title]) => <option key={title} value={title}>{title}</option>)}
          </select>
          <label className="adm-check"><input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} /> Заметка для своих — игрок не увидит</label>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={2000}
          className={internal ? 'is-internal' : undefined}
          placeholder={internal ? 'Заметка для поддержки' : `Ответ игроку ${player.nickname}`} aria-label="Текст ответа" />
        <div className="adm-ticket__actions">
          <button type="submit" disabled={!text.trim() || write.isPending}>
            {write.isPending ? 'Отправляем…' : internal ? 'Сохранить заметку' : 'Ответить'}
          </button>
          {!internal && ticket.status !== 'CLOSED' && (
            <button type="button" disabled={!text.trim() || write.isPending} onClick={() => write.mutate(true)}>Ответить и закрыть</button>
          )}
        </div>
      </form>
    </article>
  )
}

function StaffBubble({ ticketId, message: m }: { ticketId: string; message: SupportStaffMessage }) {
  if (m.author === 'SYSTEM') return <li className="adm-tk__system">{m.text} · {when(m.createdAt)}</li>
  const kind = m.internal ? 'is-note' : m.author === 'STAFF' ? 'is-staff' : 'is-player'
  return (
    <li className={`adm-tk__bubble ${kind}`}>
      <span className="adm-hint">
        {m.internal ? `Заметка ${m.authorLabel ?? ''}` : m.author === 'STAFF' ? `Ответ ${m.authorLabel ?? ''}` : 'Игрок'} · {when(m.createdAt)}
      </span>
      <p>{m.text}</p>
      {m.hasImage && <StaffShot ticketId={ticketId} messageId={m.id} />}
    </li>
  )
}

/** Скриншот — по админскому токену, поэтому через blob-адрес. */
function StaffShot({ ticketId, messageId }: { ticketId: string; messageId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    let made: string | null = null
    adminApi.supportImage(ticketId, messageId)
      .then(next => { made = next; if (alive) setUrl(next); else URL.revokeObjectURL(next) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false; if (made) URL.revokeObjectURL(made) }
  }, [ticketId, messageId])
  if (failed) return <p className="adm-hint">Скриншот не загрузился.</p>
  if (!url) return <p className="adm-hint">Скриншот загружается…</p>
  return <a href={url} target="_blank" rel="noreferrer" className="adm-ticket__shot"><img src={url} alt="Скриншот игрока" /></a>
}
