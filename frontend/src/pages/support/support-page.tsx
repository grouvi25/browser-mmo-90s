// =============================================================
// Поддержка (правка заказчика 21.10.2026): кнопка в Центре, текст и форма
// обращения со скриншотом. Ответ приходит уведомлением и виден ниже.
// =============================================================
import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Send, X } from 'lucide-react'
import { supportApi, type SupportStatus } from '../../shared/api/support.api'
import { screenshotImage } from '../../shared/lib/image-resize'
import './support.css'

const TEXT_MAX = 2000
const STATUS: Record<SupportStatus, string> = { OPEN: 'ждёт ответа', ANSWERED: 'есть ответ', CLOSED: 'закрыто' }
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function SupportPage() {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const list = useQuery({ queryKey: ['support'], queryFn: supportApi.mine })
  const mods = useQuery({ queryKey: ['support', 'moderators'], queryFn: supportApi.moderators, refetchInterval: 60_000 })

  const send = useMutation({
    mutationFn: () => supportApi.create(text.trim(), image),
    onSuccess: () => {
      setText(''); setImage(null)
      setMsg({ text: 'Обращение отправлено. Ответ придёт уведомлением.', bad: false })
      void qc.invalidateQueries({ queryKey: ['support'] })
    },
    onError: (e: Error) => setMsg({ text: e.message, bad: true }),
  })

  const pick = async (file: File | undefined) => {
    if (!file) return
    setPreparing(true)
    try { setImage(await screenshotImage(file)); setMsg(null) }
    catch (e) { setMsg({ text: (e as Error).message, bad: true }) }
    finally { setPreparing(false); if (fileRef.current) fileRef.current.value = '' }
  }

  return (
    <div className="support">
      <p className="support__lead">
        Что-то сломалось, пропали вещи или деньги, есть вопрос по игре — опишите, что случилось,
        и приложите скриншот, если он есть. Можно написать и на почту{' '}
        <a href="mailto:info@kooperativ.space">info@kooperativ.space</a>.
      </p>

      {/* Модераторы (обещание игрокам 22.10): кто в сети и общий список. */}
      <section className="support__mods" aria-label="Модераторы">
        <h3>Модераторы</h3>
        {mods.data?.items && (mods.data.items.length === 0
          ? <p className="support__meta">Список модераторов пока пуст.</p>
          : <ul>{mods.data.items.map(m => <li key={m.nickname} className={m.online ? 'is-online' : undefined}>
              <span className="support__dot" aria-hidden="true" />{m.nickname} [{m.level}] — {m.online ? 'в сети' : `был ${when(m.lastActiveAt)}`}
            </li>)}</ul>)}
        <p className="support__meta">Быстрее всего — заявкой ниже: её сразу видят все модераторы, а в личку может ответить только тот, кто у компьютера.</p>
      </section>

      <form className="support__form" onSubmit={e => { e.preventDefault(); if (text.trim()) send.mutate() }}>
        <label className="support__label" htmlFor="support-text">Обращение</label>
        <textarea
          id="support-text" className="support__text" rows={5} maxLength={TEXT_MAX}
          value={text} onChange={e => setText(e.target.value)}
          placeholder="Что случилось, когда и где в игре"
        />
        <div className="support__row">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={e => void pick(e.target.files?.[0])} />
          {image ? (
            <span className="support__thumb">
              <img src={image} alt="Скриншот к обращению" />
              <button type="button" className="btn btn-sm" onClick={() => setImage(null)} aria-label="Убрать скриншот"><X size={13} /> Убрать</button>
            </span>
          ) : (
            <button type="button" className="btn" disabled={preparing} onClick={() => fileRef.current?.click()}>
              <ImagePlus size={14} /> {preparing ? 'Готовим скриншот…' : 'Приложить скриншот'}
            </button>
          )}
          <span className="support__count">{text.length}/{TEXT_MAX}</span>
          <button type="submit" className="btn support__send" disabled={!text.trim() || send.isPending || preparing}>
            <Send size={14} /> {send.isPending ? 'Отправляем…' : 'Отправить'}
          </button>
        </div>
        {msg && <p className={'support__msg' + (msg.bad ? ' is-bad' : '')} role={msg.bad ? 'alert' : 'status'}>{msg.text}</p>}
      </form>

      {list.data && list.data.items.length > 0 && (
        <section className="support__history">
          <h3>Мои обращения</h3>
          <ul>
            {list.data.items.map(t => (
              <li key={t.id} className={`support__ticket is-${t.status.toLowerCase()}`}>
                <div className="support__meta">{when(t.createdAt)} · {STATUS[t.status]}{t.hasImage && ' · со скриншотом'}</div>
                <p className="support__body">{t.text}</p>
                {t.reply && <p className="support__reply"><b>Поддержка{t.repliedAt && `, ${when(t.repliedAt)}`}:</b> {t.reply}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {list.isError && <p role="alert">Обращения не загрузились. <button type="button" className="btn btn-sm" onClick={() => void list.refetch()}>Повторить</button></p>}
    </div>
  )
}
