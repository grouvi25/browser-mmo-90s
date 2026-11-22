import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { contentApi } from '../../shared/api/content.api'
import { libraryApi } from '../../shared/api/library.api'
import { RichText } from '../../widgets/rich-text/rich-text'
import { Empty, Fault, Skeleton } from '../stage3/stage3-ui'
import { RUSTORE_APP } from '../../shared/lib/rustore'
import './library.css'

export function LibraryPage() {
  const [open, setOpen] = useState<string | null>(null)
  const pages = useQuery({ queryKey: ['content', 'LIBRARY'], queryFn: () => contentApi.list('LIBRARY'), staleTime: 60_000 })
  const items = pages.data ?? []
  const tables = useQuery({
    queryKey: ['library', 'tables'],
    queryFn: libraryApi.tables,
    staleTime: 5 * 60_000,
    enabled: items.length > 0,
  })
  if (pages.isLoading) return <Skeleton rows={4} />
  if (pages.isError) return <Fault retry={() => pages.refetch()} />
  if (!items.length) return <Empty title="В библиотеке пока нет опубликованных разделов" />

  const page = items.find(item => item.id === open) ?? items[0]
  const tablesUnavailable = tables.isError && !tables.data
  return (
    <div className="library">
      <nav className="library__toc" aria-label="Разделы библиотеки">
        <Link to="/training">Обучение для новичков</Link>
        {items.map(item => <button key={item.id} type="button" aria-current={item.id === page.id ? 'page' : undefined}
          className={item.id === page.id ? 'is-active' : ''} onClick={() => setOpen(item.id)}>{item.title}</button>)}
        <a href={RUSTORE_APP} target="_blank" rel="noreferrer">Скачать игру в RuStore</a>
      </nav>
      <article className="library__text">
        <h2>{page.title}</h2>
        {tablesUnavailable && <Fault title="Таблицы и числа не загрузились" retry={() => tables.refetch()} />}
        <RichText body={page.body} tables={tables.data} tablesUnavailable={tablesUnavailable} />
      </article>
    </div>
  )
}
