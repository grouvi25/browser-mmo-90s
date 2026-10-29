// =============================================================
// Поддержка тикетами (правка 29.10: «нормальная поддержка, удобно и
// функционально»). Три экрана на одном адресе:
//   /support          — мои обращения (пусто — сразу форма нового);
//   /support/new      — новое обращение: тема, категория, текст, скриншот;
//   /support/:id      — переписка: дописать, закрыть, оценить ответ.
// Ответ поддержки приходит уведомлением в чат и отметкой на кнопке.
// =============================================================
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ImagePlus, Plus, Send, Star, X } from 'lucide-react'
import {
  CATEGORY_LABEL, SUPPORT_CATEGORIES, supportApi,
  type SupportCategory, type SupportMessage, type SupportStatus, type SupportThread,
} from '../../shared/api/support.api'
import { screenshotImage } from '../../shared/lib/image-resize'
import './support.css'

const TEXT_MAX = 2000
const SUBJECT_MAX = 120
const STATUS: Record<SupportStatus, string> = { OPEN: 'ждёт ответа', ANSWERED: 'есть ответ', CLOSED: 'закрыто' }
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function SupportPage() {
  const { ticketId } = useParams<{ ticketId?: string }>()
  if (ticketId === 'new') return <NewTicket />
  if (ticketId) return <Thread id={ticketId} />
  return <TicketList />
}

// ── Список ───────────────────────────────────────────────────

function TicketList() {
  const list = useQuery({ queryKey: ['support', 'mine'], queryFn: supportApi.mine, refetchInterval: 30_000 })
  if (list.isLoading) return <p role="status">Загрузка…</p>
  if (list.isError) return <p role="alert">Обращения не загрузились. <button type="button" className="btn btn-sm" onClick={() => void list.refetch()}>Повторить</button></p>
  const items = list.data?.items ?? []
  // Обращений ещё не было — сразу форма: список из нуля строк никому не нужен.
  if (items.length === 0) return <NewTicket first />

  return (
    <div className="support">
      <div className="support__bar">
        <h3>Мои обращения{list.data!.unread > 0 && <span className="support__badge">{list.data!.unread} с ответом</span>}</h3>
        <Link className="btn support__new" to="/support/new"><Plus size={14} /> Новое обращение</Link>
      </div>
      <ul className="support__list">
        {items.map(t => (
          <li key={t.id}>
            <Link to={`/support/${t.id}`} className={`support__row is-${t.status.toLowerCase()}` + (t.playerUnread ? ' is-unread' : '')}>
              <span className="support__row-head">
                <b>№{t.number} · {t.subject}</b>
                <span className={`support__status is-${t.status.toLowerCase()}`}>{t.playerUnread ? 'новый ответ' : STATUS[t.status]}</span>
              </span>
              <span className="support__meta">{CATEGORY_LABEL[t.category]} · {when(t.lastMessageAt)}</span>
              {t.last && <span className="support__preview">{t.last.author === 'STAFF' ? 'Поддержка: ' : t.last.author === 'PLAYER' ? 'Вы: ' : ''}{t.last.text}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Новое обращение ──────────────────────────────────────────

function NewTicket({ first = false }: { first?: boolean }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState<SupportCategory>('BUG')
  const [text, setText] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [error, setError] = useState('')
  const mods = useQuery({ queryKey: ['support', 'moderators'], queryFn: supportApi.moderators, refetchInterval: 60_000 })

  const send = useMutation({
    mutationFn: () => supportApi.create({ subject: subject.trim(), category, text: text.trim(), image }),
    onSuccess: ticket => {
      void qc.invalidateQueries({ queryKey: ['support'] })
      navigate(`/support/${ticket.id}`, { replace: true })
    },
    onError: (e: Error) => setError(e.message),
  })
  const ready = subject.trim().length > 0 && text.trim().length > 0

  return (
    <div className="support">
      {!first && <Link className="support__back" to="/support"><ArrowLeft size={14} /> Мои обращения</Link>}
      <p className="support__lead">
        Что-то сломалось, пропали вещи или деньги, есть вопрос или предложение — напишите, и поддержка ответит здесь же.
        Ответ придёт уведомлением в чат. Можно и на почту <a href="mailto:info@kooperativ.space">info@kooperativ.space</a>.
      </p>

      <form className="support__form" onSubmit={e => { e.preventDefault(); if (ready) { setError(''); send.mutate() } }}>
        <div className="support__fields">
          <label className="support__field support__field--grow">
            <span>Тема</span>
            <input aria-label="Тема" value={subject} maxLength={SUBJECT_MAX} onChange={e => setSubject(e.target.value)} placeholder="Коротко: что случилось" />
          </label>
          <label className="support__field">
            <span>Раздел</span>
            <select value={category} onChange={e => setCategory(e.target.value as SupportCategory)} aria-label="Раздел">
              {SUPPORT_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
        <label className="support__label" htmlFor="support-text">Подробности</label>
        <Composer
          id="support-text" text={text} onText={setText} image={image} onImage={setImage} onError={setError}
          placeholder="Подробно: что делали, где в игре, когда. Скриншот можно вставить сюда же через Ctrl+V"
          busy={send.isPending} ready={ready} submitLabel="Отправить"
        />
        {error && <p className="support__msg is-bad" role="alert">{error}</p>}
      </form>

      {/* Модераторы (обещание игрокам 22.10): кто в сети и общий список. */}
      <section className="support__mods" aria-label="Модераторы">
        <h3>Модераторы</h3>
        {mods.data?.items && (mods.data.items.length === 0
          ? <p className="support__meta">Список модераторов пока пуст.</p>
          : <ul>{mods.data.items.map(m => <li key={m.nickname} className={m.online ? 'is-online' : undefined}>
              <span className="support__dot" aria-hidden="true" />{m.nickname} [{m.level}] — {m.online ? 'в сети' : `был ${when(m.lastActiveAt)}`}
            </li>)}</ul>)}
        <p className="support__meta">Быстрее всего — обращением: его сразу видят все модераторы, а в личку ответит только тот, кто у компьютера.</p>
      </section>
    </div>
  )
}

// ── Переписка ────────────────────────────────────────────────

function Thread({ id }: { id: string }) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const thread = useQuery({ queryKey: ['support', 'thread', id], queryFn: () => supportApi.thread(id), refetchInterval: 20_000 })

  // Открыл — прочитал: отметка на кнопке и в списке гаснет.
  const seen = thread.data?.ticket.id
  useEffect(() => {
    if (seen) void qc.invalidateQueries({ queryKey: ['support', 'unread'] })
  }, [seen, qc])
  const count = thread.data?.messages.length ?? 0
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [count])

  const update = (next: SupportThread) => {
    qc.setQueryData(['support', 'thread', id], next)
    void qc.invalidateQueries({ queryKey: ['support', 'mine'] })
  }
  const fail = (e: Error) => setError(e.message)
  const write = useMutation({
    mutationFn: () => supportApi.write(id, text.trim(), image),
    onSuccess: next => { setText(''); setImage(null); setError(''); update(next) },
    onError: fail,
  })
  const close = useMutation({ mutationFn: () => supportApi.close(id), onSuccess: update, onError: fail })
  const rate = useMutation({ mutationFn: (rating: number) => supportApi.rate(id, rating), onSuccess: update, onError: fail })

  if (thread.isLoading) return <p role="status">Загрузка…</p>
  if (thread.isError || !thread.data) {
    return <div className="support">
      <Link className="support__back" to="/support"><ArrowLeft size={14} /> Мои обращения</Link>
      <p role="alert">Обращение не найдено или не загрузилось. <button type="button" className="btn btn-sm" onClick={() => void thread.refetch()}>Повторить</button></p>
    </div>
  }

  const { ticket, messages } = thread.data
  const closed = ticket.status === 'CLOSED'
  const canWrite = !closed || ticket.canReopen

  return (
    <div className="support">
      <Link className="support__back" to="/support"><ArrowLeft size={14} /> Мои обращения</Link>
      <header className="support__thread-head">
        <h3>№{ticket.number} · {ticket.subject}</h3>
        <span className="support__meta">
          {CATEGORY_LABEL[ticket.category]} · создано {when(ticket.createdAt)} ·{' '}
          <span className={`support__status is-${ticket.status.toLowerCase()}`}>{STATUS[ticket.status]}</span>
        </span>
      </header>

      <ol className="support__chat" aria-label="Переписка">
        {messages.map(m => <Bubble key={m.id} ticketId={ticket.id} message={m} />)}
      </ol>
      <div ref={endRef} />

      {closed && (
        <section className="support__rate" aria-label="Оценка ответа">
          <span>{ticket.rating ? 'Ваша оценка:' : 'Оцените, пожалуйста, ответ:'}</span>
          <span className="support__stars" role="radiogroup" aria-label="Оценка от 1 до 5">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" role="radio" aria-checked={ticket.rating === n} aria-label={`${n} из 5`}
                className={'support__star' + ((ticket.rating ?? 0) >= n ? ' is-on' : '')}
                disabled={rate.isPending} onClick={() => rate.mutate(n)}>
                <Star size={18} aria-hidden="true" />
              </button>
            ))}
          </span>
        </section>
      )}

      {canWrite ? (
        <form className="support__form" onSubmit={e => { e.preventDefault(); if (text.trim()) write.mutate() }}>
          <label className="support__label" htmlFor="support-reply">{closed ? 'Не решилось? Напишите — обращение откроется снова' : 'Ваше сообщение'}</label>
          <Composer
            id="support-reply" text={text} onText={setText} image={image} onImage={setImage} onError={setError}
            placeholder="Дописать, ответить на вопрос поддержки" busy={write.isPending} ready={!!text.trim()} submitLabel="Отправить"
            extra={!closed && <button type="button" className="btn" disabled={close.isPending} onClick={() => close.mutate()}>Вопрос решён — закрыть</button>}
          />
          {error && <p className="support__msg is-bad" role="alert">{error}</p>}
        </form>
      ) : (
        <p className="support__meta">Обращение закрыто давно. Если вопрос остался — <Link to="/support/new">создайте новое</Link>.</p>
      )}
    </div>
  )
}

function Bubble({ ticketId, message: m }: { ticketId: string; message: SupportMessage }) {
  if (m.author === 'SYSTEM') return <li className="support__system">{m.text} · {when(m.createdAt)}</li>
  const staff = m.author === 'STAFF'
  return (
    <li className={'support__bubble' + (staff ? ' is-staff' : ' is-mine')}>
      <span className="support__meta">{staff ? `Поддержка${m.authorLabel ? ` (${m.authorLabel})` : ''}` : 'Вы'} · {when(m.createdAt)}</span>
      <p className="support__body">{m.text}</p>
      {m.hasImage && <Shot ticketId={ticketId} messageId={m.id} />}
    </li>
  )
}

/** Скриншот из переписки: грузится по токену, открывается целиком в новой вкладке. */
function Shot({ ticketId, messageId }: { ticketId: string; messageId: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    let made: string | null = null
    supportApi.image(ticketId, messageId)
      .then(next => { made = next; if (alive) setUrl(next); else URL.revokeObjectURL(next) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false; if (made) URL.revokeObjectURL(made) }
  }, [ticketId, messageId])
  if (failed) return <span className="support__meta">Скриншот не загрузился.</span>
  if (!url) return <span className="support__meta">Скриншот загружается…</span>
  return <a className="support__shot" href={url} target="_blank" rel="noreferrer"><img src={url} alt="Скриншот" /></a>
}

/** Поле сообщения со скриншотом: кнопкой или вставкой из буфера (Ctrl+V). */
function Composer({ id, text, onText, image, onImage, onError, placeholder, busy, ready, submitLabel, extra }: {
  id: string; text: string; onText: (v: string) => void
  image: string | null; onImage: (v: string | null) => void; onError: (v: string) => void
  placeholder: string; busy: boolean; ready: boolean; submitLabel: string; extra?: ReactNode
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preparing, setPreparing] = useState(false)
  const pick = async (file: File | undefined | null) => {
    if (!file) return
    setPreparing(true)
    try { onImage(await screenshotImage(file)); onError('') }
    catch (e) { onError((e as Error).message) }
    finally { setPreparing(false); if (fileRef.current) fileRef.current.value = '' }
  }
  return <>
    <textarea
      id={id} className="support__text" rows={4} maxLength={TEXT_MAX}
      value={text} onChange={e => onText(e.target.value)} placeholder={placeholder}
      onPaste={e => {
        const file = Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'))
        if (file) { e.preventDefault(); void pick(file) }
      }}
    />
    <div className="support__row">
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => void pick(e.target.files?.[0])} />
      {image ? (
        <span className="support__thumb">
          <img src={image} alt="Скриншот к сообщению" />
          <button type="button" className="btn btn-sm" onClick={() => onImage(null)} aria-label="Убрать скриншот"><X size={13} /> Убрать</button>
        </span>
      ) : (
        <button type="button" className="btn" disabled={preparing} onClick={() => fileRef.current?.click()}>
          <ImagePlus size={14} /> {preparing ? 'Готовим скриншот…' : 'Приложить скриншот'}
        </button>
      )}
      {extra}
      <span className="support__count">{text.length}/{TEXT_MAX}</span>
      <button type="submit" className="btn support__send" disabled={!ready || busy || preparing}>
        <Send size={14} /> {busy ? 'Отправляем…' : submitLabel}
      </button>
    </div>
  </>
}
