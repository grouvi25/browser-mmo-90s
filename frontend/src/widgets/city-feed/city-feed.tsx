// =============================================================
// Чат района и список онлайна.
//
// Транспорта под них на бэкенде пока нет (чат и присутствие —
// Этап 3), поэтому данные отдаёт useCityFeed. Когда появится
// сокет-канал, меняется только этот хук: разметка и вёрстка
// остаются как есть.
// =============================================================
import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { charactersApi } from '../../shared/api/characters.api'
import { MENU } from '../../shared/lib/layout-map'
import { useFitBlock } from '../../shared/lib/use-fit-block'

export interface ChatMessage {
  id: string
  time: string
  nick: string
  tone: 1 | 2 | 3 | 4
  text: string
  own?: boolean
}

export interface OnlinePlayer {
  nick: string
  level: number
  tone: 'r' | 'c' | 'o'
  self?: boolean
}

/** Демо-лента района. Точка подключения реального канала. */
export const DEMO_CHAT: ChatMessage[] = [
  { id: '1', time: '16:31', nick: 'Hitman', tone: 1, text: 'Ну что, собрались наконец? У кого катриджи свежие?' },
  { id: '2', time: '16:32', nick: 'Бездушный гном', tone: 2, text: 'У меня только «Танчики» осталось, всё остальное батя на шкаф убрал.' },
  { id: '3', time: '16:33', nick: 'Кепка СССР', tone: 3, text: 'А я вчера у соседа «Чёрного Плаща» на вечер взял, только не говните джойстик, а!' },
  { id: '4', time: '16:33', nick: 'Жвачный Король', tone: 4, text: 'Я могу батарейки подкинуть для джоя, а то опять полчаса бегать по двору.' },
  { id: '5', time: '16:34', nick: 'Бездушный гном', tone: 2, text: 'А конфеты кто-то брал? У меня рот пустой, пацаны.' },
  { id: '6', time: '16:35', nick: 'Кепка СССР', tone: 3, text: 'Я «Кислый дождик» купил! Могу поделиться — но только за первый ход!' },
]

export const DEMO_ONLINE: OnlinePlayer[] = [
  { nick: 'ISHkA_88', level: 15, tone: 'r' },
  { nick: 'КоSoЛапЫй', level: 15, tone: 'r' },
  { nick: 'BATYA_90', level: 30, tone: 'c' },
  { nick: 'ёЖиК_v_ТУМанЕ', level: 30, tone: 'c' },
  { nick: '4elovek_Keks', level: 1, tone: 'o' },
  { nick: 'GopStop_2077', level: 15, tone: 'r' },
  { nick: 'ДeД_МoРоЗ_Z', level: 15, tone: 'r' },
  { nick: 'Pozytiv4ik', level: 30, tone: 'c' },
]

// ── Чат ──────────────────────────────────────────────────────
export function CityChat() {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<ChatMessage[]>(DEMO_CHAT)
  const [draft, setDraft] = useState('')
  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
  })

  const boxRef = useRef<HTMLDivElement>(null)
  useFitBlock(boxRef, MENU.chat.w, [messages])

  const send = (e: FormEvent) => {
    e.preventDefault()
    const text = draft.trim()
    if (!text || !char) return
    const now = new Date()
    setMessages(prev => [
      ...prev.slice(-(MENU.chat.rows - 1)),
      {
        id: String(Date.now()),
        time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        nick: char.nickname, tone: 1, text, own: true,
      },
    ])
    setDraft('')
  }

  const shown = messages.slice(-MENU.chat.rows)

  return (
    <>
      <div
        ref={boxRef}
        className="city-chat"
        style={{
          left: MENU.chat.x, top: MENU.chat.y,
          fontSize: MENU.chat.size, lineHeight: `${MENU.chat.lineHeight}px`,
        }}
        title="Чат района. Транспорт подключается в Этапе 3 — сейчас лента демонстрационная."
      >
        {shown.map(m => (
          <div key={m.id} className="city-chat__row">
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

      <form onSubmit={send}>
        <input
          className="chat-input"
          style={{
            left: MENU.chatInput.x, top: MENU.chatInput.y,
            width: MENU.chatInput.w, height: MENU.chatInput.h,
            fontSize: MENU.chat.size,
          }}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Написать в чат района…"
          maxLength={200}
          spellCheck={false}
        />
      </form>
    </>
  )
}

// ── Онлайн ───────────────────────────────────────────────────
export function OnlineList() {
  const navigate = useNavigate()
  const { data: char } = useQuery({
    queryKey: ['character', 'me'],
    queryFn: () => charactersApi.getMe(),
    retry: false,
  })

  const listRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLDivElement>(null)

  const players: OnlinePlayer[] = char
    ? [{ nick: char.nickname, level: char.battleLevel, tone: 'o', self: true }, ...DEMO_ONLINE]
    : DEMO_ONLINE

  const shown = players.slice(0, 9)

  // Ник и уровень идут одной строкой: при подмене шрифта они больше
  // не расходятся и не налезают друг на друга, как при абсолютных позициях.
  useFitBlock(listRef, MENU.onlineList.w + 60, [shown.length, char?.nickname])
  useFitBlock(titleRef, MENU.onlineTitle.w, [players.length])

  return (
    <>
      <div
        ref={titleRef}
        className="online-title"
        style={{ left: MENU.onlineTitle.x, top: MENU.onlineTitle.y, fontSize: MENU.onlineTitle.size }}
        title="Присутствие подключается в Этапе 3 — список демонстрационный"
      >
        Игроки онлайн: {players.length}
      </div>

      <div
        ref={listRef}
        className="online-list"
        style={{
          left: MENU.onlineList.x, top: MENU.onlineList.y,
          fontSize: MENU.onlineList.size, lineHeight: `${MENU.onlineList.lineHeight}px`,
        }}
      >
        {shown.map(p => (
          <div
            key={p.nick}
            className={'online-list__row' + (p.self ? ' is-self' : '')}
            onClick={() => navigate(p.self ? '/profile' : `/u/${encodeURIComponent(p.nick)}`)}
            title={p.self ? 'Это вы — открыть личное дело' : `Открыть профиль ${p.nick}`}
          >
            <span className="online-list__nick">{p.nick}</span>
            <span className={`online-lvl online-lvl--${p.tone}`}>{p.level}</span>
          </div>
        ))}
      </div>
    </>
  )
}
