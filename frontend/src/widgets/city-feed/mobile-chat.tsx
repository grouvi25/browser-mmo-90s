// =============================================================
// Чат и онлайн для мобильной шторки. Данные те же, что на
// большом экране (DEMO_CHAT / DEMO_ONLINE) — когда появится
// сокет-канал Этапа 3, меняется один источник на оба вида.
// =============================================================
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { DEMO_CHAT, DEMO_ONLINE, type ChatMessage } from './city-feed'

export function MobileChat() {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<ChatMessage[]>(DEMO_CHAT)
  const [draft, setDraft] = useState('')
  const [tab, setTab] = useState<'chat' | 'online'>('chat')

  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
  })

  const send = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || !char) return
    const now = new Date()
    setMessages(prev => [...prev, {
      id: String(Date.now()),
      time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      nick: char.nickname, tone: 1, text, own: true,
    }])
    setDraft('')
  }

  const players = char
    ? [{ nick: char.nickname, level: char.battleLevel, tone: 'o' as const, self: true }, ...DEMO_ONLINE]
    : DEMO_ONLINE

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
            {messages.map(m => (
              <div key={m.id} className="m-chat__row">
                <span className="city-chat__time">[{m.time}]</span>{' '}
                <span
                  className={`city-chat__nick city-chat__nick--${m.tone}`}
                  onClick={() => navigate(`/u/${encodeURIComponent(m.nick)}`)}
                >
                  {m.nick}:
                </span>{' '}
                {m.text}
              </div>
            ))}
          </div>
          <form className="m-chat__form" onSubmit={send}>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Демо-сообщение (только у вас)…"
              maxLength={200}
              spellCheck={false}
            />
            <button type="submit">→</button>
          </form>
          <p className="m-chat__note">Демо: сообщение видно только вам и исчезнет после обновления страницы. Общий чат появится в Этапе 3.</p>
        </>
      ) : (
        <div className="m-chat__online">
          {players.map(p => (
            <button
              key={p.nick}
              type="button"
              className={'m-chat__player' + ('self' in p && p.self ? ' is-self' : '')}
              onClick={() => navigate('self' in p && p.self ? '/profile' : `/u/${encodeURIComponent(p.nick)}`)}
            >
              <span>{p.nick}</span>
              <b className={`online-list__lvl online-list__lvl--${p.tone}`}>{p.level}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
