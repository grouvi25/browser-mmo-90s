// Обращения в поддержку: игрок пишет из Центра, здесь — ответ. Ответ уходит
// игроку уведомлением и виден в его списке обращений.
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type SupportRow, type SupportStatus } from '../admin-api'
import { Skeleton, Fault, Empty, Note } from '../../stage3/stage3-ui'
import { when } from '../admin-ui'

const SCOPES: { value: SupportStatus; title: string }[] = [
  { value: 'OPEN', title: 'Ждут ответа' },
  { value: 'ANSWERED', title: 'Отвечены' },
  { value: 'CLOSED', title: 'Закрыты' },
]

export function SupportSection() {
  const [scope, setScope] = useState<SupportStatus>('OPEN')
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)
  const list = useQuery({ queryKey: ['admin', 'support', scope], queryFn: () => adminApi.support(scope) })

  return (
    <>
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      <div className="adm-switch">
        {SCOPES.map(item => (
          <button key={item.value} type="button" className={scope === item.value ? 'active' : ''} onClick={() => setScope(item.value)}>
            {item.title}
          </button>
        ))}
      </div>
      {list.isLoading && <Skeleton rows={4} />}
      {list.isError && <Fault retry={() => list.refetch()} />}
      {list.data && (list.data.items.length === 0
        ? <Empty title="Обращений нет" hint={scope === 'OPEN' ? 'Все отвечены.' : 'В этом списке пусто.'} />
        : <div className="adm-support">
            {list.data.items.map(row => (
              <Ticket key={row.id} row={row} onDone={text => { setBad(false); setMsg(text) }} onFail={text => { setBad(true); setMsg(text) }} />
            ))}
          </div>)}
    </>
  )
}

function Ticket({ row, onDone, onFail }: { row: SupportRow; onDone: (text: string) => void; onFail: (text: string) => void }) {
  const qc = useQueryClient()
  const [answer, setAnswer] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)

  // Скриншот — по админскому токену, поэтому через blob-адрес.
  useEffect(() => {
    if (!row.hasImage) return
    let url: string | null = null
    let alive = true
    adminApi.supportImage(row.id)
      .then(next => { url = next; if (alive) setImage(next); else URL.revokeObjectURL(next) })
      .catch(() => { if (alive) setImageError(true) })
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [row.id, row.hasImage])

  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 'support'] })
  const reply = useMutation({
    mutationFn: () => adminApi.supportReply(row.id, answer.trim()),
    onSuccess: () => { setAnswer(''); onDone(`Ответ ушёл игроку ${row.character.nickname}.`); refresh() },
    onError: (e: Error) => onFail(e.message),
  })
  const close = useMutation({
    mutationFn: () => adminApi.supportClose(row.id),
    onSuccess: () => { onDone('Обращение закрыто.'); refresh() },
    onError: (e: Error) => onFail(e.message),
  })

  return (
    <article className="adm-ticket">
      <header className="adm-ticket__head">
        <b>{row.character.nickname}</b> · ур. {row.character.battleLevel} · {when(row.createdAt)}
      </header>
      <p className="adm-ticket__text">{row.text}</p>
      {row.hasImage && (image
        ? <a href={image} target="_blank" rel="noreferrer" className="adm-ticket__shot"><img src={image} alt="Скриншот игрока" /></a>
        : <p className="adm-hint">{imageError ? 'Скриншот не загрузился.' : 'Скриншот загружается…'}</p>)}
      {row.reply && <p className="adm-ticket__reply"><b>{row.repliedBy ?? 'Поддержка'}, {when(row.repliedAt)}:</b> {row.reply}</p>}
      {row.status !== 'CLOSED' && (
        <form className="adm-ticket__form" onSubmit={e => { e.preventDefault(); if (answer.trim()) reply.mutate() }}>
          <textarea value={answer} onChange={e => setAnswer(e.target.value)} rows={3} maxLength={2000}
            placeholder={row.reply ? 'Дописать ответ' : 'Ответ игроку'} aria-label={`Ответ игроку ${row.character.nickname}`} />
          <div className="adm-ticket__actions">
            <button type="submit" disabled={!answer.trim() || reply.isPending}>{reply.isPending ? 'Отправляем…' : 'Ответить'}</button>
            <button type="button" disabled={close.isPending} onClick={() => close.mutate()}>Закрыть</button>
          </div>
        </form>
      )}
    </article>
  )
}
