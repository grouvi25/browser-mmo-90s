// =============================================================
// Отметка «новое» на кнопках «Новости» и «Обновления» (просьба 27.10:
// вкладка обновлений должна работать как оповещение). Помним, до какого
// объявления игрок дочитал, — в браузере: это удобство, а не данные игры,
// и без хранилища всё работает, просто отметка не гаснет до перезахода.
// =============================================================
import { useEffect, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { announcementsApi, type Announcement, type AnnouncementKind } from '../api/announcements.api'

const KEY = (kind: AnnouncementKind) => `mmo_seen_announcement_${kind}`
const listeners = new Set<() => void>()

function readSeen(kind: AnnouncementKind): string {
  try { return localStorage.getItem(KEY(kind)) ?? '' } catch { return '' }
}

const newest = (items: Announcement[] | undefined) =>
  (items ?? []).reduce((max, item) => (item.createdAt > max ? item.createdAt : max), '')

/** Есть ли объявление новее прочитанного. */
export function useUnreadAnnouncements(kind: AnnouncementKind): boolean {
  const seen = useSyncExternalStore(
    notify => { listeners.add(notify); return () => { listeners.delete(notify) } },
    () => readSeen(kind),
  )
  const { data } = useQuery({
    queryKey: ['announcements', 'latest', kind],
    queryFn: () => announcementsApi.feed(kind, 5),
    refetchInterval: 120_000,
    retry: false,
  })
  const latest = newest(data?.items)
  return !!latest && latest > seen
}

/** Открытая лента гасит отметку: всё, что в ней есть, прочитано. */
export function useMarkAnnouncementsSeen(kind: AnnouncementKind | undefined, items: Announcement[] | undefined) {
  const latest = newest(items)
  useEffect(() => {
    if (!kind || !latest || latest <= readSeen(kind)) return
    try { localStorage.setItem(KEY(kind), latest) } catch { /* без хранилища отметка просто не погаснет */ }
    listeners.forEach(notify => notify())
  }, [kind, latest])
}
