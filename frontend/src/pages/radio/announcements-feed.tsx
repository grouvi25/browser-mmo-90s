// =============================================================
// Лента объявлений.
//
// Одна и та же на трёх адресах: вкладка «Объявления» в радиорубке и
// пункты меню «Новости» и «Обновления» — они отличаются только тем,
// какой вид показывать. Заводить под каждый свою страницу незачем:
// источник один, разметка одна.
// =============================================================
import { useQuery } from '@tanstack/react-query'

import { announcementsApi, type AnnouncementKind } from '../../shared/api/announcements.api'

const KIND_LABELS: Record<AnnouncementKind, string> = {
  PATCH: 'обновление',
  NEWS: 'новость',
  WORLD: 'в городе',
}

/** Дата в ленте — короткая: год нужен только у прошлогодних. */
function stamp(iso: string): string {
  const at = new Date(iso)
  const sameYear = at.getFullYear() === new Date().getFullYear()
  return at.toLocaleDateString('ru', {
    day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }),
  }) + ', ' + at.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
}

export function AnnouncementsFeed({ kind, empty }: { kind?: AnnouncementKind; empty?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['announcements', kind ?? 'all'],
    queryFn: () => announcementsApi.feed(kind),
    retry: false,
  })

  const items = data?.items ?? []

  if (!isLoading && !items.length) {
    return <p className="radio__empty">{empty ?? 'Объявлений пока нет.'}</p>
  }

  return (
    <div className="announce">
      {items.map(item => (
        <article key={item.id} className={'announce__item' + (item.pinned ? ' is-pinned' : '')}>
          <header>
            <h3>{item.title}</h3>
            <span className={`announce__kind announce__kind--${item.kind.toLowerCase()}`}>
              {KIND_LABELS[item.kind]}
            </span>
            {item.pinned && <span className="announce__pin" title="Закреплено">закреплено</span>}
          </header>
          {/* Перевод строки в объявлении осмысленный: администратор
              разбивает текст на абзацы руками. */}
          <p className="announce__body">{item.body}</p>
          <footer>
            {stamp(item.createdAt)}
            {item.authorLogin && <> · {item.authorLogin}</>}
          </footer>
        </article>
      ))}
    </div>
  )
}
