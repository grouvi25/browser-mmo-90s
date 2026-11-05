// =============================================================
// Приглашение в бригаду видно с любого экрана.
//
// Ответить на него можно только в Домах бригад, и игроки его не находили:
// «и где это предложение?», «нет там ничего». Строка в чате уезжает вверх,
// поэтому напоминание висит, пока боец не ответит.
// =============================================================
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { charactersApi } from '../shared/api/characters.api'
import { clansApi } from '../shared/api/clans.api'
import './invite-strip.css'

const ANSWER_PAGE = '/clan-houses'

export function InviteStrip() {
  const { pathname } = useLocation()
  const me = useQuery({ queryKey: ['character', 'me'], queryFn: charactersApi.getMe })
  const invites = useQuery({
    queryKey: ['clan', 'invites'],
    queryFn: clansApi.myInvites,
    enabled: !!me.data && !me.data.clan,
    refetchInterval: 30_000,
  })
  const items = invites.data?.items ?? []
  if (me.data?.clan || items.length === 0) return null
  if (pathname === ANSWER_PAGE || pathname.startsWith('/battle/')) return null

  const more = items.length - 1
  return createPortal(
    <div className="invite-strip" role="status">
      <span>Вас зовут в бригаду «{items[0].clan.name}»{more > 0 ? ` и ещё ${more}` : ''}</span>
      <Link to={ANSWER_PAGE}>Ответить</Link>
    </div>,
    document.body,
  )
}
