// Окно при входе в игру (просьба Дмитрия 29.10): текст и выключатель.
// Правка текста показывает окно игрокам ещё раз — даже тем, кто его уже закрыл.
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../admin-api'
import { Fault, Note, Skeleton } from '../../stage3/stage3-ui'

export function WelcomeEditor() {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['admin', 'welcome'], queryFn: adminApi.welcome })
  const [enabled, setEnabled] = useState(false)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const [bad, setBad] = useState(false)

  const loaded = q.data?.welcome
  useEffect(() => {
    if (!q.data) return
    setEnabled(loaded?.enabled ?? false)
    setTitle(loaded?.title ?? '')
    setText(loaded?.text ?? '')
  }, [q.data, loaded])

  const save = useMutation({
    mutationFn: () => adminApi.saveWelcome({ enabled, title: title.trim(), text: text.trim() }),
    onSuccess: r => {
      qc.setQueryData(['admin', 'welcome'], r)
      setBad(false)
      setMsg(!r.welcome.enabled ? 'Окно выключено.' : r.welcome.version !== loaded?.version ? 'Сохранено — игроки увидят новое окно при следующем заходе.' : 'Сохранено.')
    },
    onError: (e: Error) => { setBad(true); setMsg(e.message) },
  })

  if (q.isLoading) return <Skeleton rows={2} />
  if (q.isError) return <Fault retry={() => q.refetch()} />
  const ready = title.trim().length > 0 && text.trim().length > 0

  return (
    <section className="adm-card-block adm-announce-form">
      <h4>Окно при входе в игру</h4>
      <p className="adm-hint">Показывается игроку один раз за сеанс. Пустая строка в тексте — новый абзац.</p>
      <Note text={msg} kind={bad ? 'bad' : 'ok'} />
      <div className="adm-item__fields">
        <label className="adm-announce-title"><span>Заголовок</span>
          <input value={title} maxLength={120} onChange={e => setTitle(e.target.value)} /></label>
        <label className="adm-check"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Показывать</label>
      </div>
      <label className="adm-announce-body"><span>Текст</span>
        <textarea value={text} maxLength={2000} rows={5} onChange={e => setText(e.target.value)} /></label>
      <div className="adm-ticket__actions">
        <button type="button" disabled={!ready || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Сохраняем…' : 'Сохранить'}</button>
      </div>
    </section>
  )
}
