// Объявления (просьба 27.10: «вкладка для обновлений… доделаем, чтоб
// работала»). Лента «Обновления» и «Новости» в верхнем меню игры была,
// а писать в неё было неоткуда: ручки на сервере есть, экрана в админке
// не было — за всё время не вышло ни одного объявления.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../admin-api'
import type { AnnouncementKind } from '../../../shared/api/announcements.api'
import { Skeleton, Fault, Empty, Note } from '../../stage3/stage3-ui'
import { when } from '../admin-ui'
import { WelcomeEditor } from './welcome-editor'

const KINDS: [AnnouncementKind, string][] = [['PATCH', 'Обновление'], ['NEWS', 'Новость']]
const KIND_LABEL: Record<AnnouncementKind, string> = { PATCH: 'обновление', NEWS: 'новость', WORLD: 'в городе' }

export function AnnouncementsSection() {
  const qc = useQueryClient()
  const [kind, setKind] = useState<AnnouncementKind>('PATCH')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const list = useQuery({ queryKey: ['admin', 'announcements'], queryFn: adminApi.announcements })
  const refresh = (text: string) => { setBad(false); setMsg(text); void qc.invalidateQueries({ queryKey: ['admin', 'announcements'] }) }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }

  const publish = useMutation({
    mutationFn: () => adminApi.publishAnnouncement({ kind, title: title.trim(), body: body.trim(), pinned }),
    onSuccess: () => { setTitle(''); setBody(''); setPinned(false); refresh('Опубликовано — игроки увидят отметку на кнопке меню') },
    onError: fail,
  })
  const pin = useMutation({
    mutationFn: (row: { id: string; pinned: boolean }) => adminApi.pinAnnouncement(row.id, row.pinned),
    onSuccess: (_r, row) => refresh(row.pinned ? 'Закреплено' : 'Откреплено'),
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.removeAnnouncement(id),
    onSuccess: () => refresh('Снято из ленты'),
    onError: fail,
  })

  const ready = title.trim().length > 0 && body.trim().length > 0
  const items = list.data?.items ?? []

  return (
    <>
      <WelcomeEditor />
      <section className="adm-card-block adm-announce-form">
        <h4>Новое объявление</h4>
        <div className="adm-item__fields">
          <label><span>Куда</span>
            <select value={kind} onChange={e => setKind(e.target.value as AnnouncementKind)}>
              {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
          <label className="adm-announce-title"><span>Заголовок</span>
            <input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="Обновление 27 октября" /></label>
          <label className="adm-check"><input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /> Закрепить сверху</label>
        </div>
        <label className="adm-announce-body"><span>Текст</span>
          <textarea value={body} maxLength={2000} rows={8} onChange={e => setBody(e.target.value)}
            placeholder={'— частные заводы заработали…\n— в Швейном цехе шьются кепки…'} /></label>
        <div className="adm-item__save">
          <small>{body.length} / 2000</small>
          <button type="button" disabled={!ready || publish.isPending} onClick={() => publish.mutate()}>
            {publish.isPending ? 'Публикуем…' : 'Опубликовать'}
          </button>
        </div>
        <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      </section>

      {list.isLoading && <Skeleton rows={3} />}
      {list.isError && <Fault retry={() => list.refetch()} />}
      {list.data && (items.length === 0
        ? <Empty title="Объявлений нет" hint="Опубликованное появится здесь и в меню игры." />
        : <div className="adm-announce-list">
            {items.map(item => (
              <article key={item.id} className={item.pinned ? 'is-pinned' : undefined}>
                <header>
                  <b>{item.title}</b>
                  <small>{KIND_LABEL[item.kind]} · {when(item.createdAt)}{item.authorLogin ? ` · ${item.authorLogin}` : ''}{item.pinned ? ' · закреплено' : ''}</small>
                </header>
                <p>{item.body}</p>
                <div className="adm-announce-actions">
                  <button type="button" disabled={pin.isPending} onClick={() => pin.mutate({ id: item.id, pinned: !item.pinned })}>
                    {item.pinned ? 'Открепить' : 'Закрепить'}
                  </button>
                  <button type="button" className="danger" disabled={remove.isPending}
                    onClick={() => { if (window.confirm(`Снять «${item.title}» из ленты?`)) remove.mutate(item.id) }}>
                    Снять
                  </button>
                </div>
              </article>
            ))}
          </div>)}
    </>
  )
}
