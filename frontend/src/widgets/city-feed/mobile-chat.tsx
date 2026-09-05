// =============================================================
// Чат и онлайн для мобильной шторки. Источник тот же, что на большом
// экране: /api/chat плюс живые реплики сокетом. Отдельного мобильного
// канала нет — окна разные, эфир один.
// =============================================================
import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { districtKey } from '../city-nav/city-nav'
import { nickTone, useChat, useOnline } from '../../shared/lib/use-chat'
import { chatTime, levelTone } from './city-feed'

export function MobileChat() {
  const navigate = useNavigate()
  const location = useLocation()
  const [draft, setDraft] = useState('')
  const [tab, setTab] = useState<'chat' | 'online'>('chat')

  const district = districtKey(location.pathname + location.search) || 'center'
  const chat = useChat('DISTRICT', district)
  const online = useOnline()

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
  })

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (await chat.send(draft)) setDraft('')
  }

  const players = online
    .map(p => ({ ...p, self: p.characterId === char?.id }))
    .sort((a, b) => Number(b.self) - Number(a.self))

  return (
    <div className="m-chat">
      <div className="m-chat__tabs">
        <button type="button" className={tab === 'chat' ? 'is-active' : ''} onClick={() => setTab('chat')}>
          Чат района
        </button>
        <button type="button" className={tab === 'online' ? 'is-active' : ''} onClick={() => setTab('online')}>
          Онлайн: {players.length}
        </button>
      </div>

      {tab === 'chat' ? (
        <>
          <div className="m-chat__log">
            {chat.messages.map(m => (
              <div key={m.id} className="m-chat__row">
                <span className="city-chat__time">[{chatTime(m.createdAt)}]</span>{' '}
                <span
                  className={`city-chat__nick city-chat__nick--${nickTone(m.nickname)}`}
                  onClick={() => navigate(`/u/${encodeURIComponent(m.nickname)}`)}
                >
                  {m.nickname}:
                </span>{' '}
                {m.body}
              </div>
            ))}
            {!chat.loading && !chat.messages.length && (
              <div className="m-chat__row">В районе тихо. Скажите первое слово.</div>
            )}
          </div>
          <form className="m-chat__form" onSubmit={send}>
            <input
              value={draft}
              onChange={e => { setDraft(e.target.value); if (chat.notice) chat.clearNotice() }}
              placeholder={chat.notice || 'Написать в чат района…'}
              maxLength={chat.maxBody}
              spellCheck={false}
              aria-label="Написать в чат района"
            />
            <button type="submit">→</button>
          </form>
        </>
      ) : (
        <div className="m-chat__online">
          {players.map(p => (
            <button
              key={p.characterId}
              type="button"
              className={'m-chat__player' + (p.self ? ' is-self' : '')}
              onClick={() => navigate(p.self ? '/profile' : `/u/${encodeURIComponent(p.nickname)}`)}
            >
              <span>{p.nickname}</span>
              <b className={`online-list__lvl online-list__lvl--${p.self ? 'o' : levelTone(p.level)}`}>{p.level}</b>
            </button>
          ))}
          {!players.length && <div className="m-chat__row">В эфире пусто.</div>}
        </div>
      )}
    </div>
  )
}
