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
  // Какой черновик сейчас в форме: сохранение пойдёт поверх него.
  const [draftId, setDraftId] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const list = useQuery({ queryKey: ['admin', 'announcements'], queryFn: adminApi.announcements })
  const drafts = useQuery({ queryKey: ['admin', 'announcements', 'drafts'], queryFn: adminApi.announcementDrafts })
  const refresh = (text: string) => { setBad(false); setMsg(text); void qc.invalidateQueries({ queryKey: ['admin', 'announcements'] }) }
  const clearForm = () => { setTitle(''); setBody(''); setPinned(false); setDraftId(null) }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }

  const publish = useMutation({
    // Открытый черновик публикуется сам: сначала сохраняем правки, потом выпускаем.
    mutationFn: async () => {
      if (!draftId) return adminApi.publishAnnouncement({ kind, title: title.trim(), body: body.trim(), pinned })
      await adminApi.saveAnnouncementDraft({ id: draftId, kind, title: title.trim(), body: body.trim(), pinned })
      return adminApi.publishAnnouncementDraft(draftId)
    },
    onSuccess: () => { clearForm(); refresh('Опубликовано — игроки увидят отметку на кнопке меню') },
    onError: fail,
  })
  const saveDraft = useMutation({
    mutationFn: () => adminApi.saveAnnouncementDraft({ id: draftId ?? undefined, kind, title: title.trim(), body: body.trim(), pinned }),
    onSuccess: saved => { setDraftId(saved.id); refresh('Черновик сохранён, в ленту он не попал') },
    onError: fail,
  })
  const publishDraft = useMutation({
    mutationFn: (id: string) => adminApi.publishAnnouncementDraft(id),
    onSuccess: (_r, id) => { if (id === draftId) clearForm(); refresh('Черновик опубликован') },
    onError: fail,
  })
  const pin = useMutation({
    mutationFn: (row: { id: string; pinned: boolean }) => adminApi.pinAnnouncement(row.id, row.pinned),
    onSuccess: (_r, row) => refresh(row.pinned ? 'Закреплено' : 'Откреплено'),
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.removeAnnouncement(id),
    onSuccess: (_r, id) => { if (id === draftId) clearForm(); refresh(id === draftId ? 'Черновик удалён' : 'Снято') },
    onError: fail,
  })
  const openDraft = (item: { id: string; kind: AnnouncementKind; title: string; body: string; pinned: boolean }) => {
    setDraftId(item.id); setKind(item.kind); setTitle(item.title); setBody(item.body); setPinned(item.pinned)
    setBad(false); setMsg('Черновик открыт в форме: правьте и сохраняйте или публикуйте')
  }
  const draftItems = drafts.data?.items ?? []

  const ready = title.trim().length > 0 && body.trim().length > 0
  const items = list.data?.items ?? []

  return (
    <>
      <WelcomeEditor />
      {draftItems.length > 0 && (
        <section className="adm-card-block">
          <h4>Черновики ({draftItems.length})</h4>
          <div className="adm-announce-list">
            {draftItems.map(item => (
              <article key={item.id} className={item.id === draftId ? 'is-pinned' : undefined}>
                <header>
                  <b>{item.title}</b>
                  <small>черновик · {KIND_LABEL[item.kind]} · {when(item.updatedAt ?? item.createdAt)}{item.authorLogin ? ` · подготовил ${item.authorLogin}` : ''}</small>
                </header>
                <p>{item.body.length > 400 ? item.body.slice(0, 400) + '…' : item.body}</p>
                <div className="adm-announce-actions">
                  <button type="button" onClick={() => openDraft(item)}>Открыть и править</button>
                  <button type="button" disabled={publishDraft.isPending}
                    onClick={() => { if (window.confirm(`Опубликовать «${item.title}»? Игроки увидят его в ленте.`)) publishDraft.mutate(item.id) }}>
                    Опубликовать
                  </button>
                  <button type="button" className="danger" disabled={remove.isPending}
                    onClick={() => { if (window.confirm(`Удалить черновик «${item.title}»?`)) remove.mutate(item.id) }}>
                    Удалить
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="adm-card-block adm-announce-form">
        <h4>{draftId ? 'Черновик' : 'Новое объявление'}</h4>
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
          <textarea value={body} maxLength={4000} rows={draftId ? 16 : 8} onChange={e => setBody(e.target.value)}
            placeholder={'— частные заводы заработали…\n— в Швейном цехе шьются кепки…'} /></label>
        <div className="adm-item__save">
          <small>{body.length} / 4000</small>
          {draftId && <button type="button" onClick={clearForm}>Закрыть черновик</button>}
          <button type="button" disabled={!ready || saveDraft.isPending} onClick={() => saveDraft.mutate()}>
            {saveDraft.isPending ? 'Сохраняем…' : 'Сохранить черновик'}
          </button>
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
