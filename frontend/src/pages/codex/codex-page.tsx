// Кодекс (Дима 19.11): законы города. Разделы пишет администрация в админке,
// вид как у Библиотеки: оглавление слева, текст справа.
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { contentApi } from '../../shared/api/content.api'
import { RichText } from '../../widgets/rich-text/rich-text'
import { Skeleton, Fault, Empty } from '../stage3/stage3-ui'
import '../library/library.css'

export function CodexPage() {
  const pages = useQuery({ queryKey: ['content', 'CODEX'], queryFn: () => contentApi.list('CODEX'), staleTime: 60_000 })
  const [open, setOpen] = useState<string | null>(null)
  if (pages.isLoading) return <Skeleton rows={4} />
  if (pages.isError) return <Fault retry={() => pages.refetch()} />
  const items = pages.data ?? []
  if (!items.length) return <Empty title="Кодекс пока пишется" />
  const page = items.find(p => p.id === open) ?? items[0]
  return (
    <div className="library">
      <nav className="library__toc" aria-label="Разделы кодекса">
        {items.map(p => <button key={p.id} type="button" aria-current={p.id === page.id ? 'page' : undefined}
          className={p.id === page.id ? 'is-active' : ''} onClick={() => setOpen(p.id)}>{p.title}</button>)}
      </nav>
      <article className="library__text"><h2>{page.title}</h2><RichText body={page.body} /></article>
    </div>
  )
}
