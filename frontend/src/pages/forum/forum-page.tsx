import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../shared/api/client'
import { Empty, Fault, Note, Skeleton } from '../stage3/stage3-ui'
import './forum.css'

interface Post {
  id: string
  body: string
  createdAt: string
  author: { nickname: string }
}

interface TopicList {
  items: { id: string; title: string; pinnedAt: string | null; activityAt: string; author: Post['author']; _count: { replies: number } }[]
  more: boolean
}

interface TopicDetail {
  topic: Post & { title: string; pinnedAt: string | null }
  replies: Post[]
  more: boolean
  canModerate: boolean
}

const path = '/api/forum'
const forumDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' })

function Pagination({ page, more, go }: { page: number; more: boolean; go: (page: number) => void }) {
  if (page === 1 && !more) return null
  return <nav className="forum__actions" aria-label="Страницы форума">
    <button className="btn" type="button" disabled={page === 1} onClick={() => go(page - 1)}>Назад</button>
    <span>{page}</span>
    <button className="btn" type="button" disabled={!more} onClick={() => go(page + 1)}>Дальше</button>
  </nav>
}

function Topics() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const list = useQuery({ queryKey: ['forum', 'topics', page], queryFn: () => api.get<TopicList>(path + '?page=' + page) })
  const write = useMutation({
    mutationFn: () => api.post<{ id: string }>(path, { title: title.trim(), body: body.trim() }),
    onSuccess: ({ id }) => {
      void qc.invalidateQueries({ queryKey: ['forum', 'topics'] })
      navigate('/forum/' + id)
    },
  })
  const items = list.data?.items ?? []
  return <div className="forum">
    <details className="forum__post">
      <summary>Новая тема</summary>
      <form className="forum__form" onSubmit={event => { event.preventDefault(); write.mutate() }}>
        <label>Заголовок <input maxLength={100} required value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label>Сообщение <textarea maxLength={4000} rows={4} required value={body} onChange={event => setBody(event.target.value)} /></label>
        <button type="submit" className="btn" disabled={!title.trim() || !body.trim() || write.isPending}>Опубликовать тему</button>
        <Note kind="bad" text={write.error?.message ?? ''} />
      </form>
    </details>
    {list.isLoading && <Skeleton rows={3} />}
    {list.isError && <Fault retry={() => list.refetch()} />}
    {list.isSuccess && !items.length && <Empty title={page === 1 ? 'Пока нет тем' : 'На этой странице нет тем'} />}
    {items.length > 0 && <ul className="forum__topics">{items.map(topic =>
      <li key={topic.id} className="forum__post">
        <Link to={'/forum/' + topic.id}>{topic.title}</Link>
        <small>{topic.pinnedAt && 'Закреплено · '}{topic.author.nickname} · ответов: {topic._count.replies} · {forumDate.format(new Date(topic.activityAt))}</small>
      </li>
    )}</ul>}
    <Pagination page={page} more={!!list.data?.more} go={setPage} />
  </div>
}

function Topic({ id }: { id: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [body, setBody] = useState('')
  const key = ['forum', 'topic', id]
  const detail = useQuery({ queryKey: [...key, page], queryFn: () => api.get<TopicDetail>(path + '/' + id + '?page=' + page) })
  const reply = useMutation({
    mutationFn: () => api.post(path + '/' + id + '/replies', { body: body.trim() }),
    onSuccess: () => { setBody(''); void qc.invalidateQueries({ queryKey: ['forum'] }) },
  })
  const pin = useMutation({
    mutationFn: (pinned: boolean) => api.patch(path + '/moderation/topics/' + id + '/pin', { pinned }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['forum'] }),
  })
  const remove = useMutation({
    mutationFn: (target: { type: 'topics' | 'replies'; id: string }) => api.delete(path + '/moderation/' + target.type + '/' + target.id),
    onSuccess: (_result, { type }) => {
      void qc.invalidateQueries({ queryKey: ['forum'] })
      if (type === 'topics') navigate('/forum', { replace: true })
    },
  })
  const control = (type: 'topics' | 'replies', targetId: string) => detail.data?.canModerate &&
    <button type="button" className="btn" disabled={remove.isPending}
      onClick={() => { if (window.confirm('Скрыть публикацию с форума?')) remove.mutate({ type, id: targetId }) }}>
      {type === 'topics' ? 'Скрыть тему' : 'Скрыть ответ'}
    </button>
  const topic = detail.data?.topic
  return <div className="forum">
    <Link to="/forum">Все темы</Link>
    {detail.isLoading && <Skeleton rows={3} />}
    {detail.isError && <Fault title={detail.error.message} retry={() => detail.refetch()} />}
    {topic && <>
      <article className="forum__post">
        <h2>{topic.title}</h2>
        <small>{topic.pinnedAt && 'Закреплено · '}{topic.author.nickname} · {forumDate.format(new Date(topic.createdAt))}</small>
        <p>{topic.body}</p>
        {detail.data?.canModerate && <div className="forum__actions">
          <button type="button" className="btn" disabled={pin.isPending} onClick={() => pin.mutate(!topic.pinnedAt)}>
            {topic.pinnedAt ? 'Открепить тему' : 'Закрепить тему'}
          </button>
          {control('topics', topic.id)}
        </div>}
        <Note text={pin.error?.message ?? ''} kind="bad" />
      </article>
      {detail.data?.replies.map(post => <article className="forum__post" key={post.id}>
        <small>{post.author.nickname} · {forumDate.format(new Date(post.createdAt))}</small>
        <p>{post.body}</p>
        {control('replies', post.id)}
      </article>)}
      <Pagination page={page} more={!!detail.data?.more} go={setPage} />
      <form className="forum__form" onSubmit={event => { event.preventDefault(); reply.mutate() }}>
        <label>Ответ <textarea maxLength={4000} rows={3} required value={body} onChange={event => setBody(event.target.value)} /></label>
        <button type="submit" className="btn" disabled={!body.trim() || reply.isPending}>Отправить ответ</button>
        <Note text={reply.error?.message ?? (reply.isSuccess ? 'Ответ опубликован' : '')} kind={reply.isError ? 'bad' : 'ok'} />
      </form>
      <Note text={remove.error?.message ?? ''} kind="bad" />
    </>}
  </div>
}

export function ForumPage() {
  const { topicId } = useParams()
  return topicId ? <Topic key={topicId} id={topicId} /> : <Topics />
}
