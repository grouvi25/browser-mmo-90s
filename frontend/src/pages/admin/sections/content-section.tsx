// Библиотека и Кодекс (Дима 19.11): разделы, которые администрация пишет сама.
// Встроенные разделы Библиотеки с таблицами из игры остаются как есть, эти
// добавляются после них. Кодекс целиком состоит из таких разделов.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type AdminContentPage } from '../admin-api'
import type { ContentSection as Section } from '../../../shared/api/content.api'
import { RichText } from '../../../widgets/rich-text/rich-text'
import { Skeleton, Fault, Empty, Note } from '../../stage3/stage3-ui'
import { when } from '../admin-ui'
import '../../library/library.css'

const SECTIONS: [Section, string][] = [['LIBRARY', 'Библиотека'], ['CODEX', 'Кодекс']]
const MAX_BODY = 20_000

interface Form { id: string | null; title: string; body: string; sortOrder: number; isPublished: boolean }
const EMPTY: Form = { id: null, title: '', body: '', sortOrder: 0, isPublished: true }

export function ContentSection() {
  const qc = useQueryClient()
  const [section, setSection] = useState<Section>('LIBRARY')
  const [form, setForm] = useState<Form>(EMPTY)
  const [preview, setPreview] = useState(false)
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const list = useQuery({ queryKey: ['admin', 'content', section], queryFn: () => adminApi.contentPages(section) })
  const done = (text: string) => {
    setBad(false); setMsg(text)
    void qc.invalidateQueries({ queryKey: ['admin', 'content'] })
    void qc.invalidateQueries({ queryKey: ['content'] })
  }
  const fail = (e: Error) => { setBad(true); setMsg(e.message) }

  const save = useMutation({
    mutationFn: () => {
      const body = { title: form.title.trim(), body: form.body.trim(), sortOrder: form.sortOrder, isPublished: form.isPublished }
      return form.id ? adminApi.updateContentPage(form.id, body) : adminApi.createContentPage({ section, ...body })
    },
    onSuccess: saved => { setForm(f => ({ ...f, id: saved.id })); done(form.isPublished ? 'Сохранено, игроки уже видят' : 'Сохранено, раздел скрыт от игроков') },
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: (id: string) => adminApi.removeContentPage(id),
    onSuccess: (_r, id) => { if (id === form.id) setForm(EMPTY); done('Раздел удален') },
    onError: fail,
  })

  const open = (page: AdminContentPage) => {
    setForm({ id: page.id, title: page.title, body: page.body, sortOrder: page.sortOrder, isPublished: page.isPublished })
    setPreview(false); setMsg('')
  }
  const switchSection = (next: Section) => { setSection(next); setForm(EMPTY); setPreview(false); setMsg('') }
  const ready = form.title.trim().length > 0 && form.body.trim().length > 0
  const items = list.data ?? []

  return (
    <>
      <div className="adm-switch">
        {SECTIONS.map(([key, label]) => (
          <button key={key} type="button" className={section === key ? 'active' : ''} onClick={() => switchSection(key)}>{label}</button>
        ))}
      </div>

      {list.isLoading && <Skeleton rows={3} />}
      {list.isError && <Fault retry={() => list.refetch()} />}
      {list.data && (items.length === 0
        ? <Empty title="Своих разделов пока нет" />
        : <div className="adm-announce-list">
            {items.map(page => (
              <article key={page.id} className={page.id === form.id ? 'is-pinned' : undefined}>
                <header>
                  <b>{page.title}</b>
                  <small>порядок {page.sortOrder} · {page.isPublished ? 'видно игрокам' : 'скрыт'} · {when(page.updatedAt)}{page.updatedBy ? ` · ${page.updatedBy}` : ''}</small>
                </header>
                <div className="adm-announce-actions">
                  <button type="button" onClick={() => open(page)}>Править</button>
                  <button type="button" className="danger" disabled={remove.isPending}
                    onClick={() => { if (window.confirm(`Удалить раздел «${page.title}»? Текст пропадет насовсем.`)) remove.mutate(page.id) }}>
                    Удалить
                  </button>
                </div>
              </article>
            ))}
          </div>)}

      <section className="adm-card-block adm-announce-form">
        <h4>{form.id ? 'Правка раздела' : 'Новый раздел'}</h4>
        <div className="adm-item__fields">
          <label className="adm-announce-title"><span>Название</span>
            <input value={form.title} maxLength={80} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></label>
          <label><span>Порядок</span>
            <input type="number" value={form.sortOrder} min={-1000} max={1000} onChange={e => setForm(f => ({ ...f, sortOrder: Number(e.target.value) || 0 }))} /></label>
          <label className="adm-check"><input type="checkbox" checked={form.isPublished} onChange={e => setForm(f => ({ ...f, isPublished: e.target.checked }))} /> Видно игрокам</label>
        </div>
        {preview
          ? <div className="library__text adm-content-preview"><h2>{form.title || 'Без названия'}</h2><RichText body={form.body} /></div>
          : <label className="adm-announce-body"><span>Текст</span>
              <textarea value={form.body} maxLength={MAX_BODY} rows={18} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                placeholder={'## Подзаголовок\nАбзац текста. Пустая строка начинает новый абзац.\n\n- пункт списка\n- еще пункт\n\n**жирным** выделяется так'} /></label>}
        <div className="adm-item__save">
          <small>{form.body.length} / {MAX_BODY}</small>
          <button type="button" onClick={() => setPreview(p => !p)}>{preview ? 'Править текст' : 'Как увидят игроки'}</button>
          {form.id && <button type="button" onClick={() => { setForm(EMPTY); setPreview(false); setMsg('') }}>Новый раздел</button>}
          <button type="button" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
        <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      </section>
    </>
  )
}
